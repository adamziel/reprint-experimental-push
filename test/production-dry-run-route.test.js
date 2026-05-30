import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routeSourcePath = path.join(repoRoot, 'scripts/playground/push-remote-rest-plugin.php');
const routeSource = readFileSync(routeSourcePath, 'utf8');
const liveSmokeSourcePath = path.join(repoRoot, 'scripts/playground/production-dry-run-route-live-smoke.mjs');
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

test('RPP-0523 dry-run proof uses the real production-shaped route over sandbox-local loopback', () => {
  assert.match(liveSmokeSource, /const endpointPath = '\/wp-json\/reprint\/v1\/push\/dry-run';/);
  assert.match(liveSmokeSource, /const routeIndexPath = '\/reprint\/v1\/push\/dry-run';/);
  assert.match(liveSmokeSource, /assertRoute\(index\.body, routeIndexPath, 'POST'\)/);

  assert.match(liveSmokeSource, /assert\.equal\(unsigned\.status, 401, `unsigned production dry-run HTTP \$\{unsigned\.status\}`\)/);
  assert.match(liveSmokeSource, /assert\.equal\(unsigned\.body\?\.code, 'SIGNED_HEADER_REQUIRED'\)/);
  assert.match(liveSmokeSource, /assert\.equal\(unsigned\.body\?\.receipt, undefined, 'unsigned dry-run must not mint a receipt'\)/);

  assert.match(
    liveSmokeSource,
    /authenticatedHttpClient\(\{\s+sourceUrl: server\.baseUrl,\s+credential: credentials,\s+routeProfile: 'production-shaped',/s,
  );
  assert.match(liveSmokeSource, /const preflight = await client\.signedGet\('\/preflight'\)/);
  assert.match(liveSmokeSource, /const dryRun = await client\.signedPost\('\/dry-run', \{ plan: readyPlan \}, \{\s+session,\s+idempotencyKey,/s);
  assert.match(liveSmokeSource, /assert\.equal\(dryRun\.status, 200, `production-shaped dry-run HTTP \$\{dryRun\.status\}`\)/);
  assert.match(liveSmokeSource, /assert\.equal\(dryRun\.request\?\.pathname, endpointPath\)/);
  assert.match(liveSmokeSource, /assert\.equal\(receipt\.authBinding\?\.request\?\.restNamespace, 'reprint\/v1'\)/);
  assert.match(liveSmokeSource, /assert\.equal\(receipt\.authBinding\?\.request\?\.dryRunRoute, '\/push\/dry-run'\)/);
  assert.match(liveSmokeSource, /assert\.equal\(receipt\.authBinding\?\.request\?\.routeProfile, 'production-shaped'\)/);
  assert.match(liveSmokeSource, /assert\.equal\(receipt\.authBinding\?\.session\?\.type, 'production-auth-session'\)/);
  assert.match(liveSmokeSource, /assert\.equal\(receipt\.authBinding\?\.session\?\.id, session\)/);
  assert.match(liveSmokeSource, /assert\.equal\(receipt\.authBinding\?\.binding\?\.planHash, expectedPlanHash\)/);
  assert.match(liveSmokeSource, /receipt\.authBinding\.binding\.bindingHash,\s+digest\(withoutKey\(receipt\.authBinding\.binding, 'bindingHash'\)\),/s);
  assert.match(liveSmokeSource, /assert\.equal\(receipt\.receiptHash, digest\(withoutKey\(receipt, 'receiptHash'\)\)\)/);
  assert.match(liveSmokeSource, /assertVisibleSurfaceEqual\(after\.body\.snapshot, snapshots\.base, 'production-shaped dry-run must not mutate'\)/);

  assert.match(liveSmokeSource, /host: '127\.0\.0\.1'/);
  assert.match(liveSmokeSource, /port: 'ephemeral'/);
  assert.match(liveSmokeSource, /exposure: 'sandbox-local-loopback-only'/);
  assert.match(liveSmokeSource, /tunnel: 'none'/);
  assert.match(liveSmokeSource, /http\.Server\.prototype\.listen = function reprintPushLocalhostListen/);
  assert.doesNotMatch(liveSmokeSource, /\b(?:ngrok|cloudflared|localtunnel|serveo|localhost\.run|lhr\.life|Tailscale Funnel)\b/i);
});

test('RPP-0523 live proof summary reports hash-only dry-run binding evidence', () => {
  const summaryInitializer = sourceSlice(liveSmokeSource, 'const summary = {', 'try {');
  assert.match(summaryInitializer, /routeProfile: 'production-shaped'/);
  assert.match(summaryInitializer, /endpoint: endpointPath/);
  assert.match(summaryInitializer, /liveUrl: \{/);
  assert.match(summaryInitializer, /exposure: 'sandbox-local-loopback-only'/);
  assert.match(summaryInitializer, /tunnel: 'none'/);

  const unsignedSummary = sourceSlice(liveSmokeSource, 'summary.unsigned = {', '    const client = authenticatedHttpClient');
  assert.match(unsignedSummary, /status: unsigned\.status/);
  assert.match(unsignedSummary, /code: unsigned\.body\?\.code \|\| null/);
  assert.match(unsignedSummary, /receiptMinted: Boolean\(unsigned\.body\?\.receipt\)/);
  assert.doesNotMatch(unsignedSummary, /authorization|Basic|password|credential/i);

  const dryRunSummary = sourceSlice(liveSmokeSource, 'summary.dryRun = {', '    summary.after = {');
  assert.match(dryRunSummary, /requestPath: dryRun\.request\.pathname/);
  assert.match(dryRunSummary, /receiptHashLength: String\(receipt\.receiptHash \|\| ''\)\.length/);
  assert.match(dryRunSummary, /planHashMatchesExpected: receipt\.planHash === expectedPlanHash/);
  assert.match(dryRunSummary, /scope: receipt\.authBinding\.scope/);
  assert.match(dryRunSummary, /routeProfile: receipt\.authBinding\.request\.routeProfile/);
  assert.match(dryRunSummary, /restNamespace: receipt\.authBinding\.request\.restNamespace/);
  assert.match(dryRunSummary, /dryRunRoute: receipt\.authBinding\.request\.dryRunRoute/);
  assert.match(dryRunSummary, /idMatchesPreflight: receipt\.authBinding\.session\.id === session/);
  assert.match(dryRunSummary, /scopeHashLength: String\(receipt\.authBinding\.binding\.scopeHash \|\| ''\)\.length/);
  assert.match(dryRunSummary, /identityHashLength: String\(receipt\.authBinding\.binding\.identityHash \|\| ''\)\.length/);
  assert.match(dryRunSummary, /authSessionHashLength: String\(receipt\.authBinding\.binding\.authSessionHash \|\| ''\)\.length/);
  assert.match(dryRunSummary, /pushSessionHashLength: String\(receipt\.authBinding\.binding\.pushSessionHash \|\| ''\)\.length/);
  assert.match(dryRunSummary, /bindingHashLength: String\(receipt\.authBinding\.binding\.bindingHash \|\| ''\)\.length/);
  assert.match(dryRunSummary, /idempotencyKeyHashLength: String\(dryRun\.body\.signedRequest\.request\.idempotencyKeyHash \|\| ''\)\.length/);
  assert.doesNotMatch(dryRunSummary, /authorization|Basic|applicationPassword|password|credentialHash|signingKey:|sessionHash:/i);

  const afterSummary = sourceSlice(liveSmokeSource, 'summary.after = {', '    summary.ok = true;');
  assert.match(afterSummary, /finalMatchesBase: true/);
  assert.match(afterSummary, /visibleSurfaceDigest: digest\(visibleSurface\(after\.body\.snapshot\)\)/);
});
