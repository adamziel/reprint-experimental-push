import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SQLITE_CAS_BOUNDARY,
  SQLITE_CAS_SURFACE_DEFINITIONS,
  applySqliteCasWriteGuard,
  createSqliteCasFixture,
  createSqliteCasFixtureTable,
  insertSqliteCasFixtureRow,
  pickSqliteCasColumns,
  readSqliteCasStorageByKey,
} from '../src/sqlite-cas-write-guard.js';
import { ABSENT, digest } from '../src/stable-json.js';
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

const sqliteAvailable = DatabaseSync !== null;
const fixedNow = new Date('2026-05-31T00:00:00.000Z');

test('RPP-0722 variant 2 applies matching SQLite storage exactly once and refuses stale writes', {
  skip: sqliteAvailable ? false : 'node:sqlite is unavailable in this Node.js runtime',
}, () => {
  SQLITE_CAS_SURFACE_DEFINITIONS.forEach((surface, index) => {
    const fixture = createSqliteCasFixture(surface, 7220 + index);

    withDatabase(surface, [fixture.expectedStorage], (database) => {
      const success = applySqliteCasWriteGuard({
        database,
        surface,
        expectedResource: fixture.expectedResource,
        expectedStorage: fixture.expectedStorage,
        nextStorage: fixture.nextStorage,
      });
      const afterSuccess = readSqliteCasStorageByKey(database, surface, fixture.expectedStorage);

      assert.equal(success.applied, true, `${surface.id} matching write should apply`);
      assert.equal(success.rowsAffected, 1, `${surface.id} matching write should affect exactly one row`);
      assert.equal(success.storageGuard.outcome, 'applied');
      assert.equal(success.storageGuard.rowsAffected, 1);
      assert.deepEqual(afterSuccess, fixture.nextStorage);

      const staleReplay = applySqliteCasWriteGuard({
        database,
        surface,
        expectedResource: fixture.expectedResource,
        expectedStorage: fixture.expectedStorage,
        nextStorage: fixture.driftedStorage,
      });
      const afterReplay = readSqliteCasStorageByKey(database, surface, fixture.expectedStorage);

      assert.equal(staleReplay.applied, false, `${surface.id} stale replay should be refused`);
      assert.equal(staleReplay.rowsAffected, 0, `${surface.id} stale replay should affect zero rows`);
      assert.equal(staleReplay.storageGuard.outcome, 'stale-at-write');
      assert.deepEqual(afterReplay, afterSuccess, `${surface.id} stale replay should not mutate storage`);
      assertGuardEvidenceIsHashOnly(success.storageGuard);
      assertGuardEvidenceIsHashOnly(staleReplay.storageGuard);
    });

    withDatabase(surface, [fixture.driftedStorage], (database) => {
      const staleWrite = applySqliteCasWriteGuard({
        database,
        surface,
        expectedResource: fixture.expectedResource,
        expectedStorage: fixture.expectedStorage,
        nextStorage: fixture.nextStorage,
      });
      const row = readSqliteCasStorageByKey(database, surface, fixture.expectedStorage);

      assert.equal(staleWrite.applied, false, `${surface.id} drifted storage should be refused`);
      assert.equal(staleWrite.rowsAffected, 0, `${surface.id} drifted storage should affect zero rows`);
      assert.equal(staleWrite.storageGuard.outcome, 'stale-at-write');
      assert.deepEqual(pickSqliteCasColumns(row, surface.setColumns), pickSqliteCasColumns(fixture.driftedStorage, surface.setColumns));
      assert.equal(
        staleWrite.storageGuard.observedStorageHash,
        digest(pickSqliteCasColumns(fixture.driftedStorage, staleWrite.storageGuard.comparedColumns)),
      );
      assertGuardEvidenceIsHashOnly(staleWrite.storageGuard);
    });

    withDatabase(surface, [], (database) => {
      const absentWrite = applySqliteCasWriteGuard({
        database,
        surface,
        expectedResource: fixture.expectedResource,
        expectedStorage: fixture.expectedStorage,
        nextStorage: fixture.nextStorage,
      });
      const row = readSqliteCasStorageByKey(database, surface, fixture.expectedStorage);

      assert.equal(absentWrite.applied, false, `${surface.id} absent storage should be refused`);
      assert.equal(absentWrite.rowsAffected, 0, `${surface.id} absent storage should affect zero rows`);
      assert.equal(absentWrite.storageGuard.outcome, 'stale-at-write');
      assert.equal(row, ABSENT);
      assertGuardEvidenceIsHashOnly(absentWrite.storageGuard);
    });
  });
});

test('RPP-0722 variant 2 keeps SQLite benchmark gates deterministic for passing and failing budgets', {
  skip: sqliteAvailable ? false : 'node:sqlite is unavailable in this Node.js runtime',
}, async () => {
  const passOptions = {
    iterations: 2,
    now: fixedNow,
    maxDurationMs: 100_000,
    maxHeapUsedBytes: 1024 * 1024 * 1024,
    loadSqliteRuntime: simulatedSqliteRuntime,
  };
  const firstPass = await runSqliteCasWriteGuardBenchmark(passOptions);
  const secondPass = await runSqliteCasWriteGuardBenchmark(passOptions);

  assert.equal(firstPass.rppId, 'RPP-0702');
  assert.equal(firstPass.benchmark, SQLITE_CAS_BENCHMARK_ID);
  assert.equal(firstPass.ok, true);
  assert.equal(secondPass.ok, true);
  assert.deepEqual(gateStatuses(firstPass), gateStatuses(secondPass));
  assert.deepEqual(gateStatuses(firstPass).map((gate) => gate.status), ['pass', 'pass', 'pass', 'pass', 'pass', 'pass']);

  const expectedPerOutcome = SQLITE_CAS_SURFACE_DEFINITIONS.length * passOptions.iterations;
  assert.equal(firstPass.mode, 'sqlite-runtime-guarded-writes');
  assert.equal(firstPass.runtime.generatedAt, fixedNow.toISOString());
  assert.equal(firstPass.runtime.sqliteRuntime.status, 'available');
  assert.equal(firstPass.runtime.sqliteRuntime.sqliteVersion, 'rpp-0722-focused');
  assert.equal(firstPass.resources.storage.boundary, SQLITE_CAS_BOUNDARY);
  assert.equal(firstPass.resources.storage.engine, 'sqlite');
  assert.equal(firstPass.resources.storage.guardedWritesAttempted, expectedPerOutcome * 3);
  assert.equal(firstPass.resources.storage.appliedWrites, expectedPerOutcome);
  assert.equal(firstPass.resources.storage.staleAtWriteWrites, expectedPerOutcome);
  assert.equal(firstPass.resources.storage.absentAtWriteWrites, expectedPerOutcome);
  assert.equal(firstPass.resources.storage.unsafeMultipleMatchWrites, 0);
  assert.equal(firstPass.resources.sqlite.databasesOpened, expectedPerOutcome * 3);
  assert.ok(firstPass.runtime.durationMs <= passOptions.maxDurationMs);
  assert.ok(firstPass.resources.process.heapUsedBytes <= passOptions.maxHeapUsedBytes);
  assert.equal(firstPass.deterministicCoverage.failures.length, 0);
  assert.equal(firstPass.deterministicCoverage.rawValueEvidenceLeaks, 0);

  const failOptions = {
    ...passOptions,
    iterations: 1,
    maxHeapUsedBytes: 1,
  };
  const firstFail = await runSqliteCasWriteGuardBenchmark(failOptions);
  const secondFail = await runSqliteCasWriteGuardBenchmark(failOptions);

  assert.equal(firstFail.ok, false);
  assert.equal(secondFail.ok, false);
  assert.deepEqual(gateStatuses(firstFail), gateStatuses(secondFail));
  assert.equal(gateById(firstFail, 'runtime-resource-budget').status, 'fail');
  assert.ok(gateById(firstFail, 'runtime-resource-budget').metrics.heapUsedBytes > failOptions.maxHeapUsedBytes);
  assert.deepEqual(
    gateStatuses(firstFail).filter((gate) => gate.id !== 'runtime-resource-budget').map((gate) => gate.status),
    ['pass', 'pass', 'pass', 'pass', 'pass'],
  );
});

function simulatedSqliteRuntime() {
  return {
    DatabaseSync,
    report: {
      status: 'available',
      unavailableCapabilities: [],
      detail: 'RPP-0722 focused local in-memory SQLite runtime',
      sqliteVersion: 'rpp-0722-focused',
    },
  };
}

function withDatabase(surface, rows, callback) {
  const database = new DatabaseSync(':memory:');
  try {
    createSqliteCasFixtureTable(database, surface);
    for (const row of rows) {
      insertSqliteCasFixtureRow(database, surface, row);
    }
    return callback(database);
  } finally {
    database.close();
  }
}

function gateStatuses(report) {
  return report.gates.map((gate) => ({
    id: gate.id,
    status: gate.status,
  }));
}

function gateById(report, id) {
  const gate = report.gates.find((entry) => entry.id === id);
  assert.ok(gate, `missing gate ${id}`);
  return gate;
}

function assertGuardEvidenceIsHashOnly(evidence) {
  assert.match(evidence.expectedResourceHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.expectedStorageHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.plannedStorageHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.observedStorageHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.sqlShapeHash, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(evidence), /sqlite-(?:base|planned|drift|payload|release)/);
}
