#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticatedHttpClient } from '../../src/authenticated-http-push-client.js';
import { createPushPlan } from '../../src/planner.js';
import { digest } from '../../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const muPluginDir = path.join(repoRoot, 'scripts/playground/rest-mu-plugins');
const cliPath = path.join(repoRoot, 'bin/reprint-push-lab.js');
const serverStartupTimeoutMs = 120_000;
const transientFetchRetryDelayMs = 250;
const transientFetchAttempts = 4;

const credentials = {
  username: 'reprint_push_admin',
  password: 'reprint-push-admin-app-password',
};

const fixtures = {
  base: 'fixtures/playground/remote-base.blueprint.json',
  local: 'fixtures/playground/local-edited.blueprint.json',
};

const snapshots = Object.fromEntries(
  Object.entries(fixtures).map(([name, fixture]) => [
    name,
    exportSnapshot(name, path.join(repoRoot, fixture)),
  ]),
);
const routeLocalSnapshot = snapshots.local;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-production-shaped-route-'));
const basePath = path.join(tmpDir, 'base.json');
const localPath = path.join(tmpDir, 'local.json');
fs.writeFileSync(basePath, `${JSON.stringify(snapshots.base, null, 2)}\n`);
fs.writeFileSync(localPath, `${JSON.stringify(routeLocalSnapshot, null, 2)}\n`);

const readyPlan = createPushPlan({
  base: snapshots.base,
  local: routeLocalSnapshot,
  remote: snapshots.base,
});

assert.equal(readyPlan.status, 'ready');
assert.ok(readyPlan.mutations.some((mutation) => mutation.resourceKey.startsWith('row:')), 'ready plan needs a DB row mutation');
assert.ok(readyPlan.mutations.some((mutation) => mutation.resourceKey.startsWith('file:')), 'ready plan needs a file mutation');

const summary = {
  routeProfile: 'production-shaped',
  cli: {},
  routes: {},
  dryRun: {},
  apply: {},
  crossRouteReceipt: {},
  replay: {},
  conflict: {},
  journal: {},
  recovery: {},
};

try {
  await withPlaygroundServer('production-shaped-route', path.join(repoRoot, fixtures.base), async (server) => {
    const client = authenticatedHttpClient({
      sourceUrl: server.baseUrl,
      credential: credentials,
      routeProfile: 'production-shaped',
    });
    const labClient = authenticatedHttpClient({
      sourceUrl: server.baseUrl,
      credential: credentials,
      routeProfile: 'lab-authenticated',
    });

    const index = await requestJson(server.baseUrl, 'GET', '/wp-json/');
    assert.equal(index.status, 200);
    assertRouteNamespace(index.body);

    const cliDryRun = runCli([
      'push-authenticated',
      '--base',
      basePath,
      '--local',
      localPath,
      '--source-url',
      server.baseUrl,
      '--username',
      credentials.username,
      '--application-password',
      credentials.password,
      '--idempotency-key',
      'production-shaped-cli-dry-run',
      '--route-profile',
      'production-shaped',
      '--dry-run-only',
    ]);
    assert.equal(cliDryRun.ok, true);
    assert.equal(cliDryRun.source.namespace, 'reprint/v1');
    assert.equal(cliDryRun.source.routePrefix, '/push');
    assert.equal(cliDryRun.source.routeProfile, 'production-shaped');
    assert.equal(cliDryRun.dryRun.status, 200);
    assert.equal(cliDryRun.after.finalMatchesLocal, false);
    await assertCurrentSurface(client, snapshots.base, 'production-shaped CLI dry-run must not mutate');

    const preflight = await client.signedGet('/preflight');
    assert.equal(preflight.status, 200);
    assert.equal(preflight.body.ok, true);
    assert.equal(preflight.body.routeProfile.profile, 'production-shaped');
    assert.equal(preflight.body.routeProfile.restNamespace, 'reprint/v1');
    assert.equal(preflight.body.routeProfile.routePrefix, '/push');
    assert.equal(preflight.body.routeProfile.labBacked, true);
    assert.match(preflight.body.session.id, /^[A-Za-z0-9_-]{32,160}$/);
    const session = preflight.body.session.id;

    const initial = await client.get('/snapshot');
    assert.equal(initial.status, 200);
    assert.equal(initial.body.ok, true);
    assertVisibleSurfaceEqual(initial.body.snapshot, snapshots.base, 'production-shaped initial snapshot');

    const idempotencyKey = 'production-shaped-route-apply';
    const dryRun = await client.signedPost('/dry-run', { plan: readyPlan }, {
      session,
      idempotencyKey,
    });
    assert.equal(dryRun.status, 200);
    assert.equal(dryRun.body.ok, true);
    assert.equal(dryRun.body.mode, 'dry-run');
    assert.ok(dryRun.body.receipt?.receiptHash, 'production-shaped dry-run receipt hash missing');
    assert.equal(dryRun.body.receipt.authBinding.request.restNamespace, 'reprint/v1');
    assert.equal(dryRun.body.receipt.authBinding.request.dryRunRoute, '/push/dry-run');
    assert.equal(dryRun.body.receipt.authBinding.request.routeProfile, 'production-shaped');
    assert.equal(dryRun.body.receipt.authBinding.request.labBacked, true);
    await assertCurrentSurface(client, snapshots.base, 'production-shaped dry-run must not mutate');

    const labPreflight = await labClient.signedGet('/preflight');
    assert.equal(labPreflight.status, 200);
    assert.equal(labPreflight.body.ok, true);
    assert.equal(labPreflight.body.routeProfile.profile, 'lab-authenticated');
    assert.equal(labPreflight.body.routeProfile.restNamespace, 'reprint-push-lab/v1');
    const labSession = labPreflight.body.session.id;

    const labDryRun = await labClient.signedPost('/dry-run', { plan: readyPlan }, {
      session: labSession,
      idempotencyKey: 'production-shaped-cross-route-lab-dry-run',
    });
    assert.equal(labDryRun.status, 200);
    assert.equal(labDryRun.body.ok, true);
    assert.ok(labDryRun.body.receipt?.receiptHash, 'lab-authenticated dry-run receipt hash missing');
    assert.equal(labDryRun.body.receipt.authBinding.request.routeProfile, 'lab-authenticated');
    assert.equal(labDryRun.body.receipt.authBinding.request.dryRunRoute, '/authenticated/dry-run');

    const labReceiptOnProductionApply = await client.signedPost('/apply', {
      plan: readyPlan,
      receipt: labDryRun.body.receipt,
    }, {
      session,
      idempotencyKey: 'production-shaped-cross-route-lab-receipt-on-production',
    });
    assert.equal(labReceiptOnProductionApply.status, 409);
    assert.equal(labReceiptOnProductionApply.body.ok, false);
    assert.equal(labReceiptOnProductionApply.body.code, 'AUTH_RECEIPT_MISMATCH');
    assert.equal(labReceiptOnProductionApply.body.mode, 'apply');
    await assertCurrentSurface(client, snapshots.base, 'lab-authenticated receipt on production-shaped apply must not mutate');

    const productionReceiptOnLabApply = await labClient.signedPost('/apply', {
      plan: readyPlan,
      receipt: dryRun.body.receipt,
    }, {
      session: labSession,
      idempotencyKey: 'production-shaped-cross-route-production-receipt-on-lab',
    });
    assert.equal(productionReceiptOnLabApply.status, 409);
    assert.equal(productionReceiptOnLabApply.body.ok, false);
    assert.equal(productionReceiptOnLabApply.body.code, 'AUTH_RECEIPT_MISMATCH');
    assert.equal(productionReceiptOnLabApply.body.mode, 'apply');
    await assertCurrentSurface(client, snapshots.base, 'production-shaped receipt on lab-authenticated apply must not mutate');

    const journalAfterCrossRouteFailures = await client.get('/db-journal?limit=80');
    assert.equal(journalAfterCrossRouteFailures.status, 200);
    assert.equal(journalAfterCrossRouteFailures.body.ok, true);
    const crossRouteFailureRows = journalAfterCrossRouteFailures.body.dbJournal.latestRows;
    assert.equal(crossRouteFailureRows.filter((entry) => entry.event === 'idempotency-opened').length, 0);
    assert.equal(crossRouteFailureRows.filter((entry) => entry.event === 'apply-started').length, 0);
    assert.equal(crossRouteFailureRows.filter((entry) => entry.event === 'mutation-applied').length, 0);

    const applyBody = { plan: readyPlan, receipt: dryRun.body.receipt };
    const apply = await client.signedPost('/apply', applyBody, {
      session,
      idempotencyKey,
    });
    assert.equal(apply.status, 200);
    assert.equal(apply.body.ok, true);
    assert.equal(apply.body.mode, 'apply');
    assert.equal(apply.body.applied, readyPlan.mutations.length);
    assert.equal(apply.body.idempotency.freshMutationWork, true);
    await assertCurrentSurface(client, routeLocalSnapshot, 'production-shaped apply final source');

    const replay = await client.signedPost('/apply', applyBody, {
      session,
      idempotencyKey,
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.ok, true);
    assert.equal(replay.body.idempotency.replayed, true);
    assert.equal(replay.body.idempotency.freshMutationWork, false);
    await assertCurrentSurface(client, routeLocalSnapshot, 'production-shaped replay must not mutate');

    const conflict = await client.signedPost('/apply', {
      ...applyBody,
      labDelayAfterIdempotencyOpenMs: 0,
    }, {
      session,
      idempotencyKey,
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.ok, false);
    assert.equal(conflict.body.code, 'IDEMPOTENCY_KEY_CONFLICT');
    assert.equal(conflict.body.idempotency.freshMutationWork, false);
    await assertCurrentSurface(client, routeLocalSnapshot, 'production-shaped different-body conflict must not mutate');

    const dbJournal = await client.get('/db-journal?limit=80');
    assert.equal(dbJournal.status, 200);
    const entries = dbJournal.body.dbJournal.latestRows;
    assert.ok(entries.some((entry) => entry.event === 'apply-committed'), 'DB journal missing apply-committed');
    assert.ok(entries.some((entry) => entry.event === 'apply-replayed'), 'DB journal missing apply-replayed');
    assert.ok(entries.some((entry) => entry.event === 'idempotency-key-conflict'), 'DB journal missing idempotency-key-conflict');
    assert.equal(entries.filter((entry) => entry.event === 'mutation-applied').length, readyPlan.mutations.length);

    const recovery = await client.post('/recovery/inspect', applyBody);
    assert.equal(recovery.status, 200);
    assert.equal(recovery.body.ok, true);
    assert.equal(recovery.body.recovery.state, 'fully-updated-remote');
    assert.equal(recovery.body.recovery.counts.new, readyPlan.mutations.length);

    summary.cli = {
      ok: cliDryRun.ok,
      namespace: cliDryRun.source.namespace,
      routePrefix: cliDryRun.source.routePrefix,
      dryRunStatus: cliDryRun.dryRun.status,
    };
    summary.routes = {
      namespace: preflight.body.routeProfile.restNamespace,
      prefix: preflight.body.routeProfile.routePrefix,
      labBacked: preflight.body.routeProfile.labBacked,
    };
    summary.dryRun = {
      receiptHash: dryRun.body.receipt.receiptHash,
      dryRunRoute: dryRun.body.receipt.authBinding.request.dryRunRoute,
    };
    summary.apply = {
      applied: apply.body.applied,
      freshMutationWork: apply.body.idempotency.freshMutationWork,
    };
    summary.crossRouteReceipt = {
      labReceiptOnProductionStatus: labReceiptOnProductionApply.status,
      labReceiptOnProductionCode: labReceiptOnProductionApply.body.code,
      productionReceiptOnLabStatus: productionReceiptOnLabApply.status,
      productionReceiptOnLabCode: productionReceiptOnLabApply.body.code,
      dbMutationRowsBeforeValidApply: crossRouteFailureRows.filter((entry) => entry.event === 'mutation-applied').length,
    };
    summary.replay = {
      replayed: replay.body.idempotency.replayed,
      freshMutationWork: replay.body.idempotency.freshMutationWork,
    };
    summary.conflict = {
      status: conflict.status,
      code: conflict.body.code,
      freshMutationWork: conflict.body.idempotency.freshMutationWork,
    };
    summary.journal = {
      events: [...new Set(entries.map((entry) => entry.event))].sort(),
      mutationApplied: entries.filter((entry) => entry.event === 'mutation-applied').length,
    };
    summary.recovery = {
      state: recovery.body.recovery.state,
      counts: recovery.body.recovery.counts,
    };
  });
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log(JSON.stringify(summary, null, 2));

function exportSnapshot(name, blueprintPath) {
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
  });

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

function runCli(args, { expectStatus = 0 } = {}) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  });

  assert.equal(
    result.status,
    expectStatus,
    `CLI status mismatch\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
  );

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`CLI did not return JSON\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}\n${error.message}`);
  }
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
  const logs = [];
  const child = spawn('npx', [
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
  ], {
    cwd: repoRoot,
    env: {
      ...process.env,
      REPRINT_PUSH_LAB_AUTH_BOOTSTRAP: '1',
      REPRINT_PUSH_LAB_AUTH_ADMIN_USER: credentials.username,
      REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: credentials.password,
      NODE_OPTIONS: appendNodeOption(process.env.NODE_OPTIONS, localhostListenPreloadOption()),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => pushLog(logs, chunk));
  child.stderr.on('data', (chunk) => pushLog(logs, chunk));

  try {
    await waitForServer(child, baseUrl, logs);
  } catch (error) {
    await stopChildProcess(child);
    throw error;
  }

  return { name, port, baseUrl, child, logs };
}

async function stopPlaygroundServer(server) {
  await stopChildProcess(server.child);
  assert.equal(await isPortAccepting(server.port), false, `Playground server still accepts connections on ${server.baseUrl}`);
}

async function stopChildProcess(child) {
  if (child.exitCode !== null || child.killed) {
    return;
  }
  child.kill('SIGTERM');
  try {
    await waitForExit(child, 12_000);
  } catch {
    child.kill('SIGKILL');
    await waitForExit(child, 12_000);
  }
}

async function waitForServer(child, baseUrl, logs) {
  const deadline = Date.now() + serverStartupTimeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Playground server exited early with ${child.exitCode}\n${logs.join('')}`);
    }

    try {
      const response = await fetch(`${baseUrl}/wp-json/`, { headers: { connection: 'close' } });
      if (response.status === 200) {
        await response.arrayBuffer();
        const snapshot = await requestJsonWithRetry(
          baseUrl,
          'GET',
          '/wp-json/reprint/v1/push/snapshot',
          undefined,
          authHeaders(credentials),
          { attempts: 2 },
        );
        if (snapshot.status === 200 && snapshot.body?.ok === true) {
          return;
        }
        lastError = new Error(`Production-shaped snapshot readiness HTTP ${snapshot.status}`);
      } else {
        lastError = new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for Playground server at ${baseUrl}: ${lastError?.message || 'unknown'}\n${logs.join('')}`);
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      reject(new Error('Timed out waiting for Playground server exit'));
    }, timeoutMs);
    function onExit() {
      clearTimeout(timer);
      resolve();
    }
    child.once('exit', onExit);
  });
}

async function assertCurrentSurface(client, expected, label) {
  const response = await client.get('/snapshot');
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assertVisibleSurfaceEqual(response.body.snapshot, expected, label);
}

function assertRouteNamespace(body) {
  const namespaces = Array.isArray(body.namespaces) ? body.namespaces : [];
  const routeKeys = body.routes && typeof body.routes === 'object' ? Object.keys(body.routes) : [];
  assert.ok(
    namespaces.includes('reprint/v1') || routeKeys.some((route) => route.startsWith('/reprint/v1/push/')),
    'REST index does not expose reprint/v1 push routes',
  );
}

function authHeaders(credential) {
  return {
    authorization: `Basic ${Buffer.from(`${credential.username}:${credential.password}`, 'utf8').toString('base64')}`,
  };
}

async function requestJson(baseUrl, method, pathname, body = undefined, headers = {}) {
  return requestJsonWithRetry(baseUrl, method, pathname, body, headers);
}

async function requestJsonWithRetry(baseUrl, method, pathname, body = undefined, headers = {}, { attempts = transientFetchAttempts } = {}) {
  let lastError;
  const retryable = method === 'GET';
  const maxAttempts = retryable ? attempts : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await requestJsonOnce(baseUrl, method, pathname, body, headers);
    } catch (error) {
      lastError = error;
      if (!retryable || !isTransientFetchError(error) || attempt === maxAttempts) {
        throw error;
      }
      await sleep(transientFetchRetryDelayMs * attempt);
    }
  }
  throw lastError;
}

async function requestJsonOnce(baseUrl, method, pathname, body = undefined, headers = {}) {
  const requestHeaders = body === undefined ? {
    connection: 'close',
    ...headers,
  } : {
    'content-type': 'application/json',
    connection: 'close',
    ...headers,
  };
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`Expected JSON from ${method} ${pathname}, got HTTP ${response.status}\n${text}\n${error.message}`);
  }
  return {
    status: response.status,
    body: json,
  };
}

async function findLocalPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      assert.equal(typeof address, 'object');
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

async function isPortAccepting(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(750, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function isTransientFetchError(error) {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = error.cause?.code || error.code;
  return error.name === 'TypeError' && (
    code === 'UND_ERR_SOCKET'
    || code === 'ECONNRESET'
    || code === 'EPIPE'
    || code === 'ETIMEDOUT'
  );
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

function pushLog(logs, chunk) {
  logs.push(chunk);
  if (logs.join('').length > 20_000) {
    logs.splice(0, logs.length, logs.join('').slice(-20_000));
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseMarkedJson(stdout, begin, end, missingMessage) {
  const match = stdout.match(new RegExp(`${begin}\\n([\\s\\S]*?)\\n${end}`));
  if (!match) {
    throw new Error(missingMessage);
  }
  return JSON.parse(match[1]);
}

function assertVisibleSurfaceEqual(actual, expected, label) {
  assert.deepEqual(visibleSurface(actual), visibleSurface(expected), `${label} mismatch`);
  assert.equal(digest(visibleSurface(actual)), digest(visibleSurface(expected)), `${label} digest mismatch`);
}

function visibleSurface(snapshot) {
  return {
    files: snapshot.files,
    db: snapshot.db,
    plugins: snapshot.plugins,
  };
}
