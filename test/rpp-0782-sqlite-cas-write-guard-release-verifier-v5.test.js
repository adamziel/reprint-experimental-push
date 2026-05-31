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
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
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
const fixedNow = new Date('2026-05-31T20:00:00.000Z');
const sha256HexPattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const rawFixtureTokens = Object.freeze([
  'sqlite-base-title-',
  'sqlite-planned-title-',
  'sqlite-drift-title-',
  'sqlite-base-value-',
  'sqlite-planned-value-',
  'sqlite-drift-value-',
  'sqlite-payload-json-',
  'sqlite-release-payload-',
  'rpp-0782-v5-stale',
]);

test('RPP-0782 release verifier v5 rejects stale SQLite storage states with hash-only proof', {
  skip: sqliteAvailable ? false : 'node:sqlite is unavailable in this Node.js runtime',
}, () => {
  const proof = summarizeSqliteCasReleaseVerifierProof({
    now: fixedNow,
  });

  assert.equal(proof.rpp, 'RPP-0782');
  assert.equal(proof.evidenceSource, 'release-verifier-sqlite-cas-write-guard-v5');
  assert.equal(proof.status, 'support_only');
  assert.equal(proof.verdict, 'SQLITE_CAS_STALE_STORAGE_REJECTED');
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.releaseGate, 'NO-GO');
  assert.equal(proof.generatedAt, fixedNow.toISOString());
  assert.equal(proof.boundary.boundaryHash, digest(SQLITE_CAS_BOUNDARY));
  assert.equal(proof.boundary.surfaceCount, SQLITE_CAS_SURFACE_DEFINITIONS.length);
  assert.equal(proof.boundary.operationCount, 1);
  assert.equal(proof.guard.staleWriteAttempts, SQLITE_CAS_SURFACE_DEFINITIONS.length);
  assert.equal(proof.guard.rejectedStaleAtWrite, SQLITE_CAS_SURFACE_DEFINITIONS.length);
  assert.equal(proof.guard.appliedStaleWrites, 0);
  assert.equal(proof.guard.rowsAffectedByStaleWrites, 0);
  assert.equal(proof.guard.staleRowsMutated, 0);
  assert.equal(proof.guard.uniqueObservedStaleStorageHashes, SQLITE_CAS_SURFACE_DEFINITIONS.length);
  assert.equal(proof.guard.uniqueSqlShapeHashes, SQLITE_CAS_SURFACE_DEFINITIONS.length);
  assert.equal(proof.redaction.format, 'hash-count-only');
  assert.equal(proof.redaction.rawValuesIncluded, false);
  assert.equal(proof.redaction.rawFieldNamesIncluded, false);
  assert.equal(proof.redaction.checkedFixtureTokenCount, rawFixtureTokens.length);
  assert.equal(proof.surfaceProofs.length, SQLITE_CAS_SURFACE_DEFINITIONS.length);
  assert.match(proof.coverageHash, sha256EvidencePattern);
  assert.match(proof.proofHash, sha256EvidencePattern);

  for (const surfaceProof of proof.surfaceProofs) {
    assert.match(surfaceProof.surfaceHash, sha256HexPattern);
    assert.match(surfaceProof.expectedStorageHash, sha256HexPattern);
    assert.match(surfaceProof.plannedStorageHash, sha256HexPattern);
    assert.match(surfaceProof.observedStorageHash, sha256HexPattern);
    assert.match(surfaceProof.staleRowBeforeHash, sha256HexPattern);
    assert.match(surfaceProof.staleRowAfterHash, sha256HexPattern);
    assert.match(surfaceProof.sqlShapeHash, sha256HexPattern);
    assert.match(surfaceProof.guardEvidenceHash, sha256EvidencePattern);
    assert.equal(surfaceProof.appliedCount, 0);
    assert.equal(surfaceProof.rejectedStaleAtWriteCount, 1);
    assert.equal(surfaceProof.rowsAffected, 0);
    assert.equal(surfaceProof.staleRowMutatedCount, 0);
    assert.notEqual(surfaceProof.observedStorageHash, surfaceProof.expectedStorageHash);
    assert.equal(surfaceProof.staleRowAfterHash, surfaceProof.staleRowBeforeHash);
  }

  assertNoRawSqliteFixtureValues(proof, 'RPP-0782 release verifier proof');
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0782 SQLite CAS release verifier proof' }));
});

test('RPP-0782 release verifier v5 records deterministic SQLite CAS support counts', {
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
  const proof = summarizeBenchmarkReleaseVerifierProof(report);
  const expectedPerOutcome = SQLITE_CAS_SURFACE_DEFINITIONS.length * iterations;

  assert.equal(report.rppId, 'RPP-0702');
  assert.equal(report.benchmark, SQLITE_CAS_BENCHMARK_ID);
  assert.equal(report.ok, true);
  assert.equal(report.mode, 'sqlite-runtime-guarded-writes');
  assert.equal(report.runtime.generatedAt, fixedNow.toISOString());
  assert.equal(report.runtime.sqliteRuntime.status, 'available');
  assert.equal(report.runtime.sqliteRuntime.sqliteVersion, 'rpp-0782-release-verifier-v5');
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

  assert.equal(proof.rpp, 'RPP-0782');
  assert.equal(proof.evidenceSource, 'release-verifier-sqlite-cas-write-guard-benchmark-v5');
  assert.equal(proof.status, 'support_only');
  assert.equal(proof.verdict, 'SQLITE_CAS_BENCHMARK_COUNTS_HASH_ONLY');
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.releaseGate, 'NO-GO');
  assert.equal(proof.counts.guardedWritesAttempted, expectedPerOutcome * 3);
  assert.equal(proof.counts.appliedWrites, expectedPerOutcome);
  assert.equal(proof.counts.staleAtWriteWrites, expectedPerOutcome);
  assert.equal(proof.counts.absentAtWriteWrites, expectedPerOutcome);
  assert.equal(proof.counts.unsafeMultipleMatchWrites, 0);
  assert.equal(proof.gates.passCount, report.gates.length);
  assert.equal(proof.gates.failCount, 0);
  assert.equal(proof.redaction.rawValuesIncluded, false);
  assert.match(proof.countOnlyCoverageDigest, sha256EvidencePattern);
  assert.match(proof.gateSummaryHash, sha256EvidencePattern);
  assert.match(proof.proofHash, sha256EvidencePattern);

  for (const surface of proof.surfaceProofs) {
    assert.equal(surface.applied, iterations);
    assert.equal(surface.staleAtWrite, iterations);
    assert.equal(surface.absentAtWrite, iterations);
    assert.match(surface.surfaceHash, sha256HexPattern);
    assert.match(surface.sqlShapeHash, sha256HexPattern);
  }
  for (const evidence of report.deterministicCoverage.evidenceSamples) {
    assertGuardEvidenceIsHashOnly(evidence);
  }

  assertNoRawSqliteFixtureValues(proof, 'RPP-0782 benchmark release verifier proof');
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0782 SQLite CAS benchmark verifier proof' }));
});

function summarizeSqliteCasReleaseVerifierProof({ now }) {
  const surfaceProofs = [];
  let staleWriteAttempts = 0;
  let rejectedStaleAtWrite = 0;
  let appliedStaleWrites = 0;
  let rowsAffectedByStaleWrites = 0;
  let staleRowsMutated = 0;
  const observedStaleStorageHashes = new Set();
  const sqlShapeHashes = new Set();

  SQLITE_CAS_SURFACE_DEFINITIONS.forEach((surface, surfaceIndex) => {
    const fixture = createSqliteCasFixture(surface, 782_000 + surfaceIndex);
    const staleStorage = createVariant5StaleStorage(surface, fixture.expectedStorage, surfaceIndex);
    const comparedColumns = [...new Set([...surface.keyColumns, ...surface.compareColumns])];

    assert.notDeepEqual(
      pickSqliteCasColumns(staleStorage, comparedColumns),
      pickSqliteCasColumns(fixture.expectedStorage, comparedColumns),
      `${surface.id} fixture should create stale compared-column storage`,
    );

    const staleRowBeforeHash = digest(pickSqliteCasColumns(staleStorage, comparedColumns));

    withDatabase(surface, [staleStorage], (database) => {
      const staleWrite = applySqliteCasWriteGuard({
        database,
        surface,
        expectedResource: fixture.expectedResource,
        expectedStorage: fixture.expectedStorage,
        nextStorage: fixture.nextStorage,
      });
      const afterWrite = readSqliteCasStorageByKey(database, surface, fixture.expectedStorage);
      const staleRowAfterHash = digest(pickSqliteCasColumns(afterWrite, comparedColumns));
      const staleRowMutatedCount = staleRowAfterHash === staleRowBeforeHash ? 0 : 1;

      staleWriteAttempts += 1;
      rejectedStaleAtWrite += staleWrite.storageGuard.outcome === 'stale-at-write' && !staleWrite.applied ? 1 : 0;
      appliedStaleWrites += staleWrite.applied ? 1 : 0;
      rowsAffectedByStaleWrites += staleWrite.rowsAffected;
      staleRowsMutated += staleRowMutatedCount;
      observedStaleStorageHashes.add(staleWrite.storageGuard.observedStorageHash);
      sqlShapeHashes.add(staleWrite.storageGuard.sqlShapeHash);

      assert.equal(staleWrite.applied, false, `${surface.id} stale state should be refused`);
      assert.equal(staleWrite.rowsAffected, 0, `${surface.id} stale state should affect zero rows`);
      assert.equal(staleWrite.storageGuard.rowsAffected, 0);
      assert.equal(staleWrite.storageGuard.outcome, 'stale-at-write');
      assert.equal(staleRowMutatedCount, 0, `${surface.id} stale row should remain unchanged`);
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
      assert.notEqual(staleWrite.storageGuard.observedStorageHash, staleWrite.storageGuard.expectedStorageHash);
      assertGuardEvidenceIsHashOnly(staleWrite.storageGuard);

      surfaceProofs.push({
        surfaceHash: digest({
          logicalTable: surface.logicalTable,
          driver: surface.driver,
        }),
        keyColumnCount: surface.keyColumns.length,
        setColumnCount: surface.setColumns.length,
        comparedColumnCount: staleWrite.storageGuard.comparedColumns.length,
        appliedCount: staleWrite.applied ? 1 : 0,
        rejectedStaleAtWriteCount: staleWrite.storageGuard.outcome === 'stale-at-write' && !staleWrite.applied ? 1 : 0,
        rowsAffected: staleWrite.rowsAffected,
        staleRowMutatedCount,
        expectedStorageHash: staleWrite.storageGuard.expectedStorageHash,
        plannedStorageHash: staleWrite.storageGuard.plannedStorageHash,
        observedStorageHash: staleWrite.storageGuard.observedStorageHash,
        staleRowBeforeHash,
        staleRowAfterHash,
        sqlShapeHash: staleWrite.storageGuard.sqlShapeHash,
        guardEvidenceHash: `sha256:${digest(staleWrite.storageGuard)}`,
      });
    });
  });

  const proof = {
    schemaVersion: 1,
    rpp: 'RPP-0782',
    evidenceSource: 'release-verifier-sqlite-cas-write-guard-v5',
    status: 'support_only',
    verdict: 'SQLITE_CAS_STALE_STORAGE_REJECTED',
    productionBacked: false,
    releaseEligible: false,
    releaseGate: 'NO-GO',
    generatedAt: now.toISOString(),
    boundary: {
      boundaryHash: digest(SQLITE_CAS_BOUNDARY),
      adapterHash: digest('sqlite-single-statement-cas'),
      engineHash: digest('sqlite'),
      operationHash: digest('update'),
      surfaceCount: SQLITE_CAS_SURFACE_DEFINITIONS.length,
      operationCount: 1,
    },
    guard: {
      staleWriteAttempts,
      rejectedStaleAtWrite,
      appliedStaleWrites,
      rowsAffectedByStaleWrites,
      staleRowsMutated,
      uniqueObservedStaleStorageHashes: observedStaleStorageHashes.size,
      uniqueSqlShapeHashes: sqlShapeHashes.size,
    },
    redaction: {
      format: 'hash-count-only',
      rawValuesIncluded: false,
      rawFieldNamesIncluded: false,
      checkedFixtureTokenCount: rawFixtureTokens.length,
    },
    surfaceProofs,
  };

  return {
    ...proof,
    coverageHash: `sha256:${digest({
      boundary: proof.boundary,
      guard: proof.guard,
      surfaces: proof.surfaceProofs,
    })}`,
    proofHash: `sha256:${digest(proof)}`,
  };
}

function summarizeBenchmarkReleaseVerifierProof(report) {
  const proof = {
    schemaVersion: 1,
    rpp: 'RPP-0782',
    evidenceSource: 'release-verifier-sqlite-cas-write-guard-benchmark-v5',
    status: 'support_only',
    verdict: 'SQLITE_CAS_BENCHMARK_COUNTS_HASH_ONLY',
    productionBacked: false,
    releaseEligible: false,
    releaseGate: 'NO-GO',
    benchmarkHash: digest({
      benchmark: report.benchmark,
      mode: report.mode,
      generatedAt: report.runtime.generatedAt,
    }),
    counts: {
      iterations: report.deterministicCoverage.iterations,
      surfaceCount: report.deterministicCoverage.surfaces.length,
      guardedWritesAttempted: report.resources.storage.guardedWritesAttempted,
      appliedWrites: report.resources.storage.appliedWrites,
      staleAtWriteWrites: report.resources.storage.staleAtWriteWrites,
      absentAtWriteWrites: report.resources.storage.absentAtWriteWrites,
      unsafeMultipleMatchWrites: report.resources.storage.unsafeMultipleMatchWrites,
      databasesOpened: report.resources.sqlite.databasesOpened,
      singleStatementSqlShapes: report.resources.sql.singleStatementShapes,
      rawValueEvidenceLeaks: report.deterministicCoverage.rawValueEvidenceLeaks,
    },
    gates: {
      totalCount: report.gates.length,
      passCount: report.gates.filter((gate) => gate.status === 'pass').length,
      failCount: report.gates.filter((gate) => gate.status === 'fail').length,
    },
    redaction: {
      format: 'hash-count-only',
      rawValuesIncluded: false,
      rawFieldNamesIncluded: false,
    },
    surfaceProofs: report.deterministicCoverage.surfaces.map((surface) => ({
      surfaceHash: digest({
        logicalTable: surface.logicalTable,
        driver: surface.driver,
      }),
      keyColumnCount: surface.keyColumns.length,
      setColumnCount: surface.setColumns.length,
      comparedColumnCount: surface.comparedColumns.length,
      sqlShapeHash: surface.sqlShapeHash,
      applied: surface.applied,
      staleAtWrite: surface.staleAtWrite,
      absentAtWrite: surface.absentAtWrite,
    })),
  };

  return {
    ...proof,
    countOnlyCoverageDigest: `sha256:${digest({
      counts: proof.counts,
      gates: proof.gates,
      surfaces: proof.surfaceProofs,
    })}`,
    gateSummaryHash: `sha256:${digest(report.gates.map((gate) => ({
      id: gate.id,
      status: gate.status,
    })))}`,
    proofHash: `sha256:${digest(proof)}`,
  };
}

function simulatedSqliteRuntime() {
  return {
    DatabaseSync,
    report: {
      status: 'available',
      unavailableCapabilities: [],
      detail: 'RPP-0782 release verifier local in-memory SQLite runtime',
      sqliteVersion: 'rpp-0782-release-verifier-v5',
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

function createVariant5StaleStorage(surface, expectedStorage, surfaceIndex) {
  const staleStorage = { ...expectedStorage };

  surface.compareColumns.forEach((column, columnIndex) => {
    if (!surface.keyColumns.includes(column)) {
      staleStorage[column] = staleValue(staleStorage[column], surfaceIndex, columnIndex);
    }
  });

  return staleStorage;
}

function staleValue(value, surfaceIndex, columnIndex) {
  if (typeof value === 'number') {
    return value + 78_200 + (surfaceIndex * 100) + columnIndex;
  }
  return `${value ?? 'null'}-rpp-0782-v5-stale-${surfaceIndex}-${columnIndex}`;
}

function assertGuardEvidenceIsHashOnly(evidence) {
  assert.match(evidence.expectedResourceHash, sha256HexPattern);
  assert.match(evidence.expectedStorageHash, sha256HexPattern);
  assert.match(evidence.plannedStorageHash, sha256HexPattern);
  assert.match(evidence.observedStorageHash, sha256HexPattern);
  assert.match(evidence.sqlShapeHash, sha256HexPattern);
  assert.doesNotMatch(
    JSON.stringify(evidence),
    /sqlite-(?:base|planned|drift|payload|release)|rpp-0782-v5-stale/,
  );

  for (const rawField of ['option_value', 'post_content', 'meta_value', 'payload_json']) {
    assert.ok(!Object.hasOwn(evidence, rawField), `storage guard evidence exposed raw field ${rawField}`);
  }
}

function assertNoRawSqliteFixtureValues(value, label) {
  const serialized = JSON.stringify(value);
  for (const token of rawFixtureTokens) {
    assert.equal(serialized.includes(token), false, `${label} leaked raw fixture token ${token}`);
  }
  for (const rawField of ['option_value', 'post_content', 'meta_value', 'payload_json']) {
    assert.equal(serialized.includes(rawField), false, `${label} leaked raw field name ${rawField}`);
  }
}
