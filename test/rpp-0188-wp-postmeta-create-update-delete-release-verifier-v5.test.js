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
  coverageKey: 'wpPostmetaCreateUpdateDeleteReleaseVerifierVariant5',
  family: 'wp-postmeta-create-update-delete-release-verifier-v5',
  tag: 'wp-postmeta-create-update-delete-release-verifier-v5',
  readyTag: 'wp-postmeta-create-update-delete-release-verifier-v5-ready',
  nonReadyTag: 'wp-postmeta-create-update-delete-release-verifier-v5-non-ready',
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

function assertWpPostmetaShape(testCase, { conflict = false } = {}) {
  const createRows = Object.entries(testCase.local.db.wp_postmeta)
    .filter(([id, row]) => !testCase.base.db.wp_postmeta[id]
      && row.meta_value.startsWith('generated wp_postmeta create '));
  const updateRows = Object.entries(testCase.local.db.wp_postmeta)
    .filter(([id, row]) => testCase.base.db.wp_postmeta[id]
      && row.meta_value.startsWith('generated wp_postmeta update '));
  const deleteRows = Object.entries(testCase.base.db.wp_postmeta)
    .filter(([id, row]) => row.meta_value.startsWith('base postmeta delete ')
      && !testCase.local.db.wp_postmeta[id]
      && testCase.remote.db.wp_postmeta[id]);

  assert.equal(createRows.length, 1, `${testCase.id} should create one wp_postmeta row`);
  assert.equal(updateRows.length, 1, `${testCase.id} should update one wp_postmeta row`);
  assert.equal(deleteRows.length, 1, `${testCase.id} should delete one wp_postmeta row`);

  const [createRowId, createRow] = createRows[0];
  const [updateRowId, updateRow] = updateRows[0];
  const [deleteRowId, deleteRow] = deleteRows[0];

  assert.equal(createRowId, `meta_id:${createRow.meta_id}`, `${testCase.id} created meta row id should match row key`);
  assert.equal(updateRowId, `meta_id:${updateRow.meta_id}`, `${testCase.id} updated meta row id should match row key`);
  assert.equal(deleteRowId, `meta_id:${deleteRow.meta_id}`, `${testCase.id} deleted meta row id should match row key`);
  assert.ok(testCase.base.db.wp_posts[`ID:${createRow.post_id}`], `${testCase.id} should keep created meta parent in base`);
  assert.ok(testCase.base.db.wp_posts[`ID:${updateRow.post_id}`], `${testCase.id} should keep updated meta parent in base`);
  assert.ok(testCase.base.db.wp_posts[`ID:${deleteRow.post_id}`], `${testCase.id} should keep deleted meta parent in base`);
  assert.match(createRow.meta_key, /^_generated_postmeta_create_/);
  assert.match(updateRow.meta_key, /^_generated_postmeta_update_/);
  assert.match(deleteRow.meta_key, /^_generated_postmeta_delete_/);

  if (conflict) {
    assert.match(testCase.remote.db.wp_postmeta[updateRowId].meta_value, /^remote concurrent wp_postmeta update /);
    assert.notEqual(
      testCase.remote.db.wp_postmeta[updateRowId].meta_value,
      updateRow.meta_value,
      `${testCase.id} conflict remote meta value should differ from local update`,
    );
  } else {
    assert.deepEqual(
      testCase.remote.db.wp_postmeta[updateRowId],
      testCase.base.db.wp_postmeta[updateRowId],
      `${testCase.id} ready update meta row should not drift remotely`,
    );
  }

  return {
    createResource: rowResource('wp_postmeta', createRowId),
    createResourceKey: rowResourceKey('wp_postmeta', createRowId),
    updateResource: rowResource('wp_postmeta', updateRowId),
    updateResourceKey: rowResourceKey('wp_postmeta', updateRowId),
    deleteResource: rowResource('wp_postmeta', deleteRowId),
    deleteResourceKey: rowResourceKey('wp_postmeta', deleteRowId),
    parentPostIds: {
      create: createRow.post_id,
      update: updateRow.post_id,
      delete: deleteRow.post_id,
    },
    metaKeyHashes: {
      create: `sha256:${digest(createRow.meta_key)}`,
      update: `sha256:${digest(updateRow.meta_key)}`,
      delete: `sha256:${digest(deleteRow.meta_key)}`,
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
      parentPostId: shape.parentPostIds[label],
      metaKeyHash: shape.metaKeyHashes[label],
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
  const postmetaMutations = {};

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
    assert.equal(appliedHash, localHash, `${testCase.id} did not apply local wp_postmeta ${changeKind} for ${resourceKey}`);
    incrementCount(plannedChangeKinds, changeKind);

    postmetaMutations[label] = {
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
    postmetaMutations,
  };
}

function staleReplayEvidence({ testCase, plan, shape }) {
  const driftedRemote = cloneJson(testCase.remote);
  const remoteBeforeHash = digest(driftedRemote);
  let beforeMutationCalls = 0;

  driftedRemote.db.wp_postmeta[shape.updateResource.id].meta_value = 'RPP-0188 stale replay drift';

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

  assert.ok(conflict, `${testCase.id} should report a wp_postmeta update conflict for ${shape.updateResourceKey}`);
  assert.equal(conflict.class, 'row-conflict');
  assert.equal(plannedMutation, false, `${testCase.id} should not plan the conflicted wp_postmeta update mutation`);
  assert.equal(plannedPrecondition, false, `${testCase.id} should not precondition the conflicted wp_postmeta update row`);

  return {
    resourceKey: conflict.resourceKey,
    class: conflict.class,
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
  const shape = assertWpPostmetaShape(testCase, { conflict });
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
    parentPostIds: shape.parentPostIds,
    planSummary: plan.summary,
    surface,
  };

  if (result.status === 'ready') {
    const applied = applyPlan(cloneJson(testCase.remote), plan);
    const { plannedChangeKinds, postmetaMutations } = readyMutationEvidence({
      testCase,
      plan,
      applied,
      shape,
    });
    const staleReplay = staleReplayEvidence({ testCase, plan, shape });

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
      postmetaMutations,
      staleReplay,
      modelProofHash: `sha256:${digest({
        id: testCase.id,
        status: result.status,
        planSummary: plan.summary,
        surface,
        plannedChangeKinds,
        postmetaMutations,
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

function generatedWpPostmetaReleaseVerifierEvidence(coverage) {
  const perTier = {};
  const statuses = {};
  const selectedCases = new Map();
  let totalCases = 0;
  let readyApplied = 0;
  let readyPreconditioned = 0;
  let readyUnplannedPreserved = 0;
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
      readyPreconditioned += Object.values(evidence.postmetaMutations)
        .every((mutation) => mutation.plannedPrecondition) ? 1 : 0;
      readyUnplannedPreserved += evidence.unplannedRemotePreserved ? 1 : 0;
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

  assert.deepEqual(sortedPerTier, coverage.perTier, 'RPP-0188 target recount should match summary tiers');
  assert.deepEqual(sortedStatuses, coverage.statuses, 'RPP-0188 target recount should match summary statuses');
  assert.equal(totalCases, coverage.total, 'RPP-0188 target recount should match summary total');
  assert.ok(selectedCases.has('ready'), 'RPP-0188 target should select one ready wp_postmeta case');
  assert.ok(selectedCases.has('non-ready'), 'RPP-0188 target should select one non-ready wp_postmeta case');

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
      readyUnplannedPreserved,
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

test('RPP-0188 generated harness summary exposes wp_postmeta release-verifier v5 per-tier counts', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage[target.coverageKey];
  const readyCase = targetCases().find((testCase) => testCase.tags.has(target.readyTag));
  const nonReadyCase = targetCases().find((testCase) => testCase.tags.has(target.nonReadyTag));

  assert.ok(coverage, 'missing wp_postmeta release-verifier v5 target coverage');
  assert.equal(coverage.family, target.family);
  assert.equal(coverage.total, report.summary.featureFamilies[target.tag]);
  assert.equal(coverage.total, 20);
  assert.deepEqual(coverage.perTier, expectedPerTier);
  assert.deepEqual(coverage.statuses, expectedStatuses);
  assert.equal(report.summary.featureFamilies[target.readyTag], 10);
  assert.equal(report.summary.featureFamilies[target.nonReadyTag], 10);
  assert.ok(readyCase, 'missing ready RPP-0188 wp_postmeta case');
  assert.ok(nonReadyCase, 'missing non-ready RPP-0188 wp_postmeta case');
  assert.equal(validateGeneratedCase(readyCase).status, 'ready');
  assert.equal(validateGeneratedCase(nonReadyCase).status, 'conflict');
});

test('RPP-0188 generated wp_postmeta release-verifier evidence applies ready cases without unplanned overwrite', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage[target.coverageKey];
  const firstEvidence = generatedWpPostmetaReleaseVerifierEvidence(coverage);
  const replayEvidence = generatedWpPostmetaReleaseVerifierEvidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test test/rpp-0188-wp-postmeta-create-update-delete-release-verifier-v5.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'RPP-0188 wp_postmeta evidence changed between runs');
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
    readyUnplannedPreserved: 10,
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
  for (const change of ['create', 'update', 'delete']) {
    const mutation = readyCase.postmetaMutations[change];
    assert.equal(mutation.changeKind, change);
    assert.equal(mutation.plannedMutation, true);
    assert.equal(mutation.plannedPrecondition, true);
    assert.equal(mutation.appliedHash, readyCase.surface[change].localHash);
    assert.equal(mutation.preconditionExpectedHash, mutation.remoteBeforeHash);
    assert.match(mutation.mutationHash, sha256EvidencePattern);
  }
  assert.equal(readyCase.staleReplay.code, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplay.resourceKey, readyCase.surface.update.resourceKey);
  assert.equal(readyCase.staleReplay.beforeMutationCalls, 0);
  assert.equal(readyCase.staleReplay.preMutationRefusal, true);
  assert.equal(readyCase.staleReplay.remoteUnchanged, true);
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
  assert.equal(evidenceText.includes('generated wp_postmeta create'), false, 'RPP-0188 evidence leaked created meta value');
  assert.equal(evidenceText.includes('generated wp_postmeta update'), false, 'RPP-0188 evidence leaked updated meta value');
  assert.equal(evidenceText.includes('base postmeta update'), false, 'RPP-0188 evidence leaked base update meta value');
  assert.equal(evidenceText.includes('base postmeta delete'), false, 'RPP-0188 evidence leaked deleted meta value');
  assert.equal(evidenceText.includes('remote concurrent wp_postmeta update'), false, 'RPP-0188 evidence leaked remote drift value');
});
