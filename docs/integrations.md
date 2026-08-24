# Deployment and Integration Notes

## Render

The first deployment target is a Render Web Service. It runs the Express server with:

```text
Build command: npm ci
Start command: npm start
Health check: /api/health
```

The `render.yaml` file defines the public Supabase URL and marks secret variables as values to be entered in Render's environment settings. Never commit a service-role key, Telegram token, Gemini key, or wallet private key.

The web service handles order creation, customer-scoped status tokens, Solana transaction-signature submission, and synchronous USDT-SPL verification. Jobs that remain in `confirming` are stored in the PostgreSQL queue. Run `npm run worker:cron` as a Render Cron Job for periodic recovery, or `npm run worker:run` as a Render Background Worker for continuous queue processing. Render does not offer Free instances for Background Workers or Cron Jobs, so enable one only after choosing a paid instance and understanding its cost.

## Solana payment integration

The payment network is Solana Mainnet and the asset is USDT-SPL, not SOL. The server uses `SolanaRpcProvider` to call Solana JSON-RPC with `getTransaction` and `getSignatureStatuses`. It requests `jsonParsed` transaction data, reads `preTokenBalances` and `postTokenBalances`, matches the official USDT mint, identifies a positive token balance delta owned by the configured receiving wallet, and requires successful finalized execution before releasing a ZIP.

The configured receiving address is a public operational value. The application never needs a private key, seed phrase, or signing capability. `USDT_TOKEN_CONTRACT` is retained as a compatibility name for the Solana mint; new deployments should also set `SOLANA_USDT_MINT` to the official Solana USDT mint. `SOLANA_COMMITMENT=finalized` is the recommended production setting. With finalized commitment, `USDT_MIN_CONFIRMATIONS=1` represents one finalized Solana result rather than a TRON block count.

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

## Deferred secrets and operational variables

The following values must be entered in Render and must not be committed:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Supabase PostgreSQL Pooler connection string |
| `SUPABASE_SERVICE_ROLE_KEY` | Compatibility fallback for Supabase REST |
| `ADMIN_ACCESS_TOKEN` | Protected admin actions |
| `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` | Optional Telegram bot |
| `GEMINI_API_KEY_1` through `GEMINI_API_KEY_5` | Server-side analysis key rotation |
| `USDT_RECEIVING_ADDRESS` | Public Solana wallet receiving USDT-SPL |
| `SOLANA_RPC_URL` | Solana Mainnet JSON-RPC endpoint; the code has a public default |
| `SOLANA_COMMITMENT` | `finalized` or `confirmed`; use `finalized` in production |
| `SOLANA_USDT_MINT` | Solana USDT mint address |
| `USDT_TOKEN_CONTRACT` | Compatibility alias for the Solana USDT mint |
| `USDT_TOKEN_DECIMALS` | `6` for USDT |
| `USDT_MIN_CONFIRMATIONS` | `1` when using finalized commitment |
| `PUBLIC_BASE_URL` | Public customer-facing URL |

The wallet address is public operational configuration; the private key and seed phrase are never needed by the application. Solana payment acceptance still requires the correct public RPC settings, the correct mint, the correct receiving wallet, the deployed provider code, and a controlled live test.

## Sources

- Render service types: https://render.com/docs/service-types
- Render environment variables: https://render.com/docs/configure-environment-variables
- Supabase REST API: https://supabase.com/docs/guides/api
- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Solana `getTransaction`: https://solana.com/docs/rpc/http/gettransaction
- Solana token transfers: https://solana.com/docs/tokens/basics/transfer-tokens
- Tether USDt on Solana: https://tether.io/news/tether-tokens-usdt-live-on-solana/
