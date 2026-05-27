import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  packagedProductionPluginClassifyBoundedStartup,
  packagedProductionPluginClassifyTimeoutFallbackStartup,
  packagedProductionPluginMalformedTerminalIndexProbe,
  packagedProductionPluginNextNotReadyProbeCount,
  packagedProductionPluginNextRouteNotReadyProbeCounts,
  packagedProductionPluginNextTimeoutProbeCount,
  packagedProductionPluginNotReadyProbeLimitReached,
  packagedProductionPluginPackagedRouteStartupLimitReached,
  packagedProductionPluginPackagedRouteStartupStillWithinBudget,
  packagedProductionPluginPreflightReady,
  packagedProductionPluginPreflightRetryable,
  packagedProductionPluginPreflightTerminal,
  packagedProductionPluginPreflightTerminalContext,
  packagedProductionPluginReadinessBodyRetryable,
  packagedProductionPluginReadinessErrorRetryable,
  packagedProductionPluginReadinessProbeTimedOut,
  packagedProductionPluginReadinessWordPressNotReady,
  packagedProductionPluginResetRouteNotReadyProbeCounts,
  packagedProductionPluginRestIndexReady,
  packagedProductionPluginRestIndexRetryable,
  packagedProductionPluginRouteRetryableWhilePackagedRouteStarting,
  packagedProductionPluginRouteRetryableWhileWordPressStarting,
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
        status: 503,
        body: JSON.stringify({
          code: 'wordpress_not_ready',
          message: 'WordPress is not ready yet',
        }),
      },
    ),
    {
      kind: 'retryable-route-wordpress-starting',
      globalWordPressStartup: true,
    },
  );

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
        childPid: 987,
        indexTerminal: true,
        invalidReadinessBody: true,
      },
      {
        snapshotStartupFallback: true,
      },
    ),
    {
      childPid: 987,
      packagedProductionPlugin: true,
      preflightTerminal: true,
      indexTerminal: true,
      invalidReadinessBody: true,
      snapshotStartupFallback: true,
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

  assert.deepEqual(
    packagedProductionPluginPreflightTerminalContext(
      {
        childPid: 432,
        globalWordPressStartup: true,
        packagedRouteStartup: true,
        indexProbeTimedOut: true,
        preflightNotReadyProbeCount: 3,
        snapshotNotReadyProbeCount: 2,
      },
      {
        timeoutFallback: true,
      },
    ),
    {
      childPid: 432,
      packagedProductionPlugin: true,
      preflightTerminal: true,
      globalWordPressStartup: true,
      packagedRouteStartup: true,
      indexProbeTimedOut: true,
      preflightNotReadyProbeCount: 3,
      snapshotNotReadyProbeCount: 2,
      timeoutFallback: true,
    },
  );
});

test('packaged preflight fails closed on ready-looking 200 responses even while startup hints stay retryable', () => {
  const startupContext = {
    packagedStartup: true,
    indexProbe: {
      status: 503,
      body: JSON.stringify({
        code: 'wordpress_not_ready',
        message: 'WordPress is not ready yet',
      }),
    },
    snapshotProbe: {
      status: 404,
      body: JSON.stringify({
        code: 'rest_no_route',
        message: 'No route was found matching the URL and request method.',
      }),
    },
  };

  const terminalPreflights = [
    {
      label: 'wrong route profile',
      preflight: {
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
            },
          },
        },
      },
    },
    {
      label: 'missing auth session',
      preflight: {
        status: 200,
        body: {
          ok: true,
          routeProfile: {
            profile: 'production-shaped',
            restNamespace: 'reprint/v1',
            routePrefix: '/push',
            labBacked: false,
          },
          auth: {},
        },
      },
    },
    {
      label: 'expired production session',
      preflight: {
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
              expiresAt: '2000-01-01T00:00:00Z',
            },
          },
        },
      },
    },
  ];

  for (const { label, preflight } of terminalPreflights) {
    assert.equal(
      packagedProductionPluginPreflightReady(preflight),
      false,
      `${label} should not be considered ready`,
    );
    assert.equal(
      packagedProductionPluginPreflightRetryable(preflight, startupContext),
      false,
      `${label} should fail closed instead of inheriting packaged startup hints`,
    );
    assert.equal(
      packagedProductionPluginPreflightTerminal(preflight, startupContext),
      true,
      `${label} should stay terminal even while startup hints remain retryable elsewhere`,
    );
  }
});

test('packaged preflight fails closed on broken session identity and envelope responses even while startup hints stay retryable', () => {
  const startupContext = {
    packagedStartup: true,
    indexProbe: {
      status: 503,
      body: JSON.stringify({
        code: 'wordpress_not_ready',
        message: 'WordPress is not ready yet',
      }),
    },
    snapshotProbe: {
      status: 404,
      body: JSON.stringify({
        code: 'rest_no_route',
        message: 'No route was found matching the URL and request method.',
      }),
    },
  };

  const terminalPreflights = [
    {
      label: 'missing top-level session',
      preflight: {
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
              id: 'session_123',
              status: 'active',
              type: 'production-auth-session',
              expiresAt: '2099-01-01T00:00:00Z',
            },
          },
        },
      },
    },
    {
      label: 'missing top-level session id',
      preflight: {
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
              id: 'session_123',
              status: 'active',
              type: 'production-auth-session',
              expiresAt: '2099-01-01T00:00:00Z',
            },
          },
          session: {
            type: 'production-auth-session',
          },
        },
      },
    },
    {
      label: 'mismatched auth and top-level session ids',
      preflight: {
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
              id: 'session_456',
              status: 'active',
              type: 'production-auth-session',
              expiresAt: '2099-01-01T00:00:00Z',
            },
          },
          session: {
            id: 'session_123',
            type: 'production-auth-session',
          },
        },
      },
    },
    {
      label: 'wrong top-level session type',
      preflight: {
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
              id: 'session_123',
              status: 'active',
              type: 'production-auth-session',
              expiresAt: '2099-01-01T00:00:00Z',
            },
          },
          session: {
            id: 'session_123',
            type: 'lab-auth-session',
          },
        },
      },
    },
  ];

  for (const { label, preflight } of terminalPreflights) {
    assert.equal(
      packagedProductionPluginPreflightReady(preflight),
      false,
      `${label} should not be considered ready`,
    );
    assert.equal(
      packagedProductionPluginPreflightRetryable(preflight, startupContext),
      false,
      `${label} should fail closed instead of inheriting packaged startup hints`,
    );
    assert.equal(
      packagedProductionPluginPreflightTerminal(preflight, startupContext),
      true,
      `${label} should stay terminal even while startup hints remain retryable elsewhere`,
    );
  }
});

test('packaged preflight fails closed on broken top-level auth envelopes even while startup hints stay retryable', () => {
  const startupContext = {
    packagedStartup: true,
    indexProbe: {
      status: 503,
      body: JSON.stringify({
        code: 'wordpress_not_ready',
        message: 'WordPress is not ready yet',
      }),
    },
    snapshotProbe: {
      status: 404,
      body: JSON.stringify({
        code: 'rest_no_route',
        message: 'No route was found matching the URL and request method.',
      }),
    },
  };

  const terminalPreflights = [
    {
      label: 'missing top-level auth',
      preflight: {
        status: 200,
        body: {
          ok: true,
          routeProfile: {
            profile: 'production-shaped',
            restNamespace: 'reprint/v1',
            routePrefix: '/push',
            labBacked: false,
          },
          session: {
            id: 'session_123',
            type: 'production-auth-session',
          },
        },
      },
    },
    {
      label: 'missing top-level auth session',
      preflight: {
        status: 200,
        body: {
          ok: true,
          routeProfile: {
            profile: 'production-shaped',
            restNamespace: 'reprint/v1',
            routePrefix: '/push',
            labBacked: false,
          },
          auth: {},
          session: {
            id: 'session_123',
            type: 'production-auth-session',
          },
        },
      },
    },
  ];

  for (const { label, preflight } of terminalPreflights) {
    assert.equal(
      packagedProductionPluginPreflightReady(preflight),
      false,
      `${label} should not be considered ready`,
    );
    assert.equal(
      packagedProductionPluginPreflightRetryable(preflight, startupContext),
      false,
      `${label} should fail closed instead of inheriting packaged startup hints`,
    );
    assert.equal(
      packagedProductionPluginPreflightTerminal(preflight, startupContext),
      true,
      `${label} should stay terminal even while startup hints remain retryable elsewhere`,
    );
  }
});

test('packaged startup runtimes preserve signed-preflight terminal context across index-terminal branches', () => {
  for (const scriptName of [
    'production-plugin-package-smoke.mjs',
    'production-shaped-release-verify.mjs',
  ]) {
    const source = readFileSync(
      path.join(repoRoot, 'scripts/playground', scriptName),
      'utf8',
    );

    const assertNearby = (messageNeedle, requiredNeedles, failureMessage) => {
      const start = source.indexOf(messageNeedle);
      assert.notEqual(start, -1, `${scriptName} should include ${failureMessage}`);
      const nearby = source.slice(start, start + 1000);
      for (const needle of requiredNeedles) {
        assert.match(
          nearby,
          needle,
          `${scriptName} should preserve ${failureMessage}`,
        );
      }
    };

    assertNearby(
      'Packaged production plugin signed preflight stayed startup-shaped while /wp-json/ returned a terminal readiness failure HTTP ${indexProbe.status} after ${preflightNotReadyProbeCount} consecutive response',
      [/packagedProductionPluginPreflightTerminalContext\(/, /indexTerminal:\s*true/],
      'index-terminal context when signed preflight stays startup-shaped after snapshot startup probes',
    );
    assertNearby(
      'Packaged production plugin signed preflight stayed startup-shaped while /wp-json/ returned a terminal readiness failure HTTP ${indexProbe?.status ?? 0} after the snapshot probe timed out at ${baseUrl}',
      [/packagedProductionPluginPreflightTerminalContext\(/, /indexTerminal:\s*true/, /timeoutFallback:\s*true/],
      'index-terminal timeout-fallback context when signed preflight stays startup-shaped after the snapshot probe timed out',
    );
    assertNearby(
      'Packaged production plugin signed preflight probe timed out while /wp-json/ returned a terminal readiness failure HTTP ${indexProbe.status} after the snapshot probe timed out at ${baseUrl}',
      [/packagedProductionPluginPreflightTerminalContext\(/, /indexTerminal:\s*true/, /timeoutFallback:\s*true/],
      'index-terminal timeout-fallback context when signed preflight times out after the snapshot probe timed out',
    );
    assertNearby(
      'Packaged production plugin signed preflight became terminal while snapshot still reported startup-shaped readiness at ${baseUrl}',
      [/packagedProductionPluginPreflightTerminalContext\(/, /snapshotStartupFallback:\s*true/],
      'snapshot-startup fallback context on terminal signed-preflight failures',
    );
  }
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
        timedOut: true,
      },
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginPreflightTerminal(labAuthRequiredPreflight, {
      packagedStartup: true,
      indexProbe: {
        timedOut: true,
      },
    }),
    false,
  );
  assert.equal(
    packagedProductionPluginPreflightRetryable(labAuthRequiredPreflight, {
      indexProbe: {
        timedOut: true,
      },
    }),
    false,
  );
  assert.equal(
    packagedProductionPluginPreflightTerminal(labAuthRequiredPreflight, {
      indexProbe: {
        timedOut: true,
      },
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

test('packaged preflight retryability preserves malformed parsed snapshot fallback startup evidence', () => {
  const labAuthRequiredPreflight = {
    status: 401,
    body: {
      code: 'reprint_push_lab_auth_required',
      message: 'Authenticated push routes require WordPress Application Password basic auth.',
    },
  };

  assert.equal(
    packagedProductionPluginPreflightRetryable(labAuthRequiredPreflight, {
      indexProbe: {
        timedOut: true,
      },
      snapshotProbe: {
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
    packagedProductionPluginPreflightTerminal(labAuthRequiredPreflight, {
      indexProbe: {
        timedOut: true,
      },
      snapshotProbe: {
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
    false,
  );

  assert.equal(
    packagedProductionPluginPreflightRetryable(labAuthRequiredPreflight, {
      indexProbe: {
        timedOut: true,
      },
      snapshotProbe: {
        status: 200,
        body: '<!doctype html><html><body>not a snapshot</body></html>',
        parsedBody: null,
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
        body: '<!doctype html><html><body>not a snapshot</body></html>',
        parsedBody: null,
      },
    }),
    true,
  );
});

test('packaged preflight retryability prefers the freshest index probe over conflicting snapshot fallback signals', () => {
  const labAuthRequiredPreflight = {
    status: 401,
    body: {
      code: 'reprint_push_lab_auth_required',
      message: 'Authenticated push routes require WordPress Application Password basic auth.',
    },
  };

  assert.equal(
    packagedProductionPluginPreflightRetryable(labAuthRequiredPreflight, {
      indexProbe: {
        status: 200,
        body: '<!doctype html><html><body>not a REST index</body></html>',
        parsedBody: null,
      },
      snapshotProbe: {
        status: 503,
        body: {
          details: {
            error: {
              code: 'wordpress_not_ready',
              message: 'WordPress is not ready yet',
            },
          },
        },
      },
    }),
    false,
  );
  assert.equal(
    packagedProductionPluginPreflightTerminal(labAuthRequiredPreflight, {
      indexProbe: {
        status: 200,
        body: '<!doctype html><html><body>not a REST index</body></html>',
        parsedBody: null,
      },
      snapshotProbe: {
        status: 503,
        body: {
          details: {
            error: {
              code: 'wordpress_not_ready',
              message: 'WordPress is not ready yet',
            },
          },
        },
      },
    }),
    true,
  );

  assert.equal(
    packagedProductionPluginPreflightRetryable(labAuthRequiredPreflight, {
      indexProbe: {
        status: 404,
        body: {
          details: {
            error_code: 'rest_no_route',
            reason: 'No route was found matching the URL and request method.',
          },
        },
      },
      snapshotProbe: {
        status: 200,
        body: {
          ok: true,
          note: 'missing snapshot payload should not override a fresher retryable index probe',
        },
      },
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginPreflightTerminal(labAuthRequiredPreflight, {
      indexProbe: {
        status: 404,
        body: {
          details: {
            error_code: 'rest_no_route',
            reason: 'No route was found matching the URL and request method.',
          },
        },
      },
      snapshotProbe: {
        status: 200,
        body: {
          ok: true,
          note: 'missing snapshot payload should not override a fresher retryable index probe',
        },
      },
    }),
    false,
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

test('packaged readiness helper counters and direct startup predicates stay fail-closed', () => {
  assert.equal(
    packagedProductionPluginReadinessProbeTimedOut(
      new Error('Timed out fetching http://127.0.0.1:8080/wp-json/'),
    ),
    true,
  );
  assert.equal(
    packagedProductionPluginReadinessProbeTimedOut(
      new Error('connect ECONNREFUSED 127.0.0.1:8080'),
    ),
    false,
  );

  assert.equal(
    packagedProductionPluginReadinessErrorRetryable({
      isPlaygroundReadinessFailure: true,
    }),
    false,
  );
  assert.equal(
    packagedProductionPluginReadinessErrorRetryable(
      new Error('ordinary fetch failure'),
    ),
    true,
  );

  assert.equal(
    packagedProductionPluginNextTimeoutProbeCount(
      2,
      new Error('Timed out fetching http://127.0.0.1:8080/wp-json/'),
    ),
    3,
  );
  assert.equal(
    packagedProductionPluginNextTimeoutProbeCount(
      2,
      new Error('socket hang up'),
    ),
    0,
  );

  assert.equal(
    packagedProductionPluginNextNotReadyProbeCount(
      1,
      503,
      'WordPress is not ready yet',
    ),
    2,
  );
  assert.equal(
    packagedProductionPluginNextNotReadyProbeCount(
      3,
      500,
      'Internal Server Error',
    ),
    0,
  );
  assert.equal(
    packagedProductionPluginNotReadyProbeLimitReached(4, 4),
    true,
  );
  assert.equal(
    packagedProductionPluginNotReadyProbeLimitReached(3, 4),
    false,
  );

  assert.equal(
    packagedProductionPluginRouteRetryableWhileWordPressStarting(
      404,
      'No route was found matching the URL and request method.',
      503,
      JSON.stringify({
        code: 'wordpress_not_ready',
        message: 'WordPress is not ready yet',
      }),
    ),
    true,
  );
  assert.equal(
    packagedProductionPluginRouteRetryableWhileWordPressStarting(
      404,
      'No route was found matching the URL and request method.',
      200,
      '<!doctype html><html><body>not a REST index</body></html>',
    ),
    false,
  );

  assert.equal(
    packagedProductionPluginRouteRetryableWhilePackagedRouteStarting(
      404,
      'No route was found matching the URL and request method.',
      200,
      JSON.stringify({
        namespaces: ['reprint/v1'],
        routes: {
          '/reprint/v1/push/preflight': {},
        },
      }),
    ),
    true,
  );
  assert.equal(
    packagedProductionPluginRouteRetryableWhilePackagedRouteStarting(
      404,
      'No route was found matching the URL and request method.',
      503,
      JSON.stringify({
        code: 'wordpress_not_ready',
        message: 'WordPress is not ready yet',
      }),
    ),
    false,
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
          id: 'session_123',
          status: 'active',
          type: 'production-auth-session',
          expiresAt: '2099-01-01T00:00:00Z',
          expired: false,
        },
        identity: {
          userLogin: 'admin',
          userId: 1,
        },
      },
      session: {
        id: 'session_123',
        type: 'production-auth-session',
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
          id: 'session_123',
          status: 'active',
          type: 'production-auth-session',
          expiresAt: '2099-01-01T00:00:00Z',
          expired: false,
        },
        identity: {
          userLogin: 'admin',
          userId: 1,
        },
      },
      session: {
        id: 'session_123',
        type: 'production-auth-session',
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

test('packaged server readiness fails closed for broken top-level signed preflight session envelopes', () => {
  const readySnapshot = {
    status: 200,
    body: {
      ok: true,
      snapshot: {
        posts: [],
      },
    },
  };
  const basePreflight = {
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
          id: 'session_123',
          status: 'active',
          type: 'production-auth-session',
          expiresAt: '2099-01-01T00:00:00Z',
        },
      },
      session: {
        id: 'session_123',
        type: 'production-auth-session',
      },
    },
  };

  const terminalEnvelopes = [
    {
      label: 'missing top-level session',
      session: undefined,
    },
    {
      label: 'missing top-level session id',
      session: {
        type: 'production-auth-session',
      },
    },
    {
      label: 'non-string top-level session id',
      session: {
        id: 123,
        type: 'production-auth-session',
      },
    },
    {
      label: 'wrong top-level session type',
      session: {
        id: 'session_123',
        type: 'lab-auth-session',
      },
    },
  ];

  for (const { label, session } of terminalEnvelopes) {
    const terminalPreflight = {
      ...basePreflight,
      body: {
        ...basePreflight.body,
        ...(session === undefined ? { session: undefined } : { session }),
      },
    };

    assert.equal(
      packagedProductionPluginPreflightReady(terminalPreflight),
      false,
      `${label} should not be considered ready`,
    );
    assert.equal(
      packagedProductionPluginPreflightRetryable(terminalPreflight),
      false,
      `${label} should fail closed instead of retrying`,
    );
    assert.equal(
      packagedProductionPluginPreflightTerminal(terminalPreflight),
      true,
      `${label} should be terminal`,
    );
    assert.equal(
      packagedProductionPluginServerReady({
        snapshot: readySnapshot,
        preflight: terminalPreflight,
      }),
      false,
      `${label} should keep the packaged server unready`,
    );
  }
});

test('packaged server readiness fails closed for broken top-level signed preflight auth envelopes', () => {
  const readySnapshot = {
    status: 200,
    body: {
      ok: true,
      snapshot: {
        posts: [],
      },
    },
  };
  const basePreflight = {
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
          id: 'session_123',
          status: 'active',
          type: 'production-auth-session',
          expiresAt: '2099-01-01T00:00:00Z',
        },
      },
      session: {
        id: 'session_123',
        type: 'production-auth-session',
      },
    },
  };

  const terminalEnvelopes = [
    {
      label: 'missing top-level auth',
      auth: undefined,
    },
    {
      label: 'missing top-level auth session',
      auth: {},
    },
  ];

  for (const { label, auth } of terminalEnvelopes) {
    const terminalPreflight = {
      ...basePreflight,
      body: {
        ...basePreflight.body,
        ...(auth === undefined ? { auth: undefined } : { auth }),
      },
    };

    assert.equal(
      packagedProductionPluginPreflightReady(terminalPreflight),
      false,
      `${label} should not be considered ready`,
    );
    assert.equal(
      packagedProductionPluginPreflightRetryable(terminalPreflight),
      false,
      `${label} should fail closed instead of retrying`,
    );
    assert.equal(
      packagedProductionPluginPreflightTerminal(terminalPreflight),
      true,
      `${label} should be terminal`,
    );
    assert.equal(
      packagedProductionPluginServerReady({
        snapshot: readySnapshot,
        preflight: terminalPreflight,
      }),
      false,
      `${label} should keep the packaged server unready`,
    );
  }
});

test('packaged preflight startup context still fails closed for broken top-level signed preflight session envelopes', () => {
  const basePreflight = {
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
          id: 'session_123',
          status: 'active',
          type: 'production-auth-session',
          expiresAt: '2099-01-01T00:00:00Z',
        },
      },
      session: {
        id: 'session_123',
        type: 'production-auth-session',
      },
    },
  };
  const startupContext = {
    packagedStartup: true,
    indexProbe: {
      status: 503,
      body: JSON.stringify({
        code: 'wordpress_not_ready',
        message: 'WordPress is not ready yet',
      }),
    },
    snapshotProbe: {
      status: 404,
      body: JSON.stringify({
        code: 'rest_no_route',
        message: 'No route was found matching the URL and request method.',
      }),
    },
  };
  const terminalEnvelopes = [
    {
      label: 'missing top-level session',
      session: undefined,
    },
    {
      label: 'missing top-level session id',
      session: {
        type: 'production-auth-session',
      },
    },
    {
      label: 'non-string top-level session id',
      session: {
        id: 123,
        type: 'production-auth-session',
      },
    },
    {
      label: 'wrong top-level session type',
      session: {
        id: 'session_123',
        type: 'lab-auth-session',
      },
    },
  ];

  for (const { label, session } of terminalEnvelopes) {
    const terminalPreflight = {
      ...basePreflight,
      body: {
        ...basePreflight.body,
        ...(session === undefined ? { session: undefined } : { session }),
      },
    };

    assert.equal(
      packagedProductionPluginPreflightRetryable(terminalPreflight, startupContext),
      false,
      `${label} should fail closed instead of inheriting packaged startup retryability`,
    );
    assert.equal(
      packagedProductionPluginPreflightTerminal(terminalPreflight, startupContext),
      true,
      `${label} should remain terminal even with packaged startup context`,
    );
  }
});

test('packaged preflight startup context still fails closed for broken top-level signed preflight auth envelopes', () => {
  const basePreflight = {
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
          id: 'session_123',
          status: 'active',
          type: 'production-auth-session',
          expiresAt: '2099-01-01T00:00:00Z',
        },
      },
      session: {
        id: 'session_123',
        type: 'production-auth-session',
      },
    },
  };
  const startupContext = {
    packagedStartup: true,
    indexProbe: {
      status: 503,
      body: JSON.stringify({
        code: 'wordpress_not_ready',
        message: 'WordPress is not ready yet',
      }),
    },
    snapshotProbe: {
      status: 404,
      body: JSON.stringify({
        code: 'rest_no_route',
        message: 'No route was found matching the URL and request method.',
      }),
    },
  };
  const terminalEnvelopes = [
    {
      label: 'missing top-level auth',
      auth: undefined,
    },
    {
      label: 'missing top-level auth session',
      auth: {},
    },
  ];

  for (const { label, auth } of terminalEnvelopes) {
    const terminalPreflight = {
      ...basePreflight,
      body: {
        ...basePreflight.body,
        ...(auth === undefined ? { auth: undefined } : { auth }),
      },
    };

    assert.equal(
      packagedProductionPluginPreflightRetryable(terminalPreflight, startupContext),
      false,
      `${label} should fail closed instead of inheriting packaged startup retryability`,
    );
    assert.equal(
      packagedProductionPluginPreflightTerminal(terminalPreflight, startupContext),
      true,
      `${label} should remain terminal even with packaged startup context`,
    );
  }
});

test('packaged preflight startup context still fails closed for broken production route profiles', () => {
  const basePreflight = {
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
          id: 'session_123',
          status: 'active',
          type: 'production-auth-session',
          expiresAt: '2099-01-01T00:00:00Z',
        },
        identity: {
          userLogin: 'admin',
          userId: 1,
        },
      },
      session: {
        id: 'session_123',
        type: 'production-auth-session',
      },
    },
  };
  const startupContext = {
    packagedStartup: true,
    indexProbe: {
      status: 503,
      body: JSON.stringify({
        code: 'wordpress_not_ready',
        message: 'WordPress is not ready yet',
      }),
    },
    snapshotProbe: {
      status: 404,
      body: JSON.stringify({
        code: 'rest_no_route',
        message: 'No route was found matching the URL and request method.',
      }),
    },
  };
  const terminalRouteProfiles = [
    {
      label: 'lab-backed route profile',
      routeProfile: {
        profile: 'production-shaped',
        restNamespace: 'reprint/v1',
        routePrefix: '/push',
        labBacked: true,
      },
    },
    {
      label: 'wrong route profile name',
      routeProfile: {
        profile: 'lab-authenticated',
        restNamespace: 'reprint/v1',
        routePrefix: '/push',
        labBacked: false,
      },
    },
    {
      label: 'wrong route namespace',
      routeProfile: {
        profile: 'production-shaped',
        restNamespace: 'reprint-push-lab/v1',
        routePrefix: '/push',
        labBacked: false,
      },
    },
    {
      label: 'wrong route prefix',
      routeProfile: {
        profile: 'production-shaped',
        restNamespace: 'reprint/v1',
        routePrefix: '/authenticated',
        labBacked: false,
      },
    },
  ];

  for (const { label, routeProfile } of terminalRouteProfiles) {
    const preflight = {
      ...basePreflight,
      body: {
        ...basePreflight.body,
        routeProfile,
      },
    };

    assert.equal(
      packagedProductionPluginPreflightRetryable(preflight, startupContext),
      false,
      `${label} should fail closed instead of inheriting packaged startup retryability`,
    );
    assert.equal(
      packagedProductionPluginPreflightTerminal(preflight, startupContext),
      true,
      `${label} should remain terminal even with packaged startup context`,
    );
  }
});

test('packaged server readiness fails closed for terminal production auth session states', () => {
  const readySnapshot = {
    status: 200,
    body: {
      ok: true,
      snapshot: {
        posts: [],
      },
    },
  };
  const basePreflight = {
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
          id: 'session_123',
          status: 'active',
          type: 'production-auth-session',
          expiresAt: '2099-01-01T00:00:00Z',
        },
        identity: {
          userLogin: 'admin',
          userId: 1,
        },
      },
      session: {
        id: 'session_123',
        type: 'production-auth-session',
      },
    },
  };

  assert.equal(packagedProductionPluginPreflightReady(basePreflight), true, 'base preflight should be ready');

  const terminalSessions = [
    {
      label: 'missing expiry',
      session: {
        status: 'active',
        type: 'production-auth-session',
      },
    },
    {
      label: 'past expiry',
      session: {
        status: 'active',
        type: 'production-auth-session',
        expiresAt: '2000-01-01T00:00:00Z',
      },
    },
    {
      label: 'invalid expiry',
      session: {
        status: 'active',
        type: 'production-auth-session',
        expiresAt: 'not-a-timestamp',
      },
    },
    {
      label: 'expired status',
      session: {
        status: 'expired',
        type: 'production-auth-session',
        expiresAt: '2099-01-01T00:00:00Z',
      },
    },
    {
      label: 'explicitly expired',
      session: {
        status: 'active',
        type: 'production-auth-session',
        expiresAt: '2099-01-01T00:00:00Z',
        expired: true,
      },
    },
    {
      label: 'revoked status',
      session: {
        status: 'revoked',
        type: 'production-auth-session',
        expiresAt: '2099-01-01T00:00:00Z',
      },
    },
    {
      label: 'explicitly revoked',
      session: {
        status: 'active',
        type: 'production-auth-session',
        expiresAt: '2099-01-01T00:00:00Z',
        revoked: true,
      },
    },
    {
      label: 'cleaned-up status',
      session: {
        status: 'cleaned-up',
        type: 'production-auth-session',
        expiresAt: '2099-01-01T00:00:00Z',
      },
    },
    {
      label: 'cleanup alias status',
      session: {
        status: 'cleaned_up',
        type: 'production-auth-session',
        expiresAt: '2099-01-01T00:00:00Z',
      },
    },
    {
      label: 'cleaned up',
      session: {
        status: 'active',
        type: 'production-auth-session',
        expiresAt: '2099-01-01T00:00:00Z',
        cleanedUp: true,
      },
    },
    {
      label: 'cleanup alias',
      session: {
        status: 'active',
        type: 'production-auth-session',
        expiresAt: '2099-01-01T00:00:00Z',
        cleanup: true,
      },
    },
    {
      label: 'rotated status',
      session: {
        status: 'rotated',
        type: 'production-auth-session',
        expiresAt: '2099-01-01T00:00:00Z',
      },
    },
    {
      label: 'explicitly rotated',
      session: {
        status: 'active',
        type: 'production-auth-session',
        expiresAt: '2099-01-01T00:00:00Z',
        rotated: true,
      },
    },
    {
      label: 'wrong auth session type',
      session: {
        status: 'active',
        type: 'lab-signed-push-session',
        expiresAt: '2099-01-01T00:00:00Z',
      },
    },
    {
      label: 'missing auth session status',
      session: {
        type: 'production-auth-session',
        expiresAt: '2099-01-01T00:00:00Z',
      },
    },
  ];

  for (const { label, session } of terminalSessions) {
    const terminalPreflight = {
      ...basePreflight,
      body: {
        ...basePreflight.body,
        auth: {
          ...basePreflight.body.auth,
          session,
        },
      },
    };

    assert.equal(
      packagedProductionPluginPreflightReady(terminalPreflight),
      false,
      `${label} should not be considered ready`,
    );
    assert.equal(
      packagedProductionPluginPreflightRetryable(terminalPreflight),
      false,
      `${label} should fail closed instead of retrying`,
    );
    assert.equal(
      packagedProductionPluginPreflightTerminal(terminalPreflight),
      true,
      `${label} should be terminal`,
    );
    assert.equal(
      packagedProductionPluginServerReady({
        snapshot: readySnapshot,
        preflight: terminalPreflight,
      }),
      false,
      `${label} should keep the packaged server unready`,
    );
  }
});

test('packaged preflight startup context still fails closed for terminal production auth session states', () => {
  const basePreflight = {
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
          id: 'session_123',
          status: 'active',
          type: 'production-auth-session',
          expiresAt: '2099-01-01T00:00:00Z',
        },
        identity: {
          userLogin: 'admin',
          userId: 1,
        },
      },
      session: {
        id: 'session_123',
        type: 'production-auth-session',
      },
    },
  };
  const startupContext = {
    packagedStartup: true,
    indexProbe: {
      status: 503,
      body: JSON.stringify({
        code: 'wordpress_not_ready',
        message: 'WordPress is not ready yet',
      }),
    },
    snapshotProbe: {
      status: 404,
      body: JSON.stringify({
        code: 'rest_no_route',
        message: 'No route was found matching the URL and request method.',
      }),
    },
  };

  const terminalSessions = [
    {
      label: 'missing expiry',
      session: {
        id: 'session_123',
        status: 'active',
        type: 'production-auth-session',
      },
    },
    {
      label: 'past expiry',
      session: {
        id: 'session_123',
        status: 'active',
        type: 'production-auth-session',
        expiresAt: '2000-01-01T00:00:00Z',
      },
    },
    {
      label: 'invalid expiry',
      session: {
        id: 'session_123',
        status: 'active',
        type: 'production-auth-session',
        expiresAt: 'not-a-timestamp',
      },
    },
    {
      label: 'expired status',
      session: {
        id: 'session_123',
        status: 'expired',
        type: 'production-auth-session',
        expiresAt: '2099-01-01T00:00:00Z',
      },
    },
    {
      label: 'explicitly expired',
      session: {
        id: 'session_123',
        status: 'active',
        type: 'production-auth-session',
        expiresAt: '2099-01-01T00:00:00Z',
        expired: true,
      },
    },
    {
      label: 'revoked status',
      session: {
        id: 'session_123',
        status: 'revoked',
        type: 'production-auth-session',
        expiresAt: '2099-01-01T00:00:00Z',
      },
    },
    {
      label: 'explicitly revoked',
      session: {
        id: 'session_123',
        status: 'active',
        type: 'production-auth-session',
        expiresAt: '2099-01-01T00:00:00Z',
        revoked: true,
      },
    },
    {
      label: 'cleaned-up status',
      session: {
        id: 'session_123',
        status: 'cleaned-up',
        type: 'production-auth-session',
        expiresAt: '2099-01-01T00:00:00Z',
      },
    },
    {
      label: 'cleanup alias status',
      session: {
        id: 'session_123',
        status: 'cleaned_up',
        type: 'production-auth-session',
        expiresAt: '2099-01-01T00:00:00Z',
      },
    },
    {
      label: 'cleaned-up marker',
      session: {
        id: 'session_123',
        status: 'active',
        type: 'production-auth-session',
        expiresAt: '2099-01-01T00:00:00Z',
        cleanedUp: true,
      },
    },
    {
      label: 'cleanup alias marker',
      session: {
        id: 'session_123',
        status: 'active',
        type: 'production-auth-session',
        expiresAt: '2099-01-01T00:00:00Z',
        cleanup: true,
      },
    },
    {
      label: 'rotated status',
      session: {
        id: 'session_123',
        status: 'rotated',
        type: 'production-auth-session',
        expiresAt: '2099-01-01T00:00:00Z',
      },
    },
    {
      label: 'explicitly rotated',
      session: {
        id: 'session_123',
        status: 'active',
        type: 'production-auth-session',
        expiresAt: '2099-01-01T00:00:00Z',
        rotated: true,
      },
    },
    {
      label: 'wrong auth session type',
      session: {
        id: 'session_123',
        status: 'active',
        type: 'lab-signed-push-session',
        expiresAt: '2099-01-01T00:00:00Z',
      },
    },
    {
      label: 'missing auth session status',
      session: {
        id: 'session_123',
        type: 'production-auth-session',
        expiresAt: '2099-01-01T00:00:00Z',
      },
    },
  ];

  for (const { label, session } of terminalSessions) {
    const terminalPreflight = {
      ...basePreflight,
      body: {
        ...basePreflight.body,
        auth: {
          ...basePreflight.body.auth,
          session,
        },
      },
    };

    assert.equal(
      packagedProductionPluginPreflightRetryable(terminalPreflight, startupContext),
      false,
      `${label} should fail closed instead of inheriting packaged startup retryability`,
    );
    assert.equal(
      packagedProductionPluginPreflightTerminal(terminalPreflight, startupContext),
      true,
      `${label} should remain terminal even with packaged startup context`,
    );
  }
});


test('packaged server readiness fails closed for mismatched or incomplete signed preflight session identities', () => {
  const readySnapshot = {
    status: 200,
    body: {
      ok: true,
      snapshot: {
        posts: [],
      },
    },
  };
  const basePreflight = {
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
          id: 'session_123',
          status: 'active',
          type: 'production-auth-session',
          expiresAt: '2099-01-01T00:00:00Z',
        },
        identity: {
          userLogin: 'admin',
          userId: 1,
        },
      },
      session: {
        id: 'session_123',
        type: 'production-auth-session',
      },
    },
  };

  assert.equal(packagedProductionPluginPreflightReady(basePreflight), true, 'base preflight should be ready');

  const identityCases = [
    {
      label: 'mismatched ids',
      preflight: {
        ...basePreflight,
        body: {
          ...basePreflight.body,
          auth: {
            ...basePreflight.body.auth,
            session: {
              ...basePreflight.body.auth.session,
              id: 'session_456',
            },
          },
        },
      },
    },
    {
      label: 'missing auth session id',
      preflight: {
        ...basePreflight,
        body: {
          ...basePreflight.body,
          auth: {
            ...basePreflight.body.auth,
            session: {
              status: 'active',
              type: 'production-auth-session',
              expiresAt: '2099-01-01T00:00:00Z',
            },
          },
        },
      },
    },
    {
      label: 'non-string auth session id',
      preflight: {
        ...basePreflight,
        body: {
          ...basePreflight.body,
          auth: {
            ...basePreflight.body.auth,
            session: {
              ...basePreflight.body.auth.session,
              id: 123,
            },
          },
        },
      },
    },
    {
      label: 'non-string top-level session id',
      preflight: {
        ...basePreflight,
        body: {
          ...basePreflight.body,
          session: {
            id: 123,
            type: 'production-auth-session',
          },
        },
      },
    },
  ];

  for (const { label, preflight } of identityCases) {
    assert.equal(packagedProductionPluginPreflightReady(preflight), false, `${label} should not be ready`);
    assert.equal(packagedProductionPluginPreflightRetryable(preflight), false, `${label} should fail closed`);
    assert.equal(packagedProductionPluginPreflightTerminal(preflight), true, `${label} should be terminal`);
    assert.equal(
      packagedProductionPluginServerReady({
        snapshot: readySnapshot,
        preflight,
      }),
      false,
      `${label} should keep the packaged server unready`,
    );
  }
});

test('packaged preflight startup context still fails closed for mismatched or incomplete signed preflight session identities', () => {
  const basePreflight = {
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
          id: 'session_123',
          status: 'active',
          type: 'production-auth-session',
          expiresAt: '2099-01-01T00:00:00Z',
        },
        identity: {
          userLogin: 'admin',
          userId: 1,
        },
      },
      session: {
        id: 'session_123',
        type: 'production-auth-session',
      },
    },
  };
  const startupContext = {
    packagedStartup: true,
    indexProbe: {
      status: 503,
      body: JSON.stringify({
        code: 'wordpress_not_ready',
        message: 'WordPress is not ready yet',
      }),
    },
    snapshotProbe: {
      status: 404,
      body: JSON.stringify({
        code: 'rest_no_route',
        message: 'No route was found matching the URL and request method.',
      }),
    },
  };
  const identityCases = [
    {
      label: 'mismatched ids',
      preflight: {
        ...basePreflight,
        body: {
          ...basePreflight.body,
          auth: {
            ...basePreflight.body.auth,
            session: {
              ...basePreflight.body.auth.session,
              id: 'session_456',
            },
          },
        },
      },
    },
    {
      label: 'missing auth session id',
      preflight: {
        ...basePreflight,
        body: {
          ...basePreflight.body,
          auth: {
            ...basePreflight.body.auth,
            session: {
              status: 'active',
              type: 'production-auth-session',
              expiresAt: '2099-01-01T00:00:00Z',
            },
          },
        },
      },
    },
    {
      label: 'non-string auth session id',
      preflight: {
        ...basePreflight,
        body: {
          ...basePreflight.body,
          auth: {
            ...basePreflight.body.auth,
            session: {
              ...basePreflight.body.auth.session,
              id: 123,
            },
          },
        },
      },
    },
    {
      label: 'non-string top-level session id',
      preflight: {
        ...basePreflight,
        body: {
          ...basePreflight.body,
          session: {
            id: 123,
            type: 'production-auth-session',
          },
        },
      },
    },
  ];

  for (const { label, preflight } of identityCases) {
    assert.equal(
      packagedProductionPluginPreflightRetryable(preflight, startupContext),
      false,
      `${label} should fail closed instead of inheriting packaged startup retryability`,
    );
    assert.equal(
      packagedProductionPluginPreflightTerminal(preflight, startupContext),
      true,
      `${label} should remain terminal even with packaged startup context`,
    );
  }
});

test('packaged server readiness fails closed for broken top-level auth envelopes', () => {
  const readySnapshot = {
    status: 200,
    body: {
      ok: true,
      snapshot: {
        posts: [],
      },
    },
  };
  const brokenAuthEnvelopes = [
    {
      label: 'missing top-level auth',
      body: {
        ok: true,
        routeProfile: {
          profile: 'production-shaped',
          restNamespace: 'reprint/v1',
          routePrefix: '/push',
          labBacked: false,
        },
        session: {
          id: 'session_123',
          type: 'production-auth-session',
        },
      },
    },
    {
      label: 'missing top-level auth session',
      body: {
        ok: true,
        routeProfile: {
          profile: 'production-shaped',
          restNamespace: 'reprint/v1',
          routePrefix: '/push',
          labBacked: false,
        },
        auth: {},
        session: {
          id: 'session_123',
          type: 'production-auth-session',
        },
      },
    },
  ];

  for (const { label, body } of brokenAuthEnvelopes) {
    const preflight = {
      status: 200,
      body,
    };

    assert.equal(packagedProductionPluginPreflightReady(preflight), false, `${label} should not be ready`);
    assert.equal(packagedProductionPluginPreflightRetryable(preflight), false, `${label} should fail closed`);
    assert.equal(packagedProductionPluginPreflightTerminal(preflight), true, `${label} should be terminal`);
    assert.equal(
      packagedProductionPluginServerReady({
        snapshot: readySnapshot,
        preflight,
      }),
      false,
      `${label} should keep the packaged server unready`,
    );
  }
});

test('packaged server readiness fails closed for broken signed preflight auth identities', () => {
  const readySnapshot = {
    status: 200,
    body: {
      ok: true,
      snapshot: {
        posts: [],
      },
    },
  };
  const basePreflight = {
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
          id: 'session_123',
          status: 'active',
          type: 'production-auth-session',
          expiresAt: '2099-01-01T00:00:00Z',
        },
        identity: {
          userLogin: 'admin',
          userId: 1,
        },
      },
      session: {
        id: 'session_123',
        type: 'production-auth-session',
      },
    },
  };
  const identityCases = [
    {
      label: 'missing auth identity',
      auth: {
        session: basePreflight.body.auth.session,
      },
    },
    {
      label: 'missing auth identity userLogin',
      auth: {
        ...basePreflight.body.auth,
        identity: {
          userId: 1,
        },
      },
    },
    {
      label: 'blank auth identity userLogin',
      auth: {
        ...basePreflight.body.auth,
        identity: {
          userLogin: '   ',
          userId: 1,
        },
      },
    },
    {
      label: 'non-string auth identity userLogin',
      auth: {
        ...basePreflight.body.auth,
        identity: {
          userLogin: 7,
          userId: 1,
        },
      },
    },
    {
      label: 'missing auth identity userId',
      auth: {
        ...basePreflight.body.auth,
        identity: {
          userLogin: 'admin',
        },
      },
    },
    {
      label: 'non-positive auth identity userId',
      auth: {
        ...basePreflight.body.auth,
        identity: {
          userLogin: 'admin',
          userId: 0,
        },
      },
    },
    {
      label: 'string auth identity userId',
      auth: {
        ...basePreflight.body.auth,
        identity: {
          userLogin: 'admin',
          userId: '1',
        },
      },
    },
  ];

  for (const { label, auth } of identityCases) {
    const preflight = {
      ...basePreflight,
      body: {
        ...basePreflight.body,
        auth,
      },
    };

    assert.equal(packagedProductionPluginPreflightReady(preflight), false, `${label} should not be ready`);
    assert.equal(packagedProductionPluginPreflightRetryable(preflight), false, `${label} should fail closed`);
    assert.equal(packagedProductionPluginPreflightTerminal(preflight), true, `${label} should be terminal`);
    assert.equal(
      packagedProductionPluginServerReady({
        snapshot: readySnapshot,
        preflight,
      }),
      false,
      `${label} should keep the packaged server unready`,
    );
  }
});

test('packaged preflight startup context still fails closed for broken signed preflight auth identities', () => {
  const basePreflight = {
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
          id: 'session_123',
          status: 'active',
          type: 'production-auth-session',
          expiresAt: '2099-01-01T00:00:00Z',
        },
        identity: {
          userLogin: 'admin',
          userId: 1,
        },
      },
      session: {
        id: 'session_123',
        type: 'production-auth-session',
      },
    },
  };
  const startupContext = {
    packagedStartup: true,
    indexProbe: {
      status: 503,
      body: JSON.stringify({
        code: 'wordpress_not_ready',
        message: 'WordPress is not ready yet',
      }),
    },
    snapshotProbe: {
      status: 404,
      body: JSON.stringify({
        code: 'rest_no_route',
        message: 'No route was found matching the URL and request method.',
      }),
    },
  };
  const identityCases = [
    {
      label: 'missing auth identity',
      auth: {
        session: basePreflight.body.auth.session,
      },
    },
    {
      label: 'missing auth identity userLogin',
      auth: {
        ...basePreflight.body.auth,
        identity: {
          userId: 1,
        },
      },
    },
    {
      label: 'blank auth identity userLogin',
      auth: {
        ...basePreflight.body.auth,
        identity: {
          userLogin: '   ',
          userId: 1,
        },
      },
    },
    {
      label: 'non-string auth identity userLogin',
      auth: {
        ...basePreflight.body.auth,
        identity: {
          userLogin: 7,
          userId: 1,
        },
      },
    },
    {
      label: 'missing auth identity userId',
      auth: {
        ...basePreflight.body.auth,
        identity: {
          userLogin: 'admin',
        },
      },
    },
    {
      label: 'non-positive auth identity userId',
      auth: {
        ...basePreflight.body.auth,
        identity: {
          userLogin: 'admin',
          userId: 0,
        },
      },
    },
    {
      label: 'string auth identity userId',
      auth: {
        ...basePreflight.body.auth,
        identity: {
          userLogin: 'admin',
          userId: '1',
        },
      },
    },
  ];

  for (const { label, auth } of identityCases) {
    const preflight = {
      ...basePreflight,
      body: {
        ...basePreflight.body,
        auth,
      },
    };

    assert.equal(
      packagedProductionPluginPreflightRetryable(preflight, startupContext),
      false,
      `${label} should fail closed instead of inheriting packaged startup retryability`,
    );
    assert.equal(
      packagedProductionPluginPreflightTerminal(preflight, startupContext),
      true,
      `${label} should remain terminal even with packaged startup context`,
    );
  }
});
