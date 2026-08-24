import test from 'node:test';
import assert from 'node:assert/strict';
import { TronGridProvider } from '../src/integrations/trongrid-provider.js';
import { UsdtVerifier } from '../src/integrations/usdt-verifier.js';

const txid = 'b'.repeat(64);
const receivingAddress = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuW';
const senderAddress = 'TJRabPrwbZy45sbavfcjinPJC18kjp31W';
const tokenContract = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
process.env.USDT_MIN_CONFIRMATIONS = '3';
process.env.USDT_TOKEN_DECIMALS = '6';

function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

function simulationFetch({ amount = '7000000', to = receivingAddress, contract = tokenContract, blockNumber = 100, latestBlock = 102, receipt = true } = {}) {
  return async (url) => {
    if (url.endsWith('/wallet/gettransactionbyid')) return response({ txID: txid, raw_data: { contract: [] } });
    if (url.endsWith('/wallet/gettransactioninfobyid')) return response(receipt ? { id: txid, blockNumber, receipt: { result: 'SUCCESS' } } : { id: txid });
    if (url.includes('/v1/accounts/')) return response({ data: [{ transaction_id: txid, from_address: senderAddress, to_address: to, contract_address: contract, amount_str: amount, decimals: 6, status: 0, token_info: { address: contract } }] });
    if (url.endsWith('/wallet/getnowblock')) return response({ block_header: { raw_data: { number: latestBlock } } });
    return response({}, 404);
  };
}

function buildVerifier(fetchImpl) {
  const provider = new TronGridProvider({ apiKey: 'simulation-key', receivingAddress, tokenContract, fetchImpl });
  return { provider, verifier: new UsdtVerifier({ network: 'TRC20', receivingAddress, tokenContract, provider }) };
}

function invoice() {
  return { amountUsdt: 7, network: 'TRC20', receivingAddress };
}

test('simulation confirms an exact USDT TRC20 payment after three confirmations', async () => {
  const { verifier } = buildVerifier(simulationFetch());
  const result = await verifier.verify({ txid, invoice: invoice() });
  assert.equal(result.status, 'confirmed');
  assert.equal(result.transaction.amountUsdt, 7);
  assert.equal(result.transaction.confirmations, 3);
  assert.equal(result.transaction.tokenContract, tokenContract);
});

test('simulation keeps an unconfirmed payment in confirming state', async () => {
  const { verifier } = buildVerifier(simulationFetch({ latestBlock: 101 }));
  const result = await verifier.verify({ txid, invoice: invoice() });
  assert.equal(result.status, 'confirming');
  assert.equal(result.reason, 'waiting_for_confirmations');
  assert.equal(result.transaction.confirmations, 2);
});

test('simulation rejects an underpaid transfer', async () => {
  const { verifier } = buildVerifier(simulationFetch({ amount: '6999999' }));
  const result = await verifier.verify({ txid, invoice: invoice() });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'transaction_does_not_match_invoice');
});

test('simulation rejects a transfer to the wrong address', async () => {
  const { verifier } = buildVerifier(simulationFetch({ to: 'TJRabPrwbZy45sbavfcjinPJC18kjp31W' }));
  const result = await verifier.verify({ txid, invoice: invoice() });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'transaction_does_not_match_invoice');
});

test('simulation rejects a transfer for the wrong token contract', async () => {
  const { verifier } = buildVerifier(simulationFetch({ contract: 'TWrongContract1234567890123456789012' }));
  const result = await verifier.verify({ txid, invoice: invoice() });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'transaction_does_not_match_invoice');
});

test('simulation keeps a transaction without a receipt in confirming state', async () => {
  const { verifier } = buildVerifier(simulationFetch({ receipt: false }));
  const result = await verifier.verify({ txid, invoice: invoice() });
  assert.equal(result.status, 'confirming');
  assert.equal(result.reason, 'transaction_pending');
});
