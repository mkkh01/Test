import test from 'node:test';
import assert from 'node:assert/strict';
import { ResendProvider } from '../src/integrations/resend-provider.js';

test('Resend provider sends a sample email through the API', async () => {
  let request;
  const provider = new ResendProvider({
    provider: 'resend',
    apiKey: 're_test_only',
    from: 'onboarding@resend.dev',
    replyTo: 'owner@example.com',
    testTo: 'owner@example.com',
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({ id: 'email_test_123' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });

  const result = await provider.sendSampleEmail({
    to: 'owner@example.com',
    fullName: 'Owner',
    issue: 'Unpaid invoices',
    previewUrl: 'https://test-p2h3.onrender.com/preview.html',
    idempotencyKey: 'sample-test-123'
  });

  assert.deepEqual(result, { sent: true, status: 'sent', providerMessageId: 'email_test_123' });
  assert.equal(request.url, 'https://api.resend.com/emails');
  assert.equal(request.options.headers.Authorization, 'Bearer re_test_only');
  assert.deepEqual(request.body.to, ['owner@example.com']);
  assert.equal(request.body.from, 'Client Protection Kit <onboarding@resend.dev>');
  assert.deepEqual(request.body.reply_to, ['owner@example.com']);
  assert.equal(request.options.headers['Idempotency-Key'], 'sample-test-123');
  assert.match(request.body.html, /preview\.html/);
  assert.match(request.body.text, /Unpaid invoices/);
  assert.match(request.body.text, /requested a sample/);
});

test('Resend provider does not send when no key is configured', async () => {
  let called = false;
  const provider = new ResendProvider({ provider: 'resend', apiKey: '', fetchImpl: async () => { called = true; } });
  const result = await provider.sendSampleEmail({ to: 'owner@example.com', previewUrl: 'https://example.com/preview.html' });
  assert.deepEqual(result, { sent: false, status: 'not_configured' });
  assert.equal(called, false);
});

test('Resend provider rejects invalid recipients before making a request', async () => {
  let called = false;
  const provider = new ResendProvider({ provider: 'resend', apiKey: 're_test_only', testTo: 'owner@example.com', fetchImpl: async () => { called = true; } });
  await assert.rejects(() => provider.sendSampleEmail({ to: 'not-an-email', previewUrl: 'https://example.com/preview.html' }), /recipient and preview URL are required/);
  assert.equal(called, false);
});

test('Resend provider surfaces a safe API failure without returning the secret', async () => {
  const provider = new ResendProvider({
    provider: 'resend',
    apiKey: 're_secret_test_only',
    testTo: 'owner@example.com',
    fetchImpl: async () => new Response(JSON.stringify({ message: 'API key is invalid' }), { status: 401 })
  });
  await assert.rejects(
    () => provider.sendSampleEmail({ to: 'owner@example.com', previewUrl: 'https://example.com/preview.html' }),
    error => error.message === 'API key is invalid' && !error.message.includes('re_secret_test_only')
  );
});

test('Resend provider stays disabled when another provider is selected', async () => {
  const provider = new ResendProvider({ provider: 'disabled', apiKey: 're_test_only' });
  assert.equal(provider.configured, false);
});

test('Resend test mode refuses a different recipient', async () => {
  let called = false;
  const provider = new ResendProvider({ provider: 'resend', apiKey: 're_test_only', testTo: 'owner@example.com', fetchImpl: async () => { called = true; } });
  await assert.rejects(() => provider.sendSampleEmail({ to: 'someone-else@example.com', previewUrl: 'https://example.com/preview.html' }), /restricted to EMAIL_TEST_TO/);
  assert.equal(called, false);
});
