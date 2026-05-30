import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendJournalCompleted,
  appendMutationObserved,
  assertJournalRecordHasNoRawValues,
  openPlanRecoveryJournal,
  readRecoveryJournal,
  readSqliteRecoveryJournalTable,
} from '../src/recovery-journal.js';
import { inspectRecoveryJournal } from '../src/recovery-inspect.js';
import {
  inspectRecoveryRepair,
  markRecoveryJournalRepaired,
  replayRecoveryRepair,
  RecoveryRepairError,
} from '../src/recovery-repair.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue, resourceHash, setResource } from '../src/resources.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
let DatabaseSync = null;

try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  DatabaseSync = null;
}

function tempJournalPath(prefix = 'rpp-0611-new-remote-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return path.join(dir, 'recovery.jsonl');
}

function tempSqlitePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpp-0611-new-remote-sqlite-'));
  return path.join(dir, 'recovery.sqlite');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite() {
  return {
    files: {
      'planned.txt': 'base-planned-bytes',
      'remote-only.txt': 'base-preserved-bytes',
    },
    plugins: {},
    db: {},
  };
}

function buildNewRemoteFixture() {
  const base = baseSite();
  const local = clone(base);
  const remote = clone(base);
  const privateLocal = 'rpp0611-private-local-planned-bytes';
  const privatePreservedBeforePlan = 'rpp0611-private-remote-preserved-before-plan';
  const privatePreservedAfterCrash = 'rpp0611-private-remote-preserved-after-crash';

  local.files['planned.txt'] = privateLocal;
  remote.files['remote-only.txt'] = privatePreservedBeforePlan;
  const plan = createPushPlan({ base, local, remote, now: fixedNow });
  const current = clone(remote);

  for (const mutation of plan.mutations) {
    setResource(current, mutation.resource, deserializeResourceValue(mutation.value));
  }
  current.files['remote-only.txt'] = privatePreservedAfterCrash;

  return {
    base,
    local,
    remote,
    current,
    plan,
    privateLocal,
    privatePreservedBeforePlan,
    privatePreservedAfterCrash,
  };
}

function writeCompletedHashOnlyJournal({ filePath, plan, remote, current }) {
  const journal = openPlanRecoveryJournal({
    filePath,
    plan,
    current: remote,
    now: fixedNow,
  });

  for (const mutation of plan.mutations) {
    appendMutationObserved(journal, {
      plan,
      mutation,
      current,
      state: 'applied',
    });
  }
  appendJournalCompleted(journal, { plan, current });
  journal.close();
  return readRecoveryJournal(filePath);
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

function assertPlanPreservesRemoteOnlyResource(plan) {
  assert.equal(plan.status, 'ready');
  assert.equal(plan.mutations.length, 1);
  assert.equal(plan.mutations[0].resourceKey, 'file:planned.txt');
  assert.equal(plan.preconditions.length, 1);
  assert.equal(plan.preconditions[0].resourceKey, 'file:planned.txt');

  const preservedDecision = plan.decisions.find(
    (decision) => decision.resourceKey === 'file:remote-only.txt',
  );
  assert.ok(preservedDecision, 'expected keep-remote decision for preserved resource');
  assert.equal(preservedDecision.decision, 'keep-remote');
  assert.equal(typeof preservedDecision.remoteHash, 'string');
  assert.match(preservedDecision.remoteHash, /^[a-f0-9]{64}$/);
  assert.equal(
    plan.mutations.some((mutation) => mutation.resourceKey === 'file:remote-only.txt'),
    false,
  );
  assert.equal(
    plan.preconditions.some((precondition) => precondition.resourceKey === 'file:remote-only.txt'),
    false,
  );
}

function assertNewRemoteClassification({ inspection, plan, current }) {
  assert.equal(inspection.status, 'fully-updated-remote');
  assert.deepEqual(inspection.remoteClassification, {
    state: 'new-remote',
    status: 'fully-updated-remote',
    evidence: 'hash-only-before-after-target-envelope',
    allTargetsAccountedFor: true,
  });
  assert.deepEqual(inspection.counts, { old: 0, new: 1, blockedUnknown: 0 });
  assert.equal(inspection.targets.length, 1);
  assert.equal(inspection.targets[0].state, 'new');
  assert.equal(inspection.targets[0].resourceKey, 'file:planned.txt');
  assert.equal(inspection.targets[0].observedHash, resourceHash(current, plan.mutations[0].resource));
  assert.equal(inspection.targets[0].observedHash, inspection.targets[0].afterHash);
}

function assertHashOnlyEvidence(value, forbiddenValues) {
  const serialized = JSON.stringify(value);
  for (const forbidden of forbiddenValues) {
    assert.equal(
      serialized.includes(forbidden),
      false,
      `hash-only recovery evidence leaked raw value: ${forbidden}`,
    );
  }
}

test('RPP-0611 focused classifier reports new-remote without overwriting preserved remote changes', () => {
  const filePath = tempJournalPath();
  const fixture = buildNewRemoteFixture();
  const {
    plan,
    remote,
    current,
    privateLocal,
    privatePreservedBeforePlan,
    privatePreservedAfterCrash,
  } = fixture;
  assertPlanPreservesRemoteOnlyResource(plan);
  const persisted = writeCompletedHashOnlyJournal({ filePath, plan, remote, current });

  const inspection = inspectRecoveryJournal({ journal: persisted, plan, current });
  const repair = inspectRecoveryRepair({ journalPath: filePath, plan, current });
  const writes = [];

  assertNewRemoteClassification({ inspection, plan, current });
  assert.equal(repair.status, 'fully-updated-remote');
  assert.equal(repair.canRollForward, false);
  assert.equal(repair.canMarkRepaired, true);
  assert.deepEqual(repair.rollForwardTargets, []);
  assert.throws(
    () => replayRecoveryRepair({
      journalPath: filePath,
      plan,
      current,
      writeResource(site, resource, value, context) {
        writes.push({ resourceKey: context.target.resourceKey, value });
        setResource(site, resource, value);
      },
    }),
    (error) => {
      assert.ok(error instanceof RecoveryRepairError);
      assert.equal(error.code, 'RECOVERY_REPAIR_ALREADY_COMPLETE');
      return true;
    },
  );

  assert.deepEqual(writes, []);
  assert.equal(current.files['remote-only.txt'], privatePreservedAfterCrash);

  const repaired = markRecoveryJournalRepaired({
    journalPath: filePath,
    plan,
    current,
    now: fixedNow,
    repairId: 'rpp-0611-new-remote-repaired',
  });
  assert.equal(repaired.status, 'repaired');
  assert.equal(current.files['remote-only.txt'], privatePreservedAfterCrash);

  const finalJournal = readRecoveryJournal(filePath);
  assert.equal(finalJournal.integrity.status, 'ok');
  for (const record of finalJournal.records) {
    assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(record));
  }
  assertHashOnlyEvidence(
    {
      records: finalJournal.records,
      targets: inspection.targets,
      remoteClassification: inspection.remoteClassification,
      repair: {
        status: repair.status,
        counts: repair.counts,
        alreadyUpdatedTargets: repair.alreadyUpdatedTargets,
        rollForwardTargets: repair.rollForwardTargets,
      },
    },
    [privateLocal, privatePreservedBeforePlan, privatePreservedAfterCrash],
  );
});

test('RPP-0611 SQLite-backed journal carries new-remote hash-only recovery state', {
  skip: DatabaseSync === null ? 'node:sqlite is unavailable in this Node.js runtime' : false,
}, () => {
  const filePath = tempJournalPath('rpp-0611-new-remote-seed-');
  const sqlitePath = tempSqlitePath();
  const fixture = buildNewRemoteFixture();
  const {
    plan,
    remote,
    current,
    privateLocal,
    privatePreservedBeforePlan,
    privatePreservedAfterCrash,
  } = fixture;
  const persisted = writeCompletedHashOnlyJournal({ filePath, plan, remote, current });

  const database = new DatabaseSync(sqlitePath);
  try {
    writeSqliteJournalTable(database, persisted.records);
    const sqliteJournal = readSqliteRecoveryJournalTable(database);
    const inspection = inspectRecoveryJournal({ journal: sqliteJournal, plan, current });

    assert.equal(sqliteJournal.storage, 'sqlite');
    assert.equal(sqliteJournal.integrity.status, 'ok');
    assert.equal(sqliteJournal.committedState.status, 'completed');
    assertNewRemoteClassification({ inspection, plan, current });
    assert.equal(current.files['remote-only.txt'], privatePreservedAfterCrash);
    assertHashOnlyEvidence(
      {
        rows: sqliteJournal.rows,
        records: sqliteJournal.records,
        targets: inspection.targets,
        remoteClassification: inspection.remoteClassification,
      },
      [privateLocal, privatePreservedBeforePlan, privatePreservedAfterCrash],
    );
  } finally {
    database.close();
  }
});
