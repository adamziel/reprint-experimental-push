#!/usr/bin/env node

const releaseCommand = 'timeout 300s npm run verify:release';
const liveSourceUrl = process.env.REPRINT_PUSH_SOURCE_URL || '';
const username = process.env.REPRINT_PUSH_USERNAME || '';
const applicationPassword = process.env.REPRINT_PUSH_APPLICATION_PASSWORD || '';
const authSessionSourceCommand = process.env.REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND || '';
const requireProductionAuthSession = process.env.REPRINT_PUSH_REQUIRE_PRODUCTION_AUTH_SESSION === '1';
const requireProductionDurableJournal = process.env.REPRINT_PUSH_REQUIRE_PRODUCTION_DURABLE_JOURNAL === '1';
const preservedRemoteRetryPath = process.env.REPRINT_PUSH_SIMULATE_PRESERVED_REMOTE_RETRY_PATH || '/snapshot';

const gates = {
  'GATE-1': 'support_only',
  'GATE-2': 'support_only',
  'GATE-3': 'support_only',
  'GATE-4': 'support_only',
};

const ignoredFallbackInputs = {
  remoteUrlPresent: Boolean(process.env.REPRINT_PUSH_REMOTE_URL),
  labAuthUserPresent: Boolean(process.env.REPRINT_PUSH_LAB_AUTH_ADMIN_USER),
  labAuthApplicationPasswordPresent: Boolean(process.env.REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD),
  packagedSourceCommandRequested: isPackagedSourceCommand(authSessionSourceCommand),
};

if (!liveSourceUrl) {
  failClosed({
    code: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
    message:
      'production push requires a real live REPRINT_PUSH_SOURCE_URL before preflight, dry-run, apply, or gate movement',
    topology: {
      sourceUrl: '',
      releaseMovementAllowed: false,
      reason: 'missing REPRINT_PUSH_SOURCE_URL',
    },
    boundary: {
      firstRemainingProductionBoundary: 'explicit live REPRINT_PUSH_SOURCE_URL',
      verdict: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
    },
    observed: 'missing-live-source',
  });
}

let parsedSourceUrl = null;
try {
  parsedSourceUrl = new URL(liveSourceUrl);
} catch {
  failClosed({
    code: 'REPRINT_PUSH_LIVE_SOURCE_INVALID',
    message: 'REPRINT_PUSH_SOURCE_URL must be an absolute http(s) URL',
    topology: {
      sourceUrl: liveSourceUrl,
      releaseMovementAllowed: false,
      reason: 'invalid REPRINT_PUSH_SOURCE_URL',
    },
    boundary: {
      firstRemainingProductionBoundary: 'valid live REPRINT_PUSH_SOURCE_URL',
      verdict: 'REPRINT_PUSH_LIVE_SOURCE_INVALID',
    },
    observed: 'invalid-live-source',
  });
}

if (!['http:', 'https:'].includes(parsedSourceUrl.protocol)) {
  failClosed({
    code: 'REPRINT_PUSH_LIVE_SOURCE_INVALID',
    message: 'REPRINT_PUSH_SOURCE_URL must use http or https',
    topology: {
      sourceUrl: redactUrl(liveSourceUrl),
      releaseMovementAllowed: false,
      reason: 'unsupported REPRINT_PUSH_SOURCE_URL protocol',
    },
    boundary: {
      firstRemainingProductionBoundary: 'valid live REPRINT_PUSH_SOURCE_URL',
      verdict: 'REPRINT_PUSH_LIVE_SOURCE_INVALID',
    },
    observed: parsedSourceUrl.protocol,
  });
}

if (!username || !applicationPassword) {
  failClosed({
    code: 'REPRINT_PUSH_SECRET_REQUIRED',
    message: 'production release verification requires explicit live source credentials',
    topology: {
      sourceUrl: redactUrl(liveSourceUrl),
      releaseMovementAllowed: false,
      reason: 'missing REPRINT_PUSH_USERNAME or REPRINT_PUSH_APPLICATION_PASSWORD',
    },
    boundary: {
      firstRemainingProductionBoundary: 'production auth/session lifecycle',
      verdict: 'REPRINT_PUSH_SECRET_REQUIRED',
    },
    observed: 'missing-production-credentials',
  });
}

if (requireProductionAuthSession && !authSessionSourceCommand) {
  failClosed({
    code: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    message:
      'production release verification requires an executable auth-session source for issuance and readback',
    topology: {
      sourceUrl: redactUrl(liveSourceUrl),
      releaseMovementAllowed: false,
      reason: 'missing REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND',
    },
    boundary: {
      firstRemainingProductionBoundary: 'auth/session issuance and readback from the same source command',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    },
    observed: 'missing-auth-session-source-command',
  });
}

failClosed({
  code: 'REPRINT_PUSH_RELEASE_VERIFIER_NOT_RECONCILED',
  message:
    'the live release verifier is present as the canonical command, but this integration has not reconciled enough reliable-executor proof code to mutate or move gates',
  topology: {
    sourceUrl: redactUrl(liveSourceUrl),
    releaseMovementAllowed: false,
    reason: 'required production proofs are not yet executable on this integration branch',
  },
  boundary: {
    firstRemainingProductionBoundary:
      'live auth/session readback, durable journal lease fencing, preserved rejected-remote evidence, and apply-time revalidation',
    verdict: 'REPRINT_PUSH_RELEASE_VERIFIER_NOT_RECONCILED',
  },
  observed: 'proof-code-not-reconciled',
});

function failClosed({
  code,
  message,
  topology,
  boundary,
  observed,
}) {
  const summary = {
    ok: false,
    command: releaseCommand,
    code,
    message,
    topology: {
      sourceUrl: topology.sourceUrl,
      remoteChangedUrl: process.env.REPRINT_PUSH_REMOTE_CHANGED_URL || null,
      localUrl: process.env.REPRINT_PUSH_LOCAL_URL || null,
      runner: 'release-boundary-integrator',
      ingressPort: 8080,
      remoteTunnels: 'disallowed',
      releaseMovementAllowed: false,
      reason: topology.reason,
      fallbackSourcesAllowed: false,
      packagedSourceAllowed: false,
      labSourceAllowed: false,
      fixtureSourceAllowed: false,
      ignoredFallbackInputs,
    },
    requirements: {
      liveSourceUrl: {
        env: 'REPRINT_PUSH_SOURCE_URL',
        required: true,
        observed,
      },
      authSession: {
        required: requireProductionAuthSession,
        sourceCommandRequired: requireProductionAuthSession,
        sourceCommandPresent: Boolean(authSessionSourceCommand),
        verdict: requireProductionAuthSession
          ? 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED'
          : 'not-required-by-env',
      },
      durableJournal: {
        required: requireProductionDurableJournal,
        ownsJournal: false,
        restartReadable: false,
        leaseFenced: false,
        verdict: requireProductionDurableJournal
          ? 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED'
          : 'not-required-by-env',
      },
      preservedRejectedRemoteEvidence: {
        requiredPath: preservedRemoteRetryPath,
        preserved: false,
        verdict: 'PRESERVED_REMOTE_RETRY_REQUIRED',
      },
      applyTimeRevalidation: {
        requiredBeforeFirstMutation: true,
        proven: false,
        verdict: 'APPLY_TIME_REVALIDATION_REQUIRED',
      },
    },
    boundary: {
      status: 'blocked',
      gates,
      releaseVerdict: '0/4',
      gatesMoved: [],
      ...boundary,
    },
    releaseProof: {
      ok: false,
      code,
      structuredJson: true,
      gateMovementAllowed: false,
    },
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.stderr.write(`${code}: ${message}\n`);
  process.exit(1);
}

function isPackagedSourceCommand(command) {
  return /packaged-production-plugin|package-smoke|fixture/i.test(command || '');
}

function redactUrl(value) {
  const url = new URL(value);
  url.username = '';
  url.password = '';
  url.hash = '';
  return url.toString();
}
