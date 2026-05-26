#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticatedHttpClient } from '../../src/authenticated-http-push-client.js';
import {
  labMaxConsecutiveNotReadyProbes,
  labNotReadyProbeLimitReached,
  labReadinessBodyRetryable,
  labReadinessErrorRetryable,
  labNextTimeoutProbeCount,
  labReadinessProbeTimedOut,
  labSnapshotReady,
  labSnapshotRetryable,
} from './lab-playground-readiness.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const muPluginDir = path.join(repoRoot, 'scripts/playground/rest-mu-plugins');
const serverStartupTimeoutMs = 120_000;
const serverFetchTimeoutMs = 3_000;
const readinessProbeIntervalMs = 500;
const readinessFailureBodyLimit = 500;
const maxConsecutiveTimeoutProbes = 4;
const maxReadinessProbes = Math.max(10, Math.ceil(serverStartupTimeoutMs / readinessProbeIntervalMs));
const maxNotReadyReadinessProbes = Math.max(labMaxConsecutiveNotReadyProbes, maxReadinessProbes);
const credentials = {
  username: 'reprint_push_admin',
  password: 'reprint-push-admin-app-password',
};

const topology = {
  remoteBase: 'remote-base',
  localEdited: 'local-edited',
  remoteChanged: 'remote-changed',
  runner: 'runner',
  ingressPort: 8080,
  proxyPolicy: 'local-only',
  tunnels: 'disallowed',
};

await withPlaygroundServer('remote-base', path.join(repoRoot, 'fixtures/playground/remote-base.blueprint.json'), async (remoteServer) => {
  await withPlaygroundServer('local-edited', path.join(repoRoot, 'fixtures/playground/local-edited.blueprint.json'), async (localServer) => {
    const client = authenticatedHttpClient({
      sourceUrl: remoteServer.baseUrl,
      credential: credentials,
      routeProfile: 'production-shaped',
    });

    const preflight = await client.signedGet('/preflight');
    assert.equal(preflight.status, 200, `production-shaped live preflight HTTP ${preflight.status}`);
    assert.equal(preflight.body.ok, true);
    assert.equal(preflight.body.routeProfile.profile, 'production-shaped');
    assert.equal(preflight.body.routeProfile.restNamespace, 'reprint/v1');
    assert.equal(preflight.body.routeProfile.routePrefix, '/push');
    assert.match(preflight.body.session.id, /^[A-Za-z0-9_-]{32,160}$/);
    assertProductionAuthSessionLifecycle(preflight.body.auth?.session);

    const localIndex = await fetch(`${localServer.baseUrl}/wp-json/`);
    assert.equal(localIndex.status, 200);

    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          topology,
          source: {
            url: remoteServer.baseUrl,
            routeProfile: preflight.body.routeProfile,
            session: {
              id: preflight.body.session.id,
              type: preflight.body.session.type,
              status: preflight.body.auth?.session?.status || null,
              expiresAt: preflight.body.auth?.session?.expiresAt || null,
              expired: isExpiredSession(preflight.body.auth?.session),
            },
          },
          local: {
            url: localServer.baseUrl,
            indexStatus: localIndex.status,
          },
        },
        null,
        2,
      ),
    );
    process.stdout.write('\n');
  });
});

async function withPlaygroundServer(name, blueprintPath, run) {
  const server = await startPlaygroundServer(name, blueprintPath);
  try {
    await run(server);
  } finally {
    await stopPlaygroundServer(server);
  }
}

function assertProductionAuthSessionLifecycle(session) {
  assert.ok(session, 'production-shaped live preflight missing auth session');
  assert.equal(session.type, 'production-auth-session', 'production-shaped live preflight session type');
  assert.equal(session.status, 'active', 'production-shaped live preflight session status');
  assert.equal(isExpiredSession(session), false, 'production-shaped live preflight session must be unexpired');
}

function isExpiredSession(session) {
  if (!session || typeof session !== 'object') {
    return false;
  }

  const expiresAt = session.expiresAt;
  if (!expiresAt) {
    return false;
  }

  const expiresAtMs = Date.parse(expiresAt);
  return !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now();
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
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });

  await waitForServer(child, baseUrl, () => output);

  return {
    name,
    baseUrl,
    port,
    child,
  };
}

async function stopPlaygroundServer(server) {
  if (server.child.exitCode !== null) {
    return;
  }
  server.child.kill('SIGTERM');
  await waitForExit(server.child, 12_000);
}

async function waitForServer(child, baseUrl, getLogs) {
  const deadline = Date.now() + serverStartupTimeoutMs;
  let lastError = null;
  let notReadyProbeCount = 0;
  let readinessProbeCount = 0;
  let timeoutProbeCount = 0;
  const lastProbes = [];
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      const exitLabel = child.exitCode !== null
        ? `exited early with ${child.exitCode}`
        : `terminated by ${child.signalCode}`;
      throw new Error(`Playground server ${exitLabel}\n${getLogs()}`);
    }
    try {
      const { response, bodyText: responseBody } = await fetchTextWithTimeout(`${baseUrl}/wp-json/`, {
        headers: { connection: 'close' },
      }, serverFetchTimeoutMs, child);
      readinessProbeCount += 1;
      timeoutProbeCount = 0;
      const responsePreview = responseBody.slice(0, readinessFailureBodyLimit);
      lastProbes.push({
        route: '/wp-json/',
        status: response.status,
        ok: response.ok,
        body: responsePreview,
      });
      const readinessRetryable = labReadinessBodyRetryable(response.status, responseBody);
      if (response.status === 200 && !readinessRetryable) {
        notReadyProbeCount = 0;
        const { response: snapshot, bodyText: snapshotBody } = await fetchTextWithTimeout(`${baseUrl}/wp-json/reprint-push-lab/v1/snapshot`, {
          headers: {
            Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`,
            connection: 'close',
          },
        }, serverFetchTimeoutMs, child);
        timeoutProbeCount = 0;
        const snapshotPreview = snapshotBody.slice(0, readinessFailureBodyLimit);
        lastProbes.push({
          route: '/wp-json/reprint-push-lab/v1/snapshot',
          status: snapshot.status,
          ok: snapshot.ok,
          body: snapshotPreview,
        });
        let snapshotJson = null;
        try {
          snapshotJson = JSON.parse(snapshotBody);
        } catch (error) {
          if (labReadinessBodyRetryable(snapshot.status, snapshotBody)) {
            lastError = new Error(
              `Snapshot readiness HTTP ${snapshot.status}; ${describeLastProbe(lastProbes.at(-1))}`,
            );
            await sleepUnlessChildExit(readinessProbeIntervalMs, child);
            continue;
          }
          lastError = error;
          await throwPlaygroundReadinessFailure(
            child,
            `Playground lab snapshot returned an invalid readiness body at ${baseUrl}`,
            lastError,
            lastProbes,
            getLogs(),
          );
        }
        if (labSnapshotReady({
          status: snapshot.status,
          body: snapshotJson,
        })) {
          return;
        }
        lastError = new Error(
          `Snapshot readiness HTTP ${snapshot.status}; ${describeLastProbe(lastProbes.at(-1))}`,
        );
        if (labSnapshotRetryable({
          status: snapshot.status,
          body: snapshotJson,
        })) {
          await sleepUnlessChildExit(readinessProbeIntervalMs, child);
          continue;
        }
        await throwPlaygroundReadinessFailure(
          child,
          `Playground lab snapshot returned a terminal readiness failure at ${baseUrl}`,
          lastError,
          lastProbes,
          getLogs(),
        );
      }
      lastError = new Error(
        `HTTP ${response.status}: ${responsePreview}; ${describeLastProbe(lastProbes.at(-1))}`,
      );
      if (readinessRetryable) {
        const { response: snapshot, bodyText: snapshotBody } = await fetchTextWithTimeout(`${baseUrl}/wp-json/reprint-push-lab/v1/snapshot`, {
          headers: {
            Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`,
            connection: 'close',
          },
        }, serverFetchTimeoutMs, child);
        timeoutProbeCount = 0;
        const snapshotPreview = snapshotBody.slice(0, readinessFailureBodyLimit);
        lastProbes.push({
          route: '/wp-json/reprint-push-lab/v1/snapshot',
          status: snapshot.status,
          ok: snapshot.ok,
          body: snapshotPreview,
        });
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
              `Snapshot readiness HTTP ${snapshot.status}; ${describeLastProbe(lastProbes.at(-1))}`,
            );
            await throwPlaygroundReadinessFailure(
              child,
              `Playground lab snapshot returned a terminal readiness failure at ${baseUrl}`,
              lastError,
              lastProbes,
              getLogs(),
            );
          }
        }
        notReadyProbeCount += 1;
        if (labNotReadyProbeLimitReached(notReadyProbeCount, maxNotReadyReadinessProbes)) {
          await throwPlaygroundReadinessFailure(
            child,
            `Playground server reported the bounded readiness failure ${response.status} after ${readinessProbeCount} /wp-json/ probes `
              + `(${notReadyProbeCount} consecutive not-ready response${notReadyProbeCount === 1 ? '' : 's'}; `
              + `limit ${maxNotReadyReadinessProbes}) at ${baseUrl}`,
            lastError,
            lastProbes,
            getLogs(),
          );
        }
      } else {
        notReadyProbeCount = 0;
        if (response.status !== 200 && readinessProbeCount >= maxReadinessProbes) {
          await throwPlaygroundReadinessFailure(
            child,
            `Playground server stayed in readiness response ${response.status} after ${readinessProbeCount} /wp-json/ probes at ${baseUrl}`,
            lastError,
            lastProbes,
            getLogs(),
          );
        }
      }
    } catch (error) {
      if (!labReadinessErrorRetryable(error)) {
        throw error;
      }
      lastError = error;
      timeoutProbeCount = labNextTimeoutProbeCount(timeoutProbeCount, error);
      if (labReadinessProbeTimedOut(error) && timeoutProbeCount >= maxConsecutiveTimeoutProbes) {
        await throwPlaygroundReadinessFailure(
          child,
          `Playground server hit ${timeoutProbeCount} consecutive readiness probe timeout${timeoutProbeCount === 1 ? '' : 's'} at ${baseUrl}`,
          lastError,
          lastProbes,
          getLogs(),
        );
      }
    }
    await sleepUnlessChildExit(readinessProbeIntervalMs, child);
  }
  await throwPlaygroundReadinessFailure(
    child,
    `Timed out waiting for Playground server at ${baseUrl}`,
    lastError,
    lastProbes,
    getLogs(),
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

function writePlaygroundFailure(message, lastProbes, logs, lastError) {
  const lastProbe = lastProbes.at(-1) ?? null;
  const summary = {
    message,
    lastProbe,
    lastRouteStatusBody: lastProbe
      ? {
          route: lastProbe.route ?? null,
          status: lastProbe.status ?? null,
          body: lastProbe.body ?? null,
        }
      : null,
    lastError: lastError?.message ?? null,
  };
  writeSync(2, `${message}\n`);
  writeSync(2, `${JSON.stringify(summary)}\n`);
  writeSync(1, `${JSON.stringify(summary)}\n`);
  if (logs) {
    writeSync(2, `${logs}\n`);
  }
}

async function throwPlaygroundReadinessFailure(child, prefix, lastError, lastProbes, logs) {
  const diagnostic = formatPlaygroundStartupFailure(prefix, lastError, lastProbes, logs);
  writePlaygroundFailure(diagnostic, lastProbes, logs, lastError);
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
  throw finalError;
}

function formatPlaygroundStartupFailure(prefix, lastError, lastProbes, logs) {
  const lastProbe = lastProbes.at(-1);
  const probeText = lastProbes.length
    ? `\nProbe trail: ${JSON.stringify(lastProbes.slice(-4), null, 2)}`
    : '';
  const lastProbeText = lastProbe
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
  return `${prefix}: ${lastError?.message ?? 'unknown'}${probeText}${lastProbeText}\n${logs}`;
}

async function stopSpawnedServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill('SIGTERM');
  await waitForExit(child, 12_000);
}

async function fetchTextWithTimeout(url, options = {}, timeoutMs = serverFetchTimeoutMs, child = null) {
  const response = await fetchWithTimeout(url, options, timeoutMs, child);
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

async function fetchWithTimeout(url, options = {}, timeoutMs = serverFetchTimeoutMs, child = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Timed out fetching ${url}`)), timeoutMs);
  const childExitWatcher = createChildExitWatcher(child, url, controller);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
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

async function sleepUnlessChildExit(ms, child) {
  if (!child) {
    await sleep(ms);
    return;
  }

  if (child.exitCode !== null || child.signalCode !== null) {
    throw buildChildExitFetchError(child, 'sleep')();
  }

  await new Promise((resolve, reject) => {
    const onExit = () => {
      cleanup();
      reject(buildChildExitFetchError(child, 'sleep')());
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const cleanup = () => {
      clearTimeout(timer);
      child.off('exit', onExit);
      child.off('close', onExit);
    };
    child.once('exit', onExit);
    child.once('close', onExit);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForExit(child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill('SIGKILL');
  while (child.exitCode === null) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
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
