import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { applyPlan } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { inspectRecoveryJournal } from '../src/recovery-inspect.js';
import {
  migrateSqliteRecoveryJournalTableSchema,
  openPlanRecoveryJournal,
  openRecoveryJournal,
  readRecoveryJournal,
  readSqliteRecoveryJournalTable,
  RECOVERY_JOURNAL_SCHEMA_VERSION,
} from '../src/recovery-journal.js';

const fixedGeneratedNow = new Date('2026-05-31T00:00:00.000Z');
let DatabaseSync = null;

try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const generatedMigrationCases = Object.freeze([
  {
    id: 'rpp-0641-open-legacy-table-v3',
    state: 'open',
    mutationCount: 2,
    storageShape: 'missing-table-schema-version',
    schemaVersionColumnAdded: true,
    expectedInspectionStatus: 'old-remote',
  },
  {
    id: 'rpp-0641-staged-legacy-json-v3',
    state: 'staged',
    mutationCount: 3,
    storageShape: 'table-version-legacy-json',
    schemaVersionColumnAdded: false,
    expectedInspectionStatus: 'old-remote',
  },
  {
    id: 'rpp-0641-committed-mixed-json-v3',
    state: 'committed',
    mutationCount: 4,
    committedMutations: 2,
    storageShape: 'table-version-mixed-json',
    schemaVersionColumnAdded: false,
    expectedInspectionStatus: 'blocked-recovery',
  },
]);

function tempJournalPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0641-journal-'));
  return path.join(dir, 'recovery.jsonl');
}

function tempSqlitePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0641-sqlite-'));
  return path.join(dir, 'recovery.sqlite');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function withoutSchemaVersion(record) {
  const { schemaVersion, ...rest } = record;
  return rest;
}

function generatedSites(generatedCase) {
  const fileCount = Math.max(generatedCase.mutationCount + 1, 5);
  const base = { files: {}, plugins: {}, db: {} };
  for (let index = 1; index <= fileCount; index++) {
    base.files[`rpp-0641-${generatedCase.id}-file-${index}.txt`] =
      `base-rpp-0641-${generatedCase.id}-${index}`;
  }

  const local = cloneJson(base);
  const remote = cloneJson(base);
  for (let index = 1; index <= generatedCase.mutationCount; index++) {
    local.files[`rpp-0641-${generatedCase.id}-file-${index}.txt`] =
      `local-rpp-0641-${generatedCase.id}-${index}`;
  }

  const plan = createPushPlan({
    base,
    local,
    remote,
    now: fixedGeneratedNow,
  });
  assert.equal(plan.status, 'ready');
  assert.equal(plan.mutations.length, generatedCase.mutationCount);
  return { base, local, remote, plan };
}

function captureApplyError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected applyPlan() to throw for the generated recovery case');
}

function seedGeneratedFileJournal(generatedCase, { plan, remote }) {
  const filePath = tempJournalPath();
  const current = cloneJson(remote);

  if (generatedCase.state === 'open') {
    const journal = openPlanRecoveryJournal({
      filePath,
      plan,
      current,
      now: fixedGeneratedNow,
      artifactRefs: { generatedCase: `artifact://rpp-0641/${generatedCase.id}` },
    });
    journal.close();
  } else {
    const durableJournal = openRecoveryJournal(filePath, {
      truncate: true,
      now: fixedGeneratedNow,
      claimId: `${generatedCase.id}-claim`,
    });
    try {
      const error = captureApplyError(() => applyPlan(current, plan, {
        durableJournal,
        mutateRemote: true,
        ...(generatedCase.state === 'staged'
          ? { failAfterStaging: true }
          : { failDuringCommitAtMutation: generatedCase.committedMutations }),
      }));
      assert.equal(
        error.code,
        generatedCase.state === 'staged'
          ? 'INJECTED_FAILURE_AFTER_STAGING'
          : 'INJECTED_FAILURE_DURING_COMMIT',
      );
    } finally {
      durableJournal.close();
    }
  }

  const journal = readRecoveryJournal(filePath);
  assert.equal(journal.integrity.status, 'ok');
  return {
    filePath,
    current,
    records: journal.records,
  };
}

function shouldOmitRecordSchemaVersion(generatedCase, record) {
  if (
    generatedCase.storageShape === 'missing-table-schema-version'
    || generatedCase.storageShape === 'table-version-legacy-json'
  ) {
    return true;
  }

  return record.type === 'mutation-observed'
    || record.type === 'recovery-state'
    || record.sequence % 3 === 0;
}

function storageRecordFor(generatedCase, record) {
  return shouldOmitRecordSchemaVersion(generatedCase, record)
    ? withoutSchemaVersion(record)
    : { ...record };
}

function writeGeneratedSqliteJournalTable(database, generatedCase, records) {
  if (generatedCase.storageShape === 'missing-table-schema-version') {
    database.exec(`CREATE TABLE recovery_journal (
      sequence INTEGER PRIMARY KEY,
      record_json TEXT NOT NULL
    )`);
    const insert = database.prepare('INSERT INTO recovery_journal (sequence, record_json) VALUES (?, ?)');
    const storedRecords = records.map((record) => storageRecordFor(generatedCase, record));
    for (const record of storedRecords) {
      insert.run(record.sequence, JSON.stringify(record));
    }
    return storedRecords;
  }

  database.exec(`CREATE TABLE recovery_journal (
    sequence INTEGER PRIMARY KEY,
    record_json TEXT NOT NULL,
    schema_version INTEGER NOT NULL
  )`);
  const insert = database.prepare(
    'INSERT INTO recovery_journal (sequence, record_json, schema_version) VALUES (?, ?, ?)',
  );
  const storedRecords = records.map((record) => storageRecordFor(generatedCase, record));
  for (const record of storedRecords) {
    insert.run(record.sequence, JSON.stringify(record), RECOVERY_JOURNAL_SCHEMA_VERSION);
  }
  return storedRecords;
}

function assertIntegrityIncludes(read, code, expected = true) {
  assert.equal(
    read.integrity.errors.some((error) => error.code === code),
    expected,
    `${read.tableName || 'journal'} expected ${code} presence to be ${expected}`,
  );
}

function assertStrictLegacyReadBlocksAsExpected(generatedCase, strictRead) {
  assert.equal(strictRead.integrity.status, 'blocked');
  assert.equal(
    strictRead.schemaVersionColumnPresent,
    generatedCase.storageShape !== 'missing-table-schema-version',
  );
  assertIntegrityIncludes(
    strictRead,
    'JOURNAL_TABLE_SCHEMA_VERSION_MISSING',
    generatedCase.storageShape === 'missing-table-schema-version',
  );
  assertIntegrityIncludes(strictRead, 'JOURNAL_SCHEMA_UNSUPPORTED', true);
}

function countEventRows(records, type) {
  return records.filter((record) => record.type === type).length;
}

function assertGeneratedRestartState(generatedCase, restarted, plan) {
  assert.equal(restarted.openState.status, 'opened');
  assert.equal(restarted.openState.restartReadable, true);
  assert.equal(restarted.openState.openRows, 1);
  assert.equal(countEventRows(restarted.records, 'target-planned'), plan.mutations.length);

  if (generatedCase.state === 'open') {
    assert.equal(restarted.stagedState.status, 'missing');
    assert.equal(restarted.stagedState.restartReadable, false);
    assert.equal(restarted.committedState.status, 'missing');
    assert.equal(restarted.committedState.restartReadable, false);
    return;
  }

  assert.equal(restarted.stagedState.status, 'staged');
  assert.equal(restarted.stagedState.restartReadable, true);
  assert.equal(restarted.stagedState.targetRows, plan.mutations.length);
  assert.deepEqual(restarted.stagedState.targetEnvelope, {
    plannedTargets: plan.mutations.length,
    allTargetsHaveHashes: true,
  });

  if (generatedCase.state === 'staged') {
    assert.equal(countEventRows(restarted.records, 'apply-staged'), 1);
    assert.equal(restarted.committedState.status, 'missing');
    assert.equal(restarted.committedState.restartReadable, false);
    return;
  }

  assert.equal(restarted.committedState.status, 'committed');
  assert.equal(restarted.committedState.restartReadable, true);
  assert.equal(restarted.committedState.mutationRows, generatedCase.committedMutations);
  assert.equal(restarted.committedState.completedRows, 0);
  assert.deepEqual(restarted.committedState.targetEnvelope, {
    plannedTargets: plan.mutations.length,
    committedTargets: generatedCase.committedMutations,
    allCommittedTargetsHaveHashes: true,
    allTargetsCommitted: false,
  });
}

function assertGeneratedInspection(generatedCase, restarted, plan, current) {
  const inspection = inspectRecoveryJournal({ journal: restarted, plan, current });
  assert.equal(inspection.status, generatedCase.expectedInspectionStatus);
  if (generatedCase.state === 'committed') {
    assert.deepEqual(inspection.counts, {
      old: plan.mutations.length - generatedCase.committedMutations,
      new: generatedCase.committedMutations,
      blockedUnknown: 0,
    });
  } else {
    assert.deepEqual(inspection.counts, {
      old: plan.mutations.length,
      new: 0,
      blockedUnknown: 0,
    });
  }
}

test('RPP-0641 generated SQLite journal table schema migration variant 3 preserves recovery states', {
  skip: DatabaseSync === null ? 'node:sqlite is unavailable in this Node.js runtime' : false,
}, () => {
  const proofRows = [];

  for (const generatedCase of generatedMigrationCases) {
    const sqlitePath = tempSqlitePath();
    const sites = generatedSites(generatedCase);
    let database = new DatabaseSync(sqlitePath);
    const seeded = seedGeneratedFileJournal(generatedCase, sites);
    const storedRecords = writeGeneratedSqliteJournalTable(database, generatedCase, seeded.records);
    const missingRecordSchemaRows = storedRecords
      .filter((record) => !Object.hasOwn(record, 'schemaVersion'))
      .length;
    const strictLegacyRead = readSqliteRecoveryJournalTable(database);

    assertStrictLegacyReadBlocksAsExpected(generatedCase, strictLegacyRead);
    assert.ok(missingRecordSchemaRows > 0, `${generatedCase.id} should exercise legacy JSON rows`);

    const migration = migrateSqliteRecoveryJournalTableSchema(database);

    assert.equal(migration.storage, 'sqlite');
    assert.equal(migration.tableName, 'recovery_journal');
    assert.equal(migration.exists, true);
    assert.equal(migration.schemaVersion, RECOVERY_JOURNAL_SCHEMA_VERSION);
    assert.equal(migration.tableSchemaVersion, RECOVERY_JOURNAL_SCHEMA_VERSION);
    assert.deepEqual(migration.tableSchemaVersions, [RECOVERY_JOURNAL_SCHEMA_VERSION]);
    assert.deepEqual(migration.recordSchemaVersions, [RECOVERY_JOURNAL_SCHEMA_VERSION]);
    assert.equal(migration.migrated, true);
    assert.equal(migration.schemaVersionColumnAdded, generatedCase.schemaVersionColumnAdded);
    assert.equal(migration.records, seeded.records.length);
    assert.equal(migration.migratedRecords, missingRecordSchemaRows);
    assert.equal(migration.updatedTableRows, missingRecordSchemaRows);
    assert.equal(migration.preservedRows, true);
    assert.equal(migration.restartReadable, true);
    assert.equal(migration.integrity.status, 'ok');
    assertGeneratedRestartState(generatedCase, migration.journal, sites.plan);

    database.close();
    database = new DatabaseSync(sqlitePath);
    const restarted = readSqliteRecoveryJournalTable(database);
    const tableRows = database
      .prepare('SELECT sequence, schema_version, record_json FROM recovery_journal ORDER BY sequence ASC')
      .all();

    assert.equal(restarted.integrity.status, 'ok');
    assert.equal(restarted.schemaVersionColumnPresent, true);
    assert.equal(restarted.schemaVersion, RECOVERY_JOURNAL_SCHEMA_VERSION);
    assert.equal(restarted.tableSchemaVersion, RECOVERY_JOURNAL_SCHEMA_VERSION);
    assert.deepEqual(restarted.tableSchemaVersions, [RECOVERY_JOURNAL_SCHEMA_VERSION]);
    assert.deepEqual(restarted.recordSchemaVersions, [RECOVERY_JOURNAL_SCHEMA_VERSION]);
    assert.deepEqual(
      restarted.records.map((record) => record.sequence),
      Array.from({ length: seeded.records.length }, (_, index) => index + 1),
    );
    assert.deepEqual(
      restarted.records.map(withoutSchemaVersion),
      seeded.records.map(withoutSchemaVersion),
    );
    assert.ok(restarted.records.every((record) => record.schemaVersion === RECOVERY_JOURNAL_SCHEMA_VERSION));
    assert.equal(tableRows.length, seeded.records.length);
    assert.ok(tableRows.every((row) => row.schema_version === RECOVERY_JOURNAL_SCHEMA_VERSION));
    assert.ok(
      tableRows.every((row) => JSON.parse(row.record_json).schemaVersion === RECOVERY_JOURNAL_SCHEMA_VERSION),
    );

    assertGeneratedRestartState(generatedCase, restarted, sites.plan);
    assertGeneratedInspection(generatedCase, restarted, sites.plan, seeded.current);

    proofRows.push({
      id: generatedCase.id,
      state: generatedCase.state,
      storageShape: generatedCase.storageShape,
      records: restarted.records.length,
      migratedRecords: migration.migratedRecords,
      schemaVersionColumnAdded: migration.schemaVersionColumnAdded,
      restartReadable: restarted.integrity.status === 'ok',
      productionBacked: false,
    });

    database.close();
  }

  assert.deepEqual(
    proofRows.map((row) => row.state),
    ['open', 'staged', 'committed'],
  );
  assert.ok(proofRows.every((row) => row.restartReadable === true));
  assert.ok(proofRows.every((row) => row.productionBacked === false));
});
