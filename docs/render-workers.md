# Render Worker Operations

The web service handles the storefront and synchronous Solana transaction-signature submission. Queue processing must run separately so a web restart cannot lose work.

## Recommended low-cost operation

Create one Render Cron Job from this repository with command `npm run worker:cron` and schedule `*/10 * * * *` UTC. The job runs payment rechecks, lead analysis, public-source discovery, and cleanup once, then exits. Render documents that cron jobs must exit after work and charges are based on active runtime, with a minimum monthly charge per cron job. The first payment submission is synchronous; the cron job is a recovery path for transactions still waiting for confirmations.

## Always-on operation

For continuous queue processing, create a Render Background Worker with command `npm run worker:run`. The worker polls the PostgreSQL-backed queue conservatively and never sends unsolicited outreach. Render documents Background Workers as continuously running services that do not receive incoming traffic. Background Workers are not available on the Free instance type, so creating one requires a paid instance.

## Shared environment

The web service and worker/cron must share `DATABASE_URL`, `DB_POOL_MAX`, `SOLANA_RPC_URL`, `SOLANA_COMMITMENT`, `USDT_NETWORK`, `USDT_RECEIVING_ADDRESS`, `SOLANA_USDT_MINT`, `USDT_TOKEN_CONTRACT`, `USDT_TOKEN_DECIMALS`, `USDT_MIN_CONFIRMATIONS`, `GEMINI_MODEL`, `GEMINI_API_KEY_1..5`, `GEMINI_API_KEY_COUNT`, `TELEGRAM_BOT_TOKEN`, and `TELEGRAM_WEBHOOK_SECRET`. Secrets must be entered in Render, not committed to GitHub.

## Hourly external Cron trigger

If the Render Web Service is the only deployed service, an external cron provider can call the protected endpoint once per hour:

```text
POST https://test-p2h3.onrender.com/api/internal/cron/run
Authorization: Bearer <CRON_TRIGGER_SECRET>
```

The service returns `202` immediately, starts one child process, and logs the discovery, analysis, and payment summary. If a previous cycle is still running, it returns `409` and the cron provider should record the run as already in progress rather than retrying aggressively. The secret must be created by the owner, entered in Render as `CRON_TRIGGER_SECRET`, and entered in the cron provider's Authorization header; it must never be placed in the URL or committed to GitHub. The endpoint supports GET for providers that cannot issue POST, but POST is preferred.

The hourly cycle discovers public Hacker News and Bluesky candidates first, then analyzes newly queued candidates with Gemini, and finally processes payment jobs. It creates drafts only; there is no outbound message step.

## Safety

The worker uses database locking and dedupe keys. It must not be configured to rotate provider keys to bypass limits, scrape private platforms, or send bulk messages. All first-contact drafts remain `needs_human_review=true` and `approval_required=true`.

## References

- Render Background Workers: https://render.com/docs/background-workers
- Render Cron Jobs: https://render.com/docs/cronjobs
- Render Blueprint service types and instance plans: https://render.com/docs/blueprint-spec
- Render free instance limitations: https://render.com/docs/free
