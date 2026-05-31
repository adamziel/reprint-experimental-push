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
import { digest } from '../src/stable-json.js';
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
const fixedNow = new Date('2026-05-31T18:00:00.000Z');

test('RPP-0762 variant 4 rejects multi-column stale SQLite storage states', {
  skip: sqliteAvailable ? false : 'node:sqlite is unavailable in this Node.js runtime',
}, () => {
  let staleCaseCount = 0;
  const observedStaleHashes = new Set();
  const sqlShapeHashes = new Set();

  SQLITE_CAS_SURFACE_DEFINITIONS.forEach((surface, surfaceIndex) => {
    const fixture = createSqliteCasFixture(surface, 762_000 + surfaceIndex);
    const staleStorage = createVariant4StaleStorage(surface, fixture.expectedStorage, surfaceIndex);
    const comparedColumns = [...new Set([...surface.keyColumns, ...surface.compareColumns])];

    assert.notDeepEqual(
      pickSqliteCasColumns(staleStorage, comparedColumns),
      pickSqliteCasColumns(fixture.expectedStorage, comparedColumns),
      `${surface.id} fixture should create a stale compared-column snapshot`,
    );

    withDatabase(surface, [staleStorage], (database) => {
      const staleWrite = applySqliteCasWriteGuard({
        database,
        surface,
        expectedResource: fixture.expectedResource,
        expectedStorage: fixture.expectedStorage,
        nextStorage: fixture.nextStorage,
      });
      const afterWrite = readSqliteCasStorageByKey(database, surface, fixture.expectedStorage);

      assert.equal(staleWrite.applied, false, `${surface.id} stale state should be refused`);
      assert.equal(staleWrite.rowsAffected, 0, `${surface.id} stale state should affect zero rows`);
      assert.equal(staleWrite.storageGuard.rowsAffected, 0);
      assert.equal(staleWrite.storageGuard.outcome, 'stale-at-write');
      assert.deepEqual(afterWrite, staleStorage, `${surface.id} stale row should remain unchanged`);
      assert.equal(
        staleWrite.storageGuard.expectedStorageHash,
        digest(pickSqliteCasColumns(fixture.expectedStorage, staleWrite.storageGuard.comparedColumns)),
      );
      assert.equal(
        staleWrite.storageGuard.plannedStorageHash,
        digest(pickSqliteCasColumns(fixture.nextStorage, surface.setColumns)),
      );
      assert.equal(
        staleWrite.storageGuard.observedStorageHash,
        digest(pickSqliteCasColumns(staleStorage, staleWrite.storageGuard.comparedColumns)),
      );
      assert.notEqual(
        staleWrite.storageGuard.observedStorageHash,
        staleWrite.storageGuard.expectedStorageHash,
        `${surface.id} stale observed hash should differ from the expected snapshot hash`,
      );
      assertGuardEvidenceIsHashOnly(staleWrite.storageGuard);

      observedStaleHashes.add(staleWrite.storageGuard.observedStorageHash);
      sqlShapeHashes.add(staleWrite.storageGuard.sqlShapeHash);
    });

    staleCaseCount += 1;
  });

  assert.equal(staleCaseCount, SQLITE_CAS_SURFACE_DEFINITIONS.length);
  assert.equal(observedStaleHashes.size, SQLITE_CAS_SURFACE_DEFINITIONS.length);
  assert.equal(sqlShapeHashes.size, SQLITE_CAS_SURFACE_DEFINITIONS.length);
});

test('RPP-0762 variant 4 records count-only local SQLite guard proof', {
  skip: sqliteAvailable ? false : 'node:sqlite is unavailable in this Node.js runtime',
}, async () => {
  const iterations = 3;
  const report = await runSqliteCasWriteGuardBenchmark({
    iterations,
    now: fixedNow,
    maxDurationMs: 100_000,
    maxHeapUsedBytes: 1024 * 1024 * 1024,
    loadSqliteRuntime: simulatedSqliteRuntime,
  });
  const expectedPerOutcome = SQLITE_CAS_SURFACE_DEFINITIONS.length * iterations;
  const countOnlyCoverageDigest = digest({
    attempted: report.resources.storage.guardedWritesAttempted,
    applied: report.resources.storage.appliedWrites,
    staleAtWrite: report.resources.storage.staleAtWriteWrites,
    absentAtWrite: report.resources.storage.absentAtWriteWrites,
    unsafeMultipleMatch: report.resources.storage.unsafeMultipleMatchWrites,
    surfaces: report.deterministicCoverage.surfaces.map((surface) => ({
      applied: surface.applied,
      staleAtWrite: surface.staleAtWrite,
      absentAtWrite: surface.absentAtWrite,
      keyColumnCount: surface.keyColumns.length,
      setColumnCount: surface.setColumns.length,
      comparedColumnCount: surface.comparedColumns.length,
      sqlShapeHash: surface.sqlShapeHash,
    })),
  });

  assert.equal(report.rppId, 'RPP-0702');
  assert.equal(report.benchmark, SQLITE_CAS_BENCHMARK_ID);
  assert.equal(report.ok, true);
  assert.equal(report.mode, 'sqlite-runtime-guarded-writes');
  assert.equal(report.runtime.generatedAt, fixedNow.toISOString());
  assert.equal(report.runtime.sqliteRuntime.status, 'available');
  assert.equal(report.runtime.sqliteRuntime.sqliteVersion, 'rpp-0762-focused');
  assert.equal(report.resources.storage.boundary, SQLITE_CAS_BOUNDARY);
  assert.equal(report.resources.storage.engine, 'sqlite');
  assert.equal(report.resources.storage.guardedWritesAttempted, expectedPerOutcome * 3);
  assert.equal(report.resources.storage.appliedWrites, expectedPerOutcome);
  assert.equal(report.resources.storage.staleAtWriteWrites, expectedPerOutcome);
  assert.equal(report.resources.storage.absentAtWriteWrites, expectedPerOutcome);
  assert.equal(report.resources.storage.unsafeMultipleMatchWrites, 0);
  assert.equal(report.resources.sqlite.databasesOpened, expectedPerOutcome * 3);
  assert.equal(report.resources.sql.singleStatementShapes, SQLITE_CAS_SURFACE_DEFINITIONS.length);
  assert.equal(report.deterministicCoverage.failures.length, 0);
  assert.equal(report.deterministicCoverage.rawValueEvidenceLeaks, 0);
  assert.deepEqual(report.gates.map((gate) => gate.status), ['pass', 'pass', 'pass', 'pass', 'pass', 'pass']);
  assert.match(countOnlyCoverageDigest, /^[a-f0-9]{64}$/);

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
      detail: 'RPP-0762 focused local in-memory SQLite runtime',
      sqliteVersion: 'rpp-0762-focused',
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

function createVariant4StaleStorage(surface, expectedStorage, surfaceIndex) {
  const staleStorage = { ...expectedStorage };

  for (const column of surface.compareColumns) {
    if (!surface.keyColumns.includes(column)) {
      staleStorage[column] = staleValue(staleStorage[column], column, surfaceIndex);
    }
  }

  return staleStorage;
}

function staleValue(value, column, surfaceIndex) {
  if (typeof value === 'number') {
    return value + 76_200 + surfaceIndex + column.length;
  }
  return `${value ?? 'null'}-rpp-0762-v4-stale-${surfaceIndex}-${column}`;
}

function assertGuardEvidenceIsHashOnly(evidence) {
  assert.match(evidence.expectedResourceHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.expectedStorageHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.plannedStorageHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.observedStorageHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.sqlShapeHash, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(evidence), /sqlite-(?:base|planned|drift|payload|release)|rpp-0762-v4-stale/);

  for (const rawField of ['option_value', 'post_content', 'meta_value', 'payload_json']) {
    assert.ok(!Object.hasOwn(evidence, rawField), `storage guard evidence exposed raw field ${rawField}`);
  }
}
