# Resend live check

On 2026-08-24, the deployed preview page returned HTTP 200 at `https://test-p2h3.onrender.com/preview.html`.

The live `/api/health` response showed `postgresConfigured=true`, `dataStore=postgres`, `geminiKeyCount=5`, `solanaRpcConfigured=true`, `usdtConfigured=true`, and `cronTriggerConfigured=true`. It also showed `emailConfigured=false`, so the deployed service was not ready for a live Resend request. No real email was sent.

Render Dashboard access was available for the user's workspace and project. No environment value was changed during this check. The next safe step is for the user to ensure `EMAIL_PROVIDER=resend`, a newly rotated `RESEND_API_KEY`, `EMAIL_FROM=onboarding@resend.dev`, and `EMAIL_TEST_TO=memo2026186@gmail.com` are saved in the Test service, then wait for the deployment to finish and recheck health.

Render Dashboard later confirmed service `Test` is deployed live for commit `65a3d06` (`Add safe Resend sample email integration`). The service remains on the Free plan. The environment was not edited in the dashboard during this session. Live health still reports `emailConfigured=false`, which means the email variables are absent, incomplete, or not yet applied to the running service.

The Render Environment page visibly listed `EMAIL_FROM` and `EMAIL_PROVIDER`. A page search did not find `EMAIL_TEST_TO`. Values were not opened, copied, or changed. This strongly explains why the new provider reports `emailConfigured=false`; in test mode the code requires `EMAIL_TEST_TO` in addition to the provider, key, and sender.

The Render Environment page is now in edit mode. Existing `EMAIL_FROM` and `EMAIL_PROVIDER` rows are present, and the UI offers `Add variable`; `EMAIL_TEST_TO` is not present. No secret value was opened or copied. The only intended change is adding `EMAIL_TEST_TO=memo2026186@gmail.com`.

The new Render row now contains `EMAIL_TEST_TO=memo2026186@gmail.com`. The form is still in edit mode; the save/rebuild/deploy action has not yet been submitted in this checkpoint.

After Render redeployed with `EMAIL_TEST_TO=memo2026186@gmail.com`, live health reported `emailConfigured=true`. One internal sample request was submitted to `/api/intake` with `contactMethod=Email` and explicit consent. The service returned HTTP 201 with `stored=true` and `emailStatus=sent`, meaning the application accepted the request and Resend API call succeeded. No outreach or additional recipient was used. Inbox placement itself should be confirmed in Gmail and in the Resend dashboard Logs.

A corrected sample request was sent once on 2026-08-24 to `memo2026186@gmail.com` after health reported `emailConfigured=true` and `/preview` returned HTTP 200. The application returned HTTP 201 with `emailStatus=sent`. The corrected email uses the `/preview` URL and includes a visible copyable URL. No other recipient was used.
