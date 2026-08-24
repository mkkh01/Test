import 'dotenv/config';
import pg from 'pg';
import { ResendProvider } from '../integrations/resend-provider.js';

const configuredSupabaseValue = process.env.SUPABASE_URL?.trim() || '';
const databaseUrl = process.env.DATABASE_URL?.trim() || (configuredSupabaseValue.startsWith('postgresql://') || configuredSupabaseValue.startsWith('postgres://') ? configuredSupabaseValue : '');
const pool = databaseUrl
  ? new pg.Pool({ connectionString: databaseUrl, max: Number(process.env.DB_POOL_MAX || 5), idleTimeoutMillis: 30_000, connectionTimeoutMillis: 8_000, ssl: databaseUrl.includes('supabase.com') ? { rejectUnauthorized: false } : undefined })
  : null;
const resendProvider = new ResendProvider();

function safeError(error) {
  return String(error?.message || error || 'Unknown email error').slice(0, 1000);
}

function minGapMinutes() {
  const value = Number(process.env.OUTREACH_MIN_GAP_MINUTES || 30);
  return Number.isFinite(value) ? Math.max(10, Math.min(value, 1440)) : 30;
}

async function claimOne() {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(hashtext($1))', ['client-protection-outreach-sender']);
    const result = await client.query(`
      select om.id, om.lead_id, om.body, om.recipient_email, l.display_name, l.public_handle,
             l.problem_type, l.source_url
      from public.outreach_messages om
      join public.leads l on l.id = om.lead_id
      where om.status = 'queued'
        and om.scheduled_at <= now()
        and om.recipient_email is not null
        and l.contact_permission = 'public_contact'
        and l.opted_out_at is null
        and l.blocked_at is null
        and not exists (
          select 1 from public.outreach_messages recent
          where recent.status = 'sent'
            and recent.sent_at > now() - ($1::text || ' minutes')::interval
        )
      order by om.scheduled_at asc, om.created_at asc
      limit 1
      for update of om skip locked`, [String(minGapMinutes())]);
    const message = result.rows[0];
    if (!message) {
      await client.query('commit');
      return null;
    }
    await client.query(`update public.outreach_messages
      set attempt_count = attempt_count + 1, last_attempt_at = now(), provider = 'resend', updated_at = now()
      where id = $1`, [message.id]);
    await client.query('commit');
    return message;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function finish(message, status, details = {}) {
  await pool.query(`update public.outreach_messages
    set status = $1, sent_at = case when $1 = 'sent' then now() else sent_at end,
        external_message_id = coalesce($2, external_message_id), error_message = $3, updated_at = now()
    where id = $4`, [status, details.providerMessageId || null, details.error || null, message.id]);
  await pool.query(`update public.leads set sales_status = case when $1 = 'sent' then 'contacted' else sales_status end,
    last_contacted_at = case when $1 = 'sent' then now() else last_contacted_at end,
    updated_at = now() where id = $2`, [status, message.lead_id]);
}

export async function closeOutreachWorker() {
  return pool?.end();
}

export async function runOutreachWorker({ limit = 1 } = {}) {
  if (!pool) return { mode: 'disabled', reason: 'DATABASE_URL is not configured.', processed: 0 };
  if (process.env.OUTREACH_SEND_ENABLED !== 'true') return { mode: 'waiting_for_approval', reason: 'OUTREACH_SEND_ENABLED is not true.', processed: 0 };
  if (resendProvider.testMode) return { mode: 'blocked_test_sender', reason: 'A verified sending domain is required for lead outreach.', processed: 0 };
  if (!resendProvider.configured) return { mode: 'not_configured', processed: 0 };

  const results = [];
  for (let i = 0; i < Math.min(Math.max(Number(limit) || 1, 1), 3); i += 1) {
    const message = await claimOne();
    if (!message) break;
    try {
      const result = await resendProvider.sendLeadEmail({
        to: message.recipient_email,
        displayName: message.display_name || message.public_handle || '',
        problem: message.problem_type || '',
        message: message.body,
        sourceUrl: message.source_url || '',
        idempotencyKey: `lead:${message.lead_id}:message:${message.id}`
      });
      await finish(message, result.sent ? 'sent' : 'failed', { providerMessageId: result.providerMessageId, error: result.sent ? null : result.status });
      results.push({ messageId: message.id, status: result.status, providerMessageId: result.providerMessageId || null });
    } catch (error) {
      await finish(message, 'failed', { error: safeError(error) });
      results.push({ messageId: message.id, status: 'failed', error: safeError(error) });
    }
  }
  return { mode: 'resend-approved-only', processed: results.length, results, minGapMinutes: minGapMinutes() };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runOutreachWorker().then((summary) => { console.log(JSON.stringify(summary)); return closeOutreachWorker(); }).catch(async (error) => { console.error(JSON.stringify({ error: safeError(error) })); await closeOutreachWorker(); process.exitCode = 1; });
}
