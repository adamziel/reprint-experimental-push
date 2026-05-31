import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue, resourceHash, setResource } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import {
  generatePushHarnessCases,
  runGeneratedPushHarness,
  validateGeneratedCase,
} from '../scripts/harness/generated-push-cases.js';

const fixedGeneratedHarnessNow = new Date('2026-05-28T00:00:00.000Z');
const targetTag = 'term-relationship-object-graph';
const variantTag = 'wp-term-relationships-graph-v3';
const readyTag = 'wp-term-relationships-graph-v3-ready';
const staleTag = 'wp-term-relationships-graph-v3-stale';
const objectRelationshipKey = 'wp_term_relationships.object_id';
const taxonomyRelationshipKey = 'wp_term_relationships.term_taxonomy_id';
const staleObjectDriftTitle = 'rpp-0353-derived-stale-object-remote-drift';
const sha256Pattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}

function rowResource(table, id) {
  return { type: 'row', table, id, key: rowResourceKey(table, id) };
}

function rowResourceKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
}

function planFor(testCase, remote = testCase.remote) {
  return createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote,
    now: fixedGeneratedHarnessNow,
  });
}

function increment(object, key) {
  object[key] = (object[key] || 0) + 1;
}

function sortNumericObject(object) {
  return Object.fromEntries(Object.entries(object).sort(([left], [right]) => Number(left) - Number(right)));
}

function sortStringObject(object) {
  return Object.fromEntries(Object.entries(object).sort(([left], [right]) => left.localeCompare(right)));
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey) || null;
}

function preconditionFor(plan, mutation) {
  return plan.preconditions.find((precondition) => precondition.mutationId === mutation?.id) || null;
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function relationshipShape(testCase) {
  const relationships = Object.entries(testCase.local.db?.wp_term_relationships || {})
    .filter(([rowId, row]) =>
      typeof row?.object_id === 'number'
      && typeof row?.term_taxonomy_id === 'number'
      && !Object.hasOwn(testCase.base.db?.wp_term_relationships || {}, rowId)
      && rowId === `object_id:${row.object_id}|term_taxonomy_id:${row.term_taxonomy_id}`);

  assert.equal(relationships.length, 1, `${testCase.id} should carry one generated term relationship row`);

  const [relationshipRowId, relationshipRow] = relationships[0];
  const objectRowId = `ID:${relationshipRow.object_id}`;
  const taxonomyRowId = `term_taxonomy_id:${relationshipRow.term_taxonomy_id}`;
  const relationshipResource = rowResource('wp_term_relationships', relationshipRowId);
  const objectResource = rowResource('wp_posts', objectRowId);
  const taxonomyResource = rowResource('wp_term_taxonomy', taxonomyRowId);
  const objectHashes = {
    base: resourceHash(testCase.base, objectResource),
    local: resourceHash(testCase.local, objectResource),
    remote: resourceHash(testCase.remote, objectResource),
  };

  assert.ok(testCase.base.db?.wp_posts?.[objectRowId], `${testCase.id} object target should exist in base`);
  assert.equal(objectHashes.base, objectHashes.local, `${testCase.id} object target should be stable locally`);
  assert.equal(objectHashes.base, objectHashes.remote, `${testCase.id} object target should be stable remotely`);

  return {
    relationshipRow,
    relationshipResource,
    relationshipResourceKey: relationshipResource.key,
    objectResource,
    objectResourceKey: objectResource.key,
    taxonomyResource,
    taxonomyResourceKey: taxonomyResource.key,
    objectHashes,
  };
}

function generatedCoverageProof() {
  const report = runGeneratedPushHarness();
  const summaryCoverage = report.summary.targetCoverage.wpTermRelationshipsGraphVariant3;
  const targetCases = generatePushHarnessCases()
    .filter((entry) => entry.tags.has(targetTag) && entry.tags.has(variantTag));
  const perTier = {};
  const statuses = {};
  const tagCounts = {};
  let readyCase = null;
  let readyValidation = null;
  let staleCase = null;
  let staleValidation = null;

  assert.ok(summaryCoverage, 'missing wp_term_relationships variant 3 target coverage');

  for (const testCase of targetCases) {
    const validation = validateGeneratedCase(testCase);
    increment(perTier, testCase.tier);
    increment(statuses, validation.status);
    if (testCase.tags.has(readyTag)) {
      increment(tagCounts, 'generated-ready-tag');
      assert.equal(validation.status, 'ready', `${testCase.id} ready tag should validate ready`);
      readyCase ??= testCase;
      readyValidation ??= validation;
    }
    if (testCase.tags.has(staleTag)) {
      increment(tagCounts, 'generated-stale-tag');
      assert.notEqual(validation.status, 'ready', `${testCase.id} stale tag should validate non-ready`);
      staleCase ??= testCase;
      staleValidation ??= validation;
    }
  }

  const coverage = {
    target: 'termRelationshipObjectReferenceVariant3',
    generatedHarnessTags: [targetTag, variantTag],
    total: targetCases.length,
    perTier: sortNumericObject(perTier),
    statuses: sortStringObject(statuses),
    readyCases: statuses.ready || 0,
    staleCases: tagCounts['generated-stale-tag'] || 0,
    tagCounts: sortStringObject(tagCounts),
    summaryHash: sha256Evidence(summaryCoverage),
  };

  assert.deepEqual(coverage, {
    target: 'termRelationshipObjectReferenceVariant3',
    generatedHarnessTags: [targetTag, variantTag],
    total: 10,
    perTier: { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 1 },
    statuses: { blocked: 5, ready: 5 },
    readyCases: 5,
    staleCases: 5,
    tagCounts: { 'generated-ready-tag': 5, 'generated-stale-tag': 5 },
    summaryHash: sha256Evidence(summaryCoverage),
  });
  assert.deepEqual(summaryCoverage, {
    family: 'wp-term-relationships-graph-variant3',
    total: 10,
    perTier: coverage.perTier,
    statuses: coverage.statuses,
  });
  assert.ok(readyCase, 'missing generated ready term relationship object case');
  assert.ok(staleCase, 'missing generated stale term relationship object case');

  return {
    coverage,
    readyCase,
    readyValidation,
    staleCase,
    staleValidation,
  };
}

function generatedReadyObjectEvidence(testCase, validation) {
  const shape = relationshipShape(testCase);
  const plan = planFor(testCase);
  const relationshipMutation = mutationFor(plan, shape.relationshipResourceKey);
  const relationshipPrecondition = preconditionFor(plan, relationshipMutation);
  let beforeMutationCalls = 0;
  const applied = applyPlan(cloneJson(testCase.remote), plan, {
    beforeMutation({ mutation }) {
      if (mutation.resourceKey === shape.relationshipResourceKey) {
        beforeMutationCalls += 1;
      }
    },
  });
  const plannedRelationship = deserializeResourceValue(relationshipMutation?.value);
  const appliedRelationshipHash = resourceHash(applied.site, shape.relationshipResource);
  const appliedObjectHash = resourceHash(applied.site, shape.objectResource);

  assert.equal(plan.status, 'ready');
  assert.equal(validation.status, 'ready');
  assert.ok(relationshipMutation, 'generated ready case should plan the term relationship row');
  assert.equal(relationshipMutation.action, 'put');
  assert.equal(relationshipMutation.changeKind, 'create');
  assert.equal(relationshipMutation.wordpressGraphIdentity, undefined);
  assert.ok(relationshipPrecondition, 'generated ready relationship should have a precondition');
  assert.equal(relationshipPrecondition.checkedAgainst, 'live-remote');
  assert.equal(relationshipPrecondition.expectedHash, relationshipMutation.remoteBeforeHash);
  assert.equal(beforeMutationCalls, 1, 'ready apply should reach the relationship mutation once');
  assert.equal(plannedRelationship.object_id, shape.relationshipRow.object_id);
  assert.equal(appliedRelationshipHash, relationshipMutation.localHash);
  assert.equal(appliedObjectHash, shape.objectHashes.remote);
  assert.equal(validation.applied, true);
  assert.equal(validation.unplannedRemotePreserved, true);
  assert.equal(validation.staleReplayRejected, true);
  assert.equal(validation.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(validation.staleReplayRemoteUnchanged, true);

  const evidence = {
    id: testCase.id,
    tier: testCase.tier,
    variant: 'generated-ready-object-reference-v3',
    status: plan.status,
    tags: [...testCase.tags].filter((tag) => tag === targetTag || tag.startsWith('wp-term-relationships-graph-v3')).sort(),
    planSummary: plan.summary,
    relationship: {
      resourceKey: shape.relationshipResourceKey,
      action: relationshipMutation.action,
      changeKind: relationshipMutation.changeKind,
      objectIdHash: sha256Evidence(String(shape.relationshipRow.object_id)),
      localHash: relationshipMutation.localHash,
      remoteBeforeHash: relationshipMutation.remoteBeforeHash,
      preconditionHash: sha256Evidence(relationshipPrecondition),
      appliedHash: appliedRelationshipHash,
      beforeMutationCalls,
      mutationHash: sha256Evidence({
        resourceKey: relationshipMutation.resourceKey,
        action: relationshipMutation.action,
        changeKind: relationshipMutation.changeKind,
        localHash: relationshipMutation.localHash,
        remoteBeforeHash: relationshipMutation.remoteBeforeHash,
      }),
    },
    objectReference: {
      relationshipKey: objectRelationshipKey,
      relationshipType: 'term-relationship-object',
      sourceResourceKey: shape.relationshipResourceKey,
      targetResourceKey: shape.objectResourceKey,
      objectIdHash: sha256Evidence(String(shape.relationshipRow.object_id)),
      targetBaseHash: shape.objectHashes.base,
      targetLocalHash: shape.objectHashes.local,
      targetRemoteHash: shape.objectHashes.remote,
      targetAppliedHash: appliedObjectHash,
      targetStableAcrossGeneratedSnapshots:
        shape.objectHashes.base === shape.objectHashes.local
        && shape.objectHashes.base === shape.objectHashes.remote,
      applyPreservedTarget: appliedObjectHash === shape.objectHashes.remote,
    },
    validation: {
      applied: validation.applied,
      unplannedRemotePreserved: validation.unplannedRemotePreserved,
      staleReplayRejected: validation.staleReplayRejected,
      staleReplayRejectionCode: validation.staleReplayRejectionCode,
      staleReplayRemoteUnchanged: validation.staleReplayRemoteUnchanged,
    },
  };

  return {
    ...evidence,
    modelProofHash: sha256Evidence(evidence),
  };
}

function generatedStaleObjectCaseEvidence(testCase, validation) {
  const shape = relationshipShape(testCase);
  const plan = planFor(testCase);
  const relationshipBlocker = plan.blockers.find((blocker) =>
    blocker.resourceKey === shape.relationshipResourceKey);
  const relationshipKeys = relationshipBlocker?.references
    .map((reference) => reference.relationshipKey)
    .sort();
  const refusal = applyRefusalEvidence(testCase.remote, plan);

  assert.equal(plan.status, 'blocked');
  assert.equal(validation.status, 'blocked');
  assert.ok(relationshipBlocker, 'generated stale case should expose a relationship blocker');
  assert.equal(relationshipBlocker.class, 'stale-wordpress-graph-identity');
  assert.deepEqual(relationshipKeys, [taxonomyRelationshipKey]);
  assert.equal(mutationFor(plan, shape.relationshipResourceKey), null);
  assert.equal(validation.applied, false);
  assert.equal(validation.nonReadyRemoteUnchanged, true);
  assert.equal(refusal.code, 'PLAN_NOT_READY');
  assert.equal(refusal.beforeMutationCalls, 0);
  assert.equal(refusal.remoteHashAfter, refusal.remoteHashBefore);

  const evidence = {
    id: testCase.id,
    tier: testCase.tier,
    variant: 'generated-stale-object-reference-v3',
    status: plan.status,
    tags: [...testCase.tags].filter((tag) => tag === targetTag || tag.startsWith('wp-term-relationships-graph-v3')).sort(),
    planSummary: plan.summary,
    relationship: {
      resourceKey: shape.relationshipResourceKey,
      plannedMutation: false,
      blockerHash: sha256Evidence(relationshipBlocker),
    },
    objectReference: {
      relationshipKey: objectRelationshipKey,
      relationshipType: 'term-relationship-object',
      sourceResourceKey: shape.relationshipResourceKey,
      targetResourceKey: shape.objectResourceKey,
      objectIdHash: sha256Evidence(String(shape.relationshipRow.object_id)),
      targetBaseHash: shape.objectHashes.base,
      targetLocalHash: shape.objectHashes.local,
      targetRemoteHash: shape.objectHashes.remote,
      targetStableAcrossGeneratedSnapshots:
        shape.objectHashes.base === shape.objectHashes.local
        && shape.objectHashes.base === shape.objectHashes.remote,
    },
    staleBlocker: {
      class: relationshipBlocker.class,
      relationshipKeys,
      targetResourceKey: shape.taxonomyResourceKey,
      plannedRelationshipMutation: false,
    },
    refusal,
  };

  return {
    ...evidence,
    modelProofHash: sha256Evidence(evidence),
  };
}

function derivedStaleObjectEvidence(readyCase) {
  const shape = relationshipShape(readyCase);
  const staleObjectRemote = cloneJson(readyCase.remote);

  setResource(staleObjectRemote, shape.objectResource, {
    ...staleObjectRemote.db.wp_posts[`ID:${shape.relationshipRow.object_id}`],
    post_title: staleObjectDriftTitle,
  });

  const plan = planFor(readyCase, staleObjectRemote);
  const relationshipBlocker = plan.blockers.find((blocker) =>
    blocker.resourceKey === shape.relationshipResourceKey
    && blocker.references?.some((reference) => reference.relationshipKey === objectRelationshipKey));
  const objectReference = relationshipBlocker?.references.find((reference) =>
    reference.relationshipKey === objectRelationshipKey);
  const refusal = applyRefusalEvidence(staleObjectRemote, plan);

  assert.equal(plan.status, 'blocked');
  assert.ok(relationshipBlocker, 'derived stale object case should block the relationship row');
  assert.ok(objectReference, 'derived stale object case should expose object_id reference evidence');
  assert.equal(relationshipBlocker.class, 'stale-wordpress-graph-identity');
  assert.equal(objectReference.relationshipType, 'term-relationship-object');
  assert.equal(objectReference.targetResourceKey, shape.objectResourceKey);
  assert.equal(objectReference.targetBaseHash, objectReference.targetLocalHash);
  assert.notEqual(objectReference.targetBaseHash, objectReference.targetRemoteHash);
  assert.equal(objectReference.targetChange.localChange, 'unchanged');
  assert.equal(objectReference.targetChange.remoteChange, 'update');
  assert.equal(mutationFor(plan, shape.relationshipResourceKey), null);
  assert.equal(refusal.code, 'PLAN_NOT_READY');
  assert.equal(refusal.beforeMutationCalls, 0);
  assert.equal(refusal.remoteHashAfter, refusal.remoteHashBefore);

  const evidence = {
    id: readyCase.id,
    variant: 'derived-stale-object-reference-v3',
    status: plan.status,
    relationship: {
      resourceKey: shape.relationshipResourceKey,
      plannedMutation: false,
      blockerHash: sha256Evidence(relationshipBlocker),
    },
    objectReference: {
      relationshipKey: objectReference.relationshipKey,
      relationshipType: objectReference.relationshipType,
      sourceResourceKey: objectReference.sourceResourceKey,
      targetResourceKey: objectReference.targetResourceKey,
      targetBaseHash: objectReference.targetBaseHash,
      targetLocalHash: objectReference.targetLocalHash,
      targetRemoteHash: objectReference.targetRemoteHash,
      targetLocalChange: objectReference.targetChange.localChange,
      targetRemoteChange: objectReference.targetChange.remoteChange,
      targetRemoteChanged: objectReference.targetRemoteHash !== objectReference.targetBaseHash,
      referenceHash: sha256Evidence(objectReference),
    },
    refusal,
  };

  return {
    ...evidence,
    modelProofHash: sha256Evidence(evidence),
  };
}

function applyRefusalEvidence(remote, plan) {
  const candidate = cloneJson(remote);
  const remoteHashBefore = sha256Evidence(candidate);
  let beforeMutationCalls = 0;
  const error = captureError(() => applyPlan(candidate, plan, {
    beforeMutation() {
      beforeMutationCalls += 1;
    },
  }));
  const remoteHashAfter = sha256Evidence(candidate);

  assert.ok(error instanceof PushPlanError);

  return {
    code: error.code,
    detailsHash: sha256Evidence(error.details || {}),
    beforeMutationCalls,
    refusedBeforeMutation: beforeMutationCalls === 0,
    remoteHashBefore,
    remoteHashAfter,
  };
}

function assertHashOnlyEvidence(proof) {
  const serialized = JSON.stringify(proof);
  for (const forbidden of [
    'Generated wp_term_relationships',
    'generated-wp-term-relationships',
    'Remote stale wp_term_relationships',
    'Remote preserved wp_term_relationships graph note',
    staleObjectDriftTitle,
    'Base post 1',
    'post_title',
    'post_name',
    'post_content',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `RPP-0353 proof leaked ${forbidden}`);
  }
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0353 term relationship object reference v3 proof' }));
}

function assertHashes(proof) {
  assert.match(proof.proofHash, sha256EvidencePattern);
  assert.match(proof.coverage.summaryHash, sha256EvidencePattern);
  for (const entry of proof.selectedCases) {
    assert.match(entry.modelProofHash, sha256EvidencePattern);
    assert.match(entry.relationship.blockerHash || entry.relationship.mutationHash, sha256EvidencePattern);
    assert.match(entry.objectReference.targetBaseHash, sha256Pattern);
    assert.match(entry.objectReference.targetLocalHash, sha256Pattern);
    assert.match(entry.objectReference.targetRemoteHash, sha256Pattern);
  }
}

test('RPP-0353 proves term relationship object reference variant 3 generated ready and stale support', () => {
  const {
    coverage,
    readyCase,
    readyValidation,
    staleCase,
    staleValidation,
  } = generatedCoverageProof();
  const readyEvidence = generatedReadyObjectEvidence(readyCase, readyValidation);
  const staleEvidence = generatedStaleObjectCaseEvidence(staleCase, staleValidation);
  const staleObjectEvidence = derivedStaleObjectEvidence(readyCase);
  const proof = {
    rpp: 'RPP-0353',
    evidenceSource: 'term-relationship-object-reference-v3-local-support',
    status: 'support_only',
    verdict: 'TERM_RELATIONSHIP_OBJECT_REFERENCE_V3_READY_AND_STALE_SUPPORT_ONLY',
    evidenceScope: 'local-generated-support-only',
    productionBacked: false,
    releaseGate: 'NO-GO',
    rawValuesIncluded: false,
    coverage,
    selectedCases: [
      readyEvidence,
      staleEvidence,
      staleObjectEvidence,
    ],
  };
  proof.proofHash = sha256Evidence({
    coverage: proof.coverage,
    selectedCases: proof.selectedCases,
  });

  assert.equal(proof.coverage.readyCases, 5);
  assert.equal(proof.coverage.staleCases, 5);
  assert.deepEqual(
    proof.selectedCases.map((entry) => entry.variant),
    [
      'generated-ready-object-reference-v3',
      'generated-stale-object-reference-v3',
      'derived-stale-object-reference-v3',
    ],
  );
  assert.equal(readyEvidence.objectReference.relationshipKey, objectRelationshipKey);
  assert.equal(readyEvidence.objectReference.targetStableAcrossGeneratedSnapshots, true);
  assert.equal(readyEvidence.objectReference.applyPreservedTarget, true);
  assert.equal(readyEvidence.relationship.appliedHash, readyEvidence.relationship.localHash);
  assert.equal(readyEvidence.validation.staleReplayRejected, true);
  assert.equal(staleEvidence.status, 'blocked');
  assert.equal(staleEvidence.objectReference.targetStableAcrossGeneratedSnapshots, true);
  assert.deepEqual(staleEvidence.staleBlocker.relationshipKeys, [taxonomyRelationshipKey]);
  assert.equal(staleEvidence.refusal.refusedBeforeMutation, true);
  assert.equal(staleObjectEvidence.status, 'blocked');
  assert.equal(staleObjectEvidence.objectReference.relationshipKey, objectRelationshipKey);
  assert.equal(staleObjectEvidence.objectReference.targetRemoteChanged, true);
  assert.equal(staleObjectEvidence.relationship.plannedMutation, false);
  assert.equal(staleObjectEvidence.refusal.refusedBeforeMutation, true);
  assert.equal(staleObjectEvidence.refusal.remoteHashAfter, staleObjectEvidence.refusal.remoteHashBefore);

  assertHashes(proof);
  assertHashOnlyEvidence(proof);
});
