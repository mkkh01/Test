import crypto from 'node:crypto';

export function createDownloadToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function hashDownloadToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

export function tokenMatches(token, expectedHash) {
  const actual = Buffer.from(hashDownloadToken(token));
  const expected = Buffer.from(String(expectedHash || ''));
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function isTokenExpired(expiresAt, now = Date.now()) {
  const timestamp = Date.parse(expiresAt || '');
  return !Number.isFinite(timestamp) || timestamp <= now;
}
