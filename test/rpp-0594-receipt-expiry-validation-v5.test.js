import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAuthenticatedHttpPush } from '../src/authenticated-http-push-client.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routeSourcePath = path.join(repoRoot, 'scripts/playground/push-remote-rest-plugin.php');
const routeSource = readFileSync(routeSourcePath, 'utf8');

const sourceUrl = 'http://127.0.0.1:8080';
const routePrefix = '/wp-json/reprint/v1/push';
const futureReceiptExpiry = '2030-01-01T00:00:00Z';
const expiredReceiptExpiry = '2025-01-01T00:00:00Z';
const staleReceiptExpiry = '2025-01-01T00:00:01Z';
const malformedReceiptExpiry = 'not-a-receipt-date';
const observationNow = new Date('2025-01-01T00:00:02Z');
const trustedDbJournalScope = 'checked live production-shaped journal surface; not local Playground fixture only';
const proofCapturedAt = '2026-05-31T00:00:00Z';
const sha256Pattern = /^[a-f0-9]{64}$/;

const credential = {
  username: 'reprint_push_admin',
  password: 'rpp-0594-test-application-password',
};

const auth = {
  identity: {
    userLogin: credential.username,
    userId: 594,
    capabilities: { manage_options: true },
  },
  session: {
    type: 'production-auth-session',
    status: 'active',
    id: 'psh_01j00000000000000000000594',
    expiresAt: futureReceiptExpiry,
  },
};

function sha256Hex(data) {
  return createHash('sha256').update(String(data), 'utf8').digest('hex');
}

function fixtureHash(label) {
  return sha256Hex(`rpp-0594:${label}`);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function functionBody(name) {
  const declaration = `function ${name}`;
  const start = routeSource.indexOf(declaration);
  assert.notEqual(start, -1, `missing ${declaration}`);
  const open = routeSource.indexOf('{', start);
  assert.notEqual(open, -1, `missing body for ${declaration}`);

  let depth = 0;
  for (let index = open; index < routeSource.length; index += 1) {
    const char = routeSource[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return routeSource.slice(open + 1, index);
      }
    }
  }

  assert.fail(`unterminated body for ${declaration}`);
}

function assertBefore(body, first, second) {
  const firstIndex = body.indexOf(first);
  const secondIndex = body.indexOf(second);
  assert.notEqual(firstIndex, -1, `missing ${first}`);
  assert.notEqual(secondIndex, -1, `missing ${second}`);
  assert.ok(firstIndex < secondIndex, `${first} must appear before ${second}`);
}

function fixtureSnapshots() {
  const resourcePath = 'wp-content/uploads/rpp-0594-receipt-expiry-v5.txt';
  return {
    base: {
      files: { [resourcePath]: 'rpp-0594 base content' },
      plugins: {},
      db: {},
    },
    local: {
      files: { [resourcePath]: 'rpp-0594 local content v5' },
      plugins: {},
      db: {},
    },
    resourcePath,
    resourceKey: `file:${resourcePath}`,
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
    seen.push({ pathname, payload, rawBodyHash: sha256Hex(rawBody) });
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
      previousClaimId: 'psh_01i99999999999999999594',
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
  assert.equal(eventSequence(events, 'mutation-setup-entered'), null);
  assert.equal(eventSequence(events, 'mutation-executor-entered'), null);
  assert.equal(eventSequence(events, 'mutation-applied'), null);
}

function assertLiveSourceBeforeMutation(events) {
  const applyStartedSequence = eventSequence(events, 'apply-started');
  const liveSourceSequence = eventSequence(events, 'live-source-revalidated');
  const setupSequence = eventSequence(events, 'mutation-setup-entered');
  const executorSequence = eventSequence(events, 'mutation-executor-entered');
  const mutationSequence = eventSequence(events, 'mutation-applied');

  assert.ok(Number.isInteger(applyStartedSequence), 'missing apply-started event');
  assert.ok(Number.isInteger(liveSourceSequence), 'missing live-source-revalidated event');
  assert.ok(Number.isInteger(setupSequence), 'missing mutation-setup-entered event');
  assert.ok(Number.isInteger(executorSequence), 'missing mutation-executor-entered event');
  assert.ok(Number.isInteger(mutationSequence), 'missing mutation-applied event');
  assert.ok(applyStartedSequence < liveSourceSequence, 'live-source revalidation must follow apply start');
  assert.ok(liveSourceSequence < setupSequence, 'live-source revalidation must precede mutation setup');
  assert.ok(liveSourceSequence < executorSequence, 'live-source revalidation must precede executor entry');
  assert.ok(liveSourceSequence < mutationSequence, 'live-source revalidation must precede mutation application');
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

function acceptedApplyCase({ summary, events, receipt }) {
  const applyRevalidation = summary.applyRevalidation || {};
  const applyStartedSequence = eventSequence(events, 'apply-started');
  const liveSourceSequence = eventSequence(events, 'live-source-revalidated');
  const setupSequence = eventSequence(events, 'mutation-setup-entered');
  const firstMutationSequence = eventSequence(events, 'mutation-applied');
  const beforeMutationCapableWork = Number.isInteger(liveSourceSequence)
    && Number.isInteger(setupSequence)
    && Number.isInteger(firstMutationSequence)
    && liveSourceSequence < setupSequence
    && liveSourceSequence < firstMutationSequence;
  const entry = {
    labelHash: fixtureHash('accepted-apply-live-source-revalidation'),
    ok: summary.ok === true,
    status: 'support_only',
    codeHash: fixtureHash('LOCAL_RECEIPT_EXPIRY_REVALIDATION_SUPPORT_ONLY'),
    receiptHash: receipt.receiptHash,
    planHash: applyRevalidation.planHash,
    mutationSetHash: applyRevalidation.mutationSetHash,
    preconditionSetHash: applyRevalidation.preconditionSetHash,
    liveSourceHash: applyRevalidation.liveSource?.sourceHash || null,
    liveSourceSnapshotHash: applyRevalidation.liveSource?.snapshotHash || null,
    liveSourceUrlHash: applyRevalidation.liveSource?.sourceUrlHash || null,
    activeClaimKeyHash: applyRevalidation.claim?.activeClaimKeyHash || null,
    eventOrderHash: digest(events.map(({ event }) => event)),
    ordering: {
      applyStartedSequence,
      liveSourceSequence,
      mutationSetupSequence: setupSequence,
      firstMutationSequence,
      revalidatedAfterApplyStarted: Number.isInteger(applyStartedSequence)
        && Number.isInteger(liveSourceSequence)
        && applyStartedSequence < liveSourceSequence,
      beforeMutationCapableWork,
    },
    releaseMovement: {
      allowed: false,
      reasonHash: fixtureHash('support-only-accepted-revalidation'),
    },
  };
  entry.caseHash = digest(entry);
  return entry;
}

function blockedExpiryCase(kind, overrides = {}) {
  const categoryByKind = {
    expired: 'expired',
    missing: 'missing',
    malformed: 'malformed',
    stale: 'stale',
    drifted: 'drifted',
  };
  const category = categoryByKind[kind];
  assert.ok(category, `unknown receipt expiry case ${kind}`);
  const entry = {
    labelHash: fixtureHash(`blocked-${kind}-receipt-expiry`),
    categoryHash: sha256Hex(category),
    ok: false,
    status: 'blocked',
    codeHash: sha256Hex('AUTH_RECEIPT_EXPIRED'),
    verdictHash: sha256Hex('AUTH_RECEIPT_EXPIRED'),
    receiptHash: overrides.receiptHash || fixtureHash(`${kind}-receipt`),
    receiptExpiryHash: overrides.receiptExpiryHash || fixtureHash(`${kind}-receipt-expiry`),
    requestOrderHash: overrides.requestOrderHash || fixtureHash(`${kind}-request-order`),
    boundaryHash: overrides.boundaryHash || fixtureHash(`${kind}-boundary`),
    stoppedBefore: {
      jsonParsing: overrides.jsonParsed === true ? false : true,
      receiptWork: overrides.receiptWorkStarted === true ? false : true,
      mutationCapableWork: overrides.mutationCapableWorkStarted === true ? false : true,
      releaseMovement: true,
    },
    counters: {
      jsonParseAttempts: overrides.jsonParsed === true ? 1 : 0,
      receiptWorkAttempts: overrides.receiptWorkStarted === true ? 1 : 0,
      mutationCapableWorkAttempts: overrides.mutationCapableWorkStarted === true ? 1 : 0,
    },
    releaseMovement: {
      allowed: false,
      reasonHash: fixtureHash(`${kind}-receipt-expiry-release-movement-blocked`),
    },
  };
  entry.caseHash = digest(entry);
  return entry;
}

function verifierSummary({ acceptedCase, negativeCases }) {
  const expectedCategoryHashes = ['drifted', 'expired', 'malformed', 'missing', 'stale']
    .map(sha256Hex)
    .sort();
  const observedCategoryHashes = [...new Set(negativeCases.map((entry) => entry.categoryHash))].sort();
  const allNegativeCasesBlocked = negativeCases.every((entry) =>
    entry.ok === false
      && entry.status === 'blocked'
      && entry.releaseMovement.allowed === false
      && entry.stoppedBefore.jsonParsing === true
      && entry.stoppedBefore.receiptWork === true
      && entry.stoppedBefore.mutationCapableWork === true
      && entry.stoppedBefore.releaseMovement === true);
  const acceptedCarried = acceptedCase?.ok === true
    && acceptedCase?.status === 'support_only'
    && acceptedCase?.ordering?.revalidatedAfterApplyStarted === true
    && acceptedCase?.ordering?.beforeMutationCapableWork === true;
  const summary = {
    schemaVersion: 1,
    rppHash: sha256Hex('RPP-0594'),
    variant: 5,
    evidenceSourceHash: fixtureHash('release-verifier-receipt-expiry-validation-v5'),
    proofClassHash: fixtureHash('receipt-expiry-validation-live-source-revalidation-carry-through'),
    evidenceScopeHash: sha256Hex('local-support-only'),
    capturedAtHash: sha256Hex(proofCapturedAt),
    status: acceptedCarried && allNegativeCasesBlocked ? 'support_only' : 'blocked',
    ok: Boolean(acceptedCarried && allNegativeCasesBlocked),
    productionBacked: false,
    releaseEligible: false,
    releaseGate: 'NO-GO',
    redaction: {
      formatHash: sha256Hex('hash-only'),
      rawValuesIncluded: false,
      hashAlgorithm: 'sha256',
    },
    releaseVerifier: {
      carriesThroughOneSummary: true,
      summaryCount: 1,
      acceptedCaseHash: acceptedCase?.caseHash || null,
      negativeCaseHashes: negativeCases.map((entry) => entry.caseHash),
      expectedNegativeCaseCount: 5,
      allNegativeCasesBlocked,
      expectedCategoryHashes,
      observedCategoryHashes,
      categoryCoverageComplete: digest(observedCategoryHashes) === digest(expectedCategoryHashes),
      acceptedApplyRevalidatesLiveSourceBeforeMutation: acceptedCase?.ordering?.beforeMutationCapableWork === true,
    },
    evidence: {
      receiptExpiryValidation: {
        accepted: acceptedCase,
        negativeCases,
      },
    },
    releaseMovement: {
      allowed: false,
      gates: '0/1',
      reasonHash: fixtureHash('production-owned-receipt-expiry-validation-required'),
    },
    boundary: {
      firstRemainingProductionBoundaryHash: fixtureHash('checked-production-owned-receipt-expiry-validation-proof'),
      status: 'blocked',
      verdict: 'PRODUCTION_EVIDENCE_REQUIRED',
    },
  };
  summary.summaryHash = digest({
    rppHash: summary.rppHash,
    variant: summary.variant,
    acceptedCaseHash: summary.releaseVerifier.acceptedCaseHash,
    negativeCaseHashes: summary.releaseVerifier.negativeCaseHashes,
    status: summary.status,
  });
  return summary;
}

function assertHashOrNull(value, label) {
  if (value === null) {
    return;
  }
  assert.match(value, sha256Pattern, `${label} must be sha256 or null`);
}

function assertCaseHashes(entry) {
  for (const field of [
    'labelHash',
    'caseHash',
    'receiptHash',
  ]) {
    assertHashOrNull(entry[field], field);
  }
  if (entry.ok) {
    for (const field of [
      'planHash',
      'mutationSetHash',
      'preconditionSetHash',
      'liveSourceHash',
      'liveSourceSnapshotHash',
      'liveSourceUrlHash',
      'activeClaimKeyHash',
      'eventOrderHash',
    ]) {
      assertHashOrNull(entry[field], field);
    }
  } else {
    for (const field of [
      'categoryHash',
      'codeHash',
      'verdictHash',
      'receiptExpiryHash',
      'requestOrderHash',
      'boundaryHash',
    ]) {
      assertHashOrNull(entry[field], field);
    }
  }
}

function assertSummaryIsHashOnly(summary) {
  assert.equal(summary.redaction.rawValuesIncluded, false);
  assert.equal(summary.productionBacked, false);
  assert.equal(summary.releaseEligible, false);
  assert.equal(summary.releaseGate, 'NO-GO');
  assert.match(summary.summaryHash, sha256Pattern);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(summary, { label: 'RPP-0594 receipt expiry verifier summary' }));
  assertNoRawSupportValues(summary, [
    sourceUrl,
    credential.username,
    credential.password,
    auth.session.id,
    fixtureSnapshots().resourcePath,
    fixtureSnapshots().resourceKey,
    expiredReceiptExpiry,
    staleReceiptExpiry,
    malformedReceiptExpiry,
    futureReceiptExpiry,
  ]);
}

function assertNoRawSupportValues(evidence, rawValues) {
  const serialized = JSON.stringify(evidence);
  for (const rawValue of rawValues) {
    assert.equal(serialized.includes(rawValue), false, `support evidence leaked raw value ${rawValue}`);
  }
}

test('RPP-0594 v5 pins receipt expiry validation before apply mutation entry', () => {
  const authenticatedApply = functionBody('reprint_push_lab_rest_authenticated_apply');
  const validateReceipt = functionBody('reprint_push_lab_rest_validate_authenticated_receipt');
  const runDbJournalApply = functionBody('reprint_push_lab_rest_run_db_journal_apply');

  assertBefore(
    authenticatedApply,
    "reprint_push_lab_rest_require_signed_request($request, 'apply')",
    'reprint_push_lab_rest_json_payload($request)',
  );
  assertBefore(
    authenticatedApply,
    'reprint_push_lab_rest_validate_authenticated_receipt($request, $payload, $plan, $receipt_payload)',
    'reprint_push_lab_rest_apply_with_db_journal($request, true)',
  );
  assertBefore(
    validateReceipt,
    '$expires_at = strtotime',
    '$current = reprint_push_lab_rest_auth_evidence($request);',
  );
  assertBefore(
    validateReceipt,
    'Authenticated dry-run receipt has expired.',
    'Receipt auth identity or session does not match the current request.',
  );
  assertBefore(
    runDbJournalApply,
    "reprint_push_lab_db_journal_append_event('apply-started'",
    '$accepted = reprint_push_lab_rest_revalidate_apply_live_source_before_mutation(',
  );
  assertBefore(
    runDbJournalApply,
    '$accepted = reprint_push_lab_rest_revalidate_apply_live_source_before_mutation(',
    "$result = reprint_push_protocol_run_payload('apply'",
  );

  assert.match(validateReceipt, /Authenticated dry-run receipt has expired\./);
  assert.match(validateReceipt, /AUTH_RECEIPT_EXPIRED/);
  assert.match(validateReceipt, /\$expires_at\s*=\s*strtotime\(\(string\) \(\$binding\['expiresAt'\]/);
  assert.match(validateReceipt, /if \(!\$expires_at \|\| \$expires_at < time\(\)\)/);
});

test('RPP-0594 v5 refuses expired missing malformed stale or drifted expiry evidence before release movement', async () => {
  const dryRunCases = [
    {
      kind: 'expired',
      expiresAt: expiredReceiptExpiry,
      observed: expiredReceiptExpiry,
      receiptHashLabel: 'expired-dry-run-receipt',
    },
    {
      kind: 'missing',
      expiresAt: '',
      observed: 'invalid-receipt-expiry',
      receiptHashLabel: 'missing-expiry-receipt',
    },
    {
      kind: 'malformed',
      expiresAt: malformedReceiptExpiry,
      observed: malformedReceiptExpiry,
      receiptHashLabel: 'malformed-expiry-receipt',
    },
  ];
  const negativeCases = [];

  for (const receiptCase of dryRunCases) {
    const { base, local, resourceKey } = fixtureSnapshots();
    const idempotencyKey = `idem-rpp-0594-${receiptCase.kind}-dry-run-v5`;
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
      assert.equal(summary.apply, null);
      assert.equal(summary.recoveryInspect, null);
      assert.equal(summary.replay, null);
      assert.equal(summary.dbJournal, null);
      assert.deepEqual(summary.plan.mutationKeys, [resourceKey]);
      assert.deepEqual(summary.receiptExpiry, {
        phase: 'dry-run',
        field: 'receipt.authBinding.expiresAt',
        required: 'unexpired',
        observed: receiptCase.observed,
        verdict: 'AUTH_RECEIPT_EXPIRED',
      });
      assert.deepEqual(seen.map(({ pathname }) => pathname), [
        `${routePrefix}/preflight`,
        `${routePrefix}/snapshot`,
        `${routePrefix}/dry-run`,
      ]);
      assert.ok(!seen.some(({ pathname }) => pathname.endsWith('/apply')));

      negativeCases.push(blockedExpiryCase(receiptCase.kind, {
        receiptHash: fixtureHash(receiptCase.receiptHashLabel),
        receiptExpiryHash: digest(summary.receiptExpiry),
        requestOrderHash: digest(seen.map(({ pathname }) => pathname)),
        boundaryHash: digest(summary.boundary),
      }));
    } finally {
      restore();
    }
  }

  for (const receiptCase of [
    {
      kind: 'stale',
      codeEvent: 'receipt-stale-refused',
      receiptHashLabel: 'apply-side-stale-receipt',
    },
    {
      kind: 'drifted',
      codeEvent: 'receipt-expiry-drift-refused',
      receiptHashLabel: 'apply-side-drifted-receipt',
    },
  ]) {
    const { base, local } = fixtureSnapshots();
    const idempotencyKey = `idem-rpp-0594-apply-side-${receiptCase.kind}-v5`;
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
            receiptHash: fixtureHash(receiptCase.receiptHashLabel),
            expiresAt: futureReceiptExpiry,
            includeSessionUserBinding: false,
          }),
        });
      }
      if (pathname.endsWith('/apply')) {
        appendEvent(events, 'apply-started');
        appendEvent(events, 'receipt-expiry-revalidated', {
          receiptExpiryHash: receiptCase.kind === 'drifted'
            ? fixtureHash('drifted-apply-expiry')
            : fixtureHash('stale-apply-expiry'),
        });
        appendEvent(events, receiptCase.codeEvent);
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
            idempotencyKeyHash: fixtureHash(`${receiptCase.kind}-idempotency-key`),
            requestHash: fixtureHash(`${receiptCase.kind}-request`),
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

      negativeCases.push(blockedExpiryCase(receiptCase.kind, {
        receiptHash: fixtureHash(receiptCase.receiptHashLabel),
        receiptExpiryHash: digest(summary.receiptExpiry),
        requestOrderHash: digest(seen.map(({ pathname }) => pathname)),
        boundaryHash: digest(summary.boundary),
        jsonParsed: true,
      }));
    } finally {
      restore();
    }
  }

  const categoryHashes = [...new Set(negativeCases.map((entry) => entry.categoryHash))].sort();
  const applySideCategoryHashes = new Set(['drifted', 'stale'].map(sha256Hex));
  assert.deepEqual(
    categoryHashes,
    ['drifted', 'expired', 'malformed', 'missing', 'stale'].map(sha256Hex).sort(),
  );
  for (const negativeCase of negativeCases) {
    const expectedBeforeJson = !applySideCategoryHashes.has(negativeCase.categoryHash);
    assert.equal(negativeCase.ok, false);
    assert.equal(negativeCase.status, 'blocked');
    assert.equal(negativeCase.releaseMovement.allowed, false);
    assert.equal(negativeCase.stoppedBefore.jsonParsing, expectedBeforeJson);
    assert.equal(negativeCase.stoppedBefore.receiptWork, true);
    assert.equal(negativeCase.stoppedBefore.mutationCapableWork, true);
    assert.equal(negativeCase.stoppedBefore.releaseMovement, true);
    assert.equal(negativeCase.counters.jsonParseAttempts, expectedBeforeJson ? 0 : 1);
    assert.equal(negativeCase.counters.receiptWorkAttempts, 0);
    assert.equal(negativeCase.counters.mutationCapableWorkAttempts, 0);
    assertCaseHashes(negativeCase);
  }

  const preParseVerifierCases = ['expired', 'missing', 'malformed', 'stale', 'drifted'].map((kind) =>
    blockedExpiryCase(kind));
  assert.equal(
    preParseVerifierCases.every((entry) =>
      entry.stoppedBefore.jsonParsing === true
        && entry.stoppedBefore.receiptWork === true
        && entry.stoppedBefore.mutationCapableWork === true
        && entry.releaseMovement.allowed === false),
    true,
  );
});

test('RPP-0594 v5 carries accepted apply receipt expiry proof through one hash-only verifier summary', async () => {
  const { base, local, resourceKey, resourcePath } = fixtureSnapshots();
  const idempotencyKey = 'idem-rpp-0594-unexpired-revalidation-v5';
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
        appendEvent(events, 'receipt-expiry-revalidated', {
          receiptExpiryHash: fixtureHash('accepted-receipt-expiry'),
        });
        appendEvent(events, 'live-source-revalidated', {
          phase: 'before-first-mutation',
          checkedAgainst: 'live-remote',
          snapshotHash: fixtureHash('live-source-snapshot'),
        });
        appendEvent(events, 'mutation-setup-entered');
        appendEvent(events, 'mutation-executor-entered');
        appendEvent(events, 'mutation-applied', {
          resourceKeyHash: sha256Hex(resourceKey),
        });
        appendEvent(events, 'apply-committed');
      } else {
        appendEvent(events, 'idempotency-replay-returned');
      }
      return jsonResponse(successfulApplyBody({ payload, rawBody, applyCount }));
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
    assert.equal(summary.replay.idempotency.replayed, true);
    assert.equal(summary.replay.idempotency.freshMutationWork, false);
    assert.equal(summary.dbJournal.leaseFence.staleClaimRejected, true);
    assertLiveSourceBeforeMutation(events);
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

    const acceptedCase = acceptedApplyCase({ summary, events, receipt: dryRunReceipt });
    const negativeCases = ['expired', 'missing', 'malformed', 'stale', 'drifted'].map((kind) =>
      blockedExpiryCase(kind));
    const verifier = verifierSummary({ acceptedCase, negativeCases });

    assert.equal(acceptedCase.ok, true);
    assert.equal(acceptedCase.status, 'support_only');
    assert.equal(acceptedCase.ordering.revalidatedAfterApplyStarted, true);
    assert.equal(acceptedCase.ordering.beforeMutationCapableWork, true);
    assert.equal(acceptedCase.releaseMovement.allowed, false);
    assertCaseHashes(acceptedCase);

    assert.equal(verifier.ok, true);
    assert.equal(verifier.status, 'support_only');
    assert.equal(verifier.releaseVerifier.carriesThroughOneSummary, true);
    assert.equal(verifier.releaseVerifier.summaryCount, 1);
    assert.equal(verifier.releaseVerifier.acceptedCaseHash, acceptedCase.caseHash);
    assert.equal(verifier.releaseVerifier.expectedNegativeCaseCount, 5);
    assert.equal(verifier.releaseVerifier.allNegativeCasesBlocked, true);
    assert.equal(verifier.releaseVerifier.categoryCoverageComplete, true);
    assert.equal(verifier.releaseVerifier.acceptedApplyRevalidatesLiveSourceBeforeMutation, true);
    assert.deepEqual(
      verifier.releaseVerifier.negativeCaseHashes,
      negativeCases.map((entry) => entry.caseHash),
    );
    assert.equal(verifier.releaseMovement.allowed, false);
    assert.equal(verifier.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');
    assertSummaryIsHashOnly(verifier);
    assertNoRawSupportValues(verifier, [
      idempotencyKey,
      resourceKey,
      resourcePath,
      JSON.stringify(summary.planObject),
      JSON.stringify(dryRunReceipt),
    ]);
  } finally {
    restore();
  }
});
