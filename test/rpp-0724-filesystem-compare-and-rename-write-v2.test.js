import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  FILESYSTEM_COMPARE_RENAME_BOUNDARY,
  FILESYSTEM_COMPARE_RENAME_TEMP_PREFIX,
  applyFilesystemCompareRenameWrite,
  createFilesystemCompareRenameTempRoot,
  ensureFilesystemDirectoryUsable,
  filesystemStorageHash,
  filesystemTempLeakPaths,
  readFilesystemStorageDescriptor,
} from '../src/filesystem-compare-rename-write.js';
import { digest } from '../src/stable-json.js';
import {
  FILESYSTEM_COMPARE_RENAME_BENCHMARK_ID,
  runFilesystemCompareRenameBenchmark,
} from '../scripts/bench/filesystem-compare-rename-write.js';

const proofId = 'rpp-0724-filesystem-compare-and-rename-write-v2';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');

test('RPP-0724 variant 2 applies matching filesystem writes only after compare-before-rename', () => {
  const rootDir = createFilesystemCompareRenameTempRoot('reprint-rpp-0724-atomic-');
  const updatePath = 'wp-content/uploads/rpp-0724/atomic/update.txt';
  const createPath = 'wp-content/uploads/rpp-0724/atomic/create.txt';
  writeFixture(rootDir, updatePath, 'rpp0724-base-update-payload');

  const expectedUpdate = readFilesystemStorageDescriptor({ rootDir, logicalPath: updatePath });
  let updateCallbackObserved = false;
  const update = applyFilesystemCompareRenameWrite({
    rootDir,
    logicalPath: updatePath,
    expectedResource: resourceEvidence('update', updatePath, expectedUpdate),
    expectedStorage: expectedUpdate,
    plannedContents: 'rpp0724-planned-update-payload',
    operation: 'update',
    driver: 'rpp-0724-focused-proof',
    afterTempWrite: ({ absolutePath }) => {
      updateCallbackObserved = true;
      assert.equal(readFixture(rootDir, updatePath), 'rpp0724-base-update-payload');
      assert.equal(tempNamesBesideTarget(absolutePath).length, 1);
    },
  });

  assert.equal(updateCallbackObserved, true);
  assert.equal(update.applied, true);
  assert.equal(readFixture(rootDir, updatePath), 'rpp0724-planned-update-payload');
  assertStorageGuardApplied(update.storageGuard, 'update');
  assert.deepEqual(update.storageGuard.steps, [
    'write-temp-same-directory',
    'read-live-storage',
    'compare-expected-storage-hash',
    'rename-temp-to-target',
  ]);

  const expectedCreate = readFilesystemStorageDescriptor({ rootDir, logicalPath: createPath });
  let createTargetVisibleBeforeRename = null;
  const create = applyFilesystemCompareRenameWrite({
    rootDir,
    logicalPath: createPath,
    expectedResource: resourceEvidence('create', createPath, expectedCreate),
    expectedStorage: expectedCreate,
    plannedContents: Buffer.from('rpp0724-planned-create-payload'),
    operation: 'create',
    driver: 'rpp-0724-focused-proof',
    afterTempWrite: ({ absolutePath }) => {
      createTargetVisibleBeforeRename = fs.existsSync(absolutePath);
      assert.equal(tempNamesBesideTarget(absolutePath).length, 1);
    },
  });

  assert.equal(createTargetVisibleBeforeRename, false);
  assert.equal(create.applied, true);
  assert.equal(readFixture(rootDir, createPath), 'rpp0724-planned-create-payload');
  assertStorageGuardApplied(create.storageGuard, 'create');
  assert.equal(filesystemTempLeakPaths(rootDir).length, 0);

  assertStorageGuardHasNoRawValues(update.storageGuard, rootDir);
  assertStorageGuardHasNoRawValues(create.storageGuard, rootDir);
});

test('RPP-0724 variant 2 rejects stale filesystem state without renaming the temp file', () => {
  const rootDir = createFilesystemCompareRenameTempRoot('reprint-rpp-0724-stale-');
  const logicalPath = 'wp-content/uploads/rpp-0724/stale/reject.txt';
  writeFixture(rootDir, logicalPath, 'rpp0724-base-stale-payload');
  const expectedStorage = readFilesystemStorageDescriptor({ rootDir, logicalPath });

  let staleCallbackObserved = false;
  const stale = applyFilesystemCompareRenameWrite({
    rootDir,
    logicalPath,
    expectedResource: resourceEvidence('stale', logicalPath, expectedStorage),
    expectedStorage,
    plannedContents: 'rpp0724-planned-stale-payload',
    operation: 'update',
    driver: 'rpp-0724-focused-proof',
    afterTempWrite: ({ absolutePath }) => {
      staleCallbackObserved = true;
      assert.equal(readFixture(rootDir, logicalPath), 'rpp0724-base-stale-payload');
      assert.equal(tempNamesBesideTarget(absolutePath).length, 1);
      fs.writeFileSync(absolutePath, 'rpp0724-drift-stale-payload');
    },
  });

  assert.equal(staleCallbackObserved, true);
  assert.equal(stale.applied, false);
  assert.equal(readFixture(rootDir, logicalPath), 'rpp0724-drift-stale-payload');
  assert.equal(stale.storageGuard.boundary, FILESYSTEM_COMPARE_RENAME_BOUNDARY);
  assert.equal(stale.storageGuard.outcome, 'stale-at-write');
  assert.equal(stale.storageGuard.renameAttempted, false);
  assert.equal(stale.storageGuard.tempRemovedOnStale, true);
  assert.equal(stale.storageGuard.sameDirectoryTemp, true);
  assert.equal(stale.storageGuard.compareBeforeRename, true);
  assert.equal(stale.storageGuard.atomicVisibilityBoundary, 'same-directory-rename');
  assert.deepEqual(stale.storageGuard.steps, [
    'write-temp-same-directory',
    'read-live-storage',
    'compare-expected-storage-hash',
  ]);
  assert.notEqual(stale.storageGuard.actualStorageHash, stale.storageGuard.expectedStorageHash);
  assert.equal(
    stale.storageGuard.actualStorageHash,
    filesystemStorageHash(readFilesystemStorageDescriptor({ rootDir, logicalPath })),
  );
  assert.equal(filesystemTempLeakPaths(rootDir).length, 0);
  assertStorageGuardHasNoRawValues(stale.storageGuard, rootDir);
});

test('RPP-0724 variant 2 keeps benchmark gates deterministic and release posture support-only NO-GO', () => {
  const passOptions = smallBenchmarkOptions({
    maxDurationMs: 100_000,
    maxHeapUsedBytes: 1024 * 1024 * 1024,
  });
  const firstPass = runFilesystemCompareRenameBenchmark(passOptions);
  const secondPass = runFilesystemCompareRenameBenchmark(passOptions);
  const passProof = buildVariant2Proof(firstPass, secondPass);

  assert.equal(passProof.rppId, 'RPP-0724');
  assert.equal(passProof.proofId, proofId);
  assert.equal(passProof.variant, 2);
  assert.equal(passProof.status, 'passed');
  assert.equal(passProof.builtOn.rppId, 'RPP-0704');
  assert.equal(passProof.builtOn.benchmark, FILESYSTEM_COMPARE_RENAME_BENCHMARK_ID);
  assert.match(passProof.builtOn.evidenceHash, /^[a-f0-9]{64}$/);
  assert.equal(passProof.storage.boundary, FILESYSTEM_COMPARE_RENAME_BOUNDARY);
  assert.equal(passProof.storage.guardWritesAttempted, 4);
  assert.equal(passProof.storage.appliedWrites, 3);
  assert.equal(passProof.stale.rejectedWrites, 1);
  assert.equal(passProof.stale.unsafeRenameOnStaleWrites, 0);
  assert.equal(passProof.stale.driftPreservedWrites, 1);
  assert.equal(passProof.atomicity.sameDirectoryTemp, true);
  assert.equal(passProof.atomicity.compareBeforeRename, true);
  assert.equal(passProof.atomicity.renameVisibilityBoundary, 'same-directory-rename');
  assert.equal(passProof.runtime.budgetStatus, 'passed');
  assert.deepEqual(passProof.gates.map((gate) => gate.status), [
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
  assert.equal(passProof.release.finalReleaseStatus, 'NO-GO');
  assert.equal(passProof.release.integrationRecommendation, 'NO-GO');
  assert.match(passProof.evidenceHash, /^[a-f0-9]{64}$/);
  assertProjectionHasNoRawFilesystemValues(passProof);

  const failOptions = smallBenchmarkOptions({
    maxDurationMs: 100_000,
    maxHeapUsedBytes: 1,
  });
  const firstFail = runFilesystemCompareRenameBenchmark(failOptions);
  const secondFail = runFilesystemCompareRenameBenchmark(failOptions);
  const failProof = buildVariant2Proof(firstFail, secondFail);

  assert.equal(failProof.status, 'failed');
  assert.deepEqual(gateStatuses(firstFail), gateStatuses(secondFail));
  assert.equal(gateById(failProof, 'stale-state-rejection').status, 'pass');
  assert.equal(gateById(failProof, 'atomic-compare-before-rename').status, 'pass');
  assert.equal(gateById(failProof, 'deterministic-benchmark-gates').status, 'pass');
  assert.equal(gateById(failProof, 'bounded-benchmark-runtime-resources').status, 'fail');
  assert.equal(failProof.runtime.budgetStatus, 'failed');
  assert.equal(failProof.runtime.heapWithinBudget, false);
  assert.equal(failProof.runtime.maxHeapUsedBytes, 1);
  assert.equal(failProof.release.finalReleaseStatus, 'NO-GO');
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

function tempNamesBesideTarget(absolutePath) {
  return fs.readdirSync(path.dirname(absolutePath))
    .filter((entry) => entry.startsWith(FILESYSTEM_COMPARE_RENAME_TEMP_PREFIX))
    .sort();
}

function resourceEvidence(kind, logicalPath, expectedStorage) {
  return {
    kind,
    logicalPathHash: digest(logicalPath),
    expectedStorageHash: filesystemStorageHash(expectedStorage),
  };
}

function assertStorageGuardApplied(evidence, operation) {
  assert.equal(evidence.boundary, FILESYSTEM_COMPARE_RENAME_BOUNDARY);
  assert.equal(evidence.operation, operation);
  assert.equal(evidence.outcome, 'applied');
  assert.equal(evidence.sameDirectoryTemp, true);
  assert.equal(evidence.compareBeforeRename, true);
  assert.equal(evidence.renameAttempted, true);
  assert.equal(evidence.atomicVisibilityBoundary, 'same-directory-rename');
  assert.deepEqual(evidence.comparedFields, ['exists', 'type', 'sizeBytes', 'contentHash']);
  assert.match(evidence.physicalPathHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.expectedResourceHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.expectedStorageHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.actualStorageHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.plannedStorageHash, /^[a-f0-9]{64}$/);
}

function assertStorageGuardHasNoRawValues(evidence, rootDir) {
  const serialized = JSON.stringify(evidence);
  for (const token of rawFilesystemTokens(rootDir).filter((value) => value !== 'wp-content/uploads')) {
    assert.equal(serialized.includes(token), false, `storage guard leaked raw token ${token}`);
  }
}

function smallBenchmarkOptions(overrides = {}) {
  return {
    profile: 'unit',
    now: fixedNow,
    updateFiles: 2,
    createFiles: 1,
    staleFiles: 1,
    fileBytes: 1024,
    seed: proofId,
    ...overrides,
  };
}

function buildVariant2Proof(report, repeatedReport) {
  const staleGatePassed = report.resources.storage.staleAtWriteWrites === report.resources.workload.staleFiles
    && report.resources.storage.unsafeRenameOnStaleWrites === 0
    && report.deterministicCoverage.writes.stalePreserved === report.resources.workload.staleFiles;
  const atomicGatePassed = report.deterministicCoverage.evidenceSamples.length > 0
    && report.deterministicCoverage.evidenceSamples.every((evidence) => (
      evidence.boundary === FILESYSTEM_COMPARE_RENAME_BOUNDARY
      && evidence.sameDirectoryTemp === true
      && evidence.compareBeforeRename === true
      && evidence.atomicVisibilityBoundary === 'same-directory-rename'
    ));
  const gateVector = gateStatuses(report);
  const repeatedGateVector = gateStatuses(repeatedReport);
  const sameGateVector = JSON.stringify(gateVector) === JSON.stringify(repeatedGateVector);
  const runtimeGate = benchmarkGateById(report, 'large-site-runtime-budget');
  const supportOnlyRelease = {
    supportOnly: true,
    productionBacked: false,
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
    proofGate('stale-state-rejection', staleGatePassed, {
      staleAtWriteWrites: report.resources.storage.staleAtWriteWrites,
      driftPreservedWrites: report.deterministicCoverage.writes.stalePreserved,
      unsafeRenameOnStaleWrites: report.resources.storage.unsafeRenameOnStaleWrites,
    }),
    proofGate('atomic-compare-before-rename', atomicGatePassed, {
      evidenceSamples: report.deterministicCoverage.evidenceSamples.length,
      tempPlacement: report.resources.storage.tempPlacement,
      visibilityBoundary: report.resources.storage.visibilityBoundary,
    }),
    proofGate('deterministic-benchmark-gates', sameGateVector, {
      sameGateVector,
      firstGateVector: gateVector,
      secondGateVector: repeatedGateVector,
    }),
    proofGate('bounded-benchmark-runtime-resources', runtimeGate.status === 'pass', runtimeGate.evidence),
    proofGate('hash-only-evidence', report.deterministicCoverage.rawValueEvidenceLeaks === 0, {
      rawValueEvidenceLeaks: report.deterministicCoverage.rawValueEvidenceLeaks,
      evidenceSampleHashes: report.deterministicCoverage.evidenceSamples.map((evidence) => digest(evidence)),
    }),
    proofGate('support-only-release-posture', supportOnlyRelease.finalReleaseStatus === 'NO-GO'
      && supportOnlyRelease.supportOnly === true
      && supportOnlyRelease.productionBacked === false
      && supportOnlyRelease.integrationRecommendation === 'NO-GO', {
      finalReleaseStatus: supportOnlyRelease.finalReleaseStatus,
      productionBacked: supportOnlyRelease.productionBacked,
      integrationRecommendation: supportOnlyRelease.integrationRecommendation,
    }),
  ];
  const runtimeWithinBudget = runtimeGate.status === 'pass';
  const publicEvidence = {
    rppId: 'RPP-0724',
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
      guardWritesAttempted: report.resources.storage.guardedWritesAttempted,
      appliedWrites: report.resources.storage.appliedWrites,
    },
    stale: {
      rejectedWrites: report.resources.storage.staleAtWriteWrites,
      driftPreservedWrites: report.deterministicCoverage.writes.stalePreserved,
      unsafeRenameOnStaleWrites: report.resources.storage.unsafeRenameOnStaleWrites,
    },
    atomicity: {
      sameDirectoryTemp: report.resources.storage.tempPlacement === 'same-directory',
      compareBeforeRename: atomicGatePassed,
      renameVisibilityBoundary: 'same-directory-rename',
      tempLeaks: report.resources.tempLeaks,
    },
    runtime: {
      budgetStatus: runtimeWithinBudget ? 'passed' : 'failed',
      profile: report.profile,
      durationMs: report.runtime.durationMs,
      maxDurationMs: report.runtime.budgets.maxDurationMs,
      durationWithinBudget: report.runtime.durationMs <= report.runtime.budgets.maxDurationMs,
      heapUsedBytes: report.resources.process.heapUsedBytes,
      maxHeapUsedBytes: report.runtime.budgets.maxHeapUsedBytes,
      heapWithinBudget: report.resources.process.heapUsedBytes <= report.runtime.budgets.maxHeapUsedBytes,
    },
    benchmarkGates: gateVector,
    gates,
    release: supportOnlyRelease,
    redaction: {
      mode: 'hash-only-public-proof',
      rawValueEvidenceLeaks: report.deterministicCoverage.rawValueEvidenceLeaks,
      evidenceSampleHashes: report.deterministicCoverage.evidenceSamples.map((evidence) => digest(evidence)),
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

function gateById(proof, id) {
  const gate = proof.gates.find((candidate) => candidate.id === id);
  assert.ok(gate, `missing proof gate ${id}`);
  return gate;
}

function assertProjectionHasNoRawFilesystemValues(proof) {
  const serialized = JSON.stringify(proof);
  for (const token of rawFilesystemTokens()) {
    assert.equal(serialized.includes(token), false, `proof leaked raw token ${token}`);
  }
}

function rawFilesystemTokens(rootDir = null) {
  return [
    'rpp0724-base-update-payload',
    'rpp0724-planned-update-payload',
    'rpp0724-planned-create-payload',
    'rpp0724-base-stale-payload',
    'rpp0724-planned-stale-payload',
    'rpp0724-drift-stale-payload',
    'fs-base-payload',
    'fs-planned-payload',
    'fs-drift-payload',
    'filesystem raw fixture',
    'wp-content/uploads',
    FILESYSTEM_COMPARE_RENAME_TEMP_PREFIX,
    rootDir,
  ].filter(Boolean);
}
