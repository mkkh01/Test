# Preview link diagnosis

On 2026-08-24, `https://test-p2h3.onrender.com/preview.html` returned HTTP 200 with the expected page title and sample content. Browser navigation also rendered the page and exposed the navigation links. The static page itself is reachable; the reported issue is likely the email client's link handling or the email URL presentation, not a missing server route.

No second email was sent during diagnosis. The next fix should make the URL visibly copyable as plain text in the email and use a canonical absolute URL in the message. The preview page will remain a public informational page with no paid files exposed.
