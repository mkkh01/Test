# Client Payment & Scope Protection Platform

A small, English-first digital product storefront for the **Client Payment & Scope Protection Kit**. The platform is designed to sell reusable templates, capture qualified project-intake requests, deliver digital files after payment verification, and later add automated lead discovery through approved public sources.

## Current foundation

- Express web server suitable for Render.
- English storefront with Starter, Complete, and Agency product tiers.
- Responsive landing page, pricing cards, free-sample intake form, checkout form, admin summary page, and health endpoint.
- Supabase schema for products, orders, invoices, payments, leads, source items, analyses, outreach messages, jobs, and audit logs.
- Private-by-default database permissions with Row Level Security and server-side service-role access only.
- Gemini, Telegram, and USDT integration modules are present as secret-free adapters; no real credentials are committed to the repository.
- Public-source discovery adapters for Hacker News, Bluesky, and RSS are present, with a Supabase-backed discovery worker ready for later Render worker scheduling.

## Local development

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:10000`.

Without Supabase environment variables, the intake endpoint runs in demo mode and does not persist submissions. With `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, it stores submissions in the private `intake_submissions` table.

## Render deployment

The repository includes `render.yaml` for the first web service. Configure the secret environment variables in the Render dashboard; never place real values in this repository.

Required later integrations:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TELEGRAM_BOT_TOKEN`
- `GEMINI_API_KEY_1` through `GEMINI_API_KEY_5`
- `USDT_NETWORK`
- `USDT_RECEIVING_ADDRESS`

The five Gemini keys are for reliability and controlled rotation, not for bypassing provider quotas or terms. The application will record key health, apply per-key limits, and stop or fall back to deterministic rules when no key is available.

## Admin summary

Open `/admin.html` only from a trusted device after setting `ADMIN_ACCESS_TOKEN` in the server environment. The page shows aggregate counts and sends the token in an HTTP header; it does not persist the token in browser storage. The admin route does not expose customer rows or secrets.

## Integration modules

- `src/integrations/gemini-router.js` rotates up to five configured Gemini API keys with local failure backoff and no key values in code.
- `src/integrations/telegram-bot.js` provides webhook and message helpers while remaining disabled without `TELEGRAM_BOT_TOKEN`.
- `src/integrations/usdt-verifier.js` validates invoice data and transaction results through a provider adapter; it never handles a private key.
- `src/discovery/public-sources.js` includes public Hacker News, Bluesky, and RSS candidate collectors with keyword filtering, deduplication, and a deterministic fit score.
- `src/workers/discovery-worker.js` collects candidates and queues lead-analysis jobs in Supabase; it runs in dry-run mode when Supabase server credentials are absent.

These modules are intentionally not connected to real accounts yet. They can be tested with injected adapters before production credentials are added.

## Database

The initial migration is at:

```text
supabase/migrations/001_initial_schema.sql
```

It has been applied to the confirmed Supabase project. The server uses the service role only on the backend. Client-facing database access is not enabled for private business tables.

## Product flow

```text
Storefront → free sample / intake → order → USDT invoice → blockchain verification → secure download
```

The payment module will verify a successful transaction, correct network, correct token contract, destination address, amount, confirmations, and TxID uniqueness. It will never receive or store a wallet private key.

## Lead discovery flow (later)

```text
Approved public sources → deduplicate → keyword/rule filter → Gemini analysis → lead score → message draft → policy checks → approved channel
```

The discovery worker will not scrape private data, bypass CAPTCHAs, create fake accounts, or send uncontrolled bulk messages. Source connectors will be enabled only after confirming their official capabilities and terms.

## Quality and security principles

- Templates and product content are static and do not require Gemini at purchase time.
- Gemini is an analysis and drafting assistant, not a payment authority.
- Payment state changes are deterministic and auditable.
- Secrets remain in Render environment variables or another server-side secret store.
- Wallet private keys and seed phrases are never required.
- Private Supabase tables are protected with explicit grants and RLS.
- Sensitive actions use audit logs and manual-review states.

## Validation

```bash
npm run check
npm test
```

The test suite covers candidate scoring, deduplication, RSS parsing, unsupported payment networks, and the rule that a TxID alone never counts as a confirmed payment.

The repository now contains the foundation and tested secret-free adapters. Real Telegram credentials, Gemini keys, wallet settings, source schedules, file storage, authentication, and production download links remain controlled integration steps.
