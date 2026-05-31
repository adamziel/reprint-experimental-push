import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  FILESYSTEM_COMPARE_RENAME_ADAPTER,
  FILESYSTEM_COMPARE_RENAME_BOUNDARY,
  FILESYSTEM_COMPARE_RENAME_COMPARED_FIELDS,
  FILESYSTEM_COMPARE_RENAME_TEMP_PREFIX,
} from '../src/filesystem-compare-rename-write.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { digest } from '../src/stable-json.js';
import { FILESYSTEM_COMPARE_RENAME_BENCHMARK_ID } from '../scripts/bench/filesystem-compare-rename-write.js';

const benchmarkScript = fileURLToPath(new URL('../scripts/bench/filesystem-compare-rename-write.js', import.meta.url));
const proofId = 'rpp-0784-filesystem-compare-and-rename-write-release-verifier-v5';
const hashPattern = /^[a-f0-9]{64}$/;
const successWorkload = Object.freeze({
  updateFiles: 5,
  createFiles: 4,
  staleFiles: 4,
  fileBytes: 4096,
  maxDurationMs: 5000,
  maxHeapUsedBytes: 268435456,
});
const failGateWorkload = Object.freeze({
  updateFiles: 2,
  createFiles: 1,
  staleFiles: 1,
  fileBytes: 1024,
  maxDurationMs: 5000,
  maxHeapUsedBytes: 1,
});
const requiredBenchmarkGateIds = Object.freeze([
  'deterministic-guard-behavior',
  'matching-storage-renames',
  'stale-storage-rejected-and-preserved',
  'same-directory-compare-before-rename-evidence',
  'temp-cleanup',
  'hash-only-evidence',
  'large-site-runtime-budget',
]);
const releaseVerifierSupportGateIds = Object.freeze([
  'release-verifier-benchmark-command-reports-runtime-resources-gates',
  'complete-filesystem-storage-performance-report',
  'deterministic-filesystem-guard-coverage',
  'hash-only-release-verifier-evidence',
  'support-only-release-no-go',
]);

test('RPP-0784 release verifier v5 benchmark command reports filesystem runtime, resources, and pass gates', () => {
  const result = runBenchmarkCommand(workloadArgs(successWorkload));

  assert.equal(result.status, 0, result.stdout);
  const report = parseBenchmarkReport(result);

  assertBenchmarkReportShape(report, successWorkload);
  assert.equal(report.ok, true);
  assert.deepEqual([...new Set(report.gates.map((gate) => gate.status))], ['pass']);

  const proof = buildReleaseVerifierSupportProof(report, successWorkload);
  assert.equal(proof.rppId, 'RPP-0784');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 5);
  assert.equal(proof.evidenceSource, 'filesystem-compare-and-rename-write-release-verifier-v5');
  assert.equal(proof.supportOnly, true);
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.integrationRecommendation, 'NO-GO');
  assert.deepEqual(proof.gates.map((gate) => gate.id), releaseVerifierSupportGateIds);
  assert.deepEqual([...new Set(proof.gates.map((gate) => gate.status))], ['pass']);
  assert.equal(proof.releaseVerifier.runtimeReported, true);
  assert.equal(proof.releaseVerifier.resourcesReported, true);
  assert.equal(proof.releaseVerifier.passFailGatesReported, true);
  assert.deepEqual(proof.releaseVerifier.passGateIds.sort(), [...requiredBenchmarkGateIds].sort());
  assert.deepEqual(proof.releaseVerifier.failGateIds, []);
  assert.equal(proof.storagePerformance.productionStorageDurability, 'not-claimed');
  assert.equal(proof.storagePerformance.guardedWritesAttempted, 13);
  assert.equal(proof.storagePerformance.appliedWrites, 9);
  assert.equal(proof.storagePerformance.staleAtWriteWrites, 4);
  assert.equal(proof.storagePerformance.unsafeRenameOnStaleWrites, 0);
  assert.equal(proof.storagePerformance.tempLeaks, 0);
  assert.equal(proof.atomicity.sameDirectoryTemp, true);
  assert.equal(proof.atomicity.compareBeforeRename, true);
  assert.equal(proof.atomicity.renameVisibilityBoundary, 'same-directory-rename');
  assert.match(proof.benchmarkHash, hashPattern);
  assert.match(proof.proofHash, hashPattern);

  assertNoRawOrPrivateFilesystemEvidence(proof);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0784 filesystem release verifier proof' }));
});

test('RPP-0784 release verifier v5 benchmark command exposes fail gates with runtime and resources', () => {
  const result = runBenchmarkCommand(workloadArgs(failGateWorkload));

  assert.ok([0, 1].includes(result.status), result.stdout);
  const report = parseBenchmarkReport(result);

  assertBenchmarkReportShape(report, failGateWorkload);
  assert.equal(report.ok, false);
  assert.equal(hasRuntimeReport(report), true);
  assert.equal(hasResourceReport(report), true);
  assert.equal(hasPassFailGateReport(report), true);

  const runtimeBudgetGate = gateById(report, 'large-site-runtime-budget');
  assert.equal(runtimeBudgetGate.status, 'fail');
  assert.equal(runtimeBudgetGate.evidence.maxHeapUsedBytes, 1);
  assert.ok(runtimeBudgetGate.evidence.heapUsedBytes > 1);
  assertNonNegativeNumber(runtimeBudgetGate.evidence.durationMs);

  for (const id of requiredBenchmarkGateIds.filter((gateId) => gateId !== 'large-site-runtime-budget')) {
    assert.equal(gateById(report, id).status, 'pass', `${id} gate should remain pass`);
  }

  const failGateProof = buildFailGateReleaseVerifierProof(report);
  assert.equal(failGateProof.rppId, 'RPP-0784');
  assert.equal(failGateProof.variant, 5);
  assert.equal(failGateProof.evidenceSource, 'filesystem-compare-and-rename-write-release-verifier-v5');
  assert.deepEqual(failGateProof.failGateIds, ['large-site-runtime-budget']);
  assert.equal(failGateProof.runtimeReported, true);
  assert.equal(failGateProof.resourcesReported, true);
  assert.equal(failGateProof.passFailGatesReported, true);
  assert.equal(failGateProof.supportOnly, true);
  assert.equal(failGateProof.productionBacked, false);
  assert.equal(failGateProof.finalReleaseStatus, 'NO-GO');
  assert.equal(failGateProof.integrationRecommendation, 'NO-GO');

  assertNoRawOrPrivateFilesystemEvidence(failGateProof);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(failGateProof, { label: 'RPP-0784 filesystem fail-gate proof' }));
});

function runBenchmarkCommand(args) {
  const result = spawnSync(process.execPath, [benchmarkScript, ...args], {
    encoding: 'utf8',
    env: sanitizedBenchmarkEnv(),
    timeout: 15_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.stderr, '');
  return result;
}

function sanitizedBenchmarkEnv() {
  const env = {
    LC_ALL: 'C',
    LANG: 'C',
  };
  if (process.env.PATH) {
    env.PATH = process.env.PATH;
  }
  return env;
}

function workloadArgs(workload) {
  return [
    '--profile=unit',
    `--update-files=${workload.updateFiles}`,
    `--create-files=${workload.createFiles}`,
    `--stale-files=${workload.staleFiles}`,
    `--file-bytes=${workload.fileBytes}`,
    `--max-duration-ms=${workload.maxDurationMs}`,
    `--max-heap-used-bytes=${workload.maxHeapUsedBytes}`,
  ];
}

function parseBenchmarkReport(result) {
  assert.ok(result.stdout.trim().length > 0, 'filesystem benchmark command did not emit JSON');
  return JSON.parse(result.stdout);
}

function assertBenchmarkReportShape(report, workload) {
  const expectedWrites = workload.updateFiles + workload.createFiles + workload.staleFiles;
  const expectedApplied = workload.updateFiles + workload.createFiles;

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0704');
  assert.equal(report.benchmark, FILESYSTEM_COMPARE_RENAME_BENCHMARK_ID);
  assert.equal(report.profile, 'unit');
  assert.equal(report.runtime.benchmarkId, FILESYSTEM_COMPARE_RENAME_BENCHMARK_ID);
  assert.equal(Date.parse(report.runtime.generatedAt) > 0, true);
  assertNonNegativeNumber(report.runtime.durationMs);
  assert.match(report.runtime.node, /^v\d+\.\d+\.\d+/);
  assert.equal(typeof report.runtime.platform, 'string');
  assert.equal(typeof report.runtime.arch, 'string');
  assert.ok(report.runtime.cpuCount > 0);
  assert.equal(report.runtime.budgets.profile, 'unit');
  assert.equal(report.runtime.budgets.maxDurationMs, workload.maxDurationMs);
  assert.equal(report.runtime.budgets.maxHeapUsedBytes, workload.maxHeapUsedBytes);

  assert.deepEqual(report.resources.workload, {
    updateFiles: workload.updateFiles,
    createFiles: workload.createFiles,
    staleFiles: workload.staleFiles,
    fileBytes: workload.fileBytes,
    expectedWrites,
    expectedApplied,
    expectedStale: workload.staleFiles,
  });
  assert.equal(report.resources.storage.boundary, FILESYSTEM_COMPARE_RENAME_BOUNDARY);
  assert.equal(report.resources.storage.adapter, FILESYSTEM_COMPARE_RENAME_ADAPTER);
  assert.equal(report.resources.storage.engine, 'filesystem');
  assert.deepEqual(report.resources.storage.comparedFields, [...FILESYSTEM_COMPARE_RENAME_COMPARED_FIELDS]);
  assert.equal(report.resources.storage.tempPlacement, 'same-directory');
  assert.equal(report.resources.storage.visibilityBoundary, 'rename-temp-to-target-after-compare');
  assert.equal(report.resources.storage.guardedWritesAttempted, expectedWrites);
  assert.equal(report.resources.storage.appliedWrites, expectedApplied);
  assert.equal(report.resources.storage.staleAtWriteWrites, workload.staleFiles);
  assert.equal(report.resources.storage.unsafeRenameOnStaleWrites, 0);
  assert.equal(report.resources.tempLeaks, 0);

  assert.equal(report.resources.bytes.setupExistingBytes, (workload.updateFiles + workload.staleFiles) * workload.fileBytes);
  assert.equal(report.resources.bytes.tempWrittenBytes, expectedWrites * workload.fileBytes);
  assert.equal(report.resources.bytes.comparedBytes, (workload.updateFiles + workload.staleFiles) * workload.fileBytes);
  assert.equal(report.resources.bytes.renamedBytes, expectedApplied * workload.fileBytes);
  assert.equal(report.resources.bytes.driftPreservedBytes, workload.staleFiles * workload.fileBytes);

  assertNonNegativeNumber(report.resources.process.userCpuMs);
  assertNonNegativeNumber(report.resources.process.systemCpuMs);
  assertNonNegativeNumber(report.resources.process.maxRssBytes);
  assert.equal(report.resources.process.heapUsedBytes > 0, true);
  assertFiniteNumber(report.resources.process.heapDeltaBytes);
  assert.deepEqual(report.resources.runtimeBudget, report.runtime.budgets);

  assert.deepEqual(report.gates.map((gate) => gate.id).sort(), [...requiredBenchmarkGateIds].sort());
  assert.equal(report.deterministicCoverage.profile, 'unit');
  assert.deepEqual(report.deterministicCoverage.workload, report.resources.workload);
  assert.deepEqual(report.deterministicCoverage.failures, []);
  assert.equal(report.deterministicCoverage.rawValueEvidenceLeaks, 0);
  assert.equal(report.deterministicCoverage.tempLeaks, 0);
  assert.equal(report.deterministicCoverage.writes.attempted, expectedWrites);
  assert.equal(report.deterministicCoverage.writes.applied, expectedApplied);
  assert.equal(report.deterministicCoverage.writes.staleAtWrite, workload.staleFiles);
  assert.equal(report.deterministicCoverage.writes.updatesApplied, workload.updateFiles);
  assert.equal(report.deterministicCoverage.writes.createsApplied, workload.createFiles);
  assert.equal(report.deterministicCoverage.writes.stalePreserved, workload.staleFiles);
  assert.equal(report.deterministicCoverage.writes.unsafeRenameOnStale, 0);
  assert.ok(report.deterministicCoverage.evidenceSamples.length > 0);

  for (const evidence of report.deterministicCoverage.evidenceSamples) {
    assertGuardEvidenceShape(evidence);
  }
}

function assertGuardEvidenceShape(evidence) {
  assert.equal(evidence.boundary, FILESYSTEM_COMPARE_RENAME_BOUNDARY);
  assert.equal(evidence.adapter, FILESYSTEM_COMPARE_RENAME_ADAPTER);
  assert.equal(evidence.engine, 'filesystem');
  assert.ok(['update', 'create'].includes(evidence.operation));
  assert.ok(['applied', 'stale-at-write'].includes(evidence.outcome));
  assert.equal(evidence.sameDirectoryTemp, true);
  assert.equal(evidence.compareBeforeRename, true);
  assert.equal(evidence.atomicVisibilityBoundary, 'same-directory-rename');
  assert.deepEqual(evidence.comparedFields, [...FILESYSTEM_COMPARE_RENAME_COMPARED_FIELDS]);
  assert.match(evidence.physicalPathHash, hashPattern);
  assert.match(evidence.expectedResourceHash, hashPattern);
  assert.match(evidence.expectedStorageHash, hashPattern);
  assert.match(evidence.actualStorageHash, hashPattern);
  assert.match(evidence.plannedStorageHash, hashPattern);
}

function buildReleaseVerifierSupportProof(report, workload) {
  const expectedWrites = workload.updateFiles + workload.createFiles + workload.staleFiles;
  const expectedApplied = workload.updateFiles + workload.createFiles;
  const storageCountsMatch = report.resources.storage.guardedWritesAttempted === expectedWrites
    && report.resources.storage.appliedWrites === expectedApplied
    && report.resources.storage.staleAtWriteWrites === workload.staleFiles
    && report.resources.storage.unsafeRenameOnStaleWrites === 0
    && report.resources.tempLeaks === 0;
  const byteCountsMatch = report.resources.bytes.tempWrittenBytes === expectedWrites * workload.fileBytes
    && report.resources.bytes.renamedBytes === expectedApplied * workload.fileBytes
    && report.resources.bytes.driftPreservedBytes === workload.staleFiles * workload.fileBytes;
  const deterministicCoveragePassed = report.ok
    && report.deterministicCoverage.failures.length === 0
    && gateById(report, 'deterministic-guard-behavior').status === 'pass'
    && gateById(report, 'matching-storage-renames').status === 'pass'
    && gateById(report, 'stale-storage-rejected-and-preserved').status === 'pass'
    && gateById(report, 'same-directory-compare-before-rename-evidence').status === 'pass'
    && gateById(report, 'temp-cleanup').status === 'pass';
  const proof = {
    rppId: 'RPP-0784',
    proofId,
    variant: 5,
    evidenceSource: 'filesystem-compare-and-rename-write-release-verifier-v5',
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    benchmarkHash: digest(publicBenchmarkProjection(report)),
    releaseVerifier: {
      benchmarkId: report.benchmark,
      command: 'node scripts/bench/filesystem-compare-rename-write.js',
      runtimeReported: hasRuntimeReport(report),
      resourcesReported: hasResourceReport(report),
      passFailGatesReported: hasPassFailGateReport(report),
      passGateIds: report.gates.filter((gate) => gate.status === 'pass').map((gate) => gate.id),
      failGateIds: report.gates.filter((gate) => gate.status === 'fail').map((gate) => gate.id),
      productionGateEvidence: 'not-present',
    },
    storagePerformance: {
      boundary: report.resources.storage.boundary,
      adapter: report.resources.storage.adapter,
      engine: report.resources.storage.engine,
      comparedFieldCount: report.resources.storage.comparedFields.length,
      guardedWritesAttempted: report.resources.storage.guardedWritesAttempted,
      appliedWrites: report.resources.storage.appliedWrites,
      staleAtWriteWrites: report.resources.storage.staleAtWriteWrites,
      unsafeRenameOnStaleWrites: report.resources.storage.unsafeRenameOnStaleWrites,
      tempLeaks: report.resources.tempLeaks,
      tempWrittenBytes: report.resources.bytes.tempWrittenBytes,
      renamedBytes: report.resources.bytes.renamedBytes,
      driftPreservedBytes: report.resources.bytes.driftPreservedBytes,
      productionStorageDurability: 'not-claimed',
    },
    atomicity: {
      sameDirectoryTemp: report.resources.storage.tempPlacement === 'same-directory',
      compareBeforeRename: gateById(report, 'same-directory-compare-before-rename-evidence').status === 'pass',
      renameVisibilityBoundary: 'same-directory-rename',
    },
    redaction: {
      mode: 'hash-count-only-release-verifier-proof',
      rawValueEvidenceLeaks: report.deterministicCoverage.rawValueEvidenceLeaks,
      checkedFixtureMarkerCount: rawFilesystemTokens().length,
      evidenceSampleHashes: report.deterministicCoverage.evidenceSamples.map((evidence) => digest(evidence)),
    },
    gates: [],
  };
  proof.gates = [
    localGate('release-verifier-benchmark-command-reports-runtime-resources-gates',
      proof.releaseVerifier.runtimeReported
        && proof.releaseVerifier.resourcesReported
        && proof.releaseVerifier.passFailGatesReported,
      {
        runtimeReported: proof.releaseVerifier.runtimeReported,
        resourcesReported: proof.releaseVerifier.resourcesReported,
        gateCount: report.gates.length,
      }),
    localGate('complete-filesystem-storage-performance-report',
      storageCountsMatch && byteCountsMatch,
      {
        guardedWritesAttempted: report.resources.storage.guardedWritesAttempted,
        tempWrittenBytes: report.resources.bytes.tempWrittenBytes,
        renamedBytes: report.resources.bytes.renamedBytes,
        driftPreservedBytes: report.resources.bytes.driftPreservedBytes,
      }),
    localGate('deterministic-filesystem-guard-coverage',
      deterministicCoveragePassed,
      {
        appliedWrites: report.resources.storage.appliedWrites,
        staleAtWriteWrites: report.resources.storage.staleAtWriteWrites,
        unsafeRenameOnStaleWrites: report.resources.storage.unsafeRenameOnStaleWrites,
      }),
    localGate('hash-only-release-verifier-evidence',
      gateById(report, 'hash-only-evidence').status === 'pass' && !containsRawOrPrivateFilesystemEvidence(proof),
      {
        rawValueEvidenceLeaks: report.deterministicCoverage.rawValueEvidenceLeaks,
        evidenceSampleHashes: proof.redaction.evidenceSampleHashes,
      }),
    localGate('support-only-release-no-go',
      proof.supportOnly
        && !proof.productionBacked
        && !proof.releaseEligible
        && proof.finalReleaseStatus === 'NO-GO'
        && proof.integrationRecommendation === 'NO-GO',
      {
        productionBacked: proof.productionBacked,
        releaseEligible: proof.releaseEligible,
        finalReleaseStatus: proof.finalReleaseStatus,
      }),
  ];

  return {
    ...proof,
    proofHash: digest({
      ...proof,
      gates: proof.gates.map((gate) => ({
        id: gate.id,
        status: gate.status,
      })),
    }),
  };
}

function buildFailGateReleaseVerifierProof(report) {
  const runtimeBudgetGate = gateById(report, 'large-site-runtime-budget');
  return {
    rppId: 'RPP-0784',
    variant: 5,
    evidenceSource: 'filesystem-compare-and-rename-write-release-verifier-v5',
    supportOnly: true,
    productionBacked: false,
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    runtimeReported: hasRuntimeReport(report),
    resourcesReported: hasResourceReport(report),
    passFailGatesReported: hasPassFailGateReport(report),
    failGateIds: report.gates.filter((gate) => gate.status === 'fail').map((gate) => gate.id),
    failedBudgetGate: {
      id: runtimeBudgetGate.id,
      durationMs: runtimeBudgetGate.evidence.durationMs,
      maxDurationMs: runtimeBudgetGate.evidence.maxDurationMs,
      heapUsedBytes: runtimeBudgetGate.evidence.heapUsedBytes,
      maxHeapUsedBytes: runtimeBudgetGate.evidence.maxHeapUsedBytes,
    },
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
    process: {
      heapUsedBytes: report.resources.process.heapUsedBytes,
      maxRssBytes: report.resources.process.maxRssBytes,
    },
    gates: report.gates.map((gate) => ({
      id: gate.id,
      status: gate.status,
    })),
    evidenceSampleHashes: report.deterministicCoverage.evidenceSamples.map((evidence) => digest(evidence)),
  };
}

function hasRuntimeReport(report) {
  return Boolean(report.runtime
    && report.runtime.benchmarkId === FILESYSTEM_COMPARE_RENAME_BENCHMARK_ID
    && typeof report.runtime.generatedAt === 'string'
    && typeof report.runtime.durationMs === 'number'
    && typeof report.runtime.node === 'string'
    && typeof report.runtime.platform === 'string'
    && typeof report.runtime.arch === 'string'
    && typeof report.runtime.cpuCount === 'number'
    && report.runtime.budgets);
}

function hasResourceReport(report) {
  return report.resources
    && report.resources.process
    && report.resources.storage
    && report.resources.bytes
    && typeof report.resources.process.heapUsedBytes === 'number'
    && typeof report.resources.storage.guardedWritesAttempted === 'number'
    && typeof report.resources.bytes.tempWrittenBytes === 'number'
    && typeof report.resources.tempLeaks === 'number';
}

function hasPassFailGateReport(report) {
  return Array.isArray(report.gates)
    && report.gates.length === requiredBenchmarkGateIds.length
    && report.gates.every((gate) => requiredBenchmarkGateIds.includes(gate.id)
      && ['pass', 'fail'].includes(gate.status));
}

function localGate(id, ok, metrics = {}) {
  return {
    id,
    status: ok ? 'pass' : 'fail',
    metrics,
  };
}

function gateById(report, id) {
  const gate = report.gates.find((candidate) => candidate.id === id);
  assert.ok(gate, `missing ${id} gate`);
  return gate;
}

function assertNonNegativeNumber(value) {
  assertFiniteNumber(value);
  assert.ok(value >= 0);
}

function assertFiniteNumber(value) {
  assert.equal(typeof value, 'number');
  assert.ok(Number.isFinite(value));
}

function assertNoRawOrPrivateFilesystemEvidence(value) {
  assert.equal(containsRawOrPrivateFilesystemEvidence(value), false);
}

function containsRawOrPrivateFilesystemEvidence(value) {
  const serialized = JSON.stringify(value);
  const lower = serialized.toLowerCase();
  return rawFilesystemTokens().some((token) => lower.includes(token.toLowerCase()));
}

function rawFilesystemTokens() {
  return [
    'fs-base-payload',
    'fs-planned-payload',
    'fs-drift-payload',
    'filesystem raw fixture',
    'wp-content/uploads',
    'rpp-0704/',
    'file-0000.bin',
    FILESYSTEM_COMPARE_RENAME_TEMP_PREFIX,
    'http://',
    'https://',
    'bearer ',
  ];
}
