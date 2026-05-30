import test from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';

import { applyPlan } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import { buildComplexSiteReleaseEvidence } from '../scripts/playground/local-production-complex-site-proof.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const postId = 71001;
const termId = 72901;
const termTaxonomyId = 72911;
const termmetaId = 72921;
const termRowId = `term_id:${termId}`;
const taxonomyRowId = `term_taxonomy_id:${termTaxonomyId}`;
const relationshipRowId = `object_id:${postId}|term_taxonomy_id:${termTaxonomyId}`;
const termmetaRowId = `meta_id:${termmetaId}`;
const termResourceKey = rowResourceKey('wp_terms', termRowId);
const taxonomyResourceKey = rowResourceKey('wp_term_taxonomy', taxonomyRowId);
const relationshipResourceKey = rowResourceKey('wp_term_relationships', relationshipRowId);
const termmetaResourceKey = rowResourceKey('wp_termmeta', termmetaRowId);
const releaseStateResourceKey = rowResourceKey('wp_reprint_push_release_state', 'state_id:1');
const relationshipKey = 'wp_term_relationships.term_taxonomy_id';
const relationshipType = 'term-relationship-taxonomy';
const hashPattern = /^[a-f0-9]{64}$/;
const privateMarkers = Object.freeze([
  'RPP-0394 Private Category Term',
  'rpp-0394-private-category-term',
  'RPP-0394 private category taxonomy description',
  'rpp-0394-private-termmeta',
]);

function rowResourceKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite() {
  return {
    meta: {
      fixture: 'rpp-0394-source',
      pluginOwnedResources: {
        allowedResources: [
          {
            resourceKey: releaseStateResourceKey,
            pluginOwner: 'reprint-push',
            driver: 'reprint-push-release-state',
            table: 'wp_reprint_push_release_state',
            supportsDelete: false,
          },
        ],
      },
    },
    files: {
      'index.php': '<?php echo "rpp-0394-base";',
    },
    plugins: {},
    db: {
      wp_posts: {
        [`ID:${postId}`]: {
          ID: postId,
          post_title: 'Stable RPP-0394 relationship object',
          post_name: 'stable-rpp0394-relationship-object',
          post_status: 'publish',
          post_type: 'post',
          post_parent: 0,
          post_author: 0,
        },
      },
      wp_reprint_push_release_state: {},
      wp_terms: {},
      wp_term_taxonomy: {},
      wp_term_relationships: {},
      wp_termmeta: {},
    },
  };
}

function localWithTermRelationshipTaxonomyGraph(base) {
  const local = cloneJson(base);

  local.meta.fixture = 'rpp-0394-local-edited';
  local.db.wp_terms[termRowId] = {
    term_id: termId,
    name: 'RPP-0394 Private Category Term',
    slug: 'rpp-0394-private-category-term',
    term_group: 0,
  };
  local.db.wp_term_taxonomy[taxonomyRowId] = {
    term_taxonomy_id: termTaxonomyId,
    term_id: termId,
    taxonomy: 'category',
    description: 'RPP-0394 private category taxonomy description',
    parent: 0,
    count: 1,
  };
  local.db.wp_term_relationships[relationshipRowId] = {
    object_id: postId,
    term_taxonomy_id: termTaxonomyId,
    term_order: 0,
  };
  local.db.wp_termmeta[termmetaRowId] = {
    meta_id: termmetaId,
    term_id: termId,
    meta_key: 'reprint_push_taxonomy_fixture',
    meta_value: 'rpp-0394-private-termmeta',
  };

  return local;
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey) || null;
}

function preconditionFor(plan, mutation) {
  return plan.preconditions.find((entry) => entry.mutationId === mutation?.id) || null;
}

function assertEveryMutationHasLiveRemotePrecondition(plan) {
  for (const mutation of plan.mutations) {
    const precondition = preconditionFor(plan, mutation);
    assert.ok(precondition, `missing precondition for ${mutation.resourceKey}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey);
    assert.equal(precondition.checkedAgainst, 'live-remote');
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.match(precondition.expectedHash, hashPattern);
  }
}

function buildReadyFixture() {
  const base = baseSite();
  const local = localWithTermRelationshipTaxonomyGraph(base);
  const remote = cloneJson(base);
  remote.meta.fixture = 'rpp-0394-remote';
  const plan = planFor(base, local, remote);
  const applied = applyPlan(cloneJson(remote), plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.blockers.length, 0);
  assert.equal(plan.conflicts.length, 0);

  return { base, local, remote, plan, applied };
}

function releaseSummaryFromPlan({
  plan,
  appliedSite,
  localSite,
  omitApplyRevalidationResourceKey = null,
  relationshipTermTaxonomyOverride = null,
} = {}) {
  const releaseStateMutation = syntheticReleaseStateMutation();
  const mutations = [
    releaseStateMutation,
    ...cloneJson(plan.mutations),
  ];
  const preconditions = [
    {
      mutationId: releaseStateMutation.id,
      resourceKey: releaseStateMutation.resourceKey,
      checkedAgainst: 'live-remote',
      expectedHash: releaseStateMutation.baseHash,
    },
    ...cloneJson(plan.preconditions),
  ];
  const relationshipMutation = mutations.find((mutation) =>
    mutation.resourceKey === relationshipResourceKey);
  const afterTermTaxonomyId = relationshipTermTaxonomyOverride ?? termTaxonomyId;

  if (relationshipTermTaxonomyOverride != null && relationshipMutation?.value?.value) {
    relationshipMutation.value.value.term_taxonomy_id = relationshipTermTaxonomyOverride;
  }

  const verifiedResourceKeys = mutations
    .map((mutation) => mutation.resourceKey)
    .filter((resourceKey) => resourceKey !== omitApplyRevalidationResourceKey);

  return {
    ok: true,
    releaseMovement: {
      allowed: true,
      gates: 'candidate-for-review',
      reason: 'checked live source/local/changed topology carried RPP-0394 relationship taxonomy evidence',
    },
    boundary: {
      firstRemainingProductionBoundary: null,
      verdict: 'LIVE_RELEASE_BOUNDARY_OK',
      authSession: { verdict: 'LIVE_RELEASE_BOUNDARY_OK' },
      durableJournal: { verdict: 'LIVE_RELEASE_BOUNDARY_OK' },
      replayAndRetry: { verdict: 'LIVE_RELEASE_BOUNDARY_OK' },
    },
    authSessionBoundary: {
      verdict: 'AUTH_SESSION_BOUNDARY_OK',
      identityContinuity: {
        sameSession: true,
        sameUserLogin: true,
        manageOptions: true,
      },
    },
    releaseProof: {
      dryRun: {
        status: 200,
        receiptHash: 'a'.repeat(64),
      },
      apply: {
        status: 200,
        applyRevalidation: {
          verifiedCount: verifiedResourceKeys.length,
          phase: 'before-first-mutation',
          checkedAgainst: 'live-remote',
          verifiedResourceKeys,
        },
      },
      after: {
        status: 200,
        finalMatchesLocal: isDeepStrictEqual(appliedSite.db, localSite.db),
        termRelationshipTaxonomy: {
          relationshipKey,
          relationshipType,
          resourceKey: relationshipResourceKey,
          targetResourceKey: taxonomyResourceKey,
          objectId: appliedSite.db.wp_term_relationships[relationshipRowId]?.object_id ?? null,
          termTaxonomyId: afterTermTaxonomyId,
        },
      },
      planObject: {
        mutations,
        preconditions,
      },
    },
    durableJournal: {
      rows: mutations.length + 10,
      rowCount: mutations.length + 10,
      readbackPages: 2,
      paginationComplete: true,
      paginationTruncated: false,
      oldestSequence: 1,
      newestSequence: mutations.length + 10,
      mutationApplied: mutations.length,
      applyCommitted: true,
      checkedAccepted: true,
      ownership: {
        ownsJournal: true,
        restartReadable: true,
      },
    },
    replayEquivalence: {
      equivalent: true,
      mismatches: [],
    },
    gate2DurableRecoveryJournal: {
      ok: true,
    },
  };
}

function syntheticReleaseStateMutation() {
  return {
    id: 'mutation-release-state',
    resourceKey: releaseStateResourceKey,
    action: 'put',
    resource: {
      type: 'row',
      table: 'wp_reprint_push_release_state',
      id: 'state_id:1',
      key: releaseStateResourceKey,
    },
    pluginOwnedResource: {
      pluginOwner: 'reprint-push',
      driver: 'reprint-push-release-state',
      table: 'wp_reprint_push_release_state',
      supportsDelete: false,
    },
    value: {
      value: {
        state_id: 1,
        payload: {
          owner: 'reprint-push',
          mode: 'local-rpp-0394',
          version: 2,
          releaseBoundaryProof: 'term-relationship-taxonomy-reference',
        },
        updated_marker: 'local-rpp-0394',
        __pluginOwner: 'reprint-push',
      },
    },
    baseHash: 'b'.repeat(64),
    remoteBeforeHash: 'b'.repeat(64),
    localHash: 'c'.repeat(64),
  };
}

function termRelationshipTaxonomyReleaseEvidence(releaseSummary) {
  const planObject = releaseSummary.releaseProof.planObject;
  const relationshipMutation = planObject.mutations.find((mutation) =>
    mutation.resourceKey === relationshipResourceKey) || null;
  const taxonomyMutation = planObject.mutations.find((mutation) =>
    mutation.resourceKey === taxonomyResourceKey) || null;
  const relationshipPrecondition = planObject.preconditions.find((precondition) =>
    precondition.resourceKey === relationshipResourceKey) || null;
  const relationshipValue = relationshipMutation
    ? deserializeResourceValue(relationshipMutation.value)
    : null;
  const verifiedResourceKeys = releaseSummary.releaseProof.apply.applyRevalidation.verifiedResourceKeys || [];
  const afterRelationship = releaseSummary.releaseProof.after.termRelationshipTaxonomy || {};
  const mutationPlanned = Boolean(relationshipMutation);
  const targetMutationPlanned = Boolean(taxonomyMutation);
  const carriesTaxonomyTarget = Number(relationshipValue?.term_taxonomy_id) === termTaxonomyId
    && relationshipMutation?.resource?.table === 'wp_term_relationships'
    && relationshipMutation?.resource?.id === relationshipRowId;
  const preconditionLive = relationshipPrecondition?.checkedAgainst === 'live-remote'
    && relationshipPrecondition.expectedHash === relationshipMutation?.remoteBeforeHash
    && relationshipPrecondition.expectedHash === relationshipMutation?.baseHash
    && hashPattern.test(relationshipPrecondition.expectedHash);
  const applyRevalidated = verifiedResourceKeys.includes(relationshipResourceKey);
  const finalCarriesTaxonomyTarget = Number(afterRelationship.termTaxonomyId) === termTaxonomyId
    && Number(afterRelationship.objectId) === postId;
  const proof = {
    target: 'termRelationshipTaxonomyReferenceReleaseVerifierVariant5',
    relationshipKey,
    relationshipType,
    resourceKey: relationshipResourceKey,
    targetResourceKey: taxonomyResourceKey,
    mutation: {
      planned: mutationPlanned,
      action: relationshipMutation?.action || null,
      changeKind: relationshipMutation?.changeKind || null,
      objectId: Number(relationshipValue?.object_id),
      termTaxonomyId: Number(relationshipValue?.term_taxonomy_id),
      carriesTaxonomyTarget,
      baseHash: relationshipMutation?.baseHash || null,
      remoteBeforeHash: relationshipMutation?.remoteBeforeHash || null,
      localHash: relationshipMutation?.localHash || null,
    },
    targetMutation: {
      planned: targetMutationPlanned,
      resourceKey: taxonomyMutation?.resourceKey || null,
    },
    precondition: {
      live: preconditionLive,
      expectedHash: relationshipPrecondition?.expectedHash || null,
      checkedAgainst: relationshipPrecondition?.checkedAgainst || null,
    },
    apply: {
      revalidated: applyRevalidated,
      verifiedCount: releaseSummary.releaseProof.apply.applyRevalidation.verifiedCount,
      finalMatchesLocal: releaseSummary.releaseProof.after.finalMatchesLocal,
      finalCarriesTaxonomyTarget,
    },
  };

  return {
    ...proof,
    allThroughApply: mutationPlanned
      && targetMutationPlanned
      && carriesTaxonomyTarget
      && preconditionLive
      && applyRevalidated
      && finalCarriesTaxonomyTarget
      && releaseSummary.releaseProof.after.finalMatchesLocal === true,
    proofHash: `sha256:${digest(proof)}`,
  };
}

test('RPP-0394 release verifier carries the term relationship taxonomy reference through apply', () => {
  const { local, plan, applied } = buildReadyFixture();
  const releaseSummary = releaseSummaryFromPlan({
    plan,
    appliedSite: applied.site,
    localSite: local,
  });
  const releaseEvidence = buildComplexSiteReleaseEvidence({
    plannerProof: { ok: true, shape: { taxonomyGraph: true } },
    verifyOutput: JSON.stringify(releaseSummary),
    verifyStatus: 0,
    verifySignal: null,
  });
  const carryThrough = termRelationshipTaxonomyReleaseEvidence(releaseSummary);
  const relationshipMutation = mutationFor(plan, relationshipResourceKey);
  const taxonomyMutation = mutationFor(plan, taxonomyResourceKey);
  const plannedRelationship = deserializeResourceValue(relationshipMutation.value);
  const tamperedSummary = releaseSummaryFromPlan({
    plan,
    appliedSite: applied.site,
    localSite: local,
    relationshipTermTaxonomyOverride: termTaxonomyId + 1,
  });
  const tamperedCarryThrough = termRelationshipTaxonomyReleaseEvidence(tamperedSummary);
  const redactedEvidence = JSON.stringify({ releaseEvidence, carryThrough });

  assert.deepEqual(
    new Set(plan.mutations.map((mutation) => mutation.resourceKey)),
    new Set([
      termResourceKey,
      taxonomyResourceKey,
      relationshipResourceKey,
      termmetaResourceKey,
    ]),
  );
  assert.equal(relationshipMutation.action, 'put');
  assert.equal(relationshipMutation.changeKind, 'create');
  assert.equal(taxonomyMutation.action, 'put');
  assert.equal(plannedRelationship.object_id, postId);
  assert.equal(plannedRelationship.term_taxonomy_id, termTaxonomyId);
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.deepEqual(
    applied.site.db.wp_term_relationships[relationshipRowId],
    local.db.wp_term_relationships[relationshipRowId],
  );

  assert.equal(releaseEvidence.ok, true);
  assert.equal(releaseEvidence.verifier.receipt.present, true);
  assert.equal(releaseEvidence.verifier.plan.mutations, plan.mutations.length + 1);
  assert.equal(releaseEvidence.verifier.plan.preconditions, plan.preconditions.length + 1);
  assert.equal(releaseEvidence.verifier.taxonomyGraph.required, true);
  assert.equal(releaseEvidence.verifier.taxonomyGraph.resourceKey, taxonomyResourceKey);
  assert.equal(releaseEvidence.verifier.taxonomyGraph.termResourceKey, termResourceKey);
  assert.equal(releaseEvidence.verifier.taxonomyGraph.termTaxonomyMutationPlanned, true);
  assert.equal(releaseEvidence.verifier.taxonomyGraph.termTaxonomyMutationCarriesTermReference, true);
  assert.equal(releaseEvidence.verifier.taxonomyGraph.preconditionLive, true);
  assert.equal(releaseEvidence.verifier.taxonomyGraph.applyRevalidated, true);
  assert.equal(releaseEvidence.verifier.taxonomyGraph.finalMatchesLocal, true);
  assert.equal(releaseEvidence.invariants.applyRevalidationCoveredEveryMutation, true);
  assert.equal(releaseEvidence.invariants.taxonomyGraphTermTaxonomyApplyRevalidated, true);

  assert.deepEqual(carryThrough, {
    target: 'termRelationshipTaxonomyReferenceReleaseVerifierVariant5',
    relationshipKey,
    relationshipType,
    resourceKey: relationshipResourceKey,
    targetResourceKey: taxonomyResourceKey,
    mutation: {
      planned: true,
      action: 'put',
      changeKind: 'create',
      objectId: postId,
      termTaxonomyId,
      carriesTaxonomyTarget: true,
      baseHash: relationshipMutation.baseHash,
      remoteBeforeHash: relationshipMutation.remoteBeforeHash,
      localHash: relationshipMutation.localHash,
    },
    targetMutation: {
      planned: true,
      resourceKey: taxonomyResourceKey,
    },
    precondition: {
      live: true,
      expectedHash: relationshipMutation.remoteBeforeHash,
      checkedAgainst: 'live-remote',
    },
    apply: {
      revalidated: true,
      verifiedCount: plan.mutations.length + 1,
      finalMatchesLocal: true,
      finalCarriesTaxonomyTarget: true,
    },
    allThroughApply: true,
    proofHash: carryThrough.proofHash,
  });
  assert.match(carryThrough.proofHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(tamperedCarryThrough.allThroughApply, false);
  assert.equal(tamperedCarryThrough.mutation.carriesTaxonomyTarget, false);
  assert.equal(tamperedCarryThrough.apply.finalCarriesTaxonomyTarget, false);

  for (const marker of privateMarkers) {
    assert.equal(redactedEvidence.includes(marker), false, `release evidence leaked ${marker}`);
  }
});

test('RPP-0394 carry-through evidence fails closed when relationship apply revalidation is omitted', () => {
  const { local, plan, applied } = buildReadyFixture();
  const releaseSummary = releaseSummaryFromPlan({
    plan,
    appliedSite: applied.site,
    localSite: local,
    omitApplyRevalidationResourceKey: relationshipResourceKey,
  });
  const releaseEvidence = buildComplexSiteReleaseEvidence({
    plannerProof: { ok: true, shape: { taxonomyGraph: true } },
    verifyOutput: JSON.stringify(releaseSummary),
    verifyStatus: 0,
    verifySignal: null,
  });
  const carryThrough = termRelationshipTaxonomyReleaseEvidence(releaseSummary);

  assert.equal(releaseEvidence.ok, false);
  assert.equal(releaseEvidence.invariants.applyRevalidationCoveredEveryMutation, false);
  assert.equal(carryThrough.mutation.carriesTaxonomyTarget, true);
  assert.equal(carryThrough.precondition.live, true);
  assert.equal(carryThrough.apply.revalidated, false);
  assert.equal(carryThrough.allThroughApply, false);
});
