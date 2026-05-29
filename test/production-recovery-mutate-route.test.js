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

function assertNoKnownMutationCalls(body) {
  for (const forbiddenMutationCall of [
    'reprint_push_protocol_run_payload',
    'reprint_push_lab_rest_apply_with_db_journal',
    'reprint_push_lab_rest_run_db_journal_apply',
    'reprint_push_apply_resource',
    'wp_insert_post',
    'wp_update_post',
    'update_option',
    'delete_option',
    '$wpdb->insert',
    '$wpdb->update',
    '$wpdb->delete',
  ]) {
    assert.doesNotMatch(body, new RegExp(forbiddenMutationCall.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
}

test('production recovery mutate route is a signed POST route behind authenticated permission', () => {
  const productionRoute = routeRegistration(
    'REPRINT_PUSH_PRODUCTION_SHAPED_REST_NAMESPACE',
    '/push/recovery/mutate',
  );
  assert.match(productionRoute, /'methods'\s*=>\s*WP_REST_Server::CREATABLE/);
  assert.match(productionRoute, /'callback'\s*=>\s*'reprint_push_lab_rest_authenticated_recovery_mutate'/);
  assert.match(productionRoute, /'permission_callback'\s*=>\s*'reprint_push_lab_rest_authenticated_permission'/);

  const labAuthenticatedRoute = routeRegistration(
    'REPRINT_PUSH_LAB_REST_NAMESPACE',
    '/authenticated/recovery/mutate',
  );
  assert.match(labAuthenticatedRoute, /'permission_callback'\s*=>\s*'reprint_push_lab_rest_authenticated_permission'/);

  const repairAlias = routeRegistration(
    'REPRINT_PUSH_PRODUCTION_SHAPED_REST_NAMESPACE',
    '/push/recovery/repair',
  );
  assert.match(repairAlias, /'callback'\s*=>\s*'reprint_push_lab_rest_authenticated_recovery_mutate'/);
  assert.match(repairAlias, /'permission_callback'\s*=>\s*'reprint_push_lab_rest_authenticated_permission'/);
});

test('negative recovery mutate auth and signature cases fail before JSON parsing or mutation', () => {
  const callback = functionBody('reprint_push_lab_rest_authenticated_recovery_mutate');
  const mutate = functionBody('reprint_push_lab_rest_recovery_mutate');
  const boundaryEvidence = functionBody('reprint_push_lab_rest_recovery_mutate_boundary_evidence');

  assertBefore(
    callback,
    "reprint_push_lab_rest_require_signed_request($request, 'recovery-mutate')",
    'reprint_push_lab_rest_recovery_mutate($request)',
  );
  assertBefore(callback, 'return $signature_error;', 'reprint_push_lab_rest_recovery_mutate($request)');
  assert.doesNotMatch(callback, /reprint_push_lab_rest_json_payload\(\$request\)/);

  assertBefore(
    mutate,
    'reprint_push_lab_rest_json_payload($request)',
    'reprint_push_lab_rest_recovery_mutate_plan_payload($payload)',
  );
  assertBefore(mutate, 'reprint_push_protocol_inspect_recovery', 'reprint_push_lab_rest_recovery_mutate_boundary_evidence');
  assert.match(mutate, /'code'\s*=>\s*'RECOVERY_MUTATE_INSPECT_BLOCKED'/);
  assert.match(mutate, /'code'\s*=>\s*'RECOVERY_MUTATE_NOT_IMPLEMENTED'/);
  assert.match(boundaryEvidence, /'inspectFirst'\s*=>\s*true/);
  assert.match(boundaryEvidence, /'mutationAttempted'\s*=>\s*false/);

  assertNoKnownMutationCalls(callback);
  assertNoKnownMutationCalls(mutate);
  assertNoKnownMutationCalls(boundaryEvidence);
});

test('signed auth lifecycle and status mapping explicitly include recovery mutate', () => {
  const signedVerifier = functionBody('reprint_push_lab_rest_verify_signed_request');
  const lifecycle = functionBody('reprint_push_lab_rest_auth_session_lifecycle_step');
  const status = functionBody('reprint_push_lab_rest_status_for_result');

  assert.match(signedVerifier, /signed dry-run, snapshot hashes, apply, recovery inspect, recovery mutate, and journal inspect requests/);
  assertBefore(lifecycle, "str_ends_with($route, '/recovery/inspect')", "str_ends_with($route, '/recovery/mutate')");
  assert.match(lifecycle, /str_ends_with\(\$route, '\/recovery\/repair'\)\s*=>\s*'recovery-mutate'/);
  assert.match(status, /case 'RECOVERY_MUTATE_INSPECT_BLOCKED':\s*return 409;/);
  assert.match(status, /case 'RECOVERY_MUTATE_NOT_IMPLEMENTED':\s*return 501;/);
});
