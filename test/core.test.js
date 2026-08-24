import test from 'node:test';
import assert from 'node:assert/strict';
import { deduplicateCandidates, parseRss, scoreCandidate } from '../src/discovery/public-sources.js';
import { UsdtVerifier } from '../src/integrations/usdt-verifier.js';
import { createDownloadToken, hashDownloadToken, tokenMatches, isTokenExpired } from '../src/delivery/download-token.js';
import { GeminiRouter } from '../src/integrations/gemini-router.js';
import { TelegramBot } from '../src/integrations/telegram-bot.js';
import { TronGridProvider } from '../src/integrations/trongrid-provider.js';

const fakeFetch = async (url, options = {}) => ({ ok: true, status: 200, json: async () => ({ ok: true, url, options }) });

test('candidate scoring prioritizes direct payment and scope problems', () => {
  const score = scoreCandidate({ title: 'Client has not paid my late invoice', body: 'How do I handle scope creep?' });
  assert.ok(score >= 60);
});

test('candidate deduplication keeps one item per source identity', () => {
  const items = deduplicateCandidates([
    { source: 'bluesky', externalId: 'at://one', body: 'late invoice' },
    { source: 'bluesky', externalId: 'at://one', body: 'late invoice' },
    { source: 'hacker_news', externalId: '2', body: 'scope creep' }
  ]);
  assert.equal(items.length, 2);
});

test('RSS parser extracts a useful public item', () => {
  const xml = '<rss><channel><item><title>Late invoice question</title><link>https://example.test/post</link><description>My client has not paid.</description><pubDate>Tue, 23 Aug 2026 10:00:00 GMT</pubDate></item></channel></rss>';
  const [item] = parseRss(xml, { source: 'demo_rss' });
  assert.equal(item.source, 'demo_rss');
  assert.equal(item.sourceUrl, 'https://example.test/post');
  assert.match(item.body, /not paid/);
});

test('USDT verifier rejects wrong network before provider access', async () => {
  let called = false;
  const verifier = new UsdtVerifier({ network: 'TRC20', receivingAddress: 'T123', provider: { getTransaction: async () => { called = true; } } });
  const result = await verifier.verify({ txid: 'abc', invoice: { amountUsdt: 7, network: 'ERC20', receivingAddress: 'T123' } });
  assert.equal(result.reason, 'unsupported_network');
  assert.equal(called, false);
});

test('USDT verifier requires a provider and never treats a TxID alone as paid', async () => {
  const verifier = new UsdtVerifier({ network: 'TRC20', receivingAddress: 'T123', tokenContract: 'TCONTRACT', provider: null });
  const result = await verifier.verify({ txid: 'abc', invoice: { amountUsdt: 7, network: 'TRC20', receivingAddress: 'T123' } });
  assert.equal(result.status, 'manual_review');
});

test('TronGrid provider normalizes a confirmed TRC20 transfer', async () => {
  const txid = 'a'.repeat(64);
  const receivingAddress = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuW';
  const tokenContract = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
  const provider = new TronGridProvider({
    apiKey: 'test-key',
    receivingAddress,
    tokenContract,
    fetchImpl: async (url, options = {}) => {
      if (url.endsWith('/wallet/gettransactionbyid')) return { ok: true, status: 200, json: async () => ({ txID: txid, raw_data: { contract: [] } }) };
      if (url.endsWith('/wallet/gettransactioninfobyid')) return { ok: true, status: 200, json: async () => ({ id: txid, blockNumber: 100, receipt: { result: 'SUCCESS' } }) };
      if (url.includes('/v1/accounts/')) return { ok: true, status: 200, json: async () => ({ data: [{ transaction_id: txid, from_address: 'TJRabPrwbZy45sbavfcjinPJC18kjp31W', to_address: receivingAddress, contract_address: tokenContract, amount_str: '7000000', decimals: 6, status: 0, token_info: { address: tokenContract } }] }) };
      if (url.endsWith('/wallet/getnowblock')) return { ok: true, status: 200, json: async () => ({ block_header: { raw_data: { number: 102 } } }) };
      return { ok: false, status: 404, json: async () => ({}) };
    }
  });
  const result = await provider.getTransaction(txid);
  assert.equal(result.network, 'TRC20');
  assert.equal(result.toAddress, receivingAddress);
  assert.equal(result.tokenContract, tokenContract);
  assert.equal(result.amountUsdt, 7);
  assert.equal(result.confirmations, 3);
  assert.equal(result.success, true);
});

test('Gemini router rotates after a rate-limited key', async () => {
  process.env.GEMINI_API_KEY_1 = 'test-key-1';
  process.env.GEMINI_API_KEY_2 = 'test-key-2';
  let calls = 0;
  const router = new GeminiRouter({ fetchImpl: async (_url, options) => {
    calls += 1;
    if (calls === 1) return { ok: false, status: 429, json: async () => ({ error: { message: 'quota' } }) };
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }), options };
  } });
  const result = await router.generateText({ prompt: 'Return JSON.' });
  assert.equal(result.keyIndex, 2);
  assert.equal(calls, 2);
  delete process.env.GEMINI_API_KEY_1;
  delete process.env.GEMINI_API_KEY_2;
});

test('Telegram bot stays disabled without a token', async () => {
  const bot = new TelegramBot({ token: '' });
  assert.equal(bot.configured, false);
  await assert.rejects(() => bot.sendMessage({ chatId: '1', text: 'hello' }), /not configured/);
});

test('download tokens are hashed and expire safely', () => {
  const token = createDownloadToken();
  const hash = hashDownloadToken(token);
  assert.equal(tokenMatches(token, hash), true);
  assert.equal(tokenMatches('wrong-token', hash), false);
  assert.equal(isTokenExpired(new Date(Date.now() - 1000).toISOString()), true);
  assert.equal(isTokenExpired(new Date(Date.now() + 60_000).toISOString()), false);
});

void fakeFetch;
