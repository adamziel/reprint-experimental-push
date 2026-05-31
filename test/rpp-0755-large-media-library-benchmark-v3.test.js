import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FILESYSTEM_FSYNC_BOUNDARY,
} from '../src/filesystem-fsync-evidence.js';
import {
  LARGE_MEDIA_LIBRARY_BENCHMARK_ID,
  LARGE_MEDIA_LIBRARY_FAST_PATH_LANE,
  runLargeMediaLibraryBenchmark,
} from '../scripts/bench/large-media-library-benchmark.js';
import { digest } from '../src/stable-json.js';

const proofId = 'rpp-0755-large-media-library-benchmark-v3';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const maxDurationMs = 5_000;
const maxHeapUsedBytes = 128 * 1024 * 1024;
const workload = Object.freeze({
  updateMedia: 6,
  createMedia: 2,
  staleMedia: 3,
  tempFsyncFailureMedia: 1,
  directoryFsyncFailureMedia: 2,
  fileBytes: 3_072,
  metadataRowsPerMedia: 4,
});
const limits = Object.freeze({
  maxDbBatchRows: 6,
});
const expectedAttemptedMedia = 14;
const expectedFastPathLaneUpdates = 8;
const expectedFastPathLaneBlocked = 6;
const expectedRowPreconditions = 70;
const expectedLaneRowPreconditions = 40;
const expectedGateIds = Object.freeze([
  'benchmark-storage-performance-gates-pass',
  'generated-large-media-library-coverage-recorded',
  'media-counts-match',
  'fast-path-lane-updates-only-after-correctness-gates',
  'row-preconditions-attached-to-lane-updates',
  'media-db-batches-within-budget',
  'stale-and-fsync-failures-withhold-lane-update',
  'deterministic-hash-only-storage-evidence',
  'runtime-resource-budget',
  'support-only-release-no-go',
]);

let recordedEvidencePair;

test('RPP-0755 variant 3 proves generated large media library coverage gates before fast-path output', {
  concurrency: false,
}, () => {
  const proof = buildVariant3Proof();

  assert.equal(proof.rppId, 'RPP-0755');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 3);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.generatedCoverage.source, 'local-support-generated-large-media-library-cases');
  assert.equal(proof.generatedCoverage.variant, 'large-media-library-benchmark-v3');
  assert.equal(proof.generatedCoverage.deterministic, true);
  assert.equal(proof.generatedCoverage.expectedCases, expectedAttemptedMedia);
  assert.equal(proof.generatedCoverage.fastPathLaneUpdates, expectedFastPathLaneUpdates);
  assert.equal(proof.generatedCoverage.fastPathLaneBlocked, expectedFastPathLaneBlocked);
  assert.match(proof.generatedCoverage.workloadHash, /^[a-f0-9]{64}$/);
  assert.match(proof.generatedCoverage.outcomeCountsHash, /^[a-f0-9]{64}$/);

  assert.equal(proof.builtOn.rppId, 'RPP-0715');
  assert.equal(proof.builtOn.benchmark, LARGE_MEDIA_LIBRARY_BENCHMARK_ID);
  assert.equal(proof.builtOn.ok, true);
  assert.match(proof.builtOn.evidenceHash, /^[a-f0-9]{64}$/);

  assert.equal(proof.runtime.generatedAt, fixedNow.toISOString());
  assert.equal(proof.runtime.durationMs >= 0, true);
  assert.equal(proof.runtime.durationMs <= proof.runtime.budgets.maxDurationMs, true);
  assert.equal(proof.resources.process.heapUsedBytes <= proof.runtime.budgets.maxHeapUsedBytes, true);
  assert.deepEqual([...new Set(proof.benchmark.gates.map((gate) => gate.status))], ['pass']);

  assert.equal(proof.resources.storage.boundary, FILESYSTEM_FSYNC_BOUNDARY);
  assert.equal(proof.resources.storage.engine, 'filesystem');
  assert.equal(proof.resources.storage.mediaDriver, 'benchmark-media-library-file');
  assert.equal(proof.resources.storage.mediaWritesAttempted, expectedAttemptedMedia);
  assert.equal(proof.resources.storage.appliedMediaWrites, 10);
  assert.equal(proof.resources.storage.appliedFsyncCompleteMediaWrites, expectedFastPathLaneUpdates);
  assert.equal(proof.resources.storage.appliedFsyncIncompleteMediaWrites, 2);
  assert.equal(proof.resources.storage.staleAtWriteMediaWrites, 3);
  assert.equal(proof.resources.storage.tempFsyncFailedBeforeRenameMediaWrites, 1);
  assert.equal(proof.resources.storage.unsafeRenameOnStaleMediaWrites, 0);
  assert.equal(proof.resources.storage.unsafeRenameAfterTempFsyncFailureMediaWrites, 0);
  assert.equal(proof.resources.storage.postWriteStorageVerified, expectedFastPathLaneUpdates);

  assert.deepEqual(proof.resources.database.tables, ['wp_posts', 'wp_postmeta']);
  assert.equal(proof.resources.database.attachmentRowsPreconditioned, expectedAttemptedMedia);
  assert.equal(proof.resources.database.metadataRowsPreconditioned, 56);
  assert.equal(proof.resources.database.rowPreconditions, expectedRowPreconditions);
  assert.equal(proof.resources.database.rowPreconditionsAttachedToLaneUpdates, expectedLaneRowPreconditions);
  assert.equal(proof.resources.database.missingExpectedRemoteHashes, 0);
  assert.equal(proof.resources.database.batchCount, 13);
  assert.equal(proof.resources.database.maxBatchRowsObserved, limits.maxDbBatchRows);
  assert.equal(proof.resources.database.batchesOverLimit, 0);

  assert.equal(proof.fastPathLaneEvidence.laneId, LARGE_MEDIA_LIBRARY_FAST_PATH_LANE);
  assert.equal(proof.fastPathLaneEvidence.storageBoundary, FILESYSTEM_FSYNC_BOUNDARY);
  assert.equal(proof.fastPathLaneEvidence.fastPathLane.updatesOnlyAfterCorrectnessGates, true);
  assert.equal(proof.fastPathLaneEvidence.fastPathLane.updates, expectedFastPathLaneUpdates);
  assert.equal(proof.fastPathLaneEvidence.fastPathLane.blocked, expectedFastPathLaneBlocked);
  assert.deepEqual(proof.fastPathLaneEvidence.fastPathLane.blockedBy, {
    'live-storage-mismatch': 3,
    'target-directory-fsync-missing': 2,
    'temp-file-fsync-missing': 1,
  });
  assert.equal(proof.fastPathLaneEvidence.sampleHashes.length, 12);
  assert.deepEqual(proof.fastPathLaneEvidence.sampleOutcomeCounts, {
    applied: 8,
    'fsync-failed-before-rename': 1,
    'stale-at-write': 3,
  });
  assert.match(proof.fastPathLaneEvidence.laneEvidenceHash, /^sha256:[a-f0-9]{64}$/);

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
  assert.equal(proof.correctness.correctnessGatesHoldBeforeLaneUpdate, true);
  assert.equal(proof.correctness.correctnessGatesRecordedBeforeLaneEvidence, true);
  assert.equal(proof.correctness.hashOnlyLaneOutput, true);
  assert.equal(proof.correctness.fastPathLaneOutputEmittedAfterGates, true);
  assert.match(proof.fastPathLaneEvidence.outputHash, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(proof.gates.map((gate) => gate.status), [
    'pass',
    'pass',
    'pass',
    'pass',
  ]);

  assert.equal(proof.unsafe.unsafeLaneUpdate.updated, false);
  assert.equal(proof.unsafe.unsafeLaneUpdate.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.unsafeLaneUpdate.blockedBy.includes(
    'fast-path-lane-updates-only-after-correctness-gates',
  ));
  assert.equal(proof.unsafe.missingLaneRowPreconditions.updated, false);
  assert.equal(proof.unsafe.missingLaneRowPreconditions.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.missingLaneRowPreconditions.blockedBy.includes(
    'row-preconditions-attached-to-lane-updates',
  ));
  assert.equal(proof.unsafe.mismatchedLaneEvidenceHash.updated, false);
  assert.equal(proof.unsafe.mismatchedLaneEvidenceHash.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.mismatchedLaneEvidenceHash.blockedBy.includes(
    'deterministic-hash-only-storage-evidence',
  ));
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
  assertHashOnlyLargeMediaEvidence(proof);
});

test('RPP-0755 variant 3 fails closed before fast-path lane output on unsafe generated evidence', () => {
  const { evidence, repeatedEvidence } = buildRecordedEvidencePair();
  const safeDecision = resolveLargeMediaLibraryProof(evidence, { repeatedEvidence });
  const unsafeDecisions = unsafeLargeMediaEvidenceDecisions(evidence, repeatedEvidence);

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
  assert.equal(unsafeDecisions.unsafeLaneUpdate.updated, false);
  assert.ok(unsafeDecisions.unsafeLaneUpdate.blockedBy.includes(
    'fast-path-lane-updates-only-after-correctness-gates',
  ));
  assert.equal(unsafeDecisions.missingLaneRowPreconditions.updated, false);
  assert.ok(unsafeDecisions.missingLaneRowPreconditions.blockedBy.includes(
    'row-preconditions-attached-to-lane-updates',
  ));
  assert.equal(unsafeDecisions.mismatchedLaneEvidenceHash.updated, false);
  assert.ok(unsafeDecisions.mismatchedLaneEvidenceHash.blockedBy.includes(
    'deterministic-hash-only-storage-evidence',
  ));
  assert.equal(unsafeDecisions.prematurePassStatus.updated, false);
  assert.ok(unsafeDecisions.prematurePassStatus.blockedBy.includes('correctness-gates-not-recorded'));

  for (const decision of Object.values(unsafeDecisions)) {
    assert.equal(decision.output, null);
    assert.equal(decision.outputEmitted, false);
    assert.equal(decision.attemptedPassBlocked, true);
    assert.match(decision.decisionHash, /^[a-f0-9]{64}$/);
    assertHashOnlyLargeMediaEvidence(decision);
  }
});

function buildVariant3Proof() {
  const { benchmark, evidence, repeatedEvidence } = buildRecordedEvidencePair();
  const safeDecision = resolveLargeMediaLibraryProof(evidence, { repeatedEvidence });
  const unsafe = projectUnsafeDecisions(unsafeLargeMediaEvidenceDecisions(evidence, repeatedEvidence));
  const correctnessGatesRecordedBeforeLaneEvidence = objectKeyBefore(
    evidence,
    'correctnessGates',
    'fastPathLaneEvidence',
  );
  const benchmarkGatesPass = benchmark.gates.every((gate) => gate.status === 'pass');
  const supportOnlyRelease = supportOnlyReleasePosture();
  const proofGates = [
    proofGate('benchmark-storage-performance-gates-pass', benchmark.ok && benchmarkGatesPass, {
      benchmarkGateStatuses: benchmark.gates.map((gate) => gate.status),
      durationMs: benchmark.runtime.durationMs,
      heapUsedBytes: benchmark.resources.process.heapUsedBytes,
    }),
    proofGate('fast-path-lane-output-after-correctness-gates', safeDecision.updated
      && safeDecision.outputEmitted
      && correctnessGatesRecordedBeforeLaneEvidence, {
      outputEmitted: safeDecision.outputEmitted,
      correctnessGatesRecordedBeforeLaneEvidence,
      blockedBy: safeDecision.blockedBy,
    }),
    proofGate('unsafe-generated-large-media-evidence-fails-closed', Object.values(unsafe).every((decision) => (
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
    rppId: 'RPP-0755',
    proofId,
    variant: 3,
    generatedCoverage: evidence.generatedCoverage,
    status: proofGates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed',
    builtOn: {
      rppId: 'RPP-0715',
      benchmark: benchmark.benchmark,
      ok: benchmark.ok,
      profile: benchmark.profile,
      evidenceHash: digest(publicBenchmarkProjection(benchmark)),
    },
    runtime: {
      generatedAt: benchmark.runtime.generatedAt,
      durationMs: benchmark.runtime.durationMs,
      budgets: benchmark.runtime.budgets,
    },
    resources: {
      workload: benchmark.resources.workload,
      storage: benchmark.resources.storage,
      database: benchmark.resources.database,
      fastPathLane: benchmark.resources.fastPathLane,
      bytes: benchmark.resources.bytes,
      process: benchmark.resources.process,
      tempLeaks: benchmark.resources.tempLeaks,
    },
    benchmark: publicBenchmarkProjection(benchmark),
    fastPathLaneEvidence: {
      ...evidence.fastPathLaneEvidence,
      outputHash: safeDecision.outputHash,
    },
    correctness: {
      gateIds: evidence.correctnessGates.map((gate) => gate.id),
      recomputedGateVector: safeDecision.recomputedGates,
      correctnessGatesRecordedBeforeLaneEvidence,
      correctnessGatesHoldBeforeLaneUpdate: safeDecision.correctnessGatesHold,
      hashOnlyLaneOutput: safeDecision.hashOnlyLaneOutput,
      fastPathLaneOutputEmittedAfterGates: safeDecision.outputEmitted,
    },
    unsafe,
    gates: proofGates,
    release: supportOnlyRelease,
    redaction: {
      mode: 'hash-only-generated-storage-and-row-evidence',
      rawValueEvidenceLeaks: largeMediaEvidenceHasNoRawValues(evidence.fastPathLaneEvidence) ? 0 : 1,
      publicLaneEvidenceHash: digest(publicLargeMediaEvidenceProjection(evidence)),
      repeatedLaneEvidenceHash: digest(publicLargeMediaEvidenceProjection(repeatedEvidence)),
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
  const evidence = buildLargeMediaLibraryEvidence({ benchmark });
  const repeatedEvidence = buildLargeMediaLibraryEvidence({ benchmark: repeatedBenchmark });

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

function buildLargeMediaLibraryEvidence({ benchmark }) {
  const fastPathLaneEvidence = collectFastPathLaneEvidence(benchmark);
  const generatedCoverage = generatedCoverageSummary(benchmark, fastPathLaneEvidence);

  return {
    schemaVersion: 1,
    rppId: 'RPP-0755',
    proofId,
    variant: 3,
    generatedCoverage,
    status: 'pending',
    builtOn: {
      rppId: 'RPP-0715',
      benchmark: benchmark.benchmark,
      evidenceHash: digest(publicBenchmarkProjection(benchmark)),
    },
    correctnessGates: [],
    fastPathLaneEvidence,
    runtime: {
      generatedAt: benchmark.runtime.generatedAt,
      durationMs: benchmark.runtime.durationMs,
      budgets: benchmark.runtime.budgets,
    },
    resources: {
      process: benchmark.resources.process,
    },
    benchmark: publicBenchmarkProjection(benchmark),
    release: supportOnlyReleasePosture(),
  };
}

function generatedCoverageSummary(benchmark, fastPathLaneEvidence) {
  return {
    source: 'local-support-generated-large-media-library-cases',
    variant: 'large-media-library-benchmark-v3',
    profile: benchmark.profile,
    deterministic: true,
    expectedCases: benchmark.resources.workload.attemptedMedia,
    fastPathLaneUpdates: benchmark.fastPathLane.updates,
    fastPathLaneBlocked: benchmark.fastPathLane.blocked,
    workloadHash: digest(fastPathLaneEvidence.workload),
    outcomeCountsHash: digest(fastPathLaneEvidence.storageOutcomeCounts),
    sampleOutcomeCountsHash: digest(fastPathLaneEvidence.sampleOutcomeCounts),
    benchmarkGateVectorHash: fastPathLaneEvidence.benchmarkGateVectorHash,
  };
}

function recordCorrectnessGates(evidence, repeatedEvidence) {
  const gates = recomputeLargeMediaLibraryGates(evidence, repeatedEvidence);
  evidence.correctnessGates = gates.map((gate) => ({
    id: gate.id,
    status: gate.status === 'pass' ? 'passed' : 'failed',
    evidenceHash: digest(gate.metrics),
  }));
  evidence.status = gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed';
  return evidence;
}

function collectFastPathLaneEvidence(benchmark) {
  const samples = benchmark.deterministicCoverage.evidenceSamples;
  const batchSummaries = benchmark.resources.database.batches.map(batchSummary);
  const core = {
    evidenceMode: 'support-only-hash-only-generated-storage-performance',
    benchmarkGateVectorHash: sha256(benchmark.gates.map((gate) => ({
      id: gate.id,
      status: gate.status,
    }))),
    laneId: LARGE_MEDIA_LIBRARY_FAST_PATH_LANE,
    lanePolicy: benchmark.fastPathLane.updatePolicy,
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
    fastPathLane: {
      id: benchmark.fastPathLane.id,
      updatePolicy: benchmark.fastPathLane.updatePolicy,
      evaluatedBeforeUpdate: benchmark.resources.fastPathLane.evaluatedBeforeUpdate,
      evaluatedAfterGates: benchmark.fastPathLane.evaluatedAfterGates,
      updatesOnlyAfterCorrectnessGates: benchmark.fastPathLane.updatesOnlyAfterCorrectnessGates,
      updates: benchmark.fastPathLane.updates,
      blocked: benchmark.fastPathLane.blocked,
      blockedBy: benchmark.fastPathLane.blockedBy,
      unsafeUpdatesBeforeGates: benchmark.resources.fastPathLane.unsafeUpdatesBeforeGates,
      updatesWithFailedGate: benchmark.resources.fastPathLane.updatesWithFailedGate,
      updatesMissingRowPreconditions: benchmark.resources.fastPathLane.updatesMissingRowPreconditions,
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

function resolveLargeMediaLibraryProof(evidence, { repeatedEvidence }) {
  const recomputedGates = recomputeLargeMediaLibraryGates(evidence, repeatedEvidence);
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
        generatedCoverageHash: digest(evidence.generatedCoverage),
        gateVectorHash: sha256(recomputedGates),
        laneEvidenceHash: evidence.fastPathLaneEvidence.laneEvidenceHash,
        laneId: evidence.fastPathLaneEvidence.laneId,
        fastPathLaneUpdates: evidence.fastPathLaneEvidence.fastPathLane.updates,
        fastPathLaneBlocked: evidence.fastPathLaneEvidence.fastPathLane.blocked,
        storageOutcomeHash: sha256(evidence.fastPathLaneEvidence.storageOutcomeCounts),
        rowPreconditionHash: sha256(evidence.fastPathLaneEvidence.rowPreconditions),
        dbBatchHash: sha256(evidence.fastPathLaneEvidence.dbBatching),
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
    hashOnlyLaneOutput: output ? largeMediaEvidenceHasNoRawValues(output) : false,
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

function recomputeLargeMediaLibraryGates(evidence, repeatedEvidence) {
  const lane = evidence.fastPathLaneEvidence || {};
  const mediaWorkload = lane.workload || {};
  const storage = lane.storageOutcomeCounts || {};
  const rowPreconditions = lane.rowPreconditions || {};
  const dbBatching = lane.dbBatching || {};
  const fastPathLane = lane.fastPathLane || {};
  const generatedCoverage = evidence.generatedCoverage || {};
  const runtime = evidence.runtime || {};
  const processResources = evidence.resources?.process || {};
  const release = evidence.release || {};
  const benchmarkGateStatuses = evidence.benchmark?.gates?.map((gate) => gate.status) || [];
  const expectedUpdates = mediaWorkload.updateMedia + mediaWorkload.createMedia;
  const expectedBlocked = mediaWorkload.attemptedMedia - expectedUpdates;
  const rowsPerMedia = 1 + mediaWorkload.metadataRowsPerMedia;
  const batchHashMismatches = (dbBatching.batches || [])
    .filter((batch) => batch.batchHash !== sha256(batchSummaryCore(batch)))
    .map((batch) => batch.batchIndex);
  const laneEvidenceHashMatches = lane.laneEvidenceHash === sha256(laneEvidenceCore(lane));
  const deterministicProjection = Boolean(repeatedEvidence)
    && digest(publicLargeMediaEvidenceProjection(evidence)) === digest(publicLargeMediaEvidenceProjection(repeatedEvidence));
  const hashOnlyEvidence = largeMediaEvidenceHasNoRawValues(lane);

  return [
    proofGate('benchmark-storage-performance-gates-pass', evidence.builtOn?.rppId === 'RPP-0715'
      && evidence.builtOn?.benchmark === LARGE_MEDIA_LIBRARY_BENCHMARK_ID
      && evidence.benchmark?.ok === true
      && benchmarkGateStatuses.length > 0
      && benchmarkGateStatuses.every((status) => status === 'pass')
      && lane.benchmarkGateVectorHash === sha256(evidence.benchmark.gates.map((gate) => ({
        id: gate.id,
        status: gate.status,
      }))), {
      benchmarkGateStatuses,
      benchmarkGateVectorHash: lane.benchmarkGateVectorHash,
    }),
    proofGate('generated-large-media-library-coverage-recorded',
      generatedCoverage.source === 'local-support-generated-large-media-library-cases'
        && generatedCoverage.variant === 'large-media-library-benchmark-v3'
        && generatedCoverage.deterministic === true
        && generatedCoverage.expectedCases === mediaWorkload.attemptedMedia
        && generatedCoverage.fastPathLaneUpdates === expectedUpdates
        && generatedCoverage.fastPathLaneBlocked === expectedBlocked
        && generatedCoverage.workloadHash === digest(mediaWorkload)
        && generatedCoverage.outcomeCountsHash === digest(storage)
        && generatedCoverage.sampleOutcomeCountsHash === digest(lane.sampleOutcomeCounts)
        && generatedCoverage.benchmarkGateVectorHash === lane.benchmarkGateVectorHash,
      {
        expectedCases: mediaWorkload.attemptedMedia,
        fastPathLaneUpdates: generatedCoverage.fastPathLaneUpdates,
        fastPathLaneBlocked: generatedCoverage.fastPathLaneBlocked,
        workloadHash: generatedCoverage.workloadHash,
      }),
    proofGate('media-counts-match', storage.mediaWritesAttempted === mediaWorkload.attemptedMedia
      && storage.appliedMediaWrites === expectedUpdates + mediaWorkload.directoryFsyncFailureMedia
      && storage.appliedFsyncCompleteMediaWrites === expectedUpdates
      && storage.appliedFsyncIncompleteMediaWrites === mediaWorkload.directoryFsyncFailureMedia
      && storage.staleAtWriteMediaWrites === mediaWorkload.staleMedia
      && storage.tempFsyncFailedBeforeRenameMediaWrites === mediaWorkload.tempFsyncFailureMedia
      && fastPathLane.updates + fastPathLane.blocked === mediaWorkload.attemptedMedia, {
      attemptedMedia: mediaWorkload.attemptedMedia,
      mediaWritesAttempted: storage.mediaWritesAttempted,
      appliedMediaWrites: storage.appliedMediaWrites,
      expectedAppliedMediaWrites: expectedUpdates + mediaWorkload.directoryFsyncFailureMedia,
      fastPathLaneObservedTotal: fastPathLane.updates + fastPathLane.blocked,
    }),
    proofGate('fast-path-lane-updates-only-after-correctness-gates',
      fastPathLane.id === LARGE_MEDIA_LIBRARY_FAST_PATH_LANE
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
        blocked: fastPathLane.blocked,
        unsafeUpdatesBeforeGates: fastPathLane.unsafeUpdatesBeforeGates,
        updatesWithFailedGate: fastPathLane.updatesWithFailedGate,
        updatesMissingRowPreconditions: fastPathLane.updatesMissingRowPreconditions,
      }),
    proofGate('row-preconditions-attached-to-lane-updates',
      rowPreconditions.attachmentRowsPreconditioned === mediaWorkload.attemptedMedia
        && rowPreconditions.metadataRowsPreconditioned === mediaWorkload.attemptedMedia
          * mediaWorkload.metadataRowsPerMedia
        && rowPreconditions.rowPreconditions === mediaWorkload.attemptedMedia * rowsPerMedia
        && rowPreconditions.rowPreconditionsAttachedToLaneUpdates === expectedUpdates * rowsPerMedia
        && rowPreconditions.missingExpectedRemoteHashes === 0,
      {
        attachmentRowsPreconditioned: rowPreconditions.attachmentRowsPreconditioned,
        metadataRowsPreconditioned: rowPreconditions.metadataRowsPreconditioned,
        rowPreconditions: rowPreconditions.rowPreconditions,
        rowPreconditionsAttachedToLaneUpdates: rowPreconditions.rowPreconditionsAttachedToLaneUpdates,
        expectedLaneRowPreconditions: expectedUpdates * rowsPerMedia,
        missingExpectedRemoteHashes: rowPreconditions.missingExpectedRemoteHashes,
      }),
    proofGate('media-db-batches-within-budget',
      dbBatching.batchCount > 0
        && dbBatching.batchCount === (dbBatching.batches || []).length
        && dbBatching.batchHashes?.length === dbBatching.batchCount
        && dbBatching.batchRowCounts?.length === dbBatching.batchCount
        && dbBatching.maxBatchRowsObserved <= dbBatching.maxDbBatchRows
        && dbBatching.batchesOverLimit === 0
        && batchHashMismatches.length === 0,
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
    proofGate('deterministic-hash-only-storage-evidence', laneEvidenceHashMatches
      && deterministicProjection
      && hashOnlyEvidence, {
      laneEvidenceHashMatches,
      firstEvidenceHash: digest(publicLargeMediaEvidenceProjection(evidence)),
      repeatedEvidenceHash: repeatedEvidence ? digest(publicLargeMediaEvidenceProjection(repeatedEvidence)) : '',
      rawValueEvidenceLeaks: hashOnlyEvidence ? 0 : 1,
    }),
    proofGate('runtime-resource-budget', runtime.durationMs <= runtime.budgets?.maxDurationMs
      && processResources.heapUsedBytes <= runtime.budgets?.maxHeapUsedBytes, {
      durationMs: runtime.durationMs,
      heapUsedBytes: processResources.heapUsedBytes,
      maxDurationMs: runtime.budgets?.maxDurationMs,
      maxHeapUsedBytes: runtime.budgets?.maxHeapUsedBytes,
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

function unsafeLargeMediaEvidenceDecisions(evidence, repeatedEvidence) {
  const unsafeLaneUpdate = withPassedStatus(clone(evidence));
  unsafeLaneUpdate.fastPathLaneEvidence.fastPathLane.updates += 1;
  unsafeLaneUpdate.fastPathLaneEvidence.fastPathLane.unsafeUpdatesBeforeGates = 1;
  unsafeLaneUpdate.fastPathLaneEvidence.fastPathLane.updatesWithFailedGate = 1;
  refreshLaneEvidenceHash(unsafeLaneUpdate);

  const missingLaneRowPreconditions = withPassedStatus(clone(evidence));
  missingLaneRowPreconditions.fastPathLaneEvidence.rowPreconditions.rowPreconditionsAttachedToLaneUpdates -= 1;
  refreshLaneEvidenceHash(missingLaneRowPreconditions);

  const mismatchedLaneEvidenceHash = withPassedStatus(clone(evidence));
  mismatchedLaneEvidenceHash.fastPathLaneEvidence.laneEvidenceHash = sha256(
    'rpp-0755-mismatched-lane-evidence-hash',
  );

  const prematurePassStatus = withPassedStatus(clone(evidence));
  prematurePassStatus.correctnessGates = [];

  return {
    unsafeLaneUpdate: resolveLargeMediaLibraryProof(unsafeLaneUpdate, { repeatedEvidence }),
    missingLaneRowPreconditions: resolveLargeMediaLibraryProof(missingLaneRowPreconditions, { repeatedEvidence }),
    mismatchedLaneEvidenceHash: resolveLargeMediaLibraryProof(mismatchedLaneEvidenceHash, { repeatedEvidence }),
    prematurePassStatus: resolveLargeMediaLibraryProof(prematurePassStatus, { repeatedEvidence }),
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

function publicLargeMediaEvidenceProjection(evidence) {
  return {
    rppId: evidence.rppId,
    proofId: evidence.proofId,
    variant: evidence.variant,
    generatedCoverage: evidence.generatedCoverage,
    builtOn: evidence.builtOn,
    fastPathLaneEvidence: evidence.fastPathLaneEvidence,
    release: evidence.release,
  };
}

function laneEvidenceCore(lane) {
  return {
    evidenceMode: lane.evidenceMode,
    benchmarkGateVectorHash: lane.benchmarkGateVectorHash,
    laneId: lane.laneId,
    lanePolicy: lane.lanePolicy,
    workload: lane.workload,
    storageBoundary: lane.storageBoundary,
    storageDriver: lane.storageDriver,
    storageOutcomeCounts: lane.storageOutcomeCounts,
    rowPreconditions: lane.rowPreconditions,
    dbBatching: lane.dbBatching,
    fastPathLane: lane.fastPathLane,
    bytes: lane.bytes,
    sampleOutcomeCounts: lane.sampleOutcomeCounts,
    sampleHashes: lane.sampleHashes,
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

function refreshLaneEvidenceHash(evidence) {
  evidence.fastPathLaneEvidence.laneEvidenceHash = sha256(laneEvidenceCore(evidence.fastPathLaneEvidence));
  return evidence;
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

function proofGate(id, passed, metrics = {}) {
  return {
    id,
    status: passed ? 'pass' : 'fail',
    metrics,
  };
}

function countBy(values, getKey) {
  const counts = {};
  for (const value of values) {
    const key = getKey(value);
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function assertHashOnlyLargeMediaEvidence(value) {
  assert.equal(largeMediaEvidenceHasNoRawValues(value), true);
}

function largeMediaEvidenceHasNoRawValues(value) {
  return !rawLargeMediaEvidencePattern().test(JSON.stringify(value));
}

function rawLargeMediaEvidencePattern() {
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

function withPassedStatus(evidence) {
  evidence.status = 'passed';
  return evidence;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
