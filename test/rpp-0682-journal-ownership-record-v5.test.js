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
  productionRecoveryJournalInspectionSurfaceIsPresent,
  readRecoveryJournal,
  readSqliteRecoveryJournalTable,
  recoveryClaimHash,
} from '../src/recovery-journal.js';
import { buildDurableRecoveryJournalReleaseProof } from '../scripts/playground/production-shaped-live-release-verify-lib.js';

const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hashPattern = /^[a-f0-9]{64}$/;
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0682-journal-'));
  return path.join(dir, 'recovery.jsonl');
}

function tempSqlitePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0682-sqlite-'));
  return path.join(dir, 'recovery.sqlite');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite() {
  const files = {};
  for (let index = 1; index <= 4; index++) {
    files[`rpp-0682-file-${index}.txt`] = `rpp-0682-base-raw-site-value-${index}`;
  }
  return { files, plugins: {}, db: {} };
}

function localSite(base = baseSite()) {
  const site = cloneJson(base);
  for (let index = 1; index <= 4; index++) {
    site.files[`rpp-0682-file-${index}.txt`] = `rpp-0682-local-raw-site-value-${index}`;
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
    'rpp-0682-base-raw-site-value',
    'rpp-0682-local-raw-site-value',
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

function recordsOfType(records, type) {
  return records.filter((record) => record.type === type);
}

function ownershipRecordFor(journal, claimId) {
  return ownershipRecordsFor(journal).find((record) => record.claimId === claimId);
}

function assertOwnerIdentity(record, claimId) {
  assert.equal(record.claimId, claimId);
  assert.equal(record.claimHash, recoveryClaimHash(claimId));
  assert.match(record.journalIdentityHash, hashPattern);
}

function assertOwnershipRecordContract(record, {
  claimId,
  plan,
  artifactRefs,
  rawSiteValues,
  expectedSequence = null,
}) {
  assert.ok(record, `missing ownership record for ${claimId}`);
  if (expectedSequence !== null) {
    assert.equal(record.sequence, expectedSequence);
  }
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
  expectedSequence = null,
}) {
  assert.ok(record, `missing ownership summary for ${claimId}`);
  if (expectedSequence !== null) {
    assert.equal(record.sequence, expectedSequence);
  }
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

function assertProductionInspectionContract(inspection, {
  filePath,
  activeClaimId,
  retryClaimId,
  claimStaleThresholdMs,
  rawSiteValues,
}) {
  assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(inspection), true);
  assert.equal(inspection.claim.status, 'advanced');
  assert.equal(inspection.claim.activeClaimId, retryClaimId);
  assert.equal(inspection.claim.activeClaimHash, recoveryClaimHash(retryClaimId));
  assert.equal(inspection.claim.previousClaimId, activeClaimId);
  assert.equal(inspection.claim.previousClaimHash, recoveryClaimHash(activeClaimId));
  assert.equal(inspection.claim.staleClaimRejected, true);
  assert.equal(inspection.claim.claimExpiry.policy, 'bounded-stale-claim-advance');
  assert.equal(inspection.claim.claimExpiry.expired, true);
  assert.equal(inspection.claim.claimExpiry.previousClaimExpired, true);
  assert.equal(inspection.claim.claimExpiry.previousClaimAgeMs, 7_000);
  assert.equal(inspection.claim.claimExpiry.staleThresholdMs, claimStaleThresholdMs);
  assert.equal(inspection.journal.restartReadable, true);
  assert.equal(inspection.journal.openState.restartReadable, true);
  assert.equal(inspection.journal.ownership.restartReadable, true);
  assert.deepEqual(inspection.journal.ownership, expectedOwnership);
  assert.equal(inspection.journal.leaseFence.restartReadable, true);
  assert.equal(inspection.journal.leaseFence.staleClaimRejected, true);
  assert.equal(inspection.journal.writerLease.claimId, retryClaimId);
  assert.equal(inspection.journal.writerLease.claimKeyHash, recoveryClaimHash(retryClaimId));
  assert.equal(inspection.journal.leaseFence.writerLease.claimId, retryClaimId);
  assert.equal(
    inspection.journal.leaseFence.writerLease.claimKeyHash,
    recoveryClaimHash(retryClaimId),
  );
  assert.deepEqual(inspection.journal.checked, [filePath]);
  assertOwnershipSummaryContract(inspection.journal.ownershipRecord, {
    claimId: retryClaimId,
    rawSiteValues,
  });
  assertNoRawSiteValues(inspection, rawSiteValues);
}

function assertJournalRowsDurableAfterRestart(restarted, seededRecords, {
  plan,
  rawSiteValues,
  expectedClaimIds,
}) {
  assert.equal(restarted.integrity.status, 'ok');
  assert.deepEqual(restarted.records, seededRecords);
  assert.deepEqual(
    restarted.records.map((record) => record.sequence),
    Array.from({ length: restarted.records.length }, (_, index) => index + 1),
  );
  assert.equal(
    restarted.records.filter((record) => record.type === 'target-planned').length,
    plan.mutations.length,
  );
  assert.equal(
    restarted.records.filter((record) => record.type === 'recovery-claim-opened').length,
    1,
  );
  assert.equal(recordsOfType(restarted.records, 'stale-claim-advanced').length, 1);
  assert.deepEqual(
    ownershipRecordsFor(restarted).map((record) => record.claimId).sort(),
    [...expectedClaimIds].sort(),
  );
  assert.ok(restarted.records.every((record) => record.fsync.requested === true));
  assertNoRawSiteValues(restarted.records, rawSiteValues);
}

function assertRestartInspection(restarted, {
  plan,
  remote,
  retryClaimId,
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
  assert.equal(inspection.claim.activeClaimId, retryClaimId);
  assert.equal(inspection.claim.activeClaimHash, recoveryClaimHash(retryClaimId));
  assertNoRawSiteValues(inspection, rawSiteValues);
  return inspection;
}

function assertNoRawSiteValues(value, rawSiteValues) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const rawValue of rawSiteValues) {
    assert.equal(
      serialized.includes(rawValue),
      false,
      `Unexpected raw site value in RPP-0682 ownership evidence: ${rawValue}`,
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

function openDurableOwnershipJournal({ filePath, plan, remote, rawSiteValues }) {
  const artifactRefs = {
    releaseProof: 'artifact://rpp-0682-journal-ownership-record-v5',
    recoverySupport: 'artifact://rpp-0682-local-recovery-support',
  };
  const claimStaleThresholdMs = 2_000;
  const activeClaimId = 'rpp-0682-file-backed-active-ownership-claim';
  const retryClaimId = 'rpp-0682-file-backed-retry-ownership-claim';

  const active = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    now: fixedNow,
    claimId: activeClaimId,
    claimStaleThresholdMs,
  });
  const activeInspection = active.inspect();
  active.close();

  assertOwnershipSummaryContract(activeInspection.journal.ownershipRecord, {
    claimId: activeClaimId,
    rawSiteValues,
    expectedSequence: 2,
  });

  const retry = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    now: new Date(fixedNow.getTime() + 7_000),
    truncate: false,
    claimId: retryClaimId,
    claimStaleThresholdMs,
  });
  const productionInspection = retry.inspect();
  retry.close();

  assertProductionInspectionContract(productionInspection, {
    filePath,
    activeClaimId,
    retryClaimId,
    claimStaleThresholdMs,
    rawSiteValues,
  });

  const seeded = readRecoveryJournal(filePath);
  assert.equal(seeded.integrity.status, 'ok');
  assertOwnershipRecordContract(ownershipRecordFor(seeded, activeClaimId), {
    claimId: activeClaimId,
    plan,
    artifactRefs,
    rawSiteValues,
    expectedSequence: 2,
  });
  assertOwnershipRecordContract(ownershipRecordFor(seeded, retryClaimId), {
    claimId: retryClaimId,
    plan,
    artifactRefs,
    rawSiteValues,
  });
  assert.equal(ownershipRecordFor(seeded, retryClaimId).sequence > 2, true);
  assert.equal(recordsOfType(seeded.records, 'stale-claim-advanced').length, 1);
  assertNoRawSiteValues(fs.readFileSync(filePath, 'utf8'), rawSiteValues);

  return {
    artifactRefs,
    activeClaimId,
    retryClaimId,
    productionInspection,
    seeded,
  };
}

function oldRemoteRecoveryFromInspection({ inspection, plan, checkedPath }) {
  return {
    source: 'RPP-0682 restarted journal ownership record readback',
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
      checkedPath,
      allTargetsAccountedFor: true,
    },
  };
}

function buildRecoveryReleaseSummary({
  productionInspection,
  plan,
  oldRemoteRecovery,
}) {
  const mutationEvents = plan.mutations.length;
  const checkedPath = productionInspection.journal.checked[0];
  const originalRequestHash = '5'.repeat(64);
  const conflictingRequestHash = '6'.repeat(64);
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

  return {
    topology: {
      sourceUrl: 'http://127.0.0.1:8080',
    },
    boundary: {
      verdict: 'LIVE_RELEASE_BOUNDARY_OK',
    },
    durableJournal: {
      proof: productionInspection,
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
          checkedPath,
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
          requestHash: conflictingRequestHash,
          originalRequestHash,
        },
        targetSnapshotUnchanged: true,
        recoveryState: {
          source: 'RPP-0682 different-body conflict recovery state',
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
        mutationApplied: mutationEvents,
        eventCounts: {
          'idempotency-key-conflict': 1,
        },
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
        required: checkedPath,
        observed: checkedPath,
        retryAttempts: 2,
        verdict: 'PRESERVED_REMOTE_RETRY_PROVEN',
      },
    },
  };
}

function buildBlockedApplyRevalidation(plan) {
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
        applyRejected: 20,
        applyReplayed: 21,
        mutationAppliedBeforeFailure: 0,
        applyCommitted: false,
      },
    },
    durableJournal: {
      checkedAccepted: true,
    },
    boundary: {
      verdict: 'LIVE_RELEASE_BOUNDARY_OK',
      durableJournal: {
        verdict: 'LIVE_RELEASE_BOUNDARY_OK',
      },
    },
  };
}

function assertReleaseVerifierProof(proof, {
  releaseSummary,
  plan,
  retryClaimId,
  checkedPath,
  oldRemoteRecovery,
  rawSiteValues,
}) {
  assert.equal(releaseSummary.releaseProof.recoveryInspect.recovery.checkedPath, checkedPath);
  assert.equal(
    releaseSummary.releaseProof.staleClaimRetry.oldRemoteRecovery.targetEnvelope.checkedPath,
    checkedPath,
  );
  assert.equal(releaseSummary.releaseProof.replayAndRetry.required, checkedPath);
  assert.equal(releaseSummary.releaseProof.replayAndRetry.observed, checkedPath);
  assert.equal(proof.ok, true);
  assert.equal(proof.gate, 'GATE-2');
  assert.equal(proof.durableRecoveryJournalBoundary, 'release-verifier');
  assert.equal(proof.gateStatus, 'proven');
  assert.equal(proof.sameReleaseBoundary, true);
  assert.equal(proof.sourceUrl, 'http://127.0.0.1:8080');
  assert.equal(proof.checks.ownsJournal, true);
  assert.equal(proof.checks.restartReadable, true);
  assert.equal(proof.checks.leaseOwnerIdentity, true);
  assert.equal(proof.checks.staleOwnerFencing, true);
  assert.equal(proof.checks.claimExpiryPolicy, true);
  assert.equal(proof.checks.recoveryInspectAfterRestart, true);
  assert.equal(proof.checks.oldState, true);
  assert.equal(proof.checks.newState, true);
  assert.equal(proof.checks.blockedState, true);
  assert.equal(proof.checks.sameKeyReplayAfterRejection, true);
  assert.equal(proof.checks.manualRecoveryAuditExport, true);
  assert.deepEqual(proof.ownership, expectedOwnership);
  assert.equal(proof.leaseOwnerIdentity.activeClaimId, retryClaimId);
  assert.equal(proof.leaseOwnerIdentity.activeClaimKeyHash, recoveryClaimHash(retryClaimId));
  assert.equal(proof.leaseOwnerIdentity.writerLeaseClaimId, retryClaimId);
  assert.equal(proof.leaseOwnerIdentity.writerLeaseClaimKeyHash, recoveryClaimHash(retryClaimId));
  assert.equal(proof.leaseOwnerIdentity.leaseFenceClaimId, retryClaimId);
  assert.equal(proof.leaseOwnerIdentity.leaseFenceClaimKeyHash, recoveryClaimHash(retryClaimId));
  assert.equal(proof.leaseOwnerIdentity.matches, true);
  assert.equal(proof.staleOwnerFencing.proved, true);
  assert.equal(proof.claimExpiryPolicy.proved, true);
  assert.equal(proof.claimExpiryPolicy.previousClaimAgeMs, 7_000);
  assert.equal(proof.recoveryInspectAfterRestart.proved, true);
  assert.equal(proof.recoveryInspectAfterRestart.journalState, 'ok');
  assert.equal(proof.partialStates.old.proved, true);
  assert.equal(proof.partialStates.old.source, oldRemoteRecovery.source);
  assert.equal(proof.partialStates.old.state, 'old-remote');
  assert.deepEqual(proof.partialStates.old.counts, oldRemoteRecovery.counts);
  assert.equal(proof.sameKeyReplayAfterRejection.sameCheckedRecoveryPath, true);
  assert.equal(proof.sameKeyReplayAfterRejection.applyStatus, 412);
  assert.equal(proof.sameKeyReplayAfterRejection.applyApplied, 0);
  assert.equal(proof.manualRecoveryAuditExport.proved, true);
  assert.equal(proof.manualRecoveryAuditExport.kind, 'manual-recovery-audit-export');
  assert.equal(proof.manualRecoveryAuditExport.sameReleaseBoundary, true);
  assert.equal(proof.manualRecoveryAuditExport.targetEnvelope.plannedTargets, plan.mutations.length);
  assert.equal(proof.manualRecoveryAuditExport.targetEnvelope.summaryOnly, true);
  assert.equal(proof.manualRecoveryAuditExport.targetEnvelope.hashOnly, true);
  assert.equal(proof.manualRecoveryAuditExport.targetEnvelope.rawValuesIncluded, false);
  assertNoRawSiteValues(proof, rawSiteValues);
}

test('RPP-0682 file-backed journal ownership rows are durable after process restart and carried through the release verifier', () => {
  const filePath = tempJournalPath();
  const { plan, remote, rawSiteValues } = buildScenario();
  const {
    artifactRefs,
    activeClaimId,
    retryClaimId,
    productionInspection,
    seeded,
  } = openDurableOwnershipJournal({ filePath, plan, remote, rawSiteValues });

  const restarted = readFileJournalAfterProcessRestart(filePath);
  assertJournalRowsDurableAfterRestart(restarted, seeded.records, {
    plan,
    rawSiteValues,
    expectedClaimIds: [activeClaimId, retryClaimId],
  });
  assertOwnershipRecordContract(ownershipRecordFor(restarted, activeClaimId), {
    claimId: activeClaimId,
    plan,
    artifactRefs,
    rawSiteValues,
    expectedSequence: 2,
  });
  assertOwnershipRecordContract(ownershipRecordFor(restarted, retryClaimId), {
    claimId: retryClaimId,
    plan,
    artifactRefs,
    rawSiteValues,
  });

  const oldRemoteInspection = assertRestartInspection(restarted, {
    plan,
    remote,
    retryClaimId,
    rawSiteValues,
  });
  const checkedPath = productionInspection.journal.checked[0];
  const oldRemoteRecovery = oldRemoteRecoveryFromInspection({
    inspection: oldRemoteInspection,
    plan,
    checkedPath,
  });
  const releaseSummary = buildRecoveryReleaseSummary({
    productionInspection,
    plan,
    oldRemoteRecovery,
  });
  const releaseProof = buildDurableRecoveryJournalReleaseProof({
    releaseSummary,
    applyRevalidation: buildBlockedApplyRevalidation(plan),
  });

  assert.equal(checkedPath, filePath);
  assertReleaseVerifierProof(releaseProof, {
    releaseSummary,
    plan,
    retryClaimId,
    checkedPath,
    oldRemoteRecovery,
    rawSiteValues,
  });
});

test('RPP-0682 SQLite journal ownership rows are durable after process restart', {
  skip: DatabaseSync === null ? 'node:sqlite is unavailable in this Node.js runtime' : false,
}, () => {
  const filePath = tempJournalPath();
  const sqlitePath = tempSqlitePath();
  const { plan, remote, rawSiteValues } = buildScenario();
  const {
    artifactRefs,
    activeClaimId,
    retryClaimId,
    seeded,
  } = openDurableOwnershipJournal({ filePath, plan, remote, rawSiteValues });

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
    expectedClaimIds: [activeClaimId, retryClaimId],
  });
  assertOwnershipRecordContract(ownershipRecordFor(restarted, activeClaimId), {
    claimId: activeClaimId,
    plan,
    artifactRefs,
    rawSiteValues,
    expectedSequence: 2,
  });
  assertOwnershipRecordContract(ownershipRecordFor(restarted, retryClaimId), {
    claimId: retryClaimId,
    plan,
    artifactRefs,
    rawSiteValues,
  });
  assert.equal(JSON.stringify(ownershipRecordsFor(restarted)).includes(filePath), false);
  assert.equal(JSON.stringify(ownershipRecordsFor(restarted)).includes(sqlitePath), false);
  assertRestartInspection(restarted, {
    plan,
    remote,
    retryClaimId,
    rawSiteValues,
  });

  database = new DatabaseSync(sqlitePath);
  try {
    for (const ownershipRecord of ownershipRecordsFor(seeded)) {
      const storedOwnershipRows = database
        .prepare('SELECT sequence, schema_version, record_json FROM recovery_journal WHERE sequence = ?')
        .all(ownershipRecord.sequence);
      assert.equal(storedOwnershipRows.length, 1);
      assert.equal(storedOwnershipRows[0].schema_version, ownershipRecord.schemaVersion);
      assert.deepEqual(JSON.parse(storedOwnershipRows[0].record_json), ownershipRecord);
    }
  } finally {
    database.close();
  }
});
