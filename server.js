import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { createClient } from '@supabase/supabase-js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number(process.env.PORT || 10000);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } })
  : null;

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
    telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    geminiKeyCount: Number(process.env.GEMINI_API_KEY_COUNT || 0)
  });
});

app.get('/api/products', (_req, res) => {
  res.json({ products });
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
