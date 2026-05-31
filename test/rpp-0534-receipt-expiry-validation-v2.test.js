import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { runAuthenticatedHttpPush } from '../src/authenticated-http-push-client.js';
import { digest } from '../src/stable-json.js';

const sourceUrl = 'http://127.0.0.1:8080';
const routePrefix = '/wp-json/reprint/v1/push';
const futureReceiptExpiry = '2030-01-01T00:00:00Z';
const expiredReceiptExpiry = '2025-01-01T00:00:00Z';
const observationNow = new Date('2025-01-01T00:00:01Z');
const trustedDbJournalScope = 'checked live production-shaped journal surface; not local Playground fixture only';
const sha256Pattern = /^[a-f0-9]{64}$/;

const credential = {
  username: 'reprint_push_admin',
  password: 'rpp-0534-test-application-password',
};

const auth = {
  identity: {
    userLogin: credential.username,
    userId: 534,
    capabilities: { manage_options: true },
  },
  session: {
    type: 'production-auth-session',
    status: 'active',
    id: 'psh_01j00000000000000000000534',
    expiresAt: futureReceiptExpiry,
  },
};

function sha256Hex(data) {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function fixtureHash(label) {
  return sha256Hex(`rpp-0534:${label}`);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function fixtureSnapshots() {
  const path = 'wp-content/uploads/rpp-0534-receipt-expiry.txt';
  return {
    base: {
      files: { [path]: 'rpp-0534 base content' },
      plugins: {},
      db: {},
    },
    local: {
      files: { [path]: 'rpp-0534 local content v2' },
      plugins: {},
      db: {},
    },
    resourceKey: `file:${path}`,
  };
}

function authEnvelope() {
  return cloneJson(auth);
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function installFetch(handler) {
  const originalFetch = global.fetch;
  const seen = [];

  global.fetch = async (url, options = {}) => {
    const pathname = new URL(String(url)).pathname;
    const rawBody = typeof options.body === 'string' ? options.body : '';
    const payload = rawBody ? JSON.parse(rawBody) : null;
    seen.push({ pathname, payload, rawBody });
    return handler({ pathname, payload, rawBody });
  };

  return {
    seen,
    restore() {
      global.fetch = originalFetch;
    },
  };
}

function preflightResponse() {
  return jsonResponse({
    ok: true,
    auth: authEnvelope(),
    session: { id: auth.session.id },
  });
}

function snapshotResponse(snapshot) {
  return jsonResponse({
    ok: true,
    snapshot: cloneJson(snapshot),
  });
}

function planEvidence(plan) {
  const mutations = Array.isArray(plan?.mutations) ? plan.mutations : [];
  const preconditions = Array.isArray(plan?.preconditions) ? plan.preconditions : [];

  return {
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
    preconditionSetHash: digest(preconditions.map((precondition) => ({
      mutationId: String(precondition?.mutationId || ''),
      resourceKey: String(precondition?.resourceKey || ''),
      resource: precondition?.resource,
      expectedHash: String(precondition?.expectedHash || ''),
    }))),
  };
}

function receiptForPlan(plan, { receiptHash, expiresAt = futureReceiptExpiry, includeSessionUserBinding = true } = {}) {
  const evidence = planEvidence(plan);
  const identityHash = digest(auth.identity);
  const pushSessionHash = fixtureHash('push-session');
  const receipt = {
    receiptHash,
    planHash: digest(plan),
    preconditionSetHash: evidence.preconditionSetHash,
    mutationSetHash: evidence.mutationSetHash,
    mutationCount: Array.isArray(plan?.mutations) ? plan.mutations.length : 0,
    authBinding: {
      expiresAt,
    },
  };

  if (includeSessionUserBinding) {
    receipt.authBinding.identity = cloneJson(auth.identity);
    receipt.authBinding.binding = {
      identityHash,
      pushSessionHash,
    };
    receipt.authBinding.pushSession = {
      sessionHash: pushSessionHash,
      issue: { identityHash },
    };
    receipt.authBinding.sessionUser = {
      identityHash,
      userId: auth.identity.userId,
      userLoginHash: sha256Hex(auth.identity.userLogin),
      pushSessionHash,
      bindingHash: fixtureHash('session-user-binding'),
    };
  }

  return receipt;
}

function applyRevalidationEvidence(plan, receipt) {
  const mutations = Array.isArray(plan?.mutations) ? plan.mutations : [];
  const evidence = planEvidence(plan);

  return {
    schemaVersion: 1,
    required: 'fresh-live-hashes-before-first-mutation',
    phase: 'before-first-mutation',
    checkedAgainst: 'live-remote',
    planHash: receipt.planHash || digest(plan),
    receiptHash: receipt.receiptHash,
    preconditionSetHash: receipt.preconditionSetHash || evidence.preconditionSetHash,
    mutationSetHash: receipt.mutationSetHash || evidence.mutationSetHash,
    mutationCount: mutations.length,
    verifiedCount: mutations.length,
    verifiedResourceKeys: mutations.map((mutation) => mutation.resourceKey),
    claim: {
      activeClaimId: auth.session.id,
      activeClaimKeyHash: fixtureHash('active-claim-key'),
      activeClaimSequence: 2,
      staleClaimRetry: false,
    },
  };
}

function storageGuard() {
  return {
    boundary: 'wpdb-single-statement-cas',
    operation: 'update',
    outcome: 'applied',
  };
}

function checkedJournal() {
  const activeClaimKeyHash = fixtureHash('active-claim-key');

  return {
    scope: trustedDbJournalScope,
    latestRows: [
      { event: 'idempotency-opened' },
      { event: 'mutation-applied' },
      { event: 'apply-committed' },
    ],
    claim: {
      status: 'stale-claim-rejected',
      activeClaimId: auth.session.id,
      activeClaimKeyHash,
      activeClaimSequence: 2,
      activeClaimEvent: 'stale-claim-rejected',
      previousClaimId: 'psh_01i99999999999999999534',
      previousClaimKeyHash: fixtureHash('previous-claim-key'),
      previousClaimSequence: 1,
      previousClaimEvent: 'recovery-claim-opened',
      idempotencyKeyHash: fixtureHash('journal-idempotency-key'),
      requestHash: fixtureHash('journal-request'),
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
      claimKeyHash: activeClaimKeyHash,
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
        claimKeyHash: activeClaimKeyHash,
        claimKeyUnique: true,
        fsyncEvidence: true,
        storageGuard: 'wpdb-single-statement-cas',
        monotonicSequence: true,
        restartReadable: true,
        staleClaimRejected: true,
      },
    },
  };
}

function successfulApplyResponse({ payload, rawBody, applyCount }) {
  return jsonResponse({
    ok: true,
    mode: 'apply',
    applied: 1,
    code: applyCount === 1 ? 'APPLIED' : 'BATCH_ALREADY_COMMITTED',
    responseSchemaVersion: 1,
    auth: authEnvelope(),
    ...(applyCount === 1 ? { receipt: payload.receipt } : {}),
    storageGuard: storageGuard(),
    signedRequest: {
      signed: true,
      schemaVersion: 1,
      contentHash: sha256Hex(rawBody),
      sessionHash: fixtureHash('signed-session'),
      signingKeyHash: fixtureHash('signing-key'),
      request: { method: 'POST', path: `${routePrefix}/apply` },
    },
    idempotency: {
      replayed: applyCount > 1,
      freshMutationWork: applyCount === 1,
      conflict: false,
      idempotencyKeyHash: fixtureHash('apply-idempotency-key'),
      requestHash: fixtureHash('apply-request'),
    },
    applyRevalidation: applyRevalidationEvidence(payload.plan, payload.receipt),
  });
}

function assertNoRawSupportValues(evidence, rawValues) {
  const serialized = JSON.stringify(evidence);
  for (const rawValue of rawValues) {
    assert.equal(serialized.includes(rawValue), false, `support evidence leaked raw value ${rawValue}`);
  }
}

function runPush({ base, local, idempotencyKey }) {
  return runAuthenticatedHttpPush({
    sourceUrl,
    base,
    local,
    username: credential.username,
    applicationPassword: credential.password,
    idempotencyKey,
    routeProfile: 'production-shaped',
    requireProductionAuthSession: true,
    now: observationNow,
  });
}

test('RPP-0534 v2 refuses an expired dry-run receipt before apply mutation', async () => {
  const { base, local, resourceKey } = fixtureSnapshots();
  const idempotencyKey = 'idem-rpp-0534-expired-dry-run-v2';
  const { seen, restore } = installFetch(({ pathname, payload }) => {
    if (pathname.endsWith('/preflight')) {
      return preflightResponse();
    }
    if (pathname.endsWith('/snapshot')) {
      return snapshotResponse(base);
    }
    if (pathname.endsWith('/dry-run')) {
      return jsonResponse({
        ok: true,
        mode: 'dry-run',
        auth: authEnvelope(),
        receipt: receiptForPlan(payload.plan, {
          receiptHash: fixtureHash('expired-dry-run-receipt'),
          expiresAt: expiredReceiptExpiry,
          includeSessionUserBinding: false,
        }),
      });
    }
    throw new Error(`unexpected fetch to ${pathname}`);
  });

  try {
    const summary = await runPush({ base, local, idempotencyKey });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'AUTH_RECEIPT_EXPIRED');
    assert.equal(summary.plan.mutations, 1);
    assert.deepEqual(summary.plan.mutationKeys, [resourceKey]);
    assert.deepEqual(summary.receiptExpiry, {
      phase: 'dry-run',
      field: 'receipt.authBinding.expiresAt',
      required: 'unexpired',
      observed: expiredReceiptExpiry,
      verdict: 'AUTH_RECEIPT_EXPIRED',
    });
    assert.equal(summary.apply, null);
    assert.equal(summary.recoveryInspect, null);
    assert.equal(summary.replay, null);
    assert.equal(summary.dbJournal, null);
    assert.deepEqual(seen.map(({ pathname }) => pathname), [
      `${routePrefix}/preflight`,
      `${routePrefix}/snapshot`,
      `${routePrefix}/dry-run`,
    ]);
    assert.ok(!seen.some(({ pathname }) => pathname.endsWith('/apply')));
    assertNoRawSupportValues({
      idempotencyKeyHash: summary.idempotencyKeyHash,
      receiptExpiry: summary.receiptExpiry,
      boundary: summary.boundary,
    }, [idempotencyKey, credential.password]);
  } finally {
    restore();
  }
});

test('RPP-0534 v2 keeps apply-side expired receipt refusals pre-mutation', async () => {
  const { base, local } = fixtureSnapshots();
  const idempotencyKey = 'idem-rpp-0534-apply-side-expired-v2';
  const { seen, restore } = installFetch(({ pathname, payload }) => {
    if (pathname.endsWith('/preflight')) {
      return preflightResponse();
    }
    if (pathname.endsWith('/snapshot')) {
      return snapshotResponse(base);
    }
    if (pathname.endsWith('/dry-run')) {
      return jsonResponse({
        ok: true,
        mode: 'dry-run',
        auth: authEnvelope(),
        receipt: receiptForPlan(payload.plan, {
          receiptHash: fixtureHash('apply-side-expired-receipt'),
          expiresAt: futureReceiptExpiry,
          includeSessionUserBinding: false,
        }),
      });
    }
    if (pathname.endsWith('/apply')) {
      return jsonResponse({
        ok: false,
        mode: 'apply',
        code: 'AUTH_RECEIPT_EXPIRED',
        applied: 0,
        auth: authEnvelope(),
        idempotency: {
          replayed: false,
          freshMutationWork: false,
          conflict: false,
          idempotencyKeyHash: fixtureHash('apply-side-refusal-idempotency-key'),
          requestHash: fixtureHash('apply-side-refusal-request'),
        },
      }, 409);
    }
    throw new Error(`unexpected fetch to ${pathname}`);
  });

  try {
    const summary = await runPush({ base, local, idempotencyKey });

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
      `${routePrefix}/preflight`,
      `${routePrefix}/snapshot`,
      `${routePrefix}/dry-run`,
      `${routePrefix}/apply`,
    ]);
    assertNoRawSupportValues({
      idempotencyKeyHash: summary.idempotencyKeyHash,
      receiptExpiry: summary.receiptExpiry,
      apply: {
        status: summary.apply.status,
        applied: summary.apply.applied,
        idempotency: summary.apply.idempotency,
      },
    }, [idempotencyKey, credential.password]);
  } finally {
    restore();
  }
});

test('RPP-0534 v2 keeps unexpired receipts on live-source apply revalidation', async () => {
  const { base, local, resourceKey } = fixtureSnapshots();
  const idempotencyKey = 'idem-rpp-0534-unexpired-revalidation-v2';
  let snapshotCount = 0;
  let applyCount = 0;
  let dryRunReceipt = null;
  const { seen, restore } = installFetch(({ pathname, payload, rawBody }) => {
    if (pathname.endsWith('/preflight')) {
      return preflightResponse();
    }
    if (pathname.endsWith('/snapshot')) {
      snapshotCount += 1;
      return snapshotResponse(snapshotCount === 1 ? base : local);
    }
    if (pathname.endsWith('/dry-run')) {
      dryRunReceipt = receiptForPlan(payload.plan, {
        receiptHash: fixtureHash('unexpired-revalidation-receipt'),
        expiresAt: futureReceiptExpiry,
      });
      return jsonResponse({
        ok: true,
        mode: 'dry-run',
        auth: authEnvelope(),
        receipt: dryRunReceipt,
      });
    }
    if (pathname.endsWith('/recovery/inspect')) {
      return jsonResponse({
        ok: true,
        auth: authEnvelope(),
        recovery: {
          state: 'fully-updated-remote',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: { integrity: { status: 'ok' } },
        },
      });
    }
    if (pathname.endsWith('/db-journal')) {
      return jsonResponse({
        ok: true,
        auth: authEnvelope(),
        dbJournal: checkedJournal(),
        storageGuard: storageGuard(),
      });
    }
    if (pathname.endsWith('/apply')) {
      applyCount += 1;
      return successfulApplyResponse({ payload, rawBody, applyCount });
    }
    throw new Error(`unexpected fetch to ${pathname}`);
  });

  try {
    const summary = await runPush({ base, local, idempotencyKey });

    assert.equal(summary.ok, true);
    assert.equal(summary.code, undefined);
    assert.equal(summary.receiptExpiry, undefined);
    assert.equal(summary.plan.mutations, 1);
    assert.deepEqual(summary.plan.mutationKeys, [resourceKey]);
    assert.equal(summary.applyRevalidation.phase, 'before-first-mutation');
    assert.equal(summary.applyRevalidation.checkedAgainst, 'live-remote');
    assert.equal(summary.applyRevalidation.required, 'fresh-live-hashes-before-first-mutation');
    assert.equal(summary.applyRevalidation.receiptHash, dryRunReceipt.receiptHash);
    assert.equal(summary.applyRevalidation.mutationCount, 1);
    assert.equal(summary.applyRevalidation.verifiedCount, 1);
    assert.deepEqual(summary.applyRevalidation.verifiedResourceKeys, [resourceKey]);
    assert.match(summary.applyRevalidation.planHash, sha256Pattern);
    assert.match(summary.applyRevalidation.preconditionSetHash, sha256Pattern);
    assert.match(summary.applyRevalidation.mutationSetHash, sha256Pattern);
    assert.match(summary.applyRevalidation.claim.activeClaimKeyHash, sha256Pattern);
    assert.notEqual(summary.applyRevalidation.claim.activeClaimKeyHash, auth.session.id);
    assert.equal(summary.sessionUserIdentityBinding.ok, true);
    assert.equal(
      summary.sessionUserIdentityBinding.user.userLoginHash,
      sha256Hex(credential.username),
    );
    assert.equal(summary.replay.idempotency.replayed, true);
    assert.equal(summary.replay.idempotency.freshMutationWork, false);
    assert.equal(summary.dbJournal.leaseFence.staleClaimRejected, true);
    assert.deepEqual(
      seen
        .filter(({ pathname }) => pathname.endsWith('/apply'))
        .map(({ payload }) => payload.receipt.receiptHash),
      [dryRunReceipt.receiptHash, dryRunReceipt.receiptHash],
    );
    assert.deepEqual(seen.map(({ pathname }) => pathname), [
      `${routePrefix}/preflight`,
      `${routePrefix}/snapshot`,
      `${routePrefix}/dry-run`,
      `${routePrefix}/apply`,
      `${routePrefix}/recovery/inspect`,
      `${routePrefix}/apply`,
      `${routePrefix}/snapshot`,
      `${routePrefix}/db-journal`,
    ]);
    assertNoRawSupportValues({
      idempotencyKeyHash: summary.idempotencyKeyHash,
      applyRevalidation: summary.applyRevalidation,
      sessionUser: summary.sessionUserIdentityBinding.user,
      receipt: summary.sessionUserIdentityBinding.receipt,
      replay: {
        sameKeySameBodyReplay: summary.sameKeySameBodyReplay,
        idempotency: summary.replay.idempotency,
      },
    }, [idempotencyKey, credential.password]);
  } finally {
    restore();
  }
});
