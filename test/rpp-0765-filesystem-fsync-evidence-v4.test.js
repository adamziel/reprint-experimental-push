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
import { digest } from '../src/stable-json.js';
import {
  FILESYSTEM_FSYNC_EVIDENCE_BENCHMARK_ID,
  runFilesystemFsyncEvidenceBenchmark,
} from '../scripts/bench/filesystem-fsync-evidence.js';

const proofId = 'rpp-0765-filesystem-fsync-evidence-v4';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');

test('RPP-0765 variant 4 guards fast-path lane updates until correctness gates hold', () => {
  const { rootDir, results, summary } = runFocusedStorageMatrix();

  assert.equal(summary.storage.boundary, FILESYSTEM_FSYNC_BOUNDARY);
  assert.equal(summary.storage.guardedWritesAttempted, 6);
  assert.equal(summary.storage.appliedFsyncCompleteWrites, 2);
  assert.equal(summary.storage.appliedFsyncIncompleteWrites, 2);
  assert.equal(summary.storage.staleAtWriteWrites, 1);
  assert.equal(summary.storage.tempFsyncFailedBeforeRenameWrites, 1);
  assert.equal(summary.fastPathLane.id, FILESYSTEM_FSYNC_FAST_PATH_LANE);
  assert.equal(summary.fastPathLane.updates, 2);
  assert.equal(summary.fastPathLane.blocked, 4);
  assert.deepEqual(summary.fastPathLane.blockedBy, {
    'live-storage-mismatch': 1,
    'post-rename-storage-mismatch': 1,
    'target-directory-fsync-missing': 1,
    'temp-file-fsync-missing': 1,
  });
  assert.equal(summary.fastPathLane.updatesOnlyAfterCorrectnessGates, true);
  assert.equal(summary.fastPathLane.updatesOnlyWhenCorrectnessGatesHold, true);
  assert.equal(summary.fastPathLane.unsafeUpdatesBeforeGates, 0);
  assert.equal(summary.fastPathLane.updatesWithFailedGate, 0);
  assert.equal(summary.correctness.updatedSamplesAllGatesPassed, true);
  assert.equal(summary.correctness.blockedSamplesHoldNoLaneUpdate, true);
  assert.equal(summary.correctness.postRenameMismatchBlocksLane, true);
  assert.equal(summary.redaction.rawValueEvidenceLeaks, 0);
  assertProjectionHasNoRawFilesystemValues(summary);

  for (const { scenario, logicalPath, result } of results) {
    assert.equal(result.applied, scenario.expected.applied, scenario.id);
    assert.equal(result.fastPathLaneUpdated, scenario.expected.fastPathLaneUpdated, scenario.id);
    assert.equal(result.storageGuard.outcome, scenario.expected.outcome, scenario.id);
    assert.equal(result.storageGuard.fastPathLane.updated, result.fastPathLaneUpdated, scenario.id);
    assert.equal(result.storageGuard.boundary, FILESYSTEM_FSYNC_BOUNDARY, scenario.id);
    assert.equal(result.storageGuard.fastPathLane.id, FILESYSTEM_FSYNC_FAST_PATH_LANE, scenario.id);
    assert.equal(result.storageGuard.fastPathLane.correctnessGatesEvaluatedBeforeUpdate, true, scenario.id);
    assert.equal(objectKeyBefore(result.storageGuard, 'fsyncEvidence', 'correctnessGates'), true, scenario.id);
    assert.equal(objectKeyBefore(result.storageGuard, 'correctnessGates', 'fastPathLane'), true, scenario.id);
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
  assert.equal(byId['matching-update'].storageGuard.fsyncEvidence.tempFile.status, 'passed');
  assert.equal(byId['matching-update'].storageGuard.fsyncEvidence.targetDirectory.status, 'passed');
  assert.equal(gateById(byId['matching-update'].storageGuard, 'post-rename-storage-matches-planned').status, 'pass');

  assert.equal(byId['stale-update'].storageGuard.renameAttempted, false);
  assert.equal(byId['stale-update'].storageGuard.tempRemovedOnBlockedWrite, true);
  assert.equal(gateById(byId['stale-update'].storageGuard, 'live-storage-precondition-match').status, 'fail');

  assert.equal(byId['temp-fsync-failure'].storageGuard.renameAttempted, false);
  assert.equal(byId['temp-fsync-failure'].storageGuard.fsyncEvidence.tempFile.status, 'failed');
  assert.equal(byId['temp-fsync-failure'].storageGuard.fsyncEvidence.targetDirectory.status, 'not-attempted');
  assert.equal(gateById(byId['temp-fsync-failure'].storageGuard, 'temp-file-fsync-before-live-compare').status, 'fail');

  assert.equal(byId['directory-fsync-failure'].storageGuard.fsyncEvidence.tempFile.status, 'passed');
  assert.equal(byId['directory-fsync-failure'].storageGuard.fsyncEvidence.targetDirectory.status, 'failed');
  assert.equal(gateById(byId['directory-fsync-failure'].storageGuard, 'target-directory-fsync-after-rename').status, 'fail');
  assert.equal(gateById(byId['directory-fsync-failure'].storageGuard, 'post-rename-storage-matches-planned').status, 'pass');

  assert.equal(byId['post-rename-mismatch'].storageGuard.fsyncEvidence.tempFile.status, 'passed');
  assert.equal(byId['post-rename-mismatch'].storageGuard.fsyncEvidence.targetDirectory.status, 'passed');
  assert.equal(gateById(byId['post-rename-mismatch'].storageGuard, 'target-directory-fsync-after-rename').status, 'pass');
  assert.equal(gateById(byId['post-rename-mismatch'].storageGuard, 'post-rename-storage-matches-planned').status, 'fail');
  assert.ok(
    byId['post-rename-mismatch'].storageGuard.fastPathLane.blockedBy.includes('post-rename-storage-mismatch'),
  );

  assert.equal(filesystemTempLeakPaths(rootDir).length, 0);
});

test('RPP-0765 variant 4 projects deterministic hash-only support evidence and release NO-GO', () => {
  const focusedSummary = runFocusedStorageMatrix().summary;
  const repeatedFocusedSummary = runFocusedStorageMatrix().summary;
  const passOptions = variant4BenchmarkOptions({
    maxDurationMs: 100_000,
    maxHeapUsedBytes: 1024 * 1024 * 1024,
  });
  const firstPass = runFilesystemFsyncEvidenceBenchmark(passOptions);
  const secondPass = runFilesystemFsyncEvidenceBenchmark(passOptions);
  const passProof = buildVariant4Proof({
    focusedSummary,
    repeatedFocusedSummary,
    report: firstPass,
    repeatedReport: secondPass,
  });

  assert.equal(passProof.rppId, 'RPP-0765');
  assert.equal(passProof.proofId, proofId);
  assert.equal(passProof.variant, 4);
  assert.equal(passProof.status, 'passed');
  assert.equal(passProof.builtOn.rppId, 'RPP-0705');
  assert.equal(passProof.builtOn.benchmark, FILESYSTEM_FSYNC_EVIDENCE_BENCHMARK_ID);
  assert.match(passProof.builtOn.evidenceHash, /^[a-f0-9]{64}$/);
  assert.equal(passProof.focusedRegression.storage.guardedWritesAttempted, 6);
  assert.equal(passProof.focusedRegression.storage.appliedFsyncCompleteWrites, 2);
  assert.equal(passProof.focusedRegression.storage.appliedFsyncIncompleteWrites, 2);
  assert.deepEqual(passProof.focusedRegression.fastPathLane.blockedBy, {
    'live-storage-mismatch': 1,
    'post-rename-storage-mismatch': 1,
    'target-directory-fsync-missing': 1,
    'temp-file-fsync-missing': 1,
  });
  assert.equal(passProof.focusedRegression.correctness.postRenameMismatchBlocksLane, true);
  assert.match(passProof.focusedRegression.projectionHash, /^[a-f0-9]{64}$/);
  assert.equal(passProof.generatedCoverage.storage.guardedWritesAttempted, 10);
  assert.equal(passProof.generatedCoverage.storage.appliedFsyncCompleteWrites, 6);
  assert.equal(passProof.generatedCoverage.storage.appliedFsyncIncompleteWrites, 1);
  assert.equal(passProof.generatedCoverage.storage.staleAtWriteWrites, 2);
  assert.equal(passProof.generatedCoverage.storage.tempFsyncFailedBeforeRenameWrites, 1);
  assert.equal(passProof.fastPathLane.id, FILESYSTEM_FSYNC_FAST_PATH_LANE);
  assert.equal(passProof.fastPathLane.focusedUpdates, 2);
  assert.equal(passProof.fastPathLane.focusedBlocked, 4);
  assert.equal(passProof.fastPathLane.generatedUpdates, 6);
  assert.equal(passProof.fastPathLane.generatedBlocked, 4);
  assert.deepEqual(passProof.fastPathLane.generatedBlockedBy, {
    'live-storage-mismatch': 2,
    'target-directory-fsync-missing': 1,
    'temp-file-fsync-missing': 1,
  });
  assert.equal(passProof.fastPathLane.updatesOnlyAfterCorrectnessGates, true);
  assert.equal(passProof.fastPathLane.updatesOnlyWhenCorrectnessGatesHold, true);
  assert.equal(passProof.fastPathLane.unsafeUpdatesBeforeGates, 0);
  assert.equal(passProof.fastPathLane.updatesWithFailedGate, 0);
  assert.equal(passProof.correctness.updatedSamplesAllGatesPassed, true);
  assert.equal(passProof.correctness.blockedSamplesHoldNoLaneUpdate, true);
  assert.equal(passProof.correctness.correctnessGatesBeforePerformanceClaims, true);
  assert.equal(passProof.correctness.deterministicHashCountProjection, true);
  assert.equal(passProof.performance.budgetStatus, 'passed');
  assert.equal(passProof.performance.localSupportOnly, true);
  assert.equal(passProof.performance.productionThroughput, 'not-claimed');
  assert.deepEqual(passProof.gates.map((gate) => gate.status), [
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
  ]);
  assert.equal(gateById(passProof, 'deterministic-hash-count-projection').metrics.sameFocusedProjectionHash, true);
  assert.equal(gateById(passProof, 'deterministic-hash-count-projection').metrics.sameBenchmarkProjectionHash, true);
  assert.equal(passProof.release.supportOnly, true);
  assert.equal(passProof.release.productionBacked, false);
  assert.equal(passProof.release.productionStorageReceipts, 'not-claimed');
  assert.equal(passProof.release.speedClaimsAllowed, false);
  assert.equal(passProof.release.finalReleaseStatus, 'NO-GO');
  assert.equal(passProof.release.integrationRecommendation, 'NO-GO');
  assert.match(passProof.evidenceHash, /^[a-f0-9]{64}$/);
  assertProjectionHasNoRawFilesystemValues(passProof);

  const failOptions = variant4BenchmarkOptions({
    maxDurationMs: 100_000,
    maxHeapUsedBytes: 1,
  });
  const firstFail = runFilesystemFsyncEvidenceBenchmark(failOptions);
  const secondFail = runFilesystemFsyncEvidenceBenchmark(failOptions);
  const failProof = buildVariant4Proof({
    focusedSummary,
    repeatedFocusedSummary,
    report: firstFail,
    repeatedReport: secondFail,
  });

  assert.equal(failProof.status, 'failed');
  assert.equal(gateById(failProof, 'focused-storage-regression-covered').status, 'pass');
  assert.equal(gateById(failProof, 'fast-path-lane-only-after-correctness-gates-hold').status, 'pass');
  assert.equal(gateById(failProof, 'benchmark-correctness-gates-retained').status, 'pass');
  assert.equal(gateById(failProof, 'deterministic-hash-count-projection').status, 'pass');
  assert.equal(gateById(failProof, 'local-performance-budget').status, 'fail');
  assert.equal(gateById(failProof, 'hash-only-public-proof').status, 'pass');
  assert.equal(gateById(failProof, 'support-only-release-no-go').status, 'pass');
  assert.equal(failProof.performance.budgetStatus, 'failed');
  assert.equal(failProof.performance.heapWithinBudget, false);
  assert.equal(failProof.performance.maxHeapUsedBytes, 1);
  assert.equal(failProof.release.finalReleaseStatus, 'NO-GO');
  assert.equal(failProof.release.integrationRecommendation, 'NO-GO');
  assertProjectionHasNoRawFilesystemValues(failProof);
});

function runFocusedStorageMatrix() {
  const rootDir = createFilesystemFsyncTempRoot('reprint-rpp-0765-focused-');
  const results = [];

  for (const scenario of focusedStorageScenarios()) {
    const logicalPath = `wp-content/uploads/rpp-0765/focused/${scenario.id}.txt`;
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
      driver: 'rpp-0765-focused-proof',
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
  }

  return {
    rootDir,
    results,
    summary: summarizeFocusedMatrix(results),
  };
}

function focusedStorageScenarios() {
  return [
    {
      id: 'matching-update',
      operation: 'update',
      initialContents: 'rpp0765-base-update-payload',
      plannedContents: 'rpp0765-planned-update-payload',
      expected: {
        applied: true,
        fastPathLaneUpdated: true,
        outcome: 'applied',
        blocker: null,
        finalContents: 'rpp0765-planned-update-payload',
      },
    },
    {
      id: 'matching-create',
      operation: 'create',
      initialContents: null,
      plannedContents: 'rpp0765-planned-create-payload',
      expected: {
        applied: true,
        fastPathLaneUpdated: true,
        outcome: 'applied',
        blocker: null,
        finalContents: 'rpp0765-planned-create-payload',
      },
    },
    {
      id: 'stale-update',
      operation: 'update',
      initialContents: 'rpp0765-base-stale-payload',
      plannedContents: 'rpp0765-planned-stale-payload',
      afterTempFsync: ({ absolutePath }) => {
        fs.writeFileSync(absolutePath, 'rpp0765-drift-stale-payload');
      },
      expected: {
        applied: false,
        fastPathLaneUpdated: false,
        outcome: 'stale-at-write',
        blocker: 'live-storage-mismatch',
        finalContents: 'rpp0765-drift-stale-payload',
      },
    },
    {
      id: 'temp-fsync-failure',
      operation: 'update',
      initialContents: 'rpp0765-base-temp-fsync-payload',
      plannedContents: 'rpp0765-planned-temp-fsync-payload',
      fsyncFileSync: () => {
        throw codedError('EIO');
      },
      expected: {
        applied: false,
        fastPathLaneUpdated: false,
        outcome: 'fsync-failed-before-rename',
        blocker: 'temp-file-fsync-missing',
        finalContents: 'rpp0765-base-temp-fsync-payload',
      },
    },
    {
      id: 'directory-fsync-failure',
      operation: 'update',
      initialContents: 'rpp0765-base-directory-fsync-payload',
      plannedContents: 'rpp0765-planned-directory-fsync-payload',
      fsyncDirectorySync: () => {
        throw codedError('EINVAL');
      },
      expected: {
        applied: true,
        fastPathLaneUpdated: false,
        outcome: 'applied-fsync-incomplete',
        blocker: 'target-directory-fsync-missing',
        finalContents: 'rpp0765-planned-directory-fsync-payload',
      },
    },
    {
      id: 'post-rename-mismatch',
      operation: 'update',
      initialContents: 'rpp0765-base-post-rename-payload',
      plannedContents: 'rpp0765-planned-post-rename-payload',
      fsyncDirectorySync: ({ rootDir, logicalPath }) => {
        fs.writeFileSync(path.join(rootDir, logicalPath), 'rpp0765-drift-post-rename-payload');
      },
      expected: {
        applied: true,
        fastPathLaneUpdated: false,
        outcome: 'applied-fsync-incomplete',
        blocker: 'post-rename-storage-mismatch',
        finalContents: 'rpp0765-drift-post-rename-payload',
      },
    },
  ];
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

function variant4BenchmarkOptions(overrides = {}) {
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
    gateIds: FILESYSTEM_FSYNC_CORRECTNESS_GATE_IDS,
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
    mode: 'hash-count-only-public-proof',
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

function buildVariant4Proof({
  focusedSummary,
  repeatedFocusedSummary,
  report,
  repeatedReport,
}) {
  const evidenceSamples = report.deterministicCoverage.evidenceSamples;
  const gateVector = gateStatuses(report);
  const repeatedGateVector = gateStatuses(repeatedReport);
  const sameGateVector = JSON.stringify(gateVector) === JSON.stringify(repeatedGateVector);
  const benchmarkProjectionHash = digest(publicBenchmarkProjection(report));
  const repeatedBenchmarkProjectionHash = digest(publicBenchmarkProjection(repeatedReport));
  const sameBenchmarkProjectionHash = benchmarkProjectionHash === repeatedBenchmarkProjectionHash;
  const benchmarkSampleHashes = evidenceSamples.map(safeStorageGuardHash);
  const repeatedBenchmarkSampleHashes = repeatedReport.deterministicCoverage.evidenceSamples.map(safeStorageGuardHash);
  const sameBenchmarkSampleHashes = JSON.stringify(benchmarkSampleHashes) === JSON.stringify(repeatedBenchmarkSampleHashes);
  const sameFocusedProjectionHash = focusedSummary.projectionHash === repeatedFocusedSummary.projectionHash;
  const updatedSamples = evidenceSamples.filter((evidence) => evidence.fastPathLane.updated === true);
  const blockedSamples = evidenceSamples.filter((evidence) => evidence.fastPathLane.updated === false);
  const outcomes = sortedObject(countBy(evidenceSamples, (evidence) => evidence.outcome));
  const updatedSamplesAllGatesPassed = updatedSamples.length === report.resources.fastPathLane.updates
    && updatedSamples.every((evidence) => (
      evidence.outcome === 'applied'
      && evidence.fsyncEvidence.tempFile.status === 'passed'
      && evidence.fsyncEvidence.targetDirectory.status === 'passed'
      && allCorrectnessGatesPass(evidence)
      && evidence.fastPathLane.correctnessGatesHold === true
    ));
  const blockedSamplesHoldNoLaneUpdate = blockedSamples.length === report.resources.fastPathLane.blocked
    && blockedSamples.every((evidence) => (
      evidence.fastPathLane.updated === false
      && evidence.fastPathLane.correctnessGatesHold === false
      && evidence.fastPathLane.blockedBy.length > 0
    ));
  const updatesOnlyWhenCorrectnessGatesHold = evidenceSamples.every((evidence) => (
    evidence.fastPathLane.updated === (evidence.outcome === 'applied' && allCorrectnessGatesPass(evidence))
  ));
  const benchmarkCorrectnessGatesRetained = [
    'deterministic-fsync-guard-behavior',
    'correctness-gates-before-fast-path-lane',
    'temp-and-directory-fsync-required-for-updates',
    'stale-storage-blocks-rename-and-lane-update',
    'temp-fsync-failure-blocks-rename-and-lane-update',
    'directory-fsync-failure-withholds-fast-path-lane-update',
    'temp-cleanup',
    'hash-only-evidence',
  ].every((gateId) => benchmarkGateById(report, gateId).status === 'pass');
  const unsafeLaneUpdates = report.resources.fastPathLane.unsafeUpdatesBeforeGates
    + report.resources.fastPathLane.updatesWithFailedGate;
  const focusedStorageRegressionCovered = focusedSummary.storage.guardedWritesAttempted === 6
    && focusedSummary.storage.appliedFsyncCompleteWrites === 2
    && focusedSummary.storage.appliedFsyncIncompleteWrites === 2
    && focusedSummary.storage.staleAtWriteWrites === 1
    && focusedSummary.storage.tempFsyncFailedBeforeRenameWrites === 1
    && focusedSummary.fastPathLane.updates === 2
    && focusedSummary.fastPathLane.blocked === 4
    && focusedSummary.correctness.postRenameMismatchBlocksLane === true;
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
    && report.resources.storage.unsafeRenameAfterTempFsyncFailureWrites === 0
    && outcomes.applied === report.resources.workload.expectedFastPathLaneUpdates
    && outcomes['applied-fsync-incomplete'] === report.resources.workload.directoryFsyncFailureFiles
    && outcomes['stale-at-write'] === report.resources.workload.staleFiles
    && outcomes['fsync-failed-before-rename'] === report.resources.workload.tempFsyncFailureFiles;
  const runtimeGate = benchmarkGateById(report, 'runtime-resource-budget');
  const supportOnlyRelease = {
    supportOnly: true,
    productionBacked: false,
    productionStorageReceipts: 'not-claimed',
    externalDurability: 'not-claimed',
    releaseVerifierCarryThrough: 'not-claimed',
    productionThroughput: 'not-claimed',
    speedClaimsAllowed: false,
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    blockers: [
      'production-storage-receipts-not-measured',
      'external-filesystem-durability-not-proven',
      'release-verifier-carry-through-not-claimed',
    ],
  };
  const correctnessGatesBeforePerformanceClaims = benchmarkCorrectnessGatesRetained
    && report.fastPathLane.updatesOnlyAfterCorrectnessGates === true
    && supportOnlyRelease.productionThroughput === 'not-claimed'
    && supportOnlyRelease.speedClaimsAllowed === false;
  const deterministicHashCountProjection = sameFocusedProjectionHash
    && sameGateVector
    && sameBenchmarkProjectionHash
    && sameBenchmarkSampleHashes;
  const gates = [
    proofGate('focused-storage-regression-covered', focusedStorageRegressionCovered, {
      guardedWritesAttempted: focusedSummary.storage.guardedWritesAttempted,
      outcomes: focusedSummary.outcomes,
      blockedBy: focusedSummary.fastPathLane.blockedBy,
      postRenameMismatchBlocksLane: focusedSummary.correctness.postRenameMismatchBlocksLane,
    }),
    proofGate('fast-path-lane-only-after-correctness-gates-hold',
      focusedSummary.fastPathLane.updatesOnlyWhenCorrectnessGatesHold
        && focusedSummary.fastPathLane.updatesOnlyAfterCorrectnessGates
        && updatedSamplesAllGatesPassed
        && blockedSamplesHoldNoLaneUpdate
        && updatesOnlyWhenCorrectnessGatesHold
        && unsafeLaneUpdates === 0, {
        focusedUpdates: focusedSummary.fastPathLane.updates,
        focusedBlocked: focusedSummary.fastPathLane.blocked,
        generatedUpdates: updatedSamples.length,
        generatedBlocked: blockedSamples.length,
        unsafeLaneUpdates,
        updatesOnlyWhenCorrectnessGatesHold,
      }),
    proofGate('benchmark-correctness-gates-retained', generatedStorageOutcomesCovered
      && correctnessGatesBeforePerformanceClaims, {
      benchmarkGateVector: gateVector,
      productionThroughput: supportOnlyRelease.productionThroughput,
      speedClaimsAllowed: supportOnlyRelease.speedClaimsAllowed,
    }),
    proofGate('deterministic-hash-count-projection', deterministicHashCountProjection, {
      sameFocusedProjectionHash,
      sameBenchmarkGateVector: sameGateVector,
      sameBenchmarkProjectionHash,
      sameBenchmarkSampleHashes,
      focusedProjectionHash: focusedSummary.projectionHash,
      benchmarkProjectionHash,
    }),
    proofGate('local-performance-budget', runtimeGate.status === 'pass', runtimeGate.evidence),
    proofGate('hash-only-public-proof',
      focusedSummary.redaction.rawValueEvidenceLeaks === 0
        && report.deterministicCoverage.rawValueEvidenceLeaks === 0, {
        focusedRawValueEvidenceLeaks: focusedSummary.redaction.rawValueEvidenceLeaks,
        benchmarkRawValueEvidenceLeaks: report.deterministicCoverage.rawValueEvidenceLeaks,
        focusedEvidenceSampleHashes: focusedSummary.redaction.evidenceSampleHashes,
        benchmarkEvidenceSampleHashes: benchmarkSampleHashes,
      }),
    proofGate('support-only-release-no-go', supportOnlyRelease.supportOnly === true
      && supportOnlyRelease.productionBacked === false
      && supportOnlyRelease.finalReleaseStatus === 'NO-GO'
      && supportOnlyRelease.integrationRecommendation === 'NO-GO', {
      finalReleaseStatus: supportOnlyRelease.finalReleaseStatus,
      productionBacked: supportOnlyRelease.productionBacked,
      integrationRecommendation: supportOnlyRelease.integrationRecommendation,
    }),
  ];
  const publicEvidence = {
    rppId: 'RPP-0765',
    proofId,
    variant: 4,
    status: gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed',
    builtOn: {
      rppId: report.rppId,
      benchmark: report.benchmark,
      evidenceHash: benchmarkProjectionHash,
    },
    focusedRegression: {
      source: 'RPP-0765 local focused matrix',
      storage: focusedSummary.storage,
      outcomes: focusedSummary.outcomes,
      fastPathLane: focusedSummary.fastPathLane,
      correctness: focusedSummary.correctness,
      evidenceSamples: focusedSummary.evidenceSamples,
      evidenceSampleHashes: focusedSummary.redaction.evidenceSampleHashes,
      projectionHash: focusedSummary.projectionHash,
    },
    generatedCoverage: {
      source: 'RPP-0705 local filesystem fsync benchmark',
      workload: report.resources.workload,
      storage: report.resources.storage,
      outcomes,
      evidenceSamples: evidenceSamples.length,
      evidenceSampleHashes: benchmarkSampleHashes,
    },
    fastPathLane: {
      id: report.fastPathLane.id,
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
        && updatesOnlyWhenCorrectnessGatesHold,
      unsafeUpdatesBeforeGates: focusedSummary.fastPathLane.unsafeUpdatesBeforeGates
        + report.resources.fastPathLane.unsafeUpdatesBeforeGates,
      updatesWithFailedGate: focusedSummary.fastPathLane.updatesWithFailedGate
        + report.resources.fastPathLane.updatesWithFailedGate,
    },
    correctness: {
      gateIds: FILESYSTEM_FSYNC_CORRECTNESS_GATE_IDS,
      updatedSamplesAllGatesPassed: focusedSummary.correctness.updatedSamplesAllGatesPassed
        && updatedSamplesAllGatesPassed,
      blockedSamplesHoldNoLaneUpdate: focusedSummary.correctness.blockedSamplesHoldNoLaneUpdate
        && blockedSamplesHoldNoLaneUpdate,
      postRenameMismatchBlocksLane: focusedSummary.correctness.postRenameMismatchBlocksLane,
      correctnessGatesBeforePerformanceClaims,
      deterministicHashCountProjection,
      benchmarkGateVector: gateVector,
    },
    performance: {
      localSupportOnly: true,
      budgetStatus: runtimeGate.status === 'pass' ? 'passed' : 'failed',
      profile: report.profile,
      durationMs: report.runtime.durationMs,
      maxDurationMs: report.runtime.budgets.maxDurationMs,
      durationWithinBudget: report.runtime.durationMs <= report.runtime.budgets.maxDurationMs,
      heapUsedBytes: report.resources.process.heapUsedBytes,
      maxHeapUsedBytes: report.runtime.budgets.maxHeapUsedBytes,
      heapWithinBudget: report.resources.process.heapUsedBytes <= report.runtime.budgets.maxHeapUsedBytes,
      guardedWritesAttempted: report.resources.storage.guardedWritesAttempted,
      fastPathLaneUpdates: report.fastPathLane.updates,
      productionThroughput: supportOnlyRelease.productionThroughput,
    },
    gates,
    release: supportOnlyRelease,
    redaction: {
      mode: 'hash-count-only-public-proof',
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

function benchmarkGateById(report, id) {
  const gate = report.gates.find((candidate) => candidate.id === id);
  assert.ok(gate, `missing benchmark gate ${id}`);
  return gate;
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
  for (const token of rawFilesystemTokens(rootDir).filter((value) => value !== 'wp-content/uploads')) {
    assert.equal(serialized.includes(token), false, `storage guard leaked raw token ${token}`);
  }
}

function assertProjectionHasNoRawFilesystemValues(proof) {
  const serialized = JSON.stringify(proof);
  for (const token of rawFilesystemTokens()) {
    assert.equal(serialized.includes(token), false, `proof leaked raw token ${token}`);
  }
}

function hasRawFilesystemToken(value) {
  const serialized = JSON.stringify(value);
  return rawFilesystemTokens().some((token) => serialized.includes(token));
}

function rawFilesystemTokens(rootDir = null) {
  return [
    'rpp0765-base-update-payload',
    'rpp0765-planned-update-payload',
    'rpp0765-planned-create-payload',
    'rpp0765-base-stale-payload',
    'rpp0765-planned-stale-payload',
    'rpp0765-drift-stale-payload',
    'rpp0765-base-temp-fsync-payload',
    'rpp0765-planned-temp-fsync-payload',
    'rpp0765-base-directory-fsync-payload',
    'rpp0765-planned-directory-fsync-payload',
    'rpp0765-base-post-rename-payload',
    'rpp0765-planned-post-rename-payload',
    'rpp0765-drift-post-rename-payload',
    'fixture EIO failure',
    'fixture EINVAL failure',
    'fsync-base-payload',
    'fsync-planned-payload',
    'fsync-drift-payload',
    'filesystem fsync raw fixture',
    'wp-content/uploads',
    FILESYSTEM_FSYNC_TEMP_PREFIX,
    rootDir,
  ].filter(Boolean);
}
