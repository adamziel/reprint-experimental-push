import assert from 'node:assert/strict';

import { createPushPlan } from '../../src/planner.js';
import { resourceHash } from '../../src/resources.js';

export const complexSiteFixtureShape = Object.freeze({
  postCount: 12,
  schemaMetaCount: 5,
  fileCount: 3,
  formsLabRows: 4,
  remoteDriftPosts: 3,
  remoteDriftFiles: 1,
  featuredImageGraph: false,
  taxonomyGraph: false,
  wpNavigationFailClosed: false,
  postParentGraph: false,
  commentGraph: false,
});

const proofNow = new Date('2026-05-27T21:45:00.000Z');
const formsFixtureOption = 'reprint_push_forms_fixture';
const releaseStateDriver = 'reprint-push-release-state';
const releaseStateOwner = 'reprint-push';
const releaseStateTable = 'wp_reprint_push_release_state';
const releaseStateRowId = 'state_id:1';
const releaseStateResourceKey = `row:["${releaseStateTable}","${releaseStateRowId}"]`;
const releaseStateResource = Object.freeze({
  type: 'row',
  table: releaseStateTable,
  id: releaseStateRowId,
  key: releaseStateResourceKey,
});
const featuredImagePostId = 71001;
const featuredImageAttachmentId = 71901;
const featuredImageAttachmentSlug = 'brewcommerce-featured-attachment';
const featuredImageMetaKey = '_thumbnail_id';
const featuredImageAttachmentResourceKey = `row:["wp_posts","ID:${featuredImageAttachmentId}"]`;
const featuredImageMetaResourceKey = `row:["wp_postmeta","post_id:${featuredImagePostId}:meta_key:${featuredImageMetaKey}"]`;
const wpNavigationGraphPostId = 71951;
const wpNavigationGraphSlug = 'reprint-push-wp-navigation-fail-closed';
const wpNavigationGraphTitle = 'Reprint Push WP Navigation Fail Closed';
const wpNavigationGraphContent = '<!-- wp:navigation-link {"label":"Local Private Navigation Fail Closed"} /-->';
const wpNavigationGraphResourceKey = `row:["wp_posts","ID:${wpNavigationGraphPostId}"]`;
const postParentGraphParentId = 71801;
const postParentGraphChildId = 71802;
const postParentGraphParentSlug = 'reprint-push-post-parent-graph-parent';
const postParentGraphChildSlug = 'reprint-push-post-parent-graph-child';
const postParentGraphParentResourceKey = `row:["wp_posts","ID:${postParentGraphParentId}"]`;
const postParentGraphChildResourceKey = `row:["wp_posts","ID:${postParentGraphChildId}"]`;
const postParentGraphResourceKeys = Object.freeze([
  postParentGraphParentResourceKey,
  postParentGraphChildResourceKey,
]);
const taxonomyGraphPostId = 71001;
const taxonomyGraphTermId = 72901;
const taxonomyGraphTermTaxonomyId = 72911;
const taxonomyGraphTermMetaId = 72921;
const taxonomyGraphTermSlug = 'reprint-push-taxonomy-graph';
const taxonomyGraphMetaKey = 'reprint_push_taxonomy_fixture';
const taxonomyGraphTermResourceKey = `row:["wp_terms","term_id:${taxonomyGraphTermId}"]`;
const taxonomyGraphTaxonomyResourceKey = `row:["wp_term_taxonomy","term_taxonomy_id:${taxonomyGraphTermTaxonomyId}"]`;
const taxonomyGraphRelationshipResourceKey = `row:["wp_term_relationships","object_id:${taxonomyGraphPostId}|term_taxonomy_id:${taxonomyGraphTermTaxonomyId}"]`;
const taxonomyGraphTermMetaResourceKey = `row:["wp_termmeta","meta_id:${taxonomyGraphTermMetaId}"]`;
const taxonomyGraphResourceKeys = Object.freeze([
  taxonomyGraphTermResourceKey,
  taxonomyGraphTaxonomyResourceKey,
  taxonomyGraphRelationshipResourceKey,
  taxonomyGraphTermMetaResourceKey,
]);
const commentGraphPostId = 71001;
const commentGraphParentId = 72801;
const commentGraphChildId = 72802;
const commentGraphMetaId = 72811;
const commentGraphMetaKey = 'reprint_push_comment_fixture';
const commentGraphAgent = 'reprint-push-comment-graph';
const commentGraphParentResourceKey = `row:["wp_comments","comment_ID:${commentGraphParentId}"]`;
const commentGraphChildResourceKey = `row:["wp_comments","comment_ID:${commentGraphChildId}"]`;
const commentGraphMetaResourceKey = `row:["wp_commentmeta","meta_id:${commentGraphMetaId}"]`;
const commentGraphResourceKeys = Object.freeze([
  commentGraphParentResourceKey,
  commentGraphChildResourceKey,
  commentGraphMetaResourceKey,
]);

export function complexSiteFixtureShapeFromEnv(env = process.env) {
  return Object.freeze({
    postCount: positiveEnvInt(env.REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_POST_COUNT, complexSiteFixtureShape.postCount),
    schemaMetaCount: positiveEnvInt(env.REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_SCHEMA_META_COUNT, complexSiteFixtureShape.schemaMetaCount),
    fileCount: positiveEnvInt(env.REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_FILE_COUNT, complexSiteFixtureShape.fileCount),
    formsLabRows: positiveEnvInt(env.REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_FORMS_ROWS, complexSiteFixtureShape.formsLabRows),
    remoteDriftPosts: positiveEnvInt(env.REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_REMOTE_DRIFT_POSTS, complexSiteFixtureShape.remoteDriftPosts),
    remoteDriftFiles: positiveEnvInt(env.REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_REMOTE_DRIFT_FILES, complexSiteFixtureShape.remoteDriftFiles),
    featuredImageGraph: env.REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_GRAPH_PROOF === '1',
    taxonomyGraph: env.REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_TAXONOMY_GRAPH_PROOF === '1',
    wpNavigationFailClosed: env.REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_WP_NAVIGATION_FAIL_CLOSED_PROOF === '1',
    postParentGraph: env.REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_POST_PARENT_GRAPH_PROOF === '1',
    commentGraph: env.REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_COMMENT_GRAPH_PROOF === '1',
  });
}

export function buildComplexSiteSeedPhp(variant, shape = complexSiteFixtureShape) {
  const variantKey = String(variant.key || 'source');
  return [
    `$complex_variant = ${phpString(variantKey)};`,
    `$complex_is_local = $complex_variant === 'local-edited';`,
    `$complex_is_remote = $complex_variant === 'remote-changed';`,
    `$complex_post_count = ${positiveInt(shape.postCount)};`,
    `$complex_schema_count = ${positiveInt(shape.schemaMetaCount)};`,
    `$complex_file_count = ${positiveInt(shape.fileCount)};`,
    `$complex_forms_rows = ${positiveInt(shape.formsLabRows)};`,
    `$complex_remote_drift_posts = ${positiveInt(shape.remoteDriftPosts)};`,
    `$complex_remote_drift_files = ${positiveInt(shape.remoteDriftFiles)};`,
    `$complex_featured_image_graph = ${shape.featuredImageGraph ? 'true' : 'false'};`,
    `$complex_taxonomy_graph = ${shape.taxonomyGraph ? 'true' : 'false'};`,
    `$complex_wp_navigation_fail_closed = ${shape.wpNavigationFailClosed ? 'true' : 'false'};`,
    `$complex_post_parent_graph = ${shape.postParentGraph ? 'true' : 'false'};`,
    `$complex_comment_graph = ${shape.commentGraph ? 'true' : 'false'};`,
    "for ($i = 1; $i <= $complex_post_count; $i++) {",
    "  $stable_id = 71000 + $i;",
    "  $suffix = str_pad((string) $i, 2, '0', STR_PAD_LEFT);",
    "  $base_title = 'Brewcommerce Complex Item ' . $suffix;",
    "  $base_content = 'Base Brewcommerce complex catalog content ' . $suffix . ' for local production proof.';",
    "  $title = $base_title;",
    "  $content = $base_content;",
    "  if ($complex_is_local) {",
    "    $title = $base_title . ' Local Edit';",
    "    $content = $base_content . ' Local editorial, merchandising, and fulfillment changes are staged.';",
    "  }",
    "  if ($complex_is_remote && $i <= $complex_remote_drift_posts) {",
    "    $title = $base_title . ' Remote Drift';",
    "    $content = $base_content . ' Concurrent remote merchandising edit must be preserved.';",
    "  }",
    "  $post_type = $i % 4 === 0 ? 'page' : ($i % 3 === 0 ? 'product' : 'post');",
    "  $post_id = wp_insert_post(array('import_id'=>$stable_id,'post_title'=>$title,'post_name'=>'brewcommerce-complex-' . $suffix,'post_content'=>$content,'post_status'=>'publish','post_type'=>$post_type,'post_parent'=>0,'post_author'=>0));",
    "  add_post_meta($post_id, 'reprint_push_fixture', 'complex-site', true);",
    "  if ($i <= $complex_schema_count) {",
    "    $schema_version = $complex_is_local ? 2 : (($complex_is_remote && $i <= $complex_remote_drift_posts) ? 3 : 1);",
    "    $schema_marker = $complex_is_local ? 'local-edit' : (($complex_is_remote && $i <= $complex_remote_drift_posts) ? 'remote-drift' : 'base');",
    "    update_post_meta($post_id, '_reprint_push_forms_schema', array('owner'=>'forms','schemaVersion'=>'brewcommerce-complex-' . $schema_version,'form'=>'complex-checkout-' . $suffix,'marker'=>$schema_marker,'fields'=>array(array('key'=>'email','type'=>'email','enabled'=>true),array('key'=>'quantity','type'=>'number','enabled'=>true),array('key'=>'delivery','type'=>'select','enabled'=>true,'choices'=>array('pickup','ship','courier')))));",
    "  }",
    "}",
    "if ($complex_featured_image_graph && $complex_is_local) {",
    `  $featured_post_id = ${featuredImagePostId};`,
    `  $attachment_id = ${featuredImageAttachmentId};`,
    `  $attachment_result = wp_insert_post(array('import_id'=>$attachment_id,'post_title'=>'Brewcommerce Featured Image Attachment','post_name'=>${phpString(featuredImageAttachmentSlug)},'post_content'=>'Local featured image attachment used for graph identity proof.','post_status'=>'inherit','post_type'=>'attachment','post_parent'=>$featured_post_id,'post_author'=>0));`,
    "  if (is_wp_error($attachment_result)) { throw new RuntimeException($attachment_result->get_error_message()); }",
    "  add_post_meta((int) $attachment_result, 'reprint_push_fixture', 'complex-featured-image', true);",
    `  update_post_meta($featured_post_id, ${phpString(featuredImageMetaKey)}, (string) $attachment_id);`,
    "}",
    "if ($complex_wp_navigation_fail_closed && $complex_is_local) {",
    `  $wp_navigation_post_id = ${wpNavigationGraphPostId};`,
    `  $navigation_result = wp_insert_post(array('import_id'=>$wp_navigation_post_id,'post_title'=>${phpString(wpNavigationGraphTitle)},'post_name'=>${phpString(wpNavigationGraphSlug)},'post_content'=>${phpString(wpNavigationGraphContent)},'post_status'=>'publish','post_type'=>'wp_navigation','post_parent'=>0,'post_author'=>0));`,
    "  if (is_wp_error($navigation_result)) { throw new RuntimeException($navigation_result->get_error_message()); }",
    "  add_post_meta((int) $navigation_result, 'reprint_push_fixture', 'wp-navigation-fail-closed', true);",
    "}",
    "if ($complex_post_parent_graph && $complex_is_local) {",
    `  $parent_post_id = ${postParentGraphParentId};`,
    `  $child_post_id = ${postParentGraphChildId};`,
    `  $parent_result = wp_insert_post(array('import_id'=>$parent_post_id,'post_title'=>'Reprint Push Parent Graph Parent','post_name'=>${phpString(postParentGraphParentSlug)},'post_content'=>'Local parent page used for same-plan post_parent graph proof.','post_status'=>'publish','post_type'=>'page','post_parent'=>0,'post_author'=>0));`,
    "  if (is_wp_error($parent_result)) { throw new RuntimeException($parent_result->get_error_message()); }",
    "  add_post_meta((int) $parent_result, 'reprint_push_fixture', 'complex-post-parent-graph', true);",
    `  $child_result = wp_insert_post(array('import_id'=>$child_post_id,'post_title'=>'Reprint Push Parent Graph Child','post_name'=>${phpString(postParentGraphChildSlug)},'post_content'=>'Local child page whose post_parent points at the same-plan parent page.','post_status'=>'publish','post_type'=>'page','post_parent'=>$parent_post_id,'post_author'=>0));`,
    "  if (is_wp_error($child_result)) { throw new RuntimeException($child_result->get_error_message()); }",
    "  add_post_meta((int) $child_result, 'reprint_push_fixture', 'complex-post-parent-graph', true);",
    "}",
    "if ($complex_taxonomy_graph && $complex_is_local) {",
    `  $taxonomy_post_id = ${taxonomyGraphPostId};`,
    `  $taxonomy_term_id = ${taxonomyGraphTermId};`,
    `  $taxonomy_term_taxonomy_id = ${taxonomyGraphTermTaxonomyId};`,
    `  $taxonomy_termmeta_id = ${taxonomyGraphTermMetaId};`,
    `  $wpdb->replace($wpdb->terms, array('term_id'=>$taxonomy_term_id,'name'=>'Reprint Push Taxonomy Graph','slug'=>${phpString(taxonomyGraphTermSlug)},'term_group'=>0), array('%d','%s','%s','%d'));`,
    "  $wpdb->replace($wpdb->term_taxonomy, array('term_taxonomy_id'=>$taxonomy_term_taxonomy_id,'term_id'=>$taxonomy_term_id,'taxonomy'=>'category','description'=>'Local taxonomy graph fixture.','parent'=>0,'count'=>1), array('%d','%d','%s','%s','%d','%d'));",
    "  $wpdb->replace($wpdb->term_relationships, array('object_id'=>$taxonomy_post_id,'term_taxonomy_id'=>$taxonomy_term_taxonomy_id,'term_order'=>0), array('%d','%d','%d'));",
    `  $wpdb->replace($wpdb->termmeta, array('meta_id'=>$taxonomy_termmeta_id,'term_id'=>$taxonomy_term_id,'meta_key'=>${phpString(taxonomyGraphMetaKey)},'meta_value'=>'local-taxonomy-graph'), array('%d','%d','%s','%s'));`,
    "  clean_term_cache(array($taxonomy_term_id), 'category');",
    "}",
    "if ($complex_comment_graph && $complex_is_local) {",
    `  $comment_post_id = ${commentGraphPostId};`,
    `  $parent_comment_id = ${commentGraphParentId};`,
    `  $child_comment_id = ${commentGraphChildId};`,
    `  $commentmeta_id = ${commentGraphMetaId};`,
    `  $comment_agent = ${phpString(commentGraphAgent)};`,
    `  $wpdb->replace($wpdb->comments, array('comment_ID'=>$parent_comment_id,'comment_post_ID'=>$comment_post_id,'comment_author'=>'Reprint Parent Comment','comment_author_email'=>'parent-comment@example.test','comment_author_url'=>'','comment_author_IP'=>'127.0.0.1','comment_date'=>'2026-05-27 21:45:00','comment_date_gmt'=>'2026-05-27 21:45:00','comment_content'=>'Local parent comment used for graph identity proof.','comment_karma'=>0,'comment_approved'=>'1','comment_agent'=>$comment_agent,'comment_type'=>'comment','comment_parent'=>0,'user_id'=>0), array('%d','%d','%s','%s','%s','%s','%s','%s','%s','%d','%s','%s','%s','%d','%d'));`,
    `  $wpdb->replace($wpdb->comments, array('comment_ID'=>$child_comment_id,'comment_post_ID'=>$comment_post_id,'comment_author'=>'Reprint Child Comment','comment_author_email'=>'child-comment@example.test','comment_author_url'=>'','comment_author_IP'=>'127.0.0.1','comment_date'=>'2026-05-27 21:46:00','comment_date_gmt'=>'2026-05-27 21:46:00','comment_content'=>'Local child comment whose comment_parent points at the same-plan parent comment.','comment_karma'=>0,'comment_approved'=>'1','comment_agent'=>$comment_agent,'comment_type'=>'comment','comment_parent'=>$parent_comment_id,'user_id'=>0), array('%d','%d','%s','%s','%s','%s','%s','%s','%s','%d','%s','%s','%s','%d','%d'));`,
    `  $wpdb->replace($wpdb->commentmeta, array('meta_id'=>$commentmeta_id,'comment_id'=>$child_comment_id,'meta_key'=>${phpString(commentGraphMetaKey)},'meta_value'=>'local-comment-graph'), array('%d','%d','%s','%s'));`,
    "  clean_comment_cache(array($parent_comment_id, $child_comment_id));",
    "}",
    "wp_mkdir_p($dir);",
    "for ($i = 1; $i <= $complex_file_count; $i++) {",
    "  $suffix = str_pad((string) $i, 2, '0', STR_PAD_LEFT);",
    "  $marker = $complex_is_local ? 'local-edit' : (($complex_is_remote && $i <= $complex_remote_drift_files) ? 'remote-drift' : 'base');",
    "  file_put_contents($dir . '/brewcommerce-complex-' . $suffix . '.json', wp_json_encode(array('owner'=>'brewcommerce','asset'=>'complex-local-production','index'=>$i,'marker'=>$marker,'receiptBounded'=>true)));",
    "}",
    "$forms_fixture_revision = $complex_is_local ? 'local-edit' : ($complex_is_remote ? 'remote-drift' : 'base');",
    "update_option('reprint_push_forms_fixture', array('owner'=>'forms','revision'=>$forms_fixture_revision,'complexSite'=>true,'postCount'=>$complex_post_count,'schemaMetaCount'=>$complex_schema_count,'fileCount'=>$complex_file_count));",
    "for ($i = 2; $i <= $complex_forms_rows; $i++) {",
    "  $wpdb->replace($forms_table, array('id'=>$i,'form_slug'=>'complex-checkout-' . $i,'payload_json'=>wp_json_encode(array('owner'=>'forms','mode'=>'production','version'=>'1','rules'=>array('terms'=>true,'index'=>(string) $i))),'updated_marker'=>'production'), array('%d','%s','%s','%s'));",
    "}",
  ].join(' ');
}

export function buildComplexSitePlannerProof({
  sourceSnapshot,
  localEditedSnapshot,
  remoteChangedSnapshot,
  fullBrewcommerceImport = false,
  installWooCommerce = false,
  brewcommerceBlueprintDir = '',
  shape = complexSiteFixtureShape,
} = {}) {
  assert.ok(sourceSnapshot, 'sourceSnapshot is required');
  assert.ok(localEditedSnapshot, 'localEditedSnapshot is required');
  assert.ok(remoteChangedSnapshot, 'remoteChangedSnapshot is required');

  const readyPlan = createPushPlan({
    base: sourceSnapshot,
    local: localEditedSnapshot,
    remote: sourceSnapshot,
    now: proofNow,
  });
  const remoteDriftPlan = createPushPlan({
    base: sourceSnapshot,
    local: localEditedSnapshot,
    remote: remoteChangedSnapshot,
    now: proofNow,
  });
  const readyMutations = readyPlan.mutations || [];
  const remoteConflicts = remoteDriftPlan.conflicts || [];
  const pluginDriverEvidence = buildPluginDriverBoundaryEvidence({
    sourceSnapshot,
    localEditedSnapshot,
    remoteChangedSnapshot,
    readyPlan,
    remoteDriftPlan,
  });
  const expectedMinimumReadyMutations =
    positiveInt(shape.postCount)
    + positiveInt(shape.schemaMetaCount)
    + positiveInt(shape.fileCount)
    + 2
    + (shape.featuredImageGraph ? 2 : 0)
    + (shape.postParentGraph ? postParentGraphResourceKeys.length : 0)
    + (shape.taxonomyGraph ? taxonomyGraphResourceKeys.length : 0)
    + (shape.commentGraph ? commentGraphResourceKeys.length : 0);
  const expectedMinimumConflicts =
    positiveInt(shape.remoteDriftPosts)
    + Math.min(positiveInt(shape.schemaMetaCount), positiveInt(shape.remoteDriftPosts))
    + positiveInt(shape.remoteDriftFiles)
    + 2;
  const invariants = {
    denseSourceCountsPresent: snapshotMeetsComplexShape(sourceSnapshot, shape),
    denseLocalCountsPresent: snapshotMeetsComplexShape(localEditedSnapshot, shape),
    denseRemoteChangedCountsPresent: snapshotMeetsComplexShape(remoteChangedSnapshot, shape),
    readyPlanReady: readyPlan.status === 'ready',
    readyPlanHasConcreteMutations: readyMutations.length >= expectedMinimumReadyMutations,
    preconditionsMatchMutations: readyPlan.preconditions?.length === readyMutations.length,
    everyMutationHasLiveRemotePrecondition: readyMutations.every((mutation) =>
      readyPlan.preconditions?.some((precondition) =>
        precondition.mutationId === mutation.id
        && precondition.resourceKey === mutation.resourceKey
        && precondition.checkedAgainst === 'live-remote'
        && typeof precondition.expectedHash === 'string'
        && /^[a-f0-9]{64}$/.test(precondition.expectedHash))),
    noDeleteMutations: readyMutations.every((mutation) => mutation.action !== 'delete'),
    noActivePluginsDirectMutation: readyMutations.every((mutation) =>
      !(mutation.resource?.type === 'row'
        && mutation.resource.table === 'wp_options'
        && mutation.resource.id === 'option_name:active_plugins')),
    pluginOwnedMutationsHaveDrivers: readyMutations
      .filter((mutation) => mutation.pluginOwnedResource)
      .every((mutation) => typeof mutation.pluginOwnedResource?.driver === 'string'
        && mutation.pluginOwnedResource.driver.length > 0),
    noUnsupportedPluginOwnedBlockers: readyPlan.blockers.every((blocker) =>
      blocker.class !== 'unsupported-plugin-owned-resource'),
    pluginDriverAllowlistExact: pluginDriverEvidence.allowlist.exact === true,
    pluginDriverMutationPlanned: pluginDriverEvidence.mutationBoundary.planned === true,
    pluginDriverHasLivePrecondition: pluginDriverEvidence.preconditionHashes.liveRemote === true
      && pluginDriverEvidence.preconditionHashes.matchesSource === true
      && pluginDriverEvidence.preconditionHashes.matchesMutationBase === true
      && pluginDriverEvidence.preconditionHashes.matchesRemoteBefore === true,
    pluginDriverRemoteDriftFailsClosed: pluginDriverEvidence.rejectedRemoteEvidence.failureClosed === true,
    pluginDriverNoUnsafeOptionMutation: pluginDriverEvidence.safeMutationSet.noActivePluginsDirectMutation === true
      && pluginDriverEvidence.safeMutationSet.noUnownedOptionMutation === true,
    pluginDriverCustomTablesDriverOwned: pluginDriverEvidence.safeMutationSet.customTableMutationsDriverOwned === true,
    featuredImageGraphCountsPresent: !shape.featuredImageGraph
      || (summarizeComplexSnapshot(localEditedSnapshot).featuredImageAttachments >= 1
        && summarizeComplexSnapshot(localEditedSnapshot).featuredImageMeta >= 1),
    featuredImageGraphPlanned: !shape.featuredImageGraph
      || [featuredImageAttachmentResourceKey, featuredImageMetaResourceKey].every((resourceKey) =>
        readyMutations.some((mutation) => mutation.resourceKey === resourceKey)),
    featuredImageGraphHasLivePreconditions: !shape.featuredImageGraph
      || [featuredImageAttachmentResourceKey, featuredImageMetaResourceKey].every((resourceKey) =>
        readyPlan.preconditions?.some((precondition) =>
          precondition.resourceKey === resourceKey
          && precondition.checkedAgainst === 'live-remote'
          && typeof precondition.expectedHash === 'string'
          && /^[a-f0-9]{64}$/.test(precondition.expectedHash))),
    featuredImageGraphNoStaleBlocker: !shape.featuredImageGraph
      || readyPlan.blockers.every((blocker) => blocker.class !== 'stale-wordpress-graph-identity'),
    postParentGraphCountsPresent: !shape.postParentGraph
      || (summarizeComplexSnapshot(localEditedSnapshot).postParentGraphParents >= 1
        && summarizeComplexSnapshot(localEditedSnapshot).postParentGraphChildren >= 1),
    postParentGraphPlanned: !shape.postParentGraph
      || postParentGraphResourceKeys.every((resourceKey) =>
        readyMutations.some((mutation) => mutation.resourceKey === resourceKey)),
    postParentGraphHasLivePreconditions: !shape.postParentGraph
      || postParentGraphResourceKeys.every((resourceKey) =>
        readyPlan.preconditions?.some((precondition) =>
          precondition.resourceKey === resourceKey
          && precondition.checkedAgainst === 'live-remote'
          && typeof precondition.expectedHash === 'string'
          && /^[a-f0-9]{64}$/.test(precondition.expectedHash))),
    postParentGraphNoStaleBlocker: !shape.postParentGraph
      || readyPlan.blockers.every((blocker) => blocker.class !== 'stale-wordpress-graph-identity'),
    taxonomyGraphCountsPresent: !shape.taxonomyGraph
      || (summarizeComplexSnapshot(localEditedSnapshot).taxonomyGraphTerms >= 1
        && summarizeComplexSnapshot(localEditedSnapshot).taxonomyGraphTaxonomies >= 1
        && summarizeComplexSnapshot(localEditedSnapshot).taxonomyGraphRelationships >= 1
        && summarizeComplexSnapshot(localEditedSnapshot).taxonomyGraphTermmeta >= 1),
    taxonomyGraphPlanned: !shape.taxonomyGraph
      || taxonomyGraphResourceKeys.every((resourceKey) =>
        readyMutations.some((mutation) => mutation.resourceKey === resourceKey)),
    taxonomyGraphHasLivePreconditions: !shape.taxonomyGraph
      || taxonomyGraphResourceKeys.every((resourceKey) =>
        readyPlan.preconditions?.some((precondition) =>
          precondition.resourceKey === resourceKey
          && precondition.checkedAgainst === 'live-remote'
          && typeof precondition.expectedHash === 'string'
          && /^[a-f0-9]{64}$/.test(precondition.expectedHash))),
    taxonomyGraphNoStaleBlocker: !shape.taxonomyGraph
      || readyPlan.blockers.every((blocker) => blocker.class !== 'stale-wordpress-graph-identity'),
    commentGraphCountsPresent: !shape.commentGraph
      || (summarizeComplexSnapshot(localEditedSnapshot).commentGraphParents >= 1
        && summarizeComplexSnapshot(localEditedSnapshot).commentGraphChildren >= 1
        && summarizeComplexSnapshot(localEditedSnapshot).commentGraphCommentmeta >= 1),
    commentGraphPlanned: !shape.commentGraph
      || commentGraphResourceKeys.every((resourceKey) =>
        readyMutations.some((mutation) => mutation.resourceKey === resourceKey)),
    commentGraphHasLivePreconditions: !shape.commentGraph
      || commentGraphResourceKeys.every((resourceKey) =>
        readyPlan.preconditions?.some((precondition) =>
          precondition.resourceKey === resourceKey
          && precondition.checkedAgainst === 'live-remote'
          && typeof precondition.expectedHash === 'string'
          && /^[a-f0-9]{64}$/.test(precondition.expectedHash))),
    commentGraphNoStaleBlocker: !shape.commentGraph
      || readyPlan.blockers.every((blocker) => blocker.class !== 'stale-wordpress-graph-identity'),
    remoteDriftFailsClosed: ['blocked', 'conflict'].includes(remoteDriftPlan.status)
      && remoteConflicts.length >= expectedMinimumConflicts,
    remoteDriftPreservesRemote: remoteConflicts.every((conflict) =>
      conflict.resolutionPolicy === 'preserve-remote-and-stop'),
  };

  return {
    gate: 'GATE-3',
    runtime: 'local-playground-wordpress',
    dockerAvailable: false,
    fullBrewcommerceImport,
    installWooCommerce,
    brewcommerceBlueprintDir,
    shape: {
      ...shape,
      expectedMinimumReadyMutations,
      expectedMinimumConflicts,
    },
    counts: {
      source: summarizeComplexSnapshot(sourceSnapshot),
      localEdited: summarizeComplexSnapshot(localEditedSnapshot),
      remoteChanged: summarizeComplexSnapshot(remoteChangedSnapshot),
    },
    readyPlan: summarizePlan(readyPlan),
    remoteDriftPlan: {
      ...summarizePlan(remoteDriftPlan),
      conflictSamples: remoteConflicts.slice(0, 8).map((conflict) => ({
        resourceKey: conflict.resourceKey,
        class: conflict.class,
        resolutionPolicy: conflict.resolutionPolicy,
      })),
    },
    mutationFamilies: countMutationFamilies(readyMutations),
    graphEvidence: shape.featuredImageGraph ? {
      type: 'featured-image-attachment',
      attachmentResourceKey: featuredImageAttachmentResourceKey,
      thumbnailMetaResourceKey: featuredImageMetaResourceKey,
      attachmentPlanned: readyMutations.some((mutation) =>
        mutation.resourceKey === featuredImageAttachmentResourceKey),
      thumbnailMetaPlanned: readyMutations.some((mutation) =>
        mutation.resourceKey === featuredImageMetaResourceKey),
      staleGraphBlockers: readyPlan.blockers.filter((blocker) =>
        blocker.class === 'stale-wordpress-graph-identity').length,
    } : null,
    postParentGraphEvidence: shape.postParentGraph ? {
      type: 'post-parent-page-closure',
      parentResourceKey: postParentGraphParentResourceKey,
      childResourceKey: postParentGraphChildResourceKey,
      allResourcesPlanned: postParentGraphResourceKeys.every((resourceKey) =>
        readyMutations.some((mutation) => mutation.resourceKey === resourceKey)),
      childReferencesParent: Number(
        localEditedSnapshot?.db?.wp_posts?.[`ID:${postParentGraphChildId}`]?.post_parent,
      ) === postParentGraphParentId,
      staleGraphBlockers: readyPlan.blockers.filter((blocker) =>
        blocker.class === 'stale-wordpress-graph-identity').length,
    } : null,
    taxonomyGraphEvidence: shape.taxonomyGraph ? {
      type: 'category-term-relationship-termmeta',
      termResourceKey: taxonomyGraphTermResourceKey,
      termTaxonomyResourceKey: taxonomyGraphTaxonomyResourceKey,
      relationshipResourceKey: taxonomyGraphRelationshipResourceKey,
      termmetaResourceKey: taxonomyGraphTermMetaResourceKey,
      allResourcesPlanned: taxonomyGraphResourceKeys.every((resourceKey) =>
        readyMutations.some((mutation) => mutation.resourceKey === resourceKey)),
      staleGraphBlockers: readyPlan.blockers.filter((blocker) =>
        blocker.class === 'stale-wordpress-graph-identity').length,
    } : null,
    commentGraphEvidence: shape.commentGraph ? {
      type: 'comment-parent-commentmeta',
      parentResourceKey: commentGraphParentResourceKey,
      childResourceKey: commentGraphChildResourceKey,
      commentmetaResourceKey: commentGraphMetaResourceKey,
      allResourcesPlanned: commentGraphResourceKeys.every((resourceKey) =>
        readyMutations.some((mutation) => mutation.resourceKey === resourceKey)),
      parentReferencesPost: Number(
        localEditedSnapshot?.db?.wp_comments?.[`comment_ID:${commentGraphParentId}`]?.comment_post_ID,
      ) === commentGraphPostId,
      childReferencesParent: Number(
        localEditedSnapshot?.db?.wp_comments?.[`comment_ID:${commentGraphChildId}`]?.comment_parent,
      ) === commentGraphParentId,
      commentmetaReferencesChild: Number(
        localEditedSnapshot?.db?.wp_commentmeta?.[`meta_id:${commentGraphMetaId}`]?.comment_id,
      ) === commentGraphChildId,
      staleGraphBlockers: readyPlan.blockers.filter((blocker) =>
        blocker.class === 'stale-wordpress-graph-identity').length,
    } : null,
    pluginDriverEvidence,
    invariants,
    ok: Object.values(invariants).every(Boolean),
  };
}

export function buildWpNavigationFailClosedProof({
  sourceSnapshot,
  localEditedSnapshot,
  remoteChangedSnapshot,
} = {}) {
  assert.ok(sourceSnapshot, 'sourceSnapshot is required');
  assert.ok(localEditedSnapshot, 'localEditedSnapshot is required');
  assert.ok(remoteChangedSnapshot, 'remoteChangedSnapshot is required');

  const readyPlan = createPushPlan({
    base: sourceSnapshot,
    local: localEditedSnapshot,
    remote: sourceSnapshot,
    now: proofNow,
  });
  const remoteDriftPlan = createPushPlan({
    base: sourceSnapshot,
    local: localEditedSnapshot,
    remote: remoteChangedSnapshot,
    now: proofNow,
  });
  const navigationBlocker = readyPlan.blockers.find((blocker) =>
    blocker?.resourceKey === wpNavigationGraphResourceKey) || null;
  const blockerEvidence = navigationBlocker
    ? hashOnlyWordPressGraphBlockerEvidence(navigationBlocker)
    : null;
  const blockerEvidenceJson = JSON.stringify(blockerEvidence);
  const readyMutations = readyPlan.mutations || [];
  const counts = {
    source: summarizeComplexSnapshot(sourceSnapshot),
    localEdited: summarizeComplexSnapshot(localEditedSnapshot),
    remoteChanged: summarizeComplexSnapshot(remoteChangedSnapshot),
  };
  const invariants = {
    wpNavigationCountsPresent: counts.source.wpNavigationFailClosedPosts === 0
      && counts.localEdited.wpNavigationFailClosedPosts >= 1,
    plannerFailsClosed: readyPlan.status === 'blocked',
    releaseMovementPrevented: readyPlan.status !== 'ready',
    wpNavigationBlocked: navigationBlocker?.class === 'stale-wordpress-graph-identity'
      && navigationBlocker?.resolutionPolicy === 'preserve-remote-wordpress-graph-and-stop'
      && String(navigationBlocker?.reason || '').includes('unsupported post graph surface wp_navigation'),
    noWpNavigationMutation: !readyMutations.some((mutation) =>
      mutation.resourceKey === wpNavigationGraphResourceKey),
    blockerEvidenceIsHashOnly: Boolean(blockerEvidence)
      && [blockerEvidence.baseHash, blockerEvidence.localHash, blockerEvidence.remoteHash].every(isSha256Hex)
      && ['base', 'local', 'remote'].every((slot) => isSha256Hex(blockerEvidence.change?.[slot]?.hash)),
    blockerEvidenceRedactsRawValues: ![
      wpNavigationGraphTitle,
      wpNavigationGraphSlug,
      wpNavigationGraphContent,
    ].some((privateValue) => blockerEvidenceJson.includes(privateValue)),
  };

  return {
    type: 'wp-navigation-fail-closed',
    releaseReady: false,
    resourceKey: wpNavigationGraphResourceKey,
    counts,
    readyPlan: summarizePlan(readyPlan),
    remoteDriftPlan: summarizePlan(remoteDriftPlan),
    mutationFamilies: countMutationFamilies(readyMutations),
    blocker: blockerEvidence,
    invariants,
    ok: Object.values(invariants).every(Boolean),
  };
}

export function buildComplexSiteReleaseEvidence({
  plannerProof,
  verifyOutput = '',
  verifyStatus = null,
  verifySignal = null,
} = {}) {
  const releaseSummary = findReleaseVerifierSummary(verifyOutput);
  const releaseProof = releaseSummary?.releaseProof || {};
  const dryRun = releaseProof.dryRun || {};
  const apply = releaseProof.apply || {};
  const planObject = releaseProof.planObject || {};
  const mutations = Array.isArray(planObject.mutations) ? planObject.mutations : [];
  const preconditions = Array.isArray(planObject.preconditions) ? planObject.preconditions : [];
  const receiptHash = dryRun.receiptHash || dryRun.receipt?.receiptHash || '';
  const journal = releaseSummary?.durableJournal || {};
  const boundary = releaseSummary?.boundary || {};
  const authSessionBoundary = releaseSummary?.authSessionBoundary || {};
  const applyRevalidation = apply.applyRevalidation || {};
  const pluginDriverMutation = mutations.find((mutation) =>
    mutation?.resourceKey === releaseStateResourceKey) || null;
  const pluginDriverPrecondition = preconditions.find((precondition) =>
    precondition?.resourceKey === releaseStateResourceKey) || null;
  const applyRevalidationResourceKeys = Array.isArray(applyRevalidation.verifiedResourceKeys)
    ? applyRevalidation.verifiedResourceKeys
    : [];
  const invariants = {
    verifierExitedZero: verifyStatus === 0 && verifySignal === null,
    summaryParsed: Boolean(releaseSummary),
    releaseMovementCandidate: releaseSummary?.releaseMovement?.gates === 'candidate-for-review',
    boundaryLiveOk: boundary.verdict === 'LIVE_RELEASE_BOUNDARY_OK',
    authSessionGateOk: boundary.authSession?.verdict === 'LIVE_RELEASE_BOUNDARY_OK'
      && authSessionBoundary.verdict === 'AUTH_SESSION_BOUNDARY_OK',
    durableJournalGateOk: boundary.durableJournal?.verdict === 'LIVE_RELEASE_BOUNDARY_OK'
      && journal.checkedAccepted === true,
    receiptHashPresent: /^[a-f0-9]{64}$/.test(receiptHash),
    journalRowsPresent: Number.isInteger(journal.rows) && journal.rows > 0,
    journalCommitted: journal.applyCommitted === true,
    journalMutationCountMatchesPlan: Number.isInteger(journal.mutationApplied)
      && journal.mutationApplied === mutations.length,
    applyRevalidationCoveredEveryMutation: Number.isInteger(applyRevalidation.verifiedCount)
      && applyRevalidation.verifiedCount === mutations.length,
    pluginDriverCarriedInReleasePlan: pluginDriverMutation?.pluginOwnedResource?.driver === releaseStateDriver
      && pluginDriverMutation?.pluginOwnedResource?.pluginOwner === releaseStateOwner
      && pluginDriverMutation?.resource?.table === releaseStateTable
      && pluginDriverMutation?.resource?.id === releaseStateRowId,
    pluginDriverHasReleasePrecondition: pluginDriverPrecondition?.checkedAgainst === 'live-remote'
      && typeof pluginDriverPrecondition?.expectedHash === 'string'
      && /^[a-f0-9]{64}$/.test(pluginDriverPrecondition.expectedHash)
      && pluginDriverPrecondition.expectedHash === pluginDriverMutation?.baseHash
      && pluginDriverPrecondition.expectedHash === pluginDriverMutation?.remoteBeforeHash,
    pluginDriverApplyRevalidated: applyRevalidation.phase === 'before-first-mutation'
      && applyRevalidation.checkedAgainst === 'live-remote'
      && applyRevalidationResourceKeys.includes(releaseStateResourceKey),
    replayEquivalent: releaseSummary?.replayEquivalence?.equivalent === true,
    plannerProofPassed: plannerProof?.ok === true,
  };

  return {
    ok: Object.values(invariants).every(Boolean),
    verifier: {
      status: verifyStatus,
      signal: verifySignal,
      summaryParsed: Boolean(releaseSummary),
      ok: releaseSummary?.ok === true,
      releaseMovement: releaseSummary?.releaseMovement || null,
      boundary: boundary ? {
        verdict: boundary.verdict || null,
        firstRemainingProductionBoundary: boundary.firstRemainingProductionBoundary ?? null,
        authSessionVerdict: boundary.authSession?.verdict || null,
        durableJournalVerdict: boundary.durableJournal?.verdict || null,
        replayAndRetryVerdict: boundary.replayAndRetry?.verdict || null,
      } : null,
      authSessionBoundary: authSessionBoundary ? {
        verdict: authSessionBoundary.verdict || null,
        sameSession: authSessionBoundary.identityContinuity?.sameSession ?? null,
        sameUserLogin: authSessionBoundary.identityContinuity?.sameUserLogin ?? null,
        manageOptions: authSessionBoundary.identityContinuity?.manageOptions ?? null,
      } : null,
      receipt: {
        hash: receiptHash || null,
        present: Boolean(receiptHash),
        dryRunStatus: dryRun.status ?? null,
        applyStatus: apply.status ?? null,
        applyRevalidationVerifiedCount: applyRevalidation.verifiedCount ?? null,
      },
      plan: {
        mutations: mutations.length,
        preconditions: preconditions.length,
      },
      pluginDriver: {
        resourceKey: releaseStateResourceKey,
        driver: releaseStateDriver,
        owner: releaseStateOwner,
        mutationPlanned: Boolean(pluginDriverMutation),
        mutation: pluginDriverMutation ? {
          id: pluginDriverMutation.id,
          action: pluginDriverMutation.action,
          driver: pluginDriverMutation.pluginOwnedResource?.driver || null,
          owner: pluginDriverMutation.pluginOwnedResource?.pluginOwner || null,
          baseHash: pluginDriverMutation.baseHash || null,
          remoteBeforeHash: pluginDriverMutation.remoteBeforeHash || null,
          localHash: pluginDriverMutation.localHash || null,
        } : null,
        precondition: pluginDriverPrecondition ? {
          mutationId: pluginDriverPrecondition.mutationId,
          expectedHash: pluginDriverPrecondition.expectedHash,
          checkedAgainst: pluginDriverPrecondition.checkedAgainst || null,
        } : null,
        applyRevalidated: applyRevalidationResourceKeys.includes(releaseStateResourceKey),
      },
      durableJournal: {
        rows: journal.rows ?? null,
        rowCount: journal.rowCount ?? null,
        readbackPages: journal.readbackPages ?? null,
        paginationComplete: journal.paginationComplete ?? null,
        paginationTruncated: journal.paginationTruncated ?? null,
        oldestSequence: journal.oldestSequence ?? null,
        newestSequence: journal.newestSequence ?? null,
        mutationApplied: journal.mutationApplied ?? null,
        applyCommitted: journal.applyCommitted ?? null,
        checkedAccepted: journal.checkedAccepted ?? null,
        ownership: journal.ownership || null,
        leaseFence: journal.proof?.leaseFence || journal.liveLeaseFence || null,
      },
      replayEquivalence: releaseSummary?.replayEquivalence || null,
      gate2DurableRecoveryJournal: releaseSummary?.gate2DurableRecoveryJournal || null,
    },
    planner: plannerProof ? {
      ok: plannerProof.ok,
      counts: plannerProof.counts,
      readyPlan: plannerProof.readyPlan,
      remoteDriftPlan: plannerProof.remoteDriftPlan,
      mutationFamilies: plannerProof.mutationFamilies,
    } : null,
    invariants,
  };
}

export function buildPluginDriverBoundaryEvidence({
  sourceSnapshot,
  localEditedSnapshot,
  remoteChangedSnapshot,
  readyPlan,
  remoteDriftPlan,
} = {}) {
  const readyMutations = readyPlan?.mutations || [];
  const readyPreconditions = readyPlan?.preconditions || [];
  const remoteConflicts = remoteDriftPlan?.conflicts || [];
  const mutation = readyMutations.find((entry) => entry?.resourceKey === releaseStateResourceKey) || null;
  const precondition = readyPreconditions.find((entry) => entry?.resourceKey === releaseStateResourceKey) || null;
  const rejectedRemoteConflict = remoteConflicts.find((entry) =>
    entry?.resourceKey === releaseStateResourceKey) || null;
  const allowlistEntry = pluginDriverAllowlistEntry(sourceSnapshot)
    || pluginDriverAllowlistEntry(localEditedSnapshot)
    || pluginDriverAllowlistEntry(remoteChangedSnapshot);
  const sourceState = pluginDriverStateEvidence(sourceSnapshot);
  const localState = pluginDriverStateEvidence(localEditedSnapshot);
  const remoteChangedState = pluginDriverStateEvidence(remoteChangedSnapshot);
  const optionMutations = readyMutations.filter((entry) =>
    entry?.resource?.type === 'row' && entry.resource.table === 'wp_options');
  const customTableMutations = readyMutations.filter((entry) =>
    entry?.resource?.type === 'row' && String(entry.resource.table || '').startsWith('wp_reprint_push_'));

  return {
    type: 'production-owned-plugin-driver',
    driver: releaseStateDriver,
    owner: releaseStateOwner,
    table: releaseStateTable,
    rowId: releaseStateRowId,
    resourceKey: releaseStateResourceKey,
    allowlist: {
      exact: allowlistEntry?.resourceKey === releaseStateResourceKey
        && allowlistEntry?.pluginOwner === releaseStateOwner
        && allowlistEntry?.driver === releaseStateDriver
        && allowlistEntry?.table === releaseStateTable
        && allowlistEntry?.supportsDelete === false,
      entry: allowlistEntry || null,
    },
    sourcePluginStateEvidence: sourceState,
    localPluginStateEvidence: localState,
    remoteChangedPluginStateEvidence: remoteChangedState,
    mutationBoundary: mutation ? {
      planned: true,
      id: mutation.id,
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      driver: mutation.pluginOwnedResource?.driver || null,
      owner: mutation.pluginOwnedResource?.pluginOwner || null,
      baseHash: mutation.baseHash || null,
      remoteBeforeHash: mutation.remoteBeforeHash || null,
      localHash: mutation.localHash || null,
      exactDriver: mutation.pluginOwnedResource?.driver === releaseStateDriver
        && mutation.pluginOwnedResource?.pluginOwner === releaseStateOwner
        && mutation.resource?.table === releaseStateTable
        && mutation.resource?.id === releaseStateRowId,
    } : {
      planned: false,
    },
    preconditionHashes: precondition ? {
      liveRemote: precondition.checkedAgainst === 'live-remote'
        && typeof precondition.expectedHash === 'string'
        && /^[a-f0-9]{64}$/.test(precondition.expectedHash),
      mutationId: precondition.mutationId,
      expectedHash: precondition.expectedHash,
      sourceHash: sourceState.hash,
      mutationBaseHash: mutation?.baseHash || null,
      mutationRemoteBeforeHash: mutation?.remoteBeforeHash || null,
      mutationLocalHash: mutation?.localHash || null,
      matchesSource: precondition.expectedHash === sourceState.hash,
      matchesMutationBase: precondition.expectedHash === mutation?.baseHash,
      matchesRemoteBefore: precondition.expectedHash === mutation?.remoteBeforeHash,
    } : {
      liveRemote: false,
      matchesSource: false,
      matchesMutationBase: false,
      matchesRemoteBefore: false,
    },
    rejectedRemoteEvidence: {
      failureClosed: rejectedRemoteConflict?.resolutionPolicy === 'preserve-remote-and-stop',
      resourceKey: rejectedRemoteConflict?.resourceKey || null,
      class: rejectedRemoteConflict?.class || null,
      resolutionPolicy: rejectedRemoteConflict?.resolutionPolicy || null,
      remoteChangedHash: remoteChangedState.hash,
      remoteChangedMode: remoteChangedState.mode,
    },
    safeMutationSet: {
      noActivePluginsDirectMutation: readyMutations.every((entry) =>
        !(entry?.resource?.type === 'row'
          && entry.resource.table === 'wp_options'
          && entry.resource.id === 'option_name:active_plugins')),
      noUnownedOptionMutation: optionMutations.every((entry) =>
        entry?.pluginOwnedResource?.pluginOwner
        && entry?.pluginOwnedResource?.driver),
      customTableMutationsDriverOwned: customTableMutations.every((entry) =>
        entry?.pluginOwnedResource?.pluginOwner
        && entry?.pluginOwnedResource?.driver),
      customTableMutationCount: customTableMutations.length,
      optionMutationCount: optionMutations.length,
    },
  };
}

export function findReleaseVerifierSummary(output) {
  const objects = extractJsonObjects(output);
  return [...objects].reverse().find((object) =>
    object
    && typeof object === 'object'
    && object.releaseMovement
    && object.gate2DurableRecoveryJournal
    && object.releaseProof
    && object.boundary) || null;
}

function hashOnlyWordPressGraphBlockerEvidence(blocker) {
  return {
    id: blocker.id || null,
    class: blocker.class || null,
    resourceKey: blocker.resourceKey || null,
    reason: blocker.reason || null,
    resolutionPolicy: blocker.resolutionPolicy || null,
    baseHash: blocker.baseHash || null,
    localHash: blocker.localHash || null,
    remoteHash: blocker.remoteHash || null,
    change: blocker.change || null,
    references: Array.isArray(blocker.references)
      ? blocker.references.map((reference) => ({
        relationshipKey: reference.relationshipKey || null,
        relationshipType: reference.relationshipType || null,
        sourceResourceKey: reference.sourceResourceKey || null,
        targetResourceKey: reference.targetResourceKey || null,
        targetBaseHash: reference.targetBaseHash || null,
        targetLocalHash: reference.targetLocalHash || null,
        targetRemoteHash: reference.targetRemoteHash || null,
        targetChange: reference.targetChange || null,
        targetSupport: reference.targetSupport ? {
          supported: reference.targetSupport.supported === true,
          className: reference.targetSupport.className || null,
          reason: reference.targetSupport.reason || null,
        } : null,
      }))
      : [],
  };
}

function isSha256Hex(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function pluginDriverAllowlistEntry(snapshot) {
  const resources = snapshot?.meta?.pluginOwnedResources?.allowedResources;
  if (!Array.isArray(resources)) {
    return null;
  }
  return resources.find((entry) => entry?.resourceKey === releaseStateResourceKey) || null;
}

function pluginDriverStateEvidence(snapshot) {
  const row = snapshot?.db?.[releaseStateTable]?.[releaseStateRowId] || null;
  return {
    present: Boolean(row),
    resourceKey: releaseStateResourceKey,
    hash: row ? resourceHash(snapshot, releaseStateResource) : null,
    owner: row?.__pluginOwner || null,
    mode: row?.payload?.mode || null,
    version: row?.payload?.version ?? null,
    updatedMarker: row?.updated_marker || null,
    proofMarker: row?.payload?.releaseBoundaryProof || null,
  };
}

export function extractJsonObjects(output) {
  const text = String(output || '');
  const objects = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '{') {
      continue;
    }
    const end = findJsonObjectEnd(text, index);
    if (end === -1) {
      continue;
    }
    const candidate = text.slice(index, end + 1);
    try {
      objects.push(JSON.parse(candidate));
      index = end;
    } catch {
      // Keep scanning; command output may contain braces from non-JSON text.
    }
  }
  return objects;
}

export function summarizeComplexSnapshot(snapshot) {
  const db = snapshot?.db || {};
  const posts = db.wp_posts || {};
  const postmeta = db.wp_postmeta || {};
  const terms = db.wp_terms || {};
  const termTaxonomy = db.wp_term_taxonomy || {};
  const termRelationships = db.wp_term_relationships || {};
  const termmeta = db.wp_termmeta || {};
  const comments = db.wp_comments || {};
  const commentmeta = db.wp_commentmeta || {};
  const files = snapshot?.files || {};
  const formsLab = db.wp_reprint_push_forms_lab || {};
  const releaseState = db.wp_reprint_push_release_state || {};
  const options = db.wp_options || {};
  return {
    fixture: snapshot?.meta?.fixture || null,
    siteUrl: snapshot?.meta?.site_url || null,
    posts: Object.keys(posts).length,
    complexPosts: Object.values(posts).filter((row) =>
      String(row?.post_name || '').startsWith('brewcommerce-complex-')).length,
    postmeta: Object.keys(postmeta).length,
    complexSchemaMeta: Object.values(postmeta).filter((row) =>
      String(row?.meta_key || '') === '_reprint_push_forms_schema'
      && String(row?.meta_value?.form || '').startsWith('complex-checkout-')).length,
    featuredImageAttachments: Object.values(posts).filter((row) =>
      String(row?.post_type || '') === 'attachment'
      && String(row?.post_name || '') === featuredImageAttachmentSlug).length,
    featuredImageMeta: Object.values(postmeta).filter((row) =>
      String(row?.meta_key || '') === featuredImageMetaKey
      && String(row?.meta_value || '') === String(featuredImageAttachmentId)).length,
    wpNavigationFailClosedPosts: Object.values(posts).filter((row) =>
      Number(row?.ID) === wpNavigationGraphPostId
      && String(row?.post_type || '') === 'wp_navigation'
      && String(row?.post_name || '') === wpNavigationGraphSlug).length,
    postParentGraphParents: Object.values(posts).filter((row) =>
      Number(row?.ID) === postParentGraphParentId
      && String(row?.post_name || '') === postParentGraphParentSlug
      && Number(row?.post_parent) === 0).length,
    postParentGraphChildren: Object.values(posts).filter((row) =>
      Number(row?.ID) === postParentGraphChildId
      && String(row?.post_name || '') === postParentGraphChildSlug
      && Number(row?.post_parent) === postParentGraphParentId).length,
    taxonomyGraphTerms: Object.values(terms).filter((row) =>
      String(row?.slug || '') === taxonomyGraphTermSlug).length,
    taxonomyGraphTaxonomies: Object.values(termTaxonomy).filter((row) =>
      Number(row?.term_taxonomy_id) === taxonomyGraphTermTaxonomyId
      && Number(row?.term_id) === taxonomyGraphTermId
      && String(row?.taxonomy || '') === 'category').length,
    taxonomyGraphRelationships: Object.values(termRelationships).filter((row) =>
      Number(row?.object_id) === taxonomyGraphPostId
      && Number(row?.term_taxonomy_id) === taxonomyGraphTermTaxonomyId).length,
    taxonomyGraphTermmeta: Object.values(termmeta).filter((row) =>
      Number(row?.meta_id) === taxonomyGraphTermMetaId
      && Number(row?.term_id) === taxonomyGraphTermId
      && String(row?.meta_key || '') === taxonomyGraphMetaKey).length,
    commentGraphParents: Object.values(comments).filter((row) =>
      Number(row?.comment_ID) === commentGraphParentId
      && Number(row?.comment_post_ID) === commentGraphPostId
      && Number(row?.comment_parent) === 0
      && String(row?.comment_agent || '') === commentGraphAgent).length,
    commentGraphChildren: Object.values(comments).filter((row) =>
      Number(row?.comment_ID) === commentGraphChildId
      && Number(row?.comment_post_ID) === commentGraphPostId
      && Number(row?.comment_parent) === commentGraphParentId
      && String(row?.comment_agent || '') === commentGraphAgent).length,
    commentGraphCommentmeta: Object.values(commentmeta).filter((row) =>
      Number(row?.meta_id) === commentGraphMetaId
      && Number(row?.comment_id) === commentGraphChildId
      && String(row?.meta_key || '') === commentGraphMetaKey).length,
    files: Object.keys(files).length,
    complexFiles: Object.keys(files).filter((file) =>
      file.startsWith('wp-content/uploads/reprint-push/brewcommerce-complex-')).length,
    formsLabRows: Object.keys(formsLab).length,
    releaseStateRows: Object.keys(releaseState).length,
    pluginOwnedResources: snapshot?.meta?.pluginOwnedResources?.allowedResources?.length || 0,
    formsFixtureOption: options[`option_name:${formsFixtureOption}`] ? 'present' : 'missing',
  };
}

function snapshotMeetsComplexShape(snapshot, shape) {
  const counts = summarizeComplexSnapshot(snapshot);
  return counts.complexPosts >= positiveInt(shape.postCount)
    && counts.complexSchemaMeta >= positiveInt(shape.schemaMetaCount)
    && counts.complexFiles >= positiveInt(shape.fileCount)
    && counts.formsLabRows >= positiveInt(shape.formsLabRows)
    && counts.releaseStateRows >= 1
    && counts.formsFixtureOption === 'present';
}

function summarizePlan(plan) {
  return {
    status: plan.status,
    mutations: plan.mutations?.length || 0,
    preconditions: plan.preconditions?.length || 0,
    conflicts: plan.conflicts?.length || 0,
    blockers: plan.blockers?.length || 0,
    decisions: plan.decisions?.length || 0,
  };
}

function countMutationFamilies(mutations) {
  const families = {};
  for (const mutation of mutations) {
    const family = mutation.resource?.type === 'row'
      ? `row:${mutation.resource.table}`
      : mutation.resource?.type || 'unknown';
    families[family] = (families[family] || 0) + 1;
  }
  return families;
}

function findJsonObjectEnd(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function positiveInt(value) {
  const number = Number.parseInt(String(value), 10);
  assert.ok(Number.isInteger(number) && number > 0, `Expected positive integer, got ${value}`);
  return number;
}

function positiveEnvInt(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return fallback;
  }
  return positiveInt(value);
}

function phpString(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}
