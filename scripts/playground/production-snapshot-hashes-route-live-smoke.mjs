#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticatedHttpClient } from '../../src/authenticated-http-push-client.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const muPluginDir = path.join(repoRoot, 'scripts/playground/rest-mu-plugins');
const blueprintPath = path.join(repoRoot, 'fixtures/playground/remote-base.blueprint.json');
const serverStartupTimeoutMs = Number(process.env.REPRINT_PUSH_SNAPSHOT_HASHES_ROUTE_LIVE_TIMEOUT_MS || 120_000);
const transientFetchRetryDelayMs = 250;
const transientFetchAttempts = 4;
const endpointPath = '/wp-json/reprint/v1/push/snapshot-hashes';
const routeIndexPath = '/reprint/v1/push/snapshot-hashes';
const preflightPath = '/wp-json/reprint/v1/push/preflight';
const labJournalPath = '/wp-json/reprint-push-lab/v1/journal?limit=80';
const malformedJsonBody = '{"scope":';
const credentials = {
  username: 'reprint_push_admin',
  password: 'reprint-push-admin-app-password',
};

const summary = {
  ok: false,
  evidence: {
    rpp: 'RPP-0522',
    classification: 'local-lab-backed',
    productionUrlSupplied: false,
    caveat: 'Sandbox-local WordPress Playground proof; not production-backed evidence.',
  },
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
  negativeCases: [],
  mutationGuard: {},
  snapshotHashes: {},
};

try {
  await withPlaygroundServer('rpp-0522-production-snapshot-hashes', blueprintPath, async (server) => {
    summary.liveUrl.port = server.port;

    const index = await requestJson(server.baseUrl, 'GET', '/wp-json/');
    assert.equal(index.status, 200, `REST index HTTP ${index.status}`);
    assertRoute(index.body, routeIndexPath, 'POST');
    assertRoute(index.body, '/reprint/v1/push/preflight', 'GET');
    summary.routeIndex = {
      namespacePresent: Array.isArray(index.body.namespaces) && index.body.namespaces.includes('reprint/v1'),
      routePresent: Boolean(index.body.routes?.[routeIndexPath]),
      methods: routeMethods(index.body.routes?.[routeIndexPath]),
    };

    const beforeJournal = await requestJson(server.baseUrl, 'GET', labJournalPath);
    assert.equal(beforeJournal.status, 200, `before journal HTTP ${beforeJournal.status}`);
    const beforeJournalFingerprint = journalFingerprint(beforeJournal.body?.journal);

    for (const negativeCase of negativeCaseDefinitions()) {
      const result = await requestRawJson(
        server.baseUrl,
        'POST',
        endpointPath,
        malformedJsonBody,
        negativeCase.headers,
      );
      assert.equal(result.status, negativeCase.expectedStatus, `${negativeCase.name} HTTP ${result.status}`);
      assert.equal(result.body?.code, negativeCase.expectedCode, `${negativeCase.name} code`);
      assertMalformedJsonWasNotParsed(result.body, negativeCase.name);
      assertNoSnapshotHashPayload(result.body, negativeCase.name);

      summary.negativeCases.push({
        name: negativeCase.name,
        status: result.status,
        code: result.body?.code || null,
        malformedJsonParsed: false,
        routePayloadBuilt: false,
      });
    }

    const afterNegativeJournal = await requestJson(server.baseUrl, 'GET', labJournalPath);
    assert.equal(afterNegativeJournal.status, 200, `after negative journal HTTP ${afterNegativeJournal.status}`);
    const afterNegativeJournalFingerprint = journalFingerprint(afterNegativeJournal.body?.journal);
    assert.equal(afterNegativeJournalFingerprint, beforeJournalFingerprint, 'negative cases must not append protocol journal entries');

    const client = authenticatedHttpClient({
      sourceUrl: server.baseUrl,
      credential: credentials,
      routeProfile: 'production-shaped',
      requestTimeoutMs: 30_000,
    });
    const preflight = await client.signedGet('/preflight');
    assert.equal(preflight.status, 200, `production-shaped preflight HTTP ${preflight.status}`);
    assert.equal(preflight.body?.ok, true, 'production-shaped preflight must report ok');
    assert.equal(preflight.body?.mode, 'preflight');
    assert.equal(preflight.request?.pathname, preflightPath);
    assert.equal(preflight.body?.routeProfile?.profile, 'production-shaped');
    assert.equal(preflight.body?.routeProfile?.labBacked, true);
    const session = preflight.body?.session?.id;
    assert.match(session || '', /^[A-Za-z0-9_-]{32,160}$/);

    const snapshotHashes = await client.signedPost('/snapshot-hashes', {
      scope: {
        plugins: true,
      },
      batch_size: 1000,
    }, {
      session,
      idempotencyKey: 'rpp-0522-production-snapshot-hashes-local-proof',
    });
    assert.equal(snapshotHashes.status, 200, `production-shaped snapshot hashes HTTP ${snapshotHashes.status}`);
    assert.equal(snapshotHashes.body?.ok, true, 'snapshot hashes must report ok');
    assert.equal(snapshotHashes.body?.mode, 'snapshot-hashes');
    assert.equal(snapshotHashes.request?.pathname, endpointPath);
    assert.equal(snapshotHashes.body?.lab?.scope, 'local Playground fixture only');
    assert.equal(
      snapshotHashes.body?.lab?.permission,
      'lab-backed route; production-shaped aliases still use local Playground fixture auth',
    );
    assert.equal(snapshotHashes.body?.receipt?.routeProfile, 'production-shaped');
    assert.equal(snapshotHashes.body?.receipt?.restNamespace, 'reprint/v1');
    assert.equal(snapshotHashes.body?.receipt?.route, '/push/snapshot-hashes');
    assert.equal(snapshotHashes.body?.receipt?.planningOnly?.mutates, false);
    assert.equal(snapshotHashes.body?.planningOnly?.mutates, false);
    assert.equal(snapshotHashes.body?.auth?.session?.type, 'production-auth-session');
    assert.equal(snapshotHashes.body?.auth?.identity?.userLogin, credentials.username);
    assert.equal(snapshotHashes.body?.auth?.identity?.capabilities?.manage_options, true);
    assert.match(snapshotHashes.body?.snapshotHash || '', /^sha256:[a-f0-9]{64}$/);
    assert.match(snapshotHashes.body?.snapshotHashSetHash || '', /^sha256:[a-f0-9]{64}$/);
    assert.match(snapshotHashes.body?.pageHash || '', /^sha256:[a-f0-9]{64}$/);
    assert.ok(Number.isInteger(snapshotHashes.body?.coverage?.resource_count));
    assert.ok(Array.isArray(snapshotHashes.body?.resources));

    const afterSnapshotHashesJournal = await requestJson(server.baseUrl, 'GET', labJournalPath);
    assert.equal(afterSnapshotHashesJournal.status, 200, `after snapshot hashes journal HTTP ${afterSnapshotHashesJournal.status}`);
    const afterSnapshotHashesJournalFingerprint = journalFingerprint(afterSnapshotHashesJournal.body?.journal);
    assert.equal(afterSnapshotHashesJournalFingerprint, beforeJournalFingerprint, 'snapshot-hashes route must not append protocol journal entries');

    summary.mutationGuard = {
      surface: 'reprint_push_protocol_journal',
      beforeNextSequence: beforeJournal.body?.journal?.nextSequence ?? null,
      afterNegativeNextSequence: afterNegativeJournal.body?.journal?.nextSequence ?? null,
      afterSnapshotHashesNextSequence: afterSnapshotHashesJournal.body?.journal?.nextSequence ?? null,
      negativeCasesJournalUnchanged: afterNegativeJournalFingerprint === beforeJournalFingerprint,
      snapshotHashesJournalUnchanged: afterSnapshotHashesJournalFingerprint === beforeJournalFingerprint,
    };
    summary.snapshotHashes = {
      status: snapshotHashes.status,
      ok: snapshotHashes.body.ok,
      requestPath: snapshotHashes.request.pathname,
      lab: snapshotHashes.body.lab,
      receipt: {
        routeProfile: snapshotHashes.body.receipt.routeProfile,
        restNamespace: snapshotHashes.body.receipt.restNamespace,
        route: snapshotHashes.body.receipt.route,
        planningOnlyMutates: snapshotHashes.body.receipt.planningOnly.mutates,
      },
      auth: {
        userLogin: snapshotHashes.body.auth.identity.userLogin,
        manageOptions: snapshotHashes.body.auth.identity.capabilities.manage_options,
        sessionType: snapshotHashes.body.auth.session.type,
        sessionStatus: snapshotHashes.body.auth.session.status,
      },
      hashes: {
        snapshotHashPattern: '^sha256:[a-f0-9]{64}$',
        snapshotHashSetHashPattern: '^sha256:[a-f0-9]{64}$',
        pageHashPattern: '^sha256:[a-f0-9]{64}$',
        resourceCount: snapshotHashes.body.coverage.resource_count,
        pageResourceCount: snapshotHashes.body.resources.length,
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

function negativeCaseDefinitions() {
  const validContentHash = sha256(malformedJsonBody);
  return [
    {
      name: 'missing-basic-auth-malformed-json',
      expectedStatus: 401,
      expectedCode: 'reprint_push_lab_auth_required',
      headers: {
        'content-type': 'application/json',
      },
    },
    {
      name: 'wrong-basic-auth-malformed-json',
      expectedStatus: 401,
      expectedCode: 'reprint_push_lab_auth_required',
      headers: {
        'content-type': 'application/json',
        ...authHeaders({ username: credentials.username, password: 'not-the-lab-application-password' }),
      },
    },
    {
      name: 'valid-auth-missing-signature-headers-malformed-json',
      expectedStatus: 401,
      expectedCode: 'SIGNED_HEADER_REQUIRED',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(credentials),
      },
    },
    {
      name: 'valid-auth-missing-session-malformed-json',
      expectedStatus: 401,
      expectedCode: 'SIGNED_SESSION_REQUIRED',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(credentials),
        ...unsignedSnapshotHashHeaders({
          nonce: 'rpp0522missing-session',
          contentHash: validContentHash,
        }),
      },
    },
    {
      name: 'valid-auth-content-hash-mismatch-malformed-json',
      expectedStatus: 401,
      expectedCode: 'SIGNED_CONTENT_HASH_MISMATCH',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(credentials),
        ...unsignedSnapshotHashHeaders({
          nonce: 'rpp0522content-mismatch',
          contentHash: '0'.repeat(64),
          session: 'psh_rpp0522negativecontenthash000000000000000000',
          idempotencyKey: 'rpp-0522-content-hash-mismatch',
        }),
      },
    },
    {
      name: 'valid-auth-auth-signature-mismatch-malformed-json',
      expectedStatus: 401,
      expectedCode: 'SIGNED_AUTH_SIGNATURE_MISMATCH',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(credentials),
        ...unsignedSnapshotHashHeaders({
          nonce: 'rpp0522authsig-mismatch',
          contentHash: validContentHash,
          session: 'psh_rpp0522negativeauthsig00000000000000000000',
          idempotencyKey: 'rpp-0522-auth-signature-mismatch',
        }),
      },
    },
  ];
}

function unsignedSnapshotHashHeaders({ nonce, contentHash, session = '', idempotencyKey = '' }) {
  return {
    'X-Auth-Content-Hash': contentHash,
    'X-Auth-Timestamp': String(Math.floor(Date.now() / 1000)),
    'X-Auth-Nonce': nonce,
    'X-Auth-Signature': 'a'.repeat(64),
    'X-Reprint-Push-Signature': 'b'.repeat(64),
    ...(session !== '' ? { 'X-Reprint-Push-Session': session } : {}),
    ...(idempotencyKey !== '' ? { 'X-Reprint-Push-Idempotency-Key': idempotencyKey } : {}),
  };
}

function assertMalformedJsonWasNotParsed(body, caseName) {
  assert.notEqual(body?.code, 'INVALID_ARGUMENT', `${caseName} parsed route JSON`);
  assert.notEqual(body?.code, 'rest_invalid_json', `${caseName} parsed malformed REST JSON`);
  assert.doesNotMatch(
    JSON.stringify(body),
    /Request body must be a JSON object|Invalid JSON|rest_invalid_json/i,
    `${caseName} should fail before JSON parsing`,
  );
}

function assertNoSnapshotHashPayload(body, caseName) {
  for (const field of ['snapshotHash', 'snapshotHashSetHash', 'resources', 'receipt', 'coverage', 'pageHash']) {
    assert.equal(Object.hasOwn(body || {}, field), false, `${caseName} unexpectedly built ${field}`);
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
  return parseJsonResponse(response, method, pathname);
}

async function requestRawJson(baseUrl, method, pathname, rawBody, headers = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      connection: 'close',
      ...headers,
    },
    body: rawBody,
  });
  return parseJsonResponse(response, method, pathname);
}

async function parseJsonResponse(response, method, pathname) {
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

function journalFingerprint(journal) {
  const entries = Array.isArray(journal?.entries) ? journal.entries : [];
  return sha256(JSON.stringify({
    nextSequence: journal?.nextSequence ?? null,
    entries: entries.map((entry) => ({
      sequence: entry?.sequence ?? null,
      type: entry?.type ?? null,
      event: entry?.event ?? null,
    })),
  }));
}

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
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
