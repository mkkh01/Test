# Leads and approved outreach

## What runs every 30 minutes

The external scheduler calls `POST https://test-p2h3.onrender.com/api/internal/cron/run` with the `Authorization: Bearer <CRON_TRIGGER_SECRET>` header. One cycle discovers public posts, deduplicates them, creates `lead_analyze` jobs, runs Gemini analysis, processes payment work, and checks the approved outreach queue. A five-field external cron expression is `*/30 * * * *` in UTC. The secret must never be placed in the URL or committed to GitHub.

## Public sources

The discovery worker uses the public Hacker News API, Bluesky public search endpoint, DEV Community API, and Stack Overflow public tag feed. It stores only the public URL, public text, author handle, source, timestamp, and analysis evidence. It does not log in, scrape private pages, guess an email address, or bypass platform limits.

## Admin workflow

Open `/admin.html`, enter the admin token, and review the **Public leads & outreach** table. Each row shows the public source, evidence excerpt, problem type, fit score, available contact email, message draft, delivery state, and sales state. To contact a lead, enter a publicly provided business email and use **Approve & queue**. This changes the lead to `qualified`, saves the approval audit entry, and places one message in the queue. The worker sends at most one approved message per cycle and enforces the configured minimum gap.

A lead without a permitted email remains a draft. **Reject** removes the pending message from the send queue, while **Opt out** blocks future outreach. Sales status can be changed independently to `qualified`, `contacted`, `replied`, `converted`, `not_interested`, `lost`, or `blocked`. If an order later uses the same email, the table shows the latest order status beside the lead.

## Sending requirements

`OUTREACH_SEND_ENABLED` is `false` by default. It must remain false while using the shared `onboarding@resend.dev` test sender. Real lead outreach requires a verified sending domain in Resend, a valid `EMAIL_FROM` on that domain, a Reply-To address, and a review of the message and recipient. Turning on the queue does not authorize bulk or unreviewed sending.
