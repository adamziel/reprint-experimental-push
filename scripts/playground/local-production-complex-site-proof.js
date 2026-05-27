import assert from 'node:assert/strict';

import { createPushPlan } from '../../src/planner.js';

export const complexSiteFixtureShape = Object.freeze({
  postCount: 12,
  schemaMetaCount: 5,
  fileCount: 3,
  formsLabRows: 4,
  remoteDriftPosts: 3,
  remoteDriftFiles: 1,
  featuredImageGraph: false,
});

const proofNow = new Date('2026-05-27T21:45:00.000Z');
const formsFixtureOption = 'reprint_push_forms_fixture';
const featuredImagePostId = 71001;
const featuredImageAttachmentId = 71901;
const featuredImageAttachmentSlug = 'brewcommerce-featured-attachment';
const featuredImageMetaKey = '_thumbnail_id';
const featuredImageAttachmentResourceKey = `row:["wp_posts","ID:${featuredImageAttachmentId}"]`;
const featuredImageMetaResourceKey = `row:["wp_postmeta","post_id:${featuredImagePostId}:meta_key:${featuredImageMetaKey}"]`;

export function complexSiteFixtureShapeFromEnv(env = process.env) {
  return Object.freeze({
    postCount: positiveEnvInt(env.REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_POST_COUNT, complexSiteFixtureShape.postCount),
    schemaMetaCount: positiveEnvInt(env.REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_SCHEMA_META_COUNT, complexSiteFixtureShape.schemaMetaCount),
    fileCount: positiveEnvInt(env.REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_FILE_COUNT, complexSiteFixtureShape.fileCount),
    formsLabRows: positiveEnvInt(env.REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_FORMS_ROWS, complexSiteFixtureShape.formsLabRows),
    remoteDriftPosts: positiveEnvInt(env.REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_REMOTE_DRIFT_POSTS, complexSiteFixtureShape.remoteDriftPosts),
    remoteDriftFiles: positiveEnvInt(env.REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_REMOTE_DRIFT_FILES, complexSiteFixtureShape.remoteDriftFiles),
    featuredImageGraph: env.REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_GRAPH_PROOF === '1',
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
  const expectedMinimumReadyMutations =
    positiveInt(shape.postCount)
    + positiveInt(shape.schemaMetaCount)
    + positiveInt(shape.fileCount)
    + 2
    + (shape.featuredImageGraph ? 2 : 0);
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
  const receiptHash = dryRun.receiptHash || dryRun.receipt?.receiptHash || '';
  const journal = releaseSummary?.durableJournal || {};
  const boundary = releaseSummary?.boundary || {};
  const authSessionBoundary = releaseSummary?.authSessionBoundary || {};
  const applyRevalidation = apply.applyRevalidation || {};
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
        preconditions: Array.isArray(planObject.preconditions) ? planObject.preconditions.length : null,
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
