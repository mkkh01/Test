import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { createClient } from '@supabase/supabase-js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GeminiRouter } from './src/integrations/gemini-router.js';
import { TelegramBot } from './src/integrations/telegram-bot.js';
import { UsdtVerifier } from './src/integrations/usdt-verifier.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number(process.env.PORT || 10000);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } })
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

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'client-payment-scope-protection-platform',
    environment: process.env.NODE_ENV || 'development',
    supabaseConfigured: Boolean(supabase),
    telegramConfigured: telegramBot.configured,
    geminiKeyCount: geminiRouter.keys.length,
    usdtConfigured: usdtVerifier.configured
  });
});

app.get('/api/products', (_req, res) => {
  res.json({ products });
});

app.post('/api/orders', async (req, res) => {
  const productSlug = cleanText(req.body.productSlug, 120);
  const customerEmail = cleanText(req.body.email, 180).toLowerCase();
  const customerName = cleanText(req.body.name, 120);
  const product = products.find((item) => item.slug === productSlug);

  if (!product || !isEmail(customerEmail)) {
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

  if (!supabase) {
    return res.status(202).json({
      ok: true,
      stored: false,
      order: { orderNumber, invoiceNumber, product: product.slug, amountUsdt: product.priceUsdt, network, receivingAddress, expiresAt, status: 'awaiting_payment' }
    });
  }

  const { data: dbProduct, error: productError } = await supabase
    .from('products')
    .select('id,slug,price_usdt')
    .eq('slug', product.slug)
    .limit(1)
    .maybeSingle();

  if (productError || !dbProduct) {
    console.error('product lookup failed', productError);
    return res.status(500).json({ ok: false, error: 'The selected product is not available.' });
  }

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({ order_number: orderNumber, product_id: dbProduct.id, customer_email: customerEmail, customer_name: customerName || null, amount_usdt: product.priceUsdt, network, receiving_address: receivingAddress, status: 'awaiting_payment' })
    .select('id,order_number,amount_usdt,network,receiving_address,status')
    .single();

  if (orderError) {
    console.error('order insert failed', orderError);
    return res.status(500).json({ ok: false, error: 'The order could not be created.' });
  }

  const { error: invoiceError } = await supabase
    .from('invoices')
    .insert({ order_id: order.id, invoice_number: invoiceNumber, amount_usdt: product.priceUsdt, network, receiving_address: receivingAddress, expires_at: expiresAt, status: 'open' });

  if (invoiceError) {
    console.error('invoice insert failed', invoiceError);
    return res.status(500).json({ ok: false, error: 'The invoice could not be created.' });
  }

  return res.status(201).json({ ok: true, stored: true, order: { orderNumber, invoiceNumber, product: product.slug, amountUsdt: product.priceUsdt, network, receivingAddress, expiresAt, status: 'awaiting_payment' } });
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

  if (!supabase) {
    return res.status(202).json({ ok: true, stored: false, message: 'Submission accepted in demo mode.' });
  }

  const { error } = await supabase.from('intake_submissions').insert(submission);
  if (error) {
    console.error('intake insert failed', error);
    return res.status(500).json({ ok: false, error: 'The submission could not be stored.' });
  }

  return res.status(201).json({ ok: true, stored: true, message: 'Submission received.' });
});

app.use((_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server listening on port ${port}`);
});
