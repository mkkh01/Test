# Deployment and Integration Notes

## Render

The first deployment target is a Render Web Service. It runs the Express server with:

```text
Build command: npm ci
Start command: npm start
Health check: /api/health
```

The `render.yaml` file defines the public Supabase URL and marks secret variables as values to be entered in Render's environment settings. Never commit a service-role key, Telegram token, Gemini key, or wallet private key.

If continuous lead processing is enabled later, add a Background Worker for queue work and a Cron Job for periodic source and payment checks. Keep the first deployment as a Web Service until the basic storefront and intake flow are stable.

## Supabase

Confirmed project:

```text
Name: memo2026186@gmail.com's Project
Project ref: attihpianzukswsfjoab
URL: https://attihpianzukswsfjoab.supabase.co
Region: eu-central-1
```

The first migration is:

```text
supabase/migrations/001_initial_schema.sql
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

The wallet address can be added later after selecting one network. The private key and seed phrase are never needed by the application.

## Sources

- Render service types: https://render.com/docs/service-types
- Render environment variables: https://render.com/docs/configure-environment-variables
- Supabase REST API: https://supabase.com/docs/guides/api
- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
