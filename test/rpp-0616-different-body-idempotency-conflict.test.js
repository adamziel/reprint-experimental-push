import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue, setResource } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import { inspectRecoveryJournal } from '../src/recovery-inspect.js';
import {
  appendJournalCompleted,
  appendMutationObserved,
  openProductionRecoveryJournal,
  readRecoveryJournal,
  readSqliteRecoveryJournalTable,
  recoveryClaimHash,
} from '../src/recovery-journal.js';
import { buildDurableRecoveryJournalReleaseProof } from '../scripts/playground/production-shaped-live-release-verify-lib.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
let DatabaseSync = null;

try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  DatabaseSync = null;
}

function tempPath(prefix, basename) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return path.join(dir, basename);
}

function baseSite() {
  return {
    files: {
      'rpp-0616-a.txt': 'base-hash-only-a',
      'rpp-0616-b.txt': 'base-hash-only-b',
      'rpp-0616-c.txt': 'base-hash-only-c',
    },
    plugins: {},
    db: {},
  };
}

function localSite() {
  return {
    files: {
      'rpp-0616-a.txt': 'local-hash-only-a',
      'rpp-0616-b.txt': 'local-hash-only-b',
      'rpp-0616-c.txt': 'local-hash-only-c',
    },
    plugins: {},
    db: {},
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function applyMutationForTest(site, mutation) {
  setResource(site, mutation.resource, deserializeResourceValue(mutation.value));
}

function writeSqliteRecoveryJournal(sqlitePath, records) {
  let database = new DatabaseSync(sqlitePath);
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
  database.close();

  database = new DatabaseSync(sqlitePath);
  return database;
}

function releaseProofForConflict({ inspection, plan, originalRequestHash, conflictingRequestHash, conflictSequence }) {
  const mutationEvents = plan.mutations.map((mutation, index) => ({
    sequence: 3 + index,
    event: 'mutation-applied',
    requestHash: originalRequestHash,
    mutationId: mutation.id,
    resourceKey: mutation.resourceKey,
  }));
  const latestEvents = [
    { sequence: 1, event: 'idempotency-opened', requestHash: originalRequestHash },
    { sequence: 2, event: 'apply-started', requestHash: originalRequestHash },
    ...mutationEvents,
    { sequence: 3 + plan.mutations.length, event: 'apply-committed', requestHash: originalRequestHash },
    { sequence: conflictSequence, event: 'idempotency-key-conflict', requestHash: conflictingRequestHash },
  ];
  const recoveryCounts = {
    ...inspection.counts,
    total: plan.mutations.length,
  };

  return buildDurableRecoveryJournalReleaseProof({
    releaseSummary: {
      releaseProof: {
        plan: {
          mutations: plan.mutations.length,
        },
        recoveryInspect: {
          status: 200,
          recovery: {
            state: inspection.status,
            journalState: 'ok',
            counts: recoveryCounts,
          },
        },
        idempotencyConflict: {
          status: 409,
          code: 'IDEMPOTENCY_KEY_CONFLICT',
          idempotency: {
            conflict: true,
            freshMutationWork: false,
            requestHash: conflictingRequestHash,
            originalRequestHash,
          },
          targetSnapshotUnchanged: true,
          recoveryState: {
            source: 'RPP-0616 SQLite restart readback after different-body idempotency conflict',
            storage: 'sqlite',
            state: inspection.status,
            counts: recoveryCounts,
            restartReadable: inspection.journal.integrity.status === 'ok',
          },
        },
        dbJournal: {
          mutationApplied: plan.mutations.length,
          eventCounts: {
            'idempotency-key-conflict': 1,
          },
          latestEvents,
        },
      },
    },
  });
}

test('RPP-0616 SQLite-backed different-body idempotency conflict preserves fully-updated recovery state', {
  skip: DatabaseSync === null ? 'node:sqlite is unavailable in this Node.js runtime' : false,
}, () => {
  const journalPath = tempPath('rpp-0616-recovery-jsonl-', 'recovery.jsonl');
  const sqlitePath = tempPath('rpp-0616-recovery-sqlite-', 'recovery.sqlite');
  const base = baseSite();
  const remote = clone(base);
  const current = clone(remote);
  const plan = createPushPlan({ base, local: localSite(), remote, now: fixedNow });
  const claimId = 'rpp-0616-original-claim';
  const artifactRefs = { evidence: 'artifact://rpp-0616-sqlite-conflict' };
  const idempotencyKeyHash = digest({ rpp: '0616', idempotencyKey: 'same-key' });
  const originalRequestHash = digest({ rpp: '0616', request: 'original-body', planId: plan.id });
  const conflictingRequestHash = digest({ rpp: '0616', request: 'different-body', planId: plan.id });

  assert.notEqual(originalRequestHash, conflictingRequestHash);

  const journal = openProductionRecoveryJournal({
    filePath: journalPath,
    plan,
    current: remote,
    artifactRefs,
    now: fixedNow,
    claimId,
  });

  for (const mutation of plan.mutations) {
    applyMutationForTest(current, mutation);
    appendMutationObserved(journal, {
      plan,
      mutation,
      current,
      state: 'applied',
      artifactRefs,
    });
  }
  appendJournalCompleted(journal, { plan, current, artifactRefs });
  const conflictRecord = journal.appendEvent('idempotency-key-conflict', {
    planId: plan.id,
    state: 'rejected',
    idempotencyKeyHash,
    requestHash: conflictingRequestHash,
    originalRequestHash,
    claimId,
    claimHash: recoveryClaimHash(claimId),
    freshMutationWork: false,
    observedHash: digest(current),
    artifactRefs,
  });
  journal.close();

  const persisted = readRecoveryJournal(journalPath);
  let database = writeSqliteRecoveryJournal(sqlitePath, persisted.records);
  try {
    const restarted = readSqliteRecoveryJournalTable(database);
    const inspection = inspectRecoveryJournal({ journal: restarted, plan, current });
    const mutationsAfterConflict = restarted.records.filter(
      (record) => record.type === 'mutation-observed' && record.sequence > conflictRecord.sequence,
    );
    const restartedConflict = restarted.records.find(
      (record) => record.type === 'idempotency-key-conflict',
    );

    assert.equal(restarted.storage, 'sqlite');
    assert.equal(restarted.integrity.status, 'ok');
    assert.equal(restartedConflict.requestHash, conflictingRequestHash);
    assert.equal(restartedConflict.originalRequestHash, originalRequestHash);
    assert.equal(restartedConflict.freshMutationWork, false);
    assert.equal(mutationsAfterConflict.length, 0);
    assert.equal(inspection.status, 'fully-updated-remote');
    assert.deepEqual(inspection.counts, {
      old: 0,
      new: plan.mutations.length,
      blockedUnknown: 0,
    });
    assert.equal(inspection.journal.committedState.restartReadable, true);
    assert.equal(inspection.journal.committedState.completedRows, 1);

    const proof = releaseProofForConflict({
      inspection,
      plan,
      originalRequestHash,
      conflictingRequestHash,
      conflictSequence: conflictRecord.sequence,
    });
    assert.equal(proof.sameKeyDifferentBodyConflict.proved, true);
    assert.equal(proof.sameKeyDifferentBodyConflict.requestHashEvidence.proved, true);
    assert.equal(proof.sameKeyDifferentBodyConflict.recoveryState.proved, true);
    assert.equal(proof.sameKeyDifferentBodyConflict.recoveryState.storage, 'sqlite');
    assert.deepEqual(proof.sameKeyDifferentBodyConflict.recoveryState.counts, {
      old: 0,
      new: plan.mutations.length,
      blockedUnknown: 0,
      total: plan.mutations.length,
    });
  } finally {
    database.close();
  }
});
