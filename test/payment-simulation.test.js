import test from 'node:test';
import assert from 'node:assert/strict';
import { SolanaRpcProvider } from '../src/integrations/solana-rpc-provider.js';
import { UsdtVerifier } from '../src/integrations/usdt-verifier.js';

const txid = '5'.repeat(64);
const receivingAddress = 'ES5uuF9x1XhipfPyKa7H5uLVEkjKXJ9w2MNFXBgphjVB';
const senderAddress = 'Sender111111111111111111111111111111111111111';
const tokenMint = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const wrongMint = 'So11111111111111111111111111111111111111112';
process.env.USDT_MIN_CONFIRMATIONS = '1';
process.env.USDT_TOKEN_DECIMALS = '6';

function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

function rpcTransaction({ amount = '7000000', owner = receivingAddress, mint = tokenMint, finalized = true, err = null } = {}) {
  return {
    slot: 100,
    meta: {
      err,
      preTokenBalances: [
        { accountIndex: 0, mint, owner: senderAddress, uiTokenAmount: { amount, decimals: 6 } },
        { accountIndex: 1, mint, owner, uiTokenAmount: { amount: '0', decimals: 6 } }
      ],
      postTokenBalances: [
        { accountIndex: 0, mint, owner: senderAddress, uiTokenAmount: { amount: '0', decimals: 6 } },
        { accountIndex: 1, mint, owner, uiTokenAmount: { amount, decimals: 6 } }
      ]
    },
    transaction: { message: { accountKeys: ['SenderToken11111111111111111111111111111111', 'ReceiverToken1111111111111111111111111111111'] }, signatures: [txid] },
    version: finalized ? 0 : 0
  };
}

function simulationFetch(options = {}) {
  return async (_url, requestOptions = {}) => {
    const request = JSON.parse(requestOptions.body);
    if (request.method === 'getTransaction') return response({ result: options.pending ? null : rpcTransaction(options) });
    if (request.method === 'getSignatureStatuses') return response({ result: { value: [{ slot: 100, confirmationStatus: options.pending ? 'confirmed' : 'finalized', err: null }] } });
    if (request.method === 'getAccountInfo') return response({ result: { value: null } });
    return response({}, 404);
  };
}

function buildVerifier(options = {}) {
  const provider = new SolanaRpcProvider({ rpcUrl: 'https://rpc.example.test', receivingAddress, tokenContract: tokenMint, commitment: options.finalized === false ? 'confirmed' : 'finalized', fetchImpl: simulationFetch(options) });
  return { provider, verifier: new UsdtVerifier({ network: 'SOLANA_SPL', receivingAddress, tokenContract: tokenMint, provider }) };
}

function invoice() {
  return { amountUsdt: 7, network: 'SOLANA_SPL', receivingAddress };
}

test('simulation confirms an exact USDT SPL payment after finalization', async () => {
  const { verifier } = buildVerifier();
  const result = await verifier.verify({ txid, invoice: invoice() });
  assert.equal(result.status, 'confirmed');
  assert.equal(result.transaction.amountUsdt, 7);
  assert.equal(result.transaction.confirmations, 1);
  assert.equal(result.transaction.tokenContract, tokenMint);
});

test('simulation keeps a non-finalized Solana payment in confirming state', async () => {
  const { verifier } = buildVerifier({ finalized: false });
  const result = await verifier.verify({ txid, invoice: invoice() });
  assert.equal(result.status, 'confirming');
  assert.equal(result.reason, 'waiting_for_finalization');
});

test('simulation rejects an underpaid transfer', async () => {
  const { verifier } = buildVerifier({ amount: '6999999' });
  const result = await verifier.verify({ txid, invoice: invoice() });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'transaction_does_not_match_invoice');
});

test('simulation rejects a transfer to the wrong Solana wallet', async () => {
  const { verifier } = buildVerifier({ owner: senderAddress });
  const result = await verifier.verify({ txid, invoice: invoice() });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'transaction_does_not_match_invoice');
});

test('simulation rejects a transfer for the wrong SPL mint', async () => {
  const { verifier } = buildVerifier({ mint: wrongMint });
  const result = await verifier.verify({ txid, invoice: invoice() });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'transaction_does_not_match_invoice');
});

test('simulation keeps a signature unavailable at RPC in confirming state', async () => {
  const { verifier } = buildVerifier({ pending: true });
  const result = await verifier.verify({ txid, invoice: invoice() });
  assert.equal(result.status, 'confirming');
  assert.equal(result.reason, 'transaction_pending');
});
