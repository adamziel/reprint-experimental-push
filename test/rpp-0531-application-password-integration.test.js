import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticatedHttpClient } from '../src/authenticated-http-push-client.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const muPluginDir = path.join(repoRoot, 'scripts/playground/rest-mu-plugins');
const blueprintPath = path.join(repoRoot, 'fixtures/playground/remote-base.blueprint.json');
const endpointPath = '/wp-json/reprint/v1/push/preflight';
const preflightRouteIndexPath = '/reprint/v1/push/preflight';
const usersMeRouteIndexPath = '/wp/v2/users/me';
const authScope = 'reprint-push-lab:authenticated-http-push';
const startupTimeoutMs = Number(process.env.REPRINT_PUSH_RPP0531_LIVE_TIMEOUT_MS || 120_000);
const requestTimeoutMs = Number(process.env.REPRINT_PUSH_RPP0531_REQUEST_TIMEOUT_MS || 30_000);
const scopedCredentials = {
  username: 'reprint_push_admin',
  password: 'reprint-push-admin-app-password',
};
const unscopedCredentials = {
  username: 'rpp_0531_unscoped_admin',
  password: 'rpp-0531-unscoped-app-password',
};

test('RPP-0531 proves scoped Application Password integration on a live production-shaped endpoint', { timeout: startupTimeoutMs + 60_000 }, async () => {
  await withPlaygroundServer('rpp-0531-application-password-integration', async (server) => {
    const index = await requestJson(server.baseUrl, 'GET', '/wp-json/');
    assert.equal(index.status, 200, `REST index HTTP ${index.status}`);
    assertRoute(index.body, preflightRouteIndexPath, 'GET');
    assertRoute(index.body, usersMeRouteIndexPath, 'GET');

    const unscopedCore = await requestJson(
      server.baseUrl,
      'GET',
      '/wp-json/wp/v2/users/me?context=edit',
      undefined,
      authHeaders(unscopedCredentials),
    );
    assert.equal(unscopedCore.status, 200, `unscoped core users/me HTTP ${unscopedCore.status}`);
    assert.equal(unscopedCore.body?.username, unscopedCredentials.username);
    assert.ok(
      Array.isArray(unscopedCore.body?.roles) && unscopedCore.body.roles.includes('administrator'),
      'unscoped Application Password should authenticate an administrator to a core REST endpoint',
    );

    const unscopedClient = authenticatedHttpClient({
      sourceUrl: server.baseUrl,
      credential: unscopedCredentials,
      routeProfile: 'production-shaped',
      requestTimeoutMs,
    });
    const unscopedPreflight = await unscopedClient.signedGet('/preflight');
    assert.equal(unscopedPreflight.status, 401, `unscoped push preflight HTTP ${unscopedPreflight.status}`);
    assert.equal(unscopedPreflight.body?.code, 'reprint_push_lab_auth_required');

    const scopedCore = await requestJson(
      server.baseUrl,
      'GET',
      '/wp-json/wp/v2/users/me?context=edit',
      undefined,
      authHeaders(scopedCredentials),
    );
    assert.equal(scopedCore.status, 200, `scoped core users/me HTTP ${scopedCore.status}`);
    assert.equal(scopedCore.body?.username, scopedCredentials.username);

    const scopedClient = authenticatedHttpClient({
      sourceUrl: server.baseUrl,
      credential: scopedCredentials,
      routeProfile: 'production-shaped',
      requestTimeoutMs,
    });
    const preflight = await scopedClient.signedGet('/preflight');

    assert.equal(preflight.status, 200, `scoped Application Password preflight HTTP ${preflight.status}`);
    assert.equal(preflight.request?.pathname, endpointPath);
    assert.equal(preflight.body?.ok, true);
    assert.equal(preflight.body?.mode, 'preflight');
    assert.equal(preflight.body?.routeProfile?.profile, 'production-shaped');
    assert.equal(preflight.body?.auth?.identity?.userLogin, scopedCredentials.username);
    assert.equal(preflight.body?.auth?.identity?.capabilities?.manage_options, true);
    assert.equal(preflight.body?.auth?.session?.type, 'production-auth-session');
    assert.equal(preflight.body?.auth?.session?.status, 'active');
    assert.equal(preflight.body?.auth?.session?.verifier, 'wordpress-core-application-password');
    assert.equal(preflight.body?.auth?.session?.playgroundFallback, false);
    assert.equal(preflight.body?.auth?.session?.credentialScope, authScope);
    assert.equal(preflight.body?.auth?.session?.credentialType, 'push-application-password');
    assert.match(preflight.body?.auth?.session?.applicationPasswordUuid || '', /^[a-f0-9-]{36}$/);
    assert.match(preflight.body?.auth?.session?.applicationPasswordAppId || '', /^[a-f0-9-]{36}$/);
    assert.match(preflight.body?.auth?.session?.credentialHash || '', /^[a-f0-9]{64}$/);
    assert.equal(preflight.body?.auth?.session?.credentialHash === scopedCredentials.password, false);
    assert.equal(JSON.stringify(preflight.body).includes(scopedCredentials.password), false, 'response must not leak the scoped raw Application Password');
    assert.equal(JSON.stringify(preflight.body).includes(unscopedCredentials.password), false, 'response must not leak the unscoped raw Application Password');
    assert.equal(preflight.body?.auth?.session?.id, preflight.body?.session?.id);
    assert.equal(preflight.body?.session?.type, 'production-auth-session');
    assert.equal(preflight.body?.session?.applicationPasswordUuid, preflight.body?.auth?.session?.applicationPasswordUuid);
    assert.match(preflight.body?.session?.id || '', /^[A-Za-z0-9_-]{32,160}$/);
    assert.match(preflight.body?.session?.sessionHash || '', /^[a-f0-9]{64}$/);
    assert.match(preflight.body?.session?.userIdentityHash || '', /^[a-f0-9]{64}$/);
    assert.match(preflight.body?.session?.capabilityHash || '', /^[a-f0-9]{64}$/);
    assert.match(preflight.body?.session?.sourceUrlHash || '', /^[a-f0-9]{64}$/);
    assert.match(preflight.body?.session?.signingKeyHash || '', /^[a-f0-9]{64}$/);
    assert.equal(preflight.body?.sessionStore?.type, 'wp-options');

    const snapshot = await scopedClient.get('/snapshot');
    assert.equal(snapshot.status, 200, `scoped Application Password snapshot HTTP ${snapshot.status}`);
    assert.equal(snapshot.request?.pathname, '/wp-json/reprint/v1/push/snapshot');
    assert.equal(snapshot.body?.ok, true);
    assert.ok(snapshot.body?.snapshot?.db, 'scoped Application Password should authorize the adjacent read endpoint');
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
  const tempDir = await mkdtemp(path.join(tmpdir(), `${name}-`));
  const liveBlueprintPath = path.join(tempDir, 'blueprint.json');
  await writeFile(liveBlueprintPath, await liveBlueprintSource(), 'utf8');
  const child = spawn('npx', [
    '--yes',
    '@wp-playground/cli@latest',
    'server',
    '--blueprint',
    liveBlueprintPath,
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
      REPRINT_PUSH_LAB_AUTH_ADMIN_USER: scopedCredentials.username,
      REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: scopedCredentials.password,
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
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }

  return { name, port, baseUrl, child, logs, tempDir };
}

async function stopPlaygroundServer(server) {
  await stopChildProcess(server.child);
  assert.equal(await isPortAccepting(server.port), false, `Playground server still accepts connections on ${server.baseUrl}`);
  await rm(server.tempDir, { recursive: true, force: true });
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
      if (index.status === 200 && index.body?.routes?.[preflightRouteIndexPath]) {
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
    signal: AbortSignal.timeout(requestTimeoutMs),
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

function authHeaders(credentials) {
  return {
    authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`,
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

async function liveBlueprintSource() {
  const blueprint = JSON.parse(await readFile(blueprintPath, 'utf8'));
  blueprint.meta = {
    ...blueprint.meta,
    title: 'RPP-0531 Application Password Integration',
    description: 'Remote base fixture with one valid but unscoped Application Password for live endpoint proof.',
  };
  blueprint.steps.push({
    step: 'runPHP',
    code: [
      '<?php',
      "require_once '/wordpress/wp-load.php';",
      '$login = ' + phpString(unscopedCredentials.username) + ';',
      '$app_password = ' + phpString(unscopedCredentials.password) + ';',
      '$user_id = wp_insert_user(array(',
      "'user_login' => $login,",
      "'user_pass' => wp_generate_password(32, true, true),",
      "'user_email' => sanitize_user($login, true) . '@example.test',",
      "'display_name' => $login,",
      "'role' => 'administrator',",
      '));',
      "if (is_wp_error($user_id)) { throw new RuntimeException($user_id->get_error_message()); }",
      "$uuid_seed = 'rpp-0531-unscoped-' . $login;",
      "$app_id_seed = 'rpp-0531-unscoped-app-' . $login;",
      '$stable_uuid = static function (string $seed): string {',
      '$hex = md5($seed);',
      "return substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-' . substr($hex, 12, 4) . '-' . substr($hex, 16, 4) . '-' . substr($hex, 20, 12);",
      '};',
      "$items = array(array('uuid' => $stable_uuid($uuid_seed), 'app_id' => $stable_uuid($app_id_seed), 'name' => 'RPP-0531 Unscoped Application Password', 'password' => wp_hash_password(preg_replace('/[^a-zA-Z0-9]/', '', $app_password)), 'created' => time(), 'last_used' => null, 'last_ip' => null));",
      "update_user_meta($user_id, '_application_passwords', $items);",
      "if (class_exists('WP_Application_Passwords')) { update_network_option(get_main_network_id(), WP_Application_Passwords::OPTION_KEY_IN_USE, true); }",
    ].join(' '),
  });
  return JSON.stringify(blueprint, null, 2);
}

function phpString(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
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
