import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routeSourcePath = path.join(repoRoot, 'scripts/playground/push-remote-rest-plugin.php');
const routeSource = readFileSync(routeSourcePath, 'utf8');
const protocolSourcePath = path.join(repoRoot, 'scripts/playground/push-remote-lib.php');
const protocolSource = readFileSync(protocolSourcePath, 'utf8');
const snapshotSourcePath = path.join(repoRoot, 'scripts/playground/snapshot-lib.php');
const snapshotSource = readFileSync(snapshotSourcePath, 'utf8');
const dbJournalLibSourcePath = path.join(repoRoot, 'scripts/playground/push-db-journal-lib.php');
const dbJournalLibSource = readFileSync(dbJournalLibSourcePath, 'utf8');
const liveSmokeSourcePath = path.join(repoRoot, 'scripts/playground/production-apply-route-live-smoke.mjs');
const liveSmokeSource = readFileSync(liveSmokeSourcePath, 'utf8');

function functionBodyFromSource(source, name) {
  const declaration = `function ${name}`;
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `missing ${declaration}`);
  const open = source.indexOf('{', start);
  assert.notEqual(open, -1, `missing body for ${declaration}`);

  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(open + 1, index);
      }
    }
  }

  assert.fail(`unterminated body for ${declaration}`);
}

function functionBody(name) {
  return functionBodyFromSource(routeSource, name);
}

function protocolFunctionBody(name) {
  return functionBodyFromSource(protocolSource, name);
}

function routeRegistration(namespace, route) {
  const startNeedle = `register_rest_route(${namespace}, '${route}', [`;
  const start = routeSource.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing route registration ${namespace} ${route}`);
  const end = routeSource.indexOf('    ]);', start);
  assert.notEqual(end, -1, `missing end for route registration ${namespace} ${route}`);
  return routeSource.slice(start, end + '    ]);'.length);
}

function assertBefore(body, first, second) {
  const firstIndex = body.indexOf(first);
  const secondIndex = body.indexOf(second);
  assert.notEqual(firstIndex, -1, `missing ${first}`);
  assert.notEqual(secondIndex, -1, `missing ${second}`);
  assert.ok(firstIndex < secondIndex, `${first} must appear before ${second}`);
}

function sourceSlice(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing ${startNeedle}`);
  const end = source.indexOf(endNeedle, start);
  assert.notEqual(end, -1, `missing ${endNeedle} after ${startNeedle}`);
  return source.slice(start, end);
}

test('production apply route is a signed POST route behind authenticated permission', () => {
  const productionRoute = routeRegistration(
    'REPRINT_PUSH_PRODUCTION_SHAPED_REST_NAMESPACE',
    '/push/apply',
  );
  assert.match(productionRoute, /'methods'\s*=>\s*WP_REST_Server::CREATABLE/);
  assert.match(productionRoute, /'callback'\s*=>\s*'reprint_push_lab_rest_authenticated_apply'/);
  assert.match(productionRoute, /'permission_callback'\s*=>\s*'reprint_push_lab_rest_authenticated_permission'/);

  const labAuthenticatedRoute = routeRegistration(
    'REPRINT_PUSH_LAB_REST_NAMESPACE',
    '/authenticated/apply',
  );
  assert.match(labAuthenticatedRoute, /'permission_callback'\s*=>\s*'reprint_push_lab_rest_authenticated_permission'/);
});

test('production apply rejects unsigned requests before parsing JSON plans', () => {
  const callback = functionBody('reprint_push_lab_rest_authenticated_apply');

  assertBefore(
    callback,
    "reprint_push_lab_rest_require_signed_request($request, 'apply')",
    'reprint_push_lab_rest_json_payload($request)',
  );
  assertBefore(callback, 'return $signature_error;', 'reprint_push_lab_rest_json_payload($request)');
  assertBefore(
    callback,
    'reprint_push_lab_rest_validate_authenticated_receipt($request, $payload, $plan, $receipt_payload)',
    'reprint_push_lab_rest_apply_with_db_journal($request, true)',
  );

  const validateReceipt = functionBody('reprint_push_lab_rest_validate_authenticated_receipt');
  assertBefore(
    validateReceipt,
    'reprint_push_lab_rest_validate_authenticated_receipt_signature($request, $receipt)',
    '$expires_at = strtotime',
  );
  assert.match(validateReceipt, /reprint_push_lab_rest_validate_authenticated_receipt_signature\(\$request,\s*\$receipt\)/);

  const validateSignature = functionBody('reprint_push_lab_rest_validate_authenticated_receipt_signature');
  assert.match(validateSignature, /AUTH_RECEIPT_SIGNATURE_REQUIRED/);
  assert.match(validateSignature, /AUTH_RECEIPT_SIGNATURE_INVALID/);
  assert.match(validateSignature, /AUTH_RECEIPT_SIGNATURE_MISMATCH/);
  assert.match(validateSignature, /hash_hmac\('sha256',\s*\$payload_json,\s*\$receipt_signing_key\)/);
  assert.match(validateSignature, /hash\('sha256',\s*\$expected_signature\)/);
  assert.doesNotMatch(validateSignature, /\$wpdb|update_option|reprint_push_protocol_run_payload|reprint_push_apply_resource/);
});

test('production apply maps receipt signature refusals before mutation work', () => {
  const statusForResult = functionBody('reprint_push_lab_rest_status_for_result');

  assert.match(statusForResult, /case 'AUTH_RECEIPT_SIGNATURE_INVALID':\s*return 400;/);
  assert.match(
    statusForResult,
    /case 'AUTH_RECEIPT_SIGNATURE_REQUIRED':\s*case 'AUTH_RECEIPT_SIGNATURE_MISMATCH':\s*case 'ATOMIC_GROUP_DEPENDENCY_INVALID':\s*return 409;/s,
  );
});

test('packaged production apply rejects lab-only controls before journal claim or mutation setup', () => {
  const callback = functionBody('reprint_push_lab_rest_authenticated_apply');
  const applyWithJournal = functionBody('reprint_push_lab_rest_apply_with_db_journal');
  const rejectLabControls = functionBody('reprint_push_lab_rest_reject_packaged_apply_lab_controls');
  const controlKeys = functionBody('reprint_push_lab_rest_packaged_apply_lab_control_keys');
  const statusForResult = functionBody('reprint_push_lab_rest_status_for_result');

  assertBefore(
    callback,
    'reprint_push_lab_rest_json_payload($request)',
    'reprint_push_lab_rest_reject_packaged_apply_lab_controls($request, $payload)',
  );
  assertBefore(
    callback,
    'reprint_push_lab_rest_reject_packaged_apply_lab_controls($request, $payload)',
    "reprint_push_lab_rest_plan_payload($payload, 'apply')",
  );
  assertBefore(
    callback,
    'reprint_push_lab_rest_reject_packaged_apply_lab_controls($request, $payload)',
    'reprint_push_lab_rest_apply_with_db_journal($request, true)',
  );

  assertBefore(
    applyWithJournal,
    'reprint_push_lab_rest_json_payload($request)',
    'reprint_push_lab_rest_reject_packaged_apply_lab_controls($request, $payload)',
  );
  assertBefore(
    applyWithJournal,
    'reprint_push_lab_rest_reject_packaged_apply_lab_controls($request, $payload)',
    'reprint_push_lab_rest_db_journal_context($payload, $idempotency_key, $profile)',
  );
  assertBefore(
    applyWithJournal,
    'reprint_push_lab_rest_reject_packaged_apply_lab_controls($request, $payload)',
    'reprint_push_lab_db_journal_try_open_idempotency',
  );
  assertBefore(
    applyWithJournal,
    'reprint_push_lab_rest_reject_packaged_apply_lab_controls($request, $payload)',
    'reprint_push_lab_rest_run_db_journal_apply',
  );

  assert.match(rejectLabControls, /reprint_push_lab_rest_package_mode_enabled\(\)/);
  assert.match(rejectLabControls, /\(\(\$profile\['labBacked'\]\s*\?\?\s*true\)\s*===\s*false\)/);
  assert.match(rejectLabControls, /'code'\s*=>\s*'PACKAGED_LAB_CONTROL_REJECTED'/);
  assert.match(rejectLabControls, /'mutationAttempted'\s*=>\s*false/);
  assert.match(rejectLabControls, /'rejectedControls'\s*=>\s*\$present/);
  assert.doesNotMatch(rejectLabControls, /reprint_push_lab_db_journal_try_open_idempotency|reprint_push_protocol_run_payload|reprint_push_apply_resource|wp_update_post|\$wpdb->query/);

  for (const key of [
    'labFailAfterMutations',
    'labDriftAfterPrepared',
    'labDriftBeforeStorageWrite',
    'labSimulateMissingDbCommit',
    'labSimulateStaleClaimAllOld',
    'labSimulateStaleRetryAfterStarted',
    'labSimulateStaleRetryAfterClaim',
    'labOmitDbJournalTargetPlannedRows',
    'labDelayAfterStaleRetryClaimMs',
    'labDelayAfterIdempotencyOpenMs',
    'labDelayAfterDbJournalStartedMs',
  ]) {
    assert.match(controlKeys, new RegExp(`'${key}'`));
  }
  assert.doesNotMatch(controlKeys, /applyBatchSize|apply_batch_size/);
  assert.match(statusForResult, /case 'PACKAGED_LAB_CONTROL_REJECTED':\s*case 'INVALID_PLAN':/);
});

test('packaged production snapshot ignores authenticated lab drift hooks', () => {
  const snapshotDrift = functionBody('reprint_push_lab_rest_maybe_drift_after_authenticated_snapshot');

  assertBefore(
    snapshotDrift,
    'reprint_push_lab_rest_package_mode_enabled()',
    'reprint_push_lab_rest_get_auth_context($request)',
  );
  assertBefore(snapshotDrift, 'return null;', '$mode = (string) $request->get_param');
  assert.doesNotMatch(
    sourceSlice(
      routeSource,
      'if (reprint_push_lab_rest_package_mode_enabled())',
      "if ($mode !== 'post-title')",
    ),
    /wp_update_post|update_option/,
  );
});

test('production apply revalidates live source hashes after claim start and before mutation execution', () => {
  const applyWithJournal = functionBody('reprint_push_lab_rest_run_db_journal_apply');
  const liveRevalidation = functionBody('reprint_push_lab_rest_revalidate_apply_live_source_before_mutation');
  const revalidationEvidence = functionBody('reprint_push_lab_rest_apply_revalidation_evidence');
  const targetPlannedAppend = functionBodyFromSource(
    dbJournalLibSource,
    'reprint_push_lab_db_journal_append_target_planned',
  );

  assertBefore(
    applyWithJournal,
    "reprint_push_lab_db_journal_append_event('apply-started'",
    'reprint_push_lab_rest_revalidate_apply_live_source_before_mutation',
  );
  assertBefore(
    applyWithJournal,
    'reprint_push_lab_rest_revalidate_apply_live_source_before_mutation',
    "reprint_push_protocol_run_payload('apply'",
  );
  assertBefore(
    applyWithJournal,
    "reprint_push_lab_db_journal_append_event('apply-started'",
    'reprint_push_lab_db_journal_append_target_planned',
  );
  assertBefore(
    applyWithJournal,
    'reprint_push_lab_db_journal_append_target_planned',
    'reprint_push_lab_rest_revalidate_apply_live_source_before_mutation',
  );
  assertBefore(
    applyWithJournal,
    'reprint_push_lab_db_journal_append_target_planned',
    "reprint_push_protocol_run_payload('apply'",
  );
  assert.match(applyWithJournal, /foreach\s*\(\s*\$accepted\['recoveryTargets'\]\s+as\s+\$target\s*\)/);

  assert.match(liveRevalidation, /\$current\s*=\s*reprint_push_export_snapshot\(\)/);
  assert.match(liveRevalidation, /reprint_push_protocol_validate_fixture_atomic_dependencies\(\$plan,\s*\$current,\s*\$mutations,\s*\$live_context\)/);
  assert.match(liveRevalidation, /reprint_push_protocol_verify_preconditions\(\s*\$current,\s*\$precondition_entries,\s*\$live_context\s*\)/);
  assert.match(liveRevalidation, /'phase'\s*=>\s*'before-first-mutation'/);
  assert.match(liveRevalidation, /'checkedAgainst'\s*=>\s*'live-remote'/);
  assert.match(liveRevalidation, /'snapshotHash'\s*=>\s*hash\('sha256',\s*reprint_push_stable_json\(\$current\)\)/);

  for (const forbiddenMutationCall of [
    'reprint_push_protocol_run_payload',
    'reprint_push_apply_resource',
    'wp_insert_post',
    'wp_update_post',
    'update_option',
    '$wpdb->insert',
    '$wpdb->update',
    '$wpdb->delete',
  ]) {
    assert.doesNotMatch(liveRevalidation, new RegExp(forbiddenMutationCall.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.match(revalidationEvidence, /\$live_revalidation\s*=\s*isset\(\$accepted\['liveSourceRevalidation'\]/);
  assert.match(revalidationEvidence, /'phase'\s*=>\s*\(string\) \(\$live_revalidation\['phase'\]/);
  assert.match(revalidationEvidence, /'checkedAgainst'\s*=>\s*\(string\) \(\$live_revalidation\['checkedAgainst'\]/);
  assert.match(revalidationEvidence, /'liveSource'\s*=>\s*\[/);

  assert.match(targetPlannedAppend, /reprint_push_lab_db_journal_append_event\('target-planned'/);
  assert.match(targetPlannedAppend, /'operation'\s*=>\s*'db-journal-target-planned'/);
  assert.match(targetPlannedAppend, /'startedCursor'\s*=>\s*\$started_cursor/);
  assert.match(targetPlannedAppend, /'targetHash'\s*=>\s*hash\('sha256',\s*reprint_push_stable_json\(\$safe_target\)\)/);
  assert.match(targetPlannedAppend, /'hashOnly'\s*=>\s*true/);
  assert.match(targetPlannedAppend, /'rawValuesIncluded'\s*=>\s*false/);
});

test('production apply refuses uncovered storage write boundaries before mutation', () => {
  const runPayload = protocolFunctionBody('reprint_push_protocol_run_payload');
  const coverageAssert = protocolFunctionBody('reprint_push_protocol_assert_storage_guard_coverage');
  const coverageClassifier = protocolFunctionBody('reprint_push_protocol_storage_guard_coverage_for_mutation');
  const guardedPostPut = functionBodyFromSource(snapshotSource, 'reprint_push_guarded_put_post_row');
  const guardedPostCreate = functionBodyFromSource(snapshotSource, 'reprint_push_guarded_create_post_row');
  const guardedPostmetaPut = functionBodyFromSource(snapshotSource, 'reprint_push_guarded_put_postmeta_row');
  const guardedPostmetaDelete = functionBodyFromSource(snapshotSource, 'reprint_push_guarded_delete_existing_postmeta_row');
  const guardedPostmetaCreate = functionBodyFromSource(snapshotSource, 'reprint_push_guarded_create_postmeta_row');
  const guardedBlogmetaDelete = functionBodyFromSource(snapshotSource, 'reprint_push_guarded_delete_existing_blogmeta_row');
  const guardedApply = functionBodyFromSource(snapshotSource, 'reprint_push_apply_resource_with_storage_guard');
  const dbJournalMutationEvidence = functionBodyFromSource(
    dbJournalLibSource,
    'reprint_push_lab_db_journal_mutation_evidence',
  );
  const compactDbJournalResult = functionBodyFromSource(
    dbJournalLibSource,
    'reprint_push_lab_db_journal_compact_result',
  );
  const statusForResult = functionBody('reprint_push_lab_rest_status_for_result');

  assertBefore(
    runPayload,
    'reprint_push_protocol_assert_storage_guard_coverage(',
    "'mutation-storage-write-ready'",
  );
  assertBefore(
    runPayload,
    'reprint_push_protocol_assert_storage_guard_coverage(',
    'reprint_push_apply_resource_with_storage_guard(',
  );

  assert.match(coverageAssert, /'code'\s*=>\s*'UNSUPPORTED_STORAGE_GUARD'/);
  assert.match(coverageAssert, /'preconditionCheck'\s*=>\s*'storage-boundary-unsupported'/);
  assert.match(coverageAssert, /'storageGuardCoverage'\s*=>\s*\$coverage/);
  assert.match(coverageAssert, /'mutation-precondition-failed'/);
  assert.doesNotMatch(coverageAssert, /reprint_push_apply_resource|reprint_push_apply_resource_with_storage_guard|wp_update_post|update_option|\$wpdb->query/);

  for (const guardedTable of [
    'wp_posts',
    'wp_options',
    'wp_postmeta',
    'wp_reprint_push_forms_lab',
    'wp_reprint_push_release_state',
    'wp_blogmeta',
  ]) {
    assert.match(coverageClassifier, new RegExp(`'${guardedTable}'`));
  }
  for (const unsupportedTable of [
    'wp_terms',
    'wp_term_taxonomy',
    'wp_term_relationships',
    'wp_termmeta',
    'wp_comments',
    'wp_commentmeta',
  ]) {
    assert.doesNotMatch(coverageClassifier, new RegExp(`'${unsupportedTable}'`));
  }
  assert.match(coverageClassifier, /'resolutionPolicy'\s*=>\s*'preserve-remote-state-and-stop'/);
  assert.match(coverageClassifier, /'mutationAttempted'\s*=>\s*false/);
  assert.match(coverageClassifier, /\$covered_post_insert\s*=\s*!\$is_delete[\s\S]*\$table === 'wp_posts'/);
  assert.match(coverageClassifier, /\$covered_postmeta_insert\s*=\s*!\$is_delete[\s\S]*\$table === 'wp_postmeta'/);
  assert.match(coverageClassifier, /\$covered_postmeta_delete\s*=\s*\$is_delete[\s\S]*\$table === 'wp_postmeta'/);
  assert.match(coverageClassifier, /\$covered_blogmeta_delete\s*=\s*\$is_delete[\s\S]*\$table === 'wp_blogmeta'/);
  assert.match(coverageClassifier, /\$covered_update \|\| \$covered_post_insert \|\| \$covered_postmeta_insert \|\| \$covered_postmeta_delete \|\| \$covered_blogmeta_put \|\| \$covered_blogmeta_delete/);
  assert.match(coverageClassifier, /'wpdb-primary-key-insert-cas'/);
  assert.match(coverageClassifier, /'wpdb-named-lock-cas'/);
  assert.match(coverageClassifier, /'row-write-has-no-storage-guard'/);
  assert.match(coverageClassifier, /'resource-type-has-no-storage-guard'/);
  assert.doesNotMatch(coverageClassifier, /reprint_push_apply_resource|reprint_push_apply_resource_with_storage_guard|wp_update_post|update_option|\$wpdb->query/);

  assert.match(guardedApply, /if \(\$table === 'wp_posts'\) \{\s*return reprint_push_guarded_put_post_row\(/);
  assert.match(guardedApply, /if \(\$table === 'wp_postmeta'\) \{\s*return reprint_push_guarded_put_postmeta_row\(/);
  assert.match(guardedApply, /if \(\$table === 'wp_blogmeta'\) \{\s*return reprint_push_guarded_put_blogmeta_row\(/);
  assert.match(guardedApply, /if \(!empty\(\$payload\['absent'\]\)\) \{[\s\S]*\$table === 'wp_postmeta'[\s\S]*return reprint_push_guarded_delete_existing_postmeta_row\(/);
  assert.match(guardedApply, /if \(!empty\(\$payload\['absent'\]\)\) \{[\s\S]*\$table === 'wp_blogmeta'[\s\S]*return reprint_push_guarded_delete_existing_blogmeta_row\(/);
  assertBefore(
    guardedApply,
    "if (!empty($payload['absent']))",
    "$value = $payload['value'] ?? null",
  );
  assertBefore(
    guardedApply,
    "if ($table === 'wp_postmeta')",
    "if (($expected_resource_value['exists'] ?? false) !== true",
  );
  assertBefore(
    guardedApply,
    "if ($table === 'wp_blogmeta')",
    "if (($expected_resource_value['exists'] ?? false) !== true",
  );
  assert.match(guardedPostPut, /reprint_push_guarded_update_existing_post_row/);
  assert.match(guardedPostPut, /reprint_push_guarded_create_post_row/);
  assert.match(guardedPostCreate, /SELECT absent wp_posts\.ID; INSERT wp_posts by primary key; add fixture marker/);
  assert.match(guardedPostCreate, /\$wpdb->insert\(\s*\$wpdb->posts,/);
  assert.match(guardedPostCreate, /'wpdb-primary-key-insert-cas'/);
  assert.match(guardedPostCreate, /add_post_meta\(\$post_id,\s*'reprint_push_fixture'/);
  assert.match(guardedPostCreate, /reprint_push_storage_guard_result\('wp-post',\s*'wp_posts',\s*\$wpdb->posts,\s*'insert'/);
  assert.doesNotMatch(guardedPostCreate, /wp_insert_post|wp_update_post/);
  assert.match(guardedPostmetaPut, /reprint_push_guarded_update_existing_postmeta_row/);
  assert.match(guardedPostmetaPut, /reprint_push_guarded_create_postmeta_row/);
  assert.match(guardedPostmetaCreate, /GET_LOCK wp_postmeta row id; verify parent fixture marker; verify row absent; insert row; RELEASE_LOCK/);
  assert.match(guardedPostmetaCreate, /reprint_push_fixture_marker_storage_row\(\$post_id\)/);
  assert.match(guardedPostmetaCreate, /reprint_push_postmeta_row_count\(\$post_id,\s*\$meta_key\) !== 0/);
  assert.match(guardedPostmetaCreate, /\$wpdb->insert\(\s*\$wpdb->postmeta,/);
  assert.match(guardedPostmetaCreate, /'wpdb-named-lock-cas'/);
  assert.match(guardedPostmetaCreate, /reprint_push_storage_guard_result\('wp-postmeta',\s*'wp_postmeta',\s*\$wpdb->postmeta,\s*'insert'/);
  assert.match(guardedPostmetaDelete, /DELETE FROM \{\$table\} WHERE post_id = %d AND meta_key = %s AND meta_value = %s/);
  assert.match(guardedPostmetaDelete, /reprint_push_guard_postmeta_count\) = 1/);
  assert.match(guardedPostmetaDelete, /reprint_push_guard_parent_marker_count\) >= 1/);
  assert.match(guardedPostmetaDelete, /reprint_push_storage_guard_result\('wp-postmeta',\s*'wp_postmeta',\s*\$wpdb->postmeta,\s*'delete'/);
  assert.doesNotMatch(guardedPostmetaDelete, /delete_post_meta|wp_delete_post/);
  assert.match(guardedBlogmetaDelete, /DELETE FROM \{\$table\} WHERE blog_id = %d AND meta_key = %s AND meta_value = %s/);
  assert.match(guardedBlogmetaDelete, /reprint_push_guard_blogmeta_count\) = 1/);
  assert.match(guardedBlogmetaDelete, /reprint_push_guard_parent_blog_marker_count\) >= 1/);
  assert.match(guardedBlogmetaDelete, /reprint_push_storage_guard_result\('wp-blogmeta',\s*'wp_blogmeta',\s*\$table_name,\s*'delete'/);
  assert.doesNotMatch(guardedBlogmetaDelete, /delete_metadata|delete_site_meta|delete_blog_option|wpmu_delete_blog/);

  assert.match(dbJournalMutationEvidence, /\$evidence\['storageGuardCoverage'\]\s*=\s*\$mutation\['storageGuardCoverage'\]/);
  assert.match(compactDbJournalResult, /'storageGuardCoverage'/);
  assert.match(statusForResult, /case 'UNSUPPORTED_STORAGE_GUARD':\s*return 409;/);
});

test('RPP-0524 apply proof uses the real production-shaped route over sandbox-local loopback', () => {
  assert.match(liveSmokeSource, /apply:\s*'\/wp-json\/reprint\/v1\/push\/apply'/);
  assert.match(liveSmokeSource, /apply:\s*'\/reprint\/v1\/push\/apply'/);
  assert.match(liveSmokeSource, /assertRoute\(index\.body, routeIndexPaths\.apply, 'POST'\)/);

  assert.match(liveSmokeSource, /assert\.equal\(noAuthApply\.status, 401, `no-auth production apply HTTP \$\{noAuthApply\.status\}`\)/);
  assert.match(liveSmokeSource, /assert\.equal\(noAuthApply\.body\?\.code, 'reprint_push_lab_auth_required'\)/);
  assert.match(liveSmokeSource, /assertCurrentSurface\(client, snapshots\.base, 'no-auth production apply must not mutate'\)/);
  assert.match(liveSmokeSource, /assert\.equal\(unsignedApply\.status, 401, `unsigned production apply HTTP \$\{unsignedApply\.status\}`\)/);
  assert.match(liveSmokeSource, /assert\.equal\(unsignedApply\.body\?\.code, 'SIGNED_HEADER_REQUIRED'\)/);
  assert.match(liveSmokeSource, /assertCurrentSurface\(client, snapshots\.base, 'unsigned production apply must not mutate'\)/);
  assert.match(liveSmokeSource, /countJournalEvents\(preApplyRows, 'mutation-applied'\), 0/);

  assert.match(
    liveSmokeSource,
    /authenticatedHttpClient\(\{\s+sourceUrl: server\.baseUrl,\s+credential: credentials,\s+routeProfile: 'production-shaped',/s,
  );
  assert.match(liveSmokeSource, /const preflight = await client\.signedGet\('\/preflight'\)/);
  assert.match(liveSmokeSource, /const dryRun = await client\.signedPost\('\/dry-run', \{ plan: readyPlan \}/);
  assert.match(liveSmokeSource, /const apply = await client\.signedPost\('\/apply', applyPayload/);
  assert.match(liveSmokeSource, /assert\.equal\(apply\.status, 200, `production-shaped apply HTTP \$\{apply\.status\}`\)/);
  assert.match(liveSmokeSource, /assert\.equal\(apply\.request\?\.pathname, endpointPaths\.apply\)/);
  assert.match(liveSmokeSource, /assert\.equal\(apply\.body\?\.signedRequest\?\.request\?\.path, endpointPaths\.apply\)/);
  assert.match(liveSmokeSource, /assert\.equal\(apply\.body\?\.auth\?\.session\?\.type, 'production-auth-session'\)/);
  assert.match(liveSmokeSource, /assert\.equal\(apply\.body\?\.applyRevalidation\?\.phase, 'before-first-mutation'\)/);
  assert.match(liveSmokeSource, /assert\.equal\(apply\.body\?\.applyRevalidation\?\.checkedAgainst, 'live-remote'\)/);
  assert.match(liveSmokeSource, /assertVisibleSurfaceEqual\(afterApply\.body\.snapshot, localSnapshot, 'production-shaped apply final source'\)/);

  assert.match(liveSmokeSource, /host: '127\.0\.0\.1'/);
  assert.match(liveSmokeSource, /port: 'ephemeral'/);
  assert.match(liveSmokeSource, /exposure: 'sandbox-local-loopback-only'/);
  assert.match(liveSmokeSource, /tunnel: 'none'/);
  assert.match(liveSmokeSource, /http\.Server\.prototype\.listen = function reprintPushLocalhostListen/);
  assert.doesNotMatch(liveSmokeSource, /\b(?:ngrok|cloudflared|localtunnel|serveo|localhost\.run|lhr\.life|Tailscale Funnel)\b/i);
});

test('RPP-0524 live proof summary reports apply-path success and fail-closed evidence without credentials', () => {
  const summaryInitializer = sourceSlice(liveSmokeSource, 'const summary = {', 'try {');
  assert.match(summaryInitializer, /rpp: 'RPP-0524'/);
  assert.match(summaryInitializer, /routeProfile: 'production-shaped'/);
  assert.match(summaryInitializer, /endpoint: endpointPaths\.apply/);
  assert.match(summaryInitializer, /liveUrl: \{/);
  assert.match(summaryInitializer, /exposure: 'sandbox-local-loopback-only'/);
  assert.match(summaryInitializer, /tunnel: 'none'/);

  const unauthorizedSummary = sourceSlice(liveSmokeSource, 'summary.unauthorized = {', '    summary.preflight = {');
  assert.match(unauthorizedSummary, /noAuth: \{ status: noAuthApply\.status, code: noAuthApply\.body\?\.code \|\| null \}/);
  assert.match(unauthorizedSummary, /unsigned: \{ status: unsignedApply\.status, code: unsignedApply\.body\?\.code \|\| null, mode: unsignedApply\.body\?\.mode \|\| null \}/);
  assert.match(unauthorizedSummary, /mutationEventsBeforeApply: countJournalEvents\(preApplyRows, 'mutation-applied'\)/);
  assert.doesNotMatch(unauthorizedSummary, /authorization|Basic|password|credential/i);

  const applySummary = sourceSlice(liveSmokeSource, 'summary.apply = {', '    summary.final = {');
  assert.match(applySummary, /requestPath: apply\.request\.pathname/);
  assert.match(applySummary, /signedRequestPath: apply\.body\.signedRequest\.request\.path/);
  assert.match(applySummary, /freshMutationWork: apply\.body\.idempotency\.freshMutationWork/);
  assert.match(applySummary, /authSessionType: apply\.body\.auth\.session\.type/);
  assert.match(applySummary, /phase: apply\.body\.applyRevalidation\.phase/);
  assert.match(applySummary, /checkedAgainst: apply\.body\.applyRevalidation\.checkedAgainst/);
  assert.match(applySummary, /snapshotHashLength: String\(apply\.body\.applyRevalidation\.liveSource\.snapshotHash \|\| ''\)\.length/);
  assert.match(applySummary, /sourceHashLength: String\(apply\.body\.applyRevalidation\.liveSource\.sourceHash \|\| ''\)\.length/);
  assert.match(applySummary, /sourceUrlHashLength: String\(apply\.body\.applyRevalidation\.liveSource\.sourceUrlHash \|\| ''\)\.length/);
  assert.doesNotMatch(applySummary, /authorization|Basic|applicationPassword|password|credentialHash|signingKey:|sessionHash:/i);

  const finalSummary = sourceSlice(liveSmokeSource, 'summary.final = {', '    summary.ok = true;');
  assert.match(finalSummary, /finalMatchesLocal: digest\(visibleSurface\(afterApply\.body\.snapshot\)\) === digest\(visibleSurface\(localSnapshot\)\)/);
  assert.match(finalSummary, /mutationApplied: countJournalEvents\(afterRows, 'mutation-applied'\)/);
  assert.match(finalSummary, /journalEvents: \[\.\.\.new Set\(afterRows\.map\(\(entry\) => entry\.event\)\)\]\.sort\(\)/);
  assert.doesNotMatch(finalSummary, /authorization|Basic|password|credential/i);
});
