#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';
import { digest } from '../../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-production-plugin-package-'));
const packageRoot = path.join(tmpDir, 'package');
const pluginDir = path.join(packageRoot, 'reprint-push');
const blueprintPath = path.join(tmpDir, 'remote-base-with-reprint-push-plugin.blueprint.json');
const basePath = path.join(tmpDir, 'base.json');
const localPath = path.join(tmpDir, 'local.json');

try {
  buildPluginPackage(pluginDir);
  writeActivationBlueprint(path.join(repoRoot, fixtures.base), blueprintPath);
  fs.writeFileSync(basePath, `${JSON.stringify(snapshots.base, null, 2)}\n`);
  fs.writeFileSync(localPath, `${JSON.stringify(snapshots.local, null, 2)}\n`);

  const summary = {
    package: {
      plugin: 'reprint-push/reprint-push.php',
      mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      copiedFiles: fs.readdirSync(path.join(pluginDir, 'includes')).sort(),
    },
    routes: {},
    cli: {},
    final: {},
  };

  await withPlaygroundServer('production-plugin-package', blueprintPath, pluginDir, async (server) => {
    const index = await requestJson(server.baseUrl, 'GET', '/wp-json/');
    assert.equal(index.status, 200);
    assertRouteNamespace(index.body);

    const labRoute = await requestJson(server.baseUrl, 'GET', '/wp-json/reprint-push-lab/v1/snapshot');
    assert.equal(labRoute.status, 404);
    assert.equal(labRoute.body.code, 'rest_no_route');

    const preflight = await requestJson(
      server.baseUrl,
      'GET',
      '/wp-json/reprint/v1/push/preflight',
      undefined,
      signedHeadersForPreflight(),
    );
    assert.equal(preflight.status, 200);
    assert.equal(preflight.body.ok, true);
    assert.equal(preflight.body.routeProfile.profile, 'production-shaped');
    assert.equal(preflight.body.routeProfile.restNamespace, 'reprint/v1');
    assert.equal(preflight.body.routeProfile.labBacked, true);
    assertSignedStoreCleanup(preflight.body.sessionStore?.cleanup);

    const result = runCli([
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
      'production-plugin-package-apply',
      '--route-profile',
      'production-shaped',
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.source.namespace, 'reprint/v1');
    assert.equal(result.source.routePrefix, '/push');
    assert.equal(result.apply.status, 200);
    assert.equal(result.apply.applied, result.plan.mutations);
    assert.equal(result.apply.idempotency.freshMutationWork, true);
    assert.equal(result.dbJournal.applyCommitted, true);
    assert.equal(result.after.finalMatchesLocal, true);

    const after = await requestJson(
      server.baseUrl,
      'GET',
      '/wp-json/reprint/v1/push/snapshot',
      undefined,
      authHeaders(),
    );
    assert.equal(after.status, 200);
    assert.equal(after.body.ok, true);
    assertVisibleSurfaceEqual(after.body.snapshot, snapshots.local, 'packaged plugin final source');

    summary.routes = {
      namespace: preflight.body.routeProfile.restNamespace,
      labNamespaceDisabled: labRoute.status === 404,
      profile: preflight.body.routeProfile.profile,
      signedStoreCleanup: {
        deletedExpiredTotal: preflight.body.sessionStore.cleanup.deletedExpiredTotal,
        sessionsDeleted: preflight.body.sessionStore.cleanup.sessionOptions.deletedExpired,
        noncesDeleted: preflight.body.sessionStore.cleanup.nonceOptions.deletedExpired,
      },
    };
    summary.cli = {
      ok: result.ok,
      namespace: result.source.namespace,
      applied: result.apply.applied,
      applyCommitted: result.dbJournal.applyCommitted,
    };
    summary.final = {
      finalMatchesLocal: result.after.finalMatchesLocal,
      visibleSurfaceHash: digest(visibleSurface(after.body.snapshot)),
    };
  });

  console.log(JSON.stringify(summary, null, 2));
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
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

function writeActivationBlueprint(sourceBlueprintPath, targetBlueprintPath) {
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
      '$past = time() - 60;',
      '$future = time() + 3600;',
      "add_option('reprint_push_lab_signed_session_' . str_repeat('a', 64), array('schemaVersion'=>1,'expiresAtUnix'=>$past,'fixture'=>'expired-session'), '', 'no');",
      "add_option('reprint_push_lab_signed_session_' . str_repeat('b', 64), array('schemaVersion'=>1,'expiresAtUnix'=>$future,'fixture'=>'future-session'), '', 'no');",
      "add_option('reprint_push_lab_signed_nonce_' . str_repeat('c', 64), array('schemaVersion'=>1,'expiresAtUnix'=>$past,'fixture'=>'expired-nonce'), '', 'no');",
      "add_option('reprint_push_lab_signed_nonce_' . str_repeat('d', 64), array('schemaVersion'=>1,'expiresAtUnix'=>$future,'fixture'=>'future-nonce'), '', 'no');",
    ].join(' '),
  });
  fs.writeFileSync(targetBlueprintPath, `${JSON.stringify(blueprint, null, 2)}\n`);
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

async function withPlaygroundServer(name, blueprintPath, mountedPluginDir, run) {
  const server = await startPlaygroundServer(name, blueprintPath, mountedPluginDir);
  try {
    await run(server);
  } finally {
    await stopPlaygroundServer(server);
  }
}

async function startPlaygroundServer(name, blueprintPath, mountedPluginDir) {
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
    `${mountedPluginDir}:/wordpress/wp-content/plugins/reprint-push`,
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

async function waitForServer(child, baseUrl, logs) {
  const deadline = Date.now() + serverStartupTimeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Playground server exited early with ${child.exitCode}\n${logs.join('')}`);
    }

    try {
      const response = await requestJson(
        baseUrl,
        'GET',
        '/wp-json/reprint/v1/push/snapshot',
        undefined,
        authHeaders(),
        { attempts: 2 },
      );
      if (response.status === 200 && response.body?.ok === true) {
        return;
      }
      lastError = new Error(`Production plugin package snapshot readiness HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for Playground server at ${baseUrl}: ${lastError?.message || 'unknown'}\n${logs.join('')}`);
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

async function requestJson(baseUrl, method, pathname, body = undefined, headers = {}, { attempts = transientFetchAttempts } = {}) {
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

function signedHeadersForPreflight() {
  const contentHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = `production-plugin-package-${Date.now()}`;
  const signingKey = hmacHex(credentials.password, `reprint-push-lab-v1\n${credentials.username}`);
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
    ...authHeaders(),
    'X-Auth-Content-Hash': contentHash,
    'X-Auth-Timestamp': timestamp,
    'X-Auth-Nonce': nonce,
    'X-Auth-Signature': hmacHex(signingKey, authString),
    'X-Reprint-Push-Signature': hmacHex(signingKey, canonical),
  };
}

function authHeaders() {
  return {
    authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`, 'utf8').toString('base64')}`,
  };
}

function hmacHex(key, data) {
  return createHmac('sha256', key).update(data, 'utf8').digest('hex');
}

function assertRouteNamespace(body) {
  const namespaces = Array.isArray(body.namespaces) ? body.namespaces : [];
  const routeKeys = body.routes && typeof body.routes === 'object' ? Object.keys(body.routes) : [];
  assert.ok(
    namespaces.includes('reprint/v1') || routeKeys.some((route) => route.startsWith('/reprint/v1/push/')),
    'REST index does not expose reprint/v1 push routes',
  );
  assert.equal(
    namespaces.includes('reprint-push-lab/v1') || routeKeys.some((route) => route.startsWith('/reprint-push-lab/v1')),
    false,
    'packaged plugin must not expose public lab REST namespace',
  );
}

function assertSignedStoreCleanup(cleanup) {
  assert.equal(cleanup?.schemaVersion, 1);
  assert.equal(cleanup.store, 'wp-options');
  assert.ok(cleanup.deletedExpiredTotal >= 2, 'signed store cleanup must delete seeded expired artifacts');
  assert.ok(cleanup.sessionOptions.deletedExpired >= 1, 'expired signed session option was not deleted');
  assert.ok(cleanup.nonceOptions.deletedExpired >= 1, 'expired signed nonce option was not deleted');
  assert.ok(cleanup.sessionOptions.retainedUnexpired >= 1, 'unexpired signed session option was not retained');
  assert.ok(cleanup.nonceOptions.retainedUnexpired >= 1, 'unexpired signed nonce option was not retained');
  assert.equal(cleanup.sessionOptions.limitReached, false);
  assert.equal(cleanup.nonceOptions.limitReached, false);
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
