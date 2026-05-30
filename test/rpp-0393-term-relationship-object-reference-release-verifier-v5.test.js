import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash, setResource } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import {
  generatePushHarnessCases,
  validateGeneratedCase,
} from '../scripts/harness/generated-push-cases.js';

const fixedGeneratedHarnessNow = new Date('2026-05-28T00:00:00.000Z');
const targetTag = 'term-relationship-object-graph';
const readyTag = 'wp-term-relationships-graph-ready';
const staleTag = 'wp-term-relationships-graph-stale';
const objectRelationshipKey = 'wp_term_relationships.object_id';
const taxonomyRelationshipKey = 'wp_term_relationships.term_taxonomy_id';
const staleObjectDriftTitle = 'rpp-0393-derived-stale-object-remote-drift';
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}

function rowResource(table, id) {
  return { type: 'row', table, id, key: `row:${JSON.stringify([table, id])}` };
}

function planFor(testCase, remote = testCase.remote) {
  return createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote,
    now: fixedGeneratedHarnessNow,
  });
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
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

function relationshipShape(testCase) {
  const relationships = Object.entries(testCase.local.db?.wp_term_relationships || {})
    .filter(([rowId, row]) =>
      typeof row?.object_id === 'number'
      && typeof row?.term_taxonomy_id === 'number'
      && !Object.hasOwn(testCase.base.db?.wp_term_relationships || {}, rowId)
      && rowId === `object_id:${row.object_id}|term_taxonomy_id:${row.term_taxonomy_id}`);

  assert.equal(relationships.length, 1, `${testCase.id} should carry one target term relationship row`);

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
    taxonomyResourceKey: taxonomyResource.key,
    objectHashes,
  };
}

function objectReferenceEvidence(shape) {
  return {
    relationshipKey: objectRelationshipKey,
    relationshipType: 'term-relationship-object',
    sourceResourceKey: shape.relationshipResourceKey,
    targetResourceKey: shape.objectResourceKey,
    targetTable: 'wp_posts',
    objectIdHash: sha256Evidence(String(shape.relationshipRow.object_id)),
    targetBaseHash: shape.objectHashes.base,
    targetLocalHash: shape.objectHashes.local,
    targetRemoteHash: shape.objectHashes.remote,
    targetStableAcrossGeneratedSnapshots:
      shape.objectHashes.base === shape.objectHashes.local
      && shape.objectHashes.base === shape.objectHashes.remote,
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
  ]) {
    assert.equal(serialized.includes(forbidden), false, `release-verifier proof leaked ${forbidden}`);
  }
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0393 term relationship object release-verifier proof' }));
}

test('RPP-0393 release verifier evidence carries term relationship object ready and stale generated cases', () => {
  const targetCases = generatePushHarnessCases().filter((entry) => entry.tags.has(targetTag));
  const perTier = {};
  const statuses = {};
  const tagCounts = {};
  let readyCase = null;
  let readyValidation = null;
  let generatedStaleCase = null;
  let generatedStaleValidation = null;

  for (const testCase of targetCases) {
    const validation = validateGeneratedCase(testCase);
    increment(perTier, testCase.tier);
    increment(statuses, validation.status);
    if (testCase.tags.has(readyTag)) {
      increment(tagCounts, 'generated-ready-tag');
      assert.equal(validation.status, 'ready', `${testCase.id} ready tag should validate as ready`);
      readyCase ??= testCase;
      readyValidation ??= validation;
    }
    if (testCase.tags.has(staleTag)) {
      increment(tagCounts, 'generated-stale-tag');
      assert.notEqual(validation.status, 'ready', `${testCase.id} stale tag should validate as non-ready`);
      generatedStaleCase ??= testCase;
      generatedStaleValidation ??= validation;
    }
  }

  const coverage = {
    target: 'termRelationshipObjectReferenceReleaseVerifierVariant5',
    generatedHarnessTag: targetTag,
    total: targetCases.length,
    perTier: sortNumericObject(perTier),
    statuses: sortStringObject(statuses),
    readyCases: statuses.ready || 0,
    staleCases: tagCounts['generated-stale-tag'] || 0,
    tagCounts: sortStringObject(tagCounts),
  };

  assert.deepEqual(coverage, {
    target: 'termRelationshipObjectReferenceReleaseVerifierVariant5',
    generatedHarnessTag: targetTag,
    total: 10,
    perTier: { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 1 },
    statuses: { blocked: 5, ready: 5 },
    readyCases: 5,
    staleCases: 5,
    tagCounts: { 'generated-ready-tag': 5, 'generated-stale-tag': 5 },
  });
  assert.ok(readyCase, 'missing generated ready object-reference case');
  assert.ok(generatedStaleCase, 'missing generated stale object-reference case');

  const readyShape = relationshipShape(readyCase);
  const readyPlan = planFor(readyCase);
  const relationshipMutation = readyPlan.mutations.find((mutation) =>
    mutation.resourceKey === readyShape.relationshipResourceKey);
  const relationshipPrecondition = readyPlan.preconditions.find((precondition) =>
    precondition.mutationId === relationshipMutation?.id);
  const appliedReady = applyPlan(cloneJson(readyCase.remote), readyPlan);
  const appliedRelationshipHash = resourceHash(appliedReady.site, readyShape.relationshipResource);
  const localRelationshipHash = resourceHash(readyCase.local, readyShape.relationshipResource);

  assert.equal(readyPlan.status, 'ready');
  assert.ok(relationshipMutation, 'ready generated case should plan the term relationship create');
  assert.equal(relationshipMutation.action, 'put');
  assert.equal(relationshipMutation.changeKind, 'create');
  assert.ok(relationshipPrecondition, 'ready relationship mutation should have a live precondition');
  assert.equal(relationshipPrecondition.resourceKey, relationshipMutation.resourceKey);
  assert.equal(relationshipPrecondition.checkedAgainst, 'live-remote');
  assert.equal(relationshipPrecondition.expectedHash, relationshipMutation.remoteBeforeHash);
  assert.equal(appliedRelationshipHash, localRelationshipHash);
  assert.equal(readyValidation.applied, true);
  assert.equal(readyValidation.unplannedRemotePreserved, true);
  assert.equal(readyValidation.staleReplayRejected, true);
  assert.equal(readyValidation.staleReplayRejectionCode, 'PRECONDITION_FAILED');

  const generatedStaleShape = relationshipShape(generatedStaleCase);
  const generatedStalePlan = planFor(generatedStaleCase);
  const generatedStaleBlocker = generatedStalePlan.blockers.find((blocker) =>
    blocker.resourceKey === generatedStaleShape.relationshipResourceKey);

  assert.equal(generatedStalePlan.status, 'blocked');
  assert.ok(generatedStaleBlocker, 'generated stale case should expose a relationship graph blocker');
  assert.equal(generatedStaleBlocker.class, 'stale-wordpress-graph-identity');
  assert.deepEqual(
    generatedStaleBlocker.references.map((reference) => reference.relationshipKey).sort(),
    [taxonomyRelationshipKey],
  );
  assert.equal(
    generatedStalePlan.mutations.some((mutation) => mutation.resourceKey === generatedStaleShape.relationshipResourceKey),
    false,
  );
  assert.equal(generatedStaleValidation.applied, false);
  assert.equal(generatedStaleValidation.nonReadyRemoteUnchanged, true);

  const staleObjectRemote = cloneJson(readyCase.remote);
  setResource(staleObjectRemote, readyShape.objectResource, {
    ...staleObjectRemote.db.wp_posts[`ID:${readyShape.relationshipRow.object_id}`],
    post_title: staleObjectDriftTitle,
  });
  const staleObjectPlan = planFor(readyCase, staleObjectRemote);
  const staleObjectBlocker = staleObjectPlan.blockers.find((blocker) =>
    blocker.resourceKey === readyShape.relationshipResourceKey
    && blocker.references?.some((reference) => reference.relationshipKey === objectRelationshipKey));
  const staleObjectReference = staleObjectBlocker?.references.find((reference) =>
    reference.relationshipKey === objectRelationshipKey);
  const staleObjectBeforeHash = digest(staleObjectRemote);
  const staleObjectError = captureError(() => applyPlan(staleObjectRemote, staleObjectPlan));
  const staleObjectAfterHash = digest(staleObjectRemote);

  assert.equal(staleObjectPlan.status, 'blocked');
  assert.ok(staleObjectBlocker, 'stale object drift should fail closed on the relationship row');
  assert.ok(staleObjectReference, 'stale object drift should expose the object_id relationship reference');
  assert.equal(staleObjectReference.relationshipType, 'term-relationship-object');
  assert.equal(staleObjectReference.targetResourceKey, readyShape.objectResourceKey);
  assert.equal(staleObjectReference.targetBaseHash, staleObjectReference.targetLocalHash);
  assert.notEqual(staleObjectReference.targetBaseHash, staleObjectReference.targetRemoteHash);
  assert.equal(staleObjectReference.targetChange.localChange, 'unchanged');
  assert.equal(staleObjectReference.targetChange.remoteChange, 'update');
  assert.equal(staleObjectPlan.mutations.some((mutation) => mutation.resourceKey === readyShape.relationshipResourceKey), false);
  assert.ok(staleObjectError instanceof PushPlanError);
  assert.equal(staleObjectError.code, 'PLAN_NOT_READY');
  assert.equal(staleObjectAfterHash, staleObjectBeforeHash);

  const proof = {
    rpp: 'RPP-0393',
    evidenceSource: 'release-verifier-term-relationship-object-reference-v5',
    status: 'support_only',
    verdict: 'TERM_RELATIONSHIP_OBJECT_REFERENCE_READY_AND_STALE_GENERATED_SUPPORT_ONLY',
    evidenceScope: 'local-generated-harness',
    productionBacked: false,
    releaseGate: 'NO-GO',
    rawValuesIncluded: false,
    releaseVerifier: {
      checkedBy: 'test/rpp-0393-term-relationship-object-reference-release-verifier-v5.test.js',
      generatedHarnessIncludesReadyAndStaleCases: coverage.readyCases > 0 && coverage.staleCases > 0,
      staleObjectReferenceFailsClosed: true,
    },
    coverage,
    selectedCases: [
      {
        id: readyCase.id,
        variant: 'generated-ready',
        status: readyPlan.status,
        relationship: {
          resourceKey: readyShape.relationshipResourceKey,
          mutationHash: sha256Evidence(relationshipMutation),
          preconditionHash: sha256Evidence(relationshipPrecondition),
          appliedHash: appliedRelationshipHash,
        },
        objectReference: objectReferenceEvidence(readyShape),
      },
      {
        id: generatedStaleCase.id,
        variant: 'generated-stale',
        status: generatedStalePlan.status,
        relationship: {
          resourceKey: generatedStaleShape.relationshipResourceKey,
          plannedMutation: false,
          blockerHash: sha256Evidence(generatedStaleBlocker),
        },
        objectReference: objectReferenceEvidence(generatedStaleShape),
      },
      {
        id: readyCase.id,
        variant: 'derived-stale-object-reference',
        status: staleObjectPlan.status,
        relationship: {
          resourceKey: readyShape.relationshipResourceKey,
          plannedMutation: false,
          blockerHash: sha256Evidence(staleObjectBlocker),
        },
        objectReference: {
          relationshipKey: staleObjectReference.relationshipKey,
          relationshipType: staleObjectReference.relationshipType,
          targetResourceKey: staleObjectReference.targetResourceKey,
          targetBaseHash: staleObjectReference.targetBaseHash,
          targetLocalHash: staleObjectReference.targetLocalHash,
          targetRemoteHash: staleObjectReference.targetRemoteHash,
          targetRemoteChanged: staleObjectReference.targetRemoteHash !== staleObjectReference.targetBaseHash,
        },
        refusal: {
          code: staleObjectError.code,
          beforeMutation: true,
          remoteHashBefore: sha256Evidence(staleObjectBeforeHash),
          remoteHashAfter: sha256Evidence(staleObjectAfterHash),
        },
      },
    ],
  };
  proof.proofHash = sha256Evidence({ coverage: proof.coverage, selectedCases: proof.selectedCases });

  assert.equal(proof.releaseVerifier.generatedHarnessIncludesReadyAndStaleCases, true);
  assert.equal(proof.releaseVerifier.staleObjectReferenceFailsClosed, true);
  assert.equal(proof.selectedCases[0].objectReference.targetStableAcrossGeneratedSnapshots, true);
  assert.equal(proof.selectedCases[1].objectReference.targetStableAcrossGeneratedSnapshots, true);
  assert.equal(proof.selectedCases[2].objectReference.relationshipKey, objectRelationshipKey);
  assert.equal(proof.selectedCases[2].objectReference.targetRemoteChanged, true);
  assert.equal(proof.selectedCases[2].refusal.remoteHashAfter, proof.selectedCases[2].refusal.remoteHashBefore);

  for (const selectedCase of proof.selectedCases) {
    assert.match(selectedCase.relationship.blockerHash || selectedCase.relationship.mutationHash, sha256EvidencePattern);
  }
  assert.match(proof.proofHash, sha256EvidencePattern);
  assertHashOnlyEvidence(proof);
});
