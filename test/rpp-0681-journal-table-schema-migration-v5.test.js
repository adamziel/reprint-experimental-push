import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { applyPlan } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
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
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const claimId = 'rpp-0681-release-verifier-migration-v5-claim';
const tableName = 'rpp_0681_recovery_journal';
const hashPattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
let DatabaseSync = null;

try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  DatabaseSync = null;
}

function tempJournalPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0681-journal-'));
  return path.join(dir, 'recovery.jsonl');
}

function tempSqlitePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0681-sqlite-'));
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
  const rawFixtures = [];
  for (let index = 1; index <= 7; index++) {
    const fileKey = `rpp-0681-completed-file-${index}.txt`;
    base.files[fileKey] = `base-rpp-0681-release-verifier-completed-${index}`;
    rawFixtures.push(fileKey, base.files[fileKey]);
  }

  const local = cloneJson(base);
  const remote = cloneJson(base);
  for (let index = 1; index <= 7; index++) {
    const fileKey = `rpp-0681-completed-file-${index}.txt`;
    local.files[fileKey] = `local-rpp-0681-release-verifier-completed-${index}`;
    rawFixtures.push(local.files[fileKey]);
  }

  const plan = createPushPlan({
    base,
    local,
    remote,
    now: fixedNow,
  });
  assert.equal(plan.status, 'ready');
  assert.equal(plan.mutations.length, 7);
  return { base, local, remote, plan, rawFixtures };
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
    || record.type === 'apply-staged'
    || record.type === 'journal-completed'
    || record.sequence % 3 === 0;
}

function shouldStoreNullTableSchemaVersion(record) {
  return record.type === 'recovery-claim-opened'
    || record.type === 'apply-committing'
    || record.type === 'journal-completed'
    || record.sequence % 4 === 0;
}

function writeVariantFiveSqliteJournalTable(database, records) {
  database.exec(`CREATE TABLE ${tableName} (
    sequence INTEGER PRIMARY KEY,
    schema_version INTEGER,
    record_json TEXT NOT NULL
  )`);
  const insert = database.prepare(
    `INSERT INTO ${tableName} (sequence, schema_version, record_json) VALUES (?, ?, ?)`,
  );
  const storedRows = records.map((record) => {
    const storedRecord = shouldOmitRecordSchemaVersion(record)
      ? withoutSchemaVersion(record)
      : { ...record };
    const tableSchemaVersion = shouldStoreNullTableSchemaVersion(record)
      ? null
      : RECOVERY_JOURNAL_SCHEMA_VERSION;
    insert.run(record.sequence, tableSchemaVersion, JSON.stringify(storedRecord));
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

function fixtureCounts(storedRows) {
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

  return {
    missingRecordSchemaRows,
    nullTableSchemaRows,
    rowsNeedingMigration,
  };
}

function buildReleaseVerifierProof({
  strictLegacyRead,
  migration,
  restarted,
  inspection,
  plan,
  counts,
}) {
  const proof = {
    rpp: 'RPP-0681',
    variant: 5,
    evidenceSource: 'release-verifier-journal-table-schema-migration-v5',
    status: 'support_only',
    verdict: 'JOURNAL_TABLE_SCHEMA_MIGRATION_RECOVERY_STATE_PROVED_SUPPORT_ONLY',
    evidenceScope: 'local-sqlite-backed-release-verifier',
    productionBacked: false,
    releaseEligible: false,
    releaseGate: 'NO-GO',
    rawValuesIncluded: false,
    storage: 'sqlite',
    tableName,
    preMigration: {
      integrityStatus: strictLegacyRead.integrity.status,
      failedClosed: strictLegacyRead.integrity.status === 'blocked',
      schemaVersionColumnPresent: strictLegacyRead.schemaVersionColumnPresent,
      tableSchemaVersionMissing: strictLegacyRead.integrity.errors
        .some((error) => error.code === 'JOURNAL_TABLE_SCHEMA_VERSION_MISSING'),
      unsupportedTableSchema: strictLegacyRead.integrity.errors
        .some((error) => error.code === 'JOURNAL_TABLE_SCHEMA_UNSUPPORTED'),
      unsupportedRecordSchema: strictLegacyRead.integrity.errors
        .some((error) => error.code === 'JOURNAL_SCHEMA_UNSUPPORTED'),
      completedStateVisible: strictLegacyRead.committedState.status === 'completed',
      completedRestartReadable: strictLegacyRead.committedState.restartReadable,
    },
    migration: {
      migrated: migration.migrated,
      schemaVersionColumnAdded: migration.schemaVersionColumnAdded,
      records: migration.records,
      migratedRecords: migration.migratedRecords,
      updatedTableRows: migration.updatedTableRows,
      preservedRows: migration.preservedRows,
      restartReadable: migration.restartReadable,
      integrityStatus: migration.integrity.status,
      tableSchemaVersions: migration.tableSchemaVersions,
      recordSchemaVersions: migration.recordSchemaVersions,
      fixtureRowsMissingRecordSchema: counts.missingRecordSchemaRows,
      fixtureRowsMissingTableSchema: counts.nullTableSchemaRows,
      fixtureRowsNeedingMigration: counts.rowsNeedingMigration,
    },
    restart: {
      integrityStatus: restarted.integrity.status,
      schemaVersionColumnPresent: restarted.schemaVersionColumnPresent,
      tableSchemaVersion: restarted.tableSchemaVersion,
      openRows: restarted.openState.openRows,
      targetRows: restarted.committedState.targetRows,
      mutationRows: restarted.committedState.mutationRows,
      completedRows: restarted.committedState.completedRows,
      restartReadable: restarted.committedState.restartReadable,
      allTargetsCommitted: restarted.committedState.targetEnvelope.allTargetsCommitted,
      leaseOwnerClaimHash: restarted.committedState.leaseOwner.claimHash,
      leaseOwnerClaimKeyHash: restarted.committedState.leaseOwner.claimKeyHash,
      latestCompletedSequence: restarted.committedState.latestCompletedSequence,
    },
    remoteRecovery: {
      status: inspection.status,
      classificationState: inspection.remoteRecoveryClassification.state,
      classificationKind: inspection.remoteRecoveryClassification.kind,
      proved: inspection.remoteRecoveryClassification.proved,
      replaySafe: inspection.remoteRecoveryClassification.replaySafe,
      counts: inspection.remoteRecoveryClassification.counts,
      journalState: inspection.remoteRecoveryClassification.journalState,
      storage: inspection.remoteRecoveryClassification.storage,
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: 'support-only SQLite-backed journal table migration proof; production release boundary still required',
    },
    plannedTargets: plan.mutations.length,
  };

  return {
    ...proof,
    proofHash: `sha256:${digest(proof)}`,
  };
}

function assertReleaseVerifierProof(proof, plan) {
  assert.equal(proof.rpp, 'RPP-0681');
  assert.equal(proof.variant, 5);
  assert.equal(proof.evidenceSource, 'release-verifier-journal-table-schema-migration-v5');
  assert.equal(proof.status, 'support_only');
  assert.equal(proof.verdict, 'JOURNAL_TABLE_SCHEMA_MIGRATION_RECOVERY_STATE_PROVED_SUPPORT_ONLY');
  assert.equal(proof.evidenceScope, 'local-sqlite-backed-release-verifier');
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.releaseGate, 'NO-GO');
  assert.equal(proof.rawValuesIncluded, false);
  assert.equal(proof.preMigration.failedClosed, true);
  assert.equal(proof.preMigration.tableSchemaVersionMissing, false);
  assert.equal(proof.preMigration.unsupportedTableSchema, true);
  assert.equal(proof.preMigration.unsupportedRecordSchema, true);
  assert.equal(proof.preMigration.completedStateVisible, true);
  assert.equal(proof.preMigration.completedRestartReadable, false);
  assert.equal(proof.migration.migrated, true);
  assert.equal(proof.migration.schemaVersionColumnAdded, false);
  assert.equal(proof.migration.preservedRows, true);
  assert.equal(proof.migration.restartReadable, true);
  assert.equal(proof.migration.integrityStatus, 'ok');
  assert.deepEqual(proof.migration.tableSchemaVersions, [RECOVERY_JOURNAL_SCHEMA_VERSION]);
  assert.deepEqual(proof.migration.recordSchemaVersions, [RECOVERY_JOURNAL_SCHEMA_VERSION]);
  assert.equal(proof.migration.migratedRecords, proof.migration.fixtureRowsMissingRecordSchema);
  assert.equal(proof.migration.updatedTableRows, proof.migration.fixtureRowsNeedingMigration);
  assert.ok(proof.migration.fixtureRowsMissingTableSchema > 0);
  assert.equal(proof.restart.integrityStatus, 'ok');
  assert.equal(proof.restart.schemaVersionColumnPresent, true);
  assert.equal(proof.restart.tableSchemaVersion, RECOVERY_JOURNAL_SCHEMA_VERSION);
  assert.equal(proof.restart.mutationRows, plan.mutations.length);
  assert.equal(proof.restart.completedRows, 1);
  assert.equal(proof.restart.restartReadable, true);
  assert.equal(proof.restart.allTargetsCommitted, true);
  assert.match(proof.restart.leaseOwnerClaimHash, hashPattern);
  assert.match(proof.restart.leaseOwnerClaimKeyHash, hashPattern);
  assert.equal(proof.remoteRecovery.status, 'fully-updated-remote');
  assert.equal(proof.remoteRecovery.classificationState, 'fully-updated-remote');
  assert.equal(proof.remoteRecovery.classificationKind, 'new-remote');
  assert.equal(proof.remoteRecovery.proved, true);
  assert.equal(proof.remoteRecovery.replaySafe, true);
  assert.deepEqual(proof.remoteRecovery.counts, {
    old: 0,
    new: plan.mutations.length,
    blockedUnknown: 0,
    total: plan.mutations.length,
  });
  assert.equal(proof.remoteRecovery.journalState, 'ok');
  assert.equal(proof.remoteRecovery.storage, 'sqlite');
  assert.deepEqual(proof.releaseMovement, {
    allowed: false,
    gates: '0/4',
    reason: 'support-only SQLite-backed journal table migration proof; production release boundary still required',
  });
  assert.equal(proof.plannedTargets, plan.mutations.length);
  assert.match(proof.proofHash, sha256EvidencePattern);

  const { proofHash, ...proofWithoutHash } = proof;
  assert.equal(proofHash, `sha256:${digest(proofWithoutHash)}`);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0681 release verifier proof' }));
}

function assertProofHasNoRawFixtures(proof, rawFixtures) {
  const serialized = JSON.stringify(proof);
  for (const rawFixture of rawFixtures) {
    assert.equal(
      serialized.includes(rawFixture),
      false,
      `RPP-0681 release verifier proof leaked raw fixture ${rawFixture}`,
    );
  }
  assert.equal(serialized.includes(claimId), false, 'RPP-0681 release verifier proof leaked claim id');
}

test('RPP-0681 release verifier carries SQLite journal table schema migration variant 5 recovery state', {
  skip: DatabaseSync === null ? 'node:sqlite is unavailable in this Node.js runtime' : false,
}, () => {
  const sqlitePath = tempSqlitePath();
  const sites = completedSites();
  const seeded = seedCompletedFileJournal(sites);
  let database = new DatabaseSync(sqlitePath);
  const storedRows = writeVariantFiveSqliteJournalTable(database, seeded.records);
  const counts = fixtureCounts(storedRows);
  const strictLegacyRead = readSqliteRecoveryJournalTable(database, { tableName });

  assert.equal(strictLegacyRead.tableName, tableName);
  assert.equal(strictLegacyRead.integrity.status, 'blocked');
  assert.equal(strictLegacyRead.schemaVersionColumnPresent, true);
  assert.deepEqual(strictLegacyRead.tableSchemaVersions, [RECOVERY_JOURNAL_SCHEMA_VERSION]);
  assert.deepEqual(strictLegacyRead.recordSchemaVersions, [RECOVERY_JOURNAL_SCHEMA_VERSION]);
  assertIntegrityIncludes(strictLegacyRead, 'JOURNAL_TABLE_SCHEMA_VERSION_MISSING', false);
  assertIntegrityIncludes(strictLegacyRead, 'JOURNAL_TABLE_SCHEMA_UNSUPPORTED', true);
  assertIntegrityIncludes(strictLegacyRead, 'JOURNAL_SCHEMA_UNSUPPORTED', true);
  assert.equal(strictLegacyRead.committedState.status, 'completed');
  assert.equal(strictLegacyRead.committedState.restartReadable, false);
  assert.ok(counts.missingRecordSchemaRows > 0);
  assert.ok(counts.nullTableSchemaRows > 0);
  assert.ok(counts.rowsNeedingMigration > counts.missingRecordSchemaRows);
  assert.ok(counts.rowsNeedingMigration > counts.nullTableSchemaRows);

  const migration = migrateSqliteRecoveryJournalTableSchema(database, { tableName });

  assert.equal(migration.storage, 'sqlite');
  assert.equal(migration.tableName, tableName);
  assert.equal(migration.exists, true);
  assert.equal(migration.schemaVersion, RECOVERY_JOURNAL_SCHEMA_VERSION);
  assert.equal(migration.tableSchemaVersion, RECOVERY_JOURNAL_SCHEMA_VERSION);
  assert.deepEqual(migration.tableSchemaVersions, [RECOVERY_JOURNAL_SCHEMA_VERSION]);
  assert.deepEqual(migration.recordSchemaVersions, [RECOVERY_JOURNAL_SCHEMA_VERSION]);
  assert.equal(migration.migrated, true);
  assert.equal(migration.schemaVersionColumnAdded, false);
  assert.equal(migration.records, seeded.records.length);
  assert.equal(migration.migratedRecords, counts.missingRecordSchemaRows);
  assert.equal(migration.updatedTableRows, counts.rowsNeedingMigration);
  assert.equal(migration.preservedRows, true);
  assert.equal(migration.restartReadable, true);
  assert.equal(migration.integrity.status, 'ok');
  assertCompletedRestartState(migration.journal, sites.plan);

  database.close();
  database = new DatabaseSync(sqlitePath);
  const restarted = readSqliteRecoveryJournalTable(database, { tableName });
  const tableRows = database
    .prepare(`SELECT sequence, schema_version, record_json FROM ${tableName} ORDER BY sequence ASC`)
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

  const proof = buildReleaseVerifierProof({
    strictLegacyRead,
    migration,
    restarted,
    inspection,
    plan: sites.plan,
    counts,
  });
  assertReleaseVerifierProof(proof, sites.plan);
  assertProofHasNoRawFixtures(proof, sites.rawFixtures);

  database.close();
});
