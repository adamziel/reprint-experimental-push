import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticatedHttpClient } from '../src/authenticated-http-push-client.js';

const credential = {
  username: 'reprint_push_admin',
  password: 'reprint-push-admin-app-password',
};

test('authenticated push client requires an explicit session and idempotency key for mutating requests', () => {
  const client = authenticatedHttpClient({
    sourceUrl: 'http://127.0.0.1:8080',
    credential,
    routeProfile: 'production-shaped',
    requestTimeoutMs: 1,
  });

  assert.throws(
    () => client.signedPost('/dry-run', { plan: { id: 'plan-01' } }, {}),
    /Missing push session for mutating request: \/wp-json\/reprint\/v1\/push\/dry-run/,
  );
  assert.throws(
    () => client.signedPost('/apply', { plan: { id: 'plan-01' } }, { session: 'psh_01j00000000000000000000000' }),
    /Missing push idempotencyKey for mutating request: \/wp-json\/reprint\/v1\/push\/apply/,
  );
});

test('authenticated push client signs mutating requests when session and idempotency are present', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const client = authenticatedHttpClient({
      sourceUrl: 'http://127.0.0.1:8080',
      credential,
      routeProfile: 'production-shaped',
      requestTimeoutMs: 1_000,
    });

    const proof = await client.signedPost('/recovery/inspect', { plan: { id: 'plan-01' } }, {
      session: 'psh_01j00000000000000000000000',
      idempotencyKey: 'idem-01',
    });

    assert.equal(proof.status, 200);
    assert.deepEqual(proof.body, { ok: true });
    assert.equal(seen.length, 1);
    const headerEntries = Object.entries(seen[0].options.headers).reduce((acc, [key, value]) => {
      acc[key.toLowerCase()] = value;
      return acc;
    }, {});
    assert.match(headerEntries['x-reprint-push-session'], /^psh_/);
    assert.equal(headerEntries['x-reprint-push-idempotency-key'], 'idem-01');
  } finally {
    global.fetch = originalFetch;
  }
});
