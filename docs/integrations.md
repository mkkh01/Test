# Deployment and Integration Notes

## Render

The first deployment target is a Render Web Service. It runs the Express server with:

```text
Build command: npm ci
Start command: npm start
Health check: /api/health
```

The `render.yaml` file defines the public Supabase URL and marks secret variables as values to be entered in Render's environment settings. Never commit a service-role key, Telegram token, Gemini key, or wallet private key.

The web service now handles order creation, customer-scoped status tokens, TxID submission, and synchronous TronGrid verification. Jobs that remain in `confirming` are stored in the PostgreSQL queue. Run `npm run worker:cron` as a Render Cron Job for periodic recovery, or `npm run worker:run` as a Render Background Worker for continuous queue processing. Render does not offer Free instances for Background Workers or Cron Jobs, so enable one only after choosing a paid instance and understanding its cost. The repository contains `docs/render-workers.md` with the exact settings.

## Supabase

Confirmed project:

```text
Name: memo2026186@gmail.com's Project
Project ref: attihpianzukswsfjoab
URL: https://attihpianzukswsfjoab.supabase.co
Region: eu-central-1
```

The migrations are:

```text
supabase/migrations/001_initial_schema.sql
supabase/migrations/002_payment_access_tokens.sql
```

Private business tables use explicit grants and Row Level Security. The server uses `DATABASE_URL` (the Supabase PostgreSQL Pooler URL) as the primary data path. `SUPABASE_SERVICE_ROLE_KEY` is retained only as a compatibility fallback. The browser does not receive either secret and does not query private tables directly. The password placeholder must be replaced only inside a secret environment variable; it must never be committed to GitHub.

## Deferred secrets

The following are intentionally not committed:

- `DATABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_ACCESS_TOKEN`
- `TELEGRAM_BOT_TOKEN`
- `GEMINI_API_KEY_1` through `GEMINI_API_KEY_5`
- `USDT_RECEIVING_ADDRESS`
- `USDT_TOKEN_CONTRACT`
- `USDT_TOKEN_DECIMALS`
- `USDT_MIN_CONFIRMATIONS`
- `TRONGRID_BASE_URL`
- `TRONGRID_API_KEY`
- `TELEGRAM_WEBHOOK_SECRET`
- `PUBLIC_BASE_URL`

The wallet address is public operational configuration; the private key and seed phrase are never needed by the application. `TRONGRID_API_KEY` is a read-side API credential and must remain in Render only. The current production contract uses the official TRC20 USDT contract and three confirmations, but payment acceptance still requires the provider key and the deployed provider code.

## Sources

- Render service types: https://render.com/docs/service-types
- Render environment variables: https://render.com/docs/configure-environment-variables
- Supabase REST API: https://supabase.com/docs/guides/api
- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
