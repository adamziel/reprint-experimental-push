import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MYSQL_CAS_BOUNDARY,
  MYSQL_CAS_SURFACE_DEFINITIONS,
  applyMysqlCasWriteGuard,
  buildMysqlCasUpdateShape,
  createMysqlCasFixture,
  detectMysqlRuntime,
  runMysqlCasWriteGuardBenchmark,
} from '../scripts/bench/mysql-cas-write-guard.js';

const fixedNow = new Date('2026-05-29T00:00:00.000Z');
const unavailableMysqlRuntime = () => ({
  status: 'unavailable',
  unavailableCapabilities: ['mysql-server-socket'],
  detail: 'simulated focused test: mysql server socket unavailable',
});
const uniqueGuardSurfaceCount = MYSQL_CAS_SURFACE_DEFINITIONS
  .filter((surface) => surface.uniqueKeyColumns?.length).length;

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
  assert.equal(report.resources.storage.guardedWritesAttempted, (MYSQL_CAS_SURFACE_DEFINITIONS.length * 3 * 3) + (uniqueGuardSurfaceCount * 3));
  assert.equal(report.resources.storage.appliedWrites, MYSQL_CAS_SURFACE_DEFINITIONS.length * 3);
  assert.equal(report.resources.storage.staleAtWriteWrites, MYSQL_CAS_SURFACE_DEFINITIONS.length * 3);
  assert.equal(report.resources.storage.absentAtWriteWrites, MYSQL_CAS_SURFACE_DEFINITIONS.length * 3);
  assert.equal(report.resources.storage.duplicateKeyRejectedWrites, uniqueGuardSurfaceCount * 3);
  assert.equal(report.resources.storage.unsafeMultipleMatchWrites, 0);
  assert.equal(report.resources.sql.singleStatementShapes, MYSQL_CAS_SURFACE_DEFINITIONS.length);
  assert.equal(typeof report.resources.process.heapUsedBytes, 'number');
  assert.equal(typeof report.resources.process.userCpuMs, 'number');

  assert.ok(report.gates.length >= 5);
  assert.deepEqual([...new Set(report.gates.map((gate) => gate.status))], ['pass']);
  assert.ok(report.gates.some((gate) => gate.id === 'duplicate-key-guard'));
  assert.ok(report.gates.some((gate) => gate.id === 'mysql-runtime-capability-recorded'));
  assert.ok(report.gates.some((gate) => gate.id === 'runtime-resource-budget'));
});

test('MySQL CAS shapes are single null-safe UPDATE statements with compared columns and no values', () => {
  for (const surface of MYSQL_CAS_SURFACE_DEFINITIONS) {
    const shape = buildMysqlCasUpdateShape(surface);

    assert.equal(shape.singleStatement, true);
    assert.equal(shape.statementKind, 'UPDATE');
    assert.equal(shape.boundary, MYSQL_CAS_BOUNDARY);
    assert.equal(shape.nullSafePredicate, true);
    assert.match(shape.sqlShape, /^UPDATE `[A-Za-z0-9_]+` SET /);
    assert.match(shape.sqlShape, / WHERE /);
    assert.match(shape.sqlShape, / LIMIT 1$/);
    assert.doesNotMatch(shape.sqlShape, /;/);
    assert.match(shape.sqlShapeHash, /^[a-f0-9]{64}$/);

    for (const column of shape.comparedColumns) {
      assert.ok(shape.sqlShape.includes(`\`${column}\` <=> ?`), `shape for ${surface.id} omits null-safe compared column ${column}`);
    }
    if (shape.uniqueKeyGuard) {
      assert.match(shape.sqlShape, /SELECT COUNT\(\*\)/);
      for (const column of shape.uniqueKeyColumns) {
        assert.ok(shape.sqlShape.includes(`\`${column}\` <=> ?`), `shape for ${surface.id} omits unique-key guard column ${column}`);
      }
    }
    for (const rawToken of ['base-value', 'planned-value', 'drift-value', 'payload-json', 'release-payload']) {
      assert.ok(!shape.sqlShape.includes(rawToken), `shape leaked raw fixture token ${rawToken}`);
    }
  }
});

test('guard uses null-safe comparisons and rejects ambiguous duplicate keys', () => {
  const releaseFixture = createMysqlCasFixture('wp_reprint_push_release_state', 11);
  const expectedWithNull = {
    ...releaseFixture.expectedStorage,
    updated_marker: null,
  };
  const plannedFromNull = {
    ...expectedWithNull,
    payload_json: 'release-payload-planned-null',
    updated_marker: 'planned-null',
  };
  const driftedFromNull = {
    ...expectedWithNull,
    updated_marker: 'drift-null',
  };

  const nullSuccess = applyMysqlCasWriteGuard({
    surface: 'wp_reprint_push_release_state',
    rows: [expectedWithNull],
    expectedResource: releaseFixture.expectedResource,
    expectedStorage: expectedWithNull,
    nextStorage: plannedFromNull,
  });
  assert.equal(nullSuccess.applied, true);
  assert.equal(nullSuccess.storageGuard.rowsAffected, 1);
  assert.equal([...nullSuccess.rows.values()][0].updated_marker, plannedFromNull.updated_marker);

  const nullStale = applyMysqlCasWriteGuard({
    surface: 'wp_reprint_push_release_state',
    rows: [driftedFromNull],
    expectedResource: releaseFixture.expectedResource,
    expectedStorage: expectedWithNull,
    nextStorage: plannedFromNull,
  });
  assert.equal(nullStale.applied, false);
  assert.equal(nullStale.storageGuard.rowsAffected, 0);
  assert.equal(nullStale.storageGuard.outcome, 'stale-at-write');
  assert.equal([...nullStale.rows.values()][0].updated_marker, driftedFromNull.updated_marker);

  const postmetaFixture = createMysqlCasFixture('wp_postmeta', 12);
  const duplicate = applyMysqlCasWriteGuard({
    surface: 'wp_postmeta',
    rows: [
      postmetaFixture.expectedStorage,
      {
        ...postmetaFixture.expectedStorage,
        meta_value: 'duplicate-value-12',
      },
    ],
    expectedResource: postmetaFixture.expectedResource,
    expectedStorage: postmetaFixture.expectedStorage,
    nextStorage: postmetaFixture.nextStorage,
  });
  assert.equal(duplicate.applied, false);
  assert.equal(duplicate.storageGuard.rowsAffected, 0);
  assert.equal(duplicate.storageGuard.outcome, 'stale-at-write');
  assert.equal(duplicate.storageGuard.uniqueKeyGuard, true);
  assert.deepEqual(duplicate.storageGuard.uniqueKeyColumns, ['post_id', 'meta_key']);
  assertNoRawFixtureEvidence(duplicate.storageGuard);
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

test('MySQL runtime detection records missing connection settings exactly', () => {
  const runtime = detectMysqlRuntime({}, fakeMysqlSpawn([
    mysqlVersionResult(),
  ]));

  assert.equal(runtime.status, 'unavailable');
  assert.deepEqual(runtime.unavailableCapabilities, ['mysql-runtime-connection-settings']);
  assert.match(runtime.detail, /REPRINT_PUSH_MYSQL_CAS_DSN/);
  assert.match(runtime.detail, /REPRINT_PUSH_MYSQL_CAS_DATABASE/);
  assert.equal(runtime.clientVersion, mysqlVersionResult().stdout.trim());
});

test('MySQL runtime detection records connection probe failures without leaking settings', () => {
  const env = {
    REPRINT_PUSH_MYSQL_CAS_HOST: 'private-db.example',
    REPRINT_PUSH_MYSQL_CAS_PORT: '3307',
    REPRINT_PUSH_MYSQL_CAS_DATABASE: 'reprint_push_test',
    REPRINT_PUSH_MYSQL_CAS_USER: 'cas_worker',
    REPRINT_PUSH_MYSQL_CAS_PASSWORD: 'super-secret',
  };
  const runtime = detectMysqlRuntime(env, fakeMysqlSpawn([
    mysqlVersionResult(),
    {
      status: 1,
      stdout: '',
      stderr: 'ERROR 1045 (28000): Access denied for user cas_worker on private-db.example using password super-secret',
    },
  ], ({ call, args, options }) => {
    if (call === 1) {
      assert.ok(args.includes('--protocol=tcp'));
      assert.ok(args.includes('--host=private-db.example'));
      assert.ok(args.includes('--port=3307'));
      assert.ok(args.includes('--database=reprint_push_test'));
      assert.ok(args.includes('--user=cas_worker'));
      assert.ok(!args.some((arg) => arg.includes('super-secret')));
      assert.equal(options.env.MYSQL_PWD, 'super-secret');
    }
  }));

  assert.equal(runtime.status, 'unavailable');
  assert.deepEqual(runtime.unavailableCapabilities, ['mysql-runtime-connection-probe']);
  assert.equal(runtime.connection, 'configured-redacted');
  assert.match(runtime.detail, /mysql connection probe exited 1/);
  assertNoConnectionSecret(runtime.detail);
});

test('MySQL runtime detection records successful redacted probes without claiming live CAS DML', () => {
  const runtime = detectMysqlRuntime({
    REPRINT_PUSH_MYSQL_CAS_DSN: 'mysql://cas_worker:super-secret@private-db.example:3307/reprint_push_test',
  }, fakeMysqlSpawn([
    mysqlVersionResult(),
    {
      status: 0,
      stdout: '8.0.36\n',
      stderr: '',
    },
  ]));

  assert.equal(runtime.status, 'available');
  assert.deepEqual(runtime.unavailableCapabilities, []);
  assert.equal(runtime.connection, 'configured-redacted');
  assert.equal(runtime.serverVersion, '8.0.36');
  assert.match(runtime.detail, /connection probe succeeded/);
  assert.match(runtime.detail, /did not run live CAS DML/);
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

function mysqlVersionResult() {
  return {
    status: 0,
    stdout: 'mysql  Ver 15.1 Distrib 10.11.13-MariaDB, for Linux (x86_64) using readline 5.1\n',
    stderr: '',
  };
}

function fakeMysqlSpawn(results, onCall = () => {}) {
  let call = 0;
  return (command, args, options) => {
    assert.equal(command, 'mysql');
    onCall({ call, args, options });
    const result = results[call];
    call += 1;
    assert.ok(result, `unexpected mysql spawn call ${call}`);
    return result;
  };
}

function assertNoConnectionSecret(value) {
  for (const token of [
    'private-db.example',
    'reprint_push_test',
    'cas_worker',
    'super-secret',
  ]) {
    assert.ok(!value.includes(token), `runtime evidence leaked ${token}`);
  }
}
