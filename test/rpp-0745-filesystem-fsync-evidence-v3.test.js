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

const proofId = 'rpp-0745-filesystem-fsync-evidence-v3';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');

test('RPP-0745 variant 3 generated storage matrix updates fast-path lane only after gates hold', () => {
  const rootDir = createFilesystemFsyncTempRoot('reprint-rpp-0745-matrix-');
  const scenarios = generatedStorageScenarios();
  const results = [];

  for (const scenario of scenarios) {
    const logicalPath = `wp-content/uploads/rpp-0745/generated/${scenario.id}.txt`;
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
      driver: 'rpp-0745-generated-proof',
      afterTempFsync: scenario.afterTempFsync,
      fsyncFileSync: scenario.fsyncFileSync,
      fsyncDirectorySync: scenario.fsyncDirectorySync,
    });

    results.push({ scenario, logicalPath, result });
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

    const correctnessGatesHold = result.storageGuard.correctnessGates.every((gate) => gate.status === 'pass');
    assert.equal(result.storageGuard.fastPathLane.correctnessGatesHold, correctnessGatesHold, scenario.id);
    assert.equal(
      result.storageGuard.fastPathLane.updated,
      result.storageGuard.outcome === 'applied' && correctnessGatesHold,
      scenario.id,
    );

    if (scenario.expected.fastPathLaneUpdated) {
      assert.equal(correctnessGatesHold, true, scenario.id);
      assert.deepEqual(result.storageGuard.fastPathLane.blockedBy, [], scenario.id);
      assert.equal(readFixture(rootDir, logicalPath), scenario.plannedContents, scenario.id);
    } else {
      assert.equal(correctnessGatesHold, false, scenario.id);
      assert.ok(result.storageGuard.fastPathLane.blockedBy.includes(scenario.expected.blocker), scenario.id);
    }

    assertStorageGuardHasOnlySafeValues(result.storageGuard, rootDir);
  }

  const byId = Object.fromEntries(results.map(({ scenario, result }) => [scenario.id, result]));
  assert.equal(byId['stale-update'].storageGuard.renameAttempted, false);
  assert.equal(byId['stale-update'].storageGuard.tempRemovedOnBlockedWrite, true);
  assert.equal(gateById(byId['stale-update'].storageGuard, 'live-storage-precondition-match').status, 'fail');
  assert.equal(readFixture(rootDir, 'wp-content/uploads/rpp-0745/generated/stale-update.txt'), 'rpp0745-drift-stale-payload');

  assert.equal(byId['temp-fsync-failure'].storageGuard.renameAttempted, false);
  assert.equal(byId['temp-fsync-failure'].storageGuard.fsyncEvidence.tempFile.status, 'failed');
  assert.equal(byId['temp-fsync-failure'].storageGuard.fsyncEvidence.targetDirectory.status, 'not-attempted');
  assert.equal(gateById(byId['temp-fsync-failure'].storageGuard, 'temp-file-fsync-before-live-compare').status, 'fail');
  assert.equal(
    readFixture(rootDir, 'wp-content/uploads/rpp-0745/generated/temp-fsync-failure.txt'),
    'rpp0745-base-temp-fsync-payload',
  );

  assert.equal(byId['directory-fsync-failure'].storageGuard.fsyncEvidence.tempFile.status, 'passed');
  assert.equal(byId['directory-fsync-failure'].storageGuard.fsyncEvidence.targetDirectory.status, 'failed');
  assert.equal(gateById(byId['directory-fsync-failure'].storageGuard, 'target-directory-fsync-after-rename').status, 'fail');
  assert.equal(gateById(byId['directory-fsync-failure'].storageGuard, 'post-rename-storage-matches-planned').status, 'pass');
  assert.equal(
    readFixture(rootDir, 'wp-content/uploads/rpp-0745/generated/directory-fsync-failure.txt'),
    'rpp0745-planned-directory-fsync-payload',
  );

  assert.equal(filesystemTempLeakPaths(rootDir).length, 0);
});

test('RPP-0745 variant 3 projects local support-only storage and performance proof evidence', () => {
  const passOptions = generatedBenchmarkOptions({
    maxDurationMs: 100_000,
    maxHeapUsedBytes: 1024 * 1024 * 1024,
  });
  const firstPass = runFilesystemFsyncEvidenceBenchmark(passOptions);
  const secondPass = runFilesystemFsyncEvidenceBenchmark(passOptions);
  const passProof = buildVariant3Proof(firstPass, secondPass);

  assert.equal(passProof.rppId, 'RPP-0745');
  assert.equal(passProof.proofId, proofId);
  assert.equal(passProof.variant, 3);
  assert.equal(passProof.status, 'passed');
  assert.equal(passProof.builtOn.rppId, 'RPP-0705');
  assert.equal(passProof.builtOn.benchmark, FILESYSTEM_FSYNC_EVIDENCE_BENCHMARK_ID);
  assert.match(passProof.builtOn.evidenceHash, /^[a-f0-9]{64}$/);
  assert.equal(passProof.storage.boundary, FILESYSTEM_FSYNC_BOUNDARY);
  assert.equal(passProof.storage.guardedWritesAttempted, 9);
  assert.equal(passProof.storage.appliedFsyncCompleteWrites, 5);
  assert.equal(passProof.storage.appliedFsyncIncompleteWrites, 1);
  assert.equal(passProof.storage.staleAtWriteWrites, 2);
  assert.equal(passProof.storage.tempFsyncFailedBeforeRenameWrites, 1);
  assert.equal(passProof.fastPathLane.id, FILESYSTEM_FSYNC_FAST_PATH_LANE);
  assert.equal(passProof.fastPathLane.updates, 5);
  assert.equal(passProof.fastPathLane.blocked, 4);
  assert.deepEqual(passProof.fastPathLane.blockedBy, {
    'live-storage-mismatch': 2,
    'target-directory-fsync-missing': 1,
    'temp-file-fsync-missing': 1,
  });
  assert.equal(passProof.fastPathLane.updatesOnlyAfterCorrectnessGates, true);
  assert.equal(passProof.fastPathLane.updatesOnlyWhenCorrectnessGatesHold, true);
  assert.equal(passProof.fastPathLane.unsafeUpdatesBeforeGates, 0);
  assert.equal(passProof.fastPathLane.updatesWithFailedGate, 0);
  assert.equal(passProof.generatedCoverage.outcomes.applied, 5);
  assert.equal(passProof.generatedCoverage.outcomes['applied-fsync-incomplete'], 1);
  assert.equal(passProof.generatedCoverage.outcomes['stale-at-write'], 2);
  assert.equal(passProof.generatedCoverage.outcomes['fsync-failed-before-rename'], 1);
  assert.equal(passProof.correctness.updatedSamplesAllGatesPassed, true);
  assert.equal(passProof.correctness.blockedSamplesHoldNoLaneUpdate, true);
  assert.equal(passProof.correctness.correctnessGatesBeforePerformanceClaims, true);
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
  assert.equal(gateById(passProof, 'deterministic-generated-proof').metrics.sameGateVector, true);
  assert.equal(passProof.release.supportOnly, true);
  assert.equal(passProof.release.productionBacked, false);
  assert.equal(passProof.release.productionStorageReceipts, 'not-claimed');
  assert.equal(passProof.release.speedClaimsAllowed, false);
  assert.equal(passProof.release.finalReleaseStatus, 'NO-GO');
  assert.equal(passProof.release.integrationRecommendation, 'NO-GO');
  assert.match(passProof.evidenceHash, /^[a-f0-9]{64}$/);
  assertProjectionHasNoRawFilesystemValues(passProof);

  const failOptions = generatedBenchmarkOptions({
    maxDurationMs: 100_000,
    maxHeapUsedBytes: 1,
  });
  const firstFail = runFilesystemFsyncEvidenceBenchmark(failOptions);
  const secondFail = runFilesystemFsyncEvidenceBenchmark(failOptions);
  const failProof = buildVariant3Proof(firstFail, secondFail);

  assert.equal(failProof.status, 'failed');
  assert.equal(gateById(failProof, 'generated-storage-outcomes-covered').status, 'pass');
  assert.equal(gateById(failProof, 'fast-path-lane-after-correctness-gates-hold').status, 'pass');
  assert.equal(gateById(failProof, 'benchmark-correctness-gates-retained').status, 'pass');
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

function generatedStorageScenarios() {
  return [
    {
      id: 'matching-update',
      operation: 'update',
      initialContents: 'rpp0745-base-update-payload',
      plannedContents: 'rpp0745-planned-update-payload',
      expected: {
        applied: true,
        fastPathLaneUpdated: true,
        outcome: 'applied',
        blocker: null,
      },
    },
    {
      id: 'matching-create',
      operation: 'create',
      initialContents: null,
      plannedContents: 'rpp0745-planned-create-payload',
      expected: {
        applied: true,
        fastPathLaneUpdated: true,
        outcome: 'applied',
        blocker: null,
      },
    },
    {
      id: 'stale-update',
      operation: 'update',
      initialContents: 'rpp0745-base-stale-payload',
      plannedContents: 'rpp0745-planned-stale-payload',
      afterTempFsync: ({ absolutePath }) => {
        fs.writeFileSync(absolutePath, 'rpp0745-drift-stale-payload');
      },
      expected: {
        applied: false,
        fastPathLaneUpdated: false,
        outcome: 'stale-at-write',
        blocker: 'live-storage-mismatch',
      },
    },
    {
      id: 'temp-fsync-failure',
      operation: 'update',
      initialContents: 'rpp0745-base-temp-fsync-payload',
      plannedContents: 'rpp0745-planned-temp-fsync-payload',
      fsyncFileSync: () => {
        throw codedError('EIO');
      },
      expected: {
        applied: false,
        fastPathLaneUpdated: false,
        outcome: 'fsync-failed-before-rename',
        blocker: 'temp-file-fsync-missing',
      },
    },
    {
      id: 'directory-fsync-failure',
      operation: 'update',
      initialContents: 'rpp0745-base-directory-fsync-payload',
      plannedContents: 'rpp0745-planned-directory-fsync-payload',
      fsyncDirectorySync: () => {
        throw codedError('EINVAL');
      },
      expected: {
        applied: true,
        fastPathLaneUpdated: false,
        outcome: 'applied-fsync-incomplete',
        blocker: 'target-directory-fsync-missing',
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

function generatedBenchmarkOptions(overrides = {}) {
  return {
    profile: 'unit',
    now: fixedNow,
    updateFiles: 3,
    createFiles: 2,
    staleFiles: 2,
    tempFsyncFailureFiles: 1,
    directoryFsyncFailureFiles: 1,
    fileBytes: 1024,
    seed: proofId,
    ...overrides,
  };
}

function buildVariant3Proof(report, repeatedReport) {
  const evidenceSamples = report.deterministicCoverage.evidenceSamples;
  const gateVector = gateStatuses(report);
  const repeatedGateVector = gateStatuses(repeatedReport);
  const sameGateVector = JSON.stringify(gateVector) === JSON.stringify(repeatedGateVector);
  const updatedSamples = evidenceSamples.filter((evidence) => evidence.fastPathLane.updated === true);
  const blockedSamples = evidenceSamples.filter((evidence) => evidence.fastPathLane.updated === false);
  const outcomes = countBy(evidenceSamples, (evidence) => evidence.outcome);
  const updatedSamplesAllGatesPassed = updatedSamples.length === report.resources.fastPathLane.updates
    && updatedSamples.every((evidence) => (
      evidence.outcome === 'applied'
      && evidence.fsyncEvidence.tempFile.status === 'passed'
      && evidence.fsyncEvidence.targetDirectory.status === 'passed'
      && evidence.correctnessGates.every((gate) => gate.status === 'pass')
      && evidence.fastPathLane.correctnessGatesHold === true
    ));
  const blockedSamplesHoldNoLaneUpdate = blockedSamples.length === report.resources.fastPathLane.blocked
    && blockedSamples.every((evidence) => (
      evidence.fastPathLane.updated === false
      && evidence.fastPathLane.correctnessGatesHold === false
      && evidence.fastPathLane.blockedBy.length > 0
    ));
  const updatesOnlyWhenCorrectnessGatesHold = evidenceSamples.every((evidence) => {
    const correctnessGatesHold = evidence.correctnessGates.every((gate) => gate.status === 'pass');
    return evidence.fastPathLane.updated === (evidence.outcome === 'applied' && correctnessGatesHold);
  });
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
  const gates = [
    proofGate('generated-storage-outcomes-covered', generatedStorageOutcomesCovered, {
      expectedWrites: report.resources.workload.expectedWrites,
      outcomes,
      unsafeRenameOnStaleWrites: report.resources.storage.unsafeRenameOnStaleWrites,
      unsafeRenameAfterTempFsyncFailureWrites: report.resources.storage.unsafeRenameAfterTempFsyncFailureWrites,
    }),
    proofGate('fast-path-lane-after-correctness-gates-hold',
      updatedSamplesAllGatesPassed
        && blockedSamplesHoldNoLaneUpdate
        && updatesOnlyWhenCorrectnessGatesHold
        && unsafeLaneUpdates === 0, {
        updatedSamples: updatedSamples.length,
        blockedSamples: blockedSamples.length,
        unsafeLaneUpdates,
        updatesOnlyWhenCorrectnessGatesHold,
      }),
    proofGate('benchmark-correctness-gates-retained', correctnessGatesBeforePerformanceClaims, {
      benchmarkGateVector: gateVector,
      productionThroughput: supportOnlyRelease.productionThroughput,
      speedClaimsAllowed: supportOnlyRelease.speedClaimsAllowed,
    }),
    proofGate('deterministic-generated-proof', sameGateVector, {
      sameGateVector,
      firstGateVector: gateVector,
      secondGateVector: repeatedGateVector,
    }),
    proofGate('local-performance-budget', runtimeGate.status === 'pass', runtimeGate.evidence),
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
    rppId: 'RPP-0745',
    proofId,
    variant: 3,
    status: gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed',
    builtOn: {
      rppId: report.rppId,
      benchmark: report.benchmark,
      evidenceHash: digest(publicBenchmarkProjection(report)),
    },
    generatedCoverage: {
      source: 'RPP-0705 local filesystem fsync benchmark',
      workload: report.resources.workload,
      outcomes,
      evidenceSamples: evidenceSamples.length,
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
      unsafeRenameOnStaleWrites: report.resources.storage.unsafeRenameOnStaleWrites,
      unsafeRenameAfterTempFsyncFailureWrites: report.resources.storage.unsafeRenameAfterTempFsyncFailureWrites,
    },
    fastPathLane: {
      id: report.fastPathLane.id,
      updatePolicy: report.resources.fastPathLane.updatePolicy,
      updates: report.fastPathLane.updates,
      blocked: report.fastPathLane.blocked,
      blockedBy: report.fastPathLane.blockedBy,
      updatesOnlyAfterCorrectnessGates: report.fastPathLane.updatesOnlyAfterCorrectnessGates,
      updatesOnlyWhenCorrectnessGatesHold,
      unsafeUpdatesBeforeGates: report.resources.fastPathLane.unsafeUpdatesBeforeGates,
      updatesWithFailedGate: report.resources.fastPathLane.updatesWithFailedGate,
    },
    correctness: {
      gateIds: FILESYSTEM_FSYNC_CORRECTNESS_GATE_IDS,
      updatedSamplesAllGatesPassed,
      blockedSamplesHoldNoLaneUpdate,
      correctnessGatesBeforePerformanceClaims,
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

function countBy(values, keyForValue) {
  return values.reduce((counts, value) => {
    const key = keyForValue(value);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
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
    'rpp0745-base-update-payload',
    'rpp0745-planned-update-payload',
    'rpp0745-planned-create-payload',
    'rpp0745-base-stale-payload',
    'rpp0745-planned-stale-payload',
    'rpp0745-drift-stale-payload',
    'rpp0745-base-temp-fsync-payload',
    'rpp0745-planned-temp-fsync-payload',
    'rpp0745-base-directory-fsync-payload',
    'rpp0745-planned-directory-fsync-payload',
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
