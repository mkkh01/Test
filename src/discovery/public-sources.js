const DEFAULT_TERMS = [
  'late invoice', 'unpaid client', "client hasn't paid", 'scope creep',
  'extra revisions', 'working for free', 'client disappeared', 'need a deposit',
  'payment terms', 'freelance contract'
];

function clean(value, max = 4000) {
  return typeof value === 'string' ? value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function matchesTerms(item, terms) {
  const haystack = `${item.title || ''} ${item.body || ''}`.toLowerCase();
  return terms.some((term) => haystack.includes(term.toLowerCase()));
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
    const url = `https://dev.to/api/articles?tag=${encodeURIComponent(tag)}&per_page=${Math.min(limit, 100)}`;
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

export async function fetchStackOverflowCandidates({ fetchImpl = fetch, terms = DEFAULT_TERMS } = {}) {
  const tags = ['freelancing', 'freelance', 'small-business'];
  const feedUrl = `https://stackoverflow.com/feeds/tag?tagnames=${encodeURIComponent(tags.join(';'))}&sort=newest`;
  const response = await fetchImpl(feedUrl, { headers: { Accept: 'application/atom+xml, application/xml, text/xml' } });
  if (!response.ok) throw new Error(`Stack Overflow feed request failed: ${response.status}`);
  return parseRss(await response.text(), { source: 'stack_overflow', baseUrl: feedUrl }).filter((item) => matchesTerms(item, terms));
}

export async function fetchBlueskyCandidates({ fetchImpl = fetch, terms = DEFAULT_TERMS, limit = 25 } = {}) {
  const results = [];
  for (const term of terms.slice(0, 6)) {
    const url = `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(term)}&limit=${Math.min(limit, 100)}`;
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
