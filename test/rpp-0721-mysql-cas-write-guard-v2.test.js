import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MYSQL_CAS_BENCHMARK_ID,
  MYSQL_CAS_BOUNDARY,
  MYSQL_CAS_SURFACE_DEFINITIONS,
  runMysqlCasWriteGuardBenchmark,
} from '../scripts/bench/mysql-cas-write-guard.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const iterations = 4;
const mysqlUnavailableForVariant2 = () => ({
  status: 'unavailable',
  unavailableCapabilities: ['mysql-runtime-connection-settings'],
  detail: 'RPP-0721 variant 2 deterministic support proof: external MySQL connection intentionally not configured',
});
const requiredGateIds = [
  'deterministic-guard-behavior',
  'applied-and-stale-outcomes',
  'duplicate-key-guard',
  'single-statement-cas-shapes',
  'hash-only-evidence',
  'mysql-runtime-capability-recorded',
  'runtime-resource-budget',
];
const uniqueGuardSurfaceCount = MYSQL_CAS_SURFACE_DEFINITIONS
  .filter((surface) => surface.uniqueKeyColumns?.length).length;

test('RPP-0721 variant 2 MySQL CAS report exposes support-only deterministic guard evidence', () => {
  const report = runMysqlCasWriteGuardBenchmark({
    iterations,
    now: fixedNow,
    detectMysqlRuntime: mysqlUnavailableForVariant2,
  });

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0701');
  assert.equal(report.benchmark, MYSQL_CAS_BENCHMARK_ID);
  assert.equal(report.ok, true);
  assert.equal(report.mode, 'deterministic-no-mysql-runtime');

  assert.equal(report.runtime.benchmarkId, MYSQL_CAS_BENCHMARK_ID);
  assert.equal(report.runtime.generatedAt, fixedNow.toISOString());
  assertNonNegativeNumber(report.runtime.durationMs);
  assert.match(report.runtime.node, /^v\d+\.\d+\.\d+/);
  assert.equal(typeof report.runtime.platform, 'string');
  assert.equal(typeof report.runtime.arch, 'string');
  assert.ok(report.runtime.cpuCount > 0);
  assert.equal(report.runtime.mysqlRuntime.status, 'unavailable');
  assert.deepEqual(report.runtime.mysqlRuntime.unavailableCapabilities, ['mysql-runtime-connection-settings']);
  assert.match(report.runtime.mysqlRuntime.detail, /external MySQL connection intentionally not configured/);
  assert.equal(Object.hasOwn(report.runtime.mysqlRuntime, 'serverVersion'), false);
  assert.equal(Object.hasOwn(report.runtime.mysqlRuntime, 'connection'), false);

  assert.equal(report.resources.process.heapUsedBytes > 0, true);
  assertFiniteNumber(report.resources.process.heapDeltaBytes);
  assertNonNegativeNumber(report.resources.process.rssBytes);
  assertNonNegativeNumber(report.resources.process.userCpuMs);
  assertNonNegativeNumber(report.resources.process.systemCpuMs);
  assertNonNegativeNumber(report.resources.process.maxRSSKiB);

  assert.equal(report.resources.storage.boundary, MYSQL_CAS_BOUNDARY);
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

  const gatesById = new Map(report.gates.map((gate) => [gate.id, gate]));
  assert.deepEqual([...gatesById.keys()].sort(), [...requiredGateIds].sort());
  for (const id of requiredGateIds) {
    assert.equal(gatesById.get(id).status, 'pass', `${id} gate should pass`);
  }
  assert.deepEqual(gatesById.get('mysql-runtime-capability-recorded').metrics, {
    status: 'unavailable',
    unavailableCapabilities: ['mysql-runtime-connection-settings'],
  });
  assert.equal(gatesById.get('runtime-resource-budget').metrics.maxHeapUsedBytes, 268435456);

  assert.equal(report.deterministicCoverage.iterations, iterations);
  assert.deepEqual(report.deterministicCoverage.failures, []);
  assert.equal(report.deterministicCoverage.rawValueEvidenceLeaks, 0);
  assert.equal(report.deterministicCoverage.writes.staleAtWrite, MYSQL_CAS_SURFACE_DEFINITIONS.length * iterations);
  assert.equal(report.deterministicCoverage.writes.absentAtWrite, MYSQL_CAS_SURFACE_DEFINITIONS.length * iterations);
  assert.equal(report.deterministicCoverage.writes.unsafeMultipleMatch, 0);
  assert.equal(report.deterministicCoverage.surfaces.length, MYSQL_CAS_SURFACE_DEFINITIONS.length);
  for (const surface of report.deterministicCoverage.surfaces) {
    assert.equal(surface.applied, iterations);
    assert.equal(surface.staleAtWrite, iterations);
    assert.equal(surface.absentAtWrite, iterations);
    assert.match(surface.sqlShapeHash, /^[a-f0-9]{64}$/);
  }

  const staleSamples = report.deterministicCoverage.evidenceSamples
    .filter((sample) => sample.outcome === 'stale-at-write');
  assert.ok(staleSamples.length > 0);
  for (const sample of staleSamples) {
    assert.equal(sample.boundary, MYSQL_CAS_BOUNDARY);
    assert.equal(sample.engine, 'mysql');
    assert.equal(sample.rowsAffected, 0);
    assert.equal(sample.operation, 'update');
    assert.equal(sample.nullSafePredicate, true);
    assert.match(sample.expectedResourceHash, /^[a-f0-9]{64}$/);
    assert.match(sample.expectedStorageHash, /^[a-f0-9]{64}$/);
    assert.match(sample.plannedStorageHash, /^[a-f0-9]{64}$/);
    assert.match(sample.observedStorageHash, /^[a-f0-9]{64}$/);
    assert.match(sample.sqlShapeHash, /^[a-f0-9]{64}$/);
  }

  assertReportHasNoRawFixtureValues(report);
});

test('RPP-0721 variant 2 MySQL CAS report exposes fail gates without live MySQL', () => {
  const report = runMysqlCasWriteGuardBenchmark({
    iterations: 1,
    now: fixedNow,
    detectMysqlRuntime: mysqlUnavailableForVariant2,
    maxHeapUsedBytes: 1,
  });

  assert.equal(report.ok, false);
  assert.equal(report.mode, 'deterministic-no-mysql-runtime');
  assert.equal(report.runtime.mysqlRuntime.status, 'unavailable');

  const runtimeBudgetGate = gateById(report, 'runtime-resource-budget');
  assert.equal(runtimeBudgetGate.status, 'fail');
  assert.equal(runtimeBudgetGate.metrics.maxHeapUsedBytes, 1);
  assert.ok(runtimeBudgetGate.metrics.heapUsedBytes > 1);
  assertNonNegativeNumber(runtimeBudgetGate.metrics.durationMs);

  for (const id of requiredGateIds.filter((gateId) => gateId !== 'runtime-resource-budget')) {
    assert.equal(gateById(report, id).status, 'pass', `${id} gate should remain pass`);
  }
  assert.equal(report.resources.storage.staleAtWriteWrites, MYSQL_CAS_SURFACE_DEFINITIONS.length);
  assert.equal(report.deterministicCoverage.rawValueEvidenceLeaks, 0);
  assertReportHasNoRawFixtureValues(report);
});

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

function assertReportHasNoRawFixtureValues(report) {
  const serialized = JSON.stringify(report);
  for (const token of [
    'base-title-',
    'planned-title-',
    'drift-title-',
    'base-value-',
    'planned-value-',
    'drift-value-',
    'payload-json-',
    'release-payload-',
    'duplicate-value-',
  ]) {
    assert.equal(serialized.includes(token), false, `report leaked raw fixture token ${token}`);
  }
}
