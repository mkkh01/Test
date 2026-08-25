import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../supabase/migrations/003_payment_manual_evidence.sql', import.meta.url), 'utf8');
const detailsMigration = fs.readFileSync(new URL('../supabase/migrations/008_payment_evidence_details.sql', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const storefront = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('manual payment evidence contract stays private and verifies first-failure details', () => {
  assert.match(migration, /payment_failed_attempts integer not null default 0/);
  assert.match(migration, /create table if not exists public\.payment_evidence/);
  assert.match(migration, /alter table public\.payment_evidence enable row level security/);
  assert.match(server, /app\.post\('\/api\/orders\/:orderNumber\/payment-evidence'/);
  assert.match(detailsMigration, /sender_address text/);
  assert.match(detailsMigration, /transfer_time timestamptz/);
  assert.match(server, /order\.paymentFailedAttempts < 1/);
  assert.match(server, /isWithinEvidenceWindow/);
  assert.match(server, /verificationStatus/);
  assert.match(server, /manual_review/);
  assert.match(storefront, /id="evidenceForm"/);
  assert.match(storefront, /id="paymentTransferTime"/);
  assert.match(storefront, /id="paymentSenderAddress"/);
  assert.match(client, /fileToDataUrl/);
  assert.match(client, /window\.location\.assign/);
  assert.match(server, /amountUsdt = Number\(dbProduct\.price_usdt\)/);
  assert.match(client, /fetch\('\/api\/products'/);
  assert.match(storefront, /data-product-price="starter"/);
});
