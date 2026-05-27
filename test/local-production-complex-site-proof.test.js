import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildComplexSitePlannerProof,
  buildComplexSiteReleaseEvidence,
  buildComplexSiteSeedPhp,
  complexSiteFixtureShapeFromEnv,
  extractJsonObjects,
  findReleaseVerifierSummary,
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
  postParentGraph: false,
});

test('complex-site seed PHP is bounded and variant-aware', () => {
  const php = buildComplexSiteSeedPhp({ key: 'local-edited' }, smallShape);

  assert.match(php, /Brewcommerce Complex Item/);
  assert.match(php, /local-edited/);
  assert.match(php, /complex-checkout-/);
  assert.match(php, /brewcommerce-complex-/);
});

test('complex-site seed PHP can add a featured image graph fixture', () => {
  const php = buildComplexSiteSeedPhp({ key: 'local-edited' }, {
    ...smallShape,
    featuredImageGraph: true,
  });

  assert.match(php, /brewcommerce-featured-attachment/);
  assert.match(php, /_thumbnail_id/);
  assert.match(php, /if \(\$complex_featured_image_graph && \$complex_is_local\)/);
  assert.match(buildComplexSiteSeedPhp({ key: 'local-edited' }, smallShape), /\$complex_featured_image_graph = false/);
});

test('complex-site seed PHP can add a taxonomy graph fixture', () => {
  const php = buildComplexSiteSeedPhp({ key: 'local-edited' }, {
    ...smallShape,
    taxonomyGraph: true,
  });

  assert.match(php, /reprint-push-taxonomy-graph/);
  assert.match(php, /term_relationships/);
  assert.match(php, /reprint_push_taxonomy_fixture/);
  assert.match(php, /if \(\$complex_taxonomy_graph && \$complex_is_local\)/);
  assert.match(buildComplexSiteSeedPhp({ key: 'local-edited' }, smallShape), /\$complex_taxonomy_graph = false/);
});

test('complex-site seed PHP can add a post parent graph fixture', () => {
  const php = buildComplexSiteSeedPhp({ key: 'local-edited' }, {
    ...smallShape,
    postParentGraph: true,
  });

  assert.match(php, /reprint-push-post-parent-graph-parent/);
  assert.match(php, /reprint-push-post-parent-graph-child/);
  assert.match(php, /post_parent'=>\$parent_post_id/);
  assert.match(php, /if \(\$complex_post_parent_graph && \$complex_is_local\)/);
  assert.match(buildComplexSiteSeedPhp({ key: 'local-edited' }, smallShape), /\$complex_post_parent_graph = false/);
});

test('complex-site fixture shape can be expanded for journal-window evidence', () => {
  const shape = complexSiteFixtureShapeFromEnv({
    REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_POST_COUNT: '25',
    REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_GRAPH_PROOF: '1',
    REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_TAXONOMY_GRAPH_PROOF: '1',
    REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_POST_PARENT_GRAPH_PROOF: '1',
  });

  assert.equal(shape.postCount, 25);
  assert.equal(shape.schemaMetaCount, 5);
  assert.equal(shape.fileCount, 3);
  assert.equal(shape.featuredImageGraph, true);
  assert.equal(shape.taxonomyGraph, true);
  assert.equal(shape.postParentGraph, true);
});

test('complex-site planner proof reports dense counts, receipts prerequisites, and no-data-loss invariants', () => {
  const source = syntheticComplexSnapshot('source', smallShape);
  const localEdited = syntheticComplexSnapshot('local-edited', smallShape);
  const remoteChanged = syntheticComplexSnapshot('remote-changed', smallShape);
  const proof = buildComplexSitePlannerProof({
    sourceSnapshot: source,
    localEditedSnapshot: localEdited,
    remoteChangedSnapshot: remoteChanged,
    brewcommerceBlueprintDir: '/tmp/wp-blueprints-brewcommerce/blueprints/brewcommerce',
    shape: smallShape,
  });

  assert.equal(proof.ok, true);
  assert.equal(proof.counts.source.complexPosts, smallShape.postCount);
  assert.equal(proof.counts.localEdited.complexSchemaMeta, smallShape.schemaMetaCount);
  assert.equal(proof.counts.remoteChanged.complexFiles, smallShape.fileCount);
  assert.equal(proof.readyPlan.status, 'ready');
  assert.ok(proof.readyPlan.mutations >= proof.shape.expectedMinimumReadyMutations);
  assert.equal(proof.readyPlan.preconditions, proof.readyPlan.mutations);
  assert.equal(proof.remoteDriftPlan.status, 'conflict');
  assert.ok(proof.remoteDriftPlan.conflicts >= proof.shape.expectedMinimumConflicts);
  assert.equal(proof.invariants.remoteDriftPreservesRemote, true);
  assert.equal(proof.invariants.noDeleteMutations, true);
  assert.equal(proof.invariants.pluginOwnedMutationsHaveDrivers, true);
});

test('complex-site planner proof covers real featured image attachment graph closure', () => {
  const graphShape = { ...smallShape, featuredImageGraph: true };
  const proof = buildComplexSitePlannerProof({
    sourceSnapshot: syntheticComplexSnapshot('source', graphShape),
    localEditedSnapshot: syntheticComplexSnapshot('local-edited', graphShape),
    remoteChangedSnapshot: syntheticComplexSnapshot('remote-changed', graphShape),
    brewcommerceBlueprintDir: '/tmp/wp-blueprints-brewcommerce/blueprints/brewcommerce',
    shape: graphShape,
  });

  assert.equal(proof.ok, true);
  assert.equal(proof.counts.source.featuredImageAttachments, 0);
  assert.equal(proof.counts.localEdited.featuredImageAttachments, 1);
  assert.equal(proof.counts.localEdited.featuredImageMeta, 1);
  assert.equal(proof.graphEvidence.type, 'featured-image-attachment');
  assert.equal(proof.graphEvidence.attachmentPlanned, true);
  assert.equal(proof.graphEvidence.thumbnailMetaPlanned, true);
  assert.equal(proof.graphEvidence.staleGraphBlockers, 0);
  assert.equal(proof.invariants.featuredImageGraphCountsPresent, true);
  assert.equal(proof.invariants.featuredImageGraphPlanned, true);
  assert.equal(proof.invariants.featuredImageGraphHasLivePreconditions, true);
});

test('complex-site planner proof covers real taxonomy graph closure', () => {
  const graphShape = { ...smallShape, taxonomyGraph: true };
  const proof = buildComplexSitePlannerProof({
    sourceSnapshot: syntheticComplexSnapshot('source', graphShape),
    localEditedSnapshot: syntheticComplexSnapshot('local-edited', graphShape),
    remoteChangedSnapshot: syntheticComplexSnapshot('remote-changed', graphShape),
    brewcommerceBlueprintDir: '/tmp/wp-blueprints-brewcommerce/blueprints/brewcommerce',
    shape: graphShape,
  });

  assert.equal(proof.ok, true);
  assert.equal(proof.counts.source.taxonomyGraphTerms, 0);
  assert.equal(proof.counts.localEdited.taxonomyGraphTerms, 1);
  assert.equal(proof.counts.localEdited.taxonomyGraphTaxonomies, 1);
  assert.equal(proof.counts.localEdited.taxonomyGraphRelationships, 1);
  assert.equal(proof.counts.localEdited.taxonomyGraphTermmeta, 1);
  assert.equal(proof.taxonomyGraphEvidence.type, 'category-term-relationship-termmeta');
  assert.equal(proof.taxonomyGraphEvidence.allResourcesPlanned, true);
  assert.equal(proof.taxonomyGraphEvidence.staleGraphBlockers, 0);
  assert.equal(proof.invariants.taxonomyGraphCountsPresent, true);
  assert.equal(proof.invariants.taxonomyGraphPlanned, true);
  assert.equal(proof.invariants.taxonomyGraphHasLivePreconditions, true);
});

test('complex-site planner proof covers real post parent graph closure', () => {
  const graphShape = { ...smallShape, postParentGraph: true };
  const proof = buildComplexSitePlannerProof({
    sourceSnapshot: syntheticComplexSnapshot('source', graphShape),
    localEditedSnapshot: syntheticComplexSnapshot('local-edited', graphShape),
    remoteChangedSnapshot: syntheticComplexSnapshot('remote-changed', graphShape),
    brewcommerceBlueprintDir: '/tmp/wp-blueprints-brewcommerce/blueprints/brewcommerce',
    shape: graphShape,
  });

  assert.equal(proof.ok, true);
  assert.equal(proof.counts.source.postParentGraphParents, 0);
  assert.equal(proof.counts.source.postParentGraphChildren, 0);
  assert.equal(proof.counts.localEdited.postParentGraphParents, 1);
  assert.equal(proof.counts.localEdited.postParentGraphChildren, 1);
  assert.equal(proof.postParentGraphEvidence.type, 'post-parent-page-closure');
  assert.equal(proof.postParentGraphEvidence.allResourcesPlanned, true);
  assert.equal(proof.postParentGraphEvidence.childReferencesParent, true);
  assert.equal(proof.postParentGraphEvidence.staleGraphBlockers, 0);
  assert.equal(proof.invariants.postParentGraphCountsPresent, true);
  assert.equal(proof.invariants.postParentGraphPlanned, true);
  assert.equal(proof.invariants.postParentGraphHasLivePreconditions, true);
});

test('complex-site release evidence extracts release verifier receipts and gates from noisy command output', () => {
  const plannerProof = { ok: true };
  const releaseSummary = syntheticReleaseSummary(9);
  const output = [
    'npm banner with braces ignored {not json}',
    JSON.stringify({ event: 'earlier-proof', ok: true }),
    JSON.stringify(releaseSummary, null, 2),
  ].join('\n');

  assert.equal(extractJsonObjects(output).length, 2);
  assert.equal(findReleaseVerifierSummary(output).releaseMovement.gates, 'candidate-for-review');

  const evidence = buildComplexSiteReleaseEvidence({
    plannerProof,
    verifyOutput: output,
    verifyStatus: 0,
    verifySignal: null,
  });

  assert.equal(evidence.ok, true);
  assert.equal(evidence.verifier.receipt.present, true);
  assert.equal(evidence.verifier.durableJournal.readbackPages, 2);
  assert.equal(evidence.verifier.durableJournal.paginationComplete, true);
  assert.equal(evidence.verifier.durableJournal.paginationTruncated, false);
  assert.equal(evidence.verifier.durableJournal.mutationApplied, 9);
  assert.equal(evidence.invariants.authSessionGateOk, true);
  assert.equal(evidence.invariants.durableJournalGateOk, true);
});

test('complex-site release evidence fails closed without a dry-run receipt', () => {
  const releaseSummary = syntheticReleaseSummary(2);
  releaseSummary.releaseProof.dryRun.receiptHash = '';
  const evidence = buildComplexSiteReleaseEvidence({
    plannerProof: { ok: true },
    verifyOutput: JSON.stringify(releaseSummary),
    verifyStatus: 0,
    verifySignal: null,
  });

  assert.equal(evidence.ok, false);
  assert.equal(evidence.invariants.receiptHashPresent, false);
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

  if (shape.featuredImageGraph && local) {
    snapshot.db.wp_posts['ID:71901'] = {
      ID: 71901,
      post_title: 'Brewcommerce Featured Image Attachment',
      post_name: 'brewcommerce-featured-attachment',
      post_content: 'Local featured image attachment used for graph identity proof.',
      post_status: 'inherit',
      post_type: 'attachment',
      post_parent: 71001,
      post_author: 0,
    };
    snapshot.db.wp_postmeta['post_id:71001:meta_key:_thumbnail_id'] = {
      post_id: 71001,
      meta_key: '_thumbnail_id',
      meta_value: '71901',
    };
  }

  if (shape.postParentGraph && local) {
    snapshot.db.wp_posts['ID:71801'] = {
      ID: 71801,
      post_title: 'Reprint Push Parent Graph Parent',
      post_name: 'reprint-push-post-parent-graph-parent',
      post_content: 'Local parent page used for same-plan post_parent graph proof.',
      post_status: 'publish',
      post_type: 'page',
      post_parent: 0,
      post_author: 0,
    };
    snapshot.db.wp_posts['ID:71802'] = {
      ID: 71802,
      post_title: 'Reprint Push Parent Graph Child',
      post_name: 'reprint-push-post-parent-graph-child',
      post_content: 'Local child page whose post_parent points at the same-plan parent page.',
      post_status: 'publish',
      post_type: 'page',
      post_parent: 71801,
      post_author: 0,
    };
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
    },
    updated_marker: local ? 'local-update' : remote ? 'remote-changed' : 'base',
    __pluginOwner: 'reprint-push',
  };

  return snapshot;
}

function syntheticReleaseSummary(mutations) {
  const mutationList = Array.from({ length: mutations }, (_, index) => ({
    id: `mutation-${index + 1}`,
    resourceKey: `row:["wp_posts","ID:${71001 + index}"]`,
  }));
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
        },
      },
      planObject: {
        mutations: mutationList,
        preconditions: mutationList.map((mutation) => ({
          mutationId: mutation.id,
          resourceKey: mutation.resourceKey,
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
