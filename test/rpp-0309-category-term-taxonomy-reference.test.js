import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildComplexSitePlannerProof,
  buildComplexSiteReleaseEvidence,
} from '../scripts/playground/local-production-complex-site-proof.js';

const smallShape = Object.freeze({
  postCount: 3,
  schemaMetaCount: 2,
  fileCount: 2,
  formsLabRows: 2,
  remoteDriftPosts: 1,
  remoteDriftFiles: 1,
  featuredImageGraph: false,
  taxonomyGraph: false,
  postTagTaxonomyGraph: false,
  postmetaPostGraph: false,
  postParentGraph: false,
  commentGraph: false,
});

const categoryShape = Object.freeze({
  ...smallShape,
  taxonomyGraph: true,
});

const taxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:72911"]';

test('RPP-0309 planner proof records the category term_taxonomy term reference', () => {
  const proof = buildComplexSitePlannerProof({
    sourceSnapshot: syntheticComplexSnapshot('source', categoryShape),
    localEditedSnapshot: syntheticComplexSnapshot('local-edited', categoryShape),
    remoteChangedSnapshot: syntheticComplexSnapshot('remote-changed', categoryShape),
    brewcommerceBlueprintDir: '/tmp/wp-blueprints-brewcommerce/blueprints/brewcommerce',
    shape: categoryShape,
  });

  assert.equal(proof.ok, true);
  assert.equal(proof.counts.source.taxonomyGraphTerms, 0);
  assert.equal(proof.counts.localEdited.taxonomyGraphTerms, 1);
  assert.equal(proof.counts.localEdited.taxonomyGraphTaxonomies, 1);
  assert.equal(proof.taxonomyGraphEvidence.type, 'category-term-relationship-termmeta');
  assert.equal(proof.taxonomyGraphEvidence.allResourcesPlanned, true);
  assert.equal(proof.taxonomyGraphEvidence.termTaxonomyReferencesTerm, true);
  assert.equal(proof.taxonomyGraphEvidence.termTaxonomyMutationCarriesTermReference, true);
  assert.equal(proof.taxonomyGraphEvidence.plannedTermTaxonomy.resourceKey, taxonomyResourceKey);
  assert.equal(proof.taxonomyGraphEvidence.plannedTermTaxonomy.termTaxonomyId, 72911);
  assert.equal(proof.taxonomyGraphEvidence.plannedTermTaxonomy.termId, 72901);
  assert.equal(proof.taxonomyGraphEvidence.plannedTermTaxonomy.taxonomy, 'category');
  assert.equal(proof.invariants.taxonomyGraphTermTaxonomyCarriesTermReference, true);
  assert.equal(proof.invariants.taxonomyGraphHasLivePreconditions, true);
});

test('RPP-0309 release evidence requires the category term_taxonomy target through apply', () => {
  const releaseSummary = syntheticReleaseSummary(9, { taxonomyGraph: true });
  const evidence = buildComplexSiteReleaseEvidence({
    plannerProof: { ok: true, shape: categoryShape },
    verifyOutput: JSON.stringify(releaseSummary, null, 2),
    verifyStatus: 0,
    verifySignal: null,
  });

  assert.equal(evidence.ok, true);
  assert.equal(evidence.verifier.taxonomyGraph.required, true);
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
});

test('RPP-0309 release evidence fails closed when the category term reference changes', () => {
  const releaseSummary = syntheticReleaseSummary(9, { taxonomyGraph: true });
  const taxonomyMutation = releaseSummary.releaseProof.planObject.mutations.find((mutation) =>
    mutation.resourceKey === taxonomyResourceKey);
  taxonomyMutation.value.value.term_id = 72902;

  const evidence = buildComplexSiteReleaseEvidence({
    plannerProof: { ok: true, shape: categoryShape },
    verifyOutput: JSON.stringify(releaseSummary),
    verifyStatus: 0,
    verifySignal: null,
  });

  assert.equal(evidence.ok, false);
  assert.equal(evidence.verifier.taxonomyGraph.termTaxonomyMutationCarriesTermReference, false);
  assert.equal(evidence.invariants.taxonomyGraphTermTaxonomyCarriedInReleasePlan, false);
});

function syntheticComplexSnapshot(variant, shape) {
  const snapshot = {
    meta: {
      fixture: `synthetic-${variant}`,
      site_url: `http://127.0.0.1/${variant}`,
      pluginOwnedResources: {
        allowedResources: [
          {
            resourceKey: 'row:["wp_options","option_name:reprint_push_forms_fixture"]',
            pluginOwner: 'forms',
            driver: 'wp-option',
          },
          {
            resourceKey: 'row:["wp_reprint_push_release_state","state_id:1"]',
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
    db: {
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
    },
  };
  const local = variant === 'local-edited';
  const remote = variant === 'remote-changed';

  for (let index = 1; index <= shape.postCount; index += 1) {
    const id = 71000 + index;
    const drift = remote && index <= shape.remoteDriftPosts;
    const marker = local ? 'local-edit' : drift ? 'remote-drift' : 'base';
    snapshot.db.wp_posts[`ID:${id}`] = {
      ID: id,
      post_title: `Brewcommerce Complex Item ${index} ${marker}`,
      post_name: `brewcommerce-complex-${String(index).padStart(2, '0')}`,
      post_content: `Complex content ${index} ${marker}`,
      post_status: 'publish',
      post_type: index % 3 === 0 ? 'product' : 'post',
      post_parent: 0,
      post_author: 0,
    };
    if (index <= shape.schemaMetaCount) {
      snapshot.db.wp_postmeta[`post_id:${id}:meta_key:_reprint_push_forms_schema`] = {
        post_id: id,
        meta_key: '_reprint_push_forms_schema',
        meta_value: {
          owner: 'forms',
          form: `complex-checkout-${String(index).padStart(2, '0')}`,
          marker,
        },
        __pluginOwner: 'forms',
      };
      snapshot.meta.pluginOwnedResources.allowedResources.push({
        resourceKey: `row:["wp_postmeta","post_id:${id}:meta_key:_reprint_push_forms_schema"]`,
        pluginOwner: 'forms',
        driver: 'wp-postmeta',
      });
    }
  }

  if (shape.taxonomyGraph && local) {
    snapshot.db.wp_terms['term_id:72901'] = {
      term_id: 72901,
      name: 'Reprint Push Taxonomy Graph',
      slug: 'reprint-push-taxonomy-graph',
      term_group: 0,
    };
    snapshot.db.wp_term_taxonomy['term_taxonomy_id:72911'] = {
      term_taxonomy_id: 72911,
      term_id: 72901,
      taxonomy: 'category',
      description: 'Local taxonomy graph fixture.',
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
      meta_value: 'local-taxonomy-graph',
    };
  }

  for (let index = 1; index <= shape.fileCount; index += 1) {
    const drift = remote && index <= shape.remoteDriftFiles;
    const marker = local ? 'local-edit' : drift ? 'remote-drift' : 'base';
    snapshot.files[`wp-content/uploads/reprint-push/brewcommerce-complex-${String(index).padStart(2, '0')}.json`] =
      JSON.stringify({ marker, index });
  }

  for (let index = 1; index <= shape.formsLabRows; index += 1) {
    snapshot.db.wp_reprint_push_forms_lab[`id:${index}`] = {
      id: index,
      form_slug: `complex-checkout-${index}`,
      payload: { owner: 'forms', mode: 'production', version: '1' },
      updated_marker: 'production',
      __pluginOwner: 'forms',
    };
  }

  const optionMarker = local ? 'local-edit' : remote ? 'remote-drift' : 'base';
  snapshot.db.wp_options['option_name:reprint_push_forms_fixture'] = {
    option_name: 'reprint_push_forms_fixture',
    option_value: {
      owner: 'forms',
      revision: optionMarker,
      complexSite: true,
    },
    __pluginOwner: 'forms',
  };
  snapshot.db.wp_reprint_push_release_state['state_id:1'] = {
    state_id: 1,
    payload: {
      owner: 'reprint-push',
      mode: local ? 'local-update' : remote ? 'remote-changed' : 'base',
      version: local ? 2 : remote ? 3 : 1,
      releaseBoundaryProof: 'plugin-driver-boundary',
    },
    updated_marker: local ? 'local-update' : remote ? 'remote-changed' : 'base',
    __pluginOwner: 'reprint-push',
  };

  return snapshot;
}

function syntheticReleaseSummary(mutations, options = {}) {
  const taxonomyGraphMutations = options.taxonomyGraph ? [
    {
      id: 'mutation-taxonomy-graph-term-taxonomy',
      resourceKey: taxonomyResourceKey,
      action: 'put',
      resource: {
        type: 'row',
        table: 'wp_term_taxonomy',
        id: 'term_taxonomy_id:72911',
        key: taxonomyResourceKey,
      },
      value: {
        value: {
          term_taxonomy_id: 72911,
          term_id: 72901,
          taxonomy: 'category',
          description: 'Local taxonomy graph fixture.',
          parent: 0,
          count: 1,
        },
      },
      baseHash: 'e'.repeat(64),
      remoteBeforeHash: 'e'.repeat(64),
      localHash: 'f'.repeat(64),
    },
  ] : [];
  const mutationList = [
    {
      id: 'mutation-release-state',
      resourceKey: 'row:["wp_reprint_push_release_state","state_id:1"]',
      action: 'update',
      resource: {
        type: 'row',
        table: 'wp_reprint_push_release_state',
        id: 'state_id:1',
        key: 'row:["wp_reprint_push_release_state","state_id:1"]',
      },
      pluginOwnedResource: {
        pluginOwner: 'reprint-push',
        driver: 'reprint-push-release-state',
        table: 'wp_reprint_push_release_state',
        supportsDelete: false,
      },
      baseHash: 'b'.repeat(64),
      remoteBeforeHash: 'b'.repeat(64),
      localHash: 'c'.repeat(64),
    },
    ...taxonomyGraphMutations,
    ...Array.from({ length: Math.max(0, mutations - 1 - taxonomyGraphMutations.length) }, (_, index) => ({
      id: `mutation-${index + 1}`,
      resourceKey: `row:["wp_posts","ID:${71001 + index}"]`,
    })),
  ];

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
          verifiedCount: mutations,
          phase: 'before-first-mutation',
          checkedAgainst: 'live-remote',
          verifiedResourceKeys: mutationList.map((mutation) => mutation.resourceKey),
        },
      },
      after: {
        status: 200,
        finalMatchesLocal: true,
      },
      planObject: {
        mutations: mutationList,
        preconditions: mutationList.map((mutation) => ({
          mutationId: mutation.id,
          resourceKey: mutation.resourceKey,
          checkedAgainst: 'live-remote',
          expectedHash: mutation.baseHash || 'd'.repeat(64),
        })),
      },
    },
    durableJournal: {
      rows: mutations + 10,
      rowCount: mutations + 10,
      readbackPages: 2,
      paginationComplete: true,
      paginationTruncated: false,
      oldestSequence: 1,
      newestSequence: mutations + 10,
      mutationApplied: mutations,
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
