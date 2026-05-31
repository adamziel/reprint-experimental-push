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
const prefixedSha256Pattern = /^sha256:[a-f0-9]{64}$/;
const sha256HexPattern = /^[a-f0-9]{64}$/;

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

function assertGeneratedMutationPreconditionOneToOne(testCase, plan) {
  assert.equal(
    plan.preconditions.length,
    plan.mutations.length,
    `${testCase.id} should emit one live-remote precondition per mutation`,
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

function assertLargeReadyPlanShape(testCase) {
  const createRows = Object.entries(testCase.local.db.wp_posts)
    .filter(([id, row]) => !testCase.base.db.wp_posts[id]
      && row.post_title.startsWith('Generated large ready create '));
  const updateRows = Object.entries(testCase.local.db.wp_posts)
    .filter(([id, row]) => testCase.base.db.wp_posts[id]
      && row.post_title.startsWith('Generated large ready update '));
  const deleteRows = Object.entries(testCase.base.db.wp_posts)
    .filter(([id, row]) => row.post_title.startsWith('Base large ready delete ')
      && !testCase.local.db.wp_posts[id]
      && testCase.remote.db.wp_posts[id]);
  const remotePreserveRows = Object.entries(testCase.base.db.wp_posts)
    .filter(([, row]) => row.post_title.startsWith('Base large ready remote preserve '));
  const fileCreates = Object.keys(testCase.local.files)
    .filter((path) => path.includes('/large-ready-create-') && !testCase.base.files[path]);
  const fileUpdates = Object.entries(testCase.local.files)
    .filter(([path, value]) => path.includes('/large-ready-update-')
      && testCase.base.files[path]
      && String(value).startsWith('generated large ready file update '));
  const fileDeletes = Object.keys(testCase.base.files)
    .filter((path) => path.includes('/large-ready-delete-')
      && !testCase.local.files[path]
      && testCase.remote.files[path]);
  const remotePreserveFiles = Object.keys(testCase.base.files)
    .filter((path) => path.includes('/large-ready-remote-preserve-'));
  const termRows = Object.entries(testCase.local.db.wp_terms)
    .filter(([id, row]) => !testCase.base.db.wp_terms[id]
      && row.name.startsWith('Generated term '));
  const taxonomyRows = Object.keys(testCase.local.db.wp_term_taxonomy)
    .filter((id) => !testCase.base.db.wp_term_taxonomy[id]);
  const relationshipRows = Object.keys(testCase.local.db.wp_term_relationships)
    .filter((id) => !testCase.base.db.wp_term_relationships[id]);
  const commentRows = Object.keys(testCase.local.db.wp_comments)
    .filter((id) => !testCase.base.db.wp_comments[id]);

  assert.equal(remotePreserveRows.length, 1, `${testCase.id} should include one remote-only row`);
  assert.equal(remotePreserveFiles.length, 1, `${testCase.id} should include one remote-only file`);
  assert.deepEqual(
    testCase.local.db.wp_posts[remotePreserveRows[0][0]],
    testCase.base.db.wp_posts[remotePreserveRows[0][0]],
    `${testCase.id} remote-only row should be unchanged locally`,
  );
  assert.notDeepEqual(
    testCase.remote.db.wp_posts[remotePreserveRows[0][0]],
    testCase.base.db.wp_posts[remotePreserveRows[0][0]],
    `${testCase.id} remote-only row should drift remotely`,
  );
  assert.equal(
    testCase.local.files[remotePreserveFiles[0]],
    testCase.base.files[remotePreserveFiles[0]],
    `${testCase.id} remote-only file should be unchanged locally`,
  );
  assert.notEqual(
    testCase.remote.files[remotePreserveFiles[0]],
    testCase.base.files[remotePreserveFiles[0]],
    `${testCase.id} remote-only file should drift remotely`,
  );

  return {
    postCreateRows: createRows.map(([id]) => id).sort(),
    postUpdateRows: updateRows.map(([id]) => id).sort(),
    postDeleteRows: deleteRows.map(([id]) => id).sort(),
    fileCreates: fileCreates.sort(),
    fileUpdates: fileUpdates.map(([path]) => path).sort(),
    fileDeletes: fileDeletes.sort(),
    remotePreserveRows: remotePreserveRows.map(([id]) => id).sort(),
    remotePreserveFiles: remotePreserveFiles.sort(),
    termRows: termRows.map(([id]) => id).sort(),
    taxonomyRows: taxonomyRows.sort(),
    relationshipRows: relationshipRows.sort(),
    commentRows: commentRows.sort(),
  };
}

function largeReadyPlanSurfaceCounts(shape) {
  return {
    postCreates: shape.postCreateRows.length,
    postUpdates: shape.postUpdateRows.length,
    postDeletes: shape.postDeleteRows.length,
    fileCreates: shape.fileCreates.length,
    fileUpdates: shape.fileUpdates.length,
    fileDeletes: shape.fileDeletes.length,
    taxonomyTermCreates: shape.termRows.length,
    taxonomyTermTaxonomyCreates: shape.taxonomyRows.length,
    taxonomyRelationshipCreates: shape.relationshipRows.length,
    commentCreates: shape.commentRows.length,
    remoteOnlyRows: shape.remotePreserveRows.length,
    remoteOnlyFiles: shape.remotePreserveFiles.length,
  };
}

function expectedLargeReadyPlanTierSurfaceCounts(tier) {
  return {
    postCreates: 4 + Math.floor(tier / 2),
    postUpdates: 4 + tier,
    postDeletes: 3 + Math.floor(tier / 3),
    fileCreates: 3 + Math.floor(tier / 4),
    fileUpdates: 3 + Math.floor(tier / 3),
    fileDeletes: 2 + Math.floor(tier / 5),
    taxonomyTermCreates: 1,
    taxonomyTermTaxonomyCreates: 1,
    taxonomyRelationshipCreates: 1,
    commentCreates: 2,
    remoteOnlyRows: 1,
    remoteOnlyFiles: 1,
  };
}

function largeReadyPlanExpectedChangeKinds(surfaceCounts) {
  return sortStringObject({
    create: surfaceCounts.postCreates
      + surfaceCounts.fileCreates
      + surfaceCounts.taxonomyTermCreates
      + surfaceCounts.taxonomyTermTaxonomyCreates
      + surfaceCounts.taxonomyRelationshipCreates
      + surfaceCounts.commentCreates,
    delete: surfaceCounts.postDeletes + surfaceCounts.fileDeletes,
    update: surfaceCounts.postUpdates + surfaceCounts.fileUpdates,
  });
}

function largeReadyPlanPlannedResourceKeys(shape) {
  return [
    ...shape.postCreateRows.map((id) => generatedRowResourceKey('wp_posts', id)),
    ...shape.postUpdateRows.map((id) => generatedRowResourceKey('wp_posts', id)),
    ...shape.postDeleteRows.map((id) => generatedRowResourceKey('wp_posts', id)),
    ...shape.termRows.map((id) => generatedRowResourceKey('wp_terms', id)),
    ...shape.taxonomyRows.map((id) => generatedRowResourceKey('wp_term_taxonomy', id)),
    ...shape.relationshipRows.map((id) => generatedRowResourceKey('wp_term_relationships', id)),
    ...shape.commentRows.map((id) => generatedRowResourceKey('wp_comments', id)),
    ...shape.fileCreates.map((path) => `file:${path}`),
    ...shape.fileUpdates.map((path) => `file:${path}`),
    ...shape.fileDeletes.map((path) => `file:${path}`),
  ].sort();
}

function largeReadyPlanRemotePreservationEvidence({ shape, plan, testCase, applied }) {
  const mutationResourceKeys = new Set(plan.mutations.map((mutation) => mutation.resourceKey));
  const preconditionResourceKeys = new Set(plan.preconditions.map((precondition) => precondition.resourceKey));
  const resources = [
    ...shape.remotePreserveRows.map((id) => ({
      resource: { type: 'row', table: 'wp_posts', id },
      resourceKey: generatedRowResourceKey('wp_posts', id),
    })),
    ...shape.remotePreserveFiles.map((path) => ({
      resource: { type: 'file', path },
      resourceKey: `file:${path}`,
    })),
  ].sort((left, right) => left.resourceKey.localeCompare(right.resourceKey));

  return resources.map(({ resource, resourceKey }) => {
    const decision = plan.decisions.find((entry) => entry.resourceKey === resourceKey);
    assert.ok(decision, `${testCase.id} should record a keep-remote decision for ${resourceKey}`);
    assert.equal(decision.decision, 'keep-remote');
    assert.equal(decision.change.localChange, 'unchanged');
    assert.equal(decision.change.remoteChange, 'update');
    assert.equal(mutationResourceKeys.has(resourceKey), false, `${testCase.id} should not mutate ${resourceKey}`);
    assert.equal(preconditionResourceKeys.has(resourceKey), false, `${testCase.id} should not precondition ${resourceKey}`);

    const baseHash = resourceHash(testCase.base, resource);
    const localHash = resourceHash(testCase.local, resource);
    const remoteHash = resourceHash(testCase.remote, resource);
    const appliedHash = resourceHash(applied.site, resource);

    assert.equal(localHash, baseHash, `${testCase.id} local should leave ${resourceKey} unchanged`);
    assert.notEqual(remoteHash, baseHash, `${testCase.id} remote should drift ${resourceKey}`);
    assert.equal(appliedHash, remoteHash, `${testCase.id} apply should preserve remote drift for ${resourceKey}`);

    return {
      resourceKeyHash: `sha256:${digest(resourceKey)}`,
      resourceType: resource.type,
      decision: decision.decision,
      change: decision.change,
      baseHash,
      localHash,
      remoteHash,
      appliedHash,
      plannedMutation: false,
      plannedPrecondition: false,
      decisionHash: `sha256:${digest(decision)}`,
    };
  });
}

function rpp0200LargeReadyPlanStaleValue(resource, currentValue, stalePayload) {
  if (resource.type === 'file') {
    return { type: 'file', content: stalePayload };
  }

  if (currentValue && currentValue !== ABSENT && typeof currentValue === 'object' && !Array.isArray(currentValue)) {
    return {
      ...currentValue,
      __rpp0200LargeReadyPlanStaleReplay: stalePayload,
    };
  }

  return {
    value: currentValue === ABSENT ? 'absent-before-large-ready-release-verifier-v5-replay' : currentValue,
    __rpp0200LargeReadyPlanStaleReplay: stalePayload,
  };
}

function largeReadyPlanReleaseVerifierStaleReplayEvidence(testCase, plan) {
  const mutationIndex = Math.floor(plan.mutations.length / 2);
  const mutation = plan.mutations[mutationIndex];
  const precondition = plan.preconditions.find((entry) => entry.mutationId === mutation?.id);
  const staleRemote = cloneJson(testCase.remote);
  const stalePayload = `stale-private-rpp0200-${testCase.tier}-${mutation?.id}`;
  const plannedValue = deserializeResourceValue(mutation?.value);

  assert.ok(mutation, `${testCase.id} should have a mutation to drift for stale replay`);
  assert.ok(mutationIndex > 0, `${testCase.id} should drift a non-initial mutation`);
  assert.ok(precondition, `${testCase.id} should have a live-remote precondition for ${mutation.resourceKey}`);
  assert.equal(precondition.resourceKey, mutation.resourceKey);
  assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
  assert.equal(resourceHash(staleRemote, mutation.resource), precondition.expectedHash);

  setResource(
    staleRemote,
    mutation.resource,
    rpp0200LargeReadyPlanStaleValue(mutation.resource, getResource(staleRemote, mutation.resource), stalePayload),
  );
  const staleResourceHash = resourceHash(staleRemote, mutation.resource);
  const remoteBeforeHash = digest(staleRemote);
  let beforeMutationCalls = 0;
  const error = captureError(() => applyPlan(staleRemote, plan, {
    beforeMutation() {
      beforeMutationCalls += 1;
    },
  }));
  const remoteAfterHash = digest(staleRemote);

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PRECONDITION_FAILED');
  assert.equal(error.details.resourceKey, mutation.resourceKey);
  assert.equal(error.details.expectedHash, precondition.expectedHash);
  assert.equal(error.details.actualHash, staleResourceHash);
  assert.equal(beforeMutationCalls, 0, `${testCase.id} stale replay reached mutation callback`);
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} stale replay mutated remote before refusal`);

  return {
    mutationIdHash: `sha256:${digest(mutation.id)}`,
    mutationIndex,
    mutationCount: plan.mutations.length,
    preconditionCount: plan.preconditions.length,
    resourceKeyHash: `sha256:${digest(mutation.resourceKey)}`,
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
    remoteBeforeHash,
    remoteAfterHash,
    remoteUnchanged: remoteAfterHash === remoteBeforeHash,
  };
}

function generatedLargeReadyPlanTierReleaseVerifierVariant5CaseEvidence(testCase, result) {
  const shape = assertLargeReadyPlanShape(testCase);
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const applied = applyPlan(cloneJson(testCase.remote), plan);
  const surfaceCounts = largeReadyPlanSurfaceCounts(shape);
  const plannedResourceKeys = largeReadyPlanPlannedResourceKeys(shape);
  const mutationResourceKeys = plan.mutations.map((mutation) => mutation.resourceKey).sort();
  const preconditionResourceKeys = plan.preconditions.map((precondition) => precondition.resourceKey).sort();
  const changeKinds = sortStringObject(plan.mutations.reduce((counts, mutation) => {
    incrementCount(counts, mutation.changeKind);
    return counts;
  }, {}));

  assert.equal(plan.status, 'ready', `${testCase.id} should plan as ready`);
  assert.equal(result.status, 'ready', `${testCase.id} should validate as ready`);
  assert.equal(result.applied, true, `${testCase.id} should apply`);
  assert.equal(result.unplannedRemotePreserved, true, `${testCase.id} should preserve unplanned remote data`);
  assert.equal(result.staleReplayRejected, true, `${testCase.id} should reject stale replay`);
  assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(result.staleReplayRemoteUnchanged, true, `${testCase.id} stale replay should not mutate remote`);
  assertGeneratedMutationPreconditionOneToOne(testCase, plan);
  assert.deepEqual(
    surfaceCounts,
    expectedLargeReadyPlanTierSurfaceCounts(testCase.tier),
    `${testCase.id} large ready surface counts changed`,
  );
  assert.deepEqual(
    mutationResourceKeys,
    plannedResourceKeys,
    `${testCase.id} mutations should match the generated large-ready surface exactly`,
  );
  assert.deepEqual(
    preconditionResourceKeys,
    plannedResourceKeys,
    `${testCase.id} preconditions should match the generated large-ready surface exactly`,
  );
  assert.deepEqual(
    changeKinds,
    largeReadyPlanExpectedChangeKinds(surfaceCounts),
    `${testCase.id} mutation change-kind counts changed`,
  );
  assert.equal(plan.summary.mutations, plannedResourceKeys.length);
  assert.equal(plan.summary.decisions, 2);
  assert.equal(plan.summary.conflicts, 0);
  assert.equal(plan.summary.blockers, 0);
  assert.equal(applied.appliedMutations, plan.mutations.length, `${testCase.id} should apply every mutation`);

  for (const mutation of plan.mutations) {
    assert.equal(
      resourceHash(applied.site, mutation.resource),
      resourceHash(testCase.local, mutation.resource),
      `${testCase.id} did not apply the planned local value for ${mutation.resourceKey}`,
    );
  }

  const remotePreservation = largeReadyPlanRemotePreservationEvidence({
    shape,
    plan,
    testCase,
    applied,
  });
  const staleReplay = largeReadyPlanReleaseVerifierStaleReplayEvidence(testCase, plan);
  const plannedMutations = {
    total: plan.mutations.length,
    preconditions: plan.preconditions.length,
    changeKinds,
    resourceKeySetHash: `sha256:${digest(mutationResourceKeys)}`,
    preconditionResourceKeySetHash: `sha256:${digest(preconditionResourceKeys)}`,
  };
  const releaseVerifier = {
    variant: 5,
    summaryTargetExposed: true,
    gate: 'large-ready-plan-tier',
    surfaceMatchesLargeReadyPlanTier: true,
    plannedResourcesApplied: applied.appliedMutations === plan.mutations.length,
    remoteOnlyDriftPreserved: remotePreservation.every((entry) => entry.appliedHash === entry.remoteHash),
    liveRemotePreconditionsMatchMutations: plan.preconditions.length === plan.mutations.length,
    staleReplayFailsBeforeMutation: staleReplay.preMutationRefusal,
  };
  const releaseCarryThrough = {
    appliedMutations: applied.appliedMutations,
    plannedMutationCount: plan.mutations.length,
    preconditionCount: plan.preconditions.length,
    liveRemotePreconditionsMatchMutations: plan.preconditions.length === plan.mutations.length,
    remoteOnlyPreservationCount: remotePreservation.length,
    remoteOnlyDriftPreserved: releaseVerifier.remoteOnlyDriftPreserved,
    staleReplayPreMutationRefusal: staleReplay.preMutationRefusal,
    staleReplayRemoteUnchanged: staleReplay.remoteUnchanged,
    plannedSurfaceHash: `sha256:${digest({
      mutationResourceKeys,
      preconditionResourceKeys,
      surfaceCounts,
    })}`,
  };

  assert.equal(releaseVerifier.plannedResourcesApplied, true);
  assert.equal(releaseVerifier.remoteOnlyDriftPreserved, true);
  assert.equal(releaseVerifier.liveRemotePreconditionsMatchMutations, true);
  assert.equal(releaseVerifier.staleReplayFailsBeforeMutation, true);

  return {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    status: result.status,
    tags: [...testCase.tags].sort(),
    planSummary: plan.summary,
    applied: result.applied,
    unplannedRemotePreserved: result.unplannedRemotePreserved,
    staleReplayRejected: result.staleReplayRejected,
    staleReplayRejectionCode: result.staleReplayRejectionCode,
    staleReplayRemoteUnchanged: result.staleReplayRemoteUnchanged,
    surfaceCounts,
    plannedMutations,
    remotePreservation,
    staleReplay,
    releaseVerifier,
    releaseCarryThrough: {
      ...releaseCarryThrough,
      proofHash: `sha256:${digest({
        id: testCase.id,
        tier: testCase.tier,
        plannedMutations,
        remotePreservation,
        staleReplay,
        releaseVerifier,
        releaseCarryThrough,
      })}`,
    },
    modelProofHash: `sha256:${digest({
      id: testCase.id,
      tier: testCase.tier,
      surfaceCounts,
      plannedMutations,
      remotePreservation,
      staleReplay,
      releaseVerifier,
      releaseCarryThrough,
      planSummary: plan.summary,
    })}`,
  };
}

function generatedLargeReadyPlanTierReleaseVerifierVariant5Evidence({
  coverage,
  variant4Coverage,
  variant3Coverage,
  legacyCoverage,
}) {
  const perTier = {};
  const statuses = {};
  const cases = [];

  for (const testCase of generatePushHarnessCases()) {
    if (testCase.family !== 'large-ready-plan-tier'
      || !testCase.tags.has('large-ready-plan-release-verifier-v5')) {
      continue;
    }

    const result = validateGeneratedCase(testCase);
    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);
    cases.push(generatedLargeReadyPlanTierReleaseVerifierVariant5CaseEvidence(testCase, result));
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);
  const totalCases = cases.length;

  assert.deepEqual(sortedPerTier, coverage.perTier, 'release-verifier v5 target recount should match summary tiers');
  assert.deepEqual(sortedStatuses, coverage.statuses, 'release-verifier v5 target recount should match summary statuses');
  assert.equal(totalCases, coverage.total, 'release-verifier v5 target recount should match summary total');
  assert.deepEqual(sortedPerTier, variant4Coverage.perTier, 'release-verifier v5 target tiers should match variant 4');
  assert.deepEqual(sortedStatuses, variant4Coverage.statuses, 'release-verifier v5 target statuses should match variant 4');
  assert.equal(totalCases, variant4Coverage.total, 'release-verifier v5 target total should match variant 4');
  assert.deepEqual(sortedPerTier, variant3Coverage.perTier, 'release-verifier v5 target tiers should match variant 3');
  assert.deepEqual(sortedStatuses, variant3Coverage.statuses, 'release-verifier v5 target statuses should match variant 3');
  assert.equal(totalCases, variant3Coverage.total, 'release-verifier v5 target total should match variant 3');
  assert.deepEqual(sortedPerTier, legacyCoverage.perTier, 'release-verifier v5 target tiers should match legacy target');
  assert.deepEqual(sortedStatuses, legacyCoverage.statuses, 'release-verifier v5 target statuses should match legacy target');
  assert.equal(totalCases, legacyCoverage.total, 'release-verifier v5 target total should match legacy target');

  return {
    target: 'largeReadyPlanTierReleaseVerifierVariant5',
    variant4Target: 'largeReadyPlanTierVariant4',
    variant3Target: 'largeReadyPlanTierVariant3',
    legacyTarget: 'largeReadyPlanTier',
    sourceFamily: legacyCoverage.family,
    family: coverage.family,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    releaseVerifier: {
      variant: 5,
      summaryTargetExposed: true,
      gate: 'large-ready-plan-tier',
      allCasesReady: sortedStatuses.ready === totalCases,
      plannedResourcesApplied: true,
      remoteOnlyDriftPreserved: true,
      liveRemotePreconditionsMatchMutations: true,
      staleReplayFailsBeforeMutation: true,
    },
    totalCases,
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    coverageCrossCheck: {
      legacyFamily: legacyCoverage.family,
      variant3Family: variant3Coverage.family,
      variant4Family: variant4Coverage.family,
      legacyTotal: legacyCoverage.total,
      variant3Total: variant3Coverage.total,
      variant4Total: variant4Coverage.total,
    },
    cases: cases.sort((left, right) => left.tier - right.tier || left.id.localeCompare(right.id)),
  };
}

test('RPP-0200 large ready plan tier release-verifier v5 carries ready surface and invariant', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.largeReadyPlanTierReleaseVerifierVariant5;
  const variant4Coverage = report.summary.targetCoverage.largeReadyPlanTierVariant4;
  const variant3Coverage = report.summary.targetCoverage.largeReadyPlanTierVariant3;
  const legacyCoverage = report.summary.targetCoverage.largeReadyPlanTier;

  assert.ok(coverage, 'missing large ready plan tier release-verifier v5 target coverage');
  assert.ok(variant4Coverage, 'missing large ready plan tier variant 4 target coverage');
  assert.ok(variant3Coverage, 'missing large ready plan tier variant 3 target coverage');
  assert.ok(legacyCoverage, 'missing legacy large ready plan tier target coverage');

  const firstEvidence = generatedLargeReadyPlanTierReleaseVerifierVariant5Evidence({
    coverage,
    variant4Coverage,
    variant3Coverage,
    legacyCoverage,
  });
  const replayEvidence = generatedLargeReadyPlanTierReleaseVerifierVariant5Evidence({
    coverage,
    variant4Coverage,
    variant3Coverage,
    legacyCoverage,
  });
  const evidenceEnvelope = {
    command: 'node --test test/rpp-0200-large-ready-plan-tier-release-verifier-v5.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.equal(coverage.family, 'large-ready-plan-tier-release-verifier-v5');
  assert.equal(coverage.total, report.summary.featureFamilies['large-ready-plan-release-verifier-v5']);
  assert.equal(coverage.total, report.summary.featureFamilies['large-ready-plan-release-verifier-v5-ready']);
  assert.equal(coverage.total, legacyCoverage.total);
  assert.equal(coverage.total, variant3Coverage.total);
  assert.equal(coverage.total, variant4Coverage.total);
  assert.equal(coverage.total, 10);
  assert.deepEqual(coverage.statuses, { ready: 10 });
  assert.deepEqual(coverage.perTier, legacyCoverage.perTier);
  assert.deepEqual(coverage.perTier, variant3Coverage.perTier);
  assert.deepEqual(coverage.perTier, variant4Coverage.perTier);
  assert.deepEqual(coverage.statuses, legacyCoverage.statuses);
  assert.deepEqual(coverage.statuses, variant3Coverage.statuses);
  assert.deepEqual(coverage.statuses, variant4Coverage.statuses);
  assert.deepEqual(firstEvidence, replayEvidence, 'release-verifier v5 large ready evidence changed between runs');
  assert.equal(firstEvidence.target, 'largeReadyPlanTierReleaseVerifierVariant5');
  assert.equal(firstEvidence.family, 'large-ready-plan-tier-release-verifier-v5');
  assert.equal(firstEvidence.variant4Target, 'largeReadyPlanTierVariant4');
  assert.equal(firstEvidence.variant3Target, 'largeReadyPlanTierVariant3');
  assert.equal(firstEvidence.legacyTarget, 'largeReadyPlanTier');
  assert.equal(firstEvidence.sourceFamily, 'large-ready-plan-tier');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(firstEvidence.releaseVerifier, {
    variant: 5,
    summaryTargetExposed: true,
    gate: 'large-ready-plan-tier',
    allCasesReady: true,
    plannedResourcesApplied: true,
    remoteOnlyDriftPreserved: true,
    liveRemotePreconditionsMatchMutations: true,
    staleReplayFailsBeforeMutation: true,
  });
  assert.deepEqual(
    firstEvidence.cases.map((entry) => entry.tier),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );

  for (const entry of firstEvidence.cases) {
    const expectedSurface = expectedLargeReadyPlanTierSurfaceCounts(entry.tier);
    const expectedChangeKinds = largeReadyPlanExpectedChangeKinds(expectedSurface);

    assert.equal(entry.status, 'ready', `${entry.id} should remain ready`);
    assert.equal(entry.applied, true, `${entry.id} should apply through the harness`);
    assert.equal(entry.unplannedRemotePreserved, true, `${entry.id} should preserve unplanned remote data`);
    assert.equal(entry.staleReplayRejected, true, `${entry.id} should reject stale replay`);
    assert.equal(entry.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(entry.staleReplayRemoteUnchanged, true, `${entry.id} stale replay should not mutate remote`);
    assert.ok(entry.tags.includes('large-ready-plan-release-verifier-v5'), `${entry.id} should carry the v5 target tag`);
    assert.ok(entry.tags.includes('large-ready-plan-release-verifier-v5-ready'), `${entry.id} should carry the v5 ready tag`);
    assert.deepEqual(entry.surfaceCounts, expectedSurface, `${entry.id} surface counts drifted`);
    assert.deepEqual(entry.plannedMutations.changeKinds, expectedChangeKinds, `${entry.id} mutation kinds drifted`);
    assert.equal(entry.plannedMutations.total, entry.planSummary.mutations);
    assert.equal(entry.plannedMutations.preconditions, entry.plannedMutations.total);
    assert.equal(
      entry.plannedMutations.total,
      Object.values(entry.plannedMutations.changeKinds).reduce((sum, count) => sum + count, 0),
    );
    assert.equal(entry.planSummary.decisions, 2, `${entry.id} should record row and file keep-remote decisions`);
    assert.match(entry.plannedMutations.resourceKeySetHash, prefixedSha256Pattern);
    assert.match(entry.plannedMutations.preconditionResourceKeySetHash, prefixedSha256Pattern);
    assert.equal(
      entry.plannedMutations.resourceKeySetHash,
      entry.plannedMutations.preconditionResourceKeySetHash,
      `${entry.id} precondition surface should match planned mutations`,
    );
    assert.equal(entry.remotePreservation.length, 2, `${entry.id} should preserve one row and one file`);

    for (const remoteEntry of entry.remotePreservation) {
      assert.match(remoteEntry.resourceKeyHash, prefixedSha256Pattern);
      assert.equal(remoteEntry.decision, 'keep-remote');
      assert.equal(remoteEntry.change.localChange, 'unchanged');
      assert.equal(remoteEntry.change.remoteChange, 'update');
      assert.match(remoteEntry.baseHash, sha256HexPattern);
      assert.match(remoteEntry.remoteHash, sha256HexPattern);
      assert.equal(remoteEntry.localHash, remoteEntry.baseHash);
      assert.equal(remoteEntry.appliedHash, remoteEntry.remoteHash);
      assert.notEqual(remoteEntry.remoteHash, remoteEntry.baseHash);
      assert.equal(remoteEntry.plannedMutation, false);
      assert.equal(remoteEntry.plannedPrecondition, false);
      assert.match(remoteEntry.decisionHash, prefixedSha256Pattern);
    }

    assert.deepEqual(entry.releaseVerifier, {
      variant: 5,
      summaryTargetExposed: true,
      gate: 'large-ready-plan-tier',
      surfaceMatchesLargeReadyPlanTier: true,
      plannedResourcesApplied: true,
      remoteOnlyDriftPreserved: true,
      liveRemotePreconditionsMatchMutations: true,
      staleReplayFailsBeforeMutation: true,
    });
    assert.equal(entry.releaseCarryThrough.appliedMutations, entry.planSummary.mutations);
    assert.equal(entry.releaseCarryThrough.plannedMutationCount, entry.planSummary.mutations);
    assert.equal(entry.releaseCarryThrough.preconditionCount, entry.planSummary.mutations);
    assert.equal(entry.releaseCarryThrough.liveRemotePreconditionsMatchMutations, true);
    assert.equal(entry.releaseCarryThrough.remoteOnlyPreservationCount, 2);
    assert.equal(entry.releaseCarryThrough.remoteOnlyDriftPreserved, true);
    assert.equal(entry.releaseCarryThrough.staleReplayPreMutationRefusal, true);
    assert.equal(entry.releaseCarryThrough.staleReplayRemoteUnchanged, true);
    assert.match(entry.releaseCarryThrough.plannedSurfaceHash, prefixedSha256Pattern);
    assert.match(entry.releaseCarryThrough.proofHash, prefixedSha256Pattern);

    assert.equal(entry.staleReplay.code, 'PRECONDITION_FAILED');
    assert.equal(entry.staleReplay.beforeMutationCalls, 0);
    assert.equal(entry.staleReplay.preMutationRefusal, true);
    assert.ok(entry.staleReplay.mutationIndex > 0, `${entry.id} should drift a non-initial mutation`);
    assert.equal(entry.staleReplay.mutationCount, entry.planSummary.mutations);
    assert.equal(entry.staleReplay.preconditionCount, entry.planSummary.mutations);
    assert.equal(entry.staleReplay.remoteBeforeHash, entry.staleReplay.remoteAfterHash);
    assert.equal(entry.staleReplay.remoteUnchanged, true);
    assert.equal(entry.staleReplay.expectedHash, entry.staleReplay.mutationRemoteBeforeHash);
    assert.notEqual(entry.staleReplay.actualHash, entry.staleReplay.expectedHash);
    assert.match(entry.staleReplay.mutationIdHash, prefixedSha256Pattern);
    assert.match(entry.staleReplay.resourceKeyHash, prefixedSha256Pattern);
    assert.match(entry.staleReplay.detailsHash, prefixedSha256Pattern);
    assert.match(entry.staleReplay.plannedValueHash, prefixedSha256Pattern);
    assert.match(entry.staleReplay.preconditionHash, prefixedSha256Pattern);
    assert.match(entry.modelProofHash, prefixedSha256Pattern);
  }

  assert.match(evidenceEnvelope.evidenceHash, prefixedSha256Pattern);
  assert.equal(evidenceText.includes('Generated large ready create'), false, 'RPP-0200 evidence leaked row create title');
  assert.equal(evidenceText.includes('Generated large ready update'), false, 'RPP-0200 evidence leaked row update title');
  assert.equal(evidenceText.includes('Base large ready delete'), false, 'RPP-0200 evidence leaked row delete title');
  assert.equal(evidenceText.includes('Remote large ready preserved'), false, 'RPP-0200 evidence leaked remote row title');
  assert.equal(evidenceText.includes('generated large ready file'), false, 'RPP-0200 evidence leaked file payload');
  assert.equal(evidenceText.includes('remote large ready preserved file'), false, 'RPP-0200 evidence leaked remote file payload');
  assert.equal(evidenceText.includes('stale-private-rpp0200'), false, 'RPP-0200 evidence leaked stale replay payload');
});
