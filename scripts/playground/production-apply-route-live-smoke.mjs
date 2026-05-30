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
const fixtures = {
  base: 'fixtures/playground/remote-base.blueprint.json',
  local: 'fixtures/playground/local-edited.blueprint.json',
};
const serverStartupTimeoutMs = Number(process.env.REPRINT_PUSH_APPLY_ROUTE_LIVE_TIMEOUT_MS || 120_000);
const transientFetchRetryDelayMs = 250;
const transientFetchAttempts = 4;
const endpointPaths = {
  preflight: '/wp-json/reprint/v1/push/preflight',
  dryRun: '/wp-json/reprint/v1/push/dry-run',
  apply: '/wp-json/reprint/v1/push/apply',
  snapshot: '/wp-json/reprint/v1/push/snapshot',
  dbJournal: '/wp-json/reprint/v1/push/db-journal',
};
const routeIndexPaths = {
  preflight: '/reprint/v1/push/preflight',
  dryRun: '/reprint/v1/push/dry-run',
  apply: '/reprint/v1/push/apply',
};
const credentials = {
  username: 'reprint_push_admin',
  password: 'reprint-push-admin-app-password',
};
const idempotencyHeader = 'X-Reprint-Push-Idempotency-Key';

const snapshots = Object.fromEntries(
  Object.entries(fixtures).map(([name, fixture]) => [
    name,
    exportSnapshot(name, path.join(repoRoot, fixture)),
  ]),
);
const localSnapshot = withoutUnmappedGraphPostmeta(snapshots.local);
const readyPlan = createPushPlan({
  base: snapshots.base,
  local: localSnapshot,
  remote: snapshots.base,
});

assert.equal(readyPlan.status, 'ready', 'RPP-0524 apply proof requires a ready push plan');
assert.ok(readyPlan.mutations.length > 0, 'RPP-0524 apply proof requires at least one mutation');

const summary = {
  ok: false,
  rpp: 'RPP-0524',
  routeProfile: 'production-shaped',
  endpoint: endpointPaths.apply,
  liveUrl: {
    scheme: 'http',
    host: '127.0.0.1',
    port: 'ephemeral',
    exposure: 'sandbox-local-loopback-only',
    tunnel: 'none',
  },
  routeIndex: {},
  unauthorized: {},
  preflight: {},
  dryRun: {},
  apply: {},
  final: {},
};

try {
  await withPlaygroundServer('rpp-0524-production-apply', path.join(repoRoot, fixtures.base), async (server) => {
    summary.liveUrl.port = server.port;

    const index = await requestJson(server.baseUrl, 'GET', '/wp-json/');
    assert.equal(index.status, 200, `REST index HTTP ${index.status}`);
    assertRoute(index.body, routeIndexPaths.preflight, 'GET');
    assertRoute(index.body, routeIndexPaths.dryRun, 'POST');
    assertRoute(index.body, routeIndexPaths.apply, 'POST');
    summary.routeIndex = {
      namespacePresent: Array.isArray(index.body.namespaces) && index.body.namespaces.includes('reprint/v1'),
      preflightMethods: routeMethods(index.body.routes?.[routeIndexPaths.preflight]),
      dryRunMethods: routeMethods(index.body.routes?.[routeIndexPaths.dryRun]),
      applyMethods: routeMethods(index.body.routes?.[routeIndexPaths.apply]),
    };

    const client = authenticatedHttpClient({
      sourceUrl: server.baseUrl,
      credential: credentials,
      routeProfile: 'production-shaped',
      requestTimeoutMs: 30_000,
    });

    const initial = await client.get('/snapshot');
    assert.equal(initial.status, 200, `initial production snapshot HTTP ${initial.status}`);
    assertVisibleSurfaceEqual(initial.body.snapshot, snapshots.base, 'RPP-0524 initial source');

    const noAuthApply = await requestJson(
      server.baseUrl,
      'POST',
      endpointPaths.apply,
      { plan: readyPlan, receipt: {} },
      { [idempotencyHeader]: 'rpp-0524-no-auth-apply' },
    );
    assert.equal(noAuthApply.status, 401, `no-auth production apply HTTP ${noAuthApply.status}`);
    assert.equal(noAuthApply.body?.code, 'reprint_push_lab_auth_required');
    await assertCurrentSurface(client, snapshots.base, 'no-auth production apply must not mutate');

    const unsignedApply = await requestJson(
      server.baseUrl,
      'POST',
      endpointPaths.apply,
      { plan: readyPlan, receipt: {} },
      {
        ...authHeaders(credentials),
        [idempotencyHeader]: 'rpp-0524-unsigned-apply',
      },
    );
    assert.equal(unsignedApply.status, 401, `unsigned production apply HTTP ${unsignedApply.status}`);
    assert.equal(unsignedApply.body?.code, 'SIGNED_HEADER_REQUIRED');
    assert.equal(unsignedApply.body?.mode, 'apply');
    await assertCurrentSurface(client, snapshots.base, 'unsigned production apply must not mutate');

    const preflight = await client.signedGet('/preflight');
    assert.equal(preflight.status, 200, `production-shaped preflight HTTP ${preflight.status}`);
    assert.equal(preflight.body?.ok, true, 'production-shaped preflight must report ok');
    assert.equal(preflight.request?.pathname, endpointPaths.preflight);
    assert.equal(preflight.body?.routeProfile?.profile, 'production-shaped');
    assert.equal(preflight.body?.routeProfile?.restNamespace, 'reprint/v1');
    assert.equal(preflight.body?.routeProfile?.routePrefix, '/push');
    assert.equal(preflight.body?.auth?.identity?.userLogin, credentials.username);
    assert.equal(preflight.body?.auth?.identity?.capabilities?.manage_options, true);
    assert.equal(preflight.body?.auth?.session?.type, 'production-auth-session');
    assert.equal(preflight.body?.auth?.session?.status, 'active');
    assert.match(preflight.body?.session?.id || '', /^[A-Za-z0-9_-]{32,160}$/);
    const session = preflight.body.session.id;

    const journalBeforeApply = await client.signedGet('/db-journal?limit=80', {
      session,
      idempotencyKey: 'rpp-0524-journal-before-apply',
    });
    assert.equal(journalBeforeApply.status, 200, `pre-apply production db-journal HTTP ${journalBeforeApply.status}`);
    const preApplyRows = journalRows(journalBeforeApply);
    assert.equal(countJournalEvents(preApplyRows, 'apply-started'), 0, 'unauthorized apply opened an apply claim');
    assert.equal(countJournalEvents(preApplyRows, 'mutation-applied'), 0, 'unauthorized apply mutated before the valid apply');

    const idempotencyKey = `rpp-0524-production-apply-${Date.now()}-${process.pid}`;
    const dryRun = await client.signedPost('/dry-run', { plan: readyPlan }, {
      session,
      idempotencyKey,
    });
    assert.equal(dryRun.status, 200, `production-shaped dry-run HTTP ${dryRun.status}`);
    assert.equal(dryRun.body?.ok, true, 'production-shaped dry-run must report ok');
    assert.equal(dryRun.body?.mode, 'dry-run');
    assert.equal(dryRun.request?.pathname, endpointPaths.dryRun);
    assert.ok(dryRun.body?.receipt?.receiptHash, 'production-shaped dry-run receipt hash missing');
    assert.equal(dryRun.body.receipt.authBinding.request.restNamespace, 'reprint/v1');
    assert.equal(dryRun.body.receipt.authBinding.request.dryRunRoute, '/push/dry-run');
    assert.equal(dryRun.body.receipt.authBinding.request.routeProfile, 'production-shaped');
    assert.equal(dryRun.body.receipt.authBinding.session.type, 'production-auth-session');
    assert.equal(dryRun.body.receipt.authBinding.session.id, session);
    await assertCurrentSurface(client, snapshots.base, 'production-shaped dry-run must not mutate');

    const applyPayload = { plan: readyPlan, receipt: dryRun.body.receipt };
    const apply = await client.signedPost('/apply', applyPayload, {
      session,
      idempotencyKey,
    });
    assert.equal(apply.status, 200, `production-shaped apply HTTP ${apply.status}`);
    assert.equal(apply.body?.ok, true, 'production-shaped apply must report ok');
    assert.equal(apply.body?.mode, 'apply');
    assert.equal(apply.request?.pathname, endpointPaths.apply);
    assert.equal(apply.body?.signedRequest?.request?.path, endpointPaths.apply);
    assert.equal(apply.body?.signedRequest?.request?.method, 'POST');
    assert.equal(apply.body?.auth?.identity?.userLogin, credentials.username);
    assert.equal(apply.body?.auth?.identity?.capabilities?.manage_options, true);
    assert.equal(apply.body?.auth?.session?.type, 'production-auth-session');
    assert.equal(apply.body?.auth?.session?.status, 'active');
    assert.equal(apply.body?.auth?.session?.id, session);
    assert.equal(apply.body?.applied, readyPlan.mutations.length);
    assert.equal(apply.body?.idempotency?.freshMutationWork, true);
    assert.equal(apply.body?.applyRevalidation?.required, 'fresh-live-hashes-before-first-mutation');
    assert.equal(apply.body?.applyRevalidation?.phase, 'before-first-mutation');
    assert.equal(apply.body?.applyRevalidation?.checkedAgainst, 'live-remote');
    assert.equal(apply.body?.applyRevalidation?.mutationCount, readyPlan.mutations.length);
    assert.equal(apply.body?.applyRevalidation?.verifiedCount, readyPlan.mutations.length);
    assert.match(apply.body?.applyRevalidation?.liveSource?.snapshotHash || '', /^[a-f0-9]{64}$/);
    assert.match(apply.body?.applyRevalidation?.liveSource?.sourceHash || '', /^[a-f0-9]{64}$/);
    assert.match(apply.body?.applyRevalidation?.liveSource?.sourceUrlHash || '', /^[a-f0-9]{64}$/);

    const afterApply = await client.get('/snapshot');
    assert.equal(afterApply.status, 200, `post-apply production snapshot HTTP ${afterApply.status}`);
    assertVisibleSurfaceEqual(afterApply.body.snapshot, localSnapshot, 'production-shaped apply final source');

    const journalAfterApply = await client.signedGet('/db-journal?limit=80', {
      session,
      idempotencyKey: 'rpp-0524-journal-after-apply',
    });
    assert.equal(journalAfterApply.status, 200, `post-apply production db-journal HTTP ${journalAfterApply.status}`);
    const afterRows = journalRows(journalAfterApply);
    assert.ok(afterRows.some((entry) => entry.event === 'apply-started'), 'DB journal missing apply-started');
    assert.ok(afterRows.some((entry) => entry.event === 'apply-committed'), 'DB journal missing apply-committed');
    assert.equal(countJournalEvents(afterRows, 'mutation-applied'), readyPlan.mutations.length);

    summary.unauthorized = {
      noAuth: { status: noAuthApply.status, code: noAuthApply.body?.code || null },
      unsigned: { status: unsignedApply.status, code: unsignedApply.body?.code || null, mode: unsignedApply.body?.mode || null },
      mutationEventsBeforeApply: countJournalEvents(preApplyRows, 'mutation-applied'),
    };
    summary.preflight = {
      status: preflight.status,
      requestPath: preflight.request.pathname,
      routeProfile: preflight.body.routeProfile,
      sessionType: preflight.body.auth.session.type,
      sessionStatus: preflight.body.auth.session.status,
      sessionIdPattern: '^[A-Za-z0-9_-]{32,160}$',
    };
    summary.dryRun = {
      status: dryRun.status,
      requestPath: dryRun.request.pathname,
      receiptHashLength: String(dryRun.body.receipt.receiptHash || '').length,
      receiptRouteProfile: dryRun.body.receipt.authBinding.request.routeProfile,
      receiptRoute: dryRun.body.receipt.authBinding.request.dryRunRoute,
    };
    summary.apply = {
      status: apply.status,
      requestPath: apply.request.pathname,
      signedRequestPath: apply.body.signedRequest.request.path,
      applied: apply.body.applied,
      freshMutationWork: apply.body.idempotency.freshMutationWork,
      authSessionType: apply.body.auth.session.type,
      applyRevalidation: {
        phase: apply.body.applyRevalidation.phase,
        checkedAgainst: apply.body.applyRevalidation.checkedAgainst,
        mutationCount: apply.body.applyRevalidation.mutationCount,
        verifiedCount: apply.body.applyRevalidation.verifiedCount,
        snapshotHashLength: String(apply.body.applyRevalidation.liveSource.snapshotHash || '').length,
        sourceHashLength: String(apply.body.applyRevalidation.liveSource.sourceHash || '').length,
        sourceUrlHashLength: String(apply.body.applyRevalidation.liveSource.sourceUrlHash || '').length,
      },
    };
    summary.final = {
      finalMatchesLocal: digest(visibleSurface(afterApply.body.snapshot)) === digest(visibleSurface(localSnapshot)),
      mutationApplied: countJournalEvents(afterRows, 'mutation-applied'),
      journalEvents: [...new Set(afterRows.map((entry) => entry.event))].sort(),
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
      const index = await requestJson(baseUrl, 'GET', '/wp-json/', undefined, {}, { attempts: 1 });
      if (index.status === 200 && index.body?.routes?.[routeIndexPaths.apply]) {
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

async function assertCurrentSurface(client, expected, label) {
  const response = await client.get('/snapshot');
  assert.equal(response.status, 200, `${label} snapshot HTTP ${response.status}`);
  assert.equal(response.body?.ok, true, `${label} snapshot did not report ok`);
  assertVisibleSurfaceEqual(response.body.snapshot, expected, label);
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

function journalRows(response) {
  const rows = response.body?.dbJournal?.latestRows;
  return Array.isArray(rows) ? rows : [];
}

function countJournalEvents(rows, event) {
  return rows.filter((entry) => entry.event === event).length;
}
