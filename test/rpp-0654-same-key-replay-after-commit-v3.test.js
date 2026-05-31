import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { applyPlan } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { inspectRecoveryJournal } from '../src/recovery-inspect.js';
import {
  assertJournalRecordHasNoRawValues,
  openProductionRecoveryJournal,
  productionRecoveryJournalInspectionSurfaceIsPresent,
  readRecoveryJournal,
  recoveryClaimHash,
} from '../src/recovery-journal.js';
import { deserializeResourceValue, resourceHash, setResource } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import { buildDurableRecoveryJournalReleaseProof } from '../scripts/playground/production-shaped-live-release-verify-lib.js';

const fixedNow = new Date('2026-05-31T11:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;

const generatedCommitReplayCases = Object.freeze([
  {
    id: 'rpp-0654-commit-replay-three-v3',
    mutationCount: 3,
  },
  {
    id: 'rpp-0654-commit-replay-five-v3',
    mutationCount: 5,
  },
]);

function tempJournalPath(prefix = 'reprint-rpp-0654-commit-replay-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return path.join(dir, 'recovery.jsonl');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function generatedSites(generatedCase) {
  const base = { files: {}, plugins: {}, db: {} };
  for (let index = 1; index <= generatedCase.mutationCount; index++) {
    base.files[`${generatedCase.id}-target-${index}.txt`] =
      `base-raw-rpp-0654-${generatedCase.id}-target-${index}`;
  }

  const local = cloneJson(base);
  const remote = cloneJson(base);
  for (let index = 1; index <= generatedCase.mutationCount; index++) {
    local.files[`${generatedCase.id}-target-${index}.txt`] =
      `local-raw-rpp-0654-${generatedCase.id}-target-${index}`;
  }

  const plan = createPushPlan({
    base,
    local,
    remote,
    now: fixedNow,
  });
  assert.equal(plan.status, 'ready');
  assert.equal(plan.mutations.length, generatedCase.mutationCount);

  return {
    plan,
    remote,
    expectedCommitted: applyMutations(cloneJson(remote), plan),
    rawSiteValues: rawSiteValuesFor(base, local, remote),
  };
}

function rawSiteValuesFor(...sites) {
  const values = new Set([
    'base-raw-rpp-0654',
    'local-raw-rpp-0654',
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
    releaseProof: `artifact://rpp-0654/${generatedCase.id}/local-release-proof`,
    recoverySupport: `artifact://rpp-0654/${generatedCase.id}/same-key-replay-after-commit-v3`,
    durabilityScope: `artifact://rpp-0654/${generatedCase.id}/sandbox-file-backed-only`,
  };
}

function claimIdsFor(generatedCase) {
  return {
    previousClaimId: `${generatedCase.id}-previous-claim`,
    replayClaimId: `${generatedCase.id}-same-key-claim`,
  };
}

function recordsOfType(records, type) {
  return records.filter((record) => record.type === type);
}

function expectedSequences(totalRecords) {
  return Array.from({ length: totalRecords }, (_, index) => index + 1);
}

function assertNoRawSiteValues(value, rawSiteValues, label = 'RPP-0654 evidence') {
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
  assertNoRawSiteValues(records, rawSiteValues, 'RPP-0654 journal rows');
}

function oldRemoteRecoveryFromInspection({ inspection, plan, checkedPath }) {
  return {
    source: 'RPP-0654 committed same-key replay old-remote classification',
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
  const originalRequestHash = '4'.repeat(64);
  const conflictingRequestHash = '5'.repeat(64);
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
          checkedPath: productionInspection.journal.checked[0],
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
          source: 'RPP-0654 generated different-body conflict recovery state',
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
        required: productionInspection.journal.checked[0],
        observed: productionInspection.journal.checked[0],
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

function buildReplayAfterCommitEvidence({
  plan,
  beforeReplay,
  afterReplay,
  replayResult,
  replayInspection,
  releaseProof,
}) {
  const mutationRowsBefore = recordsOfType(beforeReplay.records, 'mutation-observed').length;
  const mutationRowsAfter = recordsOfType(afterReplay.records, 'mutation-observed').length;
  const targetRowsBefore = recordsOfType(beforeReplay.records, 'target-planned').length;
  const targetRowsAfter = recordsOfType(afterReplay.records, 'target-planned').length;
  const completedRowsAfter = recordsOfType(afterReplay.records, 'journal-completed').length;
  const replayRowsAfter = recordsOfType(afterReplay.records, 'journal-replayed').length;
  const targetEnvelope = afterReplay.committedState.targetEnvelope;
  const leaseOwner = afterReplay.committedState.leaseOwner;

  return {
    issue: 'RPP-0654',
    proofClass: 'same-key-replay-after-commit-v3',
    sameKeyReplayAfterCommit: {
      replayed: true,
      freshMutationWork: replayResult.appliedMutations !== 0,
      appliedMutations: replayResult.appliedMutations,
      mutationRowsBefore,
      mutationRowsAfter,
      targetRowsBefore,
      targetRowsAfter,
      duplicateMutationRecords: mutationRowsAfter !== mutationRowsBefore,
      duplicateTargetPlannedRecords: targetRowsAfter !== targetRowsBefore,
      completedRows: completedRowsAfter,
      replayRows: replayRowsAfter,
      beforeReplayRowsHash: digest(beforeReplay.records),
      afterReplayRowsHash: digest(afterReplay.records),
      targetEnvelope: {
        ...targetEnvelope,
        hashOnly: true,
        rawValuesIncluded: false,
      },
    },
    auditEvidence: {
      hashOnly: true,
      rawValuesIncluded: false,
      leaseOwnerIdentity: {
        visible: leaseOwner.visible === true,
        claimId: leaseOwner.claimId,
        claimHash: leaseOwner.claimHash,
        claimKeyHash: leaseOwner.claimKeyHash,
        sequence: leaseOwner.sequence,
        eventType: leaseOwner.eventType,
      },
      manualRecoveryAuditExportHash: digest(releaseProof.manualRecoveryAuditExport),
      releaseProofHash: digest({
        gate: releaseProof.gate,
        gateStatus: releaseProof.gateStatus,
        checks: releaseProof.checks,
        leaseOwnerIdentity: releaseProof.leaseOwnerIdentity,
      }),
    },
    proofMovement: {
      accepted: releaseProof.ok === true,
      gate: releaseProof.gate,
      gateStatus: releaseProof.gateStatus,
      recoveryState: replayInspection.status,
      checkedPathHash: digest(
        replayInspection.journal.checked || [replayInspection.journal.filePath || 'local-recovery-journal'],
      ),
    },
    plan: {
      mutationCount: plan.mutations.length,
      planHash: digest(plan),
    },
  };
}

function replayAfterCommitEvidenceProvesMovement(evidence, plan) {
  const replay = evidence?.sameKeyReplayAfterCommit;
  const targetEnvelope = replay?.targetEnvelope;
  const leaseOwner = evidence?.auditEvidence?.leaseOwnerIdentity;

  return Boolean(
    replay?.replayed === true
      && replay?.freshMutationWork === false
      && replay?.appliedMutations === 0
      && replay?.duplicateMutationRecords === false
      && replay?.duplicateTargetPlannedRecords === false
      && replay?.completedRows === 1
      && replay?.replayRows === 1
      && Number.isInteger(targetEnvelope?.plannedTargets)
      && Number.isInteger(targetEnvelope?.committedTargets)
      && targetEnvelope.plannedTargets === plan.mutations.length
      && targetEnvelope.committedTargets === plan.mutations.length
      && targetEnvelope.allCommittedTargetsHaveHashes === true
      && targetEnvelope.allTargetsCommitted === true
      && targetEnvelope.hashOnly === true
      && targetEnvelope.rawValuesIncluded === false
      && evidence?.auditEvidence?.hashOnly === true
      && evidence?.auditEvidence?.rawValuesIncluded === false
      && leaseOwner?.visible === true
      && typeof leaseOwner?.claimId === 'string'
      && hashPattern.test(leaseOwner?.claimHash || '')
      && hashPattern.test(leaseOwner?.claimKeyHash || '')
      && evidence?.proofMovement?.accepted === true
      && evidence?.proofMovement?.gate === 'GATE-2'
      && evidence?.proofMovement?.gateStatus === 'proven'
      && evidence?.proofMovement?.recoveryState === 'fully-updated-remote'
  );
}

function assertReplayAfterCommitEvidenceAccepted(evidence, {
  plan,
  claimId,
  rawSiteValues,
}) {
  assert.equal(replayAfterCommitEvidenceProvesMovement(evidence, plan), true);
  assert.equal(evidence.sameKeyReplayAfterCommit.freshMutationWork, false);
  assert.equal(evidence.sameKeyReplayAfterCommit.duplicateMutationRecords, false);
  assert.equal(evidence.sameKeyReplayAfterCommit.duplicateTargetPlannedRecords, false);
  assert.equal(evidence.sameKeyReplayAfterCommit.targetEnvelope.plannedTargets, plan.mutations.length);
  assert.equal(evidence.sameKeyReplayAfterCommit.targetEnvelope.committedTargets, plan.mutations.length);
  assert.equal(evidence.auditEvidence.leaseOwnerIdentity.visible, true);
  assert.equal(evidence.auditEvidence.leaseOwnerIdentity.claimId, claimId);
  assert.equal(evidence.auditEvidence.leaseOwnerIdentity.claimHash, recoveryClaimHash(claimId));
  assert.equal(evidence.auditEvidence.leaseOwnerIdentity.claimKeyHash, recoveryClaimHash(claimId));
  assert.match(evidence.auditEvidence.manualRecoveryAuditExportHash, hashPattern);
  assert.match(evidence.auditEvidence.releaseProofHash, hashPattern);
  assert.match(evidence.proofMovement.checkedPathHash, hashPattern);
  assertNoRawSiteValues(evidence, rawSiteValues, 'RPP-0654 replay evidence');
}

function runCommittedReplayScenario(generatedCase) {
  const filePath = tempJournalPath();
  fs.chmodSync(path.dirname(filePath), 0o700);
  const {
    plan,
    remote,
    expectedCommitted,
    rawSiteValues,
  } = generatedSites(generatedCase);
  const originalRemote = cloneJson(remote);
  const previousJournal = oldRemoteJournalForPlan(originalRemote, plan);
  const artifactRefs = artifactRefsFor(generatedCase);
  const { previousClaimId, replayClaimId } = claimIdsFor(generatedCase);
  const claimStaleThresholdMs = 1_000;

  const previous = openProductionRecoveryJournal({
    filePath,
    plan,
    current: originalRemote,
    artifactRefs,
    now: fixedNow,
    claimId: previousClaimId,
    claimStaleThresholdMs,
  });
  previous.close();

  const committedWriter = openProductionRecoveryJournal({
    filePath,
    plan,
    current: originalRemote,
    artifactRefs,
    now: new Date(fixedNow.getTime() + 5_000),
    truncate: false,
    claimId: replayClaimId,
    claimStaleThresholdMs,
  });
  const beforeCommitJournal = readRecoveryJournal(filePath);
  const oldRemoteInspection = inspectRecoveryJournal({
    journal: beforeCommitJournal,
    plan,
    current: originalRemote,
  });
  assert.equal(oldRemoteInspection.status, 'old-remote');

  const commitResult = applyPlan(remote, plan, {
    durableJournal: committedWriter,
    journal: previousJournal,
    mutateRemote: true,
    artifactRefs,
  });
  const commitInspection = committedWriter.inspect();
  committedWriter.close();

  assert.equal(commitResult.appliedMutations, plan.mutations.length);
  assert.deepEqual(remote, expectedCommitted);
  assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(commitInspection), true);
  assert.equal(commitInspection.claim.status, 'advanced');
  assert.equal(commitInspection.claim.activeClaimId, replayClaimId);
  assert.equal(commitInspection.claim.previousClaimId, previousClaimId);
  assert.equal(commitInspection.claim.claimExpiry.expired, true);
  assert.equal(commitInspection.claim.claimExpiry.previousClaimExpired, true);
  assertNoRawSiteValues(commitInspection, rawSiteValues, 'RPP-0654 commit inspection');

  const afterCommit = readRecoveryJournal(filePath);
  assertCommittedJournal(afterCommit, {
    plan,
    current: remote,
    claimId: replayClaimId,
    rawSiteValues,
  });

  const committedSnapshotHash = digest(remote);
  const replayWriter = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    now: new Date(fixedNow.getTime() + 5_500),
    truncate: false,
    claimId: replayClaimId,
    claimStaleThresholdMs,
  });
  const replayResult = applyPlan(remote, plan, {
    durableJournal: replayWriter,
    journal: previousJournal,
    mutateRemote: true,
    artifactRefs,
  });
  const replayInspection = replayWriter.inspect();
  replayWriter.close();

  const afterReplay = readRecoveryJournal(filePath);
  const replayRecoveryInspection = inspectRecoveryJournal({
    journal: afterReplay,
    plan,
    current: remote,
  });
  const oldRemoteRecovery = oldRemoteRecoveryFromInspection({
    inspection: oldRemoteInspection,
    plan,
    checkedPath: replayInspection.journal.checked[0],
  });
  const releaseProof = buildDurableRecoveryJournalReleaseProof({
    releaseSummary: buildRecoveryReleaseSummary({
      productionInspection: replayInspection,
      plan,
      oldRemoteRecovery,
    }),
    applyRevalidation: buildBlockedApplyRevalidation(plan),
  });
  const evidence = buildReplayAfterCommitEvidence({
    plan,
    beforeReplay: afterCommit,
    afterReplay,
    replayResult,
    replayInspection: replayRecoveryInspection,
    releaseProof,
  });

  assert.equal(replayResult.appliedMutations, 0);
  assert.equal(digest(remote), committedSnapshotHash);
  assert.deepEqual(remote, expectedCommitted);
  assertCommittedJournal(afterReplay, {
    plan,
    current: remote,
    claimId: replayClaimId,
    rawSiteValues,
  });
  assert.equal(afterReplay.records.length, afterCommit.records.length + 2);
  assert.equal(recordsOfType(afterReplay.records, 'journal-replayed').length, 1);
  assert.equal(recordsOfType(afterReplay.records, 'target-planned').length, plan.mutations.length);
  assert.equal(recordsOfType(afterReplay.records, 'mutation-observed').length, plan.mutations.length);
  assert.equal(recordsOfType(afterReplay.records, 'journal-completed').length, 1);
  assert.equal(replayRecoveryInspection.status, 'fully-updated-remote');
  assert.equal(replayRecoveryInspection.journal.committedState.leaseOwner.claimId, replayClaimId);
  assert.equal(replayRecoveryInspection.journal.committedState.leaseOwner.claimKeyHash, recoveryClaimHash(replayClaimId));
  assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(replayInspection), true);
  assert.equal(replayInspection.journal.committedState.leaseOwner.visible, true);
  assert.equal(replayInspection.journal.committedState.leaseOwner.claimId, replayClaimId);
  assertNoRawSiteValues(replayInspection, rawSiteValues, 'RPP-0654 replay writer inspection');

  assert.equal(releaseProof.ok, true);
  assert.equal(releaseProof.gate, 'GATE-2');
  assert.equal(releaseProof.gateStatus, 'proven');
  assert.equal(releaseProof.checks.sameKeyBodyReplay, true);
  assert.equal(releaseProof.sameKeyBodyReplay.proved, true);
  assert.equal(releaseProof.sameKeyBodyReplay.freshMutationWork, false);
  assert.equal(releaseProof.sameKeyBodyReplay.duplicateMutationEvents, false);
  assert.equal(releaseProof.checks.leaseOwnerIdentity, true);
  assert.equal(releaseProof.leaseOwnerIdentity.activeClaimId, replayClaimId);
  assert.equal(releaseProof.leaseOwnerIdentity.activeClaimKeyHash, recoveryClaimHash(replayClaimId));
  assert.equal(releaseProof.leaseOwnerIdentity.matches, true);
  assert.equal(releaseProof.manualRecoveryAuditExport.kind, 'manual-recovery-audit-export');
  assert.equal(releaseProof.manualRecoveryAuditExport.targetEnvelope.hashOnly, true);
  assert.equal(releaseProof.manualRecoveryAuditExport.targetEnvelope.rawValuesIncluded, false);
  assertNoRawSiteValues(releaseProof, rawSiteValues, 'RPP-0654 release proof');
  assertReplayAfterCommitEvidenceAccepted(evidence, {
    plan,
    claimId: replayClaimId,
    rawSiteValues,
  });

  return {
    filePath,
    plan,
    remote,
    originalRemote,
    artifactRefs,
    claimId: replayClaimId,
    rawSiteValues,
    afterCommit,
    evidence,
  };
}

function assertCommittedJournal(journal, {
  plan,
  current,
  claimId,
  rawSiteValues,
}) {
  const completedRecord = recordsOfType(journal.records, 'journal-completed').at(-1);
  assert.ok(completedRecord);
  assert.equal(journal.integrity.status, 'ok');
  assert.deepEqual(journal.records.map((record) => record.sequence), expectedSequences(journal.records.length));
  assert.equal(journal.committedState.status, 'completed');
  assert.equal(journal.committedState.phase, 'completed');
  assert.equal(journal.committedState.restartReadable, true);
  assert.equal(journal.committedState.targetRows, plan.mutations.length);
  assert.equal(journal.committedState.committedTargetRows, plan.mutations.length);
  assert.equal(journal.committedState.targetEnvelope.plannedTargets, plan.mutations.length);
  assert.equal(journal.committedState.targetEnvelope.committedTargets, plan.mutations.length);
  assert.equal(journal.committedState.targetEnvelope.allCommittedTargetsHaveHashes, true);
  assert.equal(journal.committedState.targetEnvelope.allTargetsCommitted, true);
  assert.equal(journal.committedState.leaseOwner.visible, true);
  assert.equal(journal.committedState.leaseOwner.claimId, claimId);
  assert.equal(journal.committedState.leaseOwner.claimHash, recoveryClaimHash(claimId));
  assert.equal(journal.committedState.leaseOwner.claimKeyHash, recoveryClaimHash(claimId));
  assert.equal(journal.committedState.leaseOwner.eventType, 'journal-completed');
  assert.equal(journal.committedState.observedHash, digest(current));
  assert.equal(completedRecord.claimId, claimId);
  assert.equal(completedRecord.claimHash, recoveryClaimHash(claimId));
  assertHashOnlyJournalRows(journal.records, rawSiteValues);
  assertNoRawSiteValues(fs.readFileSync(journal.filePath, 'utf8'), rawSiteValues, 'RPP-0654 journal file');
}

function renumberRecords(records) {
  return records.map((record, index) => ({
    ...record,
    sequence: index + 1,
  }));
}

function writeJournalRecords(filePath, records) {
  fs.writeFileSync(filePath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
}

function journalCopyPath(records, prefix) {
  const filePath = tempJournalPath(prefix);
  fs.chmodSync(path.dirname(filePath), 0o700);
  writeJournalRecords(filePath, records);
  return filePath;
}

function assertRejectedSameKeyReplayOpen({
  filePath,
  plan,
  current,
  artifactRefs,
  claimId,
  rawSiteValues,
  expectedIssueCode,
}) {
  const beforeText = fs.readFileSync(filePath, 'utf8');
  const before = readRecoveryJournal(filePath);
  assert.throws(
    () => openProductionRecoveryJournal({
      filePath,
      plan,
      current,
      artifactRefs,
      now: new Date(fixedNow.getTime() + 5_500),
      truncate: false,
      claimId,
    }),
    (error) => {
      assert.equal(error.code, 'RECOVERY_JOURNAL_TARGET_ENVELOPE_MISMATCH');
      assert.ok(error.details.issues.some((issue) => issue.code === expectedIssueCode));
      assertNoRawSiteValues(error.details, rawSiteValues, 'RPP-0654 rejected replay details');
      return true;
    },
  );
  assert.equal(fs.readFileSync(filePath, 'utf8'), beforeText);
  const after = readRecoveryJournal(filePath);
  assert.deepEqual(after.records, before.records);
  assert.equal(recordsOfType(after.records, 'journal-retry-opened').length, recordsOfType(before.records, 'journal-retry-opened').length);
  assert.equal(recordsOfType(after.records, 'mutation-observed').length, recordsOfType(before.records, 'mutation-observed').length);
  assert.equal(recordsOfType(after.records, 'target-planned').length, recordsOfType(before.records, 'target-planned').length);
  assertHashOnlyJournalRows(after.records, rawSiteValues);
}

test('RPP-0654 generated same-key replay after commit is idempotent and audit-visible variant 3', () => {
  for (const generatedCase of generatedCommitReplayCases) {
    runCommittedReplayScenario(generatedCase);
  }
});

test('RPP-0654 rejects invalid committed target envelopes before replay proof movement variant 3', () => {
  const {
    plan,
    remote,
    artifactRefs,
    claimId,
    rawSiteValues,
    afterCommit,
    evidence,
  } = runCommittedReplayScenario(generatedCommitReplayCases[0]);
  const targetRows = recordsOfType(afterCommit.records, 'target-planned');
  assert.equal(targetRows.length, plan.mutations.length);

  const missingRecords = renumberRecords(
    afterCommit.records.filter((record) => record !== targetRows[0]),
  );
  const malformedRecords = afterCommit.records.map((record) => (
    record === targetRows[0]
      ? { ...record, resourceKey: null }
      : { ...record }
  ));
  const staleRecords = afterCommit.records.map((record) => (
    record === targetRows[0]
      ? { ...record, planId: `${plan.id}-stale-target-envelope` }
      : { ...record }
  ));
  const driftedPlan = cloneJson(plan);
  driftedPlan.mutations[0].localHash = 'f'.repeat(64);

  const invalidJournals = [
    {
      name: 'missing',
      filePath: journalCopyPath(missingRecords, 'reprint-rpp-0654-missing-envelope-'),
      plan,
      expectedIssueCode: 'TARGET_PLANNED_COUNT_MISMATCH',
    },
    {
      name: 'malformed',
      filePath: journalCopyPath(malformedRecords, 'reprint-rpp-0654-malformed-envelope-'),
      plan,
      expectedIssueCode: 'TARGET_PLANNED_RESOURCE_MISMATCH',
    },
    {
      name: 'stale',
      filePath: journalCopyPath(staleRecords, 'reprint-rpp-0654-stale-envelope-'),
      plan,
      expectedIssueCode: 'TARGET_PLANNED_COUNT_MISMATCH',
    },
    {
      name: 'drifted',
      filePath: journalCopyPath(afterCommit.records, 'reprint-rpp-0654-drifted-envelope-'),
      plan: driftedPlan,
      expectedIssueCode: 'TARGET_PLANNED_AFTER_HASH_MISMATCH',
    },
  ];

  for (const invalid of invalidJournals) {
    assertRejectedSameKeyReplayOpen({
      filePath: invalid.filePath,
      plan: invalid.plan,
      current: remote,
      artifactRefs,
      claimId,
      rawSiteValues,
      expectedIssueCode: invalid.expectedIssueCode,
    });
    assert.equal(typeof invalid.name, 'string');
  }

  const invalidEvidence = [
    {
      name: 'missing',
      evidence: {
        ...evidence,
        sameKeyReplayAfterCommit: {
          ...evidence.sameKeyReplayAfterCommit,
          targetEnvelope: null,
        },
      },
    },
    {
      name: 'malformed',
      evidence: {
        ...evidence,
        sameKeyReplayAfterCommit: {
          ...evidence.sameKeyReplayAfterCommit,
          targetEnvelope: {
            ...evidence.sameKeyReplayAfterCommit.targetEnvelope,
            plannedTargets: String(plan.mutations.length),
          },
        },
      },
    },
    {
      name: 'stale',
      evidence: {
        ...evidence,
        sameKeyReplayAfterCommit: {
          ...evidence.sameKeyReplayAfterCommit,
          targetEnvelope: {
            ...evidence.sameKeyReplayAfterCommit.targetEnvelope,
            plannedTargets: plan.mutations.length - 1,
            committedTargets: plan.mutations.length - 1,
            allTargetsCommitted: false,
          },
        },
      },
    },
    {
      name: 'drifted',
      evidence: {
        ...evidence,
        sameKeyReplayAfterCommit: {
          ...evidence.sameKeyReplayAfterCommit,
          targetEnvelope: {
            ...evidence.sameKeyReplayAfterCommit.targetEnvelope,
            committedTargets: plan.mutations.length - 1,
            allTargetsCommitted: false,
          },
        },
        proofMovement: {
          ...evidence.proofMovement,
          accepted: false,
          recoveryState: 'blocked-recovery',
        },
      },
    },
  ];

  for (const invalid of invalidEvidence) {
    assert.equal(
      replayAfterCommitEvidenceProvesMovement(invalid.evidence, plan),
      false,
      `${invalid.name} committed replay evidence must not move recovery proof`,
    );
    assertNoRawSiteValues(invalid.evidence, rawSiteValues, `RPP-0654 ${invalid.name} rejected evidence`);
  }
});
