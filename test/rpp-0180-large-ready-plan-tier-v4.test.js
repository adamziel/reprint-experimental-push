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

function incrementCount(map, key) {
  map[key] = (map[key] || 0) + 1;
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

function generatedRowResourceKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
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

function largeReadyPlanStaleReplayEvidence(testCase, plan) {
  const mutationIndex = Math.floor(plan.mutations.length / 2);
  const mutation = plan.mutations[mutationIndex];
  const precondition = plan.preconditions.find((entry) => entry.mutationId === mutation?.id);
  const staleRemote = cloneJson(testCase.remote);
  const stalePayload = `stale-private-rpp0180-v4-${testCase.tier}-${mutation?.id}`;
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
    rpp0180LargeReadyPlanStaleValue(mutation.resource, getResource(staleRemote, mutation.resource), stalePayload),
  );
  const staleResourceHash = resourceHash(staleRemote, mutation.resource);
  const remoteBeforeHash = digest(staleRemote);
  const error = captureError(() => applyPlan(staleRemote, plan));
  const remoteAfterHash = digest(staleRemote);

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PRECONDITION_FAILED');
  assert.equal(error.details.resourceKey, mutation.resourceKey);
  assert.equal(error.details.expectedHash, precondition.expectedHash);
  assert.equal(error.details.actualHash, staleResourceHash);
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} stale replay mutated remote before refusal`);

  return {
    mutationIdHash: `sha256:${digest(mutation.id)}`,
    mutationIndex,
    resourceKeyHash: `sha256:${digest(mutation.resourceKey)}`,
    action: mutation.action,
    changeKind: mutation.changeKind,
    code: error.code,
    expectedHash: error.details.expectedHash,
    actualHash: error.details.actualHash,
    mutationRemoteBeforeHash: mutation.remoteBeforeHash,
    plannedValueHash: `sha256:${digest(plannedValue)}`,
    preconditionHash: `sha256:${digest(precondition)}`,
    detailsHash: `sha256:${digest(error.details)}`,
    remoteBeforeHash,
    remoteAfterHash,
  };
}

function rpp0180LargeReadyPlanStaleValue(resource, currentValue, stalePayload) {
  if (resource.type === 'file') {
    return { type: 'file', content: stalePayload };
  }

  if (currentValue && currentValue !== ABSENT && typeof currentValue === 'object' && !Array.isArray(currentValue)) {
    return {
      ...currentValue,
      __rpp0180LargeReadyPlanStaleReplay: stalePayload,
    };
  }

  return {
    value: currentValue === ABSENT ? 'absent-before-large-ready-replay' : currentValue,
    __rpp0180LargeReadyPlanStaleReplay: stalePayload,
  };
}

function generatedLargeReadyPlanTierVariant4CaseEvidence(testCase, result) {
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
  const staleReplay = largeReadyPlanStaleReplayEvidence(testCase, plan);
  const plannedMutations = {
    total: plan.mutations.length,
    preconditions: plan.preconditions.length,
    changeKinds,
    resourceKeySetHash: `sha256:${digest(mutationResourceKeys)}`,
    preconditionResourceKeySetHash: `sha256:${digest(preconditionResourceKeys)}`,
  };

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
    modelProofHash: `sha256:${digest({
      id: testCase.id,
      tier: testCase.tier,
      surfaceCounts,
      plannedMutations,
      remotePreservation,
      staleReplay,
      planSummary: plan.summary,
    })}`,
  };
}

function generatedLargeReadyPlanTierVariant4Evidence(targetCoverage, variant3Coverage, legacyCoverage) {
  const perTier = {};
  const statuses = {};
  const cases = [];

  for (const testCase of generatePushHarnessCases()) {
    if (testCase.family !== 'large-ready-plan-tier'
      || !testCase.tags.has('large-ready-plan-v4')) {
      continue;
    }

    const result = validateGeneratedCase(testCase);
    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);
    cases.push(generatedLargeReadyPlanTierVariant4CaseEvidence(testCase, result));
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);
  const totalCases = cases.length;

  assert.deepEqual(sortedPerTier, targetCoverage.perTier, 'variant 4 target recount should match summary tiers');
  assert.deepEqual(sortedStatuses, targetCoverage.statuses, 'variant 4 target recount should match summary statuses');
  assert.equal(totalCases, targetCoverage.total, 'variant 4 target recount should match summary total');
  assert.deepEqual(sortedPerTier, variant3Coverage.perTier, 'variant 4 target tiers should match variant 3');
  assert.deepEqual(sortedStatuses, variant3Coverage.statuses, 'variant 4 target statuses should match variant 3');
  assert.equal(totalCases, variant3Coverage.total, 'variant 4 target total should match variant 3');
  assert.deepEqual(sortedPerTier, legacyCoverage.perTier, 'variant 4 target tiers should match legacy large-ready target');
  assert.deepEqual(sortedStatuses, legacyCoverage.statuses, 'variant 4 target statuses should match legacy large-ready target');
  assert.equal(totalCases, legacyCoverage.total, 'variant 4 target total should match legacy large-ready target');

  return {
    target: 'largeReadyPlanTierVariant4',
    variant3Target: 'largeReadyPlanTierVariant3',
    legacyTarget: 'largeReadyPlanTier',
    family: targetCoverage.family,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    totalCases,
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    cases: cases.sort((left, right) => left.tier - right.tier || left.id.localeCompare(right.id)),
  };
}

test('RPP-0180 large ready plan tier variant 4 records surface and invariant', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.largeReadyPlanTierVariant4;
  const variant3Coverage = report.summary.targetCoverage.largeReadyPlanTierVariant3;
  const legacyCoverage = report.summary.targetCoverage.largeReadyPlanTier;

  assert.ok(coverage, 'missing large ready plan tier variant 4 target coverage');
  assert.ok(variant3Coverage, 'missing variant 3 large ready plan tier target coverage');
  assert.ok(legacyCoverage, 'missing legacy large ready plan tier target coverage');

  const firstEvidence = generatedLargeReadyPlanTierVariant4Evidence(coverage, variant3Coverage, legacyCoverage);
  const replayEvidence = generatedLargeReadyPlanTierVariant4Evidence(coverage, variant3Coverage, legacyCoverage);
  const evidenceEnvelope = {
    command: 'node --test test/rpp-0180-large-ready-plan-tier-v4.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.equal(coverage.family, 'large-ready-plan-tier-variant4');
  assert.equal(coverage.total, report.summary.featureFamilies['large-ready-plan-v4']);
  assert.equal(coverage.total, report.summary.featureFamilies['large-ready-plan-v4-ready']);
  assert.equal(coverage.total, 10);
  assert.deepEqual(coverage.statuses, { ready: 10 });
  assert.deepEqual(
    Object.keys(coverage.perTier).map(Number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.deepEqual(coverage.perTier, variant3Coverage.perTier);
  assert.deepEqual(coverage.statuses, variant3Coverage.statuses);
  assert.equal(coverage.total, variant3Coverage.total);
  assert.deepEqual(coverage.perTier, legacyCoverage.perTier);
  assert.deepEqual(coverage.statuses, legacyCoverage.statuses);
  assert.equal(coverage.total, legacyCoverage.total);
  assert.deepEqual(firstEvidence, replayEvidence, 'variant 4 large ready evidence changed between runs');
  assert.equal(firstEvidence.target, 'largeReadyPlanTierVariant4');
  assert.equal(firstEvidence.family, 'large-ready-plan-tier-variant4');
  assert.equal(firstEvidence.variant3Target, 'largeReadyPlanTierVariant3');
  assert.equal(firstEvidence.legacyTarget, 'largeReadyPlanTier');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
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
    assert.ok(entry.tags.includes('large-ready-plan-v4'), `${entry.id} should carry the variant-4 target tag`);
    assert.ok(entry.tags.includes('large-ready-plan-v4-ready'), `${entry.id} should carry the variant-4 ready tag`);
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
      assert.equal(remoteEntry.localHash, remoteEntry.baseHash);
      assert.equal(remoteEntry.appliedHash, remoteEntry.remoteHash);
      assert.notEqual(remoteEntry.remoteHash, remoteEntry.baseHash);
      assert.equal(remoteEntry.plannedMutation, false);
      assert.equal(remoteEntry.plannedPrecondition, false);
      assert.match(remoteEntry.decisionHash, prefixedSha256Pattern);
    }

    assert.equal(entry.staleReplay.code, 'PRECONDITION_FAILED');
    assert.ok(entry.staleReplay.mutationIndex > 0, `${entry.id} should drift a non-initial mutation`);
    assert.equal(entry.staleReplay.remoteBeforeHash, entry.staleReplay.remoteAfterHash);
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
  assert.equal(evidenceText.includes('Generated large ready create'), false, 'variant 4 evidence leaked row create title');
  assert.equal(evidenceText.includes('Generated large ready update'), false, 'variant 4 evidence leaked row update title');
  assert.equal(evidenceText.includes('Base large ready delete'), false, 'variant 4 evidence leaked row delete title');
  assert.equal(evidenceText.includes('Remote large ready preserved'), false, 'variant 4 evidence leaked remote row title');
  assert.equal(evidenceText.includes('generated large ready file'), false, 'variant 4 evidence leaked file payload');
  assert.equal(evidenceText.includes('remote large ready preserved file'), false, 'variant 4 evidence leaked remote file payload');
  assert.equal(evidenceText.includes('stale-private-rpp0180-v4'), false, 'variant 4 evidence leaked stale replay payload');
});
