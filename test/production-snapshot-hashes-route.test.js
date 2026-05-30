import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routeSourcePath = path.join(repoRoot, 'scripts/playground/push-remote-rest-plugin.php');
const routeSource = readFileSync(routeSourcePath, 'utf8');
const liveSmokePath = path.join(repoRoot, 'scripts/playground/production-snapshot-hashes-route-live-smoke.mjs');
const liveSmokeSource = readFileSync(liveSmokePath, 'utf8');

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

function snapshotHashRouteBodies() {
  return [
    'reprint_push_lab_rest_authenticated_snapshot_hashes',
    'reprint_push_lab_rest_snapshot_hashes_response',
    'reprint_push_lab_rest_snapshot_hash_resources',
    'reprint_push_lab_rest_snapshot_hash_resource_entry',
    'reprint_push_lab_rest_snapshot_hashes_receipt',
  ].map(functionBody).join('\n');
}

test('production snapshot hashes route is a POST route behind authenticated permission', () => {
  const productionRoute = routeRegistration(
    'REPRINT_PUSH_PRODUCTION_SHAPED_REST_NAMESPACE',
    '/push/snapshot-hashes',
  );
  assert.match(productionRoute, /'methods'\s*=>\s*WP_REST_Server::CREATABLE/);
  assert.match(productionRoute, /'callback'\s*=>\s*'reprint_push_lab_rest_authenticated_snapshot_hashes'/);
  assert.match(productionRoute, /'permission_callback'\s*=>\s*'reprint_push_lab_rest_authenticated_permission'/);

  const labAuthenticatedRoute = routeRegistration(
    'REPRINT_PUSH_LAB_REST_NAMESPACE',
    '/authenticated/snapshot-hashes',
  );
  assert.match(labAuthenticatedRoute, /'permission_callback'\s*=>\s*'reprint_push_lab_rest_authenticated_permission'/);
});

test('negative snapshot hashes auth and signature cases fail before JSON parsing or snapshot export', () => {
  const callback = functionBody('reprint_push_lab_rest_authenticated_snapshot_hashes');
  const preDispatch = functionBody('reprint_push_lab_rest_pre_dispatch_snapshot_hashes_auth_guard');
  const signedVerifier = functionBody('reprint_push_lab_rest_verify_signed_request');

  assert.match(routeSource, /add_filter\('rest_pre_dispatch', 'reprint_push_lab_rest_pre_dispatch_snapshot_hashes_auth_guard', 9, 3\)/);
  assertBefore(preDispatch, 'reprint_push_lab_rest_authenticated_permission($request)', "reprint_push_lab_rest_verify_signed_request($request, 'snapshot-hashes', ['claimNonce' => false])");
  assert.match(preDispatch, /\['claimNonce'\s*=>\s*false\]/);
  assert.match(preDispatch, /return reprint_push_lab_rest_json_response\(\$signature \+ \['mode' => 'snapshot-hashes'\]\);/);
  assert.doesNotMatch(preDispatch, /reprint_push_lab_rest_json_payload|get_json_params|reprint_push_export_snapshot|reprint_push_lab_rest_snapshot_hashes_response|reprint_push_lab_rest_claim_signed_nonce/);
  assert.match(routeSource, /function reprint_push_lab_rest_verify_signed_request\(WP_REST_Request \$request, string \$mode, array \$options = \[\]\): array/);
  assertBefore(signedVerifier, '$claim_nonce = !array_key_exists', 'reprint_push_lab_rest_claim_signed_nonce($nonce');

  assertBefore(
    callback,
    "reprint_push_lab_rest_require_signed_request($request, 'snapshot-hashes')",
    'reprint_push_lab_rest_json_payload($request)',
  );
  assertBefore(callback, 'return $signature_error;', 'reprint_push_lab_rest_json_payload($request)');
  assertBefore(callback, 'reprint_push_lab_rest_json_payload($request)', 'reprint_push_lab_rest_snapshot_hashes_response($request, $payload)');

  const productionRoute = routeRegistration(
    'REPRINT_PUSH_PRODUCTION_SHAPED_REST_NAMESPACE',
    '/push/snapshot-hashes',
  );
  assert.match(productionRoute, /reprint_push_lab_rest_authenticated_permission/);

  const routeBodies = snapshotHashRouteBodies();
  for (const forbiddenMutationCall of [
    'reprint_push_protocol_run_payload',
    'reprint_push_protocol_append_journal_event',
    'reprint_push_lab_db_journal_insert_event',
    'reprint_push_lab_rest_apply_with_db_journal',
    'wp_insert_post',
    'wp_update_post',
    'update_option',
    '$wpdb->insert',
    '$wpdb->update',
    '$wpdb->delete',
  ]) {
    assert.doesNotMatch(routeBodies, new RegExp(forbiddenMutationCall.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('snapshot hashes receipts bind hash evidence without credential material', () => {
  const snapshotReceipt = functionBody('reprint_push_lab_rest_snapshot_hashes_receipt');
  assert.match(snapshotReceipt, /'type'\s*=>\s*'snapshot-hashes'/);
  assert.match(snapshotReceipt, /'snapshotHashSetHash'\s*=>/);
  assert.match(snapshotReceipt, /'pageHash'\s*=>/);
  assert.match(snapshotReceipt, /'authBinding'\s*=>/);
  assert.match(snapshotReceipt, /'identityHash'\s*=>/);
  assert.match(snapshotReceipt, /'sessionHash'\s*=>/);
  assert.match(snapshotReceipt, /'signingKeyHash'\s*=>/);
  assert.match(snapshotReceipt, /'idempotencyKeyHash'\s*=>/);
  assert.doesNotMatch(snapshotReceipt, /authorization|applicationPassword|credentialHash|password/i);

  const dryRunReceiptBinding = functionBody('reprint_push_lab_rest_authenticated_receipt_snapshot_hash_binding');
  assert.match(dryRunReceiptBinding, /'snapshotIdHash'\s*=>/);
  assert.match(dryRunReceiptBinding, /'preconditionSetHash'\s*=>/);
  assert.match(dryRunReceiptBinding, /'mutationSetHash'\s*=>/);
  assert.match(dryRunReceiptBinding, /'planningOnly'\s*=>\s*true/);
  assert.doesNotMatch(dryRunReceiptBinding, /authorization|applicationPassword|signingKey|password/i);

  const dryRunReceipt = functionBody('reprint_push_lab_rest_bind_authenticated_receipt');
  assert.match(dryRunReceipt, /'snapshotHashes'\s*=>\s*reprint_push_lab_rest_authenticated_receipt_snapshot_hash_binding/);

  const validateReceipt = functionBody('reprint_push_lab_rest_validate_authenticated_receipt');
  assert.match(validateReceipt, /\$snapshot_hashes\s*=\s*isset\(\$binding\['snapshotHashes'\]/);
  assert.match(validateReceipt, /Receipt snapshot-hashes binding does not match receipt evidence\./);
});

test('signed request and auth lifecycle explicitly include snapshot hashes', () => {
  const signedVerifier = functionBody('reprint_push_lab_rest_verify_signed_request');
  assert.match(signedVerifier, /signed dry-run, snapshot hashes, apply, recovery inspect, recovery mutate, and journal inspect requests/);

  const lifecycle = functionBody('reprint_push_lab_rest_auth_session_lifecycle_step');
  assertBefore(lifecycle, "str_ends_with($route, '/snapshot-hashes')", "str_ends_with($route, '/dry-run')");
});

test('live smoke covers malformed negative cases and labels local lab-backed evidence', () => {
  assert.match(liveSmokeSource, /classification:\s*'local-lab-backed'/);
  assert.match(liveSmokeSource, /productionUrlSupplied:\s*false/);
  assert.match(liveSmokeSource, /Sandbox-local WordPress Playground proof; not production-backed evidence\./);
  assert.match(liveSmokeSource, /exposure:\s*'sandbox-local-loopback-only'/);
  assert.match(liveSmokeSource, /tunnel:\s*'none'/);
  assert.match(liveSmokeSource, /http:\/\/127\.0\.0\.1:\$\{port\}/);

  for (const expectedCase of [
    'missing-basic-auth-malformed-json',
    'wrong-basic-auth-malformed-json',
    'valid-auth-missing-signature-headers-malformed-json',
    'valid-auth-missing-session-malformed-json',
    'valid-auth-content-hash-mismatch-malformed-json',
    'valid-auth-auth-signature-mismatch-malformed-json',
  ]) {
    assert.match(liveSmokeSource, new RegExp(expectedCase));
  }

  assert.match(liveSmokeSource, /assertMalformedJsonWasNotParsed\(result\.body, negativeCase\.name\)/);
  assert.match(liveSmokeSource, /assertNoSnapshotHashPayload\(result\.body, negativeCase\.name\)/);
  assert.match(liveSmokeSource, /negative cases must not append protocol journal entries/);
  assert.match(liveSmokeSource, /snapshot-hashes route must not append protocol journal entries/);
  assert.match(liveSmokeSource, /negativeCasesJournalUnchanged/);
  assert.match(liveSmokeSource, /snapshotHashesJournalUnchanged/);
  assert.doesNotMatch(liveSmokeSource, /ngrok|cloudflared|localtunnel|serveo|localhost\.run|lhr\.life|Tailscale Funnel/i);
});
