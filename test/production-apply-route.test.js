import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routeSourcePath = path.join(repoRoot, 'scripts/playground/push-remote-rest-plugin.php');
const routeSource = readFileSync(routeSourcePath, 'utf8');
const liveSmokeSourcePath = path.join(repoRoot, 'scripts/playground/production-apply-route-live-smoke.mjs');
const liveSmokeSource = readFileSync(liveSmokeSourcePath, 'utf8');

function functionBody(name) {
  const declaration = `function ${name}`;
  const start = routeSource.indexOf(declaration);
  assert.notEqual(start, -1, `missing ${declaration}`);
  const open = routeSource.indexOf('{', start);
  assert.notEqual(open, -1, `missing body for ${declaration}`);

  let depth = 0;
  for (let index = open; index < routeSource.length; index += 1) {
    const char = routeSource[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return routeSource.slice(open + 1, index);
      }
    }
  }

  assert.fail(`unterminated body for ${declaration}`);
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
});

test('production apply revalidates live source hashes after claim start and before mutation execution', () => {
  const applyWithJournal = functionBody('reprint_push_lab_rest_run_db_journal_apply');
  const liveRevalidation = functionBody('reprint_push_lab_rest_revalidate_apply_live_source_before_mutation');
  const revalidationEvidence = functionBody('reprint_push_lab_rest_apply_revalidation_evidence');

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
