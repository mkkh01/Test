export class TelegramBot {
  constructor({ token = process.env.TELEGRAM_BOT_TOKEN, fetchImpl = fetch } = {}) {
    this.token = token?.trim() || '';
    this.fetchImpl = fetchImpl;
  }

  get configured() {
    return Boolean(this.token);
  }

  async call(method, body = {}) {
    if (!this.configured) throw new Error('Telegram bot token is not configured.');
    const response = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload?.description || `Telegram ${method} failed.`);
    return payload.result;
  }

  async sendMessage({ chatId, text, parseMode = 'HTML', disableWebPagePreview = true }) {
    if (!chatId || !text?.trim()) throw new Error('Telegram chatId and text are required.');
    return this.call('sendMessage', { chat_id: chatId, text: text.trim().slice(0, 4096), parse_mode: parseMode, disable_web_page_preview: disableWebPagePreview });
  }

  async setWebhook({ url, secretToken }) {
    if (!url?.startsWith('https://')) throw new Error('Telegram webhook URL must use HTTPS.');
    return this.call('setWebhook', { url, secret_token: secretToken });
  }
}
