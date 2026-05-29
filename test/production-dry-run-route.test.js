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

test('production dry-run route is a signed POST route behind authenticated permission', () => {
  const productionRoute = routeRegistration(
    'REPRINT_PUSH_PRODUCTION_SHAPED_REST_NAMESPACE',
    '/push/dry-run',
  );
  assert.match(productionRoute, /'methods'\s*=>\s*WP_REST_Server::CREATABLE/);
  assert.match(productionRoute, /'callback'\s*=>\s*'reprint_push_lab_rest_authenticated_dry_run'/);
  assert.match(productionRoute, /'permission_callback'\s*=>\s*'reprint_push_lab_rest_authenticated_permission'/);

  const labAuthenticatedRoute = routeRegistration(
    'REPRINT_PUSH_LAB_REST_NAMESPACE',
    '/authenticated/dry-run',
  );
  assert.match(labAuthenticatedRoute, /'permission_callback'\s*=>\s*'reprint_push_lab_rest_authenticated_permission'/);
});

test('production dry-run rejects unsigned requests before parsing JSON plans', () => {
  const callback = functionBody('reprint_push_lab_rest_authenticated_dry_run');

  assertBefore(
    callback,
    "reprint_push_lab_rest_require_signed_request($request, 'dry-run')",
    'reprint_push_lab_rest_protocol_response',
  );
  assertBefore(callback, 'return $signature_error;', 'reprint_push_lab_rest_protocol_response');
  assertBefore(callback, 'reprint_push_lab_rest_protocol_response', 'reprint_push_lab_rest_json_payload($request)');
});

test('production dry-run receipts bind scope identity session and plan hash', () => {
  const bindReceipt = functionBody('reprint_push_lab_rest_bind_authenticated_receipt');

  assert.match(bindReceipt, /\$auth\s*=\s*reprint_push_lab_rest_auth_evidence\(\$request\)/);
  assert.match(bindReceipt, /\$plan_payload_hash\s*=\s*hash\('sha256',\s*reprint_push_stable_json\(\$plan\)\)/);
  assert.match(bindReceipt, /'scope'\s*=>\s*\(string\)\s*\$profile\['authScope'\]/);
  assert.match(bindReceipt, /'planHash'\s*=>\s*\$plan_hash/);
  assert.match(bindReceipt, /'binding'\s*=>\s*reprint_push_lab_rest_authenticated_receipt_subject_binding/);
  assert.match(bindReceipt, /'identity'\s*=>\s*\$auth\['identity'\]/);
  assert.match(bindReceipt, /'session'\s*=>\s*\$auth\['session'\]/);
  assert.match(bindReceipt, /'pushSession'\s*=>\s*\[/);
  assert.match(bindReceipt, /'plan'\s*=>\s*\[/);

  const subjectBinding = functionBody('reprint_push_lab_rest_authenticated_receipt_subject_binding');
  assert.match(subjectBinding, /'scopeHash'\s*=>\s*hash\('sha256',\s*\(string\)\s*\(\$profile\['authScope'\]/);
  assert.match(subjectBinding, /'identityHash'\s*=>\s*hash\('sha256',\s*reprint_push_stable_json\(\$identity\)\)/);
  assert.match(subjectBinding, /'authSessionHash'\s*=>\s*hash\('sha256',\s*reprint_push_stable_json\(\$session\)\)/);
  assert.match(subjectBinding, /'pushSessionHash'\s*=>\s*\(string\)\s*\(\$signed_request\['sessionHash'\]/);
  assert.match(subjectBinding, /'planHash'\s*=>\s*\$plan_hash/);
  assert.match(subjectBinding, /'bindingHash'\s*\]\s*=\s*hash\('sha256',\s*reprint_push_stable_json\(\$binding\)\)/);
});

test('authenticated apply validates dry-run receipt subject and plan binding before mutation path', () => {
  const validateReceipt = functionBody('reprint_push_lab_rest_validate_authenticated_receipt');
  const applyCallback = functionBody('reprint_push_lab_rest_authenticated_apply');

  assertBefore(
    applyCallback,
    'reprint_push_lab_rest_validate_authenticated_receipt($request, $payload, $plan, $receipt_payload)',
    'reprint_push_lab_rest_apply_with_db_journal($request, true)',
  );
  assert.match(validateReceipt, /\$expected_plan_hash\s*=\s*hash\('sha256',\s*reprint_push_stable_json\(\$plan\)\)/);
  assert.match(validateReceipt, /Receipt plan hash binding does not match the supplied plan\./);
  assert.match(validateReceipt, /\$plan_binding\s*=\s*isset\(\$binding\['plan'\]/);
  assert.match(validateReceipt, /Receipt plan binding does not match the supplied plan hash\./);
  assert.match(validateReceipt, /\$expected_subject_binding\s*=\s*reprint_push_lab_rest_authenticated_receipt_subject_binding/);
  assert.match(validateReceipt, /Receipt subject binding does not match the current session, identity, scope, and plan hash\./);
  assertBefore(
    validateReceipt,
    '$expected_subject_binding = reprint_push_lab_rest_authenticated_receipt_subject_binding',
    '$push_session = isset($binding[\'pushSession\'])',
  );
});
