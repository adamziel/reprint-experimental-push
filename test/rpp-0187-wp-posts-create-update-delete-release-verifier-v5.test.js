import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import {
  generatePushHarnessCases,
  runGeneratedPushHarness,
  validateGeneratedCase,
} from '../scripts/harness/generated-push-cases.js';

const fixedGeneratedHarnessNow = new Date('2026-05-28T00:00:00.000Z');
const target = Object.freeze({
  coverageKey: 'wpPostsCreateUpdateDeleteReleaseVerifierVariant5',
  family: 'wp-posts-create-update-delete-release-verifier-v5',
  tag: 'wp-posts-create-update-delete-release-verifier-v5',
  readyTag: 'wp-posts-create-update-delete-release-verifier-v5-ready',
  nonReadyTag: 'wp-posts-create-update-delete-release-verifier-v5-non-ready',
});
const expectedPerTier = Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2]));
const expectedStatuses = { conflict: 10, ready: 10 };
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
  object[String(key)] = (object[String(key)] || 0) + 1;
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

function rowResource(table, id) {
  return {
    type: 'row',
    table,
    id,
    key: rowResourceKey(table, id),
  };
}

function rowResourceKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
}

function targetCases() {
  return generatePushHarnessCases()
    .filter((testCase) => testCase.tags.has(target.tag));
}

function assertWpPostsShape(testCase, { conflict = false } = {}) {
  const createRows = Object.entries(testCase.local.db.wp_posts)
    .filter(([id, row]) => !testCase.base.db.wp_posts[id]
      && row.post_title.startsWith('Generated wp_posts create '));
  const updateRows = Object.entries(testCase.local.db.wp_posts)
    .filter(([id, row]) => testCase.base.db.wp_posts[id]
      && row.post_title.startsWith('Generated wp_posts update '));
  const deleteRows = Object.entries(testCase.base.db.wp_posts)
    .filter(([id, row]) => row.post_title.startsWith('Base wp_posts delete ')
      && !testCase.local.db.wp_posts[id]
      && testCase.remote.db.wp_posts[id]);

  assert.equal(createRows.length, 1, `${testCase.id} should create one wp_posts row`);
  assert.equal(updateRows.length, 1, `${testCase.id} should update one wp_posts row`);
  assert.equal(deleteRows.length, 1, `${testCase.id} should delete one wp_posts row`);

  const [createRowId, createRow] = createRows[0];
  const [updateRowId, updateRow] = updateRows[0];
  const [deleteRowId, deleteRow] = deleteRows[0];

  assert.equal(createRowId, `ID:${createRow.ID}`, `${testCase.id} created row id should match row key`);
  assert.equal(updateRowId, `ID:${updateRow.ID}`, `${testCase.id} updated row id should match row key`);
  assert.equal(deleteRowId, `ID:${deleteRow.ID}`, `${testCase.id} deleted row id should match row key`);
  assert.equal(createRow.post_type, 'post');
  assert.equal(updateRow.post_type, 'page');
  assert.equal(deleteRow.post_type, 'post');

  if (conflict) {
    assert.match(testCase.remote.db.wp_posts[updateRowId].post_title, /^Remote concurrent wp_posts update /);
    assert.notEqual(
      testCase.remote.db.wp_posts[updateRowId].post_title,
      updateRow.post_title,
      `${testCase.id} conflict remote title should differ from local update`,
    );
  } else {
    assert.deepEqual(
      testCase.remote.db.wp_posts[updateRowId],
      testCase.base.db.wp_posts[updateRowId],
      `${testCase.id} ready update row should not drift remotely`,
    );
  }

  return {
    createResource: rowResource('wp_posts', createRowId),
    createResourceKey: rowResourceKey('wp_posts', createRowId),
    updateResource: rowResource('wp_posts', updateRowId),
    updateResourceKey: rowResourceKey('wp_posts', updateRowId),
    deleteResource: rowResource('wp_posts', deleteRowId),
    deleteResourceKey: rowResourceKey('wp_posts', deleteRowId),
    postTypes: {
      create: createRow.post_type,
      update: updateRow.post_type,
      delete: deleteRow.post_type,
    },
  };
}

function surfaceEvidence(testCase, shape) {
  return Object.fromEntries([
    ['create', shape.createResource],
    ['update', shape.updateResource],
    ['delete', shape.deleteResource],
  ].map(([label, resource]) => [
    label,
    {
      resourceKey: resource.key,
      baseHash: resourceHash(testCase.base, resource),
      localHash: resourceHash(testCase.local, resource),
      remoteHash: resourceHash(testCase.remote, resource),
      postType: shape.postTypes[label],
    },
  ]));
}

function readyMutationEvidence({ testCase, plan, applied, shape }) {
  const expected = [
    { label: 'create', resource: shape.createResource, resourceKey: shape.createResourceKey, changeKind: 'create' },
    { label: 'update', resource: shape.updateResource, resourceKey: shape.updateResourceKey, changeKind: 'update' },
    { label: 'delete', resource: shape.deleteResource, resourceKey: shape.deleteResourceKey, changeKind: 'delete' },
  ];
  const mutations = new Map(plan.mutations.map((mutation) => [mutation.resourceKey, mutation]));
  const preconditions = new Map(plan.preconditions.map((precondition) => [precondition.resourceKey, precondition]));
  const plannedChangeKinds = {};
  const postMutations = {};

  for (const { label, resource, resourceKey, changeKind } of expected) {
    const mutation = mutations.get(resourceKey);
    const precondition = preconditions.get(resourceKey);
    const localHash = resourceHash(testCase.local, resource);
    const appliedHash = resourceHash(applied.site, resource);

    assert.ok(mutation, `${testCase.id} should plan ${changeKind} mutation for ${resourceKey}`);
    assert.ok(precondition, `${testCase.id} should precondition ${resourceKey}`);
    assert.equal(mutation.changeKind, changeKind);
    assert.equal(precondition.mutationId, mutation.id);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.equal(precondition.checkedAgainst, 'live-remote');
    assert.equal(appliedHash, localHash, `${testCase.id} did not apply local wp_posts ${changeKind} for ${resourceKey}`);
    incrementCount(plannedChangeKinds, changeKind);

    postMutations[label] = {
      resourceKey,
      action: mutation.action,
      changeKind: mutation.changeKind,
      localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      preconditionExpectedHash: precondition.expectedHash,
      appliedHash,
      plannedMutation: true,
      plannedPrecondition: true,
      mutationHash: `sha256:${digest({
        resourceKey: mutation.resourceKey,
        action: mutation.action,
        changeKind: mutation.changeKind,
        localHash,
        remoteBeforeHash: mutation.remoteBeforeHash,
      })}`,
    };
  }

  return {
    plannedChangeKinds: sortStringObject(plannedChangeKinds),
    postMutations,
  };
}

function staleReplayEvidence({ testCase, plan, shape }) {
  const driftedRemote = cloneJson(testCase.remote);
  const remoteBeforeHash = digest(driftedRemote);
  let beforeMutationCalls = 0;

  driftedRemote.db.wp_posts[shape.updateResource.id].post_title = 'RPP-0187 stale replay drift';
  driftedRemote.db.wp_posts[shape.updateResource.id].post_content = 'RPP-0187 stale replay content drift';

  const staleRemoteHash = digest(driftedRemote);
  const error = captureError(() => applyPlan(driftedRemote, plan, {
    beforeMutation() {
      beforeMutationCalls += 1;
    },
  }));
  const remoteAfterHash = digest(driftedRemote);

  assert.ok(error instanceof PushPlanError, `${testCase.id} stale replay should refuse apply`);
  assert.equal(error.code, 'PRECONDITION_FAILED');
  assert.notEqual(staleRemoteHash, remoteBeforeHash, `${testCase.id} stale remote should drift before replay`);
  assert.equal(remoteAfterHash, staleRemoteHash, `${testCase.id} stale replay refusal mutated remote`);
  assert.equal(beforeMutationCalls, 0, `${testCase.id} stale replay reached beforeMutation`);

  return {
    code: error.code,
    resourceKey: error.details?.resourceKey,
    beforeMutationCalls,
    preMutationRefusal: beforeMutationCalls === 0,
    remoteBeforeHash,
    staleRemoteHash,
    remoteAfterHash,
    remoteUnchanged: remoteAfterHash === staleRemoteHash,
    detailsHash: `sha256:${digest(error.details)}`,
  };
}

function conflictEvidence({ testCase, plan, shape }) {
  const conflict = plan.conflicts.find((entry) => entry.resourceKey === shape.updateResourceKey);
  const plannedMutation = plan.mutations.some((mutation) => mutation.resourceKey === shape.updateResourceKey);
  const plannedPrecondition = plan.preconditions.some((precondition) => precondition.resourceKey === shape.updateResourceKey);

  assert.ok(conflict, `${testCase.id} should report a wp_posts update conflict for ${shape.updateResourceKey}`);
  assert.equal(conflict.class, 'row-conflict');
  assert.equal(plannedMutation, false, `${testCase.id} should not plan the conflicted wp_posts update mutation`);
  assert.equal(plannedPrecondition, false, `${testCase.id} should not precondition the conflicted wp_posts update row`);

  return {
    resourceKey: conflict.resourceKey,
    class: conflict.class,
    change: conflict.change,
    plannedMutation,
    plannedPrecondition,
    conflictHash: `sha256:${digest(conflict)}`,
  };
}

function refusalEvidence(testCase, plan) {
  const remoteBefore = cloneJson(testCase.remote);
  const remoteBeforeHash = digest(remoteBefore);
  let beforeMutationCalls = 0;
  const error = captureError(() => applyPlan(remoteBefore, plan, {
    beforeMutation() {
      beforeMutationCalls += 1;
    },
  }));
  const remoteAfterHash = digest(remoteBefore);

  assert.ok(error instanceof PushPlanError, `${testCase.id} non-ready plan should refuse apply`);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(beforeMutationCalls, 0, `${testCase.id} non-ready refusal reached beforeMutation`);
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} non-ready refusal mutated remote`);

  return {
    code: error.code,
    detailsHash: `sha256:${digest(error.details)}`,
    beforeMutationCalls,
    preMutationRefusal: beforeMutationCalls === 0,
    remoteBeforeHash,
    remoteAfterHash,
  };
}

function caseEvidence(testCase, result) {
  const conflict = result.status !== 'ready';
  const shape = assertWpPostsShape(testCase, { conflict });
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const surface = surfaceEvidence(testCase, shape);
  const commonEvidence = {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    variant: result.status === 'ready' ? 'ready' : 'non-ready',
    status: result.status,
    tags: [...testCase.tags].sort(),
    postTypes: shape.postTypes,
    planSummary: plan.summary,
    surface,
  };

  if (result.status === 'ready') {
    const applied = applyPlan(cloneJson(testCase.remote), plan);
    const { plannedChangeKinds, postMutations } = readyMutationEvidence({
      testCase,
      plan,
      applied,
      shape,
    });
    const staleReplay = staleReplayEvidence({
      testCase,
      plan,
      shape,
    });

    assert.equal(plan.status, 'ready', `${testCase.id} should plan as ready`);
    assert.equal(result.applied, true, `${testCase.id} should apply`);
    assert.equal(result.unplannedRemotePreserved, true, `${testCase.id} should preserve unplanned remote data`);
    assert.equal(result.staleReplayRejected, true, `${testCase.id} should reject stale replay`);
    assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(result.staleReplayRemoteUnchanged, true, `${testCase.id} stale replay should not mutate remote`);

    return {
      ...commonEvidence,
      applied: result.applied,
      unplannedRemotePreserved: result.unplannedRemotePreserved,
      staleReplayRejected: result.staleReplayRejected,
      staleReplayRejectionCode: result.staleReplayRejectionCode,
      staleReplayRemoteUnchanged: result.staleReplayRemoteUnchanged,
      plannedChangeKinds,
      postMutations,
      staleReplay,
      modelProofHash: `sha256:${digest({
        id: testCase.id,
        status: result.status,
        planSummary: plan.summary,
        surface,
        plannedChangeKinds,
        postMutations,
        staleReplay,
      })}`,
    };
  }

  assert.notEqual(plan.status, 'ready', `${testCase.id} should plan as non-ready`);
  assert.notEqual(result.status, 'ready', `${testCase.id} should validate as non-ready`);
  assert.equal(result.applied, false, `${testCase.id} must not apply`);

  const conflictProof = conflictEvidence({ testCase, plan, shape });
  const refusal = refusalEvidence(testCase, plan);

  return {
    ...commonEvidence,
    applied: result.applied,
    conflict: conflictProof,
    refusal,
    modelProofHash: `sha256:${digest({
      id: testCase.id,
      status: result.status,
      planSummary: plan.summary,
      surface,
      conflict: conflictProof,
      refusal,
    })}`,
  };
}

function generatedWpPostsReleaseVerifierEvidence(coverage) {
  const perTier = {};
  const statuses = {};
  const selectedCases = new Map();
  let totalCases = 0;
  let readyApplied = 0;
  let readyPreconditioned = 0;
  let readyStaleReplayRejected = 0;
  let readyStaleReplayBeforeMutation = 0;
  let nonReadyApplyRefused = 0;
  let nonReadyBeforeMutation = 0;

  for (const testCase of targetCases()) {
    const result = validateGeneratedCase(testCase);
    const evidence = caseEvidence(testCase, result);
    const selectedKey = result.status === 'ready' ? 'ready' : 'non-ready';
    totalCases += 1;
    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);

    if (result.status === 'ready') {
      readyApplied += evidence.applied ? 1 : 0;
      readyPreconditioned += Object.values(evidence.postMutations)
        .every((mutation) => mutation.plannedPrecondition) ? 1 : 0;
      readyStaleReplayRejected += evidence.staleReplayRejected ? 1 : 0;
      readyStaleReplayBeforeMutation += evidence.staleReplay.beforeMutationCalls === 0 ? 1 : 0;
    } else {
      nonReadyApplyRefused += evidence.refusal.code === 'PLAN_NOT_READY' ? 1 : 0;
      nonReadyBeforeMutation += evidence.refusal.beforeMutationCalls === 0 ? 1 : 0;
    }

    if (!selectedCases.has(selectedKey)) {
      selectedCases.set(selectedKey, evidence);
    }
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);

  assert.deepEqual(sortedPerTier, coverage.perTier, 'RPP-0187 target recount should match summary tiers');
  assert.deepEqual(sortedStatuses, coverage.statuses, 'RPP-0187 target recount should match summary statuses');
  assert.equal(totalCases, coverage.total, 'RPP-0187 target recount should match summary total');
  assert.ok(selectedCases.has('ready'), 'RPP-0187 target should select one ready wp_posts case');
  assert.ok(selectedCases.has('non-ready'), 'RPP-0187 target should select one non-ready wp_posts case');

  return {
    target: target.coverageKey,
    family: coverage.family,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    totalCases,
    readyCases: sortedStatuses.ready || 0,
    nonReadyCases: totalCases - (sortedStatuses.ready || 0),
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    aggregate: {
      readyApplied,
      readyPreconditioned,
      readyStaleReplayRejected,
      readyStaleReplayBeforeMutation,
      nonReadyApplyRefused,
      nonReadyBeforeMutation,
    },
    selectedCases: [
      selectedCases.get('ready'),
      selectedCases.get('non-ready'),
    ],
  };
}

test('RPP-0187 generated harness summary exposes wp_posts release-verifier v5 per-tier counts', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage[target.coverageKey];
  const readyCase = targetCases().find((testCase) => testCase.tags.has(target.readyTag));
  const nonReadyCase = targetCases().find((testCase) => testCase.tags.has(target.nonReadyTag));

  assert.ok(coverage, 'missing wp_posts release-verifier v5 target coverage');
  assert.equal(coverage.family, target.family);
  assert.equal(coverage.total, report.summary.featureFamilies[target.tag]);
  assert.equal(coverage.total, 20);
  assert.deepEqual(coverage.perTier, expectedPerTier);
  assert.deepEqual(coverage.statuses, expectedStatuses);
  assert.equal(report.summary.featureFamilies[target.readyTag], 10);
  assert.equal(report.summary.featureFamilies[target.nonReadyTag], 10);
  assert.ok(readyCase, 'missing ready RPP-0187 wp_posts case');
  assert.ok(nonReadyCase, 'missing non-ready RPP-0187 wp_posts case');
  assert.equal(validateGeneratedCase(readyCase).status, 'ready');
  assert.equal(validateGeneratedCase(nonReadyCase).status, 'conflict');
});

test('RPP-0187 generated wp_posts release-verifier evidence proves preconditioned apply and refusal before mutation', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage[target.coverageKey];
  const firstEvidence = generatedWpPostsReleaseVerifierEvidence(coverage);
  const replayEvidence = generatedWpPostsReleaseVerifierEvidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test test/rpp-0187-wp-posts-create-update-delete-release-verifier-v5.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'RPP-0187 wp_posts evidence changed between runs');
  assert.equal(firstEvidence.target, target.coverageKey);
  assert.equal(firstEvidence.family, target.family);
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.equal(firstEvidence.readyCases, coverage.statuses.ready);
  assert.equal(firstEvidence.nonReadyCases, coverage.statuses.conflict);
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(firstEvidence.aggregate, {
    readyApplied: 10,
    readyPreconditioned: 10,
    readyStaleReplayRejected: 10,
    readyStaleReplayBeforeMutation: 10,
    nonReadyApplyRefused: 10,
    nonReadyBeforeMutation: 10,
  });
  assert.deepEqual(
    firstEvidence.selectedCases.map((entry) => entry.status),
    ['ready', 'conflict'],
  );

  const [readyCase, nonReadyCase] = firstEvidence.selectedCases;
  assert.ok(readyCase.tags.includes(target.readyTag));
  assert.equal(readyCase.variant, 'ready');
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.unplannedRemotePreserved, true);
  assert.equal(readyCase.staleReplayRejected, true);
  assert.equal(readyCase.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplayRemoteUnchanged, true);
  assert.deepEqual(readyCase.plannedChangeKinds, { create: 1, delete: 1, update: 1 });
  assert.equal(readyCase.postMutations.create.changeKind, 'create');
  assert.equal(readyCase.postMutations.update.changeKind, 'update');
  assert.equal(readyCase.postMutations.delete.changeKind, 'delete');
  assert.equal(readyCase.postMutations.create.plannedPrecondition, true);
  assert.equal(readyCase.postMutations.update.plannedPrecondition, true);
  assert.equal(readyCase.postMutations.delete.plannedPrecondition, true);
  assert.equal(readyCase.postMutations.create.appliedHash, readyCase.surface.create.localHash);
  assert.equal(readyCase.postMutations.update.appliedHash, readyCase.surface.update.localHash);
  assert.equal(readyCase.postMutations.delete.appliedHash, readyCase.surface.delete.localHash);
  assert.equal(readyCase.staleReplay.code, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplay.resourceKey, readyCase.surface.update.resourceKey);
  assert.equal(readyCase.staleReplay.beforeMutationCalls, 0);
  assert.equal(readyCase.staleReplay.preMutationRefusal, true);
  assert.equal(readyCase.staleReplay.remoteUnchanged, true);
  assert.match(readyCase.postMutations.create.mutationHash, sha256EvidencePattern);
  assert.match(readyCase.postMutations.update.mutationHash, sha256EvidencePattern);
  assert.match(readyCase.postMutations.delete.mutationHash, sha256EvidencePattern);
  assert.match(readyCase.staleReplay.detailsHash, sha256EvidencePattern);
  assert.match(readyCase.modelProofHash, sha256EvidencePattern);

  assert.ok(nonReadyCase.tags.includes(target.nonReadyTag));
  assert.equal(nonReadyCase.variant, 'non-ready');
  assert.equal(nonReadyCase.applied, false);
  assert.equal(nonReadyCase.conflict.resourceKey, nonReadyCase.surface.update.resourceKey);
  assert.equal(nonReadyCase.conflict.class, 'row-conflict');
  assert.equal(nonReadyCase.conflict.plannedMutation, false);
  assert.equal(nonReadyCase.conflict.plannedPrecondition, false);
  assert.equal(nonReadyCase.refusal.code, 'PLAN_NOT_READY');
  assert.equal(nonReadyCase.refusal.beforeMutationCalls, 0);
  assert.equal(nonReadyCase.refusal.preMutationRefusal, true);
  assert.equal(nonReadyCase.refusal.remoteBeforeHash, nonReadyCase.refusal.remoteAfterHash);
  assert.match(nonReadyCase.conflict.conflictHash, sha256EvidencePattern);
  assert.match(nonReadyCase.refusal.detailsHash, sha256EvidencePattern);
  assert.match(nonReadyCase.modelProofHash, sha256EvidencePattern);

  assert.match(evidenceEnvelope.evidenceHash, sha256EvidencePattern);
  assert.equal(evidenceText.includes('Generated wp_posts create'), false, 'RPP-0187 evidence leaked created post title');
  assert.equal(evidenceText.includes('Generated wp_posts update'), false, 'RPP-0187 evidence leaked updated post title');
  assert.equal(evidenceText.includes('generated create content'), false, 'RPP-0187 evidence leaked created post content');
  assert.equal(evidenceText.includes('generated update content'), false, 'RPP-0187 evidence leaked updated post content');
  assert.equal(evidenceText.includes('Base wp_posts delete'), false, 'RPP-0187 evidence leaked deleted post title');
  assert.equal(evidenceText.includes('base delete content'), false, 'RPP-0187 evidence leaked deleted post content');
  assert.equal(evidenceText.includes('Remote concurrent wp_posts update'), false, 'RPP-0187 evidence leaked remote drift title');
  assert.equal(evidenceText.includes('remote concurrent wp_posts content'), false, 'RPP-0187 evidence leaked remote drift content');
});
