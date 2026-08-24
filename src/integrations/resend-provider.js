const RESEND_API_URL = 'https://api.resend.com/emails';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value, max = 1000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function escapeHtml(value) {
  return clean(value, 4000)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export class ResendProvider {
  constructor({ fetchImpl = fetch, provider = process.env.EMAIL_PROVIDER || '', apiKey = process.env.RESEND_API_KEY, from = process.env.EMAIL_FROM || 'onboarding@resend.dev', testTo = process.env.EMAIL_TEST_TO || '', timeoutMs = 10_000 } = {}) {
    this.fetchImpl = fetchImpl;
    this.provider = clean(provider, 40).toLowerCase();
    this.apiKey = clean(apiKey, 300);
    this.from = clean(from, 320);
    this.testTo = clean(testTo, 320).toLowerCase();
    this.timeoutMs = timeoutMs;
  }

  get testMode() {
    return this.from.toLowerCase().endsWith('@resend.dev');
  }

  get configured() {
    const testModeReady = this.testMode && EMAIL_PATTERN.test(this.testTo);
    return this.provider === 'resend' && Boolean(this.apiKey && this.from) && (!this.testMode || testModeReady);
  }

  async sendSampleEmail({ to, fullName = '', issue = '', previewUrl }) {
    const recipient = clean(to, 320).toLowerCase();
    const name = escapeHtml(fullName || 'there', 120);
    const safeIssue = escapeHtml(issue || 'client payment and scope protection', 500);
    const safePreviewUrl = clean(previewUrl, 1000);
    if (!this.configured) return { sent: false, status: 'not_configured' };
    if (!recipient || !EMAIL_PATTERN.test(recipient) || !safePreviewUrl) throw new Error('Resend recipient and preview URL are required.');
    if (this.from.toLowerCase().endsWith('@resend.dev') && recipient !== this.testTo) throw new Error('Resend test mode is restricted to EMAIL_TEST_TO.');

    const subject = 'A practical solution for clearer scope and client payments';
    const text = `Hi ${fullName || 'there'},\n\nYou mentioned: ${issue || 'a client payment or scope challenge'}. We created practical templates to help with scope, revisions, payment terms, and handover.\n\nPreview the Starter, Complete, and Agency samples before deciding: ${safePreviewUrl}\n\nIf the button does not open, copy this URL into your browser:\n${safePreviewUrl}\n\nBest,\nClient Protection Kit`;
    const htmlPreviewUrl = escapeHtml(safePreviewUrl);
    const html = `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033;max-width:640px;margin:auto"><h2>Client Payment &amp; Scope Protection Kit</h2><p>Hi ${name},</p><p>You mentioned: <strong>${safeIssue}</strong>.</p><p>We created practical templates to help freelancers and small agencies clarify scope, control revisions, organize payment terms, and document handover.</p><p>You can review samples from all three versions before deciding:</p><p><a href="${htmlPreviewUrl}" style="display:inline-block;background:#2463eb;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">View the sample previews</a></p><p>If the button does not open, copy this URL into your browser:<br><code>${htmlPreviewUrl}</code></p><p>Starter — 5 USDT<br>Complete — 7 USDT<br>Agency — 10 USDT</p><p>No pressure. The preview lets you see the format and level of detail first.</p><p>Best,<br>Client Protection Kit</p></div>`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(RESEND_API_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: this.from, to: [recipient], subject, html, text }),
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || payload?.error?.message || `Resend request failed: ${response.status}`);
      return { sent: true, status: 'sent', providerMessageId: payload?.id || null };
    } finally {
      clearTimeout(timeout);
    }
  }
}
