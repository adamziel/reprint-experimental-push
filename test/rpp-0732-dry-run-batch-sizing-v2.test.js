import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DRY_RUN_BATCH_SIZING_BENCHMARK_ID,
  planDryRunBatches,
  runDryRunBatchSizingBenchmark,
} from '../scripts/bench/dry-run-batch-sizing.js';
import { digest } from '../src/stable-json.js';

const proofId = 'rpp-0732-dry-run-batch-sizing-v2';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const maxDurationMs = 5_000;
const maxHeapUsedBytes = 128 * 1024 * 1024;
const workload = Object.freeze({
  fileResources: 4,
  wpPosts: 10,
  wpPostmeta: 13,
  wpOptions: 5,
  pluginMetadataResources: 2,
});
const limits = Object.freeze({
  maxBatchResources: 7,
  maxBatchEstimatedBytes: 32 * 1024,
  maxBatchPreconditions: 7,
});
const expectedGateIds = Object.freeze([
  'deterministic-batch-size',
  'ordered-batch-windows',
  'complete-batch-coverage',
  'resource-counts-match',
  'batch-window-hashes-match',
  'deterministic-batch-evidence',
  'runtime-resource-budget',
  'stale-storage-refusal-before-mutation',
  'hash-only-batch-evidence',
  'support-only-release-no-go',
]);

test('RPP-0732 variant 2 proves dry-run batch sizing gates and support-only NO-GO', {
  concurrency: false,
}, () => {
  const proof = buildVariant2Proof();

  assert.equal(proof.rppId, 'RPP-0732');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 2);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.builtOn.rppId, 'RPP-0712');
  assert.equal(proof.builtOn.benchmark, DRY_RUN_BATCH_SIZING_BENCHMARK_ID);
  assert.equal(proof.builtOn.ok, true);
  assert.match(proof.builtOn.evidenceHash, /^[a-f0-9]{64}$/);

  assert.equal(proof.runtime.generatedAt, fixedNow.toISOString());
  assert.equal(proof.runtime.durationMs >= 0, true);
  assert.equal(proof.runtime.durationMs <= proof.runtime.budgets.maxDurationMs, true);
  assert.equal(proof.resources.process.heapUsedBytes <= proof.runtime.budgets.maxHeapUsedBytes, true);
  assert.equal(proof.resources.dryRun.stage, 'push_plan_dry_run');
  assert.equal(proof.resources.dryRun.readOnly, true);
  assert.equal(proof.resources.dryRun.totalResources, 34);
  assert.equal(proof.resources.dryRun.totalPreconditions, 34);
  assert.equal(proof.resources.dryRun.batches, 5);
  assert.equal(proof.resources.dryRun.finalReceiptApplyAuthorization, false);
  assert.deepEqual([...new Set(proof.benchmark.gates.map((gate) => gate.status))], ['pass']);

  assert.equal(proof.batchCollection.resourceCount, 34);
  assert.equal(proof.batchCollection.batchSize, limits.maxBatchResources);
  assert.equal(proof.batchCollection.batchWindowCount, 5);
  assert.equal(proof.batchCollection.expectedBatchWindowCount, 5);
  assert.deepEqual(proof.batchCollection.batchStarts, [0, 7, 14, 21, 28]);
  assert.deepEqual(proof.batchCollection.batchEnds, [6, 13, 20, 27, 33]);
  assert.deepEqual(proof.batchCollection.batchSizes, [7, 7, 7, 7, 6]);
  assert.equal(proof.batchCollection.totalWindowResources, 34);
  assert.equal(proof.batchCollection.uniqueResourceKeyHashes, 34);
  assert.equal(proof.batchCollection.observedCoverageHash, proof.batchCollection.expectedCoverageHash);
  assert.match(proof.batchCollection.batchCollectionHash, /^sha256:[a-f0-9]{64}$/);
  assert.ok(proof.batchCollection.batchWindows.every((window) => window.resourceCount <= limits.maxBatchResources));
  assert.ok(proof.batchCollection.batchWindows.every((window) => window.preconditionCount <= limits.maxBatchPreconditions));
  assert.ok(proof.batchCollection.batchWindows.every((window) => window.estimatedBytes <= limits.maxBatchEstimatedBytes));
  assert.ok(proof.batchCollection.batchWindows.every((window) => window.batchWindowHash.match(/^sha256:[a-f0-9]{64}$/)));
  assertHashOnlyBatchEvidence(proof.batchCollection);

  assert.equal(proof.storageGuard.guardedWriteRejected, true);
  assert.equal(proof.storageGuard.outcome, 'stale-at-write');
  assert.equal(proof.storageGuard.mutationCapableWorkStarted, false);
  assert.equal(proof.storageGuard.mutationApplied, false);
  assert.equal(proof.storageGuard.observedAt, 'before-mutation-capable-work');
  assert.deepEqual(proof.storageGuard.guardOrder, [
    'compare-live-storage-hash',
    'reject-stale-state',
    'skip-mutation-capable-work',
  ]);

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
    'pass',
  ]);
  assert.equal(proof.correctness.correctnessGatesHoldBeforeOutput, true);
  assert.equal(proof.correctness.correctnessGatesRecordedBeforeOutput, true);
  assert.equal(proof.correctness.hashOnlyBatchOutput, true);
  assert.equal(proof.correctness.batchOutputEmittedAfterGates, true);
  assert.match(proof.batchCollection.outputHash, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(proof.gates.map((gate) => gate.status), [
    'pass',
    'pass',
    'pass',
    'pass',
  ]);

  assert.equal(proof.unsafe.staleBatchHash.updated, false);
  assert.equal(proof.unsafe.staleBatchHash.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.staleBatchHash.blockedBy.includes('batch-window-hashes-match'));
  assert.equal(proof.unsafe.missingBatchWindow.updated, false);
  assert.equal(proof.unsafe.missingBatchWindow.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.missingBatchWindow.blockedBy.includes('complete-batch-coverage'));
  assert.equal(proof.unsafe.mismatchedResourceCounts.updated, false);
  assert.equal(proof.unsafe.mismatchedResourceCounts.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.mismatchedResourceCounts.blockedBy.includes('resource-counts-match'));
  assert.equal(proof.unsafe.prematurePassStatus.updated, false);
  assert.equal(proof.unsafe.prematurePassStatus.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.prematurePassStatus.blockedBy.includes('correctness-gates-not-recorded'));

  assert.equal(proof.release.supportOnly, true);
  assert.equal(proof.release.productionBacked, false);
  assert.equal(proof.release.productionThroughput, 'not-claimed');
  assert.equal(proof.release.speedClaimsAllowed, false);
  assert.equal(proof.release.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.release.integrationRecommendation, 'NO-GO');
  assert.match(proof.evidenceHash, /^[a-f0-9]{64}$/);
  assertHashOnlyBatchEvidence(proof);
});

test('RPP-0732 variant 2 fails closed for stale, missing, mismatched, and premature batch evidence', () => {
  const { evidence, repeatedEvidence } = buildRecordedEvidencePair();
  const safeDecision = resolveDryRunBatchSizingProof(evidence, { repeatedEvidence });
  const staleBatchHash = withPassedStatus(clone(evidence));
  staleBatchHash.batchCollection.batchWindows[1].batchWindowHash = sha256('rpp-0732-stale-batch-hash');
  const missingBatchWindow = withPassedStatus(clone(evidence));
  missingBatchWindow.batchCollection.batchWindows.splice(2, 1);
  const mismatchedResourceCounts = withPassedStatus(clone(evidence));
  mismatchedResourceCounts.batchCollection.resourceCount += 1;
  const prematurePassStatus = withPassedStatus(clone(evidence));
  prematurePassStatus.correctnessGates = [];
  const unsafeDecisions = {
    staleBatchHash: resolveDryRunBatchSizingProof(staleBatchHash, { repeatedEvidence }),
    missingBatchWindow: resolveDryRunBatchSizingProof(missingBatchWindow, { repeatedEvidence }),
    mismatchedResourceCounts: resolveDryRunBatchSizingProof(mismatchedResourceCounts, { repeatedEvidence }),
    prematurePassStatus: resolveDryRunBatchSizingProof(prematurePassStatus, { repeatedEvidence }),
  };

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
    'pass',
  ]);
  assert.equal(unsafeDecisions.staleBatchHash.updated, false);
  assert.ok(unsafeDecisions.staleBatchHash.blockedBy.includes('batch-window-hashes-match'));
  assert.equal(unsafeDecisions.missingBatchWindow.updated, false);
  assert.ok(unsafeDecisions.missingBatchWindow.blockedBy.includes('complete-batch-coverage'));
  assert.equal(unsafeDecisions.mismatchedResourceCounts.updated, false);
  assert.ok(unsafeDecisions.mismatchedResourceCounts.blockedBy.includes('resource-counts-match'));
  assert.equal(unsafeDecisions.prematurePassStatus.updated, false);
  assert.ok(unsafeDecisions.prematurePassStatus.blockedBy.includes('correctness-gates-not-recorded'));

  for (const decision of Object.values(unsafeDecisions)) {
    assert.equal(decision.output, null);
    assert.equal(decision.outputEmitted, false);
    assert.equal(decision.attemptedPassBlocked, true);
    assert.match(decision.decisionHash, /^[a-f0-9]{64}$/);
  }
});

function buildVariant2Proof() {
  const { benchmark, evidence, repeatedEvidence } = buildRecordedEvidencePair();
  const safeDecision = resolveDryRunBatchSizingProof(evidence, { repeatedEvidence });
  const unsafe = projectUnsafeDecisions(unsafeBatchEvidenceDecisions(evidence, repeatedEvidence));
  const correctnessGatesRecordedBeforeOutput = objectKeyBefore(
    evidence,
    'correctnessGates',
    'batchCollection',
  );
  const benchmarkGatesPass = benchmark.gates.every((gate) => gate.status === 'pass');
  const supportOnlyRelease = supportOnlyReleasePosture();
  const proofGates = [
    proofGate('benchmark-runtime-resource-gates-pass', benchmark.ok && benchmarkGatesPass, {
      benchmarkGateStatuses: benchmark.gates.map((gate) => gate.status),
      durationMs: benchmark.runtime.durationMs,
      heapUsedBytes: benchmark.resources.process.heapUsedBytes,
    }),
    proofGate('batch-output-after-correctness-gates', safeDecision.updated
      && safeDecision.outputEmitted
      && correctnessGatesRecordedBeforeOutput, {
      outputEmitted: safeDecision.outputEmitted,
      correctnessGatesRecordedBeforeOutput,
      blockedBy: safeDecision.blockedBy,
    }),
    proofGate('unsafe-batch-evidence-fails-closed', Object.values(unsafe).every((decision) => (
      decision.updated === false
        && decision.outputEmitted === false
        && decision.attemptedPassBlocked === true
    )), {
      blockedDecisionHashes: Object.values(unsafe).map((decision) => decision.decisionHash),
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
    rppId: 'RPP-0732',
    proofId,
    variant: 2,
    status: proofGates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed',
    builtOn: {
      rppId: 'RPP-0712',
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
    batchCollection: {
      ...evidence.batchCollection,
      outputHash: safeDecision.outputHash,
    },
    storageGuard: evidence.storageGuard,
    correctness: {
      gateIds: evidence.correctnessGates.map((gate) => gate.id),
      recomputedGateVector: safeDecision.recomputedGates,
      correctnessGatesRecordedBeforeOutput,
      correctnessGatesHoldBeforeOutput: safeDecision.correctnessGatesHold,
      hashOnlyBatchOutput: safeDecision.hashOnlyBatchOutput,
      batchOutputEmittedAfterGates: safeDecision.outputEmitted,
    },
    unsafe,
    gates: proofGates,
    release: supportOnlyRelease,
    redaction: {
      mode: 'hash-only-batch-windows',
      rawValueEvidenceLeaks: dryRunBatchEvidenceHasNoRawValues(evidence.batchCollection) ? 0 : 1,
      publicBatchEvidenceHash: digest(publicBatchEvidenceProjection(evidence)),
      repeatedBatchEvidenceHash: digest(publicBatchEvidenceProjection(repeatedEvidence)),
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
  const items = buildDryRunFixtureItems(workload);
  const evidence = buildBatchSizingEvidence({
    benchmark,
    batchCollection: collectDryRunBatchWindowEvidence({ items, limits }),
  });
  const repeatedEvidence = buildBatchSizingEvidence({
    benchmark: repeatedBenchmark,
    batchCollection: collectDryRunBatchWindowEvidence({ items: buildDryRunFixtureItems(workload), limits }),
  });

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

function buildBatchSizingEvidence({ benchmark, batchCollection }) {
  return {
    schemaVersion: 1,
    rppId: 'RPP-0732',
    proofId,
    variant: 2,
    status: 'pending',
    builtOn: {
      rppId: 'RPP-0712',
      benchmark: benchmark.benchmark,
      evidenceHash: digest(publicBenchmarkProjection(benchmark)),
    },
    correctnessGates: [],
    batchCollection,
    runtime: {
      generatedAt: benchmark.runtime.generatedAt,
      durationMs: benchmark.runtime.durationMs,
      budgets: benchmark.runtime.budgets,
    },
    resources: {
      dryRun: benchmark.resources.dryRun,
      process: benchmark.resources.process,
    },
    storageGuard: storageGuardBeforeMutationEvidence(benchmark.resources.storageGuardProjection),
    release: supportOnlyReleasePosture(),
  };
}

function recordCorrectnessGates(evidence, repeatedEvidence) {
  const gates = recomputeDryRunBatchSizingGates(evidence, repeatedEvidence);
  evidence.correctnessGates = gates.map((gate) => ({
    id: gate.id,
    status: gate.status === 'pass' ? 'passed' : 'failed',
    evidenceHash: digest(gate.metrics),
  }));
  evidence.status = gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed';
  return evidence;
}

function collectDryRunBatchWindowEvidence({ items, limits: batchLimits }) {
  const batches = planDryRunBatches(items, batchLimits);
  const expectedResourceKeyHashes = items.map((item) => item.resourceKeyHash);
  const batchWindows = batches.map(batchWindowSummary);
  const observedResourceKeyHashes = batchWindows.flatMap((window) => window.resourceKeyHashes);
  const collectionCore = {
    planHash: sha256({
      proofId,
      resourceKeyHashes: expectedResourceKeyHashes,
      limits: batchLimits,
    }),
    resourceCount: expectedResourceKeyHashes.length,
    batchSize: batchLimits.maxBatchResources,
    limits: batchLimits,
    batchWindowCount: batchWindows.length,
    expectedBatchWindowCount: Math.ceil(expectedResourceKeyHashes.length / batchLimits.maxBatchResources),
    batchStarts: batchWindows.map((window) => window.firstSequence),
    batchEnds: batchWindows.map((window) => window.lastSequence),
    batchSizes: batchWindows.map((window) => window.resourceCount),
    totalWindowResources: batchWindows.reduce((sum, window) => sum + window.resourceCount, 0),
    totalWindowPreconditions: batchWindows.reduce((sum, window) => sum + window.preconditionCount, 0),
    uniqueResourceKeyHashes: new Set(observedResourceKeyHashes).size,
    expectedCoverageHash: sha256(expectedResourceKeyHashes),
    observedCoverageHash: sha256(observedResourceKeyHashes),
    planningOnly: {
      readOnly: true,
      mutates: false,
      authority: 'planning-evidence-only',
      applyBoundary: 'apply-must-revalidate-live-storage-hash',
    },
    batchWindows,
  };

  return {
    ...collectionCore,
    batchCollectionHash: sha256(collectionCore),
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

function storageGuardBeforeMutationEvidence(projection) {
  return {
    outcome: projection.outcome,
    observedAt: 'before-mutation-capable-work',
    guardOrder: [
      'compare-live-storage-hash',
      'reject-stale-state',
      'skip-mutation-capable-work',
    ],
    targetItemHash: sha256(projection.targetItemId),
    kind: projection.kind,
    resourceKeyHash: projection.resourceKeyHash,
    dryRunReceiptHash: projection.dryRunReceiptHash,
    dryRunExpectedHash: projection.dryRunExpectedHash,
    observedLiveHash: projection.observedLiveHash,
    guardedWriteAttempted: projection.guardedWriteAttempted,
    guardedWriteRejected: projection.guardedWriteRejected,
    mutationCapableWorkStarted: false,
    mutationApplied: projection.mutationApplied,
    dryRunReceiptAuthorizesMutation: projection.dryRunReceiptAuthorizesMutation,
    reason: projection.reason,
  };
}

function resolveDryRunBatchSizingProof(evidence, { repeatedEvidence }) {
  const recomputedGates = recomputeDryRunBatchSizingGates(evidence, repeatedEvidence);
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
        batchCollectionHash: evidence.batchCollection.batchCollectionHash,
        observedCoverageHash: evidence.batchCollection.observedCoverageHash,
        expectedCoverageHash: evidence.batchCollection.expectedCoverageHash,
        batchWindowHashSetHash: sha256(evidence.batchCollection.batchWindows.map((window) => window.batchWindowHash)),
        staleStorageOutcome: evidence.storageGuard.outcome,
        releaseStatus: evidence.release.finalReleaseStatus,
      }
    : null;
  const publicDecision = {
    updated: correctnessGatesHold,
    outputEmitted: Boolean(output),
    attemptedPassBlocked: evidence.status === 'passed' && !correctnessGatesHold,
    correctnessGatesHold,
    recordedGateIdsComplete,
    recordedGateStatusesHold,
    hashOnlyBatchOutput: output ? dryRunBatchEvidenceHasNoRawValues(output) : false,
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

function recomputeDryRunBatchSizingGates(evidence, repeatedEvidence) {
  const collection = evidence.batchCollection || {};
  const windows = Array.isArray(collection.batchWindows) ? collection.batchWindows : [];
  const order = batchWindowOrderMetrics(windows);
  const coverage = batchCoverageMetrics(collection, windows);
  const resourceCounts = resourceCountMetrics(evidence, windows);
  const hashMismatches = windows
    .filter((window) => window.batchWindowHash !== sha256(batchWindowCore(window)))
    .map((window) => window.batchIndex);
  const batchCollectionHashMatches = collection.batchCollectionHash === sha256(batchCollectionCore(collection));
  const deterministicBatchEvidence = Boolean(repeatedEvidence)
    && digest(publicBatchEvidenceProjection(evidence)) === digest(publicBatchEvidenceProjection(repeatedEvidence));
  const deterministicBatchSize = Number.isInteger(collection.batchSize)
    && collection.batchSize === collection.limits?.maxBatchResources
    && windows.length === collection.expectedBatchWindowCount
    && windows.every((window, index) => {
      const expectedSize = index === windows.length - 1
        ? collection.resourceCount - (collection.batchSize * index)
        : collection.batchSize;
      return window.resourceCount === expectedSize
        && window.resourceCount > 0
        && window.resourceCount <= collection.batchSize
        && window.preconditionCount <= collection.limits.maxBatchPreconditions
        && window.estimatedBytes <= collection.limits.maxBatchEstimatedBytes;
    });
  const runtime = evidence.runtime || {};
  const processResources = evidence.resources?.process || {};
  const storageGuard = evidence.storageGuard || {};
  const release = evidence.release || {};

  return [
    proofGate('deterministic-batch-size', deterministicBatchSize, {
      batchSize: collection.batchSize,
      expectedBatchWindowCount: collection.expectedBatchWindowCount,
      batchSizes: windows.map((window) => window.resourceCount),
      maxBatchResources: collection.limits?.maxBatchResources,
    }),
    proofGate('ordered-batch-windows', order.ordered, order),
    proofGate('complete-batch-coverage', coverage.complete, coverage),
    proofGate('resource-counts-match', resourceCounts.match, resourceCounts),
    proofGate('batch-window-hashes-match', hashMismatches.length === 0 && batchCollectionHashMatches, {
      mismatchedBatchIndexes: hashMismatches,
      batchCollectionHashMatches,
    }),
    proofGate('deterministic-batch-evidence', deterministicBatchEvidence, {
      firstEvidenceHash: digest(publicBatchEvidenceProjection(evidence)),
      repeatedEvidenceHash: repeatedEvidence ? digest(publicBatchEvidenceProjection(repeatedEvidence)) : '',
    }),
    proofGate('runtime-resource-budget', (
      runtime.durationMs <= runtime.budgets?.maxDurationMs
        && processResources.heapUsedBytes <= runtime.budgets?.maxHeapUsedBytes
    ), {
      durationMs: runtime.durationMs,
      heapUsedBytes: processResources.heapUsedBytes,
      maxDurationMs: runtime.budgets?.maxDurationMs,
      maxHeapUsedBytes: runtime.budgets?.maxHeapUsedBytes,
    }),
    proofGate('stale-storage-refusal-before-mutation', storageGuard.guardedWriteRejected === true
      && storageGuard.outcome === 'stale-at-write'
      && storageGuard.mutationCapableWorkStarted === false
      && storageGuard.mutationApplied === false
      && storageGuard.dryRunReceiptAuthorizesMutation === false
      && storageGuard.observedAt === 'before-mutation-capable-work', {
      outcome: storageGuard.outcome,
      guardedWriteRejected: storageGuard.guardedWriteRejected,
      mutationCapableWorkStarted: storageGuard.mutationCapableWorkStarted,
      mutationApplied: storageGuard.mutationApplied,
      dryRunReceiptAuthorizesMutation: storageGuard.dryRunReceiptAuthorizesMutation,
    }),
    proofGate('hash-only-batch-evidence', dryRunBatchEvidenceHasNoRawValues({
      batchCollection: collection,
      storageGuard,
    }), {
      rawValueEvidenceLeaks: dryRunBatchEvidenceHasNoRawValues({ batchCollection: collection, storageGuard }) ? 0 : 1,
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

function batchWindowOrderMetrics(windows) {
  let expectedStart = 0;
  let indexMismatchCount = 0;
  let startMismatchCount = 0;
  let endMismatchCount = 0;
  let emptyWindowCount = 0;

  windows.forEach((window, index) => {
    if (window.batchIndex !== index) {
      indexMismatchCount += 1;
    }
    if (window.firstSequence !== expectedStart) {
      startMismatchCount += 1;
    }
    if (window.lastSequence !== window.firstSequence + window.resourceCount - 1) {
      endMismatchCount += 1;
    }
    if (window.resourceCount <= 0) {
      emptyWindowCount += 1;
    }
    expectedStart = window.lastSequence + 1;
  });

  return {
    ordered: indexMismatchCount === 0
      && startMismatchCount === 0
      && endMismatchCount === 0
      && emptyWindowCount === 0,
    indexMismatchCount,
    startMismatchCount,
    endMismatchCount,
    emptyWindowCount,
    terminalSequence: windows.at(-1)?.lastSequence ?? null,
  };
}

function batchCoverageMetrics(collection, windows) {
  const observedResourceKeyHashes = windows.flatMap((window) => window.resourceKeyHashes || []);
  const uniqueResourceKeyHashes = new Set(observedResourceKeyHashes).size;
  const recomputedObservedCoverageHash = sha256(observedResourceKeyHashes);
  const expectedBatchWindowCount = Math.ceil(collection.resourceCount / collection.batchSize);
  const complete = windows.length === collection.batchWindowCount
    && windows.length === expectedBatchWindowCount
    && collection.expectedBatchWindowCount === expectedBatchWindowCount
    && observedResourceKeyHashes.length === collection.resourceCount
    && uniqueResourceKeyHashes === collection.resourceCount
    && collection.uniqueResourceKeyHashes === uniqueResourceKeyHashes
    && collection.totalWindowResources === observedResourceKeyHashes.length
    && collection.observedCoverageHash === recomputedObservedCoverageHash
    && collection.observedCoverageHash === collection.expectedCoverageHash;

  return {
    complete,
    batchWindowCount: windows.length,
    recordedBatchWindowCount: collection.batchWindowCount,
    expectedBatchWindowCount,
    observedResourceKeyHashes: observedResourceKeyHashes.length,
    uniqueResourceKeyHashes,
    recomputedObservedCoverageHash,
    recordedObservedCoverageHash: collection.observedCoverageHash,
    expectedCoverageHash: collection.expectedCoverageHash,
  };
}

function resourceCountMetrics(evidence, windows) {
  const windowResourceTotal = windows.reduce((sum, window) => sum + window.resourceCount, 0);
  const windowPreconditionTotal = windows.reduce((sum, window) => sum + window.preconditionCount, 0);
  const collection = evidence.batchCollection || {};
  const dryRun = evidence.resources?.dryRun || {};

  return {
    match: windowResourceTotal === collection.resourceCount
      && windowPreconditionTotal === collection.totalWindowPreconditions
      && dryRun.totalResources === collection.resourceCount
      && dryRun.totalPreconditions === collection.totalWindowPreconditions
      && dryRun.batches === collection.batchWindowCount,
    windowResourceTotal,
    collectionResourceCount: collection.resourceCount,
    dryRunTotalResources: dryRun.totalResources,
    windowPreconditionTotal,
    collectionPreconditions: collection.totalWindowPreconditions,
    dryRunTotalPreconditions: dryRun.totalPreconditions,
    dryRunBatches: dryRun.batches,
    collectionBatchWindowCount: collection.batchWindowCount,
  };
}

function unsafeBatchEvidenceDecisions(evidence, repeatedEvidence) {
  const staleBatchHash = withPassedStatus(clone(evidence));
  staleBatchHash.batchCollection.batchWindows[1].batchWindowHash = sha256('rpp-0732-stale-batch-hash');

  const missingBatchWindow = withPassedStatus(clone(evidence));
  missingBatchWindow.batchCollection.batchWindows.splice(2, 1);

  const mismatchedResourceCounts = withPassedStatus(clone(evidence));
  mismatchedResourceCounts.batchCollection.resourceCount += 1;

  const prematurePassStatus = withPassedStatus(clone(evidence));
  prematurePassStatus.correctnessGates = [];

  return {
    staleBatchHash: resolveDryRunBatchSizingProof(staleBatchHash, { repeatedEvidence }),
    missingBatchWindow: resolveDryRunBatchSizingProof(missingBatchWindow, { repeatedEvidence }),
    mismatchedResourceCounts: resolveDryRunBatchSizingProof(mismatchedResourceCounts, { repeatedEvidence }),
    prematurePassStatus: resolveDryRunBatchSizingProof(prematurePassStatus, { repeatedEvidence }),
  };
}

function publicBenchmarkProjection(benchmark) {
  return {
    benchmark: benchmark.benchmark,
    ok: benchmark.ok,
    mode: benchmark.mode,
    profile: benchmark.profile,
    limits: benchmark.limits,
    dryRun: benchmark.resources.dryRun,
    storageGuardProjection: benchmark.resources.storageGuardProjection,
    gates: benchmark.gates.map((gate) => ({
      id: gate.id,
      status: gate.status,
    })),
  };
}

function publicBatchEvidenceProjection(evidence) {
  return {
    rppId: evidence.rppId,
    proofId: evidence.proofId,
    variant: evidence.variant,
    builtOn: evidence.builtOn,
    batchCollection: evidence.batchCollection,
    storageGuard: evidence.storageGuard,
    release: evidence.release,
  };
}

function batchCollectionCore(collection) {
  return {
    planHash: collection.planHash,
    resourceCount: collection.resourceCount,
    batchSize: collection.batchSize,
    limits: collection.limits,
    batchWindowCount: collection.batchWindowCount,
    expectedBatchWindowCount: collection.expectedBatchWindowCount,
    batchStarts: collection.batchStarts,
    batchEnds: collection.batchEnds,
    batchSizes: collection.batchSizes,
    totalWindowResources: collection.totalWindowResources,
    totalWindowPreconditions: collection.totalWindowPreconditions,
    uniqueResourceKeyHashes: collection.uniqueResourceKeyHashes,
    expectedCoverageHash: collection.expectedCoverageHash,
    observedCoverageHash: collection.observedCoverageHash,
    planningOnly: collection.planningOnly,
    batchWindows: collection.batchWindows,
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

function buildDryRunFixtureItems({
  fileResources,
  wpPosts,
  wpPostmeta,
  wpOptions,
  pluginMetadataResources,
}) {
  const items = [];
  let sequence = 0;

  for (let index = 0; index < fileResources; index += 1) {
    items.push(fixtureItem({
      sequence: sequence++,
      kind: 'file',
      resourceKey: `file:rpp-0732-fixture-${index}`,
      estimatedBytes: 2_048 + (index * 17),
    }));
  }

  for (const [kind, count, baseBytes] of [
    ['post-row', wpPosts, 720],
    ['postmeta-row', wpPostmeta, 520],
    ['option-row', wpOptions, 680],
  ]) {
    for (let index = 0; index < count; index += 1) {
      items.push(fixtureItem({
        sequence: sequence++,
        kind,
        resourceKey: `${kind}:rpp-0732-fixture-${index}`,
        estimatedBytes: baseBytes + (index % 5) * 13,
      }));
    }
  }

  for (let index = 0; index < pluginMetadataResources; index += 1) {
    items.push(fixtureItem({
      sequence: sequence++,
      kind: 'plugin-metadata',
      resourceKey: `plugin-metadata:rpp-0732-fixture-${index}`,
      estimatedBytes: 940 + (index * 11),
    }));
  }

  return items;
}

function fixtureItem({ sequence, kind, resourceKey, estimatedBytes }) {
  return {
    itemId: `rpp-0732-dry-run-item-${String(sequence).padStart(5, '0')}`,
    sequence,
    kind,
    table: null,
    resourceKey,
    resourceKeyHash: digest(resourceKey),
    atomicGroupId: null,
    estimatedBytes,
    preconditionCount: 1,
    expectedHash: sha256({ resourceKey, phase: 'expected-storage' }),
    plannedHash: sha256({ resourceKey, phase: 'planned-storage' }),
    validatesOnly: true,
    applyAuthorization: false,
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

function assertHashOnlyBatchEvidence(value) {
  assert.equal(dryRunBatchEvidenceHasNoRawValues(value), true);
}

function dryRunBatchEvidenceHasNoRawValues(value) {
  return !rawDryRunBatchEvidencePattern().test(JSON.stringify(value));
}

function rawDryRunBatchEvidencePattern() {
  return /"resourceKey"\s*:|wp-content|wp_posts|wp_postmeta|wp_options|post_content|option_value|meta_value|private option value|dry-run raw payload|customer secret|rpp-0732-fixture-\d/i;
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
