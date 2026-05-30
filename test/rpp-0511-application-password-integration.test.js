import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticatedHttpClient } from '../src/authenticated-http-push-client.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const muPluginDir = path.join(repoRoot, 'scripts/playground/rest-mu-plugins');
const blueprintPath = path.join(repoRoot, 'fixtures/playground/remote-base.blueprint.json');
const endpointPath = '/wp-json/reprint/v1/push/preflight';
const routeIndexPath = '/reprint/v1/push/preflight';
const authScope = 'reprint-push-lab:authenticated-http-push';
const startupTimeoutMs = Number(process.env.REPRINT_PUSH_RPP0511_LIVE_TIMEOUT_MS || 120_000);
const requestTimeoutMs = Number(process.env.REPRINT_PUSH_RPP0511_REQUEST_TIMEOUT_MS || 30_000);
const credentials = {
  username: 'reprint_push_admin',
  password: 'reprint-push-admin-app-password',
};

test('RPP-0511 production-shaped preflight accepts a scoped WordPress Application Password on a live URL', { timeout: startupTimeoutMs + 45_000 }, async () => {
  await withPlaygroundServer('rpp-0511-application-password-integration', async (server) => {
    const index = await requestJson(server.baseUrl, 'GET', '/wp-json/');
    assert.equal(index.status, 200, `REST index HTTP ${index.status}`);
    assertRoute(index.body, routeIndexPath, 'GET');

    const rejectedClient = authenticatedHttpClient({
      sourceUrl: server.baseUrl,
      credential: {
        username: credentials.username,
        password: 'wrong-application-password',
      },
      routeProfile: 'production-shaped',
      requestTimeoutMs,
    });
    const rejected = await rejectedClient.signedGet('/preflight');
    assert.equal(rejected.status, 401, `wrong Application Password HTTP ${rejected.status}`);
    assert.equal(rejected.body?.code, 'reprint_push_lab_auth_required');

    const client = authenticatedHttpClient({
      sourceUrl: server.baseUrl,
      credential: credentials,
      routeProfile: 'production-shaped',
      requestTimeoutMs,
    });
    const preflight = await client.signedGet('/preflight');

    assert.equal(preflight.status, 200, `Application Password preflight HTTP ${preflight.status}`);
    assert.equal(preflight.request?.pathname, endpointPath);
    assert.equal(preflight.body?.ok, true);
    assert.equal(preflight.body?.mode, 'preflight');
    assert.equal(preflight.body?.routeProfile?.profile, 'production-shaped');
    assert.equal(preflight.body?.auth?.scope, authScope);
    assert.equal(preflight.body?.auth?.identity?.userLogin, credentials.username);
    assert.equal(preflight.body?.auth?.identity?.capabilities?.manage_options, true);
    assert.equal(preflight.body?.auth?.session?.type, 'production-auth-session');
    assert.equal(preflight.body?.auth?.session?.status, 'active');
    assert.equal(preflight.body?.auth?.session?.verifier, 'wordpress-core-application-password');
    assert.equal(preflight.body?.auth?.session?.credentialScope, authScope);
    assert.equal(preflight.body?.auth?.session?.credentialType, 'push-application-password');
    assert.match(preflight.body?.auth?.session?.applicationPasswordUuid || '', /^[a-f0-9-]{36}$/);
    assert.match(preflight.body?.auth?.session?.applicationPasswordAppId || '', /^[a-f0-9-]{36}$/);
    assert.match(preflight.body?.auth?.session?.credentialHash || '', /^[a-f0-9]{64}$/);
    assert.equal(preflight.body?.auth?.session?.credentialHash === credentials.password, false);
    assert.equal(JSON.stringify(preflight.body).includes(credentials.password), false, 'response must not leak the raw Application Password');
    assert.equal(preflight.body?.auth?.session?.id, preflight.body?.session?.id);
    assert.equal(preflight.body?.session?.type, 'production-auth-session');
    assert.match(preflight.body?.session?.id || '', /^[A-Za-z0-9_-]{32,160}$/);
    assert.match(preflight.body?.session?.sessionHash || '', /^[a-f0-9]{64}$/);
    assert.match(preflight.body?.session?.signingKeyHash || '', /^[a-f0-9]{64}$/);
    assert.equal(preflight.body?.sessionStore?.type, 'wp-options');
  });
});

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
