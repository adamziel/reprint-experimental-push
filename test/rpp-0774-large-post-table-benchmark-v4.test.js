import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LARGE_POST_TABLE_BENCHMARK_ID,
  runLargePostTableBenchmark,
} from '../scripts/bench/large-post-table-benchmark.js';
import { digest } from '../src/stable-json.js';

const proofId = 'rpp-0774-large-post-table-benchmark-v4';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const maxDurationMs = 15_000;
const maxHeapUsedBytes = 256 * 1024 * 1024;
const expectedGateIds = Object.freeze([
  'benchmark-gates-pass',
  'documented-large-site-budget',
  'live-remote-storage-preconditions',
  'ordered-primary-key-window-coverage',
  'row-window-hashes-match',
  'generated-large-site-coverage-complete',
  'generated-coverage-hashes-match',
  'deterministic-large-site-coverage-repeatable',
  'apply-verification-complete',
  'hash-count-only-storage-performance-evidence',
  'support-only-release-no-go',
]);
const hexSha256Pattern = /^[a-f0-9]{64}$/;
const sha256Pattern = /^sha256:[a-f0-9]{64}$/;
let recordedLargeSiteEvidencePair;

test('RPP-0774 variant 4 proves repeated generated large post table coverage stays inside budgets', {
  concurrency: false,
}, () => {
  const proof = buildVariant4Proof();

  assert.equal(proof.rppId, 'RPP-0774');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 4);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.builtOn.rppId, 'RPP-0714');
  assert.equal(proof.builtOn.previousVariantRppId, 'RPP-0754');
  assert.equal(proof.builtOn.previousVariantProofId, 'rpp-0754-large-post-table-benchmark-v3');
  assert.equal(proof.builtOn.previousVariant, 3);
  assert.equal(proof.builtOn.benchmark, LARGE_POST_TABLE_BENCHMARK_ID);
  assert.equal(proof.builtOn.ok, true);
  assert.equal(proof.builtOn.profile, 'large-site');
  assert.match(proof.builtOn.evidenceHash, hexSha256Pattern);

  assert.equal(proof.runtime.generatedAt, fixedNow.toISOString());
  assert.equal(proof.runtime.budgets.profile, 'large-site');
  assert.equal(proof.runtime.budgets.maxDurationMs, maxDurationMs);
  assert.equal(proof.runtime.budgets.maxHeapUsedBytes, maxHeapUsedBytes);
  assert.equal(proof.runtime.durationMs <= proof.runtime.budgets.maxDurationMs, true);
  assert.equal(proof.resources.process.heapUsedBytes <= proof.runtime.budgets.maxHeapUsedBytes, true);

  assert.equal(proof.resources.table.engine, 'in-memory-wordpress-site-fixture');
  assert.equal(proof.resources.table.table, 'wp_posts');
  assert.equal(proof.resources.table.totalRows, 20_000);
  assert.equal(proof.resources.table.changedRows, 10_000);
  assert.equal(proof.resources.table.unchangedRows, 10_000);
  assert.equal(proof.resources.table.mutationRows, 10_000);
  assert.equal(proof.resources.table.storageBoundary, 'live-remote-hash-precondition-before-apply');
  assert.equal(proof.resources.preconditions.expected, 10_000);
  assert.equal(proof.resources.preconditions.recorded, 10_000);
  assert.equal(proof.resources.preconditions.liveRemote, 10_000);
  assert.equal(proof.resources.preconditions.everyMutationHasLivePrecondition, true);
  assert.equal(proof.resources.apply.appliedMutations, 10_000);
  assert.equal(proof.resources.apply.changedRowsVerified, 10_000);
  assert.equal(proof.resources.apply.unchangedSamplesVerified, 3);
  assert.equal(proof.resources.apply.verificationFailures, 0);
  assert.deepEqual([...new Set(proof.benchmark.gates.map((gate) => gate.status))], ['pass']);

  assert.equal(proof.batchCollection.table, 'wp_posts');
  assert.equal(proof.batchCollection.plannedRows, 10_000);
  assert.equal(proof.batchCollection.observedRows, 10_000);
  assert.equal(proof.batchCollection.batchSizeRows, 500);
  assert.equal(proof.batchCollection.batchWindowCount, 20);
  assert.equal(proof.batchCollection.expectedBatchWindowCount, 20);
  assert.equal(proof.batchCollection.maxObservedBatchRows, 500);
  assert.equal(proof.batchCollection.duplicatePostIds, 0);
  assert.equal(proof.batchCollection.monotonicPrimaryKeyOrder, true);
  assert.equal(proof.batchCollection.allRowsCoveredOnce, true);
  assert.equal(proof.batchCollection.everyBatchWithinLimit, true);
  assert.deepEqual(proof.batchCollection.firstPostIds.slice(0, 3), [1, 501, 1001]);
  assert.deepEqual(proof.batchCollection.lastPostIds.slice(-3), [9000, 9500, 10000]);
  assert.equal(proof.batchCollection.batchSizes.every((size) => size === 500), true);
  assert.equal(proof.batchCollection.observedWindowBoundsHash, proof.batchCollection.expectedWindowBoundsHash);
  assert.match(proof.batchCollection.collectionSummaryHash, sha256Pattern);
  assert.match(proof.batchCollection.outputHash, sha256Pattern);

  assert.equal(proof.generatedCoverage.profile, 'large-site');
  assert.equal(proof.generatedCoverage.workload.table, 'wp_posts');
  assert.equal(proof.generatedCoverage.workload.totalRows, 20_000);
  assert.equal(proof.generatedCoverage.workload.changedRows, 10_000);
  assert.equal(proof.generatedCoverage.workload.batchSizeRows, 500);
  assert.equal(proof.generatedCoverage.plan.status, 'ready');
  assert.equal(proof.generatedCoverage.plan.mutations, 10_000);
  assert.equal(proof.generatedCoverage.plan.conflicts, 0);
  assert.equal(proof.generatedCoverage.plan.blockers, 0);
  assert.equal(proof.generatedCoverage.batchCoverage.plannedRows, 10_000);
  assert.equal(proof.generatedCoverage.batchCoverage.observedRows, 10_000);
  assert.equal(proof.generatedCoverage.batchCoverage.batches, 20);
  assert.equal(proof.generatedCoverage.batchCoverage.duplicatePostIds, 0);
  assert.equal(proof.generatedCoverage.batchCoverage.monotonicPrimaryKeyOrder, true);
  assert.equal(proof.generatedCoverage.batchCoverage.everyBatchWithinLimit, true);
  assert.equal(proof.generatedCoverage.batchWindows.length, 20);
  assert.equal(proof.generatedCoverage.hashOnlySamples.changedRowCount, 5);
  assert.equal(proof.generatedCoverage.hashOnlySamples.unchangedRowCount, 3);
  assert.equal(proof.generatedCoverage.failures.count, 0);
  assert.equal(proof.generatedCoverage.redaction.rawValueEvidenceLeaks, 0);
  assert.match(proof.generatedCoverage.windowDigestHash, sha256Pattern);
  assert.match(proof.generatedCoverage.hashOnlySampleHash, sha256Pattern);
  assert.match(proof.generatedCoverage.coverageHash, sha256Pattern);
  assert.ok(proof.generatedCoverage.batchWindows.every((window) => window.windowHash.match(sha256Pattern)));
  assert.ok(proof.generatedCoverage.hashOnlySamples.changedRows.every(sampleHashesAreHex));
  assert.ok(proof.generatedCoverage.hashOnlySamples.unchangedRows.every(sampleHashesAreHex));

  assert.equal(proof.deterministic.profile, 'large-site');
  assert.equal(proof.deterministic.projectionScope, 'runtime-free-count-hash-only');
  assert.equal(proof.deterministic.repeatMatch, true);
  assert.equal(proof.deterministic.currentHash, proof.deterministic.repeatedHash);
  assert.match(proof.deterministic.currentHash, hexSha256Pattern);

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
    'pass',
  ]);
  assert.equal(proof.correctness.correctnessGatesRecordedBeforeOutput, true);
  assert.equal(proof.correctness.correctnessGatesHoldBeforeOutput, true);
  assert.equal(proof.correctness.hashCountOnlyPerformanceOutput, true);
  assert.equal(proof.correctness.performanceOutputEmittedAfterGates, true);
  assert.deepEqual(proof.gates.map((gate) => gate.status), [
    'pass',
    'pass',
    'pass',
    'pass',
  ]);

  assert.equal(proof.unsafe.overBudget.updated, false);
  assert.equal(proof.unsafe.overBudget.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.overBudget.blockedBy.includes('documented-large-site-budget'));
  assert.equal(proof.unsafe.missingWindow.updated, false);
  assert.equal(proof.unsafe.missingWindow.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.missingWindow.blockedBy.includes('ordered-primary-key-window-coverage'));
  assert.equal(proof.unsafe.staleWindowHash.updated, false);
  assert.equal(proof.unsafe.staleWindowHash.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.staleWindowHash.blockedBy.includes('row-window-hashes-match'));
  assert.equal(proof.unsafe.rawValueLeak.updated, false);
  assert.equal(proof.unsafe.rawValueLeak.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.rawValueLeak.blockedBy.includes('hash-count-only-storage-performance-evidence'));
  assert.equal(proof.unsafe.deterministicMismatch.updated, false);
  assert.equal(proof.unsafe.deterministicMismatch.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.deterministicMismatch.blockedBy.includes('deterministic-large-site-coverage-repeatable'));
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
  assertHashCountOnlyLargePostEvidence(proof);
});

test('RPP-0774 variant 4 fails closed for unsafe generated large post table evidence', () => {
  const { evidence, repeatedEvidence } = buildRecordedEvidencePair(smallLargeSiteOptions());
  const safeDecision = resolveLargePostTableStoragePerformanceProof(evidence, { repeatedEvidence });
  const unsafeDecisions = unsafeEvidenceDecisions(evidence, repeatedEvidence);

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
    'pass',
  ]);
  assert.equal(unsafeDecisions.overBudget.updated, false);
  assert.ok(unsafeDecisions.overBudget.blockedBy.includes('documented-large-site-budget'));
  assert.equal(unsafeDecisions.missingWindow.updated, false);
  assert.ok(unsafeDecisions.missingWindow.blockedBy.includes('ordered-primary-key-window-coverage'));
  assert.equal(unsafeDecisions.staleWindowHash.updated, false);
  assert.ok(unsafeDecisions.staleWindowHash.blockedBy.includes('row-window-hashes-match'));
  assert.equal(unsafeDecisions.rawValueLeak.updated, false);
  assert.ok(unsafeDecisions.rawValueLeak.blockedBy.includes('hash-count-only-storage-performance-evidence'));
  assert.equal(unsafeDecisions.deterministicMismatch.updated, false);
  assert.ok(unsafeDecisions.deterministicMismatch.blockedBy.includes('deterministic-large-site-coverage-repeatable'));
  assert.equal(unsafeDecisions.prematurePassStatus.updated, false);
  assert.ok(unsafeDecisions.prematurePassStatus.blockedBy.includes('correctness-gates-not-recorded'));

  for (const decision of Object.values(unsafeDecisions)) {
    assert.equal(decision.output, null);
    assert.equal(decision.outputEmitted, false);
    assert.equal(decision.attemptedPassBlocked, true);
    assert.match(decision.decisionHash, hexSha256Pattern);
  }
});

function buildVariant4Proof() {
  const { benchmark, evidence, repeatedEvidence } = buildRecordedLargeSiteEvidencePair();
  const safeDecision = resolveLargePostTableStoragePerformanceProof(evidence, { repeatedEvidence });
  const unsafe = projectUnsafeDecisions(unsafeEvidenceDecisions(evidence, repeatedEvidence));
  const correctnessGatesRecordedBeforeOutput = objectKeyBefore(
    evidence,
    'correctnessGates',
    'batchCollection',
  );
  const benchmarkGatesPass = benchmark.ok && benchmark.gates.every((gate) => gate.status === 'pass');
  const supportOnlyRelease = supportOnlyReleasePosture();
  const proofGates = [
    proofGate('benchmark-large-site-budget-gates-pass', benchmarkGatesPass
      && benchmark.profile === 'large-site'
      && benchmark.runtime.budgets.profile === 'large-site'
      && benchmark.runtime.durationMs <= benchmark.runtime.budgets.maxDurationMs
      && benchmark.resources.process.heapUsedBytes <= benchmark.runtime.budgets.maxHeapUsedBytes, {
      benchmarkGateStatuses: benchmark.gates.map((gate) => gate.status),
      profile: benchmark.profile,
      durationBudgetHash: sha256({
        durationMs: benchmark.runtime.durationMs,
        maxDurationMs: benchmark.runtime.budgets.maxDurationMs,
      }),
      heapBudgetHash: sha256({
        heapUsedBytes: benchmark.resources.process.heapUsedBytes,
        maxHeapUsedBytes: benchmark.runtime.budgets.maxHeapUsedBytes,
      }),
    }),
    proofGate('generated-coverage-output-after-correctness-gates', safeDecision.updated
      && safeDecision.outputEmitted
      && correctnessGatesRecordedBeforeOutput
      && safeDecision.recomputedGates
        .filter((gate) => [
          'generated-large-site-coverage-complete',
          'generated-coverage-hashes-match',
          'deterministic-large-site-coverage-repeatable',
        ].includes(gate.id))
        .every((gate) => gate.status === 'pass'), {
      outputEmitted: safeDecision.outputEmitted,
      correctnessGatesRecordedBeforeOutput,
      blockedBy: safeDecision.blockedBy,
    }),
    proofGate('unsafe-generated-coverage-evidence-fails-closed', Object.values(unsafe).every((decision) => (
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
    rppId: 'RPP-0774',
    proofId,
    variant: 4,
    status: proofGates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed',
    builtOn: {
      rppId: 'RPP-0714',
      previousVariantRppId: 'RPP-0754',
      previousVariantProofId: 'rpp-0754-large-post-table-benchmark-v3',
      previousVariant: 3,
      benchmark: benchmark.benchmark,
      ok: benchmark.ok,
      profile: benchmark.profile,
      evidenceHash: digest(publicBenchmarkProjection(benchmark)),
    },
    runtime: evidence.runtime,
    resources: evidence.resources,
    benchmark: publicBenchmarkProjection(benchmark),
    batchCollection: {
      ...evidence.batchCollection,
      outputHash: safeDecision.outputHash,
    },
    generatedCoverage: evidence.generatedCoverage,
    deterministic: deterministicRepeatEvidence(evidence, repeatedEvidence),
    correctness: {
      gateIds: evidence.correctnessGates.map((gate) => gate.id),
      recomputedGateVector: safeDecision.recomputedGates,
      correctnessGatesRecordedBeforeOutput,
      correctnessGatesHoldBeforeOutput: safeDecision.correctnessGatesHold,
      hashCountOnlyPerformanceOutput: safeDecision.hashCountOnlyPerformanceOutput,
      performanceOutputEmittedAfterGates: safeDecision.outputEmitted,
    },
    unsafe,
    gates: proofGates,
    release: supportOnlyRelease,
    redaction: {
      mode: 'hash-count-only-generated-large-post-coverage',
      rawValueEvidenceLeaks: largePostStorageEvidenceHasNoRawValues(evidence) ? 0 : 1,
      publicEvidenceHash: digest(publicStoragePerformanceProjection(evidence)),
      laneDecisionHash: safeDecision.decisionHash,
    },
  };

  return {
    ...publicProof,
    evidenceHash: digest(publicProof),
  };
}

function buildRecordedLargeSiteEvidencePair() {
  if (!recordedLargeSiteEvidencePair) {
    recordedLargeSiteEvidencePair = buildRecordedEvidencePair({
      profile: 'large-site',
      now: fixedNow,
    });
  }

  return recordedLargeSiteEvidencePair;
}

function buildRecordedEvidencePair(options) {
  const current = buildPendingEvidence(options);
  const repeated = buildPendingEvidence(options);

  recordCorrectnessGates(current.evidence, { repeatedEvidence: repeated.evidence });
  recordCorrectnessGates(repeated.evidence, { repeatedEvidence: current.evidence });
  return {
    benchmark: current.benchmark,
    repeatedBenchmark: repeated.benchmark,
    evidence: current.evidence,
    repeatedEvidence: repeated.evidence,
  };
}

function buildPendingEvidence(options) {
  const benchmark = runLargePostTableBenchmark(options);
  return {
    benchmark,
    evidence: buildStoragePerformanceEvidence({ benchmark }),
  };
}

function smallLargeSiteOptions() {
  return {
    profile: 'large-site',
    now: fixedNow,
    tableRows: 96,
    changedRows: 48,
    batchSizeRows: 12,
    maxDurationMs: 5_000,
    maxHeapUsedBytes: 256 * 1024 * 1024,
  };
}

function buildStoragePerformanceEvidence({ benchmark }) {
  return {
    schemaVersion: 1,
    rppId: 'RPP-0774',
    proofId,
    variant: 4,
    status: 'pending',
    builtOn: {
      rppId: 'RPP-0714',
      previousVariantRppId: 'RPP-0754',
      previousVariantProofId: 'rpp-0754-large-post-table-benchmark-v3',
      previousVariant: 3,
      benchmark: benchmark.benchmark,
      profile: benchmark.profile,
      evidenceHash: digest(publicBenchmarkProjection(benchmark)),
    },
    benchmark: publicBenchmarkProjection(benchmark),
    correctnessGates: [],
    runtime: {
      generatedAt: benchmark.runtime.generatedAt,
      durationMs: benchmark.runtime.durationMs,
      timings: benchmark.runtime.timings,
      budgets: benchmark.runtime.budgets,
    },
    resources: {
      table: benchmark.resources.table,
      batchSizing: benchmark.resources.batchSizing,
      preconditions: benchmark.resources.preconditions,
      apply: benchmark.resources.apply,
      process: benchmark.resources.process,
    },
    batchCollection: collectPostBatchWindowEvidence(benchmark),
    generatedCoverage: collectGeneratedCoverageEvidence(benchmark),
    release: supportOnlyReleasePosture(),
  };
}

function recordCorrectnessGates(evidence, options = {}) {
  const gates = recomputeLargePostTableProofGates(evidence, options);
  evidence.correctnessGates = gates.map((gate) => ({
    id: gate.id,
    status: gate.status === 'pass' ? 'passed' : 'failed',
    evidenceHash: digest(gate.metrics),
  }));
  evidence.status = gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed';
  return evidence;
}

function collectPostBatchWindowEvidence(benchmark) {
  const coverage = benchmark.deterministicCoverage.batchCoverage;
  const batchWindows = benchmark.deterministicCoverage.batchWindows.map(postBatchWindowSummary);
  const observedWindowBounds = batchWindows.map(batchWindowBounds);
  const expectedWindowBounds = expectedPrimaryKeyWindowBounds({
    plannedRows: coverage.plannedRows,
    batchSizeRows: coverage.batchSizeRows,
  });
  const collectionCore = {
    table: coverage.table,
    batchSizeRows: coverage.batchSizeRows,
    plannedRows: coverage.plannedRows,
    observedRows: coverage.observedRows,
    batchWindowCount: batchWindows.length,
    expectedBatchWindowCount: Math.ceil(coverage.plannedRows / coverage.batchSizeRows),
    firstPostIds: batchWindows.map((window) => window.firstPostId),
    lastPostIds: batchWindows.map((window) => window.lastPostId),
    batchSizes: batchWindows.map((window) => window.rowCount),
    totalWindowPreconditions: batchWindows.reduce((sum, window) => sum + window.preconditionCount, 0),
    maxObservedBatchRows: coverage.maxObservedBatchRows,
    duplicatePostIds: coverage.duplicatePostIds,
    monotonicPrimaryKeyOrder: coverage.monotonicPrimaryKeyOrder,
    allRowsCoveredOnce: coverage.allRowsCoveredOnce,
    everyBatchWithinLimit: coverage.everyBatchWithinLimit,
    expectedWindowBoundsHash: sha256(expectedWindowBounds),
    observedWindowBoundsHash: sha256(observedWindowBounds),
    batchWindows,
  };

  return {
    ...collectionCore,
    collectionSummaryHash: sha256(collectionCore),
  };
}

function collectGeneratedCoverageEvidence(benchmark) {
  const coverage = benchmark.deterministicCoverage;
  const batchWindows = coverage.batchWindows.map(postBatchWindowSummary);
  const hashOnlySamples = {
    changedRowCount: coverage.hashOnlySamples.changedRows.length,
    unchangedRowCount: coverage.hashOnlySamples.unchangedRows.length,
    changedRows: coverage.hashOnlySamples.changedRows.map(changedSampleSummary),
    unchangedRows: coverage.hashOnlySamples.unchangedRows.map(unchangedSampleSummary),
  };
  const coverageCore = {
    profile: coverage.profile,
    workload: coverage.workload,
    plan: {
      status: coverage.plan.status,
      mutations: coverage.plan.mutations,
      conflicts: coverage.plan.conflicts,
      blockers: coverage.plan.blockers,
      decisions: coverage.plan.decisions,
    },
    batchCoverage: coverage.batchCoverage,
    batchWindows,
    hashOnlySamples,
    failures: {
      count: coverage.failures.length,
      hash: sha256(coverage.failures),
    },
    redaction: coverage.redaction,
  };

  return {
    ...coverageCore,
    windowDigestHash: sha256(batchWindows),
    hashOnlySampleHash: sha256(hashOnlySamples),
    coverageHash: sha256(coverageCore),
  };
}

function postBatchWindowSummary(batch) {
  const core = {
    batchIndex: batch.batchIndex,
    batchIdHash: sha256(batch.batchId),
    table: batch.table,
    rowCount: batch.rowCount,
    firstPostId: batch.firstPostId,
    lastPostId: batch.lastPostId,
    preconditionCount: batch.preconditionCount,
    rowHashDigest: batch.rowHashDigest,
  };

  return {
    ...core,
    windowHash: sha256(core),
  };
}

function changedSampleSummary(sample) {
  return {
    postId: sample.postId,
    resourceKeyHash: sample.resourceKeyHash,
    remoteBeforeHash: sample.remoteBeforeHash,
    appliedHash: sample.appliedHash,
    localHash: sample.localHash,
  };
}

function unchangedSampleSummary(sample) {
  return {
    postId: sample.postId,
    resourceKeyHash: sample.resourceKeyHash,
    appliedHash: sample.appliedHash,
    remoteHash: sample.remoteHash,
  };
}

function resolveLargePostTableStoragePerformanceProof(evidence, options = {}) {
  const recomputedGates = recomputeLargePostTableProofGates(evidence, options);
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
        runtimeBudgetHash: sha256({
          durationMs: evidence.runtime.durationMs,
          heapUsedBytes: evidence.resources.process.heapUsedBytes,
          budgets: evidence.runtime.budgets,
        }),
        batchCollectionHash: evidence.batchCollection.collectionSummaryHash,
        generatedCoverageHash: evidence.generatedCoverage.coverageHash,
        generatedWindowHash: evidence.generatedCoverage.windowDigestHash,
        generatedSampleHash: evidence.generatedCoverage.hashOnlySampleHash,
        deterministicEvidenceHash: digest(deterministicLargePostEvidenceProjection(evidence)),
        deterministicRepeatHash: options.repeatedEvidence
          ? digest(deterministicLargePostEvidenceProjection(options.repeatedEvidence))
          : null,
        observedWindowBoundsHash: evidence.batchCollection.observedWindowBoundsHash,
        expectedWindowBoundsHash: evidence.batchCollection.expectedWindowBoundsHash,
        storageBoundaryHash: sha256(evidence.resources.table.storageBoundary),
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
    hashCountOnlyPerformanceOutput: output ? largePostStorageEvidenceHasNoRawValues(output) : false,
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

function recomputeLargePostTableProofGates(evidence, options = {}) {
  const runtime = evidence.runtime || {};
  const resources = evidence.resources || {};
  const table = resources.table || {};
  const batchSizing = resources.batchSizing || {};
  const preconditions = resources.preconditions || {};
  const apply = resources.apply || {};
  const processResources = resources.process || {};
  const collection = evidence.batchCollection || {};
  const windows = Array.isArray(collection.batchWindows) ? collection.batchWindows : [];
  const benchmarkGateStatuses = Array.isArray(evidence.benchmark?.gates)
    ? evidence.benchmark.gates.map((gate) => gate.status)
    : [];
  const benchmarkGatesPass = evidence.benchmark?.ok === true
    && benchmarkGateStatuses.length > 0
    && benchmarkGateStatuses.every((status) => status === 'pass');
  const largeSiteBudgetPass = evidence.benchmark?.profile === 'large-site'
    && runtime.budgets?.profile === 'large-site'
    && runtime.durationMs <= runtime.budgets?.maxDurationMs
    && processResources.heapUsedBytes <= runtime.budgets?.maxHeapUsedBytes;
  const storagePreconditionsPass = table.table === 'wp_posts'
    && table.storageBoundary === 'live-remote-hash-precondition-before-apply'
    && table.applyMode === 'applyPlan-live-precondition-row-mutations'
    && table.changedRows === table.mutationRows
    && preconditions.expected === table.changedRows
    && preconditions.recorded === table.changedRows
    && preconditions.liveRemote === table.changedRows
    && preconditions.everyMutationHasLivePrecondition === true;
  const order = primaryKeyWindowCoverageMetrics(collection, windows, batchSizing);
  const hashMetrics = rowWindowHashMetrics(collection, windows);
  const generatedCoverage = generatedCoverageMetrics(evidence, collection, table);
  const deterministicRepeat = deterministicRepeatEvidence(evidence, options.repeatedEvidence);
  const applyVerificationPass = apply.appliedMutations === table.mutationRows
    && apply.changedRowsVerified === table.changedRows
    && apply.verificationFailures === 0
    && apply.unchangedSamplesVerified > 0;
  const release = evidence.release || {};

  return [
    proofGate('benchmark-gates-pass', benchmarkGatesPass, {
      benchmarkGateStatuses,
      benchmarkOk: evidence.benchmark?.ok,
    }),
    proofGate('documented-large-site-budget', largeSiteBudgetPass, {
      profile: evidence.benchmark?.profile,
      budgetProfile: runtime.budgets?.profile,
      durationMs: runtime.durationMs,
      maxDurationMs: runtime.budgets?.maxDurationMs,
      heapUsedBytes: processResources.heapUsedBytes,
      maxHeapUsedBytes: runtime.budgets?.maxHeapUsedBytes,
    }),
    proofGate('live-remote-storage-preconditions', storagePreconditionsPass, {
      storageBoundary: table.storageBoundary,
      applyMode: table.applyMode,
      changedRows: table.changedRows,
      mutationRows: table.mutationRows,
      preconditions,
    }),
    proofGate('ordered-primary-key-window-coverage', order.complete, order),
    proofGate('row-window-hashes-match', hashMetrics.match, hashMetrics),
    proofGate('generated-large-site-coverage-complete', generatedCoverage.complete, generatedCoverage),
    proofGate('generated-coverage-hashes-match', generatedCoverage.hashesMatch, generatedCoverage),
    proofGate('deterministic-large-site-coverage-repeatable', deterministicRepeat.repeatMatch, deterministicRepeat),
    proofGate('apply-verification-complete', applyVerificationPass, {
      appliedMutations: apply.appliedMutations,
      expectedMutations: table.mutationRows,
      changedRowsVerified: apply.changedRowsVerified,
      expectedChangedRows: table.changedRows,
      unchangedSamplesVerified: apply.unchangedSamplesVerified,
      verificationFailures: apply.verificationFailures,
    }),
    proofGate('hash-count-only-storage-performance-evidence', largePostStorageEvidenceHasNoRawValues({
      runtime,
      resources,
      batchCollection: collection,
      generatedCoverage: evidence.generatedCoverage,
    }), {
      rawValueEvidenceLeaks: largePostStorageEvidenceHasNoRawValues({
        runtime,
        resources,
        batchCollection: collection,
        generatedCoverage: evidence.generatedCoverage,
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

function primaryKeyWindowCoverageMetrics(collection, windows, batchSizing) {
  const plannedRows = Number(collection.plannedRows);
  const batchSizeRows = Number(collection.batchSizeRows);
  const expectedWindowBounds = Number.isInteger(plannedRows) && Number.isInteger(batchSizeRows) && batchSizeRows > 0
    ? expectedPrimaryKeyWindowBounds({ plannedRows, batchSizeRows })
    : [];
  const observedWindowBounds = windows.map(batchWindowBounds);
  const observedRows = windows.reduce((sum, window) => sum + window.rowCount, 0);
  const observedPreconditions = windows.reduce((sum, window) => sum + window.preconditionCount, 0);
  const expectedWindowBoundsHash = sha256(expectedWindowBounds);
  const observedWindowBoundsHash = sha256(observedWindowBounds);
  let indexMismatchCount = 0;
  let firstPostMismatchCount = 0;
  let lastPostMismatchCount = 0;
  let preconditionMismatchCount = 0;
  let emptyWindowCount = 0;
  let expectedFirstPostId = 1;

  windows.forEach((window, index) => {
    if (window.batchIndex !== index) {
      indexMismatchCount += 1;
    }
    if (window.firstPostId !== expectedFirstPostId) {
      firstPostMismatchCount += 1;
    }
    if (window.lastPostId !== window.firstPostId + window.rowCount - 1) {
      lastPostMismatchCount += 1;
    }
    if (window.preconditionCount !== window.rowCount) {
      preconditionMismatchCount += 1;
    }
    if (window.rowCount <= 0) {
      emptyWindowCount += 1;
    }
    expectedFirstPostId = window.lastPostId + 1;
  });

  const expectedBatchWindowCount = Number.isInteger(plannedRows) && Number.isInteger(batchSizeRows) && batchSizeRows > 0
    ? Math.ceil(plannedRows / batchSizeRows)
    : 0;
  const complete = windows.length === collection.batchWindowCount
    && windows.length === collection.expectedBatchWindowCount
    && windows.length === expectedBatchWindowCount
    && observedRows === collection.observedRows
    && observedRows === collection.plannedRows
    && observedPreconditions === collection.totalWindowPreconditions
    && collection.batchWindowCount === batchSizing.batchCount
    && collection.maxObservedBatchRows === batchSizing.maxObservedBatchRows
    && collection.observedRows === batchSizing.observedRows
    && collection.duplicatePostIds === 0
    && collection.monotonicPrimaryKeyOrder === true
    && collection.allRowsCoveredOnce === true
    && collection.everyBatchWithinLimit === true
    && observedWindowBoundsHash === collection.observedWindowBoundsHash
    && expectedWindowBoundsHash === collection.expectedWindowBoundsHash
    && observedWindowBoundsHash === expectedWindowBoundsHash
    && indexMismatchCount === 0
    && firstPostMismatchCount === 0
    && lastPostMismatchCount === 0
    && preconditionMismatchCount === 0
    && emptyWindowCount === 0;

  return {
    complete,
    batchWindowCount: windows.length,
    recordedBatchWindowCount: collection.batchWindowCount,
    expectedBatchWindowCount,
    observedRows,
    recordedObservedRows: collection.observedRows,
    plannedRows: collection.plannedRows,
    observedPreconditions,
    totalWindowPreconditions: collection.totalWindowPreconditions,
    maxObservedBatchRows: collection.maxObservedBatchRows,
    batchSizingBatchCount: batchSizing.batchCount,
    duplicatePostIds: collection.duplicatePostIds,
    monotonicPrimaryKeyOrder: collection.monotonicPrimaryKeyOrder,
    allRowsCoveredOnce: collection.allRowsCoveredOnce,
    everyBatchWithinLimit: collection.everyBatchWithinLimit,
    observedWindowBoundsHash,
    recordedObservedWindowBoundsHash: collection.observedWindowBoundsHash,
    expectedWindowBoundsHash,
    recordedExpectedWindowBoundsHash: collection.expectedWindowBoundsHash,
    indexMismatchCount,
    firstPostMismatchCount,
    lastPostMismatchCount,
    preconditionMismatchCount,
    emptyWindowCount,
    terminalPostId: windows.at(-1)?.lastPostId ?? null,
  };
}

function rowWindowHashMetrics(collection, windows) {
  const mismatchedWindowIndexes = windows
    .filter((window) => window.windowHash !== sha256(batchWindowCore(window)))
    .map((window) => window.batchIndex);
  const collectionSummaryHashMatches = collection.collectionSummaryHash === sha256(batchCollectionCore(collection));

  return {
    match: mismatchedWindowIndexes.length === 0 && collectionSummaryHashMatches,
    mismatchedWindowIndexes,
    collectionSummaryHashMatches,
  };
}

function generatedCoverageMetrics(evidence, collection, table) {
  const generated = evidence.generatedCoverage || {};
  const windows = Array.isArray(generated.batchWindows) ? generated.batchWindows : [];
  const samples = generated.hashOnlySamples || {};
  const changedSamples = Array.isArray(samples.changedRows) ? samples.changedRows : [];
  const unchangedSamples = Array.isArray(samples.unchangedRows) ? samples.unchangedRows : [];
  const windowDigestHash = sha256(windows);
  const hashOnlySampleHash = sha256(samples);
  const coverageHash = sha256(generatedCoverageCore(generated));
  const hashesMatch = generated.windowDigestHash === windowDigestHash
    && generated.hashOnlySampleHash === hashOnlySampleHash
    && generated.coverageHash === coverageHash
    && windows.every((window) => window.windowHash === sha256(batchWindowCore(window)))
    && changedSamples.every(sampleHashesAreHex)
    && unchangedSamples.every(sampleHashesAreHex);
  const complete = generated.profile === evidence.benchmark?.profile
    && generated.profile === 'large-site'
    && generated.workload?.table === 'wp_posts'
    && generated.workload?.totalRows === table.totalRows
    && generated.workload?.changedRows === table.changedRows
    && generated.workload?.batchSizeRows === collection.batchSizeRows
    && generated.plan?.status === 'ready'
    && generated.plan?.mutations === table.mutationRows
    && generated.plan?.conflicts === 0
    && generated.plan?.blockers === 0
    && generated.batchCoverage?.table === 'wp_posts'
    && generated.batchCoverage?.plannedRows === collection.plannedRows
    && generated.batchCoverage?.observedRows === collection.observedRows
    && generated.batchCoverage?.batches === collection.batchWindowCount
    && generated.batchCoverage?.maxObservedBatchRows === collection.maxObservedBatchRows
    && generated.batchCoverage?.duplicatePostIds === 0
    && generated.batchCoverage?.monotonicPrimaryKeyOrder === true
    && generated.batchCoverage?.allRowsCoveredOnce === true
    && generated.batchCoverage?.everyBatchWithinLimit === true
    && windows.length === collection.batchWindowCount
    && samples.changedRowCount === changedSamples.length
    && samples.unchangedRowCount === unchangedSamples.length
    && changedSamples.length > 0
    && unchangedSamples.length > 0
    && generated.failures?.count === 0
    && generated.redaction?.rawValueEvidenceLeaks === 0;

  return {
    complete,
    hashesMatch,
    profile: generated.profile,
    workloadHash: sha256(generated.workload || {}),
    planHash: sha256(generated.plan || {}),
    batchCoverageHash: sha256(generated.batchCoverage || {}),
    batchWindowCount: windows.length,
    changedSampleCount: changedSamples.length,
    unchangedSampleCount: unchangedSamples.length,
    failureCount: generated.failures?.count,
    redactionLeaks: generated.redaction?.rawValueEvidenceLeaks,
    windowDigestHash,
    recordedWindowDigestHash: generated.windowDigestHash,
    hashOnlySampleHash,
    recordedHashOnlySampleHash: generated.hashOnlySampleHash,
    coverageHash,
    recordedCoverageHash: generated.coverageHash,
  };
}

function deterministicRepeatEvidence(evidence, repeatedEvidence) {
  const currentHash = digest(deterministicLargePostEvidenceProjection(evidence));
  const repeatedHash = repeatedEvidence
    ? digest(deterministicLargePostEvidenceProjection(repeatedEvidence))
    : null;

  return {
    profile: evidence.benchmark?.profile,
    projectionScope: 'runtime-free-count-hash-only',
    repeatMatch: Boolean(repeatedEvidence) && currentHash === repeatedHash,
    currentHash,
    repeatedHash,
  };
}

function deterministicLargePostEvidenceProjection(evidence) {
  return {
    builtOn: evidence.builtOn,
    benchmark: {
      benchmark: evidence.benchmark?.benchmark,
      profile: evidence.benchmark?.profile,
      ok: evidence.benchmark?.ok,
      resources: evidence.benchmark?.resources,
      gates: evidence.benchmark?.gates,
      claims: evidence.benchmark?.claims,
    },
    resources: {
      table: evidence.resources?.table,
      batchSizing: evidence.resources?.batchSizing,
      preconditions: evidence.resources?.preconditions,
      apply: evidence.resources?.apply,
    },
    batchCollection: evidence.batchCollection,
    generatedCoverage: evidence.generatedCoverage,
    release: evidence.release,
  };
}

function unsafeEvidenceDecisions(evidence, repeatedEvidence) {
  const overBudget = withPassedStatus(clone(evidence));
  overBudget.runtime.durationMs = overBudget.runtime.budgets.maxDurationMs + 1;

  const missingWindow = withPassedStatus(clone(evidence));
  missingWindow.batchCollection.batchWindows.splice(1, 1);

  const staleWindowHash = withPassedStatus(clone(evidence));
  staleWindowHash.batchCollection.batchWindows[0].rowHashDigest = digest('rpp-0774-stale-row-window');

  const rawValueLeak = withPassedStatus(clone(evidence));
  rawValueLeak.generatedCoverage.rawFixtureProbe = {
    post_title: 'RPP0714 local post blocked by hash-count-only gate',
  };

  const mismatchedRepeatedEvidence = clone(repeatedEvidence);
  mismatchedRepeatedEvidence.generatedCoverage.batchCoverage.observedRows += 1;

  const prematurePassStatus = withPassedStatus(clone(evidence));
  prematurePassStatus.correctnessGates = [];

  return {
    overBudget: resolveLargePostTableStoragePerformanceProof(overBudget, { repeatedEvidence }),
    missingWindow: resolveLargePostTableStoragePerformanceProof(missingWindow, { repeatedEvidence }),
    staleWindowHash: resolveLargePostTableStoragePerformanceProof(staleWindowHash, { repeatedEvidence }),
    rawValueLeak: resolveLargePostTableStoragePerformanceProof(rawValueLeak, { repeatedEvidence }),
    deterministicMismatch: resolveLargePostTableStoragePerformanceProof(evidence, {
      repeatedEvidence: mismatchedRepeatedEvidence,
    }),
    prematurePassStatus: resolveLargePostTableStoragePerformanceProof(prematurePassStatus, { repeatedEvidence }),
  };
}

function publicBenchmarkProjection(benchmark) {
  return {
    benchmark: benchmark.benchmark,
    profile: benchmark.profile,
    ok: benchmark.ok,
    runtime: {
      generatedAt: benchmark.runtime.generatedAt,
      budgets: benchmark.runtime.budgets,
    },
    resources: {
      table: benchmark.resources.table,
      batchSizing: benchmark.resources.batchSizing,
      preconditions: benchmark.resources.preconditions,
      apply: benchmark.resources.apply,
    },
    gates: benchmark.gates.map((gate) => ({
      id: gate.id,
      status: gate.status,
    })),
    claims: benchmark.claims,
  };
}

function publicStoragePerformanceProjection(evidence) {
  return {
    rppId: evidence.rppId,
    proofId: evidence.proofId,
    variant: evidence.variant,
    builtOn: evidence.builtOn,
    runtime: evidence.runtime,
    resources: evidence.resources,
    batchCollection: evidence.batchCollection,
    generatedCoverage: evidence.generatedCoverage,
    release: evidence.release,
  };
}

function batchCollectionCore(collection) {
  return {
    table: collection.table,
    batchSizeRows: collection.batchSizeRows,
    plannedRows: collection.plannedRows,
    observedRows: collection.observedRows,
    batchWindowCount: collection.batchWindowCount,
    expectedBatchWindowCount: collection.expectedBatchWindowCount,
    firstPostIds: collection.firstPostIds,
    lastPostIds: collection.lastPostIds,
    batchSizes: collection.batchSizes,
    totalWindowPreconditions: collection.totalWindowPreconditions,
    maxObservedBatchRows: collection.maxObservedBatchRows,
    duplicatePostIds: collection.duplicatePostIds,
    monotonicPrimaryKeyOrder: collection.monotonicPrimaryKeyOrder,
    allRowsCoveredOnce: collection.allRowsCoveredOnce,
    everyBatchWithinLimit: collection.everyBatchWithinLimit,
    expectedWindowBoundsHash: collection.expectedWindowBoundsHash,
    observedWindowBoundsHash: collection.observedWindowBoundsHash,
    batchWindows: collection.batchWindows,
  };
}

function generatedCoverageCore(generated) {
  return {
    profile: generated.profile,
    workload: generated.workload,
    plan: generated.plan,
    batchCoverage: generated.batchCoverage,
    batchWindows: generated.batchWindows,
    hashOnlySamples: generated.hashOnlySamples,
    failures: generated.failures,
    redaction: generated.redaction,
  };
}

function batchWindowCore(window) {
  return {
    batchIndex: window.batchIndex,
    batchIdHash: window.batchIdHash,
    table: window.table,
    rowCount: window.rowCount,
    firstPostId: window.firstPostId,
    lastPostId: window.lastPostId,
    preconditionCount: window.preconditionCount,
    rowHashDigest: window.rowHashDigest,
  };
}

function batchWindowBounds(window) {
  return {
    batchIndex: window.batchIndex,
    rowCount: window.rowCount,
    firstPostId: window.firstPostId,
    lastPostId: window.lastPostId,
    preconditionCount: window.preconditionCount,
  };
}

function expectedPrimaryKeyWindowBounds({ plannedRows, batchSizeRows }) {
  const windows = [];
  for (let offset = 0; offset < plannedRows; offset += batchSizeRows) {
    const firstPostId = offset + 1;
    const rowCount = Math.min(batchSizeRows, plannedRows - offset);
    windows.push({
      batchIndex: windows.length,
      rowCount,
      firstPostId,
      lastPostId: firstPostId + rowCount - 1,
      preconditionCount: rowCount,
    });
  }
  return windows;
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

function assertHashCountOnlyLargePostEvidence(value) {
  assert.equal(largePostStorageEvidenceHasNoRawValues(value), true);
}

function largePostStorageEvidenceHasNoRawValues(value) {
  return !rawLargePostStorageEvidencePattern().test(JSON.stringify(value));
}

function rawLargePostStorageEvidencePattern() {
  return /RPP0714 base post|RPP0714 local post|RPP0714 post body|rpp-0714-post-|post_content|post_title|post_name|guid|option_value|meta_value|Bearer\s+|Basic\s+|https?:\/\/|private option value|customer secret/i;
}

function sampleHashesAreHex(sample) {
  return Object.entries(sample)
    .filter(([key]) => key.endsWith('Hash'))
    .every(([, value]) => hexSha256Pattern.test(value));
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
