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
  password: 'rpp-0554-test-application-password',
};

const auth = {
  identity: {
    userLogin: credential.username,
    userId: 554,
    capabilities: { manage_options: true },
  },
  session: {
    type: 'production-auth-session',
    status: 'active',
    id: 'psh_01j00000000000000000000554',
    expiresAt: futureReceiptExpiry,
  },
};

function sha256Hex(data) {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function fixtureHash(label) {
  return sha256Hex(`rpp-0554:${label}`);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function fixtureSnapshots() {
  const path = 'wp-content/uploads/rpp-0554-receipt-expiry-v3.txt';
  return {
    base: {
      files: { [path]: 'rpp-0554 base content' },
      plugins: {},
      db: {},
    },
    local: {
      files: { [path]: 'rpp-0554 local content v3' },
      plugins: {},
      db: {},
    },
    resourcePath: path,
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
    liveSource: {
      snapshotHash: fixtureHash('live-source-snapshot'),
      sourceHash: fixtureHash('live-source'),
      sourceUrlHash: sha256Hex(sourceUrl),
      cursorHash: fixtureHash('live-source-cursor'),
    },
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
      previousClaimId: 'psh_01i99999999999999999554',
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

function successfulApplyBody({ payload, rawBody, applyCount, includeApplyRevalidation = true }) {
  const body = {
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
  };

  if (includeApplyRevalidation) {
    body.applyRevalidation = applyRevalidationEvidence(payload.plan, payload.receipt);
  }

  return body;
}

function successfulApplyResponse(options) {
  return jsonResponse(successfulApplyBody(options));
}

function appendEvent(events, event, payload = {}) {
  const entry = {
    sequence: events.length + 1,
    event,
    ...payload,
  };
  events.push(entry);
  return entry;
}

function eventSequence(events, event) {
  const entry = events.find((item) => item.event === event);
  return Number.isInteger(entry?.sequence) ? entry.sequence : null;
}

function assertLiveSourceBeforeMutation(events) {
  const liveSourceSequence = eventSequence(events, 'live-source-revalidated');
  const executorSequence = eventSequence(events, 'mutation-executor-entered');
  const mutationSequence = eventSequence(events, 'mutation-applied');

  assert.ok(Number.isInteger(liveSourceSequence), 'missing live-source-revalidated event');
  assert.ok(Number.isInteger(executorSequence), 'missing mutation-executor-entered event');
  assert.ok(Number.isInteger(mutationSequence), 'missing mutation-applied event');
  assert.ok(liveSourceSequence < executorSequence, 'live-source revalidation must precede executor entry');
  assert.ok(liveSourceSequence < mutationSequence, 'live-source revalidation must precede mutation application');
}

function hashOnlyProofEnvelope({ summary, receipt, events, idempotencyKey }) {
  const applyRevalidation = summary.applyRevalidation || {};
  const liveSourceSequence = eventSequence(events, 'live-source-revalidated');
  const firstMutationSequence = eventSequence(events, 'mutation-applied');

  return {
    schemaVersion: 1,
    slice: 'RPP-0554',
    proofClass: 'receipt-expiry-validation-v3',
    evidenceScope: 'local-generated-support',
    releaseStatus: 'NO-GO',
    idempotencyKeyHash: summary.idempotencyKeyHash,
    sourceUrlHash: sha256Hex(sourceUrl),
    userLoginHash: sha256Hex(credential.username),
    sessionIdHash: sha256Hex(auth.session.id),
    receiptHash: receipt.receiptHash,
    planHash: applyRevalidation.planHash,
    mutationSetHash: applyRevalidation.mutationSetHash,
    preconditionSetHash: applyRevalidation.preconditionSetHash,
    activeClaimKeyHash: applyRevalidation.claim?.activeClaimKeyHash || null,
    eventOrderHash: digest(events.map(({ event }) => event)),
    applyRevalidation: {
      phase: applyRevalidation.phase,
      checkedAgainst: applyRevalidation.checkedAgainst,
      liveSourceRevalidatedSequence: liveSourceSequence,
      firstMutationSequence,
      beforeFirstMutation: Number.isInteger(liveSourceSequence)
        && Number.isInteger(firstMutationSequence)
        && liveSourceSequence < firstMutationSequence,
    },
    redaction: {
      format: 'hash-only',
      rawValuesIncluded: false,
    },
  };
}

function assertHashOnlyProofEnvelope(envelope) {
  for (const field of [
    'idempotencyKeyHash',
    'sourceUrlHash',
    'userLoginHash',
    'sessionIdHash',
    'receiptHash',
    'planHash',
    'mutationSetHash',
    'preconditionSetHash',
    'activeClaimKeyHash',
    'eventOrderHash',
  ]) {
    assert.match(envelope[field], sha256Pattern, `${field} must be sha256 evidence`);
  }
  assert.equal(envelope.applyRevalidation.phase, 'before-first-mutation');
  assert.equal(envelope.applyRevalidation.checkedAgainst, 'live-remote');
  assert.equal(envelope.applyRevalidation.beforeFirstMutation, true);
  assert.equal(envelope.redaction.rawValuesIncluded, false);
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

test('RPP-0554 v3 refuses an expired dry-run receipt before apply mutation', async () => {
  const { base, local, resourceKey } = fixtureSnapshots();
  const idempotencyKey = 'idem-rpp-0554-expired-dry-run-v3';
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
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'authenticated receipt expiry validation before apply mutation',
      status: 'refused',
      verdict: 'AUTH_RECEIPT_EXPIRED',
      receiptExpiry: {
        phase: 'dry-run',
        field: 'receipt.authBinding.expiresAt',
        required: 'unexpired',
        observed: expiredReceiptExpiry,
        verdict: 'AUTH_RECEIPT_EXPIRED',
      },
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
    }, [idempotencyKey, credential.username, credential.password, auth.session.id, sourceUrl]);
  } finally {
    restore();
  }
});

test('RPP-0554 v3 blocks unexpired receipts without apply-time live-source revalidation', async () => {
  const { base, local } = fixtureSnapshots();
  const idempotencyKey = 'idem-rpp-0554-missing-apply-revalidation-v3';
  const events = [];
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
        receiptHash: fixtureHash('missing-apply-revalidation-receipt'),
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
      appendEvent(events, 'apply-started', { replayed: applyCount > 1 });
      if (applyCount === 1) {
        appendEvent(events, 'mutation-executor-entered');
        appendEvent(events, 'mutation-applied');
        appendEvent(events, 'apply-committed');
      } else {
        appendEvent(events, 'idempotency-replay-returned');
      }
      return successfulApplyResponse({
        payload,
        rawBody,
        applyCount,
        includeApplyRevalidation: false,
      });
    }
    throw new Error(`unexpected fetch to ${pathname}`);
  });

  try {
    const summary = await runPush({ base, local, idempotencyKey });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'APPLY_REVALIDATION_REQUIRED');
    assert.equal(summary.receiptExpiry, undefined);
    assert.equal(summary.apply.status, 200);
    assert.equal(summary.apply.idempotency.freshMutationWork, true);
    assert.deepEqual(summary.applyRevalidation, {
      field: 'verifiedCount',
      required: 1,
      observed: 0,
      verdict: 'APPLY_REVALIDATION_REQUIRED',
    });
    assert.deepEqual(summary.boundary, {
      firstRemainingProductionBoundary: 'apply-time revalidation before first mutation on the checked release path',
      status: 'unimplemented',
      verdict: 'APPLY_REVALIDATION_REQUIRED',
      applyRevalidation: {
        field: 'verifiedCount',
        required: 1,
        observed: 0,
        verdict: 'APPLY_REVALIDATION_REQUIRED',
      },
    });
    assert.equal(eventSequence(events, 'live-source-revalidated'), null);
    assert.ok(Number.isInteger(eventSequence(events, 'mutation-applied')));
    assert.deepEqual(
      seen
        .filter(({ pathname }) => pathname.endsWith('/apply'))
        .map(({ payload }) => payload.receipt.receiptHash),
      [dryRunReceipt.receiptHash, dryRunReceipt.receiptHash],
    );
    assertNoRawSupportValues({
      idempotencyKeyHash: summary.idempotencyKeyHash,
      applyRevalidation: summary.applyRevalidation,
      boundary: summary.boundary,
      receiptHash: dryRunReceipt.receiptHash,
      eventOrderHash: digest(events.map(({ event }) => event)),
    }, [idempotencyKey, credential.username, credential.password, auth.session.id, sourceUrl]);
  } finally {
    restore();
  }
});

test('RPP-0554 v3 keeps unexpired receipts on live-source apply revalidation before mutation', async () => {
  const { base, local, resourceKey, resourcePath } = fixtureSnapshots();
  const idempotencyKey = 'idem-rpp-0554-unexpired-revalidation-v3';
  const events = [];
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
      appendEvent(events, 'apply-started', { replayed: applyCount > 1 });
      if (applyCount === 1) {
        appendEvent(events, 'live-source-revalidated', {
          phase: 'before-first-mutation',
          checkedAgainst: 'live-remote',
          snapshotHash: fixtureHash('live-source-snapshot'),
        });
        appendEvent(events, 'mutation-executor-entered');
        appendEvent(events, 'mutation-applied', {
          resourceKeyHash: sha256Hex(resourceKey),
        });
        appendEvent(events, 'apply-committed');
      } else {
        appendEvent(events, 'idempotency-replay-returned');
      }
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
    assertLiveSourceBeforeMutation(events);
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

    const proofEnvelope = hashOnlyProofEnvelope({
      summary,
      receipt: dryRunReceipt,
      events,
      idempotencyKey,
    });
    assertHashOnlyProofEnvelope(proofEnvelope);
    assertNoRawSupportValues(proofEnvelope, [
      idempotencyKey,
      credential.username,
      credential.password,
      auth.session.id,
      sourceUrl,
      resourceKey,
      resourcePath,
      JSON.stringify(summary.planObject),
      JSON.stringify(dryRunReceipt),
    ]);
  } finally {
    restore();
  }
});
