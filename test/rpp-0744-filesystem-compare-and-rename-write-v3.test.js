import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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

const proofId = 'rpp-0744-filesystem-compare-and-rename-write-v3';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const largeSiteExpectedWrites = 160;
const largeSiteExpectedAppliedWrites = 128;
const largeSiteExpectedStaleWrites = 32;
const largeSiteFileBytes = 256 * 1024;
const largeSiteMaxDurationMs = 12_000;
const largeSiteMaxHeapUsedBytes = 256 * 1024 * 1024;

test('RPP-0744 variant 3 generated filesystem writes preserve compare-before-rename behavior', () => {
  const cases = generatedWriteCases();
  const outcomes = {
    attempted: 0,
    applied: 0,
    staleAtWrite: 0,
    updatesApplied: 0,
    createsApplied: 0,
    stalePreserved: 0,
    unsafeRenameOnStale: 0,
  };

  for (const writeCase of cases) {
    const rootDir = createFilesystemCompareRenameTempRoot(`reprint-rpp-0744-${writeCase.kind}-`);
    if (writeCase.existing) {
      writeFixture(rootDir, writeCase.logicalPath, writeCase.existing);
    }
    const expectedStorage = readFilesystemStorageDescriptor({ rootDir, logicalPath: writeCase.logicalPath });
    let targetStateObservedBeforeRename = false;

    const result = applyFilesystemCompareRenameWrite({
      rootDir,
      logicalPath: writeCase.logicalPath,
      expectedResource: resourceEvidence(writeCase, expectedStorage),
      expectedStorage,
      plannedContents: writeCase.planned,
      operation: writeCase.operation,
      driver: 'rpp-0744-generated-proof',
      afterTempWrite: ({ absolutePath }) => {
        assert.equal(tempNamesBesideTarget(absolutePath).length, 1);
        if (writeCase.kind === 'create') {
          targetStateObservedBeforeRename = fs.existsSync(absolutePath) === false;
        } else {
          targetStateObservedBeforeRename = readFixture(rootDir, writeCase.logicalPath)
            .equals(writeCase.existing);
        }
        if (writeCase.kind === 'stale') {
          fs.writeFileSync(absolutePath, writeCase.drift);
        }
      },
    });

    outcomes.attempted += 1;
    assert.equal(targetStateObservedBeforeRename, true);

    if (writeCase.kind === 'stale') {
      assert.equal(result.applied, false);
      assert.equal(readFixture(rootDir, writeCase.logicalPath).equals(writeCase.drift), true);
      assertStorageGuardRejectedStale(result.storageGuard, writeCase.drift.byteLength);
      outcomes.staleAtWrite += 1;
      outcomes.stalePreserved += 1;
      outcomes.unsafeRenameOnStale += result.storageGuard.renameAttempted ? 1 : 0;
    } else {
      assert.equal(result.applied, true);
      assert.equal(readFixture(rootDir, writeCase.logicalPath).equals(writeCase.planned), true);
      assertStorageGuardApplied(result.storageGuard, writeCase.operation, writeCase.planned.byteLength);
      outcomes.applied += 1;
      if (writeCase.kind === 'update') {
        outcomes.updatesApplied += 1;
      } else {
        outcomes.createsApplied += 1;
      }
    }

    assert.equal(filesystemTempLeakPaths(rootDir).length, 0);
    assertStorageGuardHasNoRawValues(result.storageGuard, rootDir);
  }

  assert.deepEqual(outcomes, {
    attempted: cases.length,
    applied: 4,
    staleAtWrite: 2,
    updatesApplied: 2,
    createsApplied: 2,
    stalePreserved: 2,
    unsafeRenameOnStale: 0,
  });
});

test('RPP-0744 variant 3 proof projection stays deterministic hash-only support evidence', () => {
  const passOptions = smallBenchmarkOptions({
    maxDurationMs: 100_000,
    maxHeapUsedBytes: 1024 * 1024 * 1024,
  });
  const firstPass = runFilesystemCompareRenameBenchmark(passOptions);
  const secondPass = runFilesystemCompareRenameBenchmark(passOptions);
  const passProof = buildVariant3Proof(firstPass, secondPass);

  assert.equal(passProof.rppId, 'RPP-0744');
  assert.equal(passProof.proofId, proofId);
  assert.equal(passProof.variant, 3);
  assert.equal(passProof.status, 'passed');
  assert.equal(passProof.generatedCoverage.source, 'local-support-generated-filesystem-cases');
  assert.equal(passProof.generatedCoverage.writeVariant, 'compare-and-rename-write-v3');
  assert.equal(passProof.builtOn.rppId, 'RPP-0704');
  assert.equal(passProof.builtOn.benchmark, FILESYSTEM_COMPARE_RENAME_BENCHMARK_ID);
  assert.match(passProof.builtOn.evidenceHash, /^[a-f0-9]{64}$/);
  assert.equal(passProof.storage.boundary, FILESYSTEM_COMPARE_RENAME_BOUNDARY);
  assert.equal(passProof.storage.guardWritesAttempted, 7);
  assert.equal(passProof.storage.appliedWrites, 5);
  assert.equal(passProof.stale.rejectedWrites, 2);
  assert.equal(passProof.stale.unsafeRenameOnStaleWrites, 0);
  assert.equal(passProof.stale.driftPreservedWrites, 2);
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
    'pass',
  ]);
  assert.equal(gateById(passProof, 'deterministic-generated-gates').metrics.sameGateVector, true);
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
  const failProof = buildVariant3Proof(firstFail, secondFail);

  assert.equal(failProof.status, 'failed');
  assert.deepEqual(gateStatuses(firstFail), gateStatuses(secondFail));
  assert.equal(gateById(failProof, 'generated-write-counts').status, 'pass');
  assert.equal(gateById(failProof, 'stale-state-rejection').status, 'pass');
  assert.equal(gateById(failProof, 'atomic-compare-before-rename').status, 'pass');
  assert.equal(gateById(failProof, 'deterministic-generated-gates').status, 'pass');
  assert.equal(gateById(failProof, 'bounded-runtime-resources').status, 'fail');
  assert.equal(failProof.runtime.budgetStatus, 'failed');
  assert.equal(failProof.runtime.heapWithinBudget, false);
  assert.equal(failProof.runtime.maxHeapUsedBytes, 1);
  assert.equal(failProof.release.finalReleaseStatus, 'NO-GO');
  assertProjectionHasNoRawFilesystemValues(failProof);
});

test('RPP-0744 variant 3 large-site run finishes inside documented filesystem budgets', () => {
  const report = runFilesystemCompareRenameBenchmark({
    profile: 'large-site',
    now: fixedNow,
    seed: proofId,
  });
  const largeSiteProof = buildLargeSiteProof(report);

  assert.equal(report.ok, true);
  assert.equal(report.profile, 'large-site');
  assert.equal(report.resources.workload.expectedWrites, largeSiteExpectedWrites);
  assert.equal(report.resources.workload.fileBytes, largeSiteFileBytes);
  assert.equal(report.resources.storage.guardedWritesAttempted, largeSiteExpectedWrites);
  assert.equal(report.resources.storage.appliedWrites, largeSiteExpectedAppliedWrites);
  assert.equal(report.resources.storage.staleAtWriteWrites, largeSiteExpectedStaleWrites);
  assert.equal(report.resources.storage.unsafeRenameOnStaleWrites, 0);
  assert.equal(report.resources.tempLeaks, 0);
  assert.equal(report.runtime.budgets.maxDurationMs, largeSiteMaxDurationMs);
  assert.equal(report.runtime.budgets.maxHeapUsedBytes, largeSiteMaxHeapUsedBytes);
  assert.ok(report.runtime.durationMs <= largeSiteMaxDurationMs);
  assert.ok(report.resources.process.heapUsedBytes <= largeSiteMaxHeapUsedBytes);
  assert.deepEqual([...new Set(report.gates.map((gate) => gate.status))], ['pass']);

  assert.equal(largeSiteProof.rppId, 'RPP-0744');
  assert.equal(largeSiteProof.variant, 3);
  assert.equal(largeSiteProof.status, 'passed');
  assert.equal(largeSiteProof.largeSite.profile, 'large-site');
  assert.equal(largeSiteProof.largeSite.expectedWrites, largeSiteExpectedWrites);
  assert.equal(largeSiteProof.largeSite.durationWithinBudget, true);
  assert.equal(largeSiteProof.largeSite.heapWithinBudget, true);
  assert.equal(gateById(largeSiteProof, 'large-site-runtime-budget').status, 'pass');
  assert.equal(gateById(largeSiteProof, 'large-site-storage-counts').status, 'pass');
  assert.equal(gateById(largeSiteProof, 'large-site-hash-only-evidence').status, 'pass');
  assert.equal(gateById(largeSiteProof, 'support-only-release-posture').status, 'pass');
  assert.equal(largeSiteProof.release.finalReleaseStatus, 'NO-GO');
  assert.equal(largeSiteProof.release.integrationRecommendation, 'NO-GO');
  assertProjectionHasNoRawFilesystemValues(largeSiteProof);
});

function generatedWriteCases() {
  return [
    generatedWriteCase('update', 0, {
      operation: 'update',
      existingBytes: 128,
      plannedBytes: 160,
    }),
    generatedWriteCase('update', 1, {
      operation: 'update',
      existingBytes: 257,
      plannedBytes: 64,
    }),
    generatedWriteCase('create', 0, {
      operation: 'create',
      plannedBytes: 96,
    }),
    generatedWriteCase('create', 1, {
      operation: 'create',
      plannedBytes: 192,
    }),
    generatedWriteCase('stale', 0, {
      operation: 'update',
      existingBytes: 144,
      plannedBytes: 176,
      driftBytes: 208,
    }),
    generatedWriteCase('stale', 1, {
      operation: 'update',
      existingBytes: 320,
      plannedBytes: 224,
      driftBytes: 112,
    }),
  ];
}

function generatedWriteCase(kind, index, options) {
  const logicalPath = `wp-content/uploads/rpp-0744/generated/${kind}/case-${index}.bin`;
  return {
    kind,
    index,
    operation: options.operation,
    logicalPath,
    existing: options.existingBytes ? deterministicBuffer(options.existingBytes, `${kind}:existing:${index}`) : null,
    planned: deterministicBuffer(options.plannedBytes, `${kind}:planned:${index}`),
    drift: options.driftBytes ? deterministicBuffer(options.driftBytes, `${kind}:drift:${index}`) : null,
  };
}

function writeFixture(rootDir, logicalPath, contents) {
  const absolutePath = path.join(rootDir, logicalPath);
  ensureFilesystemDirectoryUsable(rootDir, path.dirname(absolutePath));
  fs.writeFileSync(absolutePath, contents);
}

function readFixture(rootDir, logicalPath) {
  return fs.readFileSync(path.join(rootDir, logicalPath));
}

function tempNamesBesideTarget(absolutePath) {
  return fs.readdirSync(path.dirname(absolutePath))
    .filter((entry) => entry.startsWith(FILESYSTEM_COMPARE_RENAME_TEMP_PREFIX))
    .sort();
}

function deterministicBuffer(sizeBytes, label) {
  const buffer = Buffer.allocUnsafe(sizeBytes);
  let offset = 0;
  let blockIndex = 0;
  while (offset < buffer.length) {
    const block = crypto.createHash('sha256').update(`${proofId}:${label}:${blockIndex}`).digest();
    block.copy(buffer, offset, 0, Math.min(block.length, buffer.length - offset));
    offset += block.length;
    blockIndex += 1;
  }
  return buffer;
}

function resourceEvidence(writeCase, expectedStorage) {
  return {
    kind: writeCase.kind,
    caseHash: digest({ proofId, kind: writeCase.kind, index: writeCase.index }),
    logicalPathHash: digest(writeCase.logicalPath),
    expectedStorageHash: filesystemStorageHash(expectedStorage),
  };
}

function assertStorageGuardApplied(evidence, operation, plannedBytes) {
  assert.equal(evidence.boundary, FILESYSTEM_COMPARE_RENAME_BOUNDARY);
  assert.equal(evidence.operation, operation);
  assert.equal(evidence.outcome, 'applied');
  assert.equal(evidence.sameDirectoryTemp, true);
  assert.equal(evidence.compareBeforeRename, true);
  assert.equal(evidence.renameAttempted, true);
  assert.equal(evidence.tempRemovedOnStale, false);
  assert.equal(evidence.atomicVisibilityBoundary, 'same-directory-rename');
  assert.equal(evidence.bytesWrittenToTemp, plannedBytes);
  assert.deepEqual(evidence.comparedFields, ['exists', 'type', 'sizeBytes', 'contentHash']);
  assert.deepEqual(evidence.steps, [
    'write-temp-same-directory',
    'read-live-storage',
    'compare-expected-storage-hash',
    'rename-temp-to-target',
  ]);
  assert.match(evidence.physicalPathHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.expectedResourceHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.expectedStorageHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.actualStorageHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.plannedStorageHash, /^[a-f0-9]{64}$/);
}

function assertStorageGuardRejectedStale(evidence, driftBytes) {
  assert.equal(evidence.boundary, FILESYSTEM_COMPARE_RENAME_BOUNDARY);
  assert.equal(evidence.operation, 'update');
  assert.equal(evidence.outcome, 'stale-at-write');
  assert.equal(evidence.sameDirectoryTemp, true);
  assert.equal(evidence.compareBeforeRename, true);
  assert.equal(evidence.renameAttempted, false);
  assert.equal(evidence.tempRemovedOnStale, true);
  assert.equal(evidence.atomicVisibilityBoundary, 'same-directory-rename');
  assert.equal(evidence.bytesCompared, driftBytes);
  assert.deepEqual(evidence.steps, [
    'write-temp-same-directory',
    'read-live-storage',
    'compare-expected-storage-hash',
  ]);
  assert.notEqual(evidence.actualStorageHash, evidence.expectedStorageHash);
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
    updateFiles: 3,
    createFiles: 2,
    staleFiles: 2,
    fileBytes: 2048,
    seed: proofId,
    ...overrides,
  };
}

function buildVariant3Proof(report, repeatedReport) {
  const gateVector = gateStatuses(report);
  const repeatedGateVector = gateStatuses(repeatedReport);
  const sameGateVector = JSON.stringify(gateVector) === JSON.stringify(repeatedGateVector);
  const runtimeGate = benchmarkGateById(report, 'large-site-runtime-budget');
  const expectedApplied = report.resources.workload.updateFiles + report.resources.workload.createFiles;
  const writeCountsPassed = report.resources.storage.guardedWritesAttempted === report.resources.workload.expectedWrites
    && report.resources.storage.appliedWrites === expectedApplied
    && report.resources.storage.staleAtWriteWrites === report.resources.workload.staleFiles;
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
  const runtimeWithinBudget = runtimeGate.status === 'pass';
  const supportOnlyRelease = supportOnlyReleasePosture();
  const gates = [
    proofGate('generated-write-counts', writeCountsPassed, {
      expectedWrites: report.resources.workload.expectedWrites,
      guardedWritesAttempted: report.resources.storage.guardedWritesAttempted,
      appliedWrites: report.resources.storage.appliedWrites,
      staleAtWriteWrites: report.resources.storage.staleAtWriteWrites,
    }),
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
    proofGate('deterministic-generated-gates', sameGateVector, {
      sameGateVector,
      firstGateVector: gateVector,
      secondGateVector: repeatedGateVector,
    }),
    proofGate('bounded-runtime-resources', runtimeWithinBudget, runtimeGate.evidence),
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
  const publicEvidence = {
    rppId: 'RPP-0744',
    proofId,
    variant: 3,
    status: gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed',
    generatedCoverage: {
      source: 'local-support-generated-filesystem-cases',
      writeVariant: 'compare-and-rename-write-v3',
      profile: report.profile,
      repeatedGateVector: sameGateVector,
    },
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

function buildLargeSiteProof(report) {
  const runtimeGate = benchmarkGateById(report, 'large-site-runtime-budget');
  const supportOnlyRelease = supportOnlyReleasePosture();
  const durationWithinBudget = report.runtime.durationMs <= report.runtime.budgets.maxDurationMs;
  const heapWithinBudget = report.resources.process.heapUsedBytes <= report.runtime.budgets.maxHeapUsedBytes;
  const storageCountsPassed = report.resources.workload.expectedWrites === largeSiteExpectedWrites
    && report.resources.storage.guardedWritesAttempted === largeSiteExpectedWrites
    && report.resources.storage.appliedWrites === largeSiteExpectedAppliedWrites
    && report.resources.storage.staleAtWriteWrites === largeSiteExpectedStaleWrites
    && report.resources.storage.unsafeRenameOnStaleWrites === 0
    && report.resources.tempLeaks === 0;
  const gates = [
    proofGate('large-site-runtime-budget', runtimeGate.status === 'pass'
      && durationWithinBudget
      && heapWithinBudget, runtimeGate.evidence),
    proofGate('large-site-storage-counts', storageCountsPassed, {
      expectedWrites: report.resources.workload.expectedWrites,
      guardedWritesAttempted: report.resources.storage.guardedWritesAttempted,
      appliedWrites: report.resources.storage.appliedWrites,
      staleAtWriteWrites: report.resources.storage.staleAtWriteWrites,
      unsafeRenameOnStaleWrites: report.resources.storage.unsafeRenameOnStaleWrites,
      tempLeaks: report.resources.tempLeaks,
    }),
    proofGate('large-site-hash-only-evidence', report.deterministicCoverage.rawValueEvidenceLeaks === 0, {
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
  const publicEvidence = {
    rppId: 'RPP-0744',
    proofId,
    variant: 3,
    status: gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed',
    builtOn: {
      rppId: report.rppId,
      benchmark: report.benchmark,
      evidenceHash: digest(publicBenchmarkProjection(report)),
    },
    largeSite: {
      profile: report.profile,
      expectedWrites: report.resources.workload.expectedWrites,
      fileBytes: report.resources.workload.fileBytes,
      durationMs: report.runtime.durationMs,
      maxDurationMs: report.runtime.budgets.maxDurationMs,
      durationWithinBudget,
      heapUsedBytes: report.resources.process.heapUsedBytes,
      maxHeapUsedBytes: report.runtime.budgets.maxHeapUsedBytes,
      heapWithinBudget,
      tempLeaks: report.resources.tempLeaks,
    },
    gates,
    release: supportOnlyRelease,
    redaction: {
      mode: 'hash-only-large-site-proof',
      evidenceSampleHashes: report.deterministicCoverage.evidenceSamples.map((evidence) => digest(evidence)),
    },
  };

  return {
    ...publicEvidence,
    evidenceHash: digest(publicEvidence),
  };
}

function supportOnlyReleasePosture() {
  return {
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
    'fs-base-payload',
    'fs-planned-payload',
    'fs-drift-payload',
    'filesystem raw fixture',
    'wp-content/uploads',
    FILESYSTEM_COMPARE_RENAME_TEMP_PREFIX,
    rootDir,
  ].filter(Boolean);
}
