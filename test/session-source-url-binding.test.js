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

test('short-lived push sessions bind the source URL at issue and verification time', () => {
  const verifySignedRequest = functionBody('reprint_push_lab_rest_verify_signed_request');
  const mintSession = functionBody('reprint_push_lab_rest_mint_signed_session');
  const signedRequestEvidence = functionBody('reprint_push_lab_rest_signed_request_evidence');
  const issueBinding = functionBody('reprint_push_lab_rest_authenticated_push_session_issue_binding');
  const sourceIdentity = functionBody('reprint_push_lab_rest_source_identity');

  assert.match(sourceIdentity, /\$source_url\s*=\s*reprint_push_lab_rest_normalized_source_url\(\(string\) get_site_url\(\)\)/);
  assert.match(sourceIdentity, /'sourceUrl'\s*=>\s*\$source_url/);
  assert.match(sourceIdentity, /'sourceUrlHash'\s*=>\s*hash\('sha256',\s*\$source_url\)/);
  assert.match(sourceIdentity, /\$identity\['sourceHash'\]\s*=\s*hash\('sha256',\s*reprint_push_stable_json\(\$identity\)\)/);

  assertBefore(
    verifySignedRequest,
    '$current_source = reprint_push_lab_rest_source_identity($request);',
    '$session = reprint_push_lab_rest_signed_session($session_id);',
  );
  assertBefore(
    verifySignedRequest,
    "|| !hash_equals((string) ($session['sourceHash'] ?? ''), (string) ($current_source['sourceHash'] ?? ''))",
    '$canonical = reprint_push_lab_rest_push_canonical_string',
  );
  assertBefore(
    verifySignedRequest,
    "|| !hash_equals((string) ($session['sourceUrlHash'] ?? ''), (string) ($current_source['sourceUrlHash'] ?? ''))",
    '$canonical = reprint_push_lab_rest_push_canonical_string',
  );
  assert.match(
    verifySignedRequest,
    /reprint_push_lab_rest_mint_signed_session\(\$auth,\s*\$signing_key_hash,\s*\$current_source\)/,
  );

  assert.match(routeSource, /function reprint_push_lab_rest_mint_signed_session\(array \$auth,\s*string \$signing_key_hash,\s*array \$source_identity\): array/);
  assert.match(mintSession, /'sourceHash'\s*=>\s*\(string\)\s*\(\$source_identity\['sourceHash'\] \?\? ''\)/);
  assert.match(mintSession, /'sourceUrlHash'\s*=>\s*\(string\)\s*\(\$source_identity\['sourceUrlHash'\] \?\? ''\)/);
  assert.match(signedRequestEvidence, /'sourceHash'\s*=>\s*\(string\)\s*\(\$session\['sourceHash'\] \?\? ''\)/);
  assert.match(signedRequestEvidence, /'sourceUrlHash'\s*=>\s*\(string\)\s*\(\$session\['sourceUrlHash'\] \?\? ''\)/);
  assert.match(issueBinding, /'sourceHash'\s*=>\s*\(string\)\s*\(\$session\['sourceHash'\] \?\? ''\)/);
  assert.match(issueBinding, /'sourceUrlHash'\s*=>\s*\(string\)\s*\(\$session\['sourceUrlHash'\] \?\? ''\)/);
});

test('apply revalidates the auth-bound live source URL after apply-started and before mutation', () => {
  const runApply = functionBody('reprint_push_lab_rest_run_db_journal_apply');
  const revalidateLiveSource = functionBody('reprint_push_lab_rest_revalidate_apply_live_source_before_mutation');
  const sourceBindingEvidence = functionBody('reprint_push_lab_rest_apply_live_source_binding_evidence');
  const applyRevalidationEvidence = functionBody('reprint_push_lab_rest_apply_revalidation_evidence');
  const validateReceipt = functionBody('reprint_push_lab_rest_validate_authenticated_receipt');

  assertBefore(
    runApply,
    "reprint_push_lab_db_journal_append_event('apply-started'",
    'reprint_push_lab_rest_revalidate_apply_live_source_before_mutation(',
  );
  assertBefore(
    runApply,
    'reprint_push_lab_rest_revalidate_apply_live_source_before_mutation(',
    "reprint_push_protocol_run_payload('apply'",
  );

  assert.match(revalidateLiveSource, /reprint_push_lab_rest_apply_live_source_binding_evidence\(\$request,\s*\$accepted\)/);
  assertBefore(
    revalidateLiveSource,
    '$current_source = reprint_push_lab_rest_apply_live_source_binding_evidence($request, $accepted);',
    '$current = reprint_push_export_snapshot();',
  );
  assert.match(revalidateLiveSource, /'AUTH_SOURCE_BINDING_MISMATCH'/);
  assert.match(revalidateLiveSource, /'sourceUrlHash'\s*=>\s*\(string\)\s*\(\$current_source\['sourceUrlHash'\]/);
  assert.match(revalidateLiveSource, /'receiptSourceUrlHash'\s*=>\s*\(string\)\s*\(\$current_source\['receiptSourceUrlHash'\]/);
  assert.match(revalidateLiveSource, /'sourceBindingHash'\s*=>\s*\(string\)\s*\(\$current_source\['sourceBindingHash'\]/);

  assert.match(sourceBindingEvidence, /\$current_source\s*=\s*reprint_push_lab_rest_source_identity\(\$request\)/);
  assert.match(sourceBindingEvidence, /reprint_push_lab_rest_source_binding_matches\(\$receipt_source,\s*\$current_source\)/);
  assert.match(sourceBindingEvidence, /'checkedAgainst'\s*=>\s*'live-source-url'/);
  assert.match(sourceBindingEvidence, /'receiptSourceUrlHash'\s*=>\s*\(string\)\s*\(\$receipt_source\['sourceUrlHash'\]/);
  assert.match(applyRevalidationEvidence, /'sourceUrlHash'\s*=>\s*\(string\)\s*\(\$live_revalidation\['sourceUrlHash'\]/);
  assert.match(applyRevalidationEvidence, /'receiptSourceUrlHash'\s*=>\s*\(string\)\s*\(\$live_revalidation\['receiptSourceUrlHash'\]/);

  assert.match(validateReceipt, /reprint_push_lab_rest_source_binding_matches\(\$source_binding,\s*\$current_source\)/);

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
    assert.doesNotMatch(
      revalidateLiveSource,
      new RegExp(forbiddenMutationCall.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
  }
});
