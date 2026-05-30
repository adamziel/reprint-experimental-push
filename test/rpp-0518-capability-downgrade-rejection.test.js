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

test('RPP-0518 rejects lower-capability callers at permission before JSON parsing or mutation', () => {
  const permission = functionBody('reprint_push_lab_rest_authenticated_permission');

  assert.match(routeSource, /const REPRINT_PUSH_LAB_REQUIRED_CAPABILITY = 'manage_options';/);
  assert.match(permission, /current_user_can\(REPRINT_PUSH_LAB_REQUIRED_CAPABILITY\)/);
  assert.match(permission, /'reprint_push_lab_forbidden'/);

  for (const forbiddenCall of [
    'reprint_push_lab_rest_json_payload',
    'reprint_push_lab_rest_protocol_response',
    'reprint_push_lab_rest_apply_with_db_journal',
    'reprint_push_protocol_run_payload',
    'wp_insert_post',
    'wp_update_post',
    'update_option',
    '$wpdb->insert',
    '$wpdb->update',
    '$wpdb->delete',
  ]) {
    assert.doesNotMatch(permission, new RegExp(forbiddenCall.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('RPP-0518 rejects downgraded signed sessions before canonical verification and mutation', () => {
  const verifySignedRequest = functionBody('reprint_push_lab_rest_verify_signed_request');
  const capabilityMatches = functionBody('reprint_push_lab_rest_signed_session_capability_matches');
  const dryRun = functionBody('reprint_push_lab_rest_authenticated_dry_run');
  const apply = functionBody('reprint_push_lab_rest_authenticated_apply');

  assert.match(capabilityMatches, /current_user_can\(REPRINT_PUSH_LAB_REQUIRED_CAPABILITY\)/);
  assert.match(capabilityMatches, /\$session\['requiredCapability'\]/);
  assert.match(capabilityMatches, /\$session\['capabilityGranted'\]/);
  assert.match(capabilityMatches, /\$session\['capabilityHash'\]/);
  assert.match(capabilityMatches, /reprint_push_lab_rest_signed_capability_hash\(\)/);

  assert.match(verifySignedRequest, /'SIGNED_SESSION_CAPABILITY_DOWNGRADED'/);
  assertBefore(
    verifySignedRequest,
    'reprint_push_lab_rest_signed_session_capability_matches($session)',
    '$canonical = reprint_push_lab_rest_push_canonical_string',
  );
  assertBefore(
    verifySignedRequest,
    'reprint_push_lab_rest_signed_session_capability_matches($session)',
    'reprint_push_lab_rest_claim_signed_nonce',
  );

  assertBefore(
    dryRun,
    "reprint_push_lab_rest_require_signed_request($request, 'dry-run')",
    'reprint_push_lab_rest_protocol_response',
  );
  assertBefore(
    apply,
    "reprint_push_lab_rest_require_signed_request($request, 'apply')",
    'reprint_push_lab_rest_json_payload($request)',
  );
  assertBefore(
    apply,
    'reprint_push_lab_rest_validate_authenticated_receipt($request, $payload, $plan, $receipt_payload)',
    'reprint_push_lab_rest_apply_with_db_journal($request, true)',
  );
});

test('RPP-0518 binds capability evidence into the session and dry-run receipt issue', () => {
  const preflight = functionBody('reprint_push_lab_rest_authenticated_preflight');
  const mintSession = functionBody('reprint_push_lab_rest_mint_signed_session');
  const signedRequestEvidence = functionBody('reprint_push_lab_rest_signed_request_evidence');
  const issueBinding = functionBody('reprint_push_lab_rest_authenticated_push_session_issue_binding');
  const validateReceipt = functionBody('reprint_push_lab_rest_validate_authenticated_receipt');

  assert.match(preflight, /'requiredCapability'\s*=>\s*\$signature\['session'\]\['requiredCapability'\]/);
  assert.match(preflight, /'capabilityHash'\s*=>\s*\$signature\['session'\]\['capabilityHash'\]/);

  assert.match(mintSession, /'requiredCapability'\s*=>\s*REPRINT_PUSH_LAB_REQUIRED_CAPABILITY/);
  assert.match(mintSession, /'capabilityGranted'\s*=>\s*current_user_can\(REPRINT_PUSH_LAB_REQUIRED_CAPABILITY\)/);
  assert.match(mintSession, /'capabilityHash'\s*=>\s*reprint_push_lab_rest_signed_capability_hash\(\)/);

  assert.match(signedRequestEvidence, /'requiredCapability'\s*=>\s*\(string\) \(\$session\['requiredCapability'\]/);
  assert.match(signedRequestEvidence, /'capabilityHash'\s*=>\s*\(string\) \(\$session\['capabilityHash'\]/);
  assert.match(issueBinding, /'requiredCapability'\s*=>\s*\(string\) \(\$session\['requiredCapability'\]/);
  assert.match(issueBinding, /'capabilityHash'\s*=>\s*\(string\) \(\$session\['capabilityHash'\]/);
  assertBefore(
    validateReceipt,
    '$expected_issue_binding = reprint_push_lab_rest_authenticated_push_session_issue_binding',
    'Receipt short-lived push session issue binding does not match the current request.',
  );
});
