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

const proofId = 'rpp-0725-filesystem-fsync-evidence-v2';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');

test('RPP-0725 variant 2 records fsync evidence before fast-path lane updates', () => {
  const rootDir = createFilesystemFsyncTempRoot('reprint-rpp-0725-lane-');
  const logicalPath = 'wp-content/uploads/rpp-0725/lane/update.txt';
  writeFixture(rootDir, logicalPath, 'rpp0725-base-lane-payload');
  const expectedStorage = readFilesystemStorageDescriptor({ rootDir, logicalPath });
  const observedOrder = [];

  const result = applyFilesystemFsyncEvidenceWrite({
    rootDir,
    logicalPath,
    expectedResource: resourceEvidence('lane-update', logicalPath, expectedStorage),
    expectedStorage,
    plannedContents: 'rpp0725-planned-lane-payload',
    operation: 'update',
    driver: 'rpp-0725-focused-proof',
    fsyncFileSync: () => {
      observedOrder.push('temp-file-fsync');
    },
    afterTempFsync: ({ absolutePath }) => {
      observedOrder.push('after-temp-fsync-callback');
      assert.equal(fs.existsSync(absolutePath), true);
      assert.equal(readFixture(rootDir, logicalPath), 'rpp0725-base-lane-payload');
    },
    fsyncDirectorySync: () => {
      observedOrder.push('target-directory-fsync');
    },
  });

  assert.equal(result.applied, true);
  assert.equal(result.fastPathLaneUpdated, true);
  assert.equal(readFixture(rootDir, logicalPath), 'rpp0725-planned-lane-payload');
  assert.deepEqual(observedOrder, [
    'temp-file-fsync',
    'after-temp-fsync-callback',
    'target-directory-fsync',
  ]);
  assert.deepEqual(result.storageGuard.steps, [
    'write-temp-same-directory',
    'fsync-temp-before-live-compare',
    'read-live-storage',
    'compare-expected-storage-hash',
    'rename-temp-to-target',
    'fsync-target-directory-after-rename',
    'read-post-rename-storage',
  ]);
  assert.equal(objectKeyBefore(result.storageGuard, 'fsyncEvidence', 'correctnessGates'), true);
  assert.equal(objectKeyBefore(result.storageGuard, 'correctnessGates', 'fastPathLane'), true);
  assert.equal(result.storageGuard.boundary, FILESYSTEM_FSYNC_BOUNDARY);
  assert.equal(result.storageGuard.fsyncEvidence.tempFile.status, 'passed');
  assert.equal(result.storageGuard.fsyncEvidence.targetDirectory.status, 'passed');
  assert.deepEqual(result.storageGuard.correctnessGates.map((gate) => gate.id), FILESYSTEM_FSYNC_CORRECTNESS_GATE_IDS);
  assert.deepEqual([...new Set(result.storageGuard.correctnessGates.map((gate) => gate.status))], ['pass']);
  assert.equal(result.storageGuard.fastPathLane.id, FILESYSTEM_FSYNC_FAST_PATH_LANE);
  assert.equal(result.storageGuard.fastPathLane.correctnessGatesEvaluatedBeforeUpdate, true);
  assert.equal(result.storageGuard.fastPathLane.correctnessGatesHold, true);
  assert.equal(result.storageGuard.fastPathLane.updated, true);
  assert.deepEqual(result.storageGuard.fastPathLane.blockedBy, []);
  assertStorageGuardHasOnlySafeValues(result.storageGuard, rootDir);
  assert.equal(filesystemTempLeakPaths(rootDir).length, 0);
});

test('RPP-0725 variant 2 keeps stale and unsafe fsync cases out of the fast-path lane', () => {
  const rootDir = createFilesystemFsyncTempRoot('reprint-rpp-0725-blocked-');

  const stalePath = 'wp-content/uploads/rpp-0725/blocked/stale.txt';
  writeFixture(rootDir, stalePath, 'rpp0725-base-stale-payload');
  const expectedStale = readFilesystemStorageDescriptor({ rootDir, logicalPath: stalePath });
  const stale = applyFilesystemFsyncEvidenceWrite({
    rootDir,
    logicalPath: stalePath,
    expectedResource: resourceEvidence('stale', stalePath, expectedStale),
    expectedStorage: expectedStale,
    plannedContents: 'rpp0725-planned-stale-payload',
    operation: 'update',
    driver: 'rpp-0725-focused-proof',
    afterTempFsync: ({ absolutePath }) => {
      fs.writeFileSync(absolutePath, 'rpp0725-drift-stale-payload');
    },
  });

  assert.equal(stale.applied, false);
  assert.equal(stale.fastPathLaneUpdated, false);
  assert.equal(stale.storageGuard.outcome, 'stale-at-write');
  assert.equal(stale.storageGuard.renameAttempted, false);
  assert.equal(stale.storageGuard.tempRemovedOnBlockedWrite, true);
  assert.equal(stale.storageGuard.fsyncEvidence.tempFile.status, 'passed');
  assert.equal(stale.storageGuard.fsyncEvidence.targetDirectory.status, 'not-attempted');
  assert.equal(stale.storageGuard.fastPathLane.updated, false);
  assert.equal(gateById(stale.storageGuard, 'live-storage-precondition-match').status, 'fail');
  assert.ok(stale.storageGuard.fastPathLane.blockedBy.includes('live-storage-mismatch'));
  assert.equal(readFixture(rootDir, stalePath), 'rpp0725-drift-stale-payload');

  const tempFailurePath = 'wp-content/uploads/rpp-0725/blocked/temp-fsync.txt';
  writeFixture(rootDir, tempFailurePath, 'rpp0725-base-temp-fsync-payload');
  const expectedTempFailure = readFilesystemStorageDescriptor({ rootDir, logicalPath: tempFailurePath });
  const tempFailure = applyFilesystemFsyncEvidenceWrite({
    rootDir,
    logicalPath: tempFailurePath,
    expectedResource: resourceEvidence('temp-fsync-failure', tempFailurePath, expectedTempFailure),
    expectedStorage: expectedTempFailure,
    plannedContents: 'rpp0725-planned-temp-fsync-payload',
    operation: 'update',
    driver: 'rpp-0725-focused-proof',
    fsyncFileSync: () => {
      throw codedError('EIO');
    },
  });

  assert.equal(tempFailure.applied, false);
  assert.equal(tempFailure.fastPathLaneUpdated, false);
  assert.equal(tempFailure.storageGuard.outcome, 'fsync-failed-before-rename');
  assert.equal(tempFailure.storageGuard.renameAttempted, false);
  assert.equal(tempFailure.storageGuard.fsyncEvidence.tempFile.status, 'failed');
  assert.equal(tempFailure.storageGuard.fsyncEvidence.targetDirectory.status, 'not-attempted');
  assert.equal(gateById(tempFailure.storageGuard, 'temp-file-fsync-before-live-compare').status, 'fail');
  assert.ok(tempFailure.storageGuard.fastPathLane.blockedBy.includes('temp-file-fsync-missing'));
  assert.equal(readFixture(rootDir, tempFailurePath), 'rpp0725-base-temp-fsync-payload');

  const directoryFailurePath = 'wp-content/uploads/rpp-0725/blocked/directory-fsync.txt';
  writeFixture(rootDir, directoryFailurePath, 'rpp0725-base-directory-fsync-payload');
  const expectedDirectoryFailure = readFilesystemStorageDescriptor({ rootDir, logicalPath: directoryFailurePath });
  const directoryFailure = applyFilesystemFsyncEvidenceWrite({
    rootDir,
    logicalPath: directoryFailurePath,
    expectedResource: resourceEvidence('directory-fsync-failure', directoryFailurePath, expectedDirectoryFailure),
    expectedStorage: expectedDirectoryFailure,
    plannedContents: 'rpp0725-planned-directory-fsync-payload',
    operation: 'update',
    driver: 'rpp-0725-focused-proof',
    fsyncDirectorySync: () => {
      throw codedError('EINVAL');
    },
  });

  assert.equal(directoryFailure.applied, true);
  assert.equal(directoryFailure.fastPathLaneUpdated, false);
  assert.equal(directoryFailure.storageGuard.outcome, 'applied-fsync-incomplete');
  assert.equal(directoryFailure.storageGuard.fsyncEvidence.tempFile.status, 'passed');
  assert.equal(directoryFailure.storageGuard.fsyncEvidence.targetDirectory.status, 'failed');
  assert.equal(directoryFailure.storageGuard.fastPathLane.updated, false);
  assert.equal(gateById(directoryFailure.storageGuard, 'target-directory-fsync-after-rename').status, 'fail');
  assert.equal(gateById(directoryFailure.storageGuard, 'post-rename-storage-matches-planned').status, 'pass');
  assert.ok(directoryFailure.storageGuard.fastPathLane.blockedBy.includes('target-directory-fsync-missing'));
  assert.equal(readFixture(rootDir, directoryFailurePath), 'rpp0725-planned-directory-fsync-payload');

  for (const evidence of [stale.storageGuard, tempFailure.storageGuard, directoryFailure.storageGuard]) {
    assert.equal(evidence.fastPathLane.updated, false);
    assert.equal(evidence.fastPathLane.correctnessGatesHold, false);
    assertStorageGuardHasOnlySafeValues(evidence, rootDir);
  }
  assert.equal(filesystemTempLeakPaths(rootDir).length, 0);
});

test('RPP-0725 variant 2 projects deterministic hash-only support evidence and keeps release NO-GO', () => {
  const passOptions = smallBenchmarkOptions({
    maxDurationMs: 100_000,
    maxHeapUsedBytes: 1024 * 1024 * 1024,
  });
  const firstPass = runFilesystemFsyncEvidenceBenchmark(passOptions);
  const secondPass = runFilesystemFsyncEvidenceBenchmark(passOptions);
  const passProof = buildVariant2Proof(firstPass, secondPass);

  assert.equal(passProof.rppId, 'RPP-0725');
  assert.equal(passProof.proofId, proofId);
  assert.equal(passProof.variant, 2);
  assert.equal(passProof.status, 'passed');
  assert.equal(passProof.builtOn.rppId, 'RPP-0705');
  assert.equal(passProof.builtOn.benchmark, FILESYSTEM_FSYNC_EVIDENCE_BENCHMARK_ID);
  assert.match(passProof.builtOn.evidenceHash, /^[a-f0-9]{64}$/);
  assert.equal(passProof.storage.boundary, FILESYSTEM_FSYNC_BOUNDARY);
  assert.equal(passProof.storage.appliedFsyncCompleteWrites, 3);
  assert.equal(passProof.storage.appliedFsyncIncompleteWrites, 1);
  assert.equal(passProof.storage.staleAtWriteWrites, 1);
  assert.equal(passProof.storage.tempFsyncFailedBeforeRenameWrites, 1);
  assert.equal(passProof.fastPathLane.id, FILESYSTEM_FSYNC_FAST_PATH_LANE);
  assert.equal(passProof.fastPathLane.updates, 3);
  assert.equal(passProof.fastPathLane.blocked, 3);
  assert.equal(passProof.fastPathLane.evidenceRecordedBeforeUpdate, true);
  assert.equal(passProof.fastPathLane.updatesOnlyAfterCorrectnessGates, true);
  assert.equal(passProof.fastPathLane.unsafeUpdatesBeforeGates, 0);
  assert.equal(passProof.correctness.updatedSamplesAllGatesPassed, true);
  assert.equal(passProof.correctness.correctnessGatesBeforeThroughputClaims, true);
  assert.equal(passProof.unsafe.staleRejectedWrites, 1);
  assert.equal(passProof.unsafe.tempFsyncFailureBlockedWrites, 1);
  assert.equal(passProof.unsafe.directoryFsyncIncompleteWrites, 1);
  assert.equal(passProof.unsafe.unsafeLaneUpdates, 0);
  assert.equal(passProof.runtime.budgetStatus, 'passed');
  assert.deepEqual(passProof.gates.map((gate) => gate.status), [
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
  ]);
  assert.equal(gateById(passProof, 'deterministic-benchmark-gates').metrics.sameGateVector, true);
  assert.equal(passProof.release.supportOnly, true);
  assert.equal(passProof.release.productionBacked, false);
  assert.equal(passProof.release.productionThroughput, 'not-claimed');
  assert.equal(passProof.release.speedClaimsAllowed, false);
  assert.equal(passProof.release.finalReleaseStatus, 'NO-GO');
  assert.equal(passProof.release.integrationRecommendation, 'NO-GO');
  assert.match(passProof.evidenceHash, /^[a-f0-9]{64}$/);
  assertProjectionHasNoRawFilesystemValues(passProof);

  const failOptions = smallBenchmarkOptions({
    maxDurationMs: 100_000,
    maxHeapUsedBytes: 1,
  });
  const firstFail = runFilesystemFsyncEvidenceBenchmark(failOptions);
  const secondFail = runFilesystemFsyncEvidenceBenchmark(failOptions);
  const failProof = buildVariant2Proof(firstFail, secondFail);

  assert.equal(failProof.status, 'failed');
  assert.equal(gateById(failProof, 'fsync-evidence-before-fast-path-lane-update').status, 'pass');
  assert.equal(gateById(failProof, 'correctness-gates-before-throughput-claims').status, 'pass');
  assert.equal(gateById(failProof, 'stale-and-unsafe-cases-no-go').status, 'pass');
  assert.equal(gateById(failProof, 'deterministic-benchmark-gates').status, 'pass');
  assert.equal(gateById(failProof, 'bounded-benchmark-runtime-resources').status, 'fail');
  assert.equal(gateById(failProof, 'hash-only-public-proof').status, 'pass');
  assert.equal(gateById(failProof, 'support-only-release-no-go').status, 'pass');
  assert.equal(failProof.runtime.budgetStatus, 'failed');
  assert.equal(failProof.runtime.heapWithinBudget, false);
  assert.equal(failProof.runtime.maxHeapUsedBytes, 1);
  assert.equal(failProof.release.finalReleaseStatus, 'NO-GO');
  assert.equal(failProof.release.integrationRecommendation, 'NO-GO');
  assertProjectionHasNoRawFilesystemValues(failProof);
});

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

function smallBenchmarkOptions(overrides = {}) {
  return {
    profile: 'unit',
    now: fixedNow,
    updateFiles: 2,
    createFiles: 1,
    staleFiles: 1,
    tempFsyncFailureFiles: 1,
    directoryFsyncFailureFiles: 1,
    fileBytes: 1024,
    seed: proofId,
    ...overrides,
  };
}

function buildVariant2Proof(report, repeatedReport) {
  const evidenceSamples = report.deterministicCoverage.evidenceSamples;
  const gateVector = gateStatuses(report);
  const repeatedGateVector = gateStatuses(repeatedReport);
  const sameGateVector = JSON.stringify(gateVector) === JSON.stringify(repeatedGateVector);
  const updatedSamples = evidenceSamples.filter((evidence) => evidence.fastPathLane.updated === true);
  const blockedSamples = evidenceSamples.filter((evidence) => evidence.fastPathLane.updated === false);
  const evidenceRecordedBeforeUpdate = evidenceSamples.length > 0
    && evidenceSamples.every((evidence) => (
      objectKeyBefore(evidence, 'fsyncEvidence', 'correctnessGates')
      && objectKeyBefore(evidence, 'correctnessGates', 'fastPathLane')
      && evidence.fastPathLane.correctnessGatesEvaluatedBeforeUpdate === true
    ));
  const updatedSamplesAllGatesPassed = updatedSamples.length === report.resources.fastPathLane.updates
    && updatedSamples.every((evidence) => (
      evidence.outcome === 'applied'
      && evidence.fsyncEvidence.tempFile.status === 'passed'
      && evidence.fsyncEvidence.targetDirectory.status === 'passed'
      && evidence.correctnessGates.every((gate) => gate.status === 'pass')
      && evidence.fastPathLane.correctnessGatesHold === true
    ));
  const blockedSamplesHoldNoLaneUpdate = blockedSamples.every((evidence) => (
    evidence.fastPathLane.updated === false
    && evidence.fastPathLane.correctnessGatesHold === false
    && evidence.fastPathLane.blockedBy.length > 0
  ));
  const correctnessBeforeThroughputClaims = benchmarkGateById(
    report,
    'correctness-gates-before-fast-path-lane',
  ).status === 'pass'
    && benchmarkGateById(report, 'temp-and-directory-fsync-required-for-updates').status === 'pass'
    && benchmarkGateById(report, 'directory-fsync-failure-withholds-fast-path-lane-update').status === 'pass';
  const unsafeLaneUpdates = report.resources.fastPathLane.unsafeUpdatesBeforeGates
    + report.resources.fastPathLane.updatesWithFailedGate;
  const staleAndUnsafeNoGo = report.resources.storage.staleAtWriteWrites === report.resources.workload.staleFiles
    && report.resources.storage.tempFsyncFailedBeforeRenameWrites === report.resources.workload.tempFsyncFailureFiles
    && report.resources.storage.appliedFsyncIncompleteWrites === report.resources.workload.directoryFsyncFailureFiles
    && report.resources.storage.unsafeRenameOnStaleWrites === 0
    && report.resources.storage.unsafeRenameAfterTempFsyncFailureWrites === 0
    && unsafeLaneUpdates === 0
    && report.resources.fastPathLane.blocked === report.resources.workload.expectedFastPathLaneBlocked;
  const runtimeGate = benchmarkGateById(report, 'runtime-resource-budget');
  const supportOnlyRelease = {
    supportOnly: true,
    productionBacked: false,
    productionThroughput: 'not-claimed',
    speedClaimsAllowed: false,
    productionStorageReceipts: 'not-claimed',
    externalDurability: 'not-claimed',
    releaseVerifierCarryThrough: 'not-claimed',
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    blockers: [
      'production-storage-receipts-not-measured',
      'external-filesystem-durability-not-proven',
      'release-verifier-carry-through-not-claimed',
    ],
  };
  const gates = [
    proofGate('fsync-evidence-before-fast-path-lane-update', evidenceRecordedBeforeUpdate
      && updatedSamplesAllGatesPassed
      && blockedSamplesHoldNoLaneUpdate, {
      evidenceSamples: evidenceSamples.length,
      updatedSamples: updatedSamples.length,
      blockedSamples: blockedSamples.length,
    }),
    proofGate('correctness-gates-before-throughput-claims',
      correctnessBeforeThroughputClaims
        && report.fastPathLane.updatesOnlyAfterCorrectnessGates === true
        && supportOnlyRelease.speedClaimsAllowed === false
        && supportOnlyRelease.productionThroughput === 'not-claimed', {
        benchmarkGateIds: [
          'correctness-gates-before-fast-path-lane',
          'temp-and-directory-fsync-required-for-updates',
          'directory-fsync-failure-withholds-fast-path-lane-update',
        ],
        speedClaimsAllowed: supportOnlyRelease.speedClaimsAllowed,
        productionThroughput: supportOnlyRelease.productionThroughput,
      }),
    proofGate('stale-and-unsafe-cases-no-go', staleAndUnsafeNoGo
      && supportOnlyRelease.finalReleaseStatus === 'NO-GO', {
      staleAtWriteWrites: report.resources.storage.staleAtWriteWrites,
      tempFsyncFailedBeforeRenameWrites: report.resources.storage.tempFsyncFailedBeforeRenameWrites,
      appliedFsyncIncompleteWrites: report.resources.storage.appliedFsyncIncompleteWrites,
      unsafeRenameOnStaleWrites: report.resources.storage.unsafeRenameOnStaleWrites,
      unsafeRenameAfterTempFsyncFailureWrites: report.resources.storage.unsafeRenameAfterTempFsyncFailureWrites,
      unsafeLaneUpdates,
    }),
    proofGate('deterministic-benchmark-gates', sameGateVector, {
      sameGateVector,
      firstGateVector: gateVector,
      secondGateVector: repeatedGateVector,
    }),
    proofGate('bounded-benchmark-runtime-resources', runtimeGate.status === 'pass', runtimeGate.evidence),
    proofGate('hash-only-public-proof', report.deterministicCoverage.rawValueEvidenceLeaks === 0, {
      rawValueEvidenceLeaks: report.deterministicCoverage.rawValueEvidenceLeaks,
      evidenceSampleHashes: evidenceSamples.map((evidence) => digest(evidence)),
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
    rppId: 'RPP-0725',
    proofId,
    variant: 2,
    status: gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed',
    builtOn: {
      rppId: report.rppId,
      benchmark: report.benchmark,
      evidenceHash: digest(publicBenchmarkProjection(report)),
    },
    storage: {
      boundary: report.resources.storage.boundary,
      engine: report.resources.storage.engine,
      adapter: report.resources.storage.adapter,
      comparedFields: report.resources.storage.comparedFields,
      fsyncStrategy: report.resources.storage.fsyncStrategy,
      visibilityBoundary: report.resources.storage.visibilityBoundary,
      guardedWritesAttempted: report.resources.storage.guardedWritesAttempted,
      appliedWrites: report.resources.storage.appliedWrites,
      appliedFsyncCompleteWrites: report.resources.storage.appliedFsyncCompleteWrites,
      appliedFsyncIncompleteWrites: report.resources.storage.appliedFsyncIncompleteWrites,
      staleAtWriteWrites: report.resources.storage.staleAtWriteWrites,
      tempFsyncFailedBeforeRenameWrites: report.resources.storage.tempFsyncFailedBeforeRenameWrites,
    },
    fastPathLane: {
      id: report.fastPathLane.id,
      updatePolicy: report.resources.fastPathLane.updatePolicy,
      updates: report.fastPathLane.updates,
      blocked: report.fastPathLane.blocked,
      blockedBy: report.fastPathLane.blockedBy,
      evidenceRecordedBeforeUpdate,
      updatesOnlyAfterCorrectnessGates: report.fastPathLane.updatesOnlyAfterCorrectnessGates,
      unsafeUpdatesBeforeGates: report.resources.fastPathLane.unsafeUpdatesBeforeGates,
      updatesWithFailedGate: report.resources.fastPathLane.updatesWithFailedGate,
    },
    correctness: {
      gateIds: FILESYSTEM_FSYNC_CORRECTNESS_GATE_IDS,
      updatedSamplesAllGatesPassed,
      blockedSamplesHoldNoLaneUpdate,
      correctnessGatesBeforeThroughputClaims: correctnessBeforeThroughputClaims
        && supportOnlyRelease.speedClaimsAllowed === false,
      benchmarkGateVector: gateVector,
    },
    unsafe: {
      staleRejectedWrites: report.resources.storage.staleAtWriteWrites,
      tempFsyncFailureBlockedWrites: report.resources.storage.tempFsyncFailedBeforeRenameWrites,
      directoryFsyncIncompleteWrites: report.resources.storage.appliedFsyncIncompleteWrites,
      unsafeRenameOnStaleWrites: report.resources.storage.unsafeRenameOnStaleWrites,
      unsafeRenameAfterTempFsyncFailureWrites: report.resources.storage.unsafeRenameAfterTempFsyncFailureWrites,
      unsafeLaneUpdates,
    },
    runtime: {
      budgetStatus: runtimeGate.status === 'pass' ? 'passed' : 'failed',
      profile: report.profile,
      durationMs: report.runtime.durationMs,
      maxDurationMs: report.runtime.budgets.maxDurationMs,
      durationWithinBudget: report.runtime.durationMs <= report.runtime.budgets.maxDurationMs,
      heapUsedBytes: report.resources.process.heapUsedBytes,
      maxHeapUsedBytes: report.runtime.budgets.maxHeapUsedBytes,
      heapWithinBudget: report.resources.process.heapUsedBytes <= report.runtime.budgets.maxHeapUsedBytes,
    },
    gates,
    release: supportOnlyRelease,
    redaction: {
      mode: 'hash-only-public-proof',
      rawValueEvidenceLeaks: report.deterministicCoverage.rawValueEvidenceLeaks,
      evidenceSampleHashes: evidenceSamples.map((evidence) => digest(evidence)),
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
    evidenceSampleHashes: report.deterministicCoverage.evidenceSamples.map((evidence) => digest(evidence)),
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

function rawFilesystemTokens(rootDir = null) {
  return [
    'rpp0725-base-lane-payload',
    'rpp0725-planned-lane-payload',
    'rpp0725-base-stale-payload',
    'rpp0725-planned-stale-payload',
    'rpp0725-drift-stale-payload',
    'rpp0725-base-temp-fsync-payload',
    'rpp0725-planned-temp-fsync-payload',
    'rpp0725-base-directory-fsync-payload',
    'rpp0725-planned-directory-fsync-payload',
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
