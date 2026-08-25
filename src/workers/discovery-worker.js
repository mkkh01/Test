import 'dotenv/config';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { fetchHackerNewsCandidates, fetchBlueskyCandidates, fetchDevToCandidates, fetchStackOverflowCandidates, deduplicateCandidates } from '../discovery/public-sources.js';

const configuredSupabaseValue = process.env.SUPABASE_URL?.trim() || '';
const supabaseUrl = configuredSupabaseValue.startsWith('http://') || configuredSupabaseValue.startsWith('https://') ? configuredSupabaseValue : '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } })
  : null;
const databaseUrl = process.env.DATABASE_URL?.trim() || (configuredSupabaseValue.startsWith('postgresql://') || configuredSupabaseValue.startsWith('postgres://') ? configuredSupabaseValue : '');
const pgPool = databaseUrl
  ? new pg.Pool({ connectionString: databaseUrl, max: Number(process.env.DB_POOL_MAX || 5), idleTimeoutMillis: 30_000, connectionTimeoutMillis: 8_000, ssl: databaseUrl.includes('supabase.com') ? { rejectUnauthorized: false } : undefined })
  : null;

function hashContent(item) {
  return crypto.createHash('sha256').update(`${item.source}\n${item.externalId}\n${item.body || item.title || ''}`).digest('hex');
}

async function saveCandidates(items) {
  const normalized = deduplicateCandidates(items);
  if (!pgPool && !supabase) return { discovered: normalized.length, stored: 0, mode: 'dry-run' };

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

  if (pgPool) {
    const client = await pgPool.connect();
    try {
      await client.query('begin');
      const storedRows = [];
      for (const row of sourceRows) {
        const result = await client.query('insert into public.source_items (source, external_id, source_url, title, body, author_handle, published_at, content_hash, processed) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (source, content_hash) do nothing returning id, source, external_id, source_url', [row.source, row.external_id, row.source_url, row.title, row.body, row.author_handle, row.published_at, row.content_hash, false]);
        if (result.rows[0]) storedRows.push(result.rows[0]);
      }
      for (const row of storedRows) {
        await client.query('insert into public.jobs (job_type, dedupe_key, payload) values ($1,$2,$3::jsonb) on conflict (dedupe_key) do nothing', ['lead_analyze', `lead_analyze:${row.source}:${row.external_id || row.source_url}`, JSON.stringify({ sourceItemId: row.id })]);
      }
      await client.query('commit');
      return { discovered: normalized.length, stored: storedRows.length, mode: 'postgres' };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  const { data: storedRows, error: sourceError } = await supabase.from('source_items').upsert(sourceRows, { onConflict: 'source,content_hash', ignoreDuplicates: true }).select('id,source,external_id,source_url');
  if (sourceError) throw sourceError;
  const jobs = (storedRows || []).map((row) => ({ job_type: 'lead_analyze', dedupe_key: `lead_analyze:${row.source}:${row.external_id || row.source_url}`, payload: { sourceItemId: row.id } }));
  if (jobs.length) {
    const { error: jobError } = await supabase.from('jobs').upsert(jobs, { onConflict: 'dedupe_key', ignoreDuplicates: true });
    if (jobError) throw jobError;
  }
  return { discovered: normalized.length, stored: storedRows?.length || 0, mode: 'supabase-rest' };
}

export async function closeDiscoveryWorker() {
  return pgPool?.end();
}

export async function runDiscovery({ fetchImpl = fetch } = {}) {
  const sourceTasks = [
    ['hacker_news', () => fetchHackerNewsCandidates({ fetchImpl, limit: 40 })],
    ['bluesky', () => fetchBlueskyCandidates({ fetchImpl, limit: 12 })],
    ['dev_to', () => fetchDevToCandidates({ fetchImpl, limit: 10 })],
    ['stack_overflow', () => fetchStackOverflowCandidates({ fetchImpl })]
  ];
  const settled = await Promise.allSettled(sourceTasks.map(([, task]) => task()));
  const sources = {};
  const allItems = [];
  settled.forEach((result, index) => {
    const [source] = sourceTasks[index];
    if (result.status === 'fulfilled') {
      sources[source] = { mode: 'ok', discovered: result.value.length };
      allItems.push(...result.value);
    } else {
      sources[source] = { mode: 'error', error: String(result.reason?.message || result.reason).slice(0, 500) };
    }
  });
  const failedSources = Object.entries(sources).filter(([, result]) => result.mode === 'error').map(([source]) => source);
  const saved = await saveCandidates(allItems);
  return {
    ...saved,
    mode: failedSources.length ? 'partial' : saved.mode,
    sources,
    failedSources
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runDiscovery()
    .then((summary) => { console.log(JSON.stringify(summary)); return closeDiscoveryWorker(); })
    .catch((error) => { console.error(error); process.exitCode = 1; });
}
