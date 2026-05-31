import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import {
  deserializeResourceValue,
  getResource,
  resourceHash,
  setResource,
} from '../src/resources.js';
import { ABSENT, digest } from '../src/stable-json.js';
import {
  generatePushHarnessCases,
  runGeneratedPushHarness,
  validateGeneratedCase,
} from '../scripts/harness/generated-push-cases.js';

const fixedGeneratedHarnessNow = new Date('2026-05-28T00:00:00.000Z');
const sha256HexPattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function incrementCount(object, key) {
  object[key] = (object[key] || 0) + 1;
}

function sortNumericObject(object) {
  return Object.fromEntries(
    Object.entries(object).sort(([left], [right]) => Number(left) - Number(right)),
  );
}

function sortStringObject(object) {
  return Object.fromEntries(
    Object.entries(object).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function generatedRowResourceKey(table, rowId) {
  return `row:${JSON.stringify([table, rowId])}`;
}

function hashOnlySideEvidence(side) {
  return {
    state: side.state,
    hash: side.hash,
    fileType: side.fileType || null,
  };
}

function hashOnlyChangeEvidence(change) {
  return {
    localChange: change.localChange,
    remoteChange: change.remoteChange,
    base: hashOnlySideEvidence(change.base),
    local: hashOnlySideEvidence(change.local),
    remote: hashOnlySideEvidence(change.remote),
  };
}

function assertGeneratedMutationPreconditionOneToOne(testCase, plan) {
  assert.equal(
    plan.preconditions.length,
    plan.mutations.length,
    `${testCase.id} should emit exactly one live-remote precondition per mutation`,
  );

  const mutationById = new Map();
  for (const mutation of plan.mutations) {
    assert.equal(mutationById.has(mutation.id), false, `${testCase.id} duplicate mutation ${mutation.id}`);
    assert.equal(mutation.resource?.key, mutation.resourceKey, `${testCase.id} mutation resource key mismatch`);
    mutationById.set(mutation.id, mutation);
  }

  const preconditionByMutationId = new Map();
  for (const precondition of plan.preconditions) {
    assert.equal(
      preconditionByMutationId.has(precondition.mutationId),
      false,
      `${testCase.id} duplicate precondition for ${precondition.mutationId}`,
    );
    preconditionByMutationId.set(precondition.mutationId, precondition);
    const mutation = mutationById.get(precondition.mutationId);
    assert.ok(mutation, `${testCase.id} orphan precondition ${precondition.mutationId}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey, `${testCase.id} precondition resource key`);
    assert.deepEqual(precondition.resource, mutation.resource, `${testCase.id} precondition resource`);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash, `${testCase.id} precondition hash`);
    assert.equal(precondition.expectedHash, resourceHash(testCase.remote, mutation.resource), `${testCase.id} remote hash`);
    assert.equal(precondition.checkedAgainst, 'live-remote', `${testCase.id} precondition source`);
  }

  for (const mutation of plan.mutations) {
    assert.ok(preconditionByMutationId.has(mutation.id), `${testCase.id} missing precondition for ${mutation.id}`);
  }
}

function generatedRemoteOnlyPostUpdateTargets(testCase) {
  const rowEntry = Object.entries(testCase.remote.db.wp_posts)
    .find(([id, row]) =>
      testCase.base.db.wp_posts[id]
      && testCase.local.db.wp_posts[id]
      && row.post_title?.startsWith('Remote editorial '));

  assert.ok(rowEntry, `${testCase.id} missing generated remote-only post update`);
  assert.deepEqual(
    testCase.local.db.wp_posts[rowEntry[0]],
    testCase.base.db.wp_posts[rowEntry[0]],
    `${testCase.id} remote-only row should be unchanged locally`,
  );
  assert.notDeepEqual(
    testCase.remote.db.wp_posts[rowEntry[0]],
    testCase.base.db.wp_posts[rowEntry[0]],
    `${testCase.id} remote-only row should drift remotely`,
  );

  return {
    rowId: rowEntry[0],
    remoteTitle: rowEntry[1].post_title,
  };
}

function rpp0199StaleRemoteValue(resource, currentValue, stalePayload) {
  if (resource.type === 'file') {
    return currentValue === ABSENT
      ? stalePayload
      : { type: 'file', content: stalePayload };
  }

  if (resource.type === 'plugin') {
    return {
      ...(currentValue === ABSENT ? {} : currentValue),
      version: stalePayload,
    };
  }

  if (currentValue && currentValue !== ABSENT && typeof currentValue === 'object' && !Array.isArray(currentValue)) {
    return {
      ...currentValue,
      __rpp0199RemoteOnlyPreservationStaleReplay: stalePayload,
    };
  }

  return {
    value: currentValue === ABSENT ? 'absent-before-remote-only-preservation-release-verifier-v5-replay' : currentValue,
    __rpp0199RemoteOnlyPreservationStaleReplay: stalePayload,
  };
}

function generatedRemoteOnlyPreservationReleaseVerifierVariant5CaseEvidence(testCase, result) {
  const { rowId, remoteTitle } = generatedRemoteOnlyPostUpdateTargets(testCase);
  const rowResource = { type: 'row', table: 'wp_posts', id: rowId };
  const rowKey = generatedRowResourceKey('wp_posts', rowId);
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const rowDecision = plan.decisions.find((decision) => decision.resourceKey === rowKey);
  const rowPrecondition = plan.preconditions.find((precondition) => precondition.resourceKey === rowKey);
  const applied = applyPlan(cloneJson(testCase.remote), plan);
  const mutationIndex = plan.mutations.length - 1;
  const mutation = plan.mutations[mutationIndex];
  const precondition = plan.preconditions.find((entry) => entry.mutationId === mutation?.id);
  const plannedValue = deserializeResourceValue(mutation?.value);
  const stalePayload = `stale-private-rpp0199-${testCase.tier}-${mutation?.id}`;
  const staleRemote = cloneJson(testCase.remote);

  assert.equal(plan.status, 'ready', `${testCase.id} release-verifier v5 plan status`);
  assert.equal(result.status, 'ready', `${testCase.id} validation status`);
  assert.equal(result.applied, true, `${testCase.id} validation apply`);
  assert.equal(result.unplannedRemotePreserved, true, `${testCase.id} unplanned remote preservation`);
  assert.equal(result.staleReplayRejected, true, `${testCase.id} generated stale replay rejection`);
  assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED', `${testCase.id} generated stale code`);
  assert.equal(result.staleReplayRemoteUnchanged, true, `${testCase.id} generated stale remote digest`);
  assertGeneratedMutationPreconditionOneToOne(testCase, plan);
  assert.ok(rowDecision, `${testCase.id} missing keep-remote decision`);
  assert.equal(rowDecision.decision, 'keep-remote', `${testCase.id} remote-only row decision`);
  assert.equal(rowDecision.change.localChange, 'unchanged', `${testCase.id} row local change`);
  assert.equal(rowDecision.change.remoteChange, 'update', `${testCase.id} row remote change`);
  assert.equal(plan.mutations.some((entry) => entry.resourceKey === rowKey), false, `${testCase.id} row mutation`);
  assert.equal(rowPrecondition, undefined, `${testCase.id} row precondition`);
  assert.ok(mutation, `${testCase.id} should have a planned mutation to stale after dry-run`);
  assert.ok(mutationIndex > 0, `${testCase.id} should drift a non-leading mutation`);
  assert.equal(mutationIndex, plan.mutations.length - 1, `${testCase.id} should drift the final mutation`);
  assert.ok(precondition, `${testCase.id} missing precondition for final mutation`);
  assert.equal(precondition.resourceKey, mutation.resourceKey, `${testCase.id} stale precondition key`);
  assert.equal(precondition.expectedHash, mutation.remoteBeforeHash, `${testCase.id} stale precondition hash`);
  assert.equal(resourceHash(staleRemote, mutation.resource), precondition.expectedHash, `${testCase.id} dry-run hash`);

  setResource(
    staleRemote,
    mutation.resource,
    rpp0199StaleRemoteValue(mutation.resource, getResource(staleRemote, mutation.resource), stalePayload),
  );
  const staleResourceHash = resourceHash(staleRemote, mutation.resource);
  const staleRemoteBeforeHash = digest(staleRemote);
  let beforeMutationCalls = 0;
  const error = captureError(() => applyPlan(staleRemote, plan, {
    beforeMutation() {
      beforeMutationCalls += 1;
    },
  }));
  const staleRemoteAfterHash = digest(staleRemote);

  assert.ok(error instanceof PushPlanError, `${testCase.id} stale replay should throw PushPlanError`);
  assert.equal(error.code, 'PRECONDITION_FAILED', `${testCase.id} stale replay code`);
  assert.equal(error.details.resourceKey, mutation.resourceKey, `${testCase.id} stale replay resource`);
  assert.equal(error.details.expectedHash, precondition.expectedHash, `${testCase.id} stale expected hash`);
  assert.equal(error.details.actualHash, staleResourceHash, `${testCase.id} stale actual hash`);
  assert.equal(beforeMutationCalls, 0, `${testCase.id} stale replay reached beforeMutation`);
  assert.equal(staleRemoteAfterHash, staleRemoteBeforeHash, `${testCase.id} stale replay mutated remote`);
  assert.equal(resourceHash(applied.site, rowResource), resourceHash(testCase.remote, rowResource));
  assert.equal(JSON.stringify(rowDecision).includes(remoteTitle), false, `${testCase.id} row decision leaked title`);

  const remoteOnly = {
    resourceKey: rowKey,
    decision: rowDecision.decision,
    change: hashOnlyChangeEvidence(rowDecision.change),
    baseHash: resourceHash(testCase.base, rowResource),
    localHash: resourceHash(testCase.local, rowResource),
    remoteHash: resourceHash(testCase.remote, rowResource),
    appliedHash: resourceHash(applied.site, rowResource),
    plannedMutation: false,
    plannedPrecondition: false,
    decisionHash: `sha256:${digest({
      resourceKey: rowDecision.resourceKey,
      decision: rowDecision.decision,
      change: hashOnlyChangeEvidence(rowDecision.change),
    })}`,
  };
  const staleReplay = {
    mutationId: mutation.id,
    mutationIndex,
    mutationCount: plan.mutations.length,
    preconditionCount: plan.preconditions.length,
    resourceKey: mutation.resourceKey,
    resourceType: mutation.resource.type,
    action: mutation.action,
    changeKind: mutation.changeKind,
    code: error.code,
    beforeMutationCalls,
    preMutationRefusal: beforeMutationCalls === 0,
    expectedHash: error.details.expectedHash,
    actualHash: error.details.actualHash,
    mutationRemoteBeforeHash: mutation.remoteBeforeHash,
    plannedValueHash: `sha256:${digest(plannedValue)}`,
    preconditionHash: `sha256:${digest(precondition)}`,
    detailsHash: `sha256:${digest(error.details)}`,
    staleResourceHash,
    remoteBeforeHash: staleRemoteBeforeHash,
    remoteAfterHash: staleRemoteAfterHash,
    remoteUnchanged: staleRemoteAfterHash === staleRemoteBeforeHash,
  };
  const releaseVerifier = {
    variant: 5,
    summaryTargetExposed: true,
    gate: 'remote-only-preservation',
    remoteOnlyRowPreserved: remoteOnly.appliedHash === remoteOnly.remoteHash,
    noLiveRemotePreconditionForRemoteOnlyRow: remoteOnly.plannedPrecondition === false,
    staleReplayFailsBeforeMutation: staleReplay.preMutationRefusal,
  };
  const releaseCarryThrough = {
    appliedMutations: applied.appliedMutations,
    plannedMutationCount: plan.mutations.length,
    preconditionCount: plan.preconditions.length,
    liveRemotePreconditionsMatchMutations: plan.preconditions.length === plan.mutations.length,
    remoteOnlyRowMutation: remoteOnly.plannedMutation,
    remoteOnlyRowPrecondition: remoteOnly.plannedPrecondition,
    remoteOnlyRemoteHash: remoteOnly.remoteHash,
    remoteOnlyAppliedHash: remoteOnly.appliedHash,
    staleReplayPreMutationRefusal: staleReplay.preMutationRefusal,
    staleReplayRemoteUnchanged: staleReplay.remoteUnchanged,
  };

  assert.equal(releaseVerifier.remoteOnlyRowPreserved, true);
  assert.equal(releaseVerifier.noLiveRemotePreconditionForRemoteOnlyRow, true);
  assert.equal(releaseVerifier.staleReplayFailsBeforeMutation, true);
  assert.equal(releaseCarryThrough.liveRemotePreconditionsMatchMutations, true);
  assert.equal(releaseCarryThrough.remoteOnlyAppliedHash, releaseCarryThrough.remoteOnlyRemoteHash);
  assert.equal(releaseCarryThrough.staleReplayRemoteUnchanged, true);

  return {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    status: result.status,
    tags: [...testCase.tags].sort(),
    planSummary: plan.summary,
    applied: result.applied,
    unplannedRemotePreserved: result.unplannedRemotePreserved,
    remoteOnly,
    staleReplay,
    releaseVerifier,
    releaseCarryThrough: {
      ...releaseCarryThrough,
      proofHash: `sha256:${digest({
        id: testCase.id,
        tier: testCase.tier,
        remoteOnly,
        staleReplay,
        releaseVerifier,
        releaseCarryThrough,
      })}`,
    },
    modelProofHash: `sha256:${digest({ remoteOnly, staleReplay, releaseVerifier, releaseCarryThrough })}`,
  };
}

function generatedRemoteOnlyPreservationReleaseVerifierVariant5Evidence({
  coverage,
  legacyCoverage,
  variant3Coverage,
}) {
  const perTier = {};
  const statuses = {};
  const cases = [];

  for (const testCase of generatePushHarnessCases()) {
    if (testCase.family !== 'remote-only-post-update' || !testCase.tags.has('remote-preserve')) {
      continue;
    }

    const result = validateGeneratedCase(testCase);
    const targetMatch = result.status === 'ready'
      && result.applied === true
      && result.unplannedRemotePreserved === true
      && result.staleReplayRejected === true
      && result.staleReplayRejectionCode === 'PRECONDITION_FAILED'
      && result.staleReplayRemoteUnchanged === true;

    if (!targetMatch) {
      continue;
    }

    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);
    cases.push(generatedRemoteOnlyPreservationReleaseVerifierVariant5CaseEvidence(testCase, result));
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);
  const totalCases = Object.values(sortedPerTier).reduce((sum, count) => sum + count, 0);

  assert.deepEqual(sortedPerTier, coverage.perTier, 'release-verifier v5 target recount should match summary tiers');
  assert.deepEqual(sortedStatuses, coverage.statuses, 'release-verifier v5 target recount should match summary statuses');
  assert.equal(totalCases, coverage.total, 'release-verifier v5 target recount should match summary total');
  assert.deepEqual(sortedPerTier, legacyCoverage.perTier, 'release-verifier v5 target recount should match legacy tiers');
  assert.deepEqual(sortedStatuses, legacyCoverage.statuses, 'release-verifier v5 target recount should match legacy statuses');
  assert.equal(totalCases, legacyCoverage.total, 'release-verifier v5 target recount should match legacy total');
  assert.deepEqual(sortedPerTier, variant3Coverage.perTier, 'release-verifier v5 target recount should match variant 3 tiers');
  assert.deepEqual(sortedStatuses, variant3Coverage.statuses, 'release-verifier v5 target recount should match variant 3 statuses');
  assert.equal(totalCases, variant3Coverage.total, 'release-verifier v5 target recount should match variant 3 total');

  return {
    target: 'remoteOnlyPreservationReleaseVerifierVariant5',
    family: coverage.family,
    sourceFamily: legacyCoverage.family,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    releaseVerifier: {
      variant: 5,
      summaryTargetExposed: true,
      gate: 'remote-only-preservation',
      staleReplayFailsBeforeMutation: true,
      remoteOnlyRowPreserved: true,
    },
    totalCases,
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    coverageCrossCheck: {
      legacyFamily: legacyCoverage.family,
      variant3Family: variant3Coverage.family,
      legacyTotal: legacyCoverage.total,
      variant3Total: variant3Coverage.total,
    },
    cases: cases.sort((left, right) => left.tier - right.tier || left.id.localeCompare(right.id)),
  };
}

test('RPP-0199 remote-only preservation release-verifier v5 rejects stale replay before mutation', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.remoteOnlyPreservationReleaseVerifierVariant5;
  const legacyCoverage = report.summary.targetCoverage.remoteOnlyPreservation;
  const variant3Coverage = report.summary.targetCoverage.remoteOnlyPreservationVariant3;

  assert.ok(coverage, 'missing remote-only preservation release-verifier v5 target coverage');
  assert.ok(legacyCoverage, 'missing legacy remote-only preservation coverage');
  assert.ok(variant3Coverage, 'missing variant 3 remote-only preservation coverage');

  const firstEvidence = generatedRemoteOnlyPreservationReleaseVerifierVariant5Evidence({
    coverage,
    legacyCoverage,
    variant3Coverage,
  });
  const replayEvidence = generatedRemoteOnlyPreservationReleaseVerifierVariant5Evidence({
    coverage,
    legacyCoverage,
    variant3Coverage,
  });
  const evidenceEnvelope = {
    command: 'node --test test/rpp-0199-remote-only-preservation-release-verifier-v5.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.equal(coverage.family, 'remote-only-preservation-release-verifier-v5');
  assert.equal(coverage.total, legacyCoverage.total);
  assert.equal(coverage.total, variant3Coverage.total);
  assert.deepEqual(coverage.perTier, legacyCoverage.perTier);
  assert.deepEqual(coverage.perTier, variant3Coverage.perTier);
  assert.deepEqual(coverage.statuses, legacyCoverage.statuses);
  assert.deepEqual(coverage.statuses, variant3Coverage.statuses);
  assert.deepEqual(firstEvidence, replayEvidence, 'release-verifier v5 remote-only evidence changed between runs');
  assert.equal(firstEvidence.target, 'remoteOnlyPreservationReleaseVerifierVariant5');
  assert.equal(firstEvidence.family, 'remote-only-preservation-release-verifier-v5');
  assert.equal(firstEvidence.sourceFamily, 'remote-only-post-update');
  assert.equal(firstEvidence.totalCases, 9);
  assert.deepEqual(firstEvidence.perTier, {
    1: 1,
    2: 1,
    3: 1,
    4: 1,
    5: 1,
    6: 1,
    7: 1,
    8: 1,
    9: 1,
  });
  assert.deepEqual(firstEvidence.statuses, { ready: 9 });
  assert.deepEqual(firstEvidence.releaseVerifier, {
    variant: 5,
    summaryTargetExposed: true,
    gate: 'remote-only-preservation',
    staleReplayFailsBeforeMutation: true,
    remoteOnlyRowPreserved: true,
  });
  assert.deepEqual(
    firstEvidence.cases.map((entry) => entry.tier),
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
  );

  for (const entry of firstEvidence.cases) {
    assert.equal(entry.status, 'ready', `${entry.id} status`);
    assert.equal(entry.applied, true, `${entry.id} applied`);
    assert.equal(entry.unplannedRemotePreserved, true, `${entry.id} unplanned remote preservation`);
    assert.deepEqual(entry.releaseVerifier, {
      variant: 5,
      summaryTargetExposed: true,
      gate: 'remote-only-preservation',
      remoteOnlyRowPreserved: true,
      noLiveRemotePreconditionForRemoteOnlyRow: true,
      staleReplayFailsBeforeMutation: true,
    });
    assert.equal(entry.remoteOnly.decision, 'keep-remote', `${entry.id} remote-only decision`);
    assert.equal(entry.remoteOnly.change.localChange, 'unchanged', `${entry.id} remote-only local change`);
    assert.equal(entry.remoteOnly.change.remoteChange, 'update', `${entry.id} remote-only remote change`);
    assert.equal(entry.remoteOnly.localHash, entry.remoteOnly.baseHash, `${entry.id} local row hash`);
    assert.equal(entry.remoteOnly.appliedHash, entry.remoteOnly.remoteHash, `${entry.id} applied row hash`);
    assert.notEqual(entry.remoteOnly.remoteHash, entry.remoteOnly.baseHash, `${entry.id} remote row drift`);
    assert.equal(entry.remoteOnly.plannedMutation, false, `${entry.id} row mutation flag`);
    assert.equal(entry.remoteOnly.plannedPrecondition, false, `${entry.id} row precondition flag`);
    assert.equal(entry.staleReplay.code, 'PRECONDITION_FAILED', `${entry.id} stale code`);
    assert.equal(entry.staleReplay.beforeMutationCalls, 0, `${entry.id} before mutation calls`);
    assert.equal(entry.staleReplay.preMutationRefusal, true, `${entry.id} pre-mutation refusal`);
    assert.ok(entry.staleReplay.mutationIndex > 0, `${entry.id} should drift a non-leading mutation`);
    assert.equal(
      entry.staleReplay.mutationIndex,
      entry.staleReplay.mutationCount - 1,
      `${entry.id} should drift the final mutation`,
    );
    assert.equal(
      entry.staleReplay.preconditionCount,
      entry.staleReplay.mutationCount,
      `${entry.id} precondition count`,
    );
    assert.equal(
      entry.staleReplay.expectedHash,
      entry.staleReplay.mutationRemoteBeforeHash,
      `${entry.id} stale expected hash`,
    );
    assert.notEqual(
      entry.staleReplay.actualHash,
      entry.staleReplay.expectedHash,
      `${entry.id} stale actual hash`,
    );
    assert.equal(
      entry.staleReplay.remoteAfterHash,
      entry.staleReplay.remoteBeforeHash,
      `${entry.id} stale remote digest`,
    );
    assert.equal(entry.staleReplay.remoteUnchanged, true, `${entry.id} stale remote unchanged`);
    assert.equal(entry.releaseCarryThrough.appliedMutations, entry.planSummary.mutations);
    assert.equal(entry.releaseCarryThrough.plannedMutationCount, entry.planSummary.mutations);
    assert.equal(entry.releaseCarryThrough.preconditionCount, entry.planSummary.mutations);
    assert.equal(entry.releaseCarryThrough.liveRemotePreconditionsMatchMutations, true);
    assert.equal(entry.releaseCarryThrough.remoteOnlyRowMutation, false);
    assert.equal(entry.releaseCarryThrough.remoteOnlyRowPrecondition, false);
    assert.equal(entry.releaseCarryThrough.remoteOnlyAppliedHash, entry.releaseCarryThrough.remoteOnlyRemoteHash);
    assert.equal(entry.releaseCarryThrough.staleReplayPreMutationRefusal, true);
    assert.equal(entry.releaseCarryThrough.staleReplayRemoteUnchanged, true);
    assert.match(entry.remoteOnly.baseHash, sha256HexPattern, `${entry.id} base hash`);
    assert.match(entry.remoteOnly.remoteHash, sha256HexPattern, `${entry.id} remote hash`);
    assert.match(entry.remoteOnly.decisionHash, sha256EvidencePattern, `${entry.id} decision hash`);
    assert.match(entry.staleReplay.plannedValueHash, sha256EvidencePattern, `${entry.id} planned value hash`);
    assert.match(entry.staleReplay.preconditionHash, sha256EvidencePattern, `${entry.id} precondition hash`);
    assert.match(entry.staleReplay.detailsHash, sha256EvidencePattern, `${entry.id} details hash`);
    assert.match(entry.releaseCarryThrough.proofHash, sha256EvidencePattern, `${entry.id} carry-through hash`);
    assert.match(entry.modelProofHash, sha256EvidencePattern, `${entry.id} model proof hash`);
  }

  assert.match(evidenceEnvelope.evidenceHash, sha256EvidencePattern);
  assert.equal(evidenceText.includes('Remote editorial'), false, 'RPP-0199 evidence leaked remote-only row title');
  assert.equal(evidenceText.includes('Remote ready preserve'), false, 'RPP-0199 evidence leaked bulk remote row title');
  assert.equal(evidenceText.includes('stale-private-rpp0199'), false, 'RPP-0199 evidence leaked stale replay payload');
  assert.equal(evidenceText.includes('ready-bulk'), false, 'RPP-0199 evidence leaked generated ready file payload');
});
