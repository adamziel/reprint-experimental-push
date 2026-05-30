import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticatedHttpClient } from '../src/authenticated-http-push-client.js';
import { createPushPlan } from '../src/planner.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routeSourcePath = path.join(repoRoot, 'scripts/playground/push-remote-rest-plugin.php');
const routeSource = readFileSync(routeSourcePath, 'utf8');
const muPluginDir = path.join(repoRoot, 'scripts/playground/rest-mu-plugins');
const blueprintPath = path.join(repoRoot, 'fixtures/playground/remote-base.blueprint.json');
const startupTimeoutMs = Number(process.env.REPRINT_PUSH_RPP0517_LIVE_TIMEOUT_MS || 120_000);
const requestTimeoutMs = Number(process.env.REPRINT_PUSH_RPP0517_REQUEST_TIMEOUT_MS || 30_000);
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

function functionBody(name) {
  const declaration = `function ${name}`;
  const start = routeSource.indexOf(declaration);
  assert.notEqual(start, -1, `missing ${declaration}`);
  const open = routeSource.indexOf('{', start);
  assert.notEqual(open, -1, `missing body for ${declaration}`);

  let depth = 0;
  for (let index = open; index < routeSource.length; index += 1) {
    const char = routeSource[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return routeSource.slice(open + 1, index);
      }
    }
  }

  assert.fail(`unterminated body for ${declaration}`);
}

function assertBefore(body, first, second) {
  const firstIndex = body.indexOf(first);
  const secondIndex = body.indexOf(second);
  assert.notEqual(firstIndex, -1, `missing ${first}`);
  assert.notEqual(secondIndex, -1, `missing ${second}`);
  assert.ok(firstIndex < secondIndex, `${first} must appear before ${second}`);
}

test('RPP-0517 authenticated apply rejects bad auth before JSON parsing or mutation setup', () => {
  const callback = functionBody('reprint_push_lab_rest_authenticated_apply');
  const applyWithJournal = functionBody('reprint_push_lab_rest_apply_with_db_journal');
  const conflictResult = functionBody('reprint_push_lab_rest_idempotency_conflict_result');

  assertBefore(
    callback,
    "reprint_push_lab_rest_require_signed_request($request, 'apply')",
    'reprint_push_lab_rest_json_payload($request)',
  );
  assertBefore(callback, 'return $signature_error;', 'reprint_push_lab_rest_json_payload($request)');
  assertBefore(callback, 'reprint_push_lab_rest_validate_authenticated_receipt($request, $payload, $plan, $receipt_payload)', 'reprint_push_lab_rest_apply_with_db_journal($request, true)');
  assertBefore(applyWithJournal, 'reprint_push_lab_db_journal_key_has_different_request', 'reprint_push_lab_db_journal_try_open_idempotency');
  assertBefore(applyWithJournal, 'reprint_push_lab_rest_idempotency_conflict_result($context)', 'reprint_push_lab_rest_run_db_journal_apply');

  assert.match(conflictResult, /'code'\s*=>\s*'IDEMPOTENCY_KEY_CONFLICT'/);
  assert.match(conflictResult, /'status'\s*=>\s*'conflict'/);
  assert.match(conflictResult, /'freshMutationWork'\s*=>\s*false/);
  assert.match(conflictResult, /'mutationEventCounts'\s*=>\s*\$mutation_counts/);
});

test('RPP-0517 production-shaped apply rejects same-key different-body conflict on a live URL', { timeout: startupTimeoutMs + 90_000 }, async () => {
  await withPlaygroundServer('rpp-0517-same-key-different-body-conflict', async (server) => {
    const index = await requestJson(server.baseUrl, 'GET', '/wp-json/');
    assert.equal(index.status, 200, `REST index HTTP ${index.status}`);
    assertRoute(index.body, routeIndexPaths.preflight, 'GET');
    assertRoute(index.body, routeIndexPaths.dryRun, 'POST');
    assertRoute(index.body, routeIndexPaths.apply, 'POST');
    assertRoute(index.body, routeIndexPaths.dbJournal, 'GET');

    const noAuthApply = await requestRaw(
      server.baseUrl,
      'POST',
      endpointPaths.apply,
      '{}',
      { 'content-type': 'application/json' },
    );
    assert.equal(noAuthApply.status, 401, `no-auth production apply HTTP ${noAuthApply.status}`);
    assert.equal(noAuthApply.body?.code, 'reprint_push_lab_auth_required');
    assert.notEqual(noAuthApply.body?.code, 'INVALID_ARGUMENT');

    const unsignedApply = await requestRaw(
      server.baseUrl,
      'POST',
      endpointPaths.apply,
      '{}',
      {
        authorization: basicAuthorizationHeader(),
        'content-type': 'application/json',
      },
    );
    assert.equal(unsignedApply.status, 401, `unsigned production apply HTTP ${unsignedApply.status}`);
    assert.equal(unsignedApply.body?.code, 'SIGNED_HEADER_REQUIRED');
    assert.notEqual(unsignedApply.body?.code, 'INVALID_ARGUMENT');

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
      'fixture must expose the shared upload file used by the focused conflict mutation',
    );
    await assertCurrentSurface(client, baseSnapshot, 'negative auth requests must not mutate');
    const journalAfterNegativeAuth = await requestJson(server.baseUrl, 'GET', '/wp-json/reprint/v1/push/db-journal?limit=80');
    assert.equal(countJournalEvents(journalRows(journalAfterNegativeAuth), 'mutation-applied'), 0);

    const localSnapshot = JSON.parse(JSON.stringify(baseSnapshot));
    localSnapshot.files['wp-content/uploads/reprint-push/shared.txt'] = 'rpp-0517 conflict target content';
    const readyPlan = createPushPlan({
      base: baseSnapshot,
      local: localSnapshot,
      remote: baseSnapshot,
      now: new Date('2026-05-30T00:00:00.000Z'),
    });
    assert.equal(readyPlan.status, 'ready', 'focused conflict proof requires a ready push plan');
    assert.equal(readyPlan.mutations.length, 1, 'focused conflict proof should mutate exactly one resource');
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

    const idempotencyKey = `rpp-0517-different-body-${Date.now()}-${process.pid}`;
    const idempotencyKeyHash = sha256Text(idempotencyKey);
    const dryRun = await client.signedPost('/dry-run', { plan: readyPlan }, {
      session,
      idempotencyKey,
    });
    assert.equal(dryRun.status, 200, `production-shaped dry-run HTTP ${dryRun.status}`);
    assert.equal(dryRun.request?.pathname, endpointPaths.dryRun);
    assert.equal(dryRun.body?.ok, true);
    assert.ok(dryRun.body?.receipt?.receiptHash, 'dry-run receipt hash missing');
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
    assert.equal(apply.body?.idempotency?.replayed, false);
    assert.equal(apply.body?.idempotency?.freshMutationWork, true);
    assert.equal(apply.body?.idempotency?.idempotencyKeyHash, idempotencyKeyHash);
    assert.equal(apply.body?.signedRequest?.request?.idempotencyKeyHash, idempotencyKeyHash);
    assert.equal(apply.body?.auth?.session?.id, session);
    assert.equal(apply.body?.applyRevalidation?.phase, 'before-first-mutation');
    assert.equal(apply.body?.applyRevalidation?.checkedAgainst, 'live-remote');
    await assertCurrentSurface(client, localSnapshot, 'production-shaped apply final source');

    const conflictPayload = {
      ...applyPayload,
      rpp0517ConflictProbe: {
        type: 'same-key-different-body-conflict-before-mutation',
        schemaVersion: 1,
      },
    };
    const conflict = await client.signedPost('/apply', conflictPayload, {
      session,
      idempotencyKey,
    });
    assert.equal(conflict.status, 409, `production-shaped conflict HTTP ${conflict.status}`);
    assert.equal(conflict.request?.pathname, endpointPaths.apply);
    assert.equal(conflict.body?.ok, false);
    assert.equal(conflict.body?.code, 'IDEMPOTENCY_KEY_CONFLICT');
    assert.equal(conflict.body?.mode, 'apply');
    assert.equal(conflict.body?.idempotency?.replayed, false);
    assert.equal(conflict.body?.idempotency?.conflict, true);
    assert.equal(conflict.body?.idempotency?.freshMutationWork, false);
    assert.equal(conflict.body?.idempotency?.status, 'conflict');
    assert.equal(conflict.body?.idempotency?.idempotencyKeyHash, idempotencyKeyHash);
    assert.notEqual(conflict.body?.idempotency?.requestHash, apply.body?.idempotency?.requestHash);
    assert.equal(conflict.body?.idempotency?.conflictingRequestHash, apply.body?.idempotency?.requestHash);
    assert.deepEqual(conflict.body?.idempotency?.mutationEventCounts, {
      prepared: 0,
      applied: 0,
      preconditionFailed: 0,
    });
    assert.equal(conflict.body?.dbJournal?.event, 'idempotency-key-conflict');
    assert.equal(conflict.body?.signedRequest?.request?.idempotencyKeyHash, idempotencyKeyHash);
    assert.equal(conflict.body?.auth?.session?.id, session);

    await assertCurrentSurface(client, localSnapshot, 'same-key different-body conflict must not mutate');
    const journalAfterConflict = await signedJournal(client, session, 'rpp-0517-journal-after-conflict');
    const rowsAfterConflict = journalRows(journalAfterConflict);
    assert.equal(countJournalEvents(rowsAfterConflict, 'idempotency-opened'), 1, 'conflict must not open a second idempotency claim');
    assert.equal(countJournalEvents(rowsAfterConflict, 'apply-committed'), 1, 'conflict must not commit a second apply');
    assert.equal(countJournalEvents(rowsAfterConflict, 'mutation-applied'), readyPlan.mutations.length, 'conflict must not add mutation work');
    assert.equal(countJournalEvents(rowsAfterConflict, 'idempotency-key-conflict'), 1, 'conflict journal evidence missing');
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

function basicAuthorizationHeader() {
  return `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`;
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
  const bodyText = body === undefined ? undefined : JSON.stringify(body);
  return requestRaw(baseUrl, method, pathname, bodyText, body === undefined ? headers : { 'content-type': 'application/json', ...headers }, { attempts });
}

async function requestRaw(baseUrl, method, pathname, bodyText = undefined, headers = {}, { attempts = 1 } = {}) {
  let lastError;
  const maxAttempts = method === 'GET' ? attempts : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await requestRawOnce(baseUrl, method, pathname, bodyText, headers);
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

async function requestRawOnce(baseUrl, method, pathname, bodyText = undefined, headers = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { connection: 'close', ...headers },
    body: bodyText,
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
