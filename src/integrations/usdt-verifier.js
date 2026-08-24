const SUPPORTED_NETWORKS = new Set(['SOLANA_SPL']);

function normalize(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export class UsdtVerifier {
  constructor({ network = process.env.USDT_NETWORK || 'SOLANA_SPL', receivingAddress = process.env.USDT_RECEIVING_ADDRESS || '', tokenContract = process.env.SOLANA_USDT_MINT || process.env.USDT_TOKEN_CONTRACT || '', provider } = {}) {
    this.network = normalize(network);
    this.receivingAddress = normalize(receivingAddress);
    this.tokenContract = normalize(tokenContract);
    this.provider = provider;
  }

  get configured() {
    return Boolean(this.network && this.receivingAddress && this.tokenContract && this.provider);
  }

  validateInvoice({ amountUsdt, network, receivingAddress }) {
    const amount = asNumber(amountUsdt);
    if (!amount || amount <= 0) return { ok: false, reason: 'invalid_invoice_amount' };
    if (!SUPPORTED_NETWORKS.has(normalize(network))) return { ok: false, reason: 'unsupported_network' };
    if (normalize(network) !== this.network) return { ok: false, reason: 'network_mismatch' };
    if (normalize(receivingAddress) !== this.receivingAddress) return { ok: false, reason: 'receiving_address_mismatch' };
    return { ok: true, amount };
  }

  async verify({ txid, invoice }) {
    const cleanTxid = normalize(txid);
    if (!cleanTxid) return { ok: false, status: 'rejected', reason: 'missing_txid' };
    const invoiceCheck = this.validateInvoice(invoice);
    if (!invoiceCheck.ok) return { ok: false, status: 'rejected', reason: invoiceCheck.reason };
    if (!this.configured) return { ok: false, status: 'manual_review', reason: 'provider_not_configured' };

    let transaction;
    try {
      transaction = await this.provider.getTransaction(cleanTxid);
    } catch (error) {
      if (error?.code === 'TX_NOT_FOUND') return { ok: false, status: 'rejected', reason: 'transaction_not_found' };
      if (error?.code === 'INVALID_TXID') return { ok: false, status: 'rejected', reason: 'invalid_txid' };
      if ([403, 429].includes(error?.status)) return { ok: false, status: 'manual_review', reason: 'provider_rate_limited' };
      throw error;
    }

    const amount = asNumber(transaction?.amountUsdt);
    const sameNetwork = normalize(transaction?.network) === this.network;
    const sameReceiver = normalize(transaction?.toAddress) === this.receivingAddress;
    const sameContract = normalize(transaction?.tokenContract) === this.tokenContract;
    const successful = transaction?.success === true;
    const finalized = transaction?.finalized === true;
    const enoughConfirmations = Number(transaction?.confirmations || 0) >= Number(process.env.USDT_MIN_CONFIRMATIONS || 1);
    const exactAmount = amount !== null && amount >= invoiceCheck.amount;

    if (transaction?.pending === true) return { ok: false, status: 'confirming', reason: 'transaction_pending', transaction };
    if (!successful || !sameNetwork || !sameReceiver || !sameContract || !exactAmount) {
      return { ok: false, status: 'rejected', reason: 'transaction_does_not_match_invoice', transaction };
    }
    if (!finalized || !enoughConfirmations) return { ok: false, status: 'confirming', reason: 'waiting_for_finalization', transaction };
    return { ok: true, status: 'confirmed', transaction };
  }
}
