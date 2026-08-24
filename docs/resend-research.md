# Resend verification notes

Reviewed official Resend documentation on 2026-08-24.

- Send Email API: https://resend.com/docs/api-reference/emails/send-email
  - The API accepts required `from`, `to`, and `subject`, plus `html` and `text`.
  - Multiple recipients use an array, with a documented maximum of 50.
  - API authentication uses an `Authorization: Bearer re_...` header (from the official API introduction documentation).
- Test emails: https://resend.com/docs/dashboard/emails/send-test-emails
  - Resend provides `delivered@resend.dev`, `bounced@resend.dev`, `complained@resend.dev`, and `suppressed@resend.dev` for simulated delivery events.
  - Test messages count against the account sending quota.
  - Resend advises avoiding fake addresses and using its test addresses for development.
- Verified domains: https://resend.com/docs/dashboard/domains/introduction
  - Production sending should use a domain owned and verified by the account.

Implementation decision: use the REST API server-side, keep the API key only in Render, send the first real test only to the user's Resend-account email after the user confirms the key previously exposed in chat was revoked/replaced, and do not send cold outreach or messages to discovered contacts.
