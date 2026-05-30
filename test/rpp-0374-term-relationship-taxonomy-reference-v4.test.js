import test from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';

import { applyPlan } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue } from '../src/resources.js';
import { buildComplexSiteReleaseEvidence } from '../scripts/playground/local-production-complex-site-proof.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const postId = 71001;
const termId = 72901;
const termTaxonomyId = 72911;
const termRowId = `term_id:${termId}`;
const taxonomyRowId = `term_taxonomy_id:${termTaxonomyId}`;
const relationshipRowId = `object_id:${postId}|term_taxonomy_id:${termTaxonomyId}`;
const termResourceKey = rowResourceKey('wp_terms', termRowId);
const taxonomyResourceKey = rowResourceKey('wp_term_taxonomy', taxonomyRowId);
const relationshipResourceKey = rowResourceKey('wp_term_relationships', relationshipRowId);
const releaseStateResourceKey = rowResourceKey('wp_reprint_push_release_state', 'state_id:1');
const hashPattern = /^[a-f0-9]{64}$/;

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "base";',
    },
    plugins: {},
    db: {
      wp_posts: {
        [`ID:${postId}`]: {
          ID: postId,
          post_title: 'Stable RPP-0374 relationship object',
          post_name: 'stable-rpp0374-relationship-object',
          post_status: 'publish',
          post_type: 'post',
          post_parent: 0,
          post_author: 0,
        },
      },
      wp_terms: {},
      wp_term_taxonomy: {},
      wp_term_relationships: {},
    },
  };
}

function localWithTermRelationshipTaxonomyGraph(base) {
  const local = cloneJson(base);
  local.db.wp_terms[termRowId] = {
    term_id: termId,
    name: 'RPP-0374 category target',
    slug: 'rpp-0374-category-target',
    term_group: 0,
  };
  local.db.wp_term_taxonomy[taxonomyRowId] = {
    term_taxonomy_id: termTaxonomyId,
    term_id: termId,
    taxonomy: 'category',
    description: 'RPP-0374 taxonomy target for relationship carry-through.',
    parent: 0,
    count: 1,
  };
  local.db.wp_term_relationships[relationshipRowId] = {
    object_id: postId,
    term_taxonomy_id: termTaxonomyId,
    term_order: 0,
  };
  return local;
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function rowResourceKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function preconditionFor(plan, mutation) {
  return plan.preconditions.find((entry) => entry.mutationId === mutation?.id);
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

function buildReleaseSummary({ plan, appliedSite, localSite }) {
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
  const mutationCount = mutations.length;
  const appliedRelationship = appliedSite.db.wp_term_relationships[relationshipRowId] || null;

  return {
    ok: true,
    releaseMovement: {
      allowed: true,
      gates: 'candidate-for-review',
      reason: 'checked live source/local/changed topology passed without packaged fallback',
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
          verifiedCount: mutationCount,
          phase: 'before-first-mutation',
          checkedAgainst: 'live-remote',
          verifiedResourceKeys: mutations.map((mutation) => mutation.resourceKey),
        },
      },
      after: {
        status: 200,
        finalMatchesLocal: isDeepStrictEqual(appliedSite.db, localSite.db),
        termRelationshipTaxonomy: {
          relationshipKey: 'wp_term_relationships.term_taxonomy_id',
          relationshipType: 'term-relationship-taxonomy',
          resourceKey: relationshipResourceKey,
          targetResourceKey: taxonomyResourceKey,
          termTaxonomyId: appliedRelationship?.term_taxonomy_id ?? null,
        },
      },
      planObject: {
        mutations,
        preconditions,
      },
    },
    durableJournal: {
      rows: mutationCount + 10,
      rowCount: mutationCount + 10,
      readbackPages: 2,
      paginationComplete: true,
      paginationTruncated: false,
      oldestSequence: 1,
      newestSequence: mutationCount + 10,
      mutationApplied: mutationCount,
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
          mode: 'local-rpp-0374',
          releaseBoundaryProof: 'term-relationship-taxonomy-reference',
        },
        updated_marker: 'local-rpp-0374',
        __pluginOwner: 'reprint-push',
      },
    },
    baseHash: 'b'.repeat(64),
    remoteBeforeHash: 'b'.repeat(64),
    localHash: 'c'.repeat(64),
  };
}

function termRelationshipTaxonomyCarryThroughEvidence(releaseSummary) {
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
  const verifiedResourceKeys = releaseSummary.releaseProof.apply.applyRevalidation.verifiedResourceKeys;
  const afterRelationship = releaseSummary.releaseProof.after.termRelationshipTaxonomy || {};
  const mutationPlanned = Boolean(relationshipMutation);
  const targetMutationPlanned = Boolean(taxonomyMutation);
  const carriesTaxonomyTarget = Number(relationshipValue?.term_taxonomy_id) === termTaxonomyId;
  const preconditionLive = relationshipPrecondition?.checkedAgainst === 'live-remote'
    && relationshipPrecondition.expectedHash === relationshipMutation?.remoteBeforeHash
    && relationshipPrecondition.expectedHash === relationshipMutation?.baseHash
    && hashPattern.test(relationshipPrecondition.expectedHash);
  const applyRevalidated = verifiedResourceKeys.includes(relationshipResourceKey);
  const finalCarriesTaxonomyTarget = Number(afterRelationship.termTaxonomyId) === termTaxonomyId;

  return {
    relationshipKey: 'wp_term_relationships.term_taxonomy_id',
    relationshipType: 'term-relationship-taxonomy',
    resourceKey: relationshipResourceKey,
    targetResourceKey: taxonomyResourceKey,
    mutationPlanned,
    targetMutationPlanned,
    carriesTaxonomyTarget,
    preconditionLive,
    applyRevalidated,
    finalCarriesTaxonomyTarget,
    allThroughApply: mutationPlanned
      && targetMutationPlanned
      && carriesTaxonomyTarget
      && preconditionLive
      && applyRevalidated
      && finalCarriesTaxonomyTarget,
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

test('RPP-0374 variant 4 applies a term relationship with its taxonomy target intact', () => {
  const base = baseSite();
  const local = localWithTermRelationshipTaxonomyGraph(base);
  const remote = cloneJson(base);
  const plan = planFor(base, local, remote);
  const applied = applyPlan(cloneJson(remote), plan);
  const relationshipMutation = mutationFor(plan, relationshipResourceKey);
  const taxonomyMutation = mutationFor(plan, taxonomyResourceKey);
  const termMutation = mutationFor(plan, termResourceKey);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.ok(termMutation, 'missing same-plan term target mutation');
  assert.ok(taxonomyMutation, 'missing same-plan term_taxonomy target mutation');
  assert.ok(relationshipMutation, 'missing term relationship mutation');
  const plannedRelationship = deserializeResourceValue(relationshipMutation.value);
  assert.equal(relationshipMutation.changeKind, 'create');
  assert.equal(plannedRelationship.object_id, postId);
  assert.equal(plannedRelationship.term_taxonomy_id, termTaxonomyId);
  assert.equal(relationshipMutation.wordpressGraphIdentity?.rewrites?.length || 0, 0);
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.deepEqual(applied.site.db.wp_term_relationships[relationshipRowId], local.db.wp_term_relationships[relationshipRowId]);
  assert.deepEqual(applied.site.db.wp_term_taxonomy[taxonomyRowId], local.db.wp_term_taxonomy[taxonomyRowId]);
});

test('RPP-0374 variant 4 local production verifier carries the relationship taxonomy target through apply', () => {
  const base = baseSite();
  const local = localWithTermRelationshipTaxonomyGraph(base);
  const remote = cloneJson(base);
  const plan = planFor(base, local, remote);
  const applied = applyPlan(cloneJson(remote), plan);
  const releaseSummary = buildReleaseSummary({ plan, appliedSite: applied.site, localSite: local });
  const releaseEvidence = buildComplexSiteReleaseEvidence({
    plannerProof: { ok: true, shape: { taxonomyGraph: true } },
    verifyOutput: JSON.stringify(releaseSummary),
    verifyStatus: 0,
    verifySignal: null,
  });
  const relationshipCarryThrough = termRelationshipTaxonomyCarryThroughEvidence(releaseSummary);
  const tamperedSummary = cloneJson(releaseSummary);
  const tamperedRelationshipMutation = tamperedSummary.releaseProof.planObject.mutations.find((mutation) =>
    mutation.resourceKey === relationshipResourceKey);
  tamperedRelationshipMutation.value.value.term_taxonomy_id = termTaxonomyId + 1;
  tamperedSummary.releaseProof.after.termRelationshipTaxonomy.termTaxonomyId = termTaxonomyId + 1;
  const tamperedCarryThrough = termRelationshipTaxonomyCarryThroughEvidence(tamperedSummary);

  assert.equal(releaseEvidence.ok, true);
  assert.equal(releaseEvidence.verifier.taxonomyGraph.required, true);
  assert.equal(releaseEvidence.verifier.taxonomyGraph.resourceKey, taxonomyResourceKey);
  assert.equal(releaseEvidence.verifier.taxonomyGraph.applyRevalidated, true);
  assert.equal(releaseEvidence.verifier.receipt.applyRevalidationVerifiedCount, plan.mutations.length + 1);
  assert.equal(releaseEvidence.invariants.applyRevalidationCoveredEveryMutation, true);
  assert.deepEqual(relationshipCarryThrough, {
    relationshipKey: 'wp_term_relationships.term_taxonomy_id',
    relationshipType: 'term-relationship-taxonomy',
    resourceKey: relationshipResourceKey,
    targetResourceKey: taxonomyResourceKey,
    mutationPlanned: true,
    targetMutationPlanned: true,
    carriesTaxonomyTarget: true,
    preconditionLive: true,
    applyRevalidated: true,
    finalCarriesTaxonomyTarget: true,
    allThroughApply: true,
  });
  assert.equal(tamperedCarryThrough.allThroughApply, false);
  assert.equal(tamperedCarryThrough.carriesTaxonomyTarget, false);
  assert.equal(tamperedCarryThrough.finalCarriesTaxonomyTarget, false);
});
