import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createPushPlan } from '../src/planner.js';
import { inspectRecoveryJournal } from '../src/recovery-inspect.js';
import {
  assertJournalRecordHasNoRawValues,
  classifyRecoveryJournalClaims,
  openProductionRecoveryJournal,
  openRecoveryJournal,
  productionRecoveryJournalInspectionSurfaceIsPresent,
  readRecoveryJournal,
  recoveryClaimHash,
  RecoveryJournalClaimStaleError,
} from '../src/recovery-journal.js';
import { digest } from '../src/stable-json.js';
import { buildDurableRecoveryJournalReleaseProof } from '../scripts/playground/production-shaped-live-release-verify-lib.js';

const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;
const mutationPreparationEventTypes = new Set([
  'apply-staged',
  'dependencies-validated',
  'mutation-observed',
  'mutation-applied',
  'journal-completed',
  'apply-committed',
]);

function tempJournalPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0685-claim-expiry-'));
  return path.join(dir, 'recovery.jsonl');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite() {
  const files = {};
  for (let index = 1; index <= 5; index++) {
    files[`rpp-0685-file-${index}.txt`] = `rpp-0685-base-raw-site-value-${index}`;
  }
  return { files, plugins: {}, db: {} };
}

function localSite(base = baseSite()) {
  const site = cloneJson(base);
  for (let index = 1; index <= 5; index++) {
    site.files[`rpp-0685-file-${index}.txt`] = `rpp-0685-local-raw-site-value-${index}`;
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
    plan,
    remote,
    rawSiteValues: rawSiteValuesFor(base, local, remote),
  };
}

function rawSiteValuesFor(...sites) {
  const values = new Set([
    'rpp-0685-base-raw-site-value',
    'rpp-0685-local-raw-site-value',
  ]);
  for (const site of sites) {
    for (const value of Object.values(site.files || {})) {
      values.add(value);
    }
  }
  return [...values];
}

function recordsOfType(records, type) {
  return records.filter((record) => record.type === type);
}

function assertNoRawSiteValues(value, rawSiteValues) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const rawValue of rawSiteValues) {
    assert.equal(
      serialized.includes(rawValue),
      false,
      `Unexpected raw site value in RPP-0685 evidence: ${rawValue}`,
    );
  }
}

function assertRecordsHaveNoRawValues(records, rawSiteValues) {
  for (const record of records) {
    assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(record));
  }
  assertNoRawSiteValues(records, rawSiteValues);
}

function assertNoMutationPreparationEvents(records) {
  assert.equal(records.some((record) => mutationPreparationEventTypes.has(record.type)), false);
}

function assertStaleClaimError(error, {
  staleClaimId,
  activeClaimId,
  activeClaimType,
  eventType,
  claimExpired,
  activeClaimAgeMs,
  rawSiteValues,
}) {
  assert.ok(error instanceof RecoveryJournalClaimStaleError);
  assert.equal(error.code, 'RECOVERY_CLAIM_STALE');
  assert.equal(error.details.eventType, eventType);
  assert.equal(error.details.staleClaimId, staleClaimId);
  assert.equal(error.details.staleClaimHash, recoveryClaimHash(staleClaimId));
  assert.equal(error.details.activeClaimId, activeClaimId);
  assert.equal(error.details.activeClaimHash, recoveryClaimHash(activeClaimId));
  assert.equal(error.details.activeClaimType, activeClaimType);
  if (claimExpired !== undefined) {
    assert.equal(error.details.claimExpired, claimExpired);
  }
  if (activeClaimAgeMs !== undefined) {
    assert.equal(error.details.activeClaimAgeMs, activeClaimAgeMs);
  }
  assertNoRawSiteValues(error.details, rawSiteValues);
  return true;
}

function assertProductionClaimSurface(inspection, {
  claimId,
  previousClaimId,
  expectedStatus,
  staleClaimRejected,
  claimExpired,
  previousClaimAgeMs,
  staleThresholdMs,
  rawSiteValues,
}) {
  const claimHash = recoveryClaimHash(claimId);
  assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(inspection), true);
  assert.equal(inspection.claim.status, expectedStatus);
  assert.equal(inspection.claim.activeClaimId, claimId);
  assert.equal(inspection.claim.activeClaimHash, claimHash);
  assert.equal(inspection.claim.previousClaimId, previousClaimId);
  assert.equal(inspection.claim.staleClaimRejected, staleClaimRejected);
  assert.equal(inspection.claim.claimExpiry.policy, 'bounded-stale-claim-advance');
  assert.equal(inspection.claim.claimExpiry.expired, claimExpired);
  assert.equal(inspection.claim.claimExpiry.staleThresholdMs, staleThresholdMs);
  if (previousClaimAgeMs !== null) {
    assert.equal(inspection.claim.claimExpiry.previousClaimAgeMs, previousClaimAgeMs);
  }
  assert.equal(inspection.journal.claimId, claimId);
  assert.equal(inspection.journal.claimHash, claimHash);
  assert.equal(inspection.journal.writerLease.claimId, claimId);
  assert.equal(inspection.journal.writerLease.claimHash, claimHash);
  assert.equal(inspection.journal.writerLease.claimKeyHash, claimHash);
  assert.equal(inspection.journal.writerLease.claimExpiry.expired, claimExpired);
  assert.equal(inspection.journal.writerLease.staleClaimRejected, staleClaimRejected);
  assert.equal(inspection.journal.leaseFence.claimExpiry.expired, claimExpired);
  assert.equal(inspection.journal.leaseFence.staleClaimRejected, staleClaimRejected);
  assert.equal(inspection.journal.leaseFence.writerLease.claimId, claimId);
  assert.equal(inspection.journal.leaseFence.writerLease.claimHash, claimHash);
  assert.deepEqual(inspection.leaseFence, inspection.journal.leaseFence);
  assert.deepEqual(inspection.leaseFence.writerLease, inspection.journal.writerLease);
  assertNoRawSiteValues(inspection, rawSiteValues);
}

function assertNonExpiredRejectionRecord(record, {
  plan,
  staleClaimId,
  activeClaimId,
  remote,
  artifactRefs,
  rawSiteValues,
}) {
  assert.equal(record.type, 'stale-claim-rejected');
  assert.equal(record.planId, plan.id);
  assert.equal(record.state, 'rejected');
  assert.equal(record.claimId, staleClaimId);
  assert.equal(record.claimHash, recoveryClaimHash(staleClaimId));
  assert.equal(record.previousClaimId, activeClaimId);
  assert.equal(record.previousClaimHash, recoveryClaimHash(activeClaimId));
  assert.equal(record.observedHash, digest(remote));
  assert.match(record.observedHash, hashPattern);
  assert.equal(record.staleThresholdMs, 2_000);
  assert.equal(record.previousClaimAgeMs, 1_000);
  assert.equal(record.previousClaimOpenedAt, '2026-05-31T00:00:00.000Z');
  assert.equal(record.previousClaimExpiresAt, '2026-05-31T00:00:02.000Z');
  assert.equal(record.evaluatedAt, '2026-05-31T00:00:01.000Z');
  assert.equal(record.claimExpired, false);
  assert.deepEqual(record.artifactRefs, artifactRefs);
  assert.equal(record.fsync.requested, true);
  assert.equal(record.fsync.strategy, 'after-append');
  assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(record));
  assertNoRawSiteValues(record, rawSiteValues);
}

function assertExpiredAdvanceRecord(record, {
  plan,
  retryClaimId,
  activeClaimId,
  remote,
  artifactRefs,
  rawSiteValues,
}) {
  assert.equal(record.type, 'stale-claim-advanced');
  assert.equal(record.planId, plan.id);
  assert.equal(record.state, 'advanced');
  assert.equal(record.claimId, retryClaimId);
  assert.equal(record.claimHash, recoveryClaimHash(retryClaimId));
  assert.equal(record.previousClaimId, activeClaimId);
  assert.equal(record.previousClaimHash, recoveryClaimHash(activeClaimId));
  assert.equal(record.observedHash, digest(remote));
  assert.match(record.observedHash, hashPattern);
  assert.equal(record.staleThresholdMs, 2_000);
  assert.equal(record.previousClaimAgeMs, 7_000);
  assert.equal(record.previousClaimOpenedAt, '2026-05-31T00:00:00.000Z');
  assert.equal(record.previousClaimExpiresAt, '2026-05-31T00:00:02.000Z');
  assert.equal(record.evaluatedAt, '2026-05-31T00:00:07.000Z');
  assert.equal(record.claimOpenedAt, '2026-05-31T00:00:07.000Z');
  assert.equal(record.claimExpiresAt, '2026-05-31T00:00:09.000Z');
  assert.equal(record.claimExpired, true);
  assert.deepEqual(record.artifactRefs, artifactRefs);
  assert.equal(record.fsync.requested, true);
  assert.equal(record.fsync.strategy, 'after-append');
  assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(record));
  assertNoRawSiteValues(record, rawSiteValues);
}

function buildRecoveryReleaseSummary({ inspection, plan, oldRemoteRecovery }) {
  const mutationEvents = plan.mutations.length;
  const originalRequestHash = '8'.repeat(64);
  const conflictingRequestHash = '9'.repeat(64);
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
      proof: inspection,
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
          requestHash: conflictingRequestHash,
          originalRequestHash,
        },
        targetSnapshotUnchanged: true,
        recoveryState: {
          source: 'RPP-0685 recovery inspect after different-body conflict',
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
        required: '/snapshot',
        observed: '/snapshot',
        retryAttempts: 2,
        verdict: 'PRESERVED_REMOTE_RETRY_PROVEN',
      },
    },
  };
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
      durableJournal: {
        verdict: 'LIVE_RELEASE_BOUNDARY_OK',
      },
    },
  };
}

test('RPP-0685 claim expiry policy advances once and keeps the release verifier on the same recovery path', () => {
  const filePath = tempJournalPath();
  const { plan, remote, rawSiteValues } = buildScenario();
  const artifactRefs = {
    releaseProof: 'artifact://rpp-0685-claim-expiry-policy-v5',
    recoverySupport: 'artifact://rpp-0685-local-recovery-support',
  };
  const activeClaimId = 'rpp-0685-active-claim-not-expired';
  const nonExpiredClaimId = 'rpp-0685-non-expired-competing-claim';
  const retryClaimId = 'rpp-0685-expired-claim-policy-retry';
  const claimStaleThresholdMs = 2_000;

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

  assertProductionClaimSurface(activeInspection, {
    claimId: activeClaimId,
    previousClaimId: null,
    expectedStatus: 'active',
    staleClaimRejected: false,
    claimExpired: false,
    previousClaimAgeMs: null,
    staleThresholdMs: claimStaleThresholdMs,
    rawSiteValues,
  });

  const remoteBeforeNonExpiredRetry = cloneJson(remote);
  assert.throws(
    () => openProductionRecoveryJournal({
      filePath,
      plan,
      current: remote,
      artifactRefs,
      now: new Date(fixedNow.getTime() + 1_000),
      truncate: false,
      claimId: nonExpiredClaimId,
      claimStaleThresholdMs,
    }),
    (error) => assertStaleClaimError(error, {
      staleClaimId: nonExpiredClaimId,
      activeClaimId,
      activeClaimType: 'recovery-claim-opened',
      eventType: 'recovery-claim-opened',
      claimExpired: false,
      activeClaimAgeMs: 1_000,
      rawSiteValues,
    }),
  );
  assert.deepEqual(remote, remoteBeforeNonExpiredRetry);

  const afterNonExpiredRetry = readRecoveryJournal(filePath);
  const nonExpiredClaim = classifyRecoveryJournalClaims(afterNonExpiredRetry.records);
  const nonExpiredRejections = recordsOfType(afterNonExpiredRetry.records, 'stale-claim-rejected');

  assert.equal(afterNonExpiredRetry.integrity.status, 'ok');
  assert.equal(nonExpiredClaim.status, 'active');
  assert.equal(nonExpiredClaim.activeClaimId, activeClaimId);
  assert.equal(nonExpiredClaim.activeClaimHash, recoveryClaimHash(activeClaimId));
  assert.equal(recordsOfType(afterNonExpiredRetry.records, 'stale-claim-advanced').length, 0);
  assert.equal(
    afterNonExpiredRetry.records.filter(
      (record) => record.type === 'recovery-claim-opened' && record.claimId === nonExpiredClaimId,
    ).length,
    0,
  );
  assert.equal(nonExpiredRejections.length, 1);
  assertNonExpiredRejectionRecord(nonExpiredRejections[0], {
    plan,
    staleClaimId: nonExpiredClaimId,
    activeClaimId,
    remote,
    artifactRefs,
    rawSiteValues,
  });
  assertNoMutationPreparationEvents(afterNonExpiredRetry.records);
  assertRecordsHaveNoRawValues(afterNonExpiredRetry.records, rawSiteValues);

  const remoteBeforeExpiredRetry = cloneJson(remote);
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
  const retryInspection = retry.inspect();
  retry.close();
  assert.deepEqual(remote, remoteBeforeExpiredRetry);

  assertProductionClaimSurface(retryInspection, {
    claimId: retryClaimId,
    previousClaimId: activeClaimId,
    expectedStatus: 'advanced',
    staleClaimRejected: true,
    claimExpired: true,
    previousClaimAgeMs: 7_000,
    staleThresholdMs: claimStaleThresholdMs,
    rawSiteValues,
  });
  assert.equal(retryInspection.claim.claimExpiry.previousClaimExpired, true);
  assert.equal(retryInspection.journal.ownershipRecord.claimId, retryClaimId);
  assert.equal(retryInspection.journal.ownershipRecord.claimHash, recoveryClaimHash(retryClaimId));
  assert.match(retryInspection.journal.ownershipRecord.journalIdentityHash, hashPattern);

  const restartedAfterAdvance = readRecoveryJournal(filePath);
  const advancedClaim = classifyRecoveryJournalClaims(restartedAfterAdvance.records);
  const advancedRecords = recordsOfType(restartedAfterAdvance.records, 'stale-claim-advanced');
  const ownershipRecords = recordsOfType(restartedAfterAdvance.records, 'journal-ownership-recorded');

  assert.equal(restartedAfterAdvance.integrity.status, 'ok');
  assert.equal(advancedClaim.status, 'advanced');
  assert.equal(advancedClaim.activeClaimId, retryClaimId);
  assert.equal(advancedClaim.previousClaimId, activeClaimId);
  assert.equal(advancedClaim.claimExpiry.expired, true);
  assert.equal(advancedRecords.length, 1);
  assertExpiredAdvanceRecord(advancedRecords[0], {
    plan,
    retryClaimId,
    activeClaimId,
    remote,
    artifactRefs,
    rawSiteValues,
  });
  assert.equal(ownershipRecords.length, 2);
  assert.deepEqual(
    ownershipRecords.map((record) => record.claimId).sort(),
    [activeClaimId, retryClaimId].sort(),
  );
  assertNoMutationPreparationEvents(restartedAfterAdvance.records);
  assertRecordsHaveNoRawValues(restartedAfterAdvance.records, rawSiteValues);
  assertNoRawSiteValues(fs.readFileSync(filePath, 'utf8'), rawSiteValues);

  const oldRemoteInspection = inspectRecoveryJournal({
    journal: restartedAfterAdvance,
    plan,
    current: remote,
  });
  assert.equal(oldRemoteInspection.status, 'old-remote');
  assert.deepEqual(oldRemoteInspection.counts, {
    old: plan.mutations.length,
    new: 0,
    blockedUnknown: 0,
  });
  assertNoRawSiteValues(oldRemoteInspection, rawSiteValues);

  const oldRemoteRecovery = {
    source: 'RPP-0685 restarted file-backed claim-expiry journal',
    status: 200,
    state: oldRemoteInspection.status,
    counts: {
      ...oldRemoteInspection.counts,
      total: plan.mutations.length,
    },
  };
  const releaseProof = buildDurableRecoveryJournalReleaseProof({
    releaseSummary: buildRecoveryReleaseSummary({
      inspection: retryInspection,
      plan,
      oldRemoteRecovery,
    }),
    applyRevalidation: buildBlockedApplyRevalidation(),
  });

  assert.equal(releaseProof.ok, true);
  assert.equal(releaseProof.gate, 'GATE-2');
  assert.equal(releaseProof.durableRecoveryJournalBoundary, 'release-verifier');
  assert.equal(releaseProof.gateStatus, 'proven');
  assert.equal(releaseProof.sameReleaseBoundary, true);
  assert.equal(releaseProof.sourceUrl, 'http://127.0.0.1:8080');
  assert.equal(releaseProof.checks.claimExpiryPolicy, true);
  assert.equal(releaseProof.checks.oldState, true);
  assert.equal(releaseProof.checks.recoveryInspectAfterRestart, true);
  assert.equal(releaseProof.checks.sameKeyReplayAfterRejection, true);
  assert.equal(releaseProof.checks.staleOwnerFencing, true);
  assert.equal(releaseProof.checks.manualRecoveryAuditExport, true);
  assert.equal(releaseProof.partialStates.old.proved, true);
  assert.equal(releaseProof.partialStates.old.source, oldRemoteRecovery.source);
  assert.equal(releaseProof.partialStates.old.state, 'old-remote');
  assert.deepEqual(releaseProof.partialStates.old.counts, oldRemoteRecovery.counts);
  assert.equal(releaseProof.recoveryInspectAfterRestart.proved, true);
  assert.equal(releaseProof.recoveryInspectAfterRestart.state, 'fully-updated-remote');
  assert.equal(releaseProof.recoveryInspectAfterRestart.journalState, 'ok');
  assert.equal(releaseProof.sameKeyReplayAfterRejection.proved, true);
  assert.equal(releaseProof.sameKeyReplayAfterRejection.sameCheckedRecoveryPath, true);
  assert.equal(releaseProof.sameKeyReplayAfterRejection.releaseBoundaryVerdict, 'LIVE_RELEASE_BOUNDARY_OK');
  assert.equal(
    releaseProof.sameKeyReplayAfterRejection.applyRevalidationDurableJournalVerdict,
    'LIVE_RELEASE_BOUNDARY_OK',
  );
  assert.equal(releaseProof.sameKeyReplayAfterRejection.applyStatus, 412);
  assert.equal(releaseProof.sameKeyReplayAfterRejection.applyApplied, 0);
  assert.equal(releaseProof.claimExpiryPolicy.proved, true);
  assert.equal(releaseProof.claimExpiryPolicy.previousClaimAgeMs, 7_000);
  assert.equal(releaseProof.claimExpiryPolicy.staleThresholdMs, claimStaleThresholdMs);
  assert.equal(releaseProof.claimExpiryPolicy.previousClaimExpired, true);
  assert.equal(releaseProof.manualRecoveryAuditExport.proved, true);
  assert.equal(releaseProof.manualRecoveryAuditExport.kind, 'manual-recovery-audit-export');
  assert.equal(releaseProof.manualRecoveryAuditExport.sourceUrl, 'http://127.0.0.1:8080');
  assert.equal(releaseProof.manualRecoveryAuditExport.targetEnvelope.hashOnly, true);
  assert.equal(releaseProof.manualRecoveryAuditExport.targetEnvelope.rawValuesIncluded, false);
  assert.equal(releaseProof.manualRecoveryAuditExport.sameReleaseBoundary, true);
  assertNoRawSiteValues(releaseProof, rawSiteValues);

  const recordCountBeforePriorWriterAttempt = readRecoveryJournal(filePath).records.length;
  const priorWriter = openRecoveryJournal(filePath, {
    truncate: false,
    now: new Date(fixedNow.getTime() + 7_500),
    claimId: activeClaimId,
    claimStaleThresholdMs,
  });
  try {
    assert.throws(
      () => priorWriter.appendEvent('apply-staged', {
        planId: plan.id,
        state: 'stale-writer-preparing-mutation-rows',
        observedHash: digest(remote),
        mutationCount: plan.mutations.length,
        artifactRefs,
      }),
      (error) => assertStaleClaimError(error, {
        staleClaimId: activeClaimId,
        activeClaimId: retryClaimId,
        activeClaimType: 'stale-claim-advanced',
        eventType: 'apply-staged',
        rawSiteValues,
      }),
    );
  } finally {
    priorWriter.close();
  }

  const afterPriorWriterAttempt = readRecoveryJournal(filePath);
  assert.equal(afterPriorWriterAttempt.records.length, recordCountBeforePriorWriterAttempt);
  assert.equal(recordsOfType(afterPriorWriterAttempt.records, 'apply-staged').length, 0);
  assert.equal(recordsOfType(afterPriorWriterAttempt.records, 'stale-claim-advanced').length, 1);
  assertNoMutationPreparationEvents(afterPriorWriterAttempt.records);
  assertRecordsHaveNoRawValues(afterPriorWriterAttempt.records, rawSiteValues);

  const retryReopen = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    now: new Date(fixedNow.getTime() + 8_000),
    truncate: false,
    claimId: retryClaimId,
    claimStaleThresholdMs,
  });
  const retryReopenInspection = retryReopen.inspect();
  retryReopen.close();

  const afterRetryReopen = readRecoveryJournal(filePath);
  assertProductionClaimSurface(retryReopenInspection, {
    claimId: retryClaimId,
    previousClaimId: activeClaimId,
    expectedStatus: 'advanced',
    staleClaimRejected: true,
    claimExpired: true,
    previousClaimAgeMs: 7_000,
    staleThresholdMs: claimStaleThresholdMs,
    rawSiteValues,
  });
  assert.equal(recordsOfType(afterRetryReopen.records, 'stale-claim-advanced').length, 1);
  assert.equal(recordsOfType(afterRetryReopen.records, 'stale-claim-rejected').length, 1);
  assert.equal(recordsOfType(afterRetryReopen.records, 'journal-ownership-recorded').length, 2);
  assertNoMutationPreparationEvents(afterRetryReopen.records);
  assertRecordsHaveNoRawValues(afterRetryReopen.records, rawSiteValues);
  assertNoRawSiteValues(fs.readFileSync(filePath, 'utf8'), rawSiteValues);
});
