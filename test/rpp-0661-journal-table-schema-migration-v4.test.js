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
  openRecoveryJournal,
  readRecoveryJournal,
  readSqliteRecoveryJournalTable,
  RECOVERY_JOURNAL_SCHEMA_VERSION,
  recoveryClaimHash,
} from '../src/recovery-journal.js';

const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const claimId = 'rpp-0661-completed-migration-v4-claim';
let DatabaseSync = null;

try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  DatabaseSync = null;
}

function tempJournalPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0661-journal-'));
  return path.join(dir, 'recovery.jsonl');
}

function tempSqlitePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0661-sqlite-'));
  return path.join(dir, 'recovery.sqlite');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function withoutSchemaVersion(record) {
  const { schemaVersion, ...rest } = record;
  return rest;
}

function completedSites() {
  const base = { files: {}, plugins: {}, db: {} };
  for (let index = 1; index <= 6; index++) {
    base.files[`rpp-0661-completed-file-${index}.txt`] =
      `base-rpp-0661-completed-${index}`;
  }

  const local = cloneJson(base);
  const remote = cloneJson(base);
  for (let index = 1; index <= 6; index++) {
    local.files[`rpp-0661-completed-file-${index}.txt`] =
      `local-rpp-0661-completed-${index}`;
  }

  const plan = createPushPlan({
    base,
    local,
    remote,
    now: fixedNow,
  });
  assert.equal(plan.status, 'ready');
  assert.equal(plan.mutations.length, 6);
  return { base, local, remote, plan };
}

function seedCompletedFileJournal({ plan, remote }) {
  const filePath = tempJournalPath();
  const committedRemote = cloneJson(remote);
  const durableJournal = openRecoveryJournal(filePath, {
    truncate: true,
    now: fixedNow,
    claimId,
  });

  try {
    const applied = applyPlan(committedRemote, plan, {
      durableJournal,
      mutateRemote: true,
    });
    assert.equal(applied.appliedMutations, plan.mutations.length);
    assert.equal(applied.recoveryState.status, 'fully-updated-remote');
  } finally {
    durableJournal.close();
  }

  const journal = readRecoveryJournal(filePath);
  assert.equal(journal.integrity.status, 'ok');
  assert.equal(journal.committedState.status, 'completed');
  assert.equal(journal.committedState.restartReadable, true);
  assert.equal(journal.committedState.mutationRows, plan.mutations.length);
  assert.equal(journal.committedState.completedRows, 1);

  const inspection = inspectRecoveryJournal({
    journal,
    plan,
    current: committedRemote,
  });
  assert.equal(inspection.status, 'fully-updated-remote');
  assert.deepEqual(inspection.counts, {
    old: 0,
    new: plan.mutations.length,
    blockedUnknown: 0,
  });

  return {
    filePath,
    committedRemote,
    records: journal.records,
  };
}

function shouldOmitRecordSchemaVersion(record) {
  return record.type === 'recovery-claim-opened'
    || record.type === 'target-planned'
    || record.type === 'journal-completed'
    || record.sequence % 4 === 0;
}

function shouldStoreNullTableSchemaVersion(record) {
  return record.sequence === 1
    || record.type === 'apply-committing'
    || record.type === 'journal-completed'
    || record.sequence % 5 === 0;
}

function writeVariantFourSqliteJournalTable(database, records) {
  database.exec(`CREATE TABLE recovery_journal (
    sequence INTEGER PRIMARY KEY,
    record_json TEXT NOT NULL,
    schema_version INTEGER
  )`);
  const insert = database.prepare(
    'INSERT INTO recovery_journal (sequence, record_json, schema_version) VALUES (?, ?, ?)',
  );
  const storedRows = records.map((record) => {
    const storedRecord = shouldOmitRecordSchemaVersion(record)
      ? withoutSchemaVersion(record)
      : { ...record };
    const tableSchemaVersion = shouldStoreNullTableSchemaVersion(record)
      ? null
      : RECOVERY_JOURNAL_SCHEMA_VERSION;
    insert.run(record.sequence, JSON.stringify(storedRecord), tableSchemaVersion);
    return {
      sequence: record.sequence,
      record: storedRecord,
      tableSchemaVersion,
    };
  });

  return storedRows;
}

function assertIntegrityIncludes(read, code, expected = true) {
  assert.equal(
    read.integrity.errors.some((error) => error.code === code),
    expected,
    `${read.tableName || 'journal'} expected ${code} presence to be ${expected}`,
  );
}

function assertCompletedRestartState(journal, plan) {
  assert.equal(journal.openState.status, 'opened');
  assert.equal(journal.openState.restartReadable, true);
  assert.equal(journal.openState.openRows, 1);
  assert.equal(journal.stagedState.status, 'staged');
  assert.equal(journal.stagedState.restartReadable, true);
  assert.equal(journal.stagedState.targetRows, plan.mutations.length);
  assert.deepEqual(journal.stagedState.targetEnvelope, {
    plannedTargets: plan.mutations.length,
    allTargetsHaveHashes: true,
  });
  assert.equal(journal.committedState.status, 'completed');
  assert.equal(journal.committedState.phase, 'completed');
  assert.equal(journal.committedState.restartReadable, true);
  assert.equal(journal.committedState.mutationRows, plan.mutations.length);
  assert.equal(journal.committedState.completedRows, 1);
  assert.equal(journal.committedState.targetRows, plan.mutations.length);
  assert.equal(journal.committedState.committedTargetRows, plan.mutations.length);
  assert.deepEqual(journal.committedState.targetEnvelope, {
    plannedTargets: plan.mutations.length,
    committedTargets: plan.mutations.length,
    allCommittedTargetsHaveHashes: true,
    allTargetsCommitted: true,
  });
  assert.deepEqual(journal.committedState.leaseOwner, {
    visible: true,
    claimId,
    claimHash: recoveryClaimHash(claimId),
    claimKeyHash: recoveryClaimHash(claimId),
    sequence: journal.committedState.latestCompletedSequence,
    eventType: 'journal-completed',
  });
}

test('RPP-0661 SQLite journal table schema migration variant 4 preserves completed recovery state', {
  skip: DatabaseSync === null ? 'node:sqlite is unavailable in this Node.js runtime' : false,
}, () => {
  const sqlitePath = tempSqlitePath();
  const sites = completedSites();
  const seeded = seedCompletedFileJournal(sites);
  let database = new DatabaseSync(sqlitePath);
  const storedRows = writeVariantFourSqliteJournalTable(database, seeded.records);
  const missingRecordSchemaRows = storedRows
    .filter((row) => !Object.hasOwn(row.record, 'schemaVersion'))
    .length;
  const nullTableSchemaRows = storedRows
    .filter((row) => row.tableSchemaVersion !== RECOVERY_JOURNAL_SCHEMA_VERSION)
    .length;
  const rowsNeedingMigration = storedRows
    .filter((row) => (
      !Object.hasOwn(row.record, 'schemaVersion')
        || row.tableSchemaVersion !== RECOVERY_JOURNAL_SCHEMA_VERSION
    ))
    .length;
  const strictLegacyRead = readSqliteRecoveryJournalTable(database);

  assert.equal(strictLegacyRead.integrity.status, 'blocked');
  assert.equal(strictLegacyRead.schemaVersionColumnPresent, true);
  assert.deepEqual(strictLegacyRead.tableSchemaVersions, [RECOVERY_JOURNAL_SCHEMA_VERSION]);
  assert.deepEqual(strictLegacyRead.recordSchemaVersions, [RECOVERY_JOURNAL_SCHEMA_VERSION]);
  assertIntegrityIncludes(strictLegacyRead, 'JOURNAL_TABLE_SCHEMA_VERSION_MISSING', false);
  assertIntegrityIncludes(strictLegacyRead, 'JOURNAL_TABLE_SCHEMA_UNSUPPORTED', true);
  assertIntegrityIncludes(strictLegacyRead, 'JOURNAL_SCHEMA_UNSUPPORTED', true);
  assert.equal(strictLegacyRead.committedState.status, 'completed');
  assert.equal(strictLegacyRead.committedState.restartReadable, false);
  assert.ok(missingRecordSchemaRows > 0);
  assert.ok(nullTableSchemaRows > 0);
  assert.ok(rowsNeedingMigration > missingRecordSchemaRows);

  const migration = migrateSqliteRecoveryJournalTableSchema(database);

  assert.equal(migration.storage, 'sqlite');
  assert.equal(migration.tableName, 'recovery_journal');
  assert.equal(migration.exists, true);
  assert.equal(migration.schemaVersion, RECOVERY_JOURNAL_SCHEMA_VERSION);
  assert.equal(migration.tableSchemaVersion, RECOVERY_JOURNAL_SCHEMA_VERSION);
  assert.deepEqual(migration.tableSchemaVersions, [RECOVERY_JOURNAL_SCHEMA_VERSION]);
  assert.deepEqual(migration.recordSchemaVersions, [RECOVERY_JOURNAL_SCHEMA_VERSION]);
  assert.equal(migration.migrated, true);
  assert.equal(migration.schemaVersionColumnAdded, false);
  assert.equal(migration.records, seeded.records.length);
  assert.equal(migration.migratedRecords, missingRecordSchemaRows);
  assert.equal(migration.updatedTableRows, rowsNeedingMigration);
  assert.equal(migration.preservedRows, true);
  assert.equal(migration.restartReadable, true);
  assert.equal(migration.integrity.status, 'ok');
  assertCompletedRestartState(migration.journal, sites.plan);

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

  assertCompletedRestartState(restarted, sites.plan);
  const inspection = inspectRecoveryJournal({
    journal: restarted,
    plan: sites.plan,
    current: seeded.committedRemote,
  });
  assert.equal(inspection.status, 'fully-updated-remote');
  assert.deepEqual(inspection.counts, {
    old: 0,
    new: sites.plan.mutations.length,
    blockedUnknown: 0,
  });
  assert.deepEqual(inspection.remoteClassification, {
    state: 'new-remote',
    status: 'fully-updated-remote',
    evidence: 'hash-only-before-after-target-envelope',
    allTargetsAccountedFor: true,
  });
  assert.deepEqual(inspection.remoteRecoveryClassification, {
    kind: 'new-remote',
    state: 'fully-updated-remote',
    proved: true,
    replaySafe: true,
    counts: {
      old: 0,
      new: sites.plan.mutations.length,
      blockedUnknown: 0,
      total: sites.plan.mutations.length,
    },
    journalState: 'ok',
    storage: 'sqlite',
  });

  database.close();
});
