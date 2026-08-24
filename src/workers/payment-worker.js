import 'dotenv/config';
import pg from 'pg';
import { createDownloadToken, hashDownloadToken } from '../delivery/download-token.js';
import { TronGridProvider } from '../integrations/trongrid-provider.js';
import { UsdtVerifier } from '../integrations/usdt-verifier.js';

const configuredSupabaseValue = process.env.SUPABASE_URL?.trim() || '';
const databaseUrl = process.env.DATABASE_URL?.trim() || (configuredSupabaseValue.startsWith('postgresql://') || configuredSupabaseValue.startsWith('postgres://') ? configuredSupabaseValue : '');
const pool = databaseUrl
  ? new pg.Pool({ connectionString: databaseUrl, max: Number(process.env.DB_POOL_MAX || 5), idleTimeoutMillis: 30_000, connectionTimeoutMillis: 8_000, ssl: databaseUrl.includes('supabase.com') ? { rejectUnauthorized: false } : undefined })
  : null;
const provider = new TronGridProvider();
const verifier = new UsdtVerifier({ provider: provider.configured ? provider : null });

function clean(value, max = 256) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

async function claimJobs(limit = 10) {
  const result = await pool.query(`with claimed as (
    select id from public.jobs
    where job_type = 'payment_check' and status = 'queued' and run_after <= now()
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

async function loadOrder(orderId) {
  const result = await pool.query(`select o.id, o.order_number, o.status, o.amount_usdt, o.network, o.receiving_address,
      i.id as invoice_id, i.status as invoice_status, i.expires_at
    from public.orders o join public.invoices i on i.order_id = o.id
    where o.id = $1 limit 1`, [orderId]);
  return result.rows[0] || null;
}

async function markJob(jobId, status, { runAfter = null, error = null } = {}) {
  if (status === 'queued') {
    await pool.query('update public.jobs set status = $1, run_after = $2, locked_at = null, last_error = $3, updated_at = now() where id = $4', [status, runAfter, error, jobId]);
  } else {
    await pool.query('update public.jobs set status = $1, completed_at = now(), locked_at = null, last_error = $2, updated_at = now() where id = $3', [status, error, jobId]);
  }
}

async function processJob(job) {
  const orderId = clean(job.payload?.orderId, 80);
  const txid = clean(job.payload?.txid, 128);
  if (!orderId || !txid) {
    await markJob(job.id, 'dead_letter', { error: 'Missing orderId or txid.' });
    return { jobId: job.id, status: 'dead_letter' };
  }
  const order = await loadOrder(orderId);
  if (!order) {
    await markJob(job.id, 'succeeded', { error: 'Orphaned payment job skipped.' });
    return { jobId: job.id, status: 'orphaned' };
  }
  if (order.status === 'paid' || order.status === 'expired' || order.status === 'cancelled') {
    await markJob(job.id, 'succeeded', { error: `Order already ${order.status}.` });
    return { jobId: job.id, status: order.status };
  }
  if (new Date(order.expires_at).getTime() <= Date.now()) {
    await pool.query('update public.orders set status = $1, updated_at = now() where id = $2 and status not in (\'paid\', \'cancelled\')', ['expired', order.id]);
    await pool.query('update public.invoices set status = $1, updated_at = now() where id = $2 and status = \'open\'', ['expired', order.invoice_id]);
    await markJob(job.id, 'succeeded', { error: 'Invoice expired.' });
    return { jobId: job.id, status: 'expired' };
  }
  if (!verifier.configured) {
    await markJob(job.id, 'queued', { runAfter: new Date(Date.now() + 15 * 60 * 1000), error: 'USDT verifier is not configured.' });
    return { jobId: job.id, status: 'waiting_for_provider' };
  }

  const verification = await verifier.verify({ txid, invoice: { amountUsdt: Number(order.amount_usdt), network: order.network, receivingAddress: order.receiving_address } });
  const transaction = verification.transaction || {};
  const paymentStatus = verification.status === 'confirmed' ? 'confirmed' : verification.status === 'confirming' ? 'confirming' : verification.status === 'manual_review' ? 'manual_review' : 'rejected';
  const client = await pool.connect();
  try {
    await client.query('begin');
    const lockedResult = await client.query('select o.id, o.status, i.id as invoice_id from public.orders o join public.invoices i on i.order_id = o.id where o.id = $1 for update', [order.id]);
    const locked = lockedResult.rows[0];
    if (!locked || locked.status === 'paid') {
      await client.query('commit');
      await markJob(job.id, 'succeeded', { error: 'Payment job already completed.' });
      return { jobId: job.id, status: 'paid' };
    }
    const existing = await client.query('select id, invoice_id from public.payments where txid = $1 limit 1', [txid]);
    if (existing.rows[0] && existing.rows[0].invoice_id !== locked.invoice_id) {
      await client.query('update public.orders set status = $1, updated_at = now() where id = $2', ['manual_review', order.id]);
      await client.query('update public.invoices set status = $1, updated_at = now() where id = $2', ['manual_review', locked.invoice_id]);
      await client.query('insert into public.audit_logs (actor_type, action, entity_type, entity_id, metadata) values ($1,$2,$3,$4,$5)', ['integration', 'duplicate_txid_review', 'order', order.id, JSON.stringify({ txid })]);
      await client.query('commit');
      await markJob(job.id, 'succeeded', { error: 'TxID belongs to another invoice.' });
      return { jobId: job.id, status: 'manual_review' };
    }
    if (existing.rows[0]) {
      await client.query('update public.payments set network = $1, token_contract = $2, from_address = $3, to_address = $4, amount_usdt = $5, confirmations = $6, status = $7, provider = $8, raw_reference = $9, verified_at = $10, updated_at = now() where id = $11', [transaction.network || order.network, transaction.tokenContract || '', transaction.fromAddress || null, transaction.toAddress || '', Number(transaction.amountUsdt || 0), Number(transaction.confirmations || 0), paymentStatus, 'trongrid', JSON.stringify(transaction.raw || transaction), verification.status === 'confirmed' ? new Date().toISOString() : null, existing.rows[0].id]);
    } else {
      await client.query('insert into public.payments (invoice_id, txid, network, token_contract, from_address, to_address, amount_usdt, confirmations, status, provider, raw_reference, verified_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [locked.invoice_id, txid, transaction.network || order.network, transaction.tokenContract || '', transaction.fromAddress || null, transaction.toAddress || '', Number(transaction.amountUsdt || 0), Number(transaction.confirmations || 0), paymentStatus, 'trongrid', JSON.stringify(transaction.raw || transaction), verification.status === 'confirmed' ? new Date().toISOString() : null]);
    }
    if (verification.status === 'confirmed') {
      const downloadToken = createDownloadToken();
      const downloadTokenHash = hashDownloadToken(downloadToken);
      const downloadExpiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
      await client.query('update public.orders set status = $1, download_token_hash = $2, download_expires_at = $3, updated_at = now() where id = $4', ['paid', downloadTokenHash, downloadExpiresAt, order.id]);
      await client.query('update public.invoices set status = $1, updated_at = now() where id = $2', ['paid', locked.invoice_id]);
      await client.query('insert into public.audit_logs (actor_type, action, entity_type, entity_id, metadata) values ($1,$2,$3,$4,$5)', ['integration', 'payment_confirmed_by_worker', 'order', order.id, JSON.stringify({ txid, confirmations: transaction.confirmations })]);
      await client.query('commit');
      await markJob(job.id, 'succeeded');
      return { jobId: job.id, status: 'confirmed', downloadTokenIssued: true };
    }
    const orderStatus = verification.status === 'confirming' ? 'confirming' : verification.status === 'manual_review' ? 'manual_review' : 'awaiting_payment';
    const invoiceStatus = verification.status === 'manual_review' ? 'manual_review' : 'open';
    await client.query('update public.orders set status = $1, updated_at = now() where id = $2', [orderStatus, order.id]);
    await client.query('update public.invoices set status = $1, updated_at = now() where id = $2', [invoiceStatus, locked.invoice_id]);
    await client.query('commit');
    if (verification.status === 'confirming') {
      await markJob(job.id, 'queued', { runAfter: new Date(Date.now() + 5 * 60 * 1000), error: verification.reason || null });
    } else {
      await markJob(job.id, 'succeeded', { error: verification.reason || null });
    }
    return { jobId: job.id, status: verification.status, reason: verification.reason };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function closePaymentWorker() {
  return pool?.end();
}

export async function runPaymentWorker({ limit = 10 } = {}) {
  if (!pool) return { mode: 'disabled', reason: 'DATABASE_URL is not configured.', processed: 0 };
  const jobs = await claimJobs(limit);
  const results = [];
  for (const job of jobs) {
    try {
      results.push(await processJob(job));
    } catch (error) {
      await pool.query('update public.jobs set status = case when attempts >= 3 then \'dead_letter\' else \'queued\' end, run_after = now() + interval \'5 minutes\', locked_at = null, last_error = $1, updated_at = now() where id = $2', [String(error.message).slice(0, 1000), job.id]);
    }
  }
  return { mode: 'postgres-trongrid', processed: results.length, results };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPaymentWorker()
    .then((summary) => { console.log(JSON.stringify(summary)); return closePaymentWorker(); })
    .catch(async (error) => { console.error(error); await pool?.end(); process.exitCode = 1; });
}
