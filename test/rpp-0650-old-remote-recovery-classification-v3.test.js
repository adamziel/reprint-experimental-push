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

const fixedNow = new Date('2026-05-31T09:30:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;

function tempJournalPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpp-0650-old-remote-v3-'));
  return path.join(dir, 'recovery.jsonl');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite() {
  return {
    files: {
      'rpp-0650-alpha.txt': 'rpp-0650-base-private-alpha',
      'rpp-0650-bravo.txt': 'rpp-0650-base-private-bravo',
      'rpp-0650-charlie.txt': 'rpp-0650-base-private-charlie',
    },
    plugins: {},
    db: {},
  };
}

function localSite(base = baseSite()) {
  const site = cloneJson(base);
  site.files['rpp-0650-alpha.txt'] = 'rpp-0650-local-private-alpha';
  site.files['rpp-0650-bravo.txt'] = 'rpp-0650-local-private-bravo';
  site.files['rpp-0650-charlie.txt'] = 'rpp-0650-local-private-charlie';
  return site;
}

function buildScenario() {
  const base = baseSite();
  const local = localSite(base);
  const remote = cloneJson(base);
  const plan = createPushPlan({ base, local, remote, now: fixedNow });

  assert.equal(plan.status, 'ready');
  assert.equal(plan.mutations.length, 3);

  return {
    plan,
    remote,
    rawValues: rawSiteValuesFor(base, local, remote),
  };
}

function rawSiteValuesFor(...sites) {
  const values = new Set([
    'rpp-0650-base-private-alpha',
    'rpp-0650-base-private-bravo',
    'rpp-0650-base-private-charlie',
    'rpp-0650-local-private-alpha',
    'rpp-0650-local-private-bravo',
    'rpp-0650-local-private-charlie',
  ]);
  for (const site of sites) {
    for (const value of Object.values(site.files || {})) {
      values.add(value);
    }
  }
  return [...values];
}

function assertNoRawValues(value, rawValues) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const rawValue of rawValues) {
    assert.equal(
      serialized.includes(rawValue),
      false,
      `RPP-0650 hash-only evidence leaked raw value: ${rawValue}`,
    );
  }
}

function assertHashOnlyJournal(journal, rawValues) {
  assert.equal(journal.integrity.status, 'ok');
  assert.deepEqual(
    journal.records.map((record) => record.sequence),
    Array.from({ length: journal.records.length }, (_, index) => index + 1),
  );
  for (const record of journal.records) {
    assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(record));
  }
  assertNoRawValues(journal, rawValues);
}

function assertOldRemoteInspection({ inspection, plan, rawValues }) {
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
  assertNoRawValues(inspection, rawValues);
}

function openRestartedOldRemoteJournal({ filePath, plan, remote, rawValues }) {
  const artifactRefs = {
    releaseProof: 'artifact://rpp-0650-old-remote-v3-release-proof',
    recoverySupport: 'artifact://rpp-0650-old-remote-v3-support',
  };
  const active = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    now: fixedNow,
    claimId: 'rpp-0650-old-remote-active-claim',
    claimStaleThresholdMs: 2_000,
  });
  active.close();

  const retry = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    now: new Date(fixedNow.getTime() + 7_000),
    truncate: false,
    claimId: 'rpp-0650-old-remote-retry-claim',
    claimStaleThresholdMs: 2_000,
  });
  const productionInspection = retry.inspect();
  retry.close();

  assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(productionInspection), true);
  assert.equal(productionInspection.claim.status, 'advanced');
  assert.equal(productionInspection.claim.claimExpiry.previousClaimExpired, true);
  assert.equal(productionInspection.claim.claimExpiry.expired, true);
  assert.equal(productionInspection.journal.restartReadable, true);
  assert.equal(productionInspection.journal.ownership.restartReadable, true);
  assert.equal(productionInspection.journal.leaseFence.restartReadable, true);
  assert.deepEqual(productionInspection.journal.checked, [filePath]);
  assertNoRawValues(productionInspection, rawValues);

  const persisted = readRecoveryJournal(filePath);
  assertHashOnlyJournal(persisted, rawValues);
  assert.equal(
    persisted.records.some((record) => record.type === 'mutation-observed'),
    false,
  );
  assert.equal(
    persisted.records.some((record) => record.type === 'journal-completed'),
    false,
  );

  const oldRemoteInspection = inspectRecoveryJournal({
    journal: persisted,
    plan,
    current: remote,
  });
  assertOldRemoteInspection({ inspection: oldRemoteInspection, plan, rawValues });

  return { productionInspection, oldRemoteInspection };
}

function oldRemoteRecoveryFromInspection({ inspection, plan, checkedPath }) {
  return {
    source: 'RPP-0650 release-bound old remote recovery classification',
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
  const originalRequestHash = '1'.repeat(64);
  const conflictingRequestHash = '2'.repeat(64);
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
          source: 'RPP-0650 generated different-body conflict recovery state',
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
  rawValues,
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
  assertNoRawValues(proof, rawValues);
}

test('RPP-0650 old remote recovery classification variant 3 proves GATE-2 on the same checked path', () => {
  const filePath = tempJournalPath();
  const { plan, remote, rawValues } = buildScenario();
  const {
    productionInspection,
    oldRemoteInspection,
  } = openRestartedOldRemoteJournal({ filePath, plan, remote, rawValues });
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

  assert.equal(releaseSummary.releaseProof.recoveryInspect.recovery.checkedPath, checkedPath);
  assert.equal(releaseProof.ok, true);
  assert.equal(releaseProof.gate, 'GATE-2');
  assert.equal(releaseProof.gateStatus, 'proven');
  assert.equal(releaseProof.sameReleaseBoundary, true);
  assert.equal(releaseProof.sourceUrl, 'http://127.0.0.1:8080');
  assert.equal(releaseProof.checks.oldState, true);
  assert.equal(releaseProof.checks.recoveryInspectAfterRestart, true);
  assert.equal(releaseProof.checks.sameKeyReplayAfterRejection, true);
  assert.equal(releaseProof.partialStates.old.proved, true);
  assert.equal(releaseProof.partialStates.old.source, oldRemoteRecovery.source);
  assert.equal(releaseProof.partialStates.old.state, 'old-remote');
  assert.equal(releaseProof.partialStates.old.observedState, 'old-remote');
  assert.deepEqual(releaseProof.partialStates.old.counts, oldRemoteRecovery.counts);
  assert.equal(releaseProof.sameKeyReplayAfterRejection.sameCheckedRecoveryPath, true);
  assert.equal(releaseProof.sameKeyReplayAfterRejection.applyStatus, 412);
  assert.equal(releaseProof.sameKeyReplayAfterRejection.applyApplied, 0);
  assert.equal(releaseProof.manualRecoveryAuditExport.kind, 'manual-recovery-audit-export');
  assert.equal(releaseProof.manualRecoveryAuditExport.sameReleaseBoundary, true);
  assert.equal(releaseProof.manualRecoveryAuditExport.targetEnvelope.hashOnly, true);
  assert.equal(releaseProof.manualRecoveryAuditExport.targetEnvelope.rawValuesIncluded, false);
  assertNoRawValues(releaseProof, rawValues);
});

test('RPP-0650 old remote release proof rejects missing malformed stale or drifted classification evidence', () => {
  const filePath = tempJournalPath();
  const { plan, remote, rawValues } = buildScenario();
  const {
    productionInspection,
    oldRemoteInspection,
  } = openRestartedOldRemoteJournal({ filePath, plan, remote, rawValues });
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
      rawValues,
    });
  }
});
