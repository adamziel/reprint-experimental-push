#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticatedHttpClient } from '../../src/authenticated-http-push-client.js';
import {
  labReadinessBodyRetryable,
  labSnapshotReady,
  labSnapshotRetryable,
} from './lab-playground-readiness.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const muPluginDir = path.join(repoRoot, 'scripts/playground/rest-mu-plugins');
const serverStartupTimeoutMs = 120_000;
const serverFetchTimeoutMs = 3_000;
const readinessProbeIntervalMs = 500;
const readinessFailureBodyLimit = 500;
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
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Playground server exited early with ${child.exitCode}\n${getLogs()}`);
    }
    try {
      const response = await fetchWithTimeout(`${baseUrl}/wp-json/`, {
        headers: { connection: 'close' },
      }, serverFetchTimeoutMs);
      const responseBody = await response.clone().text().catch(() => '');
      if (response.status === 200) {
        await response.arrayBuffer();
        const snapshot = await fetchWithTimeout(`${baseUrl}/wp-json/reprint-push-lab/v1/snapshot`, {
          headers: {
            Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`,
            connection: 'close',
          },
        }, serverFetchTimeoutMs);
        const snapshotBody = await snapshot.clone().text().catch(() => '');
        let snapshotJson = null;
        try {
          snapshotJson = JSON.parse(snapshotBody);
        } catch (error) {
          if (labReadinessBodyRetryable(snapshot.status, snapshotBody)) {
            lastError = new Error(`Snapshot readiness HTTP ${snapshot.status}`);
            await new Promise((resolve) => setTimeout(resolve, readinessProbeIntervalMs));
            continue;
          }
          throw new Error(
            `Playground lab snapshot returned an invalid readiness body at ${baseUrl}: `
            + `${snapshotBody.slice(0, readinessFailureBodyLimit)}\n${getLogs()}`,
            { cause: error },
          );
        }
        if (labSnapshotReady({
          status: snapshot.status,
          body: snapshotJson,
        })) {
          await snapshot.arrayBuffer();
          return;
        }
        lastError = new Error(`Snapshot readiness HTTP ${snapshot.status}`);
        if (labSnapshotRetryable({
          status: snapshot.status,
          body: snapshotJson,
        })) {
          await new Promise((resolve) => setTimeout(resolve, readinessProbeIntervalMs));
          continue;
        }
        throw new Error(
          `Playground lab snapshot returned a terminal readiness failure at ${baseUrl}: `
          + `${snapshotBody.slice(0, readinessFailureBodyLimit)}\n${getLogs()}`,
        );
      }
      lastError = new Error(`HTTP ${response.status}: ${responseBody.slice(0, readinessFailureBodyLimit)}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, readinessProbeIntervalMs));
  }
  throw new Error(
    `Timed out waiting for Playground server at ${baseUrl}: ${lastError?.message ?? 'unknown'}\n${getLogs()}`,
  );
}

async function fetchWithTimeout(url, options = {}, timeoutMs = serverFetchTimeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
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
