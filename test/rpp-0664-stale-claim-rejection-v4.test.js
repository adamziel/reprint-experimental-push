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

const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;
const mutationEventTypes = new Set([
  'apply-staged',
  'apply-committed',
  'journal-completed',
  'mutation-applied',
  'mutation-observed',
]);

function tempJournalPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0664-stale-claim-'));
  return path.join(dir, 'recovery.jsonl');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite() {
  const files = {};
  for (let index = 1; index <= 5; index++) {
    files[`rpp-0664-file-${index}.txt`] = `rpp-0664-base-raw-site-value-${index}`;
  }
  return { files, plugins: {}, db: {} };
}

function localSite(base = baseSite()) {
  const site = cloneJson(base);
  for (let index = 1; index <= 5; index++) {
    site.files[`rpp-0664-file-${index}.txt`] = `rpp-0664-local-raw-site-value-${index}`;
  }
  return site;
}

function preservedRemoteSite(base = baseSite()) {
  const site = cloneJson(base);
  site.files['rpp-0664-file-2.txt'] = 'rpp-0664-preserved-remote-raw-site-value-2';
  site.files['rpp-0664-file-5.txt'] = 'rpp-0664-preserved-remote-raw-site-value-5';
  return site;
}

function buildScenario() {
  const base = baseSite();
  const local = localSite(base);
  const remote = cloneJson(base);
  const preservedRemote = preservedRemoteSite(base);
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
    preservedRemote,
    rawSiteValues: rawSiteValuesFor(base, local, remote, preservedRemote),
  };
}

function rawSiteValuesFor(...sites) {
  const values = new Set([
    'rpp-0664-base-raw-site-value',
    'rpp-0664-local-raw-site-value',
    'rpp-0664-preserved-remote-raw-site-value',
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
  const serialized = JSON.stringify(value);
  for (const rawValue of rawSiteValues) {
    assert.equal(
      serialized.includes(rawValue),
      false,
      `Unexpected raw site value in RPP-0664 evidence: ${rawValue}`,
    );
  }
}

function assertRecordsHaveNoRawValues(records, rawSiteValues) {
  for (const record of records) {
    assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(record));
  }
  assertNoRawSiteValues(records, rawSiteValues);
}

function assertNoMutationEvents(records) {
  assert.equal(records.some((record) => mutationEventTypes.has(record.type)), false);
}

function assertStaleClaimError(error, {
  staleClaimId,
  activeClaimId,
  activeClaimType,
  eventType,
  claimExpired,
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
  assertNoRawSiteValues(error.details, rawSiteValues);
  return true;
}

function assertLeaseOwnerAuditEvidence(inspection, {
  activeClaimId,
  staleClaimRejected,
  expectedClaimStatus,
  rawSiteValues,
}) {
  const activeClaimHash = recoveryClaimHash(activeClaimId);
  assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(inspection), true);
  assert.equal(inspection.claim.status, expectedClaimStatus);
  assert.equal(inspection.claim.activeClaimId, activeClaimId);
  assert.equal(inspection.claim.activeClaimHash, activeClaimHash);
  assert.equal(inspection.journal.claimId, activeClaimId);
  assert.equal(inspection.journal.claimHash, activeClaimHash);
  assert.equal(inspection.journal.staleClaimRejected, staleClaimRejected);
  assert.equal(inspection.journal.ownershipRecord.claimId, activeClaimId);
  assert.equal(inspection.journal.ownershipRecord.claimHash, activeClaimHash);
  assert.match(inspection.journal.ownershipRecord.journalIdentityHash, hashPattern);
  assert.equal(inspection.journal.writerLease.claimId, activeClaimId);
  assert.equal(inspection.journal.writerLease.claimHash, activeClaimHash);
  assert.equal(inspection.journal.writerLease.claimKeyHash, activeClaimHash);
  assert.equal(inspection.journal.writerLease.storageGuard, 'filesystem-compare-rename');
  assert.equal(inspection.journal.writerLease.staleClaimRejected, staleClaimRejected);
  assert.equal(inspection.journal.writerLease.restartReadable, true);
  assert.equal(inspection.journal.leaseFence.boundary, 'filesystem-compare-rename');
  assert.equal(inspection.journal.leaseFence.storageGuard, 'filesystem-compare-rename');
  assert.equal(inspection.journal.leaseFence.fsyncEvidence, true);
  assert.equal(inspection.journal.leaseFence.monotonicSequence, true);
  assert.equal(inspection.journal.leaseFence.restartReadable, true);
  assert.equal(inspection.journal.leaseFence.staleClaimRejected, staleClaimRejected);
  assert.equal(inspection.journal.leaseFence.writerLease.claimId, activeClaimId);
  assert.equal(inspection.journal.leaseFence.writerLease.claimHash, activeClaimHash);
  assert.deepEqual(inspection.leaseFence, inspection.journal.leaseFence);
  assert.deepEqual(inspection.leaseFence.writerLease, inspection.journal.writerLease);
  assertNoRawSiteValues(inspection, rawSiteValues);
}

function assertStaleRejectionAuditRecord(record, {
  plan,
  staleClaimId,
  activeClaimId,
  preservedRemote,
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
  assert.equal(record.observedHash, digest(preservedRemote));
  assert.match(record.observedHash, hashPattern);
  assert.equal(record.staleThresholdMs, 10_000);
  assert.equal(record.previousClaimAgeMs, 1_000);
  assert.equal(record.previousClaimOpenedAt, '2026-05-31T00:00:00.000Z');
  assert.equal(record.previousClaimExpiresAt, '2026-05-31T00:00:10.000Z');
  assert.equal(record.evaluatedAt, '2026-05-31T00:00:01.000Z');
  assert.equal(record.claimExpired, false);
  assert.deepEqual(record.artifactRefs, artifactRefs);
  assert.equal(record.fsync.requested, true);
  assert.equal(record.fsync.strategy, 'after-append');
  assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(record));
  assertNoRawSiteValues(record, rawSiteValues);
}

test('RPP-0664 stale claim rejection variant 4 exposes lease owner identity in audit evidence', () => {
  const filePath = tempJournalPath();
  const { plan, remote, preservedRemote, rawSiteValues } = buildScenario();
  const artifactRefs = {
    releaseProof: 'artifact://rpp-0664-stale-claim-rejection-v4',
    recoverySupport: 'artifact://rpp-0664-local-recovery-support',
  };
  const activeClaimId = 'rpp-0664-active-lease-owner';
  const staleClaimId = 'rpp-0664-rejected-stale-writer';
  const claimStaleThresholdMs = 10_000;

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

  assertLeaseOwnerAuditEvidence(activeInspection, {
    activeClaimId,
    staleClaimRejected: false,
    expectedClaimStatus: 'active',
    rawSiteValues,
  });

  const preservedRemoteBeforeRetry = cloneJson(preservedRemote);
  assert.throws(
    () => openProductionRecoveryJournal({
      filePath,
      plan,
      current: preservedRemote,
      artifactRefs,
      now: new Date(fixedNow.getTime() + 1_000),
      truncate: false,
      claimId: staleClaimId,
      claimStaleThresholdMs,
    }),
    (error) => assertStaleClaimError(error, {
      staleClaimId,
      activeClaimId,
      activeClaimType: 'recovery-claim-opened',
      eventType: 'recovery-claim-opened',
      claimExpired: false,
      rawSiteValues,
    }),
  );
  assert.deepEqual(preservedRemote, preservedRemoteBeforeRetry);

  const restarted = readRecoveryJournal(filePath);
  const claim = classifyRecoveryJournalClaims(restarted.records);
  const activeClaimRecord = recordsOfType(restarted.records, 'recovery-claim-opened')[0];
  const staleRejections = recordsOfType(restarted.records, 'stale-claim-rejected');
  const staleRejection = staleRejections[0];

  assert.equal(restarted.integrity.status, 'ok');
  assert.equal(claim.status, 'active');
  assert.equal(claim.activeClaimId, activeClaimId);
  assert.equal(claim.activeClaimHash, recoveryClaimHash(activeClaimId));
  assert.equal(activeClaimRecord.claimId, activeClaimId);
  assert.equal(staleRejections.length, 1);
  assert.ok(staleRejection.sequence > activeClaimRecord.sequence);
  assertStaleRejectionAuditRecord(staleRejection, {
    plan,
    staleClaimId,
    activeClaimId,
    preservedRemote,
    artifactRefs,
    rawSiteValues,
  });
  assert.equal(
    restarted.records.filter(
      (record) => record.type === 'recovery-claim-opened' && record.claimId === staleClaimId,
    ).length,
    0,
  );
  assertNoMutationEvents(restarted.records);
  assertRecordsHaveNoRawValues(restarted.records, rawSiteValues);
  assertNoRawSiteValues(fs.readFileSync(filePath, 'utf8'), rawSiteValues);

  const restartInspection = inspectRecoveryJournal({
    journal: restarted,
    plan,
    current: preservedRemote,
  });
  assert.equal(restartInspection.status, 'blocked-recovery');
  assert.deepEqual(restartInspection.counts, {
    old: 3,
    new: 0,
    blockedUnknown: 2,
  });
  assert.equal(restartInspection.claim.activeClaimId, activeClaimId);
  assertNoRawSiteValues(restartInspection, rawSiteValues);

  const activeRetry = openProductionRecoveryJournal({
    filePath,
    plan,
    current: preservedRemote,
    artifactRefs,
    now: new Date(fixedNow.getTime() + 3_000),
    truncate: false,
    claimId: activeClaimId,
    claimStaleThresholdMs,
  });
  const activeRetryInspection = activeRetry.inspect();
  activeRetry.close();

  assertLeaseOwnerAuditEvidence(activeRetryInspection, {
    activeClaimId,
    staleClaimRejected: true,
    expectedClaimStatus: 'advanced',
    rawSiteValues,
  });
  assert.equal(activeRetryInspection.claim.previousClaimId, null);

  const recordCountBeforeMutationAttempt = readRecoveryJournal(filePath).records.length;
  const staleWriter = openRecoveryJournal(filePath, {
    truncate: false,
    now: new Date(fixedNow.getTime() + 4_000),
    claimId: staleClaimId,
    claimStaleThresholdMs,
  });
  try {
    assert.throws(
      () => staleWriter.appendEvent('mutation-applied', {
        planId: plan.id,
        state: 'stale-writer-mutation-attempt',
        mutationId: plan.mutations[0].id,
        resourceKey: plan.mutations[0].resourceKey,
        observedHash: digest(preservedRemote),
        artifactRefs,
      }),
      (error) => assertStaleClaimError(error, {
        staleClaimId,
        activeClaimId,
        activeClaimType: 'recovery-claim-opened',
        eventType: 'mutation-applied',
        rawSiteValues,
      }),
    );
  } finally {
    staleWriter.close();
  }

  const afterStaleMutationAttempt = readRecoveryJournal(filePath);
  assert.equal(afterStaleMutationAttempt.records.length, recordCountBeforeMutationAttempt);
  assert.equal(recordsOfType(afterStaleMutationAttempt.records, 'stale-claim-rejected').length, 1);
  assertNoMutationEvents(afterStaleMutationAttempt.records);
  assertRecordsHaveNoRawValues(afterStaleMutationAttempt.records, rawSiteValues);
  assertNoRawSiteValues(fs.readFileSync(filePath, 'utf8'), rawSiteValues);
});
