import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertJournalRecordHasNoRawValues,
  checkedDurableJournalBoundarySatisfied,
  readSqliteRecoveryJournalTable,
  recoveryClaimHash,
} from '../src/recovery-journal.js';
import { createPushPlan } from '../src/planner.js';
import { digest } from '../src/stable-json.js';
import { buildDurableRecoveryJournalReleaseProof } from '../scripts/playground/production-shaped-live-release-verify-lib.js';

const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;
let DatabaseSync = null;

try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  DatabaseSync = null;
}

function tempSqlitePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0656-sqlite-'));
  return path.join(dir, 'recovery.sqlite');
}

function baseSite() {
  return {
    files: {
      'rpp-0656-a.txt': 'base-hash-only-a',
      'rpp-0656-b.txt': 'base-hash-only-b',
      'rpp-0656-c.txt': 'base-hash-only-c',
    },
    plugins: {},
    db: {},
  };
}

function localSite() {
  return {
    files: {
      'rpp-0656-a.txt': 'local-hash-only-a',
      'rpp-0656-b.txt': 'local-hash-only-b',
      'rpp-0656-c.txt': 'local-hash-only-c',
    },
    plugins: {},
    db: {},
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function writeSqliteJournalTable(database, records, tableName = 'recovery_journal') {
  database.exec(`CREATE TABLE ${tableName} (
    sequence INTEGER PRIMARY KEY,
    schema_version INTEGER NOT NULL,
    record_json TEXT NOT NULL
  )`);
  const insert = database.prepare(`INSERT INTO ${tableName} (sequence, schema_version, record_json) VALUES (?, ?, ?)`);
  for (const record of records) {
    insert.run(record.sequence, record.schemaVersion, JSON.stringify(record));
  }
}

function sqliteEventRecord(sequence, event, fields = {}) {
  return {
    schemaVersion: 1,
    sequence,
    type: event,
    event,
    ...fields,
  };
}

function countEventRows(records, event) {
  return records.filter((record) => record.event === event || record.type === event).length;
}

function latestEventsFromJournalRows(records) {
  return records.map((record) => ({
    sequence: record.sequence,
    event: record.event || record.type,
    ...(record.requestHash ? { requestHash: record.requestHash } : {}),
    ...(Number.isInteger(record.appliedCount) ? { appliedCount: record.appliedCount } : {}),
  }));
}

function maxSequence(entries, predicate) {
  return entries.reduce((highest, entry) => (
    predicate(entry) && Number.isInteger(entry.sequence) && entry.sequence > highest
      ? entry.sequence
      : highest
  ), 0);
}

function buildBlockedApplyRevalidation() {
  return {
    ok: true,
    apply: {
      status: 412,
      code: 'PRECONDITION_FAILED',
      applied: 0,
      applyRevalidation: {
        phase: 'before-first-mutation',
        checkedAgainst: 'live-remote',
      },
    },
    replay: {
      status: 412,
      code: 'PRECONDITION_FAILED',
      replayed: true,
      freshMutationWork: false,
      preservedRemoteUnchanged: true,
    },
    recoveryInspect: {
      recovery: {
        state: 'blocked-recovery',
        counts: {
          old: 1,
          new: 0,
          blockedUnknown: 1,
          total: 2,
        },
      },
    },
    dbJournal: {
      ordering: {
        ordered: true,
        applyRejected: 20,
        applyReplayed: 21,
        mutationAppliedBeforeFailure: 0,
        applyCommitted: false,
      },
    },
    boundary: {
      verdict: 'LIVE_RELEASE_BOUNDARY_OK',
    },
  };
}

function buildRecoveryReleaseSummary({ dbJournal, plan, originalRequestHash, conflictingRequestHash }) {
  const mutationEvents = plan.mutations.length;
  const latestEvents = [
    { sequence: 1, event: 'idempotency-opened', requestHash: originalRequestHash },
    { sequence: 2, event: 'apply-started', requestHash: originalRequestHash },
    ...Array.from({ length: mutationEvents }, (_, index) => ({
      sequence: 3 + index,
      event: 'mutation-applied',
      requestHash: originalRequestHash,
    })),
    { sequence: 3 + mutationEvents, event: 'apply-committed', requestHash: originalRequestHash },
    { sequence: 4 + mutationEvents, event: 'apply-replayed', requestHash: originalRequestHash },
    { sequence: 5 + mutationEvents, event: 'idempotency-key-conflict', requestHash: conflictingRequestHash },
  ];
  const oldRemoteRecovery = {
    source: 'SQLite-backed idempotency conflict recovery inspection before mutation',
    status: 200,
    code: 'SQLITE_IDEMPOTENCY_CONFLICT_OLD_REMOTE',
    state: 'old-remote',
    observedState: 'sqlite-conflict-pre-mutation',
    counts: {
      old: mutationEvents,
      new: 0,
      blockedUnknown: 0,
      total: mutationEvents,
    },
  };

  return {
    topology: {
      sourceUrl: 'http://127.0.0.1:8080',
    },
    boundary: {
      verdict: 'LIVE_RELEASE_BOUNDARY_OK',
    },
    durableJournal: {
      proof: {
        journal: dbJournal,
        leaseFence: dbJournal.leaseFence,
      },
    },
    releaseProof: {
      plan: {
        mutations: mutationEvents,
      },
      recoveryInspect: {
        status: 200,
        recovery: {
          state: 'fully-updated-remote',
          journalState: 'ok',
          counts: {
            old: 0,
            new: mutationEvents,
            blockedUnknown: 0,
            total: mutationEvents,
          },
        },
      },
      replay: {
        idempotency: {
          replayed: true,
          freshMutationWork: false,
        },
      },
      idempotencyConflict: {
        status: 409,
        code: 'IDEMPOTENCY_KEY_CONFLICT',
        idempotency: {
          conflict: true,
          freshMutationWork: false,
          sameKey: true,
          differentRequestHash: true,
          requestHash: conflictingRequestHash,
          originalRequestHash,
          conflictingRequestHash,
        },
        targetSnapshotUnchanged: true,
        targetSnapshotHashBeforeConflict: dbJournal.targetSnapshotHash,
        targetSnapshotHashAfterConflict: dbJournal.targetSnapshotHash,
        recoveryState: {
          source: 'SQLite-backed different-body conflict recovery inspection',
          storage: 'sqlite',
          state: 'fully-updated-remote',
          restartReadable: true,
          counts: {
            old: 0,
            new: mutationEvents,
            blockedUnknown: 0,
            total: mutationEvents,
          },
        },
      },
      dbJournal: {
        ...dbJournal,
        latestEvents,
      },
      staleClaimRetry: {
        oldRemoteRecovery,
        abandoned: {
          status: 500,
          code: 'LAB_SIMULATED_STALE_CLAIM_ALL_OLD',
          recovery: oldRemoteRecovery,
        },
      },
      replayAndRetry: {
        required: '/snapshot',
        observed: '/snapshot',
        retryAttempts: 2,
        verdict: 'PRESERVED_REMOTE_RETRY_PROVEN',
      },
    },
  };
}

function buildDbJournal({ sqliteJournal, activeClaimId, previousClaimId, idempotencyKeyHash, originalRequestHash }) {
  const activeClaimKeyHash = recoveryClaimHash(activeClaimId);
  const previousClaimKeyHash = recoveryClaimHash(previousClaimId);
  const writerLease = {
    strategy: 'claim-fenced-single-writer',
    claimId: activeClaimId,
    claimKeyHash: activeClaimKeyHash,
    claimKeyUnique: true,
    fsyncEvidence: true,
    storageGuard: 'wpdb-single-statement-cas',
    monotonicSequence: true,
    restartReadable: true,
    staleClaimRejected: true,
  };
  const claimExpiry = {
    policy: 'bounded-stale-claim-advance',
    scope: 'claim-fenced-restart-readable',
    proven: true,
    expired: true,
    previousClaimExpired: true,
    staleClaimRejected: true,
    staleThresholdMs: 0,
    openedAt: '2026-05-31T00:00:02.000Z',
    expiresAt: '2026-05-31T00:00:02.000Z',
    previousClaimOpenedAt: '2026-05-31T00:00:01.000Z',
    previousClaimExpiresAt: '2026-05-31T00:00:02.000Z',
    previousClaimAgeMs: 1000,
    activeClaimSequence: 2,
    activeClaimEvent: 'stale-claim-rejected',
    previousClaimSequence: 1,
    previousClaimEvent: 'idempotency-opened',
  };
  const targetSnapshotHash = sqliteJournal.records.find((record) => (
    record.event === 'idempotency-key-conflict'
  ))?.targetSnapshotHashAfterConflict;
  const eventCounts = latestEventsFromJournalRows(sqliteJournal.records).reduce((counts, entry) => {
    counts[entry.event] = (counts[entry.event] || 0) + 1;
    return counts;
  }, {});

  return {
    scope: 'checked live production-shaped journal surface',
    targetSnapshotHash,
    ownership: {
      ownsJournal: true,
      restartReadable: true,
      productionAdapter: 'wpdb-single-statement-cas',
      supportedSurface: 'claim-fenced-restart-readable',
    },
    claim: {
      status: 'stale-claim-rejected',
      activeClaimId,
      activeClaimKeyHash,
      activeClaimSequence: 2,
      activeClaimEvent: 'stale-claim-rejected',
      idempotencyKeyHash,
      requestHash: originalRequestHash,
      staleClaimRejected: true,
      previousClaimId,
      previousClaimKeyHash,
      previousClaimSequence: 1,
      previousClaimEvent: 'idempotency-opened',
      previousStartedSequence: null,
      abandonedSequence: null,
      abandonedEvent: null,
      claimExpiry,
    },
    claimExpiry,
    writerLease,
    leaseFence: {
      boundary: 'wpdb-single-statement-cas',
      storageGuard: 'wpdb-single-statement-cas',
      fsyncEvidence: true,
      claimKeyUnique: true,
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: true,
      writerLease,
    },
    storageGuard: {
      boundary: 'wpdb-single-statement-cas',
      operation: 'update',
      outcome: 'applied',
    },
    mutationApplied: countEventRows(sqliteJournal.records, 'mutation-applied'),
    eventCounts,
    latestEvents: latestEventsFromJournalRows(sqliteJournal.records),
  };
}

function buildSqliteConflictFixture() {
  const sqlitePath = tempSqlitePath();
  const remote = baseSite();
  const plan = createPushPlan({
    base: baseSite(),
    local: localSite(),
    remote,
    now: fixedNow,
  });
  const activeClaimId = 'rpp-0656-active-claim';
  const previousClaimId = 'rpp-0656-previous-claim';
  const activeClaimKeyHash = recoveryClaimHash(activeClaimId);
  const idempotencyKeyHash = digest({
    proof: 'rpp-0656',
    idempotencyKey: 'same-key',
  });
  const originalRequestHash = digest({
    proof: 'rpp-0656',
    idempotencyKeyHash,
    requestVariantHash: digest('original-apply-request'),
  });
  const conflictingRequestHash = digest({
    proof: 'rpp-0656',
    idempotencyKeyHash,
    requestVariantHash: digest('different-apply-request'),
  });
  const targetSnapshotHash = digest({
    proof: 'rpp-0656',
    planId: plan.id,
    mutationHashes: plan.mutations.map((mutation) => mutation.localHash),
  });

  let sequence = 1;
  const rows = [
    sqliteEventRecord(sequence++, 'idempotency-opened', {
      planId: plan.id,
      claimId: activeClaimId,
      claimHash: activeClaimKeyHash,
      idempotencyKeyHash,
      requestHash: originalRequestHash,
      state: 'opened',
    }),
    sqliteEventRecord(sequence++, 'apply-started', {
      planId: plan.id,
      claimId: activeClaimId,
      claimHash: activeClaimKeyHash,
      idempotencyKeyHash,
      requestHash: originalRequestHash,
      state: 'started',
    }),
    ...plan.mutations.map((mutation) => sqliteEventRecord(sequence++, 'mutation-applied', {
      planId: plan.id,
      mutationId: mutation.id,
      resourceKey: mutation.resourceKey,
      beforeHash: mutation.remoteBeforeHash,
      afterHash: mutation.localHash,
      idempotencyKeyHash,
      requestHash: originalRequestHash,
      appliedCount: 1,
      state: 'applied',
    })),
    sqliteEventRecord(sequence++, 'apply-committed', {
      planId: plan.id,
      claimId: activeClaimId,
      claimHash: activeClaimKeyHash,
      idempotencyKeyHash,
      requestHash: originalRequestHash,
      mutationApplied: plan.mutations.length,
      targetSnapshotHash,
      state: 'committed',
    }),
    sqliteEventRecord(sequence++, 'apply-replayed', {
      planId: plan.id,
      claimId: activeClaimId,
      claimHash: activeClaimKeyHash,
      idempotencyKeyHash,
      requestHash: originalRequestHash,
      replayed: true,
      freshMutationWork: false,
      appliedCount: 0,
      targetSnapshotHash,
      state: 'replayed',
    }),
    sqliteEventRecord(sequence++, 'idempotency-key-conflict', {
      planId: plan.id,
      claimId: activeClaimId,
      claimHash: activeClaimKeyHash,
      idempotencyKeyHash,
      requestHash: conflictingRequestHash,
      previousRequestHash: originalRequestHash,
      sameIdempotencyKey: true,
      differentRequestHash: true,
      status: 409,
      code: 'IDEMPOTENCY_KEY_CONFLICT',
      freshMutationWork: false,
      appliedCount: 0,
      targetSnapshotHashBeforeConflict: targetSnapshotHash,
      targetSnapshotHashAfterConflict: targetSnapshotHash,
      targetSnapshotUnchanged: true,
      state: 'conflict',
    }),
  ];

  let database = new DatabaseSync(sqlitePath);
  writeSqliteJournalTable(database, rows);
  database.close();

  database = new DatabaseSync(sqlitePath);
  const sqliteJournal = readSqliteRecoveryJournalTable(database);
  database.close();

  const dbJournal = buildDbJournal({
    sqliteJournal,
    activeClaimId,
    previousClaimId,
    idempotencyKeyHash,
    originalRequestHash,
  });
  const releaseSummary = buildRecoveryReleaseSummary({
    dbJournal,
    plan,
    originalRequestHash,
    conflictingRequestHash,
  });

  return {
    plan,
    rows,
    sqliteJournal,
    dbJournal,
    releaseSummary,
    activeClaimId,
    previousClaimId,
    idempotencyKeyHash,
    originalRequestHash,
    conflictingRequestHash,
    targetSnapshotHash,
  };
}

function hashString(value) {
  return typeof value === 'string' && hashPattern.test(value);
}

function validateDifferentBodyConflictEvidence(releaseSummary) {
  const releaseProof = releaseSummary?.releaseProof || {};
  const conflict = releaseProof.idempotencyConflict;
  const dbJournal = releaseProof.dbJournal || {};
  const latestEvents = Array.isArray(dbJournal.latestEvents) ? dbJournal.latestEvents : [];
  const conflictEvents = latestEvents.filter((entry) => (
    entry?.event === 'idempotency-key-conflict' || entry?.event === 'idempotency-conflict'
  ));

  if (!conflict || conflictEvents.length === 0) {
    return blockConflictEvidence('CONFLICT_EVIDENCE_MISSING');
  }
  if (conflictEvents.length !== 1 || dbJournal.eventCounts?.['idempotency-key-conflict'] !== 1) {
    return blockConflictEvidence('CONFLICT_EVIDENCE_DUPLICATED');
  }

  const conflictEvent = conflictEvents[0];
  const idempotency = conflict.idempotency || {};
  const requestHash = idempotency.requestHash;
  const originalRequestHash = idempotency.originalRequestHash;
  if (!hashString(requestHash) || !hashString(originalRequestHash) || requestHash === originalRequestHash) {
    return blockConflictEvidence('CONFLICT_EVIDENCE_MALFORMED');
  }

  const applyCommittedSequence = maxSequence(latestEvents, (entry) => entry.event === 'apply-committed');
  const originalEvidenceBeforeConflict = latestEvents.some((entry) => (
    Number.isInteger(entry.sequence)
    && Number.isInteger(conflictEvent.sequence)
    && entry.sequence < conflictEvent.sequence
    && entry.requestHash === originalRequestHash
    && ['idempotency-opened', 'apply-started', 'apply-committed', 'apply-replayed'].includes(entry.event)
  ));
  const postConflictMutationEvents = latestEvents.filter((entry) => (
    Number.isInteger(entry.sequence)
    && Number.isInteger(conflictEvent.sequence)
    && entry.sequence > conflictEvent.sequence
    && ['apply-started', 'mutation-applied'].includes(entry.event)
  ));
  if (
    !originalEvidenceBeforeConflict
    || !Number.isInteger(conflictEvent.sequence)
    || conflictEvent.sequence <= applyCommittedSequence
    || postConflictMutationEvents.length > 0
  ) {
    return blockConflictEvidence('CONFLICT_EVIDENCE_STALE');
  }

  const beforeConflictHash = conflict.targetSnapshotHashBeforeConflict;
  const afterConflictHash = conflict.targetSnapshotHashAfterConflict;
  if (
    conflict.status !== 409
    || conflict.code !== 'IDEMPOTENCY_KEY_CONFLICT'
    || idempotency.conflict !== true
    || idempotency.freshMutationWork !== false
    || idempotency.sameKey !== true
    || idempotency.differentRequestHash !== true
    || conflict.targetSnapshotUnchanged !== true
    || conflictEvent.requestHash !== requestHash
    || !hashString(beforeConflictHash)
    || !hashString(afterConflictHash)
    || beforeConflictHash !== afterConflictHash
  ) {
    return blockConflictEvidence('CONFLICT_EVIDENCE_DRIFTED');
  }

  const recoveryState = conflict.recoveryState || {};
  const counts = recoveryState.counts || {};
  const mutationCount = releaseProof.plan?.mutations;
  if (
    recoveryState.storage !== 'sqlite'
    || recoveryState.restartReadable !== true
    || recoveryState.state !== 'fully-updated-remote'
    || counts.old !== 0
    || counts.new !== mutationCount
    || counts.blockedUnknown !== 0
    || counts.total !== mutationCount
  ) {
    return blockConflictEvidence('CONFLICT_EVIDENCE_DRIFTED');
  }

  return {
    ok: true,
    code: 'CONFLICT_EVIDENCE_ACCEPTED',
    conflictEventSequence: conflictEvent.sequence,
    postConflictMutationEvents: postConflictMutationEvents.length,
  };
}

function blockConflictEvidence(code) {
  return {
    ok: false,
    code,
    conflictEventSequence: null,
    postConflictMutationEvents: null,
  };
}

function evaluateRecoveryProofMovement(releaseSummary) {
  const validation = validateDifferentBodyConflictEvidence(releaseSummary);
  if (!validation.ok) {
    return {
      ok: false,
      code: validation.code,
      conflictEvidence: validation,
      checkedRecoveryProofStarted: false,
      checkedReplayProofStarted: false,
      rejectedBodyRecoveryMovementStarted: false,
      rejectedBodyReplayMovementStarted: false,
      releaseMovement: {
        allowed: false,
        gates: '0/4',
        reasonHash: digest({
          proof: 'rpp-0656',
          code: validation.code,
        }),
      },
      proof: null,
    };
  }

  const proof = buildDurableRecoveryJournalReleaseProof({
    releaseSummary,
    applyRevalidation: buildBlockedApplyRevalidation(),
  });

  return {
    ok: proof.sameKeyDifferentBodyConflict.proved === true,
    code: proof.sameKeyDifferentBodyConflict.proved
      ? 'CONFLICT_RECOVERY_PROOF_ACCEPTED'
      : 'CONFLICT_RECOVERY_PROOF_BLOCKED',
    conflictEvidence: validation,
    checkedRecoveryProofStarted: true,
    checkedReplayProofStarted: true,
    rejectedBodyRecoveryMovementStarted: false,
    rejectedBodyReplayMovementStarted: false,
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reasonHash: digest({
        proof: 'rpp-0656',
        code: 'support-only',
      }),
    },
    proof,
  };
}

test('RPP-0656 SQLite-backed variant 3 records hash-only different-body conflict and blocks rejected-body movement', {
  skip: DatabaseSync === null ? 'node:sqlite is unavailable in this Node.js runtime' : false,
}, () => {
  const fixture = buildSqliteConflictFixture();
  const {
    plan,
    sqliteJournal,
    dbJournal,
    releaseSummary,
    originalRequestHash,
    conflictingRequestHash,
    targetSnapshotHash,
  } = fixture;
  const openedRecord = sqliteJournal.records.find((record) => record.event === 'idempotency-opened');
  const conflictRecord = sqliteJournal.records.find((record) => record.event === 'idempotency-key-conflict');

  assert.equal(sqliteJournal.storage, 'sqlite');
  assert.equal(sqliteJournal.integrity.status, 'ok');
  assert.equal(sqliteJournal.schemaVersionColumnPresent, true);
  assert.deepEqual(
    sqliteJournal.records.map((record) => record.sequence),
    Array.from({ length: sqliteJournal.records.length }, (_, index) => index + 1),
  );
  assert.ok(openedRecord);
  assert.ok(conflictRecord);
  assert.equal(conflictRecord.status, 409);
  assert.equal(conflictRecord.code, 'IDEMPOTENCY_KEY_CONFLICT');
  assert.equal(conflictRecord.idempotencyKeyHash, openedRecord.idempotencyKeyHash);
  assert.equal(conflictRecord.requestHash, conflictingRequestHash);
  assert.equal(conflictRecord.previousRequestHash, originalRequestHash);
  assert.notEqual(conflictRecord.requestHash, conflictRecord.previousRequestHash);
  assert.equal(conflictRecord.sameIdempotencyKey, true);
  assert.equal(conflictRecord.differentRequestHash, true);
  assert.equal(conflictRecord.freshMutationWork, false);
  assert.equal(conflictRecord.targetSnapshotHashBeforeConflict, targetSnapshotHash);
  assert.equal(conflictRecord.targetSnapshotHashAfterConflict, targetSnapshotHash);
  assert.equal(conflictRecord.targetSnapshotUnchanged, true);
  assert.match(conflictRecord.idempotencyKeyHash, hashPattern);
  assert.match(conflictRecord.requestHash, hashPattern);
  assert.match(conflictRecord.previousRequestHash, hashPattern);
  assert.match(conflictRecord.targetSnapshotHashBeforeConflict, hashPattern);
  assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(conflictRecord));

  assert.equal(countEventRows(sqliteJournal.records, 'idempotency-opened'), 1);
  assert.equal(countEventRows(sqliteJournal.records, 'apply-started'), 1);
  assert.equal(countEventRows(sqliteJournal.records, 'mutation-applied'), plan.mutations.length);
  assert.equal(countEventRows(sqliteJournal.records, 'apply-committed'), 1);
  assert.equal(countEventRows(sqliteJournal.records, 'apply-replayed'), 1);
  assert.equal(countEventRows(sqliteJournal.records, 'idempotency-key-conflict'), 1);
  assert.deepEqual(
    sqliteJournal.records
      .filter((record) => record.sequence > conflictRecord.sequence)
      .map((record) => record.event),
    [],
  );
  assert.equal(checkedDurableJournalBoundarySatisfied(dbJournal), true);

  const movement = evaluateRecoveryProofMovement(releaseSummary);
  assert.equal(movement.ok, true);
  assert.equal(movement.checkedRecoveryProofStarted, true);
  assert.equal(movement.checkedReplayProofStarted, true);
  assert.equal(movement.rejectedBodyRecoveryMovementStarted, false);
  assert.equal(movement.rejectedBodyReplayMovementStarted, false);
  assert.equal(movement.releaseMovement.allowed, false);
  assert.match(movement.releaseMovement.reasonHash, hashPattern);
  assert.equal(movement.proof.ok, true);
  assert.equal(movement.proof.checks.sameKeyDifferentBodyConflict, true);
  assert.equal(movement.proof.sameKeyDifferentBodyConflict.proved, true);
  assert.equal(movement.proof.sameKeyDifferentBodyConflict.status, 409);
  assert.equal(movement.proof.sameKeyDifferentBodyConflict.code, 'IDEMPOTENCY_KEY_CONFLICT');
  assert.equal(movement.proof.sameKeyDifferentBodyConflict.conflictEventSequence, conflictRecord.sequence);
  assert.equal(movement.proof.sameKeyDifferentBodyConflict.mutationEventsAfterConflict, 0);
  assert.equal(movement.proof.sameKeyDifferentBodyConflict.requestHashEvidence.proved, true);
  assert.equal(movement.proof.sameKeyDifferentBodyConflict.recoveryState.proved, true);
  assert.equal(movement.proof.sameKeyDifferentBodyConflict.recoveryState.storage, 'sqlite');
  assert.deepEqual(movement.proof.sameKeyDifferentBodyConflict.recoveryState.counts, {
    old: 0,
    new: plan.mutations.length,
    blockedUnknown: 0,
    total: plan.mutations.length,
  });
});

test('RPP-0656 variant 3 rejects missing malformed stale duplicated or drifted conflict evidence before proof movement', {
  skip: DatabaseSync === null ? 'node:sqlite is unavailable in this Node.js runtime' : false,
}, () => {
  const fixture = buildSqliteConflictFixture();
  const baseSummary = fixture.releaseSummary;
  const conflictEvent = baseSummary.releaseProof.dbJournal.latestEvents.find((entry) => (
    entry.event === 'idempotency-key-conflict'
  ));
  const driftedRequestHash = digest({
    proof: 'rpp-0656',
    requestVariantHash: 'drifted-different-body',
  });

  const cases = [
    {
      name: 'missing-conflict-evidence',
      expectedCode: 'CONFLICT_EVIDENCE_MISSING',
      mutate(summary) {
        delete summary.releaseProof.idempotencyConflict;
      },
    },
    {
      name: 'malformed-conflict-request-hash',
      expectedCode: 'CONFLICT_EVIDENCE_MALFORMED',
      mutate(summary) {
        summary.releaseProof.idempotencyConflict.idempotency.requestHash = 'not-a-sha256-hash';
        const event = summary.releaseProof.dbJournal.latestEvents.find((entry) => (
          entry.event === 'idempotency-key-conflict'
        ));
        event.requestHash = 'not-a-sha256-hash';
      },
    },
    {
      name: 'stale-conflict-before-commit',
      expectedCode: 'CONFLICT_EVIDENCE_STALE',
      mutate(summary) {
        const event = summary.releaseProof.dbJournal.latestEvents.find((entry) => (
          entry.event === 'idempotency-key-conflict'
        ));
        event.sequence = 2;
      },
    },
    {
      name: 'duplicated-conflict-evidence',
      expectedCode: 'CONFLICT_EVIDENCE_DUPLICATED',
      mutate(summary) {
        summary.releaseProof.dbJournal.latestEvents.push({
          ...conflictEvent,
          sequence: conflictEvent.sequence + 1,
        });
        summary.releaseProof.dbJournal.eventCounts['idempotency-key-conflict'] = 2;
      },
    },
    {
      name: 'drifted-conflict-request-evidence',
      expectedCode: 'CONFLICT_EVIDENCE_DRIFTED',
      mutate(summary) {
        summary.releaseProof.idempotencyConflict.idempotency.requestHash = driftedRequestHash;
      },
    },
    {
      name: 'drifted-conflict-target-snapshot',
      expectedCode: 'CONFLICT_EVIDENCE_DRIFTED',
      mutate(summary) {
        summary.releaseProof.idempotencyConflict.targetSnapshotHashAfterConflict = digest({
          proof: 'rpp-0656',
          targetSnapshot: 'drifted-after-conflict',
        });
      },
    },
  ];

  for (const negativeCase of cases) {
    const summary = clone(baseSummary);
    negativeCase.mutate(summary);
    const movement = evaluateRecoveryProofMovement(summary);

    assert.equal(movement.ok, false, negativeCase.name);
    assert.equal(movement.code, negativeCase.expectedCode, negativeCase.name);
    assert.equal(movement.conflictEvidence.ok, false, negativeCase.name);
    assert.equal(movement.checkedRecoveryProofStarted, false, negativeCase.name);
    assert.equal(movement.checkedReplayProofStarted, false, negativeCase.name);
    assert.equal(movement.rejectedBodyRecoveryMovementStarted, false, negativeCase.name);
    assert.equal(movement.rejectedBodyReplayMovementStarted, false, negativeCase.name);
    assert.equal(movement.releaseMovement.allowed, false, negativeCase.name);
    assert.match(movement.releaseMovement.reasonHash, hashPattern, negativeCase.name);
    assert.equal(movement.proof, null, negativeCase.name);
  }
});
