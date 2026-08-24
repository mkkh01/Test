# Resend deliverability notes

The official Resend documentation reviewed on 2026-08-24 recommends using a valid reply address rather than a no-reply sender, including a plain-text version, keeping the message body small, and ensuring URLs match the sending domain. Resend also supports `reply_to` in the send payload and `Idempotency-Key` to prevent duplicate requests. For managed lists, Resend documents `List-Unsubscribe` and the RFC 8058 one-click headers for bulk mail; this project will not send bulk mail, but it will still provide a visible opt-out link for outreach drafts.

Sources:

- https://resend.com/docs/dashboard/emails/deliverability-insights
- https://resend.com/docs/api-reference/emails/send-email
- https://resend.com/docs/dashboard/emails/add-unsubscribe-to-transactional-emails

Render environment edit was opened without revealing secret values. A new empty environment-variable row is present at the end of the list; it will be filled only with `EMAIL_REPLY_TO=memo2026186@gmail.com` before saving.

Final verification: `EMAIL_REPLY_TO=memo2026186@gmail.com` was added in Render without exposing API secrets. The live health endpoint reports `emailConfigured=true`; code syntax checks pass and all 23 tests pass. No additional live email was sent during this deliverability configuration change.
