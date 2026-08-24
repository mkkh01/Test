# Client Payment & Scope Protection Platform

A small, English-first digital product storefront for the **Client Payment & Scope Protection Kit**. The platform is designed to sell reusable templates, capture qualified project-intake requests, deliver digital files after payment verification, and later add automated lead discovery through approved public sources.

## Current foundation

- Express web server suitable for Render.
- English storefront with Starter, Complete, and Agency product tiers.
- Responsive landing page, pricing cards, free-sample intake form, checkout form, admin summary page, and health endpoint.
- Supabase PostgreSQL schema for products, orders, invoices, payments, leads, source items, analyses, outreach messages, jobs, and audit logs.
- Private-by-default database permissions with Row Level Security and server-side service-role access only.
- Solana JSON-RPC USDT-SPL verification provider, protected customer status token, transaction-signature submission, atomic payment state transitions, secure download release, and admin payment review endpoints.
- Gemini, Telegram, and USDT integration modules remain server-side; no real credentials are committed to the repository.
- Public-source discovery adapters for Hacker News, Bluesky, and RSS are present, with queue-backed lead analysis and Render worker/Cron entrypoints.

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
- `DATABASE_URL` (Supabase PostgreSQL Pooler; primary server-side data path)
- `DB_POOL_MAX`
- `SUPABASE_SERVICE_ROLE_KEY` (compatibility fallback)
- `TELEGRAM_BOT_TOKEN`
- `GEMINI_API_KEY_1` through `GEMINI_API_KEY_5`
- `USDT_NETWORK` (set to `SOLANA_SPL`)
- `USDT_RECEIVING_ADDRESS` (the Solana wallet address)
- `SOLANA_USDT_MINT` (the official Solana USDT mint)
- `USDT_TOKEN_CONTRACT` (compatibility alias for the mint)
- `USDT_TOKEN_DECIMALS` (6)
- `USDT_MIN_CONFIRMATIONS` (1 after finalized commitment)
- `SOLANA_RPC_URL`
- `SOLANA_COMMITMENT` (confirmed or finalized)
- `TELEGRAM_WEBHOOK_SECRET`
- `PUBLIC_BASE_URL`

The five Gemini keys are for reliability and controlled rotation, not for bypassing provider quotas or terms. The application will record key health, apply per-key limits, and stop or fall back to deterministic rules when no key is available.

## Admin summary

Open `/admin.html` only from a trusted device after setting `ADMIN_ACCESS_TOKEN` in the server environment. The page shows aggregate counts and sends the token in an HTTP header; it does not persist the token in browser storage. The admin route does not expose customer rows or secrets.

## Payment flow

The customer creates an order and receives a customer-scoped status token. The storefront shows the exact USDT amount, Solana network, receiving address, and expiry. The customer submits a Solana transaction signature through the status-token endpoint. The server reads the transaction through Solana JSON-RPC, checks successful finalized execution, the USDT SPL mint, destination token-account owner, token balance delta, amount, expiry, and signature uniqueness. Only a confirmed result changes the order and invoice to `paid`, creates a short-lived download token, and releases the matching ZIP bundle. A confirming result is queued for later recheck; provider rate limits or ambiguous results go to manual review.

## Integration modules

- `src/integrations/gemini-router.js` rotates up to five configured Gemini API keys with local failure backoff and no key values in code.
- `src/integrations/telegram-bot.js` provides webhook and message helpers while remaining disabled without `TELEGRAM_BOT_TOKEN`.
- `src/integrations/usdt-verifier.js` validates invoice data and transaction results through the Solana provider; it never handles a private key.
- `src/integrations/solana-rpc-provider.js` reads finalized Solana transactions and SPL token balance changes through JSON-RPC; it requires no signing key.
- `src/discovery/public-sources.js` includes public Hacker News, Bluesky, and RSS candidate collectors with keyword filtering, deduplication, and a deterministic fit score.
- `src/workers/discovery-worker.js` collects candidates and queues lead-analysis jobs in Supabase; it runs in dry-run mode when Supabase server credentials are absent.

Real production credentials remain in Render only. The provider and webhook code are tested with injected adapters locally; live payment acceptance should be tested first with a small controlled transaction.

## Database

The initial migration is at:

```text
supabase/migrations/001_initial_schema.sql
```

It has been applied to the confirmed Supabase project. The server is configured to use `DATABASE_URL` and the Supabase PostgreSQL Pooler as its primary data path. `SUPABASE_SERVICE_ROLE_KEY` remains a compatibility fallback for environments where the direct database URL is not configured. Client-facing database access is not enabled for private business tables.

## Product flow

```text
Storefront → free sample / intake → order → USDT-SPL invoice → Solana verification → secure download
```

The payment module verifies a successful transaction, correct network, correct token contract, destination address, amount, confirmations, invoice expiry, and TxID uniqueness. It never receives or stores a wallet private key. The Render web service handles customer requests; `npm run worker:cron` is the one-shot queue processor for a Render Cron Job, and `npm run worker:run` is the continuous worker command for a paid Render Background Worker.

## Lead discovery flow

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

The test suite covers candidate scoring, deduplication, RSS parsing, unsupported payment networks, Solana SPL transfer normalization, finalized-payment rules, and the rule that a signature alone never counts as a confirmed payment.

The repository contains the production payment workflow and tested provider adapter. Real credentials remain controlled Render settings. Telegram outbound messages are limited to opted-in bot users, and public-source outreach remains draft-only until a human approves it.
