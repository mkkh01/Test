import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../supabase/migrations/003_payment_manual_evidence.sql', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const storefront = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

 test('manual payment evidence contract stays private and threshold-gated', () => {
  assert.match(migration, /payment_failed_attempts integer not null default 0/);
  assert.match(migration, /create table if not exists public\.payment_evidence/);
  assert.match(migration, /alter table public\.payment_evidence enable row level security/);
  assert.match(server, /app\.post\('\/api\/orders\/:orderNumber\/payment-evidence'/);
  assert.match(server, /order\.paymentFailedAttempts < 2/);
  assert.match(server, /manual_review/);
  assert.match(storefront, /id="evidenceForm"/);
  assert.match(client, /fileToDataUrl/);
  assert.match(server, /amountUsdt = Number\(dbProduct\.price_usdt\)/);
  assert.match(client, /fetch\('\/api\/products'/);
  assert.match(storefront, /data-product-price="starter"/);
});
