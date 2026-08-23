import crypto from 'node:crypto';

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left || '');
  const rightBuffer = Buffer.from(right || '');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function requireAdmin(req, res, next) {
  const configuredToken = process.env.ADMIN_ACCESS_TOKEN?.trim();
  const receivedToken = req.get('x-admin-token') || '';
  if (!configuredToken) return res.status(503).json({ ok: false, error: 'Admin access is not configured.' });
  if (!safeEqual(receivedToken, configuredToken)) return res.status(401).json({ ok: false, error: 'Admin authentication required.' });
  return next();
}
