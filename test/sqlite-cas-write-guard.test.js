import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SQLITE_CAS_BOUNDARY,
  SQLITE_CAS_SURFACE_DEFINITIONS,
  applySqliteCasWriteGuard,
  buildSqliteCasUpdateShape,
  createSqliteCasFixture,
  createSqliteCasFixtureTable,
  insertSqliteCasFixtureRow,
  readSqliteCasStorageByKey,
} from '../src/sqlite-cas-write-guard.js';
import { ABSENT, digest } from '../src/stable-json.js';

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const sqliteAvailable = DatabaseSync !== null;

test('SQLite CAS shapes are single UPDATE statements with null-safe compared columns and no values', () => {
  for (const surface of SQLITE_CAS_SURFACE_DEFINITIONS) {
    const shape = buildSqliteCasUpdateShape(surface);

    assert.equal(shape.singleStatement, true);
    assert.equal(shape.statementKind, 'UPDATE');
    assert.equal(shape.boundary, SQLITE_CAS_BOUNDARY);
    assert.equal(shape.nullSafePredicate, true);
    assert.match(shape.sqlShape, /^UPDATE "[A-Za-z0-9_]+" SET /);
    assert.match(shape.sqlShape, / WHERE /);
    assert.doesNotMatch(shape.sqlShape, /;/);
    assert.match(shape.sqlShapeHash, /^[a-f0-9]{64}$/);

    for (const column of shape.comparedColumns) {
      assert.ok(shape.sqlShape.includes(`"${column}" IS ?`), `shape for ${surface.id} omits null-safe compared column ${column}`);
    }
    for (const rawToken of ['sqlite-base-value', 'sqlite-planned-value', 'sqlite-drift-value', 'sqlite-payload-json', 'sqlite-release-payload']) {
      assert.ok(!shape.sqlShape.includes(rawToken), `shape leaked raw fixture token ${rawToken}`);
    }
  }
});

test('SQLite guard applies matching storage and rejects stale or absent storage without raw evidence', {
  skip: sqliteAvailable ? false : 'node:sqlite is unavailable in this Node.js runtime',
}, () => {
  const fixture = createSqliteCasFixture('wp_options', 7);

  const success = withDatabase('wp_options', [fixture.expectedStorage], (database) => {
    const write = applySqliteCasWriteGuard({
      database,
      surface: 'wp_options',
      expectedResource: fixture.expectedResource,
      expectedStorage: fixture.expectedStorage,
      nextStorage: fixture.nextStorage,
    });
    const row = readSqliteCasStorageByKey(database, 'wp_options', fixture.expectedStorage);
    return { write, row };
  });
  assert.equal(success.write.applied, true);
  assert.equal(success.write.storageGuard.rowsAffected, 1);
  assert.equal(success.write.storageGuard.outcome, 'applied');
  assert.equal(success.row.option_value, fixture.nextStorage.option_value);

  const stale = withDatabase('wp_options', [fixture.driftedStorage], (database) => {
    const write = applySqliteCasWriteGuard({
      database,
      surface: 'wp_options',
      expectedResource: fixture.expectedResource,
      expectedStorage: fixture.expectedStorage,
      nextStorage: fixture.nextStorage,
    });
    const row = readSqliteCasStorageByKey(database, 'wp_options', fixture.expectedStorage);
    return { write, row };
  });
  assert.equal(stale.write.applied, false);
  assert.equal(stale.write.storageGuard.rowsAffected, 0);
  assert.equal(stale.write.storageGuard.outcome, 'stale-at-write');
  assert.equal(stale.row.option_value, fixture.driftedStorage.option_value);
  assert.equal(
    stale.write.storageGuard.observedStorageHash,
    digest({ option_name: fixture.driftedStorage.option_name, option_value: fixture.driftedStorage.option_value }),
  );

  const absent = withDatabase('wp_options', [], (database) => {
    const write = applySqliteCasWriteGuard({
      database,
      surface: 'wp_options',
      expectedResource: fixture.expectedResource,
      expectedStorage: fixture.expectedStorage,
      nextStorage: fixture.nextStorage,
    });
    const row = readSqliteCasStorageByKey(database, 'wp_options', fixture.expectedStorage);
    return { write, row };
  });
  assert.equal(absent.write.applied, false);
  assert.equal(absent.write.storageGuard.rowsAffected, 0);
  assert.equal(absent.write.storageGuard.outcome, 'stale-at-write');
  assert.equal(absent.row, ABSENT);

  for (const evidence of [success.write.storageGuard, stale.write.storageGuard, absent.write.storageGuard]) {
    assert.match(evidence.expectedResourceHash, /^[a-f0-9]{64}$/);
    assert.match(evidence.expectedStorageHash, /^[a-f0-9]{64}$/);
    assert.match(evidence.plannedStorageHash, /^[a-f0-9]{64}$/);
    assert.match(evidence.observedStorageHash, /^[a-f0-9]{64}$/);
    assert.match(evidence.sqlShapeHash, /^[a-f0-9]{64}$/);
    assertNoRawFixtureEvidence(evidence);
  }
});

test('SQLite guard uses null-safe predicates so null storage matches only the expected null state', {
  skip: sqliteAvailable ? false : 'node:sqlite is unavailable in this Node.js runtime',
}, () => {
  const fixture = createSqliteCasFixture('wp_reprint_push_release_state', 11);
  const expectedWithNull = {
    ...fixture.expectedStorage,
    updated_marker: null,
  };
  const plannedFromNull = {
    ...expectedWithNull,
    payload_json: 'sqlite-release-payload-planned-null',
    updated_marker: 'sqlite-planned-null',
  };
  const driftedFromNull = {
    ...expectedWithNull,
    updated_marker: 'sqlite-drift-null',
  };

  const success = withDatabase('wp_reprint_push_release_state', [expectedWithNull], (database) => {
    const write = applySqliteCasWriteGuard({
      database,
      surface: 'wp_reprint_push_release_state',
      expectedResource: fixture.expectedResource,
      expectedStorage: expectedWithNull,
      nextStorage: plannedFromNull,
    });
    const row = readSqliteCasStorageByKey(database, 'wp_reprint_push_release_state', expectedWithNull);
    return { write, row };
  });
  assert.equal(success.write.applied, true);
  assert.equal(success.write.storageGuard.rowsAffected, 1);
  assert.equal(success.row.updated_marker, plannedFromNull.updated_marker);

  const stale = withDatabase('wp_reprint_push_release_state', [driftedFromNull], (database) => {
    const write = applySqliteCasWriteGuard({
      database,
      surface: 'wp_reprint_push_release_state',
      expectedResource: fixture.expectedResource,
      expectedStorage: expectedWithNull,
      nextStorage: plannedFromNull,
    });
    const row = readSqliteCasStorageByKey(database, 'wp_reprint_push_release_state', expectedWithNull);
    return { write, row };
  });
  assert.equal(stale.write.applied, false);
  assert.equal(stale.write.storageGuard.rowsAffected, 0);
  assert.equal(stale.write.storageGuard.outcome, 'stale-at-write');
  assert.equal(stale.row.updated_marker, driftedFromNull.updated_marker);
});

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

function assertNoRawFixtureEvidence(evidence) {
  const serialized = JSON.stringify(evidence);
  for (const token of [
    'sqlite-base-value',
    'sqlite-planned-value',
    'sqlite-drift-value',
    'sqlite-payload-json',
    'sqlite-release-payload',
    'sqlite_reprint_push_option_7',
  ]) {
    assert.ok(!serialized.includes(token), `storage guard evidence leaked ${token}`);
  }
  for (const key of ['option_value', 'post_content', 'meta_value', 'payload_json']) {
    assert.ok(!Object.hasOwn(evidence, key), `storage guard evidence exposed raw field ${key}`);
  }
}
