const DEFAULT_TERMS = [
  'late invoice', 'unpaid client', "client hasn't paid", 'scope creep',
  'extra revisions', 'working for free', 'client disappeared', 'need a deposit',
  'payment terms', 'freelance contract'
];
const GLOBAL_SEARCH_TERMS = [
  'cliente no paga', 'factura impaga', 'escopo do projeto', 'fatura não paga',
  'client ne paie pas', 'facture impayée', 'عميل لم يدفع', 'تأخر الدفع',
  '未付款 客户', 'フリーランス 支払い遅延'
];

function broadSearchTerms(terms) {
  const extra = String(process.env.DISCOVERY_EXTRA_TERMS || '').split(/[|,]/).map((term) => term.trim()).filter(Boolean);
  return [...new Set([...terms.slice(0, 6), ...extra, ...GLOBAL_SEARCH_TERMS])].slice(0, 24);
}

function clean(value, max = 4000) {
  return typeof value === 'string' ? value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function matchesTerms(item, terms) {
  const haystack = `${item.title || ''} ${item.body || ''}`.toLowerCase();
  return terms.some((term) => haystack.includes(term.toLowerCase()));
}

function boundedLimit(limit, fallback = 20) {
  const value = Number(limit);
  return Number.isInteger(value) && value > 0 ? Math.min(value, 100) : fallback;
}

export function publicSourceStatus() {
  return {
    redditConfigured: Boolean(process.env.REDDIT_ACCESS_TOKEN?.trim() || (process.env.REDDIT_CLIENT_ID?.trim() && process.env.REDDIT_CLIENT_SECRET?.trim())),
    xConfigured: Boolean((process.env.X_API_BEARER_TOKEN || process.env.X_BEARER_TOKEN)?.trim()),
    braveConfigured: Boolean((process.env.BRAVE_SEARCH_API_KEY || process.env.BRAVE_API_KEY)?.trim()),
    googleNewsConfigured: true,
    githubConfigured: true
  };
}

export async function fetchHackerNewsCandidates({ fetchImpl = fetch, terms = DEFAULT_TERMS, limit = 60 } = {}) {
  const idsResponse = await fetchImpl('https://hacker-news.firebaseio.com/v0/newstories.json');
  if (!idsResponse.ok) throw new Error(`Hacker News IDs request failed: ${idsResponse.status}`);
  const ids = (await idsResponse.json()).slice(0, Math.min(limit, 100));
  const items = await Promise.all(ids.map(async (id) => {
    const response = await fetchImpl(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
    if (!response.ok) return null;
    const item = await response.json();
    return item?.type === 'story' || item?.type === 'comment'
      ? { source: 'hacker_news', externalId: String(id), sourceUrl: `https://news.ycombinator.com/item?id=${id}`, title: clean(item.title), body: clean(item.text), authorHandle: clean(item.by, 120), publishedAt: item.time ? new Date(item.time * 1000).toISOString() : null }
      : null;
  }));
  return items.filter(Boolean).filter((item) => matchesTerms(item, terms));
}

function devTagsForTerm(term) {
  const words = String(term || '').toLowerCase().match(/[a-z0-9]+/g) || [];
  if (!words.length) return [];
  const hyphenated = words.join('-');
  const candidates = [hyphenated, ...words];
  return [...new Set(candidates)].filter((tag) => tag.length >= 2 && tag.length <= 30);
}

export async function fetchDevToCandidates({ fetchImpl = fetch, terms = DEFAULT_TERMS, limit = 20 } = {}) {
  const results = [];
  const tags = [...new Set(terms.slice(0, 6).flatMap(devTagsForTerm))].slice(0, 12);
  for (const tag of tags) {
    const url = `https://dev.to/api/articles?tag=${encodeURIComponent(tag)}&per_page=${boundedLimit(limit, 20)}`;
    const response = await fetchImpl(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) continue;
    const payload = await response.json();
    for (const article of payload || []) {
      results.push({
        source: 'dev_to',
        externalId: String(article.id || article.url),
        sourceUrl: article.url,
        title: clean(article.title),
        body: clean(article.description || article.title),
        authorHandle: clean(article.user?.username, 120),
        publishedAt: article.published_at || null
      });
    }
  }
  return results.filter((item) => matchesTerms(item, terms));
}

export async function fetchStackOverflowCandidates({ fetchImpl = fetch, terms = DEFAULT_TERMS, limit = 30 } = {}) {
  const tags = ['contracts', 'invoicing', 'freelancing', 'freelance', 'small-business'];
  const results = [];
  const failures = [];
  let successfulRequests = 0;
  for (const tag of tags) {
    const params = new URLSearchParams({ order: 'desc', sort: 'creation', tagged: tag, site: 'stackoverflow', pagesize: String(boundedLimit(limit, 30)), filter: 'withbody' });
    const url = `https://api.stackexchange.com/2.3/search/advanced?${params.toString()}`;
    try {
      const response = await fetchImpl(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) {
        failures.push(`${tag}:${response.status}`);
        continue;
      }
      successfulRequests += 1;
      const payload = await response.json();
      for (const question of payload.items || []) {
        results.push({
          source: 'stack_overflow',
          externalId: String(question.question_id || question.link),
          sourceUrl: question.link,
          title: clean(question.title),
          body: clean(question.body || question.title),
          authorHandle: clean(question.owner?.display_name, 120),
          publishedAt: question.creation_date ? new Date(question.creation_date * 1000).toISOString() : null
        });
      }
    } catch (error) {
      failures.push(`${tag}:${String(error.message).slice(0, 120)}`);
    }
  }
  if (!successfulRequests && failures.length) throw new Error(`Stack Exchange API requests failed: ${failures.join(', ')}`);
  return results.filter((item) => matchesTerms(item, terms));
}

export async function fetchStackExchangeCommunityCandidates({ fetchImpl = fetch, terms = DEFAULT_TERMS, sites = ['freelancing', 'pm', 'graphicdesign', 'webmasters'], limit = 20 } = {}) {
  const results = [];
  for (const site of sites) {
    const params = new URLSearchParams({ order: 'desc', sort: 'creation', q: terms.slice(0, 6).join(' '), site, pagesize: String(boundedLimit(limit, 20)), filter: 'withbody' });
    const response = await fetchImpl(`https://api.stackexchange.com/2.3/search/advanced?${params.toString()}`, { headers: { Accept: 'application/json' } });
    if (!response.ok) continue;
    const payload = await response.json();
    for (const question of payload.items || []) {
      results.push({
        source: 'stack_exchange',
        externalId: String(question.question_id || question.link),
        sourceUrl: question.link,
        title: clean(question.title),
        body: clean(question.body || question.title),
        authorHandle: clean(question.owner?.display_name, 120),
        publishedAt: question.creation_date ? new Date(question.creation_date * 1000).toISOString() : null
      });
    }
  }
  return results.filter((item) => matchesTerms(item, terms));
}

function defaultDiscourseForums() {
  return String(process.env.DISCOURSE_PUBLIC_FORUMS || 'discourse.webflow.com,forum.ghost.org').split(',').map((host) => host.trim().replace(/^https?:\/\//, '').replace(/\/$/, '')).filter(Boolean).slice(0, 8);
}

export async function fetchDiscourseCandidates({ fetchImpl = fetch, terms = DEFAULT_TERMS, limit = 20, forums = defaultDiscourseForums() } = {}) {
  const results = [];
  for (const host of forums) {
    for (const term of terms.slice(0, 6)) {
      const params = new URLSearchParams({ q: term });
      try {
        const response = await fetchImpl(`https://${host}/search.json?${params.toString()}`, { headers: { Accept: 'application/json' } });
        if (!response.ok) continue;
        const payload = await response.json();
        for (const topic of (payload.topics || []).slice(0, boundedLimit(limit, 20))) {
          const topicPath = topic.url || (topic.slug && topic.id ? `/t/${topic.slug}/${topic.id}` : '');
          if (!topicPath) continue;
          results.push({
            source: 'discourse',
            externalId: `${host}:${topic.id || topicPath}`,
            sourceUrl: topicPath.startsWith('http') ? topicPath : `https://${host}${topicPath}`,
            title: clean(topic.title),
            body: clean(topic.blurb || topic.excerpt || topic.title),
            authorHandle: clean(topic.username || topic.last_poster_username, 120),
            publishedAt: topic.created_at || topic.last_posted_at || null
          });
        }
      } catch {
        // One public forum may be unavailable; continue with the remaining forums.
      }
    }
  }
  return results.filter((item) => matchesTerms(item, terms));
}

export async function fetchBlueskyCandidates({ fetchImpl = fetch, terms = DEFAULT_TERMS, limit = 25 } = {}) {
  const results = [];
  for (const term of terms.slice(0, 6)) {
    const url = `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(term)}&limit=${boundedLimit(limit, 25)}`;
    const response = await fetchImpl(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) continue;
    const payload = await response.json();
    for (const post of payload.posts || []) {
      const record = post.record || {};
      results.push({
        source: 'bluesky',
        externalId: post.uri || post.cid,
        sourceUrl: post.uri || `https://bsky.app/profile/${post.author?.handle}/post/${post.uri?.split('/').pop()}`,
        title: '',
        body: clean(record.text),
        authorHandle: clean(post.author?.handle, 120),
        publishedAt: record.createdAt || null
      });
    }
  }
  return results.filter((item) => matchesTerms(item, terms));
}

let redditToken = null;
let redditTokenExpiresAt = 0;

async function getRedditAccessToken(fetchImpl) {
  const directToken = process.env.REDDIT_ACCESS_TOKEN?.trim();
  if (directToken) return directToken;
  const clientId = process.env.REDDIT_CLIENT_ID?.trim();
  const clientSecret = process.env.REDDIT_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return '';
  if (redditToken && Date.now() < redditTokenExpiresAt) return redditToken;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetchImpl('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': process.env.REDDIT_USER_AGENT?.trim() || 'client-payment-scope-protection-kit:source-discovery:v1'
    },
    body: 'grant_type=client_credentials'
  });
  if (!response.ok) throw new Error(`Reddit OAuth request failed: ${response.status}`);
  const payload = await response.json();
  redditToken = clean(payload.access_token, 1000);
  redditTokenExpiresAt = Date.now() + Math.max(60, Number(payload.expires_in || 3600) - 60) * 1000;
  return redditToken;
}

export async function fetchRedditCandidates({ fetchImpl = fetch, terms = DEFAULT_TERMS, limit = 25 } = {}) {
  const token = await getRedditAccessToken(fetchImpl);
  if (!token) return [];
  const userAgent = process.env.REDDIT_USER_AGENT?.trim() || 'client-payment-scope-protection-kit:source-discovery:v1';
  const results = [];
  for (const term of terms.slice(0, 6)) {
    const params = new URLSearchParams({ q: term, sort: 'new', t: 'month', limit: String(boundedLimit(limit, 25)), raw_json: '1' });
    const response = await fetchImpl(`https://oauth.reddit.com/search.json?${params.toString()}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': userAgent }
    });
    if (!response.ok) throw new Error(`Reddit search request failed: ${response.status}`);
    const payload = await response.json();
    for (const child of payload?.data?.children || []) {
      const post = child?.data || {};
      if (!post.id || !post.permalink || !post.author) continue;
      results.push({
        source: 'reddit',
        externalId: String(post.name || `t3_${post.id}`),
        sourceUrl: `https://www.reddit.com${post.permalink}`,
        title: clean(post.title),
        body: clean(post.selftext || post.title),
        authorHandle: clean(post.author, 120),
        publishedAt: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : null
      });
    }
  }
  return results.filter((item) => matchesTerms(item, terms));
}

export async function fetchXCandidates({ fetchImpl = fetch, terms = DEFAULT_TERMS, limit = 25 } = {}) {
  const token = (process.env.X_API_BEARER_TOKEN || process.env.X_BEARER_TOKEN)?.trim();
  if (!token) return [];
  const queryTerms = terms.slice(0, 8).map((term) => `"${String(term).replace(/"/g, '')}"`);
  const params = new URLSearchParams({
    query: `(${queryTerms.join(' OR ')}) lang:en -is:retweet`,
    max_results: String(Math.max(10, Math.min(boundedLimit(limit, 25), 100))),
    'tweet.fields': 'created_at,lang,author_id,text',
    expansions: 'author_id',
    'user.fields': 'username,name,protected'
  });
  const response = await fetchImpl(`https://api.x.com/2/tweets/search/recent?${params.toString()}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error(`X recent search request failed: ${response.status}`);
  const payload = await response.json();
  const users = new Map((payload.includes?.users || []).map((user) => [String(user.id), user]));
  return (payload.data || []).map((post) => {
    const user = users.get(String(post.author_id));
    return {
      source: 'x',
      externalId: String(post.id),
      sourceUrl: user?.username ? `https://x.com/${user.username}/status/${post.id}` : `https://x.com/i/web/status/${post.id}`,
      title: '',
      body: clean(post.text),
      authorHandle: clean(user?.username, 120),
      publishedAt: post.created_at || null,
      protectedAuthor: Boolean(user?.protected)
    };
  }).filter((item) => item.authorHandle && !item.protectedAuthor && matchesTerms(item, terms));
}

function publicHandleFromUrl(value) {
  try {
    const url = new URL(value);
    const parts = url.pathname.split('/').filter(Boolean);
    if (['x.com', 'twitter.com'].includes(url.hostname) && parts[0] && parts[1] === 'status') return parts[0].slice(0, 120);
    if (['reddit.com', 'www.reddit.com'].includes(url.hostname)) {
      const userIndex = parts.findIndex((part) => part === 'u' || part === 'user');
      if (userIndex >= 0 && parts[userIndex + 1]) return parts[userIndex + 1].slice(0, 120);
    }
    return '';
  } catch {
    return '';
  }
}

export async function fetchBraveSearchCandidates({ fetchImpl = fetch, terms = DEFAULT_TERMS, limit = 20 } = {}) {
  const token = (process.env.BRAVE_SEARCH_API_KEY || process.env.BRAVE_API_KEY)?.trim();
  if (!token) return [];
  const searchTerms = broadSearchTerms(terms);
  const termQuery = searchTerms.slice(0, 16).map((term) => `"${String(term).replace(/"/g, '')}"`).join(' OR ');
  const query = `(${termQuery}) (site:reddit.com OR site:x.com OR site:github.com OR site:dev.to OR site:indiehackers.com)`;
  const params = new URLSearchParams({ q: query, count: String(Math.max(1, Math.min(boundedLimit(limit, 20), 20))), country: 'us', safesearch: 'moderate' });
  const response = await fetchImpl(`https://api.search.brave.com/res/v1/web/search?${params.toString()}`, { headers: { Accept: 'application/json', 'X-Subscription-Token': token } });
  if (!response.ok) throw new Error(`Brave Search request failed: ${response.status}`);
  const payload = await response.json();
  return (payload.web?.results || []).map((result) => ({
    source: 'brave_search',
    externalId: String(result.url || result.title),
    sourceUrl: result.url,
    title: clean(result.title),
    body: clean(result.description || result.title),
    authorHandle: publicHandleFromUrl(result.url),
    publishedAt: result.age || null
  })).filter((item) => item.sourceUrl && matchesTerms(item, searchTerms));
}

export async function fetchGoogleNewsCandidates({ fetchImpl = fetch, terms = DEFAULT_TERMS, limit = 10 } = {}) {
  const results = [];
  const searchTerms = broadSearchTerms(terms).slice(0, 10);
  for (const term of searchTerms) {
    const params = new URLSearchParams({ q: term, hl: 'en-US', gl: 'US', ceid: 'US:en' });
    const response = await fetchImpl(`https://news.google.com/rss/search?${params.toString()}`, { headers: { Accept: 'application/rss+xml, application/xml, text/xml' } });
    if (!response.ok) continue;
    const items = parseRss(await response.text(), { source: 'google_news', baseUrl: 'https://news.google.com/' });
    results.push(...items.slice(0, boundedLimit(limit, 10)));
  }
  return results.filter((item) => matchesTerms(item, searchTerms));
}

export async function fetchGitHubIssueCandidates({ fetchImpl = fetch, terms = DEFAULT_TERMS, limit = 25 } = {}) {
  const query = `(${terms.slice(0, 8).map((term) => `"${String(term).replace(/"/g, '')}"`).join(' OR ')}) in:title,body type:issue state:open`;
  const params = new URLSearchParams({ q: query, sort: 'created', order: 'desc', per_page: String(boundedLimit(limit, 25)) });
  const response = await fetchImpl(`https://api.github.com/search/issues?${params.toString()}`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'client-payment-scope-protection-kit' } });
  if (!response.ok) throw new Error(`GitHub issue search request failed: ${response.status}`);
  const payload = await response.json();
  return (payload.items || []).map((issue) => ({
    source: 'github_issues',
    externalId: String(issue.id || issue.node_id || issue.html_url),
    sourceUrl: issue.html_url,
    title: clean(issue.title),
    body: clean(issue.body || issue.title),
    authorHandle: clean(issue.user?.login, 120),
    publishedAt: issue.created_at || null
  })).filter((item) => matchesTerms(item, terms));
}

export function parseRss(xml, { source = 'rss', baseUrl = '' } = {}) {
  const items = [];
  const blocks = xml.match(/<(?:item|entry)[\s\S]*?<\/(?:item|entry)>/gi) || [];
  for (const block of blocks) {
    const read = (tag) => clean(block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] || '');
    const linkMatch = block.match(/<link[^>]*?(?:href=["']([^"']+)["'])[^>]*>/i);
    const link = read('link') || clean(linkMatch?.[1] || '');
    const id = read('guid') || read('id') || link || read('title');
    items.push({ source, externalId: id, sourceUrl: link || baseUrl, title: read('title'), body: read('description') || read('summary') || read('content'), authorHandle: read('dc:creator') || read('author') || read('name'), publishedAt: read('pubDate') || read('published') || read('updated') || null });
  }
  return items;
}

export async function fetchRssCandidates(feedUrl, { fetchImpl = fetch, terms = DEFAULT_TERMS, source = 'rss' } = {}) {
  const response = await fetchImpl(feedUrl, { headers: { Accept: 'application/rss+xml, application/xml, text/xml' } });
  if (!response.ok) throw new Error(`RSS request failed: ${response.status}`);
  const items = parseRss(await response.text(), { source, baseUrl: feedUrl });
  return items.filter((item) => matchesTerms(item, terms));
}

export function scoreCandidate(item) {
  const text = `${item.title || ''} ${item.body || ''}`.toLowerCase();
  const urgentTerms = ['unpaid', 'hasn\'t paid', 'has not paid', 'late invoice', 'working for free', 'scope creep'];
  const directTerms = ['need', 'how do i', 'help', 'problem', 'advice'];
  const score = 20 + urgentTerms.reduce((total, term) => total + (text.includes(term) ? 18 : 0), 0) + directTerms.reduce((total, term) => total + (text.includes(term) ? 7 : 0), 0);
  return Math.min(score, 100);
}

export function deduplicateCandidates(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.source}:${item.externalId || item.sourceUrl || item.body}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((item) => ({ ...item, fitScore: scoreCandidate(item) }));
}
