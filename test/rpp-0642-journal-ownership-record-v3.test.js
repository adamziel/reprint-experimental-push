import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

function tempJournalPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0642-journal-'));
  return path.join(dir, 'recovery.jsonl');
}

function tempSqlitePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0642-sqlite-'));
  return path.join(dir, 'recovery.sqlite');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite() {
  const files = {};
  for (let index = 1; index <= 5; index++) {
    files[`rpp-0642-file-${index}.txt`] = `rpp-0642-base-raw-site-value-${index}`;
  }
  return { files, plugins: {}, db: {} };
}

function localSite(base = baseSite()) {
  const site = cloneJson(base);
  for (let index = 1; index <= 5; index++) {
    site.files[`rpp-0642-file-${index}.txt`] = `rpp-0642-local-raw-site-value-${index}`;
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
  assert.equal(plan.mutations.length, 5);
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
    'rpp-0642-base-raw-site-value',
    'rpp-0642-local-raw-site-value',
  ]);
  for (const site of sites) {
    for (const value of Object.values(site.files || {})) {
      values.add(value);
    }
  }
  return [...values];
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

test('RPP-0642 file-backed journal ownership record exposes owner identity after restart without raw payloads', () => {
  const filePath = tempJournalPath();
  const { plan, remote, rawSiteValues } = buildScenario();
  const claimId = 'rpp-0642-owner-identity-claim';
  const artifactRefs = {
    releaseProof: 'artifact://rpp-0642-journal-ownership-record-v3',
    recoverySupport: 'artifact://rpp-0642-local-recovery-support',
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

  const restarted = readRecoveryJournal(filePath);
  const ownershipRecords = ownershipRecordsFor(restarted);
  assert.equal(restarted.integrity.status, 'ok');
  assert.equal(ownershipRecords.length, 1);
  assertOwnershipRecordContract(ownershipRecords[0], {
    claimId,
    plan,
    artifactRefs,
    rawSiteValues,
  });
  assertNoRawSiteValues(restarted.records, rawSiteValues);

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
  assert.equal(ownershipRecordsFor(readRecoveryJournal(filePath)).length, 1);
});

test('RPP-0642 SQLite readback preserves ownership owner identity without raw payloads', {
  skip: DatabaseSync === null ? 'node:sqlite is unavailable in this Node.js runtime' : false,
}, () => {
  const filePath = tempJournalPath();
  const sqlitePath = tempSqlitePath();
  const { plan, remote, rawSiteValues } = buildScenario();
  const claimId = 'rpp-0642-sqlite-owner-identity-claim';
  const artifactRefs = {
    releaseProof: 'artifact://rpp-0642-sqlite-journal-ownership-record-v3',
    recoverySupport: 'artifact://rpp-0642-local-sqlite-recovery-support',
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
  database.close();

  database = new DatabaseSync(sqlitePath);
  try {
    const restarted = readSqliteRecoveryJournalTable(database);
    const ownershipRecords = ownershipRecordsFor(restarted);
    assert.equal(restarted.storage, 'sqlite');
    assert.equal(restarted.integrity.status, 'ok');
    assert.equal(ownershipRecords.length, 1);
    assert.deepEqual(ownershipRecords[0], seededOwnershipRecord);
    assertOwnershipRecordContract(ownershipRecords[0], {
      claimId,
      plan,
      artifactRefs,
      rawSiteValues,
    });
    assertNoRawSiteValues(restarted.records, rawSiteValues);

    const inspection = inspectRecoveryJournal({
      journal: restarted,
      plan,
      current: remote,
    });
    assert.equal(inspection.status, 'old-remote');
    assert.equal(inspection.claim.activeClaimId, claimId);
    assert.equal(inspection.claim.activeClaimHash, recoveryClaimHash(claimId));
    assertNoRawSiteValues(inspection.claim, rawSiteValues);

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
