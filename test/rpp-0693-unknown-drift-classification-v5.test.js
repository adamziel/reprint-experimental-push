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
import {
  inspectRecoveryRepair,
  replayRecoveryRepair,
  RecoveryRepairError,
} from '../src/recovery-repair.js';
import { setResource } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import { buildDurableRecoveryJournalReleaseProof } from '../scripts/playground/production-shaped-live-release-verify-lib.js';

const fixedNow = new Date('2026-05-31T10:15:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;

const generatedUnknownDriftCases = Object.freeze([
  {
    id: 'rpp-0693-unknown-drift-release-verifier-v5',
    mutationCount: 6,
    driftIndex: 4,
  },
]);

function tempJournalPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpp-0693-unknown-drift-v5-'));
  return path.join(dir, 'recovery.jsonl');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function generatedSites(generatedCase) {
  const preservedKey = `${generatedCase.id}-remote-preserved.txt`;
  const base = {
    files: {
      [preservedKey]: `base-raw-rpp-0693-${generatedCase.id}-remote-preserved`,
    },
    plugins: {},
    db: {},
  };

  for (let index = 1; index <= generatedCase.mutationCount; index++) {
    base.files[`${generatedCase.id}-target-${index}.txt`] =
      `base-raw-rpp-0693-${generatedCase.id}-target-${index}`;
  }

  const local = cloneJson(base);
  const remote = cloneJson(base);
  for (let index = 1; index <= generatedCase.mutationCount; index++) {
    local.files[`${generatedCase.id}-target-${index}.txt`] =
      `local-raw-rpp-0693-${generatedCase.id}-target-${index}`;
  }
  remote.files[preservedKey] =
    `remote-raw-rpp-0693-${generatedCase.id}-preserved-before-plan`;

  const plan = createPushPlan({
    base,
    local,
    remote,
    now: fixedNow,
  });
  assert.equal(plan.status, 'ready');
  assert.equal(plan.mutations.length, generatedCase.mutationCount);

  const driftTargetKey = `${generatedCase.id}-target-${generatedCase.driftIndex}.txt`;
  const retryRemote = cloneJson(remote);
  retryRemote.files[driftTargetKey] =
    `remote-raw-rpp-0693-${generatedCase.id}-target-${generatedCase.driftIndex}-unknown-drift`;
  retryRemote.files[preservedKey] =
    `remote-raw-rpp-0693-${generatedCase.id}-preserved-after-retry-readback`;

  return {
    plan,
    remote,
    retryRemote,
    preservedKey,
    driftTargetKey,
    preservedBeforePlanValue: remote.files[preservedKey],
    preservedAfterRetryValue: retryRemote.files[preservedKey],
    driftedValue: retryRemote.files[driftTargetKey],
    rawValues: rawSiteValuesFor(base, local, remote, retryRemote),
  };
}

function rawSiteValuesFor(...sites) {
  const values = new Set();
  for (const site of sites) {
    for (const value of Object.values(site.files || {})) {
      values.add(value);
    }
  }
  return [...values];
}

function artifactRefsFor(generatedCase) {
  return {
    releaseProof: `artifact://rpp-0693/${generatedCase.id}/release-proof`,
    recoverySupport: `artifact://rpp-0693/${generatedCase.id}/unknown-drift-classification-v5`,
    durabilityScope: `artifact://rpp-0693/${generatedCase.id}/sandbox-jsonl-only`,
  };
}

function claimIdFor(generatedCase, suffix) {
  return `${generatedCase.id}-${suffix}-claim`;
}

function assertPlanPreservesRemoteOnlyResource(plan, preservedKey) {
  const preservedResourceKey = `file:${preservedKey}`;
  const preservedDecision = plan.decisions.find(
    (decision) => decision.resourceKey === preservedResourceKey,
  );

  assert.ok(preservedDecision, 'expected keep-remote decision for preserved resource');
  assert.equal(preservedDecision.decision, 'keep-remote');
  assert.match(preservedDecision.remoteHash, hashPattern);
  assert.equal(
    plan.mutations.some((mutation) => mutation.resourceKey === preservedResourceKey),
    false,
  );
  assert.equal(
    plan.preconditions.some((precondition) => precondition.resourceKey === preservedResourceKey),
    false,
  );
}

function openRetryReadbackUnknownDriftJournal({
  filePath,
  plan,
  remote,
  retryRemote,
  artifactRefs,
  activeClaimId,
  retryClaimId,
  rawValues,
}) {
  const active = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    now: fixedNow,
    truncate: true,
    claimId: activeClaimId,
    claimStaleThresholdMs: 2_000,
  });
  active.close();

  const retry = openProductionRecoveryJournal({
    filePath,
    plan,
    current: retryRemote,
    artifactRefs,
    now: new Date(fixedNow.getTime() + 7_000),
    truncate: false,
    claimId: retryClaimId,
    claimStaleThresholdMs: 2_000,
  });
  const productionInspection = retry.inspect();
  retry.close();

  assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(productionInspection), true);
  assert.equal(productionInspection.claim.activeClaimId, retryClaimId);
  assert.equal(productionInspection.claim.previousClaimId, activeClaimId);
  assert.equal(productionInspection.claim.staleClaimRejected, true);
  assert.equal(productionInspection.claim.claimExpiry.previousClaimExpired, true);
  assert.equal(productionInspection.journal.restartReadable, true);
  assertNoRawValues(productionInspection, rawValues, 'RPP-0693 production inspection');

  const persisted = readRecoveryJournal(filePath);
  assertHashOnlyJournal(persisted, rawValues);

  return { productionInspection, persisted };
}

function assertUnknownDriftInspection({
  inspection,
  plan,
  driftTargetKey,
  rawValues,
}) {
  const driftResourceKey = `file:${driftTargetKey}`;
  const driftTarget = inspection.targets.find(
    (target) => target.resourceKey === driftResourceKey,
  );

  assert.equal(inspection.status, 'blocked-recovery');
  assert.equal(inspection.reasonCode, RECOVERY_INSPECT_REASON_CODES.blockedTargetUnknown);
  assert.deepEqual(inspection.counts, {
    old: plan.mutations.length - 1,
    new: 0,
    blockedUnknown: 1,
  });
  assert.deepEqual(inspection.remoteClassification, {
    state: 'blocked-recovery',
    status: 'blocked-recovery',
    evidence: 'hash-only-before-after-target-envelope',
    allTargetsAccountedFor: true,
  });
  assert.deepEqual(inspection.classification, {
    state: 'blocked-recovery',
    reasonCode: RECOVERY_INSPECT_REASON_CODES.blockedTargetUnknown,
    journalIntegrity: 'ok',
    durableRows: inspection.journal.records.length,
    retry: 'blocked',
    targetEnvelope: {
      total: plan.mutations.length,
      old: plan.mutations.length - 1,
      new: 0,
      blockedUnknown: 1,
    },
  });
  assert.deepEqual(inspection.remoteRecoveryClassification, {
    kind: 'blocked-recovery',
    state: 'blocked-recovery',
    proved: false,
    replaySafe: false,
    counts: {
      old: plan.mutations.length - 1,
      new: 0,
      blockedUnknown: 1,
      total: plan.mutations.length,
    },
    journalState: 'ok',
    storage: 'filesystem',
  });

  assert.ok(driftTarget, 'expected drifted target evidence');
  assert.equal(driftTarget.state, 'blocked-unknown');
  assert.equal(
    driftTarget.reason,
    'Current resource hash is outside the before/after recovery envelope.',
  );
  assert.match(driftTarget.beforeHash, hashPattern);
  assert.match(driftTarget.afterHash, hashPattern);
  assert.match(driftTarget.observedHash, hashPattern);
  assert.notEqual(driftTarget.observedHash, driftTarget.beforeHash);
  assert.notEqual(driftTarget.observedHash, driftTarget.afterHash);

  const oldTargets = inspection.targets.filter((target) => target.resourceKey !== driftResourceKey);
  assert.equal(oldTargets.length, plan.mutations.length - 1);
  for (const target of oldTargets) {
    assert.equal(target.state, 'old');
    assert.equal(target.observedHash, target.beforeHash);
    assert.notEqual(target.observedHash, target.afterHash);
  }

  assertNoRawValues(inspection, rawValues, 'RPP-0693 unknown drift inspection');
  return driftTarget;
}

function assertUnknownDriftRepairBlocksRetry({
  filePath,
  plan,
  retryRemote,
  driftTarget,
  preservedKey,
  preservedAfterRetryValue,
  rawValues,
}) {
  const beforeRetryHash = digest(retryRemote);
  const writes = [];
  const repairInspection = inspectRecoveryRepair({
    journalPath: filePath,
    plan,
    current: retryRemote,
  });

  assert.equal(repairInspection.status, 'blocked-operator-decision-required');
  assert.deepEqual(repairInspection.counts, {
    old: plan.mutations.length - 1,
    new: 0,
    unknown: 1,
    total: plan.mutations.length,
  });
  assert.equal(repairInspection.canRollForward, false);
  assert.equal(repairInspection.requiresOperatorDecision, true);
  assert.equal(repairInspection.driftedTargets.length, 1);
  assert.equal(repairInspection.driftedTargets[0].resourceKey, driftTarget.resourceKey);
  assert.equal(repairInspection.driftedTargets[0].code, 'TARGET_DRIFTED_OUTSIDE_ENVELOPE');
  assert.equal(repairInspection.driftedTargets[0].observedHash, driftTarget.observedHash);

  assert.throws(
    () => replayRecoveryRepair({
      journalPath: filePath,
      plan,
      current: retryRemote,
      mutateCurrent: true,
      writeResource(site, resource, value, context) {
        writes.push({ resourceKey: context.target.resourceKey, value });
        setResource(site, resource, value);
      },
    }),
    (error) => {
      assert.ok(error instanceof RecoveryRepairError);
      assert.equal(error.code, 'RECOVERY_REPAIR_OPERATOR_DECISION_REQUIRED');
      assert.equal(error.details.driftedTargets.length, 1);
      assert.equal(error.details.driftedTargets[0].resourceKey, driftTarget.resourceKey);
      assert.equal(error.details.driftedTargets[0].observedHash, driftTarget.observedHash);
      assertNoRawValues(error.details, rawValues, 'RPP-0693 repair refusal details');
      return true;
    },
  );

  assert.deepEqual(writes, []);
  assert.equal(digest(retryRemote), beforeRetryHash);
  assert.equal(retryRemote.files[preservedKey], preservedAfterRetryValue);
  assertNoRawValues(repairInspection, rawValues, 'RPP-0693 repair inspection');

  return repairInspection;
}

function preservedRemoteRetryEvidence({
  preservedKey,
  preservedBeforePlanValue,
  preservedAfterRetryValue,
  checkedPath,
}) {
  return {
    resourceKey: `file:${preservedKey}`,
    beforePlanHash: digest(preservedBeforePlanValue),
    afterRetryHash: digest(preservedAfterRetryValue),
    hashOnly: true,
    rawValuesIncluded: false,
    overwritten: false,
    sameCheckedRecoveryPath: true,
    checkedPath,
  };
}

function oldRemoteRecoveryFromInspection({ inspection, plan, checkedPath }) {
  return {
    source: 'RPP-0693 release-verifier old remote recovery classification',
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

function unknownDriftRecoveryFromInspection({ inspection, plan, checkedPath }) {
  return {
    source: 'RPP-0693 release-verifier unknown drift recovery classification',
    status: 200,
    state: inspection.status,
    observedState: inspection.remoteClassification.state,
    reasonCode: inspection.reasonCode,
    evidence: inspection.remoteClassification.evidence,
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
      driftedTargets: inspection.targets
        .filter((target) => target.state === 'blocked-unknown')
        .map(publicTargetSummary),
    },
  };
}

function buildRecoveryReleaseSummary({
  productionInspection,
  plan,
  oldRemoteRecovery,
  preservedRetryEvidence,
}) {
  const mutationEvents = plan.mutations.length;
  const originalRequestHash = '5'.repeat(64);
  const conflictingRequestHash = '6'.repeat(64);
  const checkedPath = productionInspection.journal.checked[0];
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
      code: 'LAB_SIMULATED_STALE_CLAIM_UNKNOWN_DRIFT',
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
          source: 'RPP-0693 generated different-body conflict recovery state',
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
        preservedRemote: preservedRetryEvidence || null,
      },
    },
  };
}

function buildBlockedApplyRevalidation(plan, unknownDriftRecovery) {
  const recovery = unknownDriftRecovery || {
    state: 'old-remote',
    counts: {
      old: plan.mutations.length,
      new: 0,
      blockedUnknown: 0,
      total: plan.mutations.length,
    },
  };

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
      recovery,
    },
    dbJournal: {
      ordering: {
        ordered: true,
        applyRejected: 30,
        applyReplayed: 31,
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

function buildReleaseProofWithUnknownDriftEvidence({
  productionInspection,
  plan,
  oldRemoteRecovery,
  unknownDriftRecovery,
  expectedUnknownDriftRecovery,
  checkedPath,
  preservedRetryEvidence,
}) {
  const movement = validateUnknownDriftRecoveryEvidence(unknownDriftRecovery, {
    expected: expectedUnknownDriftRecovery,
    plan,
    checkedPath,
  });
  const releaseProof = buildDurableRecoveryJournalReleaseProof({
    releaseSummary: buildRecoveryReleaseSummary({
      productionInspection,
      plan,
      oldRemoteRecovery,
      preservedRetryEvidence,
    }),
    applyRevalidation: buildBlockedApplyRevalidation(
      plan,
      movement.accepted ? movement.recovery : null,
    ),
  });

  return { movement, releaseProof };
}

function validateUnknownDriftRecoveryEvidence(candidate, {
  expected,
  plan,
  checkedPath,
}) {
  if (!candidate || typeof candidate !== 'object') {
    return { accepted: false, reason: 'missing', recovery: null };
  }

  const counts = candidate.counts || {};
  const envelope = candidate.targetEnvelope || {};
  const driftedTargets = Array.isArray(envelope.driftedTargets)
    ? envelope.driftedTargets
    : [];
  const expectedDriftedTargets = expected.targetEnvelope.driftedTargets;
  const commonChecks = [
    candidate.state === 'blocked-recovery',
    candidate.observedState === 'blocked-recovery',
    candidate.reasonCode === RECOVERY_INSPECT_REASON_CODES.blockedTargetUnknown,
    candidate.evidence === 'hash-only-before-after-target-envelope',
    counts.old === plan.mutations.length - 1,
    counts.new === 0,
    counts.blockedUnknown === 1,
    counts.total === plan.mutations.length,
    envelope.old === counts.old,
    envelope.new === counts.new,
    envelope.blockedUnknown === counts.blockedUnknown,
    envelope.total === counts.total,
    envelope.hashOnly === true,
    envelope.rawValuesIncluded === false,
    envelope.checkedPath === checkedPath,
    envelope.allTargetsAccountedFor === true,
    driftedTargets.length === 1,
    expectedDriftedTargets.length === 1,
  ];

  if (!commonChecks.every(Boolean)) {
    return { accepted: false, reason: 'classification-envelope-invalid', recovery: null };
  }

  const [actualTarget] = driftedTargets;
  const [expectedTarget] = expectedDriftedTargets;
  const targetMatches = actualTarget.resourceKey === expectedTarget.resourceKey
    && actualTarget.mutationId === expectedTarget.mutationId
    && actualTarget.state === 'blocked-unknown'
    && actualTarget.code === 'TARGET_DRIFTED_OUTSIDE_ENVELOPE'
    && actualTarget.beforeHash === expectedTarget.beforeHash
    && actualTarget.afterHash === expectedTarget.afterHash
    && actualTarget.observedHash === expectedTarget.observedHash
    && hashPattern.test(actualTarget.beforeHash)
    && hashPattern.test(actualTarget.afterHash)
    && hashPattern.test(actualTarget.observedHash)
    && actualTarget.observedHash !== actualTarget.beforeHash
    && actualTarget.observedHash !== actualTarget.afterHash;

  if (!targetMatches) {
    return { accepted: false, reason: 'classification-target-drifted', recovery: null };
  }

  return { accepted: true, reason: 'accepted', recovery: candidate };
}

function assertReleaseProofRejectsUnknownDriftEvidence({
  productionInspection,
  plan,
  oldRemoteRecovery,
  invalidUnknownDriftRecovery,
  expectedUnknownDriftRecovery,
  checkedPath,
  rawValues,
  expectedReason,
}) {
  const { movement, releaseProof } = buildReleaseProofWithUnknownDriftEvidence({
    productionInspection,
    plan,
    oldRemoteRecovery,
    unknownDriftRecovery: invalidUnknownDriftRecovery,
    expectedUnknownDriftRecovery,
    checkedPath,
  });

  assert.equal(movement.accepted, false);
  assert.equal(movement.reason, expectedReason);
  assert.equal(releaseProof.ok, false);
  assert.equal(releaseProof.gate, 'GATE-2');
  assert.equal(releaseProof.gateStatus, 'proven');
  assert.equal(releaseProof.checks.oldState, true);
  assert.equal(releaseProof.checks.newState, true);
  assert.equal(releaseProof.checks.blockedState, false);
  assert.equal(releaseProof.partialStates.blocked.proved, false);
  assert.equal(releaseProof.partialStates.blocked.state, 'old-remote');
  assertNoRawValues(releaseProof, rawValues, 'RPP-0693 rejected release proof');
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
  assertNoRawValues(journal, rawValues, 'RPP-0693 journal rows');
}

function assertNoRawValues(value, rawValues, label) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const rawValue of rawValues) {
    assert.equal(
      serialized.includes(rawValue),
      false,
      `${label} leaked raw fixture value: ${rawValue}`,
    );
  }
}

function publicTargetSummary(target) {
  return {
    mutationId: target.mutationId,
    resourceKey: target.resourceKey,
    state: target.state,
    code: target.state === 'blocked-unknown'
      ? 'TARGET_DRIFTED_OUTSIDE_ENVELOPE'
      : target.code || null,
    beforeHash: target.beforeHash ?? null,
    afterHash: target.afterHash ?? null,
    observedHash: target.observedHash ?? null,
  };
}

test('RPP-0693 generated unknown drift classification variant 5 preserves remote changes on retry', () => {
  const generatedCase = generatedUnknownDriftCases[0];
  const filePath = tempJournalPath();
  const artifactRefs = artifactRefsFor(generatedCase);
  const activeClaimId = claimIdFor(generatedCase, 'active');
  const retryClaimId = claimIdFor(generatedCase, 'retry');
  const {
    plan,
    remote,
    retryRemote,
    preservedKey,
    driftTargetKey,
    preservedBeforePlanValue,
    preservedAfterRetryValue,
    driftedValue,
    rawValues,
  } = generatedSites(generatedCase);

  assertPlanPreservesRemoteOnlyResource(plan, preservedKey);
  assert.equal(remote.files[preservedKey], preservedBeforePlanValue);
  assert.equal(retryRemote.files[preservedKey], preservedAfterRetryValue);
  assert.notEqual(preservedBeforePlanValue, preservedAfterRetryValue);
  assert.equal(retryRemote.files[driftTargetKey], driftedValue);

  const {
    productionInspection,
    persisted,
  } = openRetryReadbackUnknownDriftJournal({
    filePath,
    plan,
    remote,
    retryRemote,
    artifactRefs,
    activeClaimId,
    retryClaimId,
    rawValues,
  });
  const checkedPath = productionInspection.journal.checked[0];
  const inspection = inspectRecoveryJournal({
    journal: persisted,
    plan,
    current: retryRemote,
  });
  const driftTarget = assertUnknownDriftInspection({
    inspection,
    plan,
    driftTargetKey,
    rawValues,
  });

  const repairInspection = assertUnknownDriftRepairBlocksRetry({
    filePath,
    plan,
    retryRemote,
    driftTarget,
    preservedKey,
    preservedAfterRetryValue,
    rawValues,
  });
  assert.equal(repairInspection.claim.activeClaimId, retryClaimId);

  const oldRemoteInspection = inspectRecoveryJournal({
    journal: persisted,
    plan,
    current: remote,
  });
  assert.equal(oldRemoteInspection.status, 'old-remote');
  assert.deepEqual(oldRemoteInspection.counts, {
    old: plan.mutations.length,
    new: 0,
    blockedUnknown: 0,
  });

  const oldRemoteRecovery = oldRemoteRecoveryFromInspection({
    inspection: oldRemoteInspection,
    plan,
    checkedPath,
  });
  const unknownDriftRecovery = unknownDriftRecoveryFromInspection({
    inspection,
    plan,
    checkedPath,
  });
  const preservedRetryEvidence = preservedRemoteRetryEvidence({
    preservedKey,
    preservedBeforePlanValue,
    preservedAfterRetryValue,
    checkedPath,
  });
  const {
    movement,
    releaseProof,
  } = buildReleaseProofWithUnknownDriftEvidence({
    productionInspection,
    plan,
    oldRemoteRecovery,
    unknownDriftRecovery,
    expectedUnknownDriftRecovery: unknownDriftRecovery,
    checkedPath,
    preservedRetryEvidence,
  });

  assert.equal(movement.accepted, true);
  assert.equal(releaseProof.ok, true);
  assert.equal(releaseProof.gate, 'GATE-2');
  assert.equal(releaseProof.durableRecoveryJournalBoundary, 'release-verifier');
  assert.equal(releaseProof.gateStatus, 'proven');
  assert.equal(releaseProof.sameReleaseBoundary, true);
  assert.equal(releaseProof.checks.oldState, true);
  assert.equal(releaseProof.checks.newState, true);
  assert.equal(releaseProof.checks.blockedState, true);
  assert.equal(releaseProof.checks.preservedRejectedRemoteEvidence, true);
  assert.equal(releaseProof.partialStates.blocked.proved, true);
  assert.equal(releaseProof.partialStates.blocked.state, 'blocked-recovery');
  assert.deepEqual(releaseProof.partialStates.blocked.counts, unknownDriftRecovery.counts);
  assert.equal(releaseProof.sameKeyReplayAfterRejection.proved, true);
  assert.equal(releaseProof.sameKeyReplayAfterRejection.preservedRemoteUnchanged, true);
  assert.equal(
    releaseProof.preservedRejectedRemoteEvidence.replayAndRetry.preservedRemote.overwritten,
    false,
  );
  assert.equal(
    releaseProof.preservedRejectedRemoteEvidence.replayAndRetry.preservedRemote.sameCheckedRecoveryPath,
    true,
  );
  assert.match(
    releaseProof.preservedRejectedRemoteEvidence.replayAndRetry.preservedRemote.beforePlanHash,
    hashPattern,
  );
  assert.match(
    releaseProof.preservedRejectedRemoteEvidence.replayAndRetry.preservedRemote.afterRetryHash,
    hashPattern,
  );
  assert.notEqual(
    releaseProof.preservedRejectedRemoteEvidence.replayAndRetry.preservedRemote.beforePlanHash,
    releaseProof.preservedRejectedRemoteEvidence.replayAndRetry.preservedRemote.afterRetryHash,
  );
  assert.equal(releaseProof.preservedRejectedRemoteEvidence.proved, true);
  assert.equal(releaseProof.manualRecoveryAuditExport.targetEnvelope.hashOnly, true);
  assert.equal(releaseProof.manualRecoveryAuditExport.targetEnvelope.rawValuesIncluded, false);
  assertNoRawValues(
    {
      journal: persisted,
      inspection,
      repairInspection,
      oldRemoteRecovery,
      unknownDriftRecovery,
      preservedRetryEvidence,
      releaseProof,
    },
    rawValues,
    'RPP-0693 generated unknown drift proof',
  );
});

test('RPP-0693 unknown drift release proof rejects missing malformed stale or drifted evidence', () => {
  const generatedCase = generatedUnknownDriftCases[0];
  const filePath = tempJournalPath();
  const artifactRefs = artifactRefsFor(generatedCase);
  const {
    plan,
    remote,
    retryRemote,
    driftTargetKey,
    rawValues,
  } = generatedSites(generatedCase);
  const {
    productionInspection,
    persisted,
  } = openRetryReadbackUnknownDriftJournal({
    filePath,
    plan,
    remote,
    retryRemote,
    artifactRefs,
    activeClaimId: claimIdFor(generatedCase, 'invalid-active'),
    retryClaimId: claimIdFor(generatedCase, 'invalid-retry'),
    rawValues,
  });
  const checkedPath = productionInspection.journal.checked[0];
  const inspection = inspectRecoveryJournal({
    journal: persisted,
    plan,
    current: retryRemote,
  });
  assertUnknownDriftInspection({
    inspection,
    plan,
    driftTargetKey,
    rawValues,
  });

  const oldRemoteInspection = inspectRecoveryJournal({
    journal: persisted,
    plan,
    current: remote,
  });
  const oldRemoteRecovery = oldRemoteRecoveryFromInspection({
    inspection: oldRemoteInspection,
    plan,
    checkedPath,
  });
  const validUnknownDriftRecovery = unknownDriftRecoveryFromInspection({
    inspection,
    plan,
    checkedPath,
  });
  const validTarget = validUnknownDriftRecovery.targetEnvelope.driftedTargets[0];

  const invalidClassifications = [
    {
      name: 'missing',
      reason: 'missing',
      unknownDriftRecovery: null,
    },
    {
      name: 'malformed',
      reason: 'classification-envelope-invalid',
      unknownDriftRecovery: {
        ...validUnknownDriftRecovery,
        counts: {
          ...validUnknownDriftRecovery.counts,
          blockedUnknown: '1',
        },
      },
    },
    {
      name: 'stale',
      reason: 'classification-envelope-invalid',
      unknownDriftRecovery: {
        ...validUnknownDriftRecovery,
        counts: {
          old: plan.mutations.length - 2,
          new: 0,
          blockedUnknown: 1,
          total: plan.mutations.length - 1,
        },
        targetEnvelope: {
          ...validUnknownDriftRecovery.targetEnvelope,
          old: plan.mutations.length - 2,
          total: plan.mutations.length - 1,
        },
      },
    },
    {
      name: 'drifted',
      reason: 'classification-target-drifted',
      unknownDriftRecovery: {
        ...validUnknownDriftRecovery,
        targetEnvelope: {
          ...validUnknownDriftRecovery.targetEnvelope,
          driftedTargets: [
            {
              ...validTarget,
              observedHash: '7'.repeat(64),
            },
          ],
        },
      },
    },
  ];

  for (const classification of invalidClassifications) {
    assertReleaseProofRejectsUnknownDriftEvidence({
      productionInspection,
      plan,
      oldRemoteRecovery,
      invalidUnknownDriftRecovery: classification.unknownDriftRecovery,
      expectedUnknownDriftRecovery: validUnknownDriftRecovery,
      checkedPath,
      rawValues,
      expectedReason: classification.reason,
    });
  }
});
