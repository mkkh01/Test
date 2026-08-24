const DEFAULT_RPC_URL = 'https://api.mainnet-beta.solana.com';
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SOLANA_USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const SIGNATURE_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{64,96}$/;

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function isValidSolanaAddress(value) {
  const input = clean(value);
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input)) return false;
  let decoded = 0n;
  for (const character of input) {
    const digit = BASE58_ALPHABET.indexOf(character);
    if (digit < 0) return false;
    decoded = decoded * 58n + BigInt(digit);
  }
  const hexLength = decoded === 0n ? 0 : decoded.toString(16).length;
  const decodedBytes = Math.ceil(hexLength / 2) + (input.match(/^1*/)?.[0].length || 0);
  return decodedBytes === 32;
}

function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function asRawAmount(balance) {
  const amount = clean(balance?.uiTokenAmount?.amount);
  return /^\d+$/.test(amount) ? BigInt(amount) : 0n;
}

function accountKeyAt(accountKeys, index) {
  const entry = accountKeys?.[index];
  return clean(typeof entry === 'string' ? entry : entry?.pubkey);
}

function tokenBalanceDelta(preBalance, postBalance) {
  return asRawAmount(postBalance) - asRawAmount(preBalance);
}

function matchingBalance(balances, accountIndex, mint) {
  return balances.find((item) => Number(item.accountIndex) === Number(accountIndex) && clean(item.mint) === mint) || null;
}

export class SolanaRpcProvider {
  constructor({
    rpcUrl = process.env.SOLANA_RPC_URL || DEFAULT_RPC_URL,
    receivingAddress = process.env.USDT_RECEIVING_ADDRESS || '',
    tokenContract = process.env.SOLANA_USDT_MINT || '',
    tokenDecimals = Number(process.env.USDT_TOKEN_DECIMALS || 6),
    commitment = process.env.SOLANA_COMMITMENT || 'finalized',
    fetchImpl = globalThis.fetch,
    timeoutMs = 15_000
  } = {}) {
    this.rpcUrl = clean(rpcUrl);
    this.receivingAddress = clean(receivingAddress);
    this.tokenContract = clean(tokenContract);
    this.tokenDecimals = Number.isInteger(tokenDecimals) && tokenDecimals >= 0 ? tokenDecimals : 6;
    this.commitment = ['confirmed', 'finalized'].includes(clean(commitment)) ? clean(commitment) : 'finalized';
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  get configured() {
    return Boolean(this.rpcUrl && this.fetchImpl && isValidSolanaAddress(this.receivingAddress) && this.tokenContract === SOLANA_USDT_MINT);
  }

  async request(method, params) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.rpcUrl, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
        signal: controller.signal
      });
      let payload = {};
      try { payload = await response.json(); } catch { payload = {}; }
      if (!response.ok) {
        const error = new Error(`Solana RPC request failed with HTTP ${response.status}.`);
        error.status = response.status;
        error.payload = payload;
        throw error;
      }
      if (payload.error) {
        const error = new Error(payload.error.message || `Solana RPC method ${method} failed.`);
        error.code = 'RPC_ERROR';
        error.rpcCode = payload.error.code;
        error.status = [429, -32005].includes(payload.error.code) ? 429 : 502;
        error.payload = payload;
        throw error;
      }
      return payload.result;
    } finally {
      clearTimeout(timeout);
    }
  }

  async resolveTokenOwner(tokenAccount) {
    if (!tokenAccount) return '';
    try {
      const result = await this.request('getAccountInfo', [tokenAccount, { encoding: 'jsonParsed', commitment: this.commitment }]);
      return clean(result?.value?.data?.parsed?.info?.owner);
    } catch {
      return '';
    }
  }

  async getPendingTransaction(txid, rawStatus) {
    const status = rawStatus?.value?.[0];
    if (!status || status.err) {
      const error = new Error('Solana transaction was not found.');
      error.code = 'TX_NOT_FOUND';
      throw error;
    }
    return {
      txid,
      network: 'SOLANA_SPL',
      fromAddress: '',
      toAddress: '',
      tokenContract: '',
      amountUsdt: null,
      confirmations: status.confirmationStatus === 'finalized' ? 1 : 0,
      success: false,
      pending: status.confirmationStatus !== 'finalized',
      finalized: status.confirmationStatus === 'finalized',
      slot: Number(status.slot) || null,
      raw: { status }
    };
  }

  async getTransaction(txid) {
    const cleanTxid = clean(txid);
    if (!SIGNATURE_PATTERN.test(cleanTxid)) {
      const error = new Error('Invalid Solana transaction signature.');
      error.code = 'INVALID_TXID';
      throw error;
    }

    const result = await this.request('getTransaction', [cleanTxid, {
      commitment: this.commitment,
      encoding: 'jsonParsed',
      maxSupportedTransactionVersion: 0
    }]);

    if (!result) {
      const status = await this.request('getSignatureStatuses', [[cleanTxid], { searchTransactionHistory: true }]);
      return this.getPendingTransaction(cleanTxid, status);
    }

    const meta = asObject(result.meta);
    const transaction = asObject(result.transaction);
    const message = asObject(transaction.message);
    const accountKeys = Array.isArray(message.accountKeys) ? message.accountKeys : [];
    const preBalances = Array.isArray(meta.preTokenBalances) ? meta.preTokenBalances : [];
    const postBalances = Array.isArray(meta.postTokenBalances) ? meta.postTokenBalances : [];
    const mintBalances = postBalances.filter((item) => clean(item.mint) === this.tokenContract);

    let matched = null;
    for (const postBalance of mintBalances) {
      const preBalance = matchingBalance(preBalances, postBalance.accountIndex, this.tokenContract);
      const delta = tokenBalanceDelta(preBalance, postBalance);
      if (delta <= 0n) continue;
      const tokenAccount = accountKeyAt(accountKeys, postBalance.accountIndex);
      const owner = clean(postBalance.owner) || await this.resolveTokenOwner(tokenAccount);
      if (owner === this.receivingAddress) {
        matched = { postBalance, preBalance, delta, tokenAccount, owner };
        break;
      }
    }

    let fromAddress = '';
    for (const preBalance of preBalances.filter((item) => clean(item.mint) === this.tokenContract)) {
      const postBalance = matchingBalance(postBalances, preBalance.accountIndex, this.tokenContract);
      const delta = tokenBalanceDelta(preBalance, postBalance);
      if (delta >= 0n) continue;
      fromAddress = clean(preBalance.owner) || await this.resolveTokenOwner(accountKeyAt(accountKeys, preBalance.accountIndex));
      if (fromAddress) break;
    }

    const decimals = Number(matched?.postBalance?.uiTokenAmount?.decimals ?? this.tokenDecimals);
    const amountUsdt = matched ? Number(matched.delta) / (10 ** decimals) : null;
    const finalized = this.commitment === 'finalized';
    const success = meta.err === null && Boolean(matched);
    const signatures = Array.isArray(transaction.signatures) ? transaction.signatures : [];

    return {
      txid: cleanTxid,
      network: 'SOLANA_SPL',
      fromAddress,
      toAddress: matched ? this.receivingAddress : '',
      tokenContract: matched ? this.tokenContract : (mintBalances[0]?.mint || ''),
      tokenAccount: matched?.tokenAccount || '',
      amountUsdt,
      decimals,
      confirmations: finalized ? 1 : 0,
      success,
      pending: false,
      finalized,
      slot: Number(result.slot) || null,
      signatureFound: signatures.includes(cleanTxid),
      raw: { result }
    };
  }
}

export const solanaConstants = { TOKEN_PROGRAM_ID, SOLANA_USDT_MINT, DEFAULT_RPC_URL, SIGNATURE_PATTERN };
