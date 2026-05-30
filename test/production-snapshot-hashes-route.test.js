import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routeSourcePath = path.join(repoRoot, 'scripts/playground/push-remote-rest-plugin.php');
const routeSource = readFileSync(routeSourcePath, 'utf8');
const liveSmokeSourcePath = path.join(repoRoot, 'scripts/playground/production-snapshot-hashes-route-live-smoke.mjs');
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

test('RPP-0522 snapshot hashes proof uses the real production-shaped route over sandbox-local loopback', () => {
  assert.match(liveSmokeSource, /const endpointPath = '\/wp-json\/reprint\/v1\/push\/snapshot-hashes';/);
  assert.match(liveSmokeSource, /const routeIndexPath = '\/reprint\/v1\/push\/snapshot-hashes';/);
  assert.match(liveSmokeSource, /assertRoute\(index\.body, routeIndexPath, 'POST'\)/);

  assert.match(liveSmokeSource, /scope: 'would-fail-if-json-parsed'/);
  assert.match(
    liveSmokeSource,
    /assert\.equal\(unauthenticated\.status, 401, `unauthenticated production snapshot hashes HTTP \$\{unauthenticated\.status\}`\)/,
  );
  assert.match(liveSmokeSource, /assert\.equal\(unauthenticated\.body\?\.code, 'reprint_push_lab_auth_required'\)/);
  assert.match(
    liveSmokeSource,
    /assert\.equal\(unsigned\.status, 401, `unsigned production snapshot hashes HTTP \$\{unsigned\.status\}`\)/,
  );
  assert.match(liveSmokeSource, /assert\.equal\(unsigned\.body\?\.code, 'SIGNED_HEADER_REQUIRED'\)/);
  assert.match(
    liveSmokeSource,
    /assert\.equal\(invalidSession\.status, 401, `invalid-session production snapshot hashes HTTP \$\{invalidSession\.status\}`\)/,
  );
  assert.match(liveSmokeSource, /assert\.equal\(invalidSession\.body\?\.code, 'SIGNED_SESSION_INVALID'\)/);
  assert.match(liveSmokeSource, /assertNoSnapshotHashEvidence\(unauthenticated\)/);
  assert.match(liveSmokeSource, /assertNoSnapshotHashEvidence\(unsigned\)/);
  assert.match(liveSmokeSource, /assertNoSnapshotHashEvidence\(invalidSession\)/);
  assert.match(
    liveSmokeSource,
    /assert\.equal\(snapshotHashBeforeNegative, snapshotHashAfterNegative, 'negative snapshot hashes auth cases must not mutate'\)/,
  );

  assert.match(
    liveSmokeSource,
    /authenticatedHttpClient\(\{\s+sourceUrl: server\.baseUrl,\s+credential: credentials,\s+routeProfile: 'production-shaped',/s,
  );
  assert.match(liveSmokeSource, /const preflight = await client\.signedGet\('\/preflight'\)/);
  assert.match(
    liveSmokeSource,
    /const snapshotHashes = await client\.signedPost\('\/snapshot-hashes', snapshotHashesPayload, \{\s+session,\s+idempotencyKey: 'rpp-0522-production-snapshot-hashes-route',\s+\}\)/s,
  );
  assert.match(liveSmokeSource, /assert\.equal\(snapshotHashes\.status, 200, `production-shaped snapshot hashes HTTP \$\{snapshotHashes\.status\}`\)/);
  assert.match(liveSmokeSource, /assert\.equal\(snapshotHashes\.body\?\.mode, 'snapshot-hashes'\)/);
  assert.match(liveSmokeSource, /assert\.equal\(snapshotHashes\.request\?\.pathname, endpointPath\)/);
  assert.match(liveSmokeSource, /assert\.equal\(snapshotHashes\.body\?\.planningOnly\?\.readOnly, true\)/);
  assert.match(liveSmokeSource, /assert\.equal\(snapshotHashes\.body\?\.planningOnly\?\.mutates, false\)/);
  assert.match(liveSmokeSource, /assert\.equal\(receipt\.type, 'snapshot-hashes'\)/);
  assert.match(liveSmokeSource, /assert\.equal\(receipt\.routeProfile, 'production-shaped'\)/);
  assert.match(liveSmokeSource, /assert\.equal\(receipt\.restNamespace, 'reprint\/v1'\)/);
  assert.match(liveSmokeSource, /assert\.equal\(receipt\.route, '\/push\/snapshot-hashes'\)/);

  assert.match(liveSmokeSource, /host: '127\.0\.0\.1'/);
  assert.match(liveSmokeSource, /port: 'ephemeral'/);
  assert.match(liveSmokeSource, /exposure: 'sandbox-local-loopback-only'/);
  assert.match(liveSmokeSource, /tunnel: 'none'/);
  assert.match(liveSmokeSource, /http\.Server\.prototype\.listen = function reprintPushLocalhostListen/);
  assert.doesNotMatch(liveSmokeSource, /\b(?:ngrok|cloudflared|localtunnel|serveo|localhost\.run|lhr\.life|Tailscale Funnel)\b/i);
});

test('RPP-0522 live proof summary reports hash-only snapshot hashes evidence', () => {
  const summaryInitializer = sourceSlice(liveSmokeSource, 'const summary = {', 'try {');
  assert.match(summaryInitializer, /routeProfile: 'production-shaped'/);
  assert.match(summaryInitializer, /endpoint: endpointPath/);
  assert.match(summaryInitializer, /liveUrl: \{/);
  assert.match(summaryInitializer, /exposure: 'sandbox-local-loopback-only'/);
  assert.match(summaryInitializer, /tunnel: 'none'/);

  const negativeSummary = sourceSlice(liveSmokeSource, 'function summarizeNegativeAuth(response) {', 'function routeMutationSurfaceHash');
  assert.match(negativeSummary, /status: response\.status/);
  assert.match(negativeSummary, /code: response\.body\?\.code \|\| null/);
  assert.match(negativeSummary, /payloadWouldFailIfParsed: true/);
  assert.match(negativeSummary, /invalidArgument: response\.body\?\.code === 'INVALID_ARGUMENT'/);
  assert.match(negativeSummary, /snapshotHashEvidence: hasSnapshotHashEvidence\(response\)/);
  assert.doesNotMatch(negativeSummary, /authorization|Basic|applicationPassword|password|credentialHash|signingKey|sessionHash/i);

  const preflightSummary = sourceSlice(liveSmokeSource, 'summary.preflight = {', '    const snapshotHashes = await client.signedPost');
  assert.match(preflightSummary, /sessionType: preflight\.body\.auth\.session\.type/);
  assert.match(preflightSummary, /sessionStatus: preflight\.body\.auth\.session\.status/);
  assert.match(preflightSummary, /sessionIdPattern: '\^\[A-Za-z0-9_-\]\{32,160\}\$'/);
  assert.match(preflightSummary, /sessionHashLength: String\(preflight\.body\.session\.sessionHash \|\| ''\)\.length/);
  assert.match(preflightSummary, /signingKeyHashLength: String\(preflight\.body\.session\.signingKeyHash \|\| ''\)\.length/);

  const snapshotHashesSummary = sourceSlice(liveSmokeSource, 'summary.snapshotHashes = {', '    summary.ok = true;');
  assert.match(snapshotHashesSummary, /snapshotHashLength: String\(snapshotHashes\.body\.snapshotHash \|\| ''\)\.length/);
  assert.match(snapshotHashesSummary, /snapshotHashSetHashLength: String\(snapshotHashes\.body\.snapshotHashSetHash \|\| ''\)\.length/);
  assert.match(snapshotHashesSummary, /coverageHashLength: String\(snapshotHashes\.body\.coverage\.coverage_hash \|\| ''\)\.length/);
  assert.match(snapshotHashesSummary, /pageHashLength: String\(snapshotHashes\.body\.pageHash \|\| ''\)\.length/);
  assert.match(snapshotHashesSummary, /resourceCount: snapshotHashes\.body\.coverage\.resource_count/);
  assert.match(snapshotHashesSummary, /receiptHashLength: String\(receipt\.receiptHash \|\| ''\)\.length/);
  assert.match(snapshotHashesSummary, /identityHashLength: String\(receipt\.authBinding\.identityHash \|\| ''\)\.length/);
  assert.match(snapshotHashesSummary, /sessionHashLength: String\(receipt\.authBinding\.sessionHash \|\| ''\)\.length/);
  assert.match(snapshotHashesSummary, /signingKeyHashLength: String\(receipt\.authBinding\.signingKeyHash \|\| ''\)\.length/);
  assert.match(snapshotHashesSummary, /idempotencyKeyHashLength: String\(receipt\.request\.idempotencyKeyHash \|\| ''\)\.length/);
  assert.doesNotMatch(snapshotHashesSummary, /authorization|Basic|applicationPassword|password|credentialHash|signingKey:|sessionHash:/i);
});
