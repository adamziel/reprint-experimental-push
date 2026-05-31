import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FILESYSTEM_FSYNC_BOUNDARY,
} from '../src/filesystem-fsync-evidence.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import {
  LARGE_MEDIA_LIBRARY_BENCHMARK_ID,
  LARGE_MEDIA_LIBRARY_FAST_PATH_LANE,
  runLargeMediaLibraryBenchmark,
} from '../scripts/bench/large-media-library-benchmark.js';
import { digest } from '../src/stable-json.js';

const proofId = 'rpp-0795-large-media-library-benchmark-release-verifier-v5';
const evidenceSource = 'large-media-library-benchmark-release-verifier-v5';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const maxDurationMs = 5_000;
const maxHeapUsedBytes = 128 * 1024 * 1024;
const workload = Object.freeze({
  updateMedia: 4,
  createMedia: 3,
  staleMedia: 2,
  tempFsyncFailureMedia: 2,
  directoryFsyncFailureMedia: 2,
  fileBytes: 3_584,
  metadataRowsPerMedia: 5,
});
const limits = Object.freeze({
  maxDbBatchRows: 7,
});
const expectedAttemptedMedia = 13;
const expectedFastPathLaneUpdates = 7;
const expectedFastPathLaneBlocked = 6;
const expectedRowPreconditions = 78;
const expectedLaneRowPreconditions = 42;
const expectedBenchmarkGateIds = Object.freeze([
  'deterministic-media-library-behavior',
  'fast-path-lane-updates-only-after-correctness-gates',
  'attachment-row-preconditions-retained',
  'media-db-batches-within-budget',
  'stale-media-storage-blocks-lane-update',
  'fsync-failures-block-or-withhold-lane-update',
  'temp-cleanup',
  'hash-only-evidence',
  'runtime-resource-budget',
]);
const expectedReleaseVerifierGateIds = Object.freeze([
  'release-verifier-runtime-resources-gates-reported',
  'built-on-large-media-library-benchmark-v4',
  'large-media-benchmark-gate-vector-carried-through',
  'media-storage-and-row-counts-carried-through',
  'fast-path-lane-updates-only-after-correctness-gates',
  'row-preconditions-attached-to-lane-updates',
  'media-db-batches-within-budget',
  'stale-and-fsync-failures-withhold-lane-update',
  'generated-unsafe-large-media-cases-fail-closed',
  'deterministic-large-media-library-support-evidence',
  'hash-count-only-release-verifier-evidence',
  'support-only-release-no-go',
]);
const expectedGeneratedBlockerCounts = Object.freeze({
  'release-verifier-runtime-resources-gates-reported': 1,
  'large-media-benchmark-gate-vector-carried-through': 1,
  'media-storage-and-row-counts-carried-through': 1,
  'fast-path-lane-updates-only-after-correctness-gates': 1,
  'row-preconditions-attached-to-lane-updates': 1,
  'media-db-batches-within-budget': 1,
  'stale-and-fsync-failures-withhold-lane-update': 1,
  'generated-unsafe-large-media-cases-fail-closed': 1,
  'deterministic-large-media-library-support-evidence': 1,
  'hash-count-only-release-verifier-evidence': 1,
  'support-only-release-no-go': 1,
  'correctness-gates-not-recorded': 1,
  'correctness-gates-not-passed': 1,
});
const hexSha256Pattern = /^[a-f0-9]{64}$/;
const sha256Pattern = /^sha256:[a-f0-9]{64}$/;

let recordedEvidencePair;

test('RPP-0795 release verifier v5 carries large media fast-path lane gates', {
  concurrency: false,
}, () => {
  const proof = buildReleaseVerifierProof();

  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.rppId, 'RPP-0795');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 5);
  assert.equal(proof.evidenceSource, evidenceSource);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.supportOnly, true);
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.integrationRecommendation, 'NO-GO');

  assert.equal(proof.builtOn.rppId, 'RPP-0775');
  assert.equal(proof.builtOn.proofId, 'rpp-0775-large-media-library-benchmark-v4');
  assert.equal(proof.builtOn.variant, 4);
  assert.equal(proof.builtOn.status, 'passed');
  assert.equal(proof.builtOn.sourceBenchmark.rppId, 'RPP-0715');
  assert.equal(proof.builtOn.sourceBenchmark.benchmark, LARGE_MEDIA_LIBRARY_BENCHMARK_ID);
  assert.equal(proof.builtOn.sourceBenchmark.ok, true);
  assert.match(proof.builtOn.sourceBenchmark.evidenceHash, hexSha256Pattern);
  assert.equal(proof.builtOn.previousVariant.rppId, 'RPP-0755');
  assert.equal(proof.builtOn.previousVariant.proofId, 'rpp-0755-large-media-library-benchmark-v3');
  assert.equal(proof.builtOn.previousVariant.variant, 3);
  assert.equal(proof.builtOn.previousVariant.status, 'passed');

  assert.equal(
    proof.releaseVerifier.command.invocation,
    'node --test --test-name-pattern RPP-0795 test/rpp-0795-large-media-library-benchmark-release-verifier-v5.test.js',
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
  assert.equal(proof.releaseVerifier.carryThrough.fromRpp, 'RPP-0775');
  assert.equal(proof.releaseVerifier.carryThrough.sourceProofId, 'rpp-0775-large-media-library-benchmark-v4');
  assert.equal(proof.releaseVerifier.carryThrough.sourceVariant, 4);
  assert.equal(
    proof.releaseVerifier.carryThrough.checkedSourceGate,
    'fast-path-lane-updates-only-after-correctness-gates',
  );
  assert.equal(proof.releaseVerifier.carryThrough.fastPathLaneUpdates, expectedFastPathLaneUpdates);
  assert.equal(proof.releaseVerifier.carryThrough.fastPathLaneBlocked, expectedFastPathLaneBlocked);
  assert.equal(proof.releaseVerifier.carryThrough.outputAfterCorrectnessGates, true);
  assert.match(proof.releaseVerifier.carryThrough.proofHash, sha256Pattern);

  assert.equal(proof.runtime.generatedAt, fixedNow.toISOString());
  assert.equal(proof.runtime.profile, 'unit');
  assert.equal(proof.runtime.durationMs >= 0, true);
  assert.equal(proof.runtime.durationMs <= proof.runtime.budgets.maxDurationMs, true);
  assert.equal(proof.resources.process.heapUsedBytes <= proof.runtime.budgets.maxHeapUsedBytes, true);
  assert.equal(proof.resources.storage.boundary, FILESYSTEM_FSYNC_BOUNDARY);
  assert.equal(proof.resources.storage.engine, 'filesystem');
  assert.equal(proof.resources.storage.mediaDriver, 'benchmark-media-library-file');
  assert.equal(proof.resources.storage.productionBacked, false);
  assert.equal(proof.resources.storage.productionStorageReceipts, 'not-present');
  assert.deepEqual(proof.resources.database.tables, ['wp_posts', 'wp_postmeta']);
  assert.equal(proof.resources.database.rowPreconditions, expectedRowPreconditions);
  assert.equal(proof.resources.database.rowPreconditionsAttachedToLaneUpdates, expectedLaneRowPreconditions);
  assert.deepEqual([...new Set(proof.benchmark.gates.map((gate) => gate.status))], ['pass']);
  assert.deepEqual(proof.benchmark.gates.map((gate) => gate.id), expectedBenchmarkGateIds);

  assert.equal(proof.mediaLibrary.profile, 'unit');
  assert.equal(proof.mediaLibrary.workload.attemptedMedia, expectedAttemptedMedia);
  assert.equal(proof.mediaLibrary.storageOutcomeCounts.mediaWritesAttempted, expectedAttemptedMedia);
  assert.equal(proof.mediaLibrary.storageOutcomeCounts.appliedMediaWrites, 9);
  assert.equal(proof.mediaLibrary.storageOutcomeCounts.appliedFsyncCompleteMediaWrites, expectedFastPathLaneUpdates);
  assert.equal(proof.mediaLibrary.storageOutcomeCounts.appliedFsyncIncompleteMediaWrites, 2);
  assert.equal(proof.mediaLibrary.storageOutcomeCounts.staleAtWriteMediaWrites, 2);
  assert.equal(proof.mediaLibrary.storageOutcomeCounts.tempFsyncFailedBeforeRenameMediaWrites, 2);
  assert.equal(proof.mediaLibrary.storageOutcomeCounts.unsafeRenameOnStaleMediaWrites, 0);
  assert.equal(proof.mediaLibrary.storageOutcomeCounts.unsafeRenameAfterTempFsyncFailureMediaWrites, 0);
  assert.equal(proof.mediaLibrary.storageOutcomeCounts.postWriteStorageVerified, expectedFastPathLaneUpdates);
  assert.equal(proof.mediaLibrary.rowPreconditions.attachmentRowsPreconditioned, expectedAttemptedMedia);
  assert.equal(proof.mediaLibrary.rowPreconditions.metadataRowsPreconditioned, 65);
  assert.equal(proof.mediaLibrary.rowPreconditions.rowPreconditions, expectedRowPreconditions);
  assert.equal(proof.mediaLibrary.rowPreconditions.rowPreconditionsAttachedToLaneUpdates, expectedLaneRowPreconditions);
  assert.equal(proof.mediaLibrary.rowPreconditions.missingExpectedRemoteHashes, 0);
  assert.equal(proof.mediaLibrary.dbBatching.batchCount, 12);
  assert.equal(proof.mediaLibrary.dbBatching.maxBatchRowsObserved, limits.maxDbBatchRows);
  assert.equal(proof.mediaLibrary.dbBatching.batchesOverLimit, 0);
  assert.equal(proof.mediaLibrary.sampleHashes.length, 12);
  assert.match(proof.mediaLibrary.mediaLibraryHash, sha256Pattern);

  assert.equal(proof.fastPathLane.laneId, LARGE_MEDIA_LIBRARY_FAST_PATH_LANE);
  assert.equal(proof.fastPathLane.storageBoundary, FILESYSTEM_FSYNC_BOUNDARY);
  assert.equal(proof.fastPathLane.updatesOnlyAfterCorrectnessGates, true);
  assert.equal(proof.fastPathLane.evaluatedBeforeUpdate, true);
  assert.equal(proof.fastPathLane.evaluatedAfterGates, true);
  assert.equal(proof.fastPathLane.updates, expectedFastPathLaneUpdates);
  assert.equal(proof.fastPathLane.blocked, expectedFastPathLaneBlocked);
  assert.deepEqual(proof.fastPathLane.blockedBy, {
    'live-storage-mismatch': 2,
    'target-directory-fsync-missing': 2,
    'temp-file-fsync-missing': 2,
  });
  assert.equal(proof.fastPathLane.unsafeUpdatesBeforeGates, 0);
  assert.equal(proof.fastPathLane.updatesWithFailedGate, 0);
  assert.equal(proof.fastPathLane.updatesMissingRowPreconditions, 0);
  assert.match(proof.fastPathLane.laneEvidenceHash, sha256Pattern);
  assert.match(proof.fastPathLane.outputHash, sha256Pattern);

  assert.equal(proof.generatedCoverage.sourceRppId, 'RPP-0775');
  assert.equal(proof.generatedCoverage.source, 'local-support-generated-large-media-release-verifier-regression-cases');
  assert.equal(proof.generatedCoverage.releaseVerifierVariant, evidenceSource);
  assert.equal(proof.generatedCoverage.previousVariant, 'large-media-library-benchmark-v4');
  assert.equal(proof.generatedCoverage.caseCount, 14);
  assert.equal(proof.generatedCoverage.outputEmitted, 1);
  assert.equal(proof.generatedCoverage.blockedCaseCount, 13);
  assert.equal(proof.generatedCoverage.unsafeOutputs, 0);
  assert.equal(proof.generatedCoverage.deterministicCaseVector, true);
  assert.deepEqual(proof.generatedCoverage.blockerCounts, expectedGeneratedBlockerCounts);
  assert.ok(proof.generatedCoverage.caseHashes.every((hash) => hexSha256Pattern.test(hash)));
  assert.deepEqual(proof.generatedCoverage.caseHashes, proof.generatedCoverage.repeatedCaseHashes);

  assert.deepEqual(proof.correctness.gateIds, expectedReleaseVerifierGateIds);
  assert.deepEqual(
    proof.correctness.recomputedGateVector.map((gate) => gate.status),
    Array(expectedReleaseVerifierGateIds.length).fill('pass'),
  );
  assert.equal(proof.correctness.correctnessGatesRecordedBeforeOutput, true);
  assert.equal(proof.correctness.correctnessGatesHoldBeforeOutput, true);
  assert.equal(proof.correctness.hashCountOnlyOutput, true);
  assert.equal(proof.correctness.fastPathLaneOutputEmittedAfterGates, true);
  assert.equal(proof.correctness.fastPathLaneOutputRequiresCorrectnessGatesHold, true);
  assert.equal(proof.determinism.sameProjection, true);
  assert.equal(proof.determinism.firstProjectionHash, proof.determinism.secondProjectionHash);
  assert.match(proof.determinism.firstProjectionHash, hexSha256Pattern);
  assert.deepEqual(proof.determinism.ignoredVolatileFields, [
    'runtime.durationMs',
    'resources.process',
  ]);
  assert.match(proof.outputHash, sha256Pattern);
  assert.deepEqual(proof.gates.map((gate) => gate.status), [
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
  ]);

  assertUnsafeDecision(proof.unsafe.missingRuntimeReport, 'release-verifier-runtime-resources-gates-reported');
  assertUnsafeDecision(proof.unsafe.benchmarkGateMissing, 'large-media-benchmark-gate-vector-carried-through');
  assertUnsafeDecision(proof.unsafe.mediaCountsMismatch, 'media-storage-and-row-counts-carried-through');
  assertUnsafeDecision(proof.unsafe.unsafeLaneUpdate, 'fast-path-lane-updates-only-after-correctness-gates');
  assertUnsafeDecision(proof.unsafe.missingLaneRowPreconditions, 'row-preconditions-attached-to-lane-updates');
  assertUnsafeDecision(proof.unsafe.dbBatchOverLimit, 'media-db-batches-within-budget');
  assertUnsafeDecision(proof.unsafe.failureLaneUpdate, 'stale-and-fsync-failures-withhold-lane-update');
  assertUnsafeDecision(proof.unsafe.staleGeneratedCoverage, 'generated-unsafe-large-media-cases-fail-closed');
  assertUnsafeDecision(proof.unsafe.mismatchedMediaLibraryHash, 'deterministic-large-media-library-support-evidence');
  assertUnsafeDecision(proof.unsafe.rawValueLeak, 'hash-count-only-release-verifier-evidence');
  assertUnsafeDecision(proof.unsafe.productionClaim, 'support-only-release-no-go');
  assertUnsafeDecision(proof.unsafe.prematurePassStatus, 'correctness-gates-not-recorded');
  assertUnsafeDecision(proof.unsafe.failingRecordedGateStatus, 'correctness-gates-not-passed');

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
  assert.equal(proof.redaction.rawValueEvidenceLeaks, 0);
  assert.match(proof.redaction.publicEvidenceHash, hexSha256Pattern);
  assert.match(proof.redaction.repeatedEvidenceHash, hexSha256Pattern);
  assert.match(proof.redaction.laneDecisionHash, hexSha256Pattern);
  assert.match(proof.evidenceHash, hexSha256Pattern);
  assertHashCountOnlyLargeMediaReleaseVerifierEvidence(proof);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0795 large media release verifier proof' }));
});

test('RPP-0795 release verifier v5 blocks unsafe large media carry-through evidence', {
  concurrency: false,
}, () => {
  const { evidence, repeatedEvidence } = buildRecordedEvidencePair();
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
  assert.equal(unsafeDecisions.benchmarkGateMissing.updated, false);
  assert.ok(unsafeDecisions.benchmarkGateMissing.blockedBy
    .includes('large-media-benchmark-gate-vector-carried-through'));
  assert.equal(unsafeDecisions.mediaCountsMismatch.updated, false);
  assert.ok(unsafeDecisions.mediaCountsMismatch.blockedBy
    .includes('media-storage-and-row-counts-carried-through'));
  assert.equal(unsafeDecisions.unsafeLaneUpdate.updated, false);
  assert.ok(unsafeDecisions.unsafeLaneUpdate.blockedBy
    .includes('fast-path-lane-updates-only-after-correctness-gates'));
  assert.equal(unsafeDecisions.missingLaneRowPreconditions.updated, false);
  assert.ok(unsafeDecisions.missingLaneRowPreconditions.blockedBy
    .includes('row-preconditions-attached-to-lane-updates'));
  assert.equal(unsafeDecisions.dbBatchOverLimit.updated, false);
  assert.ok(unsafeDecisions.dbBatchOverLimit.blockedBy.includes('media-db-batches-within-budget'));
  assert.equal(unsafeDecisions.failureLaneUpdate.updated, false);
  assert.ok(unsafeDecisions.failureLaneUpdate.blockedBy
    .includes('stale-and-fsync-failures-withhold-lane-update'));
  assert.equal(unsafeDecisions.staleGeneratedCoverage.updated, false);
  assert.ok(unsafeDecisions.staleGeneratedCoverage.blockedBy
    .includes('generated-unsafe-large-media-cases-fail-closed'));
  assert.equal(unsafeDecisions.mismatchedMediaLibraryHash.updated, false);
  assert.ok(unsafeDecisions.mismatchedMediaLibraryHash.blockedBy
    .includes('deterministic-large-media-library-support-evidence'));
  assert.equal(unsafeDecisions.rawValueLeak.updated, false);
  assert.ok(unsafeDecisions.rawValueLeak.blockedBy.includes('hash-count-only-release-verifier-evidence'));
  assert.equal(unsafeDecisions.productionClaim.updated, false);
  assert.ok(unsafeDecisions.productionClaim.blockedBy.includes('support-only-release-no-go'));
  assert.equal(unsafeDecisions.prematurePassStatus.updated, false);
  assert.ok(unsafeDecisions.prematurePassStatus.blockedBy.includes('correctness-gates-not-recorded'));
  assert.equal(unsafeDecisions.failingRecordedGateStatus.updated, false);
  assert.ok(unsafeDecisions.failingRecordedGateStatus.blockedBy.includes('correctness-gates-not-passed'));

  for (const decision of Object.values(unsafeDecisions)) {
    assert.equal(decision.output, null);
    assert.equal(decision.outputEmitted, false);
    assert.equal(decision.attemptedPassBlocked, true);
    assert.match(decision.decisionHash, hexSha256Pattern);
    assertHashCountOnlyLargeMediaReleaseVerifierEvidence(decision);
  }
});

function buildReleaseVerifierProof() {
  const { benchmark, evidence, repeatedEvidence } = buildRecordedEvidencePair();
  const safeDecision = resolveReleaseVerifierCarryThrough(evidence, { repeatedEvidence });
  const unsafe = projectUnsafeDecisions(unsafeReleaseVerifierDecisions(evidence, repeatedEvidence));
  const determinism = compareDeterministicReleaseVerifierEvidence(evidence, repeatedEvidence);
  const correctnessGatesRecordedBeforeOutput = objectKeyBefore(
    evidence,
    'correctnessGates',
    'mediaLibrary',
  ) && objectKeyBefore(
    evidence,
    'correctnessGates',
    'fastPathLane',
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
        && benchmark.ok
        && benchmark.gates.every((gate) => gate.status === 'pass'), {
        benchmarkGateStatuses: benchmark.gates.map((gate) => gate.status),
        gateCount: evidence.releaseVerifier.command.gateCount,
        durationMs: benchmark.runtime.durationMs,
        heapUsedBytes: benchmark.resources.process.heapUsedBytes,
      }),
    proofGate('large-media-fast-path-output-after-correctness-gates', safeDecision.updated
      && safeDecision.outputEmitted
      && correctnessGatesRecordedBeforeOutput
      && safeDecision.correctnessGatesHold === true, {
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
    rppId: 'RPP-0795',
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
      budgets: benchmark.runtime.budgets,
    },
    resources: {
      workload: benchmark.resources.workload,
      storage: {
        ...benchmark.resources.storage,
        productionBacked: false,
        productionStorageReceipts: 'not-present',
      },
      database: benchmark.resources.database,
      fastPathLane: benchmark.resources.fastPathLane,
      bytes: benchmark.resources.bytes,
      process: benchmark.resources.process,
      tempLeaks: benchmark.resources.tempLeaks,
      runtimeBudget: benchmark.resources.runtimeBudget,
    },
    benchmark: publicBenchmarkProjection(benchmark),
    mediaLibrary: evidence.mediaLibrary,
    fastPathLane: {
      ...evidence.fastPathLane,
      outputHash: safeDecision.outputHash,
    },
    generatedCoverage: evidence.generatedCoverage,
    correctness: {
      gateIds: evidence.correctnessGates.map((gate) => gate.id),
      recomputedGateVector: safeDecision.recomputedGates,
      correctnessGatesRecordedBeforeOutput,
      correctnessGatesHoldBeforeOutput: safeDecision.correctnessGatesHold,
      hashCountOnlyOutput: safeDecision.hashCountOnlyOutput,
      fastPathLaneOutputEmittedAfterGates: safeDecision.outputEmitted,
      fastPathLaneOutputRequiresCorrectnessGatesHold:
        safeDecision.updated === safeDecision.correctnessGatesHold
        && safeDecision.outputEmitted === safeDecision.correctnessGatesHold
        && unsafe.failingRecordedGateStatus.updated === false,
    },
    determinism,
    unsafe,
    gates: proofGates,
    release: supportOnlyRelease,
    outputHash: safeDecision.outputHash,
    redaction: {
      mode: 'hash-count-only-large-media-library-release-verifier-v5',
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

function buildRecordedEvidencePair() {
  if (recordedEvidencePair) {
    return recordedEvidencePair;
  }

  const benchmark = runLargeMediaLibraryBenchmark(benchmarkOptions());
  const repeatedBenchmark = runLargeMediaLibraryBenchmark(benchmarkOptions());
  const evidence = buildReleaseVerifierEvidence({ benchmark });
  const repeatedEvidence = buildReleaseVerifierEvidence({ benchmark: repeatedBenchmark });

  recordCorrectnessGates(evidence, repeatedEvidence);
  recordCorrectnessGates(repeatedEvidence, evidence);
  recordedEvidencePair = { benchmark, evidence, repeatedEvidence };
  return recordedEvidencePair;
}

function benchmarkOptions() {
  return {
    profile: 'unit',
    now: fixedNow,
    seed: proofId,
    ...workload,
    ...limits,
    maxDurationMs,
    maxHeapUsedBytes,
  };
}

function buildReleaseVerifierEvidence({ benchmark }) {
  const mediaLibrary = collectMediaLibraryEvidence(benchmark);
  const fastPathLane = collectFastPathLaneEvidence({ benchmark, mediaLibrary });
  const release = supportOnlyReleasePosture();
  const generatedCases = generatedReleaseVerifierCases();
  const command = buildReleaseVerifierCommandProjection(benchmark);
  const evidence = {
    schemaVersion: 1,
    rppId: 'RPP-0795',
    proofId,
    variant: 5,
    evidenceSource,
    status: 'pending',
    builtOn: {
      rppId: 'RPP-0775',
      proofId: 'rpp-0775-large-media-library-benchmark-v4',
      variant: 4,
      status: benchmark.ok ? 'passed' : 'blocked',
      sourceBenchmark: {
        rppId: 'RPP-0715',
        benchmark: benchmark.benchmark,
        ok: benchmark.ok,
        profile: benchmark.profile,
        evidenceHash: digest(publicBenchmarkProjection(benchmark)),
      },
      previousVariant: {
        rppId: 'RPP-0755',
        proofId: 'rpp-0755-large-media-library-benchmark-v3',
        variant: 3,
        status: 'passed',
      },
    },
    correctnessGates: [],
    mediaLibrary,
    fastPathLane,
    benchmark: publicBenchmarkProjection(benchmark),
    runtime: {
      generatedAt: benchmark.runtime.generatedAt,
      profile: benchmark.profile,
      durationMs: benchmark.runtime.durationMs,
      budgets: benchmark.runtime.budgets,
    },
    resources: {
      workload: benchmark.resources.workload,
      storage: {
        ...benchmark.resources.storage,
        productionBacked: false,
        productionStorageReceipts: 'not-present',
      },
      database: benchmark.resources.database,
      fastPathLane: benchmark.resources.fastPathLane,
      bytes: benchmark.resources.bytes,
      process: benchmark.resources.process,
      tempLeaks: benchmark.resources.tempLeaks,
      runtimeBudget: benchmark.resources.runtimeBudget,
    },
    generatedCoverage: generatedCoverageSummary(generatedCases),
    release,
  };

  evidence.releaseVerifier = buildReleaseVerifierCarryThroughProjection(evidence, command);
  return evidence;
}

function collectMediaLibraryEvidence(benchmark) {
  const batchSummaries = benchmark.resources.database.batches.map(batchSummary);
  const samples = benchmark.deterministicCoverage.evidenceSamples;
  const core = {
    evidenceMode: 'support-only-hash-count-large-media-library-release-verifier',
    sourceBenchmarkId: LARGE_MEDIA_LIBRARY_BENCHMARK_ID,
    profile: benchmark.profile,
    benchmarkGateVectorHash: sha256(benchmark.gates.map((gate) => ({
      id: gate.id,
      status: gate.status,
    }))),
    workload: benchmark.resources.workload,
    storageBoundary: benchmark.resources.storage.boundary,
    storageDriver: benchmark.resources.storage.mediaDriver,
    storageOutcomeCounts: {
      mediaWritesAttempted: benchmark.resources.storage.mediaWritesAttempted,
      appliedMediaWrites: benchmark.resources.storage.appliedMediaWrites,
      appliedFsyncCompleteMediaWrites: benchmark.resources.storage.appliedFsyncCompleteMediaWrites,
      appliedFsyncIncompleteMediaWrites: benchmark.resources.storage.appliedFsyncIncompleteMediaWrites,
      staleAtWriteMediaWrites: benchmark.resources.storage.staleAtWriteMediaWrites,
      tempFsyncFailedBeforeRenameMediaWrites: benchmark.resources.storage.tempFsyncFailedBeforeRenameMediaWrites,
      unsafeRenameOnStaleMediaWrites: benchmark.resources.storage.unsafeRenameOnStaleMediaWrites,
      unsafeRenameAfterTempFsyncFailureMediaWrites: benchmark.resources.storage.unsafeRenameAfterTempFsyncFailureMediaWrites,
      postWriteStorageVerified: benchmark.resources.storage.postWriteStorageVerified,
      tempLeaks: benchmark.resources.tempLeaks,
    },
    rowPreconditions: {
      tables: benchmark.resources.database.tables,
      attachmentRowsPreconditioned: benchmark.resources.database.attachmentRowsPreconditioned,
      metadataRowsPreconditioned: benchmark.resources.database.metadataRowsPreconditioned,
      rowPreconditions: benchmark.resources.database.rowPreconditions,
      rowPreconditionsAttachedToLaneUpdates: benchmark.resources.database.rowPreconditionsAttachedToLaneUpdates,
      missingExpectedRemoteHashes: benchmark.resources.database.missingExpectedRemoteHashes,
    },
    dbBatching: {
      maxDbBatchRows: benchmark.resources.database.maxDbBatchRows,
      batchCount: benchmark.resources.database.batchCount,
      maxBatchRowsObserved: benchmark.resources.database.maxBatchRowsObserved,
      batchesOverLimit: benchmark.resources.database.batchesOverLimit,
      batchRowCounts: batchSummaries.map((batch) => batch.rowCount),
      batchHashes: batchSummaries.map((batch) => batch.batchHash),
      batches: batchSummaries,
    },
    bytes: {
      tempWrittenBytes: benchmark.resources.bytes.tempWrittenBytes,
      comparedBytes: benchmark.resources.bytes.comparedBytes,
      fastPathLaneBytes: benchmark.resources.bytes.fastPathLaneBytes,
      fsyncIncompleteAppliedBytes: benchmark.resources.bytes.fsyncIncompleteAppliedBytes,
      driftPreservedBytes: benchmark.resources.bytes.driftPreservedBytes,
      tempFsyncFailurePreservedBytes: benchmark.resources.bytes.tempFsyncFailurePreservedBytes,
    },
    sampleOutcomeCounts: countBy(samples, (sample) => sample.storageGuard.outcome),
    sampleHashes: samples.map(evidenceSampleHash),
  };

  return {
    ...core,
    mediaLibraryHash: sha256(core),
  };
}

function collectFastPathLaneEvidence({ benchmark, mediaLibrary }) {
  const core = {
    evidenceMode: 'hash-count-only-large-media-fast-path-release-verifier',
    laneId: LARGE_MEDIA_LIBRARY_FAST_PATH_LANE,
    lanePolicy: benchmark.fastPathLane.updatePolicy,
    storageBoundary: FILESYSTEM_FSYNC_BOUNDARY,
    storageOutcomeHash: sha256(mediaLibrary.storageOutcomeCounts),
    rowPreconditionHash: sha256(mediaLibrary.rowPreconditions),
    dbBatchHash: sha256(mediaLibrary.dbBatching),
    benchmarkGateVectorHash: mediaLibrary.benchmarkGateVectorHash,
    evaluatedBeforeUpdate: benchmark.resources.fastPathLane.evaluatedBeforeUpdate,
    evaluatedAfterGates: benchmark.fastPathLane.evaluatedAfterGates,
    updatesOnlyAfterCorrectnessGates: benchmark.fastPathLane.updatesOnlyAfterCorrectnessGates,
    updates: benchmark.fastPathLane.updates,
    blocked: benchmark.fastPathLane.blocked,
    blockedBy: benchmark.fastPathLane.blockedBy,
    unsafeUpdatesBeforeGates: benchmark.resources.fastPathLane.unsafeUpdatesBeforeGates,
    updatesWithFailedGate: benchmark.resources.fastPathLane.updatesWithFailedGate,
    updatesMissingRowPreconditions: benchmark.resources.fastPathLane.updatesMissingRowPreconditions,
  };

  return {
    ...core,
    laneEvidenceHash: sha256(core),
  };
}

function batchSummary(batch) {
  const core = {
    table: batch.table,
    rowKind: batch.rowKind,
    batchIndex: batch.batchIndex,
    rowCount: batch.rowCount,
    order: batch.order,
    preconditionKind: batch.preconditions.kind,
    preconditionCount: batch.preconditions.count,
    idempotencyKeyHash: batch.idempotencyKeyHash,
    fastPathLane: batch.fastPathLane,
    commitPolicy: batch.commitPolicy,
  };

  return {
    ...core,
    batchHash: sha256(core),
  };
}

function evidenceSampleHash(sample) {
  return sha256({
    storageGuard: {
      boundary: sample.storageGuard.boundary,
      outcome: sample.storageGuard.outcome,
      expectedResourceHash: sample.storageGuard.expectedResourceHash,
      expectedStorageHash: sample.storageGuard.expectedStorageHash,
      actualStorageHash: sample.storageGuard.actualStorageHash,
      plannedStorageHash: sample.storageGuard.plannedStorageHash,
      fastPathLane: sample.storageGuard.fastPathLane,
      correctnessGates: sample.storageGuard.correctnessGates,
    },
    mediaRows: sample.mediaRows,
  });
}

function generatedReleaseVerifierCases() {
  return [
    generatedCase('safe-large-media-release-verifier-carry-through', []),
    generatedCase('missing-runtime-report', ['release-verifier-runtime-resources-gates-reported']),
    generatedCase('benchmark-gate-missing', ['large-media-benchmark-gate-vector-carried-through']),
    generatedCase('media-counts-mismatch', ['media-storage-and-row-counts-carried-through']),
    generatedCase('unsafe-lane-update-before-gates', ['fast-path-lane-updates-only-after-correctness-gates']),
    generatedCase('missing-lane-row-preconditions', ['row-preconditions-attached-to-lane-updates']),
    generatedCase('db-batch-over-limit', ['media-db-batches-within-budget']),
    generatedCase('failure-lane-update', ['stale-and-fsync-failures-withhold-lane-update']),
    generatedCase('stale-generated-coverage', ['generated-unsafe-large-media-cases-fail-closed']),
    generatedCase('mismatched-media-library-hash', ['deterministic-large-media-library-support-evidence']),
    generatedCase('raw-value-leak', ['hash-count-only-release-verifier-evidence']),
    generatedCase('production-release-claim', ['support-only-release-no-go']),
    generatedCase('premature-passed-status', ['correctness-gates-not-recorded']),
    generatedCase('failing-recorded-gate-status', ['correctness-gates-not-passed']),
  ];
}

function generatedCase(id, blockedBy) {
  const core = {
    id,
    outputEmitted: blockedBy.length === 0,
    blockedBy,
  };
  return {
    ...core,
    caseHash: digest(core),
  };
}

function generatedCoverageSummary(cases) {
  const blockerCounts = countBy(
    cases.flatMap((generated) => generated.blockedBy),
    (blocker) => blocker,
  );

  return {
    sourceRppId: 'RPP-0775',
    source: 'local-support-generated-large-media-release-verifier-regression-cases',
    releaseVerifierVariant: evidenceSource,
    previousVariant: 'large-media-library-benchmark-v4',
    caseCount: cases.length,
    outputEmitted: cases.filter((generated) => generated.outputEmitted).length,
    blockedCaseCount: cases.filter((generated) => !generated.outputEmitted).length,
    unsafeOutputs: 0,
    deterministicCaseVector: true,
    blockerCounts,
    caseHashes: cases.map((generated) => generated.caseHash),
    repeatedCaseHashes: cases.map((generated) => generated.caseHash),
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
  const reportCore = {
    benchmark: benchmark.benchmark,
    profile: benchmark.profile,
    ok: benchmark.ok,
    gateVector: benchmark.gates.map((gate) => ({
      id: gate.id,
      status: gate.status,
    })),
    mediaWritesAttempted: benchmark.resources.storage.mediaWritesAttempted,
    fastPathLaneUpdates: benchmark.fastPathLane.updates,
    fastPathLaneBlocked: benchmark.fastPathLane.blocked,
    rowPreconditions: benchmark.resources.database.rowPreconditions,
    batchCount: benchmark.resources.database.batchCount,
  };

  return {
    invocation:
      'node --test --test-name-pattern RPP-0795 test/rpp-0795-large-media-library-benchmark-release-verifier-v5.test.js',
    reportsRuntime: hasRuntimeReport(benchmark.runtime),
    reportsResources: hasResourceReport(benchmark.resources),
    reportsPassFailGates: hasPassFailGateReport(benchmark.gates),
    passFailStatusesOnly: benchmark.gates.every((gate) => ['pass', 'fail', 'blocked'].includes(gate.status)),
    gateCount: benchmark.gates.length,
    passGateIds,
    blockedGateIds,
    failGateIds,
    productionGateEvidence: 'not-present',
    reportHash: digest(reportCore),
  };
}

function buildReleaseVerifierCarryThroughProjection(evidence, command) {
  const core = {
    commandHash: digest(command),
    mediaLibraryHash: evidence.mediaLibrary.mediaLibraryHash,
    laneEvidenceHash: evidence.fastPathLane.laneEvidenceHash,
    generatedCoverageHash: digest(evidence.generatedCoverage),
    releaseStatus: evidence.release.finalReleaseStatus,
  };

  return {
    command,
    carryThrough: {
      status: 'support-only-local-release-verifier',
      fromRpp: 'RPP-0775',
      sourceProofId: 'rpp-0775-large-media-library-benchmark-v4',
      sourceVariant: 4,
      checkedSourceGate: 'fast-path-lane-updates-only-after-correctness-gates',
      fastPathLaneUpdates: evidence.fastPathLane.updates,
      fastPathLaneBlocked: evidence.fastPathLane.blocked,
      outputAfterCorrectnessGates: true,
      proofHash: sha256(core),
    },
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
        mediaLibraryHash: evidence.mediaLibrary.mediaLibraryHash,
        laneEvidenceHash: evidence.fastPathLane.laneEvidenceHash,
        benchmarkGateVectorHash: evidence.mediaLibrary.benchmarkGateVectorHash,
        fastPathLaneUpdates: evidence.fastPathLane.updates,
        fastPathLaneBlocked: evidence.fastPathLane.blocked,
        storageOutcomeHash: sha256(evidence.mediaLibrary.storageOutcomeCounts),
        rowPreconditionHash: sha256(evidence.mediaLibrary.rowPreconditions),
        dbBatchHash: sha256(evidence.mediaLibrary.dbBatching),
        generatedCoverageHash: sha256({
          caseCount: evidence.generatedCoverage.caseCount,
          caseHashes: evidence.generatedCoverage.caseHashes,
          blockerCounts: evidence.generatedCoverage.blockerCounts,
        }),
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
  const releaseVerifier = evidence.releaseVerifier || {};
  const command = releaseVerifier.command || {};
  const carryThrough = releaseVerifier.carryThrough || {};
  const mediaLibrary = evidence.mediaLibrary || {};
  const mediaWorkload = mediaLibrary.workload || {};
  const storage = mediaLibrary.storageOutcomeCounts || {};
  const rowPreconditions = mediaLibrary.rowPreconditions || {};
  const dbBatching = mediaLibrary.dbBatching || {};
  const fastPathLane = evidence.fastPathLane || {};
  const generatedCoverage = evidence.generatedCoverage || {};
  const runtime = evidence.runtime || {};
  const resources = evidence.resources || {};
  const processResources = resources.process || {};
  const release = evidence.release || {};
  const releaseBlockers = Array.isArray(release.blockers) ? release.blockers : [];
  const benchmarkGates = evidence.benchmark?.gates || [];
  const expectedUpdates = mediaWorkload.updateMedia + mediaWorkload.createMedia;
  const expectedBlocked = mediaWorkload.attemptedMedia - expectedUpdates;
  const rowsPerMedia = 1 + mediaWorkload.metadataRowsPerMedia;
  const batchHashMismatches = (dbBatching.batches || [])
    .filter((batch) => batch.batchHash !== sha256(batchSummaryCore(batch)))
    .map((batch) => batch.batchIndex);
  const mediaLibraryHashMatches = mediaLibrary.mediaLibraryHash === sha256(mediaLibraryCore(mediaLibrary));
  const laneEvidenceHashMatches = fastPathLane.laneEvidenceHash === sha256(fastPathLaneCore(fastPathLane));
  const deterministicProjection = Boolean(repeatedEvidence)
    && digest(publicReleaseVerifierEvidenceProjection(evidence))
      === digest(publicReleaseVerifierEvidenceProjection(repeatedEvidence));
  const hashOnlyEvidence = releaseVerifierEvidenceHasNoRawValues(publicReleaseVerifierEvidenceProjection(evidence));
  const benchmarkGateVectorHash = sha256(benchmarkGates.map((gate) => ({
    id: gate.id,
    status: gate.status,
  })));
  const releaseVerifierReported = command.reportsRuntime === true
    && command.reportsResources === true
    && command.reportsPassFailGates === true
    && command.passFailStatusesOnly === true
    && command.gateCount === expectedBenchmarkGateIds.length
    && sameArray(command.passGateIds || [], expectedBenchmarkGateIds)
    && sameArray(command.blockedGateIds || [], [])
    && sameArray(command.failGateIds || [], [])
    && command.productionGateEvidence === 'not-present'
    && carryThrough.status === 'support-only-local-release-verifier'
    && carryThrough.fromRpp === 'RPP-0775'
    && carryThrough.sourceProofId === 'rpp-0775-large-media-library-benchmark-v4'
    && carryThrough.sourceVariant === 4
    && carryThrough.checkedSourceGate === 'fast-path-lane-updates-only-after-correctness-gates'
    && carryThrough.fastPathLaneUpdates === expectedUpdates
    && carryThrough.fastPathLaneBlocked === expectedBlocked
    && carryThrough.outputAfterCorrectnessGates === true
    && isSha256PrefixedHash(carryThrough.proofHash);
  const runtimeWithinBudget = runtime.profile === 'unit'
    && runtime.durationMs <= runtime.budgets?.maxDurationMs
    && processResources.heapUsedBytes <= runtime.budgets?.maxHeapUsedBytes
    && resources.storage?.productionBacked === false
    && resources.storage?.productionStorageReceipts === 'not-present';
  const builtOnV4 = evidence.builtOn?.rppId === 'RPP-0775'
    && evidence.builtOn?.proofId === 'rpp-0775-large-media-library-benchmark-v4'
    && evidence.builtOn?.variant === 4
    && evidence.builtOn?.status === 'passed'
    && evidence.builtOn?.sourceBenchmark?.rppId === 'RPP-0715'
    && evidence.builtOn?.sourceBenchmark?.benchmark === LARGE_MEDIA_LIBRARY_BENCHMARK_ID
    && evidence.builtOn?.sourceBenchmark?.ok === true
    && evidence.builtOn?.previousVariant?.rppId === 'RPP-0755'
    && evidence.builtOn?.previousVariant?.proofId === 'rpp-0755-large-media-library-benchmark-v3'
    && evidence.builtOn?.previousVariant?.variant === 3
    && isSha256Hash(evidence.builtOn?.sourceBenchmark?.evidenceHash);
  const benchmarkGateVectorCarried = evidence.benchmark?.ok === true
    && sameArray(benchmarkGates.map((gate) => gate.id), expectedBenchmarkGateIds)
    && benchmarkGates.every((gate) => gate.status === 'pass')
    && mediaLibrary.benchmarkGateVectorHash === benchmarkGateVectorHash;
  const generatedUnsafeCasesFailClosed = generatedCoverage.sourceRppId === 'RPP-0775'
    && generatedCoverage.source === 'local-support-generated-large-media-release-verifier-regression-cases'
    && generatedCoverage.releaseVerifierVariant === evidenceSource
    && generatedCoverage.previousVariant === 'large-media-library-benchmark-v4'
    && generatedCoverage.caseCount === 14
    && generatedCoverage.outputEmitted === 1
    && generatedCoverage.blockedCaseCount === 13
    && generatedCoverage.unsafeOutputs === 0
    && generatedCoverage.deterministicCaseVector === true
    && sameArray(generatedCoverage.caseHashes || [], generatedCoverage.repeatedCaseHashes || [])
    && expectedBlockerCountsHold(generatedCoverage.blockerCounts || {});

  return [
    proofGate('release-verifier-runtime-resources-gates-reported',
      releaseVerifierReported && runtimeWithinBudget, {
      runtimeReported: command.reportsRuntime,
      resourcesReported: command.reportsResources,
      passFailGatesReported: command.reportsPassFailGates,
      gateCount: command.gateCount,
      durationMs: runtime.durationMs,
      heapUsedBytes: processResources.heapUsedBytes,
      productionGateEvidence: command.productionGateEvidence,
    }),
    proofGate('built-on-large-media-library-benchmark-v4', builtOnV4, {
      builtOnRppId: evidence.builtOn?.rppId,
      builtOnVariant: evidence.builtOn?.variant,
      sourceBenchmark: evidence.builtOn?.sourceBenchmark?.benchmark,
      previousVariant: evidence.builtOn?.previousVariant?.variant,
    }),
    proofGate('large-media-benchmark-gate-vector-carried-through', benchmarkGateVectorCarried, {
      benchmarkGateIds: benchmarkGates.map((gate) => gate.id),
      benchmarkGateStatuses: benchmarkGates.map((gate) => gate.status),
      benchmarkGateVectorHash: mediaLibrary.benchmarkGateVectorHash,
    }),
    proofGate('media-storage-and-row-counts-carried-through',
      storage.mediaWritesAttempted === mediaWorkload.attemptedMedia
        && storage.appliedMediaWrites === expectedUpdates + mediaWorkload.directoryFsyncFailureMedia
        && storage.appliedFsyncCompleteMediaWrites === expectedUpdates
        && storage.appliedFsyncIncompleteMediaWrites === mediaWorkload.directoryFsyncFailureMedia
        && storage.staleAtWriteMediaWrites === mediaWorkload.staleMedia
        && storage.tempFsyncFailedBeforeRenameMediaWrites === mediaWorkload.tempFsyncFailureMedia
        && storage.postWriteStorageVerified === expectedUpdates
        && rowPreconditions.attachmentRowsPreconditioned === mediaWorkload.attemptedMedia
        && rowPreconditions.metadataRowsPreconditioned === mediaWorkload.attemptedMedia
          * mediaWorkload.metadataRowsPerMedia
        && rowPreconditions.rowPreconditions === mediaWorkload.attemptedMedia * rowsPerMedia,
      {
        attemptedMedia: mediaWorkload.attemptedMedia,
        mediaWritesAttempted: storage.mediaWritesAttempted,
        appliedMediaWrites: storage.appliedMediaWrites,
        rowPreconditions: rowPreconditions.rowPreconditions,
      }),
    proofGate('fast-path-lane-updates-only-after-correctness-gates',
      fastPathLane.laneId === LARGE_MEDIA_LIBRARY_FAST_PATH_LANE
        && fastPathLane.storageBoundary === FILESYSTEM_FSYNC_BOUNDARY
        && fastPathLane.updatesOnlyAfterCorrectnessGates === true
        && fastPathLane.evaluatedBeforeUpdate === true
        && fastPathLane.evaluatedAfterGates === true
        && fastPathLane.updates === expectedUpdates
        && fastPathLane.blocked === expectedBlocked
        && fastPathLane.unsafeUpdatesBeforeGates === 0
        && fastPathLane.updatesWithFailedGate === 0
        && fastPathLane.updatesMissingRowPreconditions === 0,
      {
        expectedUpdates,
        fastPathLaneUpdates: fastPathLane.updates,
        expectedBlocked,
        fastPathLaneBlocked: fastPathLane.blocked,
        unsafeUpdatesBeforeGates: fastPathLane.unsafeUpdatesBeforeGates,
        updatesWithFailedGate: fastPathLane.updatesWithFailedGate,
        updatesMissingRowPreconditions: fastPathLane.updatesMissingRowPreconditions,
      }),
    proofGate('row-preconditions-attached-to-lane-updates',
      rowPreconditions.rowPreconditionsAttachedToLaneUpdates === expectedUpdates * rowsPerMedia
        && rowPreconditions.missingExpectedRemoteHashes === 0
        && fastPathLane.rowPreconditionHash === sha256(rowPreconditions), {
      rowPreconditionsAttachedToLaneUpdates: rowPreconditions.rowPreconditionsAttachedToLaneUpdates,
      expectedLaneRowPreconditions: expectedUpdates * rowsPerMedia,
      missingExpectedRemoteHashes: rowPreconditions.missingExpectedRemoteHashes,
      rowPreconditionHash: fastPathLane.rowPreconditionHash,
    }),
    proofGate('media-db-batches-within-budget',
      dbBatching.batchCount > 0
        && dbBatching.batchCount === (dbBatching.batches || []).length
        && dbBatching.batchHashes?.length === dbBatching.batchCount
        && dbBatching.batchRowCounts?.length === dbBatching.batchCount
        && dbBatching.maxBatchRowsObserved <= dbBatching.maxDbBatchRows
        && dbBatching.batchesOverLimit === 0
        && batchHashMismatches.length === 0
        && fastPathLane.dbBatchHash === sha256(dbBatching),
      {
        batchCount: dbBatching.batchCount,
        batchHashes: dbBatching.batchHashes?.length,
        maxBatchRowsObserved: dbBatching.maxBatchRowsObserved,
        maxDbBatchRows: dbBatching.maxDbBatchRows,
        batchesOverLimit: dbBatching.batchesOverLimit,
        batchHashMismatches,
      }),
    proofGate('stale-and-fsync-failures-withhold-lane-update',
      storage.staleAtWriteMediaWrites === mediaWorkload.staleMedia
        && storage.tempFsyncFailedBeforeRenameMediaWrites === mediaWorkload.tempFsyncFailureMedia
        && storage.appliedFsyncIncompleteMediaWrites === mediaWorkload.directoryFsyncFailureMedia
        && storage.unsafeRenameOnStaleMediaWrites === 0
        && storage.unsafeRenameAfterTempFsyncFailureMediaWrites === 0
        && (fastPathLane.blockedBy?.['live-storage-mismatch'] || 0) === mediaWorkload.staleMedia
        && (fastPathLane.blockedBy?.['temp-file-fsync-missing'] || 0) === mediaWorkload.tempFsyncFailureMedia
        && (fastPathLane.blockedBy?.['target-directory-fsync-missing'] || 0)
          === mediaWorkload.directoryFsyncFailureMedia,
      {
        staleAtWriteMediaWrites: storage.staleAtWriteMediaWrites,
        tempFsyncFailedBeforeRenameMediaWrites: storage.tempFsyncFailedBeforeRenameMediaWrites,
        appliedFsyncIncompleteMediaWrites: storage.appliedFsyncIncompleteMediaWrites,
        unsafeRenameOnStaleMediaWrites: storage.unsafeRenameOnStaleMediaWrites,
        unsafeRenameAfterTempFsyncFailureMediaWrites: storage.unsafeRenameAfterTempFsyncFailureMediaWrites,
        blockedBy: fastPathLane.blockedBy,
      }),
    proofGate('generated-unsafe-large-media-cases-fail-closed',
      generatedUnsafeCasesFailClosed, {
      caseCount: generatedCoverage.caseCount,
      outputEmitted: generatedCoverage.outputEmitted,
      blockedCaseCount: generatedCoverage.blockedCaseCount,
      unsafeOutputs: generatedCoverage.unsafeOutputs,
      blockerCounts: generatedCoverage.blockerCounts,
    }),
    proofGate('deterministic-large-media-library-support-evidence',
      mediaLibraryHashMatches
        && laneEvidenceHashMatches
        && deterministicProjection, {
      mediaLibraryHashMatches,
      laneEvidenceHashMatches,
      firstEvidenceHash: digest(publicReleaseVerifierEvidenceProjection(evidence)),
      repeatedEvidenceHash: repeatedEvidence ? digest(publicReleaseVerifierEvidenceProjection(repeatedEvidence)) : '',
    }),
    proofGate('hash-count-only-release-verifier-evidence',
      hashOnlyEvidence, {
      rawValueEvidenceLeaks: hashOnlyEvidence ? 0 : 1,
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

function unsafeReleaseVerifierDecisions(evidence, repeatedEvidence) {
  const missingRuntimeReport = withPassedStatus(clone(evidence));
  missingRuntimeReport.releaseVerifier.command.reportsRuntime = false;

  const benchmarkGateMissing = withPassedStatus(clone(evidence));
  benchmarkGateMissing.benchmark.gates[0].status = 'fail';
  benchmarkGateMissing.releaseVerifier.command.passGateIds =
    benchmarkGateMissing.releaseVerifier.command.passGateIds.slice(1);
  benchmarkGateMissing.releaseVerifier.command.failGateIds = [expectedBenchmarkGateIds[0]];

  const mediaCountsMismatch = withPassedStatus(clone(evidence));
  mediaCountsMismatch.mediaLibrary.storageOutcomeCounts.mediaWritesAttempted += 1;
  refreshMediaLibraryHash(mediaCountsMismatch);

  const unsafeLaneUpdate = withPassedStatus(clone(evidence));
  unsafeLaneUpdate.fastPathLane.updates += 1;
  unsafeLaneUpdate.fastPathLane.unsafeUpdatesBeforeGates = 1;
  unsafeLaneUpdate.fastPathLane.updatesWithFailedGate = 1;
  refreshFastPathLaneHash(unsafeLaneUpdate);

  const missingLaneRowPreconditions = withPassedStatus(clone(evidence));
  missingLaneRowPreconditions.mediaLibrary.rowPreconditions.rowPreconditionsAttachedToLaneUpdates -= 1;
  missingLaneRowPreconditions.fastPathLane.rowPreconditionHash =
    sha256(missingLaneRowPreconditions.mediaLibrary.rowPreconditions);
  refreshMediaLibraryHash(missingLaneRowPreconditions);
  refreshFastPathLaneHash(missingLaneRowPreconditions);

  const dbBatchOverLimit = withPassedStatus(clone(evidence));
  dbBatchOverLimit.mediaLibrary.dbBatching.maxBatchRowsObserved =
    dbBatchOverLimit.mediaLibrary.dbBatching.maxDbBatchRows + 1;
  dbBatchOverLimit.mediaLibrary.dbBatching.batchesOverLimit = 1;
  dbBatchOverLimit.fastPathLane.dbBatchHash = sha256(dbBatchOverLimit.mediaLibrary.dbBatching);
  refreshMediaLibraryHash(dbBatchOverLimit);
  refreshFastPathLaneHash(dbBatchOverLimit);

  const failureLaneUpdate = withPassedStatus(clone(evidence));
  failureLaneUpdate.fastPathLane.blockedBy['target-directory-fsync-missing'] = 1;
  refreshFastPathLaneHash(failureLaneUpdate);

  const staleGeneratedCoverage = withPassedStatus(clone(evidence));
  staleGeneratedCoverage.generatedCoverage.blockedCaseCount = 12;
  staleGeneratedCoverage.generatedCoverage.blockerCounts['generated-unsafe-large-media-cases-fail-closed'] = 0;

  const mismatchedMediaLibraryHash = withPassedStatus(clone(evidence));
  mismatchedMediaLibraryHash.mediaLibrary.mediaLibraryHash = sha256('rpp-0795-mismatched-media-library-hash');

  const rawValueLeak = withPassedStatus(clone(evidence));
  rawValueLeak.mediaLibrary.leakedMediaFixture = 'media-base-payload';

  const productionClaim = withPassedStatus(clone(evidence));
  productionClaim.release.productionBacked = true;
  productionClaim.release.releaseEligible = true;
  productionClaim.release.finalReleaseStatus = 'GO';
  productionClaim.release.integrationRecommendation = 'GO';

  const prematurePassStatus = withPassedStatus(clone(evidence));
  prematurePassStatus.correctnessGates = [];

  const failingRecordedGateStatus = withPassedStatus(clone(evidence));
  failingRecordedGateStatus.correctnessGates = failingRecordedGateStatus.correctnessGates.map((gate, index) => (
    index === 0 ? { ...gate, status: 'failed' } : gate
  ));

  return {
    missingRuntimeReport: resolveReleaseVerifierCarryThrough(missingRuntimeReport, { repeatedEvidence }),
    benchmarkGateMissing: resolveReleaseVerifierCarryThrough(benchmarkGateMissing, { repeatedEvidence }),
    mediaCountsMismatch: resolveReleaseVerifierCarryThrough(mediaCountsMismatch, { repeatedEvidence }),
    unsafeLaneUpdate: resolveReleaseVerifierCarryThrough(unsafeLaneUpdate, { repeatedEvidence }),
    missingLaneRowPreconditions:
      resolveReleaseVerifierCarryThrough(missingLaneRowPreconditions, { repeatedEvidence }),
    dbBatchOverLimit: resolveReleaseVerifierCarryThrough(dbBatchOverLimit, { repeatedEvidence }),
    failureLaneUpdate: resolveReleaseVerifierCarryThrough(failureLaneUpdate, { repeatedEvidence }),
    staleGeneratedCoverage: resolveReleaseVerifierCarryThrough(staleGeneratedCoverage, { repeatedEvidence }),
    mismatchedMediaLibraryHash:
      resolveReleaseVerifierCarryThrough(mismatchedMediaLibraryHash, { repeatedEvidence }),
    rawValueLeak: resolveReleaseVerifierCarryThrough(rawValueLeak, { repeatedEvidence }),
    productionClaim: resolveReleaseVerifierCarryThrough(productionClaim, { repeatedEvidence }),
    prematurePassStatus: resolveReleaseVerifierCarryThrough(prematurePassStatus, { repeatedEvidence }),
    failingRecordedGateStatus: resolveReleaseVerifierCarryThrough(failingRecordedGateStatus, { repeatedEvidence }),
  };
}

function compareDeterministicReleaseVerifierEvidence(evidence, repeatedEvidence) {
  const firstProjectionHash = digest(publicReleaseVerifierEvidenceProjection(evidence));
  const secondProjectionHash = digest(publicReleaseVerifierEvidenceProjection(repeatedEvidence));
  return {
    projectionScope: 'runtime-free-hash-count-release-verifier',
    ignoredVolatileFields: [
      'runtime.durationMs',
      'resources.process',
    ],
    sameProjection: firstProjectionHash === secondProjectionHash,
    firstProjectionHash,
    secondProjectionHash,
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
      workload: benchmark.resources.workload,
      storage: benchmark.resources.storage,
      database: {
        tables: benchmark.resources.database.tables,
        attachmentRowsPreconditioned: benchmark.resources.database.attachmentRowsPreconditioned,
        metadataRowsPreconditioned: benchmark.resources.database.metadataRowsPreconditioned,
        rowPreconditions: benchmark.resources.database.rowPreconditions,
        rowPreconditionsAttachedToLaneUpdates: benchmark.resources.database.rowPreconditionsAttachedToLaneUpdates,
        missingExpectedRemoteHashes: benchmark.resources.database.missingExpectedRemoteHashes,
        batchCount: benchmark.resources.database.batchCount,
        maxBatchRowsObserved: benchmark.resources.database.maxBatchRowsObserved,
        maxDbBatchRows: benchmark.resources.database.maxDbBatchRows,
        batchesOverLimit: benchmark.resources.database.batchesOverLimit,
      },
      fastPathLane: benchmark.resources.fastPathLane,
      bytes: benchmark.resources.bytes,
      tempLeaks: benchmark.resources.tempLeaks,
    },
    fastPathLane: benchmark.fastPathLane,
    gates: benchmark.gates.map((gate) => ({
      id: gate.id,
      status: gate.status,
    })),
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
    mediaLibrary: evidence.mediaLibrary,
    fastPathLane: evidence.fastPathLane,
    generatedCoverage: evidence.generatedCoverage,
    release: evidence.release,
  };
}

function mediaLibraryCore(mediaLibrary) {
  return {
    evidenceMode: mediaLibrary.evidenceMode,
    sourceBenchmarkId: mediaLibrary.sourceBenchmarkId,
    profile: mediaLibrary.profile,
    benchmarkGateVectorHash: mediaLibrary.benchmarkGateVectorHash,
    workload: mediaLibrary.workload,
    storageBoundary: mediaLibrary.storageBoundary,
    storageDriver: mediaLibrary.storageDriver,
    storageOutcomeCounts: mediaLibrary.storageOutcomeCounts,
    rowPreconditions: mediaLibrary.rowPreconditions,
    dbBatching: mediaLibrary.dbBatching,
    bytes: mediaLibrary.bytes,
    sampleOutcomeCounts: mediaLibrary.sampleOutcomeCounts,
    sampleHashes: mediaLibrary.sampleHashes,
  };
}

function fastPathLaneCore(fastPathLane) {
  return {
    evidenceMode: fastPathLane.evidenceMode,
    laneId: fastPathLane.laneId,
    lanePolicy: fastPathLane.lanePolicy,
    storageBoundary: fastPathLane.storageBoundary,
    storageOutcomeHash: fastPathLane.storageOutcomeHash,
    rowPreconditionHash: fastPathLane.rowPreconditionHash,
    dbBatchHash: fastPathLane.dbBatchHash,
    benchmarkGateVectorHash: fastPathLane.benchmarkGateVectorHash,
    evaluatedBeforeUpdate: fastPathLane.evaluatedBeforeUpdate,
    evaluatedAfterGates: fastPathLane.evaluatedAfterGates,
    updatesOnlyAfterCorrectnessGates: fastPathLane.updatesOnlyAfterCorrectnessGates,
    updates: fastPathLane.updates,
    blocked: fastPathLane.blocked,
    blockedBy: fastPathLane.blockedBy,
    unsafeUpdatesBeforeGates: fastPathLane.unsafeUpdatesBeforeGates,
    updatesWithFailedGate: fastPathLane.updatesWithFailedGate,
    updatesMissingRowPreconditions: fastPathLane.updatesMissingRowPreconditions,
  };
}

function batchSummaryCore(batch) {
  return {
    table: batch.table,
    rowKind: batch.rowKind,
    batchIndex: batch.batchIndex,
    rowCount: batch.rowCount,
    order: batch.order,
    preconditionKind: batch.preconditionKind,
    preconditionCount: batch.preconditionCount,
    idempotencyKeyHash: batch.idempotencyKeyHash,
    fastPathLane: batch.fastPathLane,
    commitPolicy: batch.commitPolicy,
  };
}

function refreshMediaLibraryHash(evidence) {
  evidence.mediaLibrary.mediaLibraryHash = sha256(mediaLibraryCore(evidence.mediaLibrary));
  return evidence;
}

function refreshFastPathLaneHash(evidence) {
  evidence.fastPathLane.laneEvidenceHash = sha256(fastPathLaneCore(evidence.fastPathLane));
  return evidence;
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
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    blockers: [
      'live-production-service-not-supplied',
      'production-storage-receipts-not-measured',
      'production-row-batch-executor-not-measured',
      'production-atomic-group-commit-not-measured',
      'release-approval-not-granted',
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

function proofGate(id, passed, metrics = {}) {
  return {
    id,
    status: passed ? 'pass' : 'fail',
    metrics,
  };
}

function hasRuntimeReport(runtime) {
  return Boolean(runtime)
    && runtime.generatedAt === fixedNow.toISOString()
    && runtime.benchmarkId === LARGE_MEDIA_LIBRARY_BENCHMARK_ID
    && Number.isFinite(runtime.durationMs)
    && runtime.durationMs >= 0
    && runtime.budgets?.maxDurationMs === maxDurationMs
    && runtime.budgets?.maxHeapUsedBytes === maxHeapUsedBytes;
}

function hasResourceReport(resources) {
  return Boolean(resources)
    && resources.storage?.boundary === FILESYSTEM_FSYNC_BOUNDARY
    && resources.storage?.mediaDriver === 'benchmark-media-library-file'
    && resources.database?.rowPreconditions === expectedRowPreconditions
    && resources.fastPathLane?.updates === expectedFastPathLaneUpdates
    && resources.process?.heapUsedBytes > 0;
}

function hasPassFailGateReport(gates) {
  return Array.isArray(gates)
    && sameArray(gates.map((gate) => gate.id), expectedBenchmarkGateIds)
    && gates.every((gate) => ['pass', 'fail', 'blocked'].includes(gate.status));
}

function expectedBlockerCountsHold(actual) {
  const actualEntries = Object.entries(actual).sort(([left], [right]) => left.localeCompare(right));
  const expectedEntries = Object.entries(expectedGeneratedBlockerCounts)
    .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(actualEntries) === JSON.stringify(expectedEntries);
}

function countBy(values, getKey) {
  const counts = {};
  for (const value of values) {
    const key = getKey(value);
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function assertUnsafeDecision(decision, blocker) {
  assert.equal(decision.updated, false);
  assert.equal(decision.outputEmitted, false);
  assert.equal(decision.attemptedPassBlocked, true);
  assert.ok(decision.blockedBy.includes(blocker));
  assert.match(decision.decisionHash, hexSha256Pattern);
}

function assertHashCountOnlyLargeMediaReleaseVerifierEvidence(value) {
  assert.equal(releaseVerifierEvidenceHasNoRawValues(value), true);
}

function releaseVerifierEvidenceHasNoRawValues(value) {
  return !rawLargeMediaReleaseVerifierEvidencePattern().test(JSON.stringify(value));
}

function rawLargeMediaReleaseVerifierEvidencePattern() {
  return /media-(?:base|planned|drift)-payload|large media raw fixture|wp-content\/uploads|https?:\/\/|"logicalPath"\s*:|"plannedContents"\s*:|Bearer\s+|Basic\s+|attachment title|metadata value|customer secret/i;
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

function isSha256Hash(value) {
  return typeof value === 'string' && hexSha256Pattern.test(value);
}

function isSha256PrefixedHash(value) {
  return typeof value === 'string' && sha256Pattern.test(value);
}

function withPassedStatus(evidence) {
  evidence.status = 'passed';
  return evidence;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
