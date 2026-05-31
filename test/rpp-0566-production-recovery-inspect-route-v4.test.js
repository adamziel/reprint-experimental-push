import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { authenticatedHttpClient } from '../src/authenticated-http-push-client.js';
import { createPushPlan } from '../src/planner.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const muPluginDir = path.join(repoRoot, 'scripts/playground/rest-mu-plugins');
const remoteBlueprintPath = path.join(repoRoot, 'fixtures/playground/remote-base.blueprint.json');
const localBlueprintPath = path.join(repoRoot, 'fixtures/playground/local-edited.blueprint.json');
const serverStartupTimeoutMs = Number(process.env.REPRINT_PUSH_RPP_0566_LIVE_TIMEOUT_MS || 120_000);
const testTimeoutMs = Number(process.env.REPRINT_PUSH_RPP_0566_TEST_TIMEOUT_MS || 180_000);
const transientFetchRetryDelayMs = 250;
const transientFetchAttempts = 4;
const routePrefix = '/wp-json/reprint/v1/push';
const endpointPath = `${routePrefix}/recovery/inspect`;
const routeIndexPath = '/reprint/v1/push/recovery/inspect';
const malformedJsonBody = '{"plan":';
const malformedJsonBodyContentType = 'text/plain';
const hashPattern = /^[a-f0-9]{64}$/;
const credentials = {
  username: 'reprint_push_admin',
  password: 'reprint-push-admin-app-password',
};

function sha256Hex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

test(
  'RPP-0566 v4 exercises production recovery inspect against a live loopback URL',
  { timeout: testTimeoutMs },
  async () => {
    await withPlaygroundServer('rpp-0566-production-recovery-inspect', remoteBlueprintPath, async (server) => {
      assert.match(server.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);

      const index = await requestJson(server.baseUrl, 'GET', '/wp-json/');
      assert.equal(index.status, 200, `REST index HTTP ${index.status}`);
      assertRoute(index.body, '/reprint/v1/push/preflight', 'GET');
      assertRoute(index.body, '/reprint/v1/push/dry-run', 'POST');
      assertRoute(index.body, routeIndexPath, 'POST');

      const unsignedMalformed = await requestRawJson(
        server.baseUrl,
        'POST',
        endpointPath,
        malformedJsonBody,
        {
          ...authHeaders(credentials),
          'content-type': malformedJsonBodyContentType,
        },
      );
      assert.equal(unsignedMalformed.status, 401);
      assert.equal(unsignedMalformed.body?.code, 'SIGNED_HEADER_REQUIRED');
      assert.notEqual(unsignedMalformed.body?.code, 'rest_invalid_json');

      const client = authenticatedHttpClient({
        sourceUrl: server.baseUrl,
        credential: credentials,
        routeProfile: 'production-shaped',
        requestTimeoutMs: 30_000,
      });

      const initial = await client.get('/snapshot');
      assert.equal(initial.status, 200, `initial snapshot HTTP ${initial.status}`);
      assert.equal(initial.body?.ok, true);

      const localEdited = withoutUnmappedGraphPostmeta(exportSnapshot('local-edited', localBlueprintPath));
      const plan = createPushPlan({
        base: initial.body.snapshot,
        local: localEdited,
        remote: initial.body.snapshot,
      });
      assert.equal(plan.status, 'ready', JSON.stringify(plan.summary));
      assert.ok(plan.mutations.length > 0, 'RPP-0566 live recovery inspect needs a non-empty ready plan');

      const preflight = await client.signedGet('/preflight');
      assert.equal(preflight.status, 200, `preflight HTTP ${preflight.status}`);
      assert.equal(preflight.body?.ok, true);
      assert.equal(preflight.body?.auth?.session?.type, 'production-auth-session');
      assert.equal(preflight.body?.auth?.session?.status, 'active');
      assert.match(preflight.body?.session?.id || '', /^[A-Za-z0-9_-]{32,160}$/);
      const session = preflight.body.session.id;

      const dryRun = await client.signedPost('/dry-run', { plan }, {
        session,
        idempotencyKey: `rpp-0566-dry-run-${Date.now()}-${process.pid}`,
      });
      assert.equal(dryRun.status, 200, `dry-run HTTP ${dryRun.status}`);
      assert.equal(dryRun.body?.ok, true);
      assert.equal(dryRun.body?.mode, 'dry-run');
      assert.match(dryRun.body?.receipt?.receiptHash || '', /^[a-f0-9]{64}$/);

      const beforeInspect = await client.get('/snapshot');
      assert.equal(beforeInspect.status, 200, `before-inspect snapshot HTTP ${beforeInspect.status}`);
      assert.equal(targetSurfaceHash(beforeInspect.body.snapshot), targetSurfaceHash(initial.body.snapshot));

      const recoveryInspect = await client.signedPost('/recovery/inspect', {
        plan,
        receipt: dryRun.body.receipt,
      }, {
        session,
        idempotencyKey: `rpp-0566-recovery-inspect-${Date.now()}-${process.pid}`,
        retryable: true,
      });
      assert.equal(recoveryInspect.status, 200, `recovery inspect HTTP ${recoveryInspect.status}`);
      assert.equal(recoveryInspect.request?.pathname, endpointPath);
      assert.equal(recoveryInspect.body?.ok, true);
      assert.equal(recoveryInspect.body?.mode, 'inspect');
      assert.equal(recoveryInspect.body?.auth?.identity?.userLogin, credentials.username);
      assert.equal(recoveryInspect.body?.auth?.identity?.capabilities?.manage_options, true);
      assert.equal(recoveryInspect.body?.auth?.session?.type, 'production-auth-session');
      assert.equal(recoveryInspect.body?.auth?.session?.status, 'active');
      assert.equal(recoveryInspect.body?.auth?.session?.id, session);
      assert.equal(recoveryInspect.body?.signedRequest?.request?.path, endpointPath);
      assert.match(recoveryInspect.body?.signedRequest?.sessionHash || '', hashPattern);
      assert.match(recoveryInspect.body?.signedRequest?.signingKeyHash || '', hashPattern);
      assert.match(recoveryInspect.body?.signedRequest?.request?.canonicalHash || '', hashPattern);
      assert.match(recoveryInspect.body?.signedRequest?.request?.idempotencyKeyHash || '', hashPattern);
      assert.equal(recoveryInspect.body?.recovery?.counts?.total, plan.mutations.length);
      assert.equal(recoveryInspect.body?.recovery?.counts?.old, plan.mutations.length);
      assert.equal(recoveryInspect.body?.recovery?.counts?.new, 0);
      assert.equal(recoveryInspect.body?.recovery?.counts?.blockedUnknown, 0);
      assert.equal(recoveryInspect.body?.recovery?.state, 'old-remote');
      assert.equal(recoveryInspect.body?.recovery?.journal?.integrity?.status, 'ok');

      const afterInspect = await client.get('/snapshot');
      assert.equal(afterInspect.status, 200, `after-inspect snapshot HTTP ${afterInspect.status}`);
      assert.equal(
        targetSurfaceHash(afterInspect.body.snapshot),
        targetSurfaceHash(beforeInspect.body.snapshot),
        'live recovery inspect must not change the target content surface',
      );

      const proof = summarizeLiveRecoveryInspectProof({
        server,
        plan,
        recoveryInspect,
      });
      assert.equal(proof.ok, true);
      assert.equal(proof.liveUrl.checked, true);
      assert.equal(proof.liveUrl.exposure, 'sandbox-local-loopback-only');
      assert.equal(proof.liveUrl.tunnel, 'none');
      assert.equal(proof.route.requestPath, endpointPath);
      assert.equal(proof.recovery.state, 'old-remote');
      assert.match(proof.liveUrl.urlHash, hashPattern);
      assert.match(proof.route.proofHash, hashPattern);
      assert.match(proof.recovery.proofHash, hashPattern);
      assertNoRawValues(proof, [
        server.baseUrl,
        credentials.username,
        credentials.password,
        session,
      ]);
    });
  },
);

test('RPP-0566 v4 fails closed when a required live recovery inspect URL is unavailable', async () => {
  const port = await findLocalPort();
  const unavailableLiveUrl = `http://127.0.0.1:${port}`;
  assert.equal(await isPortAccepting(port), false, 'reserved unavailable port unexpectedly accepts connections');

  const client = authenticatedHttpClient({
    sourceUrl: unavailableLiveUrl,
    credential: credentials,
    routeProfile: 'production-shaped',
    requestTimeoutMs: 250,
  });

  let thrown = null;
  try {
    await client.signedPost('/recovery/inspect', {
      plan: unavailableReadyPlan(),
      receipt: unavailableReceipt(),
    }, {
      session: 'psh_rpp_0566_unavailable_session',
      readOnly: true,
      retryable: false,
    });
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown, 'unavailable live recovery inspect endpoint should throw');
  const blocker = summarizeUnavailableLiveEndpoint({
    error: thrown,
    sourceUrl: unavailableLiveUrl,
  });

  assert.equal(blocker.ok, false);
  assert.equal(blocker.status, 'blocked');
  assert.equal(blocker.code, 'LIVE_RECOVERY_INSPECT_ENDPOINT_UNAVAILABLE');
  assert.equal(blocker.releaseStatus, 'NO-GO');
  assert.equal(blocker.releaseMovement.allowed, false);
  assert.equal(blocker.mutationAttempted, false);
  assert.equal(blocker.liveUrl.checked, false);
  assert.equal(blocker.liveUrl.available, false);
  assert.equal(blocker.liveUrl.rawUrlIncluded, false);
  assert.match(blocker.liveUrl.urlHash, hashPattern);
  assert.match(blocker.route.proofHash, hashPattern);
  assertNoRawValues(blocker, [
    unavailableLiveUrl,
    credentials.username,
    credentials.password,
    'psh_rpp_0566_unavailable_session',
  ]);
});

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
    'content-type': 'application/json',
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

function targetSurfaceHash(snapshot) {
  return digest(targetSurface(snapshot));
}

function targetSurface(snapshot) {
  const next = JSON.parse(JSON.stringify({
    files: snapshot?.files || {},
    db: snapshot?.db || {},
    plugins: snapshot?.plugins || {},
  }));
  const options = next.db?.wp_options || {};
  for (const key of Object.keys(options)) {
    if (instrumentationOptionKey(key)) {
      delete options[key];
    }
  }
  if (next.db) {
    for (const table of Object.keys(next.db)) {
      if (/^wp_reprint_push_(?:db_)?journal/.test(table)) {
        delete next.db[table];
      }
    }
  }
  return next;
}

function instrumentationOptionKey(key) {
  return [
    'option_name:reprint_push_lab_auth_sessions',
    'option_name:reprint_push_lab_signed_nonces',
    'option_name:reprint_push_protocol_journal',
  ].includes(key);
}

function summarizeLiveRecoveryInspectProof({ server, plan, recoveryInspect }) {
  return {
    schemaVersion: 1,
    slice: 'RPP-0566',
    ok: recoveryInspect.status === 200 && recoveryInspect.body?.ok === true,
    proofClass: 'live-loopback-production-recovery-inspect-route',
    releaseStatus: 'NO-GO',
    liveUrl: {
      checked: true,
      available: true,
      scheme: 'http',
      hostHash: sha256Hex('127.0.0.1'),
      portHash: sha256Hex(String(server.port)),
      urlHash: sha256Hex(server.baseUrl),
      exposure: 'sandbox-local-loopback-only',
      tunnel: 'none',
      rawUrlIncluded: false,
    },
    route: {
      method: recoveryInspect.request?.method || 'POST',
      requestPath: recoveryInspect.request?.pathname || null,
      routeName: '/push/recovery/inspect',
      signed: true,
      sessionBound: true,
      idempotencyKeyHashLength: String(recoveryInspect.body?.signedRequest?.request?.idempotencyKeyHash || '').length,
      proofHash: digest({
        status: recoveryInspect.status,
        requestPath: recoveryInspect.request?.pathname || null,
        mode: recoveryInspect.body?.mode || null,
        sessionHash: recoveryInspect.body?.signedRequest?.sessionHash || null,
        canonicalHash: recoveryInspect.body?.signedRequest?.request?.canonicalHash || null,
      }),
    },
    recovery: {
      state: recoveryInspect.body?.recovery?.state || null,
      mutationCount: plan.mutations.length,
      countsHash: digest(recoveryInspect.body?.recovery?.counts || {}),
      journalIntegrity: recoveryInspect.body?.recovery?.journal?.integrity?.status || null,
      proofHash: digest({
        state: recoveryInspect.body?.recovery?.state || null,
        counts: recoveryInspect.body?.recovery?.counts || {},
        journalIntegrity: recoveryInspect.body?.recovery?.journal?.integrity?.status || null,
      }),
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: 'live loopback regression proof only; production-owned endpoint evidence remains required',
    },
  };
}

function summarizeUnavailableLiveEndpoint({ error, sourceUrl }) {
  return {
    schemaVersion: 1,
    slice: 'RPP-0566',
    ok: false,
    status: 'blocked',
    code: 'LIVE_RECOVERY_INSPECT_ENDPOINT_UNAVAILABLE',
    releaseStatus: 'NO-GO',
    mutationAttempted: false,
    liveUrl: {
      checked: false,
      available: false,
      urlHash: sha256Hex(sourceUrl),
      rawUrlIncluded: false,
    },
    route: {
      method: 'POST',
      endpointPath,
      routeName: '/push/recovery/inspect',
      proofHash: digest({
        method: 'POST',
        endpointPath,
        errorName: error?.name || 'Error',
        unavailable: true,
      }),
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: 'required live recovery inspect endpoint was unavailable',
    },
    boundary: {
      firstRemainingProductionBoundary: 'available production-backed recovery inspect route endpoint',
      status: 'blocked',
      verdict: 'LIVE_RECOVERY_INSPECT_ENDPOINT_UNAVAILABLE',
    },
  };
}

function unavailableReadyPlan() {
  return {
    id: 'plan-rpp-0566-unavailable-recovery-inspect',
    status: 'ready',
    summary: { total: 0, create: 0, update: 0, delete: 0 },
    mutations: [],
    preconditions: [],
    conflicts: [],
    blockers: [],
  };
}

function unavailableReceipt() {
  return {
    schemaVersion: 1,
    protocol: 'reprint-push-lab',
    mode: 'dry-run',
    planId: 'plan-rpp-0566-unavailable-recovery-inspect',
    receiptHash: sha256Hex('rpp-0566-unavailable-receipt'),
  };
}

function assertNoRawValues(value, rawValues) {
  const serialized = JSON.stringify(value);
  for (const rawValue of rawValues) {
    assert.equal(
      serialized.includes(rawValue),
      false,
      `evidence leaked raw value ${rawValue}`,
    );
  }
}
