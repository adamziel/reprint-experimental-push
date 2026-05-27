#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticatedHttpClient } from '../../src/authenticated-http-push-client.js';
import { createPushPlan } from '../../src/planner.js';
import { checkedDurableJournalBoundarySatisfied } from '../../src/recovery-journal.js';
import {
  loadAuthSessionSource,
  resolveAuthSessionRequestState,
} from './auth-session-source.js';
import {
  evaluateProductionAuthSessionLifecycleSummary,
  summarizeProductionAuthSessionLifecycleTrace,
} from './production-auth-session-lifecycle.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const muPluginDir = path.join(repoRoot, 'scripts/playground/rest-mu-plugins');
// Match the checked release verifier's bounded readiness window so the inline
// apply-revalidation proof does not fail earlier than the wrapper it now runs
// inside.
const serverStartupTimeoutMs = 30_000;
const serverFetchTimeoutMs = 1_000;
const requestTimeoutMs = 2_000;
const readinessProbeIntervalMs = 500;
const maxNotReadyReadinessProbes = Math.max(4, Math.ceil(serverStartupTimeoutMs / readinessProbeIntervalMs));
const credentials = {
  username: process.env.REPRINT_PUSH_USERNAME || process.env.REPRINT_PUSH_LAB_AUTH_ADMIN_USER || 'reprint_push_admin',
  password:
    process.env.REPRINT_PUSH_APPLICATION_PASSWORD
    || process.env.REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD
    || 'reprint-push-admin-app-password',
};
const requireProductionAuthSession = process.env.REPRINT_PUSH_REQUIRE_PRODUCTION_AUTH_SESSION === '1';
const externalRemoteBaseUrl = process.env.REPRINT_PUSH_SOURCE_URL || process.env.REPRINT_PUSH_REMOTE_URL || '';
const externalLocalEditedUrl = process.env.REPRINT_PUSH_LOCAL_URL || '';
const authSessionSourceCommand = process.env.REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND || '';
const authSessionSource = authSessionSourceCommand
  ? loadAuthSessionSource(authSessionSourceCommand)
  : null;
const resolvedAuthSessionRequest = resolveAuthSessionRequestState({
  liveSourceUrl: externalRemoteBaseUrl,
  username: credentials.username,
  applicationPassword: credentials.password,
}, authSessionSource, {
  preferSource: requireProductionAuthSession,
});
const resolvedCredentials = {
  username: resolvedAuthSessionRequest.username,
  password: resolvedAuthSessionRequest.applicationPassword,
};
const resolvedExternalRemoteBaseUrl = resolvedAuthSessionRequest.liveSourceUrl || externalRemoteBaseUrl;

const remoteBlueprint = path.join(repoRoot, 'fixtures/playground/remote-base.blueprint.json');
const localBlueprint = path.join(repoRoot, 'fixtures/playground/local-edited.blueprint.json');
const driftMutation = {
  mutationId: 'reprint-push-apply-revalidation-drift',
  resourceKey: 'file:wp-content/uploads/reprint-push/shared.txt',
  value: {
    type: 'file',
    content: 'production-shaped apply revalidation drift',
  },
};

const activePlaygroundChildren = new Set();
process.on('beforeExit', stopAllPlaygroundChildrenSync);
process.on('exit', stopAllPlaygroundChildrenSync);
process.on('SIGINT', () => {
  stopAllPlaygroundChildrenSync();
});
process.on('SIGTERM', () => {
  stopAllPlaygroundChildrenSync();
});
process.on('uncaughtException', (error) => {
  handleFatalProcessError(error, 'uncaught exception');
});
process.on('unhandledRejection', (reason) => {
  handleFatalProcessError(reason, 'unhandled rejection');
});

try {
  if (requireProductionAuthSession && authSessionSourceCommand && !authSessionSource?.ok) {
    emitInvalidAuthSessionSourceProof();
    process.exitCode = 1;
  } else if (resolvedExternalRemoteBaseUrl && externalLocalEditedUrl) {
    await runApplyRevalidationProof({
      remoteServer: { name: 'remote-base', baseUrl: resolvedExternalRemoteBaseUrl },
      localServer: { name: 'local-edited', baseUrl: externalLocalEditedUrl },
      externalTopology: true,
    });
  } else {
    await withPlaygroundServer('remote-base', remoteBlueprint, async (remoteServer) => {
      await withPlaygroundServer('local-edited', localBlueprint, async (localServer) => {
        await runApplyRevalidationProof({ remoteServer, localServer, externalTopology: false });
      });
    });
  }
} catch (error) {
  stopAllPlaygroundChildrenSync();
  throw error;
}

async function runApplyRevalidationProof({ remoteServer, localServer, externalTopology }) {
  const client = authenticatedHttpClient({
    sourceUrl: remoteServer.baseUrl,
    credential: resolvedCredentials,
    routeProfile: 'production-shaped',
    requestTimeoutMs,
  });
  const authSessionLifecycleTrace = [];

  const preflight = await client.signedGet('/preflight');
  assert.equal(preflight.status, 200, `production-shaped apply revalidation preflight HTTP ${preflight.status}`);
  assert.equal(preflight.body.ok, true);
  assert.equal(preflight.body.routeProfile.profile, 'production-shaped');
  assert.match(preflight.body.session.id, /^[A-Za-z0-9_-]{32,160}$/);
  recordAuthSessionLifecycle(authSessionLifecycleTrace, 'preflight', preflight.body?.auth);

  const base = await exportSnapshot('remote-base', remoteServer.baseUrl);
  const local = withoutUnmappedGraphPostmeta(await exportSnapshot('local-edited', localServer.baseUrl));
  const plan = createPushPlan({ base, local, remote: base });
  assert.equal(plan.status, 'ready');
  assert.ok(plan.mutations.length > 0, 'apply revalidation proof needs at least one mutation');

  const driftTarget = plan.mutations.find((mutation) => mutation.resourceKey === driftMutation.resourceKey)
    || plan.mutations.find((mutation) => mutation.resourceKey.startsWith('file:'))
    || plan.mutations[0];
  assert.ok(driftTarget, 'apply revalidation proof needs a prepared mutation target');
  const session = preflight.body.session.id;
  const idempotencyKey = 'production-shaped-apply-revalidation-smoke-001';

  process.stderr.write('apply-revalidation: dry-run /dry-run\n');
  const dryRun = await client.signedPost('/dry-run', { plan }, { session, idempotencyKey });
  assert.equal(dryRun.status, 200);
  assert.equal(dryRun.body.ok, true);
  assert.equal(dryRun.body.mode, 'dry-run');
  assert.ok(dryRun.body.receipt?.receiptHash, 'dry-run receipt hash missing');
  recordAuthSessionLifecycle(authSessionLifecycleTrace, 'dry-run', dryRun.body?.auth);

  process.stderr.write('apply-revalidation: apply /apply\n');
  const apply = await client.signedPost('/apply', {
    plan,
    receipt: dryRun.body.receipt,
    labDriftAfterPrepared: {
      mutationId: driftTarget.id,
      resourceKey: driftTarget.resourceKey,
      value: {
        type: 'file',
        content: 'production-shaped apply revalidation drift',
      },
    },
  }, { session, idempotencyKey });
  assert.equal(apply.status, 412);
  assert.equal(apply.body.ok, false);
  assert.equal(apply.body.code, 'PRECONDITION_FAILED');
  assert.equal(apply.body.preconditionCheck, 'just-in-time');
  assert.equal(apply.body.recovery?.required, true);
  assert.equal(apply.body.recovery?.state, 'blocked-recovery');
  recordAuthSessionLifecycle(authSessionLifecycleTrace, 'apply', apply.body?.auth);

  process.stderr.write('apply-revalidation: recovery inspect /recovery/inspect\n');
  const recoveryInspect = await client.signedPost('/recovery/inspect', {
    plan,
    receipt: dryRun.body.receipt,
  }, { session, idempotencyKey });
  assert.equal(recoveryInspect.status, 200);
  assert.equal(recoveryInspect.body.ok, true);
  assert.ok(recoveryInspect.body.recovery?.counts?.blockedUnknown >= 1);
  recordAuthSessionLifecycle(authSessionLifecycleTrace, 'recovery-inspect', recoveryInspect.body?.auth);

  const authSessionLifecycleSummary = summarizeProductionAuthSessionLifecycleTrace(authSessionLifecycleTrace);
  const authSessionLifecycle = evaluateProductionAuthSessionLifecycleSummary(authSessionLifecycleSummary);
  const recoveryJournal = recoveryInspect.body?.recovery?.journal || null;
  const checkedDurableJournalAccepted = checkedDurableJournalBoundarySatisfied(recoveryJournal);
  const boundary = buildApplyRevalidationBoundary({
    authSessionLifecycle,
    checkedDurableJournalAccepted,
  });

  process.stdout.write(JSON.stringify({
    ok: true,
    topology: {
      sourceUrl: remoteServer.baseUrl,
      remoteBase: 'remote-base',
      localEdited: 'local-edited',
      externalTopology,
      proxyPolicy: 'local-only',
      ingressPort: 8080,
    },
    authSessionSource: summarizeAuthSessionSource(authSessionSourceCommand, authSessionSource, remoteServer.baseUrl),
    preflight: {
      status: preflight.status,
      routeProfile: preflight.body.routeProfile,
      session: {
        id: preflight.body.session.id,
        type: preflight.body.session.type,
      },
    },
    dryRun: {
      status: dryRun.status,
      mode: dryRun.body.mode,
      receiptHash: dryRun.body.receipt.receiptHash,
    },
    apply: {
      status: apply.status,
      code: apply.body.code,
      preconditionCheck: apply.body.preconditionCheck,
      recovery: apply.body.recovery,
    },
    recoveryInspect: {
      status: recoveryInspect.status,
      recovery: recoveryInspect.body.recovery,
    },
    authSessionLifecycle: {
      summary: authSessionLifecycleSummary,
      trace: authSessionLifecycleTrace,
      evaluation: authSessionLifecycle,
    },
    durableJournal: {
      journal: recoveryJournal,
      checkedAccepted: checkedDurableJournalAccepted,
    },
    boundary,
  }, null, 2));
  process.stdout.write('\n');
}

function summarizeAuthSessionSource(command, source, fallbackSourceUrl = '') {
  if (!command) {
    return null;
  }

  return {
    command,
    ok: Boolean(source?.ok),
    sourceUrl: source?.sourceUrl || fallbackSourceUrl || '',
    username: source?.username || resolvedCredentials.username || '',
    applicationPasswordPresent: Boolean(source?.applicationPassword || resolvedCredentials.password),
    error: source?.error || '',
  };
}

function emitInvalidAuthSessionSourceProof() {
  process.stdout.write(JSON.stringify({
    ok: false,
    topology: {
      sourceUrl: resolvedExternalRemoteBaseUrl || externalRemoteBaseUrl || '',
      remoteBase: 'remote-base',
      localEdited: externalLocalEditedUrl ? 'local-edited' : null,
      externalTopology: Boolean(externalLocalEditedUrl),
      proxyPolicy: 'local-only',
      ingressPort: 8080,
    },
    authSessionSource: summarizeAuthSessionSource(authSessionSourceCommand, authSessionSource),
    boundary: {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      liveAuthSessionSource: {
        requiredCommand: 'REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND',
        observed: 'invalid-production-auth-session-source',
        error: authSessionSource?.error || 'invalid auth session source',
      },
      durableJournal: {
        verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
      },
    },
  }, null, 2));
  process.stdout.write('\n');
}

function buildApplyRevalidationBoundary({ authSessionLifecycle, checkedDurableJournalAccepted }) {
  if (!authSessionLifecycle?.ok) {
    return {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: {
        required: authSessionLifecycle?.required || 'production-auth-session lifecycle',
        observed: authSessionLifecycle?.observed || 'missing',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      },
      durableJournal: {
        verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
      },
    };
  }

  if (!checkedDurableJournalAccepted) {
    return {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
      authSession: {
        required: authSessionLifecycle.required,
        observed: authSessionLifecycle.observed,
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_PROVEN',
      },
      durableJournal: {
        verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
      },
    };
  }

  return {
    firstRemainingProductionBoundary: 'replay and preserved-remote retry on the checked release path',
    verdict: 'PRESERVED_REMOTE_RETRY_REQUIRED',
    authSession: {
      required: authSessionLifecycle.required,
      observed: authSessionLifecycle.observed,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_PROVEN',
    },
    durableJournal: {
      verdict: 'LIVE_RELEASE_BOUNDARY_OK',
    },
    replayAndRetry: {
      required: '/snapshot',
      observed: 'missing-transient-retry',
      verdict: 'PRESERVED_REMOTE_RETRY_REQUIRED',
    },
  };
}

function recordAuthSessionLifecycle(trace, step, auth) {
  const session = auth?.session;
  if (!session || typeof session !== 'object') {
    return;
  }

  const previous = trace.at(-1) || null;
  trace.push({
    step,
    id: session.id ?? null,
    type: session.type ?? null,
    status: session.status ?? null,
    expiresAt: session.expiresAt ?? null,
    authUser: auth?.identity?.userLogin ?? null,
    expired: session.expired === true || session.status === 'expired',
    revoked: session.revoked === true || session.status === 'revoked',
    cleanedUp: session.cleanedUp === true || session.cleanup === true || session.status === 'cleaned-up',
    rotated: Boolean(previous?.id && session.id && previous.id !== session.id),
    preserved: Boolean(previous?.id && session.id && previous.id === session.id),
  });
}

async function exportSnapshot(name, baseUrl) {
  const response = await fetch(`${baseUrl}/wp-json/reprint-push-lab/v1/snapshot`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${resolvedCredentials.username}:${resolvedCredentials.password}`).toString('base64')}`,
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

async function withPlaygroundServer(name, blueprintPath, run) {
  const server = await startPlaygroundServer(name, blueprintPath);
  try {
    await run(server);
  } finally {
    await stopPlaygroundServer(server);
  }
}

async function startPlaygroundServer(name, blueprintPath) {
  const port = await findLocalPort();
  const baseUrl = `http://127.0.0.1:${port}`;
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

  const child = spawn('npx', args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      REPRINT_PUSH_LAB_AUTH_BOOTSTRAP: '1',
      REPRINT_PUSH_LAB_AUTH_ADMIN_USER: resolvedCredentials.username,
      REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: resolvedCredentials.password,
      NODE_OPTIONS: appendNodeOption(process.env.NODE_OPTIONS, localhostListenPreloadOption()),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
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
  } catch (error) {
    process.stderr.write(`${output}\n`);
    try {
      await stopPlaygroundChild(child);
    } catch (cleanupError) {
      process.stderr.write(
        `apply-revalidation: cleanup after readiness failure ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}\n`,
      );
    }
    throw error;
  }
  return { name, baseUrl, port, child };
}

async function stopPlaygroundServer(server) {
  await stopPlaygroundChild(server.child);
  activePlaygroundChildren.delete(server.child);
}

async function stopPlaygroundChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill('SIGTERM');
  try {
    await waitForExit(child, 2_000);
    return;
  } catch (error) {
    child.kill('SIGKILL');
    try {
      await waitForExit(child, 2_000);
    } catch {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(String(error));
    }
  }
}

function stopAllPlaygroundChildrenSync() {
  for (const child of activePlaygroundChildren) {
    if (child.exitCode !== null || child.signalCode !== null) {
      activePlaygroundChildren.delete(child);
      continue;
    }
    try {
      child.kill('SIGTERM');
    } catch {}
    try {
      child.kill('SIGKILL');
    } catch {}
    activePlaygroundChildren.delete(child);
  }
}

function handleFatalProcessError(error, label) {
  stopAllPlaygroundChildrenSync();
  process.exitCode = 1;
  if (error instanceof Error) {
    process.stderr.write(`apply-revalidation: ${label}: ${error.stack || error.message}\n`);
    return;
  }
  process.stderr.write(`apply-revalidation: ${label}: ${String(error)}\n`);
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

async function waitForServer(child, baseUrl, getLogs) {
  const deadline = Date.now() + serverStartupTimeoutMs;
  let lastError = null;
  const lastProbes = [];
  let consecutiveIndex502s = 0;
  let nextHeartbeat = Date.now();
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Playground server exited early with ${child.exitCode}${formatProbeTrail(lastProbes)}\n${getLogs()}`);
    }
    if (Date.now() >= nextHeartbeat) {
      process.stderr.write(`apply-revalidation: waiting for Playground at ${baseUrl}\n`);
      nextHeartbeat = Date.now() + 2_000;
    }
    try {
      process.stderr.write('apply-revalidation: probe /wp-json/\n');
      const response = await fetchWithTimeout(`${baseUrl}/wp-json/`, {
        headers: { connection: 'close' },
      });
      const responseBody = await response.clone().text().catch(() => '');
      lastProbes.push({
        route: '/wp-json/',
        status: response.status,
        ok: response.ok,
        body: responseBody.slice(0, 500),
      });
      if (response.status === 200) {
        consecutiveIndex502s = 0;
        await response.arrayBuffer();
        const snapshot = await fetchWithTimeout(`${baseUrl}/wp-json/reprint-push-lab/v1/snapshot`, {
          headers: {
            Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`,
            connection: 'close',
          },
        });
        const snapshotBody = await snapshot.clone().text().catch(() => '');
        lastProbes.push({
        route: '/wp-json/reprint-push-lab/v1/snapshot',
        status: snapshot.status,
        ok: snapshot.ok,
        body: snapshotBody.slice(0, 500),
      });
      process.stderr.write(`apply-revalidation: snapshot probe HTTP ${snapshot.status}\n`);
      if (snapshot.status === 200) {
        await snapshot.arrayBuffer();
        return;
      }
      lastError = new Error(`Playground lab snapshot readiness HTTP ${snapshot.status}`);
      } else {
        lastError = new Error(`Playground index readiness HTTP ${response.status}`);
        if (response.status === 502) {
          consecutiveIndex502s += 1;
        } else {
          consecutiveIndex502s = 0;
        }
      }
      if (consecutiveIndex502s >= maxNotReadyReadinessProbes) {
        break;
      }
    } catch (error) {
      lastError = error;
      process.stderr.write(`apply-revalidation: readiness probe error ${error.message}\n`);
      consecutiveIndex502s = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, readinessProbeIntervalMs));
  }
  throw new Error(`Timed out waiting for Playground server at ${baseUrl}: ${lastError?.message || 'unknown'}${formatProbeTrail(lastProbes)}\n${getLogs()}`);
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Timed out fetching ${url}`)), serverFetchTimeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeoutHandle);
      child.off('exit', onExit);
      child.off('close', onExit);
    };

    const onExit = () => {
      cleanup();
      resolve();
    };

    const timeoutHandle = setTimeout(() => {
      cleanup();
      reject(new Error(`Child did not exit within ${timeoutMs}ms${child.pid ? ` (pid ${child.pid})` : ''}`));
    }, timeoutMs);

    child.once('exit', onExit);
    child.once('close', onExit);
  });
}

function formatProbeTrail(lastProbes) {
  if (lastProbes.length === 0) {
    return '';
  }
  return `\nLast probe trail: ${JSON.stringify(lastProbes.slice(-4), null, 2)}`;
}

async function findLocalPort() {
  for (;;) {
    const port = 30000 + Math.floor(Math.random() * 20000);
    if (await isPortFree(port)) {
      return port;
    }
  }
}

async function isPortFree(port) {
  return new Promise((resolve) => {
    const socket = net.createServer();
    socket.unref();
    socket.on('error', () => resolve(false));
    socket.listen(port, '127.0.0.1', () => {
      socket.close(() => resolve(true));
    });
  });
}
