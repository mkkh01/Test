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
  constructor({ fetchImpl = fetch, provider = process.env.EMAIL_PROVIDER || '', apiKey = process.env.RESEND_API_KEY, from = process.env.EMAIL_FROM || 'onboarding@resend.dev', replyTo = process.env.EMAIL_REPLY_TO || '', testTo = process.env.EMAIL_TEST_TO || '', timeoutMs = 10_000 } = {}) {
    this.fetchImpl = fetchImpl;
    this.provider = clean(provider, 40).toLowerCase();
    this.apiKey = clean(apiKey, 300);
    this.from = clean(from, 320);
    this.replyTo = clean(replyTo, 320).toLowerCase();
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

  async sendSampleEmail({ to, fullName = '', issue = '', previewUrl, idempotencyKey = '' }) {
    const recipient = clean(to, 320).toLowerCase();
    const name = escapeHtml(fullName || 'there', 120);
    const safeIssue = escapeHtml(issue || 'client payment and scope protection', 500);
    const safePreviewUrl = clean(previewUrl, 1000);
    if (!this.configured) return { sent: false, status: 'not_configured' };
    if (!recipient || !EMAIL_PATTERN.test(recipient) || !safePreviewUrl) throw new Error('Resend recipient and preview URL are required.');
    if (this.from.toLowerCase().endsWith('@resend.dev') && recipient !== this.testTo) throw new Error('Resend test mode is restricted to EMAIL_TEST_TO.');

    const subject = 'Your requested sample: Client Payment & Scope Protection Kit';
    const text = `Hi ${fullName || 'there'},\n\nYou requested a sample after telling us about: ${issue || 'a client payment or scope challenge'}.\n\nOpen the visual sample viewer to see how the kit handles scope boundaries, change requests, payment follow-ups, approvals, and handover:\n${safePreviewUrl}\n\nIf you did not request this sample, you can ignore this message.\n\nBest,\nClient Protection Kit`;
    const htmlPreviewUrl = escapeHtml(safePreviewUrl);
    const html = `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033;max-width:640px;margin:auto"><h2>Client Payment &amp; Scope Protection Kit</h2><p>Hi ${name},</p><p>You requested a sample after telling us about: <strong>${safeIssue}</strong>.</p><p>Open the visual sample viewer to see how the kit handles scope boundaries, change requests, payment follow-ups, approvals, and handover.</p><p><a href="${htmlPreviewUrl}" style="display:inline-block;background:#2463eb;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">Open the sample viewer</a></p><p>If the button does not open, copy this URL into your browser:<br><code>${htmlPreviewUrl}</code></p><p>Starter — 5 USDT<br>Complete — 7 USDT<br>Agency — 10 USDT</p><p>This message was sent because a sample was requested. If you did not request it, you can ignore this message.</p><p>Best,<br>Client Protection Kit</p></div>`;
    const sender = this.from.includes('<') ? this.from : `Client Protection Kit <${this.from}>`;
    const payload = { from: sender, to: [recipient], subject, html, text };
    if (EMAIL_PATTERN.test(this.replyTo)) payload.reply_to = [this.replyTo];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers = { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' };
      const safeIdempotencyKey = clean(idempotencyKey, 256);
      if (safeIdempotencyKey) headers['Idempotency-Key'] = safeIdempotencyKey;
      const response = await this.fetchImpl(RESEND_API_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const responsePayload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responsePayload?.message || responsePayload?.error?.message || `Resend request failed: ${response.status}`);
      return { sent: true, status: 'sent', providerMessageId: responsePayload?.id || null };
    } finally {
      clearTimeout(timeout);
    }
  }
}
