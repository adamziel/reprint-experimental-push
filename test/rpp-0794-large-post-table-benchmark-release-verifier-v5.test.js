import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LARGE_POST_TABLE_BENCHMARK_ID,
  runLargePostTableBenchmark,
} from '../scripts/bench/large-post-table-benchmark.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { digest } from '../src/stable-json.js';

const proofId = 'rpp-0794-large-post-table-benchmark-release-verifier-v5';
const evidenceSource = 'large-post-table-benchmark-release-verifier-v5';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const maxDurationMs = 15_000;
const maxHeapUsedBytes = 256 * 1024 * 1024;
const expectedBenchmarkGateIds = Object.freeze([
  'large-post-table-plan-ready',
  'wp-posts-live-preconditions',
  'bounded-primary-key-batches',
  'apply-result-matches-plan',
  'hash-only-evidence',
  'large-site-runtime-budget',
]);
const expectedReleaseVerifierGateIds = Object.freeze([
  'release-verifier-runtime-resources-gates-reported',
  'built-on-large-post-table-benchmark-v4',
  'large-site-benchmark-budget-carried-through',
  'live-remote-post-preconditions-carried-through',
  'ordered-primary-key-window-coverage-carried-through',
  'deterministic-large-post-table-coverage-carried-through',
  'generated-unsafe-large-post-table-cases-fail-closed',
  'release-verifier-carry-through-claimed',
  'hash-count-only-release-verifier-evidence',
  'support-only-release-no-go',
]);
const expectedV4BlockerCounts = Object.freeze({
  'documented-large-site-budget': 1,
  'ordered-primary-key-window-coverage': 1,
  'row-window-hashes-match': 1,
  'hash-count-only-storage-performance-evidence': 1,
  'deterministic-large-site-coverage-repeatable': 1,
  'correctness-gates-not-recorded': 1,
});
const hexSha256Pattern = /^[a-f0-9]{64}$/;
const sha256Pattern = /^sha256:[a-f0-9]{64}$/;
let recordedLargeSiteEvidencePair;

test('RPP-0794 release verifier v5 carries large post table benchmark variant 4', {
  concurrency: false,
}, () => {
  const proof = buildReleaseVerifierProof();

  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.rppId, 'RPP-0794');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 5);
  assert.equal(proof.evidenceSource, evidenceSource);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.supportOnly, true);
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.integrationRecommendation, 'NO-GO');

  assert.equal(proof.builtOn.rppId, 'RPP-0774');
  assert.equal(proof.builtOn.proofId, 'rpp-0774-large-post-table-benchmark-v4');
  assert.equal(proof.builtOn.variant, 4);
  assert.equal(proof.builtOn.status, 'passed');
  assert.equal(proof.builtOn.sourceBenchmark.rppId, 'RPP-0714');
  assert.equal(proof.builtOn.sourceBenchmark.benchmark, LARGE_POST_TABLE_BENCHMARK_ID);
  assert.equal(proof.builtOn.sourceBenchmark.ok, true);
  assert.equal(proof.builtOn.sourceBenchmark.profile, 'large-site');
  assert.match(proof.builtOn.sourceBenchmark.evidenceHash, hexSha256Pattern);
  assert.equal(proof.builtOn.previousVariant.rppId, 'RPP-0754');
  assert.equal(proof.builtOn.previousVariant.proofId, 'rpp-0754-large-post-table-benchmark-v3');
  assert.equal(proof.builtOn.previousVariant.variant, 3);
  assert.equal(proof.builtOn.previousVariant.status, 'passed');

  assert.equal(
    proof.releaseVerifier.command.invocation,
    'node --test --test-name-pattern RPP-0794 test/rpp-0794-large-post-table-benchmark-release-verifier-v5.test.js',
  );
  assert.equal(proof.releaseVerifier.command.reportsRuntime, true);
  assert.equal(proof.releaseVerifier.command.reportsResources, true);
  assert.equal(proof.releaseVerifier.command.reportsPassFailGates, true);
  assert.equal(proof.releaseVerifier.command.passFailStatusesOnly, true);
  assert.equal(proof.releaseVerifier.command.gateCount, expectedBenchmarkGateIds.length);
  assert.deepEqual(proof.releaseVerifier.command.passGateIds, expectedBenchmarkGateIds);
  assert.deepEqual(proof.releaseVerifier.command.blockedGateIds, []);
  assert.deepEqual(proof.releaseVerifier.command.failGateIds, []);
  assert.equal(proof.releaseVerifier.command.productionGateEvidence, 'not-present');
  assert.match(proof.releaseVerifier.command.reportHash, hexSha256Pattern);
  assert.equal(proof.releaseVerifier.carryThrough.status, 'support-only-local-release-verifier');
  assert.equal(proof.releaseVerifier.carryThrough.fromRpp, 'RPP-0774');
  assert.equal(proof.releaseVerifier.carryThrough.sourceProofId, 'rpp-0774-large-post-table-benchmark-v4');
  assert.equal(proof.releaseVerifier.carryThrough.sourceVariant, 4);
  assert.equal(proof.releaseVerifier.carryThrough.checkedSourceGate, 'deterministic-large-site-coverage-repeatable');
  assert.equal(proof.releaseVerifier.carryThrough.benchmarkId, LARGE_POST_TABLE_BENCHMARK_ID);
  assert.equal(proof.releaseVerifier.carryThrough.profile, 'large-site');
  assert.equal(proof.releaseVerifier.carryThrough.batchWindowCount, proof.batchCollection.batchWindowCount);
  assert.equal(proof.releaseVerifier.carryThrough.plannedRows, proof.batchCollection.plannedRows);
  assert.equal(proof.releaseVerifier.carryThrough.outputAfterCorrectnessGates, true);
  assert.match(proof.releaseVerifier.carryThrough.proofHash, sha256Pattern);

  assert.equal(proof.runtime.generatedAt, fixedNow.toISOString());
  assert.equal(proof.runtime.profile, 'large-site');
  assert.equal(proof.runtime.budgets.profile, 'large-site');
  assert.equal(proof.runtime.budgets.maxDurationMs, maxDurationMs);
  assert.equal(proof.runtime.budgets.maxHeapUsedBytes, maxHeapUsedBytes);
  assert.equal(proof.runtime.durationMs <= proof.runtime.budgets.maxDurationMs, true);
  assert.equal(proof.resources.process.heapUsedBytes <= proof.runtime.budgets.maxHeapUsedBytes, true);
  assert.equal(proof.resources.storage.localStorageProof, 'support-only-large-post-table-hash-preconditions');
  assert.equal(proof.resources.storage.productionBacked, false);
  assert.equal(proof.resources.storage.productionStorageReceipts, 'not-present');

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
  assert.deepEqual(proof.benchmark.gates.map((gate) => gate.id), expectedBenchmarkGateIds);
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

  assert.equal(proof.variant4UnsafeCoverage.sourceRppId, 'RPP-0774');
  assert.equal(proof.variant4UnsafeCoverage.releaseVerifierVariant, evidenceSource);
  assert.equal(proof.variant4UnsafeCoverage.previousVariant, 'large-post-table-benchmark-v4');
  assert.equal(proof.variant4UnsafeCoverage.caseCount, 7);
  assert.equal(proof.variant4UnsafeCoverage.outputEmitted, 1);
  assert.equal(proof.variant4UnsafeCoverage.blockedCaseCount, 6);
  assert.equal(proof.variant4UnsafeCoverage.unsafeOutputs, 0);
  assert.equal(proof.variant4UnsafeCoverage.deterministicCaseVector, true);
  assert.deepEqual(proof.variant4UnsafeCoverage.blockerCounts, expectedV4BlockerCounts);
  assert.ok(proof.variant4UnsafeCoverage.caseHashes.every((hash) => hexSha256Pattern.test(hash)));
  assert.match(proof.variant4UnsafeCoverage.coverageHash, sha256Pattern);

  assert.equal(proof.determinism.sameProjection, true);
  assert.equal(proof.determinism.firstProjectionHash, proof.determinism.secondProjectionHash);
  assert.match(proof.determinism.firstProjectionHash, sha256Pattern);
  assert.deepEqual(proof.determinism.ignoredVolatileFields, [
    'runtime.durationMs',
    'resources.process',
  ]);

  assert.deepEqual(proof.correctness.gateIds, expectedReleaseVerifierGateIds);
  assert.deepEqual(
    proof.correctness.recomputedGateVector.map((gate) => gate.status),
    Array(expectedReleaseVerifierGateIds.length).fill('pass'),
  );
  assert.equal(proof.correctness.correctnessGatesRecordedBeforeOutput, true);
  assert.equal(proof.correctness.correctnessGatesHoldBeforeOutput, true);
  assert.equal(proof.correctness.hashCountOnlyOutput, true);
  assert.equal(proof.correctness.outputEmittedAfterGates, true);
  assert.match(proof.outputHash, sha256Pattern);
  assert.deepEqual(proof.gates.map((gate) => gate.status), ['pass', 'pass', 'pass', 'pass', 'pass']);

  assert.equal(proof.unsafe.missingRuntimeReport.updated, false);
  assert.ok(proof.unsafe.missingRuntimeReport.blockedBy
    .includes('release-verifier-runtime-resources-gates-reported'));
  assert.equal(proof.unsafe.staleBatchWindow.updated, false);
  assert.ok(proof.unsafe.staleBatchWindow.blockedBy
    .includes('ordered-primary-key-window-coverage-carried-through'));
  assert.equal(proof.unsafe.staleGeneratedCoverage.updated, false);
  assert.ok(proof.unsafe.staleGeneratedCoverage.blockedBy
    .includes('generated-unsafe-large-post-table-cases-fail-closed'));
  assert.equal(proof.unsafe.deterministicMismatch.updated, false);
  assert.ok(proof.unsafe.deterministicMismatch.blockedBy
    .includes('deterministic-large-post-table-coverage-carried-through'));
  assert.equal(proof.unsafe.releaseVerifierNotCarried.updated, false);
  assert.ok(proof.unsafe.releaseVerifierNotCarried.blockedBy
    .includes('release-verifier-carry-through-claimed'));
  assert.equal(proof.unsafe.rawValueLeak.updated, false);
  assert.ok(proof.unsafe.rawValueLeak.blockedBy
    .includes('hash-count-only-release-verifier-evidence'));
  assert.equal(proof.unsafe.productionClaim.updated, false);
  assert.ok(proof.unsafe.productionClaim.blockedBy.includes('support-only-release-no-go'));
  assert.equal(proof.unsafe.prematurePassStatus.updated, false);
  assert.ok(proof.unsafe.prematurePassStatus.blockedBy.includes('correctness-gates-not-recorded'));

  assert.equal(proof.release.supportOnly, true);
  assert.equal(proof.release.productionBacked, false);
  assert.equal(proof.release.releaseEligible, false);
  assert.equal(proof.release.productionThroughput, 'not-claimed');
  assert.equal(proof.release.speedClaimsAllowed, false);
  assert.equal(proof.release.releaseVerifierCarryThrough, 'support-only-local-release-verifier');
  assert.equal(proof.release.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.release.integrationRecommendation, 'NO-GO');
  assert.ok(proof.release.blockers.includes('production-storage-receipts-not-measured'));
  assert.ok(proof.release.blockers.includes('production-row-batch-executor-not-measured'));
  assert.ok(proof.release.blockers.includes('production-atomic-group-commit-not-measured'));
  assert.equal(proof.release.blockers.includes('release-verifier-carry-through-not-claimed'), false);

  assert.equal(proof.redaction.rawValueEvidenceLeaks, 0);
  assert.match(proof.redaction.publicEvidenceHash, hexSha256Pattern);
  assert.match(proof.redaction.repeatedEvidenceHash, hexSha256Pattern);
  assert.match(proof.redaction.laneDecisionHash, hexSha256Pattern);
  assert.match(proof.evidenceHash, hexSha256Pattern);
  assertHashCountOnlyReleaseVerifierEvidence(proof);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0794 large post table release verifier proof' }));
});

test('RPP-0794 release verifier v5 fails closed for stale large post table carry-through evidence', {
  concurrency: false,
}, () => {
  const { evidence, repeatedEvidence } = buildRecordedEvidencePair(smallLargeSiteOptions());
  const safeDecision = resolveReleaseVerifierCarryThrough(evidence, { repeatedEvidence });
  const unsafeDecisions = unsafeReleaseVerifierDecisions(evidence, repeatedEvidence);

  assert.equal(safeDecision.updated, true);
  assert.equal(safeDecision.outputEmitted, true);
  assert.deepEqual(safeDecision.blockedBy, []);
  assert.deepEqual(
    safeDecision.recomputedGates.map((gate) => gate.status),
    Array(expectedReleaseVerifierGateIds.length).fill('pass'),
  );

  assert.equal(unsafeDecisions.missingRuntimeReport.updated, false);
  assert.ok(unsafeDecisions.missingRuntimeReport.blockedBy
    .includes('release-verifier-runtime-resources-gates-reported'));
  assert.equal(unsafeDecisions.staleBatchWindow.updated, false);
  assert.ok(unsafeDecisions.staleBatchWindow.blockedBy
    .includes('ordered-primary-key-window-coverage-carried-through'));
  assert.equal(unsafeDecisions.staleGeneratedCoverage.updated, false);
  assert.ok(unsafeDecisions.staleGeneratedCoverage.blockedBy
    .includes('generated-unsafe-large-post-table-cases-fail-closed'));
  assert.equal(unsafeDecisions.deterministicMismatch.updated, false);
  assert.ok(unsafeDecisions.deterministicMismatch.blockedBy
    .includes('deterministic-large-post-table-coverage-carried-through'));
  assert.equal(unsafeDecisions.releaseVerifierNotCarried.updated, false);
  assert.ok(unsafeDecisions.releaseVerifierNotCarried.blockedBy
    .includes('release-verifier-carry-through-claimed'));
  assert.equal(unsafeDecisions.rawValueLeak.updated, false);
  assert.ok(unsafeDecisions.rawValueLeak.blockedBy
    .includes('hash-count-only-release-verifier-evidence'));
  assert.equal(unsafeDecisions.productionClaim.updated, false);
  assert.ok(unsafeDecisions.productionClaim.blockedBy.includes('support-only-release-no-go'));
  assert.equal(unsafeDecisions.prematurePassStatus.updated, false);
  assert.ok(unsafeDecisions.prematurePassStatus.blockedBy.includes('correctness-gates-not-recorded'));

  for (const decision of Object.values(unsafeDecisions)) {
    assert.equal(decision.output, null);
    assert.equal(decision.outputEmitted, false);
    assert.equal(decision.attemptedPassBlocked, true);
    assert.match(decision.decisionHash, hexSha256Pattern);
    assertHashCountOnlyReleaseVerifierEvidence(decision);
  }
});

function buildReleaseVerifierProof() {
  const { benchmark, evidence, repeatedEvidence } = buildRecordedLargeSiteEvidencePair();
  const safeDecision = resolveReleaseVerifierCarryThrough(evidence, { repeatedEvidence });
  const unsafe = projectUnsafeDecisions(unsafeReleaseVerifierDecisions(evidence, repeatedEvidence));
  const determinism = compareDeterministicReleaseVerifierEvidence(evidence, repeatedEvidence);
  const correctnessGatesRecordedBeforeOutput = objectKeyBefore(
    evidence,
    'correctnessGates',
    'batchCollection',
  ) && objectKeyBefore(
    evidence,
    'correctnessGates',
    'generatedCoverage',
  ) && objectKeyBefore(
    evidence,
    'correctnessGates',
    'releaseVerifier',
  );
  const supportOnlyRelease = evidence.release;
  const proofGates = [
    proofGate('release-verifier-command-runtime-resources-gates-pass',
      evidence.releaseVerifier.command.reportsRuntime
        && evidence.releaseVerifier.command.reportsResources
        && evidence.releaseVerifier.command.reportsPassFailGates
        && evidence.releaseVerifier.command.passFailStatusesOnly
        && benchmark.ok === true
        && benchmark.gates.every((gate) => gate.status === 'pass'), {
        benchmarkGateStatuses: benchmark.gates.map((gate) => gate.status),
        gateCount: evidence.releaseVerifier.command.gateCount,
        durationMs: benchmark.runtime.durationMs,
        heapUsedBytes: benchmark.resources.process.heapUsedBytes,
      }),
    proofGate('large-post-table-output-after-release-verifier-gates',
      safeDecision.updated
        && safeDecision.outputEmitted
        && correctnessGatesRecordedBeforeOutput
        && safeDecision.recomputedGates
          .filter((gate) => [
            'large-site-benchmark-budget-carried-through',
            'ordered-primary-key-window-coverage-carried-through',
            'deterministic-large-post-table-coverage-carried-through',
          ].includes(gate.id))
          .every((gate) => gate.status === 'pass'), {
        outputEmitted: safeDecision.outputEmitted,
        correctnessGatesRecordedBeforeOutput,
        blockedBy: safeDecision.blockedBy,
      }),
    proofGate('unsafe-release-verifier-evidence-fails-closed',
      Object.values(unsafe).every((decision) => (
        decision.updated === false
          && decision.outputEmitted === false
          && decision.attemptedPassBlocked === true
      )), {
        blockedDecisionHashes: Object.values(unsafe).map((decision) => decision.decisionHash),
      }),
    proofGate('hash-count-only-release-verifier-proof',
      releaseVerifierEvidenceHasNoRawValues(publicReleaseVerifierEvidenceProjection(evidence)), {
        rawValueEvidenceLeaks:
          releaseVerifierEvidenceHasNoRawValues(publicReleaseVerifierEvidenceProjection(evidence)) ? 0 : 1,
      }),
    proofGate('support-only-release-no-go', supportOnlyRelease.supportOnly
      && supportOnlyRelease.productionBacked === false
      && supportOnlyRelease.releaseEligible === false
      && supportOnlyRelease.releaseVerifierCarryThrough === 'support-only-local-release-verifier'
      && supportOnlyRelease.finalReleaseStatus === 'NO-GO'
      && supportOnlyRelease.integrationRecommendation === 'NO-GO', {
      finalReleaseStatus: supportOnlyRelease.finalReleaseStatus,
      integrationRecommendation: supportOnlyRelease.integrationRecommendation,
      releaseVerifierCarryThrough: supportOnlyRelease.releaseVerifierCarryThrough,
    }),
  ];
  const publicProof = {
    schemaVersion: 1,
    rppId: 'RPP-0794',
    proofId,
    variant: 5,
    evidenceSource,
    status: proofGates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed',
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    finalReleaseStatus: supportOnlyRelease.finalReleaseStatus,
    integrationRecommendation: supportOnlyRelease.integrationRecommendation,
    builtOn: evidence.builtOn,
    releaseVerifier: evidence.releaseVerifier,
    runtime: {
      generatedAt: benchmark.runtime.generatedAt,
      profile: benchmark.profile,
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
      storage: evidence.resources.storage,
      runtimeBudget: benchmark.resources.runtimeBudget,
    },
    benchmark: publicBenchmarkProjection(benchmark),
    batchCollection: {
      ...evidence.batchCollection,
      outputHash: safeDecision.outputHash,
    },
    generatedCoverage: evidence.generatedCoverage,
    variant4UnsafeCoverage: evidence.variant4UnsafeCoverage,
    determinism,
    correctness: {
      gateIds: evidence.correctnessGates.map((gate) => gate.id),
      recomputedGateVector: safeDecision.recomputedGates,
      correctnessGatesRecordedBeforeOutput,
      correctnessGatesHoldBeforeOutput: safeDecision.correctnessGatesHold,
      hashCountOnlyOutput: safeDecision.hashCountOnlyOutput,
      outputEmittedAfterGates: safeDecision.outputEmitted,
    },
    unsafe,
    gates: proofGates,
    release: supportOnlyRelease,
    outputHash: safeDecision.outputHash,
    redaction: {
      mode: 'hash-count-only-large-post-table-release-verifier-v5',
      rawValueEvidenceLeaks:
        releaseVerifierEvidenceHasNoRawValues(publicReleaseVerifierEvidenceProjection(evidence)) ? 0 : 1,
      publicEvidenceHash: digest(publicReleaseVerifierEvidenceProjection(evidence)),
      repeatedEvidenceHash: digest(publicReleaseVerifierEvidenceProjection(repeatedEvidence)),
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

  current.evidence.releaseVerifier = buildReleaseVerifierCarryThroughProjection(current.evidence);
  repeated.evidence.releaseVerifier = buildReleaseVerifierCarryThroughProjection(repeated.evidence);
  recordCorrectnessGates(current.evidence, repeated.evidence);
  recordCorrectnessGates(repeated.evidence, current.evidence);
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
    evidence: buildReleaseVerifierEvidence({ benchmark }),
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

function buildReleaseVerifierEvidence({ benchmark }) {
  const variant4Cases = variant4UnsafeCases();
  const repeatedVariant4Cases = variant4UnsafeCases();
  const variant4UnsafeCoverage = variant4UnsafeCoverageSummary(variant4Cases, repeatedVariant4Cases);
  const release = supportOnlyReleasePosture();

  return {
    schemaVersion: 1,
    rppId: 'RPP-0794',
    proofId,
    variant: 5,
    evidenceSource,
    status: 'pending',
    builtOn: largePostTableReleaseVerifierContract(benchmark),
    command: buildReleaseVerifierCommandProjection(benchmark),
    correctnessGates: [],
    benchmark: publicBenchmarkProjection(benchmark),
    runtime: {
      generatedAt: benchmark.runtime.generatedAt,
      profile: benchmark.profile,
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
      runtimeBudget: benchmark.resources.runtimeBudget,
      storage: {
        localStorageProof: 'support-only-large-post-table-hash-preconditions',
        productionBacked: false,
        productionStorageReceipts: 'not-present',
        table: benchmark.resources.table.table,
        liveRemotePreconditions: benchmark.resources.preconditions.liveRemote,
        storageBoundary: benchmark.resources.table.storageBoundary,
      },
    },
    batchCollection: collectPostBatchWindowEvidence(benchmark),
    generatedCoverage: collectGeneratedCoverageEvidence(benchmark),
    variant4UnsafeCoverage,
    release,
  };
}

function recordCorrectnessGates(evidence, repeatedEvidence) {
  const gates = recomputeReleaseVerifierGates(evidence, repeatedEvidence);
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

function buildReleaseVerifierCommandProjection(benchmark) {
  const passGateIds = benchmark.gates
    .filter((gate) => gate.status === 'pass')
    .map((gate) => gate.id);
  const blockedGateIds = benchmark.gates
    .filter((gate) => gate.status === 'blocked')
    .map((gate) => gate.id);
  const failGateIds = benchmark.gates
    .filter((gate) => gate.status === 'fail')
    .map((gate) => gate.id);
  const core = {
    invocation:
      'node --test --test-name-pattern RPP-0794 test/rpp-0794-large-post-table-benchmark-release-verifier-v5.test.js',
    reportsRuntime: hasRuntimeReport(benchmark),
    reportsResources: hasResourceReport(benchmark),
    reportsPassFailGates: hasPassFailGateReport(benchmark),
    passFailStatusesOnly: benchmark.gates.every((gate) => ['pass', 'fail', 'blocked'].includes(gate.status)),
    gateCount: benchmark.gates.length,
    passGateIds,
    blockedGateIds,
    failGateIds,
    productionGateEvidence: 'not-present',
    largeSiteSummary: {
      profile: benchmark.profile,
      tableRows: benchmark.resources.table.totalRows,
      changedRows: benchmark.resources.table.changedRows,
      mutationRows: benchmark.resources.table.mutationRows,
      batchSizeRows: benchmark.resources.batchSizing.batchSizeRows,
      batchCount: benchmark.resources.batchSizing.batchCount,
      liveRemotePreconditions: benchmark.resources.preconditions.liveRemote,
      appliedMutations: benchmark.resources.apply.appliedMutations,
      verificationFailures: benchmark.resources.apply.verificationFailures,
    },
    budgets: benchmark.runtime.budgets,
  };

  return {
    ...core,
    reportHash: digest(core),
  };
}

function buildReleaseVerifierCarryThroughProjection(evidence) {
  const carryThrough = {
    status: 'support-only-local-release-verifier',
    fromRpp: 'RPP-0774',
    sourceProofId: 'rpp-0774-large-post-table-benchmark-v4',
    sourceVariant: 4,
    checkedSourceGate: 'deterministic-large-site-coverage-repeatable',
    benchmarkId: LARGE_POST_TABLE_BENCHMARK_ID,
    profile: evidence.benchmark.profile,
    table: evidence.resources.table.table,
    plannedRows: evidence.batchCollection.plannedRows,
    batchWindowCount: evidence.batchCollection.batchWindowCount,
    batchCollectionHash: evidence.batchCollection.collectionSummaryHash,
    generatedCoverageHash: evidence.generatedCoverage.coverageHash,
    variant4UnsafeCoverageHash: evidence.variant4UnsafeCoverage.coverageHash,
    deterministicProjectionScope: 'runtime-free-count-hash-only',
    outputAfterCorrectnessGates: true,
    releaseStatus: evidence.release.finalReleaseStatus,
    integrationRecommendation: evidence.release.integrationRecommendation,
  };

  return {
    evidenceSource,
    command: evidence.command,
    carryThrough: {
      ...carryThrough,
      proofHash: sha256(carryThrough),
    },
  };
}

function resolveReleaseVerifierCarryThrough(evidence, { repeatedEvidence }) {
  const recomputedGates = recomputeReleaseVerifierGates(evidence, repeatedEvidence);
  const failedGateIds = recomputedGates
    .filter((gate) => gate.status !== 'pass')
    .map((gate) => gate.id);
  const recordedGateIds = Array.isArray(evidence.correctnessGates)
    ? evidence.correctnessGates.map((gate) => gate.id)
    : [];
  const recordedGateIdsComplete = sameArray(recordedGateIds, expectedReleaseVerifierGateIds);
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
        evidenceSource,
        gateVectorHash: sha256(recomputedGates),
        releaseVerifierHash: sha256(evidence.releaseVerifier),
        benchmarkEvidenceHash: digest(evidence.benchmark),
        batchCollectionHash: evidence.batchCollection.collectionSummaryHash,
        generatedCoverageHash: evidence.generatedCoverage.coverageHash,
        variant4UnsafeCoverageHash: evidence.variant4UnsafeCoverage.coverageHash,
        deterministicEvidenceHash: digest(publicReleaseVerifierEvidenceProjection(evidence)),
        deterministicRepeatHash: digest(publicReleaseVerifierEvidenceProjection(repeatedEvidence)),
        runtimeBudgetHash: sha256({
          durationMs: evidence.runtime.durationMs,
          heapUsedBytes: evidence.resources.process.heapUsedBytes,
          budgets: evidence.runtime.budgets,
        }),
        observedWindowBoundsHash: evidence.batchCollection.observedWindowBoundsHash,
        expectedWindowBoundsHash: evidence.batchCollection.expectedWindowBoundsHash,
        storageBoundaryHash: sha256(evidence.resources.table.storageBoundary),
        supportOnly: evidence.release.supportOnly,
        productionBacked: evidence.release.productionBacked,
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
    hashCountOnlyOutput: output ? releaseVerifierEvidenceHasNoRawValues(output) : false,
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

function recomputeReleaseVerifierGates(evidence, repeatedEvidence) {
  const runtime = evidence.runtime || {};
  const resources = evidence.resources || {};
  const table = resources.table || {};
  const batchSizing = resources.batchSizing || {};
  const preconditions = resources.preconditions || {};
  const apply = resources.apply || {};
  const processResources = resources.process || {};
  const releaseVerifier = evidence.releaseVerifier || {};
  const command = releaseVerifier.command || {};
  const carryThrough = releaseVerifier.carryThrough || {};
  const collection = evidence.batchCollection || {};
  const windows = Array.isArray(collection.batchWindows) ? collection.batchWindows : [];
  const benchmark = evidence.benchmark || {};
  const release = evidence.release || {};
  const releaseBlockers = Array.isArray(release.blockers) ? release.blockers : [];
  const order = primaryKeyWindowCoverageMetrics(collection, windows, batchSizing);
  const generatedCoverage = generatedCoverageMetrics(evidence, collection, table);
  const variant4Coverage = variant4UnsafeCoverageMetrics(evidence.variant4UnsafeCoverage || {});
  const deterministicEvidence = Boolean(repeatedEvidence)
    && digest(publicReleaseVerifierEvidenceProjection(evidence))
      === digest(publicReleaseVerifierEvidenceProjection(repeatedEvidence));
  const benchmarkGatesPass = benchmark.ok === true
    && Array.isArray(benchmark.gates)
    && benchmark.gates.length === expectedBenchmarkGateIds.length
    && sameArray(benchmark.gates.map((gate) => gate.id), expectedBenchmarkGateIds)
    && benchmark.gates.every((gate) => gate.status === 'pass');
  const releaseVerifierReported = command.reportsRuntime === true
    && command.reportsResources === true
    && command.reportsPassFailGates === true
    && command.passFailStatusesOnly === true
    && command.gateCount === expectedBenchmarkGateIds.length
    && sameArray(command.passGateIds || [], expectedBenchmarkGateIds)
    && Array.isArray(command.blockedGateIds)
    && command.blockedGateIds.length === 0
    && Array.isArray(command.failGateIds)
    && command.failGateIds.length === 0
    && command.productionGateEvidence === 'not-present'
    && isSha256Hex(command.reportHash);
  const runtimeWithinBudget = runtime.profile === 'large-site'
    && runtime.budgets?.profile === 'large-site'
    && runtime.durationMs <= runtime.budgets?.maxDurationMs
    && processResources.heapUsedBytes <= runtime.budgets?.maxHeapUsedBytes
    && resources.storage?.localStorageProof === 'support-only-large-post-table-hash-preconditions'
    && resources.storage?.productionBacked === false
    && resources.storage?.productionStorageReceipts === 'not-present';
  const builtOnV4 = evidence.builtOn?.rppId === 'RPP-0774'
    && evidence.builtOn?.proofId === 'rpp-0774-large-post-table-benchmark-v4'
    && evidence.builtOn?.variant === 4
    && evidence.builtOn?.status === 'passed'
    && evidence.builtOn?.sourceBenchmark?.rppId === 'RPP-0714'
    && evidence.builtOn?.sourceBenchmark?.benchmark === LARGE_POST_TABLE_BENCHMARK_ID
    && evidence.builtOn?.sourceBenchmark?.ok === true
    && evidence.builtOn?.sourceBenchmark?.profile === 'large-site'
    && isSha256Hex(evidence.builtOn?.sourceBenchmark?.evidenceHash)
    && evidence.builtOn?.previousVariant?.rppId === 'RPP-0754'
    && evidence.builtOn?.previousVariant?.proofId === 'rpp-0754-large-post-table-benchmark-v3'
    && evidence.builtOn?.previousVariant?.variant === 3
    && evidence.builtOn?.previousVariant?.status === 'passed';
  const largeSiteBudget = benchmark.profile === 'large-site'
    && table.table === 'wp_posts'
    && table.changedRows === table.mutationRows
    && table.totalRows >= table.changedRows
    && table.changedRows > 0
    && batchSizing.batchSizeRows === collection.batchSizeRows
    && batchSizing.batchCount === collection.batchWindowCount
    && runtimeWithinBudget;
  const liveRemotePreconditions = table.storageBoundary === 'live-remote-hash-precondition-before-apply'
    && table.applyMode === 'applyPlan-live-precondition-row-mutations'
    && preconditions.expected === table.changedRows
    && preconditions.recorded === table.changedRows
    && preconditions.liveRemote === table.changedRows
    && preconditions.everyMutationHasLivePrecondition === true
    && apply.appliedMutations === table.mutationRows
    && apply.changedRowsVerified === table.changedRows
    && apply.verificationFailures === 0
    && apply.unchangedSamplesVerified > 0;
  const carryThroughClaimed = releaseVerifier.evidenceSource === evidenceSource
    && carryThrough.status === 'support-only-local-release-verifier'
    && carryThrough.fromRpp === 'RPP-0774'
    && carryThrough.sourceProofId === 'rpp-0774-large-post-table-benchmark-v4'
    && carryThrough.sourceVariant === 4
    && carryThrough.checkedSourceGate === 'deterministic-large-site-coverage-repeatable'
    && carryThrough.benchmarkId === LARGE_POST_TABLE_BENCHMARK_ID
    && carryThrough.profile === 'large-site'
    && carryThrough.table === 'wp_posts'
    && carryThrough.plannedRows === collection.plannedRows
    && carryThrough.batchWindowCount === collection.batchWindowCount
    && carryThrough.batchCollectionHash === collection.collectionSummaryHash
    && carryThrough.generatedCoverageHash === evidence.generatedCoverage?.coverageHash
    && carryThrough.variant4UnsafeCoverageHash === evidence.variant4UnsafeCoverage?.coverageHash
    && carryThrough.deterministicProjectionScope === 'runtime-free-count-hash-only'
    && carryThrough.outputAfterCorrectnessGates === true
    && carryThrough.releaseStatus === 'NO-GO'
    && carryThrough.integrationRecommendation === 'NO-GO'
    && carryThrough.proofHash === sha256(carryThroughCore(carryThrough));

  return [
    proofGate('release-verifier-runtime-resources-gates-reported',
      releaseVerifierReported && runtimeWithinBudget && benchmarkGatesPass, {
      benchmark: benchmark.benchmark,
      gateStatuses: Array.isArray(benchmark.gates) ? benchmark.gates.map((gate) => gate.status) : [],
      runtimeReported: command.reportsRuntime,
      resourcesReported: command.reportsResources,
      passFailGatesReported: command.reportsPassFailGates,
      gateCount: command.gateCount,
      durationMs: runtime.durationMs,
      heapUsedBytes: processResources.heapUsedBytes,
    }),
    proofGate('built-on-large-post-table-benchmark-v4', builtOnV4, {
      builtOnRppId: evidence.builtOn?.rppId,
      builtOnVariant: evidence.builtOn?.variant,
      sourceBenchmark: evidence.builtOn?.sourceBenchmark?.benchmark,
      previousVariant: evidence.builtOn?.previousVariant?.rppId,
    }),
    proofGate('large-site-benchmark-budget-carried-through', largeSiteBudget, {
      profile: benchmark.profile,
      tableRows: table.totalRows,
      changedRows: table.changedRows,
      mutationRows: table.mutationRows,
      batchSizeRows: collection.batchSizeRows,
      batchWindowCount: collection.batchWindowCount,
      durationMs: runtime.durationMs,
      maxDurationMs: runtime.budgets?.maxDurationMs,
      heapUsedBytes: processResources.heapUsedBytes,
      maxHeapUsedBytes: runtime.budgets?.maxHeapUsedBytes,
    }),
    proofGate('live-remote-post-preconditions-carried-through', liveRemotePreconditions, {
      storageBoundary: table.storageBoundary,
      applyMode: table.applyMode,
      changedRows: table.changedRows,
      mutationRows: table.mutationRows,
      preconditions,
      apply,
    }),
    proofGate('ordered-primary-key-window-coverage-carried-through',
      order.complete && order.hashesMatch, order),
    proofGate('deterministic-large-post-table-coverage-carried-through',
      deterministicEvidence && generatedCoverage.complete && generatedCoverage.hashesMatch, {
      deterministicEvidence,
      firstEvidenceHash: digest(publicReleaseVerifierEvidenceProjection(evidence)),
      repeatedEvidenceHash: repeatedEvidence ? digest(publicReleaseVerifierEvidenceProjection(repeatedEvidence)) : '',
      generatedCoverage,
      ignoredVolatileFields: ['runtime.durationMs', 'resources.process'],
    }),
    proofGate('generated-unsafe-large-post-table-cases-fail-closed',
      variant4Coverage.pass, variant4Coverage),
    proofGate('release-verifier-carry-through-claimed', carryThroughClaimed, {
      status: carryThrough.status,
      fromRpp: carryThrough.fromRpp,
      sourceVariant: carryThrough.sourceVariant,
      plannedRows: carryThrough.plannedRows,
      batchWindowCount: carryThrough.batchWindowCount,
    }),
    proofGate('hash-count-only-release-verifier-evidence',
      releaseVerifierEvidenceHasNoRawValues(publicReleaseVerifierEvidenceProjection(evidence)), {
        rawValueEvidenceLeaks:
          releaseVerifierEvidenceHasNoRawValues(publicReleaseVerifierEvidenceProjection(evidence)) ? 0 : 1,
      }),
    proofGate('support-only-release-no-go', release.supportOnly === true
      && release.productionBacked === false
      && release.releaseEligible === false
      && release.releaseVerifierCarryThrough === 'support-only-local-release-verifier'
      && release.productionThroughput === 'not-claimed'
      && release.speedClaimsAllowed === false
      && release.finalReleaseStatus === 'NO-GO'
      && release.integrationRecommendation === 'NO-GO'
      && releaseBlockers.includes('production-storage-receipts-not-measured')
      && releaseBlockers.includes('production-row-batch-executor-not-measured')
      && releaseBlockers.includes('production-atomic-group-commit-not-measured'), {
      supportOnly: release.supportOnly,
      productionBacked: release.productionBacked,
      releaseEligible: release.releaseEligible,
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
  const hashMismatches = windows
    .filter((window) => window.windowHash !== sha256(batchWindowCore(window)))
    .map((window) => window.batchIndex);
  const collectionSummaryHashMatches = collection.collectionSummaryHash === sha256(batchCollectionCore(collection));
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
    hashesMatch: hashMismatches.length === 0 && collectionSummaryHashMatches,
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
    hashMismatches,
    collectionSummaryHashMatches,
    indexMismatchCount,
    firstPostMismatchCount,
    lastPostMismatchCount,
    preconditionMismatchCount,
    emptyWindowCount,
    terminalPostId: windows.at(-1)?.lastPostId ?? null,
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

function variant4UnsafeCoverageMetrics(coverage) {
  const expectedCoverageHash = sha256(variant4UnsafeCoverageCore(coverage));
  const caseHashes = Array.isArray(coverage.caseHashes) ? coverage.caseHashes : [];
  const repeatedCaseHashes = Array.isArray(coverage.repeatedCaseHashes) ? coverage.repeatedCaseHashes : [];
  const pass = coverage.sourceRppId === 'RPP-0774'
    && coverage.source === 'local-support-generated-large-post-table-regression-cases'
    && coverage.releaseVerifierVariant === evidenceSource
    && coverage.previousVariant === 'large-post-table-benchmark-v4'
    && coverage.caseCount === 7
    && coverage.outputEmitted === 1
    && coverage.blockedCaseCount === 6
    && coverage.unsafeOutputs === 0
    && coverage.deterministicCaseVector === true
    && sameArray(caseHashes, repeatedCaseHashes)
    && caseHashes.every((hash) => hexSha256Pattern.test(hash))
    && expectedBlockerCountsHold(coverage.blockerCounts || {})
    && coverage.coverageHash === expectedCoverageHash;

  return {
    pass,
    sourceRppId: coverage.sourceRppId,
    caseCount: coverage.caseCount,
    outputEmitted: coverage.outputEmitted,
    blockedCaseCount: coverage.blockedCaseCount,
    unsafeOutputs: coverage.unsafeOutputs,
    deterministicCaseVector: coverage.deterministicCaseVector,
    expectedCoverageHash,
    recordedCoverageHash: coverage.coverageHash,
    blockerCounts: coverage.blockerCounts,
  };
}

function unsafeReleaseVerifierDecisions(evidence, repeatedEvidence) {
  const missingRuntimeReport = withPassedStatus(clone(evidence));
  missingRuntimeReport.releaseVerifier.command.reportsRuntime = false;

  const staleBatchWindow = withPassedStatus(clone(evidence));
  staleBatchWindow.batchCollection.batchWindows[0].rowHashDigest = digest('rpp-0794-stale-row-window');

  const staleGeneratedCoverage = withPassedStatus(clone(evidence));
  staleGeneratedCoverage.variant4UnsafeCoverage.blockedCaseCount = 5;
  staleGeneratedCoverage.variant4UnsafeCoverage.blockerCounts['documented-large-site-budget'] = 0;

  const mismatchedRepeatedEvidence = clone(repeatedEvidence);
  mismatchedRepeatedEvidence.generatedCoverage.batchCoverage.observedRows += 1;

  const releaseVerifierNotCarried = withPassedStatus(clone(evidence));
  releaseVerifierNotCarried.releaseVerifier.carryThrough.status = 'not-claimed';
  releaseVerifierNotCarried.releaseVerifier.carryThrough.outputAfterCorrectnessGates = false;

  const rawValueLeak = withPassedStatus(clone(evidence));
  rawValueLeak.generatedCoverage.rawFixtureProbe = {
    post_title: 'RPP0714 local post blocked by hash-count-only release verifier gate',
  };

  const productionClaim = withPassedStatus(clone(evidence));
  productionClaim.release.productionBacked = true;
  productionClaim.release.releaseEligible = true;
  productionClaim.release.finalReleaseStatus = 'GO';
  productionClaim.release.integrationRecommendation = 'GO';

  const prematurePassStatus = withPassedStatus(clone(evidence));
  prematurePassStatus.correctnessGates = [];

  return {
    missingRuntimeReport: resolveReleaseVerifierCarryThrough(missingRuntimeReport, { repeatedEvidence }),
    staleBatchWindow: resolveReleaseVerifierCarryThrough(staleBatchWindow, { repeatedEvidence }),
    staleGeneratedCoverage: resolveReleaseVerifierCarryThrough(staleGeneratedCoverage, { repeatedEvidence }),
    deterministicMismatch: resolveReleaseVerifierCarryThrough(evidence, {
      repeatedEvidence: mismatchedRepeatedEvidence,
    }),
    releaseVerifierNotCarried: resolveReleaseVerifierCarryThrough(releaseVerifierNotCarried, { repeatedEvidence }),
    rawValueLeak: resolveReleaseVerifierCarryThrough(rawValueLeak, { repeatedEvidence }),
    productionClaim: resolveReleaseVerifierCarryThrough(productionClaim, { repeatedEvidence }),
    prematurePassStatus: resolveReleaseVerifierCarryThrough(prematurePassStatus, { repeatedEvidence }),
  };
}

function variant4UnsafeCases() {
  const cases = [
    { id: 'deterministic-large-site-coverage', updated: true, outputEmitted: true, blockedBy: [] },
    { id: 'over-budget', updated: false, outputEmitted: false, blockedBy: ['documented-large-site-budget'] },
    {
      id: 'missing-window',
      updated: false,
      outputEmitted: false,
      blockedBy: ['ordered-primary-key-window-coverage'],
    },
    { id: 'stale-window-hash', updated: false, outputEmitted: false, blockedBy: ['row-window-hashes-match'] },
    {
      id: 'raw-value-leak',
      updated: false,
      outputEmitted: false,
      blockedBy: ['hash-count-only-storage-performance-evidence'],
    },
    {
      id: 'deterministic-repeat-mismatch',
      updated: false,
      outputEmitted: false,
      blockedBy: ['deterministic-large-site-coverage-repeatable'],
    },
    {
      id: 'premature-pass-status',
      updated: false,
      outputEmitted: false,
      blockedBy: ['correctness-gates-not-recorded'],
    },
  ];

  return cases.map((largePostCase) => {
    const publicCase = {
      caseId: largePostCase.id,
      sourceRppId: 'RPP-0774',
      previousVariant: 'large-post-table-benchmark-v4',
      updated: largePostCase.updated,
      outputEmitted: largePostCase.outputEmitted,
      attemptedPassBlocked: !largePostCase.updated,
      blockedBy: largePostCase.blockedBy,
      decisionHash: digest({
        proofId: 'rpp-0774-large-post-table-benchmark-v4',
        caseId: largePostCase.id,
        blockedBy: largePostCase.blockedBy,
      }),
    };
    return {
      ...publicCase,
      caseHash: digest(publicCase),
    };
  });
}

function variant4UnsafeCoverageSummary(generatedCases, repeatedCases) {
  const blockedCases = generatedCases.filter((largePostCase) => largePostCase.updated === false);
  const blockerCounts = {};
  for (const largePostCase of blockedCases) {
    for (const blocker of largePostCase.blockedBy) {
      blockerCounts[blocker] = (blockerCounts[blocker] || 0) + 1;
    }
  }
  const caseHashes = generatedCases.map((largePostCase) => largePostCase.caseHash);
  const repeatedCaseHashes = repeatedCases.map((largePostCase) => largePostCase.caseHash);
  const core = {
    sourceRppId: 'RPP-0774',
    source: 'local-support-generated-large-post-table-regression-cases',
    releaseVerifierVariant: evidenceSource,
    previousVariant: 'large-post-table-benchmark-v4',
    caseCount: generatedCases.length,
    outputEmitted: generatedCases.filter((largePostCase) => largePostCase.outputEmitted).length,
    blockedCaseCount: blockedCases.length,
    unsafeOutputs: generatedCases
      .filter((largePostCase) => largePostCase.caseId !== 'deterministic-large-site-coverage'
        && largePostCase.outputEmitted)
      .length,
    deterministicCaseVector: sameArray(caseHashes, repeatedCaseHashes),
    caseIds: generatedCases.map((largePostCase) => largePostCase.caseId),
    blockerCounts,
    caseHashes,
    repeatedCaseHashes,
  };

  return {
    ...core,
    coverageHash: sha256(core),
  };
}

function largePostTableReleaseVerifierContract(benchmark) {
  const sourceBenchmark = {
    rppId: 'RPP-0714',
    benchmark: benchmark.benchmark,
    ok: benchmark.ok,
    profile: benchmark.profile,
    evidenceHash: digest(publicBenchmarkProjection(benchmark)),
  };
  const previousVariant = {
    rppId: 'RPP-0754',
    proofId: 'rpp-0754-large-post-table-benchmark-v3',
    variant: 3,
    status: 'passed',
    evidenceHash: digest({
      rppId: 'RPP-0754',
      proofId: 'rpp-0754-large-post-table-benchmark-v3',
      coverage: 'hash-count-only-generated-large-post-table-proof',
    }),
  };
  const contract = {
    rppId: 'RPP-0774',
    proofId: 'rpp-0774-large-post-table-benchmark-v4',
    variant: 4,
    status: benchmark.ok ? 'passed' : 'blocked',
    sourceBenchmark,
    previousVariant,
    checkedSourceGate: 'deterministic-large-site-coverage-repeatable',
  };

  return {
    ...contract,
    evidenceHash: digest(contract),
  };
}

function publicBenchmarkProjection(benchmark) {
  return {
    rppId: benchmark.rppId,
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
      runtimeBudget: benchmark.resources.runtimeBudget,
    },
    gates: benchmark.gates.map((gate) => ({
      id: gate.id,
      status: gate.status,
    })),
    claims: benchmark.claims,
  };
}

function publicReleaseVerifierEvidenceProjection(evidence) {
  return {
    rppId: evidence.rppId,
    proofId: evidence.proofId,
    variant: evidence.variant,
    evidenceSource: evidence.evidenceSource,
    builtOn: evidence.builtOn,
    releaseVerifier: evidence.releaseVerifier,
    benchmark: evidence.benchmark,
    resources: {
      table: evidence.resources?.table,
      batchSizing: evidence.resources?.batchSizing,
      preconditions: evidence.resources?.preconditions,
      apply: evidence.resources?.apply,
      runtimeBudget: evidence.resources?.runtimeBudget,
      storage: evidence.resources?.storage,
    },
    batchCollection: evidence.batchCollection,
    generatedCoverage: evidence.generatedCoverage,
    variant4UnsafeCoverage: evidence.variant4UnsafeCoverage,
    release: evidence.release,
  };
}

function compareDeterministicReleaseVerifierEvidence(evidence, repeatedEvidence) {
  const firstProjectionHash = sha256(publicReleaseVerifierEvidenceProjection(evidence));
  const secondProjectionHash = sha256(publicReleaseVerifierEvidenceProjection(repeatedEvidence));
  return {
    sameProjection: firstProjectionHash === secondProjectionHash,
    firstProjectionHash,
    secondProjectionHash,
    ignoredVolatileFields: [
      'runtime.durationMs',
      'resources.process',
    ],
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

function variant4UnsafeCoverageCore(coverage) {
  return {
    sourceRppId: coverage.sourceRppId,
    source: coverage.source,
    releaseVerifierVariant: coverage.releaseVerifierVariant,
    previousVariant: coverage.previousVariant,
    caseCount: coverage.caseCount,
    outputEmitted: coverage.outputEmitted,
    blockedCaseCount: coverage.blockedCaseCount,
    unsafeOutputs: coverage.unsafeOutputs,
    deterministicCaseVector: coverage.deterministicCaseVector,
    caseIds: coverage.caseIds,
    blockerCounts: coverage.blockerCounts,
    caseHashes: coverage.caseHashes,
    repeatedCaseHashes: coverage.repeatedCaseHashes,
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

function carryThroughCore(carryThrough) {
  return {
    status: carryThrough.status,
    fromRpp: carryThrough.fromRpp,
    sourceProofId: carryThrough.sourceProofId,
    sourceVariant: carryThrough.sourceVariant,
    checkedSourceGate: carryThrough.checkedSourceGate,
    benchmarkId: carryThrough.benchmarkId,
    profile: carryThrough.profile,
    table: carryThrough.table,
    plannedRows: carryThrough.plannedRows,
    batchWindowCount: carryThrough.batchWindowCount,
    batchCollectionHash: carryThrough.batchCollectionHash,
    generatedCoverageHash: carryThrough.generatedCoverageHash,
    variant4UnsafeCoverageHash: carryThrough.variant4UnsafeCoverageHash,
    deterministicProjectionScope: carryThrough.deterministicProjectionScope,
    outputAfterCorrectnessGates: carryThrough.outputAfterCorrectnessGates,
    releaseStatus: carryThrough.releaseStatus,
    integrationRecommendation: carryThrough.integrationRecommendation,
  };
}

function expectedBlockerCountsHold(blockerCounts) {
  return Object.keys(blockerCounts).length === Object.keys(expectedV4BlockerCounts).length
    && Object.entries(expectedV4BlockerCounts)
      .every(([id, count]) => blockerCounts[id] === count);
}

function hasRuntimeReport(benchmark) {
  return benchmark.runtime
    && typeof benchmark.runtime.generatedAt === 'string'
    && typeof benchmark.runtime.durationMs === 'number'
    && typeof benchmark.runtime.node === 'string'
    && typeof benchmark.runtime.platform === 'string'
    && typeof benchmark.runtime.arch === 'string'
    && typeof benchmark.runtime.cpuCount === 'number'
    && typeof benchmark.runtime.budgets?.maxDurationMs === 'number'
    && typeof benchmark.runtime.budgets?.maxHeapUsedBytes === 'number';
}

function hasResourceReport(benchmark) {
  return benchmark.resources
    && benchmark.resources.table
    && benchmark.resources.batchSizing
    && benchmark.resources.preconditions
    && benchmark.resources.apply
    && benchmark.resources.process
    && typeof benchmark.resources.table.totalRows === 'number'
    && typeof benchmark.resources.batchSizing.batchCount === 'number'
    && typeof benchmark.resources.preconditions.liveRemote === 'number'
    && typeof benchmark.resources.apply.appliedMutations === 'number'
    && typeof benchmark.resources.process.heapUsedBytes === 'number';
}

function hasPassFailGateReport(benchmark) {
  return Array.isArray(benchmark.gates)
    && benchmark.gates.length === expectedBenchmarkGateIds.length
    && benchmark.gates.every((gate) =>
      expectedBenchmarkGateIds.includes(gate.id)
        && ['pass', 'fail', 'blocked'].includes(gate.status));
}

function supportOnlyReleasePosture() {
  return {
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    productionThroughput: 'not-claimed',
    speedClaimsAllowed: false,
    liveRemoteProductionService: 'not-claimed',
    productionStorageReceipts: 'not-claimed',
    productionRowBatchExecutor: 'not-claimed',
    productionAtomicGroupCommit: 'not-claimed',
    releaseVerifierCarryThrough: 'support-only-local-release-verifier',
    productionReleaseApproval: 'not-claimed',
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    blockers: [
      'live-production-service-not-supplied',
      'production-storage-receipts-not-measured',
      'production-row-batch-executor-not-measured',
      'production-atomic-group-commit-not-measured',
      'production-release-approval-not-supplied',
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

function assertHashCountOnlyReleaseVerifierEvidence(value) {
  assert.equal(releaseVerifierEvidenceHasNoRawValues(value), true);
}

function releaseVerifierEvidenceHasNoRawValues(value) {
  return !rawLargePostReleaseVerifierEvidencePattern().test(JSON.stringify(value));
}

function rawLargePostReleaseVerifierEvidencePattern() {
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

function isSha256Hex(value) {
  return typeof value === 'string' && hexSha256Pattern.test(value);
}

function objectKeyBefore(object, leftKey, rightKey) {
  const keys = Object.keys(object);
  return keys.indexOf(leftKey) !== -1
    && keys.indexOf(rightKey) !== -1
    && keys.indexOf(leftKey) < keys.indexOf(rightKey);
}

function sameArray(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function unique(values) {
  return [...new Set(values)];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
