import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  MYSQL_CAS_ADAPTER,
  MYSQL_CAS_BENCHMARK_ID,
  MYSQL_CAS_BOUNDARY,
  MYSQL_CAS_SURFACE_DEFINITIONS,
} from '../scripts/bench/mysql-cas-write-guard.js';

const benchmarkScript = fileURLToPath(new URL('../scripts/bench/mysql-cas-write-guard.js', import.meta.url));
const successIterations = 5;
const failGateIterations = 2;
const requiredBenchmarkGateIds = [
  'deterministic-guard-behavior',
  'applied-and-stale-outcomes',
  'duplicate-key-guard',
  'single-statement-cas-shapes',
  'hash-only-evidence',
  'mysql-runtime-capability-recorded',
  'runtime-resource-budget',
];
const supportProofGateIds = [
  'benchmark-command-reports-runtime-resources-gates',
  'complete-storage-performance-report',
  'deterministic-cas-storage-guard-coverage',
  'hash-only-storage-performance-evidence',
  'support-only-release-no-go',
];
const uniqueGuardSurfaceCount = MYSQL_CAS_SURFACE_DEFINITIONS
  .filter((surface) => surface.uniqueKeyColumns?.length).length;

test('RPP-0741 variant 3 benchmark command reports runtime, resources, and pass gates', () => {
  const result = runBenchmarkCommand([
    '--iterations',
    String(successIterations),
    '--max-duration-ms',
    '5000',
    '--max-heap-used-bytes',
    '268435456',
  ]);

  assert.equal(result.status, 0, result.stdout);
  const report = parseBenchmarkReport(result);

  assertBenchmarkReportShape(report, successIterations);
  assert.deepEqual([...new Set(report.gates.map((gate) => gate.status))], ['pass']);

  const proof = buildSupportOnlyStoragePerformanceProof(report, successIterations);
  assert.equal(proof.rppId, 'RPP-0741');
  assert.equal(proof.variant, 3);
  assert.equal(proof.supportOnly, true);
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.integrationRecommendation, 'NO-GO');
  assert.deepEqual(proof.gates.map((gate) => gate.id), supportProofGateIds);
  assert.deepEqual([...new Set(proof.gates.map((gate) => gate.status))], ['pass']);
  assert.equal(proof.storagePerformance.runtimeReported, true);
  assert.equal(proof.storagePerformance.resourcesReported, true);
  assert.equal(proof.storagePerformance.passFailGatesReported, true);
  assert.equal(proof.storagePerformance.productionStorageDurability, 'not-claimed');

  assertNoRawOrPrivateEvidence(report);
  assertNoRawOrPrivateEvidence(proof);
});

test('RPP-0741 variant 3 benchmark command exposes fail gates with runtime and resources', () => {
  const result = runBenchmarkCommand([
    '--iterations',
    String(failGateIterations),
    '--max-duration-ms',
    '5000',
    '--max-heap-used-bytes',
    '1',
  ]);

  assert.equal(result.status, 1, result.stdout);
  const report = parseBenchmarkReport(result);

  assertBenchmarkReportShape(report, failGateIterations);
  assert.equal(report.ok, false);
  assert.equal(report.mode, 'deterministic-no-mysql-runtime');

  const runtimeBudgetGate = gateById(report, 'runtime-resource-budget');
  assert.equal(runtimeBudgetGate.status, 'fail');
  assert.equal(runtimeBudgetGate.metrics.maxHeapUsedBytes, 1);
  assert.ok(runtimeBudgetGate.metrics.heapUsedBytes > 1);
  assertNonNegativeNumber(runtimeBudgetGate.metrics.durationMs);

  for (const id of requiredBenchmarkGateIds.filter((gateId) => gateId !== 'runtime-resource-budget')) {
    assert.equal(gateById(report, id).status, 'pass', `${id} gate should remain pass`);
  }
  assertNoRawOrPrivateEvidence(report);
});

function runBenchmarkCommand(args) {
  const result = spawnSync(process.execPath, [benchmarkScript, ...args], {
    encoding: 'utf8',
    env: sanitizedBenchmarkEnv(),
    timeout: 15_000,
    maxBuffer: 2 * 1024 * 1024,
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

function parseBenchmarkReport(result) {
  assert.ok(result.stdout.trim().length > 0, 'benchmark command did not emit JSON');
  return JSON.parse(result.stdout);
}

function assertBenchmarkReportShape(report, iterations) {
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0701');
  assert.equal(report.benchmark, MYSQL_CAS_BENCHMARK_ID);
  assert.equal(report.runtime.benchmarkId, MYSQL_CAS_BENCHMARK_ID);
  assert.equal(Date.parse(report.runtime.generatedAt) > 0, true);
  assertNonNegativeNumber(report.runtime.durationMs);
  assert.match(report.runtime.node, /^v\d+\.\d+\.\d+/);
  assert.equal(typeof report.runtime.platform, 'string');
  assert.equal(typeof report.runtime.arch, 'string');
  assert.ok(report.runtime.cpuCount > 0);
  assert.equal(report.runtime.mysqlRuntime.status, 'unavailable');
  assert.ok(report.runtime.mysqlRuntime.unavailableCapabilities.includes('mysql-runtime-connection-settings'));
  assert.match(report.runtime.mysqlRuntime.detail, /REPRINT_PUSH_MYSQL_CAS_/);
  assert.equal(Object.hasOwn(report.runtime.mysqlRuntime, 'serverVersion'), false);
  assert.equal(Object.hasOwn(report.runtime.mysqlRuntime, 'connection'), false);

  assertNonNegativeNumber(report.resources.process.rssBytes);
  assert.equal(report.resources.process.heapUsedBytes > 0, true);
  assertFiniteNumber(report.resources.process.heapDeltaBytes);
  assertNonNegativeNumber(report.resources.process.externalBytes);
  assertNonNegativeNumber(report.resources.process.arrayBuffersBytes);
  assertNonNegativeNumber(report.resources.process.userCpuMs);
  assertNonNegativeNumber(report.resources.process.systemCpuMs);
  assertNonNegativeNumber(report.resources.process.maxRSSKiB);

  assert.equal(report.resources.storage.boundary, MYSQL_CAS_BOUNDARY);
  assert.equal(report.resources.storage.adapter, MYSQL_CAS_ADAPTER);
  assert.equal(report.resources.storage.engine, 'mysql');
  assert.equal(report.resources.storage.logicalTables, MYSQL_CAS_SURFACE_DEFINITIONS.length);
  assert.equal(
    report.resources.storage.guardedWritesAttempted,
    (MYSQL_CAS_SURFACE_DEFINITIONS.length * iterations * 3) + (uniqueGuardSurfaceCount * iterations),
  );
  assert.equal(report.resources.storage.appliedWrites, MYSQL_CAS_SURFACE_DEFINITIONS.length * iterations);
  assert.equal(report.resources.storage.staleAtWriteWrites, MYSQL_CAS_SURFACE_DEFINITIONS.length * iterations);
  assert.equal(report.resources.storage.absentAtWriteWrites, MYSQL_CAS_SURFACE_DEFINITIONS.length * iterations);
  assert.equal(report.resources.storage.duplicateKeyRejectedWrites, uniqueGuardSurfaceCount * iterations);
  assert.equal(report.resources.storage.unsafeMultipleMatchWrites, 0);

  for (const surface of MYSQL_CAS_SURFACE_DEFINITIONS) {
    assert.deepEqual(
      report.resources.storage.comparedColumnsByTable[surface.logicalTable],
      [...new Set([...surface.keyColumns, ...surface.compareColumns])],
    );
  }

  assert.equal(report.resources.sql.singleStatementShapes, MYSQL_CAS_SURFACE_DEFINITIONS.length);
  assert.equal(report.resources.sql.shapes.length, MYSQL_CAS_SURFACE_DEFINITIONS.length);
  for (const shape of report.resources.sql.shapes) {
    assert.equal(shape.statementKind, 'UPDATE');
    assert.equal(shape.singleStatement, true);
    assert.equal(shape.nullSafePredicate, true);
    assert.equal(Object.hasOwn(shape, 'sqlShape'), false);
    assert.match(shape.sqlShapeHash, /^[a-f0-9]{64}$/);
    assert.equal(shape.predicateCount, shape.comparedColumns.length);
    assert.equal(shape.assignmentCount, shape.setColumns.length);
  }

  assert.deepEqual(report.gates.map((gate) => gate.id).sort(), [...requiredBenchmarkGateIds].sort());
  assert.equal(report.deterministicCoverage.iterations, iterations);
  assert.deepEqual(report.deterministicCoverage.failures, []);
  assert.equal(report.deterministicCoverage.rawValueEvidenceLeaks, 0);
  assert.equal(report.deterministicCoverage.writes.applied, MYSQL_CAS_SURFACE_DEFINITIONS.length * iterations);
  assert.equal(report.deterministicCoverage.writes.staleAtWrite, MYSQL_CAS_SURFACE_DEFINITIONS.length * iterations);
  assert.equal(report.deterministicCoverage.writes.absentAtWrite, MYSQL_CAS_SURFACE_DEFINITIONS.length * iterations);
  assert.equal(report.deterministicCoverage.writes.duplicateKeyRejected, uniqueGuardSurfaceCount * iterations);
  assert.equal(report.deterministicCoverage.writes.unsafeMultipleMatch, 0);
  assert.equal(report.deterministicCoverage.surfaces.length, MYSQL_CAS_SURFACE_DEFINITIONS.length);
  assert.ok(report.deterministicCoverage.evidenceSamples.length > 0);

  for (const evidence of report.deterministicCoverage.evidenceSamples) {
    assert.equal(evidence.boundary, MYSQL_CAS_BOUNDARY);
    assert.equal(evidence.adapter, MYSQL_CAS_ADAPTER);
    assert.equal(evidence.engine, 'mysql');
    assert.equal(evidence.operation, 'update');
    assert.equal(evidence.nullSafePredicate, true);
    assert.match(evidence.expectedResourceHash, /^[a-f0-9]{64}$/);
    assert.match(evidence.expectedStorageHash, /^[a-f0-9]{64}$/);
    assert.match(evidence.plannedStorageHash, /^[a-f0-9]{64}$/);
    assert.match(evidence.observedStorageHash, /^[a-f0-9]{64}$/);
    assert.match(evidence.sqlShapeHash, /^[a-f0-9]{64}$/);
  }
}

function buildSupportOnlyStoragePerformanceProof(report, iterations) {
  const storageCountsMatch = report.resources.storage.guardedWritesAttempted
    === (MYSQL_CAS_SURFACE_DEFINITIONS.length * iterations * 3) + (uniqueGuardSurfaceCount * iterations)
    && report.resources.storage.appliedWrites === MYSQL_CAS_SURFACE_DEFINITIONS.length * iterations
    && report.resources.storage.staleAtWriteWrites === MYSQL_CAS_SURFACE_DEFINITIONS.length * iterations
    && report.resources.storage.absentAtWriteWrites === MYSQL_CAS_SURFACE_DEFINITIONS.length * iterations
    && report.resources.storage.duplicateKeyRejectedWrites === uniqueGuardSurfaceCount * iterations
    && report.resources.storage.unsafeMultipleMatchWrites === 0;
  const proof = {
    rppId: 'RPP-0741',
    variant: 3,
    supportOnly: true,
    productionBacked: false,
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    storagePerformance: {
      benchmarkId: report.benchmark,
      mode: report.mode,
      runtimeReported: hasRuntimeReport(report),
      resourcesReported: hasResourceReport(report),
      passFailGatesReported: hasPassFailGateReport(report),
      boundary: report.resources.storage.boundary,
      adapter: report.resources.storage.adapter,
      engine: report.resources.storage.engine,
      guardedWritesAttempted: report.resources.storage.guardedWritesAttempted,
      appliedWrites: report.resources.storage.appliedWrites,
      staleAtWriteWrites: report.resources.storage.staleAtWriteWrites,
      absentAtWriteWrites: report.resources.storage.absentAtWriteWrites,
      duplicateKeyRejectedWrites: report.resources.storage.duplicateKeyRejectedWrites,
      unsafeMultipleMatchWrites: report.resources.storage.unsafeMultipleMatchWrites,
      sqlShapeCount: report.resources.sql.singleStatementShapes,
      productionStorageDurability: 'not-claimed',
    },
    gates: [],
  };
  proof.gates = [
    localGate('benchmark-command-reports-runtime-resources-gates',
      proof.storagePerformance.runtimeReported
        && proof.storagePerformance.resourcesReported
        && proof.storagePerformance.passFailGatesReported,
      {
        runtimeReported: proof.storagePerformance.runtimeReported,
        resourcesReported: proof.storagePerformance.resourcesReported,
        gateCount: report.gates.length,
      }),
    localGate('complete-storage-performance-report',
      storageCountsMatch && report.resources.sql.singleStatementShapes === MYSQL_CAS_SURFACE_DEFINITIONS.length,
      {
        guardedWritesAttempted: report.resources.storage.guardedWritesAttempted,
        sqlShapeCount: report.resources.sql.singleStatementShapes,
      }),
    localGate('deterministic-cas-storage-guard-coverage',
      report.ok
        && report.deterministicCoverage.failures.length === 0
        && gateById(report, 'deterministic-guard-behavior').status === 'pass'
        && gateById(report, 'applied-and-stale-outcomes').status === 'pass'
        && gateById(report, 'duplicate-key-guard').status === 'pass',
      {
        appliedWrites: report.resources.storage.appliedWrites,
        staleAtWriteWrites: report.resources.storage.staleAtWriteWrites,
        absentAtWriteWrites: report.resources.storage.absentAtWriteWrites,
      }),
    localGate('hash-only-storage-performance-evidence',
      gateById(report, 'hash-only-evidence').status === 'pass' && !containsRawOrPrivateEvidence(report),
      {
        evidenceSamples: report.deterministicCoverage.evidenceSamples.length,
        rawValueEvidenceLeaks: report.deterministicCoverage.rawValueEvidenceLeaks,
      }),
    localGate('support-only-release-no-go',
      proof.supportOnly
        && !proof.productionBacked
        && proof.finalReleaseStatus === 'NO-GO'
        && proof.integrationRecommendation === 'NO-GO',
      {
        productionBacked: proof.productionBacked,
        finalReleaseStatus: proof.finalReleaseStatus,
      }),
  ];
  return proof;
}

function hasRuntimeReport(report) {
  return report.runtime
    && typeof report.runtime.generatedAt === 'string'
    && typeof report.runtime.durationMs === 'number'
    && report.runtime.mysqlRuntime
    && typeof report.runtime.mysqlRuntime.status === 'string';
}

function hasResourceReport(report) {
  return report.resources
    && report.resources.process
    && report.resources.storage
    && report.resources.sql
    && typeof report.resources.process.heapUsedBytes === 'number'
    && typeof report.resources.storage.guardedWritesAttempted === 'number'
    && typeof report.resources.sql.singleStatementShapes === 'number';
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

function assertNoRawOrPrivateEvidence(value) {
  assert.equal(containsRawOrPrivateEvidence(value), false);
}

function containsRawOrPrivateEvidence(value) {
  const serialized = JSON.stringify(value);
  const lower = serialized.toLowerCase();
  return [
    'base-title-',
    'planned-title-',
    'drift-title-',
    'base-value-',
    'planned-value-',
    'drift-value-',
    'payload-json-',
    'release-payload-',
    'duplicate-value-',
    'mysql://',
    'http://',
    'https://',
    'bearer ',
  ].some((token) => lower.includes(token));
}
