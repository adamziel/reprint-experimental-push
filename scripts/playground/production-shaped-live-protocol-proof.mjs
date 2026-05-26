#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticatedHttpClient, runAuthenticatedHttpPush } from '../../src/authenticated-http-push-client.js';
import {
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
    assert.equal(preflight.status, 200, `production-shaped live protocol preflight HTTP ${preflight.status}`);
    assert.equal(preflight.body.ok, true);
    assert.equal(preflight.body.routeProfile.profile, 'production-shaped');
    assert.equal(preflight.body.routeProfile.restNamespace, 'reprint/v1');
    assert.equal(preflight.body.routeProfile.routePrefix, '/push');
    assert.match(preflight.body.session.id, /^[A-Za-z0-9_-]{32,160}$/);

    const proof = await runAuthenticatedHttpPush({
      sourceUrl: remoteServer.baseUrl,
      base: await exportSnapshot('remote-base', remoteServer.baseUrl),
      local: withoutUnmappedGraphPostmeta(await exportSnapshot('local-edited', localServer.baseUrl)),
      username: credentials.username,
      applicationPassword: credentials.password,
      idempotencyKey: 'production-shaped-live-protocol-proof-001',
      routeProfile: 'production-shaped',
      dryRunOnly: false,
      labDriftAfterSnapshot: '',
      now: new Date('2026-05-25T09:45:00.000Z'),
    });

    assert.equal(proof.preflight.status, 200);
    assert.ok(
      proof.dryRun?.status === 200,
      JSON.stringify({ code: proof.code, preflight: proof.preflight, plan: proof.plan, dryRun: proof.dryRun }, null, 2),
    );
    assert.ok(proof.dryRun?.receiptHash, 'dry-run receipt hash missing');
    assert.ok(
      proof.apply?.status === 200,
      JSON.stringify({ code: proof.code, dryRun: proof.dryRun, apply: proof.apply }, null, 2),
    );
    assert.ok(
      proof.after?.status === 200,
      JSON.stringify({ code: proof.code, apply: proof.apply, after: proof.after }, null, 2),
    );

    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          topology,
          preflight: {
            status: preflight.status,
            routeProfile: preflight.body.routeProfile,
            session: {
              id: preflight.body.session.id,
              type: preflight.body.session.type,
            },
          },
          protocol: {
            mode: proof.mode,
            sourceUrl: remoteServer.baseUrl,
            dryRun: proof.dryRun,
            apply: proof.apply,
            recoveryInspect: proof.recoveryInspect,
            after: proof.after,
            dbJournal: proof.dbJournal,
          },
        },
        null,
        2,
      ),
    );
    process.stdout.write('\n');
  });
});

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

  return { name, baseUrl, port, child };
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
  let timeoutProbeCount = 0;
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
      timeoutProbeCount = 0;
      if (response.status === 200) {
        const { response: snapshot, bodyText: snapshotBody } = await fetchTextWithTimeout(`${baseUrl}/wp-json/reprint-push-lab/v1/snapshot`, {
          headers: {
            Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`,
            connection: 'close',
          },
        }, serverFetchTimeoutMs, child);
        timeoutProbeCount = 0;
        let snapshotJson = null;
        try {
          snapshotJson = JSON.parse(snapshotBody);
        } catch (error) {
          if (labReadinessBodyRetryable(snapshot.status, snapshotBody)) {
            lastError = new Error(`Snapshot readiness HTTP ${snapshot.status}`);
            await sleepUnlessChildExit(readinessProbeIntervalMs, child);
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
          return;
        }
        lastError = new Error(`Snapshot readiness HTTP ${snapshot.status}`);
        if (labSnapshotRetryable({
          status: snapshot.status,
          body: snapshotJson,
        })) {
          await sleepUnlessChildExit(readinessProbeIntervalMs, child);
          continue;
        }
        throw new Error(
          `Playground lab snapshot returned a terminal readiness failure at ${baseUrl}: `
          + `${snapshotBody.slice(0, readinessFailureBodyLimit)}\n${getLogs()}`,
        );
      }
      lastError = new Error(`HTTP ${response.status}: ${responseBody.slice(0, readinessFailureBodyLimit)}`);
    } catch (error) {
      if (!labReadinessErrorRetryable(error)) {
        throw error;
      }
      lastError = error;
      timeoutProbeCount = labNextTimeoutProbeCount(timeoutProbeCount, error);
      if (labReadinessProbeTimedOut(error) && timeoutProbeCount >= maxConsecutiveTimeoutProbes) {
        throw new Error(
          `Playground server hit ${timeoutProbeCount} consecutive readiness probe timeout${timeoutProbeCount === 1 ? '' : 's'} at ${baseUrl}: ${lastError?.message ?? 'unknown'}\n${getLogs()}`,
        );
      }
    }
    await sleepUnlessChildExit(readinessProbeIntervalMs, child);
  }
  throw new Error(
    `Timed out waiting for Playground server at ${baseUrl}: ${lastError?.message ?? 'unknown'}\n${getLogs()}`,
  );
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
