import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticatedHttpClient, runAuthenticatedHttpPush } from '../src/authenticated-http-push-client.js';

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
  assert.throws(
    () => client.signedPost('/apply', { plan: { id: 'plan-01' } }, {
      session: 'session-01',
      idempotencyKey: 'idem-01',
    }),
    /Invalid push session for mutating request: \/wp-json\/reprint\/v1\/push\/apply/,
  );
  assert.throws(
    () => client.signedPost('/apply', { plan: { id: 'plan-01' } }, {
      session: 'psh_01j00000000000000000000000',
      idempotencyKey: '   ',
    }),
    /Invalid push idempotencyKey for mutating request: \/wp-json\/reprint\/v1\/push\/apply/,
  );
});

test('authenticated push client fails closed for unsupported production-shaped origins', () => {
  assert.throws(
    () => authenticatedHttpClient({
      sourceUrl: 'https://example.com',
      credential,
      routeProfile: 'production-shaped',
    }),
    /Unsupported production-shaped sourceUrl origin: https:\/\/example\.com/,
  );
});

test('authenticated push client allows production-shaped loopback runtime ports', () => {
  const client = authenticatedHttpClient({
    sourceUrl: 'http://127.0.0.1:3000',
    credential,
    routeProfile: 'production-shaped',
    requestTimeoutMs: 1,
  });
  assert.equal(typeof client.get, 'function');
});

test('authenticated push client fails closed for missing production-shaped credentials', () => {
  assert.throws(
    () => authenticatedHttpClient({
      sourceUrl: 'http://127.0.0.1:8080',
      credential: {},
      routeProfile: 'production-shaped',
    }),
    /Missing credentials for production-shaped authenticated client/,
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

test('authenticated push client retries idempotent signed posts after a transient transport failure', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  let attempt = 0;
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    attempt += 1;
    if (attempt === 1) {
      const error = new TypeError('fetch failed');
      error.code = 'ECONNRESET';
      throw error;
    }
    return new Response(JSON.stringify({ ok: true, attempt }), {
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

    const proof = await client.signedPost('/dry-run', { plan: { id: 'plan-01' } }, {
      session: 'psh_01j00000000000000000000000',
      idempotencyKey: 'idem-01',
    });

    assert.equal(proof.status, 200);
    assert.deepEqual(proof.body, { ok: true, attempt: 2 });
    assert.equal(seen.length, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when production auth session is required but not minted', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    if (String(url).includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'application-password-basic', id: 'psh_01j00000000000000000000000' },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-01',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED');
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: {
        required: 'production-auth-session',
        observed: 'application-password-basic',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      },
    });
    assert.equal(seen.length, 1);
    assert.match(seen[0].url, /\/wp-json\/reprint\/v1\/push\/preflight$/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when production auth session is minted but inactive', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    if (String(url).includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'expired', id: 'psh_01j00000000000000000000000' },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-01-inactive',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED');
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: {
        required: 'active',
        observed: 'expired',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      },
    });
    assert.equal(seen.length, 1);
    assert.match(seen[0].url, /\/wp-json\/reprint\/v1\/push\/preflight$/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when production auth session is minted but expired', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    if (String(url).includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2000-01-01T00:00:00Z',
          },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-01-expired',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED');
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: {
        required: 'unexpired',
        observed: '2000-01-01T00:00:00Z',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      },
    });
    assert.deepEqual(summary.authSessionLifecycle, {
      history: [
        {
          step: 'preflight',
          id: 'psh_01j00000000000000000000000',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2000-01-01T00:00:00Z',
          expired: true,
          revoked: false,
          cleanedUp: false,
          rotated: false,
          preserved: false,
        },
      ],
      minted: {
        id: 'psh_01j00000000000000000000000',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2000-01-01T00:00:00Z',
        expired: true,
        revoked: false,
        cleanedUp: false,
      },
      read: {
        id: 'psh_01j00000000000000000000000',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2000-01-01T00:00:00Z',
        expired: true,
        revoked: false,
        cleanedUp: false,
      },
        expired: {
          id: 'psh_01j00000000000000000000000',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2000-01-01T00:00:00Z',
          expired: true,
          revoked: false,
          cleanedUp: false,
        },
    });
    assert.deepEqual(summary.authSessionLifecycleSummary, {
      issued: {
        step: 'preflight',
        id: 'psh_01j00000000000000000000000',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2000-01-01T00:00:00Z',
        expired: true,
        revoked: false,
        cleanedUp: false,
        rotated: false,
        preserved: false,
      },
      read: {
        step: 'preflight',
        id: 'psh_01j00000000000000000000000',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2000-01-01T00:00:00Z',
        expired: true,
        revoked: false,
        cleanedUp: false,
        rotated: false,
        preserved: false,
      },
      observations: [
        {
          step: 'preflight',
          id: 'psh_01j00000000000000000000000',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2000-01-01T00:00:00Z',
          expired: true,
          revoked: false,
          cleanedUp: false,
          rotated: false,
          preserved: false,
        },
      ],
    });
    assert.equal(seen.length, 1);
    assert.match(seen[0].url, /\/wp-json\/reprint\/v1\/push\/preflight$/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when production auth session expires after preflight', async () => {
  const originalFetch = global.fetch;
  const originalDateNow = Date.now;
  const seen = [];
  Date.now = () => new Date('2024-01-01T00:00:00Z').getTime();
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/apply')) {
      Date.now = () => new Date('2035-01-01T00:00:00Z').getTime();
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
        idempotency: {
          replayed: false,
          freshMutationWork: false,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-01-expiry-after-preflight',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED');
    assert.deepEqual(summary.authSessionLifecycleTrace.map(({ step }) => step), [
      'preflight',
      'dry-run',
      'apply',
    ]);
    assert.equal(summary.authSessionLifecycleTrace[0].id, 'psh_01j00000000000000000000000');
    assert.equal(summary.authSessionLifecycleTrace[0].status, 'active');
    assert.equal(summary.authSessionLifecycleTrace[2].expired, true);
    assert.deepEqual(summary.authSession, {
      required: 'unexpired',
      observed: '2030-01-01T00:00:00Z',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    });
    assert.equal(summary.boundary.durableJournal.phase, 'apply');
    assert.equal(seen.length, 4);
  } finally {
    global.fetch = originalFetch;
    Date.now = originalDateNow;
  }
});

test('production-shaped authenticated push records revoked and cleaned-up auth session lifecycle observations', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
            revoked: true,
          },
        },
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/apply')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
            cleanup: true,
          },
        },
        idempotency: {
          replayed: true,
          freshMutationWork: false,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
        recovery: {
          journal: {
            integrity: {
              status: 'ok',
            },
          },
          counts: { blockedUnknown: 0 },
          state: 'ok',
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify({
        ok: true,
        dbJournal: { latestRows: [{ event: 'apply-committed' }, { event: 'mutation-applied' }, { event: 'idempotency-opened' }] },
        storageGuard: {
          boundary: 'filesystem-compare-rename',
          operation: 'update',
          outcome: 'applied',
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-01-revoked-cleanup',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'AUTH_SESSION_LIFECYCLE_DRIFT');
    assert.deepEqual(summary.authSessionLifecycleTrace.map(({ step, revoked, cleanedUp }) => ({ step, revoked, cleanedUp })), [
      { step: 'preflight', revoked: false, cleanedUp: false },
      { step: 'dry-run', revoked: true, cleanedUp: false },
      { step: 'apply', revoked: false, cleanedUp: true },
      { step: 'recovery-inspect', revoked: false, cleanedUp: false },
      { step: 'replay', revoked: false, cleanedUp: true },
      { step: 'journal', revoked: false, cleanedUp: false },
    ]);
    assert.equal(summary.authSessionLifecycle.dryRun.revoked, true);
    assert.equal(summary.authSessionLifecycle.apply.cleanedUp, true);
    assert.equal(summary.authSessionLifecycle.replay.cleanedUp, true);
    assert.deepEqual(
      summary.authSessionLifecycle.history.map(({ step, revoked, cleanedUp, rotated, preserved }) => ({
        step,
        revoked,
        cleanedUp,
        rotated,
        preserved,
      })),
      [
        { step: 'preflight', revoked: false, cleanedUp: false, rotated: false, preserved: false },
        { step: 'dry-run', revoked: true, cleanedUp: false, rotated: false, preserved: true },
        { step: 'apply', revoked: false, cleanedUp: true, rotated: false, preserved: true },
        { step: 'recovery-inspect', revoked: false, cleanedUp: false, rotated: false, preserved: true },
        { step: 'replay', revoked: false, cleanedUp: true, rotated: false, preserved: true },
        { step: 'journal', revoked: false, cleanedUp: false, rotated: false, preserved: false },
      ],
    );
    assert.equal(seen.length, 8);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when a required production auth session is revoked or cleaned up', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
            revoked: true,
          },
        },
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-01-revoked-required',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED');
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: {
        required: 'unrevoked',
        observed: 'revoked',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      },
    });
    assert.deepEqual(summary.authSessionLifecycleTrace.map(({ step, revoked, cleanedUp }) => ({ step, revoked, cleanedUp })), [
      { step: 'preflight', revoked: false, cleanedUp: false },
      { step: 'dry-run', revoked: true, cleanedUp: false },
    ]);
    assert.equal(seen.length, 3);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed on an expired preflight session even without the stricter production-session gate', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    if (String(url).includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2000-01-01T00:00:00Z',
          },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-01-expired-preflight',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED');
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: {
        required: 'unexpired',
        observed: '2000-01-01T00:00:00Z',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      },
    });
    assert.equal(seen.length, 1);
    assert.match(seen[0].url, /\/wp-json\/reprint\/v1\/push\/preflight$/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed immediately when apply drops production auth session metadata', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    if (String(url).includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (String(url).includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (String(url).includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (String(url).includes('/apply')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'application-password-basic', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        applied: true,
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-01-apply-drift',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED');
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
      durableJournal: {
        storageLeaseFence: 'retained Playground journal storage is lab-scoped; production ownership, lease fencing, and replay wiring are not yet proven on the checked release boundary',
        verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
        phase: 'apply',
      },
    });
    assert.equal(seen.length, 4);
    assert.match(seen[0].url, /\/wp-json\/reprint\/v1\/push\/preflight$/);
    assert.match(seen[1].url, /\/wp-json\/reprint\/v1\/push\/snapshot$/);
    assert.match(seen[2].url, /\/wp-json\/reprint\/v1\/push\/dry-run$/);
    assert.match(seen[3].url, /\/wp-json\/reprint\/v1\/push\/apply$/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed immediately when apply returns a non-ok payload', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    if (String(url).includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (String(url).includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (String(url).includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (String(url).includes('/apply')) {
      return new Response(JSON.stringify({
        ok: false,
        code: 'APPLY_FAILED',
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-01-apply-failed',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'APPLY_FAILED');
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
      durableJournal: {
        storageLeaseFence: 'retained Playground journal storage is lab-scoped; production ownership, lease fencing, and replay wiring are not yet proven on the checked release boundary',
        verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
        phase: 'apply',
      },
    });
    assert.equal(seen.length, 4);
    assert.match(seen[0].url, /\/wp-json\/reprint\/v1\/push\/preflight$/);
    assert.match(seen[1].url, /\/wp-json\/reprint\/v1\/push\/snapshot$/);
    assert.match(seen[2].url, /\/wp-json\/reprint\/v1\/push\/dry-run$/);
    assert.match(seen[3].url, /\/wp-json\/reprint\/v1\/push\/apply$/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push accepts replay-equivalent signed request payloads with canonical key order', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/apply') && seen.filter(({ url: seenUrl }) => seenUrl.includes('/apply')).length === 1) {
      return new Response(JSON.stringify({
        ok: true,
        mode: 'apply',
        applied: true,
        code: 'APPLIED',
        responseSchemaVersion: 1,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        receipt: { receiptHash: 'receipt-01' },
        storageGuard: {
          boundary: 'filesystem-compare-rename',
          operation: 'update',
          outcome: 'applied',
        },
        signedRequest: {
          signed: true,
          schemaVersion: 1,
          contentHash: 'content-01',
          timestamp: '2026-05-26T10:00:00.000Z',
          nonceHash: 'nonce-01',
          sessionHash: 'session-01',
          signingKeyHash: 'signing-key-01',
          request: { a: 1, b: 2 },
        },
        idempotency: {
          replayed: false,
          freshMutationWork: false,
          status: 'fresh',
          conflict: false,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/apply')) {
      return new Response(JSON.stringify({
        ok: true,
        mode: 'apply',
        applied: true,
        code: 'APPLIED',
        responseSchemaVersion: 1,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        receipt: { receiptHash: 'receipt-01' },
        storageGuard: {
          boundary: 'filesystem-compare-rename',
          operation: 'update',
          outcome: 'applied',
        },
        signedRequest: {
          signed: true,
          schemaVersion: 1,
          contentHash: 'content-01',
          timestamp: '2026-05-26T10:00:00.000Z',
          nonceHash: 'nonce-01',
          sessionHash: 'session-01',
          signingKeyHash: 'signing-key-01',
          request: { b: 2, a: 1 },
        },
        idempotency: {
          replayed: true,
          freshMutationWork: false,
          status: 'replayed',
          conflict: false,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        recovery: {
          state: 'ready',
          journal: { integrity: { status: 'ok' } },
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        dbJournal: {
          latestRows: [
            { event: 'idempotency-opened' },
            { event: 'mutation-applied' },
            { event: 'apply-committed' },
          ],
        },
        storageGuard: {
          boundary: 'filesystem-compare-rename',
          operation: 'update',
          outcome: 'applied',
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-01-canonical-replay',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, true);
    assert.equal(summary.code, undefined);
    assert.equal(summary.replay?.idempotency?.replayed, true);
    assert.equal(summary.replay?.idempotency?.freshMutationWork, false);
    assert.equal(summary.after?.finalMatchesLocal, true);
    assert.equal(seen.length, 8);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push records preserved-remote retry on read-only release probes', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  let snapshotAttempts = 0;
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/snapshot')) {
      snapshotAttempts++;
      if (snapshotAttempts === 1) {
        throw Object.assign(new TypeError('socket closed'), { cause: { code: 'ECONNRESET' } });
      }
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/apply')) {
      return new Response(JSON.stringify({
        ok: true,
        mode: 'apply',
        applied: true,
        code: 'APPLIED',
        responseSchemaVersion: 1,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        receipt: { receiptHash: 'receipt-01' },
        storageGuard: {
          boundary: 'filesystem-compare-rename',
          operation: 'update',
          outcome: 'applied',
        },
        signedRequest: {
          signed: true,
          schemaVersion: 1,
          contentHash: 'content-01',
          timestamp: '2026-05-26T10:00:00.000Z',
          nonceHash: 'nonce-01',
          sessionHash: 'session-01',
          signingKeyHash: 'signing-key-01',
          request: { a: 1, b: 2 },
        },
        idempotency: {
          replayed: true,
          freshMutationWork: false,
          status: 'replayed',
          conflict: false,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        recovery: {
          state: 'ready',
          journal: { integrity: { status: 'ok' } },
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        dbJournal: {
          latestRows: [
            { event: 'idempotency-opened' },
            { event: 'mutation-applied' },
            { event: 'apply-committed' },
          ],
        },
        storageGuard: {
          boundary: 'filesystem-compare-rename',
          operation: 'update',
          outcome: 'applied',
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-01-preserved-remote-retry',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, true);
    assert.equal(summary.retryAttempts, 2);
    assert.equal(summary.dbJournal?.retryAttempts, 1);
    assert.ok(seen.filter(({ url }) => url.includes('/snapshot')).length >= 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push records preserved-remote retry on preflight when the live source drops the first read', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  let preflightAttempts = 0;
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      preflightAttempts++;
      if (preflightAttempts === 1) {
        throw Object.assign(new TypeError('socket closed'), { cause: { code: 'ECONNRESET' } });
      }
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/apply')) {
      return new Response(JSON.stringify({
        ok: true,
        mode: 'apply',
        applied: true,
        code: 'APPLIED',
        responseSchemaVersion: 1,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        receipt: { receiptHash: 'receipt-01' },
        storageGuard: {
          boundary: 'filesystem-compare-rename',
          operation: 'update',
          outcome: 'applied',
        },
        signedRequest: {
          signed: true,
          schemaVersion: 1,
          contentHash: 'content-01',
          timestamp: '2026-05-26T10:00:00.000Z',
          nonceHash: 'nonce-01',
          sessionHash: 'session-01',
          signingKeyHash: 'signing-key-01',
          request: { a: 1, b: 2 },
        },
        idempotency: {
          replayed: true,
          freshMutationWork: false,
          status: 'replayed',
          conflict: false,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        recovery: {
          state: 'ready',
          journal: { integrity: { status: 'ok' } },
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        dbJournal: {
          latestRows: [
            { event: 'idempotency-opened' },
            { event: 'mutation-applied' },
            { event: 'apply-committed' },
          ],
        },
        storageGuard: {
          boundary: 'filesystem-compare-rename',
          operation: 'update',
          outcome: 'applied',
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-01-preflight-retry',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, true);
    assert.equal(summary.retryAttempts, 2);
    assert.equal(preflightAttempts, 2);
    assert.ok(seen.filter(({ url }) => url.includes('/preflight')).length >= 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when production auth session is minted without status', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    if (String(url).includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (String(url).includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (String(url).includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (String(url).includes('/apply')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        idempotency: {
          replayed: true,
          freshMutationWork: false,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (String(url).includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', id: 'psh_01j00000000000000000000000' },
        },
        recovery: {
          state: 'available',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: { integrity: { status: 'ok' } },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-01-no-status',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'AUTH_SESSION_LIFECYCLE_DRIFT');
    assert.deepEqual(summary.authSession, {
      required: 'production-auth-session',
      observed: 'production-auth-session',
      verdict: 'AUTH_SESSION_LIFECYCLE_DRIFT',
    });
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
      durableJournal: {
        storageLeaseFence: 'retained Playground journal storage is lab-scoped; production ownership, lease fencing, and replay wiring are not yet proven on the checked release boundary',
        verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
        phase: 'recovery-inspect',
      },
    });
    assert.equal(seen.length, 5);
    assert.match(seen[0].url, /\/wp-json\/reprint\/v1\/push\/preflight$/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when preflight auth session id does not match the minted session', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    if (String(url).includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', id: 'psh_01j00000000000000000000001' },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-03',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PREFLIGHT_SESSION_MISMATCH');
    assert.deepEqual(summary.authSession, {
      required: 'psh_01j00000000000000000000000',
      observed: 'psh_01j00000000000000000000001',
      verdict: 'PREFLIGHT_SESSION_MISMATCH',
    });
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PREFLIGHT_SESSION_MISMATCH',
      authSession: {
        required: 'psh_01j00000000000000000000000',
        observed: 'psh_01j00000000000000000000001',
        verdict: 'PREFLIGHT_SESSION_MISMATCH',
      },
    });
    assert.equal(seen.length, 1);
    assert.match(seen[0].url, /\/wp-json\/reprint\/v1\/push\/preflight$/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push exposes the durable journal boundary when journal readback fails after apply', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'application-password-basic', id: 'psh_01j00000000000000000000000' },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/apply')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify({
        ok: false,
        code: 'DURABLE_JOURNAL_UNAVAILABLE',
      }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-02',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: false,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'AUTH_SESSION_LIFECYCLE_DRIFT');
    assert.deepEqual(summary.authSession, {
      required: 'application-password-basic',
      observed: 'missing',
      verdict: 'AUTH_SESSION_LIFECYCLE_DRIFT',
    });
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
      durableJournal: {
        storageLeaseFence: 'retained Playground journal storage is lab-scoped; production ownership, lease fencing, and replay wiring are not yet proven on the checked release boundary',
        verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
        phase: 'recovery-inspect',
      },
    });
    assert.ok(seen.some(({ url }) => url.includes('/apply')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when recovery inspect drifts from the minted auth envelope', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'application-password-basic', id: 'psh_01j00000000000000000000000' },
        },
        recovery: {
          state: 'available',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: { integrity: { status: 'ok' } },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/apply')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        receipt: { receiptHash: 'receipt-01' },
        responseSchemaVersion: 1,
        mode: 'apply',
        applied: 1,
        storageGuard: {
          boundary: 'filesystem-compare-rename',
          operation: 'update',
          outcome: 'applied',
        },
        signedRequest: {
          signed: true,
          schemaVersion: 1,
          contentHash: 'content-01',
          timestamp: '1716500000',
          nonceHash: 'nonce-01',
          sessionHash: 'session-01',
          signingKeyHash: 'signing-01',
          request: { plan: { id: 'plan-01' } },
        },
        idempotency: {
          replayed: true,
          freshMutationWork: false,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        dbJournal: { latestRows: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-06a',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'AUTH_SESSION_LIFECYCLE_DRIFT');
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
      durableJournal: {
        storageLeaseFence: 'retained Playground journal storage is lab-scoped; production ownership, lease fencing, and replay wiring are not yet proven on the checked release boundary',
        verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
        phase: 'recovery-inspect',
      },
    });
    assert.deepEqual(summary.authSession, {
      required: 'production-auth-session',
      observed: 'application-password-basic',
      verdict: 'AUTH_SESSION_LIFECYCLE_DRIFT',
    });
    assert.equal(seen.length, 5);
    assert.ok(seen.some(({ url }) => url.includes('/recovery/inspect')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when journal readback loses the production auth session status', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        recovery: {
          state: 'available',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: { integrity: { status: 'ok' } },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/apply')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        idempotency: {
          replayed: true,
          freshMutationWork: false,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'expired', id: 'psh_01j00000000000000000000000' },
        },
        dbJournal: { latestRows: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-07',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED');
    assert.deepEqual(summary.authSession, {
      required: 'production-auth-session',
      observed: 'production-auth-session',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    });
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
      durableJournal: {
        storageLeaseFence: 'retained Playground journal storage is lab-scoped; production ownership, lease fencing, and replay wiring are not yet proven on the checked release boundary',
        verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
        phase: 'journal-inspect',
      },
    });
    assert.ok(seen.some(({ url }) => url.includes('/db-journal')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when recovery inspect omits the auth envelope', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        recovery: {
          state: 'available',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: { integrity: { status: 'ok' } },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/apply')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        idempotency: {
          replayed: true,
          freshMutationWork: false,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify({
        ok: true,
        dbJournal: { latestRows: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-06b',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'AUTH_SESSION_LIFECYCLE_DRIFT');
    assert.equal(summary.recoveryInspect.authUser, undefined);
    assert.deepEqual(summary.authSession, {
      required: 'production-auth-session',
      observed: 'missing',
      verdict: 'AUTH_SESSION_LIFECYCLE_DRIFT',
    });
    assert.equal(summary.boundary.durableJournal.phase, 'recovery-inspect');
    assert.equal(seen.length, 5);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when recovery inspect returns a valid journal payload but omits auth', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        recovery: {
          state: 'available',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: { integrity: { status: 'ok' } },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/apply')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        idempotency: {
          replayed: true,
          freshMutationWork: false,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        dbJournal: { latestRows: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-06b',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'REPLAY_NOT_EQUIVALENT');
    assert.equal(summary.replayEquivalence?.equivalent, false);
    assert.ok(Array.isArray(summary.replayEquivalence?.mismatches));
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
      durableJournal: {
        storageLeaseFence: 'retained Playground journal storage is lab-scoped; production ownership, lease fencing, and replay wiring are not yet proven on the checked release boundary',
        verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
      phase: 'journal-inspect',
      },
    });
    assert.equal(seen.length, 8);
    assert.ok(seen.some(({ url }) => url.includes('/recovery/inspect')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push surfaces recovery session status in the proof summary', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        recovery: {
          state: 'available',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: { integrity: { status: 'ok' } },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/apply')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        idempotency: {
          replayed: true,
          freshMutationWork: false,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify({
        ok: true,
        dbJournal: { latestRows: [
          { event: 'idempotency-opened' },
          { event: 'mutation-applied' },
          { event: 'apply-committed' },
        ] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-06c',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.recoveryInspect.sessionStatus, 'active');
    assert.equal(summary.recoveryInspect.recovery.journalState, 'ok');
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when replay changes the auth session expiry', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            expiresAt: '2030-01-01T00:00:00Z',
            id: 'psh_01j00000000000000000000000',
          },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            expiresAt: '2030-01-01T00:00:00Z',
            id: 'psh_01j00000000000000000000000',
          },
        },
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            expiresAt: '2030-01-01T00:00:00Z',
            id: 'psh_01j00000000000000000000000',
          },
        },
        recovery: {
          state: 'available',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: { integrity: { status: 'ok' } },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/apply')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            expiresAt: '2030-01-01T00:00:00Z',
            id: 'psh_01j00000000000000000000000',
          },
        },
        idempotency: {
          replayed: false,
          freshMutationWork: true,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            expiresAt: '2030-01-01T00:00:00Z',
            id: 'psh_01j00000000000000000000000',
          },
        },
        dbJournal: {
          latestRows: [
            { event: 'idempotency-opened' },
            { event: 'mutation-applied' },
            { event: 'apply-committed' },
          ],
        },
        storageGuard: {
          boundary: 'filesystem-compare-rename',
          operation: 'update',
          outcome: 'applied',
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-06-expiry',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'REPLAY_NOT_EQUIVALENT');
    assert.equal(summary.replayEquivalence?.equivalent, false);
    assert.equal(summary.boundary.durableJournal.phase, 'replay');
    assert.equal(seen.length, 8);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when recovery inspect omits auth on an incomplete recovery payload', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        recovery: {
          state: 'available',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/apply')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        idempotency: {
          replayed: true,
          freshMutationWork: false,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        dbJournal: { latestRows: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-06c',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'AUTH_SESSION_LIFECYCLE_DRIFT');
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
      durableJournal: {
        storageLeaseFence: 'retained Playground journal storage is lab-scoped; production ownership, lease fencing, and replay wiring are not yet proven on the checked release boundary',
        verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
        phase: 'recovery-inspect',
      },
    });
    assert.ok(seen.some(({ url }) => url.includes('/recovery/inspect')));
    assert.ok(seen.some(({ url }) => url.includes('/apply')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when db journal readback lacks the apply commit proof', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/apply')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        signedRequest: {
          signed: true,
        },
        idempotency: {
          replayed: true,
          freshMutationWork: false,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        recovery: {
          state: 'available',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: { integrity: { status: 'ok' } },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify({
        ok: true,
        dbJournal: {
          latestRows: [
            { event: 'idempotency-opened' },
            { event: 'mutation-applied' },
          ],
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify({
        ok: true,
        dbJournal: { latestRows: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-08',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'AUTH_SESSION_LIFECYCLE_DRIFT');
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
      durableJournal: {
        storageLeaseFence: 'retained Playground journal storage is lab-scoped; production ownership, lease fencing, and replay wiring are not yet proven on the checked release boundary',
        verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
        phase: 'journal-inspect',
      },
    });
    assert.equal(seen.length, 8);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when db journal readback omits durable ownership evidence', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/apply')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        idempotency: {
          replayed: true,
          freshMutationWork: false,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        recovery: {
          state: 'available',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: { integrity: { status: 'ok' } },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        dbJournal: {
          latestRows: [
            { event: 'idempotency-opened' },
            { event: 'mutation-applied' },
            { event: 'apply-committed' },
          ],
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-08-storage-guard',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'REPLAY_NOT_EQUIVALENT');
    assert.equal(summary.replayEquivalence?.equivalent, false);
    assert.equal(summary.dbJournal?.storageGuard, undefined);
    assert.equal(summary.boundary.durableJournal.phase, 'journal-inspect');
    assert.equal(seen.length, 8);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when db journal readback omits the auth envelope', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/apply')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        idempotency: {
          replayed: true,
          freshMutationWork: false,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        recovery: {
          state: 'available',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: { integrity: { status: 'ok' } },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify({
        ok: true,
        dbJournal: {
          latestRows: [
            { event: 'idempotency-opened' },
            { event: 'mutation-applied' },
            { event: 'apply-committed' },
          ],
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify({
        ok: true,
        dbJournal: { latestRows: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-08b',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'AUTH_SESSION_LIFECYCLE_DRIFT');
    assert.equal(summary.dbJournal?.authUser, undefined);
    assert.equal(summary.boundary.durableJournal.phase, 'journal-inspect');
    assert.equal(seen.length, 8);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when recovery inspect reports a blocked journal state', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        recovery: {
          state: 'blocked-recovery',
          counts: { old: 0, new: 0, blockedUnknown: 1, total: 1 },
          journal: { integrity: { status: 'ok' } },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/apply')) {
      return new Response(JSON.stringify({
        ok: true,
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-04',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'RECOVERY_INSPECT_JOURNAL_UNTRUSTED');
    assert.equal(summary.recoveryInspect.recovery.state, 'blocked-recovery');
    assert.deepEqual(summary.recoveryInspect.recovery.counts, {
      old: 0,
      new: 0,
      blockedUnknown: 1,
      total: 1,
    });
    assert.equal(summary.recoveryInspect.recovery.journalState, 'ok');
    assert.equal(summary.recoveryInspect.authUser, 'reprint_push_admin');
    assert.equal(summary.recoveryInspect.authSessionId, 'psh_01j00000000000000000000000');
    assert.equal(summary.recoveryInspect.sessionType, 'production-auth-session');
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
      durableJournal: {
        storageLeaseFence: 'retained Playground journal storage is lab-scoped; production ownership, lease fencing, and replay wiring are not yet proven on the checked release boundary',
        verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
        phase: 'recovery-inspect',
      },
    });
    assert.equal(seen.length, 5);
    assert.ok(seen.some(({ url }) => url.includes('/recovery/inspect')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when apply drops the production auth session type', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/apply') && !pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'application-password-basic', id: 'psh_01j00000000000000000000000' },
        },
        idempotency: {
          replayed: true,
          freshMutationWork: false,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        recovery: {
          state: 'available',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: { integrity: { status: 'ok' } },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-07',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'AUTH_SESSION_LIFECYCLE_DRIFT');
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
      durableJournal: {
        storageLeaseFence: 'retained Playground journal storage is lab-scoped; production ownership, lease fencing, and replay wiring are not yet proven on the checked release boundary',
        verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
        phase: 'dry-run',
      },
    });
    assert.ok(!seen.some(({ url }) => url.includes('/apply')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when recovery inspect drops the production auth session status', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            id: 'psh_01j00000000000000000000000',
            status: 'active',
          },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/apply') && !pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            id: 'psh_01j00000000000000000000000',
            status: 'active',
          },
        },
        idempotency: {
          replayed: true,
          freshMutationWork: false,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            id: 'psh_01j00000000000000000000000',
            status: 'expired',
          },
        },
        recovery: {
          state: 'available',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: { integrity: { status: 'ok' } },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-08',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'AUTH_SESSION_LIFECYCLE_DRIFT');
    assert.equal(summary.boundary.durableJournal.phase, 'recovery-inspect');
    assert.equal(summary.recoveryInspect.sessionStatus, 'expired');
    assert.equal(seen.length, 5);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when recovery inspect reports blocked unknown rows', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        recovery: {
          state: 'available',
          counts: { old: 0, new: 1, blockedUnknown: 1, total: 2 },
          journal: { integrity: { status: 'ok' } },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/apply')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        idempotency: {
          replayed: true,
          freshMutationWork: false,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        dbJournal: { latestRows: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-09',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'RECOVERY_INSPECT_JOURNAL_UNTRUSTED');
    assert.equal(summary.recoveryInspect.recovery.journalState, 'ok');
    assert.deepEqual(summary.recoveryInspect.recovery.counts, {
      old: 0,
      new: 1,
      blockedUnknown: 1,
      total: 2,
    });
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
      durableJournal: {
        storageLeaseFence: 'retained Playground journal storage is lab-scoped; production ownership, lease fencing, and replay wiring are not yet proven on the checked release boundary',
        verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
        phase: 'recovery-inspect',
      },
    });
    assert.equal(seen.length, 5);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when recovery inspect omits trusted journal integrity', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/apply')) {
      return new Response(JSON.stringify({
        ok: true,
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-06',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'AUTH_SESSION_LIFECYCLE_DRIFT');
    assert.deepEqual(summary.recoveryInspect.recovery, undefined);
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
      durableJournal: {
        storageLeaseFence: 'retained Playground journal storage is lab-scoped; production ownership, lease fencing, and replay wiring are not yet proven on the checked release boundary',
        verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
        phase: 'recovery-inspect',
      },
    });
    assert.equal(seen.length, 5);
    assert.ok(seen.some(({ url }) => url.includes('/recovery/inspect')));
    assert.ok(seen.some(({ url }) => url.includes('/apply')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when recovery inspect returns a mismatched auth session', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', id: 'psh_01j00000000000000000000001' },
        },
        recovery: {
          state: 'available',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: { integrity: { status: 'ok' } },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/apply')) {
      return new Response(JSON.stringify({
        ok: true,
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-06a',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'AUTH_SESSION_LIFECYCLE_DRIFT');
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
      durableJournal: {
        storageLeaseFence: 'retained Playground journal storage is lab-scoped; production ownership, lease fencing, and replay wiring are not yet proven on the checked release boundary',
        verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
        phase: 'recovery-inspect',
      },
    });
    assert.equal(seen.length, 5);
    assert.ok(seen.some(({ url }) => url.includes('/recovery/inspect')));
    assert.ok(seen.some(({ url }) => url.includes('/apply')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when dry-run drifts from the minted auth envelope', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'application-password-basic', id: 'psh_01j00000000000000000000000' },
        },
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-05a',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'AUTH_SESSION_LIFECYCLE_DRIFT');
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
      durableJournal: {
        storageLeaseFence: 'retained Playground journal storage is lab-scoped; production ownership, lease fencing, and replay wiring are not yet proven on the checked release boundary',
        verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
        phase: 'dry-run',
      },
    });
    assert.equal(seen.length, 3);
    assert.ok(seen.some(({ url }) => url.includes('/dry-run')));
    assert.ok(!seen.some(({ url }) => url.includes('/apply')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when replay reopens fresh mutation work', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', id: 'psh_01j00000000000000000000000' },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        recovery: {
          state: 'available',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: { integrity: { status: 'ok' } },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/apply')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', id: 'psh_01j00000000000000000000000' },
        },
        idempotency: {
          replayed: true,
          freshMutationWork: true,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', id: 'psh_01j00000000000000000000000' },
        },
        dbJournal: { latestRows: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-05',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'AUTH_SESSION_LIFECYCLE_DRIFT');
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
      durableJournal: {
        storageLeaseFence: 'retained Playground journal storage is lab-scoped; production ownership, lease fencing, and replay wiring are not yet proven on the checked release boundary',
        verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
        phase: 'recovery-inspect',
      },
    });
    assert.ok(seen.some(({ url }) => url.includes('/recovery/inspect')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when replay omits the auth envelope', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  let applyCount = 0;
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', id: 'psh_01j00000000000000000000000' },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', id: 'psh_01j00000000000000000000000' },
        },
        recovery: {
          state: 'available',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: { integrity: { status: 'ok' } },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/apply')) {
      applyCount += 1;
      return new Response(JSON.stringify({
        ok: true,
        ...(applyCount === 1
          ? {
            auth: {
              identity: { userLogin: 'reprint_push_admin' },
              session: { type: 'production-auth-session', id: 'psh_01j00000000000000000000000' },
            },
          }
          : {}),
        idempotency: {
          replayed: true,
          freshMutationWork: false,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', id: 'psh_01j00000000000000000000000' },
        },
        dbJournal: { latestRows: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-06',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'AUTH_SESSION_LIFECYCLE_DRIFT');
    assert.equal(summary.boundary.verdict, 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED');
    assert.equal(summary.boundary.durableJournal.phase, 'replay');
    assert.ok(seen.some(({ url }) => url.includes('/apply')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when replay response diverges from the first apply response', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  let applyCount = 0;
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', id: 'psh_01j00000000000000000000000' },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', id: 'psh_01j00000000000000000000000' },
        },
        recovery: {
          state: 'available',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: { integrity: { status: 'ok' } },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/apply')) {
      applyCount += 1;
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: applyCount === 1 ? 'receipt-01' : 'receipt-02' },
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', id: 'psh_01j00000000000000000000000' },
        },
        signedRequest: {
          signed: true,
        },
        idempotency: {
          replayed: true,
          freshMutationWork: false,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify({
        ok: true,
        dbJournal: { latestRows: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-07',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'AUTH_SESSION_LIFECYCLE_DRIFT');
    assert.equal(summary.boundary.durableJournal.phase, 'journal-inspect');
    assert.ok(seen.some(({ url }) => url.includes('/apply')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when replay changes the authenticated envelope', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  let applyCount = 0;
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', id: 'psh_01j00000000000000000000000' },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', id: 'psh_01j00000000000000000000000' },
        },
        recovery: {
          state: 'available',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: { integrity: { status: 'ok' } },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/apply')) {
      applyCount += 1;
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
        auth: {
          identity: { userLogin: applyCount === 1 ? 'reprint_push_admin' : 'different-user' },
          session: { type: 'production-auth-session', id: 'psh_01j00000000000000000000000' },
        },
        signedRequest: {
          signed: true,
        },
        idempotency: {
          replayed: true,
          freshMutationWork: false,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify({
        ok: true,
        dbJournal: { latestRows: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-08',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'AUTH_SESSION_LIFECYCLE_DRIFT');
    assert.deepEqual(summary.authSession, {
      required: 'production-auth-session',
      observed: 'production-auth-session',
      verdict: 'AUTH_SESSION_LIFECYCLE_DRIFT',
    });
    assert.ok(!seen.some(({ url }) => url.includes('/db-journal')));
    assert.ok(seen.some(({ url }) => url.includes('/apply')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when replay changes the auth session status', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  let applyCount = 0;
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', id: 'psh_01j00000000000000000000000' },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', id: 'psh_01j00000000000000000000000' },
        },
        recovery: {
          state: 'available',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: { integrity: { status: 'ok' } },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/apply')) {
      applyCount += 1;
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            id: 'psh_01j00000000000000000000000',
            status: applyCount === 1 ? 'active' : 'expired',
          },
        },
        signedRequest: {
          signed: true,
        },
        idempotency: {
          replayed: true,
          freshMutationWork: false,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify({
        ok: true,
        dbJournal: { latestRows: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-10',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'AUTH_SESSION_LIFECYCLE_DRIFT');
    assert.ok(seen.some(({ url }) => url.includes('/apply')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when replay changes the idempotency envelope', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  let applyCount = 0;
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', id: 'psh_01j00000000000000000000000' },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', id: 'psh_01j00000000000000000000000' },
        },
        recovery: {
          state: 'available',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: { integrity: { status: 'ok' } },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/apply')) {
      applyCount += 1;
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
        responseSchemaVersion: 1,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        signedRequest: {
          signed: true,
        },
        idempotency: {
          replayed: true,
          freshMutationWork: false,
          status: applyCount === 1 ? 'opened' : 'replayed',
          conflict: false,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify({
        ok: true,
        dbJournal: { latestRows: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-09',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'AUTH_SESSION_LIFECYCLE_DRIFT');
    assert.ok(seen.some(({ url }) => url.includes('/apply')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when replay changes signed request evidence', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  let applyCount = 0;
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', id: 'psh_01j00000000000000000000000' },
        },
        recovery: {
          state: 'available',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: { integrity: { status: 'ok' } },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/apply')) {
      applyCount += 1;
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
        responseSchemaVersion: 1,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        signedRequest: applyCount === 1
          ? {
            signed: true,
            schemaVersion: 1,
            contentHash: 'content-hash-01',
            timestamp: '2026-05-26T00:00:00.000Z',
            nonceHash: 'nonce-hash-01',
            sessionHash: 'session-hash-01',
            signingKeyHash: 'signing-key-hash-01',
            request: { method: 'POST', path: '/wp-json/reprint/v1/push/apply' },
          }
          : {
            signed: true,
            schemaVersion: 1,
            contentHash: 'content-hash-02',
            timestamp: '2026-05-26T00:00:00.000Z',
            nonceHash: 'nonce-hash-01',
            sessionHash: 'session-hash-01',
            signingKeyHash: 'signing-key-hash-01',
            request: { method: 'POST', path: '/wp-json/reprint/v1/push/apply' },
          },
        idempotency: {
          replayed: true,
          freshMutationWork: false,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify({
        ok: true,
        dbJournal: { latestRows: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-11',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'AUTH_SESSION_LIFECYCLE_DRIFT');
    assert.equal(summary.replay?.signedRequest?.contentHash, undefined);
    assert.ok(seen.some(({ url }) => url.includes('/apply')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when replay changes the canonical response mode or storage guard', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  let applyCount = 0;
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', id: 'psh_01j00000000000000000000000' },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', id: 'psh_01j00000000000000000000000' },
        },
        recovery: {
          state: 'available',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: { integrity: { status: 'ok' } },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/apply')) {
      applyCount += 1;
      return new Response(JSON.stringify({
        ok: true,
        mode: applyCount === 1 ? 'apply' : 'replay',
        receipt: { receiptHash: 'receipt-01' },
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', id: 'psh_01j00000000000000000000000' },
        },
        signedRequest: {
          signed: true,
        },
        storageGuard: applyCount === 1
          ? {
            boundary: 'retained-playground-journal',
            operation: 'write',
            outcome: 'allowed',
          }
          : {
            boundary: 'retained-playground-journal',
            operation: 'write',
            outcome: 'blocked',
          },
        idempotency: {
          replayed: true,
          freshMutationWork: false,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify({
        ok: true,
        dbJournal: { latestRows: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-10',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'AUTH_SESSION_LIFECYCLE_DRIFT');
    assert.deepEqual(summary.authSession, {
      required: 'production-auth-session',
      observed: 'missing',
      verdict: 'AUTH_SESSION_LIFECYCLE_DRIFT',
    });
    assert.ok(seen.some(({ url }) => url.includes('/apply')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when replay changes the response schema version', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  let applyCount = 0;
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', id: 'psh_01j00000000000000000000000' },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', id: 'psh_01j00000000000000000000000' },
        },
        recovery: {
          state: 'available',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: { integrity: { status: 'ok' } },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/apply')) {
      applyCount += 1;
      return new Response(JSON.stringify({
        ok: true,
        mode: 'apply',
        responseSchemaVersion: applyCount === 1 ? 1 : 2,
        receipt: { receiptHash: 'receipt-01' },
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', id: 'psh_01j00000000000000000000000' },
        },
        signedRequest: {
          signed: true,
        },
        storageGuard: {
          boundary: 'retained-playground-journal',
          operation: 'write',
          outcome: 'allowed',
        },
        idempotency: {
          replayed: true,
          freshMutationWork: false,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify({
        ok: true,
        dbJournal: { latestRows: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-10a',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'AUTH_SESSION_LIFECYCLE_DRIFT');
    assert.equal(summary.replay?.responseSchemaVersion, 2);
    assert.ok(seen.some(({ url }) => url.includes('/apply')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when replay omits the response schema version', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  let applyCount = 0;
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        recovery: {
          state: 'available',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: { integrity: { status: 'ok' } },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/apply')) {
      applyCount += 1;
      return new Response(JSON.stringify({
        ok: true,
        mode: 'apply',
        receipt: { receiptHash: 'receipt-01' },
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        signedRequest: {
          signed: true,
        },
        storageGuard: {
          boundary: 'retained-playground-journal',
          operation: 'write',
          outcome: 'allowed',
        },
        idempotency: {
          replayed: true,
          freshMutationWork: false,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify({
        ok: true,
        dbJournal: { latestRows: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-10b',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'AUTH_SESSION_LIFECYCLE_DRIFT');
    assert.equal(summary.replay?.responseSchemaVersion, undefined);
    assert.ok(seen.some(({ url }) => url.includes('/apply')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when replay changes the minted session id', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  let applyCount = 0;
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', id: 'psh_01j00000000000000000000000' },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        recovery: {
          state: 'available',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: { integrity: { status: 'ok' } },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/apply')) {
      applyCount += 1;
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', id: applyCount === 1 ? 'psh_01j00000000000000000000000' : 'psh_01j00000000000000000000099' },
        },
        signedRequest: {
          signed: true,
        },
        idempotency: {
          replayed: true,
          freshMutationWork: false,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify({
        ok: true,
        dbJournal: { latestRows: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-09',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'AUTH_SESSION_LIFECYCLE_DRIFT');
    assert.ok(!seen.some(({ url }) => url.includes('/db-journal')));
    assert.ok(seen.some(({ url }) => url.includes('/apply')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when apply changes the authenticated session envelope before replay', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  let applyCount = 0;
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', id: 'psh_01j00000000000000000000000' },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        recovery: {
          state: 'available',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: { integrity: { status: 'ok' } },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/apply')) {
      applyCount += 1;
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
        auth: {
          identity: { userLogin: applyCount === 1 ? 'reprint_push_admin' : 'reprint_push_admin' },
          session: {
            type: applyCount === 1 ? 'production-auth-session' : 'application-password-basic',
            id: 'psh_01j00000000000000000000000',
          },
        },
        signedRequest: {
          signed: true,
        },
        idempotency: {
          replayed: true,
          freshMutationWork: false,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify({
        ok: true,
        dbJournal: { latestRows: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-09',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'AUTH_SESSION_LIFECYCLE_DRIFT');
    assert.equal(summary.code, 'AUTH_SESSION_LIFECYCLE_DRIFT');
    assert.ok(seen.some(({ url }) => url.includes('/apply')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when durable journal readback is unavailable after apply', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', id: 'psh_01j00000000000000000000000' },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        recovery: {
          state: 'available',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: { integrity: { status: 'ok' } },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/apply')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', id: 'psh_01j00000000000000000000000' },
        },
        idempotency: {
          replayed: true,
          freshMutationWork: false,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify({
        ok: false,
        code: 'DURABLE_JOURNAL_UNAVAILABLE',
      }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-06',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'AUTH_SESSION_LIFECYCLE_DRIFT');
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
      durableJournal: {
        storageLeaseFence: 'retained Playground journal storage is lab-scoped; production ownership, lease fencing, and replay wiring are not yet proven on the checked release boundary',
        verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
        phase: 'recovery-inspect',
      },
    });
    assert.ok(!seen.some(({ url }) => url.includes('/db-journal?limit=80')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when durable journal readback omits the auth envelope after apply', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', id: 'psh_01j00000000000000000000000' },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', id: 'psh_01j00000000000000000000000' },
        },
        recovery: {
          state: 'available',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: { integrity: { status: 'ok' } },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/apply')) {
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
        responseSchemaVersion: 1,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', status: 'active', id: 'psh_01j00000000000000000000000' },
        },
        signedRequest: {
          signed: true,
        },
        idempotency: {
          replayed: true,
          freshMutationWork: false,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify({
        ok: true,
        dbJournal: {
          latestRows: [
            { event: 'apply-committed' },
            { event: 'idempotency-opened' },
            { event: 'mutation-applied' },
          ],
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-06d',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'AUTH_SESSION_LIFECYCLE_DRIFT');
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
      durableJournal: {
        storageLeaseFence: 'retained Playground journal storage is lab-scoped; production ownership, lease fencing, and replay wiring are not yet proven on the checked release boundary',
        verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
        phase: 'replay',
      },
    });
    assert.ok(!seen.some(({ url }) => url.includes('/db-journal?limit=80')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when replay drops the production auth session type', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  let applyCount = 0;
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', id: 'psh_01j00000000000000000000000' },
        },
        session: { id: 'psh_01j00000000000000000000000' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: { type: 'production-auth-session', id: 'psh_01j00000000000000000000000' },
        },
        recovery: {
          state: 'available',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: { integrity: { status: 'ok' } },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/apply')) {
      applyCount += 1;
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: applyCount === 1 ? 'production-auth-session' : 'application-password-basic',
            id: 'psh_01j00000000000000000000000',
          },
        },
        signedRequest: {
          signed: true,
        },
        idempotency: {
          replayed: true,
          freshMutationWork: false,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify({
        ok: true,
        dbJournal: { latestRows: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-10',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'AUTH_SESSION_LIFECYCLE_DRIFT');
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
      durableJournal: {
        storageLeaseFence: 'retained Playground journal storage is lab-scoped; production ownership, lease fencing, and replay wiring are not yet proven on the checked release boundary',
        verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
        phase: 'replay',
      },
    });
    assert.ok(seen.some(({ url }) => url.includes('/apply')));
  } finally {
    global.fetch = originalFetch;
  }
});
