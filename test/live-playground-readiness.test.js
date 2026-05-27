import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  packagedProductionPluginClassifyBoundedStartup,
  packagedProductionPluginClassifyTimeoutFallbackStartup,
  packagedProductionPluginPreflightRetryable,
  packagedProductionPluginPreflightTerminalContext,
  packagedProductionPluginRestIndexReady,
  packagedProductionPluginRestIndexRetryable,
} from '../scripts/playground/packaged-production-plugin-readiness.js';

const repoRoot = path.resolve(import.meta.dirname, '..');

for (const scriptName of [
  'production-shaped-live-topology-proof.mjs',
  'production-shaped-live-protocol-proof.mjs',
]) {
  test(`${scriptName} tolerates startup-shaped index readiness while probing snapshots`, () => {
    const source = readFileSync(
      path.join(repoRoot, 'scripts/playground', scriptName),
      'utf8',
    );

    assert.match(source, /labMaxConsecutiveNotReadyProbes/);
    assert.match(source, /labNotReadyProbeLimitReached/);
    assert.match(
      source,
      /const maxReadinessProbes = Math\.max\(10, Math\.ceil\(serverStartupTimeoutMs \/ readinessProbeIntervalMs\)\);/,
    );
    assert.match(
      source,
      /const maxNotReadyReadinessProbes = Math\.max\(labMaxConsecutiveNotReadyProbes, maxReadinessProbes\);/,
    );
    assert.match(source, /let notReadyProbeCount = 0;/);
    assert.match(source, /let readinessProbeCount = 0;/);
    assert.match(source, /readinessProbeCount \+= 1;/);
    assert.match(source, /const readinessRetryable = labReadinessBodyRetryable\(response\.status, responseBody\);/);
    assert.match(source, /if \(response\.status === 200 && !readinessRetryable\) \{/);
    assert.match(
      source,
      /if \(readinessRetryable\) \{[\s\S]*?fetchTextWithTimeout\(`\$\{baseUrl\}\/wp-json\/reprint-push-lab\/v1\/snapshot`/s,
    );
    assert.match(
      source,
      /if \(labSnapshotReady\(\{[\s\S]*?\}\)\) \{\s*return;\s*\}/s,
    );
    assert.match(
      source,
      /if \(labNotReadyProbeLimitReached\(notReadyProbeCount, maxNotReadyReadinessProbes\)\)/,
    );
    assert.match(source, /const lastProbes = \[\];/);
    assert.match(source, /describeLastProbe\(lastProbes\.at\(-1\)\)/);
    assert.match(source, /await throwPlaygroundReadinessFailure\(/);
    assert.match(source, /writeSync\(2, `\$\{message\}\\n`\);/);
    assert.match(source, /child\.kill\('SIGTERM'\);/);
  });
}

test('packaged rest-index helpers distinguish ready, retryable, and invalid terminal bodies', () => {
  const readyIndex = JSON.stringify({
    namespaces: ['reprint/v1'],
    routes: {
      '/reprint/v1/push/preflight': {},
    },
  });

  assert.equal(packagedProductionPluginRestIndexReady(200, readyIndex), true);
  assert.equal(packagedProductionPluginRestIndexRetryable({ status: 200, body: readyIndex }), false);

  assert.equal(
    packagedProductionPluginRestIndexRetryable({
      status: 502,
      body: JSON.stringify({ code: 'wordpress_not_ready', message: 'WordPress is not ready yet' }),
    }),
    true,
  );

  assert.equal(
    packagedProductionPluginRestIndexRetryable({
      status: 404,
      body: JSON.stringify({ code: 'rest_no_route', message: 'No route was found matching the URL and request method.' }),
    }),
    true,
  );

  assert.equal(packagedProductionPluginRestIndexReady(200, '{"routes":[]}'), false);
  assert.equal(
    packagedProductionPluginRestIndexRetryable({
      status: 200,
      body: '{"routes":[]}',
    }),
    true,
  );

  assert.equal(
    packagedProductionPluginRestIndexRetryable({
      status: 500,
      body: 'Internal Server Error',
    }),
    false,
  );
});

test('packaged startup classifiers preserve terminal /wp-json/ failures for signed preflight probes', () => {
  assert.deepEqual(
    packagedProductionPluginClassifyBoundedStartup(
      {
        retryable: true,
        status: 503,
        body: 'WordPress is not ready yet',
      },
      {
        status: 500,
        body: 'Internal Server Error',
      },
    ),
    {
      kind: 'retryable-route-index-terminal',
      indexTerminal: true,
    },
  );

  assert.deepEqual(
    packagedProductionPluginClassifyTimeoutFallbackStartup(
      {
        retryable: true,
        status: 503,
        body: 'WordPress is not ready yet',
      },
      {
        status: 500,
        body: 'Internal Server Error',
      },
    ),
    {
      kind: 'retryable-route-index-terminal',
      indexTerminal: true,
    },
  );
});

test('packaged preflight terminal context carries index-terminal readiness evidence', () => {
  assert.deepEqual(
    packagedProductionPluginPreflightTerminalContext(
      {
        childPid: 321,
        indexTerminal: true,
        invalidReadinessBody: true,
        preflightNotReadyProbeCount: 4,
      },
      {
        timeoutFallback: true,
      },
    ),
    {
      childPid: 321,
      packagedProductionPlugin: true,
      preflightTerminal: true,
      indexTerminal: true,
      invalidReadinessBody: true,
      preflightNotReadyProbeCount: 4,
      timeoutFallback: true,
    },
  );
});

test('packaged preflight retryability follows the freshest startup probe context', () => {
  const labAuthRequiredPreflight = {
    status: 401,
    body: {
      code: 'reprint_push_lab_auth_required',
      message: 'Authenticated push routes require WordPress Application Password basic auth.',
    },
  };

  assert.equal(
    packagedProductionPluginPreflightRetryable(labAuthRequiredPreflight, {
      packagedStartup: true,
    }),
    true,
  );

  assert.equal(
    packagedProductionPluginPreflightRetryable(labAuthRequiredPreflight, {
      packagedStartup: true,
      indexProbe: {
        status: 500,
        body: 'Internal Server Error',
      },
    }),
    false,
  );

  assert.equal(
    packagedProductionPluginPreflightRetryable(labAuthRequiredPreflight, {
      snapshotProbe: {
        status: 503,
        body: 'WordPress is not ready yet',
      },
    }),
    true,
  );

  assert.equal(
    packagedProductionPluginPreflightRetryable(labAuthRequiredPreflight, {
      indexProbe: {
        timedOut: true,
      },
      snapshotProbe: {
        status: 404,
        body: JSON.stringify({
          details: {
            error_code: 'rest_no_route',
          },
        }),
      },
    }),
    true,
  );
});

test('packaged timeout fallback helper separates WordPress, packaged-route, timeout, and terminal index branches', () => {
  assert.deepEqual(
    packagedProductionPluginClassifyTimeoutFallbackStartup(
      { timedOut: true },
      { status: 503, body: 'WordPress is not ready yet' },
    ),
    {
      kind: 'timed-out-route-wordpress-starting',
      globalWordPressStartup: true,
    },
  );

  assert.deepEqual(
    packagedProductionPluginClassifyTimeoutFallbackStartup(
      { timedOut: true },
      {
        status: 200,
        body: JSON.stringify({
          namespaces: ['reprint/v1'],
          routes: {
            '/reprint/v1/push/preflight': {},
          },
        }),
      },
    ),
    {
      kind: 'timed-out-route-packaged-route-starting',
      packagedRouteStartup: true,
    },
  );

  assert.deepEqual(
    packagedProductionPluginClassifyTimeoutFallbackStartup(
      { retryable: true, status: 404, body: 'No route was found matching the URL and request method.' },
      { timedOut: true },
    ),
    {
      kind: 'retryable-route-index-timeout',
      indexProbeTimedOut: true,
    },
  );

  assert.deepEqual(
    packagedProductionPluginClassifyTimeoutFallbackStartup(
      { timedOut: true },
      { timedOut: true },
    ),
    {
      kind: 'timed-out-route-index-timeout',
      indexProbeTimedOut: true,
    },
  );

  assert.deepEqual(
    packagedProductionPluginClassifyTimeoutFallbackStartup(
      { timedOut: true },
      {
        status: 200,
        body: '<!doctype html><html><body>not a REST index</body></html>',
        parsedBody: null,
      },
    ),
    {
      kind: 'timed-out-route-index-terminal',
      indexTerminal: true,
    },
  );
});
