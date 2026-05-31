import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import {
  appendJournalCompleted,
  appendMutationObserved,
  assertJournalRecordHasNoRawValues,
  openProductionRecoveryJournal,
  productionRecoveryJournalInspectionSurfaceIsPresent,
  readRecoveryJournal,
  readSqliteRecoveryJournalTable,
  recoveryClaimHash,
} from '../src/recovery-journal.js';
import {
  inspectRecoveryJournal,
  RECOVERY_INSPECT_REASON_CODES,
} from '../src/recovery-inspect.js';
import {
  deserializeResourceValue,
  setResource,
} from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import { buildDurableRecoveryJournalReleaseProof } from '../scripts/playground/production-shaped-live-release-verify-lib.js';

const fixedNow = new Date('2026-05-31T14:30:00.000Z');
const retryNow = new Date(fixedNow.getTime() + 7_000);
const checkedCommand = 'timeout 300s npm run verify:release';
const checkedRoute = '/wp-json/reprint/v1/push/recovery/inspect';
const sourceUrl = 'http://127.0.0.1:8080';
const claimStaleThresholdMs = 2_000;
const hashPattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
let DatabaseSync = null;

try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  DatabaseSync = null;
}

function tempJournalPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpp-0696-different-body-v5-journal-'));
  return path.join(dir, 'recovery.jsonl');
}

function tempSqlitePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpp-0696-different-body-v5-sqlite-'));
  return path.join(dir, 'recovery.sqlite');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite() {
  return {
    files: {
      'rpp-0696-target-1.txt': 'rpp-0696-base-private-target-1',
      'rpp-0696-target-2.txt': 'rpp-0696-base-private-target-2',
      'rpp-0696-target-3.txt': 'rpp-0696-base-private-target-3',
      'rpp-0696-target-4.txt': 'rpp-0696-base-private-target-4',
      'rpp-0696-remote-preserved.txt': 'rpp-0696-base-private-preserved',
    },
    plugins: {},
    db: {},
  };
}

function localSite(base = baseSite()) {
  const site = cloneJson(base);
  site.files['rpp-0696-target-1.txt'] = 'rpp-0696-local-private-target-1';
  site.files['rpp-0696-target-2.txt'] = 'rpp-0696-local-private-target-2';
  site.files['rpp-0696-target-3.txt'] = 'rpp-0696-local-private-target-3';
  site.files['rpp-0696-target-4.txt'] = 'rpp-0696-local-private-target-4';
  return site;
}

function rawSiteValuesFor(...sites) {
  const values = new Set([
    'rpp-0696-base-private',
    'rpp-0696-local-private',
    'rpp-0696-remote-private',
  ]);
  for (const site of sites) {
    for (const value of Object.values(site.files || {})) {
      values.add(value);
    }
  }
  return [...values];
}

function buildScenario() {
  const base = baseSite();
  const local = localSite(base);
  const remote = cloneJson(base);
  remote.files['rpp-0696-remote-preserved.txt'] = 'rpp-0696-remote-private-preserved-before-plan';
  const plan = createPushPlan({
    base,
    local,
    remote,
    now: fixedNow,
  });

  assert.equal(plan.status, 'ready');
  assert.equal(plan.mutations.length, 4);
  assert.equal(
    plan.mutations.some((mutation) => mutation.resourceKey === 'file:rpp-0696-remote-preserved.txt'),
    false,
  );
  assert.equal(
    plan.preconditions.some((precondition) => precondition.resourceKey === 'file:rpp-0696-remote-preserved.txt'),
    false,
  );

  const current = cloneJson(remote);
  applyMutations(current, plan);

  return {
    plan,
    remote,
    current,
    rawSiteValues: rawSiteValuesFor(base, local, remote, current),
  };
}

function applyMutations(site, plan) {
  for (const mutation of plan.mutations) {
    setResource(site, mutation.resource, deserializeResourceValue(mutation.value));
  }
}

function artifactRefs() {
  return {
    releaseProof: 'artifact://rpp-0696/different-body-conflict-v5/release-verifier',
    recoverySupport: 'artifact://rpp-0696/different-body-conflict-v5/sqlite-support',
    durabilityScope: 'artifact://rpp-0696/different-body-conflict-v5/local-sqlite-backed',
  };
}

function writeCompletedProductionJournal({
  filePath,
  plan,
  remote,
  current,
  activeClaimId,
  releaseVerifierClaimId,
  refs,
}) {
  const active = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs: refs,
    now: fixedNow,
    truncate: true,
    claimId: activeClaimId,
    claimStaleThresholdMs,
  });
  active.close();

  const retry = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs: refs,
    now: retryNow,
    truncate: false,
    claimId: releaseVerifierClaimId,
    claimStaleThresholdMs,
  });

  try {
    for (const mutation of plan.mutations) {
      appendMutationObserved(retry, {
        plan,
        mutation,
        current,
        state: 'applied',
        artifactRefs: refs,
      });
    }
    appendJournalCompleted(retry, { plan, current, artifactRefs: refs });
    return retry.inspect();
  } finally {
    retry.close();
  }
}

function writeSqliteJournalTable(database, records, tableName = 'recovery_journal') {
  database.exec(`CREATE TABLE ${tableName} (
    sequence INTEGER PRIMARY KEY,
    schema_version INTEGER NOT NULL,
    record_json TEXT NOT NULL
  )`);
  const insert = database.prepare(
    `INSERT INTO ${tableName} (sequence, schema_version, record_json) VALUES (?, ?, ?)`,
  );
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
    timestamp: fixedNow.toISOString(),
    fsync: {
      requested: true,
      strategy: 'sqlite-transaction',
    },
    ...fields,
  };
}

function idempotencyConflictRows({
  startSequence,
  plan,
  releaseVerifierClaimId,
  idempotencyKeyHash,
  originalRequestHash,
  conflictingRequestHash,
  targetSnapshotHash,
}) {
  const claimHash = recoveryClaimHash(releaseVerifierClaimId);
  let sequence = startSequence;
  return [
    sqliteEventRecord(sequence++, 'idempotency-opened', {
      planId: plan.id,
      claimId: releaseVerifierClaimId,
      claimHash,
      idempotencyKeyHash,
      requestHash: originalRequestHash,
      state: 'opened',
    }),
    sqliteEventRecord(sequence++, 'apply-started', {
      planId: plan.id,
      claimId: releaseVerifierClaimId,
      claimHash,
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
      claimId: releaseVerifierClaimId,
      claimHash,
      idempotencyKeyHash,
      requestHash: originalRequestHash,
      mutationApplied: plan.mutations.length,
      targetSnapshotHash,
      state: 'committed',
    }),
    sqliteEventRecord(sequence++, 'apply-replayed', {
      planId: plan.id,
      claimId: releaseVerifierClaimId,
      claimHash,
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
      claimId: releaseVerifierClaimId,
      claimHash,
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
}

function eventRows(records) {
  return records.filter((record) => typeof record.event === 'string');
}

function countEventRows(records, event) {
  return eventRows(records).filter((record) => record.event === event).length;
}

function latestEventsFromJournalRows(records) {
  return eventRows(records).map((record) => ({
    sequence: record.sequence,
    event: record.event,
    ...(record.requestHash ? { requestHash: record.requestHash } : {}),
    ...(Number.isInteger(record.appliedCount) ? { appliedCount: record.appliedCount } : {}),
  }));
}

function eventCountsFromJournalRows(records) {
  return latestEventsFromJournalRows(records).reduce((counts, entry) => {
    counts[entry.event] = (counts[entry.event] || 0) + 1;
    return counts;
  }, {});
}

function maxSequence(entries, predicate) {
  return entries.reduce((highest, entry) => (
    predicate(entry) && Number.isInteger(entry.sequence) && entry.sequence > highest
      ? entry.sequence
      : highest
  ), 0);
}

function dbJournalFromSqliteReadback({
  sqliteJournal,
  activeClaimId,
  releaseVerifierClaimId,
  idempotencyKeyHash,
  originalRequestHash,
  targetSnapshotHash,
  checkedPath,
}) {
  const activeClaimKeyHash = recoveryClaimHash(releaseVerifierClaimId);
  const previousClaimKeyHash = recoveryClaimHash(activeClaimId);
  const storageGuard = 'sqlite-local-release-verifier-mirror';
  const writerLease = {
    strategy: 'claim-fenced-single-writer',
    claimId: releaseVerifierClaimId,
    claimKeyHash: activeClaimKeyHash,
    claimKeyUnique: true,
    fsyncEvidence: true,
    storageGuard,
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
    staleThresholdMs: claimStaleThresholdMs,
    openedAt: retryNow.toISOString(),
    expiresAt: new Date(retryNow.getTime() + claimStaleThresholdMs).toISOString(),
    previousClaimOpenedAt: fixedNow.toISOString(),
    previousClaimExpiresAt: new Date(fixedNow.getTime() + claimStaleThresholdMs).toISOString(),
    previousClaimAgeMs: retryNow.getTime() - fixedNow.getTime(),
    activeClaimSequence: 2,
    activeClaimEvent: 'stale-claim-advanced',
    previousClaimSequence: 1,
    previousClaimEvent: 'recovery-claim-opened',
  };

  return {
    scope: 'local SQLite release-verifier-shaped journal surface',
    storage: 'sqlite',
    tableName: sqliteJournal.tableName,
    records: sqliteJournal.records.length,
    checkedPath,
    checkedPathHash: digest({ checkedPath }),
    targetSnapshotHash,
    integrity: sqliteJournal.integrity,
    ownership: {
      ownsJournal: true,
      restartReadable: sqliteJournal.integrity.status === 'ok',
      productionAdapter: storageGuard,
      supportedSurface: 'claim-fenced-restart-readable',
    },
    claim: {
      status: 'stale-claim-advanced',
      activeClaimId: releaseVerifierClaimId,
      activeClaimKeyHash,
      activeClaimSequence: 2,
      activeClaimEvent: 'stale-claim-advanced',
      idempotencyKeyHash,
      requestHash: originalRequestHash,
      staleClaimRejected: true,
      previousClaimId: activeClaimId,
      previousClaimKeyHash,
      previousClaimSequence: 1,
      previousClaimEvent: 'recovery-claim-opened',
      previousStartedSequence: null,
      abandonedSequence: null,
      abandonedEvent: null,
      claimExpiry,
    },
    claimExpiry,
    writerLease,
    leaseFence: {
      boundary: storageGuard,
      storageGuard,
      fsyncEvidence: true,
      claimKeyUnique: true,
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: true,
      writerLease,
    },
    storageGuard: {
      boundary: storageGuard,
      operation: 'insert',
      outcome: 'applied',
    },
    mutationApplied: countEventRows(sqliteJournal.records, 'mutation-applied'),
    eventCounts: eventCountsFromJournalRows(sqliteJournal.records),
    latestEvents: latestEventsFromJournalRows(sqliteJournal.records),
  };
}

function newRemoteRecoveryFromInspection({
  inspection,
  plan,
  checkedPath,
}) {
  return {
    source: 'RPP-0696 SQLite-backed different-body conflict recovery inspection',
    status: 200,
    state: inspection.status,
    observedState: inspection.remoteClassification.state,
    journalState: inspection.journal.integrity.status,
    checkedPath,
    storage: inspection.journal.storage,
    restartReadable: inspection.journal.committedState.restartReadable,
    counts: {
      ...inspection.counts,
      total: plan.mutations.length,
    },
    remoteRecoveryClassification: inspection.remoteRecoveryClassification,
    targetEnvelope: {
      total: plan.mutations.length,
      old: inspection.counts.old,
      new: inspection.counts.new,
      blockedUnknown: inspection.counts.blockedUnknown,
      hashOnly: true,
      rawValuesIncluded: false,
      checkedPath,
      checkedPathHash: digest({ checkedPath }),
      allTargetsAccountedFor: inspection.remoteClassification.allTargetsAccountedFor,
      targets: inspection.targets.map((target) => ({
        mutationId: target.mutationId,
        resourceKey: target.resourceKey,
        state: target.state,
        beforeHash: target.beforeHash,
        afterHash: target.afterHash,
        observedHash: target.observedHash,
      })),
    },
  };
}

function oldRemoteRecoveryFromInspection({
  inspection,
  plan,
  checkedPath,
}) {
  return {
    source: 'RPP-0696 release-verifier old-remote classification for conflict guard',
    status: 200,
    state: inspection.status,
    observedState: inspection.remoteClassification.state,
    counts: {
      ...inspection.counts,
      total: plan.mutations.length,
    },
    targetEnvelope: {
      total: plan.mutations.length,
      old: plan.mutations.length,
      new: 0,
      blockedUnknown: 0,
      hashOnly: true,
      rawValuesIncluded: false,
      checkedPath,
      checkedPathHash: digest({ checkedPath }),
      allTargetsAccountedFor: true,
    },
  };
}

function buildRecoveryReleaseSummary({
  dbJournal,
  plan,
  newRemoteRecovery,
  oldRemoteRecovery,
  originalRequestHash,
  conflictingRequestHash,
  targetSnapshotHash,
  checkedPath,
}) {
  const mutationEvents = plan.mutations.length;

  return {
    topology: {
      sourceUrl,
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
        recovery: newRemoteRecovery,
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
        targetSnapshotHashBeforeConflict: targetSnapshotHash,
        targetSnapshotHashAfterConflict: targetSnapshotHash,
        recoveryState: {
          source: 'RPP-0696 SQLite-backed different-body conflict recovery state',
          storage: newRemoteRecovery.storage,
          state: newRemoteRecovery.state,
          restartReadable: newRemoteRecovery.restartReadable,
          checkedPath,
          counts: newRemoteRecovery.counts,
        },
      },
      dbJournal,
      staleClaimRetry: {
        oldRemoteRecovery,
        abandoned: {
          status: 500,
          code: 'LAB_SIMULATED_STALE_CLAIM_ALL_OLD',
          recovery: oldRemoteRecovery,
        },
      },
      replayAndRetry: {
        required: checkedPath,
        observed: checkedPath,
        retryAttempts: 2,
        verdict: 'PRESERVED_REMOTE_RETRY_PROVEN',
      },
    },
  };
}

function buildBlockedApplyRevalidation(plan, checkedPath) {
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
      checkedPath,
    },
    recoveryInspect: {
      recovery: {
        source: 'RPP-0696 checked rejected-body recovery revalidation',
        status: 409,
        state: 'blocked-recovery',
        observedState: 'blocked-recovery',
        checkedPath,
        counts: {
          old: plan.mutations.length - 1,
          new: 0,
          blockedUnknown: 1,
          total: plan.mutations.length,
        },
      },
    },
    dbJournal: {
      ordering: {
        ordered: true,
        applyRejected: 30,
        applyReplayed: 31,
        mutationAppliedBeforeFailure: 0,
        applyCommitted: false,
      },
    },
    durableJournal: {
      checkedAccepted: true,
      checkedPath,
    },
    boundary: {
      verdict: 'LIVE_RELEASE_BOUNDARY_OK',
      durableJournal: {
        verdict: 'LIVE_RELEASE_BOUNDARY_OK',
      },
    },
  };
}

function buildSqliteBackedConflictFixture() {
  const filePath = tempJournalPath();
  const sqlitePath = tempSqlitePath();
  const {
    plan,
    remote,
    current,
    rawSiteValues,
  } = buildScenario();
  const refs = artifactRefs();
  const activeClaimId = 'rpp-0696-active-claim';
  const releaseVerifierClaimId = 'rpp-0696-release-verifier-claim';

  const productionInspection = writeCompletedProductionJournal({
    filePath,
    plan,
    remote,
    current,
    activeClaimId,
    releaseVerifierClaimId,
    refs,
  });
  assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(productionInspection), true);
  assert.deepEqual(productionInspection.journal.checked, [filePath]);
  assertNoRawValues(productionInspection, rawSiteValues, 'RPP-0696 production inspection');

  const seeded = readRecoveryJournal(filePath);
  assert.equal(seeded.integrity.status, 'ok');
  assert.equal(seeded.committedState.status, 'completed');
  assert.equal(seeded.committedState.restartReadable, true);
  assertNoRawValues(fs.readFileSync(filePath, 'utf8'), rawSiteValues, 'RPP-0696 file journal');

  const idempotencyKeyHash = digest({
    proof: 'rpp-0696',
    idempotencyKey: 'same-key',
  });
  const originalRequestHash = digest({
    proof: 'rpp-0696',
    idempotencyKeyHash,
    requestVariantHash: digest('original-apply-request'),
  });
  const conflictingRequestHash = digest({
    proof: 'rpp-0696',
    idempotencyKeyHash,
    requestVariantHash: digest('different-apply-request'),
  });
  const targetSnapshotHash = digest({
    proof: 'rpp-0696',
    planId: plan.id,
    mutationHashes: plan.mutations.map((mutation) => mutation.localHash),
  });
  const conflictRows = idempotencyConflictRows({
    startSequence: seeded.records.length + 1,
    plan,
    releaseVerifierClaimId,
    idempotencyKeyHash,
    originalRequestHash,
    conflictingRequestHash,
    targetSnapshotHash,
  });
  const sqliteRecords = [...seeded.records, ...conflictRows];

  let database = new DatabaseSync(sqlitePath);
  writeSqliteJournalTable(database, sqliteRecords);
  database.close();

  database = new DatabaseSync(sqlitePath);
  const sqliteJournal = readSqliteRecoveryJournalTable(database);
  database.close();

  const checkedPath = sqlitePath;
  const newRemoteInspection = inspectRecoveryJournal({
    journal: sqliteJournal,
    plan,
    current,
  });
  const oldRemoteInspection = inspectRecoveryJournal({
    journal: sqliteJournal,
    plan,
    current: remote,
  });
  const newRemoteRecovery = newRemoteRecoveryFromInspection({
    inspection: newRemoteInspection,
    plan,
    checkedPath,
  });
  const oldRemoteRecovery = oldRemoteRecoveryFromInspection({
    inspection: oldRemoteInspection,
    plan,
    checkedPath,
  });
  const dbJournal = dbJournalFromSqliteReadback({
    sqliteJournal,
    activeClaimId,
    releaseVerifierClaimId,
    idempotencyKeyHash,
    originalRequestHash,
    targetSnapshotHash,
    checkedPath,
  });
  const releaseSummary = buildRecoveryReleaseSummary({
    dbJournal,
    plan,
    newRemoteRecovery,
    oldRemoteRecovery,
    originalRequestHash,
    conflictingRequestHash,
    targetSnapshotHash,
    checkedPath,
  });

  return {
    filePath,
    sqlitePath,
    plan,
    remote,
    current,
    rawSiteValues,
    seeded,
    sqliteJournal,
    dbJournal,
    releaseSummary,
    productionInspection,
    newRemoteInspection,
    oldRemoteInspection,
    newRemoteRecovery,
    oldRemoteRecovery,
    idempotencyKeyHash,
    originalRequestHash,
    conflictingRequestHash,
    targetSnapshotHash,
    checkedPath,
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

  const checkedPath = releaseProof.recoveryInspect?.recovery?.checkedPath;
  if (
    typeof checkedPath !== 'string'
    || checkedPath.length === 0
    || recoveryState.checkedPath !== checkedPath
    || releaseProof.replayAndRetry?.required !== checkedPath
    || releaseProof.replayAndRetry?.observed !== checkedPath
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

function evaluateReleaseVerifierMovement(releaseSummary, { plan, checkedPath }) {
  const validation = validateDifferentBodyConflictEvidence(releaseSummary);
  if (!validation.ok) {
    return {
      ok: false,
      code: validation.code,
      conflictEvidence: validation,
      checkedReleaseVerifierProofStarted: false,
      checkedReplayProofStarted: false,
      rejectedBodyRecoveryMovementStarted: false,
      rejectedBodyReplayMovementStarted: false,
      releaseMovement: {
        allowed: false,
        gates: '0/4',
        reasonHash: digest({
          proof: 'rpp-0696',
          code: validation.code,
        }),
      },
      proof: null,
    };
  }

  const proof = buildDurableRecoveryJournalReleaseProof({
    releaseSummary,
    applyRevalidation: buildBlockedApplyRevalidation(plan, checkedPath),
  });

  return {
    ok: proof.ok === true && proof.sameKeyDifferentBodyConflict.proved === true,
    code: proof.sameKeyDifferentBodyConflict.proved
      ? 'CONFLICT_RELEASE_VERIFIER_PROOF_ACCEPTED'
      : 'CONFLICT_RELEASE_VERIFIER_PROOF_BLOCKED',
    conflictEvidence: validation,
    checkedReleaseVerifierProofStarted: true,
    checkedReplayProofStarted: true,
    rejectedBodyRecoveryMovementStarted: false,
    rejectedBodyReplayMovementStarted: false,
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reasonHash: digest({
        proof: 'rpp-0696',
        code: 'support-only',
      }),
    },
    proof,
  };
}

function releaseVerifierEvidenceFor({
  fixture,
  releaseProof,
}) {
  const { sqliteJournal, dbJournal, plan, newRemoteInspection, checkedPath } = fixture;
  const conflict = releaseProof.sameKeyDifferentBodyConflict;
  const payload = {
    schemaVersion: 1,
    issue: 'RPP-0696',
    variant: 5,
    evidenceSource: 'different-body-idempotency-conflict-release-verifier-v5',
    evidenceScope: 'local-sqlite-backed-release-verifier',
    status: 'support_only',
    verdict: 'DIFFERENT_BODY_CONFLICT_RECOVERY_STATE_PROVED_SUPPORT_ONLY',
    observedAt: fixedNow.toISOString(),
    checkedCommand,
    checkedRoute,
    sourceUrl,
    productionBacked: false,
    releaseEligible: false,
    releaseGate: 'NO-GO',
    rawValuesIncluded: false,
    hashOnly: true,
    storage: 'sqlite',
    checkedPathHash: digest({ checkedPath }),
    journal: {
      storage: sqliteJournal.storage,
      tableName: sqliteJournal.tableName,
      integrityStatus: sqliteJournal.integrity.status,
      durableRows: sqliteJournal.records.length,
      rowsHash: digest(sqliteJournal.records),
      eventCounts: dbJournal.eventCounts,
      restartReadable: sqliteJournal.committedState.restartReadable,
      completedRows: sqliteJournal.committedState.completedRows,
      committedTargetRows: sqliteJournal.committedState.committedTargetRows,
    },
    conflict: {
      status: conflict.status,
      code: conflict.code,
      sameKey: true,
      differentRequestHash: true,
      freshMutationWork: false,
      requestHashEvidence: conflict.requestHashEvidence,
      targetSnapshotUnchanged: conflict.targetSnapshotUnchanged,
      conflictEventSequence: conflict.conflictEventSequence,
      mutationEventsAfterConflict: conflict.mutationEventsAfterConflict,
      recoveryState: conflict.recoveryState,
    },
    recoveryInspect: {
      status: newRemoteInspection.status,
      reasonCode: newRemoteInspection.reasonCode,
      counts: {
        ...newRemoteInspection.counts,
        total: plan.mutations.length,
      },
      remoteClassification: newRemoteInspection.remoteClassification,
      remoteRecoveryClassification: newRemoteInspection.remoteRecoveryClassification,
    },
    releaseVerifier: {
      gate: releaseProof.gate,
      durableRecoveryJournalBoundary: releaseProof.durableRecoveryJournalBoundary,
      ok: releaseProof.ok,
      gateStatus: releaseProof.gateStatus,
      sameReleaseBoundary: releaseProof.sameReleaseBoundary,
      checks: {
        recoveryInspectAfterRestart: releaseProof.checks.recoveryInspectAfterRestart,
        sameKeyDifferentBodyConflict: releaseProof.checks.sameKeyDifferentBodyConflict,
        sameKeyReplayAfterRejection: releaseProof.checks.sameKeyReplayAfterRejection,
        oldState: releaseProof.checks.oldState,
        newState: releaseProof.checks.newState,
        blockedState: releaseProof.checks.blockedState,
        manualRecoveryAuditExport: releaseProof.checks.manualRecoveryAuditExport,
      },
      partialStates: releaseProof.partialStates,
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: 'support-only SQLite-backed different-body conflict proof; production release boundary still required',
    },
    plannedTargets: plan.mutations.length,
  };

  return {
    ...payload,
    evidenceHash: `sha256:${digest(payload)}`,
  };
}

function assertSqliteConflictReadback(fixture) {
  const {
    plan,
    sqliteJournal,
    originalRequestHash,
    conflictingRequestHash,
    targetSnapshotHash,
    rawSiteValues,
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
  assert.equal(sqliteJournal.committedState.status, 'completed');
  assert.equal(sqliteJournal.committedState.restartReadable, true);
  assert.equal(sqliteJournal.committedState.mutationRows, plan.mutations.length);
  assert.equal(sqliteJournal.committedState.completedRows, 1);
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
    eventRows(sqliteJournal.records)
      .filter((record) => record.sequence > conflictRecord.sequence)
      .map((record) => record.event),
    [],
  );
  for (const record of sqliteJournal.records) {
    assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(record));
  }
  assertNoRawValues(sqliteJournal, rawSiteValues, 'RPP-0696 SQLite journal');
}

function assertRecoveryInspections(fixture) {
  const {
    plan,
    current,
    rawSiteValues,
    newRemoteInspection,
    oldRemoteInspection,
  } = fixture;

  assert.equal(newRemoteInspection.status, 'fully-updated-remote');
  assert.equal(newRemoteInspection.reasonCode, RECOVERY_INSPECT_REASON_CODES.fullyUpdatedRemote);
  assert.deepEqual(newRemoteInspection.counts, {
    old: 0,
    new: plan.mutations.length,
    blockedUnknown: 0,
  });
  assert.deepEqual(newRemoteInspection.remoteClassification, {
    state: 'new-remote',
    status: 'fully-updated-remote',
    evidence: 'hash-only-before-after-target-envelope',
    allTargetsAccountedFor: true,
  });
  assert.equal(newRemoteInspection.remoteRecoveryClassification.kind, 'new-remote');
  assert.equal(newRemoteInspection.remoteRecoveryClassification.proved, true);
  assert.equal(newRemoteInspection.remoteRecoveryClassification.storage, 'sqlite');
  assert.equal(newRemoteInspection.journal.storage, 'sqlite');
  assert.equal(newRemoteInspection.journal.committedState.restartReadable, true);
  assert.equal(newRemoteInspection.targets.length, plan.mutations.length);
  for (const target of newRemoteInspection.targets) {
    const mutation = plan.mutations.find((candidate) => candidate.id === target.mutationId);
    const expectedResourceValue = deserializeResourceValue(mutation.value);
    assert.ok(mutation);
    assert.equal(target.state, 'new');
    assert.match(target.beforeHash, hashPattern);
    assert.match(target.afterHash, hashPattern);
    assert.match(target.observedHash, hashPattern);
    assert.equal(target.observedHash, target.afterHash);
    assert.equal(target.observedHash, digest(expectedResourceValue));
    assert.equal(current.files[target.resourceKey.replace(/^file:/, '')], expectedResourceValue.content);
  }

  assert.equal(oldRemoteInspection.status, 'old-remote');
  assert.equal(oldRemoteInspection.reasonCode, RECOVERY_INSPECT_REASON_CODES.oldRemote);
  assert.deepEqual(oldRemoteInspection.counts, {
    old: plan.mutations.length,
    new: 0,
    blockedUnknown: 0,
  });
  assertNoRawValues(newRemoteInspection, rawSiteValues, 'RPP-0696 new remote inspection');
  assertNoRawValues(oldRemoteInspection, rawSiteValues, 'RPP-0696 old remote inspection');
}

function assertReleaseVerifierProof(movement, fixture) {
  const {
    plan,
    releaseSummary,
    newRemoteRecovery,
    oldRemoteRecovery,
    originalRequestHash,
    conflictingRequestHash,
    checkedPath,
    rawSiteValues,
  } = fixture;
  const proof = movement.proof;

  assert.equal(movement.ok, true);
  assert.equal(movement.checkedReleaseVerifierProofStarted, true);
  assert.equal(movement.checkedReplayProofStarted, true);
  assert.equal(movement.rejectedBodyRecoveryMovementStarted, false);
  assert.equal(movement.rejectedBodyReplayMovementStarted, false);
  assert.equal(movement.releaseMovement.allowed, false);
  assert.match(movement.releaseMovement.reasonHash, hashPattern);
  assert.equal(releaseSummary.releaseProof.recoveryInspect.recovery.checkedPath, checkedPath);
  assert.equal(releaseSummary.releaseProof.idempotencyConflict.recoveryState.checkedPath, checkedPath);
  assert.equal(releaseSummary.releaseProof.replayAndRetry.required, checkedPath);
  assert.equal(releaseSummary.releaseProof.replayAndRetry.observed, checkedPath);

  assert.equal(proof.ok, true);
  assert.equal(proof.gate, 'GATE-2');
  assert.equal(proof.durableRecoveryJournalBoundary, 'release-verifier');
  assert.equal(proof.gateStatus, 'proven');
  assert.equal(proof.sameReleaseBoundary, true);
  assert.equal(proof.sourceUrl, sourceUrl);
  assert.equal(proof.checks.ownsJournal, true);
  assert.equal(proof.checks.restartReadable, true);
  assert.equal(proof.checks.leaseOwnerIdentity, true);
  assert.equal(proof.checks.staleOwnerFencing, true);
  assert.equal(proof.checks.claimExpiryPolicy, true);
  assert.equal(proof.checks.recoveryInspectAfterRestart, true);
  assert.equal(proof.checks.sameKeyBodyReplay, true);
  assert.equal(proof.checks.sameKeyDifferentBodyConflict, true);
  assert.equal(proof.checks.sameKeyReplayAfterRejection, true);
  assert.equal(proof.checks.sameKeyRejectedReplay, true);
  assert.equal(proof.checks.oldState, true);
  assert.equal(proof.checks.newState, true);
  assert.equal(proof.checks.blockedState, true);
  assert.equal(proof.checks.preservedRejectedRemoteEvidence, true);
  assert.equal(proof.checks.manualRecoveryAuditExport, true);
  assert.equal(proof.recoveryInspectAfterRestart.proved, true);
  assert.equal(proof.recoveryInspectAfterRestart.journalState, 'ok');
  assert.deepEqual(proof.recoveryInspectAfterRestart.counts, newRemoteRecovery.counts);
  assert.equal(proof.partialStates.new.proved, true);
  assert.deepEqual(proof.partialStates.new.counts, newRemoteRecovery.counts);
  assert.equal(proof.partialStates.old.proved, true);
  assert.equal(proof.partialStates.old.source, oldRemoteRecovery.source);
  assert.deepEqual(proof.partialStates.old.counts, oldRemoteRecovery.counts);
  assert.equal(proof.partialStates.blocked.proved, true);
  assert.equal(proof.sameKeyReplayAfterRejection.sameCheckedRecoveryPath, true);
  assert.equal(proof.sameKeyReplayAfterRejection.applyStatus, 412);
  assert.equal(proof.sameKeyReplayAfterRejection.applyApplied, 0);
  assert.equal(proof.sameKeyReplayAfterRejection.mutationAppliedBeforeFailure, 0);
  assert.equal(proof.sameKeyReplayAfterRejection.applyCommitted, false);
  assert.equal(proof.sameKeyDifferentBodyConflict.proved, true);
  assert.equal(proof.sameKeyDifferentBodyConflict.status, 409);
  assert.equal(proof.sameKeyDifferentBodyConflict.code, 'IDEMPOTENCY_KEY_CONFLICT');
  assert.equal(proof.sameKeyDifferentBodyConflict.mutationEventsAfterConflict, 0);
  assert.equal(proof.sameKeyDifferentBodyConflict.requestHashEvidence.proved, true);
  assert.equal(
    proof.sameKeyDifferentBodyConflict.requestHashEvidence.originalRequestHash,
    originalRequestHash,
  );
  assert.equal(
    proof.sameKeyDifferentBodyConflict.requestHashEvidence.conflictingRequestHash,
    conflictingRequestHash,
  );
  assert.equal(proof.sameKeyDifferentBodyConflict.recoveryState.proved, true);
  assert.equal(proof.sameKeyDifferentBodyConflict.recoveryState.storage, 'sqlite');
  assert.equal(proof.sameKeyDifferentBodyConflict.recoveryState.dbBacked, true);
  assert.equal(proof.sameKeyDifferentBodyConflict.recoveryState.restartReadable, true);
  assert.deepEqual(proof.sameKeyDifferentBodyConflict.recoveryState.counts, {
    old: 0,
    new: plan.mutations.length,
    blockedUnknown: 0,
    total: plan.mutations.length,
  });
  assert.equal(proof.manualRecoveryAuditExport.proved, true);
  assert.equal(proof.manualRecoveryAuditExport.kind, 'manual-recovery-audit-export');
  assert.equal(proof.manualRecoveryAuditExport.sameReleaseBoundary, true);
  assert.equal(proof.manualRecoveryAuditExport.targetEnvelope.hashOnly, true);
  assert.equal(proof.manualRecoveryAuditExport.targetEnvelope.rawValuesIncluded, false);
  assertNoRawValues(releaseSummary, rawSiteValues, 'RPP-0696 release summary');
  assertNoRawValues(proof, rawSiteValues, 'RPP-0696 release proof');
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0696 release proof' }));
}

function assertReleaseVerifierEvidence(evidence, fixture) {
  const { plan, rawSiteValues } = fixture;

  assert.equal(evidence.issue, 'RPP-0696');
  assert.equal(evidence.variant, 5);
  assert.equal(evidence.evidenceSource, 'different-body-idempotency-conflict-release-verifier-v5');
  assert.equal(evidence.evidenceScope, 'local-sqlite-backed-release-verifier');
  assert.equal(evidence.status, 'support_only');
  assert.equal(evidence.verdict, 'DIFFERENT_BODY_CONFLICT_RECOVERY_STATE_PROVED_SUPPORT_ONLY');
  assert.equal(evidence.productionBacked, false);
  assert.equal(evidence.releaseEligible, false);
  assert.equal(evidence.releaseGate, 'NO-GO');
  assert.equal(evidence.rawValuesIncluded, false);
  assert.equal(evidence.hashOnly, true);
  assert.equal(evidence.storage, 'sqlite');
  assert.match(evidence.checkedPathHash, hashPattern);
  assert.equal(evidence.journal.storage, 'sqlite');
  assert.equal(evidence.journal.integrityStatus, 'ok');
  assert.equal(evidence.journal.eventCounts['idempotency-key-conflict'], 1);
  assert.equal(evidence.journal.eventCounts['mutation-applied'], plan.mutations.length);
  assert.equal(evidence.journal.restartReadable, true);
  assert.equal(evidence.journal.completedRows, 1);
  assert.equal(evidence.journal.committedTargetRows, plan.mutations.length);
  assert.match(evidence.journal.rowsHash, hashPattern);
  assert.equal(evidence.conflict.status, 409);
  assert.equal(evidence.conflict.code, 'IDEMPOTENCY_KEY_CONFLICT');
  assert.equal(evidence.conflict.sameKey, true);
  assert.equal(evidence.conflict.differentRequestHash, true);
  assert.equal(evidence.conflict.freshMutationWork, false);
  assert.equal(evidence.conflict.requestHashEvidence.proved, true);
  assert.equal(evidence.conflict.targetSnapshotUnchanged, true);
  assert.equal(evidence.conflict.mutationEventsAfterConflict, 0);
  assert.equal(evidence.conflict.recoveryState.storage, 'sqlite');
  assert.equal(evidence.conflict.recoveryState.proved, true);
  assert.deepEqual(evidence.recoveryInspect.counts, {
    old: 0,
    new: plan.mutations.length,
    blockedUnknown: 0,
    total: plan.mutations.length,
  });
  assert.equal(evidence.recoveryInspect.remoteRecoveryClassification.kind, 'new-remote');
  assert.equal(evidence.recoveryInspect.remoteRecoveryClassification.storage, 'sqlite');
  assert.equal(evidence.releaseVerifier.gate, 'GATE-2');
  assert.equal(evidence.releaseVerifier.durableRecoveryJournalBoundary, 'release-verifier');
  assert.equal(evidence.releaseVerifier.ok, true);
  assert.equal(evidence.releaseVerifier.gateStatus, 'proven');
  assert.equal(evidence.releaseVerifier.sameReleaseBoundary, true);
  assert.equal(evidence.releaseVerifier.checks.sameKeyDifferentBodyConflict, true);
  assert.equal(evidence.releaseVerifier.checks.sameKeyReplayAfterRejection, true);
  assert.equal(evidence.releaseVerifier.checks.newState, true);
  assert.deepEqual(evidence.releaseMovement, {
    allowed: false,
    gates: '0/4',
    reason: 'support-only SQLite-backed different-body conflict proof; production release boundary still required',
  });
  assert.equal(evidence.plannedTargets, plan.mutations.length);
  assert.match(evidence.evidenceHash, sha256EvidencePattern);

  const { evidenceHash, ...payload } = evidence;
  assert.equal(evidenceHash, `sha256:${digest(payload)}`);
  assertNoRawValues(evidence, rawSiteValues, 'RPP-0696 support evidence');
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(evidence, { label: 'RPP-0696 support evidence' }));
}

function assertNoRawValues(value, rawValues, label) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
  for (const rawValue of rawValues) {
    assert.equal(
      serialized.includes(rawValue),
      false,
      `${label} leaked raw fixture value: ${rawValue}`,
    );
  }
}

test('RPP-0696 SQLite-backed different-body conflict carries recovery state through release verifier v5', {
  skip: DatabaseSync === null ? 'node:sqlite is unavailable in this Node.js runtime' : false,
}, () => {
  const fixture = buildSqliteBackedConflictFixture();

  assertSqliteConflictReadback(fixture);
  assertRecoveryInspections(fixture);

  const movement = evaluateReleaseVerifierMovement(fixture.releaseSummary, {
    plan: fixture.plan,
    checkedPath: fixture.checkedPath,
  });
  assertReleaseVerifierProof(movement, fixture);

  const evidence = releaseVerifierEvidenceFor({
    fixture,
    releaseProof: movement.proof,
  });
  assertReleaseVerifierEvidence(evidence, fixture);
});

test('RPP-0696 release verifier rejects missing malformed stale duplicated or drifted conflict carry-through evidence', {
  skip: DatabaseSync === null ? 'node:sqlite is unavailable in this Node.js runtime' : false,
}, () => {
  const fixture = buildSqliteBackedConflictFixture();
  const baseSummary = fixture.releaseSummary;
  const conflictEvent = baseSummary.releaseProof.dbJournal.latestEvents.find((entry) => (
    entry.event === 'idempotency-key-conflict'
  ));
  const driftedRequestHash = digest({
    proof: 'rpp-0696',
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
      name: 'post-conflict-mutation',
      expectedCode: 'CONFLICT_EVIDENCE_STALE',
      mutate(summary) {
        summary.releaseProof.dbJournal.latestEvents.push({
          sequence: conflictEvent.sequence + 1,
          event: 'mutation-applied',
          requestHash: summary.releaseProof.idempotencyConflict.idempotency.requestHash,
        });
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
          proof: 'rpp-0696',
          targetSnapshot: 'drifted-after-conflict',
        });
      },
    },
    {
      name: 'drifted-recovery-counts',
      expectedCode: 'CONFLICT_EVIDENCE_DRIFTED',
      mutate(summary) {
        summary.releaseProof.idempotencyConflict.recoveryState.counts = {
          old: 1,
          new: fixture.plan.mutations.length - 1,
          blockedUnknown: 0,
          total: fixture.plan.mutations.length,
        };
      },
    },
    {
      name: 'drifted-checked-path',
      expectedCode: 'CONFLICT_EVIDENCE_DRIFTED',
      mutate(summary) {
        summary.releaseProof.replayAndRetry.observed = '/different-local-path';
      },
    },
  ];

  for (const negativeCase of cases) {
    const summary = cloneJson(baseSummary);
    negativeCase.mutate(summary);
    const movement = evaluateReleaseVerifierMovement(summary, {
      plan: fixture.plan,
      checkedPath: fixture.checkedPath,
    });

    assert.equal(movement.ok, false, negativeCase.name);
    assert.equal(movement.code, negativeCase.expectedCode, negativeCase.name);
    assert.equal(movement.conflictEvidence.ok, false, negativeCase.name);
    assert.equal(movement.checkedReleaseVerifierProofStarted, false, negativeCase.name);
    assert.equal(movement.checkedReplayProofStarted, false, negativeCase.name);
    assert.equal(movement.rejectedBodyRecoveryMovementStarted, false, negativeCase.name);
    assert.equal(movement.rejectedBodyReplayMovementStarted, false, negativeCase.name);
    assert.equal(movement.releaseMovement.allowed, false, negativeCase.name);
    assert.match(movement.releaseMovement.reasonHash, hashPattern, negativeCase.name);
    assert.equal(movement.proof, null, negativeCase.name);
  }
});
