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
const fixedNow = new Date('2026-05-31T12:00:00.000Z');

test('RPP-0742 variant 3 rejects generated stale SQLite compare-column states', {
  skip: sqliteAvailable ? false : 'node:sqlite is unavailable in this Node.js runtime',
}, () => {
  let generatedStaleCases = 0;

  SQLITE_CAS_SURFACE_DEFINITIONS.forEach((surface, surfaceIndex) => {
    const staleColumns = surface.compareColumns.filter((column) => !surface.keyColumns.includes(column));
    assert.ok(staleColumns.length > 0, `${surface.id} should expose stale compare columns`);

    staleColumns.forEach((column, columnIndex) => {
      const fixture = createSqliteCasFixture(surface, 742_000 + (surfaceIndex * 100) + columnIndex);
      const staleStorage = driftStorageColumn(fixture.expectedStorage, column, generatedStaleCases);

      withDatabase(surface, [staleStorage], (database) => {
        const staleWrite = applySqliteCasWriteGuard({
          database,
          surface,
          expectedResource: fixture.expectedResource,
          expectedStorage: fixture.expectedStorage,
          nextStorage: fixture.nextStorage,
        });
        const afterWrite = readSqliteCasStorageByKey(database, surface, fixture.expectedStorage);

        assert.equal(staleWrite.applied, false, `${surface.id}.${column} stale state should be refused`);
        assert.equal(staleWrite.rowsAffected, 0, `${surface.id}.${column} stale state should affect zero rows`);
        assert.equal(staleWrite.storageGuard.outcome, 'stale-at-write');
        assert.deepEqual(afterWrite, staleStorage, `${surface.id}.${column} stale row should not be mutated`);
        assert.equal(
          staleWrite.storageGuard.observedStorageHash,
          digest(pickSqliteCasColumns(staleStorage, staleWrite.storageGuard.comparedColumns)),
        );
        assertGuardEvidenceIsHashOnly(staleWrite.storageGuard);
      });

      generatedStaleCases += 1;
    });
  });

  assert.equal(
    generatedStaleCases,
    SQLITE_CAS_SURFACE_DEFINITIONS.reduce(
      (total, surface) => total + surface.compareColumns.filter((column) => !surface.keyColumns.includes(column)).length,
      0,
    ),
  );
});

test('RPP-0742 variant 3 refuses stale replay and absent SQLite storage across all surfaces', {
  skip: sqliteAvailable ? false : 'node:sqlite is unavailable in this Node.js runtime',
}, () => {
  SQLITE_CAS_SURFACE_DEFINITIONS.forEach((surface, surfaceIndex) => {
    const fixture = createSqliteCasFixture(surface, 742_500 + surfaceIndex);

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
      assert.equal(success.rowsAffected, 1, `${surface.id} matching write should affect one row`);
      assert.equal(success.storageGuard.outcome, 'applied');
      assert.deepEqual(afterSuccess, fixture.nextStorage);
      assertGuardEvidenceIsHashOnly(success.storageGuard);

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
      assert.deepEqual(afterReplay, afterSuccess, `${surface.id} stale replay should leave committed storage unchanged`);
      assert.equal(
        staleReplay.storageGuard.observedStorageHash,
        digest(pickSqliteCasColumns(afterSuccess, staleReplay.storageGuard.comparedColumns)),
      );
      assertGuardEvidenceIsHashOnly(staleReplay.storageGuard);
    });

    withDatabase(surface, [], (database) => {
      const absentWrite = applySqliteCasWriteGuard({
        database,
        surface,
        expectedResource: fixture.expectedResource,
        expectedStorage: fixture.expectedStorage,
        nextStorage: fixture.nextStorage,
      });
      const afterAbsent = readSqliteCasStorageByKey(database, surface, fixture.expectedStorage);

      assert.equal(absentWrite.applied, false, `${surface.id} absent storage should be refused`);
      assert.equal(absentWrite.rowsAffected, 0, `${surface.id} absent storage should affect zero rows`);
      assert.equal(absentWrite.storageGuard.outcome, 'stale-at-write');
      assert.equal(afterAbsent, ABSENT);
      assert.equal(absentWrite.storageGuard.observedStorageHash, digest(ABSENT));
      assertGuardEvidenceIsHashOnly(absentWrite.storageGuard);
    });
  });
});

test('RPP-0742 variant 3 records local SQLite storage performance proof with bounded gates', {
  skip: sqliteAvailable ? false : 'node:sqlite is unavailable in this Node.js runtime',
}, async () => {
  const iterations = 4;
  const report = await runSqliteCasWriteGuardBenchmark({
    iterations,
    now: fixedNow,
    maxDurationMs: 100_000,
    maxHeapUsedBytes: 1024 * 1024 * 1024,
    loadSqliteRuntime: simulatedSqliteRuntime,
  });
  const expectedPerOutcome = SQLITE_CAS_SURFACE_DEFINITIONS.length * iterations;

  assert.equal(report.rppId, 'RPP-0702');
  assert.equal(report.benchmark, SQLITE_CAS_BENCHMARK_ID);
  assert.equal(report.ok, true);
  assert.equal(report.mode, 'sqlite-runtime-guarded-writes');
  assert.equal(report.runtime.generatedAt, fixedNow.toISOString());
  assert.equal(report.runtime.sqliteRuntime.status, 'available');
  assert.equal(report.runtime.sqliteRuntime.sqliteVersion, 'rpp-0742-focused');
  assert.equal(report.resources.storage.boundary, SQLITE_CAS_BOUNDARY);
  assert.equal(report.resources.storage.engine, 'sqlite');
  assert.equal(report.resources.storage.guardedWritesAttempted, expectedPerOutcome * 3);
  assert.equal(report.resources.storage.appliedWrites, expectedPerOutcome);
  assert.equal(report.resources.storage.staleAtWriteWrites, expectedPerOutcome);
  assert.equal(report.resources.storage.absentAtWriteWrites, expectedPerOutcome);
  assert.equal(report.resources.storage.unsafeMultipleMatchWrites, 0);
  assert.equal(report.resources.sqlite.databasesOpened, expectedPerOutcome * 3);
  assert.equal(report.resources.sql.singleStatementShapes, SQLITE_CAS_SURFACE_DEFINITIONS.length);
  assert.equal(typeof report.resources.process.heapUsedBytes, 'number');
  assert.equal(typeof report.resources.process.userCpuMs, 'number');
  assert.equal(report.deterministicCoverage.failures.length, 0);
  assert.equal(report.deterministicCoverage.rawValueEvidenceLeaks, 0);
  assert.deepEqual(report.gates.map((gate) => gate.status), ['pass', 'pass', 'pass', 'pass', 'pass', 'pass']);

  for (const surface of report.deterministicCoverage.surfaces) {
    assert.equal(surface.applied, iterations);
    assert.equal(surface.staleAtWrite, iterations);
    assert.equal(surface.absentAtWrite, iterations);
  }
  for (const evidence of report.deterministicCoverage.evidenceSamples) {
    assertGuardEvidenceIsHashOnly(evidence);
  }
});

function simulatedSqliteRuntime() {
  return {
    DatabaseSync,
    report: {
      status: 'available',
      unavailableCapabilities: [],
      detail: 'RPP-0742 focused local in-memory SQLite runtime',
      sqliteVersion: 'rpp-0742-focused',
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

function driftStorageColumn(storage, column, salt) {
  const value = storage[column];
  return {
    ...storage,
    [column]: typeof value === 'number'
      ? value + 9_742 + salt
      : `${value ?? 'null'}-rpp-0742-stale-${salt}`,
  };
}

function assertGuardEvidenceIsHashOnly(evidence) {
  assert.match(evidence.expectedResourceHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.expectedStorageHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.plannedStorageHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.observedStorageHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.sqlShapeHash, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(evidence), /sqlite-(?:base|planned|drift|payload|release)/);

  for (const rawField of ['option_value', 'post_content', 'meta_value', 'payload_json']) {
    assert.ok(!Object.hasOwn(evidence, rawField), `storage guard evidence exposed raw field ${rawField}`);
  }
}
