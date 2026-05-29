import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routeSourcePath = path.join(repoRoot, 'scripts/playground/push-remote-rest-plugin.php');
const routeSource = readFileSync(routeSourcePath, 'utf8');

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
