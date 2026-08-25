# Render Worker Operations

The web service handles the storefront and synchronous Solana transaction-signature submission. Queue processing must run separately so a web restart cannot lose work.

## Recommended low-cost operation

Keep the Render Web Service as the only deployed service and use the repository workflow `.github/workflows/lead-discovery-cycle.yml`. GitHub Actions calls the protected Render endpoint every 30 minutes at minutes 17 and 47 UTC using its short-lived `GITHUB_TOKEN`; the token is not stored in the repository. The endpoint starts one cycle, while the worker performs payment rechecks, lead analysis, public-source discovery, and cleanup. The first payment submission is synchronous; the worker remains a recovery path for transactions still waiting for confirmations.

## Always-on operation

For continuous queue processing, create a Render Background Worker with command `npm run worker:run`. The worker polls the PostgreSQL-backed queue conservatively and never sends unsolicited outreach. Render documents Background Workers as continuously running services that do not receive incoming traffic. Background Workers are not available on the Free instance type, so creating one requires a paid instance.

## Shared environment

The web service and worker/cron must share `DATABASE_URL`, `DB_POOL_MAX`, `SOLANA_RPC_URL`, `SOLANA_COMMITMENT`, `USDT_NETWORK`, `USDT_RECEIVING_ADDRESS`, `SOLANA_USDT_MINT`, `USDT_TOKEN_CONTRACT`, `USDT_TOKEN_DECIMALS`, `USDT_MIN_CONFIRMATIONS`, `GEMINI_MODEL`, `GEMINI_API_KEY_1..5`, `GEMINI_API_KEY_COUNT`, `TELEGRAM_BOT_TOKEN`, and `TELEGRAM_WEBHOOK_SECRET`. Secrets must be entered in Render, not committed to GitHub.

## GitHub Actions trigger every 30 minutes

The current low-cost trigger is `.github/workflows/lead-discovery-cycle.yml`. Its schedule is `17,47 * * * *` UTC, which means one run every 30 minutes while avoiding the busiest exact hour boundaries. It also supports manual `workflow_dispatch` for one controlled test. The workflow calls:

```text
POST https://test-p2h3.onrender.com/api/internal/cron/run
Authorization: Bearer <short-lived GitHub Actions token>
X-GitHub-Actions: true
X-GitHub-Repository: mkkh01/Test
```

The server validates the token against the GitHub API and checks the exact repository before starting a cycle. The response `202` means only that the cycle was accepted; the final result is available from the protected endpoint below and in Render Logs:

```text
GET https://test-p2h3.onrender.com/api/internal/cron/status
```

The status response distinguishes `running`, `completed`, and `failed` and includes the source-level summary without secrets. If a previous cycle is still running, the trigger returns `409`. The older external cron endpoint remains available for compatibility, but cron-job.org is no longer needed.

Each cycle discovers public Hacker News, Bluesky, DEV Community, and Stack Exchange API candidates, then analyzes newly queued candidates with Gemini and processes payment jobs. Each source is isolated: a temporary failure in one source produces a partial summary and does not discard candidates from healthy sources. Public leads create drafts only. The outreach worker can process at most one previously approved message per cycle, requires `OUTREACH_SEND_ENABLED=true`, and refuses the shared `onboarding@resend.dev` sender; it never sends unapproved or bulk outreach.

## Safety

The worker uses database locking and dedupe keys. It must not be configured to rotate provider keys to bypass limits, scrape private platforms, or send bulk messages. All first-contact drafts remain `needs_human_review=true` and `approval_required=true`.

## References

- Render Background Workers: https://render.com/docs/background-workers
- Render Cron Jobs: https://render.com/docs/cronjobs
- Render Blueprint service types and instance plans: https://render.com/docs/blueprint-spec
- Render free instance limitations: https://render.com/docs/free
