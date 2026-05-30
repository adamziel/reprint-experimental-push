import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routeSourcePath = path.join(repoRoot, 'scripts/playground/push-remote-rest-plugin.php');
const routeSource = readFileSync(routeSourcePath, 'utf8');
const liveSmokeSourcePath = path.join(repoRoot, 'scripts/playground/production-recovery-mutate-auth-smoke.mjs');
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

function assertNoJsonParsing(body, label) {
  assert.doesNotMatch(body, /reprint_push_lab_rest_json_payload\(\$request\)/, `${label} must not call JSON payload parsing`);
  assert.doesNotMatch(body, /get_json_params\(\)/, `${label} must not call WP_REST_Request JSON parsing`);
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

test('RPP-0527 recovery mutate negative auth floor fails before JSON parsing or mutation', () => {
  const productionRoute = routeRegistration(
    'REPRINT_PUSH_PRODUCTION_SHAPED_REST_NAMESPACE',
    '/push/recovery/mutate',
  );
  const permission = functionBody('reprint_push_lab_rest_authenticated_permission');
  const callback = functionBody('reprint_push_lab_rest_authenticated_recovery_mutate');
  const requireSigned = functionBody('reprint_push_lab_rest_require_signed_request');
  const verifier = functionBody('reprint_push_lab_rest_verify_signed_request');
  const status = functionBody('reprint_push_lab_rest_status_for_result');

  assert.match(productionRoute, /'callback'\s*=>\s*'reprint_push_lab_rest_authenticated_recovery_mutate'/);
  assert.match(productionRoute, /'permission_callback'\s*=>\s*'reprint_push_lab_rest_authenticated_permission'/);

  assert.match(permission, /reprint_push_lab_rest_basic_auth_context\(\$request\)/);
  assert.match(permission, /new WP_Error\(\s*'reprint_push_lab_auth_required'/);
  assert.match(permission, /'status'\s*=>\s*401/);
  assert.match(permission, /new WP_Error\(\s*'reprint_push_lab_forbidden'/);
  assert.match(permission, /'status'\s*=>\s*403/);
  assertNoJsonParsing(permission, 'permission callback');
  assertNoKnownMutationCalls(permission);

  assertBefore(
    callback,
    "reprint_push_lab_rest_require_signed_request($request, 'recovery-mutate')",
    'reprint_push_lab_rest_recovery_mutate($request)',
  );
  assertBefore(callback, 'return $signature_error;', 'reprint_push_lab_rest_recovery_mutate($request)');
  assertNoJsonParsing(callback, 'authenticated recovery mutate callback');
  assertNoKnownMutationCalls(callback);

  assertBefore(
    requireSigned,
    'reprint_push_lab_rest_verify_signed_request($request, $mode)',
    'reprint_push_lab_rest_set_signature_context',
  );
  assertBefore(
    requireSigned,
    "return reprint_push_lab_rest_json_response($result + ['mode' => $mode]);",
    'reprint_push_lab_rest_set_signature_context',
  );
  assertNoJsonParsing(requireSigned, 'signed request guard');

  for (const code of [
    'SIGNED_HEADER_REQUIRED',
    'SIGNED_CONTENT_HASH_MISMATCH',
    'SIGNED_AUTH_SIGNATURE_MISMATCH',
    'SIGNED_SESSION_REQUIRED',
    'MISSING_IDEMPOTENCY_KEY',
  ]) {
    assert.match(verifier, new RegExp(`'${code}'`));
    assert.match(status, new RegExp(`case '${code}':`));
    assertBefore(verifier, `'${code}'`, 'reprint_push_lab_rest_claim_signed_nonce');
  }
  assertBefore(verifier, '$raw_body = (string) $request->get_body();', "$actual_content_hash = hash('sha256', $raw_body)");
  assertNoJsonParsing(verifier, 'signed request verifier');
});

test('RPP-0527 live smoke covers malformed JSON negative auth cases on the production recovery mutate route', () => {
  assert.match(liveSmokeSource, /const endpointPath = '\/wp-json\/reprint\/v1\/push\/recovery\/mutate';/);
  assert.match(liveSmokeSource, /const routeIndexPath = '\/reprint\/v1\/push\/recovery\/mutate';/);
  assert.match(liveSmokeSource, /const malformedJsonBody = '\{"plan":';/);
  assert.match(liveSmokeSource, /const malformedJsonBodyContentType = 'text\/plain';/);
  assert.match(liveSmokeSource, /WordPress core rejects invalid JSON before route permission callbacks run/);
  assert.match(liveSmokeSource, /assertRoute\(index\.body, routeIndexPath, 'POST'\)/);

  assert.match(liveSmokeSource, /assert\.equal\(unauthenticated\.body\?\.code, 'reprint_push_lab_auth_required'\)/);
  assert.match(liveSmokeSource, /assert\.equal\(missingSignedHeaders\.body\?\.code, 'SIGNED_HEADER_REQUIRED'\)/);
  assert.match(liveSmokeSource, /assert\.equal\(contentHashMismatch\.body\?\.code, 'SIGNED_CONTENT_HASH_MISMATCH'\)/);
  assert.match(liveSmokeSource, /assert\.equal\(authSignatureMismatch\.body\?\.code, 'SIGNED_AUTH_SIGNATURE_MISMATCH'\)/);
  assert.match(liveSmokeSource, /assertNotJsonParseFailure\(unauthenticated, 'unauthenticated recovery mutate'\)/);
  assert.match(liveSmokeSource, /assertNotJsonParseFailure\(authSignatureMismatch, 'auth-signature mismatch recovery mutate'\)/);

  assert.match(liveSmokeSource, /assertTargetSurfaceEqual\(/);
  assert.match(liveSmokeSource, /mutationAttempted: false/);
  assert.match(liveSmokeSource, /host: '127\.0\.0\.1'/);
  assert.match(liveSmokeSource, /port: 'ephemeral'/);
  assert.match(liveSmokeSource, /exposure: 'sandbox-local-loopback-only'/);
  assert.match(liveSmokeSource, /tunnel: 'none'/);
  assert.match(liveSmokeSource, /http\.Server\.prototype\.listen = function reprintPushLocalhostListen/);
  assert.doesNotMatch(liveSmokeSource, /\b(?:ngrok|cloudflared|localtunnel|serveo|localhost\.run|lhr\.life|Tailscale Funnel)\b/i);
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
