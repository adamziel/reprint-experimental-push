import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createPushPlan } from '../src/planner.js';
import {
  assertJournalRecordHasNoRawValues,
  openProductionRecoveryJournal,
  productionRecoveryJournalInspectionSurfaceIsPresent,
  readRecoveryJournal,
} from '../src/recovery-journal.js';
import {
  inspectRecoveryJournal,
  RECOVERY_INSPECT_REASON_CODES,
} from '../src/recovery-inspect.js';
import { buildDurableRecoveryJournalReleaseProof } from '../scripts/playground/production-shaped-live-release-verify-lib.js';

const fixedNow = new Date('2026-05-31T10:45:00.000Z');
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpp-0690-old-remote-v5-'));
  return path.join(dir, 'recovery.jsonl');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite() {
  const files = {};
  for (let index = 1; index <= 5; index++) {
    files[`rpp-0690-file-${index}.txt`] = `rpp-0690-base-private-value-${index}`;
  }
  return { files, plugins: {}, db: {} };
}

function localSite(base = baseSite()) {
  const site = cloneJson(base);
  for (let index = 1; index <= 5; index++) {
    site.files[`rpp-0690-file-${index}.txt`] = `rpp-0690-local-private-value-${index}`;
  }
  return site;
}

function rawSiteValuesFor(...sites) {
  const values = new Set([
    'rpp-0690-base-private-value',
    'rpp-0690-local-private-value',
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
  const plan = createPushPlan({ base, local, remote, now: fixedNow });

  assert.equal(plan.status, 'ready');
  assert.equal(plan.mutations.length, 5);

  return {
    plan,
    remote,
    rawSiteValues: rawSiteValuesFor(base, local, remote),
  };
}

function assertNoRawSiteValues(value, rawSiteValues) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const rawValue of rawSiteValues) {
    assert.equal(
      serialized.includes(rawValue),
      false,
      `RPP-0690 hash-only evidence leaked raw value: ${rawValue}`,
    );
  }
}

function assertHashOnlyJournal(journal, rawSiteValues) {
  assert.equal(journal.integrity.status, 'ok');
  assert.deepEqual(
    journal.records.map((record) => record.sequence),
    Array.from({ length: journal.records.length }, (_, index) => index + 1),
  );
  assert.equal(
    journal.records.some((record) => mutationPreparationEventTypes.has(record.type)),
    false,
  );
  assert.equal(journal.openState.restartReadable, true);
  for (const record of journal.records) {
    assert.equal(record.fsync.requested, true);
    assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(record));
  }
  assertNoRawSiteValues(journal, rawSiteValues);
}

function assertOldRemoteInspection({ inspection, plan, rawSiteValues }) {
  assert.equal(inspection.status, 'old-remote');
  assert.equal(inspection.reasonCode, RECOVERY_INSPECT_REASON_CODES.oldRemote);
  assert.deepEqual(inspection.counts, {
    old: plan.mutations.length,
    new: 0,
    blockedUnknown: 0,
  });
  assert.deepEqual(inspection.remoteClassification, {
    state: 'old-remote',
    status: 'old-remote',
    evidence: 'hash-only-before-after-target-envelope',
    allTargetsAccountedFor: true,
  });
  assert.deepEqual(inspection.classification, {
    state: 'old-remote',
    reasonCode: RECOVERY_INSPECT_REASON_CODES.oldRemote,
    journalIntegrity: 'ok',
    durableRows: inspection.journal.records.length,
    retry: 'retry-after-revalidation',
    targetEnvelope: {
      total: plan.mutations.length,
      old: plan.mutations.length,
      new: 0,
      blockedUnknown: 0,
    },
  });
  assert.equal(inspection.targets.length, plan.mutations.length);
  for (const target of inspection.targets) {
    assert.equal(target.state, 'old');
    assert.match(target.beforeHash, hashPattern);
    assert.match(target.afterHash, hashPattern);
    assert.match(target.observedHash, hashPattern);
    assert.equal(target.observedHash, target.beforeHash);
    assert.notEqual(target.beforeHash, target.afterHash);
  }
  assertNoRawSiteValues(inspection, rawSiteValues);
}

function openRestartedOldRemoteJournal({ filePath, plan, remote, rawSiteValues }) {
  const artifactRefs = {
    releaseProof: 'artifact://rpp-0690-old-remote-v5-release-proof',
    recoverySupport: 'artifact://rpp-0690-old-remote-v5-support',
  };
  const claimStaleThresholdMs = 2_000;
  const activeClaimId = 'rpp-0690-old-remote-active-claim';
  const retryClaimId = 'rpp-0690-old-remote-retry-claim';

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

  assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(productionInspection), true);
  assert.equal(productionInspection.claim.status, 'advanced');
  assert.equal(productionInspection.claim.activeClaimId, retryClaimId);
  assert.equal(productionInspection.claim.previousClaimId, activeClaimId);
  assert.equal(productionInspection.claim.claimExpiry.previousClaimExpired, true);
  assert.equal(productionInspection.claim.claimExpiry.expired, true);
  assert.equal(productionInspection.claim.claimExpiry.previousClaimAgeMs, 7_000);
  assert.equal(productionInspection.journal.restartReadable, true);
  assert.equal(productionInspection.journal.openState.restartReadable, true);
  assert.equal(productionInspection.journal.ownership.restartReadable, true);
  assert.equal(productionInspection.journal.leaseFence.restartReadable, true);
  assert.deepEqual(productionInspection.journal.checked, [filePath]);
  assertNoRawSiteValues(productionInspection, rawSiteValues);

  const persisted = readRecoveryJournal(filePath);
  assertHashOnlyJournal(persisted, rawSiteValues);
  assert.equal(
    persisted.records.some((record) => record.type === 'mutation-observed'),
    false,
  );
  assert.equal(
    persisted.records.some((record) => record.type === 'journal-completed'),
    false,
  );
  assertNoRawSiteValues(fs.readFileSync(filePath, 'utf8'), rawSiteValues);

  const oldRemoteInspection = inspectRecoveryJournal({
    journal: persisted,
    plan,
    current: remote,
  });
  assertOldRemoteInspection({ inspection: oldRemoteInspection, plan, rawSiteValues });

  return { productionInspection, oldRemoteInspection };
}

function oldRemoteRecoveryFromInspection({ inspection, plan, checkedPath }) {
  return {
    source: 'RPP-0690 focused old remote recovery classification',
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
  const staleClaimRetry = {
    abandoned: {
      status: 500,
      code: 'LAB_SIMULATED_STALE_CLAIM_ALL_OLD',
    },
  };

  if (oldRemoteRecovery) {
    staleClaimRetry.oldRemoteRecovery = oldRemoteRecovery;
    staleClaimRetry.abandoned.recovery = oldRemoteRecovery;
  }

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
          source: 'RPP-0690 different-body conflict recovery state',
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
      staleClaimRetry,
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
    boundary: {
      verdict: 'LIVE_RELEASE_BOUNDARY_OK',
      durableJournal: {
        verdict: 'LIVE_RELEASE_BOUNDARY_OK',
      },
    },
  };
}

function assertReleaseProofRejectsOldRemoteEvidence({
  productionInspection,
  plan,
  oldRemoteRecovery,
  rawSiteValues,
}) {
  const proof = buildDurableRecoveryJournalReleaseProof({
    releaseSummary: buildRecoveryReleaseSummary({
      productionInspection,
      plan,
      oldRemoteRecovery,
    }),
    applyRevalidation: buildBlockedApplyRevalidation(plan),
  });

  assert.equal(proof.gate, 'GATE-2');
  assert.equal(proof.gateStatus, 'proven');
  assert.equal(proof.sameReleaseBoundary, true);
  assert.equal(proof.ok, false);
  assert.equal(proof.checks.oldState, false);
  assert.equal(proof.partialStates.old.proved, false);
  assert.equal(proof.checks.recoveryInspectAfterRestart, true);
  assert.equal(proof.checks.newState, true);
  assert.equal(proof.checks.blockedState, true);
  assert.equal(proof.sameKeyReplayAfterRejection.sameCheckedRecoveryPath, true);
  assertNoRawSiteValues(proof, rawSiteValues);
}

test('RPP-0690 old remote recovery classification variant 5 proves GATE-2 on the same checked path', () => {
  const filePath = tempJournalPath();
  const { plan, remote, rawSiteValues } = buildScenario();
  const {
    productionInspection,
    oldRemoteInspection,
  } = openRestartedOldRemoteJournal({ filePath, plan, remote, rawSiteValues });
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
  assert.equal(releaseSummary.releaseProof.recoveryInspect.recovery.checkedPath, checkedPath);
  assert.equal(releaseSummary.releaseProof.staleClaimRetry.oldRemoteRecovery.targetEnvelope.checkedPath, checkedPath);
  assert.equal(releaseSummary.releaseProof.replayAndRetry.required, checkedPath);
  assert.equal(releaseSummary.releaseProof.replayAndRetry.observed, checkedPath);
  assert.equal(releaseProof.ok, true);
  assert.equal(releaseProof.gate, 'GATE-2');
  assert.equal(releaseProof.durableRecoveryJournalBoundary, 'release-verifier');
  assert.equal(releaseProof.gateStatus, 'proven');
  assert.equal(releaseProof.sameReleaseBoundary, true);
  assert.equal(releaseProof.sourceUrl, 'http://127.0.0.1:8080');
  assert.equal(releaseProof.checks.oldState, true);
  assert.equal(releaseProof.checks.recoveryInspectAfterRestart, true);
  assert.equal(releaseProof.checks.sameKeyReplayAfterRejection, true);
  assert.equal(releaseProof.checks.claimExpiryPolicy, true);
  assert.equal(releaseProof.checks.staleOwnerFencing, true);
  assert.equal(releaseProof.checks.manualRecoveryAuditExport, true);
  assert.equal(releaseProof.partialStates.old.proved, true);
  assert.equal(releaseProof.partialStates.old.source, oldRemoteRecovery.source);
  assert.equal(releaseProof.partialStates.old.state, 'old-remote');
  assert.equal(releaseProof.partialStates.old.observedState, 'old-remote');
  assert.deepEqual(releaseProof.partialStates.old.counts, oldRemoteRecovery.counts);
  assert.equal(releaseProof.recoveryInspectAfterRestart.proved, true);
  assert.equal(releaseProof.recoveryInspectAfterRestart.journalState, 'ok');
  assert.equal(releaseProof.sameKeyReplayAfterRejection.sameCheckedRecoveryPath, true);
  assert.equal(releaseProof.sameKeyReplayAfterRejection.applyStatus, 412);
  assert.equal(releaseProof.sameKeyReplayAfterRejection.applyApplied, 0);
  assert.equal(releaseProof.manualRecoveryAuditExport.proved, true);
  assert.equal(releaseProof.manualRecoveryAuditExport.kind, 'manual-recovery-audit-export');
  assert.equal(releaseProof.manualRecoveryAuditExport.sameReleaseBoundary, true);
  assert.equal(releaseProof.manualRecoveryAuditExport.targetEnvelope.hashOnly, true);
  assert.equal(releaseProof.manualRecoveryAuditExport.targetEnvelope.rawValuesIncluded, false);
  assertNoRawSiteValues(releaseProof, rawSiteValues);
});

test('RPP-0690 old remote release proof rejects missing malformed stale or drifted classification evidence', () => {
  const filePath = tempJournalPath();
  const { plan, remote, rawSiteValues } = buildScenario();
  const {
    productionInspection,
    oldRemoteInspection,
  } = openRestartedOldRemoteJournal({ filePath, plan, remote, rawSiteValues });
  const checkedPath = productionInspection.journal.checked[0];
  const validOldRemoteRecovery = oldRemoteRecoveryFromInspection({
    inspection: oldRemoteInspection,
    plan,
    checkedPath,
  });

  const invalidClassifications = [
    {
      name: 'missing',
      oldRemoteRecovery: null,
    },
    {
      name: 'malformed',
      oldRemoteRecovery: {
        ...validOldRemoteRecovery,
        counts: {
          old: String(plan.mutations.length),
          new: 0,
          blockedUnknown: 0,
          total: plan.mutations.length,
        },
      },
    },
    {
      name: 'stale',
      oldRemoteRecovery: {
        ...validOldRemoteRecovery,
        counts: {
          old: plan.mutations.length - 1,
          new: 0,
          blockedUnknown: 0,
          total: plan.mutations.length - 1,
        },
      },
    },
    {
      name: 'drifted',
      oldRemoteRecovery: {
        ...validOldRemoteRecovery,
        state: 'blocked-recovery',
        observedState: 'blocked-recovery',
        counts: {
          old: plan.mutations.length - 1,
          new: 0,
          blockedUnknown: 1,
          total: plan.mutations.length,
        },
      },
    },
  ];

  for (const classification of invalidClassifications) {
    assertReleaseProofRejectsOldRemoteEvidence({
      productionInspection,
      plan,
      oldRemoteRecovery: classification.oldRemoteRecovery,
      rawSiteValues,
    });
  }
});
