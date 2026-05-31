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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0643-lease-'));
  return path.join(dir, 'recovery.jsonl');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite() {
  const files = {};
  for (let index = 1; index <= 5; index++) {
    files[`rpp-0643-file-${index}.txt`] = `rpp-0643-base-raw-site-value-${index}`;
  }
  return { files, plugins: {}, db: {} };
}

function localSite(base = baseSite()) {
  const site = cloneJson(base);
  for (let index = 1; index <= 5; index++) {
    site.files[`rpp-0643-file-${index}.txt`] = `rpp-0643-local-raw-site-value-${index}`;
  }
  return site;
}

function preservedRemoteSite(base = baseSite()) {
  const site = cloneJson(base);
  site.files['rpp-0643-file-1.txt'] = 'rpp-0643-preserved-remote-raw-site-value-1';
  site.files['rpp-0643-file-3.txt'] = 'rpp-0643-preserved-remote-raw-site-value-3';
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
    'rpp-0643-base-raw-site-value',
    'rpp-0643-local-raw-site-value',
    'rpp-0643-preserved-remote-raw-site-value',
  ]);
  for (const site of sites) {
    for (const value of Object.values(site.files || {})) {
      values.add(value);
    }
  }
  return [...values];
}

function assertNoRawSiteValues(value, rawSiteValues) {
  const serialized = JSON.stringify(value);
  for (const rawValue of rawSiteValues) {
    assert.equal(
      serialized.includes(rawValue),
      false,
      `Unexpected raw site value in RPP-0643 evidence: ${rawValue}`,
    );
  }
}

function assertRecordsHaveNoRawValues(records, rawSiteValues) {
  for (const record of records) {
    assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(record));
  }
  assertNoRawSiteValues(records, rawSiteValues);
}

function recordsOfType(records, type) {
  return records.filter((record) => record.type === type);
}

function assertNoMutationEvents(records) {
  assert.equal(records.some((record) => mutationEventTypes.has(record.type)), false);
}

function assertWriterLeaseContract(writerLease, {
  claimId,
  staleClaimRejected,
  claimExpired = null,
}) {
  assert.equal(writerLease.strategy, 'claim-fenced-single-writer');
  assert.equal(writerLease.claimId, claimId);
  assert.equal(writerLease.claimHash, recoveryClaimHash(claimId));
  assert.equal(writerLease.claimKeyHash, recoveryClaimHash(claimId));
  assert.equal(writerLease.claimKeyUnique, true);
  assert.equal(writerLease.fsyncEvidence, true);
  assert.equal(writerLease.storageGuard, 'filesystem-compare-rename');
  assert.equal(writerLease.monotonicSequence, true);
  assert.equal(writerLease.restartReadable, true);
  assert.equal(writerLease.staleClaimRejected, staleClaimRejected);
  assert.match(writerLease.claimHash, hashPattern);
  if (claimExpired !== null) {
    assert.equal(writerLease.claimExpiry.expired, claimExpired);
  }
}

function assertLeaseFenceContract(leaseFence, {
  claimId,
  staleClaimRejected,
  claimExpired = null,
}) {
  assert.equal(leaseFence.boundary, 'filesystem-compare-rename');
  assert.equal(leaseFence.storageGuard, 'filesystem-compare-rename');
  assert.equal(leaseFence.claimKeyUnique, true);
  assert.equal(leaseFence.fsyncEvidence, true);
  assert.equal(leaseFence.monotonicSequence, true);
  assert.equal(leaseFence.restartReadable, true);
  assert.equal(leaseFence.staleClaimRejected, staleClaimRejected);
  assertWriterLeaseContract(leaseFence.writerLease, {
    claimId,
    staleClaimRejected,
    claimExpired,
  });
}

function assertStaleClaimError(error, {
  staleClaimId,
  activeClaimId,
  activeClaimType,
  claimExpired,
}) {
  assert.ok(error instanceof RecoveryJournalClaimStaleError);
  assert.equal(error.code, 'RECOVERY_CLAIM_STALE');
  assert.equal(error.details.staleClaimId, staleClaimId);
  assert.equal(error.details.staleClaimHash, recoveryClaimHash(staleClaimId));
  assert.equal(error.details.activeClaimId, activeClaimId);
  assert.equal(error.details.activeClaimHash, recoveryClaimHash(activeClaimId));
  assert.equal(error.details.activeClaimType, activeClaimType);
  if (claimExpired !== undefined) {
    assert.equal(error.details.claimExpired, claimExpired);
  }
  assertNoRawSiteValues(error.details, [
    'rpp-0643-base-raw-site-value',
    'rpp-0643-local-raw-site-value',
    'rpp-0643-preserved-remote-raw-site-value',
  ]);
  return true;
}

function assertBlockedPreservedRemoteInspection({
  journal,
  plan,
  preservedRemote,
  rawSiteValues,
}) {
  const inspection = inspectRecoveryJournal({
    journal,
    plan,
    current: preservedRemote,
  });

  assert.equal(inspection.status, 'blocked-recovery');
  assert.deepEqual(inspection.counts, {
    old: 3,
    new: 0,
    blockedUnknown: 2,
  });
  assertNoRawSiteValues(inspection, rawSiteValues);
}

test('RPP-0643 competing single-writer lease claim fails closed after restart without raw payloads', () => {
  const filePath = tempJournalPath();
  const { plan, remote, preservedRemote, rawSiteValues } = buildScenario();
  const artifactRefs = {
    releaseProof: 'artifact://rpp-0643-single-writer-lease-claim-v3',
    recoverySupport: 'artifact://rpp-0643-local-recovery-support',
  };
  const activeClaimId = 'rpp-0643-active-single-writer';
  const staleClaimId = 'rpp-0643-competing-single-writer';
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
  const initialInspection = active.inspect();
  active.close();

  assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(initialInspection), true);
  assertWriterLeaseContract(initialInspection.journal.writerLease, {
    claimId: activeClaimId,
    staleClaimRejected: false,
    claimExpired: false,
  });
  assertLeaseFenceContract(initialInspection.leaseFence, {
    claimId: activeClaimId,
    staleClaimRejected: false,
    claimExpired: false,
  });
  assertNoRawSiteValues(initialInspection, rawSiteValues);

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
      claimExpired: false,
    }),
  );
  assert.deepEqual(preservedRemote, preservedRemoteBeforeRetry);

  const restarted = readRecoveryJournal(filePath);
  const claim = classifyRecoveryJournalClaims(restarted.records);
  const staleRejections = recordsOfType(restarted.records, 'stale-claim-rejected');
  const staleRejection = staleRejections[0];

  assert.equal(restarted.integrity.status, 'ok');
  assert.equal(claim.status, 'active');
  assert.equal(claim.activeClaimId, activeClaimId);
  assert.equal(claim.activeClaimHash, recoveryClaimHash(activeClaimId));
  assert.equal(staleRejections.length, 1);
  assert.equal(staleRejection.claimId, staleClaimId);
  assert.equal(staleRejection.claimHash, recoveryClaimHash(staleClaimId));
  assert.equal(staleRejection.previousClaimId, activeClaimId);
  assert.equal(staleRejection.previousClaimHash, recoveryClaimHash(activeClaimId));
  assert.equal(staleRejection.claimExpired, false);
  assert.equal(staleRejection.observedHash, digest(preservedRemote));
  assert.match(staleRejection.observedHash, hashPattern);
  assert.equal(
    restarted.records.filter(
      (record) => record.type === 'recovery-claim-opened' && record.claimId === staleClaimId,
    ).length,
    0,
  );
  assertNoMutationEvents(restarted.records);
  assertRecordsHaveNoRawValues(restarted.records, rawSiteValues);
  assertBlockedPreservedRemoteInspection({
    journal: restarted,
    plan,
    preservedRemote,
    rawSiteValues,
  });

  const recordCountBeforeAppendAttempt = readRecoveryJournal(filePath).records.length;
  const staleWriter = openRecoveryJournal(filePath, {
    truncate: false,
    now: new Date(fixedNow.getTime() + 2_000),
    claimId: staleClaimId,
    claimStaleThresholdMs,
  });
  try {
    assert.throws(
      () => staleWriter.appendEvent('journal-retry-opened', {
        planId: plan.id,
        state: 'retrying-stale-claim',
        observedHash: digest(preservedRemote),
        artifactRefs,
      }),
      (error) => assertStaleClaimError(error, {
        staleClaimId,
        activeClaimId,
        activeClaimType: 'recovery-claim-opened',
      }),
    );
  } finally {
    staleWriter.close();
  }
  assert.equal(readRecoveryJournal(filePath).records.length, recordCountBeforeAppendAttempt);

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

  assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(activeRetryInspection), true);
  assert.equal(activeRetryInspection.claim.activeClaimId, activeClaimId);
  assert.equal(activeRetryInspection.claim.claimExpiry.expired, false);
  assertWriterLeaseContract(activeRetryInspection.journal.writerLease, {
    claimId: activeClaimId,
    staleClaimRejected: true,
    claimExpired: false,
  });
  assertLeaseFenceContract(activeRetryInspection.leaseFence, {
    claimId: activeClaimId,
    staleClaimRejected: true,
    claimExpired: false,
  });
  assert.deepEqual(activeRetryInspection.leaseFence.writerLease, activeRetryInspection.journal.writerLease);
  assertRecordsHaveNoRawValues(readRecoveryJournal(filePath).records, rawSiteValues);
  assertNoRawSiteValues(activeRetryInspection, rawSiteValues);
});

test('RPP-0643 expired single-writer lease advances one restart-readable claim and fences the prior writer', () => {
  const filePath = tempJournalPath();
  const { plan, remote, preservedRemote, rawSiteValues } = buildScenario();
  const artifactRefs = {
    releaseProof: 'artifact://rpp-0643-expired-single-writer-lease-claim-v3',
    recoverySupport: 'artifact://rpp-0643-local-expired-lease-support',
  };
  const activeClaimId = 'rpp-0643-expired-lease-active';
  const retryClaimId = 'rpp-0643-expired-lease-retry';
  const claimStaleThresholdMs = 1_000;

  const active = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    now: fixedNow,
    claimId: activeClaimId,
    claimStaleThresholdMs,
  });
  active.close();

  const preservedRemoteBeforeRetry = cloneJson(preservedRemote);
  const retry = openProductionRecoveryJournal({
    filePath,
    plan,
    current: preservedRemote,
    artifactRefs,
    now: new Date(fixedNow.getTime() + 5_000),
    truncate: false,
    claimId: retryClaimId,
    claimStaleThresholdMs,
  });
  const retryInspection = retry.inspect();
  retry.close();
  assert.deepEqual(preservedRemote, preservedRemoteBeforeRetry);

  assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(retryInspection), true);
  assert.equal(retryInspection.claim.status, 'advanced');
  assert.equal(retryInspection.claim.activeClaimId, retryClaimId);
  assert.equal(retryInspection.claim.activeClaimHash, recoveryClaimHash(retryClaimId));
  assert.equal(retryInspection.claim.previousClaimId, activeClaimId);
  assert.equal(retryInspection.claim.previousClaimHash, recoveryClaimHash(activeClaimId));
  assert.equal(retryInspection.claim.claimExpiry.expired, true);
  assert.equal(retryInspection.claim.claimExpiry.previousClaimExpired, true);
  assert.equal(retryInspection.claim.previousClaimAgeMs, 5_000);
  assertWriterLeaseContract(retryInspection.journal.writerLease, {
    claimId: retryClaimId,
    staleClaimRejected: true,
    claimExpired: true,
  });
  assertLeaseFenceContract(retryInspection.leaseFence, {
    claimId: retryClaimId,
    staleClaimRejected: true,
    claimExpired: true,
  });
  assert.equal(retryInspection.journal.ownershipRecord.claimId, retryClaimId);
  assert.equal(retryInspection.journal.ownershipRecord.claimHash, recoveryClaimHash(retryClaimId));
  assertNoRawSiteValues(retryInspection, rawSiteValues);

  const restarted = readRecoveryJournal(filePath);
  const advancedRecords = recordsOfType(restarted.records, 'stale-claim-advanced');
  const advancedRecord = advancedRecords[0];
  const ownershipRecords = recordsOfType(restarted.records, 'journal-ownership-recorded');

  assert.equal(restarted.integrity.status, 'ok');
  assert.equal(advancedRecords.length, 1);
  assert.equal(advancedRecord.claimId, retryClaimId);
  assert.equal(advancedRecord.claimHash, recoveryClaimHash(retryClaimId));
  assert.equal(advancedRecord.previousClaimId, activeClaimId);
  assert.equal(advancedRecord.previousClaimHash, recoveryClaimHash(activeClaimId));
  assert.equal(advancedRecord.previousClaimAgeMs, 5_000);
  assert.equal(advancedRecord.claimExpired, true);
  assert.equal(advancedRecord.observedHash, digest(preservedRemote));
  assert.match(advancedRecord.observedHash, hashPattern);
  assert.equal(ownershipRecords.length, 2);
  assert.deepEqual(
    ownershipRecords.map((record) => record.claimId).sort(),
    [activeClaimId, retryClaimId].sort(),
  );
  assertNoMutationEvents(restarted.records);
  assertRecordsHaveNoRawValues(restarted.records, rawSiteValues);
  assertBlockedPreservedRemoteInspection({
    journal: restarted,
    plan,
    preservedRemote,
    rawSiteValues,
  });

  const recordCountBeforePriorWriterAttempt = readRecoveryJournal(filePath).records.length;
  const priorWriter = openRecoveryJournal(filePath, {
    truncate: false,
    now: new Date(fixedNow.getTime() + 5_500),
    claimId: activeClaimId,
    claimStaleThresholdMs,
  });
  try {
    assert.throws(
      () => priorWriter.appendEvent('journal-retry-opened', {
        planId: plan.id,
        state: 'retrying-superseded-claim',
        observedHash: digest(preservedRemote),
        artifactRefs,
      }),
      (error) => assertStaleClaimError(error, {
        staleClaimId: activeClaimId,
        activeClaimId: retryClaimId,
        activeClaimType: 'stale-claim-advanced',
        claimExpired: undefined,
      }),
    );
  } finally {
    priorWriter.close();
  }
  assert.equal(readRecoveryJournal(filePath).records.length, recordCountBeforePriorWriterAttempt);
  assertRecordsHaveNoRawValues(readRecoveryJournal(filePath).records, rawSiteValues);
});
