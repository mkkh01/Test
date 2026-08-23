import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GeminiRouter } from './src/integrations/gemini-router.js';
import { TelegramBot } from './src/integrations/telegram-bot.js';
import { UsdtVerifier } from './src/integrations/usdt-verifier.js';
import { requireAdmin } from './src/auth/admin-auth.js';
import { hashDownloadToken, isTokenExpired } from './src/delivery/download-token.js';
import { productBundles } from './src/delivery/product-manifest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number(process.env.PORT || 10000);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } })
  : null;
const databaseUrl = process.env.DATABASE_URL?.trim();
const pgPool = databaseUrl
  ? new pg.Pool({ connectionString: databaseUrl, max: Number(process.env.DB_POOL_MAX || 5), idleTimeoutMillis: 30_000, connectionTimeoutMillis: 8_000, ssl: databaseUrl.includes('supabase.com') ? { rejectUnauthorized: false } : undefined })
  : null;
const geminiRouter = new GeminiRouter();
const telegramBot = new TelegramBot();
const usdtVerifier = new UsdtVerifier({ provider: null });

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true, limit: '256kb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.static(path.join(__dirname, 'public')));

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
    priceUsdt: 3,
    tier: 'Starter',
    includes: ['Proposal template', 'Scope of Work template', 'Deposit request email', 'Five payment follow-up emails']
  },
  {
    slug: 'client-payment-scope-protection-agency',
    name: 'Client Payment & Scope Protection Kit — Agency',
    tagline: 'A structured client workflow for small agencies and teams.',
    priceUsdt: 12,
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
  return null;
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'client-payment-scope-protection-platform',
    environment: process.env.NODE_ENV || 'development',
    supabaseConfigured: Boolean(supabase),
    postgresConfigured: Boolean(pgPool),
    dataStore: pgPool ? 'postgres' : supabase ? 'supabase-rest' : 'demo',
    telegramConfigured: telegramBot.configured,
    geminiKeyCount: geminiRouter.keys.length,
    usdtConfigured: usdtVerifier.configured
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
  if (!pgPool && !supabase) return res.status(503).json({ ok: false, error: 'Database is not configured.' });
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
    return res.json({ ok: true, counts, generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error('admin summary failed', error);
    return res.status(500).json({ ok: false, error: 'Could not load admin summary.' });
  }
});

app.post('/api/orders', async (req, res) => {
  const productSlug = cleanText(req.body.productSlug, 120);
  const customerEmail = cleanText(req.body.email, 180).toLowerCase();
  const customerName = cleanText(req.body.name, 120);
  const staticProduct = products.find((item) => item.slug === productSlug);

  if (!staticProduct || !isEmail(customerEmail)) {
    return res.status(400).json({ ok: false, error: 'Choose a valid product and enter a valid email.' });
  }

  const network = cleanText(process.env.USDT_NETWORK, 30) || 'TRC20';
  const receivingAddress = cleanText(process.env.USDT_RECEIVING_ADDRESS, 128);
  if (!receivingAddress) {
    return res.status(503).json({ ok: false, code: 'PAYMENT_SETUP_REQUIRED', error: 'USDT checkout is not configured yet.' });
  }

  const orderNumber = `CPK-${Date.now().toString(36).toUpperCase()}`;
  const invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}`;
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const amountUsdt = staticProduct.priceUsdt;

  if (!pgPool && !supabase) {
    return res.status(202).json({ ok: true, stored: false, order: { orderNumber, invoiceNumber, product: staticProduct.slug, amountUsdt, network, receivingAddress, expiresAt, status: 'awaiting_payment' } });
  }

  try {
    if (pgPool) {
      const client = await pgPool.connect();
      try {
        await client.query('begin');
        const productResult = await client.query('select id, slug, price_usdt from public.products where slug = $1 and active = true limit 1', [staticProduct.slug]);
        const dbProduct = productResult.rows[0];
        if (!dbProduct) throw new Error('The selected product is not available.');
        const orderResult = await client.query('insert into public.orders (order_number, product_id, customer_email, customer_name, amount_usdt, network, receiving_address, status) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id', [orderNumber, dbProduct.id, customerEmail, customerName || null, amountUsdt, network, receivingAddress, 'awaiting_payment']);
        await client.query('insert into public.invoices (order_id, invoice_number, amount_usdt, network, receiving_address, expires_at, status) values ($1,$2,$3,$4,$5,$6,$7)', [orderResult.rows[0].id, invoiceNumber, amountUsdt, network, receivingAddress, expiresAt, 'open']);
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
      const { data: order, error: orderError } = await supabase.from('orders').insert({ order_number: orderNumber, product_id: dbProduct.id, customer_email: customerEmail, customer_name: customerName || null, amount_usdt: amountUsdt, network, receiving_address: receivingAddress, status: 'awaiting_payment' }).select('id').single();
      if (orderError) throw orderError;
      const { error: invoiceError } = await supabase.from('invoices').insert({ order_id: order.id, invoice_number: invoiceNumber, amount_usdt: amountUsdt, network, receiving_address: receivingAddress, expires_at: expiresAt, status: 'open' });
      if (invoiceError) throw invoiceError;
    }
    return res.status(201).json({ ok: true, stored: true, order: { orderNumber, invoiceNumber, product: staticProduct.slug, amountUsdt, network, receivingAddress, expiresAt, status: 'awaiting_payment' } });
  } catch (error) {
    console.error('order creation failed', error);
    return res.status(500).json({ ok: false, error: 'The order could not be created.' });
  }
});

app.get('/api/download/:token', async (req, res) => {
  const token = cleanText(req.params.token, 128);
  if (!token || (!pgPool && !supabase)) return res.status(404).json({ ok: false, error: 'Download not available.' });
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

app.post('/api/intake', async (req, res) => {
  const fullName = cleanText(req.body.fullName, 120);
  const email = cleanText(req.body.email, 180).toLowerCase();
  const company = cleanText(req.body.company, 160);
  const businessType = cleanText(req.body.businessType, 120);
  const currentSituation = cleanText(req.body.currentSituation, 2500);
  const desiredOutcome = cleanText(req.body.desiredOutcome, 1500);
  const budget = cleanText(req.body.budget, 80);
  const contactMethod = cleanText(req.body.contactMethod, 80);
  const consent = req.body.consent === true || req.body.consent === 'true';

  if (!fullName || !isEmail(email) || !company || !businessType || !currentSituation || !desiredOutcome || !budget || !contactMethod || !consent) {
    return res.status(400).json({ ok: false, error: 'Please complete the required fields and consent.' });
  }

  const submission = {
    full_name: fullName,
    email,
    company,
    business_type: businessType,
    current_situation: currentSituation,
    desired_outcome: desiredOutcome,
    budget,
    contact_method: contactMethod,
    source: cleanText(req.body.source, 120) || 'website',
    status: 'new'
  };

  if (!pgPool && !supabase) {
    return res.status(202).json({ ok: true, stored: false, message: 'Submission accepted in demo mode.' });
  }

  try {
    if (pgPool) {
      await pgPool.query('insert into public.intake_submissions (full_name, email, company, business_type, current_situation, desired_outcome, budget, contact_method, source, status) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [submission.full_name, submission.email, submission.company, submission.business_type, submission.current_situation, submission.desired_outcome, submission.budget, submission.contact_method, submission.source, submission.status]);
    } else {
      const { error } = await supabase.from('intake_submissions').insert(submission);
      if (error) throw error;
    }
    return res.status(201).json({ ok: true, stored: true, message: 'Submission received.' });
  } catch (error) {
    console.error('intake insert failed', error);
    return res.status(500).json({ ok: false, error: 'The submission could not be stored.' });
  }
});

app.use((_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server listening on port ${port}`);
});
