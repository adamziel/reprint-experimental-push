#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticatedHttpClient } from '../../src/authenticated-http-push-client.js';
import { digest } from '../../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const muPluginDir = path.join(repoRoot, 'scripts/playground/rest-mu-plugins');
const blueprintPath = path.join(repoRoot, 'fixtures/playground/remote-base.blueprint.json');
const serverStartupTimeoutMs = Number(process.env.REPRINT_PUSH_SNAPSHOT_HASHES_ROUTE_LIVE_TIMEOUT_MS || 120_000);
const transientFetchRetryDelayMs = 250;
const transientFetchAttempts = 4;
const endpointPath = '/wp-json/reprint/v1/push/snapshot-hashes';
const routeIndexPath = '/reprint/v1/push/snapshot-hashes';
const invalidSnapshotPayload = {
  scope: 'would-fail-if-json-parsed',
  batch_size: 1,
};
const snapshotHashesPayload = {
  scope: {
    files: [],
    tables: [],
    plugins: true,
  },
  batch_size: 1000,
};
const credentials = {
  username: 'reprint_push_admin',
  password: 'reprint-push-admin-app-password',
};

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
  unauthenticated: {},
  unsigned: {},
  invalidSession: {},
  surface: {},
  preflight: {},
  snapshotHashes: {},
};

try {
  await withPlaygroundServer('rpp-0522-production-snapshot-hashes', blueprintPath, async (server) => {
    summary.liveUrl.port = server.port;

    const index = await requestJson(server.baseUrl, 'GET', '/wp-json/');
    assert.equal(index.status, 200, `REST index HTTP ${index.status}`);
    assertRoute(index.body, routeIndexPath, 'POST');
    summary.routeIndex = {
      namespacePresent: Array.isArray(index.body.namespaces) && index.body.namespaces.includes('reprint/v1'),
      routePresent: Boolean(index.body.routes?.[routeIndexPath]),
      methods: routeMethods(index.body.routes?.[routeIndexPath]),
    };

    const client = authenticatedHttpClient({
      sourceUrl: server.baseUrl,
      credential: credentials,
      routeProfile: 'production-shaped',
      requestTimeoutMs: 30_000,
    });

    const beforeNegativeSnapshot = await client.get('/snapshot');
    assert.equal(beforeNegativeSnapshot.status, 200, `initial production snapshot HTTP ${beforeNegativeSnapshot.status}`);
    assert.equal(beforeNegativeSnapshot.body?.ok, true, 'initial production snapshot must report ok');
    const snapshotHashBeforeNegative = routeMutationSurfaceHash(beforeNegativeSnapshot.body.snapshot);
    summary.surface.beforeNegativeHashLength = snapshotHashBeforeNegative.length;

    const unauthenticated = await requestJson(
      server.baseUrl,
      'POST',
      endpointPath,
      invalidSnapshotPayload,
    );
    assert.equal(unauthenticated.status, 401, `unauthenticated production snapshot hashes HTTP ${unauthenticated.status}`);
    assert.equal(unauthenticated.body?.code, 'reprint_push_lab_auth_required');
    assertNoSnapshotHashEvidence(unauthenticated);
    summary.unauthenticated = summarizeNegativeAuth(unauthenticated);

    const unsigned = await requestJson(
      server.baseUrl,
      'POST',
      endpointPath,
      invalidSnapshotPayload,
      authHeaders(credentials),
    );
    assert.equal(unsigned.status, 401, `unsigned production snapshot hashes HTTP ${unsigned.status}`);
    assert.equal(unsigned.body?.code, 'SIGNED_HEADER_REQUIRED');
    assert.equal(unsigned.body?.mode, 'snapshot-hashes');
    assertNoSnapshotHashEvidence(unsigned);
    summary.unsigned = summarizeNegativeAuth(unsigned);

    const invalidSession = await client.signedPost('/snapshot-hashes', invalidSnapshotPayload, {
      session: 'psh_rpp_0522_missing_session_00000001',
      idempotencyKey: 'rpp-0522-invalid-session',
    });
    assert.equal(invalidSession.status, 401, `invalid-session production snapshot hashes HTTP ${invalidSession.status}`);
    assert.equal(invalidSession.body?.code, 'SIGNED_SESSION_INVALID');
    assert.equal(invalidSession.body?.mode, 'snapshot-hashes');
    assertNoSnapshotHashEvidence(invalidSession);
    summary.invalidSession = summarizeNegativeAuth(invalidSession);

    const afterNegativeSnapshot = await client.get('/snapshot');
    assert.equal(afterNegativeSnapshot.status, 200, `post-negative production snapshot HTTP ${afterNegativeSnapshot.status}`);
    assert.equal(afterNegativeSnapshot.body?.ok, true, 'post-negative production snapshot must report ok');
    const snapshotHashAfterNegative = routeMutationSurfaceHash(afterNegativeSnapshot.body.snapshot);
    assert.equal(snapshotHashBeforeNegative, snapshotHashAfterNegative, 'negative snapshot hashes auth cases must not mutate');
    summary.surface.afterNegativeHashLength = snapshotHashAfterNegative.length;
    summary.surface.negativeMutated = snapshotHashBeforeNegative !== snapshotHashAfterNegative;

    const preflight = await client.signedGet('/preflight');
    assert.equal(preflight.status, 200, `production-shaped preflight HTTP ${preflight.status}`);
    assert.equal(preflight.body?.ok, true, 'production-shaped preflight must report ok');
    assert.equal(preflight.body?.routeProfile?.profile, 'production-shaped');
    assert.equal(preflight.body?.routeProfile?.restNamespace, 'reprint/v1');
    assert.equal(preflight.body?.routeProfile?.routePrefix, '/push');
    assert.equal(preflight.body?.auth?.session?.type, 'production-auth-session');
    assert.equal(preflight.body?.auth?.session?.status, 'active');
    assert.match(preflight.body?.session?.id || '', /^[A-Za-z0-9_-]{32,160}$/);
    const session = preflight.body.session.id;
    summary.preflight = {
      status: preflight.status,
      ok: preflight.body.ok,
      sessionType: preflight.body.auth.session.type,
      sessionStatus: preflight.body.auth.session.status,
      sessionIdPattern: '^[A-Za-z0-9_-]{32,160}$',
      sessionHashLength: String(preflight.body.session.sessionHash || '').length,
      signingKeyHashLength: String(preflight.body.session.signingKeyHash || '').length,
    };

    const snapshotHashes = await client.signedPost('/snapshot-hashes', snapshotHashesPayload, {
      session,
      idempotencyKey: 'rpp-0522-production-snapshot-hashes-route',
    });
    assert.equal(snapshotHashes.status, 200, `production-shaped snapshot hashes HTTP ${snapshotHashes.status}`);
    assert.equal(snapshotHashes.body?.ok, true, 'production-shaped snapshot hashes must report ok');
    assert.equal(snapshotHashes.body?.mode, 'snapshot-hashes');
    assert.equal(snapshotHashes.request?.pathname, endpointPath);
    assert.match(snapshotHashes.body?.snapshotId || '', /^snap_[a-f0-9]{32}$/);
    assert.match(snapshotHashes.body?.snapshotHash || '', /^sha256:[a-f0-9]{64}$/);
    assert.match(snapshotHashes.body?.snapshotHashSetHash || '', /^sha256:[a-f0-9]{64}$/);
    assert.match(snapshotHashes.body?.coverage?.coverage_hash || '', /^sha256:[a-f0-9]{64}$/);
    assert.match(snapshotHashes.body?.pageHash || '', /^sha256:[a-f0-9]{64}$/);
    assert.ok(Array.isArray(snapshotHashes.body?.resources), 'snapshot hashes resources must be listed');
    assert.ok(snapshotHashes.body.resources.length > 0, 'snapshot hashes resources must include the live comparison set');
    assert.equal(snapshotHashes.body?.planningOnly?.readOnly, true);
    assert.equal(snapshotHashes.body?.planningOnly?.mutates, false);
    assert.equal(snapshotHashes.body?.auth?.session?.type, 'production-auth-session');
    assert.equal(snapshotHashes.body?.auth?.session?.status, 'active');
    assert.equal(snapshotHashes.body?.auth?.session?.id, session);
    assert.equal(snapshotHashes.body?.sessionStore?.type, 'wp-options');

    const receipt = snapshotHashes.body.receipt || {};
    assert.equal(receipt.type, 'snapshot-hashes');
    assert.equal(receipt.routeProfile, 'production-shaped');
    assert.equal(receipt.restNamespace, 'reprint/v1');
    assert.equal(receipt.route, '/push/snapshot-hashes');
    assert.match(receipt.receiptHash || '', /^sha256:[a-f0-9]{64}$/);
    assert.equal(receipt.planningOnly?.readOnly, true);
    assert.equal(receipt.planningOnly?.mutates, false);
    assert.match(receipt.authBinding?.identityHash || '', /^[a-f0-9]{64}$/);
    assert.match(receipt.authBinding?.sessionHash || '', /^[a-f0-9]{64}$/);
    assert.match(receipt.authBinding?.signingKeyHash || '', /^[a-f0-9]{64}$/);
    assert.match(receipt.request?.idempotencyKeyHash || '', /^[a-f0-9]{64}$/);
    assert.equal(receipt.authBinding.sessionHash, snapshotHashes.body.signedRequest.sessionHash);
    assert.equal(receipt.authBinding.signingKeyHash, snapshotHashes.body.signedRequest.signingKeyHash);
    assert.equal(receipt.request.idempotencyKeyHash, snapshotHashes.body.signedRequest.request.idempotencyKeyHash);

    summary.snapshotHashes = {
      status: snapshotHashes.status,
      ok: snapshotHashes.body.ok,
      requestPath: snapshotHashes.request.pathname,
      mode: snapshotHashes.body.mode,
      snapshotIdPattern: '^snap_[a-f0-9]{32}$',
      snapshotHashLength: String(snapshotHashes.body.snapshotHash || '').length,
      snapshotHashSetHashLength: String(snapshotHashes.body.snapshotHashSetHash || '').length,
      coverageHashLength: String(snapshotHashes.body.coverage.coverage_hash || '').length,
      pageHashLength: String(snapshotHashes.body.pageHash || '').length,
      resourceCount: snapshotHashes.body.coverage.resource_count,
      pageResourceCount: snapshotHashes.body.resources.length,
      planningOnly: {
        readOnly: snapshotHashes.body.planningOnly.readOnly,
        mutates: snapshotHashes.body.planningOnly.mutates,
      },
      receipt: {
        type: receipt.type,
        routeProfile: receipt.routeProfile,
        restNamespace: receipt.restNamespace,
        route: receipt.route,
        receiptHashLength: String(receipt.receiptHash || '').length,
        identityHashLength: String(receipt.authBinding.identityHash || '').length,
        sessionHashLength: String(receipt.authBinding.sessionHash || '').length,
        signingKeyHashLength: String(receipt.authBinding.signingKeyHash || '').length,
        idempotencyKeyHashLength: String(receipt.request.idempotencyKeyHash || '').length,
      },
      signedRequest: {
        sessionHashLength: String(snapshotHashes.body.signedRequest.sessionHash || '').length,
        signingKeyHashLength: String(snapshotHashes.body.signedRequest.signingKeyHash || '').length,
        canonicalHashLength: String(snapshotHashes.body.signedRequest.request.canonicalHash || '').length,
        idempotencyKeyHashLength: String(snapshotHashes.body.signedRequest.request.idempotencyKeyHash || '').length,
      },
      auth: {
        userLogin: snapshotHashes.body.auth.identity.userLogin,
        manageOptions: snapshotHashes.body.auth.identity.capabilities.manage_options,
        sessionType: snapshotHashes.body.auth.session.type,
        sessionStatus: snapshotHashes.body.auth.session.status,
      },
      sessionStore: {
        type: snapshotHashes.body.sessionStore.type,
        retention: snapshotHashes.body.sessionStore.retention,
      },
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

function assertNoSnapshotHashEvidence(response) {
  assert.equal(hasSnapshotHashEvidence(response), false, `negative auth response leaked snapshot hash evidence for ${response.body?.code}`);
  assert.notEqual(response.body?.code, 'INVALID_ARGUMENT', 'negative auth must fail before snapshot payload validation');
}

function hasSnapshotHashEvidence(response) {
  const body = response?.body || {};
  return Boolean(
    body.snapshotHash
    || body.snapshotHashSetHash
    || body.pageHash
    || body.receipt?.type === 'snapshot-hashes'
    || Array.isArray(body.resources)
  );
}

function summarizeNegativeAuth(response) {
  return {
    status: response.status,
    code: response.body?.code || null,
    mode: response.body?.mode || null,
    payloadWouldFailIfParsed: true,
    invalidArgument: response.body?.code === 'INVALID_ARGUMENT',
    snapshotHashEvidence: hasSnapshotHashEvidence(response),
  };
}

function routeMutationSurfaceHash(snapshot) {
  return digest(routeMutationSurface(snapshot));
}

function routeMutationSurface(snapshot) {
  const surface = JSON.parse(JSON.stringify({
    files: snapshot?.files || {},
    db: snapshot?.db || {},
    plugins: snapshot?.plugins || {},
  }));

  for (const [table, rows] of Object.entries(surface.db)) {
    if (!rows || typeof rows !== 'object') {
      continue;
    }
    for (const [key, row] of Object.entries(rows)) {
      if (isAuthRuntimeRow(table, key, row)) {
        delete rows[key];
      }
    }
    if (Object.keys(rows).length === 0) {
      delete surface.db[table];
    }
  }

  return surface;
}

function isAuthRuntimeRow(table, key, row) {
  const rowText = `${table}\n${key}\n${JSON.stringify(row)}`;
  return rowText.includes('reprint_push_lab_signed_session_')
    || rowText.includes('reprint_push_lab_signed_nonce_')
    || rowText.includes('application_passwords_in_use')
    || (String(table).endsWith('usermeta') && rowText.includes('_application_passwords'));
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
