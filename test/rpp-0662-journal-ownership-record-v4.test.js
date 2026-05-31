import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPushPlan } from '../src/planner.js';
import { inspectRecoveryJournal } from '../src/recovery-inspect.js';
import {
  assertJournalRecordHasNoRawValues,
  openProductionRecoveryJournal,
  readRecoveryJournal,
  readSqliteRecoveryJournalTable,
  recoveryClaimHash,
} from '../src/recovery-journal.js';

const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let DatabaseSync = null;

try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const expectedOwnership = Object.freeze({
  ownsJournal: true,
  restartReadable: true,
  productionAdapter: 'filesystem-compare-rename',
  supportedSurface: 'claim-fenced-restart-readable',
});

const fileJournalReadScript = `
import { readRecoveryJournal } from './src/recovery-journal.js';

const journal = readRecoveryJournal(process.argv[1]);
process.stdout.write(JSON.stringify(journal));
`;

const sqliteJournalReadScript = `
import { DatabaseSync } from 'node:sqlite';
import { readSqliteRecoveryJournalTable } from './src/recovery-journal.js';

const database = new DatabaseSync(process.argv[1]);
try {
  const journal = readSqliteRecoveryJournalTable(database);
  process.stdout.write(JSON.stringify(journal));
} finally {
  database.close();
}
`;

function tempJournalPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0662-journal-'));
  return path.join(dir, 'recovery.jsonl');
}

function tempSqlitePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0662-sqlite-'));
  return path.join(dir, 'recovery.sqlite');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite() {
  const files = {};
  for (let index = 1; index <= 4; index++) {
    files[`rpp-0662-file-${index}.txt`] = `rpp-0662-base-raw-site-value-${index}`;
  }
  return { files, plugins: {}, db: {} };
}

function localSite(base = baseSite()) {
  const site = cloneJson(base);
  for (let index = 1; index <= 4; index++) {
    site.files[`rpp-0662-file-${index}.txt`] = `rpp-0662-local-raw-site-value-${index}`;
  }
  return site;
}

function buildScenario() {
  const base = baseSite();
  const local = localSite(base);
  const remote = cloneJson(base);
  const plan = createPushPlan({
    base,
    local,
    remote,
    now: fixedNow,
  });
  assert.equal(plan.status, 'ready');
  assert.equal(plan.mutations.length, 4);
  return {
    base,
    local,
    remote,
    plan,
    rawSiteValues: rawSiteValuesFor(base, local, remote),
  };
}

function rawSiteValuesFor(...sites) {
  const values = new Set([
    'rpp-0662-base-raw-site-value',
    'rpp-0662-local-raw-site-value',
  ]);
  for (const site of sites) {
    for (const value of Object.values(site.files || {})) {
      values.add(value);
    }
  }
  return [...values];
}

function readFileJournalAfterProcessRestart(filePath) {
  return readJournalInFreshProcess(fileJournalReadScript, filePath);
}

function readSqliteJournalAfterProcessRestart(sqlitePath) {
  return readJournalInFreshProcess(sqliteJournalReadScript, sqlitePath);
}

function readJournalInFreshProcess(script, journalPath) {
  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '--eval',
    script,
    journalPath,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });

  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function ownershipRecordsFor(journal) {
  return journal.records.filter((record) => record.type === 'journal-ownership-recorded');
}

function assertOwnerIdentity(record, claimId) {
  assert.equal(record.claimId, claimId);
  assert.equal(record.claimHash, recoveryClaimHash(claimId));
  assert.match(record.journalIdentityHash, /^[a-f0-9]{64}$/);
}

function assertOwnershipRecordContract(record, {
  claimId,
  plan,
  artifactRefs,
  rawSiteValues,
}) {
  assert.equal(record.sequence, 2);
  assert.equal(record.planId, plan.id);
  assert.equal(record.state, 'owned');
  assertOwnerIdentity(record, claimId);
  assert.deepEqual(record.artifactRefs, artifactRefs);
  assert.deepEqual(record.ownership, expectedOwnership);
  assert.deepEqual(record.storageGuard, {
    boundary: 'filesystem-compare-rename',
    operation: 'append',
    outcome: 'ownership-recorded',
  });
  assert.equal(record.fsync.requested, true);
  assert.equal(record.fsync.strategy, 'after-append');
  assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(record));
  assertNoRawSiteValues(record, rawSiteValues);
}

function assertOwnershipSummaryContract(record, {
  claimId,
  rawSiteValues,
}) {
  assert.equal(record.sequence, 2);
  assert.equal(record.type, 'journal-ownership-recorded');
  assert.equal(record.state, 'owned');
  assertOwnerIdentity(record, claimId);
  assert.deepEqual(record.ownership, expectedOwnership);
  assert.equal(record.restartReadable, true);
  assert.deepEqual(record.storageGuard, {
    boundary: 'filesystem-compare-rename',
    operation: 'append',
    outcome: 'ownership-recorded',
  });
  assert.equal(record.fsync.requested, true);
  assert.equal(record.fsync.strategy, 'after-append');
  assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(record));
  assertNoRawSiteValues(record, rawSiteValues);
}

function assertJournalRowsDurableAfterRestart(restarted, seededRecords, {
  plan,
  rawSiteValues,
}) {
  assert.equal(restarted.integrity.status, 'ok');
  assert.deepEqual(restarted.records, seededRecords);
  assert.equal(restarted.records.length, plan.mutations.length + 3);
  assert.deepEqual(
    restarted.records.map((record) => record.sequence),
    Array.from({ length: restarted.records.length }, (_, index) => index + 1),
  );
  assert.equal(
    restarted.records.filter((record) => record.type === 'target-planned').length,
    plan.mutations.length,
  );
  assert.equal(ownershipRecordsFor(restarted).length, 1);
  assert.equal(
    restarted.records.filter((record) => record.type === 'recovery-claim-opened').length,
    1,
  );
  assert.ok(restarted.records.every((record) => record.fsync.requested === true));
  assertNoRawSiteValues(restarted.records, rawSiteValues);
}

function assertRestartInspection(restarted, {
  plan,
  remote,
  claimId,
  rawSiteValues,
}) {
  const inspection = inspectRecoveryJournal({
    journal: restarted,
    plan,
    current: remote,
  });
  assert.equal(inspection.status, 'old-remote');
  assert.deepEqual(inspection.counts, {
    old: plan.mutations.length,
    new: 0,
    blockedUnknown: 0,
  });
  assert.equal(inspection.claim.activeClaimId, claimId);
  assert.equal(inspection.claim.activeClaimHash, recoveryClaimHash(claimId));
  assertNoRawSiteValues(inspection.claim, rawSiteValues);
}

function assertNoRawSiteValues(value, rawSiteValues) {
  const serialized = JSON.stringify(value);
  for (const rawValue of rawSiteValues) {
    assert.equal(
      serialized.includes(rawValue),
      false,
      `Unexpected raw site value in ownership evidence: ${rawValue}`,
    );
  }
}

function writeSqliteJournalTable(database, records) {
  database.exec(`CREATE TABLE recovery_journal (
    sequence INTEGER PRIMARY KEY,
    schema_version INTEGER NOT NULL,
    record_json TEXT NOT NULL
  )`);
  const insert = database.prepare(
    'INSERT INTO recovery_journal (sequence, schema_version, record_json) VALUES (?, ?, ?)',
  );
  for (const record of records) {
    insert.run(record.sequence, record.schemaVersion, JSON.stringify(record));
  }
}

test('RPP-0662 file-backed journal ownership rows are durable after process restart', () => {
  const filePath = tempJournalPath();
  const { plan, remote, rawSiteValues } = buildScenario();
  const claimId = 'rpp-0662-file-backed-ownership-claim';
  const artifactRefs = {
    releaseProof: 'artifact://rpp-0662-journal-ownership-record-v4',
    recoverySupport: 'artifact://rpp-0662-local-recovery-support',
  };

  const journal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    now: fixedNow,
    claimId,
  });
  const initialInspection = journal.inspect();
  journal.close();

  assertOwnershipSummaryContract(initialInspection.journal.ownershipRecord, {
    claimId,
    rawSiteValues,
  });

  const seeded = readRecoveryJournal(filePath);
  const restarted = readFileJournalAfterProcessRestart(filePath);
  assertJournalRowsDurableAfterRestart(restarted, seeded.records, {
    plan,
    rawSiteValues,
  });
  assertOwnershipRecordContract(ownershipRecordsFor(restarted)[0], {
    claimId,
    plan,
    artifactRefs,
    rawSiteValues,
  });
  assertRestartInspection(restarted, {
    plan,
    remote,
    claimId,
    rawSiteValues,
  });

  const retry = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    now: fixedNow,
    truncate: false,
    claimId,
  });
  const retryInspection = retry.inspect();
  retry.close();

  assertOwnershipSummaryContract(retryInspection.journal.ownershipRecord, {
    claimId,
    rawSiteValues,
  });
  const afterRetry = readFileJournalAfterProcessRestart(filePath);
  assert.equal(afterRetry.integrity.status, 'ok');
  assert.equal(ownershipRecordsFor(afterRetry).length, 1);
  assert.ok(afterRetry.records.some((record) => record.type === 'journal-retry-opened'));
  assertNoRawSiteValues(afterRetry.records, rawSiteValues);
});

test('RPP-0662 SQLite journal ownership rows are durable after process restart', {
  skip: DatabaseSync === null ? 'node:sqlite is unavailable in this Node.js runtime' : false,
}, () => {
  const filePath = tempJournalPath();
  const sqlitePath = tempSqlitePath();
  const { plan, remote, rawSiteValues } = buildScenario();
  const claimId = 'rpp-0662-sqlite-ownership-claim';
  const artifactRefs = {
    releaseProof: 'artifact://rpp-0662-sqlite-journal-ownership-record-v4',
    recoverySupport: 'artifact://rpp-0662-local-sqlite-recovery-support',
  };

  const journal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    now: fixedNow,
    claimId,
  });
  journal.close();

  const seeded = readRecoveryJournal(filePath);
  const seededOwnershipRecord = ownershipRecordsFor(seeded)[0];
  assertOwnershipRecordContract(seededOwnershipRecord, {
    claimId,
    plan,
    artifactRefs,
    rawSiteValues,
  });

  let database = new DatabaseSync(sqlitePath);
  writeSqliteJournalTable(database, seeded.records);
  const initialRead = readSqliteRecoveryJournalTable(database);
  assert.equal(initialRead.integrity.status, 'ok');
  database.close();

  const restarted = readSqliteJournalAfterProcessRestart(sqlitePath);
  assert.equal(restarted.storage, 'sqlite');
  assert.equal(restarted.schemaVersionColumnPresent, true);
  assert.deepEqual(restarted.tableSchemaVersions, [1]);
  assert.deepEqual(restarted.recordSchemaVersions, [1]);
  assertJournalRowsDurableAfterRestart(restarted, seeded.records, {
    plan,
    rawSiteValues,
  });
  assertOwnershipRecordContract(ownershipRecordsFor(restarted)[0], {
    claimId,
    plan,
    artifactRefs,
    rawSiteValues,
  });
  assert.deepEqual(ownershipRecordsFor(restarted)[0], seededOwnershipRecord);
  assertRestartInspection(restarted, {
    plan,
    remote,
    claimId,
    rawSiteValues,
  });

  database = new DatabaseSync(sqlitePath);
  try {
    const storedOwnershipRows = database
      .prepare('SELECT sequence, schema_version, record_json FROM recovery_journal WHERE sequence = ?')
      .all(seededOwnershipRecord.sequence);
    assert.equal(storedOwnershipRows.length, 1);
    assert.equal(storedOwnershipRows[0].schema_version, seededOwnershipRecord.schemaVersion);
    assert.deepEqual(JSON.parse(storedOwnershipRows[0].record_json), seededOwnershipRecord);
  } finally {
    database.close();
  }
});
