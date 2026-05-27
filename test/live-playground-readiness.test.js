import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  packagedProductionPluginClassifyBoundedStartup,
  packagedProductionPluginClassifyTimeoutFallbackStartup,
  packagedProductionPluginMalformedTerminalIndexProbe,
  packagedProductionPluginNextRouteNotReadyProbeCounts,
  packagedProductionPluginPackagedRouteStartupLimitReached,
  packagedProductionPluginPackagedRouteStartupStillWithinBudget,
  packagedProductionPluginPreflightReady,
  packagedProductionPluginPreflightRetryable,
  packagedProductionPluginPreflightTerminal,
  packagedProductionPluginPreflightTerminalContext,
  packagedProductionPluginReadinessBodyRetryable,
  packagedProductionPluginReadinessWordPressNotReady,
  packagedProductionPluginResetRouteNotReadyProbeCounts,
  packagedProductionPluginRestIndexReady,
  packagedProductionPluginRestIndexRetryable,
  packagedProductionPluginServerReady,
  packagedProductionPluginSnapshotProbeContext,
  packagedProductionPluginSnapshotReady,
  packagedProductionPluginSnapshotRetryable,
  packagedProductionPluginSnapshotTerminal,
  packagedProductionPluginTimedOutRouteProbeWhilePackagedRouteStarting,
  packagedProductionPluginTimedOutRouteProbeWhileWordPressStarting,
  packagedProductionPluginRetryableRouteProbeWhileIndexProbeTimedOut,
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
    packagedProductionPluginRestIndexReady(200, {
      namespaces: ['reprint/v1'],
      routes: {
        '/reprint/v1/push/preflight': {},
      },
    }),
    true,
  );

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
  assert.equal(
    packagedProductionPluginRestIndexRetryable({
      status: 404,
      body: { code: 'rest_no_route', message: 'No route was found matching the URL and request method.' },
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

test('packaged readiness body helpers accept nested startup payloads but fail closed once startup signals go terminal', () => {
  assert.equal(
    packagedProductionPluginReadinessWordPressNotReady(502, {
      data: {
        details: [
          {
            error: {
              code: 'wordpress_not_ready',
              message: 'WordPress is not ready yet',
            },
          },
        ],
      },
    }),
    true,
  );

  assert.equal(
    packagedProductionPluginReadinessBodyRetryable(404, {
      details: {
        error_code: 'rest_no_route',
        reason: 'No route was found matching the URL and request method.',
      },
    }),
    true,
  );

  assert.equal(
    packagedProductionPluginReadinessBodyRetryable(200, {
      ok: true,
      note: 'missing namespaces and routes should stay terminal',
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

  assert.deepEqual(
    packagedProductionPluginPreflightTerminalContext(
      {
        childPid: 654,
      },
      {
        snapshotStartupFallback: true,
      },
    ),
    {
      childPid: 654,
      packagedProductionPlugin: true,
      preflightTerminal: true,
      snapshotStartupFallback: true,
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
      packagedStartup: true,
      indexProbe: {
        status: 200,
        body: {
          namespaces: ['reprint/v1'],
          routes: {
            '/reprint/v1/push/preflight': {},
          },
        },
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

  assert.equal(
    packagedProductionPluginPreflightRetryable(labAuthRequiredPreflight, {
      indexProbe: {
        timedOut: true,
      },
      snapshotProbe: {
        status: 200,
        body: {
          ok: true,
          note: 'missing snapshot payload should terminate startup fallback',
        },
      },
    }),
    false,
  );
  assert.equal(
    packagedProductionPluginPreflightTerminal(labAuthRequiredPreflight, {
      indexProbe: {
        timedOut: true,
      },
      snapshotProbe: {
        status: 200,
        body: {
          ok: true,
          note: 'missing snapshot payload should terminate startup fallback',
        },
      },
    }),
    true,
  );
});

test('packaged preflight retryability preserves malformed parsed startup probes but fails closed on malformed ready-looking index bodies', () => {
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
      indexProbe: {
        status: 503,
        body: {
          details: {
            error: {
              code: 'wordpress_not_ready',
              message: 'WordPress is not ready yet',
            },
          },
        },
        parsedBody: null,
      },
    }),
    true,
  );

  assert.equal(
    packagedProductionPluginPreflightRetryable(labAuthRequiredPreflight, {
      packagedStartup: true,
      indexProbe: {
        status: 200,
        body: '<!doctype html><html><body>not a REST index</body></html>',
        parsedBody: null,
      },
    }),
    false,
  );
  assert.equal(
    packagedProductionPluginPreflightTerminal(labAuthRequiredPreflight, {
      packagedStartup: true,
      indexProbe: {
        status: 200,
        body: '<!doctype html><html><body>not a REST index</body></html>',
        parsedBody: null,
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

test('packaged malformed index helper and bounded startup classifier fail closed on invalid 200 index bodies', () => {
  const invalidIndexProbe = {
    status: 200,
    body: '{"routes":[]}',
  };

  assert.equal(
    packagedProductionPluginMalformedTerminalIndexProbe(invalidIndexProbe),
    true,
  );

  assert.deepEqual(
    packagedProductionPluginClassifyBoundedStartup(
      {
        retryable: true,
        status: 404,
        body: 'No route was found matching the URL and request method.',
      },
      invalidIndexProbe,
    ),
    {
      kind: 'retryable-route-index-terminal',
      indexTerminal: true,
    },
  );
});

test('packaged timeout and malformed-index helpers preserve retryable startup evidence', () => {
  const retryableWordPressIndexProbe = {
    status: 503,
    body: {
      details: {
        error: {
          code: 'wordpress_not_ready',
          message: 'WordPress is not ready yet',
        },
      },
    },
    parsedBody: null,
  };

  assert.equal(
    packagedProductionPluginMalformedTerminalIndexProbe(retryableWordPressIndexProbe),
    false,
  );
  assert.equal(
    packagedProductionPluginTimedOutRouteProbeWhileWordPressStarting(
      { timedOut: true },
      retryableWordPressIndexProbe.status,
      retryableWordPressIndexProbe.body,
    ),
    true,
  );
  assert.deepEqual(
    packagedProductionPluginClassifyTimeoutFallbackStartup(
      { timedOut: true },
      retryableWordPressIndexProbe,
    ),
    {
      kind: 'timed-out-route-wordpress-starting',
      globalWordPressStartup: true,
    },
  );

  const readyIndexProbe = {
    status: 200,
    body: JSON.stringify({
      namespaces: ['reprint/v1'],
      routes: {
        '/reprint/v1/push/preflight': {},
      },
    }),
    parsedBody: null,
  };

  assert.equal(
    packagedProductionPluginTimedOutRouteProbeWhilePackagedRouteStarting(
      { timedOut: true },
      readyIndexProbe.status,
      readyIndexProbe.body,
    ),
    true,
  );
  assert.equal(
    packagedProductionPluginRetryableRouteProbeWhileIndexProbeTimedOut(
      { retryable: true },
      { timedOut: true },
    ),
    true,
  );
});

test('packaged route startup counters increment per route and reset independently', () => {
  const snapshotOnly = packagedProductionPluginNextRouteNotReadyProbeCounts(
    { snapshot: 1, preflight: 2 },
    'snapshot',
    404,
    'No route was found matching the URL and request method.',
  );
  assert.deepEqual(snapshotOnly, { snapshot: 2, preflight: 2 });

  const preflightOnly = packagedProductionPluginNextRouteNotReadyProbeCounts(
    snapshotOnly,
    'preflight',
    503,
    'WordPress is not ready yet',
  );
  assert.deepEqual(preflightOnly, { snapshot: 2, preflight: 3 });

  const resetSnapshot = packagedProductionPluginResetRouteNotReadyProbeCounts(
    preflightOnly,
    'snapshot',
  );
  assert.deepEqual(resetSnapshot, { snapshot: 0, preflight: 3 });

  const resetBoth = packagedProductionPluginResetRouteNotReadyProbeCounts(
    resetSnapshot,
    'snapshot',
    'preflight',
  );
  assert.deepEqual(resetBoth, { snapshot: 0, preflight: 0 });
});

test('packaged route startup helpers keep the tighter post-global-ready budget fail-closed', () => {
  assert.equal(
    packagedProductionPluginPackagedRouteStartupStillWithinBudget(3, 4),
    true,
  );
  assert.equal(
    packagedProductionPluginPackagedRouteStartupLimitReached(3, 4),
    false,
  );
  assert.equal(
    packagedProductionPluginPackagedRouteStartupStillWithinBudget(4, 4),
    false,
  );
  assert.equal(
    packagedProductionPluginPackagedRouteStartupLimitReached(4, 4),
    true,
  );
});

test('packaged preflight retryability keeps packaged-route startup retryable after global WordPress readiness', () => {
  const preflight = {
    status: 404,
    body: {
      code: 'rest_no_route',
      message: 'No route was found matching the URL and request method.',
    },
  };
  const readyIndexProbe = {
    status: 200,
    body: JSON.stringify({ namespaces: ['reprint/v1'] }),
  };

  assert.equal(
    packagedProductionPluginPreflightRetryable(preflight, {
      packagedStartup: true,
      indexProbe: readyIndexProbe,
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginPreflightTerminal(preflight, {
      packagedStartup: true,
      indexProbe: readyIndexProbe,
    }),
    false,
  );
  assert.deepEqual(
    packagedProductionPluginClassifyBoundedStartup(
      {
        retryable: true,
        status: preflight.status,
        body: JSON.stringify(preflight.body),
      },
      readyIndexProbe,
    ),
    {
      kind: 'retryable-route-packaged-route-starting',
      packagedRouteStartup: true,
    },
  );
});

test('packaged snapshot helpers distinguish ready, retryable, terminal, and probe-context branches', () => {
  const readySnapshot = {
    status: 200,
    body: {
      ok: true,
      snapshot: {
        posts: [],
      },
    },
  };
  const retryableSnapshot = {
    status: 503,
    body: {
      code: 'wordpress_not_ready',
      message: 'WordPress is not ready yet',
    },
  };
  const terminalSnapshot = {
    status: 500,
    body: 'Internal Server Error',
  };

  assert.equal(packagedProductionPluginSnapshotReady(readySnapshot), true);
  assert.equal(packagedProductionPluginSnapshotRetryable(readySnapshot), false);
  assert.equal(packagedProductionPluginSnapshotTerminal(readySnapshot), false);

  assert.equal(packagedProductionPluginSnapshotReady(retryableSnapshot), false);
  assert.equal(packagedProductionPluginSnapshotRetryable(retryableSnapshot), true);
  assert.equal(packagedProductionPluginSnapshotTerminal(retryableSnapshot), false);

  assert.equal(packagedProductionPluginSnapshotReady(terminalSnapshot), false);
  assert.equal(packagedProductionPluginSnapshotRetryable(terminalSnapshot), false);
  assert.equal(packagedProductionPluginSnapshotTerminal(terminalSnapshot), true);

  assert.deepEqual(
    packagedProductionPluginSnapshotProbeContext({
      status: 503,
      body: 'WordPress is not ready yet',
      timedOut: true,
    }),
    {
      status: 503,
      body: 'WordPress is not ready yet',
      timedOut: true,
    },
  );
  assert.equal(packagedProductionPluginSnapshotProbeContext(null), null);
});

test('packaged server readiness requires a production-shaped preflight when present', () => {
  const readySnapshot = {
    status: 200,
    body: {
      ok: true,
      snapshot: {
        posts: [],
      },
    },
  };
  const readyPreflight = {
    status: 200,
    body: {
      ok: true,
      routeProfile: {
        profile: 'production-shaped',
        restNamespace: 'reprint/v1',
        routePrefix: '/push',
        labBacked: false,
      },
      auth: {
        session: {
          status: 'active',
          type: 'production-auth-session',
          expiresAt: '2099-01-01T00:00:00Z',
          expired: false,
        },
      },
    },
  };
  const terminalPreflight = {
    status: 200,
    body: {
      ok: true,
      routeProfile: {
        profile: 'production-shaped',
        restNamespace: 'reprint/v1',
        routePrefix: '/push',
        labBacked: true,
      },
      auth: {
        session: {
          status: 'active',
          type: 'production-auth-session',
          expiresAt: '2099-01-01T00:00:00Z',
          expired: false,
        },
      },
    },
  };

  assert.equal(packagedProductionPluginPreflightReady(readyPreflight), true);
  assert.equal(packagedProductionPluginPreflightTerminal(readyPreflight), false);
  assert.equal(packagedProductionPluginServerReady({ snapshot: readySnapshot }), true);
  assert.equal(
    packagedProductionPluginServerReady({
      snapshot: readySnapshot,
      preflight: readyPreflight,
    }),
    true,
  );

  assert.equal(packagedProductionPluginPreflightReady(terminalPreflight), false);
  assert.equal(packagedProductionPluginPreflightRetryable(terminalPreflight), false);
  assert.equal(packagedProductionPluginPreflightTerminal(terminalPreflight), true);
  assert.equal(
    packagedProductionPluginServerReady({
      snapshot: readySnapshot,
      preflight: terminalPreflight,
    }),
    false,
  );
});
