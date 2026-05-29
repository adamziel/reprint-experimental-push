import { ABSENT, digest } from './stable-json.js';

export const SQLITE_CAS_BOUNDARY = 'sqlite-single-statement-cas';
export const SQLITE_CAS_ADAPTER = 'sqlite-single-statement-cas';

export const SQLITE_CAS_SURFACE_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'wp_posts',
    driver: 'wp-post',
    logicalTable: 'wp_posts',
    physicalTable: 'wp_posts',
    keyColumns: Object.freeze(['ID']),
    setColumns: Object.freeze(['post_title', 'post_name', 'post_content', 'post_status', 'post_type', 'post_parent', 'post_author']),
    compareColumns: Object.freeze(['ID', 'post_title', 'post_name', 'post_content', 'post_status', 'post_type', 'post_parent', 'post_author']),
    columns: Object.freeze({
      ID: 'INTEGER PRIMARY KEY',
      post_title: 'TEXT',
      post_name: 'TEXT',
      post_content: 'TEXT',
      post_status: 'TEXT',
      post_type: 'TEXT',
      post_parent: 'INTEGER',
      post_author: 'INTEGER',
    }),
  }),
  Object.freeze({
    id: 'wp_options',
    driver: 'wp-option',
    logicalTable: 'wp_options',
    physicalTable: 'wp_options',
    keyColumns: Object.freeze(['option_name']),
    setColumns: Object.freeze(['option_value']),
    compareColumns: Object.freeze(['option_name', 'option_value']),
    columns: Object.freeze({
      option_name: 'TEXT PRIMARY KEY',
      option_value: 'TEXT',
    }),
  }),
  Object.freeze({
    id: 'wp_postmeta',
    driver: 'wp-postmeta',
    logicalTable: 'wp_postmeta',
    physicalTable: 'wp_postmeta',
    keyColumns: Object.freeze(['meta_id']),
    setColumns: Object.freeze(['meta_value']),
    compareColumns: Object.freeze(['meta_id', 'post_id', 'meta_key', 'meta_value']),
    columns: Object.freeze({
      meta_id: 'INTEGER PRIMARY KEY',
      post_id: 'INTEGER',
      meta_key: 'TEXT',
      meta_value: 'TEXT',
    }),
  }),
  Object.freeze({
    id: 'wp_reprint_push_forms_lab',
    driver: 'fixture-forms-lab-table',
    logicalTable: 'wp_reprint_push_forms_lab',
    physicalTable: 'wp_reprint_push_forms_lab',
    keyColumns: Object.freeze(['id']),
    setColumns: Object.freeze(['form_slug', 'payload_json', 'updated_marker']),
    compareColumns: Object.freeze(['id', 'form_slug', 'payload_json', 'updated_marker']),
    columns: Object.freeze({
      id: 'INTEGER PRIMARY KEY',
      form_slug: 'TEXT',
      payload_json: 'TEXT',
      updated_marker: 'TEXT',
    }),
  }),
  Object.freeze({
    id: 'wp_reprint_push_release_state',
    driver: 'reprint-push-release-state',
    logicalTable: 'wp_reprint_push_release_state',
    physicalTable: 'wp_reprint_push_release_state',
    keyColumns: Object.freeze(['state_id']),
    setColumns: Object.freeze(['payload_json', 'updated_marker']),
    compareColumns: Object.freeze(['state_id', 'payload_json', 'updated_marker']),
    columns: Object.freeze({
      state_id: 'INTEGER PRIMARY KEY',
      payload_json: 'TEXT',
      updated_marker: 'TEXT',
    }),
  }),
]);

export function buildSqliteCasUpdateShape(surfaceInput) {
  const surface = resolveSqliteCasSurface(surfaceInput);
  const setClause = surface.setColumns
    .map((column) => `${quoteSqliteIdentifier(column)} = ?`)
    .join(', ');
  const predicateColumns = orderedUnique([
    ...surface.keyColumns,
    ...surface.compareColumns,
  ]);
  const whereClause = predicateColumns
    .map((column) => `${quoteSqliteIdentifier(column)} IS ?`)
    .join(' AND ');
  const sqlShape = `UPDATE ${quoteSqliteIdentifier(surface.physicalTable)} SET ${setClause} WHERE ${whereClause}`;

  return {
    boundary: SQLITE_CAS_BOUNDARY,
    adapter: SQLITE_CAS_ADAPTER,
    engine: 'sqlite',
    logicalTable: surface.logicalTable,
    physicalTable: surface.physicalTable,
    driver: surface.driver,
    operation: 'update',
    keyColumns: [...surface.keyColumns],
    setColumns: [...surface.setColumns],
    comparedColumns: predicateColumns,
    singleStatement: true,
    statementKind: 'UPDATE',
    nullSafePredicate: true,
    sqlShape,
    sqlShapeHash: digest(sqlShape),
  };
}

export function applySqliteCasWriteGuard({
  database,
  surface: surfaceInput,
  expectedResource,
  expectedStorage,
  nextStorage,
}) {
  const surface = resolveSqliteCasSurface(surfaceInput);
  const shape = buildSqliteCasUpdateShape(surface);
  const expected = normalizeStorageObject(expectedStorage, 'expectedStorage');
  const planned = normalizeStorageObject(nextStorage, 'nextStorage');
  const observedStorage = readSqliteCasStorageByKey(database, surface, expected);
  const statement = sqlitePrepare(database, shape.sqlShape);
  const result = sqliteRunStatement(statement, [
    ...surface.setColumns.map((column) => sqliteParameter(planned[column])),
    ...shape.comparedColumns.map((column) => sqliteParameter(expected[column])),
  ]);
  const rowsAffected = normalizeSqliteChanges(result?.changes);

  return {
    applied: rowsAffected === 1,
    rowsAffected,
    storageGuard: sqliteCasStorageGuardEvidence({
      surface,
      shape,
      rowsAffected,
      expectedResource,
      expectedStorage: expected,
      nextStorage: planned,
      observedStorage,
    }),
  };
}

export function createSqliteCasFixture(surfaceInput, index = 0) {
  const surface = resolveSqliteCasSurface(surfaceInput);
  if (surface.id === 'wp_posts') {
    const id = 10_000 + index;
    const expectedStorage = {
      ID: id,
      post_title: `sqlite-base-title-${index}`,
      post_name: `sqlite-base-post-${index}`,
      post_content: `sqlite-base-value-${index}`,
      post_status: 'draft',
      post_type: 'post',
      post_parent: 0,
      post_author: 1,
    };
    return fixtureFromStorage(surface, expectedStorage, {
      post_title: `sqlite-planned-title-${index}`,
      post_content: `sqlite-planned-value-${index}`,
    }, {
      post_title: `sqlite-drift-title-${index}`,
      post_content: `sqlite-drift-value-${index}`,
    });
  }
  if (surface.id === 'wp_options') {
    const expectedStorage = {
      option_name: `sqlite_reprint_push_option_${index}`,
      option_value: `sqlite-base-value-${index}`,
    };
    return fixtureFromStorage(surface, expectedStorage, {
      option_value: `sqlite-planned-value-${index}`,
    }, {
      option_value: `sqlite-drift-value-${index}`,
    });
  }
  if (surface.id === 'wp_postmeta') {
    const expectedStorage = {
      meta_id: 20_000 + index,
      post_id: 30_000 + index,
      meta_key: `_sqlite_reprint_push_meta_${index}`,
      meta_value: `sqlite-base-value-${index}`,
    };
    return fixtureFromStorage(surface, expectedStorage, {
      meta_value: `sqlite-planned-value-${index}`,
    }, {
      meta_value: `sqlite-drift-value-${index}`,
    });
  }
  if (surface.id === 'wp_reprint_push_forms_lab') {
    const expectedStorage = {
      id: 40_000 + index,
      form_slug: `sqlite-fixture-${index}`,
      payload_json: `sqlite-payload-json-base-${index}`,
      updated_marker: `sqlite-base-${index}`,
    };
    return fixtureFromStorage(surface, expectedStorage, {
      payload_json: `sqlite-payload-json-planned-${index}`,
      updated_marker: `sqlite-planned-${index}`,
    }, {
      payload_json: `sqlite-payload-json-drift-${index}`,
      updated_marker: `sqlite-drift-${index}`,
    });
  }
  if (surface.id === 'wp_reprint_push_release_state') {
    const expectedStorage = {
      state_id: 50_000 + index,
      payload_json: `sqlite-release-payload-base-${index}`,
      updated_marker: `sqlite-base-${index}`,
    };
    return fixtureFromStorage(surface, expectedStorage, {
      payload_json: `sqlite-release-payload-planned-${index}`,
      updated_marker: `sqlite-planned-${index}`,
    }, {
      payload_json: `sqlite-release-payload-drift-${index}`,
      updated_marker: `sqlite-drift-${index}`,
    });
  }
  throw new Error(`No SQLite CAS fixture for ${surface.id}`);
}

export function createSqliteCasFixtureTable(database, surfaceInput) {
  const surface = resolveSqliteCasSurface(surfaceInput);
  const columns = Object.entries(surface.columns)
    .map(([column, type]) => `${quoteSqliteIdentifier(column)} ${type}`)
    .join(', ');
  sqliteExec(database, `CREATE TABLE ${quoteSqliteIdentifier(surface.physicalTable)} (${columns})`);
}

export function insertSqliteCasFixtureRow(database, surfaceInput, row) {
  const surface = resolveSqliteCasSurface(surfaceInput);
  const columns = Object.keys(surface.columns);
  const placeholders = columns.map(() => '?').join(', ');
  const statement = sqlitePrepare(
    database,
    `INSERT INTO ${quoteSqliteIdentifier(surface.physicalTable)} (${columns.map(quoteSqliteIdentifier).join(', ')}) VALUES (${placeholders})`,
  );
  sqliteRunStatement(statement, columns.map((column) => sqliteParameter(row?.[column])));
}

export function readSqliteCasStorageByKey(database, surfaceInput, keyStorage) {
  const surface = resolveSqliteCasSurface(surfaceInput);
  const storage = normalizeStorageObject(keyStorage, 'keyStorage');
  const columns = Object.keys(surface.columns);
  const whereClause = surface.keyColumns
    .map((column) => `${quoteSqliteIdentifier(column)} IS ?`)
    .join(' AND ');
  const statement = sqlitePrepare(
    database,
    `SELECT ${columns.map(quoteSqliteIdentifier).join(', ')} FROM ${quoteSqliteIdentifier(surface.physicalTable)} WHERE ${whereClause} LIMIT 1`,
  );
  const row = sqliteGetStatement(statement, surface.keyColumns.map((column) => sqliteParameter(storage[column])));
  if (!row) {
    return ABSENT;
  }
  return Object.fromEntries(columns.map((column) => [column, row[column]]));
}

export function resolveSqliteCasSurface(surfaceInput) {
  if (typeof surfaceInput === 'string') {
    const surface = SQLITE_CAS_SURFACE_DEFINITIONS.find((definition) => (
      definition.id === surfaceInput
        || definition.logicalTable === surfaceInput
        || definition.physicalTable === surfaceInput
    ));
    if (!surface) {
      throw new Error(`Unknown SQLite CAS surface: ${surfaceInput}`);
    }
    return surface;
  }
  if (surfaceInput && typeof surfaceInput === 'object') {
    return surfaceInput;
  }
  throw new Error('SQLite CAS surface is required.');
}

export function sqliteCasRowKey(surfaceInput, row) {
  const surface = resolveSqliteCasSurface(surfaceInput);
  return surface.keyColumns.map((column) => String(row?.[column])).join('\u0000');
}

export function pickSqliteCasColumns(row, columns) {
  if (row === ABSENT) {
    return ABSENT;
  }
  const picked = {};
  for (const column of columns) {
    picked[column] = row?.[column] ?? null;
  }
  return picked;
}

function sqliteCasStorageGuardEvidence({
  surface,
  shape,
  rowsAffected,
  expectedResource,
  expectedStorage,
  nextStorage,
  observedStorage,
}) {
  return {
    boundary: SQLITE_CAS_BOUNDARY,
    adapter: SQLITE_CAS_ADAPTER,
    engine: 'sqlite',
    driver: surface.driver,
    logicalTable: surface.logicalTable,
    physicalTable: surface.physicalTable,
    operation: 'update',
    keyColumns: [...surface.keyColumns],
    setColumns: [...surface.setColumns],
    comparedColumns: [...shape.comparedColumns],
    nullSafePredicate: true,
    expectedResourceHash: digest(expectedResource ?? null),
    expectedStorageHash: digest(pickSqliteCasColumns(expectedStorage, shape.comparedColumns)),
    plannedStorageHash: digest(pickSqliteCasColumns(nextStorage, surface.setColumns)),
    observedStorageHash: digest(observedStorage === ABSENT ? ABSENT : pickSqliteCasColumns(observedStorage, shape.comparedColumns)),
    rowsAffected,
    outcome: rowsAffected === 1 ? 'applied' : rowsAffected === 0 ? 'stale-at-write' : 'unsafe-multiple-match',
    sqlShapeHash: shape.sqlShapeHash,
  };
}

function fixtureFromStorage(surface, expectedStorage, plannedPatch, driftPatch) {
  const nextStorage = {
    ...expectedStorage,
    ...plannedPatch,
  };
  const driftedStorage = {
    ...expectedStorage,
    ...driftPatch,
  };
  return {
    surface: surface.id,
    expectedResource: {
      type: 'row',
      table: surface.logicalTable,
      id: sqliteCasRowKey(surface, expectedStorage),
      storageHash: digest(pickSqliteCasColumns(expectedStorage, surface.compareColumns)),
    },
    expectedStorage,
    nextStorage,
    driftedStorage,
  };
}

function normalizeStorageObject(storage, label) {
  if (!storage || typeof storage !== 'object' || Array.isArray(storage)) {
    throw new Error(`SQLite CAS ${label} must be an object.`);
  }
  return storage;
}

function sqlitePrepare(database, sql) {
  if (!database || typeof database.prepare !== 'function') {
    throw new Error('SQLite CAS write guard requires a database object with prepare(sql).');
  }
  return database.prepare(sql);
}

function sqliteRunStatement(statement, params = []) {
  if (!statement || typeof statement.run !== 'function') {
    throw new Error('SQLite CAS write guard requires prepared statements with run(...params).');
  }
  return statement.run(...params);
}

function sqliteGetStatement(statement, params = []) {
  if (!statement || typeof statement.get !== 'function') {
    throw new Error('SQLite CAS write guard requires prepared statements with get(...params).');
  }
  return statement.get(...params);
}

function sqliteExec(database, sql) {
  if (!database || typeof database.exec !== 'function') {
    throw new Error('SQLite CAS write guard requires a database object with exec(sql).');
  }
  return database.exec(sql);
}

function normalizeSqliteChanges(value) {
  if (typeof value === 'bigint') {
    const asNumber = Number(value);
    if (!Number.isSafeInteger(asNumber)) {
      throw new Error('SQLite CAS rows affected is outside the safe integer range.');
    }
    return asNumber;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('SQLite CAS rows affected must be a non-negative integer.');
  }
  return value;
}

function sqliteParameter(value) {
  return value === undefined ? null : value;
}

function orderedUnique(values) {
  return [...new Set(values)];
}

function quoteSqliteIdentifier(identifier) {
  if (typeof identifier !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQLite identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}
