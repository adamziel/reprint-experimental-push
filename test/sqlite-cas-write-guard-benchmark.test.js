import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SQLITE_CAS_BOUNDARY,
  SQLITE_CAS_SURFACE_DEFINITIONS,
  buildSqliteCasUpdateShape,
} from '../src/sqlite-cas-write-guard.js';
import {
  SQLITE_CAS_BENCHMARK_ID,
  runSqliteCasWriteGuardBenchmark,
} from '../scripts/bench/sqlite-cas-write-guard.js';

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const fixedNow = new Date('2026-05-29T00:00:00.000Z');
const sqliteAvailable = DatabaseSync !== null;
const simulatedSqliteRuntime = () => ({
  DatabaseSync,
  report: {
    status: 'available',
    unavailableCapabilities: [],
    detail: 'simulated focused test: node:sqlite DatabaseSync available',
    sqliteVersion: 'focused-test',
  },
});

test('SQLite CAS benchmark reports runtime, resources, and pass/fail gates', {
  skip: sqliteAvailable ? false : 'node:sqlite is unavailable in this Node.js runtime',
}, async () => {
  const report = await runSqliteCasWriteGuardBenchmark({
    iterations: 3,
    now: fixedNow,
    loadSqliteRuntime: simulatedSqliteRuntime,
  });

  assert.equal(report.rppId, 'RPP-0702');
  assert.equal(report.benchmark, SQLITE_CAS_BENCHMARK_ID);
  assert.equal(report.ok, true);
  assert.equal(report.mode, 'sqlite-runtime-guarded-writes');
  assert.equal(report.runtime.generatedAt, fixedNow.toISOString());
  assert.equal(typeof report.runtime.durationMs, 'number');
  assert.ok(report.runtime.durationMs >= 0);
  assert.equal(report.runtime.sqliteRuntime.status, 'available');
  assert.equal(report.runtime.sqliteRuntime.sqliteVersion, 'focused-test');

  assert.equal(report.resources.storage.boundary, SQLITE_CAS_BOUNDARY);
  assert.equal(report.resources.storage.engine, 'sqlite');
  assert.equal(report.resources.storage.logicalTables, SQLITE_CAS_SURFACE_DEFINITIONS.length);
  assert.equal(report.resources.storage.guardedWritesAttempted, SQLITE_CAS_SURFACE_DEFINITIONS.length * 3 * 3);
  assert.equal(report.resources.storage.appliedWrites, SQLITE_CAS_SURFACE_DEFINITIONS.length * 3);
  assert.equal(report.resources.storage.staleAtWriteWrites, SQLITE_CAS_SURFACE_DEFINITIONS.length * 3);
  assert.equal(report.resources.storage.absentAtWriteWrites, SQLITE_CAS_SURFACE_DEFINITIONS.length * 3);
  assert.equal(report.resources.storage.unsafeMultipleMatchWrites, 0);
  assert.equal(report.resources.sqlite.databasesOpened, SQLITE_CAS_SURFACE_DEFINITIONS.length * 3 * 3);
  assert.equal(report.resources.sql.singleStatementShapes, SQLITE_CAS_SURFACE_DEFINITIONS.length);
  assert.equal(typeof report.resources.process.heapUsedBytes, 'number');
  assert.equal(typeof report.resources.process.userCpuMs, 'number');

  assert.ok(report.gates.length >= 6);
  assert.deepEqual([...new Set(report.gates.map((gate) => gate.status))], ['pass']);
  assert.ok(report.gates.some((gate) => gate.id === 'sqlite-runtime-available'));
  assert.ok(report.gates.some((gate) => gate.id === 'single-statement-null-safe-cas-shapes'));
  assert.ok(report.gates.some((gate) => gate.id === 'runtime-resource-budget'));
});

test('SQLite CAS benchmark records stale and absent write rejections without raw fixture evidence', {
  skip: sqliteAvailable ? false : 'node:sqlite is unavailable in this Node.js runtime',
}, async () => {
  const report = await runSqliteCasWriteGuardBenchmark({
    iterations: 1,
    now: fixedNow,
    loadSqliteRuntime: simulatedSqliteRuntime,
  });

  assert.equal(report.deterministicCoverage.failures.length, 0);
  for (const surface of report.deterministicCoverage.surfaces) {
    assert.equal(surface.applied, 1);
    assert.equal(surface.staleAtWrite, 1);
    assert.equal(surface.absentAtWrite, 1);
  }
  for (const evidence of report.deterministicCoverage.evidenceSamples) {
    assert.match(evidence.expectedResourceHash, /^[a-f0-9]{64}$/);
    assert.match(evidence.expectedStorageHash, /^[a-f0-9]{64}$/);
    assert.match(evidence.plannedStorageHash, /^[a-f0-9]{64}$/);
    assert.match(evidence.observedStorageHash, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(JSON.stringify(evidence), /sqlite-(?:base|planned|drift|payload|release)/);
  }
});

test('SQLite CAS benchmark shapes keep values out of SQL and compare every expected storage column', () => {
  for (const surface of SQLITE_CAS_SURFACE_DEFINITIONS) {
    const shape = buildSqliteCasUpdateShape(surface);

    assert.equal(shape.boundary, SQLITE_CAS_BOUNDARY);
    assert.equal(shape.singleStatement, true);
    assert.equal(shape.statementKind, 'UPDATE');
    assert.match(shape.sqlShape, /^UPDATE "[A-Za-z0-9_]+" SET /);
    assert.match(shape.sqlShape, / WHERE /);
    assert.match(shape.sqlShapeHash, /^[a-f0-9]{64}$/);

    for (const column of shape.comparedColumns) {
      assert.ok(shape.sqlShape.includes(`"${column}" IS ?`), `shape for ${surface.id} omits compared column ${column}`);
    }
    for (const rawToken of ['sqlite-base-value', 'sqlite-planned-value', 'sqlite-drift-value', 'sqlite-payload-json', 'sqlite-release-payload']) {
      assert.ok(!shape.sqlShape.includes(rawToken), `shape leaked raw fixture token ${rawToken}`);
    }
  }
});
