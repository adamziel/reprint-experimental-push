import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { runAuthenticatedHttpPush } from '../src/authenticated-http-push-client.js';
import { digest } from '../src/stable-json.js';

const sourceUrl = 'http://127.0.0.1:8080';
const routePrefix = '/wp-json/reprint/v1/push';
const futureReceiptExpiry = '2030-01-01T00:00:00Z';
const expiredReceiptExpiry = '2025-01-01T00:00:00Z';
const staleReceiptExpiry = '2025-01-01T00:00:01Z';
const observationNow = new Date('2025-01-01T00:00:01Z');
const trustedDbJournalScope = 'checked live production-shaped journal surface; not local Playground fixture only';
const sha256Pattern = /^[a-f0-9]{64}$/;

const credential = {
  username: 'reprint_push_admin',
  password: 'rpp-0574-test-application-password',
};

const auth = {
  identity: {
    userLogin: credential.username,
    userId: 574,
    capabilities: { manage_options: true },
  },
  session: {
    type: 'production-auth-session',
    status: 'active',
    id: 'psh_01j00000000000000000000574',
    expiresAt: futureReceiptExpiry,
  },
};

function sha256Hex(data) {
  return createHash('sha256').update(String(data), 'utf8').digest('hex');
}

function fixtureHash(label) {
  return sha256Hex(`rpp-0574:${label}`);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function fixtureSnapshots() {
  const path = 'wp-content/uploads/rpp-0574-receipt-expiry-v4.txt';
  return {
    base: {
      files: { [path]: 'rpp-0574 base content' },
      plugins: {},
      db: {},
    },
    local: {
      files: { [path]: 'rpp-0574 local content v4' },
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

function receiptForPlan(
  plan,
  {
    receiptHash,
    expiresAt = futureReceiptExpiry,
    includeSessionUserBinding = true,
  } = {},
) {
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

function applyRevalidationEvidence(plan, receipt, overrides = {}) {
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
    ...overrides,
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
      previousClaimId: 'psh_01i99999999999999999574',
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

function successfulApplyBody({ payload, rawBody, applyCount }) {
  return {
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
  };
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

function assertNoMutationWork(events) {
  assert.equal(eventSequence(events, 'mutation-executor-entered'), null);
  assert.equal(eventSequence(events, 'mutation-applied'), null);
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

function hashOnlyProofEnvelope({ summary, receipt, events }) {
  const applyRevalidation = summary.applyRevalidation || {};
  const liveSourceSequence = eventSequence(events, 'live-source-revalidated');
  const firstMutationSequence = eventSequence(events, 'mutation-applied');

  return {
    schemaVersion: 1,
    sliceHash: sha256Hex('RPP-0574'),
    proofClassHash: sha256Hex('receipt-expiry-validation-v4'),
    evidenceScopeHash: sha256Hex('local-generated-support'),
    releaseStatusHash: sha256Hex('NO-GO'),
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
    liveSourceHash: applyRevalidation.liveSource?.sourceHash || fixtureHash('live-source'),
    liveSourceSnapshotHash: applyRevalidation.liveSource?.snapshotHash || fixtureHash('live-source-snapshot'),
    negativeCoverageHash: digest([
      'expired-dry-run-refused',
      'stale-dry-run-refused',
      'blank-expiry-refused',
      'apply-side-expired-refused',
      'live-source-drift-refused',
    ]),
    applyRevalidation: {
      phaseHash: sha256Hex(applyRevalidation.phase),
      checkedAgainstHash: sha256Hex(applyRevalidation.checkedAgainst),
      liveSourceRevalidatedSequence: liveSourceSequence,
      firstMutationSequence,
      beforeFirstMutation: Number.isInteger(liveSourceSequence)
        && Number.isInteger(firstMutationSequence)
        && liveSourceSequence < firstMutationSequence,
    },
    redaction: {
      formatHash: sha256Hex('hash-only'),
      rawValuesIncluded: false,
    },
  };
}

function assertHashOnlyProofEnvelope(envelope) {
  for (const field of [
    'sliceHash',
    'proofClassHash',
    'evidenceScopeHash',
    'releaseStatusHash',
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
    'liveSourceHash',
    'liveSourceSnapshotHash',
    'negativeCoverageHash',
  ]) {
    assert.match(envelope[field], sha256Pattern, `${field} must be sha256 evidence`);
  }
  assert.match(envelope.applyRevalidation.phaseHash, sha256Pattern);
  assert.match(envelope.applyRevalidation.checkedAgainstHash, sha256Pattern);
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

test('RPP-0574 v4 refuses expired, stale, and missing dry-run receipt expiry before apply work', async () => {
  const cases = [
    {
      label: 'expired',
      expiresAt: expiredReceiptExpiry,
      observed: expiredReceiptExpiry,
      receiptHashLabel: 'expired-dry-run-receipt',
    },
    {
      label: 'stale',
      expiresAt: staleReceiptExpiry,
      observed: staleReceiptExpiry,
      receiptHashLabel: 'stale-dry-run-receipt',
    },
    {
      label: 'missing',
      expiresAt: '',
      observed: 'invalid-receipt-expiry',
      receiptHashLabel: 'missing-expiry-receipt',
    },
  ];

  for (const receiptCase of cases) {
    const { base, local, resourceKey } = fixtureSnapshots();
    const idempotencyKey = `idem-rpp-0574-${receiptCase.label}-dry-run-v4`;
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
            receiptHash: fixtureHash(receiptCase.receiptHashLabel),
            expiresAt: receiptCase.expiresAt,
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
        observed: receiptCase.observed,
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
          observed: receiptCase.observed,
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
        receiptHash: fixtureHash(receiptCase.receiptHashLabel),
        receiptExpiryHash: digest(summary.receiptExpiry),
        boundaryHash: digest(summary.boundary),
      }, [idempotencyKey, credential.username, credential.password, auth.session.id, sourceUrl]);
    } finally {
      restore();
    }
  }
});

test('RPP-0574 v4 preserves apply-side stale receipt refusal before mutation work', async () => {
  const { base, local } = fixtureSnapshots();
  const idempotencyKey = 'idem-rpp-0574-apply-side-stale-v4';
  const events = [];
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
          receiptHash: fixtureHash('apply-side-stale-receipt'),
          expiresAt: futureReceiptExpiry,
          includeSessionUserBinding: false,
        }),
      });
    }
    if (pathname.endsWith('/apply')) {
      appendEvent(events, 'apply-started');
      appendEvent(events, 'receipt-expiry-revalidated');
      appendEvent(events, 'receipt-stale-refused');
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
          idempotencyKeyHash: fixtureHash('apply-side-stale-idempotency-key'),
          requestHash: fixtureHash('apply-side-stale-request'),
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
    assertNoMutationWork(events);
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
      receiptExpiryHash: digest(summary.receiptExpiry),
      applyIdempotencyHash: digest(summary.apply.idempotency),
      eventOrderHash: digest(events.map(({ event }) => event)),
    }, [idempotencyKey, credential.username, credential.password, auth.session.id, sourceUrl]);
  } finally {
    restore();
  }
});

test('RPP-0574 v4 refuses live-source drift during apply revalidation before mutation work', async () => {
  const { base, local, resourceKey } = fixtureSnapshots();
  const idempotencyKey = 'idem-rpp-0574-live-source-drift-v4';
  const events = [];
  let dryRunReceipt = null;
  const { seen, restore } = installFetch(({ pathname, payload }) => {
    if (pathname.endsWith('/preflight')) {
      return preflightResponse();
    }
    if (pathname.endsWith('/snapshot')) {
      return snapshotResponse(base);
    }
    if (pathname.endsWith('/dry-run')) {
      dryRunReceipt = receiptForPlan(payload.plan, {
        receiptHash: fixtureHash('live-source-drift-receipt'),
        expiresAt: futureReceiptExpiry,
      });
      return jsonResponse({
        ok: true,
        mode: 'dry-run',
        auth: authEnvelope(),
        receipt: dryRunReceipt,
      });
    }
    if (pathname.endsWith('/apply')) {
      appendEvent(events, 'apply-started');
      appendEvent(events, 'live-source-revalidated');
      appendEvent(events, 'live-source-drift-refused');
      return jsonResponse({
        ok: false,
        mode: 'apply',
        code: 'APPLY_REVALIDATION_REQUIRED',
        applied: 0,
        auth: authEnvelope(),
        idempotency: {
          replayed: false,
          freshMutationWork: false,
          conflict: false,
          idempotencyKeyHash: fixtureHash('live-source-drift-idempotency-key'),
          requestHash: fixtureHash('live-source-drift-request'),
        },
        applyRevalidation: applyRevalidationEvidence(payload.plan, payload.receipt, {
          verifiedCount: 0,
          verifiedResourceKeys: [],
        }),
      }, 409);
    }
    throw new Error(`unexpected fetch to ${pathname}`);
  });

  try {
    const summary = await runPush({ base, local, idempotencyKey });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'APPLY_REVALIDATION_REQUIRED');
    assert.equal(summary.receiptExpiry, undefined);
    assert.equal(summary.apply.status, 409);
    assert.equal(summary.apply.applied, 0);
    assert.equal(summary.apply.idempotency.freshMutationWork, false);
    assert.equal(summary.apply.applyRevalidation.required, 'fresh-live-hashes-before-first-mutation');
    assert.equal(summary.apply.applyRevalidation.phase, 'before-first-mutation');
    assert.equal(summary.apply.applyRevalidation.checkedAgainst, 'live-remote');
    assert.equal(summary.apply.applyRevalidation.receiptHash, dryRunReceipt.receiptHash);
    assert.equal(summary.apply.applyRevalidation.verifiedCount, 0);
    assert.deepEqual(summary.apply.applyRevalidation.verifiedResourceKeys, []);
    assert.deepEqual(summary.plan.mutationKeys, [resourceKey]);
    assertNoMutationWork(events);
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
      applyRevalidationHash: digest(summary.apply.applyRevalidation),
      applyIdempotencyHash: digest(summary.apply.idempotency),
      eventOrderHash: digest(events.map(({ event }) => event)),
    }, [idempotencyKey, credential.username, credential.password, auth.session.id, sourceUrl, resourceKey]);
  } finally {
    restore();
  }
});

test('RPP-0574 v4 accepts support only when apply revalidates live source before mutation', async () => {
  const { base, local, resourceKey, resourcePath } = fixtureSnapshots();
  const idempotencyKey = 'idem-rpp-0574-unexpired-revalidation-v4';
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
