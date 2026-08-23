const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const MAX_KEYS = 5;

function loadKeys() {
  const keys = [];
  for (let index = 1; index <= MAX_KEYS; index += 1) {
    const value = process.env[`GEMINI_API_KEY_${index}`]?.trim();
    if (value) keys.push({ index, value, failures: 0, blockedUntil: 0 });
  }
  return keys;
}

export class GeminiRouter {
  constructor({ model = DEFAULT_MODEL, fetchImpl = fetch } = {}) {
    this.model = model;
    this.fetchImpl = fetchImpl;
    this.keys = loadKeys();
    this.cursor = 0;
  }

  get status() {
    return this.keys.map(({ index, failures, blockedUntil }) => ({
      index,
      failures,
      available: blockedUntil <= Date.now()
    }));
  }

  reload() {
    this.keys = loadKeys();
    this.cursor = 0;
  }

  nextKey() {
    const now = Date.now();
    const available = this.keys.filter((key) => key.blockedUntil <= now);
    if (!available.length) return null;
    const key = available[this.cursor % available.length];
    this.cursor += 1;
    return key;
  }

  async generateText({ prompt, systemInstruction = '', responseMimeType = 'application/json' }) {
    if (!prompt?.trim()) throw new Error('Gemini prompt is required.');
    if (!this.keys.length) throw new Error('No Gemini API key is configured.');

    let lastError;
    for (let attempt = 0; attempt < this.keys.length; attempt += 1) {
      const key = this.nextKey();
      if (!key) break;
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(key.value)}`;
      const body = {
        systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType, temperature: 0.2 }
      };
      try {
        const response = await this.fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const payload = await response.json();
        if (!response.ok) {
          const error = new Error(payload?.error?.message || `Gemini request failed: ${response.status}`);
          if ([401, 403, 429].includes(response.status)) key.blockedUntil = Date.now() + (response.status === 429 ? 60_000 : 300_000);
          key.failures += 1;
          lastError = error;
          continue;
        }
        const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
        if (!text) throw new Error('Gemini returned an empty response.');
        key.failures = 0;
        return { text, model: this.model, keyIndex: key.index };
      } catch (error) {
        key.failures += 1;
        lastError = error;
      }
    }
    throw lastError || new Error('All configured Gemini keys are unavailable.');
  }
}
