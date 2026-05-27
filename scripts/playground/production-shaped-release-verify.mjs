#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import fs from 'node:fs';
import { writeSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticatedHttpClient, runAuthenticatedHttpPush } from '../../src/authenticated-http-push-client.js';
import { digest } from '../../src/stable-json.js';
import {
  loadAuthSessionSource,
  resolveAuthSessionSourceCredentials,
} from './auth-session-source.js';
import { evaluateProductionAuthSessionLifecycle } from './production-auth-session-lifecycle.js';
import {
  bindPackagedProductionPluginRuntimeSource,
  isPackagedProductionPluginSourceCommand,
  resolvePackagedProductionPluginAuthSessionRequest,
  resolvePackagedProductionPluginAuthSessionSource,
} from './packaged-production-plugin-source-command.js';
import {
  labMaxConsecutiveNotReadyProbes,
  labReadinessBodyRetryable,
  labReadinessErrorRetryable,
  labNotReadyProbeLimitReached,
  labNextTimeoutProbeCount,
  labReadinessProbeTimedOut,
  labSnapshotReady,
  labSnapshotRetryable,
} from './lab-playground-readiness.js';
import {
  packagedProductionPluginClassifyBoundedStartup,
  packagedProductionPluginClassifyTimeoutFallbackStartup,
  packagedProductionPluginMalformedTerminalIndexProbe,
  packagedProductionPluginMaxConsecutiveNotReadyProbes,
  packagedProductionPluginReadinessBodyRetryable,
  packagedProductionPluginReadinessErrorRetryable,
  packagedProductionPluginNextRouteNotReadyProbeCounts,
  packagedProductionPluginNextTimeoutProbeCount,
  packagedProductionPluginNotReadyProbeLimitReached,
  packagedProductionPluginPackagedRouteStartupStillWithinBudget,
  packagedProductionPluginPackagedRouteStartupLimitReached,
  packagedProductionPluginPreflightTerminalContext,
  packagedProductionPluginPreflightReady,
  packagedProductionPluginPreflightRetryable,
  packagedProductionPluginReadinessProbeTimedOut,
  packagedProductionPluginResetRouteNotReadyProbeCounts,
  packagedProductionPluginServerReady,
  packagedProductionPluginSnapshotProbeContext,
  packagedProductionPluginSnapshotRetryable,
} from './packaged-production-plugin-readiness.js';
import { loadBlueprintSnapshotFixture } from './blueprint-snapshot-fixture.js';
import {
  appendRecoveryClaimOpened,
  consumeProductionRecoveryJournal,
  openProductionRecoveryJournal,
} from '../../src/recovery-journal.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const muPluginDir = path.join(repoRoot, 'scripts/playground/rest-mu-plugins');
const readinessProbeIntervalMs = 200;
const readinessFailureBodyLimit = 240;
// The release verifier starts remote-base, remote-changed, and local-edited in
// sequence, and the shared remote-changed/local-edited fixtures routinely take
// longer to clear global WordPress startup than the earlier single-server
// smoke path.
const serverStartupTimeoutMs = 120_000;
const serverFetchTimeoutMs = 1_000;
// The packaged plugin path still has to boot WordPress, mount the packaged
// plugin, and clear signed preflight readiness before the verifier can move on
// to the release boundary. Keep a slightly wider packaged startup budget than
// the earlier smoke-era default so the checked verifier does not fail at the
// last avoidable startup boundary first.
const packagedPlaygroundTimeoutSeconds = 45;
const packagedServerStartupTimeoutMs = packagedPlaygroundTimeoutSeconds * 1_000;
const packagedServerFetchTimeoutMs = 3_000;
const packagedSnapshotExportTimeoutMs = 45_000;
const maxReadinessProbes = Math.max(10, Math.ceil(serverStartupTimeoutMs / readinessProbeIntervalMs));
const maxNotReadyReadinessProbes = Math.max(labMaxConsecutiveNotReadyProbes, maxReadinessProbes);
// Shared remote-changed/local-edited fixtures can clear /wp-json/ global
// readiness before the lab snapshot route finishes booting. Keep a bounded
// post-global-ready window so the verifier does not fail at this last startup
// branch after only four probes.
const maxSnapshotStartupAfterGlobalReadyProbes = Math.max(
  labMaxConsecutiveNotReadyProbes,
  Math.ceil(15_000 / (serverFetchTimeoutMs + readinessProbeIntervalMs)),
);
// Snapshot fetches can time out transiently while /wp-json/ is still clearly in
// startup. Give that fallback a slightly wider bounded budget than the base
// four-probe classifier without letting it consume the entire startup window.
const maxSnapshotTimeoutFallbackProbes = Math.max(
  labMaxConsecutiveNotReadyProbes,
  Math.ceil(15_000 / (serverFetchTimeoutMs + readinessProbeIntervalMs)),
);
// The packaged route can still lag behind global /wp-json/ readiness while the
// packaged plugin finishes mounting its production-shaped endpoints. Keep a
// bounded post-global-ready window so the verifier does not fail on the same
// avoidable last-mile startup branch after only four probes.
const maxPackagedRouteStartupAfterGlobalReadyProbes = Math.max(
  packagedProductionPluginMaxConsecutiveNotReadyProbes,
  Math.ceil(15_000 / (packagedServerFetchTimeoutMs + readinessProbeIntervalMs)),
);
const maxPackagedStartupNotReadyProbeCount = Math.max(
  packagedProductionPluginMaxConsecutiveNotReadyProbes,
  Math.ceil(packagedServerStartupTimeoutMs / readinessProbeIntervalMs),
);
const credentials = {
  username: 'reprint_push_admin',
  password: 'reprint-push-admin-app-password',
};
const requireProductionDurableJournal = process.env.REPRINT_PUSH_REQUIRE_PRODUCTION_DURABLE_JOURNAL === '1';
const requireProductionAuthSession = process.env.REPRINT_PUSH_REQUIRE_PRODUCTION_AUTH_SESSION === '1';
const labAuthSessionDrift = process.env.REPRINT_PUSH_LAB_AUTH_SESSION_DRIFT || '';
let liveSourceUrl = process.env.REPRINT_PUSH_SOURCE_URL || process.env.REPRINT_PUSH_REMOTE_URL || '';
let username = process.env.REPRINT_PUSH_LAB_AUTH_ADMIN_USER || process.env.REPRINT_PUSH_USERNAME || '';
let applicationPassword = process.env.REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD || process.env.REPRINT_PUSH_APPLICATION_PASSWORD || '';
const liveAuthSessionSourceBlocker = {
  requiredCommand: 'REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND',
  verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
};
let authSessionSourceCommand = process.env.REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND || '';
let authSessionSource = authSessionSourceCommand ? loadAuthSessionSource(authSessionSourceCommand) : null;
let packagedProductionPluginAuthSessionSource = null;
let packagedProductionPluginRequested = isPackagedProductionPluginSourceCommand(authSessionSourceCommand);

if (authSessionSource?.ok) {
  const resolvedAuthSessionSource = resolveAuthSessionSourceCredentials({
    liveSourceUrl,
    username: credentials.username,
    applicationPassword: credentials.password,
  }, authSessionSource, {
    preferSource: requireProductionAuthSession,
  });
  // When a live auth-session source is supplied, prefer it over any stale lab
  // credentials already present in the environment.
  liveSourceUrl = resolvedAuthSessionSource.liveSourceUrl;
  credentials.username = resolvedAuthSessionSource.username;
  credentials.password = resolvedAuthSessionSource.applicationPassword;
}

if (
  requireProductionAuthSession &&
  credentials.username &&
  credentials.password
) {
  const packagedProductionPluginAuthSessionRequest = resolvePackagedProductionPluginAuthSessionRequest({
    sourceUrl: liveSourceUrl || 'http://127.0.0.1:8080',
    username: credentials.username,
    applicationPassword: credentials.password,
    authSessionSourceCommand,
  });
  packagedProductionPluginAuthSessionSource = packagedProductionPluginAuthSessionRequest;
  packagedProductionPluginRequested = packagedProductionPluginAuthSessionRequest.requested;
}

if (packagedProductionPluginAuthSessionSource?.source.ok) {
  authSessionSourceCommand = packagedProductionPluginAuthSessionSource.command;
  authSessionSource = packagedProductionPluginAuthSessionSource.source;
  if (!liveSourceUrl) {
    liveSourceUrl = packagedProductionPluginAuthSessionSource.source.sourceUrl || liveSourceUrl;
  }
  if (!username) {
    username = packagedProductionPluginAuthSessionSource.source.username || username;
  }
  if (!applicationPassword) {
    applicationPassword = packagedProductionPluginAuthSessionSource.source.applicationPassword || applicationPassword;
  }
}

function summarizeAuthSessionSource(command, source) {
  if (!command) {
    return null;
  }

  return {
    command,
    ok: Boolean(source?.ok),
    sourceUrl: source?.sourceUrl || '',
    username: source?.username || '',
    applicationPasswordPresent: Boolean(source?.applicationPassword),
    error: source?.error || '',
  };
}

class ProofFailure extends Error {
  constructor() {
    super('production-shaped release verify failed closed');
    this.name = 'ProofFailure';
  }
}

let topLevelError = null;
const activePlaygroundChildren = new Set();
let stopAllPlaygroundChildren = async () => {};
let stopAllPlaygroundChildrenSync = () => {};

try {

const protocolExtension = {
  stages: [
    'preflight',
    'remote-snapshot-hashes',
    'dry-run-plan-upload',
    'mutation-batch-apply',
    'journal-inspect',
    'recovery-inspect',
    'recovery-mutate',
  ],
  pullToPushMapping: {
    exporter: 'discovers the merge base and coverage evidence before any push request exists',
    importer: 'persists the immutable pull base package as the only origin push may consume',
    preflight: 'binds the imported pull provenance to one live remote identity and a short-lived push session',
    remoteSnapshotHashes: 'turns importer provenance into planning-only remote hash discovery',
    dryRunPlanUpload: 'turns the immutable base package into a receipt-only plan with no mutation authority',
    mutationBatchApply: 'revalidates fresh live evidence before every batch and again at the storage boundary',
    journalInspect: 'reads durable provenance without authorizing mutation',
    recoveryInspect: 'classifies recovery before any repair mutation begins',
    recoveryMutate: 'requires inspect plus fresh live evidence and the same HMAC floor as apply',
  },
  gateDependencies: {
    productionAuthSession:
      'production-backed auth/session issuance, read, expiry, rotation, revocation, and cleanup on the checked release path',
    durableJournal:
      'production durable journal storage with lease fencing, restart-readable artifacts, and release-path consumption',
    replayAndRetry:
      'checked live replay equivalence plus preserved-remote retry on the release verifier path',
  },
  topology: {
    remoteBase: 'remote-base',
    localEdited: 'local-edited',
    remoteChanged: 'remote-changed',
    runner: 'runner',
    ingressPort: 8080,
    localOnlyProxy: true,
    remoteTunnels: 'disallowed',
  },
};

const labDriftAfterSnapshot = process.env.REPRINT_PUSH_LAB_DRIFT_AFTER_SNAPSHOT || '';

if ((!liveSourceUrl || !username || !applicationPassword) && authSessionSourceCommand) {
  if (!liveSourceUrl) {
    liveSourceUrl = authSessionSource.sourceUrl || liveSourceUrl;
  }
  if (!username) {
    username = authSessionSource.username || username;
  }
  if (!applicationPassword) {
    applicationPassword = authSessionSource.applicationPassword || applicationPassword;
  }
}

if (liveSourceUrl && (!username || !applicationPassword)) {
  process.stdout.write(
    JSON.stringify(
      {
        ok: false,
        topology: {
          sourceUrl: liveSourceUrl,
          remoteBase: null,
          remoteChanged: null,
          localEdited: null,
        },
        boundary: {
          firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
          status: 'unimplemented',
          verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
          durableJournal: {
            storageLeaseFence: 'production durable journal storage, lease, and fencing are not yet proven beyond the retained Playground journal path',
            verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
          },
          authSession: {
            required: 'production-auth-session',
            observed: 'missing-production-credentials',
            verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
          },
          liveAuthSessionSource: {
            ...liveAuthSessionSourceBlocker,
            observed: 'missing-production-credentials',
          },
        },
        protocolExtension,
        preflight: {
          status: 0,
          authSessionType: 'missing-production-credentials',
          routeProfile: 'production-shaped',
          session: {
            id: '',
            type: 'missing-production-credentials',
          },
        },
        releaseProof: {
          ok: false,
          status: 1,
          code: 'REPRINT_PUSH_SECRET_REQUIRED',
        },
        authSessionSource: summarizeAuthSessionSource(authSessionSourceCommand, authSessionSource),
      },
      null,
      2,
    ),
  );
  process.stdout.write('\n');
  throw new ProofFailure();
}

if (requireProductionDurableJournal && !liveSourceUrl) {
  process.stdout.write(
    JSON.stringify(
      {
        ok: false,
        topology: {
          sourceUrl: liveSourceUrl,
          remoteBase: null,
          remoteChanged: null,
          localEdited: null,
        },
        boundary: {
          firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
          status: 'unimplemented',
          verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
          durableJournal: {
            storageLeaseFence: 'retained Playground journal storage is lab-scoped; production ownership, lease fencing, and replay wiring are not yet proven on the checked release boundary',
            verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
          },
        },
        protocolExtension,
        releaseProof: {
          ok: false,
          status: 501,
          code: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
        },
        authSessionSource: summarizeAuthSessionSource(authSessionSourceCommand, authSessionSource),
      },
      null,
      2,
    ),
  );
  process.stdout.write('\n');
  throw new ProofFailure();
}

const retainedSourceSummaryRequested =
  !liveSourceUrl &&
  !process.env.REPRINT_PUSH_REMOTE_URL &&
  !process.env.REPRINT_PUSH_LAB_AUTH_ADMIN_USER &&
  !process.env.REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD &&
  !process.env.REPRINT_PUSH_USERNAME &&
  !process.env.REPRINT_PUSH_APPLICATION_PASSWORD &&
  !process.env.REPRINT_PUSH_SIGNING_SECRET;

if (retainedSourceSummaryRequested) {
  const durableJournalProof = runBoundedSync(
    process.execPath,
    ['scripts/recovery/file-journal-restart-smoke.mjs'],
    {
      cwd: process.cwd(),
      timeout: 10_000,
      killSignal: 'SIGKILL',
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 20,
      env: {
        ...process.env,
        NODE_NO_WARNINGS: '1',
      },
    },
    'durable journal smoke',
  );
  assert.equal(durableJournalProof.status, 0, durableJournalProof.stderr || durableJournalProof.stdout);

  const durableJournalSummary = JSON.parse(durableJournalProof.stdout);
  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        topology: {
          sourceUrl: 'http://127.0.0.1:8080',
          remoteBase: 'remote-base',
          remoteChanged: 'remote-changed',
          localEdited: 'local-edited',
        },
        remoteSnapshotHashes: {
          sameRemoteIdentity: true,
          baseHash: durableJournalSummary.plan.planHash,
          changedHash: durableJournalSummary.plan.planHash,
        },
        boundary: {
          firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
          status: 'unimplemented',
          verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
          durableJournal: {
            storageLeaseFence: 'retained Playground journal storage is lab-scoped; production ownership, lease fencing, and replay wiring are not yet proven on the checked release boundary',
            verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
          },
        },
        protocolExtension,
        preflight: {
          status: 0,
          authSessionType: 'retained-playground-journal-proof',
          routeProfile: 'production-shaped',
          session: {
            id: '',
            type: 'retained-playground-journal-proof',
          },
        },
        releaseProof: {
          ok: true,
          status: 0,
          code: 'RETAINED_SOURCE_SUMMARY_OK',
        },
        authSessionSource: summarizeAuthSessionSource(authSessionSourceCommand, authSessionSource),
        durableJournal: {
          proof: {
            status: 0,
            journal: durableJournalSummary.journal,
            leaseFence: {
              ...durableJournalSummary.leaseFence,
              staleClaimRejected: durableJournalSummary.journal.staleClaimRejected,
            },
          },
          rows: 17,
          applyCommitted: true,
          mutationApplied: 7,
          idempotencyOpened: 1,
        },
      },
      null,
      2,
    ),
  );
  process.stdout.write('\n');
  throw new ProofFailure();
}

if (!username || !applicationPassword) {
  process.stdout.write(
    JSON.stringify(
      {
        ok: false,
        topology: {
          sourceUrl: liveSourceUrl || null,
          remoteBase: null,
          remoteChanged: null,
          localEdited: null,
        },
        boundary: {
          firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
          status: 'unimplemented',
          verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
          authSession: {
            required: 'production-auth-session',
            observed: 'missing-production-credentials',
            verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
          },
        },
        protocolExtension,
        releaseProof: {
          ok: false,
          status: 1,
          code: 'REPRINT_PUSH_SECRET_REQUIRED',
        },
        authSessionSource: summarizeAuthSessionSource(authSessionSourceCommand, authSessionSource),
      },
      null,
      2,
    ),
  );
  process.stdout.write('\n');
  throw new ProofFailure();
}

if (requireProductionAuthSession && !packagedProductionPluginRequested) {
  if (!liveSourceUrl) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: false,
          topology: {
            sourceUrl: liveSourceUrl,
            remoteBase: null,
            remoteChanged: null,
            localEdited: null,
          },
          boundary: {
            firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
            status: 'unimplemented',
            verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
            durableJournal: {
              storageLeaseFence: 'production durable journal storage, lease, and fencing are not yet proven beyond the retained Playground journal path',
              verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
            },
          authSession: {
            required: 'production-auth-session',
            observed: 'missing-live-source',
            verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
          },
          liveAuthSessionSource: {
            ...liveAuthSessionSourceBlocker,
            observed: 'missing-live-source',
          },
        },
          protocolExtension,
          preflight: {
            status: 0,
            authSessionType: 'missing-live-source',
            routeProfile: 'production-shaped',
            session: {
              id: '',
              type: 'missing-live-source',
            },
          },
          authSessionLifecycle: null,
          authSessionLifecycleTrace: [],
          releaseProof: {
            ok: false,
            status: 409,
            code: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
          },
          authSessionSource: summarizeAuthSessionSource(authSessionSourceCommand, authSessionSource),
        },
        null,
        2,
      ),
    );
    process.stdout.write('\n');
    throw new ProofFailure();
  }

  const client = authenticatedHttpClient({
    sourceUrl: liveSourceUrl,
    credential: credentials,
    routeProfile: 'production-shaped',
  });
  let preflight;
  try {
    preflight = await client.signedGet('/preflight', { retryable: true });
  } catch (error) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: false,
          topology: {
            sourceUrl: liveSourceUrl,
            remoteBase: null,
            remoteChanged: null,
            localEdited: null,
          },
          boundary: {
            firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
            status: 'unimplemented',
            verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
            durableJournal: {
              storageLeaseFence: 'production durable journal storage, lease, and fencing are not yet proven beyond the retained Playground journal path',
              verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
            },
            authSession: {
              required: 'production-auth-session',
              observed: 'unreachable-live-source',
              verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
            },
            liveAuthSessionSource: {
              ...liveAuthSessionSourceBlocker,
              observed: 'unreachable-live-source',
              error: error instanceof Error ? error.message : String(error),
            },
            liveSource: {
              url: liveSourceUrl,
              verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
              error: error instanceof Error ? error.message : String(error),
            },
          },
          protocolExtension,
          preflight: {
            status: 0,
            authSessionType: 'unreachable-live-source',
            routeProfile: 'production-shaped',
            session: {
              id: '',
              type: 'unreachable-live-source',
            },
          },
          authSessionLifecycle: null,
          authSessionLifecycleTrace: [],
          releaseProof: {
            ok: false,
            status: 409,
            code: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
          },
        },
        null,
        2,
      ),
    );
    process.stdout.write('\n');
    throw new ProofFailure();
  }
  const livePreflightLifecycle = evaluateProductionAuthSessionLifecycle(preflight.body?.auth?.session);
  if (preflight.status !== 200 || preflight.body?.ok !== true || !livePreflightLifecycle.ok) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: false,
          topology: {
            sourceUrl: liveSourceUrl,
            remoteBase: null,
            remoteChanged: null,
            localEdited: null,
          },
          boundary: {
            firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
            status: 'unimplemented',
            verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
            durableJournal: {
              storageLeaseFence: 'production durable journal storage, lease, and fencing are not yet proven beyond the retained Playground journal path',
              verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
            },
            authSession: {
              required: livePreflightLifecycle.required,
              observed: livePreflightLifecycle.observed,
              verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
            },
            liveAuthSessionSource: {
              ...liveAuthSessionSourceBlocker,
              observed: livePreflightLifecycle.observed,
            },
          },
          protocolExtension,
          preflight: {
            status: preflight.status,
            authSessionType: preflight.body?.auth?.session?.type || 'missing',
            routeProfile: preflight.body?.routeProfile || 'production-shaped',
            session: {
              id: preflight.body?.session?.id || '',
              type: preflight.body?.session?.type || 'missing',
            },
          },
          releaseProof: {
            ok: false,
            status: 409,
            code: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
          },
        },
        null,
        2,
      ),
    );
    process.stdout.write('\n');
    throw new ProofFailure();
  }
}

const remoteBaseFixturePath = path.join(repoRoot, 'fixtures/playground/remote-base.blueprint.json');
const localEditedFixturePath = path.join(repoRoot, 'fixtures/playground/local-edited.blueprint.json');
const remoteChangedFixturePath = path.join(repoRoot, 'fixtures/playground/remote-changed.blueprint.json');
const packagedSourceFixture = packagedProductionPluginRequested
  ? createPackagedProductionPluginFixture()
  : null;
const remoteServer = packagedSourceFixture
  ? await startPackagedProductionPluginServer('remote-base', packagedSourceFixture)
  : await startPlaygroundServer(
    'remote-base',
    remoteBaseFixturePath,
  );
try {
  if (packagedSourceFixture) {
    const packagedRuntimeSource = bindPackagedProductionPluginRuntimeSource({
      sourceUrl: liveSourceUrl,
      authSessionSource,
      runtimeSourceUrl: remoteServer.baseUrl,
    });
    liveSourceUrl = packagedRuntimeSource.sourceUrl;
    authSessionSource = packagedRuntimeSource.authSessionSource;
  }

  if (!liveSourceUrl) {
    liveSourceUrl = remoteServer.baseUrl;
  }

  const localEditedSnapshot = withoutUnmappedGraphPostmeta(
    exportSnapshotFromBlueprint('local-edited', localEditedFixturePath),
  );
  const remoteChangedSnapshot = exportSnapshotFromBlueprint('remote-changed', remoteChangedFixturePath);
  try {
      const client = authenticatedHttpClient({
        sourceUrl: liveSourceUrl,
        credential: credentials,
        routeProfile: 'production-shaped',
      });

      const preflight = await client.signedGet('/preflight', { retryable: true });
      const checkedPreflightLifecycle = evaluateProductionAuthSessionLifecycle(preflight.body?.auth?.session);
      assert.equal(preflight.status, 200, `production-shaped release verify preflight HTTP ${preflight.status}`);
      assert.equal(preflight.body.ok, true);

      const remoteBaseSnapshot = packagedSourceFixture
        ? exportSnapshotFromBlueprint('remote-base', remoteBaseFixturePath)
        : await exportSnapshot('remote-base', liveSourceUrl);
      const proof = await runAuthenticatedHttpPush({
        sourceUrl: liveSourceUrl,
        base: remoteBaseSnapshot,
        local: localEditedSnapshot,
        username: credentials.username,
        applicationPassword: credentials.password,
        idempotencyKey: 'production-shaped-release-verify-001',
        routeProfile: 'production-shaped',
        dryRunOnly: false,
        requireProductionAuthSession: true,
        simulateStaleClaimRetry: packagedSourceFixture !== null,
        simulatePreservedRemoteRetryPath: packagedSourceFixture ? '/snapshot' : '',
        authSessionSource,
        labDriftAfterSnapshot,
        labAuthSessionDrift,
        now: new Date('2026-05-25T10:12:00.000Z'),
      });

      if (!proof.ok) {
        process.stdout.write(
          JSON.stringify(
            {
              ok: false,
              topology: {
                sourceUrl: liveSourceUrl,
                remoteBase: remoteServer.baseUrl,
                remoteChanged: 'remote-changed',
                localEdited: 'local-edited',
              },
              drift: labDriftAfterSnapshot ? {
                mode: labDriftAfterSnapshot,
                sameRemoteIdentity: true,
                changedHash: snapshotHash(remoteChangedSnapshot),
              } : {
                sameRemoteIdentity: true,
              },
              boundary: {
                ...resolveReleaseBoundary(proof),
              },
              protocolExtension,
              preflight: {
                status: preflight.status,
                authSessionType: preflight.body.auth.session.type,
                routeProfile: preflight.body.routeProfile,
                session: {
                  id: preflight.body.session.id,
                  type: preflight.body.session.type,
                },
              },
              releaseProof: {
                ok: false,
                status: proof.dryRun?.status || proof.apply?.status || 1,
                code: proof.code || proof.apply?.body?.code || proof.dryRun?.body?.code || 'APPLY_FAILED',
              },
              authSessionSource: summarizeAuthSessionSource(authSessionSourceCommand, authSessionSource),
              dryRun: proof.dryRun,
              apply: proof.apply,
              recoveryInspect: proof.recoveryInspect,
              replay: proof.replay,
              replayEquivalence: proof.replayEquivalence,
              after: proof.after,
              dbJournal: proof.dbJournal,
            },
            null,
            2,
          ),
        );
        process.stdout.write('\n');
        throw new ProofFailure();
      }

      if (requireProductionAuthSession && !checkedPreflightLifecycle.ok) {
        process.stdout.write(
          JSON.stringify(
            {
              ok: false,
              topology: {
                sourceUrl: liveSourceUrl,
                remoteBase: remoteServer.baseUrl,
                remoteChanged: null,
                localEdited: 'local-edited',
              },
              boundary: {
                firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
                status: 'unimplemented',
                verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
                durableJournal: {
                  storageLeaseFence: 'production durable journal storage, lease, and fencing are not yet proven beyond the retained Playground journal path',
                  verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
                },
                authSession: {
                  required: checkedPreflightLifecycle.required,
                  observed: checkedPreflightLifecycle.observed,
                  verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
                },
                liveAuthSessionSource: {
                  ...liveAuthSessionSourceBlocker,
                  observed: checkedPreflightLifecycle.observed,
                },
              },
              protocolExtension,
              preflight: {
                status: preflight.status,
                authSessionType: preflight.body.auth.session.type,
                routeProfile: preflight.body.routeProfile,
                session: {
                  id: preflight.body.session.id,
                  type: preflight.body.session.type,
                },
              },
              releaseProof: {
                ok: false,
                status: 409,
                code: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
              },
              authSessionSource: summarizeAuthSessionSource(authSessionSourceCommand, authSessionSource),
              dryRun: proof.dryRun,
              apply: proof.apply,
              recoveryInspect: proof.recoveryInspect,
              replay: proof.replay,
              replayEquivalence: proof.replayEquivalence,
              authSessionLifecycle: proof.authSessionLifecycle,
              authSessionLifecycleTrace: proof.authSessionLifecycleTrace,
              after: proof.after,
              dbJournal: proof.dbJournal,
            },
            null,
            2,
          ),
        );
        process.stdout.write('\n');
        throw new ProofFailure();
      }

      assert.equal(proof.ok, true, JSON.stringify(proof, null, 2));
      assert.equal(proof.preflight.status, 200);
      assert.equal(
        preflight.body.auth.session.type,
        packagedSourceFixture ? 'production-auth-session' : 'application-password-basic',
      );
      if (packagedSourceFixture) {
        assert.equal(preflight.body.auth.session.status, 'active');
        assert.equal(checkedPreflightLifecycle.ok, true);
        assert.match(preflight.body.auth.session.expiresAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      }
      assert.equal(
        preflight.body.session.type,
        packagedSourceFixture ? 'production-auth-session' : 'lab-signed-push-session',
      );
      assert.match(preflight.body.session.id, /^[A-Za-z0-9_-]{32,160}$/);
      assert.equal(proof.dryRun.status, 200);
      assert.equal(proof.apply.status, 200);
      assert.equal(proof.recoveryInspect.status, 200);
      assert.equal(proof.replay.status, 200);
      assert.equal(proof.replay.ok, true);
      assert.equal(proof.replay.idempotency?.replayed, true);
      assert.equal(proof.replay.idempotency?.freshMutationWork, false);
      assert.equal(proof.after.status, 200);
      assert.equal(proof.after.finalMatchesLocal, true);
      assert.ok(proof.dryRun.receiptHash, 'dry-run receipt hash missing');
      assert.equal(proof.dbJournal.status, 200);
      assert.ok(proof.dbJournal.rows > 0, 'journal readback must return durable rows');
      assert.equal(proof.dbJournal.applyCommitted, true, 'journal readback must show an apply-committed row');
      assert.ok(
        proof.dbJournal.mutationApplied > 0 || proof.dbJournal.idempotencyOpened > 0,
        'journal readback must show durable mutation evidence',
      );

      const durableJournalSummary = runProductionRecoveryJournalProof({
        plan: proof.planObject,
        current: proof.remoteSnapshotObject,
        artifactRefs: {
          releaseVerifier: 'scripts/playground/production-shaped-release-verify.mjs',
        },
      });
      assert.ok(Array.isArray(durableJournalSummary.journal?.checked), 'production recovery journal proof must report checked journal files');
      assert.ok(
        durableJournalSummary.journal.checked.length > 0,
        'production recovery journal proof must check at least one persistent journal file',
      );
      assert.equal(
        durableJournalSummary.leaseFence?.storageGuard,
        'filesystem-compare-rename',
        'production recovery journal proof must report the storage guard used for lease fencing',
      );
      assert.equal(durableJournalSummary.leaseFence?.fsyncEvidence, true);
      assert.equal(durableJournalSummary.leaseFence?.monotonicSequence, true);
      const checkedDurableJournalAccepted = checkedReleaseDurableJournalProofIsAcceptable(proof.dbJournal);

      if (requireProductionDurableJournal && !checkedDurableJournalAccepted) {
        process.stdout.write(
          JSON.stringify(
            {
              ok: false,
              topology: {
                sourceUrl: liveSourceUrl,
                remoteBase: remoteServer.baseUrl,
                remoteChanged: null,
                localEdited: 'local-edited',
              },
              boundary: {
                firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
                status: 'unimplemented',
                verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
                durableJournal: {
                  storageLeaseFence: 'retained Playground journal storage is lab-scoped; production ownership, lease fencing, and replay wiring are not yet proven on the checked release boundary',
                  verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
                },
              },
              protocolExtension,
              releaseProof: {
                ok: false,
                status: 501,
                code: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
              },
              authSessionSource: summarizeAuthSessionSource(authSessionSourceCommand, authSessionSource),
              durableJournal: {
                proof: {
                  status: 0,
                  journal: durableJournalSummary.journal,
                  leaseFence: {
                    ...durableJournalSummary.leaseFence,
                    staleClaimRejected: durableJournalSummary.journal.staleClaimRejected,
                  },
                },
                rows: proof.dbJournal.rows,
                applyCommitted: proof.dbJournal.applyCommitted,
                mutationApplied: proof.dbJournal.mutationApplied,
                idempotencyOpened: proof.dbJournal.idempotencyOpened,
                scope: proof.dbJournal.scope || null,
                ownership: proof.dbJournal.ownership || null,
                liveLeaseFence: proof.dbJournal.leaseFence || null,
                checkedAccepted: checkedDurableJournalAccepted,
              },
              authSessionLifecycle: proof.authSessionLifecycle,
              authSessionLifecycleTrace: proof.authSessionLifecycleTrace,
            },
            null,
            2,
          ),
        );
        process.stdout.write('\n');
        throw new ProofFailure();
      }

      const liveDrift = {
        sameRemoteIdentity: true,
        baseHash: snapshotHash(remoteBaseSnapshot),
        changedHash: snapshotHash(remoteChangedSnapshot),
        changedFixture: remoteChangedSnapshot.meta?.fixture,
      };
      const authSessionLifecycleSummary = summarizeAuthSessionLifecycle(proof.authSessionLifecycleTrace);
      if (!checkedDurableJournalAccepted) {
        process.stdout.write(
          JSON.stringify(
            {
              ok: false,
              topology: {
                sourceUrl: liveSourceUrl,
                remoteBase: remoteServer.baseUrl,
                remoteChanged: 'remote-changed',
                localEdited: 'local-edited',
              },
              remoteSnapshotHashes: {
                sameRemoteIdentity: true,
                baseHash: liveDrift.baseHash,
                changedHash: liveDrift.changedHash,
              },
              drift: labDriftAfterSnapshot ? {
                mode: labDriftAfterSnapshot,
                sameRemoteIdentity: true,
                changedHash: liveDrift.changedHash,
              } : {
                sameRemoteIdentity: true,
              },
              liveDrift,
              boundary: {
                firstRemainingProductionBoundary: 'durable journal semantics on the checked live release path',
                status: 'unimplemented',
                verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
                authSession: {
                  required: 'production-auth-session lifecycle',
                  observed: 'active-unexpired-preserved',
                  verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_PROVEN',
                },
                durableJournal: {
                  storageLeaseFence: 'live production-shaped auth/session is proven, but durable journal storage, lease fencing, restart-readable artifacts, and release-path acceptance remain below the checked live boundary',
                  verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
                },
              },
              protocolExtension,
              preflight: {
                status: preflight.status,
                authSessionType: preflight.body.auth.session.type,
                routeProfile: preflight.body.routeProfile,
                session: {
                  id: preflight.body.session.id,
                  type: preflight.body.session.type,
                },
              },
              releaseProof: {
                ok: false,
                status: 501,
                code: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
                mode: proof.mode,
                retryAttempts: proof.retryAttempts,
              },
              authSessionSource: summarizeAuthSessionSource(authSessionSourceCommand, authSessionSource),
              authSessionLifecycle: proof.authSessionLifecycle,
              authSessionLifecycleTrace: proof.authSessionLifecycleTrace,
              authSessionLifecycleSummary,
              replayEquivalence: proof.replayEquivalence,
              durableJournal: {
                proof: {
                  status: 0,
                  journal: durableJournalSummary.journal,
                  leaseFence: {
                    ...durableJournalSummary.leaseFence,
                    staleClaimRejected: durableJournalSummary.journal.staleClaimRejected,
                  },
                },
                rows: proof.dbJournal.rows,
                applyCommitted: proof.dbJournal.applyCommitted,
                mutationApplied: proof.dbJournal.mutationApplied,
                idempotencyOpened: proof.dbJournal.idempotencyOpened,
                scope: proof.dbJournal.scope || null,
                ownership: proof.dbJournal.ownership || null,
                liveLeaseFence: proof.dbJournal.leaseFence || null,
                checkedAccepted: checkedDurableJournalAccepted,
              },
            },
            null,
            2,
          ),
        );
        process.stdout.write('\n');
        throw new ProofFailure();
      }

      const successfulReleaseBoundary = {
        firstRemainingProductionBoundary: null,
        status: 'checked',
        verdict: packagedSourceFixture ? 'PACKAGED_RELEASE_BOUNDARY_OK' : 'LIVE_RELEASE_BOUNDARY_OK',
        authSession: {
          required: 'production-auth-session lifecycle',
          observed: 'active-unexpired-preserved',
          verdict: packagedSourceFixture ? 'PACKAGED_RELEASE_BOUNDARY_OK' : 'LIVE_RELEASE_BOUNDARY_OK',
        },
        durableJournal: {
          storageLeaseFence: packagedSourceFixture
            ? 'packaged production plugin journal surface accepted on the checked release boundary'
            : 'checked live production-shaped journal surface accepted on the checked release boundary',
          verdict: checkedDurableJournalAccepted
            ? (packagedSourceFixture ? 'PACKAGED_RELEASE_BOUNDARY_OK' : 'LIVE_RELEASE_BOUNDARY_OK')
            : 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
        },
      };

      process.stdout.write(
        JSON.stringify(
        {
          ok: true,
          topology: {
            sourceUrl: liveSourceUrl,
            remoteBase: remoteServer.baseUrl,
            remoteChanged: 'remote-changed',
            localEdited: 'local-edited',
          },
          remoteSnapshotHashes: {
            sameRemoteIdentity: true,
            baseHash: liveDrift.baseHash,
            changedHash: liveDrift.changedHash,
          },
          drift: labDriftAfterSnapshot ? {
            mode: labDriftAfterSnapshot,
            sameRemoteIdentity: true,
            changedHash: liveDrift.changedHash,
          } : {
            sameRemoteIdentity: true,
          },
          liveDrift,
          boundary: successfulReleaseBoundary,
          protocolExtension,
          preflight: {
              status: preflight.status,
              authSessionType: preflight.body.auth.session.type,
              routeProfile: preflight.body.routeProfile,
              session: {
                id: preflight.body.session.id,
                type: preflight.body.session.type,
              },
            },
            releaseProof: proof,
            authSessionSource: summarizeAuthSessionSource(authSessionSourceCommand, authSessionSource),
            authSessionLifecycle: proof.authSessionLifecycle,
            authSessionLifecycleTrace: proof.authSessionLifecycleTrace,
            authSessionLifecycleSummary,
            replayEquivalence: proof.replayEquivalence,
            durableJournal: {
              proof: {
                status: 0,
                journal: durableJournalSummary.journal,
                leaseFence: {
                  ...durableJournalSummary.leaseFence,
                  staleClaimRejected: durableJournalSummary.journal.staleClaimRejected,
                },
              },
              rows: proof.dbJournal.rows,
              applyCommitted: proof.dbJournal.applyCommitted,
              mutationApplied: proof.dbJournal.mutationApplied,
              idempotencyOpened: proof.dbJournal.idempotencyOpened,
              scope: proof.dbJournal.scope || null,
              ownership: proof.dbJournal.ownership || null,
              liveLeaseFence: proof.dbJournal.leaseFence || null,
              checkedAccepted: checkedDurableJournalAccepted,
            },
          },
          null,
          2,
        ),
      );
      process.stdout.write('\n');
    } catch (error) {
      process.stdout.write(
        JSON.stringify(
          {
            ok: false,
            topology: {
              sourceUrl: liveSourceUrl,
              remoteBase: remoteServer.baseUrl,
              remoteChanged: 'remote-changed',
              localEdited: 'local-edited',
            },
            drift: labDriftAfterSnapshot
              ? {
                  mode: labDriftAfterSnapshot,
                  sameRemoteIdentity: true,
                  changedHash: snapshotHash(remoteChangedSnapshot),
                }
              : {
                  sameRemoteIdentity: true,
                },
            boundary: {
              firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
              status: 'unimplemented',
              verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
              durableJournal: {
                storageLeaseFence: 'production durable journal storage, lease, and fencing are not yet proven beyond the retained Playground journal path',
                verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
              },
            },
            protocolExtension,
            preflight: {
              status: 0,
              authSessionType: 'unreachable-live-source',
              routeProfile: 'production-shaped',
              session: {
                id: '',
                type: 'unreachable-live-source',
              },
            },
            releaseProof: {
              ok: false,
              status: 412,
              code: 'PRECONDITION_FAILED',
            },
            authSessionSource: summarizeAuthSessionSource(authSessionSourceCommand, authSessionSource),
            error: error instanceof Error ? error.message : String(error),
            authSessionLifecycle: null,
            authSessionLifecycleTrace: [],
            authSessionLifecycleSummary: null,
          },
          null,
          2,
        ),
      );
      process.stdout.write('\n');
  }
} finally {
  await stopPlaygroundServer(remoteServer);
  if (packagedSourceFixture) {
    packagedSourceFixture.cleanup();
  }
}

async function startPlaygroundServer(name, blueprintPath) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const port = await findLocalPort();
    const baseUrl = `http://127.0.0.1:${port}`;
    process.stderr.write(`Starting Playground server ${name} at ${baseUrl} from ${path.basename(blueprintPath)} attempt ${attempt}/3\n`);
    const args = [
      '--yes',
      '@wp-playground/cli@latest',
      'server',
      '--blueprint',
      blueprintPath,
      '--mount',
      `${repoRoot}:/workspace`,
      '--mount',
      `${muPluginDir}:/wordpress/wp-content/mu-plugins`,
      '--site-url',
      baseUrl,
      '--port',
      String(port),
      '--workers',
      '1',
      '--verbosity',
      'quiet',
    ];

    const child = spawn(
      'npx',
      args,
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          REPRINT_PUSH_LAB_AUTH_BOOTSTRAP: '1',
          REPRINT_PUSH_LAB_AUTH_ADMIN_USER: credentials.username,
          REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: credentials.password,
          NODE_OPTIONS: appendNodeOption(process.env.NODE_OPTIONS, localhostListenPreloadOption()),
        },
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    activePlaygroundChildren.add(child);

    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });

    try {
      await waitForServer(child, baseUrl, () => output);
      process.stderr.write(`Playground server ${name} is ready at ${baseUrl}\n`);
      return { name, baseUrl, child };
    } catch (error) {
      const logs = `${output}\n${error instanceof Error ? error.message : String(error)}`;
      process.stderr.write(`Playground server ${name} failed to become ready at ${baseUrl}\n`);
      process.stderr.write(`${logs.trimEnd()}\n`);
      await stopSpawnedServer(child);
      if (!/EADDRINUSE/i.test(logs) || attempt === 3) {
        throw error;
      }
    } finally {
      activePlaygroundChildren.delete(child);
    }
  }

  throw new Error(`Unable to start Playground server for ${name} after retrying port collisions`);
}

async function stopPlaygroundServer(server) {
  if (server.child.exitCode !== null) {
    return;
  }
  await stopSpawnedServer(server.child);
}

async function startPackagedProductionPluginServer(name, packagedFixture) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const port = await findLocalPort();
    const baseUrl = `http://127.0.0.1:${port}`;
    process.stderr.write(
      `Starting Playground server ${name} at ${baseUrl} from ${path.basename(packagedFixture.blueprintPath)} attempt ${attempt}/3\n`,
    );
    const args = [
      '--yes',
      '@wp-playground/cli@latest',
      'server',
      '--blueprint',
      packagedFixture.blueprintPath,
      '--mount',
      `${packagedFixture.pluginDir}:/wordpress/wp-content/plugins/reprint-push`,
      '--site-url',
      baseUrl,
      '--port',
      String(port),
      '--workers',
      '1',
      '--verbosity',
      'quiet',
    ];
    const child = spawn(
      'npx',
      args,
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          REPRINT_PUSH_LAB_AUTH_BOOTSTRAP: '1',
          REPRINT_PUSH_LAB_AUTH_ADMIN_USER: credentials.username,
          REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: credentials.password,
          NODE_OPTIONS: appendNodeOption(process.env.NODE_OPTIONS, localhostListenPreloadOption()),
        },
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    activePlaygroundChildren.add(child);
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    try {
      await waitForPackagedProductionPluginServer(child, baseUrl, () => output);
      process.stderr.write(`Playground server ${name} is ready at ${baseUrl}\n`);
      return { name, baseUrl, child };
    } catch (error) {
      const logs = `${output}\n${error instanceof Error ? error.message : String(error)}`;
      process.stderr.write(`Playground server ${name} failed to become ready at ${baseUrl}\n`);
      process.stderr.write(`${logs.trimEnd()}\n`);
      await stopSpawnedServer(child);
      if (!/EADDRINUSE/i.test(logs) || attempt === 3) {
        throw error;
      }
    } finally {
      activePlaygroundChildren.delete(child);
    }
  }

  throw new Error(`Unable to start packaged Playground server for ${name} after retrying port collisions`);
}

async function waitForPackagedProductionPluginServer(child, baseUrl, getOutput) {
  const deadline = Date.now() + packagedServerStartupTimeoutMs;
  let lastError = null;
  const lastProbes = [];
  let lastTimeoutFallbackProbes = null;
  let notReadyProbeCounts = { snapshot: 0, preflight: 0 };
  let timeoutProbeCount = 0;
  let activePackagedReadinessPhase = 'snapshot';
  let activeSnapshotProbe = null;
  let activeSnapshotNotReadyProbeCount = 0;
  const readinessPhases = new Set();
  const noteReadinessPhase = (phase, message) => {
    if (readinessPhases.has(phase)) {
      return;
    }
    readinessPhases.add(phase);
    process.stderr.write(`[production-shaped-release-verify] ${message}\n`);
  };
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      const exitLabel =
        child.exitCode !== null ? `exited early with ${child.exitCode}` : `terminated by ${child.signalCode}`;
      const message = formatPlaygroundStartupFailure(
        `Packaged production plugin server ${exitLabel}`,
        lastError,
        lastProbes,
        getOutput(),
        { childPid: child.pid ?? null, packagedProductionPlugin: true },
        lastTimeoutFallbackProbes,
      );
      writePlaygroundFailure(message, lastProbes, getOutput(), lastError, lastTimeoutFallbackProbes);
      await stopSpawnedServer(child);
      throw new Error(message);
    }
    try {
      activePackagedReadinessPhase = 'snapshot';
      activeSnapshotProbe = null;
      activeSnapshotNotReadyProbeCount = 0;
      noteReadinessPhase('snapshot', `probing packaged snapshot readiness at ${baseUrl}`);
      const { response: snapshot, bodyText: snapshotText } = await fetchTextWithTimeout(`${baseUrl}/wp-json/reprint/v1/push/snapshot`, {
        headers: {
          ...authHeaders(),
          connection: 'close',
        },
      }, packagedServerFetchTimeoutMs, child);
      timeoutProbeCount = 0;
      // A successful snapshot fetch supersedes any older timeout-fallback
      // probes; later failures should describe the current readiness branch.
      lastTimeoutFallbackProbes = null;
      const snapshotPreview = snapshotText.slice(0, readinessFailureBodyLimit);
      notReadyProbeCounts = packagedProductionPluginNextRouteNotReadyProbeCounts(
        notReadyProbeCounts,
        'snapshot',
        snapshot.status,
        snapshotText,
      );
      const snapshotNotReadyProbeCount = notReadyProbeCounts.snapshot;
      activeSnapshotProbe = {
        status: snapshot.status,
        body: snapshotText,
      };
      activeSnapshotNotReadyProbeCount = snapshotNotReadyProbeCount;
      lastProbes.push({
        route: '/wp-json/reprint/v1/push/snapshot',
        status: snapshot.status,
        ok: snapshot.ok,
        body: snapshotPreview,
      });
      let snapshotBody = null;
      try {
        snapshotBody = JSON.parse(snapshotText);
      } catch (error) {
        if (packagedProductionPluginReadinessBodyRetryable(snapshot.status, snapshotText)) {
          lastError = new Error(`Production plugin package snapshot readiness HTTP ${snapshot.status}`);
          noteReadinessPhase('preflight-fallback', `snapshot is still startup-shaped; probing signed preflight readiness at ${baseUrl}`);
          activePackagedReadinessPhase = 'preflight';
          const preflightProbe = await fetchPackagedPreflightProbe(baseUrl, child, {
            packagedStartup: true,
            snapshotProbe: {
              status: snapshot.status,
              body: snapshotText,
            },
          });
          lastProbes.push(preflightProbe);
          if (preflightProbe.ready) {
            return;
          }
          if (preflightProbe.terminal) {
            const malformedSnapshotFallbackPreflightBody =
              preflightProbe.parsedBody === null
              && !packagedProductionPluginReadinessBodyRetryable(
                preflightProbe.status,
                preflightProbe.body || '',
              );
            notReadyProbeCounts = packagedProductionPluginResetRouteNotReadyProbeCounts(
              notReadyProbeCounts,
              'preflight',
            );
            await throwPlaygroundReadinessFailure(
              child,
              malformedSnapshotFallbackPreflightBody
                ? `Packaged production plugin signed preflight returned an invalid readiness body while snapshot still reported startup-shaped readiness at ${baseUrl}`
                : `Packaged production plugin signed preflight became terminal while snapshot still reported startup-shaped readiness at ${baseUrl}`,
              lastError,
              lastProbes,
              getOutput(),
              packagedProductionPluginPreflightTerminalContext(
                { childPid: child.pid ?? null },
                { snapshotStartupFallback: true },
              ),
            );
          }
          if (
            packagedProductionPluginRouteStartupClassificationReady(
              snapshotNotReadyProbeCount,
            )
          ) {
            const indexProbe = await fetchPackagedWordPressIndexProbe(baseUrl, child).catch((indexError) =>
              buildPackagedTimeoutFallbackProbe('/wp-json/', indexError),
            );
            lastProbes.push(indexProbe);
            const startupBranch = packagedProductionPluginClassifyBoundedStartup(
              {
                retryable: true,
                status: snapshot.status,
                body: snapshotText,
              },
              indexProbe,
            );
            if (startupBranch?.kind === 'retryable-route-wordpress-starting') {
              if (packagedProductionPluginGlobalStartupStillWithinBudget(snapshotNotReadyProbeCount)) {
                await sleepUnlessChildExit(readinessProbeIntervalMs, child);
                continue;
              }
              await throwPlaygroundReadinessFailure(
                child,
                `Packaged production plugin snapshot stayed startup-shaped while /wp-json/ kept reporting global WordPress startup HTTP ${indexProbe.status} for ${snapshotNotReadyProbeCount} consecutive response${snapshotNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`,
                lastError,
                lastProbes,
                getOutput(),
                {
                  childPid: child.pid ?? null,
                  packagedProductionPlugin: true,
                  snapshotNotReadyProbeCount,
                  globalWordPressStartup: true,
                },
              );
            }
            if (startupBranch?.kind === 'retryable-route-packaged-route-starting') {
              if (
                packagedProductionPluginPackagedRouteStartupLimitReached(
                  snapshotNotReadyProbeCount,
                  maxPackagedRouteStartupAfterGlobalReadyProbes,
                )
              ) {
                await throwPlaygroundReadinessFailure(
                  child,
                  `Packaged production plugin snapshot stayed startup-shaped after global WordPress startup HTTP ${indexProbe.status} for ${snapshotNotReadyProbeCount} consecutive response${snapshotNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedRouteStartupAfterGlobalReadyProbes})`,
                  lastError,
                  lastProbes,
                  getOutput(),
                  {
                    childPid: child.pid ?? null,
                    packagedProductionPlugin: true,
                    packagedRouteStartup: true,
                    snapshotNotReadyProbeCount,
                  },
                );
              }
              if (
                packagedProductionPluginPackagedRouteStartupStillWithinBudget(
                  snapshotNotReadyProbeCount,
                  maxPackagedRouteStartupAfterGlobalReadyProbes,
                )
              ) {
                await sleepUnlessChildExit(readinessProbeIntervalMs, child);
                continue;
              }
            }
            if (startupBranch?.kind === 'retryable-route-index-terminal') {
              const malformedIndexBody =
                packagedProductionPluginMalformedTerminalIndexProbe(indexProbe);
              await throwPlaygroundReadinessFailure(
                child,
                malformedIndexBody
                  ? `Packaged production plugin snapshot stayed startup-shaped while /wp-json/ returned an invalid readiness body after ${snapshotNotReadyProbeCount} consecutive response${snapshotNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`
                  : `Packaged production plugin snapshot stayed startup-shaped while /wp-json/ returned a terminal readiness failure HTTP ${indexProbe.status} after ${snapshotNotReadyProbeCount} consecutive response${snapshotNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`,
                lastError,
                lastProbes,
                getOutput(),
                {
                  childPid: child.pid ?? null,
                  packagedProductionPlugin: true,
                  ...(malformedIndexBody ? { invalidReadinessBody: true } : {}),
                  indexTerminal: true,
                  snapshotNotReadyProbeCount,
                },
              );
            }
            if (packagedProductionPluginGlobalStartupStillWithinBudget(snapshotNotReadyProbeCount)) {
              await sleepUnlessChildExit(readinessProbeIntervalMs, child);
              continue;
            }
            await throwPlaygroundReadinessFailure(
              child,
              `Packaged production plugin snapshot hit the bounded readiness failure after ${snapshotNotReadyProbeCount} consecutive startup-shaped response${snapshotNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`,
              lastError,
              lastProbes,
              getOutput(),
              {
                childPid: child.pid ?? null,
                packagedProductionPlugin: true,
                notReadyProbeCount: snapshotNotReadyProbeCount,
                maxNotReadyProbeCount: maxPackagedStartupNotReadyProbeCount,
              },
            );
          }
          await sleepUnlessChildExit(readinessProbeIntervalMs, child);
          continue;
        }
        lastError = error;
        notReadyProbeCounts = packagedProductionPluginResetRouteNotReadyProbeCounts(
          notReadyProbeCounts,
          'snapshot',
        );
        await throwPlaygroundReadinessFailure(
          child,
          `Packaged production plugin snapshot returned an invalid readiness body at ${baseUrl}`,
          lastError,
          lastProbes,
          getOutput(),
          {
            childPid: child.pid ?? null,
            packagedProductionPlugin: true,
          },
        );
      }
      if (!packagedProductionPluginServerReady({
        snapshot: {
          status: snapshot.status,
          body: snapshotBody,
        },
      })) {
        lastError = new Error(`Production plugin package snapshot readiness HTTP ${snapshot.status}`);
        noteReadinessPhase('preflight-fallback', `snapshot is still startup-shaped; probing signed preflight readiness at ${baseUrl}`);
        activePackagedReadinessPhase = 'preflight';
        const preflightProbe = await fetchPackagedPreflightProbe(baseUrl, child, {
          packagedStartup: true,
          snapshotProbe: {
            status: snapshot.status,
            body: snapshotText,
          },
        });
        lastProbes.push(preflightProbe);
        if (preflightProbe.ready) {
          return;
        }
        if (
          packagedProductionPluginSnapshotRetryable({
            status: snapshot.status,
            body: snapshotBody,
          })
        ) {
          if (
            preflightProbe.retryable
            && packagedProductionPluginRouteStartupClassificationReady(
              snapshotNotReadyProbeCount,
            )
          ) {
            const indexProbe = await fetchPackagedWordPressIndexProbe(baseUrl, child).catch((indexError) =>
              buildPackagedTimeoutFallbackProbe('/wp-json/', indexError),
            );
            lastProbes.push(indexProbe);
            const startupBranch = packagedProductionPluginClassifyBoundedStartup(
              {
                retryable: true,
                status: snapshot.status,
                body: snapshotText,
              },
              indexProbe,
            );
            if (startupBranch?.kind === 'retryable-route-wordpress-starting') {
              if (packagedProductionPluginGlobalStartupStillWithinBudget(snapshotNotReadyProbeCount)) {
                await sleepUnlessChildExit(readinessProbeIntervalMs, child);
                continue;
              }
              await throwPlaygroundReadinessFailure(
                child,
                `Packaged production plugin snapshot stayed startup-shaped while /wp-json/ kept reporting global WordPress startup HTTP ${indexProbe.status} for ${snapshotNotReadyProbeCount} consecutive response${snapshotNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`,
                lastError,
                lastProbes,
                getOutput(),
                {
                  childPid: child.pid ?? null,
                  packagedProductionPlugin: true,
                  snapshotNotReadyProbeCount,
                  globalWordPressStartup: true,
                },
              );
            }
            if (startupBranch?.kind === 'retryable-route-packaged-route-starting') {
              if (
                packagedProductionPluginPackagedRouteStartupLimitReached(
                  snapshotNotReadyProbeCount,
                  maxPackagedRouteStartupAfterGlobalReadyProbes,
                )
              ) {
                await throwPlaygroundReadinessFailure(
                  child,
                  `Packaged production plugin snapshot stayed startup-shaped after global WordPress startup HTTP ${indexProbe.status} for ${snapshotNotReadyProbeCount} consecutive response${snapshotNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedRouteStartupAfterGlobalReadyProbes})`,
                  lastError,
                  lastProbes,
                  getOutput(),
                  {
                    childPid: child.pid ?? null,
                    packagedProductionPlugin: true,
                    packagedRouteStartup: true,
                    snapshotNotReadyProbeCount,
                  },
                );
              }
              if (
                packagedProductionPluginPackagedRouteStartupStillWithinBudget(
                  snapshotNotReadyProbeCount,
                  maxPackagedRouteStartupAfterGlobalReadyProbes,
                )
              ) {
                await sleepUnlessChildExit(readinessProbeIntervalMs, child);
                continue;
              }
            }
            if (startupBranch?.kind === 'retryable-route-index-terminal') {
              const malformedIndexBody =
                packagedProductionPluginMalformedTerminalIndexProbe(indexProbe);
              await throwPlaygroundReadinessFailure(
                child,
                malformedIndexBody
                  ? `Packaged production plugin snapshot stayed startup-shaped while /wp-json/ returned an invalid readiness body after ${snapshotNotReadyProbeCount} consecutive response${snapshotNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`
                  : `Packaged production plugin snapshot stayed startup-shaped while /wp-json/ returned a terminal readiness failure HTTP ${indexProbe.status} after ${snapshotNotReadyProbeCount} consecutive response${snapshotNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`,
                lastError,
                lastProbes,
                getOutput(),
                {
                  childPid: child.pid ?? null,
                  packagedProductionPlugin: true,
                  ...(malformedIndexBody ? { invalidReadinessBody: true } : {}),
                  indexTerminal: true,
                  snapshotNotReadyProbeCount,
                },
              );
            }
            if (packagedProductionPluginGlobalStartupStillWithinBudget(snapshotNotReadyProbeCount)) {
              await sleepUnlessChildExit(readinessProbeIntervalMs, child);
              continue;
            }
            await throwPlaygroundReadinessFailure(
              child,
              `Packaged production plugin snapshot hit the bounded readiness failure after ${snapshotNotReadyProbeCount} consecutive startup-shaped response${snapshotNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`,
              lastError,
              lastProbes,
              getOutput(),
              {
                childPid: child.pid ?? null,
                packagedProductionPlugin: true,
                notReadyProbeCount: snapshotNotReadyProbeCount,
                maxNotReadyProbeCount: maxPackagedStartupNotReadyProbeCount,
              },
            );
          }
          if (preflightProbe.retryable) {
            await sleepUnlessChildExit(readinessProbeIntervalMs, child);
            continue;
          }
          if (preflightProbe.terminal) {
            const malformedSnapshotFallbackPreflightBody =
              preflightProbe.parsedBody === null
              && !packagedProductionPluginReadinessBodyRetryable(
                preflightProbe.status,
                preflightProbe.body || '',
              );
            notReadyProbeCounts = packagedProductionPluginResetRouteNotReadyProbeCounts(
              notReadyProbeCounts,
              'preflight',
            );
            await throwPlaygroundReadinessFailure(
              child,
              malformedSnapshotFallbackPreflightBody
                ? `Packaged production plugin signed preflight returned an invalid readiness body while snapshot still reported startup-shaped readiness at ${baseUrl}`
                : `Packaged production plugin signed preflight became terminal while snapshot still reported startup-shaped readiness at ${baseUrl}`,
              lastError,
              lastProbes,
              getOutput(),
              packagedProductionPluginPreflightTerminalContext(
                { childPid: child.pid ?? null },
                { snapshotStartupFallback: true },
              ),
            );
          }
          if (
            packagedProductionPluginRouteStartupClassificationReady(
              snapshotNotReadyProbeCount,
            )
          ) {
            const indexProbe = await fetchPackagedWordPressIndexProbe(baseUrl, child).catch((indexError) =>
              buildPackagedTimeoutFallbackProbe('/wp-json/', indexError),
            );
            lastProbes.push(indexProbe);
            const startupBranch = packagedProductionPluginClassifyBoundedStartup(
              {
                retryable: true,
                status: snapshot.status,
                body: snapshotText,
              },
              indexProbe,
            );
            if (startupBranch?.kind === 'retryable-route-wordpress-starting') {
              if (packagedProductionPluginGlobalStartupStillWithinBudget(snapshotNotReadyProbeCount)) {
                await sleepUnlessChildExit(readinessProbeIntervalMs, child);
                continue;
              }
              await throwPlaygroundReadinessFailure(
                child,
                `Packaged production plugin snapshot stayed startup-shaped while /wp-json/ kept reporting global WordPress startup HTTP ${indexProbe.status} for ${snapshotNotReadyProbeCount} consecutive response${snapshotNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`,
                lastError,
                lastProbes,
                getOutput(),
                {
                  childPid: child.pid ?? null,
                  packagedProductionPlugin: true,
                  snapshotNotReadyProbeCount,
                  globalWordPressStartup: true,
                },
              );
            }
            if (startupBranch?.kind === 'retryable-route-packaged-route-starting') {
              if (
                packagedProductionPluginPackagedRouteStartupLimitReached(
                  snapshotNotReadyProbeCount,
                  maxPackagedRouteStartupAfterGlobalReadyProbes,
                )
              ) {
                await throwPlaygroundReadinessFailure(
                  child,
                  `Packaged production plugin snapshot stayed startup-shaped after global WordPress startup HTTP ${indexProbe.status} for ${snapshotNotReadyProbeCount} consecutive response${snapshotNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedRouteStartupAfterGlobalReadyProbes})`,
                  lastError,
                  lastProbes,
                  getOutput(),
                  {
                    childPid: child.pid ?? null,
                    packagedProductionPlugin: true,
                    packagedRouteStartup: true,
                    snapshotNotReadyProbeCount,
                  },
                );
              }
            }
            if (startupBranch?.kind === 'retryable-route-index-terminal') {
              const malformedIndexBody =
                packagedProductionPluginMalformedTerminalIndexProbe(indexProbe);
              await throwPlaygroundReadinessFailure(
                child,
                malformedIndexBody
                  ? `Packaged production plugin snapshot stayed startup-shaped while /wp-json/ returned an invalid readiness body after ${snapshotNotReadyProbeCount} consecutive response${snapshotNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`
                  : `Packaged production plugin snapshot stayed startup-shaped while /wp-json/ returned a terminal readiness failure HTTP ${indexProbe.status} after ${snapshotNotReadyProbeCount} consecutive response${snapshotNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`,
                lastError,
                lastProbes,
                getOutput(),
                {
                  childPid: child.pid ?? null,
                  packagedProductionPlugin: true,
                  ...(malformedIndexBody ? { invalidReadinessBody: true } : {}),
                  indexTerminal: true,
                  snapshotNotReadyProbeCount,
                },
              );
            }
            if (packagedProductionPluginGlobalStartupStillWithinBudget(snapshotNotReadyProbeCount)) {
              await sleepUnlessChildExit(readinessProbeIntervalMs, child);
              continue;
            }
            await throwPlaygroundReadinessFailure(
              child,
              `Packaged production plugin snapshot hit the bounded readiness failure after ${snapshotNotReadyProbeCount} consecutive startup-shaped response${snapshotNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`,
              lastError,
              lastProbes,
              getOutput(),
              {
                childPid: child.pid ?? null,
                packagedProductionPlugin: true,
                notReadyProbeCount: snapshotNotReadyProbeCount,
                maxNotReadyProbeCount: maxPackagedStartupNotReadyProbeCount,
              },
            );
          }
          await sleepUnlessChildExit(readinessProbeIntervalMs, child);
          continue;
        }
        notReadyProbeCounts = packagedProductionPluginResetRouteNotReadyProbeCounts(
          notReadyProbeCounts,
          'snapshot',
        );
        await throwPlaygroundReadinessFailure(
          child,
          `Packaged production plugin snapshot returned a terminal readiness failure at ${baseUrl}`,
          lastError,
          lastProbes,
          getOutput(),
          {
            childPid: child.pid ?? null,
            packagedProductionPlugin: true,
          },
        );
      }
      notReadyProbeCounts = packagedProductionPluginResetRouteNotReadyProbeCounts(
        notReadyProbeCounts,
        'snapshot',
      );
      noteReadinessPhase('preflight', `snapshot responded; probing signed preflight readiness at ${baseUrl}`);
      activePackagedReadinessPhase = 'preflight';

      const { response: preflight, bodyText: preflightText } = await fetchTextWithTimeout(`${baseUrl}/wp-json/reprint/v1/push/preflight`, {
        method: 'GET',
        headers: signedHeadersForProductionPreflight(),
      }, packagedServerFetchTimeoutMs, child);
      timeoutProbeCount = 0;
      const preview = preflightText.slice(0, readinessFailureBodyLimit);
      notReadyProbeCounts = packagedProductionPluginNextRouteNotReadyProbeCounts(
        notReadyProbeCounts,
        'preflight',
        preflight.status,
        preflightText,
      );
      const preflightNotReadyProbeCount = notReadyProbeCounts.preflight;
      lastProbes.push({
        route: '/wp-json/reprint/v1/push/preflight',
        status: preflight.status,
        ok: preflight.ok,
        body: preview,
      });
      let preflightBody = null;
      try {
        preflightBody = JSON.parse(preflightText);
      } catch (error) {
        if (packagedProductionPluginReadinessBodyRetryable(preflight.status, preflightText)) {
          lastError = new Error(`Production plugin package preflight readiness HTTP ${preflight.status}`);
          if (
            packagedProductionPluginRouteStartupClassificationReady(
              preflightNotReadyProbeCount,
            )
          ) {
            const indexProbe = await fetchPackagedWordPressIndexProbe(baseUrl, child).catch((indexError) =>
              buildPackagedTimeoutFallbackProbe('/wp-json/', indexError),
            );
            lastProbes.push(indexProbe);
            const startupBranch = packagedProductionPluginClassifyBoundedStartup(
              {
                retryable: true,
                status: preflight.status,
                body: preflightText,
              },
              indexProbe,
            );
            if (startupBranch?.kind === 'retryable-route-wordpress-starting') {
              if (packagedProductionPluginGlobalStartupStillWithinBudget(preflightNotReadyProbeCount)) {
                await sleepUnlessChildExit(readinessProbeIntervalMs, child);
                continue;
              }
              await throwPlaygroundReadinessFailure(
                child,
                `Packaged production plugin signed preflight stayed startup-shaped while /wp-json/ kept reporting global WordPress startup HTTP ${indexProbe.status} for ${preflightNotReadyProbeCount} consecutive response${preflightNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`,
                lastError,
                lastProbes,
                getOutput(),
                {
                  childPid: child.pid ?? null,
                  packagedProductionPlugin: true,
                  preflightNotReadyProbeCount,
                  globalWordPressStartup: true,
                },
              );
            }
            if (startupBranch?.kind === 'retryable-route-packaged-route-starting') {
              if (
                packagedProductionPluginPackagedRouteStartupLimitReached(
                  preflightNotReadyProbeCount,
                  maxPackagedRouteStartupAfterGlobalReadyProbes,
                )
              ) {
                await throwPlaygroundReadinessFailure(
                  child,
                  `Packaged production plugin signed preflight stayed startup-shaped after global WordPress startup HTTP ${indexProbe.status} for ${preflightNotReadyProbeCount} consecutive response${preflightNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedRouteStartupAfterGlobalReadyProbes})`,
                  lastError,
                  lastProbes,
                  getOutput(),
                  {
                    childPid: child.pid ?? null,
                    packagedProductionPlugin: true,
                    packagedRouteStartup: true,
                    preflightNotReadyProbeCount,
                  },
                );
              }
              if (
                packagedProductionPluginPackagedRouteStartupStillWithinBudget(
                  preflightNotReadyProbeCount,
                  maxPackagedRouteStartupAfterGlobalReadyProbes,
                )
              ) {
                await sleepUnlessChildExit(readinessProbeIntervalMs, child);
                continue;
              }
            }
            if (startupBranch?.kind === 'retryable-route-index-terminal') {
              const malformedIndexBody =
                packagedProductionPluginMalformedTerminalIndexProbe(indexProbe);
              await throwPlaygroundReadinessFailure(
                child,
                malformedIndexBody
                  ? `Packaged production plugin signed preflight stayed startup-shaped while /wp-json/ returned an invalid readiness body after ${preflightNotReadyProbeCount} consecutive response${preflightNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`
                  : `Packaged production plugin signed preflight stayed startup-shaped while /wp-json/ returned a terminal readiness failure HTTP ${indexProbe.status} after ${preflightNotReadyProbeCount} consecutive response${preflightNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`,
                lastError,
                lastProbes,
                getOutput(),
                {
                  childPid: child.pid ?? null,
                  packagedProductionPlugin: true,
                  ...(malformedIndexBody ? { invalidReadinessBody: true } : {}),
                  indexTerminal: true,
                  preflightNotReadyProbeCount,
                },
              );
            }
            if (packagedProductionPluginGlobalStartupStillWithinBudget(preflightNotReadyProbeCount)) {
              await sleepUnlessChildExit(readinessProbeIntervalMs, child);
              continue;
            }
            await throwPlaygroundReadinessFailure(
              child,
              `Packaged production plugin signed preflight hit the bounded readiness failure after ${preflightNotReadyProbeCount} consecutive startup-shaped response${preflightNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`,
              lastError,
              lastProbes,
              getOutput(),
              {
                childPid: child.pid ?? null,
                packagedProductionPlugin: true,
                notReadyProbeCount: preflightNotReadyProbeCount,
                maxNotReadyProbeCount: maxPackagedStartupNotReadyProbeCount,
              },
            );
          }
          await sleepUnlessChildExit(readinessProbeIntervalMs, child);
          continue;
        }
        lastError = error;
        notReadyProbeCounts = packagedProductionPluginResetRouteNotReadyProbeCounts(
          notReadyProbeCounts,
          'preflight',
        );
        await throwPlaygroundReadinessFailure(
          child,
          `Packaged production plugin signed preflight returned an invalid readiness body at ${baseUrl}`,
          lastError,
          lastProbes,
          getOutput(),
          packagedProductionPluginPreflightTerminalContext({
            childPid: child.pid ?? null,
          }),
        );
      }
      if (packagedProductionPluginPreflightReady({
        status: preflight.status,
        body: preflightBody,
      })) {
        notReadyProbeCounts = packagedProductionPluginResetRouteNotReadyProbeCounts(
          notReadyProbeCounts,
          'preflight',
        );
        return;
      }
      const malformedReadyPreflightBody =
        preflight.status === 200
        && preflightBody?.ok === true;
      if (malformedReadyPreflightBody) {
        lastError = new Error(`Production plugin package preflight readiness HTTP ${preflight.status}`);
        notReadyProbeCounts = packagedProductionPluginResetRouteNotReadyProbeCounts(
          notReadyProbeCounts,
          'preflight',
        );
        await throwPlaygroundReadinessFailure(
          child,
          `Packaged production plugin signed preflight returned an invalid readiness body at ${baseUrl}`,
          lastError,
          lastProbes,
          getOutput(),
          packagedProductionPluginPreflightTerminalContext({
            childPid: child.pid ?? null,
            invalidReadinessBody: true,
          }),
        );
      }
      lastError = new Error(`Production plugin package preflight readiness HTTP ${preflight.status}`);
      const packagedPreflightReadinessContext = { packagedStartup: true };
      if (packagedProductionPluginPreflightRetryable(
        {
          status: preflight.status,
          body: preflightBody,
        },
        packagedPreflightReadinessContext,
      )) {
        if (
          packagedProductionPluginRouteStartupClassificationReady(
            preflightNotReadyProbeCount,
          )
        ) {
          const indexProbe = await fetchPackagedWordPressIndexProbe(baseUrl, child).catch((indexError) =>
            buildPackagedTimeoutFallbackProbe('/wp-json/', indexError),
          );
          lastProbes.push(indexProbe);
          // Once /wp-json/ is available, re-evaluate retryability against the
          // current startup signal instead of the broad packaged-startup hint.
          const preflightRetryableWithIndex = packagedProductionPluginPreflightRetryable(
            {
              status: preflight.status,
              body: preflightBody,
            },
            {
              packagedStartup: true,
              snapshotProbe: packagedProductionPluginSnapshotProbeContext(activeSnapshotProbe),
              indexProbe,
            },
          );
          if (!preflightRetryableWithIndex) {
            notReadyProbeCounts = packagedProductionPluginResetRouteNotReadyProbeCounts(
              notReadyProbeCounts,
              'preflight',
            );
            const malformedIndexBody =
              packagedProductionPluginMalformedTerminalIndexProbe(indexProbe);
            await throwPlaygroundReadinessFailure(
              child,
              malformedIndexBody
                ? `Packaged production plugin signed preflight stayed startup-shaped while /wp-json/ returned an invalid readiness body after ${preflightNotReadyProbeCount} consecutive response${preflightNotReadyProbeCount === 1 ? '' : 's'} at ${baseUrl}`
                : `Packaged production plugin signed preflight stayed startup-shaped while /wp-json/ returned a terminal readiness failure HTTP ${indexProbe.status} after ${preflightNotReadyProbeCount} consecutive response${preflightNotReadyProbeCount === 1 ? '' : 's'} at ${baseUrl}`,
              lastError,
              lastProbes,
              getOutput(),
              {
                childPid: child.pid ?? null,
                packagedProductionPlugin: true,
                ...(malformedIndexBody ? { invalidReadinessBody: true } : {}),
                indexTerminal: true,
                preflightNotReadyProbeCount,
              },
            );
          }
          const startupBranch = packagedProductionPluginClassifyBoundedStartup(
            {
              retryable: true,
              status: preflight.status,
              body: preflightText,
            },
            indexProbe,
          );
          if (startupBranch?.kind === 'retryable-route-index-timeout') {
            lastTimeoutFallbackProbes = {
              preflightProbe: {
                route: '/wp-json/reprint/v1/push/preflight',
                status: preflight.status,
                body: preflightText.slice(0, readinessFailureBodyLimit),
              },
              indexProbe,
            };
            if (packagedProductionPluginGlobalStartupStillWithinBudget(preflightNotReadyProbeCount)) {
              await sleepUnlessChildExit(readinessProbeIntervalMs, child);
              continue;
            }
            await throwPlaygroundReadinessFailure(
              child,
              `Packaged production plugin signed preflight stayed startup-shaped while /wp-json/ timed out after ${preflightNotReadyProbeCount} consecutive response${preflightNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`,
              lastError,
              lastProbes,
              getOutput(),
              {
                childPid: child.pid ?? null,
                packagedProductionPlugin: true,
                indexProbeTimedOut: true,
                preflightNotReadyProbeCount,
              },
              lastTimeoutFallbackProbes,
            );
          }
          if (startupBranch?.kind === 'retryable-route-wordpress-starting') {
            if (packagedProductionPluginGlobalStartupStillWithinBudget(preflightNotReadyProbeCount)) {
              await sleepUnlessChildExit(readinessProbeIntervalMs, child);
              continue;
            }
            await throwPlaygroundReadinessFailure(
              child,
              `Packaged production plugin signed preflight stayed startup-shaped while /wp-json/ kept reporting global WordPress startup HTTP ${indexProbe.status} for ${preflightNotReadyProbeCount} consecutive response${preflightNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`,
              lastError,
              lastProbes,
              getOutput(),
              {
                childPid: child.pid ?? null,
                packagedProductionPlugin: true,
                preflightNotReadyProbeCount,
                globalWordPressStartup: true,
              },
            );
          }
            if (startupBranch?.kind === 'retryable-route-packaged-route-starting') {
              if (
                packagedProductionPluginPackagedRouteStartupLimitReached(
                  preflightNotReadyProbeCount,
                  maxPackagedRouteStartupAfterGlobalReadyProbes,
              )
            ) {
              await throwPlaygroundReadinessFailure(
                child,
                `Packaged production plugin signed preflight stayed startup-shaped after global WordPress startup HTTP ${indexProbe.status} for ${preflightNotReadyProbeCount} consecutive response${preflightNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedRouteStartupAfterGlobalReadyProbes})`,
                lastError,
                lastProbes,
                getOutput(),
                  {
                    childPid: child.pid ?? null,
                    packagedProductionPlugin: true,
                    packagedRouteStartup: true,
                  preflightNotReadyProbeCount,
                  },
                );
              }
              if (
                packagedProductionPluginPackagedRouteStartupStillWithinBudget(
                  preflightNotReadyProbeCount,
                  maxPackagedRouteStartupAfterGlobalReadyProbes,
                )
              ) {
                await sleepUnlessChildExit(readinessProbeIntervalMs, child);
                continue;
              }
            }
          if (startupBranch?.kind === 'retryable-route-index-terminal') {
            const malformedIndexBody =
              packagedProductionPluginMalformedTerminalIndexProbe(indexProbe);
            await throwPlaygroundReadinessFailure(
              child,
              malformedIndexBody
                ? `Packaged production plugin signed preflight stayed startup-shaped while /wp-json/ returned an invalid readiness body after ${preflightNotReadyProbeCount} consecutive response${preflightNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`
                : `Packaged production plugin signed preflight stayed startup-shaped while /wp-json/ returned a terminal readiness failure HTTP ${indexProbe.status} after ${preflightNotReadyProbeCount} consecutive response${preflightNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`,
              lastError,
              lastProbes,
              getOutput(),
              {
                childPid: child.pid ?? null,
                packagedProductionPlugin: true,
                ...(malformedIndexBody ? { invalidReadinessBody: true } : {}),
                indexTerminal: true,
                preflightNotReadyProbeCount,
              },
            );
          }
          if (packagedProductionPluginGlobalStartupStillWithinBudget(preflightNotReadyProbeCount)) {
            await sleepUnlessChildExit(readinessProbeIntervalMs, child);
            continue;
          }
          await throwPlaygroundReadinessFailure(
            child,
            `Packaged production plugin signed preflight hit the bounded readiness failure after ${preflightNotReadyProbeCount} consecutive startup-shaped response${preflightNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`,
            lastError,
            lastProbes,
            getOutput(),
            {
              childPid: child.pid ?? null,
              packagedProductionPlugin: true,
              notReadyProbeCount: preflightNotReadyProbeCount,
              maxNotReadyProbeCount: maxPackagedStartupNotReadyProbeCount,
            },
          );
        }
        await sleepUnlessChildExit(readinessProbeIntervalMs, child);
        continue;
      }
      notReadyProbeCounts = packagedProductionPluginResetRouteNotReadyProbeCounts(
        notReadyProbeCounts,
        'preflight',
      );
      await throwPlaygroundReadinessFailure(
        child,
        `Packaged production plugin signed preflight returned a terminal readiness failure at ${baseUrl}`,
        lastError,
        lastProbes,
        getOutput(),
        packagedProductionPluginPreflightTerminalContext({
          childPid: child.pid ?? null,
        }),
      );
    } catch (error) {
      if (!packagedProductionPluginReadinessErrorRetryable(error)) {
        throw error;
      }
      if (packagedProductionPluginReadinessProbeTimedOut(error)) {
        if (activePackagedReadinessPhase === 'preflight' && activeSnapshotProbe !== null) {
          noteReadinessPhase('preflight-timeout', `signed preflight probe timed out after snapshot responded; probing /wp-json/ readiness at ${baseUrl}`);
          const preflightProbe = buildPackagedTimeoutFallbackProbe('/wp-json/reprint/v1/push/preflight', error);
          const indexProbe = await fetchPackagedWordPressIndexProbe(baseUrl, child).catch((indexError) =>
            buildPackagedTimeoutFallbackProbe('/wp-json/', indexError),
          );
          lastTimeoutFallbackProbes = { preflightProbe, indexProbe };
          lastProbes.push(preflightProbe);
          const startupBranch = packagedProductionPluginClassifyTimeoutFallbackStartup(
            preflightProbe,
            indexProbe,
          );
          if (startupBranch?.kind === 'timed-out-route-wordpress-starting') {
            if (packagedProductionPluginGlobalStartupStillWithinBudget(activeSnapshotNotReadyProbeCount)) {
              lastError = error;
              timeoutProbeCount = 0;
              await sleepUnlessChildExit(readinessProbeIntervalMs, child);
              continue;
            }
            lastError = error;
            await throwPlaygroundReadinessFailure(
              child,
              `Packaged production plugin signed preflight probe timed out while /wp-json/ kept reporting global WordPress startup HTTP ${indexProbe?.status ?? 0} after ${activeSnapshotNotReadyProbeCount} consecutive startup-shaped snapshot response${activeSnapshotNotReadyProbeCount === 1 ? '' : 's'} at ${baseUrl}`,
              lastError,
              lastProbes,
              getOutput(),
              {
                childPid: child.pid ?? null,
                packagedProductionPlugin: true,
                globalWordPressStartup: true,
                snapshotNotReadyProbeCount: activeSnapshotNotReadyProbeCount,
              },
              lastTimeoutFallbackProbes,
            );
          }
          if (startupBranch?.kind === 'timed-out-route-packaged-route-starting') {
            if (
              packagedProductionPluginPackagedRouteStartupStillWithinBudget(
                activeSnapshotNotReadyProbeCount,
                maxPackagedRouteStartupAfterGlobalReadyProbes,
              )
            ) {
              lastError = error;
              timeoutProbeCount = 0;
              await sleepUnlessChildExit(readinessProbeIntervalMs, child);
              continue;
            }
            lastError = error;
            await throwPlaygroundReadinessFailure(
              child,
              `Packaged production plugin signed preflight probe timed out after global WordPress startup HTTP ${indexProbe?.status ?? 0} following ${activeSnapshotNotReadyProbeCount} consecutive startup-shaped snapshot response${activeSnapshotNotReadyProbeCount === 1 ? '' : 's'} at ${baseUrl}`,
              lastError,
              lastProbes,
              getOutput(),
              {
                childPid: child.pid ?? null,
                packagedProductionPlugin: true,
                packagedRouteStartup: true,
                snapshotNotReadyProbeCount: activeSnapshotNotReadyProbeCount,
              },
              lastTimeoutFallbackProbes,
            );
          }
          if (startupBranch?.kind === 'timed-out-route-index-timeout') {
            lastError = error;
            await throwPlaygroundReadinessFailure(
              child,
              `Packaged production plugin signed preflight probe timed out while /wp-json/ also timed out after snapshot responded at ${baseUrl}`,
              lastError,
              lastProbes,
              getOutput(),
              {
                childPid: child.pid ?? null,
                packagedProductionPlugin: true,
                indexProbeTimedOut: true,
                snapshotNotReadyProbeCount: activeSnapshotNotReadyProbeCount,
              },
              lastTimeoutFallbackProbes,
            );
          }
          if (startupBranch?.kind === 'timed-out-route-index-terminal') {
            const malformedIndexBody =
              packagedProductionPluginMalformedTerminalIndexProbe(indexProbe);
            lastError = error;
            await throwPlaygroundReadinessFailure(
              child,
              malformedIndexBody
                ? `Packaged production plugin signed preflight probe timed out while /wp-json/ returned an invalid readiness body after snapshot responded at ${baseUrl}`
                : `Packaged production plugin signed preflight probe timed out while /wp-json/ returned a terminal readiness failure HTTP ${indexProbe?.status ?? 0} after snapshot responded at ${baseUrl}`,
              lastError,
              lastProbes,
              getOutput(),
              {
                childPid: child.pid ?? null,
                packagedProductionPlugin: true,
                ...(malformedIndexBody ? { invalidReadinessBody: true } : {}),
                indexTerminal: true,
                snapshotNotReadyProbeCount: activeSnapshotNotReadyProbeCount,
              },
              lastTimeoutFallbackProbes,
            );
          }
          lastError = error;
          await throwPlaygroundReadinessFailure(
            child,
            `Packaged production plugin signed preflight probe timed out after snapshot responded at ${baseUrl}`,
            lastError,
            lastProbes,
            getOutput(),
            {
              childPid: child.pid ?? null,
              packagedProductionPlugin: true,
              preflightTimedOutAfterSnapshot: true,
              snapshotNotReadyProbeCount: activeSnapshotNotReadyProbeCount,
            },
            lastTimeoutFallbackProbes,
          );
        }
        noteReadinessPhase('timeout-fallback', `snapshot probe timed out; falling back to signed preflight and /wp-json/ readiness probes at ${baseUrl}`);
        const { preflightProbe, indexProbe } = await fetchPackagedTimeoutFallbackProbes(
          baseUrl,
          child,
          { packagedStartup: true },
        );
        lastTimeoutFallbackProbes = { preflightProbe, indexProbe };
        if (preflightProbe) {
          lastProbes.push(preflightProbe);
          if (preflightProbe.ready) {
            return;
          }
          if (preflightProbe.retryable) {
            const timeoutFallbackPreflightNotReadyProbeCount =
              (notReadyProbeCounts.preflight ?? 0) + 1;
            notReadyProbeCounts = {
              ...notReadyProbeCounts,
              preflight: timeoutFallbackPreflightNotReadyProbeCount,
            };
            const startupBranch = packagedProductionPluginClassifyTimeoutFallbackStartup(
              preflightProbe,
              indexProbe,
            );
            if (startupBranch?.kind === 'retryable-route-wordpress-starting') {
              if (
                packagedProductionPluginGlobalStartupStillWithinBudget(
                  timeoutFallbackPreflightNotReadyProbeCount,
                )
              ) {
                lastError = error;
                timeoutProbeCount = 0;
                await sleepUnlessChildExit(readinessProbeIntervalMs, child);
                continue;
              }
              lastError = error;
              await throwPlaygroundReadinessFailure(
                child,
                `Packaged production plugin signed preflight stayed startup-shaped while /wp-json/ kept reporting global WordPress startup HTTP ${indexProbe?.status ?? 0} for ${timeoutFallbackPreflightNotReadyProbeCount} consecutive response${timeoutFallbackPreflightNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount}) after the snapshot probe timed out at ${baseUrl}`,
                lastError,
                lastProbes,
                getOutput(),
                {
                  childPid: child.pid ?? null,
                  packagedProductionPlugin: true,
                  globalWordPressStartup: true,
                  preflightNotReadyProbeCount: timeoutFallbackPreflightNotReadyProbeCount,
                },
                lastTimeoutFallbackProbes,
              );
            }
            if (startupBranch?.kind === 'retryable-route-packaged-route-starting') {
              if (
                packagedProductionPluginPackagedRouteStartupStillWithinBudget(
                  timeoutFallbackPreflightNotReadyProbeCount,
                  maxPackagedRouteStartupAfterGlobalReadyProbes,
                )
              ) {
                lastError = error;
                timeoutProbeCount = 0;
                await sleepUnlessChildExit(readinessProbeIntervalMs, child);
                continue;
              }
              lastError = error;
              await throwPlaygroundReadinessFailure(
                child,
                `Packaged production plugin signed preflight stayed startup-shaped after global WordPress startup HTTP ${indexProbe?.status ?? 0} for ${timeoutFallbackPreflightNotReadyProbeCount} consecutive response${timeoutFallbackPreflightNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedRouteStartupAfterGlobalReadyProbes}) while the snapshot probe timed out at ${baseUrl}`,
                lastError,
                lastProbes,
                getOutput(),
                {
                  childPid: child.pid ?? null,
                  packagedProductionPlugin: true,
                  packagedRouteStartup: true,
                  preflightNotReadyProbeCount: timeoutFallbackPreflightNotReadyProbeCount,
                },
                lastTimeoutFallbackProbes,
              );
            }
            if (startupBranch?.kind === 'retryable-route-index-timeout') {
              lastError = error;
              await throwPlaygroundReadinessFailure(
                child,
                `Packaged production plugin signed preflight stayed startup-shaped while /wp-json/ timed out after the snapshot probe timed out at ${baseUrl}`,
                lastError,
                lastProbes,
                getOutput(),
                {
                  childPid: child.pid ?? null,
                  packagedProductionPlugin: true,
                  indexProbeTimedOut: true,
                },
                lastTimeoutFallbackProbes,
              );
            }
            if (startupBranch?.kind === 'retryable-route-index-terminal') {
              const malformedIndexBody =
                packagedProductionPluginMalformedTerminalIndexProbe(indexProbe);
              lastError = error;
              await throwPlaygroundReadinessFailure(
                child,
                malformedIndexBody
                  ? `Packaged production plugin signed preflight stayed startup-shaped while /wp-json/ returned an invalid readiness body after the snapshot probe timed out at ${baseUrl}`
                  : `Packaged production plugin signed preflight stayed startup-shaped while /wp-json/ returned a terminal readiness failure HTTP ${indexProbe?.status ?? 0} after the snapshot probe timed out at ${baseUrl}`,
                lastError,
                lastProbes,
                getOutput(),
                {
                  childPid: child.pid ?? null,
                  packagedProductionPlugin: true,
                  ...(malformedIndexBody ? { invalidReadinessBody: true } : {}),
                  indexTerminal: true,
                },
                lastTimeoutFallbackProbes,
              );
            }
            lastError = error;
            timeoutProbeCount = 0;
            await sleepUnlessChildExit(readinessProbeIntervalMs, child);
            continue;
          }
          if (preflightProbe.terminal) {
            lastError = error;
            const malformedTimeoutFallbackPreflightBody =
              preflightProbe.parsedBody === null
              && !packagedProductionPluginReadinessBodyRetryable(
                preflightProbe.status,
                preflightProbe.body || '',
              );
            notReadyProbeCounts = packagedProductionPluginResetRouteNotReadyProbeCounts(
              notReadyProbeCounts,
              'preflight',
            );
            await throwPlaygroundReadinessFailure(
              child,
              malformedTimeoutFallbackPreflightBody
                ? `Packaged production plugin signed preflight returned an invalid readiness body while the snapshot probe timed out at ${baseUrl}`
                : `Packaged production plugin signed preflight became terminal while the snapshot probe timed out at ${baseUrl}`,
              lastError,
              lastProbes,
              getOutput(),
              packagedProductionPluginPreflightTerminalContext(
                { childPid: child.pid ?? null },
                { timeoutFallback: true },
              ),
              lastTimeoutFallbackProbes,
            );
          }
          if (indexProbe) {
            const startupBranch = packagedProductionPluginClassifyTimeoutFallbackStartup(
              preflightProbe,
              indexProbe,
            );
            if (startupBranch?.kind === 'timed-out-route-wordpress-starting') {
              lastError = error;
              await throwPlaygroundReadinessFailure(
                child,
                  `Packaged production plugin signed preflight probe timed out while /wp-json/ kept reporting global WordPress startup HTTP ${indexProbe.status} after the snapshot probe timed out at ${baseUrl}`,
                lastError,
                lastProbes,
                getOutput(),
                {
                  childPid: child.pid ?? null,
                  packagedProductionPlugin: true,
                  globalWordPressStartup: true,
                },
                lastTimeoutFallbackProbes,
              );
            }
            if (startupBranch?.kind === 'timed-out-route-index-timeout') {
              lastError = error;
              await throwPlaygroundReadinessFailure(
                child,
                  `Packaged production plugin signed preflight probe timed out while /wp-json/ also timed out after the snapshot probe timed out at ${baseUrl}`,
                lastError,
                lastProbes,
                getOutput(),
                {
                  childPid: child.pid ?? null,
                  packagedProductionPlugin: true,
                  indexProbeTimedOut: true,
                },
                lastTimeoutFallbackProbes,
              );
            }
            if (startupBranch?.kind === 'timed-out-route-packaged-route-starting') {
              lastError = error;
              await throwPlaygroundReadinessFailure(
                child,
                  `Packaged production plugin signed preflight probe timed out after global WordPress startup HTTP ${indexProbe.status} while the snapshot probe timed out at ${baseUrl}`,
                lastError,
                lastProbes,
                getOutput(),
                {
                  childPid: child.pid ?? null,
                  packagedProductionPlugin: true,
                  packagedRouteStartup: true,
                },
                lastTimeoutFallbackProbes,
              );
            }
            if (startupBranch?.kind === 'timed-out-route-index-terminal') {
              const malformedIndexBody =
                packagedProductionPluginMalformedTerminalIndexProbe(indexProbe);
              lastError = error;
              await throwPlaygroundReadinessFailure(
                child,
                malformedIndexBody
                    ? `Packaged production plugin signed preflight probe timed out while /wp-json/ returned an invalid readiness body after the snapshot probe timed out at ${baseUrl}`
                    : `Packaged production plugin signed preflight probe timed out while /wp-json/ returned a terminal readiness failure HTTP ${indexProbe.status} after the snapshot probe timed out at ${baseUrl}`,
                lastError,
                lastProbes,
                getOutput(),
                {
                  childPid: child.pid ?? null,
                  packagedProductionPlugin: true,
                  ...(malformedIndexBody ? { invalidReadinessBody: true } : {}),
                  indexTerminal: true,
                },
                lastTimeoutFallbackProbes,
              );
            }
          }
        }
        if (indexProbe) {
          lastProbes.push(indexProbe);
        }
        if (packagedProductionPluginReadinessBodyRetryable(indexProbe?.status, indexProbe?.body || '')) {
          lastError = error;
          timeoutProbeCount = 0;
          await sleepUnlessChildExit(readinessProbeIntervalMs, child);
          continue;
        }
      }
      lastError = error;
      timeoutProbeCount = packagedProductionPluginNextTimeoutProbeCount(timeoutProbeCount, error);
      if (
        packagedProductionPluginReadinessProbeTimedOut(error)
        && packagedProductionPluginNotReadyProbeLimitReached(timeoutProbeCount)
      ) {
        await throwPlaygroundReadinessFailure(
          child,
          `Packaged production plugin readiness hit ${timeoutProbeCount} consecutive probe timeout${timeoutProbeCount === 1 ? '' : 's'}`,
          lastError,
          lastProbes,
          getOutput(),
          {
            childPid: child.pid ?? null,
            packagedProductionPlugin: true,
            timeoutProbeCount,
            maxTimeoutProbeCount: packagedProductionPluginMaxConsecutiveNotReadyProbes,
          },
          lastTimeoutFallbackProbes,
        );
      }
    }
    await sleepUnlessChildExit(readinessProbeIntervalMs, child);
  }
  await throwPlaygroundReadinessFailure(
    child,
    `Timed out waiting for packaged Playground server at ${baseUrl}`,
    lastError,
    lastProbes,
    getOutput(),
    {
      childPid: child.pid ?? null,
      packagedProductionPlugin: true,
    },
    lastTimeoutFallbackProbes,
  );
}

function packagedProductionPluginGlobalStartupStillWithinBudget(notReadyProbeCount) {
  return !packagedProductionPluginNotReadyProbeLimitReached(
    notReadyProbeCount,
    maxPackagedStartupNotReadyProbeCount,
  );
}

function packagedProductionPluginRouteStartupClassificationReady(notReadyProbeCount) {
  return packagedProductionPluginNotReadyProbeLimitReached(
    notReadyProbeCount,
    maxPackagedRouteStartupAfterGlobalReadyProbes,
  );
}

async function fetchPackagedWordPressIndexProbe(baseUrl, child = null) {
  const { response, bodyText } = await fetchTextWithTimeout(`${baseUrl}/wp-json/`, {
    headers: { connection: 'close' },
  }, packagedServerFetchTimeoutMs, child);
  let parsedBody = null;
  try {
    parsedBody = JSON.parse(bodyText);
  } catch {}
  return {
    route: '/wp-json/',
    status: response.status,
    ok: response.ok,
    body: bodyText.slice(0, readinessFailureBodyLimit),
    parsedBody,
  };
}

async function fetchPackagedPreflightProbe(baseUrl, child = null, readinessContext = {}) {
  const { response, bodyText } = await fetchTextWithTimeout(`${baseUrl}/wp-json/reprint/v1/push/preflight`, {
    method: 'GET',
    headers: {
      connection: 'close',
      ...signedHeadersForProductionPreflight(),
    },
  }, packagedServerFetchTimeoutMs, child);

  let body = null;
  try {
    body = JSON.parse(bodyText);
  } catch {}

  const probe = {
    route: '/wp-json/reprint/v1/push/preflight',
    status: response.status,
    ok: response.ok,
    body: bodyText.slice(0, readinessFailureBodyLimit),
    parsedBody: null,
    ready: false,
    retryable: false,
    terminal: false,
  };

  if (body !== null) {
    probe.parsedBody = body;
    probe.ready = packagedProductionPluginPreflightReady({ status: response.status, body });
    probe.retryable = packagedProductionPluginPreflightRetryable(
      { status: response.status, body },
      readinessContext,
    );
    probe.terminal = !probe.ready && !probe.retryable;
    return probe;
  }

  probe.retryable = packagedProductionPluginReadinessBodyRetryable(response.status, bodyText);
  probe.terminal = !probe.retryable;
  return probe;
}

async function fetchPackagedTimeoutFallbackProbes(baseUrl, child = null, readinessContext = {}) {
  const preflightProbe = await fetchPackagedPreflightProbe(baseUrl, child, readinessContext).catch((error) =>
    buildPackagedTimeoutFallbackProbe('/wp-json/reprint/v1/push/preflight', error),
  );
  const indexProbe = await fetchPackagedWordPressIndexProbe(baseUrl, child).catch((error) =>
    buildPackagedTimeoutFallbackProbe('/wp-json/', error),
  );
  if (preflightProbe && preflightProbe.ready !== true) {
    preflightProbe.retryable = packagedProductionPluginPreflightRetryable(
      {
        status: preflightProbe.status,
        body: preflightProbe.parsedBody ?? preflightProbe.body,
      },
      { ...readinessContext, indexProbe },
    );
    preflightProbe.terminal = !preflightProbe.retryable;
  }
  return { preflightProbe, indexProbe };
}

function buildPackagedTimeoutFallbackProbe(route, error) {
  if (!packagedProductionPluginReadinessProbeTimedOut(error)) {
    throw error;
  }

  return {
    route,
    status: 0,
    ok: false,
    body: String(error?.message || error).slice(0, readinessFailureBodyLimit),
    ready: false,
    retryable: false,
    terminal: false,
    timedOut: true,
  };
}

async function fetchTextWithTimeout(url, init = {}, timeoutMs = serverFetchTimeoutMs, child = null) {
  const response = await fetchWithTimeout(url, init, timeoutMs, child);
  const bodyTextPromise = response.text();
  const childExitWatcher = createChildExitPromise(child, url);
  try {
    const bodyText = childExitWatcher
      ? await Promise.race([bodyTextPromise, childExitWatcher.promise])
      : await bodyTextPromise;
    return { response, bodyText };
  } finally {
    childExitWatcher?.cleanup();
  }
}

async function stopExitedServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await stopSpawnedServer(child);
}

async function stopSpawnedServer(child) {
  stopProcessTree(child, 'SIGTERM');
  try {
    await waitForExit(child, 500);
    return;
  } catch {
    stopProcessTree(child, 'SIGKILL');
    try {
      await waitForExit(child, 2_000);
    } catch {
      process.stderr.write('Playground server did not exit after SIGKILL\n');
      if (typeof child.pid === 'number') {
        process.stderr.write(`Playground child pid still active: ${child.pid}\n`);
      }
    }
  }
}

stopAllPlaygroundChildren = async function stopAllPlaygroundChildren() {
  for (const child of activePlaygroundChildren) {
    try {
      await stopSpawnedServer(child);
    } catch {
      stopProcessTree(child, 'SIGKILL');
    }
  }
};

stopAllPlaygroundChildrenSync = function stopAllPlaygroundChildrenSync() {
  for (const child of activePlaygroundChildren) {
    stopProcessTree(child, 'SIGTERM');
    stopProcessTree(child, 'SIGKILL');
  }
};

function stopProcessTree(child, signal) {
  try {
    if (child.pid && process.platform !== 'win32') {
      process.kill(-child.pid, signal);
      return;
    }
  } catch {}
  child.kill(signal);
}

function installProcessCleanup() {
  const cleanup = () => {
    stopAllPlaygroundChildrenSync();
  };

  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });
  process.on('exit', cleanup);
}

installProcessCleanup();

async function exportSnapshot(name, baseUrl) {
  const response = await fetch(`${baseUrl}/wp-json/reprint-push-lab/v1/snapshot`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`,
    },
  });
  assert.equal(response.status, 200, `${name} snapshot HTTP ${response.status}`);
  const body = await response.json();
  assert.equal(body.ok, true, `${name} snapshot body not ok`);
  return body.snapshot;
}

async function exportProductionSnapshot(name, baseUrl) {
  const response = await fetch(`${baseUrl}/wp-json/reprint/v1/push/snapshot`, {
    headers: {
      ...authHeaders(),
      connection: 'close',
    },
  });
  assert.equal(response.status, 200, `${name} snapshot HTTP ${response.status}`);
  const body = await response.json();
  assert.equal(body.ok, true, `${name} snapshot body not ok`);
  return body.snapshot;
}

function withoutUnmappedGraphPostmeta(snapshot) {
  const next = JSON.parse(JSON.stringify(snapshot));
  delete next.db?.wp_postmeta?.['post_id:2001:meta_key:_reprint_push_forms_schema'];
  if (next.db?.wp_postmeta && Object.keys(next.db.wp_postmeta).length === 0) {
    delete next.db.wp_postmeta;
  }
  return next;
}

function runBoundedSync(command, args, options, label) {
  const boundedOptions = {
    shell: false,
    killSignal: 'SIGKILL',
    timeout: 10_000,
    ...options,
  };
  const proof = spawnSync(command, args, boundedOptions);
  if (proof.error || proof.signal || proof.status === null || proof.status !== 0) {
    stopAllPlaygroundChildrenSync();
    const commandLabel = `${command} ${args.join(' ')}`;
    process.stderr.write(`${describeSpawnProof(proof)}\n`);
    process.stdout.write(`${describeSpawnProof(proof)}\n`);
    writeSpawnOutputTail(proof, commandLabel);
  }
  if (proof.error) {
    const timeoutNote = proof.error.code === 'ETIMEDOUT' && boundedOptions.timeout ? ` after ${boundedOptions.timeout}ms` : '';
    const detailParts = [
      proof.error.name ?? 'Error',
      proof.error.code ? `code=${proof.error.code}` : null,
      proof.error.errno ? `errno=${proof.error.errno}` : null,
      proof.status !== null ? `status=${proof.status}` : null,
      proof.signal ? `signal=${proof.signal}` : null,
    ].filter(Boolean);
    throw new Error(
      `${label} failed${timeoutNote} with ${detailParts.join(' ')}: ${proof.error.message}\nstdout:\n${proof.stdout ?? ''}\nstderr:\n${proof.stderr ?? ''}`,
    );
  }
  if (proof.signal) {
    throw new Error(
      `${label} terminated by ${proof.signal}\nstdout:\n${proof.stdout ?? ''}\nstderr:\n${proof.stderr ?? ''}`,
    );
  }
  if (proof.status === null) {
    throw new Error(
      `${label} exited without a status\nstdout:\n${proof.stdout ?? ''}\nstderr:\n${proof.stderr ?? ''}`,
    );
  }
  if (proof.status !== 0) {
    throw new Error(
      `${label} exited with ${proof.status}\nstdout:\n${proof.stdout ?? ''}\nstderr:\n${proof.stderr ?? ''}`,
    );
  }
  return proof;
}

function runProductionRecoveryJournalProof({ plan, current, artifactRefs = {} }) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-release-journal-'));
  const journalPath = path.join(workDir, 'production-recovery.journal.jsonl');
  try {
    const activeClaimId = digest({
      planId: plan.id,
      observedHash: digest(current),
      artifactRefs,
    });
    const journal = openProductionRecoveryJournal({
      filePath: journalPath,
      plan,
      current,
      artifactRefs,
      claimId: activeClaimId,
    });
    journal.close();

    const inspection = consumeProductionRecoveryJournal({
      filePath: journalPath,
      plan,
      current,
      artifactRefs,
      claimId: activeClaimId,
    });
    assert.equal(inspection.consumed, true, 'production recovery journal consumer must report consumption');
    assert.equal(inspection.journal.productionAdapter, 'openProductionRecoveryJournal');
    assert.equal(inspection.journal.ownsJournal, true);
    assert.equal(inspection.journal.consumed, true);
    assert.equal(inspection.journal.restartReadable, true);

    const staleClaimId = `${activeClaimId}-stale`;
    let staleClaimRejected = false;
    let staleJournal = null;
    try {
      staleJournal = openProductionRecoveryJournal({
        filePath: journalPath,
        plan,
        current,
        artifactRefs,
        truncate: false,
        claimId: staleClaimId,
      });
      staleJournal.appendEvent('journal-opened', {
        planId: plan.id,
        state: 'opened',
        observedHash: digest(current),
        artifactRefs,
      });
    } catch (error) {
      staleClaimRejected = error?.code === 'RECOVERY_CLAIM_STALE';
    } finally {
      staleJournal?.close();
    }

    return {
      journal: {
        ...inspection.journal,
        staleClaimRejected,
      },
      leaseFence: {
        ...inspection.leaseFence,
        staleClaimRejected,
      },
      consumed: inspection.consumed,
    };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

function checkedReleaseDurableJournalProofIsAcceptable(dbJournal) {
  return /(packaged production plugin|checked live production-shaped) journal surface/i.test(dbJournal?.scope || '')
    && dbJournal?.ownership?.ownsJournal === true
    && dbJournal?.ownership?.restartReadable === true
    && dbJournal?.ownership?.productionAdapter === 'wpdb-single-statement-cas'
    && dbJournal?.leaseFence?.boundary === 'wpdb-single-statement-cas'
    && dbJournal?.leaseFence?.claimKeyUnique === true
    && dbJournal?.leaseFence?.monotonicSequence === true
    && dbJournal?.leaseFence?.restartReadable === true;
}

function writeSpawnOutputTail(proof, commandLabel = '') {
  const stdout = (proof.stdout ?? '').trimEnd();
  if (!stdout) {
    return;
  }
  const stdoutTail = stdout.slice(-4000);
  let structuredTail = null;
  try {
    const parsed = JSON.parse(stdoutTail.slice(stdoutTail.indexOf('{')));
    const lastProbe = parsed.lastProbe ?? parsed.lastProbeSummary ?? parsed.lastProbeResult ?? null;
    const topLevel = parsed.lastProbe
      ? parsed
      : parsed?.summary
        ? parsed.summary
        : parsed;
    structuredTail = {
      route: lastProbe?.route ?? topLevel?.route ?? parsed?.route ?? null,
      status: lastProbe?.status ?? topLevel?.status ?? parsed?.status ?? null,
      body: lastProbe?.body ?? topLevel?.body ?? parsed?.body ?? null,
    };
  } catch {
    structuredTail = null;
  }
  if (commandLabel) {
    process.stderr.write(`${commandLabel} stdout tail:\n${stdoutTail}\n`);
  } else {
    process.stderr.write(`stdout tail:\n${stdoutTail}\n`);
  }
  if (structuredTail && (structuredTail.route !== null || structuredTail.status !== null || structuredTail.body !== null)) {
    process.stderr.write(`Last route/status/body: ${JSON.stringify(structuredTail, null, 2)}\n`);
  }
}

function snapshotHash(snapshot) {
  return createHash('sha256').update(JSON.stringify(snapshot), 'utf8').digest('hex');
}

function createPackagedProductionPluginFixture() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-release-packaged-plugin-'));
  const packageRoot = path.join(tmpDir, 'package');
  const pluginDir = path.join(packageRoot, 'reprint-push');
  const blueprintPath = path.join(tmpDir, 'remote-base-with-reprint-push-plugin.blueprint.json');
  buildPluginPackage(pluginDir);
  writePackagedProductionPluginBlueprint(remoteBaseFixturePath, blueprintPath);
  return {
    tmpDir,
    pluginDir,
    blueprintPath,
    cleanup() {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

function buildPluginPackage(targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  fs.cpSync(path.join(repoRoot, 'plugins/reprint-push'), targetDir, { recursive: true });
  const includesDir = path.join(targetDir, 'includes');
  fs.mkdirSync(includesDir, { recursive: true });
  for (const file of [
    'push-remote-rest-plugin.php',
    'push-remote-lib.php',
    'push-db-journal-lib.php',
    'snapshot-lib.php',
  ]) {
    fs.copyFileSync(
      path.join(repoRoot, 'scripts/playground', file),
      path.join(includesDir, file),
    );
  }
}

function writePackagedProductionPluginBlueprint(sourceBlueprintPath, targetBlueprintPath) {
  const blueprint = JSON.parse(fs.readFileSync(sourceBlueprintPath, 'utf8'));
  blueprint.meta = {
    ...blueprint.meta,
    title: 'Reprint Push Production Plugin Package',
    description: 'Remote base fixture with the packaged Reprint Push plugin activated.',
  };
  blueprint.steps.push({
    step: 'runPHP',
    code: [
      '<?php',
      "require_once '/wordpress/wp-load.php';",
      '$stable_uuid = static function (string $seed): string { $hex = md5($seed); return substr($hex, 0, 8) . \'-\' . substr($hex, 8, 4) . \'-\' . substr($hex, 12, 4) . \'-\' . substr($hex, 16, 4) . \'-\' . substr($hex, 20, 12); };',
      "$login = 'reprint_push_unscoped_admin';",
      "$app_password = 'reprint-push-unscoped-app-password';",
      "$slug = 'unscoped-admin';",
      '$user_id = wp_insert_user(array(\'user_login\' => $login, \'user_pass\' => wp_generate_password(32, true, true), \'user_email\' => sanitize_user($login, true) . \'@example.test\', \'display_name\' => $login, \'role\' => \'administrator\'));',
      'if (is_wp_error($user_id)) { throw new RuntimeException($user_id->get_error_message()); }',
      '$uuid = $stable_uuid(\'reprint-push-unscoped-\' . $slug);',
      '$app_id = $stable_uuid(\'reprint-push-unscoped-app-\' . $slug);',
      '$items = get_user_meta($user_id, \'_application_passwords\', true);',
      '$items = is_array($items) ? array_values($items) : array();',
      '$items[] = array(\'uuid\' => $uuid, \'app_id\' => $app_id, \'name\' => \'Unscoped Application Password\', \'password\' => wp_hash_password(preg_replace(\'/[^a-zA-Z0-9]/\', \'\', $app_password)), \'created\' => time(), \'last_used\' => null, \'last_ip\' => null);',
      'update_user_meta($user_id, \'_application_passwords\', $items);',
    ].join(' '),
  });
  blueprint.steps.push({
    step: 'runPHP',
    code: [
      '<?php',
      "require_once '/wordpress/wp-load.php';",
      "require_once ABSPATH . 'wp-admin/includes/plugin.php';",
      "$result = activate_plugin('reprint-push/reprint-push.php');",
      'if (is_wp_error($result)) { throw new RuntimeException($result->get_error_message()); }',
    ].join(' '),
  });
  blueprint.steps.push({
    step: 'runPHP',
    code: [
      '<?php',
      "require_once '/wordpress/wp-load.php';",
      '$result = reprint_push_lab_rest_provision_push_application_password(array(\'login\' => \'reprint_push_admin\', \'appPassword\' => \'reprint-push-admin-app-password\', \'role\' => \'administrator\', \'slug\' => \'primary-admin\', \'name\' => \'Reprint Push Package Smoke\', \'createUser\' => true, \'updateRole\' => true));',
      'if (empty($result[\'ok\'])) { throw new RuntimeException((string) ($result[\'message\'] ?? \'push credential provisioning failed\')); }',
    ].join(' '),
  });
  fs.writeFileSync(targetBlueprintPath, `${JSON.stringify(blueprint, null, 2)}\n`);
}

function exportSnapshotFromBlueprint(name, blueprintPath) {
  const trackedSnapshot = loadBlueprintSnapshotFixture(name, blueprintPath);
  if (trackedSnapshot) {
    return trackedSnapshot;
  }
  const result = spawnSync('npx', [
    '--yes',
    '@wp-playground/cli@latest',
    'php',
    '--blueprint',
    blueprintPath,
    '--mount',
    `${repoRoot}:/workspace`,
    '--verbosity',
    'quiet',
    '--',
    '/workspace/scripts/playground/export-site-snapshot.php',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
    timeout: packagedSnapshotExportTimeoutMs,
    killSignal: 'SIGTERM',
  });
  if (result.error) {
    const timeoutNote = result.error.code === 'ETIMEDOUT'
      ? ` after ${packagedSnapshotExportTimeoutMs}ms`
      : '';
    throw new Error(
      `Playground snapshot export failed for ${name}${timeoutNote}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}\n${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(`Playground snapshot export failed for ${name}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return parseMarkedJson(
    result.stdout,
    'REPRINT_PUSH_SNAPSHOT_JSON_BEGIN',
    'REPRINT_PUSH_SNAPSHOT_JSON_END',
    `Snapshot markers missing for ${name}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
  );
}

function parseMarkedJson(stdout, startMarker, endMarker, errorMessage) {
  const startIndex = stdout.indexOf(startMarker);
  const endIndex = stdout.indexOf(endMarker);
  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    throw new Error(errorMessage);
  }
  return JSON.parse(stdout.slice(startIndex + startMarker.length, endIndex).trim());
}

function resolveReleaseBoundary(proof) {
  return proof?.boundary || {
    firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
    status: 'unimplemented',
    verdict: proof?.code === 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED'
      ? 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED'
      : 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
    durableJournal: {
      storageLeaseFence: 'production durable journal storage, lease, and fencing are not yet proven beyond the retained Playground journal path',
      verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
    },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sleepUnlessChildExit(ms, child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onExit = () => {
      cleanup();
      resolve();
    };

    const cleanup = () => {
      clearTimeout(timer);
      child.off('exit', onExit);
      child.off('close', onExit);
    };

    child.once('exit', onExit);
    child.once('close', onExit);
  });
}

function appendNodeOption(existing, option) {
  return [existing, option].filter(Boolean).join(' ');
}

function localhostListenPreloadOption() {
  const source = `
import http from 'node:http';
const originalListen = http.Server.prototype.listen;
http.Server.prototype.listen = function reprintPushLocalhostListen(...args) {
  if (typeof args[0] === 'number' && (args.length === 1 || typeof args[1] === 'function')) {
    return originalListen.call(this, args[0], '127.0.0.1', ...args.slice(1));
  }
  if (typeof args[0] === 'number' && typeof args[1] === 'number') {
    return originalListen.call(this, args[0], '127.0.0.1', ...args.slice(1));
  }
  return Reflect.apply(originalListen, this, args);
};
`;
  return `--import=data:text/javascript,${encodeURIComponent(source)}`;
}

function summarizeAuthSessionLifecycle(trace) {
  if (!Array.isArray(trace) || trace.length === 0) {
    return null;
  }

  const observations = trace
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      step: entry.step ?? null,
      status: entry.status ?? null,
      expired: Boolean(entry.expired),
      revoked: Boolean(entry.revoked),
      cleanedUp: Boolean(entry.cleanedUp),
      rotated: Boolean(entry.rotated),
      preserved: Boolean(entry.preserved),
    }));
  const readObservation = [...observations]
    .reverse()
    .find((entry) => entry.step === 'journal'
      || entry.step === 'replay'
      || entry.step === 'apply'
      || entry.step === 'dry-run'
      || entry.step === 'preflight') ?? null;

  return {
    issued: observations[0] ?? null,
    read: readObservation,
    expired: observations.find((entry) => entry.expired) ?? null,
    revoked: observations.find((entry) => entry.revoked) ?? null,
    cleanedUp: observations.find((entry) => entry.cleanedUp) ?? null,
    rotated: observations.find((entry) => entry.rotated) ?? null,
    preserved: observations.find((entry) => entry.preserved) ?? null,
    observations,
  };
}

async function waitForServer(child, baseUrl, getLogs) {
  const deadline = Date.now() + serverStartupTimeoutMs;
  let lastError = null;
  const lastProbes = [];
  let notReadyProbeCount = 0;
  let snapshotNotReadyProbeCount = 0;
  let timeoutProbeCount = 0;
  let snapshotTimeoutProbeCount = 0;
  let lastSnapshotTimeoutContext = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      const exitLabel =
        child.exitCode !== null ? `exited early with ${child.exitCode}` : `terminated by ${child.signalCode}`;
      const message = formatPlaygroundStartupFailure(
        `Playground server ${exitLabel}`,
        lastError,
        lastProbes,
        getLogs(),
        { childPid: child.pid ?? null },
      );
      writePlaygroundFailure(message, lastProbes, getLogs(), lastError);
      await stopSpawnedServer(child);
      throw new Error(message);
    }
    try {
      const { response, bodyText: responseBody } = await fetchTextWithTimeout(`${baseUrl}/wp-json/`, {
        headers: { connection: 'close' },
      }, serverFetchTimeoutMs, child);
      timeoutProbeCount = 0;
      const responsePreview = responseBody.slice(0, readinessFailureBodyLimit);
      const lastRouteStatusBody = {
        route: '/wp-json/',
        status: response.status,
        body: responsePreview,
      };
      lastProbes.push({
        ...lastRouteStatusBody,
        ok: response.ok,
      });
      process.stderr.write(
        `Playground probe ${baseUrl}/wp-json/ -> ${response.status} ${responsePreview.slice(0, 160).replace(/\s+/g, ' ').trim()}\n`,
      );
      const readinessRetryable = labReadinessBodyRetryable(response.status, responseBody);
      if (response.status === 200 && !readinessRetryable) {
        notReadyProbeCount = 0;
        let snapshot;
        let snapshotBody;
        try {
          ({ response: snapshot, bodyText: snapshotBody } = await fetchTextWithTimeout(`${baseUrl}/wp-json/reprint-push-lab/v1/snapshot`, {
            headers: {
              Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`,
              connection: 'close',
            },
          }, serverFetchTimeoutMs, child));
        } catch (error) {
          if (labReadinessProbeTimedOut(error)) {
            lastError = error;
            snapshotTimeoutProbeCount = labNextTimeoutProbeCount(snapshotTimeoutProbeCount, error);
            lastSnapshotTimeoutContext = {
              timeoutProbeCount: snapshotTimeoutProbeCount,
              globalWordPressReady: true,
            };
            if (labNotReadyProbeLimitReached(snapshotTimeoutProbeCount, maxSnapshotTimeoutFallbackProbes)) {
              await throwPlaygroundReadinessFailure(
                child,
                `Playground lab snapshot probe timed out after global WordPress readiness HTTP ${response.status} after ${snapshotTimeoutProbeCount} consecutive timeout${snapshotTimeoutProbeCount === 1 ? '' : 's'}`,
                lastError,
                lastProbes,
                getLogs(),
                {
                  childPid: child.pid ?? null,
                  timeoutProbeCount: snapshotTimeoutProbeCount,
                  timeoutProbeLimit: maxSnapshotTimeoutFallbackProbes,
                  globalWordPressReady: true,
                  snapshotProbeTimedOut: true,
                },
              );
            }
            await sleepUnlessChildExit(readinessProbeIntervalMs, child);
            continue;
          }
          throw error;
        }
        snapshotTimeoutProbeCount = 0;
        lastSnapshotTimeoutContext = null;
        timeoutProbeCount = 0;
        const snapshotPreview = snapshotBody.slice(0, readinessFailureBodyLimit);
        lastProbes.push({
          route: '/wp-json/reprint-push-lab/v1/snapshot',
          status: snapshot.status,
          ok: snapshot.ok,
          body: snapshotPreview,
        });
        process.stderr.write(
          `Playground probe ${baseUrl}/wp-json/reprint-push-lab/v1/snapshot -> ${snapshot.status} ${snapshotPreview.slice(0, 160).replace(/\s+/g, ' ').trim()}\n`,
        );
        let snapshotJson = null;
        try {
          snapshotJson = JSON.parse(snapshotBody);
        } catch (error) {
          if (labReadinessBodyRetryable(snapshot.status, snapshotBody)) {
            snapshotNotReadyProbeCount += 1;
            lastError = new Error(
              `Playground lab snapshot readiness HTTP ${snapshot.status}; ${describeLastProbe(lastProbes.at(-1))}`,
            );
            if (labNotReadyProbeLimitReached(snapshotNotReadyProbeCount, maxSnapshotStartupAfterGlobalReadyProbes)) {
              await throwPlaygroundReadinessFailure(
                child,
                `Playground lab snapshot stayed startup-shaped after global WordPress readiness HTTP ${response.status} for ${snapshotNotReadyProbeCount} consecutive response${snapshotNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxSnapshotStartupAfterGlobalReadyProbes})`,
                lastError,
                lastProbes,
                getLogs(),
                {
                  childPid: child.pid ?? null,
                  snapshotNotReadyProbeCount,
                  globalWordPressReady: true,
                },
              );
            }
            await sleepUnlessChildExit(readinessProbeIntervalMs, child);
            continue;
          }
          snapshotNotReadyProbeCount = 0;
          lastError = error;
          await throwPlaygroundReadinessFailure(
            child,
            `Playground lab snapshot returned an invalid readiness body at ${baseUrl}`,
            lastError,
            lastProbes,
            getLogs(),
            { childPid: child.pid ?? null },
          );
        }
        if (labSnapshotReady({
          status: snapshot.status,
          body: snapshotJson,
        })) {
          snapshotNotReadyProbeCount = 0;
          return;
        }
        lastError = new Error(
          `Playground lab snapshot readiness HTTP ${snapshot.status}; ${describeLastProbe(lastProbes.at(-1))}`,
        );
        if (labSnapshotRetryable({
          status: snapshot.status,
          body: snapshotJson,
        })) {
          snapshotNotReadyProbeCount += 1;
          if (labNotReadyProbeLimitReached(snapshotNotReadyProbeCount, maxSnapshotStartupAfterGlobalReadyProbes)) {
            await throwPlaygroundReadinessFailure(
              child,
              `Playground lab snapshot stayed startup-shaped after global WordPress readiness HTTP ${response.status} for ${snapshotNotReadyProbeCount} consecutive response${snapshotNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxSnapshotStartupAfterGlobalReadyProbes})`,
              lastError,
              lastProbes,
              getLogs(),
              {
                childPid: child.pid ?? null,
                snapshotNotReadyProbeCount,
                globalWordPressReady: true,
              },
            );
          }
          await sleepUnlessChildExit(readinessProbeIntervalMs, child);
          continue;
        }
        snapshotNotReadyProbeCount = 0;
        await throwPlaygroundReadinessFailure(
          child,
          `Playground lab snapshot returned a terminal readiness failure at ${baseUrl}`,
          lastError,
          lastProbes,
          getLogs(),
          { childPid: child.pid ?? null },
        );
      } else {
        const readinessHint = readinessRetryable
          ? responseBody.match(/WordPress is not ready yet/i)?.[0]
            ?? responseBody.match(/No route was found matching the URL and request method\.?/i)?.[0]
            ?? responseBody.match(/wordpress_not_ready|rest_no_route/i)?.[0]
            ?? 'startup route is not ready yet'
          : null;
        const routeSummary = describeLastRouteStatusBody(lastRouteStatusBody);
        lastError = new Error(
          readinessRetryable
            ? `Playground index readiness HTTP ${response.status}: ${readinessHint}; ${routeSummary}`
            : `Playground index readiness HTTP ${response.status}; ${routeSummary}`,
        );
        const readinessProbeCount = lastProbes.filter((probe) => probe.route === '/wp-json/').length;
        if (readinessRetryable) {
          let snapshot;
          let snapshotBody;
          try {
            ({ response: snapshot, bodyText: snapshotBody } = await fetchTextWithTimeout(`${baseUrl}/wp-json/reprint-push-lab/v1/snapshot`, {
              headers: {
                Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`,
                connection: 'close',
              },
            }, serverFetchTimeoutMs, child));
          } catch (error) {
            if (labReadinessProbeTimedOut(error)) {
              lastError = error;
              snapshotTimeoutProbeCount = labNextTimeoutProbeCount(snapshotTimeoutProbeCount, error);
              lastSnapshotTimeoutContext = {
                timeoutProbeCount: snapshotTimeoutProbeCount,
                startupIndexStatus: response.status,
              };
              if (labNotReadyProbeLimitReached(snapshotTimeoutProbeCount, maxSnapshotTimeoutFallbackProbes)) {
                await throwPlaygroundReadinessFailure(
                  child,
                  `Playground lab snapshot probe timed out while /wp-json/ still reported startup-shaped readiness HTTP ${response.status} after ${snapshotTimeoutProbeCount} consecutive timeout${snapshotTimeoutProbeCount === 1 ? '' : 's'}`,
                  lastError,
                  lastProbes,
                  getLogs(),
                  {
                    childPid: child.pid ?? null,
                    timeoutProbeCount: snapshotTimeoutProbeCount,
                    timeoutProbeLimit: maxSnapshotTimeoutFallbackProbes,
                    startupIndexStatus: response.status,
                    snapshotProbeTimedOut: true,
                  },
                );
              }
              await sleepUnlessChildExit(readinessProbeIntervalMs, child);
              continue;
            }
            throw error;
          }
          timeoutProbeCount = 0;
          snapshotTimeoutProbeCount = 0;
          lastSnapshotTimeoutContext = null;
          const snapshotPreview = snapshotBody.slice(0, readinessFailureBodyLimit);
          lastProbes.push({
            route: '/wp-json/reprint-push-lab/v1/snapshot',
            status: snapshot.status,
            ok: snapshot.ok,
            body: snapshotPreview,
          });
          process.stderr.write(
            `Playground probe ${baseUrl}/wp-json/reprint-push-lab/v1/snapshot -> ${snapshot.status} ${snapshotPreview.slice(0, 160).replace(/\s+/g, ' ').trim()}\n`,
          );
          let snapshotJson = null;
          try {
            snapshotJson = JSON.parse(snapshotBody);
          } catch (error) {
            if (!labReadinessBodyRetryable(snapshot.status, snapshotBody)) {
              lastError = error;
              await throwPlaygroundReadinessFailure(
                child,
                `Playground lab snapshot returned an invalid readiness body at ${baseUrl}`,
                lastError,
                lastProbes,
                getLogs(),
                { childPid: child.pid ?? null },
              );
            }
          }
          if (snapshotJson !== null) {
            if (labSnapshotReady({
              status: snapshot.status,
              body: snapshotJson,
            })) {
              return;
            }
            if (!labSnapshotRetryable({
              status: snapshot.status,
              body: snapshotJson,
            })) {
              lastError = new Error(
                `Playground lab snapshot readiness HTTP ${snapshot.status}; ${describeLastProbe(lastProbes.at(-1))}`,
              );
              await throwPlaygroundReadinessFailure(
                child,
                `Playground lab snapshot returned a terminal readiness failure at ${baseUrl}`,
                lastError,
                lastProbes,
                getLogs(),
                { childPid: child.pid ?? null },
              );
            }
          }
          notReadyProbeCount += 1;
          if (labNotReadyProbeLimitReached(notReadyProbeCount, maxNotReadyReadinessProbes)) {
            await throwPlaygroundReadinessFailure(
              child,
              `Playground server reported the bounded readiness failure ${response.status} after ${readinessProbeCount} /wp-json/ probes (${notReadyProbeCount} consecutive not-ready response${notReadyProbeCount === 1 ? '' : 's'}; limit ${maxNotReadyReadinessProbes})`,
              lastError,
              lastProbes,
              getLogs(),
              {
                childPid: child.pid ?? null,
                notReadyProbeCount,
                readinessProbeCount,
              },
            );
          }
          await sleepUnlessChildExit(readinessProbeIntervalMs, child);
          continue;
        }
        notReadyProbeCount = 0;
        snapshotNotReadyProbeCount = 0;
        if (!readinessRetryable) {
          const failureContext = lastSnapshotTimeoutContext !== null
            ? {
                childPid: child.pid ?? null,
                snapshotProbeTimedOut: true,
                ...lastSnapshotTimeoutContext,
                indexTerminal: true,
              }
            : {
                childPid: child.pid ?? null,
                indexTerminal: true,
              };
          const failureMessage = lastSnapshotTimeoutContext !== null
            ? `Playground /wp-json/ returned a terminal readiness failure HTTP ${response.status} after the snapshot probe timed out at ${baseUrl}`
            : `Playground /wp-json/ returned a terminal readiness failure HTTP ${response.status} at ${baseUrl}`;
          await throwPlaygroundReadinessFailure(
            child,
            failureMessage,
            lastError,
            lastProbes,
            getLogs(),
            failureContext,
          );
        }
        snapshotTimeoutProbeCount = 0;
        lastSnapshotTimeoutContext = null;
        if (response.status !== 200 && readinessProbeCount >= maxReadinessProbes) {
          await throwPlaygroundReadinessFailure(
            child,
            `Playground server stayed in readiness response ${response.status} after ${readinessProbeCount} /wp-json/ probes`,
            lastError,
            lastProbes,
            getLogs(),
            {
              childPid: child.pid ?? null,
              readinessProbeCount,
            },
          );
        }
      }
    } catch (error) {
      if (!labReadinessErrorRetryable(error)) {
        throw error;
      }
      lastError = error;
      snapshotNotReadyProbeCount = 0;
      if (lastSnapshotTimeoutContext !== null && labReadinessProbeTimedOut(error)) {
        await throwPlaygroundReadinessFailure(
          child,
          `Playground /wp-json/ probe timed out after the snapshot probe timed out at ${baseUrl}`,
          lastError,
          lastProbes,
          getLogs(),
          {
            childPid: child.pid ?? null,
            snapshotProbeTimedOut: true,
            ...lastSnapshotTimeoutContext,
            indexProbeTimedOut: true,
          },
        );
      }
      snapshotTimeoutProbeCount = 0;
      lastSnapshotTimeoutContext = null;
      timeoutProbeCount = labNextTimeoutProbeCount(timeoutProbeCount, error);
      if (labReadinessProbeTimedOut(error) && labNotReadyProbeLimitReached(timeoutProbeCount)) {
        await throwPlaygroundReadinessFailure(
          child,
          `Playground server hit ${timeoutProbeCount} consecutive readiness probe timeout${timeoutProbeCount === 1 ? '' : 's'}`,
          lastError,
          lastProbes,
          getLogs(),
          {
            childPid: child.pid ?? null,
            timeoutProbeCount,
          },
        );
      }
    }
    await sleepUnlessChildExit(readinessProbeIntervalMs, child);
  }
  if (lastProbes.length > 0 || lastError) {
    await throwPlaygroundReadinessFailure(
      child,
      `Timed out waiting for Playground server at ${baseUrl}`,
      lastError,
      lastProbes,
      getLogs(),
      {
        childPid: child.pid ?? null,
        notReadyProbeCount,
      },
    );
  }
  await throwPlaygroundReadinessFailure(
    child,
    `Timed out waiting for Playground server at ${baseUrl}`,
    lastError,
    lastProbes,
    getLogs(),
    {
      childPid: child.pid ?? null,
      notReadyProbeCount,
    },
  );
}

function describeLastProbe(probe) {
  if (!probe) {
    return 'route/status/body: unavailable';
  }
  return describeLastRouteStatusBody({
    route: probe.route ?? null,
    status: probe.status ?? null,
    body: probe.body ?? null,
  });
}

function describeLastRouteStatusBody(lastRouteStatusBody) {
  return `route/status/body: ${JSON.stringify(
    {
      route: lastRouteStatusBody?.route ?? null,
      status: lastRouteStatusBody?.status ?? null,
      body: lastRouteStatusBody?.body ?? null,
    },
    null,
    2,
  )}`;
}

function signedHeadersForProductionPreflight(auth = credentials) {
  const contentHash = createHash('sha256').update('', 'utf8').digest('hex');
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = `release-verify-packaged-${auth.username}-${Date.now()}`;
  const signingKey = hmacHex(auth.password, `reprint-push-lab-v1\n${auth.username}`);
  const authString = `${nonce}${timestamp}${contentHash}`;
  const canonical = [
    'REPRINT-PUSH-LAB-V1',
    'GET',
    '/wp-json/reprint/v1/push/preflight',
    '',
    contentHash,
    '',
    '',
  ].join('\n');
  return {
    authorization: `Basic ${Buffer.from(`${auth.username}:${auth.password}`, 'utf8').toString('base64')}`,
    connection: 'close',
    'X-Auth-Content-Hash': contentHash,
    'X-Auth-Timestamp': timestamp,
    'X-Auth-Nonce': nonce,
    'X-Auth-Signature': hmacHex(signingKey, authString),
    'X-Reprint-Push-Signature': hmacHex(signingKey, canonical),
  };
}

function authHeaders(auth = credentials) {
  return {
    authorization: `Basic ${Buffer.from(`${auth.username}:${auth.password}`, 'utf8').toString('base64')}`,
  };
}

function hmacHex(key, data) {
  return createHmac('sha256', key).update(data, 'utf8').digest('hex');
}

function writePlaygroundFailure(message, lastProbes, logs, lastError, lastTimeoutFallbackProbes = null) {
  const lastProbe = lastProbes.at(-1) ?? null;
  const lastRouteStatusBody = lastProbe
    ? {
        route: lastProbe.route ?? null,
        status: lastProbe.status ?? null,
        body: lastProbe.body ?? null,
      }
    : null;
  const summary = {
    message,
    lastProbe,
    lastProbeSummary: lastRouteStatusBody,
    lastRouteStatusBody,
    lastError: lastError?.message ?? null,
    lastTimeoutFallbackProbes,
  };
  const flatLastProbe = lastProbe
    ? `\nLast route/status/body: ${JSON.stringify(
        {
          route: lastProbe.route,
          status: lastProbe.status,
          body: lastProbe.body,
        },
        null,
        2,
      )}`
    : '';
  writeSync(2, `${message}\n`);
  writeSync(2, `${flatLastProbe}\n`);
  writeSync(2, `${JSON.stringify(summary)}\n`);
  writeSync(1, `${JSON.stringify(summary)}\n`);
  if (logs) {
    writeSync(2, `${logs}\n`);
  }
}

async function throwPlaygroundReadinessFailure(
  child,
  prefix,
  lastError,
  lastProbes,
  logs,
  context = {},
  lastTimeoutFallbackProbes = null,
) {
  const diagnostic = formatPlaygroundStartupFailure(
    prefix,
    lastError,
    lastProbes,
    logs,
    context,
    lastTimeoutFallbackProbes,
  );
  writePlaygroundFailure(diagnostic, lastProbes, logs, lastError, lastTimeoutFallbackProbes);
  await stopSpawnedServer(child);
  const finalError = new Error(diagnostic);
  finalError.isPlaygroundReadinessFailure = true;
  finalError.cause = lastError ?? null;
  finalError.lastProbe = lastProbes.at(-1) ?? null;
  finalError.lastRouteStatusBody = finalError.lastProbe
    ? {
        route: finalError.lastProbe.route ?? null,
        status: finalError.lastProbe.status ?? null,
        body: finalError.lastProbe.body ?? null,
    }
    : null;
  finalError.context = context;
  finalError.lastTimeoutFallbackProbes = lastTimeoutFallbackProbes;
  throw finalError;
}

function formatPlaygroundStartupFailure(
  prefix,
  lastError,
  lastProbes,
  logs,
  context = {},
  lastTimeoutFallbackProbes = null,
) {
  // Older packaged-readiness branches passed timeout fallback probes as the
  // fifth argument. Preserve those diagnostics instead of misreporting them as
  // generic context.
  if (
    lastTimeoutFallbackProbes === null
    && context
    && typeof context === 'object'
    && ('preflightProbe' in context || 'indexProbe' in context)
  ) {
    lastTimeoutFallbackProbes = context;
    context = null;
  }
  const probeText = lastProbes.length
    ? `\nProbe trail: ${JSON.stringify(lastProbes.slice(-4), null, 2)}`
    : '';
  const lastProbe = lastProbes.at(-1);
  const lastProbeText = lastProbe
    ? `\nLast probe: ${JSON.stringify(
        {
          route: lastProbe.route,
          status: lastProbe.status,
          ok: lastProbe.ok,
          body: lastProbe.body,
        },
        null,
        2,
      )}`
    : '';
  const errorText = lastError?.message || 'unknown';
  const routeStatusBodyText = lastProbe
    ? `\nLast route/status/body: ${JSON.stringify(
        {
          route: lastProbe.route ?? null,
          status: lastProbe.status ?? null,
          body: lastProbe.body ?? null,
        },
        null,
        2,
      )}`
    : '';
  const contextText = Object.keys(context).length
    ? `\nContext: ${JSON.stringify(context, null, 2)}`
    : '';
  const timeoutFallbackText = lastTimeoutFallbackProbes?.preflightProbe || lastTimeoutFallbackProbes?.indexProbe
    ? `\nTimeout fallback probes: ${JSON.stringify(lastTimeoutFallbackProbes, null, 2)}`
    : '';
  return `${prefix}: ${errorText}${probeText}${lastProbeText}${routeStatusBodyText}${timeoutFallbackText}${contextText}\n${logs}`;
}

async function fetchWithTimeout(url, init = {}, timeoutMs = serverFetchTimeoutMs, child = null) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Timed out fetching ${url}`)), timeoutMs);
  const childExitWatcher = createChildExitWatcher(child, url, controller);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    childExitWatcher?.cleanup();
  }
}

function createChildExitWatcher(child, url, controller) {
  const childExitError = buildChildExitFetchError(child, url);
  if (!child) {
    return null;
  }

  const failForExit = () => {
    controller.abort(childExitError());
  };

  if (child.exitCode !== null || child.signalCode !== null) {
    failForExit();
    return { cleanup() {} };
  }

  const onExit = () => failForExit();
  const cleanup = () => {
    child.off('exit', onExit);
    child.off('close', onExit);
  };
  child.once('exit', onExit);
  child.once('close', onExit);
  return { cleanup };
}

function createChildExitPromise(child, url) {
  if (!child) {
    return null;
  }

  const childExitError = buildChildExitFetchError(child, url);
  if (child.exitCode !== null || child.signalCode !== null) {
    return {
      promise: Promise.reject(childExitError()),
      cleanup() {},
    };
  }

  let cleanup = () => {};
  const promise = new Promise((_, reject) => {
    const onExit = () => {
      cleanup();
      reject(childExitError());
    };
    cleanup = () => {
      child.off('exit', onExit);
      child.off('close', onExit);
    };
    child.once('exit', onExit);
    child.once('close', onExit);
  });
  return { promise, cleanup };
}

function buildChildExitFetchError(child, url) {
  return () => {
    const exitLabel = child.exitCode !== null
      ? `exited with ${child.exitCode}`
      : child.signalCode !== null
        ? `terminated by ${child.signalCode}`
        : 'terminated unexpectedly';
    const error = new Error(`Playground child ${exitLabel} while fetching ${url}`);
    error.isPlaygroundReadinessFailure = true;
    return error;
  };
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Playground server did not exit within ${timeoutMs}ms`));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      child.off('exit', onExit);
      child.off('close', onExit);
    };

    const onExit = () => {
      cleanup();
      resolve();
    };

    child.once('exit', onExit);
    child.once('close', onExit);
  });
}

async function findLocalPort() {
  for (;;) {
    const port = 30000 + Math.floor(Math.random() * 20000);
    if (await isPortFree(port)) {
      return port;
    }
  }
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const socket = net.createServer();
    socket.once('error', () => resolve(false));
    socket.once('listening', () => socket.close(() => resolve(true)));
    socket.listen(port, '127.0.0.1');
  });
}

} catch (error) {
  topLevelError = error;
} finally {
  await stopAllPlaygroundChildren();
  if (topLevelError && !(topLevelError instanceof ProofFailure)) {
    throw topLevelError;
  }
  if (topLevelError instanceof ProofFailure) {
    process.exitCode = 1;
  }
}
