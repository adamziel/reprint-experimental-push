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

function assertBefore(body, first, second) {
  const firstIndex = body.indexOf(first);
  const secondIndex = body.indexOf(second);
  assert.notEqual(firstIndex, -1, `missing ${first}`);
  assert.notEqual(secondIndex, -1, `missing ${second}`);
  assert.ok(firstIndex < secondIndex, `${first} must appear before ${second}`);
}

test('short-lived push sessions are minted by preflight with a bounded TTL and non-autoloaded store row', () => {
  const verifySignedRequest = functionBody('reprint_push_lab_rest_verify_signed_request');
  const mintSession = functionBody('reprint_push_lab_rest_mint_signed_session');
  const sessionStore = functionBody('reprint_push_lab_rest_authenticated_session_store_evidence');

  assert.match(routeSource, /const REPRINT_PUSH_LAB_SIGNED_SESSION_TTL = 300;/);
  assertBefore(
    verifySignedRequest,
    '$session = reprint_push_lab_rest_mint_signed_session($auth, $signing_key_hash);',
    "'id' => $session_id",
  );
  assert.match(mintSession, /random_bytes\(32\)/);
  assert.match(mintSession, /\$session_hash\s*=\s*hash\('sha256',\s*\$token\)/);
  assert.match(mintSession, /'identityHash'\s*=>\s*reprint_push_lab_rest_signed_identity_hash\(\$auth\)/);
  assert.match(mintSession, /'credentialHash'\s*=>\s*\(string\)\s*\(\$auth\['credentialHash'\]/);
  assert.match(mintSession, /'userId'\s*=>\s*\(int\)\s*\(\$auth\['userId'\]/);
  assert.match(mintSession, /'scope'\s*=>\s*REPRINT_PUSH_LAB_AUTH_SCOPE/);
  assert.match(mintSession, /'signingKeyHash'\s*=>\s*\$signing_key_hash/);
  assert.match(mintSession, /'issuedAt'\s*=>\s*gmdate\('Y-m-d\\TH:i:s\\Z',\s*\$now\)/);
  assert.match(mintSession, /'expiresAt'\s*=>\s*gmdate\('Y-m-d\\TH:i:s\\Z',\s*\$now \+ REPRINT_PUSH_LAB_SIGNED_SESSION_TTL\)/);
  assert.match(mintSession, /'expiresAtUnix'\s*=>\s*\$now \+ REPRINT_PUSH_LAB_SIGNED_SESSION_TTL/);
  assert.match(mintSession, /add_option\(reprint_push_lab_rest_signed_session_option\(\$session_hash\),\s*\$session,\s*'',\s*'no'\)/);
  assert.match(mintSession, /\$session\['id'\]\s*=\s*\$token/);
  assert.match(sessionStore, /'sessionTtlSeconds'\s*=>\s*REPRINT_PUSH_LAB_SIGNED_SESSION_TTL/);
});

test('signed dry-run and apply requests must present an unexpired session bound to identity scope and signing key', () => {
  const verifySignedRequest = functionBody('reprint_push_lab_rest_verify_signed_request');
  const signedSession = functionBody('reprint_push_lab_rest_signed_session');

  assert.match(verifySignedRequest, /'SIGNED_PREFLIGHT_SESSION_REJECTED'/);
  assert.match(verifySignedRequest, /'SIGNED_SESSION_REQUIRED'/);
  assert.match(verifySignedRequest, /'MISSING_IDEMPOTENCY_KEY'/);
  assert.match(verifySignedRequest, /\$session\s*=\s*reprint_push_lab_rest_signed_session\(\$session_id\)/);
  assert.match(verifySignedRequest, /'SIGNED_SESSION_INVALID'/);
  assert.match(verifySignedRequest, /'SIGNED_SESSION_EXPIRED'/);
  assert.match(verifySignedRequest, /'SIGNED_SESSION_BINDING_MISMATCH'/);
  assertBefore(
    verifySignedRequest,
    "|| (string) ($session['scope'] ?? '') !== REPRINT_PUSH_LAB_AUTH_SCOPE",
    '$canonical = reprint_push_lab_rest_push_canonical_string',
  );
  assertBefore(
    verifySignedRequest,
    '$canonical = reprint_push_lab_rest_push_canonical_string',
    'reprint_push_lab_rest_claim_signed_nonce',
  );

  assert.match(signedSession, /\!\s*preg_match\('\/\^\[A-Za-z0-9_-\]\{32,160\}\$\/',\s*\$session_id\)/);
  assert.match(signedSession, /\$session_hash\s*=\s*hash\('sha256',\s*\$session_id\)/);
  assert.match(signedSession, /get_option\(reprint_push_lab_rest_signed_session_option\(\$session_hash\),\s*null\)/);
  assert.match(signedSession, /delete_option\(reprint_push_lab_rest_signed_session_option\(\$session_hash\)\)/);
  assert.match(signedSession, /if \(\(int\) \(\$session\['expiresAtUnix'\] \?\? 0\) < time\(\)\)/);
});

test('dry-run receipts carry an issue binding for session identity scope and plan hash', () => {
  const signedRequestEvidence = functionBody('reprint_push_lab_rest_signed_request_evidence');
  const bindReceipt = functionBody('reprint_push_lab_rest_bind_authenticated_receipt');
  const issueBinding = functionBody('reprint_push_lab_rest_authenticated_push_session_issue_binding');
  const validateReceipt = functionBody('reprint_push_lab_rest_validate_authenticated_receipt');
  const applyCallback = functionBody('reprint_push_lab_rest_authenticated_apply');

  assert.match(signedRequestEvidence, /'type'\s*=>\s*'short-lived-push-session'/);
  assert.match(signedRequestEvidence, /'sessionHash'\s*=>\s*\(string\)\s*\(\$session\['sessionHash'\]/);
  assert.match(signedRequestEvidence, /'issuedAt'\s*=>\s*\(string\)\s*\(\$session\['issuedAt'\]/);
  assert.match(signedRequestEvidence, /'expiresAt'\s*=>\s*\(string\)\s*\(\$session\['expiresAt'\]/);
  assert.match(signedRequestEvidence, /'ttlSeconds'\s*=>\s*REPRINT_PUSH_LAB_SIGNED_SESSION_TTL/);

  assert.match(bindReceipt, /'planHash'\s*=>\s*\$plan_hash/);
  assert.match(bindReceipt, /'identity'\s*=>\s*\$auth\['identity'\]/);
  assert.match(bindReceipt, /'session'\s*=>\s*\$auth\['session'\]/);
  assert.match(bindReceipt, /'pushSession'\s*=>\s*\[/);
  assert.match(bindReceipt, /'issue'\s*=>\s*reprint_push_lab_rest_authenticated_push_session_issue_binding/);
  assert.match(bindReceipt, /'plan'\s*=>\s*\[/);

  assert.match(issueBinding, /'type'\s*=>\s*'short-lived-push-session'/);
  assert.match(issueBinding, /'sessionHash'\s*=>\s*\(string\)\s*\(\$session\['sessionHash'\] \?\? \$signed_request\['sessionHash'\]/);
  assert.match(issueBinding, /'signingKeyHash'\s*=>\s*\(string\)\s*\(\$signed_request\['signingKeyHash'\]/);
  assert.match(issueBinding, /'scopeHash'\s*=>\s*hash\('sha256',\s*\(string\)\s*\(\$profile\['authScope'\]/);
  assert.match(issueBinding, /'identityHash'\s*=>\s*hash\('sha256',\s*reprint_push_stable_json\(\$identity\)\)/);
  assert.match(issueBinding, /'issuedAt'\s*=>\s*\(string\)\s*\(\$session\['issuedAt'\]/);
  assert.match(issueBinding, /'expiresAt'\s*=>\s*\(string\)\s*\(\$session\['expiresAt'\]/);
  assert.match(issueBinding, /'ttlSeconds'\s*=>\s*REPRINT_PUSH_LAB_SIGNED_SESSION_TTL/);
  assert.match(issueBinding, /\$issue\['issueHash'\]\s*=\s*hash\('sha256',\s*reprint_push_stable_json\(\$issue\)\)/);

  assertBefore(
    applyCallback,
    'reprint_push_lab_rest_validate_authenticated_receipt($request, $payload, $plan, $receipt_payload)',
    'reprint_push_lab_rest_apply_with_db_journal($request, true)',
  );
  assert.match(validateReceipt, /\$expected_plan_hash\s*=\s*hash\('sha256',\s*reprint_push_stable_json\(\$plan\)\)/);
  assert.match(validateReceipt, /\$expected_issue_binding\s*=\s*reprint_push_lab_rest_authenticated_push_session_issue_binding/);
  assert.match(validateReceipt, /Receipt short-lived push session issue binding does not match the current request\./);
  assertBefore(
    validateReceipt,
    '$expected_issue_binding = reprint_push_lab_rest_authenticated_push_session_issue_binding',
    'Receipt dry-run body binding is incomplete.',
  );
});
