import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  FILESYSTEM_FSYNC_BOUNDARY,
  FILESYSTEM_FSYNC_CORRECTNESS_GATE_IDS,
  FILESYSTEM_FSYNC_FAST_PATH_LANE,
  FILESYSTEM_FSYNC_TEMP_PREFIX,
  applyFilesystemFsyncEvidenceWrite,
  createFilesystemFsyncTempRoot,
} from '../src/filesystem-fsync-evidence.js';
import {
  ensureFilesystemDirectoryUsable,
  filesystemStorageHash,
  filesystemTempLeakPaths,
  readFilesystemStorageDescriptor,
} from '../src/filesystem-compare-rename-write.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { digest } from '../src/stable-json.js';
import {
  FILESYSTEM_FSYNC_EVIDENCE_BENCHMARK_ID,
  runFilesystemFsyncEvidenceBenchmark,
} from '../scripts/bench/filesystem-fsync-evidence.js';

const proofId = 'rpp-0785-filesystem-fsync-evidence-release-verifier-v5';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const sha256Pattern = /^[a-f0-9]{64}$/;
const requiredBenchmarkGateIds = Object.freeze([
  'deterministic-fsync-guard-behavior',
  'correctness-gates-before-fast-path-lane',
  'temp-and-directory-fsync-required-for-updates',
  'stale-storage-blocks-rename-and-lane-update',
  'temp-fsync-failure-blocks-rename-and-lane-update',
  'directory-fsync-failure-withholds-fast-path-lane-update',
  'temp-cleanup',
  'hash-only-evidence',
  'runtime-resource-budget',
]);
const releaseVerifierSupportGateIds = Object.freeze([
  'release-verifier-runtime-resources-gates-reported',
  'filesystem-fsync-correctness-evidence-carried-through',
  'fast-path-lane-withheld-until-correctness-gates-pass',
  'deterministic-hash-only-release-verifier-evidence',
  'release-verifier-carry-through-claimed-support-only',
  'support-only-release-no-go',
]);

test('RPP-0785 release verifier variant 5 carries filesystem fsync support evidence', () => {
  const focusedSummary = runReleaseVerifierFocusedMatrix();
  const repeatedFocusedSummary = runReleaseVerifierFocusedMatrix();
  const report = runFilesystemFsyncEvidenceBenchmark(releaseVerifierBenchmarkOptions({
    maxDurationMs: 100_000,
    maxHeapUsedBytes: 1024 * 1024 * 1024,
  }));
  const repeatedReport = runFilesystemFsyncEvidenceBenchmark(releaseVerifierBenchmarkOptions({
    maxDurationMs: 100_000,
    maxHeapUsedBytes: 1024 * 1024 * 1024,
  }));
  const proof = buildReleaseVerifierSupportProof({
    focusedSummary,
    repeatedFocusedSummary,
    report,
    repeatedReport,
  });

  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.rppId, 'RPP-0785');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 5);
  assert.equal(proof.evidenceSource, 'filesystem-fsync-evidence-release-verifier-v5');
  assert.equal(proof.status, 'passed');
  assert.equal(proof.supportOnly, true);
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.integrationRecommendation, 'NO-GO');
  assert.deepEqual(proof.gates.map((gate) => gate.id), releaseVerifierSupportGateIds);
  assert.deepEqual([...new Set(proof.gates.map((gate) => gate.status))], ['pass']);

  assert.equal(proof.releaseVerifier.benchmarkId, FILESYSTEM_FSYNC_EVIDENCE_BENCHMARK_ID);
  assert.equal(proof.releaseVerifier.runtimeReported, true);
  assert.equal(proof.releaseVerifier.resourcesReported, true);
  assert.equal(proof.releaseVerifier.passFailGatesReported, true);
  assert.equal(proof.releaseVerifier.carryThrough, 'support-only-claimed');
  assert.deepEqual(proof.releaseVerifier.passGateIds.sort(), [...requiredBenchmarkGateIds].sort());
  assert.deepEqual(proof.releaseVerifier.failGateIds, []);
  assert.deepEqual(proof.releaseVerifier.correctnessGateIds, FILESYSTEM_FSYNC_CORRECTNESS_GATE_IDS);

  assert.equal(proof.focusedRegression.storage.guardedWritesAttempted, 6);
  assert.equal(proof.focusedRegression.storage.appliedFsyncCompleteWrites, 2);
  assert.equal(proof.focusedRegression.storage.appliedFsyncIncompleteWrites, 2);
  assert.equal(proof.focusedRegression.storage.staleAtWriteWrites, 1);
  assert.equal(proof.focusedRegression.storage.tempFsyncFailedBeforeRenameWrites, 1);
  assert.deepEqual(proof.focusedRegression.fastPathLane.blockedBy, {
    'live-storage-mismatch': 1,
    'post-rename-storage-mismatch': 1,
    'target-directory-fsync-missing': 1,
    'temp-file-fsync-missing': 1,
  });
  assert.equal(proof.focusedRegression.correctness.postRenameMismatchBlocksLane, true);
  assert.match(proof.focusedRegression.projectionHash, sha256Pattern);

  assert.equal(proof.storagePerformance.boundary, FILESYSTEM_FSYNC_BOUNDARY);
  assert.equal(proof.storagePerformance.adapter, 'filesystem-compare-rename-fsync');
  assert.equal(proof.storagePerformance.engine, 'filesystem');
  assert.equal(proof.storagePerformance.guardedWritesAttempted, 10);
  assert.equal(proof.storagePerformance.appliedFsyncCompleteWrites, 6);
  assert.equal(proof.storagePerformance.appliedFsyncIncompleteWrites, 1);
  assert.equal(proof.storagePerformance.staleAtWriteWrites, 2);
  assert.equal(proof.storagePerformance.tempFsyncFailedBeforeRenameWrites, 1);
  assert.equal(proof.storagePerformance.productionStorageDurability, 'not-claimed');

  assert.equal(proof.generatedCoverage.sourceRppId, 'RPP-0705');
  assert.equal(proof.generatedCoverage.evidenceSamples, 10);
  assert.equal(proof.generatedCoverage.rawValueEvidenceLeaks, 0);
  assert.match(proof.generatedCoverage.projectionHash, sha256Pattern);
  assert.deepEqual(proof.generatedCoverage.fastPathLane.blockedBy, {
    'live-storage-mismatch': 2,
    'target-directory-fsync-missing': 1,
    'temp-file-fsync-missing': 1,
  });

  assert.equal(proof.fastPathLane.id, FILESYSTEM_FSYNC_FAST_PATH_LANE);
  assert.equal(proof.fastPathLane.focusedUpdates, 2);
  assert.equal(proof.fastPathLane.focusedBlocked, 4);
  assert.equal(proof.fastPathLane.generatedUpdates, 6);
  assert.equal(proof.fastPathLane.generatedBlocked, 4);
  assert.equal(proof.fastPathLane.updatesOnlyAfterCorrectnessGates, true);
  assert.equal(proof.fastPathLane.updatesOnlyWhenCorrectnessGatesHold, true);
  assert.equal(proof.fastPathLane.unsafeUpdatesBeforeGates, 0);
  assert.equal(proof.fastPathLane.updatesWithFailedGate, 0);

  assert.equal(proof.correctness.updatedSamplesAllGatesPassed, true);
  assert.equal(proof.correctness.blockedSamplesHoldNoLaneUpdate, true);
  assert.equal(proof.correctness.benchmarkCorrectnessGatesRetained, true);
  assert.equal(proof.correctness.deterministicHashOnlyProjection, true);
  assert.equal(proof.release.releaseVerifierCarryThrough, 'support-only-claimed');
  assert.equal(proof.release.productionBacked, false);
  assert.equal(proof.release.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.release.integrationRecommendation, 'NO-GO');
  assert.match(proof.evidenceHash, sha256Pattern);

  assertNoRawFilesystemValues(proof, 'RPP-0785 release verifier proof');
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0785 filesystem fsync release verifier proof' }));
});

test('RPP-0785 release verifier variant 5 preserves fail-gate fsync evidence for NO-GO diagnosis', () => {
  const report = runFilesystemFsyncEvidenceBenchmark(releaseVerifierBenchmarkOptions({
    updateFiles: 1,
    createFiles: 1,
    staleFiles: 1,
    tempFsyncFailureFiles: 1,
    directoryFsyncFailureFiles: 1,
    fileBytes: 512,
    maxDurationMs: 100_000,
    maxHeapUsedBytes: 1,
  }));
  const proof = buildFailGateReleaseVerifierProof(report);

  assert.equal(report.ok, false);
  assert.equal(gateById(report, 'runtime-resource-budget').status, 'fail');
  for (const gateId of requiredBenchmarkGateIds.filter((id) => id !== 'runtime-resource-budget')) {
    assert.equal(gateById(report, gateId).status, 'pass', `${gateId} should remain pass`);
  }

  assert.equal(proof.rppId, 'RPP-0785');
  assert.equal(proof.variant, 5);
  assert.equal(proof.evidenceSource, 'filesystem-fsync-evidence-release-verifier-fail-gate-v5');
  assert.equal(proof.status, 'failed_support_gate');
  assert.equal(proof.supportOnly, true);
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.integrationRecommendation, 'NO-GO');
  assert.equal(proof.releaseVerifierCarryThrough, 'support-only-claimed');
  assert.equal(proof.runtimeReported, true);
  assert.equal(proof.resourcesReported, true);
  assert.equal(proof.passFailGatesReported, true);
  assert.deepEqual(proof.failGateIds, ['runtime-resource-budget']);
  assert.equal(proof.failedBudgetGate.id, 'runtime-resource-budget');
  assert.equal(proof.failedBudgetGate.maxHeapUsedBytes, 1);
  assert.ok(proof.failedBudgetGate.heapUsedBytes > 1);
  assert.equal(proof.storage.guardedWritesAttempted, 5);
  assert.equal(proof.storage.appliedFsyncCompleteWrites, 2);
  assert.equal(proof.storage.appliedFsyncIncompleteWrites, 1);
  assert.equal(proof.storage.staleAtWriteWrites, 1);
  assert.equal(proof.storage.tempFsyncFailedBeforeRenameWrites, 1);
  assert.equal(proof.fastPathLane.updates, 2);
  assert.equal(proof.fastPathLane.blocked, 3);
  assert.match(proof.evidenceHash, sha256Pattern);

  assertNoRawFilesystemValues(proof, 'RPP-0785 fail-gate release verifier proof');
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0785 filesystem fsync fail-gate proof' }));
});

function runReleaseVerifierFocusedMatrix() {
  const rootDir = createFilesystemFsyncTempRoot('reprint-rpp-0785-focused-');
  const results = [];

  for (const scenario of focusedStorageScenarios()) {
    const logicalPath = `wp-content/uploads/rpp-0785/release-verifier/${scenario.id}.txt`;
    if (scenario.initialContents !== null) {
      writeFixture(rootDir, logicalPath, scenario.initialContents);
    }

    const expectedStorage = readFilesystemStorageDescriptor({ rootDir, logicalPath });
    const result = applyFilesystemFsyncEvidenceWrite({
      rootDir,
      logicalPath,
      expectedResource: resourceEvidence(scenario.id, logicalPath, expectedStorage),
      expectedStorage,
      plannedContents: scenario.plannedContents,
      operation: scenario.operation,
      driver: 'rpp-0785-release-verifier-focused',
      afterTempFsync: scenario.afterTempFsync
        ? (context) => scenario.afterTempFsync(context)
        : undefined,
      fsyncFileSync: scenario.fsyncFileSync
        ? (fd, fsyncContext) => scenario.fsyncFileSync({ fd, fsyncContext, rootDir, logicalPath })
        : undefined,
      fsyncDirectorySync: scenario.fsyncDirectorySync
        ? (fd, fsyncContext) => scenario.fsyncDirectorySync({ fd, fsyncContext, rootDir, logicalPath })
        : undefined,
    });

    results.push({ scenario, logicalPath, result });
    assert.equal(result.applied, scenario.expected.applied, scenario.id);
    assert.equal(result.fastPathLaneUpdated, scenario.expected.fastPathLaneUpdated, scenario.id);
    assert.equal(result.storageGuard.outcome, scenario.expected.outcome, scenario.id);
    assert.equal(result.storageGuard.fastPathLane.updated, result.fastPathLaneUpdated, scenario.id);
    assert.equal(result.storageGuard.boundary, FILESYSTEM_FSYNC_BOUNDARY, scenario.id);
    assert.equal(result.storageGuard.fastPathLane.id, FILESYSTEM_FSYNC_FAST_PATH_LANE, scenario.id);
    assert.equal(result.storageGuard.fastPathLane.correctnessGatesEvaluatedBeforeUpdate, true, scenario.id);
    assert.deepEqual(result.storageGuard.correctnessGates.map((gate) => gate.id), FILESYSTEM_FSYNC_CORRECTNESS_GATE_IDS);

    const correctnessGatesHold = allCorrectnessGatesPass(result.storageGuard);
    assert.equal(result.storageGuard.fastPathLane.correctnessGatesHold, correctnessGatesHold, scenario.id);
    assert.equal(
      result.storageGuard.fastPathLane.updated,
      result.storageGuard.outcome === 'applied' && correctnessGatesHold,
      scenario.id,
    );
    if (scenario.expected.fastPathLaneUpdated) {
      assert.equal(correctnessGatesHold, true, scenario.id);
      assert.deepEqual(result.storageGuard.fastPathLane.blockedBy, [], scenario.id);
    } else {
      assert.equal(correctnessGatesHold, false, scenario.id);
      assert.ok(result.storageGuard.fastPathLane.blockedBy.includes(scenario.expected.blocker), scenario.id);
    }
    assert.equal(readFixture(rootDir, logicalPath), scenario.expected.finalContents, scenario.id);
    assertStorageGuardHasOnlySafeValues(result.storageGuard, rootDir);
  }

  const byId = Object.fromEntries(results.map(({ scenario, result }) => [scenario.id, result]));
  assert.equal(byId['stale-update'].storageGuard.renameAttempted, false);
  assert.equal(byId['stale-update'].storageGuard.tempRemovedOnBlockedWrite, true);
  assert.equal(gateById(byId['stale-update'].storageGuard, 'live-storage-precondition-match').status, 'fail');
  assert.equal(byId['temp-fsync-failure'].storageGuard.renameAttempted, false);
  assert.equal(byId['temp-fsync-failure'].storageGuard.fsyncEvidence.tempFile.status, 'failed');
  assert.equal(byId['temp-fsync-failure'].storageGuard.fsyncEvidence.targetDirectory.status, 'not-attempted');
  assert.equal(gateById(byId['temp-fsync-failure'].storageGuard, 'temp-file-fsync-before-live-compare').status, 'fail');
  assert.equal(byId['directory-fsync-failure'].storageGuard.fsyncEvidence.targetDirectory.status, 'failed');
  assert.equal(gateById(byId['directory-fsync-failure'].storageGuard, 'target-directory-fsync-after-rename').status, 'fail');
  assert.equal(byId['post-rename-mismatch'].storageGuard.fsyncEvidence.targetDirectory.status, 'passed');
  assert.equal(gateById(byId['post-rename-mismatch'].storageGuard, 'post-rename-storage-matches-planned').status, 'fail');
  assert.ok(
    byId['post-rename-mismatch'].storageGuard.fastPathLane.blockedBy.includes('post-rename-storage-mismatch'),
  );
  assert.equal(filesystemTempLeakPaths(rootDir).length, 0);

  return summarizeFocusedMatrix(results);
}

function focusedStorageScenarios() {
  return [
    {
      id: 'matching-update',
      operation: 'update',
      initialContents: 'rpp0785-base-update-payload',
      plannedContents: 'rpp0785-planned-update-payload',
      expected: {
        applied: true,
        fastPathLaneUpdated: true,
        outcome: 'applied',
        blocker: null,
        finalContents: 'rpp0785-planned-update-payload',
      },
    },
    {
      id: 'matching-create',
      operation: 'create',
      initialContents: null,
      plannedContents: 'rpp0785-planned-create-payload',
      expected: {
        applied: true,
        fastPathLaneUpdated: true,
        outcome: 'applied',
        blocker: null,
        finalContents: 'rpp0785-planned-create-payload',
      },
    },
    {
      id: 'stale-update',
      operation: 'update',
      initialContents: 'rpp0785-base-stale-payload',
      plannedContents: 'rpp0785-planned-stale-payload',
      afterTempFsync: ({ absolutePath }) => {
        fs.writeFileSync(absolutePath, 'rpp0785-drift-stale-payload');
      },
      expected: {
        applied: false,
        fastPathLaneUpdated: false,
        outcome: 'stale-at-write',
        blocker: 'live-storage-mismatch',
        finalContents: 'rpp0785-drift-stale-payload',
      },
    },
    {
      id: 'temp-fsync-failure',
      operation: 'update',
      initialContents: 'rpp0785-base-temp-fsync-payload',
      plannedContents: 'rpp0785-planned-temp-fsync-payload',
      fsyncFileSync: () => {
        throw codedError('EIO');
      },
      expected: {
        applied: false,
        fastPathLaneUpdated: false,
        outcome: 'fsync-failed-before-rename',
        blocker: 'temp-file-fsync-missing',
        finalContents: 'rpp0785-base-temp-fsync-payload',
      },
    },
    {
      id: 'directory-fsync-failure',
      operation: 'update',
      initialContents: 'rpp0785-base-directory-fsync-payload',
      plannedContents: 'rpp0785-planned-directory-fsync-payload',
      fsyncDirectorySync: () => {
        throw codedError('EINVAL');
      },
      expected: {
        applied: true,
        fastPathLaneUpdated: false,
        outcome: 'applied-fsync-incomplete',
        blocker: 'target-directory-fsync-missing',
        finalContents: 'rpp0785-planned-directory-fsync-payload',
      },
    },
    {
      id: 'post-rename-mismatch',
      operation: 'update',
      initialContents: 'rpp0785-base-post-rename-payload',
      plannedContents: 'rpp0785-planned-post-rename-payload',
      fsyncDirectorySync: ({ rootDir, logicalPath }) => {
        fs.writeFileSync(path.join(rootDir, logicalPath), 'rpp0785-drift-post-rename-payload');
      },
      expected: {
        applied: true,
        fastPathLaneUpdated: false,
        outcome: 'applied-fsync-incomplete',
        blocker: 'post-rename-storage-mismatch',
        finalContents: 'rpp0785-drift-post-rename-payload',
      },
    },
  ];
}

function buildReleaseVerifierSupportProof({
  focusedSummary,
  repeatedFocusedSummary,
  report,
  repeatedReport,
}) {
  const benchmarkSampleHashes = report.deterministicCoverage.evidenceSamples.map(safeStorageGuardHash);
  const repeatedBenchmarkSampleHashes = repeatedReport.deterministicCoverage.evidenceSamples.map(safeStorageGuardHash);
  const benchmarkProjectionHash = digest(publicBenchmarkProjection(report));
  const repeatedBenchmarkProjectionHash = digest(publicBenchmarkProjection(repeatedReport));
  const gateVector = gateStatuses(report);
  const repeatedGateVector = gateStatuses(repeatedReport);
  const sameGateVector = JSON.stringify(gateVector) === JSON.stringify(repeatedGateVector);
  const sameBenchmarkProjectionHash = benchmarkProjectionHash === repeatedBenchmarkProjectionHash;
  const sameBenchmarkSampleHashes = JSON.stringify(benchmarkSampleHashes) === JSON.stringify(repeatedBenchmarkSampleHashes);
  const sameFocusedProjectionHash = focusedSummary.projectionHash === repeatedFocusedSummary.projectionHash;
  const benchmarkCorrectnessGatesRetained = requiredBenchmarkGateIds
    .filter((gateId) => gateId !== 'runtime-resource-budget')
    .every((gateId) => gateById(report, gateId).status === 'pass');
  const generatedOutcomes = sortedObject(countBy(
    report.deterministicCoverage.evidenceSamples,
    (evidence) => evidence.outcome,
  ));
  const generatedUpdatedSamples = report.deterministicCoverage.evidenceSamples
    .filter((evidence) => evidence.fastPathLane.updated === true);
  const generatedBlockedSamples = report.deterministicCoverage.evidenceSamples
    .filter((evidence) => evidence.fastPathLane.updated === false);
  const generatedUpdatedSamplesAllGatesPassed = generatedUpdatedSamples.length === report.fastPathLane.updates
    && generatedUpdatedSamples.every((evidence) => (
      evidence.outcome === 'applied'
      && evidence.fsyncEvidence.tempFile.status === 'passed'
      && evidence.fsyncEvidence.targetDirectory.status === 'passed'
      && allCorrectnessGatesPass(evidence)
      && evidence.fastPathLane.correctnessGatesHold === true
    ));
  const generatedBlockedSamplesHoldNoLaneUpdate = generatedBlockedSamples.length === report.fastPathLane.blocked
    && generatedBlockedSamples.every((evidence) => (
      evidence.fastPathLane.updated === false
      && evidence.fastPathLane.correctnessGatesHold === false
      && evidence.fastPathLane.blockedBy.length > 0
    ));
  const generatedUpdatesOnlyWhenCorrectnessGatesHold = report.deterministicCoverage.evidenceSamples
    .every((evidence) => (
      evidence.fastPathLane.updated === (evidence.outcome === 'applied' && allCorrectnessGatesPass(evidence))
    ));
  const generatedStorageOutcomesCovered = report.resources.storage.guardedWritesAttempted
      === report.resources.workload.expectedWrites
    && report.resources.storage.appliedFsyncCompleteWrites
      === report.resources.workload.expectedFastPathLaneUpdates
    && report.resources.storage.appliedFsyncIncompleteWrites
      === report.resources.workload.directoryFsyncFailureFiles
    && report.resources.storage.staleAtWriteWrites === report.resources.workload.staleFiles
    && report.resources.storage.tempFsyncFailedBeforeRenameWrites
      === report.resources.workload.tempFsyncFailureFiles
    && report.resources.storage.unsafeRenameOnStaleWrites === 0
    && report.resources.storage.unsafeRenameAfterTempFsyncFailureWrites === 0;
  const deterministicHashOnlyProjection = sameFocusedProjectionHash
    && sameGateVector
    && sameBenchmarkProjectionHash
    && sameBenchmarkSampleHashes;
  const release = supportOnlyReleaseProjection();

  const gates = [
    proofGate('release-verifier-runtime-resources-gates-reported',
      hasRuntimeReport(report) && hasResourceReport(report) && hasPassFailGateReport(report), {
      runtimeReported: hasRuntimeReport(report),
      resourcesReported: hasResourceReport(report),
      gateCount: report.gates.length,
    }),
    proofGate('filesystem-fsync-correctness-evidence-carried-through',
      focusedSummary.correctness.updatedSamplesAllGatesPassed
        && focusedSummary.correctness.blockedSamplesHoldNoLaneUpdate
        && focusedSummary.correctness.postRenameMismatchBlocksLane
        && generatedUpdatedSamplesAllGatesPassed
        && generatedBlockedSamplesHoldNoLaneUpdate
        && benchmarkCorrectnessGatesRetained
        && generatedStorageOutcomesCovered, {
      focusedGuardedWrites: focusedSummary.storage.guardedWritesAttempted,
      generatedGuardedWrites: report.resources.storage.guardedWritesAttempted,
      generatedOutcomes,
    }),
    proofGate('fast-path-lane-withheld-until-correctness-gates-pass',
      focusedSummary.fastPathLane.updatesOnlyAfterCorrectnessGates
        && focusedSummary.fastPathLane.updatesOnlyWhenCorrectnessGatesHold
        && report.fastPathLane.updatesOnlyAfterCorrectnessGates
        && generatedUpdatesOnlyWhenCorrectnessGatesHold
        && focusedSummary.fastPathLane.unsafeUpdatesBeforeGates === 0
        && focusedSummary.fastPathLane.updatesWithFailedGate === 0
        && report.resources.fastPathLane.unsafeUpdatesBeforeGates === 0
        && report.resources.fastPathLane.updatesWithFailedGate === 0, {
      focusedUpdates: focusedSummary.fastPathLane.updates,
      focusedBlocked: focusedSummary.fastPathLane.blocked,
      generatedUpdates: report.fastPathLane.updates,
      generatedBlocked: report.fastPathLane.blocked,
    }),
    proofGate('deterministic-hash-only-release-verifier-evidence',
      deterministicHashOnlyProjection
        && focusedSummary.redaction.rawValueEvidenceLeaks === 0
        && report.deterministicCoverage.rawValueEvidenceLeaks === 0, {
      sameFocusedProjectionHash,
      sameBenchmarkGateVector: sameGateVector,
      sameBenchmarkProjectionHash,
      sameBenchmarkSampleHashes,
      focusedRawValueEvidenceLeaks: focusedSummary.redaction.rawValueEvidenceLeaks,
      benchmarkRawValueEvidenceLeaks: report.deterministicCoverage.rawValueEvidenceLeaks,
    }),
    proofGate('release-verifier-carry-through-claimed-support-only',
      release.releaseVerifierCarryThrough === 'support-only-claimed'
        && release.productionBacked === false
        && release.releaseEligible === false, {
      releaseVerifierCarryThrough: release.releaseVerifierCarryThrough,
      productionBacked: release.productionBacked,
      releaseEligible: release.releaseEligible,
    }),
    proofGate('support-only-release-no-go',
      release.supportOnly === true
        && release.productionBacked === false
        && release.finalReleaseStatus === 'NO-GO'
        && release.integrationRecommendation === 'NO-GO', {
      finalReleaseStatus: release.finalReleaseStatus,
      integrationRecommendation: release.integrationRecommendation,
    }),
  ];
  const publicEvidence = {
    schemaVersion: 1,
    rppId: 'RPP-0785',
    proofId,
    variant: 5,
    evidenceSource: 'filesystem-fsync-evidence-release-verifier-v5',
    status: gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed',
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    finalReleaseStatus: release.finalReleaseStatus,
    integrationRecommendation: release.integrationRecommendation,
    releaseVerifier: {
      benchmarkId: report.benchmark,
      command: 'node --test --test-name-pattern RPP-0785 test/rpp-0785-filesystem-fsync-evidence-release-verifier-v5.test.js',
      runtimeReported: hasRuntimeReport(report),
      resourcesReported: hasResourceReport(report),
      passFailGatesReported: hasPassFailGateReport(report),
      carryThrough: release.releaseVerifierCarryThrough,
      passGateIds: report.gates.filter((gate) => gate.status === 'pass').map((gate) => gate.id),
      failGateIds: report.gates.filter((gate) => gate.status === 'fail').map((gate) => gate.id),
      requiredBenchmarkGateIds: [...requiredBenchmarkGateIds],
      correctnessGateIds: [...FILESYSTEM_FSYNC_CORRECTNESS_GATE_IDS],
      productionGateEvidence: 'not-present',
    },
    focusedRegression: {
      source: 'RPP-0785 local release-verifier focused matrix',
      storage: focusedSummary.storage,
      outcomes: focusedSummary.outcomes,
      fastPathLane: focusedSummary.fastPathLane,
      correctness: focusedSummary.correctness,
      evidenceSamples: focusedSummary.evidenceSamples,
      evidenceSampleHashes: focusedSummary.redaction.evidenceSampleHashes,
      projectionHash: focusedSummary.projectionHash,
    },
    generatedCoverage: {
      sourceRppId: report.rppId,
      benchmarkId: report.benchmark,
      workload: report.resources.workload,
      storage: report.resources.storage,
      outcomes: generatedOutcomes,
      fastPathLane: report.fastPathLane,
      evidenceSamples: report.deterministicCoverage.evidenceSamples.length,
      evidenceSampleHashes: benchmarkSampleHashes,
      rawValueEvidenceLeaks: report.deterministicCoverage.rawValueEvidenceLeaks,
      projectionHash: benchmarkProjectionHash,
    },
    storagePerformance: {
      boundary: report.resources.storage.boundary,
      adapter: report.resources.storage.adapter,
      engine: report.resources.storage.engine,
      fsyncStrategy: report.resources.storage.fsyncStrategy,
      visibilityBoundary: report.resources.storage.visibilityBoundary,
      guardedWritesAttempted: report.resources.storage.guardedWritesAttempted,
      appliedWrites: report.resources.storage.appliedWrites,
      appliedFsyncCompleteWrites: report.resources.storage.appliedFsyncCompleteWrites,
      appliedFsyncIncompleteWrites: report.resources.storage.appliedFsyncIncompleteWrites,
      staleAtWriteWrites: report.resources.storage.staleAtWriteWrites,
      tempFsyncFailedBeforeRenameWrites: report.resources.storage.tempFsyncFailedBeforeRenameWrites,
      unsafeRenameOnStaleWrites: report.resources.storage.unsafeRenameOnStaleWrites,
      unsafeRenameAfterTempFsyncFailureWrites: report.resources.storage.unsafeRenameAfterTempFsyncFailureWrites,
      productionStorageDurability: release.productionStorageReceipts,
    },
    fastPathLane: {
      id: FILESYSTEM_FSYNC_FAST_PATH_LANE,
      updatePolicy: report.resources.fastPathLane.updatePolicy,
      focusedUpdates: focusedSummary.fastPathLane.updates,
      focusedBlocked: focusedSummary.fastPathLane.blocked,
      focusedBlockedBy: focusedSummary.fastPathLane.blockedBy,
      generatedUpdates: report.fastPathLane.updates,
      generatedBlocked: report.fastPathLane.blocked,
      generatedBlockedBy: report.fastPathLane.blockedBy,
      updatesOnlyAfterCorrectnessGates: focusedSummary.fastPathLane.updatesOnlyAfterCorrectnessGates
        && report.fastPathLane.updatesOnlyAfterCorrectnessGates,
      updatesOnlyWhenCorrectnessGatesHold: focusedSummary.fastPathLane.updatesOnlyWhenCorrectnessGatesHold
        && generatedUpdatesOnlyWhenCorrectnessGatesHold,
      unsafeUpdatesBeforeGates: focusedSummary.fastPathLane.unsafeUpdatesBeforeGates
        + report.resources.fastPathLane.unsafeUpdatesBeforeGates,
      updatesWithFailedGate: focusedSummary.fastPathLane.updatesWithFailedGate
        + report.resources.fastPathLane.updatesWithFailedGate,
    },
    correctness: {
      gateIds: [...FILESYSTEM_FSYNC_CORRECTNESS_GATE_IDS],
      updatedSamplesAllGatesPassed: focusedSummary.correctness.updatedSamplesAllGatesPassed
        && generatedUpdatedSamplesAllGatesPassed,
      blockedSamplesHoldNoLaneUpdate: focusedSummary.correctness.blockedSamplesHoldNoLaneUpdate
        && generatedBlockedSamplesHoldNoLaneUpdate,
      postRenameMismatchBlocksLane: focusedSummary.correctness.postRenameMismatchBlocksLane,
      benchmarkCorrectnessGatesRetained,
      deterministicHashOnlyProjection,
      benchmarkGateVector: gateVector,
    },
    gates,
    release,
    redaction: {
      mode: 'hash-count-only-release-verifier-proof',
      rawValuesIncluded: false,
      focusedRawValueEvidenceLeaks: focusedSummary.redaction.rawValueEvidenceLeaks,
      benchmarkRawValueEvidenceLeaks: report.deterministicCoverage.rawValueEvidenceLeaks,
      focusedEvidenceSampleHashes: focusedSummary.redaction.evidenceSampleHashes,
      benchmarkEvidenceSampleHashes: benchmarkSampleHashes,
    },
  };

  return {
    ...publicEvidence,
    evidenceHash: digest(publicEvidence),
  };
}

function buildFailGateReleaseVerifierProof(report) {
  const runtimeGate = gateById(report, 'runtime-resource-budget');
  const proof = {
    schemaVersion: 1,
    rppId: 'RPP-0785',
    variant: 5,
    evidenceSource: 'filesystem-fsync-evidence-release-verifier-fail-gate-v5',
    status: 'failed_support_gate',
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    releaseVerifierCarryThrough: 'support-only-claimed',
    runtimeReported: hasRuntimeReport(report),
    resourcesReported: hasResourceReport(report),
    passFailGatesReported: hasPassFailGateReport(report),
    passGateIds: report.gates.filter((gate) => gate.status === 'pass').map((gate) => gate.id),
    failGateIds: report.gates.filter((gate) => gate.status === 'fail').map((gate) => gate.id),
    failedBudgetGate: {
      id: runtimeGate.id,
      durationMs: runtimeGate.evidence.durationMs,
      maxDurationMs: runtimeGate.evidence.maxDurationMs,
      heapUsedBytes: runtimeGate.evidence.heapUsedBytes,
      maxHeapUsedBytes: runtimeGate.evidence.maxHeapUsedBytes,
    },
    storage: {
      boundary: report.resources.storage.boundary,
      guardedWritesAttempted: report.resources.storage.guardedWritesAttempted,
      appliedFsyncCompleteWrites: report.resources.storage.appliedFsyncCompleteWrites,
      appliedFsyncIncompleteWrites: report.resources.storage.appliedFsyncIncompleteWrites,
      staleAtWriteWrites: report.resources.storage.staleAtWriteWrites,
      tempFsyncFailedBeforeRenameWrites: report.resources.storage.tempFsyncFailedBeforeRenameWrites,
      unsafeRenameOnStaleWrites: report.resources.storage.unsafeRenameOnStaleWrites,
      unsafeRenameAfterTempFsyncFailureWrites: report.resources.storage.unsafeRenameAfterTempFsyncFailureWrites,
    },
    fastPathLane: {
      id: report.fastPathLane.id,
      updates: report.fastPathLane.updates,
      blocked: report.fastPathLane.blocked,
      blockedBy: report.fastPathLane.blockedBy,
      updatesOnlyAfterCorrectnessGates: report.fastPathLane.updatesOnlyAfterCorrectnessGates,
    },
  };

  return {
    ...proof,
    evidenceHash: digest(proof),
  };
}

function summarizeFocusedMatrix(results) {
  const evidenceSamples = results.map(({ result }) => result.storageGuard);
  const safeEvidenceSamples = evidenceSamples.map(safeStorageGuardProjection);
  const outcomes = sortedObject(countBy(evidenceSamples, (evidence) => evidence.outcome));
  const updatedSamples = evidenceSamples.filter((evidence) => evidence.fastPathLane.updated === true);
  const blockedSamples = evidenceSamples.filter((evidence) => evidence.fastPathLane.updated === false);
  const evidenceSampleHashes = safeEvidenceSamples.map((evidence) => digest(evidence));
  const updatedSamplesAllGatesPassed = updatedSamples.length > 0
    && updatedSamples.every((evidence) => (
      evidence.outcome === 'applied'
      && evidence.fsyncEvidence.tempFile.status === 'passed'
      && evidence.fsyncEvidence.targetDirectory.status === 'passed'
      && allCorrectnessGatesPass(evidence)
      && evidence.fastPathLane.correctnessGatesHold === true
    ));
  const blockedSamplesHoldNoLaneUpdate = blockedSamples.length > 0
    && blockedSamples.every((evidence) => (
      evidence.fastPathLane.updated === false
      && evidence.fastPathLane.correctnessGatesHold === false
      && evidence.fastPathLane.blockedBy.length > 0
    ));
  const updatesOnlyAfterCorrectnessGates = updatedSamples.every((evidence) => (
    evidence.fastPathLane.correctnessGatesEvaluatedBeforeUpdate === true
    && objectKeyBefore(evidence, 'fsyncEvidence', 'correctnessGates')
    && objectKeyBefore(evidence, 'correctnessGates', 'fastPathLane')
  ));
  const updatesOnlyWhenCorrectnessGatesHold = evidenceSamples.every((evidence) => (
    evidence.fastPathLane.updated === (evidence.outcome === 'applied' && allCorrectnessGatesPass(evidence))
  ));
  const unsafeUpdatesBeforeGates = evidenceSamples.filter((evidence) => (
    evidence.fastPathLane.updated === true
    && (
      evidence.fastPathLane.correctnessGatesEvaluatedBeforeUpdate !== true
      || !objectKeyBefore(evidence, 'fsyncEvidence', 'correctnessGates')
      || !objectKeyBefore(evidence, 'correctnessGates', 'fastPathLane')
    )
  )).length;
  const updatesWithFailedGate = evidenceSamples.filter((evidence) => (
    evidence.fastPathLane.updated === true && !allCorrectnessGatesPass(evidence)
  )).length;
  const rawValueEvidenceLeaks = safeEvidenceSamples.filter((evidence) => hasRawFilesystemToken(evidence)).length;
  const storage = {
    boundary: FILESYSTEM_FSYNC_BOUNDARY,
    guardedWritesAttempted: evidenceSamples.length,
    appliedWrites: evidenceSamples.filter((evidence) => ['applied', 'applied-fsync-incomplete'].includes(evidence.outcome)).length,
    appliedFsyncCompleteWrites: outcomes.applied || 0,
    appliedFsyncIncompleteWrites: outcomes['applied-fsync-incomplete'] || 0,
    staleAtWriteWrites: outcomes['stale-at-write'] || 0,
    tempFsyncFailedBeforeRenameWrites: outcomes['fsync-failed-before-rename'] || 0,
  };
  const fastPathLane = {
    id: FILESYSTEM_FSYNC_FAST_PATH_LANE,
    updatePolicy: 'update-only-after-correctness-gates-pass',
    updates: updatedSamples.length,
    blocked: blockedSamples.length,
    blockedBy: countBlockers(evidenceSamples),
    updatesOnlyAfterCorrectnessGates,
    updatesOnlyWhenCorrectnessGatesHold,
    unsafeUpdatesBeforeGates,
    updatesWithFailedGate,
  };
  const correctness = {
    gateIds: [...FILESYSTEM_FSYNC_CORRECTNESS_GATE_IDS],
    updatedSamplesAllGatesPassed,
    blockedSamplesHoldNoLaneUpdate,
    postRenameMismatchBlocksLane: evidenceSamples.some((evidence) => (
      evidence.outcome === 'applied-fsync-incomplete'
      && gateById(evidence, 'target-directory-fsync-after-rename').status === 'pass'
      && gateById(evidence, 'post-rename-storage-matches-planned').status === 'fail'
      && evidence.fastPathLane.updated === false
      && evidence.fastPathLane.blockedBy.includes('post-rename-storage-mismatch')
    )),
  };
  const redaction = {
    mode: 'hash-count-only-release-verifier-proof',
    rawValueEvidenceLeaks,
    evidenceSampleHashes,
  };
  const projection = {
    storage,
    outcomes,
    fastPathLane,
    correctness,
    evidenceSamples: evidenceSamples.length,
    redaction,
  };

  return {
    ...projection,
    projectionHash: digest(projection),
  };
}

function releaseVerifierBenchmarkOptions(overrides = {}) {
  return {
    profile: 'unit',
    now: fixedNow,
    updateFiles: 4,
    createFiles: 2,
    staleFiles: 2,
    tempFsyncFailureFiles: 1,
    directoryFsyncFailureFiles: 1,
    fileBytes: 1024,
    seed: proofId,
    ...overrides,
  };
}

function supportOnlyReleaseProjection() {
  return {
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    productionStorageReceipts: 'not-claimed',
    externalDurability: 'not-claimed',
    releaseVerifierCarryThrough: 'support-only-claimed',
    releaseVerifierScope: 'local-filesystem-fsync-support-evidence',
    productionThroughput: 'not-claimed',
    speedClaimsAllowed: false,
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    blockers: [
      'production-storage-receipts-not-measured',
      'external-filesystem-durability-not-proven',
      'release-verifier-production-gate-not-present',
    ],
  };
}

function publicBenchmarkProjection(report) {
  return {
    rppId: report.rppId,
    benchmark: report.benchmark,
    profile: report.profile,
    workload: report.resources.workload,
    storage: report.resources.storage,
    fastPathLane: report.resources.fastPathLane,
    bytes: report.resources.bytes,
    gates: gateStatuses(report),
    evidenceSampleHashes: report.deterministicCoverage.evidenceSamples.map(safeStorageGuardHash),
  };
}

function safeStorageGuardHash(evidence) {
  return digest(safeStorageGuardProjection(evidence));
}

function safeStorageGuardProjection(evidence) {
  return {
    boundary: evidence.boundary,
    adapter: evidence.adapter,
    engine: evidence.engine,
    driver: evidence.driver,
    operation: evidence.operation,
    logicalPathHash: digest(evidence.logicalPath),
    comparedFields: evidence.comparedFields,
    expectedResourceHash: evidence.expectedResourceHash,
    expectedStorageHash: evidence.expectedStorageHash,
    actualStorageHash: evidence.actualStorageHash,
    plannedStorageHash: evidence.plannedStorageHash,
    postRenameStorageHash: evidence.postRenameStorageHash,
    outcome: evidence.outcome,
    sameDirectoryTemp: evidence.sameDirectoryTemp,
    compareBeforeRename: evidence.compareBeforeRename,
    liveStorageMatched: evidence.liveStorageMatched,
    renameAttempted: evidence.renameAttempted,
    tempRemovedOnBlockedWrite: evidence.tempRemovedOnBlockedWrite,
    atomicVisibilityBoundary: evidence.atomicVisibilityBoundary,
    fsyncEvidence: evidence.fsyncEvidence,
    correctnessGates: evidence.correctnessGates,
    fastPathLane: evidence.fastPathLane,
    bytesCompared: evidence.bytesCompared,
    bytesWrittenToTemp: evidence.bytesWrittenToTemp,
    steps: evidence.steps,
  };
}

function hasRuntimeReport(report) {
  return report.runtime
    && report.runtime.benchmarkId === FILESYSTEM_FSYNC_EVIDENCE_BENCHMARK_ID
    && typeof report.runtime.generatedAt === 'string'
    && typeof report.runtime.durationMs === 'number'
    && typeof report.runtime.node === 'string'
    && typeof report.runtime.platform === 'string'
    && typeof report.runtime.arch === 'string'
    && typeof report.runtime.cpuCount === 'number';
}

function hasResourceReport(report) {
  return report.resources
    && report.resources.process
    && report.resources.storage
    && report.resources.fastPathLane
    && report.resources.bytes
    && typeof report.resources.process.heapUsedBytes === 'number'
    && typeof report.resources.storage.guardedWritesAttempted === 'number'
    && typeof report.resources.fastPathLane.updates === 'number'
    && typeof report.resources.bytes.tempWrittenBytes === 'number';
}

function hasPassFailGateReport(report) {
  return Array.isArray(report.gates)
    && report.gates.length === requiredBenchmarkGateIds.length
    && report.gates.every((gate) => requiredBenchmarkGateIds.includes(gate.id)
      && ['pass', 'fail'].includes(gate.status));
}

function writeFixture(rootDir, logicalPath, contents) {
  const absolutePath = path.join(rootDir, logicalPath);
  ensureFilesystemDirectoryUsable(rootDir, path.dirname(absolutePath));
  fs.writeFileSync(absolutePath, contents);
}

function readFixture(rootDir, logicalPath) {
  return fs.readFileSync(path.join(rootDir, logicalPath), 'utf8');
}

function codedError(code) {
  const error = new Error(`fixture ${code} failure should not be serialized`);
  error.code = code;
  return error;
}

function resourceEvidence(kind, logicalPath, expectedStorage) {
  return {
    type: 'file',
    kind,
    logicalPathHash: digest(logicalPath),
    expectedStorageHash: filesystemStorageHash(expectedStorage),
  };
}

function proofGate(id, passed, metrics = {}) {
  return {
    id,
    status: passed ? 'pass' : 'fail',
    metrics,
  };
}

function gateStatuses(report) {
  return report.gates.map((gate) => ({
    id: gate.id,
    status: gate.status,
  }));
}

function gateById(proofOrEvidence, id) {
  const gates = proofOrEvidence.gates || proofOrEvidence.correctnessGates;
  const gate = gates.find((candidate) => candidate.id === id);
  assert.ok(gate, `missing gate ${id}`);
  return gate;
}

function countBy(values, keyForValue) {
  return values.reduce((counts, value) => {
    const key = keyForValue(value);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function countBlockers(evidenceSamples) {
  const counts = {};
  for (const evidence of evidenceSamples) {
    for (const blocker of evidence.fastPathLane.blockedBy) {
      counts[blocker] = (counts[blocker] || 0) + 1;
    }
  }
  return sortedObject(counts);
}

function sortedObject(input) {
  return Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right)));
}

function allCorrectnessGatesPass(evidence) {
  return evidence.correctnessGates.every((gate) => gate.status === 'pass');
}

function objectKeyBefore(object, leftKey, rightKey) {
  const keys = Object.keys(object);
  return keys.indexOf(leftKey) >= 0 && keys.indexOf(rightKey) >= 0
    && keys.indexOf(leftKey) < keys.indexOf(rightKey);
}

function assertStorageGuardHasOnlySafeValues(evidence, rootDir) {
  const serialized = JSON.stringify(evidence);
  for (const token of rawFilesystemTokens(rootDir).filter((value) => !value.startsWith('wp-content/uploads'))) {
    assert.equal(serialized.includes(token), false, `storage guard leaked raw token ${token}`);
  }
}

function assertNoRawFilesystemValues(value, label) {
  assert.equal(hasRawFilesystemToken(value), false, `${label} leaked raw filesystem evidence`);
}

function hasRawFilesystemToken(value) {
  const serialized = JSON.stringify(value);
  return rawFilesystemTokens().some((token) => serialized.includes(token));
}

function rawFilesystemTokens(rootDir = null) {
  return [
    'rpp0785-base-update-payload',
    'rpp0785-planned-update-payload',
    'rpp0785-planned-create-payload',
    'rpp0785-base-stale-payload',
    'rpp0785-planned-stale-payload',
    'rpp0785-drift-stale-payload',
    'rpp0785-base-temp-fsync-payload',
    'rpp0785-planned-temp-fsync-payload',
    'rpp0785-base-directory-fsync-payload',
    'rpp0785-planned-directory-fsync-payload',
    'rpp0785-base-post-rename-payload',
    'rpp0785-planned-post-rename-payload',
    'rpp0785-drift-post-rename-payload',
    'fixture EIO failure',
    'fixture EINVAL failure',
    'fsync-base-payload',
    'fsync-planned-payload',
    'fsync-drift-payload',
    'filesystem fsync raw fixture',
    'wp-content/uploads/rpp-0785',
    FILESYSTEM_FSYNC_TEMP_PREFIX,
    rootDir,
  ].filter(Boolean);
}
