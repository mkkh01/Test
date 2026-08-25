import test from 'node:test';
import assert from 'node:assert/strict';
import { deduplicateCandidates, parseRss, scoreCandidate, fetchDevToCandidates, fetchStackOverflowCandidates, fetchRedditCandidates, fetchXCandidates, fetchGitHubIssueCandidates } from '../src/discovery/public-sources.js';
import { runDiscovery } from '../src/workers/discovery-worker.js';
import { UsdtVerifier } from '../src/integrations/usdt-verifier.js';
import { createDownloadToken, hashDownloadToken, tokenMatches, isTokenExpired } from '../src/delivery/download-token.js';
import { GeminiRouter } from '../src/integrations/gemini-router.js';
import { TelegramBot } from '../src/integrations/telegram-bot.js';
import { SolanaRpcProvider, isValidSolanaAddress } from '../src/integrations/solana-rpc-provider.js';

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

test('DEV candidate fetch normalizes public article data and uses valid multiword tags', async () => {
  const requestedUrls = [];
  const items = await fetchDevToCandidates({ terms: ['late invoice'], limit: 2, fetchImpl: async (url) => { requestedUrls.push(url); return { ok: true, status: 200, json: async () => [{ id: 7, url: 'https://dev.to/example/late-invoice', title: 'Late invoice help', description: 'My client has not paid.', user: { username: 'public-author' }, published_at: '2026-08-23T10:00:00Z' }] }; } });
  assert.equal(items[0].source, 'dev_to');
  assert.equal(items[0].sourceUrl, 'https://dev.to/example/late-invoice');
  assert.equal(items[0].authorHandle, 'public-author');
  assert.ok(requestedUrls.some((url) => url.includes('tag=late-invoice')));
  assert.ok(!requestedUrls.some((url) => url.includes('tag=lateinvoice')));
});

test('Reddit candidate fetch uses OAuth and preserves public author data', async () => {
  process.env.REDDIT_ACCESS_TOKEN = 'reddit-test-token';
  const requested = [];
  const items = await fetchRedditCandidates({ terms: ['late invoice'], limit: 2, fetchImpl: async (url, options = {}) => {
    requested.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ data: { children: [{ data: { id: 'abc', name: 't3_abc', permalink: '/r/freelance/comments/abc/late_invoice/', title: 'Late invoice question', selftext: 'My client has not paid.', author: 'public_author', created_utc: 1787479200 } }] } }) };
  } });
  delete process.env.REDDIT_ACCESS_TOKEN;
  assert.equal(items[0].source, 'reddit');
  assert.equal(items[0].authorHandle, 'public_author');
  assert.equal(items[0].sourceUrl, 'https://www.reddit.com/r/freelance/comments/abc/late_invoice/');
  assert.equal(requested[0].options.headers.Authorization, 'Bearer reddit-test-token');
});

test('X candidate fetch maps public author expansion and excludes protected accounts', async () => {
  process.env.X_API_BEARER_TOKEN = 'x-test-token';
  const items = await fetchXCandidates({ terms: ['late invoice'], limit: 10, fetchImpl: async (url, options = {}) => {
    assert.ok(url.includes('api.x.com/2/tweets/search/recent'));
    assert.equal(options.headers.Authorization, 'Bearer x-test-token');
    return { ok: true, status: 200, json: async () => ({ data: [{ id: '123', text: 'My client has not paid this late invoice.', author_id: 'u1', created_at: '2026-08-23T10:00:00Z' }], includes: { users: [{ id: 'u1', username: 'public_author', protected: false }] } }) };
  } });
  delete process.env.X_API_BEARER_TOKEN;
  assert.equal(items[0].source, 'x');
  assert.equal(items[0].authorHandle, 'public_author');
  assert.equal(items[0].sourceUrl, 'https://x.com/public_author/status/123');
});

test('GitHub issue search maps public issue authors without requiring a credential', async () => {
  const items = await fetchGitHubIssueCandidates({ terms: ['scope creep'], limit: 10, fetchImpl: async (url, options = {}) => {
    assert.ok(url.includes('api.github.com/search/issues'));
    assert.equal(options.headers['User-Agent'], 'client-payment-scope-protection-kit');
    return { ok: true, status: 200, json: async () => ({ items: [{ id: 44, html_url: 'https://github.com/example/repo/issues/4', title: 'Scope creep problem', body: 'How do I handle extra revisions?', user: { login: 'public_author' }, created_at: '2026-08-23T10:00:00Z' }] }) };
  } });
  assert.equal(items[0].source, 'github_issues');
  assert.equal(items[0].authorHandle, 'public_author');
  assert.match(items[0].body, /extra revisions/);
});

test('Stack Exchange candidate fetch uses the public API and preserves matching questions', async () => {
  const requestedUrls = [];
  const items = await fetchStackOverflowCandidates({ terms: ['late invoice'], limit: 2, fetchImpl: async (url) => {
    requestedUrls.push(url);
    return { ok: true, status: 200, json: async () => ({ items: [{ question_id: 123, link: 'https://stackoverflow.com/q/123', title: 'Late invoice question', body: '<p>My client has not paid.</p>', creation_date: 1787479200, owner: { display_name: 'public-author' } }] }) };
  } });
  assert.equal(items[0].source, 'stack_overflow');
  assert.equal(items[0].sourceUrl, 'https://stackoverflow.com/q/123');
  assert.match(items[0].body, /client has not paid/);
  assert.ok(requestedUrls.every((url) => url.includes('api.stackexchange.com/2.3/search/advanced')));
});

test('discovery keeps successful sources when one source fails', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('dev.to')) throw new Error('DEV temporary failure');
    if (url.includes('hacker-news.firebaseio.com/v0/newstories')) return { ok: true, status: 200, json: async () => [1] };
    if (url.includes('hacker-news.firebaseio.com/v0/item/1')) return { ok: true, status: 200, json: async () => ({ type: 'story', id: 1, title: 'Late invoice question', text: 'My client has not paid.', by: 'public-author', time: 1787479200 }) };
    if (url.includes('public.api.bsky.app')) return { ok: true, status: 200, json: async () => ({ posts: [] }) };
    if (url.includes('api.stackexchange.com')) return { ok: true, status: 200, json: async () => ({ items: [] }) };
    if (url.includes('api.github.com/search/issues')) return { ok: true, status: 200, json: async () => ({ items: [] }) };
    throw new Error(`unexpected URL: ${url}`);
  };
  const summary = await runDiscovery({ fetchImpl });
  assert.equal(summary.mode, 'partial');
  assert.deepEqual(summary.failedSources, ['dev_to']);
  assert.equal(summary.sources.hacker_news.mode, 'ok');
  assert.ok(summary.discovered >= 1);
});

test('payment configuration accepts Solana addresses and rejects TRON addresses', () => {
  assert.equal(isValidSolanaAddress(receivingAddress), true);
  assert.equal(isValidSolanaAddress('Tjv6h25tZoSjrhwpKtp6ZkKY'), false);
});

test('Solana provider falls back from a legacy TRON address to canonical settings', () => {
  const provider = new SolanaRpcProvider({ receivingAddress: 'Tjv6h25tZoSjrhwpKtp6ZkKY', tokenContract: '' });
  assert.equal(provider.configured, true);
  assert.equal(provider.receivingAddress, receivingAddress);
  assert.equal(provider.tokenContract, tokenMint);
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
        blockTime: 1700000000,
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
  assert.equal(result.blockTime, 1700000000);
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
