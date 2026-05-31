import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DRY_RUN_BATCH_SIZING_BENCHMARK_ID,
  planDryRunBatches,
  runDryRunBatchSizingBenchmark,
} from '../scripts/bench/dry-run-batch-sizing.js';
import { digest } from '../src/stable-json.js';

const proofId = 'rpp-0752-dry-run-batch-sizing-v3';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const maxDurationMs = 5_000;
const maxHeapUsedBytes = 128 * 1024 * 1024;
const workload = Object.freeze({
  fileResources: 6,
  wpPosts: 12,
  wpPostmeta: 15,
  wpOptions: 6,
  pluginMetadataResources: 3,
});
const limits = Object.freeze({
  maxBatchResources: 8,
  maxBatchEstimatedBytes: 24 * 1024,
  maxBatchPreconditions: 8,
});
const expectedGateIds = Object.freeze([
  'benchmark-gates-pass',
  'bounded-batch-sizing-gates',
  'complete-dry-run-batch-coverage',
  'dry-run-receipts-do-not-authorize-apply',
  'stale-storage-state-rejected-before-mutation',
  'storage-state-preserved-after-rejection',
  'deterministic-storage-performance-evidence',
  'hash-count-only-evidence',
  'support-only-release-no-go',
]);
const hexSha256Pattern = /^[a-f0-9]{64}$/;
const sha256Pattern = /^sha256:[a-f0-9]{64}$/;

test('RPP-0752 variant 3 rejects stale storage state while batch sizing remains bounded', {
  concurrency: false,
}, () => {
  const proof = buildVariant3Proof();

  assert.equal(proof.rppId, 'RPP-0752');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 3);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.builtOn.rppId, 'RPP-0712');
  assert.equal(proof.builtOn.previousVariantRppId, 'RPP-0732');
  assert.equal(proof.builtOn.benchmark, DRY_RUN_BATCH_SIZING_BENCHMARK_ID);
  assert.equal(proof.builtOn.ok, true);
  assert.match(proof.builtOn.evidenceHash, hexSha256Pattern);

  assert.equal(proof.runtime.generatedAt, fixedNow.toISOString());
  assert.equal(proof.runtime.durationMs >= 0, true);
  assert.equal(proof.runtime.durationMs <= proof.runtime.budgets.maxDurationMs, true);
  assert.equal(proof.resources.process.heapUsedBytes <= proof.runtime.budgets.maxHeapUsedBytes, true);
  assert.equal(proof.resources.dryRun.stage, 'push_plan_dry_run');
  assert.equal(proof.resources.dryRun.readOnly, true);
  assert.equal(proof.resources.dryRun.totalResources, 42);
  assert.equal(proof.resources.dryRun.totalPreconditions, 42);
  assert.equal(proof.resources.dryRun.batches, 6);
  assert.equal(proof.resources.dryRun.finalReceiptApplyAuthorization, false);
  assert.deepEqual([...new Set(proof.benchmark.gates.map((gate) => gate.status))], ['pass']);

  assert.equal(proof.batchSizing.resourceCount, 42);
  assert.equal(proof.batchSizing.totalPreconditions, 42);
  assert.equal(proof.batchSizing.batchWindowCount, 6);
  assert.equal(proof.batchSizing.expectedBatchWindowCount, 6);
  assert.deepEqual(proof.batchSizing.batchStarts, [0, 8, 16, 24, 32, 40]);
  assert.deepEqual(proof.batchSizing.batchEnds, [7, 15, 23, 31, 39, 41]);
  assert.deepEqual(proof.batchSizing.batchSizes, [8, 8, 8, 8, 8, 2]);
  assert.equal(proof.batchSizing.largestBatch.resourceCount <= limits.maxBatchResources, true);
  assert.equal(proof.batchSizing.largestBatch.estimatedBytes <= limits.maxBatchEstimatedBytes, true);
  assert.equal(proof.batchSizing.largestBatch.preconditionCount <= limits.maxBatchPreconditions, true);
  assert.equal(proof.batchSizing.batchWindows.every((window) => window.resourceCount <= limits.maxBatchResources), true);
  assert.equal(proof.batchSizing.batchWindows.every((window) => window.estimatedBytes <= limits.maxBatchEstimatedBytes), true);
  assert.equal(proof.batchSizing.batchWindows.every((window) => window.preconditionCount <= limits.maxBatchPreconditions), true);
  assert.match(proof.batchSizing.batchSizingHash, sha256Pattern);
  assert.match(proof.batchSizing.outputHash, sha256Pattern);

  assert.equal(proof.storageGuard.outcome, 'stale-at-write');
  assert.equal(proof.storageGuard.liveStorageMatchesDryRunPrecondition, false);
  assert.equal(proof.storageGuard.guardedWriteAttempted, true);
  assert.equal(proof.storageGuard.guardedWriteRejected, true);
  assert.equal(proof.storageGuard.rejectedStaleStorageState, true);
  assert.equal(proof.storageGuard.mutationCapableWorkStarted, false);
  assert.equal(proof.storageGuard.mutationApplied, false);
  assert.equal(proof.storageGuard.storageStateUpdated, false);
  assert.equal(proof.storageGuard.preDecisionStorageStateHash, proof.storageGuard.postDecisionStorageStateHash);
  assert.equal(proof.storageGuard.dryRunReceiptAuthorizesMutation, false);
  assert.deepEqual(proof.storageGuard.guardOrder, [
    'read-live-storage-state',
    'compare-live-storage-hash',
    'reject-stale-state',
    'skip-mutation-capable-work',
  ]);
  assert.ok(proof.storageGuard.blockedBy.includes('stale-storage-state'));
  assert.match(proof.storageGuard.decisionHash, sha256Pattern);

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

  assert.equal(proof.unsafe.staleGuardBypass.updated, false);
  assert.equal(proof.unsafe.staleGuardBypass.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.staleGuardBypass.blockedBy.includes('stale-storage-state-rejected-before-mutation'));
  assert.equal(proof.unsafe.mutatedStorageState.updated, false);
  assert.equal(proof.unsafe.mutatedStorageState.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.mutatedStorageState.blockedBy.includes('storage-state-preserved-after-rejection'));
  assert.equal(proof.unsafe.oversizedBatchClaim.updated, false);
  assert.equal(proof.unsafe.oversizedBatchClaim.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.oversizedBatchClaim.blockedBy.includes('bounded-batch-sizing-gates'));
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

test('RPP-0752 variant 3 fails closed for stale bypass, mutation, oversized, and premature evidence', {
  concurrency: false,
}, () => {
  const { evidence, repeatedEvidence } = buildRecordedEvidencePair();
  const safeDecision = resolveDryRunStoragePerformanceProof(evidence, { repeatedEvidence });
  const unsafeDecisions = unsafeStorageEvidenceDecisions(evidence, repeatedEvidence);

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

  assert.equal(unsafeDecisions.staleGuardBypass.updated, false);
  assert.ok(unsafeDecisions.staleGuardBypass.blockedBy.includes('stale-storage-state-rejected-before-mutation'));
  assert.equal(unsafeDecisions.mutatedStorageState.updated, false);
  assert.ok(unsafeDecisions.mutatedStorageState.blockedBy.includes('storage-state-preserved-after-rejection'));
  assert.equal(unsafeDecisions.oversizedBatchClaim.updated, false);
  assert.ok(unsafeDecisions.oversizedBatchClaim.blockedBy.includes('bounded-batch-sizing-gates'));
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

function buildVariant3Proof() {
  const { benchmark, evidence, repeatedEvidence } = buildRecordedEvidencePair();
  const safeDecision = resolveDryRunStoragePerformanceProof(evidence, { repeatedEvidence });
  const unsafe = projectUnsafeDecisions(unsafeStorageEvidenceDecisions(evidence, repeatedEvidence));
  const correctnessGatesRecordedBeforeOutput = objectKeyBefore(
    evidence,
    'correctnessGates',
    'batchSizing',
  );
  const benchmarkGatesPass = benchmark.ok && benchmark.gates.every((gate) => gate.status === 'pass');
  const supportOnlyRelease = supportOnlyReleasePosture();
  const proofGates = [
    proofGate('benchmark-storage-performance-gates-pass', benchmarkGatesPass, {
      benchmarkGateStatuses: benchmark.gates.map((gate) => gate.status),
      durationMs: benchmark.runtime.durationMs,
      heapUsedBytes: benchmark.resources.process.heapUsedBytes,
    }),
    proofGate('bounded-batch-sizing-before-storage-guard-output', safeDecision.updated
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
    proofGate('guarded-stale-storage-rejected-before-mutation', evidence.storageGuard.guardedWriteRejected
      && evidence.storageGuard.rejectedStaleStorageState
      && evidence.storageGuard.mutationCapableWorkStarted === false
      && evidence.storageGuard.mutationApplied === false, {
      outcome: evidence.storageGuard.outcome,
      guardedWriteRejected: evidence.storageGuard.guardedWriteRejected,
      storageStateUpdated: evidence.storageGuard.storageStateUpdated,
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
    rppId: 'RPP-0752',
    proofId,
    variant: 3,
    status: proofGates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed',
    builtOn: {
      rppId: 'RPP-0712',
      previousVariantRppId: 'RPP-0732',
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
      mode: 'hash-count-only-dry-run-storage-performance',
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
  const evidence = buildStoragePerformanceEvidence({ benchmark });
  const repeatedEvidence = buildStoragePerformanceEvidence({ benchmark: repeatedBenchmark });

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

function buildStoragePerformanceEvidence({ benchmark }) {
  return {
    schemaVersion: 1,
    rppId: 'RPP-0752',
    proofId,
    variant: 3,
    status: 'pending',
    builtOn: {
      rppId: 'RPP-0712',
      previousVariantRppId: 'RPP-0732',
      benchmark: benchmark.benchmark,
      evidenceHash: digest(publicBenchmarkProjection(benchmark)),
    },
    correctnessGates: [],
    batchSizing: collectDryRunBatchSizingEvidence(buildDryRunFixtureItems(), limits),
    storageGuard: staleStorageGuardEvidence(benchmark.resources.storageGuardProjection),
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
  const gates = recomputeDryRunStoragePerformanceGates(evidence, repeatedEvidence);
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

function staleStorageGuardEvidence(projection) {
  const attempt = {
    observedAt: 'before-mutation-capable-work',
    guardOrder: [
      'read-live-storage-state',
      'compare-live-storage-hash',
      'reject-stale-state',
      'skip-mutation-capable-work',
    ],
    targetItemHash: sha256(projection.targetItemId),
    kindHash: sha256(projection.kind),
    resourceKeyHash: projection.resourceKeyHash,
    dryRunReceiptHash: projection.dryRunReceiptHash,
    dryRunExpectedHash: projection.dryRunExpectedHash,
    observedLiveStorageHash: projection.observedLiveHash,
    plannedStorageHash: sha256({
      resourceKeyHash: projection.resourceKeyHash,
      phase: 'support-only-planned-storage-state',
    }),
    dryRunReceiptAuthorizesMutation: projection.dryRunReceiptAuthorizesMutation,
    preDecisionStorageStateHash: projection.observedLiveHash,
  };

  return resolveGuardedWriteAttempt(attempt);
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

function resolveDryRunStoragePerformanceProof(evidence, { repeatedEvidence }) {
  const recomputedGates = recomputeDryRunStoragePerformanceGates(evidence, repeatedEvidence);
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
        staleStorageDecisionHash: evidence.storageGuard.decisionHash,
        guardedWritesAttempted: 1,
        staleStorageRejected: 1,
        mutationApplied: 0,
        storageStateUpdated: 0,
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

function recomputeDryRunStoragePerformanceGates(evidence, repeatedEvidence) {
  const batchSizing = evidence.batchSizing || {};
  const windows = Array.isArray(batchSizing.batchWindows) ? batchSizing.batchWindows : [];
  const bounded = boundedBatchSizingMetrics(batchSizing, windows);
  const coverage = batchCoverageMetrics(batchSizing, windows);
  const receiptAuthority = dryRunReceiptAuthorityMetrics(batchSizing, evidence.storageGuard || {});
  const storageGuard = evidence.storageGuard || {};
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
    proofGate('stale-storage-state-rejected-before-mutation', storageGuard.outcome === 'stale-at-write'
      && storageGuard.liveStorageMatchesDryRunPrecondition === false
      && storageGuard.guardedWriteAttempted === true
      && storageGuard.guardedWriteRejected === true
      && storageGuard.rejectedStaleStorageState === true
      && storageGuard.mutationCapableWorkStarted === false
      && storageGuard.mutationApplied === false
      && storageGuard.dryRunReceiptAuthorizesMutation === false
      && storageGuard.observedAt === 'before-mutation-capable-work', {
      outcome: storageGuard.outcome,
      guardedWriteRejected: storageGuard.guardedWriteRejected,
      rejectedStaleStorageState: storageGuard.rejectedStaleStorageState,
      mutationCapableWorkStarted: storageGuard.mutationCapableWorkStarted,
      mutationApplied: storageGuard.mutationApplied,
    }),
    proofGate('storage-state-preserved-after-rejection', storageGuard.storageStateUpdated === false
      && storageGuard.mutationApplied === false
      && storageGuard.preDecisionStorageStateHash === storageGuard.postDecisionStorageStateHash, {
      storageStateUpdated: storageGuard.storageStateUpdated,
      mutationApplied: storageGuard.mutationApplied,
      storageStateHashPreserved: storageGuard.preDecisionStorageStateHash === storageGuard.postDecisionStorageStateHash,
    }),
    proofGate('deterministic-storage-performance-evidence', deterministicEvidence, {
      firstEvidenceHash: digest(publicStorageEvidenceProjection(evidence)),
      repeatedEvidenceHash: repeatedEvidence ? digest(publicStorageEvidenceProjection(repeatedEvidence)) : '',
    }),
    proofGate('hash-count-only-evidence', dryRunStorageEvidenceHasNoRawValues({
      batchSizing,
      storageGuard,
      outputProjection: evidence.outputProjection || null,
    }), {
      rawValueEvidenceLeaks: dryRunStorageEvidenceHasNoRawValues({ batchSizing, storageGuard }) ? 0 : 1,
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
  const receiptAuthorityFailures = windows.filter((window) =>
    window.receiptApplyAuthorization !== false || window.receiptNotLock !== true);
  return {
    pass: receiptAuthorityFailures.length === 0
      && batchSizing.dryRunOnly?.readOnly === true
      && batchSizing.dryRunOnly?.mutates === false
      && storageGuard.dryRunReceiptAuthorizesMutation === false,
    receiptAuthorityFailures: receiptAuthorityFailures.map((window) => window.batchIndex),
    readOnly: batchSizing.dryRunOnly?.readOnly,
    mutates: batchSizing.dryRunOnly?.mutates,
    dryRunReceiptAuthorizesMutation: storageGuard.dryRunReceiptAuthorizesMutation,
  };
}

function unsafeStorageEvidenceDecisions(evidence, repeatedEvidence) {
  const staleGuardBypass = withPassedStatus(clone(evidence));
  staleGuardBypass.storageGuard.guardedWriteRejected = false;
  staleGuardBypass.storageGuard.rejectedStaleStorageState = false;
  staleGuardBypass.storageGuard.mutationCapableWorkStarted = true;

  const mutatedStorageState = withPassedStatus(clone(evidence));
  mutatedStorageState.storageGuard.storageStateUpdated = true;
  mutatedStorageState.storageGuard.mutationApplied = true;
  mutatedStorageState.storageGuard.postDecisionStorageStateHash = sha256('rpp-0752-mutated-storage-state');

  const oversizedBatchClaim = withPassedStatus(clone(evidence));
  oversizedBatchClaim.batchSizing.largestBatch.resourceCount = limits.maxBatchResources + 1;

  const prematurePassStatus = withPassedStatus(clone(evidence));
  prematurePassStatus.correctnessGates = [];

  return {
    staleGuardBypass: resolveDryRunStoragePerformanceProof(staleGuardBypass, { repeatedEvidence }),
    mutatedStorageState: resolveDryRunStoragePerformanceProof(mutatedStorageState, { repeatedEvidence }),
    oversizedBatchClaim: resolveDryRunStoragePerformanceProof(oversizedBatchClaim, { repeatedEvidence }),
    prematurePassStatus: resolveDryRunStoragePerformanceProof(prematurePassStatus, { repeatedEvidence }),
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
  return /"resourceKey"\s*:|wp-content|wp_posts|wp_postmeta|wp_options|post_content|option_value|meta_value|private option value|dry-run raw payload|customer secret|rpp-0752-raw-fixture|row:\[/i;
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
