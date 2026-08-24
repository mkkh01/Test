# Preview link diagnosis

On 2026-08-24, `https://test-p2h3.onrender.com/preview.html` returned HTTP 200 with the expected page title and sample content. Browser navigation also rendered the page and exposed the navigation links. The static page itself is reachable; the reported issue is likely the email client's link handling or the email URL presentation, not a missing server route.

No second email was sent during diagnosis. The next fix should make the URL visibly copyable as plain text in the email and use a canonical absolute URL in the message. The preview page will remain a public informational page with no paid files exposed.

Fix deployed in commit `de36273`:

- Added `https://test-p2h3.onrender.com/preview` as a short canonical route serving the same preview page.
- Kept `https://test-p2h3.onrender.com/preview.html` working for the already-sent email.
- Updated future sample emails to use `/preview` and show the URL as visible copyable text below the button.
- After deployment, both routes returned HTTP 200 and the short route contained the expected `Sample Previews` title.
- No additional email was sent during this fix.

The user's screenshot shows the browser resolving a malformed host/path containing `%20public_base_url`, with `DNS_PROBE_FINISHED_NXDOMAIN`. This indicates the email URL was built from an incorrectly populated `PUBLIC_BASE_URL` value or an earlier malformed template. The next action is to inspect the non-secret Render value and normalize the base URL in code so only `https://test-p2h3.onrender.com` can be used.
