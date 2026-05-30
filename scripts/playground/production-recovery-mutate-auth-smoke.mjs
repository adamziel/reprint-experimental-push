#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const muPluginDir = path.join(repoRoot, 'scripts/playground/rest-mu-plugins');
const blueprintPath = path.join(repoRoot, 'fixtures/playground/remote-base.blueprint.json');
const serverStartupTimeoutMs = Number(process.env.REPRINT_PUSH_RECOVERY_MUTATE_AUTH_SMOKE_TIMEOUT_MS || 120_000);
const transientFetchRetryDelayMs = 250;
const transientFetchAttempts = 4;
const endpointPath = '/wp-json/reprint/v1/push/recovery/mutate';
const routeIndexPath = '/reprint/v1/push/recovery/mutate';
const snapshotPath = '/wp-json/reprint-push-lab/v1/snapshot';
const dbJournalPath = '/wp-json/reprint-push-lab/v1/db-journal?limit=80';
const malformedJsonBody = '{"plan":';
const malformedJsonBodyContentType = 'text/plain';
const credentials = {
  username: 'reprint_push_admin',
  password: 'reprint-push-admin-app-password',
};

const summary = {
  ok: false,
  proof: 'RPP-0527 production recovery mutate negative auth proof',
  routeProfile: 'production-shaped',
  endpoint: endpointPath,
  malformedJsonBodyHash: sha256Hex(malformedJsonBody),
  malformedJsonBodyContentType,
  liveUrl: {
    scheme: 'http',
    host: '127.0.0.1',
    port: 'ephemeral',
    exposure: 'sandbox-local-loopback-only',
    tunnel: 'none',
  },
  routeIndex: {},
  negativeCases: {},
  mutation: {},
};

try {
  await withPlaygroundServer('rpp-0527-production-recovery-mutate-auth', blueprintPath, async (server) => {
    summary.liveUrl.port = server.port;

    const index = await requestJson(server.baseUrl, 'GET', '/wp-json/');
    assert.equal(index.status, 200, `REST index HTTP ${index.status}`);
    assertRoute(index.body, routeIndexPath, 'POST');
    summary.routeIndex = {
      namespacePresent: Array.isArray(index.body.namespaces) && index.body.namespaces.includes('reprint/v1'),
      routePresent: Boolean(index.body.routes?.[routeIndexPath]),
      methods: routeMethods(index.body.routes?.[routeIndexPath]),
    };

    const beforeSnapshot = await requestJson(server.baseUrl, 'GET', snapshotPath);
    assert.equal(beforeSnapshot.status, 200, `before snapshot HTTP ${beforeSnapshot.status}`);
    const beforeJournal = await requestJson(server.baseUrl, 'GET', dbJournalPath);
    assert.equal(beforeJournal.status, 200, `before journal HTTP ${beforeJournal.status}`);

    const unauthenticated = await requestRawJson(server.baseUrl, 'POST', endpointPath, malformedJsonBody);
    assert.equal(unauthenticated.status, 401, `unauthenticated recovery mutate HTTP ${unauthenticated.status}`);
    assert.equal(unauthenticated.body?.code, 'reprint_push_lab_auth_required');
    assertNotJsonParseFailure(unauthenticated, 'unauthenticated recovery mutate');
    summary.negativeCases.unauthenticated = summarizeNegativeCase(unauthenticated);

    const missingSignedHeaders = await requestRawJson(
      server.baseUrl,
      'POST',
      endpointPath,
      malformedJsonBody,
      authHeaders(credentials),
    );
    assert.equal(missingSignedHeaders.status, 401, `unsigned recovery mutate HTTP ${missingSignedHeaders.status}`);
    assert.equal(missingSignedHeaders.body?.code, 'SIGNED_HEADER_REQUIRED');
    assertNotJsonParseFailure(missingSignedHeaders, 'unsigned recovery mutate');
    summary.negativeCases.missingSignedHeaders = summarizeNegativeCase(missingSignedHeaders);

    const contentHashMismatch = await requestRawJson(
      server.baseUrl,
      'POST',
      endpointPath,
      malformedJsonBody,
      contentHashMismatchHeaders(credentials),
    );
    assert.equal(contentHashMismatch.status, 401, `content-hash mismatch recovery mutate HTTP ${contentHashMismatch.status}`);
    assert.equal(contentHashMismatch.body?.code, 'SIGNED_CONTENT_HASH_MISMATCH');
    assertNotJsonParseFailure(contentHashMismatch, 'content-hash mismatch recovery mutate');
    summary.negativeCases.contentHashMismatch = summarizeNegativeCase(contentHashMismatch);

    const authSignatureMismatch = await requestRawJson(
      server.baseUrl,
      'POST',
      endpointPath,
      malformedJsonBody,
      authSignatureMismatchHeaders(credentials, malformedJsonBody),
    );
    assert.equal(authSignatureMismatch.status, 401, `auth-signature mismatch recovery mutate HTTP ${authSignatureMismatch.status}`);
    assert.equal(authSignatureMismatch.body?.code, 'SIGNED_AUTH_SIGNATURE_MISMATCH');
    assertNotJsonParseFailure(authSignatureMismatch, 'auth-signature mismatch recovery mutate');
    summary.negativeCases.authSignatureMismatch = summarizeNegativeCase(authSignatureMismatch);

    const afterSnapshot = await requestJson(server.baseUrl, 'GET', snapshotPath);
    assert.equal(afterSnapshot.status, 200, `after snapshot HTTP ${afterSnapshot.status}`);
    const afterJournal = await requestJson(server.baseUrl, 'GET', dbJournalPath);
    assert.equal(afterJournal.status, 200, `after journal HTTP ${afterJournal.status}`);

    assertTargetSurfaceEqual(
      afterSnapshot.body?.snapshot,
      beforeSnapshot.body?.snapshot,
      'negative recovery mutate auth cases',
    );
    assert.equal(
      afterJournal.body?.dbJournal?.rowCount,
      beforeJournal.body?.dbJournal?.rowCount,
      'negative recovery mutate auth cases must not append DB journal rows',
    );

    const beforeTargetSurfaceHash = digest(targetSurface(beforeSnapshot.body?.snapshot));
    const afterTargetSurfaceHash = digest(targetSurface(afterSnapshot.body?.snapshot));
    summary.mutation = {
      targetSurfaceStable: true,
      targetSurfaceHashBefore: beforeTargetSurfaceHash,
      targetSurfaceHashAfter: afterTargetSurfaceHash,
      dbJournalRowsBefore: beforeJournal.body?.dbJournal?.rowCount ?? null,
      dbJournalRowsAfter: afterJournal.body?.dbJournal?.rowCount ?? null,
      mutationAttempted: false,
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
  const rawBody = body === undefined ? undefined : JSON.stringify(body);
  return requestRawJson(baseUrl, method, pathname, rawBody, headers, { attempts });
}

async function requestRawJson(baseUrl, method, pathname, rawBody = undefined, headers = {}, { attempts = transientFetchAttempts } = {}) {
  let lastError;
  const maxAttempts = method === 'GET' ? attempts : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await requestRawJsonOnce(baseUrl, method, pathname, rawBody, headers);
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

async function requestRawJsonOnce(baseUrl, method, pathname, rawBody = undefined, headers = {}) {
  const requestHeaders = rawBody === undefined ? {
    connection: 'close',
    ...headers,
  } : {
    // Deliberately do not mark this malformed JSON-shaped body as application/json:
    // WordPress core rejects invalid JSON before route permission callbacks run.
    // RPP-0527 needs to prove the recovery mutate route auth floor itself returns
    // before the route JSON payload parser and mutation path can run.
    'content-type': malformedJsonBodyContentType,
    connection: 'close',
    ...headers,
  };

  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: requestHeaders,
    body: rawBody,
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

function assertNotJsonParseFailure(response, label) {
  assert.notEqual(response.body?.code, 'rest_invalid_json', `${label} parsed malformed JSON before auth failed`);
  assert.notEqual(response.body?.code, 'INVALID_ARGUMENT', `${label} reached route JSON payload validation`);
  assert.doesNotMatch(String(response.body?.message || ''), /Request body must be a JSON object|JSON parse error/i);
}

function summarizeNegativeCase(response) {
  return {
    status: response.status,
    code: response.body?.code || null,
    ok: response.body?.ok === true,
    jsonParsed: false,
  };
}

function authHeaders(credential) {
  return {
    authorization: `Basic ${Buffer.from(`${credential.username}:${credential.password}`, 'utf8').toString('base64')}`,
  };
}

function contentHashMismatchHeaders(credential) {
  return {
    ...authHeaders(credential),
    'x-auth-content-hash': '0'.repeat(64),
    'x-auth-timestamp': currentSignedTimestamp(),
    'x-auth-nonce': opaqueNonce('content-hash'),
    'x-auth-signature': '0'.repeat(64),
    'x-reprint-push-signature': '0'.repeat(64),
    'x-reprint-push-session': 'psh_rpp052700000000000000000000',
    'x-reprint-push-idempotency-key': opaqueNonce('idem-content-hash'),
  };
}

function authSignatureMismatchHeaders(credential, rawBody) {
  return {
    ...authHeaders(credential),
    'x-auth-content-hash': sha256Hex(rawBody),
    'x-auth-timestamp': currentSignedTimestamp(),
    'x-auth-nonce': opaqueNonce('auth-signature'),
    'x-auth-signature': '0'.repeat(64),
    'x-reprint-push-signature': '0'.repeat(64),
    'x-reprint-push-session': 'psh_rpp052700000000000000000000',
    'x-reprint-push-idempotency-key': opaqueNonce('idem-auth-signature'),
  };
}

function assertTargetSurfaceEqual(actual, expected, label) {
  assert.deepEqual(targetSurface(actual), targetSurface(expected), `${label} target surface mismatch`);
  assert.equal(digest(targetSurface(actual)), digest(targetSurface(expected)), `${label} target surface hash mismatch`);
}

function targetSurface(snapshot) {
  return {
    files: snapshot?.files || {},
    plugins: snapshot?.plugins || {},
    db: snapshot?.db || {},
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

function currentSignedTimestamp() {
  return String(Math.floor(Date.now() / 1000));
}

function opaqueNonce(prefix) {
  return `${prefix}-${Date.now()}-${process.pid}`;
}

function digest(value) {
  return sha256Hex(stableJson(value));
}

function sha256Hex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
