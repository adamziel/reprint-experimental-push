import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DRY_RUN_BATCH_SIZING_BENCHMARK_ID,
  planDryRunBatches,
  runDryRunBatchSizingBenchmark,
} from '../scripts/bench/dry-run-batch-sizing.js';
import { digest } from '../src/stable-json.js';

const proofId = 'rpp-0772-dry-run-batch-sizing-v4';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const maxDurationMs = 5_000;
const maxHeapUsedBytes = 128 * 1024 * 1024;
const workload = Object.freeze({
  fileResources: 8,
  wpPosts: 14,
  wpPostmeta: 17,
  wpOptions: 7,
  pluginMetadataResources: 4,
});
const limits = Object.freeze({
  maxBatchResources: 9,
  maxBatchEstimatedBytes: 28 * 1024,
  maxBatchPreconditions: 9,
});
const expectedGateIds = Object.freeze([
  'benchmark-gates-pass',
  'bounded-batch-sizing-gates',
  'complete-dry-run-batch-coverage',
  'dry-run-receipts-do-not-authorize-apply',
  'guarded-writes-reject-stale-storage-state',
  'storage-state-preserved-after-rejected-guarded-writes',
  'deterministic-guarded-write-evidence',
  'hash-count-only-evidence',
  'support-only-release-no-go',
]);
const hexSha256Pattern = /^[a-f0-9]{64}$/;
const sha256Pattern = /^sha256:[a-f0-9]{64}$/;

test('RPP-0772 variant 4 rejects stale storage state for every guarded write', {
  concurrency: false,
}, () => {
  const proof = buildVariant4Proof();

  assert.equal(proof.rppId, 'RPP-0772');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 4);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.builtOn.rppId, 'RPP-0712');
  assert.equal(proof.builtOn.previousVariantRppId, 'RPP-0752');
  assert.equal(proof.builtOn.benchmark, DRY_RUN_BATCH_SIZING_BENCHMARK_ID);
  assert.equal(proof.builtOn.ok, true);
  assert.match(proof.builtOn.evidenceHash, hexSha256Pattern);

  assert.equal(proof.runtime.generatedAt, fixedNow.toISOString());
  assert.equal(proof.runtime.durationMs >= 0, true);
  assert.equal(proof.runtime.durationMs <= proof.runtime.budgets.maxDurationMs, true);
  assert.equal(proof.resources.process.heapUsedBytes <= proof.runtime.budgets.maxHeapUsedBytes, true);
  assert.equal(proof.resources.dryRun.stage, 'push_plan_dry_run');
  assert.equal(proof.resources.dryRun.readOnly, true);
  assert.equal(proof.resources.dryRun.totalResources, 50);
  assert.equal(proof.resources.dryRun.totalPreconditions, 50);
  assert.equal(proof.resources.dryRun.batches, 6);
  assert.equal(proof.resources.dryRun.finalReceiptApplyAuthorization, false);
  assert.deepEqual([...new Set(proof.benchmark.gates.map((gate) => gate.status))], ['pass']);

  assert.equal(proof.batchSizing.resourceCount, 50);
  assert.equal(proof.batchSizing.totalPreconditions, 50);
  assert.equal(proof.batchSizing.batchWindowCount, 6);
  assert.equal(proof.batchSizing.expectedBatchWindowCount, 6);
  assert.deepEqual(proof.batchSizing.batchStarts, [0, 9, 18, 27, 36, 45]);
  assert.deepEqual(proof.batchSizing.batchEnds, [8, 17, 26, 35, 44, 49]);
  assert.deepEqual(proof.batchSizing.batchSizes, [9, 9, 9, 9, 9, 5]);
  assert.equal(proof.batchSizing.largestBatch.resourceCount <= limits.maxBatchResources, true);
  assert.equal(proof.batchSizing.largestBatch.estimatedBytes <= limits.maxBatchEstimatedBytes, true);
  assert.equal(proof.batchSizing.largestBatch.preconditionCount <= limits.maxBatchPreconditions, true);
  assert.equal(proof.batchSizing.batchWindows.every((window) => window.resourceCount <= limits.maxBatchResources), true);
  assert.equal(proof.batchSizing.batchWindows.every((window) => window.estimatedBytes <= limits.maxBatchEstimatedBytes), true);
  assert.equal(proof.batchSizing.batchWindows.every((window) => window.preconditionCount <= limits.maxBatchPreconditions), true);
  assert.match(proof.batchSizing.batchSizingHash, sha256Pattern);
  assert.match(proof.batchSizing.outputHash, sha256Pattern);

  assert.equal(proof.storageGuard.observedAt, 'before-mutation-capable-work');
  assert.equal(proof.storageGuard.guardedWriteCount, proof.batchSizing.batchWindowCount);
  assert.equal(proof.storageGuard.rejectedStaleStorageCount, proof.batchSizing.batchWindowCount);
  assert.equal(proof.storageGuard.mutationAppliedCount, 0);
  assert.equal(proof.storageGuard.storageStateUpdatedCount, 0);
  assert.equal(proof.storageGuard.dryRunReceiptAuthorizesMutationCount, 0);
  assert.equal(proof.storageGuard.allRejectedStaleStorage, true);
  assert.equal(proof.storageGuard.allPreservedStorageState, true);
  assert.match(proof.storageGuard.decisionSetHash, sha256Pattern);
  assert.equal(proof.storageGuard.attempts.length, proof.batchSizing.batchWindowCount);

  for (const [index, attempt] of proof.storageGuard.attempts.entries()) {
    assert.equal(attempt.attemptIndex, index);
    assert.equal(attempt.targetBatchIndex, index);
    assert.equal(attempt.targetBatchWindowHash, proof.batchSizing.batchWindows[index].batchWindowHash);
    assert.equal(attempt.liveStorageMatchesDryRunPrecondition, false);
    assert.equal(attempt.outcome, 'stale-at-write');
    assert.equal(attempt.guardedWriteAttempted, true);
    assert.equal(attempt.guardedWriteRejected, true);
    assert.equal(attempt.rejectedStaleStorageState, true);
    assert.equal(attempt.mutationCapableWorkStarted, false);
    assert.equal(attempt.mutationApplied, false);
    assert.equal(attempt.storageStateUpdated, false);
    assert.equal(attempt.preDecisionStorageStateHash, attempt.postDecisionStorageStateHash);
    assert.equal(attempt.dryRunReceiptAuthorizesMutation, false);
    assert.deepEqual(attempt.guardOrder, [
      'read-live-storage-state',
      'compare-live-storage-hash',
      'reject-stale-state',
      'skip-mutation-capable-work',
    ]);
    assert.ok(attempt.blockedBy.includes('stale-storage-state'));
    assert.match(attempt.decisionHash, sha256Pattern);
  }

  assert.deepEqual(proof.correctness.gateIds, expectedGateIds);
  assert.deepEqual(proof.correctness.recomputedGateVector.map((gate) => gate.status), [
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
  ]);
  assert.equal(proof.correctness.correctnessGatesRecordedBeforeOutput, true);
  assert.equal(proof.correctness.correctnessGatesHoldBeforeOutput, true);
  assert.equal(proof.correctness.storageOutputEmittedAfterGates, true);
  assert.equal(proof.correctness.hashCountOnlyOutput, true);
  assert.deepEqual(proof.gates.map((gate) => gate.status), [
    'pass',
    'pass',
    'pass',
    'pass',
  ]);

  assert.equal(proof.unsafe.acceptedStaleGuard.updated, false);
  assert.equal(proof.unsafe.acceptedStaleGuard.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.acceptedStaleGuard.blockedBy.includes('guarded-writes-reject-stale-storage-state'));
  assert.equal(proof.unsafe.mutatedStorageState.updated, false);
  assert.equal(proof.unsafe.mutatedStorageState.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.mutatedStorageState.blockedBy.includes('storage-state-preserved-after-rejected-guarded-writes'));
  assert.equal(proof.unsafe.missingGuardedWrite.updated, false);
  assert.equal(proof.unsafe.missingGuardedWrite.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.missingGuardedWrite.blockedBy.includes('guarded-writes-reject-stale-storage-state'));
  assert.equal(proof.unsafe.prematurePassStatus.updated, false);
  assert.equal(proof.unsafe.prematurePassStatus.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.prematurePassStatus.blockedBy.includes('correctness-gates-not-recorded'));

  assert.equal(proof.release.supportOnly, true);
  assert.equal(proof.release.productionBacked, false);
  assert.equal(proof.release.productionThroughput, 'not-claimed');
  assert.equal(proof.release.speedClaimsAllowed, false);
  assert.equal(proof.release.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.release.integrationRecommendation, 'NO-GO');
  assert.equal(proof.redaction.rawValueEvidenceLeaks, 0);
  assert.match(proof.evidenceHash, hexSha256Pattern);
  assertHashCountOnlyStorageEvidence(proof);
});

test('RPP-0772 variant 4 fails closed for stale acceptance, mutation, missing guard, and premature evidence', {
  concurrency: false,
}, () => {
  const { evidence, repeatedEvidence } = buildRecordedEvidencePair();
  const safeDecision = resolveDryRunGuardedWriteProof(evidence, { repeatedEvidence });
  const unsafeDecisions = unsafeGuardedWriteEvidenceDecisions(evidence, repeatedEvidence);

  assert.equal(safeDecision.updated, true);
  assert.equal(safeDecision.outputEmitted, true);
  assert.deepEqual(safeDecision.blockedBy, []);
  assert.deepEqual(safeDecision.recomputedGates.map((gate) => gate.status), [
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
  ]);

  assert.equal(unsafeDecisions.acceptedStaleGuard.updated, false);
  assert.ok(unsafeDecisions.acceptedStaleGuard.blockedBy.includes('guarded-writes-reject-stale-storage-state'));
  assert.equal(unsafeDecisions.mutatedStorageState.updated, false);
  assert.ok(unsafeDecisions.mutatedStorageState.blockedBy.includes('storage-state-preserved-after-rejected-guarded-writes'));
  assert.equal(unsafeDecisions.missingGuardedWrite.updated, false);
  assert.ok(unsafeDecisions.missingGuardedWrite.blockedBy.includes('guarded-writes-reject-stale-storage-state'));
  assert.equal(unsafeDecisions.prematurePassStatus.updated, false);
  assert.ok(unsafeDecisions.prematurePassStatus.blockedBy.includes('correctness-gates-not-recorded'));

  for (const decision of Object.values(unsafeDecisions)) {
    assert.equal(decision.output, null);
    assert.equal(decision.outputEmitted, false);
    assert.equal(decision.attemptedPassBlocked, true);
    assert.match(decision.decisionHash, hexSha256Pattern);
    assertHashCountOnlyStorageEvidence(decision);
  }
});

function buildVariant4Proof() {
  const { benchmark, evidence, repeatedEvidence } = buildRecordedEvidencePair();
  const safeDecision = resolveDryRunGuardedWriteProof(evidence, { repeatedEvidence });
  const unsafe = projectUnsafeDecisions(unsafeGuardedWriteEvidenceDecisions(evidence, repeatedEvidence));
  const correctnessGatesRecordedBeforeOutput = objectKeyBefore(
    evidence,
    'correctnessGates',
    'storageGuard',
  );
  const benchmarkGatesPass = benchmark.ok && benchmark.gates.every((gate) => gate.status === 'pass');
  const supportOnlyRelease = supportOnlyReleasePosture();
  const proofGates = [
    proofGate('benchmark-storage-performance-gates-pass', benchmarkGatesPass, {
      benchmarkGateStatuses: benchmark.gates.map((gate) => gate.status),
      durationMs: benchmark.runtime.durationMs,
      heapUsedBytes: benchmark.resources.process.heapUsedBytes,
    }),
    proofGate('bounded-batch-sizing-before-guarded-write-output', safeDecision.updated
      && safeDecision.outputEmitted
      && safeDecision.recomputedGates
        .filter((gate) => [
          'bounded-batch-sizing-gates',
          'complete-dry-run-batch-coverage',
        ].includes(gate.id))
        .every((gate) => gate.status === 'pass'), {
      outputEmitted: safeDecision.outputEmitted,
      blockedBy: safeDecision.blockedBy,
    }),
    proofGate('all-guarded-writes-reject-stale-storage', evidence.storageGuard.allRejectedStaleStorage
      && evidence.storageGuard.allPreservedStorageState
      && evidence.storageGuard.guardedWriteCount === evidence.batchSizing.batchWindowCount
      && evidence.storageGuard.rejectedStaleStorageCount === evidence.batchSizing.batchWindowCount
      && evidence.storageGuard.mutationAppliedCount === 0
      && evidence.storageGuard.storageStateUpdatedCount === 0, {
      guardedWriteCount: evidence.storageGuard.guardedWriteCount,
      rejectedStaleStorageCount: evidence.storageGuard.rejectedStaleStorageCount,
      mutationAppliedCount: evidence.storageGuard.mutationAppliedCount,
      storageStateUpdatedCount: evidence.storageGuard.storageStateUpdatedCount,
    }),
    proofGate('support-only-release-no-go', supportOnlyRelease.supportOnly
      && supportOnlyRelease.productionBacked === false
      && supportOnlyRelease.finalReleaseStatus === 'NO-GO'
      && supportOnlyRelease.integrationRecommendation === 'NO-GO', {
      finalReleaseStatus: supportOnlyRelease.finalReleaseStatus,
      integrationRecommendation: supportOnlyRelease.integrationRecommendation,
    }),
  ];
  const publicProof = {
    rppId: 'RPP-0772',
    proofId,
    variant: 4,
    status: proofGates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed',
    builtOn: {
      rppId: 'RPP-0712',
      previousVariantRppId: 'RPP-0752',
      benchmark: benchmark.benchmark,
      ok: benchmark.ok,
      mode: benchmark.mode,
      evidenceHash: digest(publicBenchmarkProjection(benchmark)),
    },
    runtime: {
      generatedAt: benchmark.runtime.generatedAt,
      durationMs: benchmark.runtime.durationMs,
      budgets: benchmark.runtime.budgets,
      liveRemote: benchmark.liveRemote.status,
    },
    resources: {
      dryRun: benchmark.resources.dryRun,
      process: benchmark.resources.process,
    },
    benchmark: publicBenchmarkProjection(benchmark),
    batchSizing: {
      ...evidence.batchSizing,
      outputHash: safeDecision.outputHash,
    },
    storageGuard: evidence.storageGuard,
    correctness: {
      gateIds: evidence.correctnessGates.map((gate) => gate.id),
      recomputedGateVector: safeDecision.recomputedGates,
      correctnessGatesRecordedBeforeOutput,
      correctnessGatesHoldBeforeOutput: safeDecision.correctnessGatesHold,
      hashCountOnlyOutput: safeDecision.hashCountOnlyOutput,
      storageOutputEmittedAfterGates: safeDecision.outputEmitted,
    },
    unsafe,
    gates: proofGates,
    release: supportOnlyRelease,
    redaction: {
      mode: 'hash-count-only-guarded-stale-write-regression',
      rawValueEvidenceLeaks: dryRunStorageEvidenceHasNoRawValues(evidence) ? 0 : 1,
      publicEvidenceHash: digest(publicStorageEvidenceProjection(evidence)),
      repeatedEvidenceHash: digest(publicStorageEvidenceProjection(repeatedEvidence)),
      laneDecisionHash: safeDecision.decisionHash,
    },
  };

  return {
    ...publicProof,
    evidenceHash: digest(publicProof),
  };
}

function buildRecordedEvidencePair() {
  const benchmark = runDryRunBatchSizingBenchmark(benchmarkOptions());
  const repeatedBenchmark = runDryRunBatchSizingBenchmark(benchmarkOptions());
  const evidence = buildGuardedWriteEvidence({ benchmark });
  const repeatedEvidence = buildGuardedWriteEvidence({ benchmark: repeatedBenchmark });

  recordCorrectnessGates(evidence, repeatedEvidence);
  recordCorrectnessGates(repeatedEvidence, evidence);
  return { benchmark, evidence, repeatedEvidence };
}

function benchmarkOptions() {
  return {
    profile: 'unit',
    now: fixedNow,
    ...workload,
    ...limits,
    maxDurationMs,
    maxHeapUsedBytes,
  };
}

function buildGuardedWriteEvidence({ benchmark }) {
  const batchSizing = collectDryRunBatchSizingEvidence(buildDryRunFixtureItems(), limits);
  return {
    schemaVersion: 1,
    rppId: 'RPP-0772',
    proofId,
    variant: 4,
    status: 'pending',
    builtOn: {
      rppId: 'RPP-0712',
      previousVariantRppId: 'RPP-0752',
      benchmark: benchmark.benchmark,
      evidenceHash: digest(publicBenchmarkProjection(benchmark)),
    },
    correctnessGates: [],
    batchSizing,
    storageGuard: staleGuardedWriteSetEvidence({
      batchSizing,
      projection: benchmark.resources.storageGuardProjection,
    }),
    benchmark: publicBenchmarkProjection(benchmark),
    runtime: {
      generatedAt: benchmark.runtime.generatedAt,
      durationMs: benchmark.runtime.durationMs,
      budgets: benchmark.runtime.budgets,
    },
    resources: {
      dryRun: benchmark.resources.dryRun,
      process: benchmark.resources.process,
    },
    release: supportOnlyReleasePosture(),
  };
}

function recordCorrectnessGates(evidence, repeatedEvidence) {
  const gates = recomputeDryRunGuardedWriteGates(evidence, repeatedEvidence);
  evidence.correctnessGates = gates.map((gate) => ({
    id: gate.id,
    status: gate.status === 'pass' ? 'passed' : 'failed',
    evidenceHash: digest(gate.metrics),
  }));
  evidence.status = gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed';
  return evidence;
}

function collectDryRunBatchSizingEvidence(items, batchLimits) {
  const batches = planDryRunBatches(items, batchLimits);
  const expectedResourceKeyHashes = items.map((item) => item.resourceKeyHash);
  const batchWindows = batches.map(batchWindowSummary);
  const observedResourceKeyHashes = batchWindows.flatMap((window) => window.resourceKeyHashes);
  const largestBatch = batchWindows.reduce(
    (largest, window) => ({
      resourceCount: Math.max(largest.resourceCount, window.resourceCount),
      estimatedBytes: Math.max(largest.estimatedBytes, window.estimatedBytes),
      preconditionCount: Math.max(largest.preconditionCount, window.preconditionCount),
    }),
    { resourceCount: 0, estimatedBytes: 0, preconditionCount: 0 },
  );
  const collectionCore = {
    planHash: sha256({
      proofId,
      resourceKeyHashes: expectedResourceKeyHashes,
      limits: batchLimits,
    }),
    resourceCount: expectedResourceKeyHashes.length,
    totalPreconditions: items.reduce((sum, item) => sum + item.preconditionCount, 0),
    batchSize: batchLimits.maxBatchResources,
    limits: batchLimits,
    batchWindowCount: batchWindows.length,
    expectedBatchWindowCount: Math.ceil(expectedResourceKeyHashes.length / batchLimits.maxBatchResources),
    batchStarts: batchWindows.map((window) => window.firstSequence),
    batchEnds: batchWindows.map((window) => window.lastSequence),
    batchSizes: batchWindows.map((window) => window.resourceCount),
    largestBatch,
    totalWindowResources: batchWindows.reduce((sum, window) => sum + window.resourceCount, 0),
    totalWindowPreconditions: batchWindows.reduce((sum, window) => sum + window.preconditionCount, 0),
    totalWindowEstimatedBytes: batchWindows.reduce((sum, window) => sum + window.estimatedBytes, 0),
    uniqueResourceKeyHashes: new Set(observedResourceKeyHashes).size,
    expectedCoverageHash: sha256(expectedResourceKeyHashes),
    observedCoverageHash: sha256(observedResourceKeyHashes),
    dryRunOnly: {
      readOnly: true,
      mutates: false,
      authority: 'planning-evidence-only',
      applyBoundary: 'guarded-write-must-revalidate-live-storage-hash',
    },
    batchWindows,
  };

  return {
    ...collectionCore,
    batchSizingHash: sha256(collectionCore),
  };
}

function batchWindowSummary(batch, index) {
  const resourceKeyHashes = batch.items.map((item) => item.resourceKeyHash);
  const core = {
    batchIndex: index,
    batchIdHash: sha256(batch.batchId),
    firstSequence: batch.firstSequence,
    lastSequence: batch.lastSequence,
    resourceCount: batch.resourceCount,
    estimatedBytes: batch.estimatedBytes,
    preconditionCount: batch.preconditionCount,
    resourceKeyHashes,
    itemHashes: batch.itemHashes,
    receiptHash: batch.receipt.receiptHash,
    receiptApplyAuthorization: batch.receipt.applyAuthorization,
    receiptNotLock: batch.receipt.notLock,
  };

  return {
    ...core,
    batchWindowHash: sha256(core),
  };
}

function staleGuardedWriteSetEvidence({ batchSizing, projection }) {
  const attempts = batchSizing.batchWindows.map((window) => {
    const dryRunExpectedHash = sha256({
      proofId,
      batchWindowHash: window.batchWindowHash,
      sourceExpectedHash: projection.dryRunExpectedHash,
      phase: 'dry-run-precondition',
    });
    const observedLiveStorageHash = sha256({
      proofId,
      batchWindowHash: window.batchWindowHash,
      sourceObservedLiveHash: projection.observedLiveHash,
      phase: 'apply-time-live-storage-drift',
    });
    return resolveGuardedWriteAttempt({
      attemptIndex: window.batchIndex,
      observedAt: 'before-mutation-capable-work',
      guardOrder: [
        'read-live-storage-state',
        'compare-live-storage-hash',
        'reject-stale-state',
        'skip-mutation-capable-work',
      ],
      targetBatchIndex: window.batchIndex,
      targetBatchWindowHash: window.batchWindowHash,
      targetResourceKeyHash: window.resourceKeyHashes[0],
      targetItemHash: window.itemHashes[0],
      dryRunReceiptHash: window.receiptHash,
      dryRunExpectedHash,
      observedLiveStorageHash,
      plannedStorageHash: sha256({
        proofId,
        batchWindowHash: window.batchWindowHash,
        phase: 'support-only-planned-storage-state',
      }),
      dryRunReceiptAuthorizesMutation: false,
      preDecisionStorageStateHash: observedLiveStorageHash,
    });
  });
  const core = storageGuardCore({
    observedAt: 'before-mutation-capable-work',
    guardedWriteCount: attempts.length,
    rejectedStaleStorageCount: attempts.filter((attempt) => attempt.rejectedStaleStorageState).length,
    mutationAppliedCount: attempts.filter((attempt) => attempt.mutationApplied).length,
    storageStateUpdatedCount: attempts.filter((attempt) => attempt.storageStateUpdated).length,
    dryRunReceiptAuthorizesMutationCount: attempts
      .filter((attempt) => attempt.dryRunReceiptAuthorizesMutation).length,
    allRejectedStaleStorage: attempts.every((attempt) => attempt.rejectedStaleStorageState),
    allPreservedStorageState: attempts.every((attempt) =>
      attempt.storageStateUpdated === false
        && attempt.mutationApplied === false
        && attempt.preDecisionStorageStateHash === attempt.postDecisionStorageStateHash),
    attemptDecisionHashes: attempts.map((attempt) => attempt.decisionHash),
    attempts,
  });

  return {
    ...core,
    decisionSetHash: sha256(core),
  };
}

function resolveGuardedWriteAttempt(attempt) {
  const liveStorageMatchesDryRunPrecondition = attempt.observedLiveStorageHash === attempt.dryRunExpectedHash;
  const rejectedStaleStorageState = !liveStorageMatchesDryRunPrecondition;
  const guardedWriteRejected = rejectedStaleStorageState;
  const core = {
    ...attempt,
    liveStorageMatchesDryRunPrecondition,
    outcome: guardedWriteRejected ? 'stale-at-write' : 'ready-for-apply-validation',
    guardedWriteAttempted: true,
    guardedWriteRejected,
    rejectedStaleStorageState,
    mutationCapableWorkStarted: !guardedWriteRejected,
    mutationApplied: false,
    storageStateUpdated: false,
    postDecisionStorageStateHash: attempt.preDecisionStorageStateHash,
    blockedBy: rejectedStaleStorageState ? ['stale-storage-state'] : [],
    reason: rejectedStaleStorageState
      ? 'live-storage-hash-differs-from-dry-run-precondition'
      : 'live-storage-hash-matches-dry-run-precondition',
  };

  return {
    ...core,
    decisionHash: sha256(core),
  };
}

function resolveDryRunGuardedWriteProof(evidence, { repeatedEvidence }) {
  const recomputedGates = recomputeDryRunGuardedWriteGates(evidence, repeatedEvidence);
  const failedGateIds = recomputedGates
    .filter((gate) => gate.status !== 'pass')
    .map((gate) => gate.id);
  const recordedGateIds = Array.isArray(evidence.correctnessGates)
    ? evidence.correctnessGates.map((gate) => gate.id)
    : [];
  const recordedGateIdsComplete = sameArray(recordedGateIds, expectedGateIds);
  const recordedGateStatusesHold = recordedGateIdsComplete
    && evidence.correctnessGates.every((gate) => gate.status === 'passed');
  const blockedBy = unique([
    ...failedGateIds,
    ...(!recordedGateIdsComplete ? ['correctness-gates-not-recorded'] : []),
    ...(!recordedGateStatusesHold ? ['correctness-gates-not-passed'] : []),
  ]);
  const correctnessGatesHold = blockedBy.length === 0;
  const output = correctnessGatesHold
    ? {
        proofId,
        gateVectorHash: sha256(recomputedGates),
        batchSizingHash: evidence.batchSizing.batchSizingHash,
        batchWindowHashSetHash: sha256(evidence.batchSizing.batchWindows.map((window) => window.batchWindowHash)),
        resourceCount: evidence.batchSizing.resourceCount,
        preconditionCount: evidence.batchSizing.totalPreconditions,
        batchWindowCount: evidence.batchSizing.batchWindowCount,
        largestBatch: evidence.batchSizing.largestBatch,
        guardedWriteCount: evidence.storageGuard.guardedWriteCount,
        rejectedStaleStorageCount: evidence.storageGuard.rejectedStaleStorageCount,
        mutationAppliedCount: evidence.storageGuard.mutationAppliedCount,
        storageStateUpdatedCount: evidence.storageGuard.storageStateUpdatedCount,
        storageGuardDecisionSetHash: evidence.storageGuard.decisionSetHash,
        releaseStatus: evidence.release.finalReleaseStatus,
        integrationRecommendation: evidence.release.integrationRecommendation,
      }
    : null;
  const publicDecision = {
    updated: correctnessGatesHold,
    outputEmitted: Boolean(output),
    attemptedPassBlocked: evidence.status === 'passed' && !correctnessGatesHold,
    correctnessGatesHold,
    recordedGateIdsComplete,
    recordedGateStatusesHold,
    hashCountOnlyOutput: output ? dryRunStorageEvidenceHasNoRawValues(output) : false,
    blockedBy,
    recomputedGates,
    outputHash: output ? sha256(output) : null,
  };

  return {
    ...publicDecision,
    output,
    decisionHash: digest(publicDecision),
  };
}

function recomputeDryRunGuardedWriteGates(evidence, repeatedEvidence) {
  const batchSizing = evidence.batchSizing || {};
  const windows = Array.isArray(batchSizing.batchWindows) ? batchSizing.batchWindows : [];
  const bounded = boundedBatchSizingMetrics(batchSizing, windows);
  const coverage = batchCoverageMetrics(batchSizing, windows);
  const receiptAuthority = dryRunReceiptAuthorityMetrics(batchSizing, evidence.storageGuard || {});
  const guardedWrites = guardedWriteRejectionMetrics(batchSizing, evidence.storageGuard || {});
  const storagePreservation = storagePreservationMetrics(evidence.storageGuard || {});
  const benchmark = evidence.benchmark || {};
  const release = evidence.release || {};
  const deterministicEvidence = Boolean(repeatedEvidence)
    && digest(publicStorageEvidenceProjection(evidence)) === digest(publicStorageEvidenceProjection(repeatedEvidence));
  const benchmarkGatesPass = benchmark.ok === true
    && Array.isArray(benchmark.gates)
    && benchmark.gates.every((gate) => gate.status === 'pass');

  return [
    proofGate('benchmark-gates-pass', benchmarkGatesPass, {
      benchmark: benchmark.benchmark,
      gateStatuses: Array.isArray(benchmark.gates) ? benchmark.gates.map((gate) => gate.status) : [],
    }),
    proofGate('bounded-batch-sizing-gates', bounded.pass, bounded),
    proofGate('complete-dry-run-batch-coverage', coverage.complete, coverage),
    proofGate('dry-run-receipts-do-not-authorize-apply', receiptAuthority.pass, receiptAuthority),
    proofGate('guarded-writes-reject-stale-storage-state', guardedWrites.pass, guardedWrites),
    proofGate('storage-state-preserved-after-rejected-guarded-writes', storagePreservation.pass, storagePreservation),
    proofGate('deterministic-guarded-write-evidence', deterministicEvidence, {
      firstEvidenceHash: digest(publicStorageEvidenceProjection(evidence)),
      repeatedEvidenceHash: repeatedEvidence ? digest(publicStorageEvidenceProjection(repeatedEvidence)) : '',
    }),
    proofGate('hash-count-only-evidence', dryRunStorageEvidenceHasNoRawValues({
      batchSizing,
      storageGuard: evidence.storageGuard || {},
      outputProjection: evidence.outputProjection || null,
    }), {
      rawValueEvidenceLeaks: dryRunStorageEvidenceHasNoRawValues({
        batchSizing,
        storageGuard: evidence.storageGuard || {},
      }) ? 0 : 1,
    }),
    proofGate('support-only-release-no-go', release.supportOnly === true
      && release.productionBacked === false
      && release.finalReleaseStatus === 'NO-GO'
      && release.integrationRecommendation === 'NO-GO', {
      supportOnly: release.supportOnly,
      productionBacked: release.productionBacked,
      finalReleaseStatus: release.finalReleaseStatus,
      integrationRecommendation: release.integrationRecommendation,
    }),
  ];
}

function boundedBatchSizingMetrics(batchSizing, windows) {
  const limitViolations = [];
  const limitsRecord = batchSizing.limits || {};
  windows.forEach((window) => {
    if (window.resourceCount > limitsRecord.maxBatchResources) {
      limitViolations.push(`${window.batchIndex}:resources`);
    }
    if (window.estimatedBytes > limitsRecord.maxBatchEstimatedBytes) {
      limitViolations.push(`${window.batchIndex}:estimatedBytes`);
    }
    if (window.preconditionCount > limitsRecord.maxBatchPreconditions) {
      limitViolations.push(`${window.batchIndex}:preconditions`);
    }
  });

  const largestBatch = batchSizing.largestBatch || {};
  const largestBatchWithinLimits = largestBatch.resourceCount <= limitsRecord.maxBatchResources
    && largestBatch.estimatedBytes <= limitsRecord.maxBatchEstimatedBytes
    && largestBatch.preconditionCount <= limitsRecord.maxBatchPreconditions;
  const expectedBatchWindowCount = Math.ceil(batchSizing.resourceCount / batchSizing.batchSize);
  const deterministicBatchSize = Number.isInteger(batchSizing.batchSize)
    && batchSizing.batchSize === limitsRecord.maxBatchResources
    && batchSizing.expectedBatchWindowCount === expectedBatchWindowCount
    && windows.length === expectedBatchWindowCount
    && windows.every((window, index) => {
      const expectedSize = index === windows.length - 1
        ? batchSizing.resourceCount - (batchSizing.batchSize * index)
        : batchSizing.batchSize;
      return window.resourceCount === expectedSize
        && window.resourceCount > 0
        && window.preconditionCount <= limitsRecord.maxBatchPreconditions
        && window.estimatedBytes <= limitsRecord.maxBatchEstimatedBytes;
    });

  return {
    pass: limitViolations.length === 0 && largestBatchWithinLimits && deterministicBatchSize,
    limitViolations,
    largestBatchWithinLimits,
    deterministicBatchSize,
    batchSize: batchSizing.batchSize,
    expectedBatchWindowCount,
    batchWindowCount: windows.length,
    batchSizes: windows.map((window) => window.resourceCount),
    largestBatch,
    limits: limitsRecord,
  };
}

function batchCoverageMetrics(batchSizing, windows) {
  const observedResourceKeyHashes = windows.flatMap((window) => window.resourceKeyHashes || []);
  const uniqueResourceKeyHashes = new Set(observedResourceKeyHashes).size;
  const recomputedObservedCoverageHash = sha256(observedResourceKeyHashes);
  const hashMismatches = windows
    .filter((window) => window.batchWindowHash !== sha256(batchWindowCore(window)))
    .map((window) => window.batchIndex);
  const batchSizingHashMatches = batchSizing.batchSizingHash === sha256(batchSizingCore(batchSizing));
  const complete = windows.length === batchSizing.batchWindowCount
    && observedResourceKeyHashes.length === batchSizing.resourceCount
    && uniqueResourceKeyHashes === batchSizing.resourceCount
    && batchSizing.uniqueResourceKeyHashes === uniqueResourceKeyHashes
    && batchSizing.totalWindowResources === observedResourceKeyHashes.length
    && batchSizing.totalWindowPreconditions === batchSizing.totalPreconditions
    && batchSizing.observedCoverageHash === recomputedObservedCoverageHash
    && batchSizing.observedCoverageHash === batchSizing.expectedCoverageHash
    && hashMismatches.length === 0
    && batchSizingHashMatches;

  return {
    complete,
    batchWindowCount: windows.length,
    recordedBatchWindowCount: batchSizing.batchWindowCount,
    observedResourceKeyHashes: observedResourceKeyHashes.length,
    uniqueResourceKeyHashes,
    totalWindowResources: batchSizing.totalWindowResources,
    resourceCount: batchSizing.resourceCount,
    totalWindowPreconditions: batchSizing.totalWindowPreconditions,
    totalPreconditions: batchSizing.totalPreconditions,
    recomputedObservedCoverageHash,
    recordedObservedCoverageHash: batchSizing.observedCoverageHash,
    expectedCoverageHash: batchSizing.expectedCoverageHash,
    mismatchedBatchIndexes: hashMismatches,
    batchSizingHashMatches,
  };
}

function dryRunReceiptAuthorityMetrics(batchSizing, storageGuard) {
  const windows = Array.isArray(batchSizing.batchWindows) ? batchSizing.batchWindows : [];
  const attempts = Array.isArray(storageGuard.attempts) ? storageGuard.attempts : [];
  const receiptAuthorityFailures = windows.filter((window) =>
    window.receiptApplyAuthorization !== false || window.receiptNotLock !== true);
  const guardAuthorityFailures = attempts
    .filter((attempt) => attempt.dryRunReceiptAuthorizesMutation !== false)
    .map((attempt) => attempt.attemptIndex);
  return {
    pass: receiptAuthorityFailures.length === 0
      && guardAuthorityFailures.length === 0
      && batchSizing.dryRunOnly?.readOnly === true
      && batchSizing.dryRunOnly?.mutates === false
      && storageGuard.dryRunReceiptAuthorizesMutationCount === 0,
    receiptAuthorityFailures: receiptAuthorityFailures.map((window) => window.batchIndex),
    guardAuthorityFailures,
    readOnly: batchSizing.dryRunOnly?.readOnly,
    mutates: batchSizing.dryRunOnly?.mutates,
    dryRunReceiptAuthorizesMutationCount: storageGuard.dryRunReceiptAuthorizesMutationCount,
  };
}

function guardedWriteRejectionMetrics(batchSizing, storageGuard) {
  const windows = Array.isArray(batchSizing.batchWindows) ? batchSizing.batchWindows : [];
  const attempts = Array.isArray(storageGuard.attempts) ? storageGuard.attempts : [];
  const expectedWindowHashes = windows.map((window) => window.batchWindowHash);
  const attemptWindowHashes = attempts.map((attempt) => attempt.targetBatchWindowHash);
  const rejectedIndexes = attempts
    .filter((attempt) => !(
      attempt.outcome === 'stale-at-write'
        && attempt.liveStorageMatchesDryRunPrecondition === false
        && attempt.guardedWriteAttempted === true
        && attempt.guardedWriteRejected === true
        && attempt.rejectedStaleStorageState === true
        && attempt.mutationCapableWorkStarted === false
        && attempt.dryRunReceiptAuthorizesMutation === false
        && attempt.observedAt === 'before-mutation-capable-work'
    ))
    .map((attempt) => attempt.attemptIndex);
  const decisionHashMismatches = attempts
    .filter((attempt) => attempt.decisionHash !== sha256(guardedWriteAttemptCore(attempt)))
    .map((attempt) => attempt.attemptIndex);
  const summaryCountsMatch = storageGuard.guardedWriteCount === attempts.length
    && storageGuard.rejectedStaleStorageCount === attempts.filter((attempt) => attempt.rejectedStaleStorageState).length
    && storageGuard.mutationAppliedCount === attempts.filter((attempt) => attempt.mutationApplied).length
    && storageGuard.storageStateUpdatedCount === attempts.filter((attempt) => attempt.storageStateUpdated).length
    && storageGuard.dryRunReceiptAuthorizesMutationCount === attempts
      .filter((attempt) => attempt.dryRunReceiptAuthorizesMutation).length
    && sameArray(storageGuard.attemptDecisionHashes || [], attempts.map((attempt) => attempt.decisionHash));
  const decisionSetHashMatches = storageGuard.decisionSetHash === sha256(storageGuardCore(storageGuard));

  return {
    pass: attempts.length > 0
      && attempts.length === windows.length
      && storageGuard.guardedWriteCount === windows.length
      && storageGuard.rejectedStaleStorageCount === windows.length
      && storageGuard.allRejectedStaleStorage === true
      && sameArray(attemptWindowHashes, expectedWindowHashes)
      && rejectedIndexes.length === 0
      && decisionHashMismatches.length === 0
      && summaryCountsMatch
      && decisionSetHashMatches,
    guardedWriteCount: storageGuard.guardedWriteCount,
    batchWindowCount: windows.length,
    rejectedStaleStorageCount: storageGuard.rejectedStaleStorageCount,
    rejectedIndexes,
    allAttemptWindowsCovered: sameArray(attemptWindowHashes, expectedWindowHashes),
    decisionHashMismatches,
    summaryCountsMatch,
    decisionSetHashMatches,
  };
}

function storagePreservationMetrics(storageGuard) {
  const attempts = Array.isArray(storageGuard.attempts) ? storageGuard.attempts : [];
  const stateMutationIndexes = attempts
    .filter((attempt) => !(
      attempt.storageStateUpdated === false
        && attempt.mutationApplied === false
        && attempt.preDecisionStorageStateHash === attempt.postDecisionStorageStateHash
    ))
    .map((attempt) => attempt.attemptIndex);

  return {
    pass: attempts.length > 0
      && storageGuard.allPreservedStorageState === true
      && storageGuard.mutationAppliedCount === 0
      && storageGuard.storageStateUpdatedCount === 0
      && stateMutationIndexes.length === 0,
    allPreservedStorageState: storageGuard.allPreservedStorageState,
    mutationAppliedCount: storageGuard.mutationAppliedCount,
    storageStateUpdatedCount: storageGuard.storageStateUpdatedCount,
    stateMutationIndexes,
  };
}

function unsafeGuardedWriteEvidenceDecisions(evidence, repeatedEvidence) {
  const acceptedStaleGuard = withPassedStatus(clone(evidence));
  acceptedStaleGuard.storageGuard.attempts[2].outcome = 'ready-for-apply-validation';
  acceptedStaleGuard.storageGuard.attempts[2].guardedWriteRejected = false;
  acceptedStaleGuard.storageGuard.attempts[2].rejectedStaleStorageState = false;
  acceptedStaleGuard.storageGuard.attempts[2].mutationCapableWorkStarted = true;
  acceptedStaleGuard.storageGuard.rejectedStaleStorageCount -= 1;
  acceptedStaleGuard.storageGuard.allRejectedStaleStorage = false;

  const mutatedStorageState = withPassedStatus(clone(evidence));
  mutatedStorageState.storageGuard.attempts[1].storageStateUpdated = true;
  mutatedStorageState.storageGuard.attempts[1].mutationApplied = true;
  mutatedStorageState.storageGuard.attempts[1].postDecisionStorageStateHash = sha256('rpp-0772-mutated-storage-state');
  mutatedStorageState.storageGuard.mutationAppliedCount = 1;
  mutatedStorageState.storageGuard.storageStateUpdatedCount = 1;
  mutatedStorageState.storageGuard.allPreservedStorageState = false;

  const missingGuardedWrite = withPassedStatus(clone(evidence));
  missingGuardedWrite.storageGuard.attempts.splice(3, 1);
  missingGuardedWrite.storageGuard.guardedWriteCount -= 1;
  missingGuardedWrite.storageGuard.rejectedStaleStorageCount -= 1;
  missingGuardedWrite.storageGuard.attemptDecisionHashes = missingGuardedWrite.storageGuard.attempts
    .map((attempt) => attempt.decisionHash);

  const prematurePassStatus = withPassedStatus(clone(evidence));
  prematurePassStatus.correctnessGates = [];

  return {
    acceptedStaleGuard: resolveDryRunGuardedWriteProof(acceptedStaleGuard, { repeatedEvidence }),
    mutatedStorageState: resolveDryRunGuardedWriteProof(mutatedStorageState, { repeatedEvidence }),
    missingGuardedWrite: resolveDryRunGuardedWriteProof(missingGuardedWrite, { repeatedEvidence }),
    prematurePassStatus: resolveDryRunGuardedWriteProof(prematurePassStatus, { repeatedEvidence }),
  };
}

function publicBenchmarkProjection(benchmark) {
  const dryRun = benchmark.resources.dryRun;
  const storageGuardProjection = benchmark.resources.storageGuardProjection;
  return {
    rppId: benchmark.rppId,
    variant: benchmark.variant,
    benchmark: benchmark.benchmark,
    ok: benchmark.ok,
    mode: benchmark.mode,
    profile: benchmark.profile,
    limits: benchmark.limits,
    dryRun: {
      stage: dryRun.stage,
      readOnly: dryRun.readOnly,
      batches: dryRun.batches,
      totalResources: dryRun.totalResources,
      totalPreconditions: dryRun.totalPreconditions,
      totalEstimatedBytes: dryRun.totalEstimatedBytes,
      largestBatch: dryRun.largestBatch,
      finalReceiptRequiresCompleteBatchSet: dryRun.finalReceiptRequiresCompleteBatchSet,
      finalReceiptHash: dryRun.finalReceiptHash,
      finalReceiptApplyAuthorization: dryRun.finalReceiptApplyAuthorization,
    },
    storageGuardProjection: {
      outcome: storageGuardProjection.outcome,
      resourceKeyHash: storageGuardProjection.resourceKeyHash,
      dryRunReceiptHash: storageGuardProjection.dryRunReceiptHash,
      dryRunExpectedHash: storageGuardProjection.dryRunExpectedHash,
      observedLiveHash: storageGuardProjection.observedLiveHash,
      guardedWriteAttempted: storageGuardProjection.guardedWriteAttempted,
      guardedWriteRejected: storageGuardProjection.guardedWriteRejected,
      mutationApplied: storageGuardProjection.mutationApplied,
      dryRunReceiptAuthorizesMutation: storageGuardProjection.dryRunReceiptAuthorizesMutation,
      reason: storageGuardProjection.reason,
    },
    gates: benchmark.gates.map((gate) => ({
      id: gate.id,
      status: gate.status,
    })),
  };
}

function publicStorageEvidenceProjection(evidence) {
  return {
    rppId: evidence.rppId,
    proofId: evidence.proofId,
    variant: evidence.variant,
    builtOn: evidence.builtOn,
    batchSizing: evidence.batchSizing,
    storageGuard: evidence.storageGuard,
    benchmark: evidence.benchmark,
    release: evidence.release,
  };
}

function batchSizingCore(batchSizing) {
  return {
    planHash: batchSizing.planHash,
    resourceCount: batchSizing.resourceCount,
    totalPreconditions: batchSizing.totalPreconditions,
    batchSize: batchSizing.batchSize,
    limits: batchSizing.limits,
    batchWindowCount: batchSizing.batchWindowCount,
    expectedBatchWindowCount: batchSizing.expectedBatchWindowCount,
    batchStarts: batchSizing.batchStarts,
    batchEnds: batchSizing.batchEnds,
    batchSizes: batchSizing.batchSizes,
    largestBatch: batchSizing.largestBatch,
    totalWindowResources: batchSizing.totalWindowResources,
    totalWindowPreconditions: batchSizing.totalWindowPreconditions,
    totalWindowEstimatedBytes: batchSizing.totalWindowEstimatedBytes,
    uniqueResourceKeyHashes: batchSizing.uniqueResourceKeyHashes,
    expectedCoverageHash: batchSizing.expectedCoverageHash,
    observedCoverageHash: batchSizing.observedCoverageHash,
    dryRunOnly: batchSizing.dryRunOnly,
    batchWindows: batchSizing.batchWindows,
  };
}

function batchWindowCore(window) {
  return {
    batchIndex: window.batchIndex,
    batchIdHash: window.batchIdHash,
    firstSequence: window.firstSequence,
    lastSequence: window.lastSequence,
    resourceCount: window.resourceCount,
    estimatedBytes: window.estimatedBytes,
    preconditionCount: window.preconditionCount,
    resourceKeyHashes: window.resourceKeyHashes,
    itemHashes: window.itemHashes,
    receiptHash: window.receiptHash,
    receiptApplyAuthorization: window.receiptApplyAuthorization,
    receiptNotLock: window.receiptNotLock,
  };
}

function storageGuardCore(storageGuard) {
  return {
    observedAt: storageGuard.observedAt,
    guardedWriteCount: storageGuard.guardedWriteCount,
    rejectedStaleStorageCount: storageGuard.rejectedStaleStorageCount,
    mutationAppliedCount: storageGuard.mutationAppliedCount,
    storageStateUpdatedCount: storageGuard.storageStateUpdatedCount,
    dryRunReceiptAuthorizesMutationCount: storageGuard.dryRunReceiptAuthorizesMutationCount,
    allRejectedStaleStorage: storageGuard.allRejectedStaleStorage,
    allPreservedStorageState: storageGuard.allPreservedStorageState,
    attemptDecisionHashes: storageGuard.attemptDecisionHashes,
    attempts: storageGuard.attempts,
  };
}

function guardedWriteAttemptCore(attempt) {
  return {
    attemptIndex: attempt.attemptIndex,
    observedAt: attempt.observedAt,
    guardOrder: attempt.guardOrder,
    targetBatchIndex: attempt.targetBatchIndex,
    targetBatchWindowHash: attempt.targetBatchWindowHash,
    targetResourceKeyHash: attempt.targetResourceKeyHash,
    targetItemHash: attempt.targetItemHash,
    dryRunReceiptHash: attempt.dryRunReceiptHash,
    dryRunExpectedHash: attempt.dryRunExpectedHash,
    observedLiveStorageHash: attempt.observedLiveStorageHash,
    plannedStorageHash: attempt.plannedStorageHash,
    dryRunReceiptAuthorizesMutation: attempt.dryRunReceiptAuthorizesMutation,
    preDecisionStorageStateHash: attempt.preDecisionStorageStateHash,
    liveStorageMatchesDryRunPrecondition: attempt.liveStorageMatchesDryRunPrecondition,
    outcome: attempt.outcome,
    guardedWriteAttempted: attempt.guardedWriteAttempted,
    guardedWriteRejected: attempt.guardedWriteRejected,
    rejectedStaleStorageState: attempt.rejectedStaleStorageState,
    mutationCapableWorkStarted: attempt.mutationCapableWorkStarted,
    mutationApplied: attempt.mutationApplied,
    storageStateUpdated: attempt.storageStateUpdated,
    postDecisionStorageStateHash: attempt.postDecisionStorageStateHash,
    blockedBy: attempt.blockedBy,
    reason: attempt.reason,
  };
}

function buildDryRunFixtureItems() {
  const items = [];
  let sequence = 0;

  for (let index = 0; index < workload.fileResources; index += 1) {
    const resourceKey = `file:wp-content/uploads/rpp-0712/file-${String(index).padStart(4, '0')}.bin`;
    items.push(fixtureItem({
      sequence: sequence++,
      kind: 'file',
      resourceKey,
      estimatedBytes: 2_400 + (index % 5) * 211,
    }));
  }

  for (const [table, count, averageEnvelopeBytes] of [
    ['wp_posts', workload.wpPosts, 720],
    ['wp_postmeta', workload.wpPostmeta, 520],
    ['wp_options', workload.wpOptions, 680],
  ]) {
    for (let index = 0; index < count; index += 1) {
      const primaryKey = `${table === 'wp_options' ? 'option_id' : 'ID'}:${10_000 + index}`;
      const resourceKey = `row:${JSON.stringify([table, primaryKey])}`;
      items.push(fixtureItem({
        sequence: sequence++,
        kind: 'db-row',
        table,
        resourceKey,
        estimatedBytes: averageEnvelopeBytes + (index % 7) * 19,
      }));
    }
  }

  for (let index = 0; index < workload.pluginMetadataResources; index += 1) {
    const plugin = index % 2 === 0 ? 'payments' : 'commerce';
    items.push(fixtureItem({
      sequence: sequence++,
      kind: 'plugin-metadata',
      resourceKey: `plugin:${plugin}:${index}`,
      atomicGroupId: 'install-commerce-stack',
      estimatedBytes: 940 + (index % 3) * 37,
    }));
  }

  return items;
}

function fixtureItem({
  sequence,
  kind,
  resourceKey,
  estimatedBytes,
  table = null,
  atomicGroupId = null,
}) {
  const base = {
    itemId: `rpp-0712-dry-run-item-${String(sequence).padStart(5, '0')}`,
    sequence,
    kind,
    table,
    resourceKey,
    resourceKeyHash: digest(resourceKey),
    atomicGroupId,
    estimatedBytes,
    preconditionCount: 1,
    expectedHash: sha256({ seed: DRY_RUN_BATCH_SIZING_BENCHMARK_ID, resourceKey, phase: 'expected-storage' }),
    plannedHash: sha256({ seed: DRY_RUN_BATCH_SIZING_BENCHMARK_ID, resourceKey, phase: 'planned-storage' }),
    validatesOnly: true,
    applyAuthorization: false,
  };

  return {
    ...base,
    itemHash: digest(batchEvidenceItem(base)),
  };
}

function batchEvidenceItem(item) {
  return {
    itemId: item.itemId,
    sequence: item.sequence,
    kind: item.kind,
    table: item.table || null,
    resourceKeyHash: item.resourceKeyHash || digest(item.resourceKey),
    atomicGroupId: item.atomicGroupId || null,
    estimatedBytes: item.estimatedBytes,
    preconditionCount: item.preconditionCount,
    expectedHash: item.expectedHash,
    plannedHash: item.plannedHash,
    validatesOnly: item.validatesOnly === true,
    applyAuthorization: item.applyAuthorization === true,
  };
}

function supportOnlyReleasePosture() {
  return {
    supportOnly: true,
    productionBacked: false,
    productionThroughput: 'not-claimed',
    speedClaimsAllowed: false,
    liveRemoteProductionService: 'not-claimed',
    productionStorageReceipts: 'not-claimed',
    productionRowBatchExecutor: 'not-claimed',
    productionAtomicGroupCommit: 'not-claimed',
    releaseVerifierCarryThrough: 'not-claimed',
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    blockers: [
      'live-production-service-not-supplied',
      'production-storage-receipts-not-measured',
      'production-row-batch-executor-not-measured',
      'production-atomic-group-commit-not-measured',
      'release-verifier-carry-through-not-claimed',
    ],
  };
}

function projectUnsafeDecisions(unsafe) {
  return Object.fromEntries(
    Object.entries(unsafe).map(([name, decision]) => [
      name,
      {
        updated: decision.updated,
        outputEmitted: decision.outputEmitted,
        attemptedPassBlocked: decision.attemptedPassBlocked,
        correctnessGatesHold: decision.correctnessGatesHold,
        blockedBy: decision.blockedBy,
        decisionHash: decision.decisionHash,
      },
    ]),
  );
}

function withPassedStatus(evidence) {
  evidence.status = 'passed';
  return evidence;
}

function proofGate(id, passed, metrics = {}) {
  return {
    id,
    status: passed ? 'pass' : 'fail',
    metrics,
  };
}

function assertHashCountOnlyStorageEvidence(value) {
  assert.equal(dryRunStorageEvidenceHasNoRawValues(value), true);
}

function dryRunStorageEvidenceHasNoRawValues(value) {
  return !rawDryRunStorageEvidencePattern().test(JSON.stringify(value));
}

function rawDryRunStorageEvidencePattern() {
  return /"resourceKey"\s*:|wp-content|wp_posts|wp_postmeta|wp_options|post_content|option_value|meta_value|private option value|dry-run raw payload|customer secret|rpp-0772-raw-fixture|row:\[/i;
}

function sha256(value) {
  return `sha256:${digest(value)}`;
}

function objectKeyBefore(object, leftKey, rightKey) {
  const keys = Object.keys(object);
  return keys.indexOf(leftKey) !== -1
    && keys.indexOf(rightKey) !== -1
    && keys.indexOf(leftKey) < keys.indexOf(rightKey);
}

function sameArray(left, right) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function unique(values) {
  return [...new Set(values)];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
