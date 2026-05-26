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

test('authenticated push client fails closed for production-shaped loopback ports outside the sandbox ingress', () => {
  assert.throws(
    () => authenticatedHttpClient({
      sourceUrl: 'http://127.0.0.1:3000',
      credential,
      routeProfile: 'production-shaped',
    }),
    /Unsupported production-shaped sourceUrl origin: http:\/\/127\.0\.0\.1:3000/,
  );
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
    assert.deepEqual(summary.authSession, {
      required: 'production-auth-session',
      observed: 'application-password-basic',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    });
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
        receipt: { receiptHash: 'receipt-01' },
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
    assert.equal(summary.code, 'REPLAY_NOT_IDEMPOTENT');
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
    assert.ok(seen.some(({ url }) => url.includes('/db-journal?limit=80')));
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
    assert.equal(summary.code, 'RECOVERY_INSPECT_BLOCKED');
    assert.deepEqual(summary.recoveryInspect.recovery, {
      state: 'blocked-recovery',
      counts: { old: 0, new: 0, blockedUnknown: 1, total: 1 },
      journalState: 'ok',
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
    assert.ok(seen.some(({ url }) => url.includes('/recovery/inspect')));
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
    assert.equal(summary.code, 'REPLAY_NOT_EQUIVALENT');
    assert.deepEqual(summary.replay.idempotency, {
      replayed: true,
      freshMutationWork: true,
      status: undefined,
      conflict: false,
    });
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
    assert.ok(seen.some(({ url }) => url.includes('/recovery/inspect')));
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
    assert.equal(summary.code, 'REPLAY_NOT_EQUIVALENT');
    assert.deepEqual(summary.replay.idempotency, {
      replayed: true,
      freshMutationWork: false,
      status: undefined,
      conflict: false,
    });
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
    assert.equal(summary.replay.authUser, 'different-user');
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
    assert.equal(summary.replay.authSessionId, 'psh_01j00000000000000000000099');
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
    assert.deepEqual(summary.apply.authUser, 'reprint_push_admin');
    assert.deepEqual(summary.replay.authSessionId, 'psh_01j00000000000000000000000');
    assert.equal(summary.replay.sessionType, 'application-password-basic');
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
    assert.equal(summary.code, 'DURABLE_JOURNAL_UNAVAILABLE');
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
    assert.ok(seen.some(({ url }) => url.includes('/db-journal?limit=80')));
  } finally {
    global.fetch = originalFetch;
  }
});
