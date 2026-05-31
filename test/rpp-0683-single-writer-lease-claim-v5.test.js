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
  classifyRecoveryJournalClaims,
  openProductionRecoveryJournal,
  openRecoveryJournal,
  productionRecoveryJournalInspectionSurfaceIsPresent,
  readRecoveryJournal,
  recoveryClaimHash,
  RecoveryJournalClaimStaleError,
} from '../src/recovery-journal.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import { buildDurableRecoveryJournalReleaseProof } from '../scripts/playground/production-shaped-live-release-verify-lib.js';

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0683-lease-'));
  return path.join(dir, 'recovery.jsonl');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite() {
  const files = {};
  for (let index = 1; index <= 5; index++) {
    files[`rpp-0683-file-${index}.txt`] = `rpp-0683-base-raw-site-value-${index}`;
  }
  return { files, plugins: {}, db: {} };
}

function localSite(base = baseSite()) {
  const site = cloneJson(base);
  for (let index = 1; index <= 5; index++) {
    site.files[`rpp-0683-file-${index}.txt`] = `rpp-0683-local-raw-site-value-${index}`;
  }
  return site;
}

function preservedRemoteSite(base = baseSite()) {
  const site = cloneJson(base);
  site.files['rpp-0683-file-1.txt'] = 'rpp-0683-preserved-remote-raw-site-value-1';
  site.files['rpp-0683-file-3.txt'] = 'rpp-0683-preserved-remote-raw-site-value-3';
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
    'rpp-0683-base-raw-site-value',
    'rpp-0683-local-raw-site-value',
    'rpp-0683-preserved-remote-raw-site-value',
  ]);
  for (const site of sites) {
    for (const value of Object.values(site.files || {})) {
      values.add(value);
    }
  }
  return [...values];
}

function assertNoRawSiteValues(value, rawSiteValues) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const rawValue of rawSiteValues) {
    assert.equal(
      serialized.includes(rawValue),
      false,
      `Unexpected raw site value in RPP-0683 evidence: ${rawValue}`,
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
  claimExpired,
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
  assert.equal(writerLease.claimExpiry.expired, claimExpired);
  assert.match(writerLease.claimHash, hashPattern);
}

function assertLeaseFenceContract(leaseFence, {
  claimId,
  staleClaimRejected,
  claimExpired,
}) {
  assert.equal(leaseFence.boundary, 'filesystem-compare-rename');
  assert.equal(leaseFence.storageGuard, 'filesystem-compare-rename');
  assert.equal(leaseFence.claimKeyUnique, true);
  assert.equal(leaseFence.fsyncEvidence, true);
  assert.equal(leaseFence.monotonicSequence, true);
  assert.equal(leaseFence.restartReadable, true);
  assert.equal(leaseFence.staleClaimRejected, staleClaimRejected);
  assert.equal(leaseFence.claimExpiry.expired, claimExpired);
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
  rawSiteValues,
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
  assertNoRawSiteValues(error.details, rawSiteValues);
  return true;
}

function firstChangedTarget(plan, current) {
  for (const mutation of plan.mutations) {
    if (resourceHash(current, mutation.resource) !== mutation.remoteBeforeHash) {
      return mutation;
    }
  }
  assert.fail('Expected preserved remote fixture to drift at least one planned target.');
}

function assertPreconditionFailurePreservesRemote(error, {
  plan,
  preservedRemoteBeforeRetry,
  rawSiteValues,
}) {
  const blockedMutation = firstChangedTarget(plan, preservedRemoteBeforeRetry);
  const actualHash = resourceHash(preservedRemoteBeforeRetry, blockedMutation.resource);
  assert.equal(error.code, 'PRECONDITION_FAILED');
  assert.equal(error.details.resourceKey, blockedMutation.resourceKey);
  assert.equal(error.details.expectedHash, blockedMutation.remoteBeforeHash);
  assert.equal(error.details.actualHash, actualHash);
  assert.match(error.details.expectedHash, hashPattern);
  assert.match(error.details.actualHash, hashPattern);
  assertNoRawSiteValues(error.details, rawSiteValues);
  return {
    resourceKey: blockedMutation.resourceKey,
    expectedHash: blockedMutation.remoteBeforeHash,
    actualHash,
  };
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
  return inspection;
}

function assertOldRemoteInspection({
  journal,
  plan,
  remote,
  rawSiteValues,
}) {
  const inspection = inspectRecoveryJournal({
    journal,
    plan,
    current: remote,
  });

  assert.equal(inspection.status, 'old-remote');
  assert.deepEqual(inspection.counts, {
    old: plan.mutations.length,
    new: 0,
    blockedUnknown: 0,
  });
  assertNoRawSiteValues(inspection, rawSiteValues);
  return inspection;
}

function assertRetryApplyFailsBeforeMutation({
  filePath,
  durableJournal,
  plan,
  preservedRemote,
  rawSiteValues,
}) {
  const preservedRemoteBeforeRetry = cloneJson(preservedRemote);
  const recordsBeforeApply = readRecoveryJournal(filePath).records.length;
  let preconditionEvidence = null;

  assert.throws(
    () => applyPlan(preservedRemote, plan, {
      durableJournal,
      mutateRemote: true,
    }),
    (error) => {
      preconditionEvidence = assertPreconditionFailurePreservesRemote(error, {
        plan,
        preservedRemoteBeforeRetry,
        rawSiteValues,
      });
      return true;
    },
  );

  assert.deepEqual(preservedRemote, preservedRemoteBeforeRetry);
  const restarted = readRecoveryJournal(filePath);
  assert.equal(restarted.records.length, recordsBeforeApply);
  assertNoMutationEvents(restarted.records);
  assertRecordsHaveNoRawValues(restarted.records, rawSiteValues);
  assertBlockedPreservedRemoteInspection({
    journal: restarted,
    plan,
    preservedRemote,
    rawSiteValues,
  });

  const evidence = {
    status: 412,
    code: 'PRECONDITION_FAILED',
    applied: 0,
    phase: 'before-first-mutation',
    checkedAgainst: 'live-remote',
    resourceKey: preconditionEvidence.resourceKey,
    expectedHash: preconditionEvidence.expectedHash,
    actualHash: preconditionEvidence.actualHash,
    journalRowsBefore: recordsBeforeApply,
    journalRowsAfter: restarted.records.length,
    mutationRowsBeforeFailure: 0,
    preservedRemoteHashBefore: digest(preservedRemoteBeforeRetry),
    preservedRemoteHashAfter: digest(preservedRemote),
    preservedRemoteUnchanged: true,
  };
  assertNoRawSiteValues(evidence, rawSiteValues);
  return evidence;
}

function oldRemoteRecoveryFromInspection({ inspection, plan, checkedPath }) {
  return {
    source: 'RPP-0683 restarted single-writer lease retry old-remote classification',
    status: 200,
    state: inspection.status,
    observedState: inspection.status,
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
  retryPreservationEvidence,
}) {
  const mutationEvents = plan.mutations.length;
  const checkedPath = productionInspection.journal.checked[0];
  const originalRequestHash = '6'.repeat(64);
  const conflictingRequestHash = '7'.repeat(64);
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
          source: 'RPP-0683 different-body conflict recovery state',
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
        preservedRemoteUnchanged: true,
        preconditionFailure: retryPreservationEvidence,
      },
      preservedRemoteRetry: retryPreservationEvidence,
      readRetryEvidence: {
        [checkedPath]: 2,
      },
      latestReadRetryEvidence: {
        [checkedPath]: 2,
      },
    },
  };
}

function buildBlockedApplyRevalidation({
  blockedInspection,
  retryPreservationEvidence,
  preservedRemoteUnchanged = true,
  mutationAppliedBeforeFailure = 0,
  applyCommitted = false,
}) {
  return {
    ok: true,
    apply: {
      status: 412,
      code: 'PRECONDITION_FAILED',
      applied: 0,
      applyRevalidation: {
        phase: retryPreservationEvidence.phase,
        checkedAgainst: retryPreservationEvidence.checkedAgainst,
        resourceKey: retryPreservationEvidence.resourceKey,
        expectedHash: retryPreservationEvidence.expectedHash,
        actualHash: retryPreservationEvidence.actualHash,
      },
    },
    replay: {
      status: 412,
      code: 'PRECONDITION_FAILED',
      replayed: true,
      freshMutationWork: false,
      preservedRemoteUnchanged,
    },
    recoveryInspect: {
      recovery: {
        state: blockedInspection.status,
        counts: {
          ...blockedInspection.counts,
          total: Object.values(blockedInspection.counts).reduce((sum, value) => sum + value, 0),
        },
      },
    },
    dbJournal: {
      ordering: {
        ordered: true,
        applyRejected: 20,
        applyReplayed: 21,
        mutationAppliedBeforeFailure,
        applyCommitted,
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

function assertReleaseProofCarriesPreservedRetry({
  productionInspection,
  plan,
  oldRemoteRecovery,
  blockedInspection,
  retryPreservationEvidence,
  rawSiteValues,
}) {
  const releaseSummary = buildRecoveryReleaseSummary({
    productionInspection,
    plan,
    oldRemoteRecovery,
    retryPreservationEvidence,
  });
  const releaseProof = buildDurableRecoveryJournalReleaseProof({
    releaseSummary,
    applyRevalidation: buildBlockedApplyRevalidation({
      blockedInspection,
      retryPreservationEvidence,
    }),
  });

  assert.equal(releaseSummary.releaseProof.replayAndRetry.required, productionInspection.journal.checked[0]);
  assert.equal(releaseSummary.releaseProof.replayAndRetry.observed, productionInspection.journal.checked[0]);
  assert.equal(releaseSummary.releaseProof.preservedRemoteRetry.preservedRemoteUnchanged, true);
  assert.equal(releaseProof.ok, true);
  assert.equal(releaseProof.gate, 'GATE-2');
  assert.equal(releaseProof.durableRecoveryJournalBoundary, 'release-verifier');
  assert.equal(releaseProof.gateStatus, 'proven');
  assert.equal(releaseProof.sameReleaseBoundary, true);
  assert.equal(releaseProof.sourceUrl, 'http://127.0.0.1:8080');
  assert.equal(releaseProof.checks.staleOwnerFencing, true);
  assert.equal(releaseProof.checks.claimExpiryPolicy, true);
  assert.equal(releaseProof.checks.oldState, true);
  assert.equal(releaseProof.checks.blockedState, true);
  assert.equal(releaseProof.checks.recoveryInspectAfterRestart, true);
  assert.equal(releaseProof.checks.sameKeyReplayAfterRejection, true);
  assert.equal(releaseProof.checks.preservedRejectedRemoteEvidence, true);
  assert.equal(releaseProof.checks.manualRecoveryAuditExport, true);
  assert.equal(releaseProof.sameKeyReplayAfterRejection.preservedRemoteUnchanged, true);
  assert.equal(releaseProof.sameKeyReplayAfterRejection.applyStatus, 412);
  assert.equal(releaseProof.sameKeyReplayAfterRejection.applyApplied, 0);
  assert.equal(releaseProof.sameKeyReplayAfterRejection.mutationAppliedBeforeFailure, 0);
  assert.equal(releaseProof.sameKeyReplayAfterRejection.applyCommitted, false);
  assert.equal(releaseProof.preservedRejectedRemoteEvidence.proved, true);
  assert.equal(releaseProof.preservedRejectedRemoteEvidence.applyStatus, 412);
  assert.equal(releaseProof.preservedRejectedRemoteEvidence.applyCode, 'PRECONDITION_FAILED');
  assert.equal(releaseProof.preservedRejectedRemoteEvidence.recoveryState, 'blocked-recovery');
  assert.equal(releaseProof.partialStates.old.proved, true);
  assert.equal(releaseProof.partialStates.old.state, 'old-remote');
  assert.deepEqual(releaseProof.partialStates.old.counts, oldRemoteRecovery.counts);
  assert.equal(releaseProof.partialStates.blocked.proved, true);
  assert.equal(releaseProof.partialStates.blocked.state, 'blocked-recovery');
  assert.equal(releaseProof.manualRecoveryAuditExport.proved, true);
  assert.equal(releaseProof.manualRecoveryAuditExport.kind, 'manual-recovery-audit-export');
  assert.equal(releaseProof.manualRecoveryAuditExport.targetEnvelope.hashOnly, true);
  assert.equal(releaseProof.manualRecoveryAuditExport.targetEnvelope.rawValuesIncluded, false);
  assertNoRawSiteValues(releaseSummary, rawSiteValues);
  assertNoRawSiteValues(releaseProof, rawSiteValues);

  const mutatingRetryProof = buildDurableRecoveryJournalReleaseProof({
    releaseSummary,
    applyRevalidation: buildBlockedApplyRevalidation({
      blockedInspection,
      retryPreservationEvidence,
      preservedRemoteUnchanged: false,
      mutationAppliedBeforeFailure: 1,
      applyCommitted: true,
    }),
  });
  assert.equal(mutatingRetryProof.ok, false);
  assert.equal(mutatingRetryProof.checks.sameKeyReplayAfterRejection, false);
  assert.equal(mutatingRetryProof.sameKeyReplayAfterRejection.preservedRemoteUnchanged, false);
  assert.equal(mutatingRetryProof.sameKeyReplayAfterRejection.mutationAppliedBeforeFailure, 1);
  assert.equal(mutatingRetryProof.sameKeyReplayAfterRejection.applyCommitted, true);
  assertNoRawSiteValues(mutatingRetryProof, rawSiteValues);
}

test('RPP-0683 release verifier single-writer lease retry preserves remote changes before mutation', () => {
  const filePath = tempJournalPath();
  const { plan, remote, preservedRemote, rawSiteValues } = buildScenario();
  const artifactRefs = {
    releaseProof: 'artifact://rpp-0683-single-writer-lease-claim-v5',
    recoverySupport: 'artifact://rpp-0683-release-verifier-retry-preservation-support',
  };
  const activeClaimId = 'rpp-0683-active-single-writer';
  const staleClaimId = 'rpp-0683-competing-single-writer';
  const retryClaimId = 'rpp-0683-expired-lease-retry';
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

  const preservedRemoteBeforeCompetingClaim = cloneJson(preservedRemote);
  assert.throws(
    () => openProductionRecoveryJournal({
      filePath,
      plan,
      current: preservedRemote,
      artifactRefs,
      now: new Date(fixedNow.getTime() + 500),
      truncate: false,
      claimId: staleClaimId,
      claimStaleThresholdMs,
    }),
    (error) => assertStaleClaimError(error, {
      staleClaimId,
      activeClaimId,
      activeClaimType: 'recovery-claim-opened',
      claimExpired: false,
      rawSiteValues,
    }),
  );
  assert.deepEqual(preservedRemote, preservedRemoteBeforeCompetingClaim);

  const afterCompetingClaim = readRecoveryJournal(filePath);
  const staleRejections = recordsOfType(afterCompetingClaim.records, 'stale-claim-rejected');
  assert.equal(afterCompetingClaim.integrity.status, 'ok');
  assert.equal(staleRejections.length, 1);
  assert.equal(staleRejections[0].claimId, staleClaimId);
  assert.equal(staleRejections[0].claimHash, recoveryClaimHash(staleClaimId));
  assert.equal(staleRejections[0].previousClaimId, activeClaimId);
  assert.equal(staleRejections[0].previousClaimHash, recoveryClaimHash(activeClaimId));
  assert.equal(staleRejections[0].claimExpired, false);
  assert.equal(staleRejections[0].observedHash, digest(preservedRemote));
  assert.match(staleRejections[0].observedHash, hashPattern);
  assertNoMutationEvents(afterCompetingClaim.records);
  assertRecordsHaveNoRawValues(afterCompetingClaim.records, rawSiteValues);

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
  let retryInspection;
  let retryPreservationEvidence;
  try {
    retryInspection = retry.inspect();
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
    assert.deepEqual(retryInspection.leaseFence.writerLease, retryInspection.journal.writerLease);
    assertNoRawSiteValues(retryInspection, rawSiteValues);

    retryPreservationEvidence = assertRetryApplyFailsBeforeMutation({
      filePath,
      durableJournal: retry,
      plan,
      preservedRemote,
      rawSiteValues,
    });
  } finally {
    retry.close();
  }

  const restarted = readRecoveryJournal(filePath);
  const claim = classifyRecoveryJournalClaims(restarted.records);
  const advancedRecords = recordsOfType(restarted.records, 'stale-claim-advanced');
  const ownershipRecords = recordsOfType(restarted.records, 'journal-ownership-recorded');
  const blockedInspection = assertBlockedPreservedRemoteInspection({
    journal: restarted,
    plan,
    preservedRemote,
    rawSiteValues,
  });
  const oldRemoteInspection = assertOldRemoteInspection({
    journal: restarted,
    plan,
    remote,
    rawSiteValues,
  });
  const oldRemoteRecovery = oldRemoteRecoveryFromInspection({
    inspection: oldRemoteInspection,
    plan,
    checkedPath: retryInspection.journal.checked[0],
  });

  assert.equal(restarted.integrity.status, 'ok');
  assert.equal(claim.status, 'advanced');
  assert.equal(claim.activeClaimId, retryClaimId);
  assert.equal(claim.previousClaimId, activeClaimId);
  assert.equal(advancedRecords.length, 1);
  assert.equal(advancedRecords[0].claimId, retryClaimId);
  assert.equal(advancedRecords[0].claimHash, recoveryClaimHash(retryClaimId));
  assert.equal(advancedRecords[0].previousClaimId, activeClaimId);
  assert.equal(advancedRecords[0].previousClaimHash, recoveryClaimHash(activeClaimId));
  assert.equal(advancedRecords[0].previousClaimAgeMs, 5_000);
  assert.equal(advancedRecords[0].claimExpired, true);
  assert.equal(advancedRecords[0].observedHash, digest(preservedRemote));
  assert.match(advancedRecords[0].observedHash, hashPattern);
  assert.equal(ownershipRecords.length, 2);
  assert.deepEqual(
    ownershipRecords.map((record) => record.claimId).sort(),
    [activeClaimId, retryClaimId].sort(),
  );
  assertNoMutationEvents(restarted.records);
  assertRecordsHaveNoRawValues(restarted.records, rawSiteValues);
  assertNoRawSiteValues(fs.readFileSync(filePath, 'utf8'), rawSiteValues);

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
        rawSiteValues,
      }),
    );
  } finally {
    priorWriter.close();
  }
  assert.equal(readRecoveryJournal(filePath).records.length, recordCountBeforePriorWriterAttempt);

  assertReleaseProofCarriesPreservedRetry({
    productionInspection: retryInspection,
    plan,
    oldRemoteRecovery,
    blockedInspection,
    retryPreservationEvidence,
    rawSiteValues,
  });
});
