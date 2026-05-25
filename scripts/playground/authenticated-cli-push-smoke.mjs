#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  remoteChanged: 'fixtures/playground/remote-changed.blueprint.json',
};

const snapshots = Object.fromEntries(
  Object.entries(fixtures).map(([name, fixture]) => [
    name,
    exportSnapshot(name, path.join(repoRoot, fixture)),
  ]),
);
const readyLocalSnapshot = snapshots.local;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-cli-push-'));
const basePath = path.join(tmpDir, 'base.json');
const localPath = path.join(tmpDir, 'local.json');
fs.writeFileSync(basePath, `${JSON.stringify(snapshots.base, null, 2)}\n`);
fs.writeFileSync(localPath, `${JSON.stringify(readyLocalSnapshot, null, 2)}\n`);

const summary = {
  dryRun: {},
  apply: {},
  stale: {},
  driftAfterSnapshot: {},
};

try {
  await withPlaygroundServer('authenticated-cli-ready-base', path.join(repoRoot, fixtures.base), async (server) => {
    const dryRun = runCli([
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
      'cli-auth-dry-run',
      '--dry-run-only',
    ]);

    assert.equal(dryRun.ok, true);
    assert.equal(dryRun.mode, 'dry-run');
    assert.equal(dryRun.preflight.status, 200);
    assert.equal(dryRun.plan.status, 'ready');
    assert.equal(dryRun.dryRun.status, 200);
    assert.equal(dryRun.dryRun.ok, true);
    assert.ok(dryRun.dryRun.receiptHash, 'CLI dry-run summary did not expose receipt hash');
    assert.equal(dryRun.apply, null);
    assert.equal(dryRun.after.finalMatchesLocal, false);

    const afterDryRun = await getSnapshot(server);
    assertVisibleSurfaceEqual(afterDryRun.body.snapshot, snapshots.base, 'CLI dry-run mutated the source');

    const apply = runCli([
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
      'cli-auth-apply',
    ]);

    assert.equal(apply.ok, true);
    assert.equal(apply.mode, 'apply');
    assert.equal(apply.plan.status, 'ready');
    assert.equal(apply.dryRun.status, 200);
    assert.equal(apply.apply.status, 200);
    assert.equal(apply.apply.ok, true);
    assert.equal(apply.apply.applied, apply.plan.mutations);
    assert.equal(apply.apply.idempotency.freshMutationWork, true);
    assert.equal(apply.after.finalMatchesLocal, true);
    assert.equal(apply.dbJournal.applyCommitted, true);
    assert.equal(apply.dbJournal.mutationApplied, apply.plan.mutations);

    const afterApply = await getSnapshot(server);
    assertVisibleSurfaceEqual(afterApply.body.snapshot, readyLocalSnapshot, 'CLI apply final source');

    summary.dryRun = {
      ok: dryRun.ok,
      receiptHash: dryRun.dryRun.receiptHash,
      finalMatchesLocal: dryRun.after.finalMatchesLocal,
    };
    summary.apply = {
      ok: apply.ok,
      applied: apply.apply.applied,
      finalMatchesLocal: apply.after.finalMatchesLocal,
      applyCommitted: apply.dbJournal.applyCommitted,
    };
  });

  await withPlaygroundServer('authenticated-cli-stale-source', path.join(repoRoot, fixtures.remoteChanged), async (server) => {
    const stale = runCli([
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
      'cli-auth-stale',
    ], { expectStatus: 2 });

    assert.equal(stale.ok, false);
    assert.equal(stale.code, 'PLAN_NOT_READY_LOCALLY');
    assert.equal(stale.plan.status, 'conflict');
    assert.equal(stale.dryRun, null);
    assert.equal(stale.apply, null);
    assert.ok(stale.plan.conflicts.length > 0, 'CLI stale-source summary did not expose conflicts');

    const afterStale = await getSnapshot(server);
    assertVisibleSurfaceEqual(afterStale.body.snapshot, snapshots.remoteChanged, 'CLI stale refusal mutated source');

    summary.stale = {
      ok: stale.ok,
      code: stale.code,
      planStatus: stale.plan.status,
      conflicts: stale.plan.conflicts.length,
    };
  });

  await withPlaygroundServer('authenticated-cli-drift-after-snapshot', path.join(repoRoot, fixtures.base), async (server) => {
    const drift = runCli([
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
      'cli-auth-drift-after-snapshot',
      '--lab-drift-after-snapshot',
      'post-title',
    ], { expectStatus: 2 });

    assert.equal(drift.ok, false);
    assert.equal(drift.code, 'PRECONDITION_FAILED');
    assert.equal(drift.plan.status, 'ready');
    assert.equal(drift.dryRun.status, 412);
    assert.equal(drift.dryRun.code, 'PRECONDITION_FAILED');
    assert.equal(drift.apply, null);
    assert.equal(drift.after, null);
    assert.equal(drift.dbJournal, null);

    const afterDrift = await getSnapshot(server);
    const expected = snapshotWithPostTitle(
      snapshots.base,
      'Concurrent source drift after authenticated snapshot',
    );
    assertVisibleSurfaceEqual(afterDrift.body.snapshot, expected, 'CLI post-snapshot drift refusal source state');

    summary.driftAfterSnapshot = {
      ok: drift.ok,
      code: drift.code,
      planStatus: drift.plan.status,
      dryRunStatus: drift.dryRun.status,
      finalMatchesInjectedDrift: digest(visibleSurface(afterDrift.body.snapshot)) === digest(visibleSurface(expected)),
    };
  });
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log(JSON.stringify(summary, null, 2));

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

async function withPlaygroundServer(name, blueprintPath, run, options = {}) {
  const server = await startPlaygroundServer(name, blueprintPath, options);
  try {
    await run(server);
  } finally {
    await stopPlaygroundServer(server);
  }
}

async function startPlaygroundServer(name, blueprintPath, options = {}) {
  const port = await findLocalPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logs = [];
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
      REPRINT_PUSH_LAB_AUTH_ADMIN_USER: credentials.username,
      REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: credentials.password,
      ...(options.env || {}),
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
      const response = await fetch(`${baseUrl}/wp-json/`, {
        headers: {
          connection: 'close',
        },
      });
      if (response.status === 200) {
        await response.arrayBuffer();
        const snapshot = await requestJsonWithRetry(
          baseUrl,
          'GET',
          '/wp-json/reprint-push-lab/v1/snapshot',
          undefined,
          {},
          { attempts: 2 },
        );
        if (snapshot.status === 200 && snapshot.body?.ok === true) {
          return;
        }
        lastError = new Error(`Snapshot readiness HTTP ${snapshot.status}`);
      }
      if (response.status !== 200) {
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

async function getSnapshot(server) {
  const response = await requestJson(server, 'GET', '/wp-json/reprint-push-lab/v1/snapshot');
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.ok(response.body.snapshot, 'snapshot response missing snapshot');
  return response;
}

async function requestJson(server, method, pathname, body = undefined, headers = {}) {
  return requestJsonWithRetry(server.baseUrl, method, pathname, body, headers);
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

function snapshotWithPostTitle(snapshot, title) {
  const next = JSON.parse(JSON.stringify(snapshot));
  next.db.wp_posts['ID:1001'].post_title = title;
  return next;
}

function visibleSurface(snapshot) {
  return {
    files: snapshot.files,
    db: snapshot.db,
    plugins: snapshot.plugins,
  };
}
