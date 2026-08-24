import test from 'node:test';
import assert from 'node:assert/strict';
import { deduplicateCandidates, parseRss, scoreCandidate, fetchDevToCandidates } from '../src/discovery/public-sources.js';
import { UsdtVerifier } from '../src/integrations/usdt-verifier.js';
import { createDownloadToken, hashDownloadToken, tokenMatches, isTokenExpired } from '../src/delivery/download-token.js';
import { GeminiRouter } from '../src/integrations/gemini-router.js';
import { TelegramBot } from '../src/integrations/telegram-bot.js';
import { SolanaRpcProvider } from '../src/integrations/solana-rpc-provider.js';

const fakeFetch = async (url, options = {}) => ({ ok: true, status: 200, json: async () => ({ ok: true, url, options }) });
const receivingAddress = 'ES5uuF9x1XhipfPyKa7H5uLVEkjKXJ9w2MNFXBgphjVB';
const tokenMint = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const validSignature = '5'.repeat(64);

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

test('Atom parser extracts a Stack Overflow-style entry', () => {
  const xml = '<feed><entry><id>https://stackoverflow.com/q/123</id><link href="https://stackoverflow.com/q/123"/><title>Client has not paid an invoice</title><summary>How should I handle this unpaid client?</summary><updated>2026-08-23T10:00:00Z</updated></entry></feed>';
  const [item] = parseRss(xml, { source: 'stack_overflow' });
  assert.equal(item.sourceUrl, 'https://stackoverflow.com/q/123');
  assert.match(item.body, /unpaid client/);
});

test('DEV candidate fetch normalizes public article data', async () => {
  const items = await fetchDevToCandidates({ terms: ['late invoice'], limit: 2, fetchImpl: async () => ({ ok: true, status: 200, json: async () => [{ id: 7, url: 'https://dev.to/example/late-invoice', title: 'Late invoice help', description: 'My client has not paid.', user: { username: 'public-author' }, published_at: '2026-08-23T10:00:00Z' }] }) });
  assert.equal(items[0].source, 'dev_to');
  assert.equal(items[0].sourceUrl, 'https://dev.to/example/late-invoice');
  assert.equal(items[0].authorHandle, 'public-author');
});

test('USDT verifier rejects wrong network before provider access', async () => {
  let called = false;
  const verifier = new UsdtVerifier({ network: 'SOLANA_SPL', receivingAddress, provider: { getTransaction: async () => { called = true; } } });
  const result = await verifier.verify({ txid: validSignature, invoice: { amountUsdt: 7, network: 'TRC20', receivingAddress } });
  assert.equal(result.reason, 'unsupported_network');
  assert.equal(called, false);
});

test('USDT verifier requires a provider and never treats a signature alone as paid', async () => {
  const verifier = new UsdtVerifier({ network: 'SOLANA_SPL', receivingAddress, tokenContract: tokenMint, provider: null });
  const result = await verifier.verify({ txid: validSignature, invoice: { amountUsdt: 7, network: 'SOLANA_SPL', receivingAddress } });
  assert.equal(result.status, 'manual_review');
});

test('USDT verifier keeps a non-finalized Solana transaction in confirming state', async () => {
  const verifier = new UsdtVerifier({
    network: 'SOLANA_SPL',
    receivingAddress,
    tokenContract: tokenMint,
    provider: { getTransaction: async () => ({ network: 'SOLANA_SPL', toAddress: receivingAddress, tokenContract: tokenMint, amountUsdt: 7, confirmations: 0, finalized: false, success: true, pending: false }) }
  });
  const result = await verifier.verify({ txid: validSignature, invoice: { amountUsdt: 7, network: 'SOLANA_SPL', receivingAddress } });
  assert.equal(result.status, 'confirming');
  assert.equal(result.reason, 'waiting_for_finalization');
});

test('Solana provider normalizes a confirmed USDT SPL transfer', async () => {
  const provider = new SolanaRpcProvider({
    rpcUrl: 'https://rpc.example.test',
    receivingAddress,
    tokenContract: tokenMint,
    commitment: 'finalized',
    fetchImpl: async (_url, options = {}) => {
      const request = JSON.parse(options.body);
      assert.equal(request.method, 'getTransaction');
      return { ok: true, status: 200, json: async () => ({ result: {
        slot: 100,
        meta: {
          err: null,
          preTokenBalances: [
            { accountIndex: 0, mint: tokenMint, owner: 'Sender111111111111111111111111111111111111111', uiTokenAmount: { amount: '7000000', decimals: 6 } },
            { accountIndex: 1, mint: tokenMint, owner: receivingAddress, uiTokenAmount: { amount: '0', decimals: 6 } }
          ],
          postTokenBalances: [
            { accountIndex: 0, mint: tokenMint, owner: 'Sender111111111111111111111111111111111111111', uiTokenAmount: { amount: '0', decimals: 6 } },
            { accountIndex: 1, mint: tokenMint, owner: receivingAddress, uiTokenAmount: { amount: '7000000', decimals: 6 } }
          ]
        },
        transaction: { message: { accountKeys: ['SenderToken11111111111111111111111111111111', 'ReceiverToken1111111111111111111111111111111'] }, signatures: [validSignature] }
      }}) };
    }
  });
  const result = await provider.getTransaction(validSignature);
  assert.equal(result.network, 'SOLANA_SPL');
  assert.equal(result.toAddress, receivingAddress);
  assert.equal(result.tokenContract, tokenMint);
  assert.equal(result.amountUsdt, 7);
  assert.equal(result.confirmations, 1);
  assert.equal(result.finalized, true);
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
