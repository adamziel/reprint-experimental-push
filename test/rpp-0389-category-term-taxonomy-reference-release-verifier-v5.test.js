import test from 'node:test';
import assert from 'node:assert/strict';

import { createPushPlan } from '../src/planner.js';
import { buildComplexSiteReleaseEvidence } from '../scripts/playground/local-production-complex-site-proof.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const taxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:72911"]';
const termResourceKey = 'row:["wp_terms","term_id:72901"]';
const relationshipResourceKey = 'row:["wp_term_relationships","object_id:71001|term_taxonomy_id:72911"]';
const termmetaResourceKey = 'row:["wp_termmeta","meta_id:72921"]';
const releaseStateResourceKey = 'row:["wp_reprint_push_release_state","state_id:1"]';
const privateMarkers = Object.freeze([
  'RPP-0389 Private Category Term',
  'RPP-0389 private category taxonomy description',
  'rpp-0389-private-termmeta',
]);

const categoryShape = Object.freeze({
  taxonomyGraph: true,
});

test('RPP-0389 release verifier carries category term_taxonomy reference through apply', () => {
  const { plan, evidence } = buildEvidenceFromReadyCategoryPlan();
  const taxonomyMutation = mutationFor(plan, taxonomyResourceKey);
  const plannedTaxonomy = taxonomyMutation.value.value;

  assert.equal(plan.status, 'ready');
  assert.deepEqual(
    new Set(plan.mutations.map((mutation) => mutation.resourceKey)),
    new Set([
      releaseStateResourceKey,
      relationshipResourceKey,
      taxonomyResourceKey,
      termmetaResourceKey,
      termResourceKey,
    ]),
  );
  assert.equal(taxonomyMutation.action, 'put');
  assert.equal(taxonomyMutation.resource.table, 'wp_term_taxonomy');
  assert.equal(taxonomyMutation.resource.id, 'term_taxonomy_id:72911');
  assert.equal(plannedTaxonomy.term_taxonomy_id, 72911);
  assert.equal(plannedTaxonomy.term_id, 72901);
  assert.equal(plannedTaxonomy.taxonomy, 'category');

  assert.equal(evidence.ok, true);
  assert.equal(evidence.verifier.receipt.present, true);
  assert.equal(evidence.verifier.plan.mutations, plan.mutations.length);
  assert.equal(evidence.verifier.plan.preconditions, plan.preconditions.length);
  assert.equal(evidence.verifier.taxonomyGraph.required, true);
  assert.equal(evidence.verifier.taxonomyGraph.resourceKey, taxonomyResourceKey);
  assert.equal(evidence.verifier.taxonomyGraph.termResourceKey, termResourceKey);
  assert.equal(evidence.verifier.taxonomyGraph.termTaxonomyMutationPlanned, true);
  assert.equal(evidence.verifier.taxonomyGraph.termTaxonomyMutationCarriesTermReference, true);
  assert.equal(evidence.verifier.taxonomyGraph.termTaxonomyId, 72911);
  assert.equal(evidence.verifier.taxonomyGraph.termId, 72901);
  assert.equal(evidence.verifier.taxonomyGraph.taxonomy, 'category');
  assert.equal(evidence.verifier.taxonomyGraph.preconditionLive, true);
  assert.equal(evidence.verifier.taxonomyGraph.applyRevalidated, true);
  assert.equal(evidence.verifier.taxonomyGraph.finalMatchesLocal, true);
  assert.equal(evidence.invariants.taxonomyGraphTermTaxonomyCarriedInReleasePlan, true);
  assert.equal(evidence.invariants.taxonomyGraphTermTaxonomyHasReleasePrecondition, true);
  assert.equal(evidence.invariants.taxonomyGraphTermTaxonomyApplyRevalidated, true);
  assert.equal(evidence.invariants.taxonomyGraphTermTaxonomyFinalMatchesLocal, true);

  const redactedEvidence = JSON.stringify(evidence);
  for (const marker of privateMarkers) {
    assert.equal(redactedEvidence.includes(marker), false, `release evidence leaked ${marker}`);
  }
});

test('RPP-0389 release verifier fails closed when category term_taxonomy skips apply revalidation', () => {
  const { evidence } = buildEvidenceFromReadyCategoryPlan({
    omitApplyRevalidationResourceKey: taxonomyResourceKey,
  });

  assert.equal(evidence.ok, false);
  assert.equal(evidence.verifier.taxonomyGraph.termTaxonomyMutationPlanned, true);
  assert.equal(evidence.verifier.taxonomyGraph.termTaxonomyMutationCarriesTermReference, true);
  assert.equal(evidence.verifier.taxonomyGraph.preconditionLive, true);
  assert.equal(evidence.verifier.taxonomyGraph.applyRevalidated, false);
  assert.equal(evidence.verifier.taxonomyGraph.finalMatchesLocal, true);
  assert.equal(evidence.invariants.taxonomyGraphTermTaxonomyCarriedInReleasePlan, true);
  assert.equal(evidence.invariants.taxonomyGraphTermTaxonomyHasReleasePrecondition, true);
  assert.equal(evidence.invariants.taxonomyGraphTermTaxonomyApplyRevalidated, false);
  assert.equal(evidence.invariants.taxonomyGraphTermTaxonomyFinalMatchesLocal, true);
});

function buildEvidenceFromReadyCategoryPlan({ omitApplyRevalidationResourceKey = null } = {}) {
  const base = categorySiteSnapshot('source');
  const local = categorySiteSnapshot('local-edited');
  const remote = categorySiteSnapshot('source');
  const plan = createPushPlan({ base, local, remote, now: fixedNow });
  assert.equal(plan.status, 'ready');
  assert.equal(plan.blockers.length, 0);
  assert.equal(plan.conflicts.length, 0);
  assert.ok(mutationFor(plan, taxonomyResourceKey));
  assert.equal(plan.preconditions.length, plan.mutations.length);

  const releaseSummary = releaseVerifierSummaryFromPlan(plan, {
    omitApplyRevalidationResourceKey,
  });
  const evidence = buildComplexSiteReleaseEvidence({
    plannerProof: { ok: true, shape: categoryShape },
    verifyOutput: JSON.stringify(releaseSummary, null, 2),
    verifyStatus: 0,
    verifySignal: null,
  });

  return { plan, releaseSummary, evidence };
}

function releaseVerifierSummaryFromPlan(plan, { omitApplyRevalidationResourceKey = null } = {}) {
  const verifiedResourceKeys = plan.mutations
    .map((mutation) => mutation.resourceKey)
    .filter((resourceKey) => resourceKey !== omitApplyRevalidationResourceKey);

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
          verifiedCount: plan.mutations.length,
          phase: 'before-first-mutation',
          checkedAgainst: 'live-remote',
          verifiedResourceKeys,
        },
      },
      after: {
        status: 200,
        finalMatchesLocal: true,
      },
      planObject: plan,
    },
    durableJournal: {
      rows: plan.mutations.length + 10,
      rowCount: plan.mutations.length + 10,
      readbackPages: 1,
      paginationComplete: true,
      paginationTruncated: false,
      oldestSequence: 1,
      newestSequence: plan.mutations.length + 10,
      mutationApplied: plan.mutations.length,
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

function categorySiteSnapshot(variant) {
  const local = variant === 'local-edited';
  const marker = local ? 'local-update' : 'base';
  const snapshot = {
    meta: {
      fixture: `rpp-0389-${variant}`,
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
    files: {},
    plugins: {},
    db: emptyDb(),
  };

  snapshot.db.wp_posts['ID:71001'] = {
    ID: 71001,
    post_title: 'RPP-0389 taxonomy anchor post',
    post_name: 'rpp-0389-taxonomy-anchor-post',
    post_content: 'Stable anchor post for category taxonomy graph release verifier proof.',
    post_status: 'publish',
    post_type: 'post',
    post_parent: 0,
    post_author: 0,
  };
  snapshot.db.wp_reprint_push_release_state['state_id:1'] = {
    state_id: 1,
    payload: {
      owner: 'reprint-push',
      mode: marker,
      version: local ? 2 : 1,
      releaseBoundaryProof: 'plugin-driver-boundary',
    },
    updated_marker: marker,
    __pluginOwner: 'reprint-push',
  };

  if (local) {
    snapshot.db.wp_terms['term_id:72901'] = {
      term_id: 72901,
      name: 'RPP-0389 Private Category Term',
      slug: 'reprint-push-taxonomy-graph',
      term_group: 0,
    };
    snapshot.db.wp_term_taxonomy['term_taxonomy_id:72911'] = {
      term_taxonomy_id: 72911,
      term_id: 72901,
      taxonomy: 'category',
      description: 'RPP-0389 private category taxonomy description',
      parent: 0,
      count: 1,
    };
    snapshot.db.wp_term_relationships['object_id:71001|term_taxonomy_id:72911'] = {
      object_id: 71001,
      term_taxonomy_id: 72911,
      term_order: 0,
    };
    snapshot.db.wp_termmeta['meta_id:72921'] = {
      meta_id: 72921,
      term_id: 72901,
      meta_key: 'reprint_push_taxonomy_fixture',
      meta_value: 'rpp-0389-private-termmeta',
    };
  }

  return snapshot;
}

function emptyDb() {
  return {
    wp_posts: {},
    wp_users: {},
    wp_options: {},
    wp_postmeta: {},
    wp_reprint_push_forms_lab: {},
    wp_reprint_push_release_state: {},
    wp_terms: {},
    wp_term_taxonomy: {},
    wp_term_relationships: {},
    wp_termmeta: {},
    wp_comments: {},
    wp_commentmeta: {},
  };
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey) || null;
}
