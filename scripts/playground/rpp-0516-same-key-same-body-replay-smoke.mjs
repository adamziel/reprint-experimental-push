#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAuthenticatedHttpPush } from '../../src/authenticated-http-push-client.js';
import { digest } from '../../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const muPluginDir = path.join(repoRoot, 'scripts/playground/rest-mu-plugins');
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
const localSnapshot = withoutUnmappedGraphPostmeta(snapshots.local);
const idempotencyKey = 'rpp-0516-live-local-same-key-same-body';

const result = {
  ok: false,
  rpp: 'RPP-0516',
  endpoint: {
    kind: 'disposable WordPress Playground REST endpoint',
    routeProfile: 'production-shaped',
    namespace: 'reprint/v1',
    routePrefix: '/push',
    sourceUrlHash: null,
  },
  sameKeySameBodyReplay: null,
  dbJournal: null,
};

await withPlaygroundServer('rpp-0516-remote-base', path.join(repoRoot, fixtures.base), async (server) => {
  const proof = await runAuthenticatedHttpPush({
    sourceUrl: server.baseUrl,
    base: snapshots.base,
    local: localSnapshot,
    username: credentials.username,
    applicationPassword: credentials.password,
    idempotencyKey,
    routeProfile: 'production-shaped',
    now: new Date('2026-05-30T00:00:00.000Z'),
  });

  const eventNames = Array.isArray(proof.dbJournal?.latestEvents)
    ? proof.dbJournal.latestEvents.map((entry) => entry.event)
    : [];

  assert.equal(proof.ok, true, JSON.stringify({
    code: proof.code,
    preflight: proof.preflight,
    dryRun: proof.dryRun,
    apply: proof.apply,
    replay: proof.replay,
    sameKeySameBodyReplay: proof.sameKeySameBodyReplay,
    dbJournal: proof.dbJournal,
    after: proof.after,
  }, null, 2));
  assert.equal(proof.preflight?.status, 200);
  assert.equal(proof.dryRun?.status, 200);
  assert.equal(proof.apply?.status, 200);
  assert.equal(proof.replay?.status, 200);
  assert.equal(proof.replay?.idempotency?.replayed, true);
  assert.equal(proof.replay?.idempotency?.freshMutationWork, false);
  assert.equal(proof.replayEquivalence?.equivalent, true);
  assert.equal(proof.sameKeySameBodyReplay?.proved, true);
  assert.equal(proof.sameKeySameBodyReplay?.signedContentHashesMatch, true);
  assert.equal(proof.sameKeySameBodyReplay?.signedContentHashMatchesSubmittedBody, true);
  assert.equal(proof.after?.finalMatchesLocal, true);
  assert.equal(proof.dbJournal?.status, 200);
  assert.ok(eventNames.includes('apply-replayed'), 'DB journal missing apply-replayed event');
  assert.equal(proof.dbJournal?.mutationApplied, proof.plan?.mutations);

  result.ok = true;
  result.endpoint.sourceUrlHash = digest(server.baseUrl);
  result.sameKeySameBodyReplay = {
    verdict: proof.sameKeySameBodyReplay.verdict,
    proved: proof.sameKeySameBodyReplay.proved,
    idempotencyKeyHash: proof.sameKeySameBodyReplay.idempotencyKeyHash,
    sessionHash: proof.sameKeySameBodyReplay.sessionHash,
    requestBodyHash: proof.sameKeySameBodyReplay.requestBodyHash,
    applyContentHash: proof.sameKeySameBodyReplay.applyContentHash,
    replayContentHash: proof.sameKeySameBodyReplay.replayContentHash,
    signedContentHashesMatch: proof.sameKeySameBodyReplay.signedContentHashesMatch,
    signedContentHashMatchesSubmittedBody: proof.sameKeySameBodyReplay.signedContentHashMatchesSubmittedBody,
    replayed: proof.sameKeySameBodyReplay.replayed,
    noFreshMutationWork: proof.sameKeySameBodyReplay.noFreshMutationWork,
    replayEquivalent: proof.sameKeySameBodyReplay.replayEquivalent,
  };
  result.dbJournal = {
    rows: proof.dbJournal.rows,
    mutationApplied: proof.dbJournal.mutationApplied,
    idempotencyOpened: proof.dbJournal.idempotencyOpened,
    hasApplyReplayed: eventNames.includes('apply-replayed'),
  };
});

console.log(JSON.stringify(result, null, 2));

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
      const response = await fetch(`${baseUrl}/wp-json/`, { headers: { connection: 'close' } });
      if (response.status === 200) {
        await response.arrayBuffer();
        const snapshot = await requestJsonWithRetry(
          baseUrl,
          'GET',
          '/wp-json/reprint/v1/push/snapshot',
          undefined,
          authHeaders(credentials),
          { attempts: 2 },
        );
        if (snapshot.status === 200 && snapshot.body?.ok === true) {
          return;
        }
        lastError = new Error(`Production-shaped snapshot readiness HTTP ${snapshot.status}`);
      } else {
        lastError = new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for Playground server at ${baseUrl}: ${lastError?.message || 'unknown'}\n${logs.join('')}`);
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

async function requestJsonWithRetry(baseUrl, method, pathname, body = undefined, headers = {}, { attempts = transientFetchAttempts } = {}) {
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

function authHeaders(credential) {
  return {
    authorization: `Basic ${Buffer.from(`${credential.username}:${credential.password}`, 'utf8').toString('base64')}`,
  };
}

function appendNodeOption(existing, option) {
  return existing ? `${existing} ${option}` : option;
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

function isTransientFetchError(error) {
  return error?.name === 'TimeoutError'
    || error?.name === 'AbortError'
    || error?.code === 'ECONNRESET'
    || error?.code === 'ECONNREFUSED'
    || /fetch failed|other side closed|socket|terminated/i.test(error?.message || '');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
