import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticatedHttpClient } from '../src/authenticated-http-push-client.js';
import { createPushPlan } from '../src/planner.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const muPluginDir = path.join(repoRoot, 'scripts/playground/rest-mu-plugins');
const blueprintPath = path.join(repoRoot, 'fixtures/playground/remote-base.blueprint.json');
const startupTimeoutMs = Number(process.env.REPRINT_PUSH_RPP0516_LIVE_TIMEOUT_MS || 120_000);
const requestTimeoutMs = Number(process.env.REPRINT_PUSH_RPP0516_REQUEST_TIMEOUT_MS || 30_000);
const endpointPaths = {
  preflight: '/wp-json/reprint/v1/push/preflight',
  dryRun: '/wp-json/reprint/v1/push/dry-run',
  apply: '/wp-json/reprint/v1/push/apply',
  dbJournal: '/wp-json/reprint/v1/push/db-journal',
};
const routeIndexPaths = {
  preflight: '/reprint/v1/push/preflight',
  dryRun: '/reprint/v1/push/dry-run',
  apply: '/reprint/v1/push/apply',
  dbJournal: '/reprint/v1/push/db-journal',
};
const credentials = {
  username: 'reprint_push_admin',
  password: 'reprint-push-admin-app-password',
};

test('RPP-0516 production-shaped apply replays the same idempotency key and body on a live URL', { timeout: startupTimeoutMs + 90_000 }, async () => {
  await withPlaygroundServer('rpp-0516-same-key-same-body-replay', async (server) => {
    const index = await requestJson(server.baseUrl, 'GET', '/wp-json/');
    assert.equal(index.status, 200, `REST index HTTP ${index.status}`);
    assertRoute(index.body, routeIndexPaths.preflight, 'GET');
    assertRoute(index.body, routeIndexPaths.dryRun, 'POST');
    assertRoute(index.body, routeIndexPaths.apply, 'POST');
    assertRoute(index.body, routeIndexPaths.dbJournal, 'GET');

    const client = authenticatedHttpClient({
      sourceUrl: server.baseUrl,
      credential: credentials,
      routeProfile: 'production-shaped',
      requestTimeoutMs,
    });

    const initial = await client.get('/snapshot');
    assert.equal(initial.status, 200, `initial production snapshot HTTP ${initial.status}`);
    assert.equal(initial.body?.ok, true, 'initial production snapshot must report ok');
    const baseSnapshot = initial.body.snapshot;
    assert.equal(
      typeof baseSnapshot?.files?.['wp-content/uploads/reprint-push/shared.txt'],
      'string',
      'fixture must expose the shared upload file used by the focused replay mutation',
    );

    const localSnapshot = JSON.parse(JSON.stringify(baseSnapshot));
    localSnapshot.files['wp-content/uploads/reprint-push/shared.txt'] = 'rpp-0516 replay target content';
    const readyPlan = createPushPlan({
      base: baseSnapshot,
      local: localSnapshot,
      remote: baseSnapshot,
      now: new Date('2026-05-30T00:00:00.000Z'),
    });
    assert.equal(readyPlan.status, 'ready', 'focused replay proof requires a ready push plan');
    assert.equal(readyPlan.mutations.length, 1, 'focused replay proof should mutate exactly one resource');
    assert.equal(readyPlan.mutations[0]?.resourceKey, 'file:wp-content/uploads/reprint-push/shared.txt');

    const preflight = await client.signedGet('/preflight');
    assert.equal(preflight.status, 200, `production-shaped preflight HTTP ${preflight.status}`);
    assert.equal(preflight.request?.pathname, endpointPaths.preflight);
    assert.equal(preflight.body?.ok, true);
    assert.equal(preflight.body?.routeProfile?.profile, 'production-shaped');
    assert.equal(preflight.body?.auth?.session?.type, 'production-auth-session');
    assert.equal(preflight.body?.auth?.identity?.userLogin, credentials.username);
    const session = preflight.body?.session?.id;
    assert.match(session || '', /^[A-Za-z0-9_-]{32,160}$/);

    const idempotencyKey = `rpp-0516-same-body-${Date.now()}-${process.pid}`;
    const idempotencyKeyHash = sha256Text(idempotencyKey);
    const dryRun = await client.signedPost('/dry-run', { plan: readyPlan }, {
      session,
      idempotencyKey,
    });
    assert.equal(dryRun.status, 200, `production-shaped dry-run HTTP ${dryRun.status}`);
    assert.equal(dryRun.request?.pathname, endpointPaths.dryRun);
    assert.equal(dryRun.body?.ok, true);
    assert.equal(dryRun.body?.mode, 'dry-run');
    assert.ok(dryRun.body?.receipt?.receiptHash, 'dry-run receipt hash missing');
    assert.equal(dryRun.body?.receipt?.authBinding?.request?.routeProfile, 'production-shaped');
    assert.equal(dryRun.body?.receipt?.authBinding?.pushSession?.dryRunIdempotencyKeyHash, idempotencyKeyHash);
    await assertCurrentSurface(client, baseSnapshot, 'production-shaped dry-run must not mutate');

    const applyPayload = { plan: readyPlan, receipt: dryRun.body.receipt };
    const apply = await client.signedPost('/apply', applyPayload, {
      session,
      idempotencyKey,
    });
    assert.equal(apply.status, 200, `production-shaped apply HTTP ${apply.status}`);
    assert.equal(apply.request?.pathname, endpointPaths.apply);
    assert.equal(apply.body?.ok, true);
    assert.equal(apply.body?.mode, 'apply');
    assert.equal(apply.body?.applied, readyPlan.mutations.length);
    assert.equal(apply.body?.responseSchemaVersion, 1);
    assert.equal(apply.body?.idempotency?.replayed, false);
    assert.equal(apply.body?.idempotency?.freshMutationWork, true);
    assert.equal(apply.body?.idempotency?.idempotencyKeyHash, idempotencyKeyHash);
    assert.equal(apply.body?.signedRequest?.request?.path, endpointPaths.apply);
    assert.equal(apply.body?.signedRequest?.request?.idempotencyKeyHash, idempotencyKeyHash);
    assert.equal(apply.body?.auth?.session?.id, session);
    assert.equal(apply.body?.auth?.session?.type, 'production-auth-session');
    assert.equal(apply.body?.applyRevalidation?.phase, 'before-first-mutation');
    assert.equal(apply.body?.applyRevalidation?.checkedAgainst, 'live-remote');

    await assertCurrentSurface(client, localSnapshot, 'production-shaped apply final source');
    const journalAfterApply = await signedJournal(client, session, 'rpp-0516-journal-after-apply');
    const rowsAfterApply = journalRows(journalAfterApply);
    assert.equal(countJournalEvents(rowsAfterApply, 'idempotency-opened'), 1);
    assert.equal(countJournalEvents(rowsAfterApply, 'apply-committed'), 1);
    assert.equal(countJournalEvents(rowsAfterApply, 'mutation-applied'), readyPlan.mutations.length);

    const replay = await client.signedPost('/apply', applyPayload, {
      session,
      idempotencyKey,
    });
    assert.equal(replay.status, 200, `production-shaped replay HTTP ${replay.status}`);
    assert.equal(replay.request?.pathname, endpointPaths.apply);
    assert.equal(replay.body?.ok, true);
    assert.equal(replay.body?.mode, 'apply');
    assert.equal(replay.body?.code, 'BATCH_ALREADY_COMMITTED');
    assert.equal(replay.body?.applied, apply.body.applied);
    assert.equal(replay.body?.responseSchemaVersion, 1);
    assert.equal(replay.body?.idempotency?.replayed, true);
    assert.equal(replay.body?.idempotency?.freshMutationWork, false);
    assert.equal(replay.body?.idempotency?.status, 'replayed');
    assert.equal(replay.body?.idempotency?.conflict, false);
    assert.equal(replay.body?.idempotency?.idempotencyKeyHash, apply.body.idempotency.idempotencyKeyHash);
    assert.equal(replay.body?.idempotency?.requestHash, apply.body.idempotency.requestHash);
    assert.equal(replay.body?.idempotency?.committedSequence, apply.body.dbJournal.sequence);
    assert.equal(replay.body?.dbJournal?.event, 'apply-replayed');
    assert.equal(replay.body?.signedRequest?.contentHash, apply.body.signedRequest.contentHash);
    assert.equal(
      digest(replay.body?.signedRequest?.request || null),
      digest(apply.body?.signedRequest?.request || null),
      'replay must keep the same canonical request evidence except nonce/timestamp metadata',
    );
    assert.equal(replay.body?.auth?.session?.id, session);
    assert.equal(replay.body?.auth?.session?.type, 'production-auth-session');

    await assertCurrentSurface(client, localSnapshot, 'production-shaped same-key replay must not mutate');
    const journalAfterReplay = await signedJournal(client, session, 'rpp-0516-journal-after-replay');
    const rowsAfterReplay = journalRows(journalAfterReplay);
    assert.equal(countJournalEvents(rowsAfterReplay, 'idempotency-opened'), 1, 'replay must not open a second idempotency claim');
    assert.equal(countJournalEvents(rowsAfterReplay, 'apply-committed'), 1, 'replay must not commit a second apply');
    assert.equal(countJournalEvents(rowsAfterReplay, 'mutation-applied'), readyPlan.mutations.length, 'replay must not add mutation work');
    assert.equal(countJournalEvents(rowsAfterReplay, 'apply-replayed'), 1, 'replay journal evidence missing');
  });
});

async function signedJournal(client, session, idempotencyKey) {
  const response = await client.signedGet('/db-journal?limit=80', {
    session,
    idempotencyKey,
  });
  assert.equal(response.status, 200, `production-shaped db-journal HTTP ${response.status}`);
  assert.equal(response.request?.pathname?.split('?', 1)[0], endpointPaths.dbJournal);
  assert.equal(response.body?.ok, true);
  return response;
}

async function assertCurrentSurface(client, expected, label) {
  const response = await client.get('/snapshot');
  assert.equal(response.status, 200, `${label} snapshot HTTP ${response.status}`);
  assert.equal(response.body?.ok, true, `${label} snapshot did not report ok`);
  assertVisibleSurfaceEqual(response.body.snapshot, expected, label);
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

function sha256Text(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function assertRoute(body, route, method) {
  const routeEntry = body?.routes?.[route];
  assert.ok(routeEntry, `REST index missing ${route}`);
  assert.ok(routeMethods(routeEntry).includes(method), `REST index route ${route} missing ${method}`);
}

function routeMethods(routeEntry) {
  return Array.isArray(routeEntry?.methods) ? routeEntry.methods.map(String) : [];
}

async function withPlaygroundServer(name, run) {
  const server = await startPlaygroundServer(name);
  try {
    await run(server);
  } finally {
    await stopPlaygroundServer(server);
  }
}

async function startPlaygroundServer(name) {
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

async function waitForServer(child, baseUrl, logs) {
  const deadline = Date.now() + startupTimeoutMs;
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

async function requestJson(baseUrl, method, pathname, body = undefined, headers = {}, { attempts = 4 } = {}) {
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
      await sleep(250 * attempt);
    }
  }
  throw lastError;
}

async function requestJsonOnce(baseUrl, method, pathname, body = undefined, headers = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: body === undefined
      ? { connection: 'close', ...headers }
      : { 'content-type': 'application/json', connection: 'close', ...headers },
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
