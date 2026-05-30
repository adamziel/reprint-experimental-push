import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import {
  authenticatedHttpClient,
  dbJournalReadbackLimitForPlan,
  dbJournalProofIsAcceptable,
  inferTrustedDbJournalStorageGuard,
  resolveUncheckedObservedAuthSessionMetadataDrift,
  resolveAuthenticatedHttpPushSource,
  runAuthenticatedHttpPush,
} from '../src/authenticated-http-push-client.js';
import { recoveryClaimHash } from '../src/recovery-journal.js';
import { digest } from '../src/stable-json.js';

const credential = {
  username: 'reprint_push_admin',
  password: 'reprint-push-admin-app-password',
};

const trustedDbJournalScope = 'checked live production-shaped journal surface; not local Playground fixture only';
const emptyBodySha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function hmacHex(key, data) {
  return createHmac('sha256', key).update(data, 'utf8').digest('hex');
}

function sha256Hex(data) {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

test('db journal readback window scales with mutation count', () => {
  assert.equal(dbJournalReadbackLimitForPlan({ mutations: [] }), 80);
  assert.equal(dbJournalReadbackLimitForPlan({ mutations: Array.from({ length: 9 }, () => ({})) }), 80);
  assert.equal(dbJournalReadbackLimitForPlan({ mutations: Array.from({ length: 25 }, () => ({})) }), 370);
  assert.equal(dbJournalReadbackLimitForPlan({ mutations: Array.from({ length: 35 }, () => ({})) }), 470);
  assert.equal(dbJournalReadbackLimitForPlan({ mutations: Array.from({ length: 300 }, () => ({})) }), 500);
});

function buildApplyRevalidationEvidence(plan, receipt, claimId, claimHash) {
  const mutations = Array.isArray(plan?.mutations) ? plan.mutations : [];
  const preconditions = Array.isArray(plan?.preconditions) ? plan.preconditions : [];

  return {
    schemaVersion: 1,
    required: 'fresh-live-hashes-before-first-mutation',
    phase: 'before-first-mutation',
    checkedAgainst: 'live-remote',
    planHash: receipt?.planHash || digest(plan),
    receiptHash: receipt?.receiptHash || null,
    preconditionSetHash: digest(preconditions.map((precondition) => ({
      mutationId: String(precondition?.mutationId || ''),
      resourceKey: String(precondition?.resourceKey || ''),
      resource: precondition?.resource,
      expectedHash: String(precondition?.expectedHash || ''),
    }))),
    mutationSetHash: digest(mutations.map((mutation) => ({
      id: String(mutation?.id || ''),
      resourceKey: String(mutation?.resourceKey || ''),
      resource: mutation?.resource,
      action: mutation?.action ?? null,
      changeKind: mutation?.changeKind ?? null,
      baseHash: mutation?.baseHash ?? null,
      remoteBeforeHash: mutation?.remoteBeforeHash ?? null,
      localHash: mutation?.localHash ?? null,
    }))),
    mutationCount: mutations.length,
    verifiedCount: mutations.length,
    verifiedResourceKeys: mutations.map((mutation) => String(mutation.resourceKey || '')),
    claim: {
      activeClaimId: claimId,
      activeClaimKeyHash: claimHash,
      activeClaimSequence: 1,
      staleClaimRetry: false,
    },
  };
}

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

test('unchecked auth-session metadata drift fails closed on hidden revoked or cleaned-up production sessions', () => {
  assert.deepEqual(
    resolveUncheckedObservedAuthSessionMetadataDrift(
      { sessionType: 'production-auth-session' },
      {
        body: {
          auth: {
            session: {
              type: 'production-auth-session',
              status: 'active',
              revoked: true,
            },
          },
        },
      },
    ),
    {
      field: 'auth.session.status',
      required: 'unrevoked',
      observed: 'revoked',
      verdict: 'AUTH_SESSION_LIFECYCLE_DRIFT',
    },
  );

  assert.deepEqual(
    resolveUncheckedObservedAuthSessionMetadataDrift(
      { sessionType: 'production-auth-session' },
      {
        body: {
          auth: {
            session: {
              type: 'production-auth-session',
              status: 'active',
              cleanedUp: true,
            },
          },
        },
      },
    ),
    {
      field: 'auth.session.cleanedUp',
      required: 'unrevoked',
      observed: 'cleaned-up',
      verdict: 'AUTH_SESSION_LIFECYCLE_DRIFT',
    },
  );
});

test('authenticated push client fails closed for insecure remote production-shaped origins', () => {
  assert.throws(
    () => authenticatedHttpClient({
      sourceUrl: 'http://example.com',
      credential,
      routeProfile: 'production-shaped',
    }),
    /Unsupported production-shaped sourceUrl origin: http:\/\/example\.com/,
  );
});

test('authenticated push client accepts https production-shaped origins', () => {
  const client = authenticatedHttpClient({
    sourceUrl: 'https://example.com',
    credential,
    routeProfile: 'production-shaped',
    requestTimeoutMs: 1,
  });
  assert.equal(typeof client.get, 'function');
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

test('authenticated push client allows production-shaped https loopback runtime ports', () => {
  const client = authenticatedHttpClient({
    sourceUrl: 'https://127.0.0.1:3443',
    credential,
    routeProfile: 'production-shaped',
    requestTimeoutMs: 1,
  });
  assert.equal(typeof client.get, 'function');
});

test('authenticated push client allows production-shaped ipv6 loopback runtime ports', () => {
  const client = authenticatedHttpClient({
    sourceUrl: 'http://[::1]:3000',
    credential,
    routeProfile: 'production-shaped',
    requestTimeoutMs: 1,
  });
  assert.equal(typeof client.get, 'function');
});

test('db journal proof requires stale claim rejection when explicitly requested', () => {
  const proof = {
    scope: trustedDbJournalScope,
    applyCommitted: true,
    idempotencyOpened: 1,
    mutationApplied: 1,
    storageGuard: {
      boundary: 'wpdb-single-statement-cas',
      operation: 'update',
      outcome: 'applied',
    },
    ownership: {
      ownsJournal: true,
      restartReadable: true,
      productionAdapter: 'wpdb-single-statement-cas',
      supportedSurface: 'claim-fenced-restart-readable',
    },
    leaseFence: {
      boundary: 'wpdb-single-statement-cas',
      claimKeyUnique: true,
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: false,
    },
  };

  assert.equal(dbJournalProofIsAcceptable(proof), true);
  assert.equal(
    dbJournalProofIsAcceptable(proof, { requireStaleClaimRejected: true }),
    false,
  );
  proof.leaseFence.staleClaimRejected = true;
  assert.equal(
    dbJournalProofIsAcceptable(proof, { requireStaleClaimRejected: true }),
    true,
  );
});

test('db journal summary infers a trusted storage guard from the checked boundary contract', () => {
  const proof = {
    ownership: {
      ownsJournal: true,
      restartReadable: true,
      productionAdapter: 'wpdb-single-statement-cas',
      supportedSurface: 'claim-fenced-restart-readable',
    },
    writerLease: {
      storageGuard: 'wpdb-single-statement-cas',
    },
    leaseFence: {
      boundary: 'wpdb-single-statement-cas',
      writerLease: {
        storageGuard: 'wpdb-single-statement-cas',
      },
    },
  };

  assert.deepEqual(inferTrustedDbJournalStorageGuard(proof), {
    boundary: 'wpdb-single-statement-cas',
    operation: 'update',
    outcome: 'applied',
  });

  proof.leaseFence.boundary = 'filesystem-compare-rename';
  assert.equal(inferTrustedDbJournalStorageGuard(proof), undefined);
});

test('db journal proof requires the checked durable-journal contract when explicitly requested', () => {
  const proof = {
    scope: 'packaged production plugin journal surface; not local Playground fixture only',
    applyCommitted: true,
    idempotencyOpened: 1,
    mutationApplied: 1,
    storageGuard: {
      boundary: 'wpdb-single-statement-cas',
      operation: 'update',
      outcome: 'applied',
    },
    ownership: {
      ownsJournal: true,
      restartReadable: true,
      productionAdapter: 'wpdb-single-statement-cas',
      supportedSurface: 'claim-fenced-restart-readable',
    },
    writerLease: {
      strategy: 'claim-fenced-single-writer',
      claimId: 'psh_01j00000000000000000000000',
      claimKeyHash: 'psh_01j00000000000000000000000',
      claimKeyUnique: true,
      fsyncEvidence: true,
      storageGuard: 'wpdb-single-statement-cas',
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: false,
    },
    leaseFence: {
      boundary: 'wpdb-single-statement-cas',
      storageGuard: 'wpdb-single-statement-cas',
      claimKeyUnique: true,
      fsyncEvidence: true,
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: false,
      writerLease: {
        strategy: 'claim-fenced-single-writer',
        claimId: 'psh_01j00000000000000000000000',
        claimKeyHash: 'psh_01j00000000000000000000000',
        claimKeyUnique: true,
        fsyncEvidence: true,
        storageGuard: 'wpdb-single-statement-cas',
        monotonicSequence: true,
        restartReadable: true,
        staleClaimRejected: false,
      },
    },
    claim: {
      status: 'stale-claim-rejected',
      activeClaimId: 'psh_01j00000000000000000000000',
      activeClaimKeyHash: 'psh_01j00000000000000000000000',
      activeClaimSequence: 2,
      activeClaimEvent: 'stale-claim-rejected',
      previousClaimId: 'psh_01i99999999999999999999999',
      previousClaimKeyHash: 'psh_01i99999999999999999999999',
      previousClaimSequence: 1,
      previousClaimEvent: 'recovery-claim-opened',
      previousStartedSequence: null,
      abandonedSequence: null,
      abandonedEvent: null,
      idempotencyKeyHash: 'idempotency-claim-01',
      requestHash: 'request-claim-01',
      planHash: 'plan-claim-01',
      receiptHash: 'receipt-claim-01',
      planFingerprint: 'plan-fingerprint-01',
      mutationCount: 1,
      appliedCount: 1,
      staleClaimRejected: false,
    },
  };

  assert.equal(dbJournalProofIsAcceptable(proof), true);
  assert.equal(
    dbJournalProofIsAcceptable(proof, { requireCheckedBoundary: true }),
    false,
  );
  proof.writerLease.claimKeyHash = 'unexpected-claim-key-hash';
  proof.leaseFence.staleClaimRejected = true;
  proof.leaseFence.writerLease.staleClaimRejected = true;
  proof.claim.staleClaimRejected = true;
  assert.equal(
    dbJournalProofIsAcceptable(proof, { requireCheckedBoundary: true }),
    false,
  );
  proof.writerLease.claimKeyHash = 'psh_01j00000000000000000000000';
  proof.leaseFence.writerLease.claimKeyHash = 'unexpected-claim-key-hash';
  assert.equal(
    dbJournalProofIsAcceptable(proof, { requireCheckedBoundary: true }),
    false,
  );
  proof.leaseFence.writerLease.claimKeyHash = 'psh_01j00000000000000000000000';
  proof.writerLease.staleClaimRejected = true;
  assert.equal(
    dbJournalProofIsAcceptable(proof, { requireCheckedBoundary: true }),
    true,
  );
});

test('db journal proof fails closed for fixture-scoped checked contracts', () => {
  const proof = {
    scope: 'local Playground fixture only; not production durability',
    applyCommitted: true,
    idempotencyOpened: 1,
    mutationApplied: 1,
    storageGuard: {
      boundary: 'wpdb-single-statement-cas',
      operation: 'update',
      outcome: 'applied',
    },
    ownership: {
      ownsJournal: true,
      restartReadable: true,
      productionAdapter: 'wpdb-single-statement-cas',
      supportedSurface: 'claim-fenced-restart-readable',
    },
    leaseFence: {
      boundary: 'wpdb-single-statement-cas',
      claimKeyUnique: true,
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: true,
    },
  };

  assert.equal(dbJournalProofIsAcceptable(proof), false);
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

test('authenticated push source rejects an auth/session source for a different checked source URL', () => {
  assert.throws(
    () => resolveAuthenticatedHttpPushSource({
      sourceUrl: 'http://127.0.0.1:9090',
      username: 'trusted-runtime-username',
      applicationPassword: 'trusted-runtime-password',
      authSessionSource: {
        ok: true,
        sourceUrl: 'http://127.0.0.1:8080',
        username: 'reprint_push_admin',
        applicationPassword: 'reprint-push-admin-app-password',
      },
    }),
    /Auth session source URL does not match checked sourceUrl/,
  );
});

test('authenticated push source does not mix partial auth/session source fields with direct credentials', () => {
  assert.deepEqual(
    resolveAuthenticatedHttpPushSource({
      sourceUrl: 'http://127.0.0.1:9090',
      username: 'trusted-runtime-username',
      applicationPassword: 'trusted-runtime-password',
      authSessionSource: {
        ok: true,
        sourceUrl: 'http://127.0.0.1:8080',
        username: 'reprint_push_admin',
        applicationPassword: '',
      },
    }),
    {
      sourceUrl: 'http://127.0.0.1:9090',
      username: 'trusted-runtime-username',
      applicationPassword: 'trusted-runtime-password',
    },
  );
});

test('authenticated push source accepts https auth/session source URLs', () => {
  assert.deepEqual(
    resolveAuthenticatedHttpPushSource({
      sourceUrl: '',
      username: '',
      applicationPassword: '',
      authSessionSource: {
        ok: true,
        sourceUrl: 'https://example.com',
        username: 'reprint_push_admin',
        applicationPassword: 'reprint-push-admin-app-password',
      },
    }),
    {
      sourceUrl: 'https://example.com',
      username: 'reprint_push_admin',
      applicationPassword: 'reprint-push-admin-app-password',
    },
  );
});

test('authenticated push source accepts ipv6 loopback auth/session source URLs', () => {
  assert.deepEqual(
    resolveAuthenticatedHttpPushSource({
      sourceUrl: '',
      username: '',
      applicationPassword: '',
      authSessionSource: {
        ok: true,
        sourceUrl: 'http://[::1]:8080',
        username: 'reprint_push_admin',
        applicationPassword: 'reprint-push-admin-app-password',
      },
    }),
    {
      sourceUrl: 'http://[::1]:8080',
      username: 'reprint_push_admin',
      applicationPassword: 'reprint-push-admin-app-password',
    },
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

    const proof = await client.signedPost('/apply', { plan: { id: 'plan-01' } }, {
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

test('authenticated push client signs recovery inspect as a read-only session-bound request', async () => {
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
      readOnly: true,
      retryable: true,
    });

    assert.equal(proof.status, 200);
    assert.deepEqual(proof.body, { ok: true });
    assert.equal(proof.request.retryable, true);
    assert.equal(seen.length, 1);
    const headerEntries = Object.entries(seen[0].options.headers).reduce((acc, [key, value]) => {
      acc[key.toLowerCase()] = value;
      return acc;
    }, {});
    assert.match(headerEntries['x-reprint-push-session'], /^psh_/);
    assert.equal(headerEntries['x-reprint-push-idempotency-key'], undefined);
    assert.equal(typeof headerEntries['x-reprint-push-signature'], 'string');
  } finally {
    global.fetch = originalFetch;
  }
});

test('authenticated push client rejects mutating idempotency keys on read-only inspect requests', () => {
  const client = authenticatedHttpClient({
    sourceUrl: 'http://127.0.0.1:8080',
    credential,
    routeProfile: 'production-shaped',
    requestTimeoutMs: 1,
  });

  assert.throws(
    () => client.signedPost('/recovery/inspect', { plan: { id: 'plan-01' } }, {
      session: 'psh_01j00000000000000000000000',
      readOnly: true,
      idempotencyKey: 'idem-read-only-inspect',
    }),
    /Read-only signed request must not carry push idempotencyKey: \/wp-json\/reprint\/v1\/push\/recovery\/inspect/,
  );
  assert.throws(
    () => client.signedGet('/db-journal?limit=80', {
      session: 'psh_01j00000000000000000000000',
      readOnly: true,
      idempotencyKey: 'idem-read-only-journal',
    }),
    /Read-only signed request must not carry push idempotencyKey: \/wp-json\/reprint\/v1\/push\/db-journal\?limit=80/,
  );
  assert.throws(
    () => client.signedGet('/db-journal?limit=80', {
      readOnly: true,
    }),
    /Missing push session for read-only signed request: \/wp-json\/reprint\/v1\/push\/db-journal\?limit=80/,
  );
});

test('authenticated push client signs journal inspect reads without a mutating idempotency key', async () => {
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

    const proof = await client.signedGet('/db-journal?limit=80', {
      session: 'psh_01j00000000000000000000000',
      readOnly: true,
      retryable: true,
    });

    assert.equal(proof.status, 200);
    assert.deepEqual(proof.body, { ok: true });
    assert.equal(seen.length, 1);
    const headerEntries = Object.entries(seen[0].options.headers).reduce((acc, [key, value]) => {
      acc[key.toLowerCase()] = value;
      return acc;
    }, {});
    assert.match(headerEntries['x-reprint-push-session'], /^psh_/);
    assert.equal(headerEntries['x-reprint-push-idempotency-key'], undefined);
    assert.equal(headerEntries['x-auth-content-hash'], emptyBodySha256);
  } finally {
    global.fetch = originalFetch;
  }
});

test('authenticated push client canonicalizes signed query strings before HMAC signing', async () => {
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
    const session = 'psh_01j00000000000000000000000';
    const fixedSignatureOptions = {
      session,
      timestamp: '1716500000',
      nonce: 'cli-push-fixed-canonicalization',
    };

    await client.signedGet('/db-journal?z=1&a=2', fixedSignatureOptions);
    await client.signedGet('/db-journal?a=2&z=1', fixedSignatureOptions);

    const signatures = seen.map(({ options }) => options.headers['X-Reprint-Push-Signature']);
    assert.equal(signatures[0], signatures[1]);
    const signingKey = hmacHex(credential.password, `reprint-push-lab-v1\n${credential.username}`);
    const expectedCanonical = [
      'REPRINT-PUSH-LAB-V1',
      'GET',
      '/wp-json/reprint/v1/push/db-journal',
      'a=2&z=1',
      emptyBodySha256,
      session,
      '',
    ].join('\n');
    assert.equal(signatures[0], hmacHex(signingKey, expectedCanonical));
  } finally {
    global.fetch = originalFetch;
  }
});

test('authenticated push client accepts packaged production auth/session ids for mutating requests', async () => {
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

    const packagedSessionId = '-R2jo6X1bZ1_avkAxWHdCABlhgB6gufgoL-3B6U4r-E';
    const proof = await client.signedPost('/dry-run', { plan: { id: 'plan-01' } }, {
      session: packagedSessionId,
      idempotencyKey: 'idem-packaged-01',
    });

    assert.equal(proof.status, 200);
    assert.deepEqual(proof.body, { ok: true });
    assert.equal(seen.length, 1);
    const headerEntries = Object.entries(seen[0].options.headers).reduce((acc, [key, value]) => {
      acc[key.toLowerCase()] = value;
      return acc;
    }, {});
    assert.equal(headerEntries['x-reprint-push-session'], packagedSessionId);
    assert.equal(headerEntries['x-reprint-push-idempotency-key'], 'idem-packaged-01');
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
    assert.notEqual(seen[0].options.headers['X-Auth-Nonce'], seen[1].options.headers['X-Auth-Nonce']);
    assert.equal(seen[0].options.headers['X-Reprint-Push-Idempotency-Key'], 'idem-01');
    assert.equal(seen[1].options.headers['X-Reprint-Push-Idempotency-Key'], 'idem-01');
  } finally {
    global.fetch = originalFetch;
  }
});

test('authenticated push client retries idempotent signed posts after a transient timeout', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  let attempt = 0;
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    attempt += 1;
    if (attempt === 1) {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
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
      idempotencyKey: 'idem-01-timeout',
    });

    assert.equal(proof.status, 200);
    assert.deepEqual(proof.body, { ok: true, attempt: 2 });
    assert.equal(seen.length, 2);
    assert.notEqual(seen[0].options.headers['X-Auth-Nonce'], seen[1].options.headers['X-Auth-Nonce']);
    assert.equal(seen[0].options.headers['X-Reprint-Push-Idempotency-Key'], 'idem-01-timeout');
    assert.equal(seen[1].options.headers['X-Reprint-Push-Idempotency-Key'], 'idem-01-timeout');
  } finally {
    global.fetch = originalFetch;
  }
});

test('authenticated push client retries read-only signed recovery inspect with a regenerated nonce', async () => {
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

    const proof = await client.signedPost('/recovery/inspect', { plan: { id: 'plan-01' } }, {
      session: 'psh_01j00000000000000000000000',
      readOnly: true,
      retryable: true,
      nonce: 'cli-push-fixed-recovery-inspect',
      timestamp: '1716500000',
    });

    assert.equal(proof.status, 200);
    assert.deepEqual(proof.body, { ok: true, attempt: 2 });
    assert.equal(seen.length, 2);
    assert.equal(seen[0].options.headers['X-Auth-Nonce'], 'cli-push-fixed-recovery-inspect');
    assert.match(seen[1].options.headers['X-Auth-Nonce'], /^cli-push-fixed-recovery-inspect-retry-2-/);
    assert.equal(seen[0].options.headers['X-Reprint-Push-Idempotency-Key'], undefined);
    assert.equal(seen[1].options.headers['X-Reprint-Push-Idempotency-Key'], undefined);
  } finally {
    global.fetch = originalFetch;
  }
});

test('authenticated push executor can run recovery and journal inspect as idempotency-free signed reads', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  let applyCount = 0;
  const auth = {
    identity: { userLogin: 'reprint_push_admin' },
    session: {
      type: 'production-auth-session',
      status: 'active',
      id: 'psh_01j00000000000000000000000',
      expiresAt: '2030-01-01T00:00:00Z',
    },
  };
  const storageGuard = {
    boundary: 'filesystem-compare-rename',
    operation: 'update',
    outcome: 'applied',
  };

  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth,
        session: { id: auth.session.id },
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
        auth,
        receipt: { receiptHash: 'receipt-read-only-inspect-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        auth,
        recovery: {
          state: 'ok',
          journal: { integrity: { status: 'ok' } },
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
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
        applied: 0,
        code: applyCount === 1 ? 'APPLIED' : 'BATCH_ALREADY_COMMITTED',
        responseSchemaVersion: 1,
        auth,
        ...(applyCount === 1 ? { receipt: { receiptHash: 'receipt-read-only-inspect-01' } } : {}),
        storageGuard,
        signedRequest: {
          signed: true,
          schemaVersion: 1,
          contentHash: 'content-read-only-inspect-01',
          timestamp: '2026-05-28T00:00:00.000Z',
          nonceHash: `nonce-${applyCount}`,
          sessionHash: 'session-read-only-inspect-01',
          signingKeyHash: 'signing-key-read-only-inspect-01',
          request: { plan: 'empty' },
        },
        idempotency: {
          replayed: applyCount === 2,
          freshMutationWork: applyCount === 1,
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
        auth,
        dbJournal: {
          scope: trustedDbJournalScope,
          latestRows: [
            { event: 'idempotency-opened' },
            { event: 'mutation-applied' },
            { event: 'apply-committed' },
          ],
          ownership: {
            ownsJournal: true,
            restartReadable: true,
            productionAdapter: 'filesystem-compare-rename',
            supportedSurface: 'claim-fenced-restart-readable',
          },
          leaseFence: {
            boundary: 'filesystem-compare-rename',
            claimKeyUnique: true,
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: false,
          },
        },
        storageGuard,
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
      idempotencyKey: 'idem-read-only-inspect-executor',
      routeProfile: 'production-shaped',
      readOnlyInspectRequests: true,
    });

    assert.equal(summary.ok, true);
    assert.equal(summary.inspectAuthMode, 'read-only-session-bound');
    const requests = seen.map(({ url, options }) => ({
      path: new URL(url).pathname,
      idempotencyKey: options.headers['X-Reprint-Push-Idempotency-Key'],
      session: options.headers['X-Reprint-Push-Session'],
    }));
    assert.deepEqual(
      requests
        .filter(({ path }) => path.endsWith('/dry-run') || path.endsWith('/apply'))
        .map(({ idempotencyKey }) => idempotencyKey),
      [
        'idem-read-only-inspect-executor',
        'idem-read-only-inspect-executor',
        'idem-read-only-inspect-executor',
      ],
    );
    assert.deepEqual(
      requests
        .filter(({ path }) => path.endsWith('/recovery/inspect') || path.endsWith('/db-journal'))
        .map(({ idempotencyKey, session }) => ({ idempotencyKey, session })),
      [
        { idempotencyKey: undefined, session: auth.session.id },
        { idempotencyKey: undefined, session: auth.session.id },
      ],
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('authenticated push executor rejects a capability downgrade after preflight before mutation for RPP-0518', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  const activeSession = {
    type: 'production-auth-session',
    status: 'active',
    id: 'psh_01j00000000000000000000000',
    expiresAt: '2030-01-01T00:00:00Z',
  };
  const authWithManageOptions = {
    identity: {
      userId: 7,
      userLogin: 'reprint_push_admin',
      capabilities: { manage_options: true },
    },
    session: activeSession,
  };
  const authWithoutManageOptions = {
    identity: {
      userId: 7,
      userLogin: 'reprint_push_admin',
      capabilities: { manage_options: false },
    },
    session: activeSession,
  };

  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = new URL(String(url)).pathname;
    if (pathname.endsWith('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: authWithManageOptions,
        session: { id: activeSession.id },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.endsWith('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.endsWith('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: authWithoutManageOptions,
        receipt: { receiptHash: 'receipt-capability-downgrade-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected mutation path after capability downgrade: ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-capability-downgrade-rpp-0518',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'AUTH_SESSION_CAPABILITY_DOWNGRADED');
    assert.deepEqual(summary.authSession, {
      field: 'auth.identity.capabilities.manage_options',
      required: 'true',
      observed: 'false',
      verdict: 'AUTH_SESSION_CAPABILITY_DOWNGRADED',
    });
    assert.equal(summary.apply, null);
    assert.deepEqual(
      seen.map(({ url }) => new URL(url).pathname),
      [
        '/wp-json/reprint/v1/push/preflight',
        '/wp-json/reprint/v1/push/snapshot',
        '/wp-json/reprint/v1/push/dry-run',
      ],
    );
    assert.equal(summary.authSessionLifecycleSummary.issued.authCapabilities.manage_options, true);
    assert.equal(summary.authSessionLifecycleSummary.read.authCapabilities.manage_options, false);
    assert.equal(summary.dryRun.authCapabilities.manage_options, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('RPP-0520 production-shaped authenticated push carries audit event schema in db journal summary', async () => {
  const originalFetch = global.fetch;
  let applyCount = 0;
  const auth = {
    identity: { userLogin: 'reprint_push_admin' },
    session: {
      type: 'production-auth-session',
      status: 'active',
      id: 'psh_01j00000000000000000000000',
      expiresAt: '2030-01-01T00:00:00Z',
    },
  };
  const storageGuard = {
    boundary: 'filesystem-compare-rename',
    operation: 'update',
    outcome: 'applied',
  };
  const auditEventSchema = {
    schemaVersion: 1,
    schemaId: 'reprint-push-production-audit-event/v1',
    routeEvidence: {
      routeProfile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      journalRoute: '/push/db-journal',
      schemaRoute: '/push/db-journal/schema',
      checkedSurface: 'production-shaped-rest-route',
    },
    eventStore: {
      storage: 'wpdb',
      appendOnlyEvents: true,
      sequenceField: 'sequence',
      cursorPrefix: 'db-journal:',
    },
    eventShape: {
      type: 'object',
      required: ['schemaVersion', 'sequence', 'event', 'resourceHashEvidence'],
    },
    redaction: {
      format: 'hash-only',
      rawValuesIncluded: false,
      hashAlgorithm: 'sha256',
      hashOnlyFields: ['idempotencyKeyHash', 'requestHash', 'resourceHashEvidence.*Hash'],
      forbiddenRawFields: ['value', 'content', 'payload', 'post_content', 'option_value', 'meta_value'],
    },
  };

  global.fetch = async (url) => {
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth,
        session: { id: auth.session.id },
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
        auth,
        receipt: { receiptHash: 'receipt-rpp-0520-audit-schema' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        auth,
        recovery: {
          state: 'ok',
          journal: { integrity: { status: 'ok' } },
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
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
        applied: 0,
        code: applyCount === 1 ? 'APPLIED' : 'BATCH_ALREADY_COMMITTED',
        responseSchemaVersion: 1,
        auth,
        storageGuard,
        idempotency: {
          replayed: applyCount === 2,
          freshMutationWork: applyCount === 1,
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
        auth,
        dbJournal: {
          scope: trustedDbJournalScope,
          auditEventSchema,
          latestRows: [
            { schemaVersion: 1, sequence: 1, event: 'idempotency-opened' },
            { schemaVersion: 1, sequence: 2, event: 'mutation-applied' },
            { schemaVersion: 1, sequence: 3, event: 'apply-committed' },
          ],
          ownership: {
            ownsJournal: true,
            restartReadable: true,
            productionAdapter: 'filesystem-compare-rename',
            supportedSurface: 'claim-fenced-restart-readable',
          },
          leaseFence: {
            boundary: 'filesystem-compare-rename',
            claimKeyUnique: true,
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: false,
          },
        },
        storageGuard,
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
      idempotencyKey: 'idem-rpp-0520-audit-schema',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, true);
    assert.equal(summary.dbJournal.auditEventSchema.schemaVersion, 1);
    assert.equal(summary.dbJournal.auditEventSchema.schemaId, 'reprint-push-production-audit-event/v1');
    assert.equal(summary.dbJournal.auditEventSchema.schemaHash, digest(auditEventSchema));
    assert.deepEqual(summary.dbJournal.auditEventSchema.routeEvidence, {
      routeProfile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      journalRoute: '/push/db-journal',
      schemaRoute: '/push/db-journal/schema',
      checkedSurface: 'production-shaped-rest-route',
    });
    assert.deepEqual(summary.dbJournal.auditEventSchema.eventStore, {
      storage: 'wpdb',
      appendOnlyEvents: true,
      sequenceField: 'sequence',
      cursorPrefix: 'db-journal:',
    });
    assert.ok(summary.dbJournal.auditEventSchema.eventRequiredFields.includes('resourceHashEvidence'));
    assert.equal(summary.dbJournal.auditEventSchema.redaction.format, 'hash-only');
    assert.equal(summary.dbJournal.auditEventSchema.redaction.rawValuesIncluded, false);
    assert.ok(summary.dbJournal.auditEventSchema.redaction.hashOnlyFields.includes('requestHash'));
    assert.ok(summary.dbJournal.auditEventSchema.redaction.forbiddenRawFields.includes('option_value'));
    assert.doesNotMatch(
      JSON.stringify(summary.dbJournal.auditEventSchema),
      /authorization|basic|applicationPassword|password|credentialHash|signingKey/i,
    );
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

test('production-shaped authenticated push fails closed when production auth session is minted but expired by status', async () => {
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
        field: 'auth.session.status',
        required: 'unexpired',
        observed: 'expired',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      },
    });
    assert.equal(summary.authSessionLifecycleTrace[0]?.expired, true);
    assert.equal(summary.authSessionLifecycle.minted?.expired, true);
    assert.equal(summary.authSessionLifecycle.expired?.step, 'preflight');
    assert.equal(summary.authSessionLifecycle.expired?.expired, true);
    assert.equal(summary.authSessionLifecycleSummary.issued?.expired, true);
    assert.equal(summary.authSessionLifecycleSummary.expired?.step, 'preflight');
    assert.equal(summary.authSessionLifecycleSummary.expired?.expired, true);
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
        field: 'auth.session.expiresAt',
        required: 'unexpired',
        observed: '2000-01-01T00:00:00Z',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      },
    });
    assert.equal(summary.authSessionLifecycle.history.length, 1);
    assert.deepEqual(summary.authSessionLifecycle.history[0], {
      step: 'preflight',
      id: 'psh_01j00000000000000000000000',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2000-01-01T00:00:00Z',
      authUser: 'reprint_push_admin',
      expired: true,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: false,
    });
    assert.deepEqual(summary.authSessionLifecycle.minted, {
      id: 'psh_01j00000000000000000000000',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2000-01-01T00:00:00Z',
      authUser: 'reprint_push_admin',
      expired: true,
      revoked: false,
      cleanedUp: false,
      rotated: null,
      preserved: null,
    });
    assert.equal(summary.authSessionLifecycle.read, null);
    assert.deepEqual(summary.authSessionLifecycle.expired, {
      step: 'preflight',
      id: 'psh_01j00000000000000000000000',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2000-01-01T00:00:00Z',
      authUser: 'reprint_push_admin',
      expired: true,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: false,
    });
    assert.equal(summary.authSessionLifecycle.revoked, null);
    assert.equal(summary.authSessionLifecycle.cleanedUp, null);
    assert.equal(summary.authSessionLifecycle.rotated, null);
    assert.equal(summary.authSessionLifecycle.preserved, null);
    assert.deepEqual(summary.authSessionLifecycleSummary, {
      issued: {
        step: 'preflight',
        id: 'psh_01j00000000000000000000000',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2000-01-01T00:00:00Z',
        authUser: 'reprint_push_admin',
        expired: true,
        revoked: false,
        cleanedUp: false,
        rotated: false,
        preserved: false,
      },
      read: null,
      expired: {
        step: 'preflight',
        id: 'psh_01j00000000000000000000000',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2000-01-01T00:00:00Z',
        authUser: 'reprint_push_admin',
        expired: true,
        revoked: false,
        cleanedUp: false,
        rotated: false,
        preserved: false,
      },
      revoked: null,
      cleanedUp: null,
      rotated: null,
      preserved: null,
      observations: [
        {
          step: 'preflight',
          id: 'psh_01j00000000000000000000000',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2000-01-01T00:00:00Z',
          authUser: 'reprint_push_admin',
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

test('production-shaped authenticated push fails closed when production auth session is minted without an authenticated identity', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    if (String(url).includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: {},
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
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-01-missing-identity',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED');
    assert.deepEqual(summary.authSession, {
      required: 'authenticated identity',
      observed: 'missing-user-login',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    });
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: {
        required: 'authenticated identity',
        observed: 'missing-user-login',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      },
    });
    assert.equal(seen.length, 1);
    assert.match(seen[0].url, /\/wp-json\/reprint\/v1\/push\/preflight$/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when production preflight cleanup evidence is invalid', async () => {
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
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
        session: { id: 'psh_01j00000000000000000000000' },
        sessionStore: {
          cleanup: {
            schemaVersion: 1,
            store: 'wp-options',
            deletedExpiredTotal: 0,
            sessionOptions: {
              deletedExpired: 0,
              retainedUnexpired: 0,
              limitReached: false,
            },
            nonceOptions: {
              deletedExpired: 0,
              retainedUnexpired: 1,
              limitReached: false,
            },
          },
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
      idempotencyKey: 'idem-01-invalid-preflight-cleanup',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED');
    assert.deepEqual(summary.authSession, {
      required: 'cleanup evidence',
      observed: 'invalid-session-store-cleanup',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    });
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: {
        required: 'cleanup evidence',
        observed: 'invalid-session-store-cleanup',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      },
    });
    assert.equal(seen.length, 1);
    assert.match(seen[0].url, /\/wp-json\/reprint\/v1\/push\/preflight$/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when production preflight lifecycle flags are malformed', async () => {
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
            expiresAt: '2030-01-01T00:00:00Z',
            cleanup: 'yes',
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
      idempotencyKey: 'idem-01-invalid-preflight-lifecycle-flags',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED');
    assert.deepEqual(summary.authSession, {
      required: 'boolean lifecycle flags',
      observed: 'invalid-cleanup',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    });
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: {
        required: 'boolean lifecycle flags',
        observed: 'invalid-cleanup',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      },
    });
    assert.deepEqual(
      summary.authSessionLifecycleTrace.map(({ step, cleanedUp }) => ({ step, cleanedUp })),
      [
        { step: 'preflight', cleanedUp: false },
      ],
    );
    assert.equal(seen.length, 1);
    assert.match(seen[0].url, /\/wp-json\/reprint\/v1\/push\/preflight$/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when production preflight preserved flag is malformed', async () => {
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
            expiresAt: '2030-01-01T00:00:00Z',
            preserved: 'yes',
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
      idempotencyKey: 'idem-01-invalid-preflight-preserved-flag',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED');
    assert.deepEqual(summary.authSession, {
      required: 'boolean lifecycle flags',
      observed: 'invalid-preserved',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    });
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: {
        required: 'boolean lifecycle flags',
        observed: 'invalid-preserved',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      },
    });
    assert.deepEqual(
      summary.authSessionLifecycleTrace.map(({ step, cleanedUp }) => ({ step, cleanedUp })),
      [
        { step: 'preflight', cleanedUp: false },
      ],
    );
    assert.equal(seen.length, 1);
    assert.match(seen[0].url, /\/wp-json\/reprint\/v1\/push\/preflight$/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when production preflight string lifecycle fields are malformed', async () => {
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
            status: ['active'],
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
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-01-invalid-preflight-string-lifecycle-fields',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED');
    assert.deepEqual(summary.authSession, {
      field: 'auth.session.status',
      required: 'string lifecycle fields',
      observed: 'invalid-status',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    });
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: {
        field: 'auth.session.status',
        required: 'string lifecycle fields',
        observed: 'invalid-status',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      },
    });
    assert.deepEqual(
      summary.authSessionLifecycleTrace.map(({ step, cleanedUp }) => ({ step, cleanedUp })),
      [
        { step: 'preflight', cleanedUp: false },
      ],
    );
    assert.equal(seen.length, 1);
    assert.match(seen[0].url, /\/wp-json\/reprint\/v1\/push\/preflight$/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when production preflight auth identity fields are malformed', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    if (String(url).includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: ['reprint_push_admin'] },
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
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-01-invalid-preflight-auth-identity-fields',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED');
    assert.deepEqual(summary.authSession, {
      field: 'auth.identity.userLogin',
      required: 'string auth identity fields',
      observed: 'invalid-user-login',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    });
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: {
        field: 'auth.identity.userLogin',
        required: 'string auth identity fields',
        observed: 'invalid-user-login',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      },
    });
    assert.equal(seen.length, 1);
    assert.match(seen[0].url, /\/wp-json\/reprint\/v1\/push\/preflight$/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when production dry-run cleanup evidence is invalid', async () => {
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
          },
        },
        sessionStore: {
          cleanup: {
            schemaVersion: 1,
            store: 'wp-options',
            deletedExpiredTotal: 0,
            sessionOptions: {
              deletedExpired: 0,
              retainedUnexpired: 0,
              limitReached: false,
            },
            nonceOptions: {
              deletedExpired: 0,
              retainedUnexpired: 1,
              limitReached: false,
            },
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
      idempotencyKey: 'idem-01-invalid-dry-run-cleanup',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED');
    assert.deepEqual(summary.authSession, {
      required: 'cleanup evidence',
      observed: 'invalid-session-store-cleanup',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    });
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: {
        required: 'cleanup evidence',
        observed: 'invalid-session-store-cleanup',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      },
    });
    assert.deepEqual(
      summary.authSessionLifecycleTrace.map(({ step, cleanedUp }) => ({ step, cleanedUp })),
      [
        { step: 'preflight', cleanedUp: false },
        { step: 'dry-run', cleanedUp: false },
      ],
    );
    assert.equal(seen.length, 3);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when checked auth reads drop required cleanup evidence continuity', async () => {
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
        sessionStore: {
          cleanup: {
            schemaVersion: 1,
            store: 'wp-options',
            deletedExpiredTotal: 2,
            sessionOptions: {
              deletedExpired: 1,
              retainedUnexpired: 1,
              limitReached: false,
            },
            nonceOptions: {
              deletedExpired: 1,
              retainedUnexpired: 1,
              limitReached: false,
            },
          },
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
      idempotencyKey: 'idem-01-cleanup-continuity',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED');
    assert.deepEqual(summary.authSession, {
      required: 'cleanup evidence continuity',
      observed: 'missing-session-store-cleanup',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    });
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: {
        required: 'cleanup evidence continuity',
        observed: 'missing-session-store-cleanup',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      },
    });
    assert.deepEqual(
      summary.authSessionLifecycleTrace.map(({ step, cleanedUp }) => ({ step, cleanedUp })),
      [
        { step: 'preflight', cleanedUp: false },
        { step: 'dry-run', cleanedUp: false },
      ],
    );
    assert.equal(seen.length, 3);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when replay drops required cleanup evidence continuity', async () => {
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
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
        session: { id: 'psh_01j00000000000000000000000' },
        sessionStore: {
          cleanup: {
            schemaVersion: 1,
            store: 'wp-options',
            deletedExpiredTotal: 2,
            sessionOptions: {
              deletedExpired: 1,
              retainedUnexpired: 1,
              limitReached: false,
            },
            nonceOptions: {
              deletedExpired: 1,
              retainedUnexpired: 1,
              limitReached: false,
            },
          },
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
          },
        },
        sessionStore: {
          cleanup: {
            schemaVersion: 1,
            store: 'wp-options',
            deletedExpiredTotal: 2,
            sessionOptions: {
              deletedExpired: 1,
              retainedUnexpired: 1,
              limitReached: false,
            },
            nonceOptions: {
              deletedExpired: 1,
              retainedUnexpired: 1,
              limitReached: false,
            },
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
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
        sessionStore: {
          cleanup: {
            schemaVersion: 1,
            store: 'wp-options',
            deletedExpiredTotal: 2,
            sessionOptions: {
              deletedExpired: 1,
              retainedUnexpired: 1,
              limitReached: false,
            },
            nonceOptions: {
              deletedExpired: 1,
              retainedUnexpired: 1,
              limitReached: false,
            },
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
      applyCount += 1;
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
        ...(applyCount === 1
          ? {
            sessionStore: {
              cleanup: {
                schemaVersion: 1,
                store: 'wp-options',
                deletedExpiredTotal: 2,
                sessionOptions: {
                  deletedExpired: 1,
                  retainedUnexpired: 1,
                  limitReached: false,
                },
                nonceOptions: {
                  deletedExpired: 1,
                  retainedUnexpired: 1,
                  limitReached: false,
                },
              },
            },
          }
          : {}),
        receipt: { receiptHash: 'receipt-01' },
        signedRequest: {
          signed: true,
        },
        idempotency: {
          replayed: applyCount === 2,
          freshMutationWork: applyCount === 1,
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
      idempotencyKey: 'idem-01-replay-cleanup-continuity',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED');
    assert.deepEqual(summary.authSession, {
      required: 'cleanup evidence continuity',
      observed: 'missing-session-store-cleanup',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    });
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: {
        required: 'cleanup evidence continuity',
        observed: 'missing-session-store-cleanup',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      },
    });
    assert.deepEqual(
      summary.authSessionLifecycleTrace.map(({ step, cleanedUp }) => ({ step, cleanedUp })),
      [
        { step: 'preflight', cleanedUp: false },
        { step: 'dry-run', cleanedUp: false },
        { step: 'apply', cleanedUp: false },
        { step: 'recovery-inspect', cleanedUp: false },
        { step: 'replay', cleanedUp: false },
      ],
    );
    assert.equal(applyCount, 2);
    assert.ok(seen.some(({ url }) => url.includes('/recovery/inspect')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when db journal readback drops required cleanup evidence continuity', async () => {
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
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
        session: { id: 'psh_01j00000000000000000000000' },
        sessionStore: {
          cleanup: {
            schemaVersion: 1,
            store: 'wp-options',
            deletedExpiredTotal: 2,
            sessionOptions: {
              deletedExpired: 1,
              retainedUnexpired: 1,
              limitReached: false,
            },
            nonceOptions: {
              deletedExpired: 1,
              retainedUnexpired: 1,
              limitReached: false,
            },
          },
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
          },
        },
        sessionStore: {
          cleanup: {
            schemaVersion: 1,
            store: 'wp-options',
            deletedExpiredTotal: 2,
            sessionOptions: {
              deletedExpired: 1,
              retainedUnexpired: 1,
              limitReached: false,
            },
            nonceOptions: {
              deletedExpired: 1,
              retainedUnexpired: 1,
              limitReached: false,
            },
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
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
        sessionStore: {
          cleanup: {
            schemaVersion: 1,
            store: 'wp-options',
            deletedExpiredTotal: 2,
            sessionOptions: {
              deletedExpired: 1,
              retainedUnexpired: 1,
              limitReached: false,
            },
            nonceOptions: {
              deletedExpired: 1,
              retainedUnexpired: 1,
              limitReached: false,
            },
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
      applyCount += 1;
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
        sessionStore: {
          cleanup: {
            schemaVersion: 1,
            store: 'wp-options',
            deletedExpiredTotal: 2,
            sessionOptions: {
              deletedExpired: 1,
              retainedUnexpired: 1,
              limitReached: false,
            },
            nonceOptions: {
              deletedExpired: 1,
              retainedUnexpired: 1,
              limitReached: false,
            },
          },
        },
        receipt: { receiptHash: 'receipt-01' },
        signedRequest: {
          signed: true,
        },
        idempotency: {
          replayed: applyCount === 2,
          freshMutationWork: applyCount === 1,
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
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
        dbJournal: {
          latestRows: [],
          ownership: {
            ownsJournal: true,
            restartReadable: true,
            productionAdapter: 'wpdb-single-statement-cas',
            supportedSurface: 'claim-fenced-restart-readable',
          },
          claim: {
            status: 'stale-claim-rejected',
            activeClaimId: 'claim-01',
            activeClaimHash: '1111111111111111111111111111111111111111111111111111111111111111',
            activeClaimEvent: 'stale-claim-rejected',
            previousClaimId: 'claim-00',
            previousClaimHash: '0000000000000000000000000000000000000000000000000000000000000000',
            staleClaimRejected: true,
          },
          writerLease: {
            boundary: 'wpdb-single-statement-cas',
            storageGuard: 'wpdb-single-statement-cas',
            activeClaimId: 'claim-01',
            activeClaimHash: '1111111111111111111111111111111111111111111111111111111111111111',
            staleClaimRejected: true,
          },
          leaseFence: {
            boundary: 'wpdb-single-statement-cas',
            storageGuard: 'wpdb-single-statement-cas',
            writerLease: {
              boundary: 'wpdb-single-statement-cas',
              storageGuard: 'wpdb-single-statement-cas',
              activeClaimId: 'claim-01',
              activeClaimHash: '1111111111111111111111111111111111111111111111111111111111111111',
              staleClaimRejected: true,
            },
            fsyncEvidence: true,
            claimKeyUnique: true,
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: true,
          },
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
      idempotencyKey: 'idem-01-db-journal-cleanup-continuity',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED');
    assert.deepEqual(summary.authSession, {
      required: 'cleanup evidence continuity',
      observed: 'missing-session-store-cleanup',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    });
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: {
        required: 'cleanup evidence continuity',
        observed: 'missing-session-store-cleanup',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      },
    });
    assert.equal(applyCount, 2);
    assert.ok(seen.some(({ url }) => url.includes('/db-journal')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed on malformed checked-path auth user logins', async () => {
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
          identity: { userLogin: ['reprint_push_admin'] },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
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
      idempotencyKey: 'idem-01-invalid-dry-run-user-login',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED');
    assert.deepEqual(summary.authSession, {
      field: 'auth.identity.userLogin',
      required: 'string auth identity fields',
      observed: 'invalid-user-login',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    });
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: {
        field: 'auth.identity.userLogin',
        required: 'string auth identity fields',
        observed: 'invalid-user-login',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      },
    });
    assert.equal(summary.authSessionLifecycleTrace.at(-1)?.step, 'dry-run');
    assert.ok(!seen.some(({ url }) => url.includes('/apply')));
    assert.ok(!seen.some(({ url }) => url.includes('/db-journal')));
    assert.equal(seen.length, 3);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed on malformed checked-path auth session ids', async () => {
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
            id: ' psh_01j00000000000000000000001 ',
            expiresAt: '2030-01-01T00:00:00Z',
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
      idempotencyKey: 'idem-01-invalid-dry-run-id',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED');
    assert.deepEqual(summary.authSession, {
      field: 'auth.session.id',
      required: 'string lifecycle fields',
      observed: 'invalid-id',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    });
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: {
        field: 'auth.session.id',
        required: 'string lifecycle fields',
        observed: 'invalid-id',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      },
    });
    assert.equal(summary.authSessionLifecycleTrace.at(-1)?.step, 'dry-run');
    assert.ok(!seen.some(({ url }) => url.includes('/apply')));
    assert.ok(!seen.some(({ url }) => url.includes('/db-journal')));
    assert.equal(seen.length, 3);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push keeps the last read step in the lifecycle summary when recovery inspect is terminal', async () => {
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
        responseSchemaVersion: 1,
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
          freshMutationWork: true,
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
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
        recovery: {
          state: 'ready',
          journal: { integrity: { status: 'ok' } },
          counts: { old: 0, new: 1, blockedUnknown: 1, total: 2 },
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
      idempotencyKey: 'idem-01-terminal-recovery-inspect',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'RECOVERY_INSPECT_JOURNAL_UNTRUSTED');
    assert.deepEqual(summary.authSessionLifecycleSummary, {
      issued: {
        step: 'preflight',
        id: 'psh_01j00000000000000000000000',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2030-01-01T00:00:00Z',
        authUser: 'reprint_push_admin',
        expired: false,
        revoked: false,
        cleanedUp: false,
        rotated: false,
        preserved: false,
      },
      read: {
        step: 'recovery-inspect',
        id: 'psh_01j00000000000000000000000',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2030-01-01T00:00:00Z',
        authUser: 'reprint_push_admin',
        expired: false,
        revoked: false,
        cleanedUp: false,
        rotated: false,
        preserved: true,
      },
      expired: null,
      revoked: null,
      cleanedUp: null,
      rotated: null,
      preserved: {
        step: 'dry-run',
        id: 'psh_01j00000000000000000000000',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2030-01-01T00:00:00Z',
        authUser: 'reprint_push_admin',
        expired: false,
        revoked: false,
        cleanedUp: false,
        rotated: false,
        preserved: true,
      },
      observations: [
        {
          step: 'preflight',
          id: 'psh_01j00000000000000000000000',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2030-01-01T00:00:00Z',
          authUser: 'reprint_push_admin',
          expired: false,
          revoked: false,
          cleanedUp: false,
          rotated: false,
          preserved: false,
        },
        {
          step: 'dry-run',
          id: 'psh_01j00000000000000000000000',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2030-01-01T00:00:00Z',
          authUser: 'reprint_push_admin',
          expired: false,
          revoked: false,
          cleanedUp: false,
          rotated: false,
          preserved: true,
        },
        {
          step: 'apply',
          id: 'psh_01j00000000000000000000000',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2030-01-01T00:00:00Z',
          authUser: 'reprint_push_admin',
          expired: false,
          revoked: false,
          cleanedUp: false,
          rotated: false,
          preserved: true,
        },
        {
          step: 'recovery-inspect',
          id: 'psh_01j00000000000000000000000',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2030-01-01T00:00:00Z',
          authUser: 'reprint_push_admin',
          expired: false,
          revoked: false,
          cleanedUp: false,
          rotated: false,
          preserved: true,
        },
      ],
    });
    assert.equal(seen.length, 5);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when a preserved production auth session read omits the authenticated identity', async () => {
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
          identity: {},
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
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
      idempotencyKey: 'idem-01-read-missing-identity',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED');
    assert.deepEqual(summary.authSession, {
      required: 'authenticated identity',
      observed: 'missing-user-login',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    });
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: {
        required: 'authenticated identity',
        observed: 'missing-user-login',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      },
    });
    assert.equal(seen.length, 3);
    assert.ok(seen.some(({ url }) => url.includes('/dry-run')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when a preserved production auth session read changes the authenticated identity', async () => {
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
          identity: { userLogin: 'different-user' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
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
      idempotencyKey: 'idem-01-read-identity-drift',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED');
    assert.deepEqual(summary.authSession, {
      required: 'authenticated identity match',
      observed: 'different-user',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    });
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: {
        required: 'authenticated identity match',
        observed: 'different-user',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      },
    });
    assert.equal(seen.length, 3);
    assert.ok(seen.some(({ url }) => url.includes('/dry-run')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when preflight mints a production auth session for the wrong authenticated identity', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    if (String(url).includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'different-user' },
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
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-01-preflight-identity-mismatch',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED');
    assert.deepEqual(summary.authSession, {
      required: 'authenticated identity match',
      observed: 'different-user',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    });
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: {
        required: 'authenticated identity match',
        observed: 'different-user',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      },
    });
    assert.equal(seen.length, 1);
    assert.match(seen[0].url, /\/wp-json\/reprint\/v1\/push\/preflight$/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when dry-run changes the authenticated identity user id', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userId: 7, userLogin: 'reprint_push_admin' },
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
          identity: { userId: 9, userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
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
      idempotencyKey: 'idem-01-read-user-id-drift',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED');
    assert.deepEqual(summary.authSession, {
      field: 'auth.identity.userId',
      required: 7,
      observed: 9,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    });
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: {
        field: 'auth.identity.userId',
        required: 7,
        observed: 9,
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      },
    });
    assert.equal(seen.length, 3);
    assert.ok(seen.some(({ url }) => url.includes('/dry-run')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when preflight omits the minted production auth session id', async () => {
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
            expiresAt: '2030-01-01T00:00:00Z',
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
      idempotencyKey: 'idem-01-preflight-missing-session-id',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED');
    assert.deepEqual(summary.authSession, {
      required: 'preserved read',
      observed: 'missing-session-id',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    });
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: {
        required: 'preserved read',
        observed: 'missing-session-id',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      },
    });
    assert.equal(seen.length, 1);
    assert.match(seen[0].url, /\/wp-json\/reprint\/v1\/push\/preflight$/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when production auth session is minted without expiresAt', async () => {
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
      idempotencyKey: 'idem-01-missing-expiry',
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
        observed: 'missing',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      },
    });
    assert.equal(seen.length, 1);
    assert.match(seen[0].url, /\/wp-json\/reprint\/v1\/push\/preflight$/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push evaluates session expiry against the run clock instead of wall time', async () => {
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
            expiresAt: '2025-06-01T00:00:00Z',
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
            expiresAt: '2025-06-01T00:00:00Z',
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
      idempotencyKey: 'idem-01-verifier-clock-expiry',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
      dryRunOnly: true,
      now: new Date('2025-01-01T00:00:00Z'),
    });

    assert.equal(summary.ok, true);
    assert.equal(summary.code, undefined);
    assert.equal(summary.authSessionLifecycleTrace?.[0]?.expired, false);
    assert.equal(summary.authSessionLifecycleTrace?.[1]?.expired, false);
    assert.equal(summary.authSessionLifecycleTrace?.[0]?.expiresAt, '2025-06-01T00:00:00Z');
    assert.equal(summary.authSessionLifecycleTrace?.[1]?.expiresAt, '2025-06-01T00:00:00Z');
    assert.equal(seen.length, 4);
    assert.match(seen[0].url, /\/wp-json\/reprint\/v1\/push\/preflight$/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when production auth session expires after preflight', async () => {
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
            expiresAt: '2020-01-01T00:00:00Z',
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
      now: new Date('2024-01-01T00:00:00Z'),
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
      observed: '2020-01-01T00:00:00Z',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    });
    assert.deepEqual(summary.authSessionLifecycle.expired, {
      id: 'psh_01j00000000000000000000000',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2020-01-01T00:00:00Z',
      authUser: 'reprint_push_admin',
      expired: true,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: true,
      step: 'apply',
    });
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: {
        required: 'unexpired',
        observed: '2020-01-01T00:00:00Z',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      },
    });
    assert.equal(seen.length, 4);
  } finally {
    global.fetch = originalFetch;
  }
});

test('RPP-0514 authenticated push refuses an expired dry-run receipt before apply', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  const auth = {
    identity: { userLogin: 'reprint_push_admin' },
    session: {
      type: 'production-auth-session',
      status: 'active',
      id: 'psh_01j00000000000000000000000',
      expiresAt: '2030-01-01T00:00:00Z',
    },
  };

  global.fetch = async (url, options) => {
    const pathname = new URL(String(url)).pathname;
    seen.push({ url: String(url), pathname, options });
    if (pathname.endsWith('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth,
        session: { id: auth.session.id },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.endsWith('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.endsWith('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        mode: 'dry-run',
        auth,
        receipt: {
          receiptHash: 'receipt-expired-dry-run-01',
          authBinding: {
            expiresAt: '2025-01-01T00:00:00Z',
          },
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
      idempotencyKey: 'idem-rpp-0514-expired-dry-run-receipt',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
      now: new Date('2025-01-01T00:00:01Z'),
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'AUTH_RECEIPT_EXPIRED');
    assert.deepEqual(summary.receiptExpiry, {
      phase: 'dry-run',
      field: 'receipt.authBinding.expiresAt',
      required: 'unexpired',
      observed: '2025-01-01T00:00:00Z',
      verdict: 'AUTH_RECEIPT_EXPIRED',
    });
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'authenticated receipt expiry validation before apply mutation',
      status: 'refused',
      verdict: 'AUTH_RECEIPT_EXPIRED',
      receiptExpiry: {
        phase: 'dry-run',
        field: 'receipt.authBinding.expiresAt',
        required: 'unexpired',
        observed: '2025-01-01T00:00:00Z',
        verdict: 'AUTH_RECEIPT_EXPIRED',
      },
    });
    assert.equal(summary.apply, null);
    assert.deepEqual(seen.map(({ pathname }) => pathname), [
      '/wp-json/reprint/v1/push/preflight',
      '/wp-json/reprint/v1/push/snapshot',
      '/wp-json/reprint/v1/push/dry-run',
    ]);
    assert.ok(!seen.some(({ pathname }) => pathname.endsWith('/apply')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('RPP-0514 authenticated push surfaces apply-side expired receipt refusal before replay or recovery', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  const auth = {
    identity: { userLogin: 'reprint_push_admin' },
    session: {
      type: 'production-auth-session',
      status: 'active',
      id: 'psh_01j00000000000000000000000',
      expiresAt: '2030-01-01T00:00:00Z',
    },
  };

  global.fetch = async (url, options) => {
    const pathname = new URL(String(url)).pathname;
    seen.push({ url: String(url), pathname, options });
    if (pathname.endsWith('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth,
        session: { id: auth.session.id },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.endsWith('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.endsWith('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        mode: 'dry-run',
        auth,
        receipt: { receiptHash: 'receipt-remote-expired-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.endsWith('/apply')) {
      return new Response(JSON.stringify({
        ok: false,
        mode: 'apply',
        code: 'AUTH_RECEIPT_EXPIRED',
        applied: 0,
        auth,
        idempotency: {
          replayed: false,
          freshMutationWork: false,
          conflict: false,
        },
      }), {
        status: 409,
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
      idempotencyKey: 'idem-rpp-0514-expired-apply-receipt',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
      now: new Date('2025-01-01T00:00:00Z'),
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'AUTH_RECEIPT_EXPIRED');
    assert.equal(summary.apply.status, 409);
    assert.equal(summary.apply.applied, 0);
    assert.equal(summary.apply.idempotency.freshMutationWork, false);
    assert.deepEqual(summary.receiptExpiry, {
      phase: 'apply',
      required: 'unexpired',
      observed: 'remote-apply-rejected-expired-receipt',
      verdict: 'AUTH_RECEIPT_EXPIRED',
    });
    assert.equal(summary.recoveryInspect, null);
    assert.equal(summary.replay, null);
    assert.equal(summary.dbJournal, null);
    assert.deepEqual(seen.map(({ pathname }) => pathname), [
      '/wp-json/reprint/v1/push/preflight',
      '/wp-json/reprint/v1/push/snapshot',
      '/wp-json/reprint/v1/push/dry-run',
      '/wp-json/reprint/v1/push/apply',
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('RPP-0514 authenticated push keeps live-source apply revalidation on the unexpired receipt path', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  const auth = {
    identity: {
      userLogin: 'reprint_push_admin',
      userId: 7,
      capabilities: { manage_options: true },
    },
    session: {
      type: 'production-auth-session',
      status: 'active',
      id: 'psh_01j00000000000000000000000',
      expiresAt: '2030-01-01T00:00:00Z',
    },
  };
  const identityHash = digest(auth.identity);
  const pushSessionHash = 'session-rpp-0514';
  const userLoginHash = createHash('sha256')
    .update(auth.identity.userLogin, 'utf8')
    .digest('hex');
  const receipt = {
    receiptHash: 'receipt-unexpired-revalidation-01',
    authBinding: {
      expiresAt: '2030-01-01T00:00:00Z',
      identity: auth.identity,
      binding: {
        identityHash,
        pushSessionHash,
      },
      pushSession: {
        sessionHash: pushSessionHash,
        issue: { identityHash },
      },
      sessionUser: {
        identityHash,
        userId: auth.identity.userId,
        userLoginHash,
        pushSessionHash,
        bindingHash: 'binding-rpp-0514',
      },
    },
  };
  const storageGuard = {
    boundary: 'wpdb-single-statement-cas',
    operation: 'update',
    outcome: 'applied',
  };
  const checkedJournal = {
    scope: trustedDbJournalScope,
    latestRows: [
      { event: 'idempotency-opened' },
      { event: 'mutation-applied' },
      { event: 'apply-committed' },
    ],
    claim: {
      status: 'stale-claim-rejected',
      activeClaimId: auth.session.id,
      activeClaimKeyHash: auth.session.id,
      activeClaimSequence: 2,
      activeClaimEvent: 'stale-claim-rejected',
      previousClaimId: 'psh_01i99999999999999999999999',
      previousClaimKeyHash: 'psh_01i99999999999999999999999',
      previousClaimSequence: 1,
      previousClaimEvent: 'recovery-claim-opened',
      idempotencyKeyHash: 'idempotency-rpp-0514',
      requestHash: 'request-rpp-0514',
      staleClaimRejected: true,
    },
    ownership: {
      ownsJournal: true,
      restartReadable: true,
      productionAdapter: 'wpdb-single-statement-cas',
      supportedSurface: 'claim-fenced-restart-readable',
    },
    writerLease: {
      strategy: 'claim-fenced-single-writer',
      claimId: auth.session.id,
      claimKeyHash: auth.session.id,
      claimKeyUnique: true,
      fsyncEvidence: true,
      storageGuard: 'wpdb-single-statement-cas',
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: true,
    },
    leaseFence: {
      boundary: 'wpdb-single-statement-cas',
      storageGuard: 'wpdb-single-statement-cas',
      claimKeyUnique: true,
      fsyncEvidence: true,
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: true,
      writerLease: {
        strategy: 'claim-fenced-single-writer',
        claimId: auth.session.id,
        claimKeyHash: auth.session.id,
        claimKeyUnique: true,
        fsyncEvidence: true,
        storageGuard: 'wpdb-single-statement-cas',
        monotonicSequence: true,
        restartReadable: true,
        staleClaimRejected: true,
      },
    },
  };
  let applyCount = 0;

  global.fetch = async (url, options) => {
    const pathname = new URL(String(url)).pathname;
    const payload = options?.body ? JSON.parse(String(options.body)) : null;
    seen.push({ url: String(url), pathname, payload });
    if (pathname.endsWith('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth,
        session: { id: auth.session.id },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.endsWith('/snapshot')) {
      return new Response(JSON.stringify({
        ok: true,
        snapshot: { resources: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.endsWith('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        mode: 'dry-run',
        auth,
        receipt,
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.endsWith('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        auth,
        recovery: {
          state: 'fully-updated-remote',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: { integrity: { status: 'ok' } },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.endsWith('/db-journal')) {
      return new Response(JSON.stringify({
        ok: true,
        auth,
        dbJournal: checkedJournal,
        storageGuard,
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.endsWith('/apply')) {
      applyCount += 1;
      return new Response(JSON.stringify({
        ok: true,
        mode: 'apply',
        applied: 1,
        code: applyCount === 1 ? 'APPLIED' : 'BATCH_ALREADY_COMMITTED',
        responseSchemaVersion: 1,
        auth,
        ...(applyCount === 1 ? { receipt } : {}),
        storageGuard,
        signedRequest: {
          signed: true,
          schemaVersion: 1,
          contentHash: 'content-rpp-0514',
          sessionHash: pushSessionHash,
          signingKeyHash: 'signing-key-rpp-0514',
          request: { method: 'POST', path: '/wp-json/reprint/v1/push/apply' },
        },
        idempotency: {
          replayed: applyCount > 1,
          freshMutationWork: applyCount === 1,
          conflict: false,
        },
        applyRevalidation: buildApplyRevalidationEvidence(
          payload.plan,
          payload.receipt,
          auth.session.id,
          auth.session.id,
        ),
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
      idempotencyKey: 'idem-rpp-0514-unexpired-revalidation',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
      now: new Date('2025-01-01T00:00:00Z'),
    });

    assert.equal(summary.ok, true);
    assert.equal(summary.code, undefined);
    assert.equal(summary.receiptExpiry, undefined);
    assert.equal(summary.applyRevalidation.phase, 'before-first-mutation');
    assert.equal(summary.applyRevalidation.checkedAgainst, 'live-remote');
    assert.equal(summary.applyRevalidation.required, 'fresh-live-hashes-before-first-mutation');
    assert.equal(summary.applyRevalidation.receiptHash, receipt.receiptHash);
    assert.equal(summary.replay.idempotency.replayed, true);
    assert.equal(summary.dbJournal.leaseFence.staleClaimRejected, true);
    assert.deepEqual(
      seen
        .filter(({ pathname }) => pathname.endsWith('/apply'))
        .map(({ payload }) => payload.receipt.receiptHash),
      [receipt.receiptHash, receipt.receiptHash],
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push can prove packaged stale-claim retry through the DB journal surface', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  const base = {
    meta: { fixture: 'remote-base' },
    files: {
      'wp-content/uploads/reprint-push/shared.txt': 'base',
    },
    plugins: {},
    db: {},
  };
  const local = {
    meta: { fixture: 'local-edited' },
    files: {
      'wp-content/uploads/reprint-push/shared.txt': 'local',
    },
    plugins: {},
    db: {},
  };
  let applyCount = 0;
  let snapshotCount = 0;

  global.fetch = async (url, options = {}) => {
    const urlString = String(url);
    const pathname = new URL(urlString).pathname;
    const requestBody = options.body ? JSON.parse(options.body) : null;
    seen.push({ url: urlString, pathname, body: requestBody });

    if (pathname.endsWith('/preflight')) {
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

    if (pathname.endsWith('/snapshot')) {
      snapshotCount += 1;
      return new Response(JSON.stringify({
        ok: true,
        snapshot: snapshotCount === 1 ? base : local,
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (pathname.endsWith('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        mode: 'dry-run',
        receipt: { receiptHash: 'receipt-01' },
        responseSchemaVersion: 1,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
        signedRequest: {
          signed: false,
          schemaVersion: 1,
          contentHash: 'dry-run-content-hash',
          sessionHash: 'session-hash',
          signingKeyHash: 'signing-key-hash',
          request: { method: 'POST', path: '/wp-json/reprint/v1/push/dry-run' },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (pathname.endsWith('/apply')) {
      applyCount += 1;
      if (applyCount === 1) {
        return new Response(JSON.stringify({
          ok: false,
          mode: 'apply',
          code: 'LAB_SIMULATED_STALE_CLAIM_ALL_OLD',
          applied: 0,
          responseSchemaVersion: 1,
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
          recovery: {
            state: 'stale-claim-all-old-simulated',
            counts: {
              old: 1,
              new: 0,
              blockedUnknown: 0,
              total: 1,
            },
          },
          signedRequest: {
            signed: false,
            schemaVersion: 1,
            contentHash: 'apply-content-hash',
            sessionHash: 'session-hash',
            signingKeyHash: 'signing-key-hash',
            request: { method: 'POST', path: '/wp-json/reprint/v1/push/apply' },
          },
        }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (applyCount === 2) {
        return new Response(JSON.stringify({
          ok: true,
          mode: 'apply',
          applied: 1,
          responseSchemaVersion: 1,
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
            freshMutationWork: true,
            staleClaimRetry: true,
          },
          storageGuard: {
            boundary: 'wpdb-single-statement-cas',
            operation: 'update',
            outcome: 'applied',
          },
          signedRequest: {
            signed: false,
            schemaVersion: 1,
            contentHash: 'apply-content-hash',
            sessionHash: 'session-hash',
            signingKeyHash: 'signing-key-hash',
            request: { method: 'POST', path: '/wp-json/reprint/v1/push/apply' },
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({
        ok: true,
        mode: 'apply',
        code: 'BATCH_ALREADY_COMMITTED',
        applied: 1,
        responseSchemaVersion: 1,
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
          replayed: true,
          freshMutationWork: false,
          staleClaimRetry: true,
        },
        storageGuard: {
          boundary: 'wpdb-single-statement-cas',
          operation: 'update',
          outcome: 'applied',
        },
        signedRequest: {
          signed: false,
          schemaVersion: 1,
          contentHash: 'apply-content-hash',
          sessionHash: 'session-hash',
          signingKeyHash: 'signing-key-hash',
          request: { method: 'POST', path: '/wp-json/reprint/v1/push/apply' },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (pathname.endsWith('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        mode: 'inspect',
        responseSchemaVersion: 1,
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
          state: 'fully-updated-remote',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: {
            integrity: {
              status: 'ok',
            },
          },
        },
        signedRequest: {
          signed: false,
          schemaVersion: 1,
          contentHash: 'inspect-content-hash',
          sessionHash: 'session-hash',
          signingKeyHash: 'signing-key-hash',
          request: { method: 'POST', path: '/wp-json/reprint/v1/push/recovery/inspect' },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (pathname.endsWith('/db-journal')) {
      return new Response(JSON.stringify({
        ok: true,
        dbJournal: {
          scope: 'packaged production plugin journal surface; not local Playground fixture only',
          latestRows: [
            { event: 'idempotency-opened' },
            { event: 'apply-started' },
            { event: 'stale-claim-abandoned' },
            { event: 'stale-claim-retry-started' },
            { event: 'mutation-applied' },
            { event: 'apply-committed' },
          ],
          claim: {
            status: 'stale-claim-rejected',
            activeClaimId: 'psh_01j00000000000000000000000',
            activeClaimKeyHash: 'psh_01j00000000000000000000000',
            activeClaimSequence: 2,
            activeClaimEvent: 'stale-claim-rejected',
            previousClaimId: 'psh_01i99999999999999999999999',
            previousClaimKeyHash: 'psh_01i99999999999999999999999',
            previousClaimSequence: 1,
            previousClaimEvent: 'recovery-claim-opened',
            idempotencyKeyHash: 'idempotency-claim-01',
            requestHash: 'request-claim-01',
            planHash: 'plan-claim-01',
            receiptHash: 'receipt-claim-01',
            planFingerprint: 'plan-fingerprint-01',
            mutationCount: 1,
            appliedCount: 1,
            staleClaimRejected: true,
          },
          ownership: {
            ownsJournal: true,
            restartReadable: true,
            productionAdapter: 'wpdb-single-statement-cas',
            supportedSurface: 'claim-fenced-restart-readable',
          },
          writerLease: {
            strategy: 'claim-fenced-single-writer',
            claimId: 'psh_01j00000000000000000000000',
            claimKeyHash: 'psh_01j00000000000000000000000',
            claimKeyUnique: true,
            fsyncEvidence: true,
            storageGuard: 'wpdb-single-statement-cas',
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: true,
          },
          leaseFence: {
            boundary: 'wpdb-single-statement-cas',
            claimKeyUnique: true,
            fsyncEvidence: true,
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: true,
            writerLease: {
              strategy: 'claim-fenced-single-writer',
              claimId: 'psh_01j00000000000000000000000',
              claimKeyHash: 'psh_01j00000000000000000000000',
              claimKeyUnique: true,
              fsyncEvidence: true,
              storageGuard: 'wpdb-single-statement-cas',
              monotonicSequence: true,
              restartReadable: true,
              staleClaimRejected: true,
            },
          },
        },
        storageGuard: {
          boundary: 'wpdb-single-statement-cas',
          operation: 'update',
          outcome: 'applied',
        },
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    throw new Error(`unexpected fetch to ${urlString}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base,
      local,
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-stale-claim-retry-01',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
      simulateStaleClaimRetry: true,
    });

    assert.equal(summary.ok, true);
    assert.equal(summary.apply.idempotency.staleClaimRetry, true);
    assert.equal(summary.staleClaimRetry.abandoned.code, 'LAB_SIMULATED_STALE_CLAIM_ALL_OLD');
    assert.equal(summary.staleClaimRetry.oldRemoteRecovery.state, 'old-remote');
    assert.equal(summary.staleClaimRetry.oldRemoteRecovery.observedState, 'stale-claim-all-old-simulated');
    assert.deepEqual(summary.staleClaimRetry.oldRemoteRecovery.counts, {
      old: 1,
      new: 0,
      blockedUnknown: 0,
      total: 1,
    });
    assert.equal(summary.dbJournal.leaseFence.staleClaimRejected, true);
    assert.equal(summary.dbJournal.ownership.productionAdapter, 'wpdb-single-statement-cas');
    assert.equal(summary.replayEquivalence.equivalent, true);

    const applyRequests = seen.filter(({ pathname }) => pathname.endsWith('/apply'));
    assert.equal(applyRequests.length, 3);
    assert.equal(applyRequests[0].body.labSimulateStaleClaimAllOld, true);
    assert.equal(applyRequests[1].body.labSimulateStaleClaimAllOld, true);
    assert.equal(applyRequests[2].body.labSimulateStaleClaimAllOld, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('RPP-0516 authenticated push records same-key same-body replay evidence', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  const session = 'psh_01j00000000000000000000000';
  const idempotencyKey = 'idem-rpp-0516-same-key-same-body';
  const auth = {
    identity: { userLogin: 'reprint_push_admin' },
    session: {
      type: 'production-auth-session',
      status: 'active',
      id: session,
      expiresAt: '2030-01-01T00:00:00Z',
    },
  };
  const storageGuard = {
    boundary: 'wpdb-single-statement-cas',
    operation: 'update',
    outcome: 'applied',
  };
  const base = {
    meta: { fixture: 'remote-base' },
    files: {
      'wp-content/uploads/reprint-push/rpp-0516.txt': 'base',
    },
    plugins: {},
    db: {},
  };
  const local = {
    meta: { fixture: 'local-edited' },
    files: {
      'wp-content/uploads/reprint-push/rpp-0516.txt': 'local',
    },
    plugins: {},
    db: {},
  };
  let applyCount = 0;
  let snapshotCount = 0;

  global.fetch = async (url, options = {}) => {
    const urlString = String(url);
    const pathname = new URL(urlString).pathname;
    const body = options.body ? JSON.parse(options.body) : null;
    const headers = options.headers || {};
    const contentHash = headers['X-Auth-Content-Hash'] || emptyBodySha256;
    seen.push({ url: urlString, pathname, body, headers });

    const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    });
    const signedRequest = (path) => ({
      signed: true,
      schemaVersion: 1,
      contentHash,
      sessionHash: 'session-hash-rpp-0516',
      signingKeyHash: 'signing-key-hash-rpp-0516',
      request: { method: 'POST', path },
    });

    if (pathname.endsWith('/preflight')) {
      return json({
        ok: true,
        auth,
        session: { id: session },
      });
    }

    if (pathname.endsWith('/snapshot')) {
      snapshotCount += 1;
      return json({
        ok: true,
        snapshot: snapshotCount === 1 ? base : local,
      });
    }

    if (pathname.endsWith('/dry-run')) {
      return json({
        ok: true,
        mode: 'dry-run',
        receipt: { receiptHash: 'receipt-rpp-0516' },
        responseSchemaVersion: 1,
        auth,
        signedRequest: signedRequest('/wp-json/reprint/v1/push/dry-run'),
      });
    }

    if (pathname.endsWith('/recovery/inspect')) {
      return json({
        ok: true,
        mode: 'inspect',
        responseSchemaVersion: 1,
        auth,
        recovery: {
          state: 'fully-updated-remote',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: {
            integrity: { status: 'ok' },
          },
        },
        signedRequest: signedRequest('/wp-json/reprint/v1/push/recovery/inspect'),
      });
    }

    if (pathname.endsWith('/apply')) {
      applyCount += 1;
      return json({
        ok: true,
        mode: 'apply',
        ...(applyCount === 1 ? {} : { code: 'BATCH_ALREADY_COMMITTED' }),
        applied: 1,
        ...(applyCount === 1 ? { receipt: { receiptHash: 'receipt-rpp-0516' } } : {}),
        responseSchemaVersion: 1,
        auth,
        idempotency: {
          replayed: applyCount !== 1,
          freshMutationWork: applyCount === 1,
          conflict: false,
        },
        storageGuard,
        signedRequest: signedRequest('/wp-json/reprint/v1/push/apply'),
      });
    }

    if (pathname.endsWith('/db-journal')) {
      return json({
        ok: true,
        dbJournal: {
          scope: 'packaged production plugin journal surface; not local Playground fixture only',
          latestRows: [
            {
              sequence: 1,
              event: 'idempotency-opened',
              idempotencyKeyHash: digest(idempotencyKey),
              requestHash: seen.find((entry) => entry.pathname.endsWith('/apply'))?.headers['X-Auth-Content-Hash'] || null,
            },
            { sequence: 2, event: 'mutation-applied' },
            { sequence: 3, event: 'apply-committed' },
          ],
          ownership: {
            ownsJournal: true,
            restartReadable: true,
            productionAdapter: 'wpdb-single-statement-cas',
          },
          leaseFence: {
            boundary: 'wpdb-single-statement-cas',
            claimKeyUnique: true,
            monotonicSequence: true,
            restartReadable: true,
          },
        },
        storageGuard,
        auth,
      });
    }

    throw new Error(`unexpected fetch to ${urlString}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base,
      local,
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey,
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, true);
    assert.equal(summary.replayEquivalence.equivalent, true);
    assert.equal(summary.replay.idempotency.replayed, true);
    assert.equal(summary.replay.idempotency.freshMutationWork, false);

    const applyRequests = seen.filter(({ pathname }) => pathname.endsWith('/apply'));
    assert.equal(applyRequests.length, 2);
    assert.deepEqual(applyRequests[0].body, applyRequests[1].body);
    assert.equal(applyRequests[0].headers['X-Reprint-Push-Idempotency-Key'], idempotencyKey);
    assert.equal(applyRequests[1].headers['X-Reprint-Push-Idempotency-Key'], idempotencyKey);

    const requestBodyHash = sha256Hex(JSON.stringify(applyRequests[0].body));
    assert.equal(applyRequests[0].headers['X-Auth-Content-Hash'], requestBodyHash);
    assert.equal(applyRequests[1].headers['X-Auth-Content-Hash'], requestBodyHash);
    assert.deepEqual(summary.sameKeySameBodyReplay, {
      schemaVersion: 1,
      required: 'same idempotency key, identical request body, replay without fresh mutation work',
      idempotencyKeyHash: digest(idempotencyKey),
      sessionHash: digest(session),
      requestBodyHash,
      applyContentHash: requestBodyHash,
      replayContentHash: requestBodyHash,
      signedContentHashesMatch: true,
      signedContentHashMatchesSubmittedBody: true,
      signedRequestEvidenceRequired: true,
      signedRequestEvidenceProven: true,
      replayed: true,
      freshMutationWork: false,
      noFreshMutationWork: true,
      replayEquivalent: true,
      proved: true,
      verdict: 'SAME_KEY_SAME_BODY_REPLAY_PROVEN',
    });
  } finally {
    global.fetch = originalFetch;
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
        responseSchemaVersion: 1,
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
    ]);
    assert.equal(summary.authSessionLifecycle.apply, undefined);
    assert.equal(summary.authSessionLifecycle.dryRun.revoked, true);
    assert.equal(summary.authSessionLifecycle.replay, undefined);
    assert.deepEqual(summary.authSessionLifecycle.revoked, {
      step: 'dry-run',
      id: 'psh_01j00000000000000000000000',
      type: 'production-auth-session',
      status: 'revoked',
      expiresAt: '2030-01-01T00:00:00Z',
      authUser: 'reprint_push_admin',
      expired: false,
      revoked: true,
      cleanedUp: false,
      rotated: false,
      preserved: true,
    });
    assert.equal(summary.authSessionLifecycle.cleanedUp, null);
    assert.deepEqual(summary.authSessionLifecycle.preserved, {
      step: 'dry-run',
      id: 'psh_01j00000000000000000000000',
      type: 'production-auth-session',
      status: 'revoked',
      expiresAt: '2030-01-01T00:00:00Z',
      authUser: 'reprint_push_admin',
      expired: false,
      revoked: true,
      cleanedUp: false,
      rotated: false,
      preserved: true,
    });
    assert.equal(summary.authSessionLifecycleSummary.revoked?.status, 'revoked');
    assert.equal(summary.authSessionLifecycleSummary.cleanedUp, null);
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
      ],
    );
    assert.equal(seen.length, 3);
    assert.ok(!seen.some(({ url }) => String(url).includes('/apply')));
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
        field: 'auth.session.status',
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

test('production-shaped authenticated push classifies revoked status drift as an unrevoked lifecycle failure', async () => {
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
            status: 'revoked',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
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
      idempotencyKey: 'idem-01-revoked-status-required',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED');
    assert.deepEqual(summary.authSession, {
      field: 'auth.session.status',
      required: 'unrevoked',
      observed: 'revoked',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    });
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: {
        field: 'auth.session.status',
        required: 'unrevoked',
        observed: 'revoked',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      },
    });
    assert.deepEqual(summary.authSessionLifecycleTrace.map(({ step, revoked }) => ({ step, revoked })), [
      { step: 'preflight', revoked: false },
      { step: 'dry-run', revoked: true },
    ]);
    assert.equal(seen.length, 3);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push classifies cleaned-up status drift as an unrevoked lifecycle failure', async () => {
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
            status: 'cleaned-up',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
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
      idempotencyKey: 'idem-01-cleaned-up-status-required',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED');
    assert.deepEqual(summary.authSession, {
      field: 'auth.session.status',
      required: 'unrevoked',
      observed: 'cleaned-up',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    });
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: {
        field: 'auth.session.status',
        required: 'unrevoked',
        observed: 'cleaned-up',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      },
    });
    assert.deepEqual(summary.authSessionLifecycleTrace.map(({ step, cleanedUp }) => ({ step, cleanedUp })), [
      { step: 'preflight', cleanedUp: false },
      { step: 'dry-run', cleanedUp: true },
    ]);
    assert.equal(seen.length, 3);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push attributes cleanup-alias drift to the cleanup field', async () => {
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
            cleanup: true,
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
      idempotencyKey: 'idem-01-cleanup-alias-required',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED');
    assert.deepEqual(summary.authSession, {
      field: 'auth.session.cleanup',
      required: 'unrevoked',
      observed: 'cleaned-up',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    });
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: {
        field: 'auth.session.cleanup',
        required: 'unrevoked',
        observed: 'cleaned-up',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      },
    });
    assert.deepEqual(summary.authSessionLifecycleTrace.map(({ step, cleanedUp }) => ({ step, cleanedUp })), [
      { step: 'preflight', cleanedUp: false },
      { step: 'dry-run', cleanedUp: true },
    ]);
    assert.equal(seen.length, 3);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push attributes underscore cleanup drift to the cleaned_up field', async () => {
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
            cleaned_up: true,
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
      idempotencyKey: 'idem-01-cleaned-up-underscore-required',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED');
    assert.deepEqual(summary.authSession, {
      field: 'auth.session.cleaned_up',
      required: 'unrevoked',
      observed: 'cleaned-up',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    });
    assert.deepEqual(summary.authSessionLifecycleTrace.map(({ step, cleanedUp }) => ({ step, cleanedUp })), [
      { step: 'preflight', cleanedUp: false },
      { step: 'dry-run', cleanedUp: true },
    ]);
    assert.equal(seen.length, 3);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push threads auth-session drift on the checked path and fails closed on revoked dry-run sessions', async () => {
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
      idempotencyKey: 'idem-01-drifted-revoked',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
      labAuthSessionDrift: 'dry-run:revoked',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED');
    assert.deepEqual(summary.authSession, {
      field: 'auth.session.status',
      required: 'unrevoked',
      observed: 'revoked',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    });
    assert.deepEqual(summary.authSessionLifecycleTrace.map(({ step, revoked, cleanedUp }) => ({ step, revoked, cleanedUp })), [
      { step: 'preflight', revoked: false, cleanedUp: false },
      { step: 'dry-run', revoked: true, cleanedUp: false },
    ]);
    assert.match(seen[2].url, /\/dry-run\?reprint_push_lab_auth_session_drift=dry-run%3Arevoked$/);
    assert.equal(seen.length, 3);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push threads auth-session drift on the checked path and fails closed on rotated dry-run sessions', async () => {
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
            id: 'psh_01j00000000000000000000000-rotated',
            expiresAt: '2030-01-01T00:00:00Z',
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
      idempotencyKey: 'idem-01-drifted-rotated',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
      labAuthSessionDrift: 'dry-run:rotated',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED');
    assert.deepEqual(summary.authSession, {
      field: 'auth.session.id',
      required: 'psh_01j00000000000000000000000',
      observed: 'psh_01j00000000000000000000000-rotated',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    });
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: {
        field: 'auth.session.id',
        required: 'psh_01j00000000000000000000000',
        observed: 'psh_01j00000000000000000000000-rotated',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      },
    });
    assert.deepEqual(
      summary.authSessionLifecycleTrace.map(({ step, id, rotated, preserved }) => ({
        step,
        id,
        rotated,
        preserved,
      })),
      [
        {
          step: 'preflight',
          id: 'psh_01j00000000000000000000000',
          rotated: false,
          preserved: false,
        },
        {
          step: 'dry-run',
          id: 'psh_01j00000000000000000000000-rotated',
          rotated: true,
          preserved: false,
        },
      ],
    );
    assert.deepEqual(summary.authSessionLifecycle.rotated, {
      step: 'dry-run',
      id: 'psh_01j00000000000000000000000-rotated',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2030-01-01T00:00:00Z',
      authUser: 'reprint_push_admin',
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: true,
      preserved: false,
    });
    assert.equal(summary.authSessionLifecycle.preserved, null);
    assert.equal(summary.authSessionLifecycleSummary.rotated?.step, 'dry-run');
    assert.equal(summary.authSessionLifecycleSummary.rotated?.rotated, true);
    assert.equal(summary.authSessionLifecycleSummary.preserved, null);
    assert.match(seen[2].url, /\/dry-run\?reprint_push_lab_auth_session_drift=dry-run%3Arotated$/);
    assert.equal(seen.length, 3);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push threads auth-session drift to recovery inspect and fails closed when a preserved read drops the authenticated identity', async () => {
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
        mode: 'apply',
        applied: true,
        code: 'APPLIED',
        responseSchemaVersion: 1,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
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
          identity: {},
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
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
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-01-drifted-recovery-identity',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
      labAuthSessionDrift: 'recovery-inspect:missing-user-login',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED');
    assert.deepEqual(summary.authSession, {
      required: 'authenticated identity',
      observed: 'missing-user-login',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    });
    assert.deepEqual(
      summary.authSessionLifecycleTrace.map(({ step, authUser, preserved }) => ({
        step,
        authUser: authUser || '',
        preserved,
      })),
      [
        { step: 'preflight', authUser: 'reprint_push_admin', preserved: false },
        { step: 'dry-run', authUser: 'reprint_push_admin', preserved: true },
        { step: 'apply', authUser: 'reprint_push_admin', preserved: true },
        { step: 'recovery-inspect', authUser: '', preserved: true },
      ],
    );
    assert.match(seen[4].url, /\/recovery\/inspect\?reprint_push_lab_auth_session_drift=recovery-inspect%3Amissing-user-login$/);
    assert.equal(seen.length, 5);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push keeps the auth/session boundary when apply rotates the preserved session', async () => {
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
        responseSchemaVersion: 1,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000-rotated',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
        idempotency: {
          replayed: false,
          freshMutationWork: true,
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
      idempotencyKey: 'idem-01-apply-rotated-boundary',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED');
    assert.deepEqual(summary.authSession, {
      field: 'auth.session.id',
      required: 'psh_01j00000000000000000000000',
      observed: 'psh_01j00000000000000000000000-rotated',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    });
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: {
        field: 'auth.session.id',
        required: 'psh_01j00000000000000000000000',
        observed: 'psh_01j00000000000000000000000-rotated',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      },
    });
    assert.equal(seen.length, 4);
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
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
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
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: {
        required: 'production-auth-session',
        observed: 'application-password-basic',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
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
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
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
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
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
          },
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
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
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
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
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
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
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
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
        dbJournal: {
          scope: trustedDbJournalScope,
          latestRows: [
            { event: 'idempotency-opened' },
            { event: 'mutation-applied' },
            { event: 'apply-committed' },
          ],
          claim: {
            status: 'active',
            activeClaimId: 'psh_01j00000000000000000000000',
            activeClaimKeyHash: 'psh_01j00000000000000000000000',
            activeClaimSequence: 1,
            activeClaimEvent: 'recovery-claim-opened',
            staleClaimRejected: false,
          },
          ownership: {
            ownsJournal: true,
            restartReadable: true,
            productionAdapter: 'filesystem-compare-rename',
            supportedSurface: 'claim-fenced-restart-readable',
          },
          writerLease: {
            strategy: 'claim-fenced-single-writer',
            claimId: 'psh_01j00000000000000000000000',
            claimKeyHash: 'psh_01j00000000000000000000000',
            claimKeyUnique: true,
            fsyncEvidence: true,
            storageGuard: 'filesystem-compare-rename',
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: false,
          },
          leaseFence: {
            boundary: 'filesystem-compare-rename',
            claimKeyUnique: true,
            fsyncEvidence: true,
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: false,
            writerLease: {
              strategy: 'claim-fenced-single-writer',
              claimId: 'psh_01j00000000000000000000000',
              claimKeyHash: 'psh_01j00000000000000000000000',
              claimKeyUnique: true,
              fsyncEvidence: true,
              storageGuard: 'filesystem-compare-rename',
              monotonicSequence: true,
              restartReadable: true,
              staleClaimRejected: false,
            },
          },
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

test('production-shaped authenticated push accepts replay-equivalent committed replays with regenerated nonce and replay code', async () => {
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
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
        recovery: {
          state: 'fully-updated-remote',
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
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
        dbJournal: {
          scope: trustedDbJournalScope,
          latestRows: [
            { event: 'idempotency-opened' },
            { event: 'mutation-applied' },
            { event: 'apply-committed' },
          ],
          claim: {
            status: 'active',
            activeClaimId: 'psh_01j00000000000000000000000',
            activeClaimKeyHash: 'psh_01j00000000000000000000000',
            activeClaimSequence: 1,
            activeClaimEvent: 'recovery-claim-opened',
            staleClaimRejected: false,
          },
          ownership: {
            ownsJournal: true,
            restartReadable: true,
            productionAdapter: 'filesystem-compare-rename',
            supportedSurface: 'claim-fenced-restart-readable',
          },
          writerLease: {
            strategy: 'claim-fenced-single-writer',
            claimId: 'psh_01j00000000000000000000000',
            claimKeyHash: 'psh_01j00000000000000000000000',
            claimKeyUnique: true,
            fsyncEvidence: true,
            storageGuard: 'filesystem-compare-rename',
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: false,
          },
          leaseFence: {
            boundary: 'filesystem-compare-rename',
            claimKeyUnique: true,
            fsyncEvidence: true,
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: false,
            writerLease: {
              strategy: 'claim-fenced-single-writer',
              claimId: 'psh_01j00000000000000000000000',
              claimKeyHash: 'psh_01j00000000000000000000000',
              claimKeyUnique: true,
              fsyncEvidence: true,
              storageGuard: 'filesystem-compare-rename',
              monotonicSequence: true,
              restartReadable: true,
              staleClaimRejected: false,
            },
          },
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
    if (pathname.includes('/apply')) {
      applyCount += 1;
      return new Response(JSON.stringify(applyCount === 1 ? {
        ok: true,
        mode: 'apply',
        applied: 1,
        code: 'APPLIED',
        responseSchemaVersion: 1,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
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
          request: { mutations: [1] },
        },
        idempotency: {
          replayed: false,
          freshMutationWork: true,
          conflict: false,
        },
      } : {
        ok: true,
        mode: 'apply',
        applied: 1,
        code: 'BATCH_ALREADY_COMMITTED',
        responseSchemaVersion: 1,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
        storageGuard: {
          boundary: 'filesystem-compare-rename',
          operation: 'update',
          outcome: 'applied',
        },
        signedRequest: {
          signed: true,
          schemaVersion: 1,
          contentHash: 'content-01',
          timestamp: '2026-05-26T10:00:04.000Z',
          nonceHash: 'nonce-02',
          sessionHash: 'session-01',
          signingKeyHash: 'signing-key-01',
          request: { mutations: [1] },
        },
        idempotency: {
          replayed: true,
          freshMutationWork: false,
          conflict: false,
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
      idempotencyKey: 'idem-01-committed-replay',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, true);
    assert.equal(summary.code, undefined);
    assert.equal(summary.replay?.code, 'BATCH_ALREADY_COMMITTED');
    assert.equal(summary.replay?.idempotency?.replayed, true);
    assert.equal(summary.replay?.idempotency?.freshMutationWork, false);
    assert.equal(summary.replayEquivalence?.equivalent, true);
    assert.deepEqual(summary.replayEquivalence?.mismatches, []);
    assert.equal(seen.length, 8);
  } finally {
    global.fetch = originalFetch;
  }
});

test('RPP-0517 production-shaped authenticated push rejects same-key different-body conflict with hash-only proof before mutation', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  const sessionId = 'psh_01j00000000000000000000000';
  const idempotencyKey = 'idem-rpp-0517-different-body';
  const idempotencyKeyHash = 'a'.repeat(64);
  const applyRequestHash = 'b'.repeat(64);
  const conflictRequestHash = 'c'.repeat(64);
  const baseSnapshot = {
    files: { 'wp-content/uploads/rpp-0517.txt': 'base' },
    db: {},
    plugins: {},
  };
  const localSnapshot = {
    files: { 'wp-content/uploads/rpp-0517.txt': 'local' },
    db: {},
    plugins: {},
  };
  const auth = {
    identity: { userLogin: credential.username },
    session: {
      type: 'production-auth-session',
      status: 'active',
      id: sessionId,
      expiresAt: '2030-01-01T00:00:00Z',
    },
  };
  const storageGuard = {
    boundary: 'filesystem-compare-rename',
    operation: 'update',
    outcome: 'applied',
  };
  const writerLease = {
    strategy: 'claim-fenced-single-writer',
    claimId: sessionId,
    claimKeyHash: idempotencyKeyHash,
    claimKeyUnique: true,
    fsyncEvidence: true,
    storageGuard: storageGuard.boundary,
    monotonicSequence: true,
    restartReadable: true,
    staleClaimRejected: false,
  };
  let currentSnapshot = baseSnapshot;
  let applyCount = 0;
  let sequence = 0;
  const journalRows = [];
  const appendJournalRow = (event, requestHash, extra = {}) => {
    sequence += 1;
    journalRows.push({
      sequence,
      event,
      idempotencyKeyHash,
      requestHash,
      ...extra,
    });
  };
  const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
  const applyResponse = (overrides = {}) => ({
    ok: true,
    mode: 'apply',
    applied: 1,
    code: 'APPLIED',
    responseSchemaVersion: 1,
    auth,
    receipt: { receiptHash: 'receipt-rpp-0517' },
    storageGuard,
    signedRequest: {
      signed: true,
      schemaVersion: 1,
      contentHash: 'content-rpp-0517',
      timestamp: '2026-05-30T00:00:00.000Z',
      nonceHash: 'nonce-rpp-0517',
      sessionHash: 'session-rpp-0517',
      signingKeyHash: 'signing-key-rpp-0517',
      request: { planHash: 'plan-rpp-0517' },
    },
    idempotency: {
      replayed: false,
      freshMutationWork: true,
      conflict: false,
      status: 'fresh',
      idempotencyKeyHash,
      requestHash: applyRequestHash,
    },
    ...overrides,
  });
  const eventSummaries = () => Object.entries(
    journalRows.reduce((counts, row) => {
      counts[row.event] = (counts[row.event] || 0) + 1;
      return counts;
    }, {}),
  ).map(([event, count]) => ({ event, count }));

  global.fetch = async (url, options = {}) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return jsonResponse({
        ok: true,
        auth,
        session: { id: sessionId },
      });
    }
    if (pathname.includes('/snapshot')) {
      return jsonResponse({
        ok: true,
        snapshot: currentSnapshot,
      });
    }
    if (pathname.includes('/dry-run')) {
      return jsonResponse({
        ok: true,
        auth,
        receipt: {
          receiptHash: 'receipt-rpp-0517',
          authBinding: { expiresAt: '2030-01-01T00:00:00Z' },
        },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return jsonResponse({
        ok: true,
        auth,
        recovery: {
          state: 'fully-updated-remote',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: { integrity: { status: 'ok' } },
        },
      });
    }
    if (pathname.includes('/apply')) {
      const body = JSON.parse(options.body);
      if (body.durableJournalBoundaryProbe) {
        appendJournalRow('idempotency-key-conflict', conflictRequestHash, {
          errorCode: 'IDEMPOTENCY_KEY_CONFLICT',
        });
        return jsonResponse({
          ok: false,
          code: 'IDEMPOTENCY_KEY_CONFLICT',
          mode: 'apply',
          auth,
          idempotency: {
            replayed: false,
            conflict: true,
            freshMutationWork: false,
            idempotencyKeyHash,
            requestHash: conflictRequestHash,
          },
        }, 409);
      }

      applyCount += 1;
      if (applyCount === 1) {
        currentSnapshot = localSnapshot;
        appendJournalRow('idempotency-opened', applyRequestHash);
        appendJournalRow('apply-started', applyRequestHash);
        appendJournalRow('mutation-applied', applyRequestHash, { appliedCount: 1 });
        appendJournalRow('apply-committed', applyRequestHash, { appliedCount: 1 });
        return jsonResponse(applyResponse());
      }

      appendJournalRow('apply-replayed', applyRequestHash, { appliedCount: 0 });
      return jsonResponse(applyResponse({
        code: 'BATCH_ALREADY_COMMITTED',
        idempotency: {
          replayed: true,
          freshMutationWork: false,
          conflict: false,
          status: 'replayed',
          idempotencyKeyHash,
          requestHash: applyRequestHash,
        },
      }));
    }
    if (pathname.includes('/db-journal')) {
      return jsonResponse({
        ok: true,
        auth,
        dbJournal: {
          scope: trustedDbJournalScope,
          latestRows: journalRows,
          rowCount: journalRows.length,
          readback: { pages: 1, complete: true, truncated: false },
          eventSummaries: eventSummaries(),
          claim: {
            status: 'active',
            activeClaimId: sessionId,
            activeClaimKeyHash: idempotencyKeyHash,
            activeClaimSequence: 1,
            activeClaimEvent: 'idempotency-opened',
            staleClaimRejected: false,
          },
          ownership: {
            ownsJournal: true,
            restartReadable: true,
            productionAdapter: storageGuard.boundary,
          },
          writerLease,
          leaseFence: {
            boundary: storageGuard.boundary,
            claimKeyUnique: true,
            fsyncEvidence: true,
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: false,
            writerLease,
          },
        },
        storageGuard,
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: baseSnapshot,
      local: localSnapshot,
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey,
      routeProfile: 'production-shaped',
      proveDurableJournalBoundary: true,
      now: new Date('2026-05-30T00:00:00.000Z'),
    });

    assert.equal(summary.ok, true);
    assert.equal(summary.idempotencyConflict.status, 409);
    assert.equal(summary.idempotencyConflict.code, 'IDEMPOTENCY_KEY_CONFLICT');
    assert.equal(summary.idempotencyConflict.hashOnly, true);
    assert.equal(summary.idempotencyConflict.targetSnapshotUnchanged, true);
    assert.equal(summary.idempotencyConflict.finalMatchesLocal, true);
    assert.equal(summary.idempotencyConflict.idempotency.conflict, true);
    assert.equal(summary.idempotencyConflict.idempotency.freshMutationWork, false);
    assert.equal(summary.idempotencyConflict.idempotency.idempotencyKeyHash, idempotencyKeyHash);
    assert.equal(summary.idempotencyConflict.idempotency.requestHash, conflictRequestHash);
    assert.notEqual(summary.idempotencyConflict.idempotency.requestHash, applyRequestHash);
    assert.match(summary.idempotencyConflict.idempotency.idempotencyKeyHash, /^[a-f0-9]{64}$/);
    assert.match(summary.idempotencyConflict.idempotency.requestHash, /^[a-f0-9]{64}$/);
    assert.equal(summary.dbJournal.mutationApplied, 1);
    assert.equal(summary.dbJournal.eventCounts['idempotency-key-conflict'], 1);
    assert.equal(
      summary.dbJournal.latestEvents.find((entry) => entry.event === 'idempotency-key-conflict')?.requestHash,
      conflictRequestHash,
    );
    assert.equal(applyCount, 2);
    assert.equal(seen.filter(({ url }) => url.includes('/apply')).length, 3);
    const serializedConflict = JSON.stringify(summary.idempotencyConflict);
    assert.doesNotMatch(serializedConflict, new RegExp(idempotencyKey));
    assert.doesNotMatch(serializedConflict, /durableJournalBoundaryProbe/);
    assert.doesNotMatch(serializedConflict, /wp-content\/uploads\/rpp-0517\.txt/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push paginates durable db journal readback across older windows', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  let applyCount = 0;
  const session = {
    type: 'production-auth-session',
    status: 'active',
    id: 'psh_01j00000000000000000000000',
    expiresAt: '2030-01-01T00:00:00Z',
  };
  const auth = {
    identity: { userLogin: 'reprint_push_admin' },
    session,
  };
  const journalRows = [
    { sequence: 1, event: 'idempotency-opened' },
    ...Array.from({ length: 600 }, (_, index) => ({
      sequence: index + 2,
      event: 'mutation-applied',
    })),
    { sequence: 602, event: 'apply-committed' },
  ];
  const journalContract = {
    scope: trustedDbJournalScope,
    claim: {
      status: 'active',
      activeClaimId: session.id,
      activeClaimKeyHash: session.id,
      activeClaimSequence: 1,
      activeClaimEvent: 'recovery-claim-opened',
      staleClaimRejected: false,
    },
    ownership: {
      ownsJournal: true,
      restartReadable: true,
      productionAdapter: 'filesystem-compare-rename',
      supportedSurface: 'claim-fenced-restart-readable',
    },
    writerLease: {
      strategy: 'claim-fenced-single-writer',
      claimId: session.id,
      claimKeyHash: session.id,
      claimKeyUnique: true,
      fsyncEvidence: true,
      storageGuard: 'filesystem-compare-rename',
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: false,
    },
    leaseFence: {
      boundary: 'filesystem-compare-rename',
      claimKeyUnique: true,
      fsyncEvidence: true,
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: false,
      writerLease: {
        strategy: 'claim-fenced-single-writer',
        claimId: session.id,
        claimKeyHash: session.id,
        claimKeyUnique: true,
        fsyncEvidence: true,
        storageGuard: 'filesystem-compare-rename',
        monotonicSequence: true,
        restartReadable: true,
        staleClaimRejected: false,
      },
    },
  };

  function journalPage(urlString) {
    const url = new URL(urlString);
    const limit = Number.parseInt(url.searchParams.get('limit') || '20', 10);
    const beforeSequence = Number.parseInt(url.searchParams.get('beforeSequence') || '0', 10);
    const availableRows = beforeSequence > 0
      ? journalRows.filter((row) => row.sequence < beforeSequence)
      : journalRows;
    const latestRows = availableRows.slice(-limit);
    const oldestSequence = latestRows[0]?.sequence ?? null;
    const newestSequence = latestRows.at(-1)?.sequence ?? null;
    const hasOlder = oldestSequence !== null && journalRows.some((row) => row.sequence < oldestSequence);
    return {
      ok: true,
      auth,
      dbJournal: {
        ...journalContract,
        rowCount: journalRows.length,
        latestRows,
        page: {
          limit,
          beforeSequence: beforeSequence > 0 ? beforeSequence : null,
          rowCount: latestRows.length,
          oldestSequence,
          newestSequence,
          hasOlder,
          nextBeforeSequence: hasOlder ? oldestSequence : null,
        },
      },
      storageGuard: {
        boundary: 'filesystem-compare-rename',
        operation: 'update',
        outcome: 'applied',
      },
    };
  }

  global.fetch = async (url, options) => {
    const urlObject = new URL(String(url));
    seen.push({
      url: String(url),
      pathname: urlObject.pathname,
      search: urlObject.search,
      options,
    });
    const pathname = urlObject.pathname;
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth,
        session: { id: session.id },
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
        auth,
        receipt: { receiptHash: 'receipt-01' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        auth,
        recovery: {
          state: 'fully-updated-remote',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: { integrity: { status: 'ok' } },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify(journalPage(String(url))), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/apply')) {
      applyCount += 1;
      return new Response(JSON.stringify(applyCount === 1 ? {
        ok: true,
        mode: 'apply',
        applied: 1,
        code: 'APPLIED',
        responseSchemaVersion: 1,
        auth,
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
          request: { mutations: [1] },
        },
        idempotency: {
          replayed: false,
          freshMutationWork: true,
          conflict: false,
        },
      } : {
        ok: true,
        mode: 'apply',
        applied: 1,
        code: 'BATCH_ALREADY_COMMITTED',
        responseSchemaVersion: 1,
        auth,
        storageGuard: {
          boundary: 'filesystem-compare-rename',
          operation: 'update',
          outcome: 'applied',
        },
        signedRequest: {
          signed: true,
          schemaVersion: 1,
          contentHash: 'content-01',
          timestamp: '2026-05-26T10:00:04.000Z',
          nonceHash: 'nonce-02',
          sessionHash: 'session-01',
          signingKeyHash: 'signing-key-01',
          request: { mutations: [1] },
        },
        idempotency: {
          replayed: true,
          freshMutationWork: false,
          conflict: false,
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
      idempotencyKey: 'idem-01-paginated-db-journal',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, true);
    assert.equal(summary.dbJournal.rows, 602);
    assert.equal(summary.dbJournal.rowCount, 602);
    assert.equal(summary.dbJournal.mutationApplied, 600);
    assert.equal(summary.dbJournal.idempotencyOpened, 1);
    assert.equal(summary.dbJournal.applyCommitted, true);
    assert.equal(summary.dbJournal.readbackPages, 3);
    assert.equal(summary.dbJournal.paginationComplete, true);
    assert.equal(summary.dbJournal.paginationTruncated, false);
    assert.deepEqual(
      seen
        .filter(({ pathname }) => pathname.endsWith('/db-journal'))
        .map(({ search }) => search),
      ['?limit=80', '?limit=500&beforeSequence=523', '?limit=500&beforeSequence=23'],
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push records preserved-remote retry on the final read-only release probe even when a separate durable-journal boundary stays open', async () => {
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
      snapshotAttempts += 1;
      if (snapshotAttempts === 2) {
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
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
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
        mode: 'apply',
        applied: true,
        code: 'APPLIED',
        responseSchemaVersion: 1,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
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
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
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
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
        dbJournal: {
          scope: trustedDbJournalScope,
          latestRows: [
            { event: 'idempotency-opened' },
            { event: 'mutation-applied' },
            { event: 'apply-committed' },
          ],
          ownership: {
            ownsJournal: true,
            restartReadable: true,
            productionAdapter: 'filesystem-compare-rename',
          },
          leaseFence: {
            boundary: 'filesystem-compare-rename',
            claimKeyUnique: true,
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: false,
          },
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
      simulatePreservedRemoteRetryPath: '/snapshot',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'DURABLE_JOURNAL_NOT_PROVEN');
    assert.equal(summary.retryAttempts, 2);
    assert.equal(snapshotAttempts, 3);
    assert.equal(summary.dbJournal?.retryAttempts, 1);
    assert.deepEqual(summary.replayAndRetry, {
      required: '/snapshot',
      observed: '/snapshot',
      retryAttempts: 2,
      verdict: 'PRESERVED_REMOTE_RETRY_PROVEN',
    });
    assert.ok(seen.filter(({ url }) => url.includes('/snapshot')).length >= 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when only the planning snapshot retries before the final preserved-remote read', async () => {
  const originalFetch = global.fetch;
  let snapshotAttempts = 0;
  global.fetch = async (url) => {
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
      snapshotAttempts += 1;
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
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
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
        mode: 'apply',
        applied: true,
        code: 'APPLIED',
        responseSchemaVersion: 1,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
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
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
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
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
        dbJournal: {
          scope: trustedDbJournalScope,
          latestRows: [
            { event: 'idempotency-opened' },
            { event: 'mutation-applied' },
            { event: 'apply-committed' },
          ],
          ownership: {
            ownsJournal: true,
            restartReadable: true,
            productionAdapter: 'filesystem-compare-rename',
          },
          leaseFence: {
            boundary: 'filesystem-compare-rename',
            claimKeyUnique: true,
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: false,
          },
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
      idempotencyKey: 'idem-01-planning-snapshot-only-retry',
      routeProfile: 'production-shaped',
      simulatePreservedRemoteRetryPath: '/snapshot',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRESERVED_REMOTE_RETRY_REQUIRED');
    assert.equal(snapshotAttempts, 3);
    assert.deepEqual(summary.replayAndRetry, {
      required: '/snapshot',
      observed: 'missing-transient-retry',
      retryAttempts: 1,
      verdict: 'PRESERVED_REMOTE_RETRY_REQUIRED',
    });
    assert.equal(
      summary.boundary?.firstRemainingProductionBoundary,
      'replay and preserved-remote retry on the checked release path',
    );
    assert.equal(summary.boundary?.verdict, 'PRESERVED_REMOTE_RETRY_REQUIRED');
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push keeps durable journal proof ahead of missing preserved-remote retry evidence', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
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
        mode: 'apply',
        applied: 1,
        code: 'BATCH_ALREADY_COMMITTED',
        responseSchemaVersion: 1,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
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
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
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
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
        dbJournal: {
          scope: trustedDbJournalScope,
          latestRows: [
            { event: 'idempotency-opened' },
            { event: 'mutation-applied' },
            { event: 'apply-committed' },
          ],
          ownership: {
            ownsJournal: true,
            restartReadable: true,
            productionAdapter: 'filesystem-compare-rename',
          },
          leaseFence: {
            boundary: 'filesystem-compare-rename',
            claimKeyUnique: true,
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: false,
          },
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
      idempotencyKey: 'idem-01-preserved-remote-retry-required',
      routeProfile: 'production-shaped',
      simulatePreservedRemoteRetryPath: '/unmatched-read-path',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'DURABLE_JOURNAL_NOT_PROVEN');
    assert.equal(summary.retryAttempts, 1);
    assert.deepEqual(summary.replayAndRetry, {
      required: '/unmatched-read-path',
      observed: 'missing-transient-retry',
      retryAttempts: 1,
      verdict: 'PRESERVED_REMOTE_RETRY_REQUIRED',
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
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push keeps journal auth/session readback ahead of missing preserved-remote retry evidence', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
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
        mode: 'apply',
        applied: 1,
        code: 'BATCH_ALREADY_COMMITTED',
        responseSchemaVersion: 1,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
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
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
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
          identity: { userLogin: 'unexpected-user' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
        dbJournal: {
          scope: 'packaged production plugin journal surface; not local Playground fixture only',
          latestRows: [
            { event: 'idempotency-opened' },
            { event: 'mutation-applied' },
            { event: 'apply-committed' },
          ],
          ownership: {
            ownsJournal: true,
            restartReadable: true,
            productionAdapter: 'filesystem-compare-rename',
            supportedSurface: 'claim-fenced-restart-readable',
          },
          leaseFence: {
            boundary: 'filesystem-compare-rename',
            claimKeyUnique: true,
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: false,
          },
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
      idempotencyKey: 'idem-01-preserved-remote-retry-auth-drift',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
      simulatePreservedRemoteRetryPath: '/unmatched-read-path',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED');
    assert.deepEqual(summary.authSession, {
      required: 'authenticated identity match',
      observed: 'unexpected-user',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    });
    assert.equal(summary.replayAndRetry, undefined);
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: {
        required: 'authenticated identity match',
        observed: 'unexpected-user',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      },
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push accepts nested db journal storage guard evidence', async () => {
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
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
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
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
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
    if (pathname.includes('/apply')) {
      applyCount += 1;
      return new Response(JSON.stringify({
        ok: true,
        mode: 'apply',
        applied: true,
        code: applyCount === 1 ? 'APPLIED' : 'BATCH_ALREADY_COMMITTED',
        responseSchemaVersion: 1,
        receipt: { receiptHash: 'receipt-01' },
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
        signedRequest: {
          signed: true,
          schemaVersion: 1,
          contentHash: 'content-01',
          timestamp: applyCount === 1 ? '2026-05-26T10:00:00.000Z' : '2026-05-26T10:00:02.000Z',
          nonceHash: applyCount === 1 ? 'nonce-01' : 'nonce-02',
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
    if (pathname.includes('/db-journal')) {
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
        dbJournal: {
          scope: 'packaged production plugin journal surface; not local Playground fixture only',
          claim: {
            status: 'stale-claim-rejected',
            activeClaimId: 'psh_01j00000000000000000000000',
            activeClaimKeyHash: 'psh_01j00000000000000000000000',
            activeClaimSequence: 2,
            activeClaimEvent: 'stale-claim-rejected',
            previousClaimId: 'psh_01i99999999999999999999999',
            previousClaimKeyHash: 'psh_01i99999999999999999999999',
            previousClaimSequence: 1,
            previousClaimEvent: 'recovery-claim-opened',
            idempotencyKeyHash: 'idempotency-claim-01',
            requestHash: 'request-claim-01',
            planHash: 'plan-claim-01',
            receiptHash: 'receipt-claim-01',
            planFingerprint: 'plan-fingerprint-01',
            mutationCount: 1,
            appliedCount: 1,
            staleClaimRejected: false,
          },
          ownership: {
            ownsJournal: true,
            restartReadable: true,
            productionAdapter: 'wpdb-single-statement-cas',
            supportedSurface: 'claim-fenced-restart-readable',
          },
          writerLease: {
            strategy: 'claim-fenced-single-writer',
            claimId: 'psh_01j00000000000000000000000',
            claimKeyUnique: true,
            fsyncEvidence: true,
            storageGuard: 'wpdb-single-statement-cas',
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: false,
          },
          leaseFence: {
            boundary: 'wpdb-single-statement-cas',
            storageGuard: 'wpdb-single-statement-cas',
            claimKeyUnique: true,
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: false,
            writerLease: {
              strategy: 'claim-fenced-single-writer',
              claimId: 'psh_01j00000000000000000000000',
              claimKeyUnique: true,
              fsyncEvidence: true,
              storageGuard: 'wpdb-single-statement-cas',
              monotonicSequence: true,
              restartReadable: true,
              staleClaimRejected: false,
            },
          },
          latestRows: [
            { event: 'idempotency-opened' },
            {
              event: 'mutation-applied',
              resourceHashEvidence: {
                mutation: {
                  storageGuard: {
                    boundary: 'wpdb-single-statement-cas',
                    operation: 'update',
                    outcome: 'applied',
                  },
                },
              },
            },
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
      idempotencyKey: 'idem-01-nested-db-journal-storage-guard',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, true);
    assert.deepEqual(summary.dbJournal?.storageGuard, {
      boundary: 'wpdb-single-statement-cas',
      operation: 'update',
      outcome: 'applied',
    });
    assert.equal(summary.dbJournal?.scope, 'packaged production plugin journal surface; not local Playground fixture only');
    assert.deepEqual(summary.dbJournal?.ownership, {
      ownsJournal: true,
      restartReadable: true,
      productionAdapter: 'wpdb-single-statement-cas',
      supportedSurface: 'claim-fenced-restart-readable',
    });
    assert.deepEqual(summary.dbJournal?.claim, {
      status: 'stale-claim-rejected',
      activeClaimId: 'psh_01j00000000000000000000000',
      activeClaimKeyHash: 'psh_01j00000000000000000000000',
      activeClaimSequence: 2,
      activeClaimEvent: 'stale-claim-rejected',
      previousClaimId: 'psh_01i99999999999999999999999',
      previousClaimKeyHash: 'psh_01i99999999999999999999999',
      previousClaimSequence: 1,
      previousClaimEvent: 'recovery-claim-opened',
      idempotencyKeyHash: 'idempotency-claim-01',
      requestHash: 'request-claim-01',
      planHash: 'plan-claim-01',
      receiptHash: 'receipt-claim-01',
      planFingerprint: 'plan-fingerprint-01',
      mutationCount: 1,
      appliedCount: 1,
      staleClaimRejected: false,
    });
    assert.deepEqual(summary.dbJournal?.writerLease, {
      strategy: 'claim-fenced-single-writer',
      claimId: 'psh_01j00000000000000000000000',
      claimKeyUnique: true,
      fsyncEvidence: true,
      storageGuard: 'wpdb-single-statement-cas',
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: false,
    });
    assert.deepEqual(summary.dbJournal?.leaseFence, {
      boundary: 'wpdb-single-statement-cas',
      storageGuard: 'wpdb-single-statement-cas',
      claimKeyUnique: true,
      fsyncEvidence: true,
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: false,
      writerLease: {
        strategy: 'claim-fenced-single-writer',
        claimId: 'psh_01j00000000000000000000000',
        claimKeyUnique: true,
        fsyncEvidence: true,
        storageGuard: 'wpdb-single-statement-cas',
        monotonicSequence: true,
        restartReadable: true,
        staleClaimRejected: false,
      },
    });
    assert.ok(seen.some(({ url }) => url.includes('/db-journal')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when the checked release path only has a weak db-journal proof', async () => {
  const originalFetch = global.fetch;
  let applyCount = 0;
  global.fetch = async (url) => {
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
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
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
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
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
    if (pathname.includes('/apply')) {
      applyCount += 1;
      return new Response(JSON.stringify({
        ok: true,
        mode: 'apply',
        applied: true,
        code: applyCount === 1 ? 'APPLIED' : 'BATCH_ALREADY_COMMITTED',
        responseSchemaVersion: 1,
        receipt: { receiptHash: 'receipt-01' },
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
        signedRequest: {
          signed: true,
          schemaVersion: 1,
          contentHash: 'content-01',
          timestamp: applyCount === 1 ? '2026-05-26T10:00:00.000Z' : '2026-05-26T10:00:02.000Z',
          nonceHash: applyCount === 1 ? 'nonce-01' : 'nonce-02',
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
    if (pathname.includes('/db-journal')) {
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
        dbJournal: {
          scope: 'packaged production plugin journal surface; not local Playground fixture only',
          claim: {
            status: 'stale-claim-rejected',
            activeClaimId: 'psh_01j00000000000000000000000',
            activeClaimKeyHash: 'psh_01j00000000000000000000000',
            activeClaimSequence: 2,
            activeClaimEvent: 'stale-claim-rejected',
            previousClaimId: 'psh_01i99999999999999999999999',
            previousClaimKeyHash: 'psh_01i99999999999999999999999',
            previousClaimSequence: 1,
            previousClaimEvent: 'recovery-claim-opened',
            idempotencyKeyHash: 'idempotency-claim-01',
            requestHash: 'request-claim-01',
            planHash: 'plan-claim-01',
            receiptHash: 'receipt-claim-01',
            planFingerprint: 'plan-fingerprint-01',
            mutationCount: 1,
            appliedCount: 1,
            staleClaimRejected: false,
          },
          ownership: {
            ownsJournal: true,
            restartReadable: true,
            productionAdapter: 'wpdb-single-statement-cas',
            supportedSurface: 'claim-fenced-restart-readable',
          },
          writerLease: {
            strategy: 'claim-fenced-single-writer',
            claimId: 'psh_01j00000000000000000000000',
            claimKeyUnique: true,
            fsyncEvidence: true,
            storageGuard: 'wpdb-single-statement-cas',
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: false,
          },
          leaseFence: {
            boundary: 'wpdb-single-statement-cas',
            claimKeyUnique: true,
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: false,
            writerLease: {
              strategy: 'claim-fenced-single-writer',
              claimId: 'psh_01j00000000000000000000000',
              claimKeyUnique: true,
              fsyncEvidence: true,
              storageGuard: 'wpdb-single-statement-cas',
              monotonicSequence: true,
              restartReadable: true,
              staleClaimRejected: false,
            },
          },
          latestRows: [
            { event: 'idempotency-opened' },
            {
              event: 'mutation-applied',
              resourceHashEvidence: {
                mutation: {
                  storageGuard: {
                    boundary: 'wpdb-single-statement-cas',
                    operation: 'update',
                    outcome: 'applied',
                  },
                },
              },
            },
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
      idempotencyKey: 'idem-01-checked-journal-required',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'DURABLE_JOURNAL_NOT_PROVEN');
    assert.equal(summary.dbJournal?.ownership?.productionAdapter, 'wpdb-single-statement-cas');
    assert.equal(summary.dbJournal?.leaseFence?.staleClaimRejected, false);
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
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when checked db-journal stale-claim lifecycle metadata drifts', async () => {
  const originalFetch = global.fetch;
  let applyCount = 0;
  global.fetch = async (url) => {
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
        mode: 'dry-run',
        applied: 0,
        receipt: { receiptHash: 'receipt-01' },
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
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
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
        recovery: {
          state: 'available',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: { integrity: { status: 'ok' } },
        },
        dbJournal: {
          scope: 'packaged production plugin journal surface; not local Playground fixture only',
          claim: {
            status: 'stale-claim-rejected',
            activeClaimId: 'psh_01j00000000000000000000000',
            activeClaimKeyHash: 'psh_01j00000000000000000000000',
            activeClaimSequence: 2,
            activeClaimEvent: 'stale-claim-rejected',
            previousClaimId: 'psh_01i99999999999999999999999',
            previousClaimKeyHash: 'psh_01i99999999999999999999999',
            previousClaimSequence: 1,
            previousClaimEvent: 'recovery-claim-opened',
            idempotencyKeyHash: 'idempotency-claim-01',
            requestHash: 'request-claim-01',
            planHash: 'plan-claim-01',
            receiptHash: 'receipt-claim-01',
            planFingerprint: 'plan-fingerprint-01',
            mutationCount: 1,
            appliedCount: 1,
            staleClaimRejected: false,
          },
          ownership: {
            ownsJournal: true,
            restartReadable: true,
            productionAdapter: 'wpdb-single-statement-cas',
            supportedSurface: 'claim-fenced-restart-readable',
          },
          writerLease: {
            strategy: 'claim-fenced-single-writer',
            claimId: 'psh_01j00000000000000000000000',
            claimKeyHash: 'psh_01j00000000000000000000000',
            claimKeyUnique: true,
            fsyncEvidence: true,
            storageGuard: 'wpdb-single-statement-cas',
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: true,
          },
          leaseFence: {
            boundary: 'wpdb-single-statement-cas',
            claimKeyUnique: true,
            fsyncEvidence: true,
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: true,
            writerLease: {
              strategy: 'claim-fenced-single-writer',
              claimId: 'psh_01j00000000000000000000000',
              claimKeyHash: 'psh_01j00000000000000000000000',
              claimKeyUnique: true,
              fsyncEvidence: true,
              storageGuard: 'wpdb-single-statement-cas',
              monotonicSequence: true,
              restartReadable: true,
              staleClaimRejected: true,
            },
          },
          latestRows: [
            { event: 'idempotency-opened' },
            {
              event: 'mutation-applied',
              resourceHashEvidence: {
                mutation: {
                  storageGuard: {
                    boundary: 'wpdb-single-statement-cas',
                    operation: 'update',
                    outcome: 'applied',
                  },
                },
              },
            },
            { event: 'apply-committed' },
          ],
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
        applied: 0,
        receipt: { receiptHash: 'receipt-01' },
        responseSchemaVersion: 1,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
        signedRequest: {
          signed: true,
          schemaVersion: 1,
          contentHash: 'content-01',
          timestamp: applyCount === 1 ? '2026-05-26T10:00:00.000Z' : '2026-05-26T10:00:02.000Z',
          nonceHash: applyCount === 1 ? 'nonce-01' : 'nonce-02',
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
    if (pathname.includes('/db-journal')) {
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
        dbJournal: {
          scope: 'packaged production plugin journal surface; not local Playground fixture only',
          claim: {
            status: 'stale-claim-rejected',
            activeClaimId: 'psh_01j00000000000000000000000',
            activeClaimKeyHash: 'psh_01j00000000000000000000000',
            activeClaimSequence: 2,
            activeClaimEvent: 'stale-claim-rejected',
            previousClaimId: 'psh_01i99999999999999999999999',
            previousClaimKeyHash: 'psh_01i99999999999999999999999',
            previousClaimSequence: 1,
            previousClaimEvent: 'recovery-claim-opened',
            idempotencyKeyHash: 'idempotency-claim-01',
            requestHash: 'request-claim-01',
            planHash: 'plan-claim-01',
            receiptHash: 'receipt-claim-01',
            planFingerprint: 'plan-fingerprint-01',
            mutationCount: 1,
            appliedCount: 1,
            staleClaimRejected: false,
          },
          ownership: {
            ownsJournal: true,
            restartReadable: true,
            productionAdapter: 'wpdb-single-statement-cas',
            supportedSurface: 'claim-fenced-restart-readable',
          },
          writerLease: {
            strategy: 'claim-fenced-single-writer',
            claimId: 'psh_01j00000000000000000000000',
            claimKeyHash: 'psh_01j00000000000000000000000',
            claimKeyUnique: true,
            fsyncEvidence: true,
            storageGuard: 'wpdb-single-statement-cas',
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: true,
          },
          leaseFence: {
            boundary: 'wpdb-single-statement-cas',
            claimKeyUnique: true,
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: true,
            writerLease: {
              strategy: 'claim-fenced-single-writer',
              claimId: 'psh_01j00000000000000000000000',
              claimKeyHash: 'psh_01j00000000000000000000000',
              claimKeyUnique: true,
              fsyncEvidence: true,
              storageGuard: 'wpdb-single-statement-cas',
              monotonicSequence: true,
              restartReadable: true,
              staleClaimRejected: true,
            },
          },
          latestRows: [
            { event: 'idempotency-opened' },
            {
              event: 'mutation-applied',
              resourceHashEvidence: {
                mutation: {
                  storageGuard: {
                    boundary: 'wpdb-single-statement-cas',
                    operation: 'update',
                    outcome: 'applied',
                  },
                },
              },
            },
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
      idempotencyKey: 'idem-01-checked-journal-stale-claim-lifecycle-drift',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'DURABLE_JOURNAL_NOT_PROVEN');
    assert.equal(summary.dbJournal?.claim?.activeClaimEvent, 'stale-claim-rejected');
    assert.equal(summary.dbJournal?.claim?.staleClaimRejected, false);
    assert.equal(summary.dbJournal?.leaseFence?.staleClaimRejected, true);
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
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push preserves recovery inspect claim and storage-guard evidence', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
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
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
        recovery: {
          state: 'blocked-recovery',
          counts: { old: 0, new: 0, blockedUnknown: 1, total: 1 },
          journal: {
            scope: 'checked live production-shaped recovery journal surface; not local Playground fixture only',
            integrity: {
              schemaVersion: 1,
              status: 'ok',
              scope: 'checked live production-shaped recovery journal surface; not local Playground fixture only',
            },
            claim: {
              status: 'stale-claim-rejected',
              activeClaimId: 'claim-live-02',
              activeClaimKeyHash: 'claim-live-02',
              activeClaimSequence: 2,
              activeClaimEvent: 'stale-claim-rejected',
              previousClaimId: 'claim-live-01',
              previousClaimKeyHash: 'claim-live-01',
              previousClaimSequence: 1,
              previousClaimEvent: 'recovery-claim-opened',
              idempotencyKeyHash: 'idem-live',
              requestHash: 'request-live',
              staleClaimRejected: true,
            },
            storageGuard: {
              boundary: 'wpdb-single-statement-cas',
              operation: 'update',
              outcome: 'applied',
            },
            ownership: {
              ownsJournal: true,
              restartReadable: true,
              productionAdapter: 'wpdb-single-statement-cas',
              supportedSurface: 'claim-fenced-restart-readable',
            },
            writerLease: {
              strategy: 'claim-fenced-single-writer',
              claimId: 'claim-live-02',
              claimKeyUnique: true,
              fsyncEvidence: true,
              storageGuard: 'wpdb-single-statement-cas',
              monotonicSequence: true,
              restartReadable: true,
              staleClaimRejected: true,
            },
            leaseFence: {
              boundary: 'wpdb-single-statement-cas',
              claimKeyUnique: true,
              fsyncEvidence: true,
              monotonicSequence: true,
              restartReadable: true,
              staleClaimRejected: true,
              writerLease: {
                strategy: 'claim-fenced-single-writer',
                claimId: 'claim-live-02',
                claimKeyUnique: true,
                fsyncEvidence: true,
                storageGuard: 'wpdb-single-statement-cas',
                monotonicSequence: true,
                restartReadable: true,
                staleClaimRejected: true,
              },
            },
          },
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
      idempotencyKey: 'idem-recovery-claim-evidence',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'RECOVERY_INSPECT_JOURNAL_UNTRUSTED');
    assert.deepEqual(summary.recoveryInspect?.recovery?.journal?.claim, {
      status: 'stale-claim-rejected',
      activeClaimId: 'claim-live-02',
      activeClaimKeyHash: 'claim-live-02',
      activeClaimSequence: 2,
      activeClaimEvent: 'stale-claim-rejected',
      previousClaimId: 'claim-live-01',
      previousClaimKeyHash: 'claim-live-01',
      previousClaimSequence: 1,
      previousClaimEvent: 'recovery-claim-opened',
      idempotencyKeyHash: 'idem-live',
      requestHash: 'request-live',
      planHash: null,
      receiptHash: null,
      planFingerprint: null,
      mutationCount: null,
      appliedCount: null,
      staleClaimRejected: true,
    });
    assert.deepEqual(summary.recoveryInspect?.recovery?.journal?.storageGuard, {
      boundary: 'wpdb-single-statement-cas',
      operation: 'update',
      outcome: 'applied',
    });
    assert.equal(summary.recoveryInspect?.recovery?.journal?.writerLease?.claimId, 'claim-live-02');
    assert.equal(summary.recoveryInspect?.recovery?.journal?.leaseFence?.writerLease?.claimId, 'claim-live-02');
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
        mode: 'apply',
        applied: true,
        code: 'APPLIED',
        responseSchemaVersion: 1,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
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
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
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
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
        dbJournal: {
          scope: trustedDbJournalScope,
          latestRows: [
            { event: 'idempotency-opened' },
            { event: 'mutation-applied' },
            { event: 'apply-committed' },
          ],
          ownership: {
            ownsJournal: true,
            restartReadable: true,
            productionAdapter: 'filesystem-compare-rename',
          },
          leaseFence: {
            boundary: 'filesystem-compare-rename',
            claimKeyUnique: true,
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: false,
          },
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

test('production-shaped authenticated push fails closed when a different read retries than the required preserved remote path', async () => {
  const originalFetch = global.fetch;
  let preflightAttempts = 0;
  global.fetch = async (url) => {
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
        mode: 'apply',
        applied: true,
        code: 'APPLIED',
        responseSchemaVersion: 1,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
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
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
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
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
        dbJournal: {
          scope: trustedDbJournalScope,
          latestRows: [
            { event: 'idempotency-opened' },
            { event: 'mutation-applied' },
            { event: 'apply-committed' },
          ],
          ownership: {
            ownsJournal: true,
            restartReadable: true,
            productionAdapter: 'filesystem-compare-rename',
          },
          leaseFence: {
            boundary: 'filesystem-compare-rename',
            claimKeyUnique: true,
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: false,
          },
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
      idempotencyKey: 'idem-01-required-db-journal-retry',
      routeProfile: 'production-shaped',
      simulatePreservedRemoteRetryPath: '/db-journal?limit=80',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRESERVED_REMOTE_RETRY_REQUIRED');
    assert.equal(summary.retryAttempts, 2);
    assert.equal(preflightAttempts, 2);
    assert.deepEqual(summary.replayAndRetry, {
      required: '/db-journal?limit=80',
      observed: 'missing-transient-retry',
      retryAttempts: 1,
      verdict: 'PRESERVED_REMOTE_RETRY_REQUIRED',
    });
    assert.equal(
      summary.boundary?.firstRemainingProductionBoundary,
      'replay and preserved-remote retry on the checked release path',
    );
    assert.equal(summary.boundary?.verdict, 'PRESERVED_REMOTE_RETRY_REQUIRED');
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when a preserved remote snapshot exhausts transient retries', async () => {
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
      snapshotAttempts += 1;
      throw Object.assign(new TypeError('socket closed'), { cause: { code: 'ECONNRESET' } });
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
      idempotencyKey: 'idem-01-snapshot-retry-exhausted',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'SNAPSHOT_FAILED');
    assert.equal(summary.retryAttempts, 4);
    assert.equal(snapshotAttempts, 4);
    assert.deepEqual(summary.remoteSnapshot, {
      status: 0,
      ok: false,
      retryAttempts: 4,
      code: 'ECONNRESET',
      error: 'socket closed',
      transportFailure: true,
      request: {
        method: 'GET',
        pathname: '/wp-json/reprint/v1/push/snapshot',
        retryable: true,
      },
    });
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
      durableJournal: {
        storageLeaseFence: 'retained Playground journal storage is lab-scoped; production ownership, lease fencing, and replay wiring are not yet proven on the checked release boundary',
        verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
        phase: 'snapshot',
      },
    });
    assert.equal(seen.filter(({ url }) => url.includes('/snapshot')).length, 4);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when replay auth-session preserved state drifts', async () => {
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
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
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
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
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
    if (pathname.includes('/apply')) {
      applyCount += 1;
      return new Response(JSON.stringify({
        ok: true,
        mode: 'apply',
        applied: true,
        code: applyCount === 1 ? 'APPLIED' : 'BATCH_ALREADY_COMMITTED',
        responseSchemaVersion: 1,
        receipt: { receiptHash: 'receipt-01' },
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
            preserved: applyCount === 1,
          },
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
          replayed: applyCount > 1,
          freshMutationWork: applyCount === 1,
          conflict: false,
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
    if (pathname.includes('/db-journal')) {
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
        dbJournal: {
          scope: trustedDbJournalScope,
          latestRows: [
            { event: 'idempotency-opened' },
            { event: 'mutation-applied' },
            { event: 'apply-committed' },
          ],
          ownership: {
            ownsJournal: true,
            restartReadable: true,
            productionAdapter: 'filesystem-compare-rename',
          },
          leaseFence: {
            boundary: 'filesystem-compare-rename',
            claimKeyUnique: true,
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: false,
          },
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
      idempotencyKey: 'idem-06-replay-preserved-drift',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'REPLAY_NOT_EQUIVALENT');
    assert.equal(summary.replayEquivalence?.equivalent, false);
    assert.ok(
      summary.replayEquivalence?.mismatches?.some((mismatch) =>
        mismatch.field === 'authSessionPreserved'
        && mismatch.apply === true
        && mismatch.replay === false),
    );
    assert.equal(summary.boundary?.durableJournal?.phase, 'journal-inspect');
    assert.equal(seen.length, 8);
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
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
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
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
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
    if (String(url).includes('/recovery/inspect')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
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
      idempotencyKey: 'idem-01-no-status',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED');
    assert.deepEqual(summary.authSession, {
      required: 'active',
      observed: 'missing',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    });
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: {
        required: 'active',
        observed: 'missing',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
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
          },
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
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
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
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
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
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
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
      field: 'auth.session.type',
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
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
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
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
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
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'expired',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
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
      field: 'auth.session.status',
      required: 'unexpired',
      observed: 'expired',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    });
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: {
        field: 'auth.session.status',
        required: 'unexpired',
        observed: 'expired',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
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
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
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
      field: 'auth',
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
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
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
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
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
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
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
    if (pathname.includes('/db-journal')) {
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
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
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
          scope: trustedDbJournalScope,
          latestRows: [
            { event: 'idempotency-opened' },
            { event: 'mutation-applied' },
            { event: 'apply-committed' },
          ],
          ownership: {
            ownsJournal: true,
            restartReadable: true,
            productionAdapter: 'filesystem-compare-rename',
          },
          leaseFence: {
            boundary: 'filesystem-compare-rename',
            claimKeyUnique: true,
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: false,
          },
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

test('production-shaped authenticated push fails closed when replay changes the authenticated identity user id', async () => {
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
          identity: { userId: 7, userLogin: 'reprint_push_admin' },
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
        receipt: { receiptHash: 'receipt-01' },
        auth: {
          identity: { userId: 7, userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            expiresAt: '2030-01-01T00:00:00Z',
            id: 'psh_01j00000000000000000000000',
          },
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
          identity: { userId: 7, userLogin: 'reprint_push_admin' },
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
      applyCount += 1;
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: {
            userId: applyCount === 1 ? 7 : 9,
            userLogin: 'reprint_push_admin',
          },
          session: {
            type: 'production-auth-session',
            status: 'active',
            expiresAt: '2030-01-01T00:00:00Z',
            id: 'psh_01j00000000000000000000000',
          },
        },
        idempotency: {
          replayed: applyCount === 2,
          freshMutationWork: applyCount === 1,
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
          identity: { userId: 7, userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            expiresAt: '2030-01-01T00:00:00Z',
            id: 'psh_01j00000000000000000000000',
          },
        },
        dbJournal: {
          scope: trustedDbJournalScope,
          latestRows: [
            { event: 'idempotency-opened' },
            { event: 'mutation-applied' },
            { event: 'apply-committed' },
          ],
          ownership: {
            ownsJournal: true,
            restartReadable: true,
            productionAdapter: 'filesystem-compare-rename',
          },
          leaseFence: {
            boundary: 'filesystem-compare-rename',
            claimKeyUnique: true,
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: false,
          },
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
      idempotencyKey: 'idem-06-user-id-replay',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'REPLAY_NOT_EQUIVALENT');
    assert.equal(summary.replayEquivalence?.equivalent, false);
    assert.deepEqual(
      summary.replayEquivalence?.mismatches?.find((mismatch) => mismatch.field === 'authUserId'),
      {
        field: 'authUserId',
        apply: 7,
        replay: 9,
      },
    );
    assert.equal(summary.boundary.durableJournal.phase, 'replay');
    assert.equal(seen.filter(({ url }) => url.includes('/apply')).length, 2);
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
        mode: 'apply',
        applied: true,
        code: 'APPLIED',
        responseSchemaVersion: 1,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
        receipt: { receiptHash: 'receipt-01' },
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
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
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
    if (pathname.includes('/db-journal')) {
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
        dbJournal: {
          scope: trustedDbJournalScope,
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
    assert.equal(summary.code, 'DURABLE_JOURNAL_NOT_PROVEN');
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
        mode: 'apply',
        applied: true,
        code: 'APPLIED',
        responseSchemaVersion: 1,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
        receipt: { receiptHash: 'receipt-01' },
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
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
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
    if (pathname.includes('/db-journal')) {
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
        dbJournal: {
          scope: trustedDbJournalScope,
          latestRows: [
            { event: 'idempotency-opened' },
            { event: 'mutation-applied' },
            { event: 'apply-committed' },
          ],
          leaseFence: {
            boundary: 'filesystem-compare-rename',
            claimKeyUnique: true,
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: false,
          },
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
      idempotencyKey: 'idem-08-storage-guard',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'DURABLE_JOURNAL_NOT_PROVEN');
    assert.deepEqual(summary.dbJournal?.storageGuard, {
      boundary: 'filesystem-compare-rename',
      operation: 'update',
      outcome: 'applied',
    });
    assert.equal(summary.dbJournal?.ownership, undefined);
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
        mode: 'apply',
        applied: true,
        code: 'APPLIED',
        responseSchemaVersion: 1,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
        receipt: { receiptHash: 'receipt-01' },
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
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
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
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify({
        ok: true,
        dbJournal: {
          scope: trustedDbJournalScope,
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

test('production-shaped authenticated push fails closed when db journal readback drops the auth envelope even without the stricter production-session gate', async () => {
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
        mode: 'apply',
        applied: true,
        code: 'APPLIED',
        responseSchemaVersion: 1,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
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
          request: { method: 'POST', path: '/wp-json/reprint/v1/push/apply' },
        },
        idempotency: {
          replayed: false,
          freshMutationWork: true,
          status: 'opened',
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
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
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
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify({
        ok: true,
        storageGuard: {
          boundary: 'filesystem-compare-rename',
          operation: 'update',
          outcome: 'applied',
        },
        dbJournal: {
          scope: trustedDbJournalScope,
          latestRows: [
            { event: 'idempotency-opened' },
            { event: 'mutation-applied' },
            { event: 'apply-committed' },
          ],
          ownership: {
            ownsJournal: true,
            restartReadable: true,
            productionAdapter: 'filesystem-compare-rename',
          },
          leaseFence: {
            boundary: 'filesystem-compare-rename',
            claimKeyUnique: true,
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: false,
          },
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
      idempotencyKey: 'idem-06f-missing-journal-auth-unchecked',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'AUTH_SESSION_LIFECYCLE_DRIFT');
    assert.deepEqual(summary.authSession, {
      field: 'auth',
      required: 'production-auth-session',
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
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
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
          },
        },
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
            type: 'application-password-basic',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
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
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
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
      idempotencyKey: 'idem-07',
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
    assert.ok(seen.some(({ url }) => url.includes('/apply')));
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
          },
        },
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
            expiresAt: '2030-01-01T00:00:00Z',
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
    assert.equal(summary.code, 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED');
    assert.deepEqual(summary.authSession, {
      required: 'unexpired',
      observed: '2030-01-01T00:00:00Z',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    });
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
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
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

test('production-shaped authenticated push fails closed when recovery inspect surfaces a malformed production recovery claim hash', async () => {
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
          },
        },
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
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
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
    if (pathname.includes('/recovery/inspect')) {
      const badClaimHash = 'f'.repeat(64);
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
          state: 'available',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: {
            kind: 'production-recovery-journal',
            path: '/tmp/recovery.jsonl',
            journalPath: '/tmp/recovery.jsonl',
            checked: ['/tmp/recovery.jsonl'],
            artifactRefs: { releaseProof: 'artifact://release-proof-1' },
            productionAdapter: 'openProductionRecoveryJournal',
            supportedSurface: 'claim-fenced-restart-readable',
            ownership: {
              ownsJournal: true,
              restartReadable: true,
              productionAdapter: 'filesystem-compare-rename',
              supportedSurface: 'claim-fenced-restart-readable',
            },
            claim: {
              status: 'active',
              activeClaimId: 'production-claim-01',
              activeClaimHash: badClaimHash,
              previousClaimId: null,
              previousClaimHash: null,
              sequence: 1,
              type: 'recovery-claim-opened',
            },
            claimId: 'production-claim-01',
            claimHash: badClaimHash,
            consumed: true,
            ownsJournal: true,
            restartReadable: true,
            schemaVersion: 1,
            integrity: { status: 'ok' },
            records: 3,
            staleClaimRejected: false,
            writerLease: {
              strategy: 'claim-fenced-single-writer',
              claimId: 'production-claim-01',
              claimHash: badClaimHash,
              claimKeyUnique: true,
              storageGuard: 'filesystem-compare-rename',
              fsyncEvidence: true,
              monotonicSequence: true,
              restartReadable: true,
              staleClaimRejected: false,
            },
          },
          leaseFence: {
            boundary: 'filesystem-compare-rename',
            storageGuard: 'filesystem-compare-rename',
            claimKeyUnique: true,
            fsyncEvidence: true,
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: false,
            writerLease: {
              strategy: 'claim-fenced-single-writer',
              claimId: 'production-claim-01',
              claimHash: badClaimHash,
              claimKeyUnique: true,
              storageGuard: 'filesystem-compare-rename',
              fsyncEvidence: true,
              monotonicSequence: true,
              restartReadable: true,
              staleClaimRejected: false,
            },
          },
          claim: {
            status: 'active',
            activeClaimId: 'production-claim-01',
            activeClaimHash: badClaimHash,
            previousClaimId: null,
            previousClaimHash: null,
            sequence: 1,
            type: 'recovery-claim-opened',
          },
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
      idempotencyKey: 'idem-recovery-claim-hash-drift-01',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'RECOVERY_INSPECT_JOURNAL_UNTRUSTED');
    assert.equal(summary.recoveryInspect.recovery.journalState, 'ok');
    assert.deepEqual(summary.recoveryInspect.recovery.counts, {
      old: 0,
      new: 1,
      blockedUnknown: 0,
      total: 1,
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
    assert.equal(seen.some(({ url }) => url.includes('/db-journal')), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push preserves consumed claim identity from a validated production recovery journal surface', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  let applyCount = 0;
  const credential = {
    username: 'reprint_push_admin',
    password: 'app-password-01',
  };
  const claimId = 'production-claim-consumed-01';
  const claimHash = recoveryClaimHash(claimId);
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
        session: {
          id: 'psh_01j00000000000000000000000',
          expiresAt: '2030-01-01T00:00:00Z',
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
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
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
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
        recovery: {
          state: 'available',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: {
            kind: 'production-recovery-journal',
            path: '/tmp/recovery.jsonl',
            journalPath: '/tmp/recovery.jsonl',
            checked: ['/tmp/recovery.jsonl'],
            artifactRefs: { releaseProof: 'artifact://release-proof-1' },
            productionAdapter: 'openProductionRecoveryJournal',
            supportedSurface: 'claim-fenced-restart-readable',
            ownership: {
              ownsJournal: true,
              restartReadable: true,
              productionAdapter: 'filesystem-compare-rename',
              supportedSurface: 'claim-fenced-restart-readable',
            },
            claim: {
              status: 'active',
              activeClaimId: claimId,
              activeClaimHash: claimHash,
              previousClaimId: null,
              previousClaimHash: null,
              sequence: 1,
              type: 'recovery-claim-opened',
            },
            claimId,
            claimHash,
            consumed: true,
            consumedClaimId: claimId,
            consumedClaimHash: claimHash,
            ownsJournal: true,
            restartReadable: true,
            schemaVersion: 1,
            integrity: { status: 'ok' },
            records: 4,
            staleClaimRejected: false,
            writerLease: {
              strategy: 'claim-fenced-single-writer',
              claimId,
              claimHash,
              claimKeyUnique: true,
              storageGuard: 'filesystem-compare-rename',
              fsyncEvidence: true,
              monotonicSequence: true,
              restartReadable: true,
              staleClaimRejected: false,
            },
          },
          leaseFence: {
            boundary: 'filesystem-compare-rename',
            storageGuard: 'filesystem-compare-rename',
            claimKeyUnique: true,
            fsyncEvidence: true,
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: false,
            writerLease: {
              strategy: 'claim-fenced-single-writer',
              claimId,
              claimHash,
              claimKeyUnique: true,
              storageGuard: 'filesystem-compare-rename',
              fsyncEvidence: true,
              monotonicSequence: true,
              restartReadable: true,
              staleClaimRejected: false,
            },
          },
          claim: {
            status: 'active',
            activeClaimId: claimId,
            activeClaimHash: claimHash,
            previousClaimId: null,
            previousClaimHash: null,
            sequence: 1,
            type: 'recovery-claim-opened',
          },
        },
        dbJournal: {
          scope: 'packaged production plugin journal surface; not local Playground fixture only',
          acceptedOnCheckedBoundary: true,
          ownership: {
            ownsJournal: true,
            restartReadable: true,
            productionAdapter: 'wpdb-single-statement-cas',
            supportedSurface: 'claim-fenced-restart-readable',
          },
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
    if (pathname.includes('/apply')) {
      applyCount += 1;
      const payload = JSON.parse(String(options?.body || '{}'));
      return new Response(JSON.stringify({
        ok: true,
        mode: 'apply',
        applied: 0,
        receipt: { receiptHash: 'receipt-01' },
        responseSchemaVersion: 1,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
        signedRequest: {
          signed: true,
          schemaVersion: 1,
          contentHash: 'content-hash-01',
          sessionHash: 'session-hash-01',
          signingKeyHash: 'signing-key-hash-01',
          request: { method: 'POST', path: '/wp-json/reprint/v1/push/apply' },
        },
        idempotency: {
          replayed: applyCount > 1,
          freshMutationWork: applyCount === 1,
          conflict: false,
        },
        applyRevalidation: buildApplyRevalidationEvidence(
          payload.plan,
          payload.receipt,
          claimId,
          claimHash,
        ),
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify({
        ok: true,
        dbJournal: {
          scope: 'packaged production plugin journal surface; not local Playground fixture only',
          acceptedOnCheckedBoundary: true,
          ownership: {
            ownsJournal: true,
            restartReadable: true,
            productionAdapter: 'wpdb-single-statement-cas',
            supportedSurface: 'claim-fenced-restart-readable',
          },
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
      idempotencyKey: 'idem-recovery-consumed-identity-summary-01',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, true);
    assert.equal(summary.code, undefined);
    assert.equal(summary.boundary, undefined);
    assert.equal(summary.applyRevalidation?.required, 'fresh-live-hashes-before-first-mutation');
    assert.equal(summary.applyRevalidation?.checkedAgainst, 'live-remote');
    assert.equal(summary.recoveryInspect.recovery.journal.kind, 'production-recovery-journal');
    assert.equal(summary.recoveryInspect.recovery.journal.consumed, true);
    assert.equal(summary.recoveryInspect.recovery.journal.consumedClaimId, claimId);
    assert.equal(summary.recoveryInspect.recovery.journal.consumedClaimHash, claimHash);
    assert.equal(summary.recoveryInspect.recovery.claim.activeClaimId, claimId);
    assert.equal(summary.recoveryInspect.recovery.leaseFence.writerLease.claimId, claimId);
    assert.equal(summary.recoveryInspect.recovery.productionJournal.journal.consumed, true);
    assert.equal(summary.recoveryInspect.recovery.productionJournal.journal.consumedClaimId, claimId);
    assert.equal(summary.recoveryInspect.recovery.productionJournal.journal.consumedClaimHash, claimHash);
    assert.equal(summary.recoveryInspect.recovery.productionJournal.claim.activeClaimId, claimId);
    assert.equal(summary.dbJournal?.ownership?.ownsJournal, true);
    assert.equal(summary.replayEquivalence?.equivalent, true);
    assert.ok(seen.some(({ url }) => url.includes('/db-journal?limit=80')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push keeps preserved-remote retry as the remaining boundary after validated recovery-journal proof', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  let applyCount = 0;
  const credential = {
    username: 'reprint_push_admin',
    password: 'app-password-01',
  };
  const claimId = 'production-claim-consumed-01';
  const claimHash = recoveryClaimHash(claimId);
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
        session: {
          id: 'psh_01j00000000000000000000000',
          expiresAt: '2030-01-01T00:00:00Z',
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
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
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
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
        recovery: {
          state: 'available',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: {
            kind: 'production-recovery-journal',
            path: '/tmp/recovery.jsonl',
            journalPath: '/tmp/recovery.jsonl',
            checked: ['/tmp/recovery.jsonl'],
            artifactRefs: { releaseProof: 'artifact://release-proof-1' },
            productionAdapter: 'openProductionRecoveryJournal',
            supportedSurface: 'claim-fenced-restart-readable',
            ownership: {
              ownsJournal: true,
              restartReadable: true,
              productionAdapter: 'filesystem-compare-rename',
              supportedSurface: 'claim-fenced-restart-readable',
            },
            claim: {
              status: 'active',
              activeClaimId: claimId,
              activeClaimHash: claimHash,
              previousClaimId: null,
              previousClaimHash: null,
              sequence: 1,
              type: 'recovery-claim-opened',
            },
            claimId,
            claimHash,
            consumed: true,
            consumedClaimId: claimId,
            consumedClaimHash: claimHash,
            ownsJournal: true,
            restartReadable: true,
            schemaVersion: 1,
            integrity: { status: 'ok' },
            records: 4,
            staleClaimRejected: false,
            writerLease: {
              strategy: 'claim-fenced-single-writer',
              claimId,
              claimHash,
              claimKeyUnique: true,
              storageGuard: 'filesystem-compare-rename',
              fsyncEvidence: true,
              monotonicSequence: true,
              restartReadable: true,
              staleClaimRejected: false,
            },
          },
          leaseFence: {
            boundary: 'filesystem-compare-rename',
            storageGuard: 'filesystem-compare-rename',
            claimKeyUnique: true,
            fsyncEvidence: true,
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: false,
            writerLease: {
              strategy: 'claim-fenced-single-writer',
              claimId,
              claimHash,
              claimKeyUnique: true,
              storageGuard: 'filesystem-compare-rename',
              fsyncEvidence: true,
              monotonicSequence: true,
              restartReadable: true,
              staleClaimRejected: false,
            },
          },
          claim: {
            status: 'active',
            activeClaimId: claimId,
            activeClaimHash: claimHash,
            previousClaimId: null,
            previousClaimHash: null,
            sequence: 1,
            type: 'recovery-claim-opened',
          },
        },
        dbJournal: {
          scope: 'packaged production plugin journal surface; not local Playground fixture only',
          ownership: {
            ownsJournal: true,
            restartReadable: true,
            productionAdapter: 'wpdb-single-statement-cas',
            supportedSurface: 'claim-fenced-restart-readable',
          },
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
    if (pathname.includes('/apply')) {
      applyCount += 1;
      const payload = JSON.parse(String(options?.body || '{}'));
      return new Response(JSON.stringify({
        ok: true,
        mode: 'apply',
        applied: 0,
        receipt: { receiptHash: 'receipt-01' },
        responseSchemaVersion: 1,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
        signedRequest: {
          signed: true,
          schemaVersion: 1,
          contentHash: 'content-hash-01',
          sessionHash: 'session-hash-01',
          signingKeyHash: 'signing-key-hash-01',
          request: { method: 'POST', path: '/wp-json/reprint/v1/push/apply' },
        },
        idempotency: {
          replayed: applyCount > 1,
          freshMutationWork: applyCount === 1,
          conflict: false,
        },
        applyRevalidation: buildApplyRevalidationEvidence(
          payload.plan,
          payload.receipt,
          claimId,
          claimHash,
        ),
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify({
        ok: true,
        dbJournal: {
          scope: 'packaged production plugin journal surface; not local Playground fixture only',
          ownership: {
            ownsJournal: true,
            restartReadable: true,
            productionAdapter: 'wpdb-single-statement-cas',
            supportedSurface: 'claim-fenced-restart-readable',
          },
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
      idempotencyKey: 'idem-recovery-consumed-identity-summary-01',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
      simulatePreservedRemoteRetryPath: '/unmatched-read-path',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRESERVED_REMOTE_RETRY_REQUIRED');
    assert.deepEqual(summary.replayAndRetry, {
      required: '/unmatched-read-path',
      observed: 'missing-transient-retry',
      retryAttempts: 1,
      verdict: 'PRESERVED_REMOTE_RETRY_REQUIRED',
    });
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'replay and preserved-remote retry on the checked release path',
      status: 'unimplemented',
      verdict: 'PRESERVED_REMOTE_RETRY_REQUIRED',
      replayAndRetry: {
        required: '/unmatched-read-path',
        observed: 'missing-transient-retry',
        retryAttempts: 1,
        verdict: 'PRESERVED_REMOTE_RETRY_REQUIRED',
      },
      durableJournal: {
        verdict: 'LIVE_RELEASE_BOUNDARY_OK',
      },
    });
    assert.equal(summary.recoveryInspect.recovery.productionJournal.journal.consumedClaimId, claimId);
    assert.ok(seen.some(({ url }) => url.includes('/db-journal?limit=80')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push does not let recovery-journal fallback bypass stale-claim retry proof', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  let applyCount = 0;
  const credential = {
    username: 'reprint_push_admin',
    password: 'app-password-01',
  };
  const claimId = 'production-claim-consumed-01';
  const claimHash = recoveryClaimHash(claimId);
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
        session: {
          id: 'psh_01j00000000000000000000000',
          expiresAt: '2030-01-01T00:00:00Z',
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
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
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
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
        recovery: {
          state: 'available',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: {
            kind: 'production-recovery-journal',
            path: '/tmp/recovery.jsonl',
            journalPath: '/tmp/recovery.jsonl',
            checked: ['/tmp/recovery.jsonl'],
            artifactRefs: { releaseProof: 'artifact://release-proof-1' },
            productionAdapter: 'openProductionRecoveryJournal',
            supportedSurface: 'claim-fenced-restart-readable',
            ownership: {
              ownsJournal: true,
              restartReadable: true,
              productionAdapter: 'filesystem-compare-rename',
              supportedSurface: 'claim-fenced-restart-readable',
            },
            claim: {
              status: 'active',
              activeClaimId: claimId,
              activeClaimHash: claimHash,
              previousClaimId: null,
              previousClaimHash: null,
              sequence: 1,
              type: 'recovery-claim-opened',
            },
            claimId,
            claimHash,
            consumed: true,
            consumedClaimId: claimId,
            consumedClaimHash: claimHash,
            ownsJournal: true,
            restartReadable: true,
            schemaVersion: 1,
            integrity: { status: 'ok' },
            records: 4,
            staleClaimRejected: false,
            writerLease: {
              strategy: 'claim-fenced-single-writer',
              claimId,
              claimHash,
              claimKeyUnique: true,
              storageGuard: 'filesystem-compare-rename',
              fsyncEvidence: true,
              monotonicSequence: true,
              restartReadable: true,
              staleClaimRejected: false,
            },
          },
          leaseFence: {
            boundary: 'filesystem-compare-rename',
            storageGuard: 'filesystem-compare-rename',
            claimKeyUnique: true,
            fsyncEvidence: true,
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: false,
            writerLease: {
              strategy: 'claim-fenced-single-writer',
              claimId,
              claimHash,
              claimKeyUnique: true,
              storageGuard: 'filesystem-compare-rename',
              fsyncEvidence: true,
              monotonicSequence: true,
              restartReadable: true,
              staleClaimRejected: false,
            },
          },
          claim: {
            status: 'active',
            activeClaimId: claimId,
            activeClaimHash: claimHash,
            previousClaimId: null,
            previousClaimHash: null,
            sequence: 1,
            type: 'recovery-claim-opened',
          },
        },
        dbJournal: {
          scope: 'packaged production plugin journal surface; not local Playground fixture only',
          acceptedOnCheckedBoundary: false,
          ownership: {
            ownsJournal: true,
            restartReadable: true,
            productionAdapter: 'wpdb-single-statement-cas',
            supportedSurface: 'claim-fenced-restart-readable',
          },
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
    if (pathname.includes('/apply')) {
      applyCount += 1;
      const payload = JSON.parse(String(options?.body || '{}'));
      if (applyCount === 1) {
        assert.equal(payload.labSimulateStaleClaimAllOld, true);
        return new Response(JSON.stringify({
          ok: false,
          code: 'LAB_SIMULATED_STALE_CLAIM_ALL_OLD',
          auth: {
            identity: { userLogin: 'reprint_push_admin' },
            session: {
              type: 'production-auth-session',
              status: 'active',
              id: 'psh_01j00000000000000000000000',
              expiresAt: '2030-01-01T00:00:00Z',
            },
          },
        }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({
        ok: true,
        mode: 'apply',
        applied: 0,
        receipt: { receiptHash: 'receipt-01' },
        responseSchemaVersion: 1,
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
          replayed: true,
          freshMutationWork: false,
          status: 'replayed',
          conflict: false,
        },
        storageGuard: {
          boundary: 'filesystem-compare-rename',
          operation: 'update',
          outcome: 'applied',
        },
        applyRevalidation: buildApplyRevalidationEvidence(
          payload.plan,
          payload.receipt,
          claimId,
          claimHash,
        ),
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify({
        ok: true,
        dbJournal: {
          scope: 'packaged production plugin journal surface; not local Playground fixture only',
          acceptedOnCheckedBoundary: false,
          ownership: {
            ownsJournal: true,
            restartReadable: true,
            productionAdapter: 'wpdb-single-statement-cas',
            supportedSurface: 'claim-fenced-restart-readable',
          },
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
      idempotencyKey: 'idem-recovery-stale-claim-proof-01',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
      simulateStaleClaimRetry: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'DURABLE_JOURNAL_NOT_PROVEN');
    assert.equal(summary.recoveryInspect.recovery.productionJournal.leaseFence.staleClaimRejected, false);
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
    assert.ok(seen.some(({ url }) => url.includes('/recovery/inspect')));
    assert.ok(seen.some(({ url }) => url.includes('/db-journal?limit=80')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when production recovery journal consumed-claim identity drifts', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  const credential = {
    username: 'reprint_push_admin',
    password: 'app-password-01',
  };
  const claimId = 'production-claim-01';
  const claimHash = recoveryClaimHash(claimId);
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
        session: {
          id: 'psh_01j00000000000000000000000',
          expiresAt: '2030-01-01T00:00:00Z',
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
    if (pathname.includes('/dry-run')) {
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
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
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
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
          state: 'available',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: {
            kind: 'production-recovery-journal',
            path: '/tmp/recovery.jsonl',
            journalPath: '/tmp/recovery.jsonl',
            checked: ['/tmp/recovery.jsonl'],
            artifactRefs: { releaseProof: 'artifact://release-proof-1' },
            productionAdapter: 'openProductionRecoveryJournal',
            supportedSurface: 'claim-fenced-restart-readable',
            ownership: {
              ownsJournal: true,
              restartReadable: true,
              productionAdapter: 'filesystem-compare-rename',
              supportedSurface: 'claim-fenced-restart-readable',
            },
            claim: {
              status: 'active',
              activeClaimId: claimId,
              activeClaimHash: claimHash,
              previousClaimId: null,
              previousClaimHash: null,
              sequence: 1,
              type: 'recovery-claim-opened',
            },
            claimId,
            claimHash,
            consumed: true,
            consumedClaimId: 'fabricated-production-claim-id',
            consumedClaimHash: claimHash,
            ownsJournal: true,
            restartReadable: true,
            schemaVersion: 1,
            integrity: { status: 'ok' },
            records: 3,
            staleClaimRejected: false,
            writerLease: {
              strategy: 'claim-fenced-single-writer',
              claimId,
              claimHash,
              claimKeyUnique: true,
              storageGuard: 'filesystem-compare-rename',
              fsyncEvidence: true,
              monotonicSequence: true,
              restartReadable: true,
              staleClaimRejected: false,
            },
          },
          leaseFence: {
            boundary: 'filesystem-compare-rename',
            storageGuard: 'filesystem-compare-rename',
            claimKeyUnique: true,
            fsyncEvidence: true,
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: false,
            writerLease: {
              strategy: 'claim-fenced-single-writer',
              claimId,
              claimHash,
              claimKeyUnique: true,
              storageGuard: 'filesystem-compare-rename',
              fsyncEvidence: true,
              monotonicSequence: true,
              restartReadable: true,
              staleClaimRejected: false,
            },
          },
          claim: {
            status: 'active',
            activeClaimId: claimId,
            activeClaimHash: claimHash,
            previousClaimId: null,
            previousClaimHash: null,
            sequence: 1,
            type: 'recovery-claim-opened',
          },
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
      idempotencyKey: 'idem-recovery-consumed-claim-drift-01',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'RECOVERY_INSPECT_JOURNAL_UNTRUSTED');
    assert.equal(summary.recoveryInspect.recovery.journalState, 'ok');
    assert.deepEqual(summary.recoveryInspect.recovery.counts, {
      old: 0,
      new: 1,
      blockedUnknown: 0,
      total: 1,
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
    assert.equal(seen.some(({ url }) => url.includes('/db-journal')), false);
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
            type: 'application-password-basic',
            id: 'psh_01j00000000000000000000000',
            status: 'active',
            expiresAt: '2030-01-01T00:00:00Z',
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
      idempotencyKey: 'idem-05a',
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
      field: 'auth.identity.userLogin',
      required: 'reprint_push_admin',
      observed: 'different-user',
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

test('production-shaped authenticated push fails closed when replay drops the authenticated identity user id', async () => {
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
          identity: { userId: 7, userLogin: 'reprint_push_admin' },
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
        auth: {
          identity: { userId: 7, userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
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
          identity: { userId: 7, userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
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
      applyCount += 1;
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
        auth: {
          identity: applyCount === 1
            ? { userId: 7, userLogin: 'reprint_push_admin' }
            : { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
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
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-10-user-id-drift',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED');
    assert.deepEqual(summary.authSession, {
      field: 'auth.identity.userId',
      required: 7,
      observed: 'missing-user-id',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    });
    assert.equal(seen.filter(({ url }) => url.includes('/apply')).length, 2);
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
      field: 'auth',
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

test('production-shaped authenticated push fails closed on malformed recovery-inspect auth-session warning drift even without the stricter production-session gate', async () => {
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
          },
        },
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
            expiresAt: '2030-01-01T00:00:00Z',
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
            status: 'active',
            expiresAt: '2030-01-01T00:00:00Z',
            warning: ['lab-only-warning'],
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
      idempotencyKey: 'idem-recovery-warning-unrequired',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'AUTH_SESSION_LIFECYCLE_DRIFT');
    assert.deepEqual(summary.authSession, {
      field: 'auth.session.warning',
      required: 'string lifecycle fields',
      observed: 'invalid-warning',
      verdict: 'AUTH_SESSION_LIFECYCLE_DRIFT',
    });
    assert.equal(summary.boundary.firstRemainingProductionBoundary, 'auth/session lifecycle and durable journal semantics');
    assert.equal(summary.boundary.verdict, 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED');
    assert.equal(summary.boundary.durableJournal.phase, 'recovery-inspect');
    assert.equal(summary.authSessionLifecycleTrace.at(-1)?.step, 'recovery-inspect');
    assert.ok(seen.some(({ url }) => url.includes('/recovery/inspect')));
    assert.ok(!seen.some(({ url }) => url.includes('/db-journal')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed on malformed recovery-inspect auth identity user logins even without the stricter production-session gate', async () => {
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
          identity: { userLogin: ['different-user'] },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
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
      applyCount += 1;
      return new Response(JSON.stringify({
        ok: true,
        receipt: { receiptHash: 'receipt-01' },
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
        signedRequest: {
          signed: true,
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
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: 'idem-recovery-user-login-unrequired',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'AUTH_SESSION_LIFECYCLE_DRIFT');
    assert.deepEqual(summary.authSession, {
      field: 'auth.identity.userLogin',
      required: 'string auth identity fields',
      observed: 'invalid-user-login',
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
    assert.equal(summary.authSessionLifecycleTrace.at(-1)?.step, 'recovery-inspect');
    assert.equal(summary.authSessionLifecycleSummary.read?.step, 'recovery-inspect');
    assert.ok(seen.some(({ url }) => url.includes('/recovery/inspect')));
    assert.ok(!seen.some(({ url }) => url.includes('/db-journal')));
    assert.equal(applyCount, 1);
    assert.equal(seen.length, 5);
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed on malformed recovery-inspect auth identity user ids even without the stricter production-session gate', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), options });
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return new Response(JSON.stringify({
        ok: true,
        auth: {
          identity: { userId: 7, userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            id: 'psh_01j00000000000000000000000',
            status: 'active',
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
          identity: { userId: 7, userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
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
          identity: { userId: 7, userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            id: 'psh_01j00000000000000000000000',
            status: 'active',
            expiresAt: '2030-01-01T00:00:00Z',
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
          identity: { userId: ['7'], userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            id: 'psh_01j00000000000000000000000',
            status: 'active',
            expiresAt: '2030-01-01T00:00:00Z',
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
      idempotencyKey: 'idem-recovery-user-id-unrequired',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'AUTH_SESSION_LIFECYCLE_DRIFT');
    assert.deepEqual(summary.authSession, {
      field: 'auth.identity.userId',
      required: 'integer auth identity fields',
      observed: 'invalid-user-id',
      verdict: 'AUTH_SESSION_LIFECYCLE_DRIFT',
    });
    assert.equal(summary.boundary.firstRemainingProductionBoundary, 'auth/session lifecycle and durable journal semantics');
    assert.equal(summary.boundary.verdict, 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED');
    assert.equal(summary.boundary.durableJournal.phase, 'recovery-inspect');
    assert.equal(summary.authSessionLifecycleTrace.at(-1)?.step, 'recovery-inspect');
    assert.ok(seen.some(({ url }) => url.includes('/recovery/inspect')));
    assert.ok(!seen.some(({ url }) => url.includes('/db-journal')));
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
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
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
    assert.deepEqual(summary.authSession, {
      field: 'auth',
      required: 'production-auth-session',
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
        phase: 'journal-inspect',
      },
    });
    assert.equal(summary.authSessionLifecycleSummary.read?.step, 'replay');
    assert.ok(seen.some(({ url }) => url.includes('/db-journal?limit=80')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed when required journal readback omits the auth envelope even with durable ownership proof', async () => {
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
        mode: 'apply',
        applied: true,
        code: 'APPLIED',
        responseSchemaVersion: 1,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        },
        receipt: { receiptHash: 'receipt-01' },
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
        storageGuard: {
          boundary: 'wpdb-single-statement-cas',
          operation: 'update',
          outcome: 'applied',
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
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
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
    if (pathname.includes('/db-journal')) {
      return new Response(JSON.stringify({
        ok: true,
        storageGuard: {
          boundary: 'wpdb-single-statement-cas',
          operation: 'update',
          outcome: 'applied',
        },
        dbJournal: {
          scope: trustedDbJournalScope,
          latestRows: [
            { event: 'idempotency-opened' },
            { event: 'mutation-applied' },
            { event: 'apply-committed' },
          ],
          ownership: {
            ownsJournal: true,
            restartReadable: true,
            productionAdapter: 'wpdb-single-statement-cas',
            supportedSurface: 'claim-fenced-restart-readable',
          },
          writerLease: {
            strategy: 'claim-fenced-single-writer',
            claimId: 'psh_01j00000000000000000000000',
            claimKeyHash: 'psh_01j00000000000000000000000',
            claimKeyUnique: true,
            fsyncEvidence: true,
            storageGuard: 'wpdb-single-statement-cas',
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: false,
          },
          leaseFence: {
            boundary: 'wpdb-single-statement-cas',
            claimKeyUnique: true,
            fsyncEvidence: true,
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: false,
            writerLease: {
              strategy: 'claim-fenced-single-writer',
              claimId: 'psh_01j00000000000000000000000',
              claimKeyHash: 'psh_01j00000000000000000000000',
              claimKeyUnique: true,
              fsyncEvidence: true,
              storageGuard: 'wpdb-single-statement-cas',
              monotonicSequence: true,
              restartReadable: true,
              staleClaimRejected: false,
            },
          },
          claim: {
            status: 'active',
            activeClaimId: 'psh_01j00000000000000000000000',
            activeClaimKeyHash: 'psh_01j00000000000000000000000',
            activeClaimSequence: 2,
            activeClaimEvent: 'apply-committed',
            previousClaimId: 'psh_01i99999999999999999999999',
            previousClaimKeyHash: 'psh_01i99999999999999999999999',
            previousClaimSequence: 1,
            previousClaimEvent: 'recovery-claim-opened',
            idempotencyKeyHash: 'idempotency-claim-01',
            requestHash: 'request-claim-01',
            planHash: 'plan-claim-01',
            receiptHash: 'receipt-claim-01',
            planFingerprint: 'plan-fingerprint-01',
            mutationCount: 1,
            appliedCount: 1,
            staleClaimRejected: false,
          },
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
      idempotencyKey: 'idem-06e-missing-journal-auth',
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED');
    assert.equal(summary.dbJournal?.authUser, undefined);
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: {
        required: 'preserved read',
        observed: 'missing-auth-envelope',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      },
    });
    assert.equal(seen.length, 8);
    assert.ok(seen.some(({ url }) => url.includes('/db-journal?limit=80')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('production-shaped authenticated push fails closed on malformed durable-journal auth-session preserved drift even without the stricter production-session gate', async () => {
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
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
          },
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
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
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
        receipt: { receiptHash: 'receipt-01' },
        responseSchemaVersion: 1,
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
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
        auth: {
          identity: { userLogin: 'reprint_push_admin' },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: 'psh_01j00000000000000000000000',
            expiresAt: '2030-01-01T00:00:00Z',
            preserved: ['lab-unpreserved'],
          },
        },
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
      idempotencyKey: 'idem-journal-preserved-unrequired',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'AUTH_SESSION_LIFECYCLE_DRIFT');
    assert.deepEqual(summary.authSession, {
      field: 'auth.session.preserved',
      required: 'boolean lifecycle flags',
      observed: 'invalid-preserved',
      verdict: 'AUTH_SESSION_LIFECYCLE_DRIFT',
    });
    assert.equal(summary.boundary.firstRemainingProductionBoundary, 'auth/session lifecycle and durable journal semantics');
    assert.equal(summary.boundary.verdict, 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED');
    assert.equal(summary.boundary.durableJournal.phase, 'journal');
    assert.equal(summary.authSessionLifecycleTrace.at(-1)?.step, 'journal');
    assert.equal(summary.authSessionLifecycleTrace.at(-1)?.invalidLifecycleFlag, 'preserved');
    assert.ok(seen.some(({ url }) => url.includes('/db-journal?limit=80')));
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
