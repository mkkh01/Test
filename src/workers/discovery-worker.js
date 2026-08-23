import 'dotenv/config';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { fetchHackerNewsCandidates, fetchBlueskyCandidates, deduplicateCandidates } from '../discovery/public-sources.js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } })
  : null;

function hashContent(item) {
  return crypto.createHash('sha256').update(`${item.source}\n${item.externalId}\n${item.body || item.title || ''}`).digest('hex');
}

async function saveCandidates(items) {
  const normalized = deduplicateCandidates(items);
  if (!supabase) return { discovered: normalized.length, stored: 0, mode: 'dry-run' };

  const sourceRows = normalized.map((item) => ({
    source: item.source,
    external_id: item.externalId || null,
    source_url: item.sourceUrl,
    title: item.title || null,
    body: item.body || null,
    author_handle: item.authorHandle || null,
    published_at: item.publishedAt || null,
    content_hash: hashContent(item),
    processed: false
  }));

  const { data: storedRows, error: sourceError } = await supabase
    .from('source_items')
    .upsert(sourceRows, { onConflict: 'source,content_hash', ignoreDuplicates: true })
    .select('id,source,external_id,source_url');
  if (sourceError) throw sourceError;

  const jobs = (storedRows || []).map((row) => ({
    job_type: 'lead_analyze',
    dedupe_key: `lead_analyze:${row.source}:${row.external_id || row.source_url}`,
    payload: { sourceItemId: row.id }
  }));
  if (jobs.length) {
    const { error: jobError } = await supabase.from('jobs').upsert(jobs, { onConflict: 'dedupe_key', ignoreDuplicates: true });
    if (jobError) throw jobError;
  }
  return { discovered: normalized.length, stored: storedRows?.length || 0, mode: 'supabase' };
}

export async function runDiscovery({ fetchImpl = fetch } = {}) {
  const [hackerNews, bluesky] = await Promise.all([
    fetchHackerNewsCandidates({ fetchImpl, limit: 40 }),
    fetchBlueskyCandidates({ fetchImpl, limit: 12 })
  ]);
  return saveCandidates([...hackerNews, ...bluesky]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runDiscovery()
    .then((summary) => console.log(JSON.stringify(summary)))
    .catch((error) => { console.error(error); process.exitCode = 1; });
}
