import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { digest } from '../src/stable-json.js';

const proofId = 'rpp-0556-same-key-same-body-replay-v3';
const fixedNowMs = Date.parse('2026-05-31T00:00:00.000Z');
const sourceUrl = 'http://127.0.0.1:8080';
const routeProfile = 'production-shaped';
const hashPattern = /^[a-f0-9]{64}$/;

const generatedCases = Object.freeze([
  {
    id: 'single-mutation',
    idempotencyKey: 'idem-rpp-0556-generated-single-v3',
    sessionId: 'psh_01j00000000000000000556a',
    mutationCount: 1,
    resourcePrefix: 'wp-content/uploads/reprint-push/rpp-0556-single',
    baseValuePrefix: 'base-raw-rpp-0556-single',
    localValuePrefix: 'local-raw-rpp-0556-single',
  },
  {
    id: 'multi-mutation',
    idempotencyKey: 'idem-rpp-0556-generated-multi-v3',
    sessionId: 'psh_01j00000000000000000556b',
    mutationCount: 3,
    resourcePrefix: 'wp-content/uploads/reprint-push/rpp-0556-multi',
    baseValuePrefix: 'base-raw-rpp-0556-multi',
    localValuePrefix: 'local-raw-rpp-0556-multi',
  },
]);

function sha256Hex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function fixtureHash(label) {
  return sha256Hex(`${proofId}:${label}`);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function planFor(generatedCase) {
  const mutations = [];
  const preconditions = [];

  for (let index = 1; index <= generatedCase.mutationCount; index += 1) {
    const resourceKey = `${generatedCase.resourcePrefix}-${index}.txt`;
    const baseValue = `${generatedCase.baseValuePrefix}-${index}`;
    const localValue = `${generatedCase.localValuePrefix}-${index}`;
    mutations.push({
      id: `mutation-${generatedCase.id}-${index}`,
      action: 'upsert',
      resource: { type: 'file', path: resourceKey },
      resourceKey,
      remoteBeforeHash: sha256Hex(baseValue),
      localHash: sha256Hex(localValue),
      valueHash: sha256Hex(localValue),
    });
    preconditions.push({
      mutationId: `mutation-${generatedCase.id}-${index}`,
      resourceKey,
      expectedHash: sha256Hex(baseValue),
    });
  }

  return {
    id: `plan-rpp-0556-${generatedCase.id}-v3`,
    generatedAt: '2026-05-31T00:00:00.000Z',
    preconditions,
    mutations,
  };
}

function requestReceiptFor(generatedCase, plan = planFor(generatedCase)) {
  return {
    receiptHash: fixtureHash(`${generatedCase.id}:dry-run-receipt`),
    planHash: digest(plan),
    mutationCount: plan.mutations.length,
    mutationSetHash: digest(plan.mutations.map((mutation) => ({
      id: mutation.id,
      resourceKey: mutation.resourceKey,
      remoteBeforeHash: mutation.remoteBeforeHash,
      localHash: mutation.localHash,
      valueHash: mutation.valueHash,
    }))),
    preconditionSetHash: digest(plan.preconditions),
  };
}

function applyBodyFor(generatedCase) {
  const plan = planFor(generatedCase);
  return {
    plan,
    receipt: requestReceiptFor(generatedCase, plan),
    applyRevalidation: {
      required: true,
      checkedAgainst: 'live-remote',
      mutationCount: plan.mutations.length,
    },
  };
}

function sameCanonicalReplayBodyFor(generatedCase) {
  const plan = planFor(generatedCase);
  return {
    applyRevalidation: {
      mutationCount: plan.mutations.length,
      checkedAgainst: 'live-remote',
      required: true,
    },
    receipt: requestReceiptFor(generatedCase, plan),
    plan,
  };
}

function differentCanonicalBodyFor(generatedCase) {
  return {
    ...sameCanonicalReplayBodyFor(generatedCase),
    durableJournalBoundaryProbe: {
      type: 'same-key-different-body-conflict-before-mutation',
      probeHash: fixtureHash(`${generatedCase.id}:different-body-probe`),
    },
  };
}

function scopeFor(generatedCase, overrides = {}) {
  return {
    schemaVersion: 3,
    sourceUrl,
    routeProfile,
    route: '/wp-json/reprint/v1/push/apply',
    sessionHash: sha256Hex(generatedCase.sessionId),
    claimHash: fixtureHash(`${generatedCase.id}:claim`),
    receiptStoreHash: fixtureHash(`${generatedCase.id}:receipt-store`),
    recoveryScopeHash: fixtureHash(`${generatedCase.id}:recovery-scope`),
    ...overrides,
  };
}

function committedReceiptFor({ generatedCase, body, scope }) {
  const core = {
    state: 'committed',
    idempotencyKeyHash: sha256Hex(generatedCase.idempotencyKey),
    canonicalBodyHash: digest(body),
    scopeHash: digest(scope),
    receiptHash: body.receipt.receiptHash,
    mutationCount: body.plan.mutations.length,
    mutationWorkCount: body.plan.mutations.length,
    commitSequence: 40 + body.plan.mutations.length,
    expiresAtMs: fixedNowMs + 60_000,
  };

  return {
    ...core,
    committedReceiptHash: digest(core),
  };
}

function resolveReplayAttempt({
  idempotencyKey,
  body,
  committedReceipt,
  scope,
  nowMs = fixedNowMs,
}) {
  const idempotencyKeyHash = sha256Hex(idempotencyKey);
  const canonicalBodyHash = digest(body);
  const scopeHash = digest(scope);
  const mutationCount = Array.isArray(body?.plan?.mutations) ? body.plan.mutations.length : 0;
  const baseDecision = {
    proofId,
    variant: 3,
    idempotencyKeyHash,
    canonicalBodyHash,
    scopeHash,
    mutationCount,
    replayed: false,
    canReplay: false,
    mutationWorkStarted: false,
    freshMutationWork: false,
    duplicateMutationWork: 0,
    appliedCount: 0,
    receiptRowsWritten: 0,
    requestBodyIncluded: false,
    rawValuesIncluded: false,
  };

  if (!committedReceipt || committedReceipt.state !== 'committed' || !committedReceipt.committedReceiptHash) {
    return {
      ...baseDecision,
      status: 'blocked',
      code: 'COMMITTED_RECEIPT_REQUIRED',
      reason: 'missing-committed-receipt',
    };
  }

  if (
    committedReceipt.idempotencyKeyHash !== idempotencyKeyHash
    || committedReceipt.scopeHash !== scopeHash
    || committedReceipt.expiresAtMs <= nowMs
  ) {
    return {
      ...baseDecision,
      status: 'blocked',
      code: 'STALE_REPLAY_SCOPE',
      reason: 'stale-scope',
      committedScopeHash: committedReceipt.scopeHash,
    };
  }

  if (committedReceipt.canonicalBodyHash !== canonicalBodyHash) {
    return {
      ...baseDecision,
      status: 'conflict',
      code: 'IDEMPOTENCY_KEY_CONFLICT',
      reason: 'same-key-different-canonical-body',
      originalCanonicalBodyHash: committedReceipt.canonicalBodyHash,
      committedReceiptHash: committedReceipt.committedReceiptHash,
    };
  }

  return {
    ...baseDecision,
    status: 'replayed',
    code: 'BATCH_ALREADY_COMMITTED',
    reason: 'committed-receipt-returned',
    replayed: true,
    canReplay: true,
    exactCommittedReceiptMatch: true,
    receiptHash: committedReceipt.receiptHash,
    committedReceiptHash: committedReceipt.committedReceiptHash,
  };
}

function runGeneratedCase(generatedCase) {
  const applyBody = applyBodyFor(generatedCase);
  const replayBody = sameCanonicalReplayBodyFor(generatedCase);
  const scope = scopeFor(generatedCase);
  const committedReceipt = committedReceiptFor({ generatedCase, body: applyBody, scope });
  const safeReplay = resolveReplayAttempt({
    idempotencyKey: generatedCase.idempotencyKey,
    body: replayBody,
    committedReceipt,
    scope,
  });
  const differentBody = resolveReplayAttempt({
    idempotencyKey: generatedCase.idempotencyKey,
    body: differentCanonicalBodyFor(generatedCase),
    committedReceipt,
    scope,
  });
  const missingCommittedReceipt = resolveReplayAttempt({
    idempotencyKey: generatedCase.idempotencyKey,
    body: replayBody,
    committedReceipt: null,
    scope,
  });
  const staleScope = resolveReplayAttempt({
    idempotencyKey: generatedCase.idempotencyKey,
    body: replayBody,
    committedReceipt,
    scope: scopeFor(generatedCase, {
      claimHash: fixtureHash(`${generatedCase.id}:stale-claim`),
      recoveryScopeHash: fixtureHash(`${generatedCase.id}:stale-recovery-scope`),
    }),
  });

  return {
    generatedCase,
    applyBody,
    replayBody,
    applyBodyHash: digest(applyBody),
    replayBodyHash: digest(replayBody),
    committedReceipt,
    safeReplay,
    differentBody,
    missingCommittedReceipt,
    staleScope,
  };
}

function publicDecision(decision, generatedCase) {
  return {
    caseHash: fixtureHash(`${generatedCase.id}:case`),
    idempotencyKeyHash: decision.idempotencyKeyHash,
    canonicalBodyHash: decision.canonicalBodyHash,
    scopeHash: decision.scopeHash,
    status: decision.status,
    code: decision.code,
    reason: decision.reason,
    replayed: decision.replayed,
    canReplay: decision.canReplay,
    mutationCount: decision.mutationCount,
    appliedCount: decision.appliedCount,
    mutationWorkStarted: decision.mutationWorkStarted,
    freshMutationWork: decision.freshMutationWork,
    duplicateMutationWork: decision.duplicateMutationWork,
    receiptRowsWritten: decision.receiptRowsWritten,
    requestBodyIncluded: decision.requestBodyIncluded,
    rawValuesIncluded: decision.rawValuesIncluded,
    receiptHash: decision.receiptHash || null,
    committedReceiptHash: decision.committedReceiptHash || null,
    originalCanonicalBodyHash: decision.originalCanonicalBodyHash || null,
    committedScopeHash: decision.committedScopeHash || null,
  };
}

function buildGeneratedCoverageProof() {
  const caseResults = generatedCases.map(runGeneratedCase);
  const sameCanonicalDecisions = caseResults.map((result) => publicDecision(result.safeReplay, result.generatedCase));
  const differentBodyDecisions = caseResults.map((result) => publicDecision(result.differentBody, result.generatedCase));
  const missingReceiptDecisions = caseResults.map((result) => (
    publicDecision(result.missingCommittedReceipt, result.generatedCase)
  ));
  const staleScopeDecisions = caseResults.map((result) => publicDecision(result.staleScope, result.generatedCase));
  const bodyPairs = caseResults.map((result) => ({
    caseHash: fixtureHash(`${result.generatedCase.id}:case`),
    applyBodyHash: result.applyBodyHash,
    replayBodyHash: result.replayBodyHash,
    canonicalHashesMatch: result.applyBodyHash === result.replayBodyHash,
  }));
  const allDecisions = [
    ...sameCanonicalDecisions,
    ...differentBodyDecisions,
    ...missingReceiptDecisions,
    ...staleScopeDecisions,
  ];
  const counts = {
    generatedCases: generatedCases.length,
    replayAttempts: sameCanonicalDecisions.length,
    replayedCommittedReceipts: sameCanonicalDecisions.filter((decision) => decision.replayed).length,
    differentBodyBlocked: differentBodyDecisions.filter((decision) => decision.code === 'IDEMPOTENCY_KEY_CONFLICT').length,
    missingCommittedReceiptBlocked: missingReceiptDecisions.filter((decision) => (
      decision.code === 'COMMITTED_RECEIPT_REQUIRED'
    )).length,
    staleScopeBlocked: staleScopeDecisions.filter((decision) => decision.code === 'STALE_REPLAY_SCOPE').length,
    mutationBoundaryOpenedDuringReplay: allDecisions.filter((decision) => decision.mutationWorkStarted).length,
    duplicateMutationWork: allDecisions.reduce((total, decision) => total + decision.duplicateMutationWork, 0),
    duplicateReceiptRowsWritten: allDecisions.reduce((total, decision) => total + decision.receiptRowsWritten, 0),
    requestBodiesIncluded: allDecisions.filter((decision) => decision.requestBodyIncluded).length,
    rawValuesIncluded: allDecisions.filter((decision) => decision.rawValuesIncluded).length,
  };
  const gates = [
    proofGate(
      'same-key-same-canonical-body-replays-committed-receipt',
      bodyPairs.every((pair) => pair.canonicalHashesMatch)
        && sameCanonicalDecisions.every((decision) => (
          decision.status === 'replayed'
          && decision.replayed === true
          && decision.canReplay === true
          && decision.receiptHash
        )),
      {
        replayedCommittedReceipts: counts.replayedCommittedReceipts,
        generatedCases: counts.generatedCases,
        bodyPairHash: digest(bodyPairs),
      },
    ),
    proofGate(
      'no-duplicate-mutation-work',
      sameCanonicalDecisions.every((decision) => (
        decision.freshMutationWork === false
        && decision.duplicateMutationWork === 0
        && decision.mutationWorkStarted === false
        && decision.appliedCount === 0
        && decision.receiptRowsWritten === 0
      )),
      {
        duplicateMutationWork: counts.duplicateMutationWork,
        mutationBoundaryOpenedDuringReplay: counts.mutationBoundaryOpenedDuringReplay,
        duplicateReceiptRowsWritten: counts.duplicateReceiptRowsWritten,
      },
    ),
    proofGate(
      'different-body-fails-closed',
      differentBodyDecisions.every((decision) => (
        decision.status === 'conflict'
        && decision.code === 'IDEMPOTENCY_KEY_CONFLICT'
        && decision.canReplay === false
        && decision.mutationWorkStarted === false
        && decision.duplicateMutationWork === 0
      )),
      {
        blocked: counts.differentBodyBlocked,
        generatedCases: counts.generatedCases,
        decisionHash: digest(differentBodyDecisions),
      },
    ),
    proofGate(
      'missing-committed-receipt-fails-closed',
      missingReceiptDecisions.every((decision) => (
        decision.status === 'blocked'
        && decision.code === 'COMMITTED_RECEIPT_REQUIRED'
        && decision.canReplay === false
        && decision.mutationWorkStarted === false
        && decision.duplicateMutationWork === 0
      )),
      {
        blocked: counts.missingCommittedReceiptBlocked,
        generatedCases: counts.generatedCases,
        decisionHash: digest(missingReceiptDecisions),
      },
    ),
    proofGate(
      'stale-scope-fails-closed',
      staleScopeDecisions.every((decision) => (
        decision.status === 'blocked'
        && decision.code === 'STALE_REPLAY_SCOPE'
        && decision.canReplay === false
        && decision.mutationWorkStarted === false
        && decision.duplicateMutationWork === 0
      )),
      {
        blocked: counts.staleScopeBlocked,
        generatedCases: counts.generatedCases,
        decisionHash: digest(staleScopeDecisions),
      },
    ),
    proofGate(
      'hash-count-only-public-projection',
      counts.requestBodiesIncluded === 0
        && counts.rawValuesIncluded === 0
        && allDecisions.every(decisionHashesAreShaped),
      {
        publicDecisionCount: allDecisions.length,
        requestBodiesIncluded: counts.requestBodiesIncluded,
        rawValuesIncluded: counts.rawValuesIncluded,
      },
    ),
    proofGate(
      'support-only-release-no-go',
      true,
      {
        finalReleaseStatusHash: fixtureHash('NO-GO'),
        integrationRecommendationHash: fixtureHash('NO-GO'),
      },
    ),
  ];
  const publicEvidence = {
    rppId: 'RPP-0556',
    proofId,
    variant: 3,
    proofClass: 'same-key-same-body-replay-v3',
    evidenceScope: 'local-support-only',
    status: gates.every((gate) => gate.status === 'pass') ? 'support-only-passed' : 'blocked',
    releaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    redaction: {
      mode: 'hash-and-count-only',
      rawValuesIncluded: false,
      requestBodiesIncluded: false,
      idempotencyKeysIncluded: false,
      sourceUrlsIncluded: false,
    },
    sameCanonicalReplay: {
      bodyPairs,
      decisions: sameCanonicalDecisions,
      decisionsHash: digest(sameCanonicalDecisions),
    },
    failClosed: {
      differentBody: {
        status: 'blocked',
        decisions: differentBodyDecisions,
        decisionsHash: digest(differentBodyDecisions),
      },
      missingCommittedReceipt: {
        status: 'blocked',
        decisions: missingReceiptDecisions,
        decisionsHash: digest(missingReceiptDecisions),
      },
      staleScope: {
        status: 'blocked',
        decisions: staleScopeDecisions,
        decisionsHash: digest(staleScopeDecisions),
      },
    },
    counts,
    gates,
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reasonHash: fixtureHash('support-only-no-release-movement'),
    },
    boundary: {
      status: 'blocked',
      verdict: 'PRODUCTION_EVIDENCE_REQUIRED',
      firstRemainingProductionBoundaryHash: fixtureHash('checked-production-idempotency-replay-boundary'),
    },
  };

  return {
    ...publicEvidence,
    evidenceHash: digest(publicEvidence),
  };
}

function proofGate(id, passed, metrics = {}) {
  return {
    id,
    status: passed ? 'pass' : 'fail',
    metrics,
  };
}

function decisionHashesAreShaped(decision) {
  return hashPattern.test(decision.caseHash)
    && hashPattern.test(decision.idempotencyKeyHash)
    && hashPattern.test(decision.canonicalBodyHash)
    && hashPattern.test(decision.scopeHash)
    && (decision.receiptHash === null || hashPattern.test(decision.receiptHash))
    && (decision.committedReceiptHash === null || hashPattern.test(decision.committedReceiptHash))
    && (decision.originalCanonicalBodyHash === null || hashPattern.test(decision.originalCanonicalBodyHash))
    && (decision.committedScopeHash === null || hashPattern.test(decision.committedScopeHash));
}

function generatedCoverageAccepts(proof) {
  const safeDecisions = proof?.sameCanonicalReplay?.decisions || [];
  const bodyPairs = proof?.sameCanonicalReplay?.bodyPairs || [];
  const differentBody = proof?.failClosed?.differentBody?.decisions || [];
  const missingReceipts = proof?.failClosed?.missingCommittedReceipt?.decisions || [];
  const staleScopes = proof?.failClosed?.staleScope?.decisions || [];
  const allDecisions = [
    ...safeDecisions,
    ...differentBody,
    ...missingReceipts,
    ...staleScopes,
  ];

  return Boolean(
    proof?.rppId === 'RPP-0556'
      && proof?.variant === 3
      && proof?.status === 'support-only-passed'
      && proof?.releaseStatus === 'NO-GO'
      && proof?.integrationRecommendation === 'NO-GO'
      && proof?.redaction?.mode === 'hash-and-count-only'
      && proof?.redaction?.rawValuesIncluded === false
      && proof?.releaseMovement?.allowed === false
      && proof?.boundary?.verdict === 'PRODUCTION_EVIDENCE_REQUIRED'
      && proof?.counts?.generatedCases === generatedCases.length
      && proof?.counts?.duplicateMutationWork === 0
      && proof?.counts?.duplicateReceiptRowsWritten === 0
      && proof?.counts?.mutationBoundaryOpenedDuringReplay === 0
      && proof?.counts?.requestBodiesIncluded === 0
      && proof?.counts?.rawValuesIncluded === 0
      && safeDecisions.length === generatedCases.length
      && bodyPairs.length === generatedCases.length
      && bodyPairs.every((pair) => (
        pair.canonicalHashesMatch === true
        && pair.applyBodyHash === pair.replayBodyHash
        && hashPattern.test(pair.applyBodyHash)
      ))
      && safeDecisions.every((decision) => (
        decision.status === 'replayed'
        && decision.code === 'BATCH_ALREADY_COMMITTED'
        && decision.replayed === true
        && decision.canReplay === true
        && decision.mutationWorkStarted === false
        && decision.freshMutationWork === false
        && decision.duplicateMutationWork === 0
        && decision.appliedCount === 0
        && decision.receiptRowsWritten === 0
      ))
      && differentBody.every((decision) => (
        decision.status === 'conflict'
        && decision.code === 'IDEMPOTENCY_KEY_CONFLICT'
        && decision.canReplay === false
        && decision.mutationWorkStarted === false
        && decision.duplicateMutationWork === 0
      ))
      && missingReceipts.every((decision) => (
        decision.status === 'blocked'
        && decision.code === 'COMMITTED_RECEIPT_REQUIRED'
        && decision.canReplay === false
        && decision.mutationWorkStarted === false
        && decision.duplicateMutationWork === 0
      ))
      && staleScopes.every((decision) => (
        decision.status === 'blocked'
        && decision.code === 'STALE_REPLAY_SCOPE'
        && decision.canReplay === false
        && decision.mutationWorkStarted === false
        && decision.duplicateMutationWork === 0
      ))
      && allDecisions.every(decisionHashesAreShaped)
      && proof?.gates?.every((gate) => gate.status === 'pass')
      && hashPattern.test(proof?.evidenceHash || '')
  );
}

function rawValuesFor(generatedCase) {
  return [
    sourceUrl,
    generatedCase.idempotencyKey,
    generatedCase.sessionId,
    generatedCase.resourcePrefix,
    generatedCase.baseValuePrefix,
    generatedCase.localValuePrefix,
    'same-key-different-body-conflict-before-mutation',
  ];
}

function allRawValues() {
  return generatedCases.flatMap(rawValuesFor);
}

function assertHashFields(value, fields) {
  for (const field of fields) {
    assert.match(value[field], hashPattern, `${field} must be a bare sha256 hash`);
  }
}

function assertHashWhenPresent(value, fields) {
  for (const field of fields) {
    if (value[field] !== null && value[field] !== undefined) {
      assert.match(value[field], hashPattern, `${field} must be a bare sha256 hash`);
    }
  }
}

function assertNoRawValues(value, rawValues, label = 'RPP-0556 evidence') {
  const serialized = JSON.stringify(value);
  for (const rawValue of rawValues.filter(Boolean)) {
    assert.equal(
      serialized.includes(rawValue),
      false,
      `${label} leaked raw value ${rawValue}`,
    );
  }
}

function assertPublicDecisionIsHashOnly(decision) {
  assert.equal(decision.requestBodyIncluded, false);
  assert.equal(decision.rawValuesIncluded, false);
  assertHashFields(decision, [
    'caseHash',
    'idempotencyKeyHash',
    'canonicalBodyHash',
    'scopeHash',
  ]);
  assertHashWhenPresent(decision, [
    'receiptHash',
    'committedReceiptHash',
    'originalCanonicalBodyHash',
    'committedScopeHash',
  ]);
}

test('RPP-0556 v3 generated same-key same-canonical-body replay returns the committed receipt without duplicate mutation work', () => {
  for (const generatedCase of generatedCases) {
    const result = runGeneratedCase(generatedCase);
    const decision = result.safeReplay;
    const publicReplayDecision = publicDecision(decision, generatedCase);

    assert.equal(result.applyBodyHash, result.replayBodyHash);
    assert.notEqual(JSON.stringify(result.applyBody), JSON.stringify(result.replayBody));
    assert.equal(decision.status, 'replayed');
    assert.equal(decision.code, 'BATCH_ALREADY_COMMITTED');
    assert.equal(decision.replayed, true);
    assert.equal(decision.canReplay, true);
    assert.equal(decision.exactCommittedReceiptMatch, true);
    assert.equal(decision.freshMutationWork, false);
    assert.equal(decision.mutationWorkStarted, false);
    assert.equal(decision.duplicateMutationWork, 0);
    assert.equal(decision.appliedCount, 0);
    assert.equal(decision.receiptRowsWritten, 0);
    assert.equal(decision.idempotencyKeyHash, result.committedReceipt.idempotencyKeyHash);
    assert.equal(decision.canonicalBodyHash, result.committedReceipt.canonicalBodyHash);
    assert.equal(decision.receiptHash, result.committedReceipt.receiptHash);
    assert.equal(decision.committedReceiptHash, result.committedReceipt.committedReceiptHash);
    assert.equal(result.committedReceipt.mutationWorkCount, generatedCase.mutationCount);
    assertPublicDecisionIsHashOnly(publicReplayDecision);
    assertNoRawValues(publicReplayDecision, rawValuesFor(generatedCase));
  }
});

test('RPP-0556 v3 generated same-key unsafe replay variants fail closed before mutation work', () => {
  for (const generatedCase of generatedCases) {
    const result = runGeneratedCase(generatedCase);
    const differentBody = result.differentBody;
    const missingCommittedReceipt = result.missingCommittedReceipt;
    const staleScope = result.staleScope;

    assert.notEqual(differentBody.canonicalBodyHash, result.committedReceipt.canonicalBodyHash);
    assert.equal(differentBody.status, 'conflict');
    assert.equal(differentBody.code, 'IDEMPOTENCY_KEY_CONFLICT');
    assert.equal(differentBody.reason, 'same-key-different-canonical-body');
    assert.equal(differentBody.canReplay, false);
    assert.equal(differentBody.mutationWorkStarted, false);
    assert.equal(differentBody.freshMutationWork, false);
    assert.equal(differentBody.duplicateMutationWork, 0);
    assert.equal(differentBody.appliedCount, 0);
    assert.equal(differentBody.receiptRowsWritten, 0);
    assert.equal(differentBody.originalCanonicalBodyHash, result.committedReceipt.canonicalBodyHash);

    assert.equal(missingCommittedReceipt.status, 'blocked');
    assert.equal(missingCommittedReceipt.code, 'COMMITTED_RECEIPT_REQUIRED');
    assert.equal(missingCommittedReceipt.reason, 'missing-committed-receipt');
    assert.equal(missingCommittedReceipt.canReplay, false);
    assert.equal(missingCommittedReceipt.mutationWorkStarted, false);
    assert.equal(missingCommittedReceipt.freshMutationWork, false);
    assert.equal(missingCommittedReceipt.duplicateMutationWork, 0);
    assert.equal(missingCommittedReceipt.receiptRowsWritten, 0);

    assert.notEqual(staleScope.scopeHash, result.committedReceipt.scopeHash);
    assert.equal(staleScope.status, 'blocked');
    assert.equal(staleScope.code, 'STALE_REPLAY_SCOPE');
    assert.equal(staleScope.reason, 'stale-scope');
    assert.equal(staleScope.canReplay, false);
    assert.equal(staleScope.mutationWorkStarted, false);
    assert.equal(staleScope.freshMutationWork, false);
    assert.equal(staleScope.duplicateMutationWork, 0);
    assert.equal(staleScope.receiptRowsWritten, 0);
    assert.equal(staleScope.committedScopeHash, result.committedReceipt.scopeHash);

    for (const publicBlockedDecision of [
      publicDecision(differentBody, generatedCase),
      publicDecision(missingCommittedReceipt, generatedCase),
      publicDecision(staleScope, generatedCase),
    ]) {
      assertPublicDecisionIsHashOnly(publicBlockedDecision);
      assertNoRawValues(publicBlockedDecision, rawValuesFor(generatedCase));
    }
  }
});

test('RPP-0556 v3 public generated coverage remains support-only NO-GO and rejects unsafe proof movement', () => {
  const proof = buildGeneratedCoverageProof();

  assert.equal(generatedCoverageAccepts(proof), true);
  assert.equal(proof.status, 'support-only-passed');
  assert.equal(proof.releaseStatus, 'NO-GO');
  assert.equal(proof.integrationRecommendation, 'NO-GO');
  assert.equal(proof.releaseMovement.allowed, false);
  assert.equal(proof.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');
  assert.equal(proof.redaction.mode, 'hash-and-count-only');
  assert.equal(proof.redaction.rawValuesIncluded, false);
  assert.deepEqual(proof.gates.map((gate) => gate.status), [
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
  ]);
  assert.deepEqual(proof.counts, {
    generatedCases: 2,
    replayAttempts: 2,
    replayedCommittedReceipts: 2,
    differentBodyBlocked: 2,
    missingCommittedReceiptBlocked: 2,
    staleScopeBlocked: 2,
    mutationBoundaryOpenedDuringReplay: 0,
    duplicateMutationWork: 0,
    duplicateReceiptRowsWritten: 0,
    requestBodiesIncluded: 0,
    rawValuesIncluded: 0,
  });
  assertHashFields(proof, ['evidenceHash']);
  assertHashFields(proof.sameCanonicalReplay, ['decisionsHash']);
  assertHashFields(proof.failClosed.differentBody, ['decisionsHash']);
  assertHashFields(proof.failClosed.missingCommittedReceipt, ['decisionsHash']);
  assertHashFields(proof.failClosed.staleScope, ['decisionsHash']);
  for (const pair of proof.sameCanonicalReplay.bodyPairs) {
    assertHashFields(pair, ['caseHash', 'applyBodyHash', 'replayBodyHash']);
    assert.equal(pair.applyBodyHash, pair.replayBodyHash);
    assert.equal(pair.canonicalHashesMatch, true);
  }
  for (const decision of [
    ...proof.sameCanonicalReplay.decisions,
    ...proof.failClosed.differentBody.decisions,
    ...proof.failClosed.missingCommittedReceipt.decisions,
    ...proof.failClosed.staleScope.decisions,
  ]) {
    assertPublicDecisionIsHashOnly(decision);
  }
  assertNoRawValues(proof, allRawValues(), 'RPP-0556 public proof');

  const duplicateWork = cloneJson(proof);
  duplicateWork.sameCanonicalReplay.decisions[0].duplicateMutationWork = 1;
  duplicateWork.counts.duplicateMutationWork = 1;
  assert.equal(generatedCoverageAccepts(duplicateWork), false);

  const missingReceiptSpoof = cloneJson(proof);
  missingReceiptSpoof.failClosed.missingCommittedReceipt.decisions[0].status = 'replayed';
  missingReceiptSpoof.failClosed.missingCommittedReceipt.decisions[0].canReplay = true;
  assert.equal(generatedCoverageAccepts(missingReceiptSpoof), false);

  const staleScopeSpoof = cloneJson(proof);
  staleScopeSpoof.failClosed.staleScope.decisions[0].status = 'replayed';
  staleScopeSpoof.failClosed.staleScope.decisions[0].canReplay = true;
  assert.equal(generatedCoverageAccepts(staleScopeSpoof), false);

  const releaseMovementSpoof = cloneJson(proof);
  releaseMovementSpoof.releaseMovement.allowed = true;
  assert.equal(generatedCoverageAccepts(releaseMovementSpoof), false);
});
