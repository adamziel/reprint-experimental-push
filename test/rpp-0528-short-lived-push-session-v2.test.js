import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routeSourcePath = path.join(repoRoot, 'scripts/playground/push-remote-rest-plugin.php');
const routeSmokePath = path.join(repoRoot, 'scripts/playground/production-shaped-route-smoke.mjs');

const routeSource = readFileSync(routeSourcePath, 'utf8');
const routeSmokeSource = readFileSync(routeSmokePath, 'utf8');

function functionBody(source, name, { afterParameters = false } = {}) {
  const declaration = `function ${name}`;
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `missing ${declaration}`);
  const jsBodyStart = afterParameters ? source.indexOf(') {', start) : -1;
  const open = jsBodyStart === -1 ? source.indexOf('{', start) : jsBodyStart + 2;
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

function phpFunctionBody(name) {
  return functionBody(routeSource, name);
}

function jsFunctionBody(name) {
  return functionBody(routeSmokeSource, name, { afterParameters: true });
}

function assertBefore(body, first, second) {
  const firstIndex = body.indexOf(first);
  const secondIndex = body.indexOf(second);
  assert.notEqual(firstIndex, -1, `missing ${first}`);
  assert.notEqual(secondIndex, -1, `missing ${second}`);
  assert.ok(firstIndex < secondIndex, `${first} must appear before ${second}`);
}

test('RPP-0528 production-shaped preflight issues a bounded short-lived push session', () => {
  const verifySignedRequest = phpFunctionBody('reprint_push_lab_rest_verify_signed_request');
  const mintSession = phpFunctionBody('reprint_push_lab_rest_mint_signed_session');
  const signedSession = phpFunctionBody('reprint_push_lab_rest_signed_session');
  const preflight = phpFunctionBody('reprint_push_lab_rest_authenticated_preflight');

  assert.match(routeSource, /const REPRINT_PUSH_LAB_SIGNED_SESSION_TTL = 300;/);
  assert.match(verifySignedRequest, /'SIGNED_PREFLIGHT_SESSION_REJECTED'/);
  assert.match(verifySignedRequest, /'SIGNED_SESSION_REQUIRED'/);
  assertBefore(
    verifySignedRequest,
    '$current_source = reprint_push_lab_rest_source_identity($request);',
    '$session = reprint_push_lab_rest_signed_session($session_id);',
  );
  assertBefore(
    verifySignedRequest,
    "|| (string) ($session['scope'] ?? '') !== REPRINT_PUSH_LAB_AUTH_SCOPE",
    '$canonical = reprint_push_lab_rest_push_canonical_string',
  );
  assertBefore(
    verifySignedRequest,
    '$session = reprint_push_lab_rest_mint_signed_session($auth, $signing_key_hash, $current_source);',
    "'id' => $session_id",
  );

  assert.match(mintSession, /random_bytes\(32\)/);
  assert.match(mintSession, /\$session_hash\s*=\s*hash\('sha256',\s*\$token\)/);
  assert.match(mintSession, /'identityHash'\s*=>\s*reprint_push_lab_rest_signed_identity_hash\(\$auth\)/);
  assert.match(mintSession, /'userIdentityHash'\s*=>\s*reprint_push_lab_rest_signed_user_identity_hash\(\$auth\)/);
  assert.match(mintSession, /'scope'\s*=>\s*REPRINT_PUSH_LAB_AUTH_SCOPE/);
  assert.match(mintSession, /'signingKeyHash'\s*=>\s*\$signing_key_hash/);
  assert.match(mintSession, /'sourceHash'\s*=>\s*\(string\)\s*\(\$source_identity\['sourceHash'\] \?\? ''\)/);
  assert.match(mintSession, /'sourceUrlHash'\s*=>\s*\(string\)\s*\(\$source_identity\['sourceUrlHash'\] \?\? ''\)/);
  assert.match(mintSession, /'expiresAt'\s*=>\s*gmdate\('Y-m-d\\TH:i:s\\Z',\s*\$now \+ REPRINT_PUSH_LAB_SIGNED_SESSION_TTL\)/);
  assert.match(mintSession, /add_option\(reprint_push_lab_rest_signed_session_option\(\$session_hash\),\s*\$session,\s*'',\s*'no'\)/);
  assert.match(mintSession, /\$session\['id'\]\s*=\s*\$token/);

  assert.match(signedSession, /\$session_hash\s*=\s*hash\('sha256',\s*\$session_id\)/);
  assert.match(signedSession, /get_option\(reprint_push_lab_rest_signed_session_option\(\$session_hash\),\s*null\)/);
  assert.match(signedSession, /delete_option\(reprint_push_lab_rest_signed_session_option\(\$session_hash\)\)/);
  assert.match(preflight, /'type'\s*=>\s*\$session_type/);
  assert.match(preflight, /'sessionTtlSeconds'\s*=>\s*REPRINT_PUSH_LAB_SIGNED_SESSION_TTL/);
});

test('RPP-0528 dry-run receipts bind authenticated scope identity session and plan hash', () => {
  const dryRun = phpFunctionBody('reprint_push_lab_rest_authenticated_dry_run');
  const bindReceipt = phpFunctionBody('reprint_push_lab_rest_bind_authenticated_receipt');
  const subjectBinding = phpFunctionBody('reprint_push_lab_rest_authenticated_receipt_subject_binding');
  const issueBinding = phpFunctionBody('reprint_push_lab_rest_authenticated_push_session_issue_binding');

  assertBefore(
    dryRun,
    "reprint_push_lab_rest_require_signed_request($request, 'dry-run')",
    'reprint_push_lab_rest_protocol_response',
  );
  assertBefore(dryRun, 'return $signature_error;', 'reprint_push_lab_rest_protocol_response');
  assertBefore(
    dryRun,
    'reprint_push_lab_rest_protocol_response',
    'reprint_push_lab_rest_bind_authenticated_receipt',
  );

  assert.match(bindReceipt, /\$signed_request\s*=\s*reprint_push_lab_rest_signed_request_evidence\(\$request\)/);
  assert.match(bindReceipt, /\$profile\s*=\s*reprint_push_lab_rest_route_profile\(\$request\)/);
  assert.match(bindReceipt, /\$auth\s*=\s*reprint_push_lab_rest_auth_evidence\(\$request\)/);
  assert.match(bindReceipt, /\$plan_payload_hash\s*=\s*hash\('sha256',\s*reprint_push_stable_json\(\$plan\)\)/);
  assert.match(bindReceipt, /'scope'\s*=>\s*\(string\)\s*\$profile\['authScope'\]/);
  assert.match(bindReceipt, /'planHash'\s*=>\s*\$plan_hash/);
  assert.match(bindReceipt, /'binding'\s*=>\s*reprint_push_lab_rest_authenticated_receipt_subject_binding/);
  assert.match(bindReceipt, /'identity'\s*=>\s*\$auth\['identity'\]/);
  assert.match(bindReceipt, /'session'\s*=>\s*\$auth\['session'\]/);
  assert.match(bindReceipt, /'pushSession'\s*=>\s*\[/);
  assert.match(bindReceipt, /'issue'\s*=>\s*reprint_push_lab_rest_authenticated_push_session_issue_binding/);
  assert.match(bindReceipt, /'plan'\s*=>\s*\[/);
  assert.match(bindReceipt, /unset\(\$receipt\['receiptHash'\]\)/);
  assert.match(bindReceipt, /\$receipt\['receiptHash'\]\s*=\s*hash\('sha256',\s*reprint_push_stable_json\(\$receipt\)\)/);

  assert.match(subjectBinding, /'scopeHash'\s*=>\s*hash\('sha256',\s*\(string\)\s*\(\$profile\['authScope'\] \?\? ''\)\)/);
  assert.match(subjectBinding, /'identityHash'\s*=>\s*hash\('sha256',\s*reprint_push_stable_json\(\$identity\)\)/);
  assert.match(subjectBinding, /'authSessionHash'\s*=>\s*hash\('sha256',\s*reprint_push_stable_json\(\$session\)\)/);
  assert.match(subjectBinding, /'pushSessionHash'\s*=>\s*\(string\)\s*\(\$signed_request\['sessionHash'\] \?\? ''\)/);
  assert.match(subjectBinding, /'planHash'\s*=>\s*\$plan_hash/);
  assert.match(subjectBinding, /\$binding\['bindingHash'\]\s*=\s*hash\('sha256',\s*reprint_push_stable_json\(\$binding\)\)/);

  assert.match(issueBinding, /'type'\s*=>\s*'short-lived-push-session'/);
  assert.match(issueBinding, /'sessionHash'\s*=>\s*\(string\)\s*\(\$session\['sessionHash'\] \?\? \$signed_request\['sessionHash'\] \?\? ''\)/);
  assert.match(issueBinding, /'signingKeyHash'\s*=>\s*\(string\)\s*\(\$signed_request\['signingKeyHash'\] \?\? ''\)/);
  assert.match(issueBinding, /'scopeHash'\s*=>\s*hash\('sha256',\s*\(string\)\s*\(\$profile\['authScope'\] \?\? ''\)\)/);
  assert.match(issueBinding, /'identityHash'\s*=>\s*hash\('sha256',\s*reprint_push_stable_json\(\$identity\)\)/);
  assert.match(issueBinding, /'userIdentityHash'\s*=>\s*\(string\)\s*\(\$session\['userIdentityHash'\] \?\? ''\)/);
  assert.match(issueBinding, /'ttlSeconds'\s*=>\s*REPRINT_PUSH_LAB_SIGNED_SESSION_TTL/);
  assert.match(issueBinding, /\$issue\['issueHash'\]\s*=\s*hash\('sha256',\s*reprint_push_stable_json\(\$issue\)\)/);
});

test('RPP-0528 apply recomputes dry-run subject and issue bindings before mutation', () => {
  const validateReceipt = phpFunctionBody('reprint_push_lab_rest_validate_authenticated_receipt');
  const apply = phpFunctionBody('reprint_push_lab_rest_authenticated_apply');

  assertBefore(
    apply,
    'reprint_push_lab_rest_validate_authenticated_receipt($request, $payload, $plan, $receipt_payload)',
    'reprint_push_lab_rest_apply_with_db_journal($request, true)',
  );
  assert.match(validateReceipt, /\$expected_plan_hash\s*=\s*hash\('sha256',\s*reprint_push_stable_json\(\$plan\)\)/);
  assert.match(validateReceipt, /\$expected_subject_binding\s*=\s*reprint_push_lab_rest_authenticated_receipt_subject_binding/);
  assert.match(validateReceipt, /Receipt subject binding does not match the current session, identity, scope, and plan hash\./);
  assert.match(validateReceipt, /\$expected_issue_binding\s*=\s*reprint_push_lab_rest_authenticated_push_session_issue_binding/);
  assert.match(validateReceipt, /Receipt short-lived push session issue binding does not match the current request\./);
  assert.match(validateReceipt, /Production-shaped apply must reuse the dry-run receipt idempotency binding\./);
  assertBefore(
    validateReceipt,
    '$expected_subject_binding = reprint_push_lab_rest_authenticated_receipt_subject_binding',
    '$push_session = isset($binding[\'pushSession\'])',
  );
  assertBefore(
    validateReceipt,
    '$expected_issue_binding = reprint_push_lab_rest_authenticated_push_session_issue_binding',
    'Receipt dry-run body binding is incomplete.',
  );
});

test('RPP-0528 route smoke exercises live production-shaped dry-run receipt binding', () => {
  const smokeBinding = jsFunctionBody('assertProductionDryRunReceiptBinding');

  assert.match(routeSmokeSource, /const dryRunReceiptBinding = assertProductionDryRunReceiptBinding\(dryRun\.body\.receipt, \{/);
  assert.match(routeSmokeSource, /binding: dryRunReceiptBinding/);
  assert.match(smokeBinding, /const planHash = digest\(plan\)/);
  assert.match(smokeBinding, /assert\.equal\(authBinding\.scope, 'reprint-push-lab:authenticated-http-push'\)/);
  assert.match(smokeBinding, /assert\.equal\(authBinding\.planHash, planHash\)/);
  assert.match(smokeBinding, /assert\.equal\(authBinding\.identity\.userLogin, credentials\.username\)/);
  assert.match(smokeBinding, /assert\.equal\(authBinding\.session\.id, session\)/);
  assert.match(smokeBinding, /assert\.equal\(pushSession\.sessionHash, preflight\.session\.sessionHash\)/);
  assert.match(smokeBinding, /assert\.equal\(pushSession\.dryRunIdempotencyKeyHash, sha256\(idempotencyKey\)\)/);
  assert.match(smokeBinding, /assert\.equal\(issue\.type, 'short-lived-push-session'\)/);
  assert.match(smokeBinding, /assert\.equal\(issue\.sessionHash, pushSession\.sessionHash\)/);
  assert.match(smokeBinding, /assert\.equal\(issue\.identityHash, subject\.identityHash\)/);
  assert.match(smokeBinding, /assert\.equal\(issue\.scopeHash, subject\.scopeHash\)/);
  assert.match(smokeBinding, /issueHashLength: String\(issue\.issueHash \|\| ''\)\.length/);
  assert.doesNotMatch(smokeBinding, /authorization|Basic|applicationPassword|password/i);
});
