#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticatedHttpClient } from '../../src/authenticated-http-push-client.js';
import { createPushPlan } from '../../src/planner.js';
import { digest } from '../../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const muPluginDir = path.join(repoRoot, 'scripts/playground/rest-mu-plugins');
const baseBlueprintPath = path.join(repoRoot, 'fixtures/playground/remote-base.blueprint.json');
const localBlueprintPath = path.join(repoRoot, 'fixtures/playground/local-edited.blueprint.json');
const serverStartupTimeoutMs = Number(process.env.REPRINT_PUSH_DRY_RUN_ROUTE_LIVE_TIMEOUT_MS || 120_000);
const transientFetchRetryDelayMs = 250;
const transientFetchAttempts = 4;
const endpointPath = '/wp-json/reprint/v1/push/dry-run';
const preflightEndpointPath = '/wp-json/reprint/v1/push/preflight';
const snapshotEndpointPath = '/wp-json/reprint/v1/push/snapshot';
const routeIndexPath = '/reprint/v1/push/dry-run';
const credentials = {
  username: 'reprint_push_admin',
  password: 'reprint-push-admin-app-password',
};
const idempotencyKey = 'rpp-0523-production-dry-run-route-v2';

const snapshots = {
  base: exportSnapshot('remote-base', baseBlueprintPath),
  local: withoutUnmappedGraphPostmeta(exportSnapshot('local-edited', localBlueprintPath)),
};
const readyPlan = createPushPlan({
  base: snapshots.base,
  local: snapshots.local,
  remote: snapshots.base,
});
assert.equal(readyPlan.status, 'ready');
assert.ok(readyPlan.mutations.length > 0, 'RPP-0523 dry-run proof needs at least one ready mutation');
const expectedPlanHash = digest(readyPlan);

const summary = {
  ok: false,
  routeProfile: 'production-shaped',
  endpoint: endpointPath,
  liveUrl: {
    scheme: 'http',
    host: '127.0.0.1',
    port: 'ephemeral',
    exposure: 'sandbox-local-loopback-only',
    tunnel: 'none',
  },
  routeIndex: {},
  unsigned: {},
  preflight: {},
  plan: {
    status: readyPlan.status,
    mutations: readyPlan.mutations.length,
    planHashLength: expectedPlanHash.length,
  },
  dryRun: {},
  after: {},
};

try {
  await withPlaygroundServer('rpp-0523-production-dry-run', baseBlueprintPath, async (server) => {
    summary.liveUrl.port = server.port;

    const index = await requestJson(server.baseUrl, 'GET', '/wp-json/');
    assert.equal(index.status, 200, `REST index HTTP ${index.status}`);
    assertRoute(index.body, routeIndexPath, 'POST');
    summary.routeIndex = {
      namespacePresent: Array.isArray(index.body.namespaces) && index.body.namespaces.includes('reprint/v1'),
      routePresent: Boolean(index.body.routes?.[routeIndexPath]),
      methods: routeMethods(index.body.routes?.[routeIndexPath]),
    };

    const unsigned = await requestJson(
      server.baseUrl,
      'POST',
      endpointPath,
      { plan: { deliberately: 'not parsed before signature verification' } },
      authHeaders(credentials),
    );
    assert.equal(unsigned.status, 401, `unsigned production dry-run HTTP ${unsigned.status}`);
    assert.equal(unsigned.body?.code, 'SIGNED_HEADER_REQUIRED');
    assert.equal(unsigned.body?.receipt, undefined, 'unsigned dry-run must not mint a receipt');
    summary.unsigned = {
      status: unsigned.status,
      code: unsigned.body?.code || null,
      receiptMinted: Boolean(unsigned.body?.receipt),
    };

    const client = authenticatedHttpClient({
      sourceUrl: server.baseUrl,
      credential: credentials,
      routeProfile: 'production-shaped',
      requestTimeoutMs: 30_000,
    });

    const preflight = await client.signedGet('/preflight');
    assert.equal(preflight.status, 200, `production-shaped preflight HTTP ${preflight.status}`);
    assert.equal(preflight.body?.ok, true, 'production-shaped preflight must report ok');
    assert.equal(preflight.request?.pathname, preflightEndpointPath);
    assert.equal(preflight.body?.routeProfile?.profile, 'production-shaped');
    assert.equal(preflight.body?.routeProfile?.restNamespace, 'reprint/v1');
    assert.equal(preflight.body?.routeProfile?.routePrefix, '/push');
    assert.equal(preflight.body?.auth?.identity?.userLogin, credentials.username);
    assert.equal(preflight.body?.auth?.identity?.capabilities?.manage_options, true);
    assert.equal(preflight.body?.auth?.session?.type, 'production-auth-session');
    assert.equal(preflight.body?.auth?.session?.status, 'active');
    assert.match(preflight.body?.session?.id || '', /^[A-Za-z0-9_-]{32,160}$/);
    assert.match(preflight.body?.session?.sessionHash || '', /^[a-f0-9]{64}$/);
    assert.match(preflight.body?.session?.signingKeyHash || '', /^[a-f0-9]{64}$/);
    assert.equal(preflight.body?.sessionStore?.type, 'wp-options');
    const session = preflight.body.session.id;
    summary.preflight = {
      status: preflight.status,
      ok: preflight.body.ok,
      requestPath: preflight.request.pathname,
      routeProfile: preflight.body.routeProfile,
      auth: {
        userLogin: preflight.body.auth.identity.userLogin,
        manageOptions: preflight.body.auth.identity.capabilities.manage_options,
        sessionType: preflight.body.auth.session.type,
        sessionStatus: preflight.body.auth.session.status,
      },
      session: {
        idPattern: '^[A-Za-z0-9_-]{32,160}$',
        sessionHashLength: String(preflight.body.session.sessionHash || '').length,
        signingKeyHashLength: String(preflight.body.session.signingKeyHash || '').length,
      },
      sessionStoreType: preflight.body.sessionStore.type,
    };

    const initial = await client.get('/snapshot');
    assert.equal(initial.status, 200, `production-shaped snapshot HTTP ${initial.status}`);
    assert.equal(initial.body?.ok, true);
    assert.equal(initial.request?.pathname, snapshotEndpointPath);
    assertVisibleSurfaceEqual(initial.body.snapshot, snapshots.base, 'production-shaped initial snapshot');

    const dryRun = await client.signedPost('/dry-run', { plan: readyPlan }, {
      session,
      idempotencyKey,
    });
    assert.equal(dryRun.status, 200, `production-shaped dry-run HTTP ${dryRun.status}`);
    assert.equal(dryRun.body?.ok, true, 'production-shaped dry-run must report ok');
    assert.equal(dryRun.body?.mode, 'dry-run');
    assert.equal(dryRun.request?.pathname, endpointPath);
    const receipt = dryRun.body?.receipt;
    assert.ok(receipt, 'production-shaped dry-run receipt missing');
    assert.equal(receipt.planHash, expectedPlanHash);
    assert.equal(receipt.authBinding?.schemaVersion, 1);
    assert.equal(receipt.authBinding?.scope, 'reprint-push-lab:authenticated-http-push');
    assert.equal(receipt.authBinding?.planHash, expectedPlanHash);
    assert.equal(receipt.authBinding?.plan?.planHash, expectedPlanHash);
    assert.equal(receipt.authBinding?.binding?.planHash, expectedPlanHash);
    assert.equal(receipt.authBinding?.request?.planHash, expectedPlanHash);
    assert.equal(receipt.authBinding?.request?.planPayloadHash, expectedPlanHash);
    assert.equal(receipt.authBinding?.request?.restNamespace, 'reprint/v1');
    assert.equal(receipt.authBinding?.request?.dryRunRoute, '/push/dry-run');
    assert.equal(receipt.authBinding?.request?.routeProfile, 'production-shaped');
    assert.equal(receipt.authBinding?.request?.labBacked, true);
    assert.equal(receipt.authBinding?.identity?.userLogin, credentials.username);
    assert.equal(receipt.authBinding?.identity?.capabilities?.manage_options, true);
    assert.equal(receipt.authBinding?.session?.id, session);
    assert.equal(receipt.authBinding?.session?.type, 'production-auth-session');
    assert.equal(receipt.authBinding?.session?.status, 'active');
    assert.equal(dryRun.body?.auth?.identity?.userLogin, credentials.username);
    assert.equal(dryRun.body?.auth?.session?.id, session);
    assert.equal(dryRun.body?.auth?.session?.type, 'production-auth-session');
    assert.equal(dryRun.body?.signedRequest?.sessionHash, receipt.authBinding.pushSession.sessionHash);
    assert.equal(dryRun.body?.signedRequest?.signingKeyHash, receipt.authBinding.pushSession.signingKeyHash);
    assert.equal(receipt.authBinding.binding.pushSessionHash, receipt.authBinding.pushSession.sessionHash);
    assert.match(receipt.authBinding.binding.scopeHash || '', /^[a-f0-9]{64}$/);
    assert.match(receipt.authBinding.binding.identityHash || '', /^[a-f0-9]{64}$/);
    assert.match(receipt.authBinding.binding.authSessionHash || '', /^[a-f0-9]{64}$/);
    assert.match(receipt.authBinding.binding.pushSessionHash || '', /^[a-f0-9]{64}$/);
    assert.match(receipt.authBinding.binding.bindingHash || '', /^[a-f0-9]{64}$/);
    assert.equal(
      receipt.authBinding.binding.bindingHash,
      digest(withoutKey(receipt.authBinding.binding, 'bindingHash')),
    );
    assert.equal(receipt.receiptHash, digest(withoutKey(receipt, 'receiptHash')));

    const after = await client.get('/snapshot');
    assert.equal(after.status, 200, `production-shaped post-dry-run snapshot HTTP ${after.status}`);
    assert.equal(after.body?.ok, true);
    assertVisibleSurfaceEqual(after.body.snapshot, snapshots.base, 'production-shaped dry-run must not mutate');

    summary.dryRun = {
      status: dryRun.status,
      ok: dryRun.body.ok,
      mode: dryRun.body.mode,
      requestPath: dryRun.request.pathname,
      receiptHashLength: String(receipt.receiptHash || '').length,
      planHashMatchesExpected: receipt.planHash === expectedPlanHash,
      authBinding: {
        scope: receipt.authBinding.scope,
        routeProfile: receipt.authBinding.request.routeProfile,
        restNamespace: receipt.authBinding.request.restNamespace,
        dryRunRoute: receipt.authBinding.request.dryRunRoute,
        labBacked: receipt.authBinding.request.labBacked,
        identity: {
          userLogin: receipt.authBinding.identity.userLogin,
          manageOptions: receipt.authBinding.identity.capabilities.manage_options,
        },
        session: {
          idPattern: '^[A-Za-z0-9_-]{32,160}$',
          idMatchesPreflight: receipt.authBinding.session.id === session,
          type: receipt.authBinding.session.type,
          status: receipt.authBinding.session.status,
        },
        binding: {
          scopeHashLength: String(receipt.authBinding.binding.scopeHash || '').length,
          identityHashLength: String(receipt.authBinding.binding.identityHash || '').length,
          authSessionHashLength: String(receipt.authBinding.binding.authSessionHash || '').length,
          pushSessionHashLength: String(receipt.authBinding.binding.pushSessionHash || '').length,
          planHashMatchesExpected: receipt.authBinding.binding.planHash === expectedPlanHash,
          bindingHashLength: String(receipt.authBinding.binding.bindingHash || '').length,
        },
      },
      signedRequest: {
        contentHashLength: String(dryRun.body.signedRequest.contentHash || '').length,
        sessionHashLength: String(dryRun.body.signedRequest.sessionHash || '').length,
        signingKeyHashLength: String(dryRun.body.signedRequest.signingKeyHash || '').length,
        idempotencyKeyHashLength: String(dryRun.body.signedRequest.request.idempotencyKeyHash || '').length,
      },
    };
    summary.after = {
      status: after.status,
      ok: after.body.ok,
      finalMatchesBase: true,
      visibleSurfaceDigest: digest(visibleSurface(after.body.snapshot)),
    };
    summary.ok = true;
  });
} catch (error) {
  summary.ok = false;
  summary.error = {
    name: error?.name || 'Error',
    message: error?.message || String(error),
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  if (summary.ok) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
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

async function withPlaygroundServer(name, sourceBlueprintPath, run) {
  const server = await startPlaygroundServer(name, sourceBlueprintPath);
  try {
    await run(server);
  } finally {
    await stopPlaygroundServer(server);
  }
}

async function startPlaygroundServer(name, sourceBlueprintPath) {
  const port = await findLocalPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logs = [];
  const child = spawn('npx', [
    '--yes',
    '@wp-playground/cli@latest',
    'server',
    '--blueprint',
    sourceBlueprintPath,
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
      const index = await requestJson(baseUrl, 'GET', '/wp-json/', undefined, {}, { attempts: 1 });
      if (index.status === 200 && index.body?.routes?.[routeIndexPath]) {
        return;
      }
      lastError = new Error(`REST index not ready; HTTP ${index.status}`);
    } catch (error) {
      lastError = error;
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for Playground server at local loopback: ${lastError?.message || 'unknown'}\n${logs.join('')}`);
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
  const maxAttempts = method === 'GET' ? attempts : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await requestJsonOnce(baseUrl, method, pathname, body, headers);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts || !isTransientFetchError(error)) {
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

function assertRoute(body, route, method) {
  const routeEntry = body?.routes?.[route];
  assert.ok(routeEntry, `REST index missing ${route}`);
  assert.ok(routeMethods(routeEntry).includes(method), `REST index route ${route} missing ${method}`);
}

function routeMethods(routeEntry) {
  return Array.isArray(routeEntry?.methods) ? routeEntry.methods.map(String) : [];
}

function authHeaders(credential) {
  return {
    authorization: `Basic ${Buffer.from(`${credential.username}:${credential.password}`, 'utf8').toString('base64')}`,
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

function withoutUnmappedGraphPostmeta(snapshot) {
  const next = JSON.parse(JSON.stringify(snapshot));
  delete next.db?.wp_postmeta?.['post_id:2001:meta_key:_reprint_push_forms_schema'];
  if (next.db?.wp_postmeta && Object.keys(next.db.wp_postmeta).length === 0) {
    delete next.db.wp_postmeta;
  }
  return next;
}

function withoutKey(value, key) {
  const next = JSON.parse(JSON.stringify(value));
  delete next[key];
  return next;
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
