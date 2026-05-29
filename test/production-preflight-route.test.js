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

test('production preflight route is a signed GET route behind authenticated permission', () => {
  const productionRoute = routeRegistration(
    'REPRINT_PUSH_PRODUCTION_SHAPED_REST_NAMESPACE',
    '/push/preflight',
  );
  assert.match(productionRoute, /'methods'\s*=>\s*WP_REST_Server::READABLE/);
  assert.match(productionRoute, /'callback'\s*=>\s*'reprint_push_lab_rest_authenticated_preflight'/);
  assert.match(productionRoute, /'permission_callback'\s*=>\s*'reprint_push_lab_rest_authenticated_permission'/);

  const labAuthenticatedRoute = routeRegistration(
    'REPRINT_PUSH_LAB_REST_NAMESPACE',
    '/authenticated/preflight',
  );
  assert.match(labAuthenticatedRoute, /'methods'\s*=>\s*WP_REST_Server::READABLE/);
  assert.match(labAuthenticatedRoute, /'callback'\s*=>\s*'reprint_push_lab_rest_authenticated_preflight'/);
  assert.match(labAuthenticatedRoute, /'permission_callback'\s*=>\s*'reprint_push_lab_rest_authenticated_permission'/);
});

test('production preflight rejects unsigned requests before building live snapshot evidence', () => {
  const callback = functionBody('reprint_push_lab_rest_authenticated_preflight');

  assertBefore(
    callback,
    "reprint_push_lab_rest_require_signed_request($request, 'preflight')",
    'reprint_push_lab_rest_auth_evidence($request)',
  );
  assertBefore(callback, 'return $signature_error;', 'reprint_push_lab_rest_auth_evidence($request)');
  assertBefore(callback, 'reprint_push_lab_rest_auth_evidence($request)', 'reprint_push_export_snapshot()');
});

test('production preflight response exposes production route profile and hash-only session evidence', () => {
  const callback = functionBody('reprint_push_lab_rest_authenticated_preflight');
  const profile = functionBody('reprint_push_lab_rest_route_profile');

  assert.match(profile, /strpos\(\$route, '\/' \. REPRINT_PUSH_PRODUCTION_SHAPED_REST_NAMESPACE \. '\/push\/'\) === 0/);
  assert.match(profile, /'profile'\s*=>\s*'production-shaped'/);
  assert.match(profile, /'restNamespace'\s*=>\s*REPRINT_PUSH_PRODUCTION_SHAPED_REST_NAMESPACE/);
  assert.match(profile, /'routePrefix'\s*=>\s*'\/push'/);
  assert.match(profile, /'labBacked'\s*=>\s*!\$package_mode/);

  assert.match(callback, /\$session_type\s*=/);
  assert.match(callback, /'production-auth-session'/);
  assert.match(callback, /'lab-signed-push-session'/);
  assert.match(callback, /'routeProfile'\s*=>\s*\$profile/);
  assert.match(callback, /'auth'\s*=>\s*\$auth/);
  assert.match(callback, /'session'\s*=>\s*\[/);
  assert.match(callback, /'id'\s*=>\s*\$signature\['session'\]\['id'\]/);
  assert.match(callback, /'sessionHash'\s*=>\s*\$signature\['session'\]\['sessionHash'\]/);
  assert.match(callback, /'signingKeyHash'\s*=>\s*\$signature\['signingKeyHash'\]/);
  assert.match(callback, /'sessionStore'\s*=>\s*\[/);
  assert.match(callback, /'snapshotHash'\s*=>\s*hash\('sha256',\s*reprint_push_stable_json\(reprint_push_export_snapshot\(\)\)\)/);
  assert.doesNotMatch(callback, /Authorization|Basic\s+[A-Za-z0-9+/=]{16,}|applicationPassword\s*=>|password\s*=>/i);
});
