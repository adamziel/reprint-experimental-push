import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { inspectRecoveryJournal } from '../src/recovery-inspect.js';
import {
  appendJournalCompleted,
  assertJournalRecordHasNoRawValues,
  openProductionRecoveryJournal,
  productionRecoveryJournalInspectionSurfaceIsPresent,
  readRecoveryJournal,
  recoveryClaimHash,
} from '../src/recovery-journal.js';
import { deserializeResourceValue, resourceHash, setResource } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import { buildDurableRecoveryJournalReleaseProof } from '../scripts/playground/production-shaped-live-release-verify-lib.js';

const fixedNow = new Date('2026-05-31T14:00:00.000Z');
const retryNow = new Date(fixedNow.getTime() + 7_000);
const finalizerNow = new Date(retryNow.getTime() + 1_000);
const sourceUrl = 'http://127.0.0.1:8080';
const checkedCommand = 'timeout 300s npm run verify:release';
const checkedRoute = '/wp-json/reprint/v1/push/recovery/inspect';
const claimStaleThresholdMs = 2_000;
const hashPattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const openEventTypes = new Set(['journal-opened', 'journal-retry-opened']);

const generatedMissingFinalizationCases = Object.freeze([
  {
    id: 'rpp-0699-missing-finalization-four-v5',
    mutationCount: 4,
  },
  {
    id: 'rpp-0699-missing-finalization-seven-v5',
    mutationCount: 7,
  },
]);

function tempJournalPath(prefix = 'reprint-rpp-0699-missing-finalization-v5-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return path.join(dir, 'recovery.jsonl');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function generatedSites(generatedCase) {
  const base = {
    files: {
      [`${generatedCase.id}-preserved.txt`]:
        `base-raw-rpp-0699-${generatedCase.id}-preserved`,
    },
    plugins: {},
    db: {},
  };

  for (let index = 1; index <= generatedCase.mutationCount; index++) {
    base.files[`${generatedCase.id}-target-${index}.txt`] =
      `base-raw-rpp-0699-${generatedCase.id}-target-${index}`;
  }

  const local = cloneJson(base);
  const remote = cloneJson(base);
  for (let index = 1; index <= generatedCase.mutationCount; index++) {
    local.files[`${generatedCase.id}-target-${index}.txt`] =
      `local-raw-rpp-0699-${generatedCase.id}-target-${index}`;
  }

  const plan = createPushPlan({
    base,
    local,
    remote,
    now: fixedNow,
  });
  assert.equal(plan.status, 'ready');
  assert.equal(plan.mutations.length, generatedCase.mutationCount);

  const expectedCommitted = cloneJson(remote);
  applyMutations(expectedCommitted, plan);

  return {
    plan,
    remote,
    expectedCommitted,
    rawSiteValues: rawSiteValuesFor(base, local, remote, expectedCommitted),
  };
}

function rawSiteValuesFor(...sites) {
  const values = new Set([
    'base-raw-rpp-0699',
    'local-raw-rpp-0699',
    'remote-raw-rpp-0699',
  ]);
  for (const site of sites) {
    for (const value of Object.values(site.files || {})) {
      values.add(value);
    }
  }
  return [...values];
}

function applyMutations(site, plan) {
  for (const mutation of plan.mutations) {
    setResource(site, mutation.resource, deserializeResourceValue(mutation.value));
  }
  return site;
}

function oldRemoteJournalForPlan(remote, plan) {
  return {
    schemaVersion: 1,
    id: `journal-${plan.id}`,
    planId: plan.id,
    status: 'opened',
    createdAt: plan.generatedAt,
    remoteBeforeHash: digest(remote),
    entries: plan.mutations.map((mutation) => ({
      mutationId: mutation.id,
      resource: cloneJson(mutation.resource),
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      status: 'pending',
      beforeHash: mutation.remoteBeforeHash || resourceHash(remote, mutation.resource),
      afterHash: digest(deserializeResourceValue(mutation.value)),
    })),
  };
}

function artifactRefsFor(generatedCase) {
  return {
    releaseProof: `artifact://rpp-0699/${generatedCase.id}/release-verifier-missing-finalization-v5`,
    recoverySupport: `artifact://rpp-0699/${generatedCase.id}/missing-commit-finalization-v5`,
    durabilityScope: `artifact://rpp-0699/${generatedCase.id}/sandbox-file-backed-only`,
  };
}

function activeClaimIdFor(generatedCase) {
  return `${generatedCase.id}-active-claim`;
}

function releaseVerifierClaimIdFor(generatedCase) {
  return `${generatedCase.id}-release-verifier-claim`;
}

function spawnMissingFinalizationWriter({
  filePath,
  plan,
  remote,
  artifactRefs,
  activeClaimId,
  releaseVerifierClaimId,
}) {
  const recoveryJournalModule = new URL('../src/recovery-journal.js', import.meta.url).href;
  const applyModule = new URL('../src/apply.js', import.meta.url).href;
  const childScript = `
    import { openProductionRecoveryJournal } from ${JSON.stringify(recoveryJournalModule)};
    import { applyPlan } from ${JSON.stringify(applyModule)};

    const plan = JSON.parse(process.env.RPP0699_PLAN);
    const remote = JSON.parse(process.env.RPP0699_REMOTE_SITE);
    const artifactRefs = JSON.parse(process.env.RPP0699_ARTIFACT_REFS);
    const claimStaleThresholdMs = Number(process.env.RPP0699_STALE_THRESHOLD_MS);
    let durableJournal = null;
    let output = null;
    let status = 0;

    try {
      const active = openProductionRecoveryJournal({
        filePath: process.env.RPP0699_JOURNAL_PATH,
        plan,
        current: remote,
        artifactRefs,
        now: new Date(process.env.RPP0699_FIXED_NOW),
        truncate: true,
        claimId: process.env.RPP0699_ACTIVE_CLAIM_ID,
        claimStaleThresholdMs,
      });
      active.close();

      durableJournal = openProductionRecoveryJournal({
        filePath: process.env.RPP0699_JOURNAL_PATH,
        plan,
        current: remote,
        artifactRefs,
        now: new Date(process.env.RPP0699_RETRY_NOW),
        truncate: false,
        claimId: process.env.RPP0699_RELEASE_VERIFIER_CLAIM_ID,
        claimStaleThresholdMs,
      });
      applyPlan(remote, plan, {
        durableJournal,
        journal: JSON.parse(process.env.RPP0699_PREVIOUS_JOURNAL),
        mutateRemote: true,
        artifactRefs,
        failDuringCommitAtMutation: plan.mutations.length,
      });
      console.error('expected injected missing commit finalization failure');
      status = 3;
    } catch (error) {
      if (error?.code !== 'INJECTED_FAILURE_DURING_COMMIT') {
        console.error(error?.stack || String(error));
        status = 2;
      } else {
        output = {
          errorCode: error.code,
          inspection: durableJournal.inspect(),
        };
      }
    } finally {
      if (durableJournal) {
        durableJournal.close();
      }
    }

    if (output) {
      console.log(JSON.stringify(output));
    }
    process.exit(status);
  `;

  return spawnSync(process.execPath, ['--input-type=module', '-e', childScript], {
    env: {
      ...process.env,
      RPP0699_ACTIVE_CLAIM_ID: activeClaimId,
      RPP0699_ARTIFACT_REFS: JSON.stringify(artifactRefs),
      RPP0699_FIXED_NOW: fixedNow.toISOString(),
      RPP0699_JOURNAL_PATH: filePath,
      RPP0699_PLAN: JSON.stringify(plan),
      RPP0699_PREVIOUS_JOURNAL: JSON.stringify(oldRemoteJournalForPlan(remote, plan)),
      RPP0699_RELEASE_VERIFIER_CLAIM_ID: releaseVerifierClaimId,
      RPP0699_REMOTE_SITE: JSON.stringify(remote),
      RPP0699_RETRY_NOW: retryNow.toISOString(),
      RPP0699_STALE_THRESHOLD_MS: String(claimStaleThresholdMs),
    },
    encoding: 'utf8',
  });
}

function parseChildOutput(child) {
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr || child.stdout);
  assert.equal(child.stdout.trim().length > 0, true);
  const output = JSON.parse(child.stdout);
  assert.equal(output.errorCode, 'INJECTED_FAILURE_DURING_COMMIT');
  return output.inspection;
}

function recordsOfType(records, type) {
  return records.filter((record) => record.type === type);
}

function openRecords(records) {
  return records.filter((record) => openEventTypes.has(record.type));
}

function expectedSequences(totalRecords) {
  return Array.from({ length: totalRecords }, (_, index) => index + 1);
}

function assertNoRawSiteValues(value, rawSiteValues, label = 'RPP-0699 evidence') {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const rawValue of rawSiteValues) {
    assert.equal(
      serialized.includes(rawValue),
      false,
      `${label} leaked raw site value: ${rawValue}`,
    );
  }
}

function assertHashOnlyJournalRows(records, rawSiteValues) {
  for (const record of records) {
    assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(record));
    assert.equal(Object.hasOwn(record, 'beforeValue'), false);
    assert.equal(Object.hasOwn(record, 'afterValue'), false);
    for (const field of [
      'observedHash',
      'beforeHash',
      'afterHash',
      'stagedHash',
      'claimHash',
      'claimKeyHash',
      'previousClaimHash',
      'previousClaimKeyHash',
      'journalIdentityHash',
    ]) {
      if (record[field] !== undefined && record[field] !== null) {
        assert.match(record[field], hashPattern, `${field} must be SHA-256-shaped`);
      }
    }
  }
  assertNoRawSiteValues(records, rawSiteValues, 'RPP-0699 journal rows');
}

function assertProductionLeaseOwnerAudit(inspection, {
  activeClaimId,
  releaseVerifierClaimId,
  rawSiteValues,
  expectedLeaseOwnerEventType,
}) {
  const claimHash = recoveryClaimHash(releaseVerifierClaimId);
  assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(inspection), true);
  assert.equal(inspection.claim.status, 'advanced');
  assert.equal(inspection.claim.activeClaimId, releaseVerifierClaimId);
  assert.equal(inspection.claim.activeClaimHash, claimHash);
  assert.equal(inspection.claim.activeClaimKeyHash, claimHash);
  assert.equal(inspection.claim.previousClaimId, activeClaimId);
  assert.equal(inspection.claim.previousClaimHash, recoveryClaimHash(activeClaimId));
  assert.equal(inspection.claim.previousClaimKeyHash, recoveryClaimHash(activeClaimId));
  assert.equal(inspection.claim.staleClaimRejected, true);
  assert.equal(inspection.claim.claimExpiry.policy, 'bounded-stale-claim-advance');
  assert.equal(inspection.claim.claimExpiry.expired, true);
  assert.equal(inspection.claim.claimExpiry.previousClaimExpired, true);
  assert.equal(inspection.claim.claimExpiry.previousClaimAgeMs, 7_000);
  assert.equal(inspection.claim.claimExpiry.staleThresholdMs, claimStaleThresholdMs);
  assert.equal(inspection.journal.claimId, releaseVerifierClaimId);
  assert.equal(inspection.journal.claimHash, claimHash);
  assert.equal(inspection.journal.writerLease.claimId, releaseVerifierClaimId);
  assert.equal(inspection.journal.writerLease.claimHash, claimHash);
  assert.equal(inspection.journal.writerLease.claimKeyHash, claimHash);
  assert.equal(inspection.journal.writerLease.restartReadable, true);
  assert.equal(inspection.journal.writerLease.staleClaimRejected, true);
  assert.equal(inspection.journal.writerLease.storageGuard, 'filesystem-compare-rename');
  assert.equal(inspection.journal.leaseFence.writerLease.claimId, releaseVerifierClaimId);
  assert.equal(inspection.journal.leaseFence.writerLease.claimHash, claimHash);
  assert.equal(inspection.journal.leaseFence.writerLease.claimKeyHash, claimHash);
  assert.equal(inspection.journal.leaseFence.restartReadable, true);
  assert.equal(inspection.journal.leaseFence.staleClaimRejected, true);
  assert.equal(inspection.journal.leaseFence.monotonicSequence, true);
  assert.equal(inspection.journal.leaseFence.fsyncEvidence, true);
  assert.deepEqual(inspection.leaseFence, inspection.journal.leaseFence);
  assert.deepEqual(inspection.leaseFence.writerLease, inspection.journal.writerLease);
  assert.equal(inspection.journal.committedState.leaseOwner.visible, true);
  assert.equal(inspection.journal.committedState.leaseOwner.claimId, releaseVerifierClaimId);
  assert.equal(inspection.journal.committedState.leaseOwner.claimHash, claimHash);
  assert.equal(inspection.journal.committedState.leaseOwner.claimKeyHash, claimHash);
  assert.equal(
    inspection.journal.committedState.leaseOwner.eventType,
    expectedLeaseOwnerEventType,
  );
  assertNoRawSiteValues(inspection, rawSiteValues, 'RPP-0699 production lease audit');
}

function assertMissingFinalizationState(journal, {
  plan,
  expectedCommitted,
  artifactRefs,
  activeClaimId,
  releaseVerifierClaimId,
  rawSiteValues,
}) {
  const mutationRecords = recordsOfType(journal.records, 'mutation-observed');
  const completedRecords = recordsOfType(journal.records, 'journal-completed');
  const recoveryStateRecords = recordsOfType(journal.records, 'recovery-state');
  const lastMutationRow = mutationRecords.at(-1);
  const latestMutation = plan.mutations.at(-1);
  const claimHash = recoveryClaimHash(releaseVerifierClaimId);

  assert.ok(lastMutationRow);
  assert.equal(journal.integrity.status, 'ok');
  assert.deepEqual(
    journal.records.map((record) => record.sequence),
    expectedSequences(journal.records.length),
  );
  assert.equal(openRecords(journal.records).length, 3);
  assert.equal(recordsOfType(journal.records, 'target-planned').length, plan.mutations.length);
  assert.equal(recordsOfType(journal.records, 'journal-ownership-recorded').length, 2);
  assert.equal(recordsOfType(journal.records, 'recovery-claim-opened').length, 1);
  assert.equal(recordsOfType(journal.records, 'stale-claim-advanced').length, 1);
  assert.equal(recordsOfType(journal.records, 'apply-staged').length, 1);
  assert.equal(recordsOfType(journal.records, 'dependencies-validated').length, 1);
  assert.equal(recordsOfType(journal.records, 'apply-committing').length, 1);
  assert.equal(recoveryStateRecords.length, 1);
  assert.equal(recoveryStateRecords[0].state, 'blocked-recovery');
  assert.equal(mutationRecords.length, plan.mutations.length);
  assert.equal(completedRecords.length, 0);
  assert.equal(recordsOfType(journal.records, 'recovery-claim-opened')[0].claimId, activeClaimId);
  assert.ok(mutationRecords.every((record) => record.claimId === releaseVerifierClaimId));
  assert.ok(mutationRecords.every((record) => record.claimHash === claimHash));
  assert.equal(lastMutationRow.mutationId, latestMutation.id);
  assert.equal(lastMutationRow.resourceKey, latestMutation.resourceKey);
  assert.equal(lastMutationRow.afterHash, resourceHash(expectedCommitted, latestMutation.resource));
  assert.equal(lastMutationRow.observedHash, lastMutationRow.afterHash);
  assert.deepEqual(journal.openState.artifactRefs, artifactRefs);
  assert.equal(journal.stagedState.restartReadable, true);
  assert.equal(journal.stagedState.stagedHash, digest(expectedCommitted));
  assert.equal(journal.committedState.status, 'committed');
  assert.equal(journal.committedState.phase, 'applied');
  assert.equal(journal.committedState.restartReadable, true);
  assert.equal(journal.committedState.committedRows, plan.mutations.length);
  assert.equal(journal.committedState.mutationRows, plan.mutations.length);
  assert.equal(journal.committedState.completedRows, 0);
  assert.equal(journal.committedState.targetRows, plan.mutations.length);
  assert.equal(journal.committedState.committedTargetRows, plan.mutations.length);
  assert.equal(journal.committedState.latestCommittedSequence, lastMutationRow.sequence);
  assert.equal(journal.committedState.latestCommittedType, 'mutation-observed');
  assert.equal(journal.committedState.latestMutationSequence, lastMutationRow.sequence);
  assert.equal(journal.committedState.latestCompletedSequence, null);
  assert.equal(journal.committedState.latestMutation.mutationId, latestMutation.id);
  assert.equal(journal.committedState.latestMutation.resourceKey, latestMutation.resourceKey);
  assert.deepEqual(journal.committedState.targetEnvelope, {
    plannedTargets: plan.mutations.length,
    committedTargets: plan.mutations.length,
    allCommittedTargetsHaveHashes: true,
    allTargetsCommitted: false,
  });
  assert.deepEqual(journal.committedState.leaseOwner, {
    visible: true,
    claimId: releaseVerifierClaimId,
    claimHash,
    claimKeyHash: claimHash,
    sequence: lastMutationRow.sequence,
    eventType: 'mutation-observed',
  });
  assert.ok(journal.records.every((record) => record.fsync.requested === true));
  assertHashOnlyJournalRows(journal.records, rawSiteValues);
}

function assertFinalizedState(journal, {
  beforeFinalization,
  plan,
  expectedCommitted,
  artifactRefs,
  releaseVerifierClaimId,
  completedRecord,
  rawSiteValues,
}) {
  const mutationRowsBefore = recordsOfType(beforeFinalization.records, 'mutation-observed');
  const mutationRowsAfter = recordsOfType(journal.records, 'mutation-observed');
  const completedRecords = recordsOfType(journal.records, 'journal-completed');
  const latestMutation = plan.mutations.at(-1);
  const claimHash = recoveryClaimHash(releaseVerifierClaimId);

  assert.equal(journal.integrity.status, 'ok');
  assert.deepEqual(
    journal.records.map((record) => record.sequence),
    expectedSequences(journal.records.length),
  );
  assert.deepEqual(
    mutationRowsAfter.map((record) => record.sequence),
    mutationRowsBefore.map((record) => record.sequence),
  );
  assert.equal(openRecords(journal.records).length, 4);
  assert.equal(mutationRowsAfter.length, plan.mutations.length);
  assert.equal(completedRecords.length, 1);
  assert.equal(completedRecords[0].sequence, completedRecord.sequence);
  assert.equal(completedRecords[0].claimId, releaseVerifierClaimId);
  assert.equal(completedRecords[0].claimHash, claimHash);
  assert.deepEqual(completedRecords[0].artifactRefs, artifactRefs);
  assert.equal(completedRecords[0].fsync.requested, true);
  assert.equal(completedRecords[0].fsync.strategy, 'after-append');
  assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(completedRecords[0]));
  assert.equal(recordsOfType(journal.records, 'target-planned').length, plan.mutations.length);
  assert.equal(recordsOfType(journal.records, 'journal-completed').length, 1);
  assert.equal(journal.committedState.status, 'completed');
  assert.equal(journal.committedState.phase, 'completed');
  assert.equal(journal.committedState.restartReadable, true);
  assert.equal(journal.committedState.committedRows, plan.mutations.length + 1);
  assert.equal(journal.committedState.mutationRows, plan.mutations.length);
  assert.equal(journal.committedState.completedRows, 1);
  assert.equal(journal.committedState.targetRows, plan.mutations.length);
  assert.equal(journal.committedState.committedTargetRows, plan.mutations.length);
  assert.equal(journal.committedState.latestCommittedSequence, completedRecord.sequence);
  assert.equal(journal.committedState.latestCommittedType, 'journal-completed');
  assert.equal(journal.committedState.latestMutationSequence, mutationRowsAfter.at(-1).sequence);
  assert.equal(journal.committedState.latestCompletedSequence, completedRecord.sequence);
  assert.equal(journal.committedState.latestMutation.mutationId, latestMutation.id);
  assert.equal(journal.committedState.latestMutation.resourceKey, latestMutation.resourceKey);
  assert.equal(journal.committedState.observedHash, digest(expectedCommitted));
  assert.deepEqual(journal.committedState.targetEnvelope, {
    plannedTargets: plan.mutations.length,
    committedTargets: plan.mutations.length,
    allCommittedTargetsHaveHashes: true,
    allTargetsCommitted: true,
  });
  assert.deepEqual(journal.committedState.leaseOwner, {
    visible: true,
    claimId: releaseVerifierClaimId,
    claimHash,
    claimKeyHash: claimHash,
    sequence: completedRecord.sequence,
    eventType: 'journal-completed',
  });
  assertHashOnlyJournalRows(journal.records, rawSiteValues);
}

function assertFullyUpdatedInspection(inspection, {
  plan,
  releaseVerifierClaimId,
  expectedLeaseOwnerEventType,
  rawSiteValues,
}) {
  assert.equal(inspection.status, 'fully-updated-remote');
  assert.deepEqual(inspection.counts, {
    old: 0,
    new: plan.mutations.length,
    blockedUnknown: 0,
  });
  assert.ok(inspection.targets.every((target) => target.state === 'new'));
  assert.equal(inspection.journal.committedState.restartReadable, true);
  assert.equal(inspection.journal.committedState.leaseOwner.visible, true);
  assert.equal(inspection.journal.committedState.leaseOwner.claimId, releaseVerifierClaimId);
  assert.equal(
    inspection.journal.committedState.leaseOwner.claimHash,
    recoveryClaimHash(releaseVerifierClaimId),
  );
  assert.equal(
    inspection.journal.committedState.leaseOwner.claimKeyHash,
    recoveryClaimHash(releaseVerifierClaimId),
  );
  assert.equal(
    inspection.journal.committedState.leaseOwner.eventType,
    expectedLeaseOwnerEventType,
  );
  assertNoRawSiteValues(inspection, rawSiteValues, 'RPP-0699 restart inspection');
}

function assertOldRemoteInspection(inspection, {
  plan,
  rawSiteValues,
}) {
  assert.equal(inspection.status, 'old-remote');
  assert.deepEqual(inspection.counts, {
    old: plan.mutations.length,
    new: 0,
    blockedUnknown: 0,
  });
  assert.equal(inspection.remoteClassification.state, 'old-remote');
  assert.ok(inspection.targets.every((target) => target.state === 'old'));
  assertNoRawSiteValues(inspection, rawSiteValues, 'RPP-0699 old-remote inspection');
}

function assertBlockedInspection(inspection, {
  plan,
  rawSiteValues,
}) {
  assert.equal(inspection.status, 'blocked-recovery');
  assert.equal(inspection.counts.old, 0);
  assert.equal(inspection.counts.new, plan.mutations.length - 1);
  assert.equal(inspection.counts.blockedUnknown, 1);
  assert.equal(inspection.remoteRecoveryClassification.kind, 'blocked-recovery');
  assert.equal(inspection.remoteRecoveryClassification.proved, false);
  assertNoRawSiteValues(inspection, rawSiteValues, 'RPP-0699 blocked inspection');
}

function leaseOwnerIdentityFor(leaseOwner) {
  return {
    visible: leaseOwner.visible === true,
    claimId: leaseOwner.claimId,
    claimHash: leaseOwner.claimHash,
    claimKeyHash: leaseOwner.claimKeyHash,
    sequence: leaseOwner.sequence,
    eventType: leaseOwner.eventType,
    leaseOwnerHash: digest(leaseOwner),
  };
}

function newRemoteRecoveryFromInspection({ inspection, plan, checkedPath }) {
  return {
    source: 'RPP-0699 release-verifier finalized missing-completion restart inspection',
    status: 200,
    state: inspection.status,
    observedState: inspection.remoteClassification.state,
    journalState: inspection.journal.integrity.status,
    checkedPath,
    restartReadable: inspection.journal.committedState.restartReadable,
    counts: {
      ...inspection.counts,
      total: plan.mutations.length,
    },
    targetEnvelope: {
      total: plan.mutations.length,
      old: inspection.counts.old,
      new: inspection.counts.new,
      blockedUnknown: inspection.counts.blockedUnknown,
      hashOnly: true,
      rawValuesIncluded: false,
      checkedPath,
      allTargetsAccountedFor: inspection.remoteClassification.allTargetsAccountedFor,
    },
    remoteRecoveryClassification: inspection.remoteRecoveryClassification,
  };
}

function oldRemoteRecoveryFromInspection({ inspection, plan, checkedPath }) {
  return {
    source: 'RPP-0699 release-verifier old remote classification from finalized journal',
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
      allTargetsAccountedFor: true,
    },
  };
}

function blockedRecoveryFromInspection({ inspection, plan, checkedPath }) {
  return {
    source: 'RPP-0699 release-verifier blocked classification for apply revalidation',
    status: 409,
    state: inspection.status,
    observedState: inspection.remoteClassification.state,
    reasonCode: inspection.reasonCode,
    counts: {
      ...inspection.counts,
      total: plan.mutations.length,
    },
    targetEnvelope: {
      total: plan.mutations.length,
      old: inspection.counts.old,
      new: inspection.counts.new,
      blockedUnknown: inspection.counts.blockedUnknown,
      hashOnly: true,
      rawValuesIncluded: false,
      checkedPath,
      allTargetsAccountedFor: true,
    },
  };
}

function missingFinalizationCarryThrough({
  beforeFinalization,
  finalized,
  completedRecord,
}) {
  const mutationRowsBefore = recordsOfType(beforeFinalization.records, 'mutation-observed');
  const mutationRowsAfter = recordsOfType(finalized.records, 'mutation-observed');
  const completedRowsBefore = recordsOfType(beforeFinalization.records, 'journal-completed');
  const completedRowsAfter = recordsOfType(finalized.records, 'journal-completed');

  return {
    proved: beforeFinalization.committedState.status === 'committed'
      && beforeFinalization.committedState.completedRows === 0
      && finalized.committedState.status === 'completed'
      && finalized.committedState.completedRows === 1
      && digest(mutationRowsBefore) === digest(mutationRowsAfter),
    mutationRowsBefore: mutationRowsBefore.length,
    mutationRowsAfter: mutationRowsAfter.length,
    mutationRowsPreserved: digest(mutationRowsBefore) === digest(mutationRowsAfter),
    completedRowsBefore: completedRowsBefore.length,
    completedRowsAfter: completedRowsAfter.length,
    finalizationAppended: completedRowsBefore.length === 0 && completedRowsAfter.length === 1,
    completedRecordHash: digest(completedRecord),
    beforeRowsHash: digest(beforeFinalization.records),
    finalizedRowsHash: digest(finalized.records),
    beforeTargetEnvelope: {
      ...beforeFinalization.committedState.targetEnvelope,
      hashOnly: true,
      rawValuesIncluded: false,
    },
    finalizedTargetEnvelope: {
      ...finalized.committedState.targetEnvelope,
      hashOnly: true,
      rawValuesIncluded: false,
    },
  };
}

function buildRecoveryReleaseSummary({
  productionInspection,
  plan,
  newRemoteRecovery,
  oldRemoteRecovery,
  missingFinalization,
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
      sourceUrl,
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
          ...newRemoteRecovery,
          missingCommitFinalization: missingFinalization,
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
          source: 'RPP-0699 different-body conflict recovery state',
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
          code: 'LAB_SIMULATED_STALE_CLAIM_MISSING_FINALIZATION',
          recovery: oldRemoteRecovery,
        },
      },
      replayAndRetry: {
        required: checkedPath,
        observed: checkedPath,
        retryAttempts: 2,
        verdict: 'PRESERVED_REMOTE_RETRY_PROVEN',
        missingCommitFinalization: {
          finalizationAppended: missingFinalization.finalizationAppended,
          mutationRowsPreserved: missingFinalization.mutationRowsPreserved,
          beforeRowsHash: missingFinalization.beforeRowsHash,
          finalizedRowsHash: missingFinalization.finalizedRowsHash,
        },
      },
    },
  };
}

function buildBlockedApplyRevalidation(blockedRecovery) {
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
      recovery: blockedRecovery,
    },
    dbJournal: {
      ordering: {
        ordered: true,
        applyRejected: 40,
        applyReplayed: 41,
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
  plan,
  newRemoteRecovery,
  oldRemoteRecovery,
  blockedRecovery,
  activeClaimId,
  releaseVerifierClaimId,
  checkedPath,
  rawSiteValues,
}) {
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
  assert.equal(proof.leaseOwnerIdentity.activeClaimId, releaseVerifierClaimId);
  assert.equal(
    proof.leaseOwnerIdentity.activeClaimKeyHash,
    recoveryClaimHash(releaseVerifierClaimId),
  );
  assert.equal(proof.leaseOwnerIdentity.writerLeaseClaimId, releaseVerifierClaimId);
  assert.equal(
    proof.leaseOwnerIdentity.writerLeaseClaimKeyHash,
    recoveryClaimHash(releaseVerifierClaimId),
  );
  assert.equal(proof.leaseOwnerIdentity.leaseFenceClaimId, releaseVerifierClaimId);
  assert.equal(
    proof.leaseOwnerIdentity.leaseFenceClaimKeyHash,
    recoveryClaimHash(releaseVerifierClaimId),
  );
  assert.equal(proof.leaseOwnerIdentity.matches, true);
  assert.equal(proof.staleOwnerFencing.activeClaimId, releaseVerifierClaimId);
  assert.equal(proof.staleOwnerFencing.previousClaimId, activeClaimId);
  assert.equal(proof.staleOwnerFencing.previousClaimKeyHash, recoveryClaimHash(activeClaimId));
  assert.equal(proof.staleOwnerFencing.leaseFenceStaleClaimRejected, true);
  assert.equal(proof.claimExpiryPolicy.proved, true);
  assert.equal(proof.claimExpiryPolicy.previousClaimAgeMs, 7_000);
  assert.equal(proof.claimExpiryPolicy.staleThresholdMs, claimStaleThresholdMs);
  assert.equal(proof.recoveryInspectAfterRestart.proved, true);
  assert.equal(proof.recoveryInspectAfterRestart.journalState, 'ok');
  assert.deepEqual(proof.recoveryInspectAfterRestart.counts, newRemoteRecovery.counts);
  assert.equal(proof.partialStates.new.proved, true);
  assert.equal(proof.partialStates.new.state, 'fully-updated-remote');
  assert.deepEqual(proof.partialStates.new.counts, newRemoteRecovery.counts);
  assert.equal(proof.partialStates.old.proved, true);
  assert.equal(proof.partialStates.old.source, oldRemoteRecovery.source);
  assert.deepEqual(proof.partialStates.old.counts, oldRemoteRecovery.counts);
  assert.equal(proof.partialStates.blocked.proved, true);
  assert.equal(proof.partialStates.blocked.state, 'blocked-recovery');
  assert.deepEqual(proof.partialStates.blocked.counts, blockedRecovery.counts);
  assert.equal(proof.sameKeyReplayAfterRejection.sameCheckedRecoveryPath, true);
  assert.equal(proof.sameKeyReplayAfterRejection.applyStatus, 412);
  assert.equal(proof.sameKeyReplayAfterRejection.applyApplied, 0);
  assert.equal(proof.sameKeyReplayAfterRejection.mutationAppliedBeforeFailure, 0);
  assert.equal(proof.sameKeyReplayAfterRejection.applyCommitted, false);
  assert.equal(proof.preservedRejectedRemoteEvidence.proved, true);
  assert.equal(proof.preservedRejectedRemoteEvidence.replayAndRetry.required, checkedPath);
  assert.equal(proof.preservedRejectedRemoteEvidence.replayAndRetry.observed, checkedPath);
  assert.equal(proof.manualRecoveryAuditExport.proved, true);
  assert.equal(proof.manualRecoveryAuditExport.kind, 'manual-recovery-audit-export');
  assert.equal(proof.manualRecoveryAuditExport.targetEnvelope.hashOnly, true);
  assert.equal(proof.manualRecoveryAuditExport.targetEnvelope.rawValuesIncluded, false);
  assertNoRawSiteValues(proof, rawSiteValues, 'RPP-0699 release verifier proof');
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0699 release verifier proof' }));
}

function releaseVerifierEvidenceFor({
  generatedCase,
  plan,
  beforeFinalization,
  finalized,
  completedRecord,
  writerInspection,
  finalizerInspection,
  releaseProof,
  checkedPath,
}) {
  const beforeLeaseOwner = beforeFinalization.committedState.leaseOwner;
  const finalizedLeaseOwner = finalized.committedState.leaseOwner;
  const missingFinalization = missingFinalizationCarryThrough({
    beforeFinalization,
    finalized,
    completedRecord,
  });
  const payload = {
    schemaVersion: 1,
    issue: 'RPP-0699',
    variant: 5,
    generatedCase: generatedCase.id,
    planId: plan.id,
    proofClass: 'missing-commit-finalization-release-verifier-carry-through-v5',
    evidenceScope: 'local-support-only',
    evidenceSource: 'release-verifier-missing-commit-finalization-v5',
    status: 'support_only',
    verdict: 'MISSING_COMMIT_FINALIZATION_LEASE_OWNER_VISIBLE_SUPPORT_ONLY',
    observedAt: finalizerNow.toISOString(),
    checkedCommand,
    checkedRoute,
    sourceUrlHash: digest(sourceUrl),
    checkedPathHash: digest({ checkedPath }),
    productionBacked: false,
    releaseEligible: false,
    releasePosture: 'NO-GO',
    rawValuesIncluded: false,
    hashOnly: true,
    plannedTargets: plan.mutations.length,
    missingCommitFinalization: missingFinalization,
    auditEvidence: {
      hashOnly: true,
      rawValuesIncluded: false,
      leaseOwnerIdentityVisible: beforeLeaseOwner.visible === true
        && finalizedLeaseOwner.visible === true
        && releaseProof.leaseOwnerIdentity.matches === true,
      missingFinalizationLeaseOwnerIdentity: leaseOwnerIdentityFor(beforeLeaseOwner),
      finalizedLeaseOwnerIdentity: leaseOwnerIdentityFor(finalizedLeaseOwner),
      writerLeaseIdentity: {
        claimId: finalizerInspection.journal.writerLease.claimId,
        claimHash: finalizerInspection.journal.writerLease.claimHash,
        claimKeyHash: finalizerInspection.journal.writerLease.claimKeyHash,
        restartReadable: finalizerInspection.journal.writerLease.restartReadable === true,
        staleClaimRejected: finalizerInspection.journal.writerLease.staleClaimRejected === true,
      },
      leaseFenceIdentity: {
        claimId: finalizerInspection.journal.leaseFence.writerLease.claimId,
        claimHash: finalizerInspection.journal.leaseFence.writerLease.claimHash,
        claimKeyHash: finalizerInspection.journal.leaseFence.writerLease.claimKeyHash,
        restartReadable: finalizerInspection.journal.leaseFence.restartReadable === true,
        staleClaimRejected: finalizerInspection.journal.leaseFence.staleClaimRejected === true,
      },
      productionInspectionSurface: productionRecoveryJournalInspectionSurfaceIsPresent(
        finalizerInspection,
      ),
      writerInspectionSurface: productionRecoveryJournalInspectionSurfaceIsPresent(
        writerInspection,
      ),
      journalRowsHash: digest(finalized.records),
    },
    releaseVerifier: {
      gate: releaseProof.gate,
      durableRecoveryJournalBoundary: releaseProof.durableRecoveryJournalBoundary,
      ok: releaseProof.ok,
      gateStatus: releaseProof.gateStatus,
      sameReleaseBoundary: releaseProof.sameReleaseBoundary,
      leaseOwnerIdentity: releaseProof.leaseOwnerIdentity,
      checks: {
        leaseOwnerIdentity: releaseProof.checks.leaseOwnerIdentity,
        staleOwnerFencing: releaseProof.checks.staleOwnerFencing,
        claimExpiryPolicy: releaseProof.checks.claimExpiryPolicy,
        recoveryInspectAfterRestart: releaseProof.checks.recoveryInspectAfterRestart,
        oldState: releaseProof.checks.oldState,
        newState: releaseProof.checks.newState,
        blockedState: releaseProof.checks.blockedState,
        manualRecoveryAuditExport: releaseProof.checks.manualRecoveryAuditExport,
      },
      manualRecoveryAuditExport: {
        proved: releaseProof.manualRecoveryAuditExport.proved,
        kind: releaseProof.manualRecoveryAuditExport.kind,
        targetEnvelope: releaseProof.manualRecoveryAuditExport.targetEnvelope,
      },
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: 'local support-only missing-finalization proof; production-backed durable journal evidence still required',
    },
    productionBackedDurableJournalProof: {
      proved: false,
      reasonCode: 'LOCAL_SANDBOX_ONLY',
      requiredBoundary: 'live-production-backed-durable-journal',
    },
  };

  return {
    ...payload,
    evidenceHash: `sha256:${digest(payload)}`,
  };
}

function assertReleaseVerifierEvidence(evidence, {
  plan,
  activeClaimId,
  releaseVerifierClaimId,
  rawSiteValues,
}) {
  const missing = evidence.missingCommitFinalization;
  const audit = evidence.auditEvidence;
  const missingLeaseOwner = audit.missingFinalizationLeaseOwnerIdentity;
  const finalizedLeaseOwner = audit.finalizedLeaseOwnerIdentity;

  assert.equal(evidence.issue, 'RPP-0699');
  assert.equal(evidence.variant, 5);
  assert.equal(evidence.proofClass, 'missing-commit-finalization-release-verifier-carry-through-v5');
  assert.equal(evidence.evidenceScope, 'local-support-only');
  assert.equal(evidence.status, 'support_only');
  assert.equal(evidence.productionBacked, false);
  assert.equal(evidence.releaseEligible, false);
  assert.equal(evidence.releasePosture, 'NO-GO');
  assert.equal(evidence.rawValuesIncluded, false);
  assert.equal(evidence.hashOnly, true);
  assert.equal(evidence.plannedTargets, plan.mutations.length);
  assert.match(evidence.sourceUrlHash, hashPattern);
  assert.match(evidence.checkedPathHash, hashPattern);
  assert.equal(missing.proved, true);
  assert.equal(missing.mutationRowsBefore, plan.mutations.length);
  assert.equal(missing.mutationRowsAfter, plan.mutations.length);
  assert.equal(missing.mutationRowsPreserved, true);
  assert.equal(missing.completedRowsBefore, 0);
  assert.equal(missing.completedRowsAfter, 1);
  assert.equal(missing.finalizationAppended, true);
  assert.match(missing.completedRecordHash, hashPattern);
  assert.match(missing.beforeRowsHash, hashPattern);
  assert.match(missing.finalizedRowsHash, hashPattern);
  assert.equal(missing.beforeTargetEnvelope.allTargetsCommitted, false);
  assert.equal(missing.beforeTargetEnvelope.hashOnly, true);
  assert.equal(missing.beforeTargetEnvelope.rawValuesIncluded, false);
  assert.equal(missing.finalizedTargetEnvelope.allTargetsCommitted, true);
  assert.equal(missing.finalizedTargetEnvelope.hashOnly, true);
  assert.equal(missing.finalizedTargetEnvelope.rawValuesIncluded, false);
  assert.equal(audit.hashOnly, true);
  assert.equal(audit.rawValuesIncluded, false);
  assert.equal(audit.leaseOwnerIdentityVisible, true);
  assert.equal(missingLeaseOwner.visible, true);
  assert.equal(missingLeaseOwner.claimId, releaseVerifierClaimId);
  assert.equal(missingLeaseOwner.claimHash, recoveryClaimHash(releaseVerifierClaimId));
  assert.equal(missingLeaseOwner.claimKeyHash, recoveryClaimHash(releaseVerifierClaimId));
  assert.equal(missingLeaseOwner.eventType, 'mutation-observed');
  assert.equal(Number.isInteger(missingLeaseOwner.sequence), true);
  assert.match(missingLeaseOwner.leaseOwnerHash, hashPattern);
  assert.equal(finalizedLeaseOwner.visible, true);
  assert.equal(finalizedLeaseOwner.claimId, releaseVerifierClaimId);
  assert.equal(finalizedLeaseOwner.claimHash, recoveryClaimHash(releaseVerifierClaimId));
  assert.equal(finalizedLeaseOwner.claimKeyHash, recoveryClaimHash(releaseVerifierClaimId));
  assert.equal(finalizedLeaseOwner.eventType, 'journal-completed');
  assert.equal(Number.isInteger(finalizedLeaseOwner.sequence), true);
  assert.match(finalizedLeaseOwner.leaseOwnerHash, hashPattern);
  assert.equal(audit.writerLeaseIdentity.claimId, releaseVerifierClaimId);
  assert.equal(audit.writerLeaseIdentity.claimHash, finalizedLeaseOwner.claimHash);
  assert.equal(audit.writerLeaseIdentity.claimKeyHash, finalizedLeaseOwner.claimKeyHash);
  assert.equal(audit.writerLeaseIdentity.restartReadable, true);
  assert.equal(audit.writerLeaseIdentity.staleClaimRejected, true);
  assert.equal(audit.leaseFenceIdentity.claimId, releaseVerifierClaimId);
  assert.equal(audit.leaseFenceIdentity.claimHash, finalizedLeaseOwner.claimHash);
  assert.equal(audit.leaseFenceIdentity.claimKeyHash, finalizedLeaseOwner.claimKeyHash);
  assert.equal(audit.leaseFenceIdentity.restartReadable, true);
  assert.equal(audit.leaseFenceIdentity.staleClaimRejected, true);
  assert.equal(audit.productionInspectionSurface, true);
  assert.equal(audit.writerInspectionSurface, true);
  assert.match(audit.journalRowsHash, hashPattern);
  assert.equal(evidence.releaseVerifier.gate, 'GATE-2');
  assert.equal(evidence.releaseVerifier.durableRecoveryJournalBoundary, 'release-verifier');
  assert.equal(evidence.releaseVerifier.ok, true);
  assert.equal(evidence.releaseVerifier.gateStatus, 'proven');
  assert.equal(evidence.releaseVerifier.sameReleaseBoundary, true);
  assert.equal(evidence.releaseVerifier.leaseOwnerIdentity.activeClaimId, releaseVerifierClaimId);
  assert.equal(
    evidence.releaseVerifier.leaseOwnerIdentity.activeClaimKeyHash,
    recoveryClaimHash(releaseVerifierClaimId),
  );
  assert.equal(evidence.releaseVerifier.leaseOwnerIdentity.matches, true);
  assert.equal(evidence.releaseVerifier.checks.leaseOwnerIdentity, true);
  assert.equal(evidence.releaseVerifier.checks.staleOwnerFencing, true);
  assert.equal(evidence.releaseVerifier.checks.claimExpiryPolicy, true);
  assert.equal(evidence.releaseVerifier.checks.recoveryInspectAfterRestart, true);
  assert.equal(evidence.releaseVerifier.checks.oldState, true);
  assert.equal(evidence.releaseVerifier.checks.newState, true);
  assert.equal(evidence.releaseVerifier.checks.blockedState, true);
  assert.equal(evidence.releaseVerifier.checks.manualRecoveryAuditExport, true);
  assert.equal(evidence.releaseVerifier.manualRecoveryAuditExport.proved, true);
  assert.equal(evidence.releaseVerifier.manualRecoveryAuditExport.targetEnvelope.hashOnly, true);
  assert.equal(
    evidence.releaseVerifier.manualRecoveryAuditExport.targetEnvelope.rawValuesIncluded,
    false,
  );
  assert.deepEqual(evidence.releaseMovement, {
    allowed: false,
    gates: '0/4',
    reason: 'local support-only missing-finalization proof; production-backed durable journal evidence still required',
  });
  assert.deepEqual(evidence.productionBackedDurableJournalProof, {
    proved: false,
    reasonCode: 'LOCAL_SANDBOX_ONLY',
    requiredBoundary: 'live-production-backed-durable-journal',
  });
  assert.match(evidence.evidenceHash, sha256EvidencePattern);
  assert.equal(evidence.releaseVerifier.leaseOwnerIdentity.activeClaimId, releaseVerifierClaimId);
  assert.notEqual(evidence.releaseVerifier.leaseOwnerIdentity.activeClaimId, activeClaimId);

  const { evidenceHash, ...payload } = evidence;
  assert.equal(evidenceHash, `sha256:${digest(payload)}`);
  assertNoRawSiteValues(evidence, rawSiteValues, 'RPP-0699 release verifier evidence');
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(evidence, { label: 'RPP-0699 release verifier evidence' }));
}

test('RPP-0699 missing commit finalization carries lease owner identity through release verifier variant 5', () => {
  for (const generatedCase of generatedMissingFinalizationCases) {
    const filePath = tempJournalPath();
    fs.chmodSync(path.dirname(filePath), 0o700);
    const {
      plan,
      remote,
      expectedCommitted,
      rawSiteValues,
    } = generatedSites(generatedCase);
    const artifactRefs = artifactRefsFor(generatedCase);
    const activeClaimId = activeClaimIdFor(generatedCase);
    const releaseVerifierClaimId = releaseVerifierClaimIdFor(generatedCase);

    const writer = spawnMissingFinalizationWriter({
      filePath,
      plan,
      remote,
      artifactRefs,
      activeClaimId,
      releaseVerifierClaimId,
    });
    const writerInspection = parseChildOutput(writer);

    assertProductionLeaseOwnerAudit(writerInspection, {
      activeClaimId,
      releaseVerifierClaimId,
      rawSiteValues,
      expectedLeaseOwnerEventType: 'mutation-observed',
    });

    const beforeFinalization = readRecoveryJournal(filePath);
    assertMissingFinalizationState(beforeFinalization, {
      plan,
      expectedCommitted,
      artifactRefs,
      activeClaimId,
      releaseVerifierClaimId,
      rawSiteValues,
    });
    assert.deepEqual(writerInspection.journal.committedState, beforeFinalization.committedState);
    assertNoRawSiteValues(
      fs.readFileSync(filePath, 'utf8'),
      rawSiteValues,
      'RPP-0699 pre-finalization journal file',
    );

    const beforeInspection = inspectRecoveryJournal({
      journal: beforeFinalization,
      plan,
      current: expectedCommitted,
    });
    assertFullyUpdatedInspection(beforeInspection, {
      plan,
      releaseVerifierClaimId,
      expectedLeaseOwnerEventType: 'mutation-observed',
      rawSiteValues,
    });

    const finalizer = openProductionRecoveryJournal({
      filePath,
      plan,
      current: expectedCommitted,
      artifactRefs,
      now: finalizerNow,
      truncate: false,
      claimId: releaseVerifierClaimId,
      claimStaleThresholdMs,
    });
    const preAppendFinalizerInspection = finalizer.inspect();
    assertProductionLeaseOwnerAudit(preAppendFinalizerInspection, {
      activeClaimId,
      releaseVerifierClaimId,
      rawSiteValues,
      expectedLeaseOwnerEventType: 'mutation-observed',
    });

    const completedRecord = appendJournalCompleted(finalizer, {
      plan,
      current: expectedCommitted,
      artifactRefs,
    });
    const finalizerInspection = finalizer.inspect();
    finalizer.close();

    assertProductionLeaseOwnerAudit(finalizerInspection, {
      activeClaimId,
      releaseVerifierClaimId,
      rawSiteValues,
      expectedLeaseOwnerEventType: 'journal-completed',
    });

    const finalized = readRecoveryJournal(filePath);
    assertFinalizedState(finalized, {
      beforeFinalization,
      plan,
      expectedCommitted,
      artifactRefs,
      releaseVerifierClaimId,
      completedRecord,
      rawSiteValues,
    });
    assert.deepEqual(finalizerInspection.journal.committedState, finalized.committedState);
    assertNoRawSiteValues(
      fs.readFileSync(filePath, 'utf8'),
      rawSiteValues,
      'RPP-0699 finalized journal file',
    );

    const finalizedInspection = inspectRecoveryJournal({
      journal: finalized,
      plan,
      current: expectedCommitted,
    });
    assertFullyUpdatedInspection(finalizedInspection, {
      plan,
      releaseVerifierClaimId,
      expectedLeaseOwnerEventType: 'journal-completed',
      rawSiteValues,
    });

    const oldRemoteInspection = inspectRecoveryJournal({
      journal: finalized,
      plan,
      current: remote,
    });
    assertOldRemoteInspection(oldRemoteInspection, { plan, rawSiteValues });

    const driftedCurrent = cloneJson(expectedCommitted);
    const driftedValue =
      `remote-raw-rpp-0699-${generatedCase.id}-release-verifier-outside-envelope`;
    setResource(
      driftedCurrent,
      plan.mutations[0].resource,
      driftedValue,
    );
    const rawValuesWithDrift = [...rawSiteValues, driftedValue];
    const blockedInspection = inspectRecoveryJournal({
      journal: finalized,
      plan,
      current: driftedCurrent,
    });
    assertBlockedInspection(blockedInspection, { plan, rawSiteValues: rawValuesWithDrift });

    const checkedPath = finalizerInspection.journal.checked[0];
    assert.equal(checkedPath, filePath);
    const missingFinalization = missingFinalizationCarryThrough({
      beforeFinalization,
      finalized,
      completedRecord,
    });
    const newRemoteRecovery = newRemoteRecoveryFromInspection({
      inspection: finalizedInspection,
      plan,
      checkedPath,
    });
    const oldRemoteRecovery = oldRemoteRecoveryFromInspection({
      inspection: oldRemoteInspection,
      plan,
      checkedPath,
    });
    const blockedRecovery = blockedRecoveryFromInspection({
      inspection: blockedInspection,
      plan,
      checkedPath,
    });
    const releaseSummary = buildRecoveryReleaseSummary({
      productionInspection: finalizerInspection,
      plan,
      newRemoteRecovery,
      oldRemoteRecovery,
      missingFinalization,
    });
    const releaseProof = buildDurableRecoveryJournalReleaseProof({
      releaseSummary,
      applyRevalidation: buildBlockedApplyRevalidation(blockedRecovery),
    });

    assert.equal(
      releaseSummary.releaseProof.recoveryInspect.recovery.missingCommitFinalization.finalizationAppended,
      true,
    );
    assert.equal(
      releaseSummary.releaseProof.recoveryInspect.recovery.missingCommitFinalization.mutationRowsPreserved,
      true,
    );
    assert.equal(releaseSummary.releaseProof.replayAndRetry.required, checkedPath);
    assert.equal(releaseSummary.releaseProof.replayAndRetry.observed, checkedPath);
    assert.equal(
      releaseSummary.releaseProof.replayAndRetry.missingCommitFinalization.finalizationAppended,
      true,
    );
    assertReleaseVerifierProof(releaseProof, {
      plan,
      newRemoteRecovery,
      oldRemoteRecovery,
      blockedRecovery,
      activeClaimId,
      releaseVerifierClaimId,
      checkedPath,
      rawSiteValues: rawValuesWithDrift,
    });

    const evidence = releaseVerifierEvidenceFor({
      generatedCase,
      plan,
      beforeFinalization,
      finalized,
      completedRecord,
      writerInspection,
      finalizerInspection,
      releaseProof,
      checkedPath,
    });
    assertReleaseVerifierEvidence(evidence, {
      plan,
      activeClaimId,
      releaseVerifierClaimId,
      rawSiteValues: rawValuesWithDrift,
    });
    assertNoRawSiteValues(releaseSummary, rawValuesWithDrift, 'RPP-0699 release summary');
  }
});
