const DEFAULT_BASE_URL = 'https://api.trongrid.io';
const TXID_PATTERN = /^[a-f0-9]{64}$/i;
const TRON_HEX_PREFIX = '41';
const TRANSFER_SELECTOR = 'a9059cbb';
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function hexToBase58(input) {
  const hex = clean(input).replace(/^0x/i, '').toLowerCase();
  if (!/^[0-9a-f]+$/.test(hex)) return '';
  const bytes = Buffer.from(hex.length % 2 ? `0${hex}` : hex, 'hex');
  let value = BigInt(`0x${bytes.toString('hex') || '0'}`);
  let encoded = '';
  while (value > 0n) {
    const remainder = Number(value % 58n);
    encoded = ALPHABET[remainder] + encoded;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }
  return encoded || '1';
}

function base58ToHex(input) {
  const value = clean(input);
  if (!value) return '';
  let number = 0n;
  for (const character of value) {
    const index = ALPHABET.indexOf(character);
    if (index < 0) return '';
    number = number * 58n + BigInt(index);
  }
  let hex = number.toString(16).padStart(2, '0');
  const leadingOnes = value.match(/^1*/)?.[0].length || 0;
  hex = `${'00'.repeat(leadingOnes)}${hex}`;
  return hex.slice(-42).padStart(42, '0').toLowerCase();
}

function addressFromHex(value) {
  const hex = clean(value).replace(/^0x/i, '').toLowerCase();
  const normalized = hex.length === 40 ? `${TRON_HEX_PREFIX}${hex}` : hex;
  return normalized.length === 42 ? hexToBase58(normalized) : '';
}

function addressToHex(value) {
  const address = clean(value);
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) return base58ToHex(address);
  const hex = address.replace(/^0x/i, '').toLowerCase();
  return hex.length === 40 ? `${TRON_HEX_PREFIX}${hex}` : hex;
}

function jsonHeaders(apiKey) {
  const headers = { accept: 'application/json', 'content-type': 'application/json' };
  if (apiKey) headers['TRON-PRO-API-KEY'] = apiKey;
  return headers;
}

function extractContractCall(transaction) {
  const contract = transaction?.raw_data?.contract?.[0];
  const parameter = contract?.parameter?.value;
  const data = clean(parameter?.data).toLowerCase();
  if (contract?.type !== 'TriggerSmartContract' || !data.startsWith(TRANSFER_SELECTOR) || data.length < 136) return null;
  const recipientHex = data.slice(32, 96);
  const amountHex = data.slice(96, 160);
  let amountRaw;
  try {
    amountRaw = BigInt(`0x${amountHex}`);
  } catch {
    return null;
  }
  return {
    tokenContract: addressFromHex(parameter.contract_address),
    toAddress: addressFromHex(recipientHex),
    amountRaw,
    fromAddress: addressFromHex(parameter.owner_address)
  };
}

function extractTransfer(data, txid) {
  const transfers = Array.isArray(data) ? data : [];
  const match = transfers.find((item) => clean(item.transaction_id || item.txID || item.txid).toLowerCase() === txid.toLowerCase());
  if (!match) return null;
  const tokenInfo = asObject(match.token_info);
  const decimals = Number(match.decimals ?? tokenInfo.decimals ?? process.env.USDT_TOKEN_DECIMALS ?? 6);
  const rawAmount = clean(match.value ?? match.amount_str ?? match.amount);
  let amountUsdt = null;
  try {
    if (/^\d+$/.test(rawAmount)) amountUsdt = Number(BigInt(rawAmount)) / (10 ** decimals);
    else if (rawAmount) amountUsdt = Number(rawAmount);
  } catch {
    amountUsdt = null;
  }
  return {
    fromAddress: clean(match.from || match.from_address),
    toAddress: clean(match.to || match.to_address),
    tokenContract: clean(tokenInfo.address || match.contract_address || match.token_address),
    amountUsdt,
    success: match.status === undefined || Number(match.status) === 0 || String(match.status).toUpperCase() === 'SUCCESS',
    decimals,
    raw: match
  };
}

function isSuccessfulReceipt(info) {
  const receiptResult = clean(info?.receipt?.result || info?.receipt?.contractRet).toUpperCase();
  const contractRet = clean(info?.contractRet).toUpperCase();
  const retValues = Array.isArray(info?.ret) ? info.ret.map((item) => clean(item?.contractRet).toUpperCase()) : [];
  return receiptResult === 'SUCCESS' || contractRet === 'SUCCESS' || retValues.includes('SUCCESS');
}

function blockNumberFrom(info) {
  const value = info?.blockNumber ?? info?.block_num;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export class TronGridProvider {
  constructor({ baseUrl = process.env.TRONGRID_BASE_URL || DEFAULT_BASE_URL, apiKey = process.env.TRONGRID_API_KEY || '', receivingAddress = process.env.USDT_RECEIVING_ADDRESS || '', tokenContract = process.env.USDT_TOKEN_CONTRACT || '', fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {}) {
    this.baseUrl = clean(baseUrl).replace(/\/$/, '');
    this.apiKey = clean(apiKey);
    this.receivingAddress = clean(receivingAddress);
    this.tokenContract = clean(tokenContract);
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  get configured() {
    return Boolean(this.apiKey && this.baseUrl && this.fetchImpl);
  }

  async request(path, { method = 'GET', body } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: jsonHeaders(this.apiKey),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });
      let payload = {};
      try { payload = await response.json(); } catch { payload = {}; }
      if (!response.ok) {
        const error = new Error(`TronGrid request failed with HTTP ${response.status}.`);
        error.status = response.status;
        error.payload = payload;
        throw error;
      }
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getTransaction(txid) {
    const cleanTxid = clean(txid);
    if (!TXID_PATTERN.test(cleanTxid)) {
      const error = new Error('Invalid TRON transaction ID.');
      error.code = 'INVALID_TXID';
      throw error;
    }
    const [body, info] = await Promise.all([
      this.request('/wallet/gettransactionbyid', { method: 'POST', body: { value: cleanTxid } }),
      this.request('/wallet/gettransactioninfobyid', { method: 'POST', body: { value: cleanTxid } })
    ]);
    if (!body || !body.txID) {
      const error = new Error('TRON transaction was not found.');
      error.code = 'TX_NOT_FOUND';
      throw error;
    }
    const blockNumber = blockNumberFrom(info);
    const receiptExists = Boolean(info && (info.blockNumber || info.contractResult || info.contractRet || info.receipt || info.ret));
    const pending = !receiptExists;
    const decoded = extractContractCall(body);
    let transfer = null;
    if (this.receivingAddress) {
      const contract = encodeURIComponent(this.tokenContract);
      const address = encodeURIComponent(this.receivingAddress);
      try {
        const history = await this.request(`/v1/accounts/${address}/transactions/trc20?limit=200&only_confirmed=false${contract ? `&contract_address=${contract}` : ''}`);
        transfer = extractTransfer(history?.data, cleanTxid);
      } catch (error) {
        if (![403, 429].includes(error.status)) throw error;
      }
    }
    const amountUsdt = transfer?.amountUsdt ?? (decoded ? Number(decoded.amountRaw) / (10 ** Number(process.env.USDT_TOKEN_DECIMALS || 6)) : null);
    const latestBlockResponse = blockNumber ? await this.request('/wallet/getnowblock', { method: 'POST', body: {} }) : null;
    const latestBlock = Number(latestBlockResponse?.block_header?.raw_data?.number);
    const confirmations = blockNumber && Number.isFinite(latestBlock) ? Math.max(0, latestBlock - blockNumber + 1) : 0;
    return {
      txid: cleanTxid,
      network: 'TRC20',
      fromAddress: transfer?.fromAddress || decoded?.fromAddress || addressFromHex(body?.raw_data?.contract?.[0]?.parameter?.value?.owner_address),
      toAddress: transfer?.toAddress || decoded?.toAddress || '',
      tokenContract: transfer?.tokenContract || decoded?.tokenContract || '',
      amountUsdt,
      confirmations,
      success: !pending && isSuccessfulReceipt(info) && (transfer?.success ?? true),
      pending,
      blockNumber,
      raw: { body, info, transfer: transfer?.raw || null }
    };
  }
}

export const tronAddress = { addressFromHex, addressToHex };
