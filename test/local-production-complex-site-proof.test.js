import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildComplexSitePlannerProof,
  buildComplexSiteReleaseEvidence,
  buildComplexSiteSeedPhp,
  buildProductionImporterExporterIdentityMapProof,
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
  postTagTaxonomyGraph: false,
  postParentGraph: false,
  commentGraph: false,
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

test('complex-site seed PHP can add a post_tag taxonomy graph fixture', () => {
  const php = buildComplexSiteSeedPhp({ key: 'local-edited' }, {
    ...smallShape,
    postTagTaxonomyGraph: true,
  });

  assert.match(php, /reprint-push-post-tag-taxonomy-graph/);
  assert.match(php, /taxonomy'=>'post_tag'/);
  assert.match(php, /term_relationships/);
  assert.match(php, /if \(\$complex_post_tag_taxonomy_graph && \$complex_is_local\)/);
  assert.match(buildComplexSiteSeedPhp({ key: 'local-edited' }, smallShape), /\$complex_post_tag_taxonomy_graph = false/);
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

test('complex-site seed PHP can add a comment graph fixture', () => {
  const php = buildComplexSiteSeedPhp({ key: 'local-edited' }, {
    ...smallShape,
    commentGraph: true,
  });

  assert.match(php, /reprint-push-comment-graph/);
  assert.match(php, /comment_parent'=>\$parent_comment_id/);
  assert.match(php, /reprint_push_comment_fixture/);
  assert.match(php, /if \(\$complex_comment_graph && \$complex_is_local\)/);
  assert.match(buildComplexSiteSeedPhp({ key: 'local-edited' }, smallShape), /\$complex_comment_graph = false/);
});

test('complex-site fixture shape can be expanded for journal-window evidence', () => {
  const shape = complexSiteFixtureShapeFromEnv({
    REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_POST_COUNT: '25',
    REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_GRAPH_PROOF: '1',
    REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_TAXONOMY_GRAPH_PROOF: '1',
    REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_POST_TAG_TAXONOMY_PROOF: '1',
    REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_POST_PARENT_GRAPH_PROOF: '1',
    REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_COMMENT_GRAPH_PROOF: '1',
  });

  assert.equal(shape.postCount, 25);
  assert.equal(shape.schemaMetaCount, 5);
  assert.equal(shape.fileCount, 3);
  assert.equal(shape.featuredImageGraph, true);
  assert.equal(shape.taxonomyGraph, true);
  assert.equal(shape.postTagTaxonomyGraph, true);
  assert.equal(shape.postParentGraph, true);
  assert.equal(shape.commentGraph, true);
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
  assert.equal(proof.invariants.pluginDriverAllowlistExact, true);
  assert.equal(proof.invariants.pluginDriverMutationPlanned, true);
  assert.equal(proof.invariants.pluginDriverHasLivePrecondition, true);
  assert.equal(proof.invariants.pluginDriverRemoteDriftFailsClosed, true);
  assert.equal(proof.invariants.pluginDriverNoUnsafeOptionMutation, true);
  assert.equal(proof.invariants.pluginDriverCustomTablesDriverOwned, true);
  assert.equal(proof.pluginDriverEvidence.driver, 'reprint-push-release-state');
  assert.equal(proof.pluginDriverEvidence.owner, 'reprint-push');
  assert.equal(proof.pluginDriverEvidence.allowlist.exact, true);
  assert.equal(proof.pluginDriverEvidence.sourcePluginStateEvidence.mode, 'base');
  assert.equal(proof.pluginDriverEvidence.localPluginStateEvidence.mode, 'local-update');
  assert.equal(proof.pluginDriverEvidence.remoteChangedPluginStateEvidence.mode, 'remote-changed');
  assert.equal(proof.pluginDriverEvidence.mutationBoundary.exactDriver, true);
  assert.equal(proof.pluginDriverEvidence.preconditionHashes.liveRemote, true);
  assert.equal(proof.pluginDriverEvidence.preconditionHashes.matchesSource, true);
  assert.equal(proof.pluginDriverEvidence.preconditionHashes.matchesMutationBase, true);
  assert.equal(proof.pluginDriverEvidence.preconditionHashes.matchesRemoteBefore, true);
  assert.equal(proof.pluginDriverEvidence.rejectedRemoteEvidence.failureClosed, true);
  assert.equal(proof.pluginDriverEvidence.safeMutationSet.noActivePluginsDirectMutation, true);
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

test('complex-site planner proof covers real post_tag taxonomy graph closure', () => {
  const graphShape = { ...smallShape, postTagTaxonomyGraph: true };
  const proof = buildComplexSitePlannerProof({
    sourceSnapshot: syntheticComplexSnapshot('source', graphShape),
    localEditedSnapshot: syntheticComplexSnapshot('local-edited', graphShape),
    remoteChangedSnapshot: syntheticComplexSnapshot('remote-changed', graphShape),
    brewcommerceBlueprintDir: '/tmp/wp-blueprints-brewcommerce/blueprints/brewcommerce',
    shape: graphShape,
  });

  assert.equal(proof.ok, true);
  assert.equal(proof.counts.source.postTagTaxonomyGraphTerms, 0);
  assert.equal(proof.counts.localEdited.postTagTaxonomyGraphTerms, 1);
  assert.equal(proof.counts.localEdited.postTagTaxonomyGraphTaxonomies, 1);
  assert.equal(proof.counts.localEdited.postTagTaxonomyGraphRelationships, 1);
  assert.equal(proof.postTagTaxonomyGraphEvidence.type, 'post-tag-term-relationship');
  assert.equal(proof.postTagTaxonomyGraphEvidence.taxonomy, 'post_tag');
  assert.equal(proof.postTagTaxonomyGraphEvidence.allResourcesPlanned, true);
  assert.equal(proof.postTagTaxonomyGraphEvidence.termTaxonomyIsPostTag, true);
  assert.equal(proof.postTagTaxonomyGraphEvidence.staleGraphBlockers, 0);
  assert.equal(proof.invariants.postTagTaxonomyGraphCountsPresent, true);
  assert.equal(proof.invariants.postTagTaxonomyGraphPlanned, true);
  assert.equal(proof.invariants.postTagTaxonomyGraphHasLivePreconditions, true);
  assert.equal(proof.invariants.postTagTaxonomyGraphNoStaleBlocker, true);
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

test('complex-site planner proof covers real comment parent and commentmeta graph closure', () => {
  const graphShape = { ...smallShape, commentGraph: true };
  const proof = buildComplexSitePlannerProof({
    sourceSnapshot: syntheticComplexSnapshot('source', graphShape),
    localEditedSnapshot: syntheticComplexSnapshot('local-edited', graphShape),
    remoteChangedSnapshot: syntheticComplexSnapshot('remote-changed', graphShape),
    brewcommerceBlueprintDir: '/tmp/wp-blueprints-brewcommerce/blueprints/brewcommerce',
    shape: graphShape,
  });

  assert.equal(proof.ok, true);
  assert.equal(proof.counts.source.commentGraphParents, 0);
  assert.equal(proof.counts.source.commentGraphChildren, 0);
  assert.equal(proof.counts.localEdited.commentGraphParents, 1);
  assert.equal(proof.counts.localEdited.commentGraphChildren, 1);
  assert.equal(proof.counts.localEdited.commentGraphCommentmeta, 1);
  assert.equal(proof.commentGraphEvidence.type, 'comment-parent-commentmeta');
  assert.equal(proof.commentGraphEvidence.allResourcesPlanned, true);
  assert.equal(proof.commentGraphEvidence.parentReferencesPost, true);
  assert.equal(proof.commentGraphEvidence.childReferencesParent, true);
  assert.equal(proof.commentGraphEvidence.commentmetaReferencesChild, true);
  assert.equal(proof.commentGraphEvidence.staleGraphBlockers, 0);
  assert.equal(proof.invariants.commentGraphCountsPresent, true);
  assert.equal(proof.invariants.commentGraphPlanned, true);
  assert.equal(proof.invariants.commentGraphHasLivePreconditions, true);
});

test('complex-site graph proof keeps production importer exporter identity maps redacted', () => {
  const source = withImporterExporterIdentityMapFixture(
    syntheticComplexSnapshot('source', smallShape),
    'base-map',
  );
  const localEdited = withImporterExporterIdentityMapFixture(
    syntheticComplexSnapshot('source', smallShape),
    'local-edited',
  );
  const importedRemote = withImporterExporterIdentityMapFixture(
    syntheticComplexSnapshot('source', smallShape),
    'imported-remote',
  );
  const staleRemote = withImporterExporterIdentityMapFixture(
    syntheticComplexSnapshot('source', smallShape),
    'stale-remote',
  );

  const proof = buildProductionImporterExporterIdentityMapProof({
    sourceSnapshot: source,
    localEditedSnapshot: localEdited,
    importedRemoteSnapshot: importedRemote,
    staleRemoteSnapshot: staleRemote,
  });
  const proofJson = JSON.stringify(proof);

  assert.equal(proof.ok, true);
  assert.equal(proof.releaseReady, false);
  assert.match(proof.noGoCaveat, /NO-GO/);
  assert.equal(proof.deterministicMapping.mapAlias, 'pushIdentityMap');
  assert.equal(proof.readyPlan.status, 'ready');
  assert.equal(proof.stalePlan.status, 'blocked');
  assert.equal(proof.counts.source.importerExporterMapEntries, 1);
  assert.equal(proof.counts.localEdited.importerExporterSourcePosts, 1);
  assert.equal(proof.counts.localEdited.importerExporterSourcePostmeta, 1);
  assert.equal(proof.counts.importedRemote.importerExporterTargetPosts, 1);
  assert.equal(proof.mapEvidence.mapSource, 'base-snapshot.meta.identityMap[2].resources[0]');
  assert.equal(proof.mapEvidence.sourceDecision.identityMapSource, 'base-snapshot.meta.identityMap[2].resources[0]');
  assert.equal(proof.mapEvidence.sourceDecision.targetResourceKey, 'row:["wp_posts","ID:77401"]');
  assert.equal(proof.mapEvidence.dependentRewrites.length, 2);
  assert.equal(proof.mapEvidence.dependentRewrites.some((entry) =>
    entry.rewrites.some((rewrite) => rewrite.relationshipType === 'post-parent')), true);
  assert.equal(proof.mapEvidence.dependentRewrites.some((entry) =>
    entry.rewrites.some((rewrite) => rewrite.relationshipType === 'postmeta-post')), true);
  assert.equal(proof.appliedEvidence.childPostParent, 77401);
  assert.equal(proof.appliedEvidence.postmetaPostId, 77401);
  assert.equal(proof.invariants.identityDecisionUsesImporterMap, true);
  assert.equal(proof.invariants.sourceIdentityNotMutated, true);
  assert.equal(proof.invariants.targetRemotePreserved, true);
  assert.equal(proof.invariants.dependentRowsRewrittenToImportedTarget, true);
  assert.equal(proof.invariants.rewrittenPostmetaResourceKeyUsed, true);
  assert.equal(proof.invariants.staleRemoteFailsClosed, true);
  assert.equal(proof.invariants.evidenceHashOnly, true);
  assert.equal(proof.invariants.evidenceRedactsRawValues, true);
  assert.equal(proof.staleBlockerEvidence.some((entry) =>
    entry.class === 'stale-wordpress-graph-identity'), true);
  assert.equal(proofJson.includes('Production Private RPP-0340 Parent'), false);
  assert.equal(proofJson.includes('production-private-rpp-0340-meta'), false);
  assert.equal(proofJson.includes('Stale Production Private RPP-0340 Parent'), false);
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
  assert.equal(evidence.verifier.pluginDriver.driver, 'reprint-push-release-state');
  assert.equal(evidence.verifier.pluginDriver.owner, 'reprint-push');
  assert.equal(evidence.verifier.pluginDriver.mutationPlanned, true);
  assert.equal(evidence.verifier.pluginDriver.applyRevalidated, true);
  assert.equal(evidence.invariants.pluginDriverCarriedInReleasePlan, true);
  assert.equal(evidence.invariants.pluginDriverHasReleasePrecondition, true);
  assert.equal(evidence.invariants.pluginDriverApplyRevalidated, true);
  assert.equal(evidence.invariants.authSessionGateOk, true);
  assert.equal(evidence.invariants.durableJournalGateOk, true);
});

test('complex-site release evidence proves post_tag taxonomy carries through apply', () => {
  const plannerProof = { ok: true, shape: { ...smallShape, postTagTaxonomyGraph: true } };
  const releaseSummary = syntheticReleaseSummary(9, { postTagTaxonomyGraph: true });
  const output = JSON.stringify(releaseSummary, null, 2);

  const evidence = buildComplexSiteReleaseEvidence({
    plannerProof,
    verifyOutput: output,
    verifyStatus: 0,
    verifySignal: null,
  });

  assert.equal(evidence.ok, true);
  assert.equal(evidence.verifier.postTagTaxonomyGraph.required, true);
  assert.equal(evidence.verifier.postTagTaxonomyGraph.taxonomyMutationPlanned, true);
  assert.equal(evidence.verifier.postTagTaxonomyGraph.taxonomyMutationIsPostTag, true);
  assert.equal(evidence.verifier.postTagTaxonomyGraph.termTaxonomyId, 72941);
  assert.equal(evidence.verifier.postTagTaxonomyGraph.termId, 72931);
  assert.equal(evidence.verifier.postTagTaxonomyGraph.taxonomy, 'post_tag');
  assert.equal(evidence.verifier.postTagTaxonomyGraph.preconditionLive, true);
  assert.equal(evidence.verifier.postTagTaxonomyGraph.applyRevalidated, true);
  assert.equal(evidence.verifier.postTagTaxonomyGraph.finalMatchesLocal, true);
  assert.equal(evidence.invariants.postTagTaxonomyGraphCarriedInReleasePlan, true);
  assert.equal(evidence.invariants.postTagTaxonomyGraphHasReleasePrecondition, true);
  assert.equal(evidence.invariants.postTagTaxonomyGraphApplyRevalidated, true);
  assert.equal(evidence.invariants.postTagTaxonomyGraphFinalMatchesLocal, true);
});

test('complex-site release evidence fails closed when post_tag taxonomy is changed', () => {
  const plannerProof = { ok: true, shape: { ...smallShape, postTagTaxonomyGraph: true } };
  const releaseSummary = syntheticReleaseSummary(9, { postTagTaxonomyGraph: true });
  const taxonomyMutation = releaseSummary.releaseProof.planObject.mutations.find((mutation) =>
    mutation.resourceKey === 'row:["wp_term_taxonomy","term_taxonomy_id:72941"]');
  taxonomyMutation.value.value.taxonomy = 'product_cat';

  const evidence = buildComplexSiteReleaseEvidence({
    plannerProof,
    verifyOutput: JSON.stringify(releaseSummary),
    verifyStatus: 0,
    verifySignal: null,
  });

  assert.equal(evidence.ok, false);
  assert.equal(evidence.verifier.postTagTaxonomyGraph.taxonomyMutationIsPostTag, false);
  assert.equal(evidence.invariants.postTagTaxonomyGraphCarriedInReleasePlan, false);
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

  if (shape.postTagTaxonomyGraph && local) {
    snapshot.db.wp_terms['term_id:72931'] = {
      term_id: 72931,
      name: 'Reprint Push Post Tag Taxonomy Graph',
      slug: 'reprint-push-post-tag-taxonomy-graph',
      term_group: 0,
    };
    snapshot.db.wp_term_taxonomy['term_taxonomy_id:72941'] = {
      term_taxonomy_id: 72941,
      term_id: 72931,
      taxonomy: 'post_tag',
      description: 'Local post_tag taxonomy graph fixture.',
      parent: 0,
      count: 1,
    };
    snapshot.db.wp_term_relationships['object_id:71002|term_taxonomy_id:72941'] = {
      object_id: 71002,
      term_taxonomy_id: 72941,
      term_order: 0,
    };
  }

  if (shape.commentGraph && local) {

    snapshot.db.wp_comments['comment_ID:72801'] = {
      comment_ID: 72801,
      comment_post_ID: 71001,
      comment_author: 'Reprint Parent Comment',
      comment_author_email: 'parent-comment@example.test',
      comment_author_url: '',
      comment_author_IP: '127.0.0.1',
      comment_date: '2026-05-27 21:45:00',
      comment_date_gmt: '2026-05-27 21:45:00',
      comment_content: 'Local parent comment used for graph identity proof.',
      comment_karma: 0,
      comment_approved: '1',
      comment_agent: 'reprint-push-comment-graph',
      comment_type: 'comment',
      comment_parent: 0,
      user_id: 0,
    };
    snapshot.db.wp_comments['comment_ID:72802'] = {
      comment_ID: 72802,
      comment_post_ID: 71001,
      comment_author: 'Reprint Child Comment',
      comment_author_email: 'child-comment@example.test',
      comment_author_url: '',
      comment_author_IP: '127.0.0.1',
      comment_date: '2026-05-27 21:46:00',
      comment_date_gmt: '2026-05-27 21:46:00',
      comment_content: 'Local child comment whose comment_parent points at the same-plan parent comment.',
      comment_karma: 0,
      comment_approved: '1',
      comment_agent: 'reprint-push-comment-graph',
      comment_type: 'comment',
      comment_parent: 72801,
      user_id: 0,
    };
    snapshot.db.wp_commentmeta['meta_id:72811'] = {
      meta_id: 72811,
      comment_id: 72802,
      meta_key: 'reprint_push_comment_fixture',
      meta_value: 'local-comment-graph',
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

function withImporterExporterIdentityMapFixture(snapshot, variant) {
  const next = JSON.parse(JSON.stringify(snapshot));
  next.db.wp_postmeta = next.db.wp_postmeta || {};

  if (variant === 'base-map') {
    next.meta.pushIdentityMap = {
      provenance: {
        exporter: {
          artifactHash: '1'.repeat(64),
          rowCount: 1,
          observedAt: '2026-05-27T21:45:00.000Z',
        },
        importer: {
          packageHash: '2'.repeat(64),
          persistedAt: '2026-05-27T21:46:00.000Z',
          immutableBase: true,
        },
      },
      resources: [
        {
          sourceResourceKey: 'row:["wp_posts","ID:76401"]',
          targetResourceKey: 'row:["wp_posts","ID:77401"]',
        },
      ],
    };
  }

  if (variant === 'local-edited') {
    next.db.wp_posts['ID:76401'] = {
      ID: 76401,
      post_title: 'Production Private RPP-0340 Parent',
      post_name: 'rpp-0340-importer-exporter-parent',
      post_content: 'production-private-rpp-0340-parent-body',
      post_status: 'publish',
      post_type: 'page',
      post_parent: 0,
      post_author: 0,
    };
    next.db.wp_posts['ID:76402'] = {
      ID: 76402,
      post_title: 'Production Private RPP-0340 Child',
      post_name: 'rpp-0340-importer-exporter-child',
      post_content: 'production-private-rpp-0340-child-body',
      post_status: 'publish',
      post_type: 'page',
      post_parent: 76401,
      post_author: 0,
    };
    next.db.wp_postmeta['post_id:76401:meta_key:_rpp_0340_importer_exporter_map'] = {
      post_id: 76401,
      meta_key: '_rpp_0340_importer_exporter_map',
      meta_value: 'production-private-rpp-0340-meta',
    };
  }

  if (variant === 'imported-remote' || variant === 'stale-remote') {
    const stale = variant === 'stale-remote';
    next.db.wp_posts['ID:77401'] = {
      ID: 77401,
      post_title: stale ? 'Stale Production Private RPP-0340 Parent' : 'Production Private RPP-0340 Parent',
      post_name: 'rpp-0340-importer-exporter-parent',
      post_content: stale
        ? 'stale-production-private-rpp-0340-parent-body'
        : 'production-private-rpp-0340-parent-body',
      post_status: 'publish',
      post_type: 'page',
      post_parent: 0,
      post_author: 0,
    };
  }

  return next;
}

function syntheticReleaseSummary(mutations, options = {}) {
  const postTagTaxonomyGraphMutations = options.postTagTaxonomyGraph ? [
    {
      id: 'mutation-post-tag-taxonomy-graph-taxonomy',
      resourceKey: 'row:["wp_term_taxonomy","term_taxonomy_id:72941"]',
      action: 'put',
      resource: {
        type: 'row',
        table: 'wp_term_taxonomy',
        id: 'term_taxonomy_id:72941',
        key: 'row:["wp_term_taxonomy","term_taxonomy_id:72941"]',
      },
      value: {
        value: {
          term_taxonomy_id: 72941,
          term_id: 72931,
          taxonomy: 'post_tag',
          description: 'Local post_tag taxonomy graph fixture.',
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
    ...postTagTaxonomyGraphMutations,
    ...Array.from({ length: Math.max(0, mutations - 1 - postTagTaxonomyGraphMutations.length) }, (_, index) => ({
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
