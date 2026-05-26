#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticatedHttpClient } from '../../src/authenticated-http-push-client.js';
import { createPushPlan } from '../../src/planner.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const muPluginDir = path.join(repoRoot, 'scripts/playground/rest-mu-plugins');
const serverStartupTimeoutMs = 8_000;
const serverFetchTimeoutMs = 2_000;
const playgroundServerTimeoutMs = 29;
const requestTimeoutMs = 2_000;
const credentials = {
  username: 'reprint_push_admin',
  password: 'reprint-push-admin-app-password',
};

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

await withPlaygroundServer('remote-base', remoteBlueprint, async (remoteServer) => {
  await withPlaygroundServer('local-edited', localBlueprint, async (localServer) => {
    const client = authenticatedHttpClient({
      sourceUrl: remoteServer.baseUrl,
      credential: credentials,
      routeProfile: 'production-shaped',
      requestTimeoutMs,
    });

    const preflight = await client.signedGet('/preflight');
    assert.equal(preflight.status, 200, `production-shaped apply revalidation preflight HTTP ${preflight.status}`);
    assert.equal(preflight.body.ok, true);
    assert.equal(preflight.body.routeProfile.profile, 'production-shaped');
    assert.match(preflight.body.session.id, /^[A-Za-z0-9_-]{32,160}$/);

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

    process.stderr.write('apply-revalidation: recovery inspect /recovery/inspect\n');
    const recoveryInspect = await client.signedPost('/recovery/inspect', {
      plan,
      receipt: dryRun.body.receipt,
    }, { session, idempotencyKey });
    assert.equal(recoveryInspect.status, 200);
    assert.equal(recoveryInspect.body.ok, true);
    assert.ok(recoveryInspect.body.recovery?.counts?.blockedUnknown >= 1);

    process.stdout.write(JSON.stringify({
      ok: true,
      topology: {
        sourceUrl: remoteServer.baseUrl,
        remoteBase: 'remote-base',
        localEdited: 'local-edited',
        proxyPolicy: 'local-only',
        ingressPort: 8080,
      },
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
      boundary: {
        firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
        durableJournal: {
          verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
        },
      },
    }, null, 2));
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

  const child = spawn(
    'timeout',
    ['--preserve-status', '--kill-after=1s', `${playgroundServerTimeoutMs}s`, 'npx', ...args],
    {
      cwd: repoRoot,
      env: process.env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

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
    await stopPlaygroundChild(child);
    throw error;
  }
  return { name, baseUrl, port, child };
}

async function stopPlaygroundServer(server) {
  await stopPlaygroundChild(server.child);
}

async function stopPlaygroundChild(child) {
  if (child.exitCode !== null) {
    return;
  }
  child.kill('SIGTERM');
  try {
    await waitForExit(child, 2_000);
    return;
  } catch {
    child.kill('SIGKILL');
    await waitForExit(child, 2_000);
  }
}

async function waitForServer(child, baseUrl, getLogs) {
  const deadline = Date.now() + serverStartupTimeoutMs;
  let lastError = null;
  const lastProbes = [];
  let consecutiveIndex502s = 0;
  let nextHeartbeat = Date.now();
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Playground server exited early with ${child.exitCode}\n${getLogs()}`);
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
      if (consecutiveIndex502s >= 4) {
        break;
      }
    } catch (error) {
      lastError = error;
      process.stderr.write(`apply-revalidation: readiness probe error ${error.message}\n`);
      consecutiveIndex502s = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const probeText = lastProbes.length ? `\nProbe trail: ${JSON.stringify(lastProbes.slice(-4), null, 2)}` : '';
  throw new Error(`Timed out waiting for Playground server at ${baseUrl}: ${lastError?.message || 'unknown'}${probeText}\n${getLogs()}`);
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
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (child.exitCode !== null) {
    return;
  }
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
