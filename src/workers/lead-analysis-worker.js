import 'dotenv/config';
import pg from 'pg';
import { GeminiRouter } from '../integrations/gemini-router.js';

const databaseUrl = process.env.DATABASE_URL?.trim();
const pool = databaseUrl
  ? new pg.Pool({ connectionString: databaseUrl, max: Number(process.env.DB_POOL_MAX || 5), idleTimeoutMillis: 30_000, connectionTimeoutMillis: 8_000, ssl: databaseUrl.includes('supabase.com') ? { rejectUnauthorized: false } : undefined })
  : null;
const gemini = new GeminiRouter();

const SYSTEM_INSTRUCTION = `You analyze public posts for a digital product called Client Payment & Scope Protection Kit. Return only valid JSON with these keys: buyer_type, problem_type, fit_score, evidence, recommended_product, message_draft, needs_human_review. Use only facts in the supplied public text. Never invent losses, identity, contact details, legal claims, urgency, or purchasing intent. The English message must be short, helpful, and non-spammy. Always set needs_human_review to true for a first contact. Use problem_type values: late_payment, scope_creep, missing_deposit, handover_confusion, or other. Use recommended_product values: Starter, Complete, or Agency.`;

function parseJson(text) {
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Gemini did not return a JSON object.');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function boundedScore(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : 0;
}

async function claimJobs(limit = 10) {
  const result = await pool.query(`with claimed as (
    select id from public.jobs
    where job_type = 'lead_analyze' and status = 'queued' and run_after <= now()
    order by created_at asc
    limit $1
    for update skip locked
  )
  update public.jobs j
  set status = 'running', locked_at = now(), attempts = attempts + 1, updated_at = now()
  from claimed
  where j.id = claimed.id
  returning j.id, j.payload`, [limit]);
  return result.rows;
}

async function analyzeJob(job) {
  const sourceItemId = job.payload?.sourceItemId;
  const sourceResult = await pool.query('select id, source, source_url, title, body, author_handle, published_at from public.source_items where id = $1 limit 1', [sourceItemId]);
  const source = sourceResult.rows[0];
  if (!source) throw new Error('Source item not found.');

  const analysisResult = await gemini.generateText({
    systemInstruction: SYSTEM_INSTRUCTION,
    prompt: JSON.stringify({ source: source.source, url: source.source_url, title: source.title, public_text: source.body, public_handle: source.author_handle, published_at: source.published_at })
  });
  const analysis = parseJson(analysisResult.text);
  const fitScore = boundedScore(analysis.fit_score);

  const leadResult = await pool.query('insert into public.leads (source, source_item_id, source_url, display_name, public_handle, buyer_type, problem_type, fit_score, status, evidence_excerpt) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (source, source_url) do update set buyer_type = excluded.buyer_type, problem_type = excluded.problem_type, fit_score = excluded.fit_score, evidence_excerpt = excluded.evidence_excerpt, updated_at = now() returning id', [source.source, source.id, source.source_url, source.author_handle || null, source.author_handle || null, String(analysis.buyer_type || 'unknown').slice(0, 120), String(analysis.problem_type || 'other').slice(0, 80), fitScore, 'analyzed', String(analysis.evidence || '').slice(0, 1000)]);
  const leadId = leadResult.rows[0].id;

  await pool.query('insert into public.lead_analyses (lead_id, model, prompt_version, problem_type, buyer_type, fit_score, evidence, recommended_product, message_draft, needs_human_review, validation_status, raw_response) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [leadId, analysisResult.model, 'v1', String(analysis.problem_type || 'other').slice(0, 80), String(analysis.buyer_type || 'unknown').slice(0, 120), fitScore, String(analysis.evidence || '').slice(0, 1000), String(analysis.recommended_product || 'Starter').slice(0, 40), String(analysis.message_draft || '').slice(0, 4000), true, 'passed', JSON.stringify(analysis)]);

  if (analysis.message_draft) {
    await pool.query('insert into public.outreach_messages (lead_id, channel, direction, body, status, approval_required) values ($1,$2,$3,$4,$5,$6)', [leadId, 'source_public_reply', 'outbound', String(analysis.message_draft).slice(0, 4000), 'draft', true]);
  }
  await pool.query('update public.source_items set processed = true where id = $1', [source.id]);
  await pool.query('update public.jobs set status = $1, completed_at = now(), updated_at = now(), last_error = null where id = $2', ['succeeded', job.id]);
  return { jobId: job.id, leadId, fitScore };
}

export async function closeLeadAnalysisWorker() {
  return pool?.end();
}

export async function runLeadAnalysis({ limit = 10 } = {}) {
  if (!pool) return { mode: 'disabled', reason: 'DATABASE_URL is not configured.', processed: 0 };
  if (!gemini.keys.length) return { mode: 'waiting_for_gemini', reason: 'No Gemini API key is configured.', processed: 0 };
  const jobs = await claimJobs(limit);
  const results = [];
  for (const job of jobs) {
    try {
      results.push(await analyzeJob(job));
    } catch (error) {
      await pool.query('update public.jobs set status = case when attempts >= 3 then \'dead_letter\' else \'queued\' end, run_after = now() + interval \'5 minutes\', last_error = $1, updated_at = now() where id = $2', [String(error.message).slice(0, 1000), job.id]);
    }
  }
  return { mode: 'postgres-gemini', processed: results.length, results };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runLeadAnalysis()
    .then((summary) => { console.log(JSON.stringify(summary)); return closeLeadAnalysisWorker(); })
    .catch(async (error) => { console.error(error); await pool?.end(); process.exitCode = 1; });
}
