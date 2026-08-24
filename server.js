import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createDownloadToken, hashDownloadToken, isTokenExpired } from './src/delivery/download-token.js';
import { productBundles } from './src/delivery/product-manifest.js';
import { GeminiRouter } from './src/integrations/gemini-router.js';
import { TelegramBot } from './src/integrations/telegram-bot.js';
import { ResendProvider } from './src/integrations/resend-provider.js';
import { SolanaRpcProvider, isValidSolanaAddress, solanaConstants } from './src/integrations/solana-rpc-provider.js';
import { UsdtVerifier } from './src/integrations/usdt-verifier.js';
import { requireAdmin } from './src/auth/admin-auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number(process.env.PORT || 10000);
const configuredSupabaseValue = process.env.SUPABASE_URL?.trim() || '';
const databaseUrl = process.env.DATABASE_URL?.trim() || (configuredSupabaseValue.startsWith('postgresql://') || configuredSupabaseValue.startsWith('postgres://') ? configuredSupabaseValue : '');
const supabaseUrl = configuredSupabaseValue.startsWith('http://') || configuredSupabaseValue.startsWith('https://') ? configuredSupabaseValue : '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } })
  : null;
const pgPool = databaseUrl
  ? new pg.Pool({
      connectionString: databaseUrl,
      max: Number(process.env.DB_POOL_MAX || 5),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
      ssl: databaseUrl.includes('supabase.com') ? { rejectUnauthorized: false } : undefined
    })
  : null;
const geminiRouter = new GeminiRouter();
const telegramBot = new TelegramBot();
const resendProvider = new ResendProvider();
const { SOLANA_USDT_MINT, SOLANA_DEFAULT_RECEIVING_ADDRESS } = solanaConstants;
const solanaRpcProvider = new SolanaRpcProvider();
const usdtVerifier = new UsdtVerifier({ provider: solanaRpcProvider.configured ? solanaRpcProvider : null });
const products = [
  {
    slug: 'client-payment-scope-protection-complete',
    name: 'Client Payment & Scope Protection Kit',
    tagline: 'Protect your scope, control revisions, and get paid professionally.',
    priceUsdt: 7,
    tier: 'Complete',
    includes: ['Client discovery form', 'Proposal and Scope of Work', 'Change Request Form', 'Invoice and payment terms', 'Payment follow-up emails', 'Handover and acceptance form', 'Excel project payment tracker']
  },
  {
    slug: 'client-payment-scope-protection-starter',
    name: 'Client Payment & Scope Protection Kit — Starter',
    tagline: 'Start with the essentials for your next client project.',
    priceUsdt: 5,
    tier: 'Starter',
    includes: ['Proposal template', 'Scope of Work template', 'Deposit request email', 'Five payment follow-up emails']
  },
  {
    slug: 'client-payment-scope-protection-agency',
    name: 'Client Payment & Scope Protection Kit — Agency',
    tagline: 'A structured client workflow for small agencies and teams.',
    priceUsdt: 10,
    tier: 'Agency',
    includes: ['Everything in Complete', 'Agency project tracker', 'Team approval flow', 'Client communication log', 'Profitability worksheet']
  }
];

function cleanText(value, max = 2000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function publicBaseUrl() {
  const configured = cleanText(process.env.PUBLIC_BASE_URL, 300).replace(/\/$/, '');
  if (!configured || configured.toLowerCase().includes('public_base_url')) return 'https://test-p2h3.onrender.com';
  try {
    const parsed = new URL(configured);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) return 'https://test-p2h3.onrender.com';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return 'https://test-p2h3.onrender.com';
  }
}

function hasDatabase() {
  return Boolean(pgPool || supabase);
}

function cronAuthorized(req) {
  const expected = process.env.CRON_TRIGGER_SECRET?.trim() || '';
  const authorization = req.get('authorization') || '';
  const provided = req.get('x-cron-secret') || (authorization.startsWith('Bearer ') ? authorization.slice(7) : '');
  if (!expected || !provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}

let cronRunning = false;

function runCronChild() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'src/workers/cron-runner.js')], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-8000); });
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });
    child.on('error', (error) => resolve({ code: 1, stdout, stderr: String(error.message).slice(0, 1000) }));
    child.on('close', (code) => resolve({ code: Number.isInteger(code) ? code : 1, stdout, stderr }));
  });
}

function paymentConfig() {
  const configuredAddress = cleanText(process.env.USDT_RECEIVING_ADDRESS, 128);
  const configuredMint = cleanText(process.env.SOLANA_USDT_MINT, 128);
  const receivingAddress = isValidSolanaAddress(configuredAddress) ? configuredAddress : SOLANA_DEFAULT_RECEIVING_ADDRESS;
  const tokenContract = configuredMint || SOLANA_USDT_MINT;
  const minConfirmations = Number(process.env.USDT_MIN_CONFIRMATIONS || 1);
  return {
    network: 'SOLANA_SPL',
    receivingAddress,
    tokenContract,
    minConfirmations,
    valid: isValidSolanaAddress(receivingAddress) && tokenContract === SOLANA_USDT_MINT
  };
}

function publicOrder(order, { statusToken, downloadToken } = {}) {
  const result = {
    orderNumber: order.orderNumber,
    invoiceNumber: order.invoiceNumber,
    product: order.product,
    amountUsdt: Number(order.amountUsdt),
    network: order.network,
    receivingAddress: order.receivingAddress,
    expiresAt: order.expiresAt,
    status: order.status,
    invoiceStatus: order.invoiceStatus,
    statusUrl: statusToken ? `/api/orders/${encodeURIComponent(order.orderNumber)}/status?token=${encodeURIComponent(statusToken)}` : undefined,
    submitTxidUrl: statusToken ? `/api/orders/${encodeURIComponent(order.orderNumber)}/payment` : undefined
  };
  if (statusToken) result.statusToken = statusToken;
  if (order.paymentFailedAttempts !== undefined) result.paymentFailedAttempts = Number(order.paymentFailedAttempts || 0);
  if (order.paymentEvidenceRequested) {
    result.paymentEvidenceRequested = true;
    if (statusToken) result.submitEvidenceUrl = `/api/orders/${encodeURIComponent(order.orderNumber)}/payment-evidence`;
  }
  if (downloadToken) result.downloadUrl = `/api/download/${encodeURIComponent(downloadToken)}`;
  return result;
}

async function getProductBySlug(slug) {
  if (pgPool) {
    const result = await pgPool.query('select id, slug, price_usdt from public.products where slug = $1 and active = true limit 1', [slug]);
    return result.rows[0] || null;
  }
  if (supabase) {
    const { data, error } = await supabase.from('products').select('id,slug,price_usdt').eq('slug', slug).eq('active', true).limit(1).maybeSingle();
    if (error) throw error;
    return data;
  }
  return products.find((item) => item.slug === slug) || null;
}

async function getOrderByAccessToken(orderNumber, statusToken) {
  const tokenHash = hashDownloadToken(statusToken);
  if (pgPool) {
    const result = await pgPool.query(`
      select o.id, o.order_number, o.customer_email, o.customer_name, o.amount_usdt, o.network,
             o.receiving_address, o.status, o.payment_failed_attempts, o.payment_evidence_requested_at, o.download_expires_at, p.slug,
             i.invoice_number, i.status as invoice_status, i.expires_at
      from public.orders o
      join public.products p on p.id = o.product_id
      join public.invoices i on i.order_id = o.id
      where o.order_number = $1 and o.access_token_hash = $2
      limit 1`, [orderNumber, tokenHash]);
    return result.rows[0] || null;
  }
  if (supabase) {
    const { data, error } = await supabase.from('orders').select('id,order_number,customer_email,customer_name,amount_usdt,network,receiving_address,status,payment_failed_attempts,payment_evidence_requested_at,download_expires_at,product_id,access_token_hash').eq('order_number', orderNumber).eq('access_token_hash', tokenHash).limit(1).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const { data: product, error: productError } = await supabase.from('products').select('slug').eq('id', data.product_id).limit(1).maybeSingle();
    if (productError) throw productError;
    const { data: invoice, error: invoiceError } = await supabase.from('invoices').select('invoice_number,status,expires_at').eq('order_id', data.id).limit(1).maybeSingle();
    if (invoiceError) throw invoiceError;
    return { ...data, slug: product?.slug, invoice_number: invoice?.invoice_number, invoice_status: invoice?.status, expires_at: invoice?.expires_at };
  }
  return null;
}

function normalizeOrder(row) {
  return {
    id: row.id,
    orderNumber: row.order_number,
    invoiceNumber: row.invoice_number,
    product: row.slug,
    amountUsdt: Number(row.amount_usdt),
    network: row.network,
    receivingAddress: row.receiving_address,
    status: row.status,
    paymentFailedAttempts: Number(row.payment_failed_attempts || 0),
    paymentEvidenceRequested: Boolean(row.payment_evidence_requested_at),
    invoiceStatus: row.invoice_status,
    expiresAt: row.expires_at,
    downloadExpiresAt: row.download_expires_at
  };
}

async function enqueueJob(client, jobType, dedupeKey, payload, runAfter = new Date()) {
  await client.query(`insert into public.jobs (job_type, dedupe_key, payload, run_after) values ($1,$2,$3,$4) on conflict (dedupe_key) do nothing`, [jobType, dedupeKey, JSON.stringify(payload), runAfter]);
}

function txidError(error) {
  if (error?.code === 'TX_NOT_FOUND') return { status: 404, body: { ok: false, status: 'rejected', reason: 'transaction_not_found', error: 'Transaction not found on Solana.' } };
  if (error?.code === 'INVALID_TXID') return { status: 400, body: { ok: false, status: 'rejected', reason: 'invalid_txid', error: 'Enter a valid Solana transaction signature.' } };
  if ([403, 429].includes(error?.status)) return { status: 503, body: { ok: false, status: 'manual_review', reason: 'provider_rate_limited', error: 'Blockchain verification is temporarily rate-limited. Please try again later.' } };
  return null;
}

async function recordFailedPaymentAttempt(orderNumber, statusToken, reason) {
  if (!pgPool) return null;
  const row = await getOrderByAccessToken(orderNumber, statusToken);
  if (!row || ['paid', 'cancelled'].includes(row.status)) return null;
  const client = await pgPool.connect();
  try {
    await client.query('begin');
    const result = await client.query(`
      update public.orders
      set payment_failed_attempts = payment_failed_attempts + 1,
          payment_evidence_requested_at = case when payment_failed_attempts + 1 >= 2 then coalesce(payment_evidence_requested_at, now()) else payment_evidence_requested_at end,
          updated_at = now()
      where id = $1
      returning payment_failed_attempts, payment_evidence_requested_at`, [row.id]);
    const updated = result.rows[0];
    if (updated) {
      await client.query('insert into public.audit_logs (actor_type, action, entity_type, entity_id, metadata) values ($1,$2,$3,$4,$5)', ['customer', 'payment_failed_attempt', 'order', row.id, JSON.stringify({ reason, attempts: updated.payment_failed_attempts })]);
    }
    await client.query('commit');
    return updated || null;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '320kb' }));
app.use(express.urlencoded({ extended: true, limit: '320kb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/preview', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'preview.html')));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'client-payment-scope-protection-platform',
    environment: process.env.NODE_ENV || 'development',
    supabaseConfigured: Boolean(supabase),
    postgresConfigured: Boolean(pgPool),
    dataStore: pgPool ? 'postgres' : supabase ? 'supabase-rest' : 'demo',
    telegramConfigured: telegramBot.configured,
    emailConfigured: resendProvider.configured,
    geminiKeyCount: geminiRouter.keys.length,
    solanaRpcConfigured: solanaRpcProvider.configured,
    usdtConfigured: solanaRpcProvider.configured && usdtVerifier.configured && paymentConfig().valid,
    paymentConfigurationValid: paymentConfig().valid,
    cronTriggerConfigured: Boolean(process.env.CRON_TRIGGER_SECRET?.trim()),
    usdtMinConfirmations: paymentConfig().minConfirmations
  });
});

app.get('/api/products', async (_req, res) => {
  try {
    if (pgPool) {
      const result = await pgPool.query('select slug, name, tagline, price_usdt, tier from public.products where active = true order by sort_order asc limit 50');
      return res.json({ products: result.rows.map((row) => ({ ...row, priceUsdt: Number(row.price_usdt) })) });
    }
    if (supabase) {
      const { data, error } = await supabase.from('products').select('slug,name,tagline,price_usdt,tier').eq('active', true).order('sort_order', { ascending: true }).limit(50);
      if (error) throw error;
      return res.json({ products: data.map((row) => ({ ...row, priceUsdt: Number(row.price_usdt) })) });
    }
    return res.json({ products });
  } catch (error) {
    console.error('product list failed', error);
    return res.status(500).json({ ok: false, error: 'Products are temporarily unavailable.' });
  }
});

app.get('/api/admin/summary', requireAdmin, async (_req, res) => {
  if (!hasDatabase()) return res.status(503).json({ ok: false, error: 'Database is not configured.' });
  const tables = ['intake_submissions', 'orders', 'invoices', 'payments', 'leads', 'outreach_messages'];
  const counts = {};
  try {
    for (const table of tables) {
      if (pgPool) {
        const result = await pgPool.query(`select count(*)::int as count from public.${table}`);
        counts[table] = result.rows[0]?.count || 0;
      } else {
        const { count, error } = await supabase.from(table).select('id', { count: 'exact', head: true });
        if (error) throw error;
        counts[table] = count || 0;
      }
    }
    const config = paymentConfig();
    return res.json({ ok: true, counts, generatedAt: new Date().toISOString(), payment: { network: 'SOLANA_SPL', asset: 'USDT-SPL', configurationValid: config.valid, solanaRpcConfigured: solanaRpcProvider.configured, verifierConfigured: usdtVerifier.configured, confirmations: config.minConfirmations } });
  } catch (error) {
    console.error('admin summary failed', error);
    return res.status(500).json({ ok: false, error: 'Could not load admin summary.' });
  }
});

app.get('/api/admin/leads', requireAdmin, async (req, res) => {
  if (!pgPool) return res.status(503).json({ ok: false, error: 'Lead review requires PostgreSQL.' });
  const page = Math.max(1, Number.parseInt(req.query.page || '1', 10) || 1);
  const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit || '25', 10) || 25));
  const offset = (page - 1) * limit;
  const status = cleanText(req.query.status, 40);
  const salesStatus = cleanText(req.query.salesStatus, 40);
  try {
    const result = await pgPool.query(`
      select l.id, l.source, l.source_url, l.display_name, l.public_handle,
             l.contact_email, l.contact_email_source, l.contact_permission,
             l.buyer_type, l.problem_type, l.fit_score, l.status, l.sales_status,
             l.evidence_excerpt, l.discovered_at, l.last_contacted_at, l.opted_out_at,
             la.recommended_product, la.message_draft as analysis_message_draft,
             om.id as message_id, om.channel as message_channel, om.body as message_body,
             om.recipient_email as message_recipient_email, om.subject as message_subject,
             om.status as message_status, om.approval_required, om.approved_by,
             om.approved_at, om.scheduled_at, om.sent_at, om.external_message_id,
             om.error_message, om.attempt_count,
             order_info.order_number, order_info.order_status
      from public.leads l
      left join lateral (
        select recommended_product, message_draft
        from public.lead_analyses where lead_id = l.id order by created_at desc limit 1
      ) la on true
      left join lateral (
        select id, channel, body, recipient_email, subject, status, approval_required,
               approved_by, approved_at, scheduled_at, sent_at, external_message_id,
               error_message, attempt_count
        from public.outreach_messages where lead_id = l.id order by created_at desc limit 1
      ) om on true
      left join lateral (
        select o.order_number, o.status as order_status
        from public.orders o
        where l.contact_email is not null and lower(o.customer_email) = lower(l.contact_email)
        order by o.created_at desc limit 1
      ) order_info on true
      where ($1 = '' or l.status = $1) and ($2 = '' or l.sales_status = $2)
      order by l.fit_score desc nulls last, l.discovered_at desc
      limit $3 offset $4`, [status, salesStatus, limit, offset]);
    return res.json({ ok: true, page, limit, leads: result.rows });
  } catch (error) {
    console.error('admin leads failed', error);
    return res.status(500).json({ ok: false, error: 'Could not load leads.' });
  }
});

app.post('/api/admin/leads/:id/approve', requireAdmin, async (req, res) => {
  if (!pgPool) return res.status(503).json({ ok: false, error: 'Lead approval requires PostgreSQL.' });
  const leadId = cleanText(req.params.id, 80);
  const recipientEmail = cleanText(req.body.recipientEmail, 320).toLowerCase();
  const approvalNote = cleanText(req.body.approvalNote, 500);
  if (!isEmail(recipientEmail)) return res.status(400).json({ ok: false, error: 'A valid public contact email is required.' });
  const client = await pgPool.connect();
  try {
    await client.query('begin');
    const leadResult = await client.query(`select id, status, contact_permission, opted_out_at, blocked_at from public.leads where id = $1 for update`, [leadId]);
    const lead = leadResult.rows[0];
    if (!lead) { await client.query('rollback'); return res.status(404).json({ ok: false, error: 'Lead not found.' }); }
    if (lead.opted_out_at || lead.blocked_at || lead.contact_permission === 'opted_out' || lead.contact_permission === 'blocked') { await client.query('rollback'); return res.status(409).json({ ok: false, error: 'This lead is blocked or opted out.' }); }
    const messageResult = await client.query(`select id, body, status from public.outreach_messages where lead_id = $1 order by created_at desc limit 1 for update`, [leadId]);
    let message = messageResult.rows[0];
    if (!message) {
      const analysis = await client.query('select message_draft from public.lead_analyses where lead_id = $1 order by created_at desc limit 1', [leadId]);
      const body = cleanText(analysis.rows[0]?.message_draft, 4000);
      if (!body) { await client.query('rollback'); return res.status(400).json({ ok: false, error: 'This lead has no message draft.' }); }
      const created = await client.query(`insert into public.outreach_messages (lead_id, channel, direction, body, subject, status, approval_required, recipient_email, provider) values ($1, 'email', 'outbound', $2, $3, 'draft', true, $4, 'resend') returning id, body, status`, [leadId, body, 'A practical note about your client workflow', recipientEmail]);
      message = created.rows[0];
    }
    if (message.status === 'sent') { await client.query('rollback'); return res.status(409).json({ ok: false, error: 'This message has already been sent.' }); }
    const idempotencyKey = `lead:${leadId}:message:${message.id}`;
    await client.query(`update public.leads set contact_email = $1, contact_email_source = 'admin_verified_public', contact_permission = 'public_contact', sales_status = 'qualified', status = 'approved', updated_at = now() where id = $2`, [recipientEmail, leadId]);
    await client.query(`update public.outreach_messages set recipient_email = $1, subject = coalesce(subject, $2), status = 'queued', approval_required = false, approved_by = 'admin', approval_note = $3, approved_at = now(), scheduled_at = now(), provider = 'resend', idempotency_key = $4, updated_at = now() where id = $5`, [recipientEmail, 'A practical note about your client workflow', approvalNote || null, idempotencyKey, message.id]);
    await client.query('insert into public.audit_logs (actor_type, action, entity_type, entity_id, metadata) values ($1,$2,$3,$4,$5)', ['admin', 'lead_message_approved', 'lead', leadId, JSON.stringify({ messageId: message.id, recipientEmail, idempotencyKey })]);
    await client.query('commit');
    return res.status(202).json({ ok: true, status: 'queued', leadId, messageId: message.id });
  } catch (error) {
    await client.query('rollback');
    console.error('admin lead approval failed', error);
    return res.status(500).json({ ok: false, error: 'Could not approve lead message.' });
  } finally {
    client.release();
  }
});

app.post('/api/admin/leads/:id/reject', requireAdmin, async (req, res) => {
  if (!pgPool) return res.status(503).json({ ok: false, error: 'Lead review requires PostgreSQL.' });
  const leadId = cleanText(req.params.id, 80);
  const reason = cleanText(req.body.reason, 500);
  try {
    await pgPool.query(`update public.outreach_messages set status = 'rejected', error_message = $1, updated_at = now() where lead_id = $2 and status in ('draft', 'approved', 'queued')`, [reason || 'Rejected by admin.', leadId]);
    await pgPool.query(`update public.leads set status = 'ignored', sales_status = 'not_interested', updated_at = now() where id = $1`, [leadId]);
    await pgPool.query('insert into public.audit_logs (actor_type, action, entity_type, entity_id, metadata) values ($1,$2,$3,$4,$5)', ['admin', 'lead_message_rejected', 'lead', leadId, JSON.stringify({ reason: reason || null })]);
    return res.json({ ok: true, status: 'rejected', leadId });
  } catch (error) {
    console.error('admin lead rejection failed', error);
    return res.status(500).json({ ok: false, error: 'Could not reject lead message.' });
  }
});

app.post('/api/admin/leads/:id/opt-out', requireAdmin, async (req, res) => {
  if (!pgPool) return res.status(503).json({ ok: false, error: 'Lead review requires PostgreSQL.' });
  const leadId = cleanText(req.params.id, 80);
  try {
    await pgPool.query(`update public.outreach_messages set status = case when status in ('draft', 'approved', 'queued') then 'rejected' else status end, error_message = case when status in ('draft', 'approved', 'queued') then 'Lead opted out.' else error_message end, updated_at = now() where lead_id = $1`, [leadId]);
    await pgPool.query(`update public.leads set contact_permission = 'opted_out', opted_out_at = now(), sales_status = 'not_interested', status = 'blocked', updated_at = now() where id = $1`, [leadId]);
    await pgPool.query('insert into public.audit_logs (actor_type, action, entity_type, entity_id, metadata) values ($1,$2,$3,$4,$5)', ['admin', 'lead_opted_out', 'lead', leadId, '{}']);
    return res.json({ ok: true, status: 'opted_out', leadId });
  } catch (error) {
    console.error('admin lead opt-out failed', error);
    return res.status(500).json({ ok: false, error: 'Could not opt out lead.' });
  }
});

app.post('/api/admin/leads/:id/sales-status', requireAdmin, async (req, res) => {
  if (!pgPool) return res.status(503).json({ ok: false, error: 'Lead review requires PostgreSQL.' });
  const leadId = cleanText(req.params.id, 80);
  const salesStatus = cleanText(req.body.salesStatus, 40);
  const allowed = new Set(['not_contacted', 'contacted', 'replied', 'qualified', 'converted', 'not_interested', 'lost', 'blocked']);
  if (!allowed.has(salesStatus)) return res.status(400).json({ ok: false, error: 'Invalid sales status.' });
  try {
    const result = await pgPool.query(`update public.leads set sales_status = $1, status = case when $1 = 'converted' then 'converted' when $1 = 'replied' then 'replied' when $1 = 'blocked' then 'blocked' else status end, updated_at = now() where id = $2 returning id`, [salesStatus, leadId]);
    if (!result.rows[0]) return res.status(404).json({ ok: false, error: 'Lead not found.' });
    await pgPool.query('insert into public.audit_logs (actor_type, action, entity_type, entity_id, metadata) values ($1,$2,$3,$4,$5)', ['admin', 'lead_sales_status_changed', 'lead', leadId, JSON.stringify({ salesStatus })]);
    return res.json({ ok: true, leadId, salesStatus });
  } catch (error) {
    console.error('admin lead sales status failed', error);
    return res.status(500).json({ ok: false, error: 'Could not update sales status.' });
  }
});

app.get('/api/admin/orders', requireAdmin, async (req, res) => {
  if (!pgPool) return res.status(503).json({ ok: false, error: 'Admin order review requires PostgreSQL.' });
  const page = Math.max(1, Number.parseInt(req.query.page || '1', 10) || 1);
  const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit || '25', 10) || 25));
  const offset = (page - 1) * limit;
  const status = cleanText(req.query.status, 40);
  try {
    const result = await pgPool.query(`
      select o.id, o.order_number, o.customer_email, o.customer_name, o.amount_usdt,
             o.network, o.status, o.payment_failed_attempts, o.payment_evidence_requested_at, o.created_at, o.download_expires_at,
             p.slug, i.invoice_number, i.status as invoice_status, i.expires_at,
             latest.txid, latest.status as payment_status, latest.confirmations,
             latest.amount_usdt as payment_amount_usdt, latest.updated_at as payment_updated_at,
             evidence.status as evidence_status, evidence.created_at as evidence_created_at
      from public.orders o
      join public.products p on p.id = o.product_id
      join public.invoices i on i.order_id = o.id
      left join lateral (
        select txid, status, confirmations, amount_usdt, updated_at
        from public.payments where invoice_id = i.id order by created_at desc limit 1
      ) latest on true
      left join lateral (
        select status, created_at
        from public.payment_evidence where order_id = o.id order by created_at desc limit 1
      ) evidence on true
      where ($1 = '' or o.status = $1)
      order by o.created_at desc limit $2 offset $3`, [status, limit, offset]);
    return res.json({ ok: true, page, limit, orders: result.rows });
  } catch (error) {
    console.error('admin orders failed', error);
    return res.status(500).json({ ok: false, error: 'Could not load orders.' });
  }
});

app.get('/api/admin/orders/:id/evidence', requireAdmin, async (req, res) => {
  if (!pgPool) return res.status(503).json({ ok: false, error: 'Evidence review requires PostgreSQL.' });
  const orderId = cleanText(req.params.id, 80);
  try {
    const orderResult = await pgPool.query(`
      select o.id, o.order_number, o.customer_email, o.amount_usdt, o.network,
             o.receiving_address as invoice_receiving_address,
             p.slug,
             e.id as evidence_id, e.txid, e.transfer_text, e.screenshot_data_url,
             e.screenshot_mime_type, e.status as evidence_status, e.reviewed_at,
             e.reviewer_id, e.review_notes, e.created_at as evidence_created_at
      from public.orders o
      join public.products p on p.id = o.product_id
      left join lateral (
        select * from public.payment_evidence where order_id = o.id order by created_at desc limit 1
      ) e on true
      where o.id = $1
      limit 1`, [orderId]);
    const order = orderResult.rows[0];
    if (!order) return res.status(404).json({ ok: false, error: 'Order not found.' });
    return res.json({
      ok: true,
      order: {
        id: order.id,
        orderNumber: order.order_number,
        customerEmail: order.customer_email,
        amountUsdt: Number(order.amount_usdt),
        network: order.network,
        product: order.slug,
        invoiceReceivingAddress: order.invoice_receiving_address,
        configuredReceivingAddress: paymentConfig().receivingAddress,
        runtimeAddressMatchesInvoice: order.invoice_receiving_address === paymentConfig().receivingAddress
      },
      evidence: order.evidence_id ? {
        id: order.evidence_id,
        txid: order.txid,
        transferText: order.transfer_text,
        screenshotDataUrl: order.screenshot_data_url,
        screenshotMimeType: order.screenshot_mime_type,
        status: order.evidence_status,
        reviewedAt: order.reviewed_at,
        reviewerId: order.reviewer_id,
        reviewNotes: order.review_notes,
        createdAt: order.evidence_created_at
      } : null
    });
  } catch (error) {
    console.error('admin evidence load failed', error);
    return res.status(500).json({ ok: false, error: 'Could not load payment evidence.' });
  }
});

app.post('/api/admin/orders/:id/recheck', requireAdmin, async (req, res) => {
  if (!pgPool) return res.status(503).json({ ok: false, error: 'Payment recheck requires PostgreSQL.' });
  const orderId = cleanText(req.params.id, 80);
  let txid = cleanText(req.body.txid, 128);
  try {
    const orderResult = await pgPool.query('select id, order_number from public.orders where id = $1 limit 1', [orderId]);
    if (!orderResult.rows[0]) return res.status(404).json({ ok: false, error: 'Order not found.' });
    if (!txid) {
      const paymentResult = await pgPool.query('select txid from public.payments p join public.invoices i on i.id = p.invoice_id where i.order_id = $1 order by p.created_at desc limit 1', [orderId]);
      txid = paymentResult.rows[0]?.txid || '';
    }
    if (!txid) return res.status(400).json({ ok: false, error: 'A TxID is required for recheck.' });
    await pgPool.query('insert into public.jobs (job_type, dedupe_key, payload, run_after) values ($1,$2,$3,now()) on conflict (dedupe_key) do update set status = \'queued\', run_after = now(), locked_at = null, updated_at = now()', ['payment_check', `payment_check:${orderId}:${txid}`, JSON.stringify({ orderId, txid })]);
    await pgPool.query('insert into public.audit_logs (actor_type, action, entity_type, entity_id, metadata) values ($1,$2,$3,$4,$5)', ['admin', 'payment_recheck_queued', 'order', orderId, JSON.stringify({ txid })]);
    return res.status(202).json({ ok: true, status: 'queued', orderId, txid });
  } catch (error) {
    console.error('admin recheck failed', error);
    return res.status(500).json({ ok: false, error: 'Could not queue payment recheck.' });
  }
});

app.post('/api/admin/orders/:id/approve', requireAdmin, async (req, res) => {
  if (!pgPool) return res.status(503).json({ ok: false, error: 'Manual approval requires PostgreSQL.' });
  const orderId = cleanText(req.params.id, 80);
  const reason = cleanText(req.body.reason, 500);
  if (reason.length < 10) return res.status(400).json({ ok: false, error: 'A detailed approval reason is required.' });
  const client = await pgPool.connect();
  try {
    await client.query('begin');
    const result = await client.query('select o.id, o.status, i.id as invoice_id from public.orders o join public.invoices i on i.order_id = o.id where o.id = $1 for update', [orderId]);
    const order = result.rows[0];
    if (!order) { await client.query('rollback'); return res.status(404).json({ ok: false, error: 'Order not found.' }); }
    if (order.status === 'paid') { await client.query('rollback'); return res.status(409).json({ ok: false, error: 'Order is already paid.' }); }
    const downloadToken = createDownloadToken();
    const downloadTokenHash = hashDownloadToken(downloadToken);
    const downloadExpiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
    await client.query('update public.orders set status = $1, download_token_hash = $2, download_expires_at = $3, updated_at = now() where id = $4', ['paid', downloadTokenHash, downloadExpiresAt, orderId]);
    await client.query('update public.invoices set status = $1, updated_at = now() where id = $2', ['paid', order.invoice_id]);
    await client.query('update public.payment_evidence set status = \'verified\', reviewed_at = now(), reviewer_id = \'admin\', review_notes = $1, updated_at = now() where order_id = $2 and status = \'pending\'', [reason, orderId]);
    await client.query('insert into public.audit_logs (actor_type, action, entity_type, entity_id, metadata) values ($1,$2,$3,$4,$5)', ['admin', 'manual_payment_approval', 'order', orderId, JSON.stringify({ reason, downloadExpiresAt })]);
    await client.query('commit');
    return res.json({ ok: true, status: 'paid', downloadUrl: `/api/download/${encodeURIComponent(downloadToken)}`, downloadExpiresAt });
  } catch (error) {
    await client.query('rollback');
    console.error('admin approval failed', error);
    return res.status(500).json({ ok: false, error: 'Could not approve order.' });
  } finally {
    client.release();
  }
});

app.post('/api/telegram/webhook', rateLimit('telegram-webhook', 120, 60 * 1000), async (req, res) => {
  const expectedSecret = cleanText(process.env.TELEGRAM_WEBHOOK_SECRET, 256);
  const receivedSecret = cleanText(req.headers['x-telegram-bot-api-secret-token'], 256);
  if (expectedSecret && receivedSecret !== expectedSecret) return res.status(401).json({ ok: false, error: 'Invalid webhook secret.' });
  try {
    const message = req.body?.message;
    const chatId = message?.chat?.id;
    const text = cleanText(message?.text, 400);
    if (chatId && telegramBot.configured) {
      if (text === '/start') {
        await telegramBot.sendMessage({ chatId, text: '<b>Client Protection Kit</b>\n\nYou are subscribed to optional order updates. We will only send messages related to your request.' });
      } else if (text === '/help') {
        await telegramBot.sendMessage({ chatId, text: 'Use the store checkout to create an order. Payment verification is handled through the order page.' });
      }
      if (pgPool) await pgPool.query('insert into public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata) values ($1,$2,$3,$4,$5,$6)', ['customer', String(chatId), 'telegram_opt_in_event', 'telegram_chat', String(chatId), JSON.stringify({ command: text.startsWith('/') ? text : null })]);
    }
    return res.json({ ok: true });
  } catch (error) {
    console.error('telegram webhook failed', error);
    return res.status(500).json({ ok: false, error: 'Webhook processing failed.' });
  }
});

app.post('/api/admin/telegram/webhook', requireAdmin, async (req, res) => {
  const publicBaseUrl = cleanText(req.body.publicBaseUrl || process.env.PUBLIC_BASE_URL, 300).replace(/\/$/, '');
  const secretToken = cleanText(process.env.TELEGRAM_WEBHOOK_SECRET, 256);
  if (!telegramBot.configured) return res.status(503).json({ ok: false, error: 'Telegram bot is not configured.' });
  if (!publicBaseUrl || !secretToken) return res.status(400).json({ ok: false, error: 'PUBLIC_BASE_URL and TELEGRAM_WEBHOOK_SECRET are required.' });
  try {
    const result = await telegramBot.setWebhook({ url: `${publicBaseUrl}/api/telegram/webhook`, secretToken });
    return res.json({ ok: true, webhook: result });
  } catch (error) {
    console.error('telegram webhook setup failed', error);
    return res.status(502).json({ ok: false, error: 'Could not configure Telegram webhook.' });
  }
});

app.post('/api/orders', rateLimit('order-create', 10, 60 * 60 * 1000), async (req, res) => {
  const productSlug = cleanText(req.body.productSlug, 120);
  const customerEmail = cleanText(req.body.email, 180).toLowerCase();
  const customerName = cleanText(req.body.name, 120);
  const staticProduct = products.find((item) => item.slug === productSlug);
  if (!staticProduct || !isEmail(customerEmail)) return res.status(400).json({ ok: false, error: 'Choose a valid product and enter a valid email.' });

  const config = paymentConfig();
  if (!config.valid) return res.status(503).json({ ok: false, code: 'PAYMENT_SETUP_REQUIRED', error: 'Solana USDT checkout is temporarily unavailable because its payment configuration is invalid.' });
  if (!hasDatabase()) {
    return res.status(503).json({ ok: false, code: 'DATABASE_REQUIRED', error: 'Checkout is temporarily unavailable.' });
  }

  const orderNumber = `CPK-${Date.now().toString(36).toUpperCase()}`;
  const invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}`;
  const statusToken = createDownloadToken();
  const statusTokenHash = hashDownloadToken(statusToken);
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  let amountUsdt = staticProduct.priceUsdt;
  try {
    if (pgPool) {
      const client = await pgPool.connect();
      try {
        await client.query('begin');
        const productResult = await client.query('select id, slug, price_usdt from public.products where slug = $1 and active = true limit 1', [staticProduct.slug]);
        const dbProduct = productResult.rows[0];
        if (!dbProduct) throw new Error('The selected product is not available.');
        amountUsdt = Number(dbProduct.price_usdt);
        const orderResult = await client.query('insert into public.orders (order_number, product_id, customer_email, customer_name, amount_usdt, network, receiving_address, status, access_token_hash) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id', [orderNumber, dbProduct.id, customerEmail, customerName || null, amountUsdt, config.network, config.receivingAddress, 'awaiting_payment', statusTokenHash]);
        await client.query('insert into public.invoices (order_id, invoice_number, amount_usdt, network, receiving_address, expires_at, status) values ($1,$2,$3,$4,$5,$6,$7)', [orderResult.rows[0].id, invoiceNumber, amountUsdt, config.network, config.receivingAddress, expiresAt, 'open']);
        await client.query('insert into public.audit_logs (actor_type, action, entity_type, entity_id, metadata) values ($1,$2,$3,$4,$5)', ['customer', 'order_created', 'order', orderResult.rows[0].id, JSON.stringify({ orderNumber, product: staticProduct.slug })]);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    } else {
      const dbProduct = await getProductBySlug(staticProduct.slug);
      if (!dbProduct) return res.status(500).json({ ok: false, error: 'The selected product is not available.' });
      amountUsdt = Number(dbProduct.price_usdt);
      const { data: order, error: orderError } = await supabase.from('orders').insert({ order_number: orderNumber, product_id: dbProduct.id, customer_email: customerEmail, customer_name: customerName || null, amount_usdt: amountUsdt, network: config.network, receiving_address: config.receivingAddress, status: 'awaiting_payment', access_token_hash: statusTokenHash }).select('id').single();
      if (orderError) throw orderError;
      const { error: invoiceError } = await supabase.from('invoices').insert({ order_id: order.id, invoice_number: invoiceNumber, amount_usdt: amountUsdt, network: config.network, receiving_address: config.receivingAddress, expires_at: expiresAt, status: 'open' });
      if (invoiceError) throw invoiceError;
    }
    return res.status(201).json({ ok: true, stored: true, order: publicOrder({ orderNumber, invoiceNumber, product: staticProduct.slug, amountUsdt, network: config.network, receivingAddress: config.receivingAddress, expiresAt, status: 'awaiting_payment', invoiceStatus: 'open' }, { statusToken }) });
  } catch (error) {
    console.error('order creation failed', error);
    return res.status(500).json({ ok: false, error: 'The order could not be created.' });
  }
});

const requestBuckets = new Map();
function rateLimit(scope, maxRequests, windowMs) {
  return (req, res, next) => {
    const key = `${scope}:${req.ip || 'unknown'}`;
    const now = Date.now();
    const current = requestBuckets.get(key) || { count: 0, resetAt: now + windowMs };
    if (now >= current.resetAt) { current.count = 0; current.resetAt = now + windowMs; }
    current.count += 1;
    requestBuckets.set(key, current);
    if (requestBuckets.size > 2000) {
      for (const [bucketKey, bucket] of requestBuckets) if (bucket.resetAt <= now) requestBuckets.delete(bucketKey);
    }
    if (current.count > maxRequests) {
      res.set('Retry-After', String(Math.ceil((current.resetAt - now) / 1000)));
      return res.status(429).json({ ok: false, error: 'Too many requests. Please try again later.' });
    }
    return next();
  };
}

app.get('/api/orders/:orderNumber/status', rateLimit('order-status', 30, 15 * 60 * 1000), async (req, res) => {
  const orderNumber = cleanText(req.params.orderNumber, 80);
  const statusToken = cleanText(req.query.token, 128);
  if (!orderNumber || !statusToken || !hasDatabase()) return res.status(404).json({ ok: false, error: 'Order status not found.' });
  try {
    const row = await getOrderByAccessToken(orderNumber, statusToken);
    if (!row) return res.status(404).json({ ok: false, error: 'Order status not found.' });
    const order = normalizeOrder(row);
    if (order.status === 'paid' && pgPool) {
      const downloadToken = createDownloadToken();
      const downloadTokenHash = hashDownloadToken(downloadToken);
      const downloadExpiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
      await pgPool.query('update public.orders set download_token_hash = $1, download_expires_at = $2, updated_at = now() where id = $3 and status = \'paid\'', [downloadTokenHash, downloadExpiresAt, order.id]);
      order.downloadExpiresAt = downloadExpiresAt;
      return res.json({ ok: true, order: publicOrder(order, { downloadToken }) });
    }
    return res.json({ ok: true, order: publicOrder(order) });
  } catch (error) {
    console.error('order status failed', error);
    return res.status(500).json({ ok: false, error: 'Could not load order status.' });
  }
});

app.post('/api/orders/:orderNumber/payment', rateLimit('payment-submit', 12, 15 * 60 * 1000), async (req, res) => {
  const orderNumber = cleanText(req.params.orderNumber, 80);
  const statusToken = cleanText(req.body.statusToken, 128);
  const txid = cleanText(req.body.txid, 128);
  if (!orderNumber || !statusToken || !txid || !hasDatabase()) return res.status(400).json({ ok: false, error: 'Order access token and TxID are required.' });
  try {
    const orderRow = await getOrderByAccessToken(orderNumber, statusToken);
    if (!orderRow) return res.status(404).json({ ok: false, error: 'Order not found.' });
    const order = normalizeOrder(orderRow);
    if (order.status === 'paid') return res.json({ ok: true, status: 'confirmed', message: 'This order is already paid. Use the original download link if you received one.' });
    if (order.status === 'expired' || new Date(order.expiresAt).getTime() <= Date.now()) return res.status(409).json({ ok: false, status: 'expired', error: 'This invoice has expired.' });
    if (!usdtVerifier.configured) return res.status(503).json({ ok: false, status: 'manual_review', reason: 'provider_not_configured', error: 'Payment verification is not enabled yet.' });

    const verification = await usdtVerifier.verify({ txid, invoice: { amountUsdt: order.amountUsdt, network: order.network, receivingAddress: order.receivingAddress } });
    const transaction = verification.transaction || {};
    const resultStatus = verification.status;
    const paymentStatus = resultStatus === 'confirmed' ? 'confirmed' : resultStatus === 'confirming' ? 'confirming' : resultStatus === 'manual_review' ? 'manual_review' : 'rejected';
    let failedAttempts = Number(order.paymentFailedAttempts || 0);

    if (pgPool) {
      const client = await pgPool.connect();
      try {
        await client.query('begin');
        const locked = await client.query('select o.id, o.status, o.payment_failed_attempts, o.payment_evidence_requested_at, i.id as invoice_id from public.orders o join public.invoices i on i.order_id = o.id where o.id = $1 for update', [order.id]);
        const current = locked.rows[0];
        if (!current) throw new Error('Order disappeared during payment verification.');
        if (current.status === 'paid') {
          await client.query('commit');
          return res.json({ ok: true, status: 'confirmed', message: 'This order is already paid.' });
        }
        const existingPayment = await client.query('select id, invoice_id from public.payments where txid = $1 limit 1', [txid]);
        if (existingPayment.rows[0] && existingPayment.rows[0].invoice_id !== current.invoice_id) {
          const attemptResult = await client.query('update public.orders set payment_failed_attempts = payment_failed_attempts + 1, payment_evidence_requested_at = case when payment_failed_attempts + 1 >= 2 then coalesce(payment_evidence_requested_at, now()) else payment_evidence_requested_at end, updated_at = now() where id = $1 returning payment_failed_attempts', [order.id]);
          const duplicateAttempts = Number(attemptResult.rows[0]?.payment_failed_attempts || 0);
          await client.query('insert into public.audit_logs (actor_type, action, entity_type, entity_id, metadata) values ($1,$2,$3,$4,$5)', ['customer', 'payment_failed_attempt', 'order', order.id, JSON.stringify({ reason: 'txid_already_used', attempts: duplicateAttempts })]);
          await client.query('commit');
          return res.status(409).json({ ok: false, status: 'rejected', reason: 'txid_already_used', paymentFailedAttempts: duplicateAttempts, paymentEvidenceRequested: duplicateAttempts >= 2, error: 'This transaction ID has already been submitted.' });
        }
        const paymentValues = [transaction.network || order.network, transaction.tokenContract || '', transaction.fromAddress || null, transaction.toAddress || '', Number(transaction.amountUsdt || 0), Number(transaction.confirmations || 0), paymentStatus, 'solana-rpc', JSON.stringify(transaction.raw || transaction), resultStatus === 'confirmed' ? new Date().toISOString() : null];
        if (existingPayment.rows[0]) {
          await client.query('update public.payments set network = $1, token_contract = $2, from_address = $3, to_address = $4, amount_usdt = $5, confirmations = $6, status = $7, provider = $8, raw_reference = $9, verified_at = $10, updated_at = now() where id = $11', [...paymentValues, existingPayment.rows[0].id]);
        } else {
          await client.query('insert into public.payments (invoice_id, txid, network, token_contract, from_address, to_address, amount_usdt, confirmations, status, provider, raw_reference, verified_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [current.invoice_id, txid, ...paymentValues]);
        }
        if (resultStatus === 'rejected') {
          const attemptResult = await client.query(`
            update public.orders
            set payment_failed_attempts = payment_failed_attempts + 1,
                payment_evidence_requested_at = case when payment_failed_attempts + 1 >= 2 then coalesce(payment_evidence_requested_at, now()) else payment_evidence_requested_at end,
                updated_at = now()
            where id = $1
            returning payment_failed_attempts`, [order.id]);
          failedAttempts = Number(attemptResult.rows[0]?.payment_failed_attempts || failedAttempts + 1);
        }
        if (resultStatus === 'confirmed') {
          const downloadToken = createDownloadToken();
          const downloadTokenHash = hashDownloadToken(downloadToken);
          const downloadExpiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
          await client.query('update public.orders set status = $1, download_token_hash = $2, download_expires_at = $3, updated_at = now() where id = $4', ['paid', downloadTokenHash, downloadExpiresAt, order.id]);
          await client.query('update public.invoices set status = $1, updated_at = now() where id = $2', ['paid', current.invoice_id]);
          await client.query('insert into public.audit_logs (actor_type, action, entity_type, entity_id, metadata) values ($1,$2,$3,$4,$5)', ['integration', 'payment_confirmed', 'order', order.id, JSON.stringify({ txid, provider: 'solana-rpc', confirmations: transaction.confirmations })]);
          await client.query('commit');
          return res.json({ ok: true, status: 'confirmed', order: publicOrder({ ...order, status: 'paid', invoiceStatus: 'paid' }, { downloadToken }) });
        }
        const newOrderStatus = resultStatus === 'confirming' ? 'confirming' : resultStatus === 'manual_review' ? 'manual_review' : 'awaiting_payment';
        const newInvoiceStatus = resultStatus === 'manual_review' ? 'manual_review' : 'open';
        await client.query('update public.orders set status = $1, updated_at = now() where id = $2', [newOrderStatus, order.id]);
        await client.query('update public.invoices set status = $1, updated_at = now() where id = $2', [newInvoiceStatus, current.invoice_id]);
        if (resultStatus === 'confirming') await enqueueJob(client, 'payment_check', `payment_check:${order.id}:${txid}`, { orderId: order.id, txid });
        await client.query('insert into public.audit_logs (actor_type, action, entity_type, entity_id, metadata) values ($1,$2,$3,$4,$5)', ['integration', `payment_${paymentStatus}`, 'order', order.id, JSON.stringify({ txid, provider: 'solana-rpc', confirmations: transaction.confirmations || 0, reason: verification.reason || null, failedAttempts })]);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        if (error?.code === '23505') return res.status(409).json({ ok: false, status: 'rejected', reason: 'txid_already_used', error: 'This transaction ID has already been submitted.' });
        throw error;
      } finally {
        client.release();
      }
    }
    const evidenceReady = resultStatus === 'rejected' && failedAttempts >= 2;
    const message = resultStatus === 'confirming' ? 'Payment found. We are waiting for more confirmations.' : resultStatus === 'manual_review' ? 'Payment needs manual review.' : evidenceReady ? 'We could not match this TxID twice. On your next step, you can submit the transfer details or a screenshot for manual review.' : 'The transaction does not match this invoice.';
    return res.status(resultStatus === 'confirming' ? 202 : resultStatus === 'manual_review' ? 202 : 422).json({ ok: resultStatus === 'confirming', status: resultStatus, reason: verification.reason, message, paymentFailedAttempts: failedAttempts, paymentEvidenceRequested: evidenceReady, transaction: { confirmations: transaction.confirmations || 0 } });
  } catch (error) {
    const mapped = txidError(error);
    if (mapped) {
      let attempt = null;
      if (mapped.body.reason === 'transaction_not_found' || mapped.body.reason === 'invalid_txid') {
        try { attempt = await recordFailedPaymentAttempt(orderNumber, statusToken, mapped.body.reason); } catch (attemptError) { console.error('failed payment attempt record failed', attemptError); }
      }
      const failedAttempts = Number(attempt?.payment_failed_attempts || 0);
      const evidenceReady = failedAttempts >= 2;
      return res.status(mapped.status).json({ ...mapped.body, paymentFailedAttempts: failedAttempts, paymentEvidenceRequested: evidenceReady, message: evidenceReady ? 'We could not match this TxID twice. On your next step, you can submit the transfer details or a screenshot for manual review.' : mapped.body.error });
    }
    console.error('payment verification failed', error);
    return res.status(500).json({ ok: false, status: 'manual_review', error: 'Payment verification is temporarily unavailable.' });
  }
});

app.post('/api/orders/:orderNumber/payment-evidence', rateLimit('payment-evidence', 3, 15 * 60 * 1000), async (req, res) => {
  const orderNumber = cleanText(req.params.orderNumber, 80);
  const statusToken = cleanText(req.body.statusToken, 128);
  const txid = cleanText(req.body.txid, 128);
  const transferText = cleanText(req.body.transferText, 3000);
  const screenshot = typeof req.body.screenshotDataUrl === 'string' ? req.body.screenshotDataUrl.trim() : '';
  if (!orderNumber || !statusToken || !hasDatabase()) return res.status(400).json({ ok: false, error: 'Order access token is required.' });
  if (!txid && !transferText && !screenshot) return res.status(400).json({ ok: false, error: 'Provide a TxID, transfer details, or a screenshot.' });
  if (screenshot && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/.test(screenshot) || screenshot.length > 220000)) {
    return res.status(400).json({ ok: false, error: 'Use a PNG, JPEG, or WebP screenshot smaller than 160 KB.' });
  }
  try {
    const orderRow = await getOrderByAccessToken(orderNumber, statusToken);
    if (!orderRow) return res.status(404).json({ ok: false, error: 'Order not found.' });
    const order = normalizeOrder(orderRow);
    if (order.status === 'paid') return res.status(409).json({ ok: false, status: 'confirmed', error: 'This order is already paid.' });
    if (order.status === 'expired' || new Date(order.expiresAt).getTime() <= Date.now()) return res.status(409).json({ ok: false, status: 'expired', error: 'This invoice has expired.' });
    if (order.paymentFailedAttempts < 2) return res.status(409).json({ ok: false, status: 'awaiting_payment', error: 'Manual evidence becomes available after two failed TxID checks.' });
    if (!pgPool) return res.status(503).json({ ok: false, status: 'manual_review', error: 'Manual evidence review requires PostgreSQL.' });
    const screenshotMimeType = screenshot.match(/^data:(image\/(?:png|jpeg|webp));base64,/)?.[1] || null;
    const result = await pgPool.query(`
      insert into public.payment_evidence (order_id, invoice_id, txid, transfer_text, screenshot_data_url, screenshot_mime_type)
      select o.id, i.id, $1, $2, $3, $4
      from public.orders o join public.invoices i on i.order_id = o.id
      where o.id = $5
      returning id, created_at`, [txid || null, transferText || null, screenshot || null, screenshotMimeType, order.id]);
    await pgPool.query('update public.orders set status = \'manual_review\', payment_evidence_requested_at = coalesce(payment_evidence_requested_at, now()), updated_at = now() where id = $1 and status <> \'paid\'', [order.id]);
    await pgPool.query('insert into public.audit_logs (actor_type, action, entity_type, entity_id, metadata) values ($1,$2,$3,$4,$5)', ['customer', 'payment_evidence_submitted', 'order', order.id, JSON.stringify({ evidenceId: result.rows[0]?.id, hasTxid: Boolean(txid), hasTransferText: Boolean(transferText), hasScreenshot: Boolean(screenshot), runtimeAddressMatchesInvoice: order.receivingAddress === paymentConfig().receivingAddress })]);
    return res.status(202).json({ ok: true, status: 'manual_review', message: 'Your payment evidence was received. We will verify the transaction and release the kit if the blockchain details match the invoice.' });
  } catch (error) {
    console.error('payment evidence submission failed', error);
    return res.status(500).json({ ok: false, status: 'manual_review', error: 'Could not submit payment evidence.' });
  }
});

app.get('/api/download/:token', async (req, res) => {
  const token = cleanText(req.params.token, 128);
  if (!token || !hasDatabase()) return res.status(404).json({ ok: false, error: 'Download not available.' });
  const tokenHash = hashDownloadToken(token);
  try {
    let order;
    if (pgPool) {
      const result = await pgPool.query('select o.order_number, o.download_expires_at, p.slug from public.orders o join public.products p on p.id = o.product_id where o.download_token_hash = $1 and o.status = $2 limit 1', [tokenHash, 'paid']);
      order = result.rows[0];
    } else {
      const { data, error } = await supabase.from('orders').select('order_number,download_expires_at,product_id,status').eq('download_token_hash', tokenHash).eq('status', 'paid').limit(1).maybeSingle();
      if (error) throw error;
      if (data) {
        const { data: product, error: productError } = await supabase.from('products').select('slug').eq('id', data.product_id).limit(1).maybeSingle();
        if (productError) throw productError;
        order = { ...data, slug: product?.slug };
      }
    }
    if (!order || !productBundles[order.slug]) return res.status(404).json({ ok: false, error: 'Download not found or not yet authorized.' });
    if (isTokenExpired(order.download_expires_at)) return res.status(410).json({ ok: false, error: 'This download link has expired.' });
    const bundle = productBundles[order.slug];
    const filePath = path.join(__dirname, 'product-assets', 'bundles', bundle.file);
    return res.download(filePath, bundle.downloadName);
  } catch (error) {
    console.error('download failed', error);
    return res.status(500).json({ ok: false, error: 'The download could not be completed.' });
  }
});

app.post('/api/intake', rateLimit('intake-submit', 6, 60 * 60 * 1000), async (req, res) => {
  const fullName = cleanText(req.body.fullName, 120);
  const email = cleanText(req.body.email, 180).toLowerCase();
  const company = cleanText(req.body.company, 160);
  const businessType = cleanText(req.body.businessType, 120);
  const currentSituation = cleanText(req.body.currentSituation, 2500);
  const desiredOutcome = cleanText(req.body.desiredOutcome, 1500);
  const budget = cleanText(req.body.budget, 80);
  const contactMethod = cleanText(req.body.contactMethod, 80);
  const consent = req.body.consent === true || req.body.consent === 'true';
  if (!fullName || !isEmail(email) || !company || !businessType || !currentSituation || !desiredOutcome || !budget || !contactMethod || !consent) return res.status(400).json({ ok: false, error: 'Please complete the required fields and consent.' });
  const submission = { full_name: fullName, email, company, business_type: businessType, current_situation: currentSituation, desired_outcome: desiredOutcome, budget, contact_method: contactMethod, source: cleanText(req.body.source, 120) || 'website', status: 'new' };
  if (!hasDatabase()) return res.status(503).json({ ok: false, error: 'The sample form is temporarily unavailable.' });
  try {
    let submissionId = null;
    if (pgPool) {
      const result = await pgPool.query('insert into public.intake_submissions (full_name, email, company, business_type, current_situation, desired_outcome, budget, contact_method, source, status) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id', [submission.full_name, submission.email, submission.company, submission.business_type, submission.current_situation, submission.desired_outcome, submission.budget, submission.contact_method, submission.source, submission.status]);
      submissionId = result.rows[0]?.id || null;
    } else {
      const { data, error } = await supabase.from('intake_submissions').insert(submission).select('id').single();
      if (error) throw error;
      submissionId = data?.id || null;
    }
    let emailStatus = 'not_configured';
    const wantsEmail = contactMethod.toLowerCase() === 'email';
    const allowedInCurrentMode = !resendProvider.testMode || email === resendProvider.testTo;
    if (wantsEmail && resendProvider.configured && allowedInCurrentMode) {
      try {
        await resendProvider.sendSampleEmail({ to: submission.email, fullName: submission.full_name, issue: submission.business_type, previewUrl: `${publicBaseUrl()}/preview`, idempotencyKey: submissionId ? `sample-${submissionId}` : '' });
        emailStatus = 'sent';
      } catch (error) {
        emailStatus = 'failed';
        console.error('sample email failed', String(error.message).slice(0, 500));
      }
    } else if (!wantsEmail) {
      emailStatus = 'skipped_contact_method';
    } else if (resendProvider.configured && resendProvider.testMode) {
      emailStatus = 'skipped_test_recipient';
    }
    return res.status(201).json({ ok: true, stored: true, emailStatus, message: emailStatus === 'sent' ? 'Submission received and preview email sent.' : 'Submission received. Preview email is pending.' });
  } catch (error) {
    console.error('intake insert failed', error);
    return res.status(500).json({ ok: false, error: 'The submission could not be stored.' });
  }
});

const handleCronTrigger = async (req, res) => {
  if (!cronAuthorized(req)) return res.status(401).json({ ok: false, error: 'Unauthorized cron trigger.' });
  if (cronRunning) return res.status(409).json({ ok: false, status: 'already_running' });
  cronRunning = true;
  res.status(202).json({ ok: true, status: 'started', message: 'Cron cycle started. Check service logs for its summary.' });
  try {
    const result = await runCronChild();
    console.log(JSON.stringify({ worker: 'cron-trigger', exitCode: result.code, stdout: result.stdout, stderr: result.stderr }));
  } finally {
    cronRunning = false;
  }
};

app.post('/api/internal/cron/run', handleCronTrigger);
app.get('/api/internal/cron/run', handleCronTrigger);

app.use((_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(port, '0.0.0.0', () => console.log(`Server listening on port ${port}`));
