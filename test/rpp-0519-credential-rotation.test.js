import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticatedHttpClient } from '../src/authenticated-http-push-client.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routeSourcePath = path.join(repoRoot, 'scripts/playground/push-remote-rest-plugin.php');
const routeSource = readFileSync(routeSourcePath, 'utf8');
const muPluginDir = path.join(repoRoot, 'scripts/playground/rest-mu-plugins');
const blueprintPath = path.join(repoRoot, 'fixtures/playground/remote-base.blueprint.json');
const localEditedSnapshotPath = path.join(repoRoot, 'fixtures/playground/local-edited.snapshot.json');
const localEditedSnapshot = withoutUnmappedGraphPostmeta(JSON.parse(readFileSync(localEditedSnapshotPath, 'utf8')));
const routeIndexPath = '/reprint/v1/push/preflight';
const authScope = 'reprint-push-lab:authenticated-http-push';
const startupTimeoutMs = Number(process.env.REPRINT_PUSH_RPP0519_LIVE_TIMEOUT_MS || 120_000);
const requestTimeoutMs = Number(process.env.REPRINT_PUSH_RPP0519_REQUEST_TIMEOUT_MS || 30_000);
const fixedNow = new Date('2026-05-30T00:00:00.000Z');

const credentials = {
  current: {
    username: 'reprint_push_admin',
    password: 'reprint-push-admin-app-password',
  },
  rotated: {
    username: 'reprint_push_admin',
    password: 'reprint-push-admin-rotated-app-password',
  },
  invalidated: {
    username: 'reprint_push_admin',
    password: 'reprint-push-admin-invalidated-rpp-0519',
  },
};

test('RPP-0519 signed sessions bind credential, scope, and source before mutation admission', () => {
  const verifySignedRequest = functionBody('reprint_push_lab_rest_verify_signed_request');
  const mintSession = functionBody('reprint_push_lab_rest_mint_signed_session');
  const validateReceipt = functionBody('reprint_push_lab_rest_validate_authenticated_receipt');
  const applyCallback = functionBody('reprint_push_lab_rest_authenticated_apply');

  assert.match(mintSession, /'credentialHash'\s*=>\s*\(string\)\s*\(\$auth\['credentialHash'\]/);
  assert.match(mintSession, /'applicationPasswordUuid'\s*=>\s*\(string\)\s*\(\$auth\['applicationPasswordUuid'\]/);
  assert.match(mintSession, /'scope'\s*=>\s*REPRINT_PUSH_LAB_AUTH_SCOPE/);
  assert.match(mintSession, /'signingKeyHash'\s*=>\s*\$signing_key_hash/);
  assert.match(mintSession, /'sourceHash'\s*=>\s*\(string\)\s*\(\$source_identity\['sourceHash'\]/);
  assert.match(mintSession, /'sourceUrlHash'\s*=>\s*\(string\)\s*\(\$source_identity\['sourceUrlHash'\]/);

  assert.match(verifySignedRequest, /'SIGNED_SESSION_BINDING_MISMATCH'/);
  assertBefore(verifySignedRequest, "$session['credentialHash']", '$canonical = reprint_push_lab_rest_push_canonical_string');
  assertBefore(verifySignedRequest, "$session['signingKeyHash']", '$canonical = reprint_push_lab_rest_push_canonical_string');
  assertBefore(verifySignedRequest, "$session['scope']", '$canonical = reprint_push_lab_rest_push_canonical_string');
  assertBefore(verifySignedRequest, "$session['sourceHash']", '$canonical = reprint_push_lab_rest_push_canonical_string');
  assertBefore(verifySignedRequest, "$session['sourceUrlHash']", '$canonical = reprint_push_lab_rest_push_canonical_string');
  assertBefore(verifySignedRequest, "'SIGNED_SESSION_BINDING_MISMATCH'", 'reprint_push_lab_rest_claim_signed_nonce');

  assert.match(validateReceipt, /\$session\['applicationPasswordUuid'\]/);
  assert.match(validateReceipt, /\$session\['credentialHash'\]/);
  assert.match(validateReceipt, /Receipt auth identity or session does not match the current request\./);
  assertBefore(
    applyCallback,
    'reprint_push_lab_rest_validate_authenticated_receipt($request, $payload, $plan, $receipt_payload)',
    'reprint_push_lab_rest_apply_with_db_journal($request, true)',
  );
});

test('RPP-0519 production-shaped apply rejects rotated and invalidated credentials before mutation', { timeout: startupTimeoutMs + 75_000 }, async () => {
  await withPlaygroundServer('rpp-0519-credential-rotation', async (server) => {
    const index = await requestJson(server.baseUrl, 'GET', '/wp-json/');
    assert.equal(index.status, 200, `REST index HTTP ${index.status}`);
    assertRoute(index.body, routeIndexPath, 'GET');

    const currentClient = clientFor(server, credentials.current);
    const invalidatedClient = clientFor(server, credentials.invalidated);
    const rotatedClient = clientFor(server, credentials.rotated);

    const base = await exportSnapshot(server);
    const planningBase = withoutExecutorAuthBootstrapRows(base);
    const planningLocal = withoutExecutorAuthBootstrapRows(localEditedSnapshot);
    const sourcePlan = createPushPlan({
      base: planningBase,
      local: planningLocal,
      remote: planningBase,
      now: fixedNow,
    });
    const plan = readyPlanFromSupportedMutations(sourcePlan);
    assert.equal(plan.status, 'ready');
    assert.ok(plan.mutations.length > 0, 'RPP-0519 proof needs a mutating ready plan');

    const preflight = await currentClient.signedGet('/preflight');
    assert.equal(preflight.status, 200, `current credential preflight HTTP ${preflight.status}`);
    assert.equal(preflight.body?.ok, true);
    assert.equal(preflight.body?.auth?.scope, authScope);
    assert.equal(preflight.body?.auth?.identity?.userLogin, credentials.current.username);
    assert.equal(preflight.body?.auth?.session?.credentialScope, authScope);
    assert.equal(preflight.body?.auth?.session?.credentialType, 'push-application-password');
    assert.match(preflight.body?.auth?.session?.credentialHash || '', /^[a-f0-9]{64}$/);
    assert.equal(preflight.body?.auth?.session?.credentialHash === credentials.current.password, false);
    const session = preflight.body?.session?.id;
    assert.match(session || '', /^[A-Za-z0-9_-]{32,160}$/);

    const rotatedPreflight = await rotatedClient.signedGet('/preflight');
    assert.equal(rotatedPreflight.status, 200, `rotated credential preflight HTTP ${rotatedPreflight.status}: ${JSON.stringify(rotatedPreflight.body)}`);
    assert.equal(rotatedPreflight.body?.ok, true);
    assert.equal(rotatedPreflight.body?.auth?.identity?.userLogin, credentials.current.username);
    assert.notEqual(
      rotatedPreflight.body?.auth?.session?.credentialHash,
      preflight.body?.auth?.session?.credentialHash,
      'rotated credential must be a distinct credential binding',
    );

    const idempotencyKey = `rpp-0519-credential-rotation-${Date.now()}-${process.pid}`;
    const dryRun = await currentClient.signedPost('/dry-run', { plan }, { session, idempotencyKey });
    assert.equal(dryRun.status, 200, `current credential dry-run HTTP ${dryRun.status}: ${JSON.stringify(dryRun.body)}`);
    assert.equal(dryRun.body?.ok, true);
    assert.equal(dryRun.body?.mode, 'dry-run');
    assert.equal(dryRun.body?.receipt?.authBinding?.scope, authScope);
    assert.equal(
      dryRun.body?.receipt?.authBinding?.session?.credentialHash,
      preflight.body?.auth?.session?.credentialHash,
    );
    assert.equal(
      dryRun.body?.receipt?.authBinding?.session?.applicationPasswordUuid,
      preflight.body?.auth?.session?.applicationPasswordUuid,
    );
    const receipt = dryRun.body.receipt;
    const beforeFailures = await exportSnapshot(server);
    assertTargetSurfaceEqual(beforeFailures, base, 'dry-run must not mutate before credential rotation checks');

    const applyBody = { plan, receipt };
    const invalidatedApply = await invalidatedClient.signedPost('/apply', applyBody, {
      session,
      idempotencyKey,
    });
    assert.equal(invalidatedApply.status, 401, `invalidated credential apply HTTP ${invalidatedApply.status}`);
    assert.equal(invalidatedApply.body?.code, 'reprint_push_lab_auth_required');
    await assertNoMutation(server, beforeFailures, 'invalidated credential apply');

    const rotatedApply = await rotatedClient.signedPost('/apply', applyBody, {
      session,
      idempotencyKey,
    });
    assert.equal(rotatedApply.status, 401, `rotated credential apply HTTP ${rotatedApply.status}`);
    assert.equal(rotatedApply.body?.code, 'SIGNED_SESSION_BINDING_MISMATCH');
    await assertNoMutation(server, beforeFailures, 'rotated credential apply');

    const currentApply = await currentClient.signedPost('/apply', applyBody, {
      session,
      idempotencyKey,
    });
    assert.equal(currentApply.status, 200, `current credential apply HTTP ${currentApply.status}`);
    assert.equal(currentApply.body?.ok, true);
    assert.equal(currentApply.body?.auth?.scope, authScope);
    assert.equal(currentApply.body?.auth?.session?.id, session);
    assert.equal(
      currentApply.body?.auth?.session?.credentialHash,
      preflight.body?.auth?.session?.credentialHash,
    );
    assert.equal(currentApply.body?.applyRevalidation?.phase, 'before-first-mutation');
    assert.equal(currentApply.body?.applyRevalidation?.checkedAgainst, 'live-remote');
    assert.equal(currentApply.body?.applyRevalidation?.verifiedCount, plan.mutations.length);

    const afterCurrentApply = await exportSnapshot(server);
    assertPlanMutationsApplied(afterCurrentApply, planningLocal, plan, 'current credential apply');
    assert.notEqual(
      digest(targetSurface(afterCurrentApply)),
      digest(targetSurface(beforeFailures)),
      'current credential apply must be the first mutating request',
    );
  });
});

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

function clientFor(server, credential) {
  return authenticatedHttpClient({
    sourceUrl: server.baseUrl,
    credential,
    routeProfile: 'production-shaped',
    requestTimeoutMs,
  });
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
      REPRINT_PUSH_LAB_AUTH_ADMIN_USER: credentials.current.username,
      REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: credentials.current.password,
      REPRINT_PUSH_LAB_AUTH_ALT_ADMIN_USER: credentials.rotated.username,
      REPRINT_PUSH_LAB_AUTH_ALT_ADMIN_APP_PASSWORD: credentials.rotated.password,
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

async function exportSnapshot(server) {
  const response = await requestJson(
    server.baseUrl,
    'GET',
    '/wp-json/reprint-push-lab/v1/snapshot',
    undefined,
    authHeaders(credentials.current),
  );
  assert.equal(response.status, 200, `snapshot HTTP ${response.status}`);
  assert.equal(response.body?.ok, true, 'snapshot response not ok');
  assert.ok(response.body?.snapshot, 'snapshot response missing snapshot');
  return response.body.snapshot;
}

async function assertNoMutation(server, expectedSnapshot, label) {
  const after = await exportSnapshot(server);
  assertTargetSurfaceEqual(after, expectedSnapshot, label);
}

function readyPlanFromSupportedMutations(sourcePlan) {
  if (sourcePlan.status === 'ready') {
    return sourcePlan;
  }

  assert.equal(sourcePlan.conflicts.length, 0, 'RPP-0519 refuses to focus a conflicted plan');
  assert.ok(sourcePlan.mutations.length > 0, 'RPP-0519 needs planner-produced supported mutations');

  const mutationIds = new Set(sourcePlan.mutations.map((mutation) => mutation.id));
  const focused = structuredClone(sourcePlan);
  focused.id = `${sourcePlan.id}-rpp-0519-supported-mutations`;
  focused.status = 'ready';
  focused.mutations = focused.mutations.filter((mutation) => mutationIds.has(mutation.id));
  focused.preconditions = focused.preconditions.filter((precondition) => mutationIds.has(precondition.mutationId));
  focused.conflicts = [];
  focused.blockers = [];
  focused.decisions = [];
  focused.atomicGroups = focused.atomicGroups.filter((group) =>
    focused.mutations.some((mutation) => mutation.atomicGroupId && mutation.atomicGroupId === group.id),
  );
  focused.summary = {
    mutations: focused.mutations.length,
    decisions: focused.decisions.length,
    conflicts: focused.conflicts.length,
    blockers: focused.blockers.length,
    atomicGroups: focused.atomicGroups.length,
  };

  assert.equal(focused.preconditions.length, focused.mutations.length);
  return focused;
}

function withoutUnmappedGraphPostmeta(snapshot) {
  const next = structuredClone(snapshot);
  delete next.db?.wp_postmeta?.['post_id:2001:meta_key:_reprint_push_forms_schema'];
  if (next.db?.wp_postmeta && Object.keys(next.db.wp_postmeta).length === 0) {
    delete next.db.wp_postmeta;
  }
  return next;
}

function withoutExecutorAuthBootstrapRows(snapshot) {
  const next = structuredClone(snapshot);
  delete next.db?.wp_users;
  delete next.db?.wp_usermeta;
  return next;
}

function assertPlanMutationsApplied(actual, expected, plan, label) {
  for (const mutation of plan.mutations) {
    assert.equal(
      resourceHash(actual, mutation.resource),
      resourceHash(expected, mutation.resource),
      `${label}: ${mutation.resourceKey}`,
    );
  }
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
