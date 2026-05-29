import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MYSQL_CAS_BOUNDARY,
  MYSQL_CAS_SURFACE_DEFINITIONS,
  applyMysqlCasWriteGuard,
  buildMysqlCasUpdateShape,
  createMysqlCasFixture,
  runMysqlCasWriteGuardBenchmark,
} from '../scripts/bench/mysql-cas-write-guard.js';

const fixedNow = new Date('2026-05-29T00:00:00.000Z');
const unavailableMysqlRuntime = () => ({
  status: 'unavailable',
  unavailableCapabilities: ['mysql-server-socket'],
  detail: 'simulated focused test: mysql server socket unavailable',
});

test('MySQL CAS benchmark reports runtime, resources, and pass/fail gates', () => {
  const report = runMysqlCasWriteGuardBenchmark({
    iterations: 3,
    now: fixedNow,
    detectMysqlRuntime: unavailableMysqlRuntime,
  });

  assert.equal(report.rppId, 'RPP-0701');
  assert.equal(report.benchmark, 'rpp-0701-mysql-cas-write-guard');
  assert.equal(report.ok, true);
  assert.equal(report.mode, 'deterministic-no-mysql-runtime');
  assert.equal(report.runtime.generatedAt, fixedNow.toISOString());
  assert.equal(typeof report.runtime.durationMs, 'number');
  assert.ok(report.runtime.durationMs >= 0);
  assert.equal(report.runtime.mysqlRuntime.status, 'unavailable');
  assert.deepEqual(report.runtime.mysqlRuntime.unavailableCapabilities, ['mysql-server-socket']);
  assert.match(report.runtime.mysqlRuntime.detail, /socket unavailable/);

  assert.equal(report.resources.storage.boundary, MYSQL_CAS_BOUNDARY);
  assert.equal(report.resources.storage.engine, 'mysql');
  assert.equal(report.resources.storage.logicalTables, MYSQL_CAS_SURFACE_DEFINITIONS.length);
  assert.equal(report.resources.storage.guardedWritesAttempted, MYSQL_CAS_SURFACE_DEFINITIONS.length * 3 * 3);
  assert.equal(report.resources.storage.appliedWrites, MYSQL_CAS_SURFACE_DEFINITIONS.length * 3);
  assert.equal(report.resources.storage.staleAtWriteWrites, MYSQL_CAS_SURFACE_DEFINITIONS.length * 3);
  assert.equal(report.resources.storage.absentAtWriteWrites, MYSQL_CAS_SURFACE_DEFINITIONS.length * 3);
  assert.equal(report.resources.sql.singleStatementShapes, MYSQL_CAS_SURFACE_DEFINITIONS.length);
  assert.equal(typeof report.resources.process.heapUsedBytes, 'number');
  assert.equal(typeof report.resources.process.userCpuMs, 'number');

  assert.ok(report.gates.length >= 5);
  assert.deepEqual([...new Set(report.gates.map((gate) => gate.status))], ['pass']);
  assert.ok(report.gates.some((gate) => gate.id === 'mysql-runtime-capability-recorded'));
  assert.ok(report.gates.some((gate) => gate.id === 'runtime-resource-budget'));
});

test('MySQL CAS shapes are single UPDATE statements with compared columns and no values', () => {
  for (const surface of MYSQL_CAS_SURFACE_DEFINITIONS) {
    const shape = buildMysqlCasUpdateShape(surface);

    assert.equal(shape.singleStatement, true);
    assert.equal(shape.statementKind, 'UPDATE');
    assert.equal(shape.boundary, MYSQL_CAS_BOUNDARY);
    assert.match(shape.sqlShape, /^UPDATE `[A-Za-z0-9_]+` SET /);
    assert.match(shape.sqlShape, / WHERE /);
    assert.match(shape.sqlShape, / LIMIT 1$/);
    assert.doesNotMatch(shape.sqlShape, /;/);
    assert.match(shape.sqlShapeHash, /^[a-f0-9]{64}$/);

    for (const column of shape.comparedColumns) {
      assert.ok(shape.sqlShape.includes(`\`${column}\``), `shape for ${surface.id} omits compared column ${column}`);
    }
    for (const rawToken of ['base-value', 'planned-value', 'drift-value', 'payload-json', 'release-payload']) {
      assert.ok(!shape.sqlShape.includes(rawToken), `shape leaked raw fixture token ${rawToken}`);
    }
  }
});

test('guard applies matching storage and rejects stale or absent storage without raw evidence', () => {
  const fixture = createMysqlCasFixture('wp_options', 7);

  const success = applyMysqlCasWriteGuard({
    surface: 'wp_options',
    rows: [fixture.expectedStorage],
    expectedResource: fixture.expectedResource,
    expectedStorage: fixture.expectedStorage,
    nextStorage: fixture.nextStorage,
  });
  assert.equal(success.applied, true);
  assert.equal(success.storageGuard.rowsAffected, 1);
  assert.equal(success.storageGuard.outcome, 'applied');
  assert.equal([...success.rows.values()][0].option_value, fixture.nextStorage.option_value);

  const stale = applyMysqlCasWriteGuard({
    surface: 'wp_options',
    rows: [fixture.driftedStorage],
    expectedResource: fixture.expectedResource,
    expectedStorage: fixture.expectedStorage,
    nextStorage: fixture.nextStorage,
  });
  assert.equal(stale.applied, false);
  assert.equal(stale.storageGuard.rowsAffected, 0);
  assert.equal(stale.storageGuard.outcome, 'stale-at-write');
  assert.equal([...stale.rows.values()][0].option_value, fixture.driftedStorage.option_value);

  const absent = applyMysqlCasWriteGuard({
    surface: 'wp_options',
    rows: [],
    expectedResource: fixture.expectedResource,
    expectedStorage: fixture.expectedStorage,
    nextStorage: fixture.nextStorage,
  });
  assert.equal(absent.applied, false);
  assert.equal(absent.storageGuard.rowsAffected, 0);
  assert.equal(absent.storageGuard.outcome, 'stale-at-write');

  for (const evidence of [success.storageGuard, stale.storageGuard, absent.storageGuard]) {
    assert.match(evidence.expectedResourceHash, /^[a-f0-9]{64}$/);
    assert.match(evidence.expectedStorageHash, /^[a-f0-9]{64}$/);
    assert.match(evidence.plannedStorageHash, /^[a-f0-9]{64}$/);
    assert.match(evidence.observedStorageHash, /^[a-f0-9]{64}$/);
    assert.match(evidence.sqlShapeHash, /^[a-f0-9]{64}$/);
    assertNoRawFixtureEvidence(evidence);
  }
});

function assertNoRawFixtureEvidence(evidence) {
  const serialized = JSON.stringify(evidence);
  for (const token of [
    'base-value',
    'planned-value',
    'drift-value',
    'payload-json',
    'release-payload',
    fixtureColumnValueToken(),
  ]) {
    assert.ok(!serialized.includes(token), `storage guard evidence leaked ${token}`);
  }
  for (const key of ['option_value', 'post_content', 'meta_value', 'payload_json']) {
    assert.ok(!Object.hasOwn(evidence, key), `storage guard evidence exposed raw field ${key}`);
  }
}

function fixtureColumnValueToken() {
  return 'reprint_push_option_7';
}
