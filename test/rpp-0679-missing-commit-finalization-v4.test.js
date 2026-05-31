import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

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

const fixedNow = new Date('2026-05-31T12:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;
const openEventTypes = new Set(['journal-opened', 'journal-retry-opened']);

const generatedMissingFinalizationCases = Object.freeze([
  {
    id: 'rpp-0679-missing-finalization-three-v4',
    mutationCount: 3,
  },
  {
    id: 'rpp-0679-missing-finalization-six-v4',
    mutationCount: 6,
  },
]);

function tempJournalPath(prefix = 'reprint-rpp-0679-missing-finalization-') {
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
        `base-raw-rpp-0679-${generatedCase.id}-preserved`,
    },
    plugins: {},
    db: {},
  };

  for (let index = 1; index <= generatedCase.mutationCount; index++) {
    base.files[`${generatedCase.id}-target-${index}.txt`] =
      `base-raw-rpp-0679-${generatedCase.id}-target-${index}`;
  }

  const local = cloneJson(base);
  const remote = cloneJson(base);
  for (let index = 1; index <= generatedCase.mutationCount; index++) {
    local.files[`${generatedCase.id}-target-${index}.txt`] =
      `local-raw-rpp-0679-${generatedCase.id}-target-${index}`;
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
    'base-raw-rpp-0679',
    'local-raw-rpp-0679',
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
    releaseProof: `artifact://rpp-0679/${generatedCase.id}/local-release-proof-not-production-durable`,
    recoverySupport: `artifact://rpp-0679/${generatedCase.id}/missing-commit-finalization-v4`,
    durabilityScope: `artifact://rpp-0679/${generatedCase.id}/sandbox-file-backed-only`,
  };
}

function claimIdFor(generatedCase) {
  return `${generatedCase.id}-claim`;
}

function spawnMissingFinalizationWriter({
  filePath,
  plan,
  remote,
  artifactRefs,
  claimId,
  now,
}) {
  const recoveryJournalModule = new URL('../src/recovery-journal.js', import.meta.url).href;
  const applyModule = new URL('../src/apply.js', import.meta.url).href;
  const childScript = `
    import { openProductionRecoveryJournal } from ${JSON.stringify(recoveryJournalModule)};
    import { applyPlan } from ${JSON.stringify(applyModule)};

    const plan = JSON.parse(process.env.RPP0679_PLAN);
    const remote = JSON.parse(process.env.RPP0679_REMOTE_SITE);
    const artifactRefs = JSON.parse(process.env.RPP0679_ARTIFACT_REFS);
    let durableJournal = null;
    let output = null;
    let status = 0;

    try {
      durableJournal = openProductionRecoveryJournal({
        filePath: process.env.RPP0679_JOURNAL_PATH,
        plan,
        current: remote,
        artifactRefs,
        now: new Date(process.env.RPP0679_NOW),
        truncate: true,
        claimId: process.env.RPP0679_CLAIM_ID,
      });
      applyPlan(remote, plan, {
        durableJournal,
        journal: JSON.parse(process.env.RPP0679_PREVIOUS_JOURNAL),
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
      RPP0679_ARTIFACT_REFS: JSON.stringify(artifactRefs),
      RPP0679_CLAIM_ID: claimId,
      RPP0679_JOURNAL_PATH: filePath,
      RPP0679_NOW: now.toISOString(),
      RPP0679_PLAN: JSON.stringify(plan),
      RPP0679_PREVIOUS_JOURNAL: JSON.stringify(oldRemoteJournalForPlan(remote, plan)),
      RPP0679_REMOTE_SITE: JSON.stringify(remote),
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

function assertNoRawSiteValues(value, rawSiteValues, label = 'RPP-0679 evidence') {
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
      'previousClaimHash',
      'journalIdentityHash',
    ]) {
      if (record[field] !== undefined && record[field] !== null) {
        assert.match(record[field], hashPattern, `${field} must be SHA-256-shaped`);
      }
    }
  }
  assertNoRawSiteValues(records, rawSiteValues, 'RPP-0679 journal rows');
}

function assertProductionLeaseOwnerAudit(inspection, {
  claimId,
  rawSiteValues,
  expectedLeaseOwnerEventType,
}) {
  const claimHash = recoveryClaimHash(claimId);
  assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(inspection), true);
  assert.equal(inspection.claim.status, 'active');
  assert.equal(inspection.claim.activeClaimId, claimId);
  assert.equal(inspection.claim.activeClaimHash, claimHash);
  assert.equal(inspection.journal.claimId, claimId);
  assert.equal(inspection.journal.claimHash, claimHash);
  assert.equal(inspection.journal.writerLease.claimId, claimId);
  assert.equal(inspection.journal.writerLease.claimHash, claimHash);
  assert.equal(inspection.journal.writerLease.claimKeyHash, claimHash);
  assert.equal(inspection.journal.writerLease.restartReadable, true);
  assert.equal(inspection.journal.writerLease.storageGuard, 'filesystem-compare-rename');
  assert.equal(inspection.journal.leaseFence.writerLease.claimId, claimId);
  assert.equal(inspection.journal.leaseFence.writerLease.claimHash, claimHash);
  assert.equal(inspection.journal.leaseFence.writerLease.claimKeyHash, claimHash);
  assert.equal(inspection.journal.leaseFence.restartReadable, true);
  assert.equal(inspection.journal.leaseFence.monotonicSequence, true);
  assert.equal(inspection.journal.leaseFence.fsyncEvidence, true);
  assert.deepEqual(inspection.leaseFence, inspection.journal.leaseFence);
  assert.deepEqual(inspection.leaseFence.writerLease, inspection.journal.writerLease);
  assert.equal(inspection.journal.committedState.leaseOwner.visible, true);
  assert.equal(inspection.journal.committedState.leaseOwner.claimId, claimId);
  assert.equal(inspection.journal.committedState.leaseOwner.claimHash, claimHash);
  assert.equal(inspection.journal.committedState.leaseOwner.claimKeyHash, claimHash);
  assert.equal(
    inspection.journal.committedState.leaseOwner.eventType,
    expectedLeaseOwnerEventType,
  );
  assertNoRawSiteValues(inspection, rawSiteValues, 'RPP-0679 production lease audit');
}

function assertMissingFinalizationState(journal, {
  plan,
  expectedCommitted,
  artifactRefs,
  claimId,
  rawSiteValues,
}) {
  const mutationRecords = recordsOfType(journal.records, 'mutation-observed');
  const completedRecords = recordsOfType(journal.records, 'journal-completed');
  const recoveryStateRecords = recordsOfType(journal.records, 'recovery-state');
  const lastMutationRow = mutationRecords.at(-1);
  const latestMutation = plan.mutations.at(-1);
  const claimHash = recoveryClaimHash(claimId);

  assert.ok(lastMutationRow);
  assert.equal(journal.integrity.status, 'ok');
  assert.deepEqual(
    journal.records.map((record) => record.sequence),
    expectedSequences(journal.records.length),
  );
  assert.equal(openRecords(journal.records).length, 2);
  assert.equal(recordsOfType(journal.records, 'target-planned').length, plan.mutations.length);
  assert.equal(recordsOfType(journal.records, 'journal-ownership-recorded').length, 1);
  assert.equal(recordsOfType(journal.records, 'recovery-claim-opened').length, 1);
  assert.equal(recordsOfType(journal.records, 'apply-staged').length, 1);
  assert.equal(recordsOfType(journal.records, 'dependencies-validated').length, 1);
  assert.equal(recordsOfType(journal.records, 'apply-committing').length, 1);
  assert.equal(recoveryStateRecords.length, 1);
  assert.equal(recoveryStateRecords[0].state, 'blocked-recovery');
  assert.equal(mutationRecords.length, plan.mutations.length);
  assert.equal(completedRecords.length, 0);
  assert.ok(mutationRecords.every((record) => record.claimId === claimId));
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
    claimId,
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
  claimId,
  completedRecord,
  rawSiteValues,
}) {
  const mutationRowsBefore = recordsOfType(beforeFinalization.records, 'mutation-observed');
  const mutationRowsAfter = recordsOfType(journal.records, 'mutation-observed');
  const completedRecords = recordsOfType(journal.records, 'journal-completed');
  const latestMutation = plan.mutations.at(-1);
  const claimHash = recoveryClaimHash(claimId);

  assert.equal(journal.integrity.status, 'ok');
  assert.deepEqual(
    journal.records.map((record) => record.sequence),
    expectedSequences(journal.records.length),
  );
  assert.deepEqual(
    mutationRowsAfter.map((record) => record.sequence),
    mutationRowsBefore.map((record) => record.sequence),
  );
  assert.equal(mutationRowsAfter.length, plan.mutations.length);
  assert.equal(completedRecords.length, 1);
  assert.equal(completedRecords[0].sequence, completedRecord.sequence);
  assert.equal(completedRecords[0].claimId, claimId);
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
    claimId,
    claimHash,
    claimKeyHash: claimHash,
    sequence: completedRecord.sequence,
    eventType: 'journal-completed',
  });
  assertHashOnlyJournalRows(journal.records, rawSiteValues);
}

function assertFullyUpdatedInspection(inspection, {
  plan,
  claimId,
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
  assert.equal(inspection.journal.committedState.leaseOwner.claimId, claimId);
  assert.equal(inspection.journal.committedState.leaseOwner.claimHash, recoveryClaimHash(claimId));
  assert.equal(
    inspection.journal.committedState.leaseOwner.claimKeyHash,
    recoveryClaimHash(claimId),
  );
  assert.equal(
    inspection.journal.committedState.leaseOwner.eventType,
    expectedLeaseOwnerEventType,
  );
  assertNoRawSiteValues(inspection, rawSiteValues, 'RPP-0679 restart inspection');
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

function missingCommitFinalizationEvidence({
  generatedCase,
  plan,
  beforeFinalization,
  finalized,
  completedRecord,
  writerInspection,
  finalizerInspection,
  beforeInspection,
  finalizedInspection,
}) {
  const mutationRowsBefore = recordsOfType(beforeFinalization.records, 'mutation-observed');
  const mutationRowsAfter = recordsOfType(finalized.records, 'mutation-observed');
  const completedRowsBefore = recordsOfType(beforeFinalization.records, 'journal-completed');
  const completedRowsAfter = recordsOfType(finalized.records, 'journal-completed');
  const beforeLeaseOwner = beforeFinalization.committedState.leaseOwner;
  const finalizedLeaseOwner = finalized.committedState.leaseOwner;

  return {
    issue: 'RPP-0679',
    proofClass: 'missing-commit-finalization-v4',
    generatedCaseId: generatedCase.id,
    missingCommitFinalization: {
      proved: beforeFinalization.committedState.status === 'committed'
        && beforeFinalization.committedState.completedRows === 0
        && finalized.committedState.status === 'completed'
        && finalized.committedState.completedRows === 1
        && mutationRowsBefore.length === plan.mutations.length
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
    },
    auditEvidence: {
      hashOnly: true,
      rawValuesIncluded: false,
      leaseOwnerIdentityVisible: beforeLeaseOwner.visible === true
        && finalizedLeaseOwner.visible === true,
      missingFinalizationLeaseOwnerIdentity: leaseOwnerIdentityFor(beforeLeaseOwner),
      leaseOwnerIdentity: leaseOwnerIdentityFor(finalizedLeaseOwner),
      writerLeaseIdentity: {
        claimId: finalizerInspection.journal.writerLease.claimId,
        claimHash: finalizerInspection.journal.writerLease.claimHash,
        claimKeyHash: finalizerInspection.journal.writerLease.claimKeyHash,
        restartReadable: finalizerInspection.journal.writerLease.restartReadable === true,
      },
      leaseFenceIdentity: {
        claimId: finalizerInspection.journal.leaseFence.writerLease.claimId,
        claimHash: finalizerInspection.journal.leaseFence.writerLease.claimHash,
        claimKeyHash: finalizerInspection.journal.leaseFence.writerLease.claimKeyHash,
        restartReadable: finalizerInspection.journal.leaseFence.restartReadable === true,
      },
      productionInspectionSurface: productionRecoveryJournalInspectionSurfaceIsPresent(
        finalizerInspection,
      ),
      writerInspectionSurface: productionRecoveryJournalInspectionSurfaceIsPresent(
        writerInspection,
      ),
      recoveryInspectionStates: {
        beforeFinalization: beforeInspection.status,
        finalized: finalizedInspection.status,
      },
      journalRowsHash: digest(finalized.records),
    },
    productionBackedDurableJournalProof: {
      proved: false,
      reasonCode: 'LOCAL_SANDBOX_ONLY',
      requiredBoundary: 'live-production-backed-durable-journal',
    },
    releasePosture: 'NO-GO',
  };
}

function missingCommitFinalizationEvidenceProvesAudit(evidence, plan) {
  const finalization = evidence?.missingCommitFinalization;
  const audit = evidence?.auditEvidence;
  const missingLeaseOwner = audit?.missingFinalizationLeaseOwnerIdentity;
  const finalizedLeaseOwner = audit?.leaseOwnerIdentity;
  const beforeEnvelope = finalization?.beforeTargetEnvelope;
  const finalizedEnvelope = finalization?.finalizedTargetEnvelope;

  return Boolean(
    finalization?.proved === true
      && finalization?.mutationRowsBefore === plan.mutations.length
      && finalization?.mutationRowsAfter === plan.mutations.length
      && finalization?.mutationRowsPreserved === true
      && finalization?.completedRowsBefore === 0
      && finalization?.completedRowsAfter === 1
      && finalization?.finalizationAppended === true
      && beforeEnvelope?.plannedTargets === plan.mutations.length
      && beforeEnvelope?.committedTargets === plan.mutations.length
      && beforeEnvelope?.allCommittedTargetsHaveHashes === true
      && beforeEnvelope?.allTargetsCommitted === false
      && beforeEnvelope?.hashOnly === true
      && beforeEnvelope?.rawValuesIncluded === false
      && finalizedEnvelope?.plannedTargets === plan.mutations.length
      && finalizedEnvelope?.committedTargets === plan.mutations.length
      && finalizedEnvelope?.allCommittedTargetsHaveHashes === true
      && finalizedEnvelope?.allTargetsCommitted === true
      && finalizedEnvelope?.hashOnly === true
      && finalizedEnvelope?.rawValuesIncluded === false
      && audit?.hashOnly === true
      && audit?.rawValuesIncluded === false
      && audit?.leaseOwnerIdentityVisible === true
      && audit?.productionInspectionSurface === true
      && audit?.writerInspectionSurface === true
      && audit?.recoveryInspectionStates?.beforeFinalization === 'fully-updated-remote'
      && audit?.recoveryInspectionStates?.finalized === 'fully-updated-remote'
      && missingLeaseOwner?.visible === true
      && missingLeaseOwner?.eventType === 'mutation-observed'
      && Number.isInteger(missingLeaseOwner?.sequence)
      && typeof missingLeaseOwner?.claimId === 'string'
      && hashPattern.test(missingLeaseOwner?.claimHash || '')
      && hashPattern.test(missingLeaseOwner?.claimKeyHash || '')
      && hashPattern.test(missingLeaseOwner?.leaseOwnerHash || '')
      && finalizedLeaseOwner?.visible === true
      && finalizedLeaseOwner?.eventType === 'journal-completed'
      && Number.isInteger(finalizedLeaseOwner?.sequence)
      && typeof finalizedLeaseOwner?.claimId === 'string'
      && hashPattern.test(finalizedLeaseOwner?.claimHash || '')
      && hashPattern.test(finalizedLeaseOwner?.claimKeyHash || '')
      && hashPattern.test(finalizedLeaseOwner?.leaseOwnerHash || '')
      && audit?.writerLeaseIdentity?.claimId === finalizedLeaseOwner.claimId
      && audit?.writerLeaseIdentity?.claimHash === finalizedLeaseOwner.claimHash
      && audit?.writerLeaseIdentity?.claimKeyHash === finalizedLeaseOwner.claimKeyHash
      && audit?.writerLeaseIdentity?.restartReadable === true
      && audit?.leaseFenceIdentity?.claimId === finalizedLeaseOwner.claimId
      && audit?.leaseFenceIdentity?.claimHash === finalizedLeaseOwner.claimHash
      && audit?.leaseFenceIdentity?.claimKeyHash === finalizedLeaseOwner.claimKeyHash
      && audit?.leaseFenceIdentity?.restartReadable === true
      && evidence?.productionBackedDurableJournalProof?.proved === false
      && evidence?.releasePosture === 'NO-GO'
  );
}

function assertEvidenceAccepted(evidence, {
  plan,
  claimId,
  rawSiteValues,
}) {
  assert.equal(missingCommitFinalizationEvidenceProvesAudit(evidence, plan), true);
  assert.equal(evidence.auditEvidence.leaseOwnerIdentityVisible, true);
  assert.equal(evidence.auditEvidence.missingFinalizationLeaseOwnerIdentity.visible, true);
  assert.equal(evidence.auditEvidence.missingFinalizationLeaseOwnerIdentity.claimId, claimId);
  assert.equal(evidence.auditEvidence.missingFinalizationLeaseOwnerIdentity.claimHash, recoveryClaimHash(claimId));
  assert.equal(
    evidence.auditEvidence.missingFinalizationLeaseOwnerIdentity.claimKeyHash,
    recoveryClaimHash(claimId),
  );
  assert.equal(
    evidence.auditEvidence.missingFinalizationLeaseOwnerIdentity.eventType,
    'mutation-observed',
  );
  assert.equal(Number.isInteger(evidence.auditEvidence.missingFinalizationLeaseOwnerIdentity.sequence), true);
  assert.equal(evidence.auditEvidence.leaseOwnerIdentity.visible, true);
  assert.equal(evidence.auditEvidence.leaseOwnerIdentity.claimId, claimId);
  assert.equal(evidence.auditEvidence.leaseOwnerIdentity.claimHash, recoveryClaimHash(claimId));
  assert.equal(evidence.auditEvidence.leaseOwnerIdentity.claimKeyHash, recoveryClaimHash(claimId));
  assert.equal(evidence.auditEvidence.leaseOwnerIdentity.eventType, 'journal-completed');
  assert.equal(Number.isInteger(evidence.auditEvidence.leaseOwnerIdentity.sequence), true);
  assert.equal(evidence.auditEvidence.writerLeaseIdentity.restartReadable, true);
  assert.equal(evidence.auditEvidence.leaseFenceIdentity.restartReadable, true);
  assert.match(evidence.missingCommitFinalization.completedRecordHash, hashPattern);
  assert.match(evidence.missingCommitFinalization.beforeRowsHash, hashPattern);
  assert.match(evidence.missingCommitFinalization.finalizedRowsHash, hashPattern);
  assert.match(evidence.auditEvidence.journalRowsHash, hashPattern);
  assert.equal(evidence.productionBackedDurableJournalProof.reasonCode, 'LOCAL_SANDBOX_ONLY');
  assertNoRawSiteValues(evidence, rawSiteValues, 'RPP-0679 audit evidence');
}

test('RPP-0679 generated missing commit finalization exposes lease owner audit identity variant 4', () => {
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
    const claimId = claimIdFor(generatedCase);

    const writer = spawnMissingFinalizationWriter({
      filePath,
      plan,
      remote,
      artifactRefs,
      claimId,
      now: fixedNow,
    });
    const writerInspection = parseChildOutput(writer);

    assertProductionLeaseOwnerAudit(writerInspection, {
      claimId,
      rawSiteValues,
      expectedLeaseOwnerEventType: 'mutation-observed',
    });

    const beforeFinalization = readRecoveryJournal(filePath);
    assertMissingFinalizationState(beforeFinalization, {
      plan,
      expectedCommitted,
      artifactRefs,
      claimId,
      rawSiteValues,
    });
    assert.deepEqual(writerInspection.journal.committedState, beforeFinalization.committedState);
    assertNoRawSiteValues(
      fs.readFileSync(filePath, 'utf8'),
      rawSiteValues,
      'RPP-0679 pre-finalization journal file',
    );

    const beforeInspection = inspectRecoveryJournal({
      journal: beforeFinalization,
      plan,
      current: expectedCommitted,
    });
    assertFullyUpdatedInspection(beforeInspection, {
      plan,
      claimId,
      expectedLeaseOwnerEventType: 'mutation-observed',
      rawSiteValues,
    });

    const finalizer = openProductionRecoveryJournal({
      filePath,
      plan,
      current: expectedCommitted,
      artifactRefs,
      now: new Date(fixedNow.getTime() + 1_000),
      truncate: false,
      claimId,
    });
    const preAppendFinalizerInspection = finalizer.inspect();
    assertProductionLeaseOwnerAudit(preAppendFinalizerInspection, {
      claimId,
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
      claimId,
      rawSiteValues,
      expectedLeaseOwnerEventType: 'journal-completed',
    });

    const finalized = readRecoveryJournal(filePath);
    assertFinalizedState(finalized, {
      beforeFinalization,
      plan,
      expectedCommitted,
      artifactRefs,
      claimId,
      completedRecord,
      rawSiteValues,
    });
    assert.deepEqual(finalizerInspection.journal.committedState, finalized.committedState);
    assertNoRawSiteValues(
      fs.readFileSync(filePath, 'utf8'),
      rawSiteValues,
      'RPP-0679 finalized journal file',
    );

    const finalizedInspection = inspectRecoveryJournal({
      journal: finalized,
      plan,
      current: expectedCommitted,
    });
    assertFullyUpdatedInspection(finalizedInspection, {
      plan,
      claimId,
      expectedLeaseOwnerEventType: 'journal-completed',
      rawSiteValues,
    });

    const evidence = missingCommitFinalizationEvidence({
      generatedCase,
      plan,
      beforeFinalization,
      finalized,
      completedRecord,
      writerInspection,
      finalizerInspection,
      beforeInspection,
      finalizedInspection,
    });
    assertEvidenceAccepted(evidence, {
      plan,
      claimId,
      rawSiteValues,
    });
  }
});
