#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { releaseVerifyFixtureCredentials } from './release-verify-credentials.js';
import { shouldRequestPackagedProductionPluginAuthSession } from './packaged-production-plugin-source-command.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const muPluginDir = path.join(repoRoot, 'scripts/playground/rest-mu-plugins');
const remoteBaseFixturePath = path.join(repoRoot, 'fixtures/playground/remote-base.blueprint.json');
const serverStartupTimeoutMs = 30_000;
const readinessProbeIntervalMs = 500;

const credentials = {
  username: releaseVerifyFixtureCredentials.username,
  applicationPassword: releaseVerifyFixtureCredentials.applicationPassword,
};
const packagedBoundaryRequested = shouldRequestPackagedProductionPluginAuthSession({
  requireProductionAuthSession: process.env.REPRINT_PUSH_REQUIRE_PRODUCTION_AUTH_SESSION === '1',
  authSessionSourceCommand: process.env.REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND || '',
  liveSourceUrl: process.env.REPRINT_PUSH_SOURCE_URL || process.env.REPRINT_PUSH_REMOTE_URL || '',
  username: process.env.REPRINT_PUSH_USERNAME || process.env.REPRINT_PUSH_LAB_AUTH_ADMIN_USER || '',
  applicationPassword: process.env.REPRINT_PUSH_APPLICATION_PASSWORD || process.env.REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD || '',
  fixtureUsername: credentials.username,
  fixtureApplicationPassword: credentials.applicationPassword,
});
const innerVerifyTimeoutMs = packagedBoundaryRequested ? 180_000 : 90_000;
const applyRevalidationTimeoutMs = packagedBoundaryRequested ? 60_000 : 45_000;

if (packagedBoundaryRequested) {
  const verify = runCheckedReleaseVerify();
  const applyRevalidation = runApplyRevalidationProof();
  emitCombinedReleaseProof(verify, applyRevalidation);
} else {
  await withPlaygroundServer('remote-base', remoteBaseFixturePath, async (remoteServer) => {
    const verify = runCheckedReleaseVerify({
      REPRINT_PUSH_SOURCE_URL: remoteServer.baseUrl,
      REPRINT_PUSH_REMOTE_URL: remoteServer.baseUrl,
      REPRINT_PUSH_USERNAME: credentials.username,
      REPRINT_PUSH_APPLICATION_PASSWORD: credentials.applicationPassword,
      REPRINT_PUSH_LAB_AUTH_ADMIN_USER: credentials.username,
      REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: credentials.applicationPassword,
    });
    const applyRevalidation = runApplyRevalidationProof();
    emitCombinedReleaseProof(verify, applyRevalidation);
  });
}

function runCheckedReleaseVerify(envOverrides = {}) {
  const verify = spawnSync(process.execPath, ['scripts/playground/production-shaped-release-verify.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: innerVerifyTimeoutMs,
    killSignal: 'SIGKILL',
    maxBuffer: 1024 * 1024 * 20,
    env: {
      ...process.env,
      ...envOverrides,
      NODE_NO_WARNINGS: '1',
    },
  });

  process.stderr.write(verify.stderr || '');
  assert.equal(verify.error, undefined, verify.error?.stack || verify.stderr || verify.stdout);
  assert.equal(verify.signal, null, verify.stderr || verify.stdout);
  assert.equal(verify.status, 0, verify.stderr || verify.stdout);
  return parseJsonOutput(verify.stdout, 'checked live release verify');
}

function runApplyRevalidationProof() {
  const proof = spawnSync(process.execPath, ['scripts/playground/production-shaped-apply-revalidation-smoke.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: applyRevalidationTimeoutMs,
    killSignal: 'SIGKILL',
    maxBuffer: 1024 * 1024 * 20,
    env: {
      ...process.env,
      NODE_NO_WARNINGS: '1',
    },
  });

  process.stderr.write(proof.stderr || '');
  assert.equal(proof.error, undefined, proof.error?.stack || proof.stderr || proof.stdout);
  assert.equal(proof.signal, null, proof.stderr || proof.stdout);
  assert.equal(proof.status, 0, proof.stderr || proof.stdout);

  const summary = parseJsonOutput(proof.stdout, 'apply revalidation proof');
  return {
    ok: summary.ok === true,
    topology: summary.topology || null,
    preflight: {
      status: summary.preflight?.status ?? null,
      routeProfile: summary.preflight?.routeProfile?.profile || summary.preflight?.routeProfile || null,
      sessionType: summary.preflight?.session?.type || null,
    },
    dryRun: {
      status: summary.dryRun?.status ?? null,
      mode: summary.dryRun?.mode || null,
      receiptHash: summary.dryRun?.receiptHash || null,
    },
    apply: summary.apply || null,
    recoveryInspect: summary.recoveryInspect || null,
    boundary: summary.boundary || null,
  };
}

function emitCombinedReleaseProof(verify, applyRevalidation) {
  process.stdout.write(
    JSON.stringify(
      {
        ...verify,
        applyRevalidation,
      },
      null,
      2,
    ),
  );
  process.stdout.write('\n');
}

function parseJsonOutput(stdout, label) {
  const trimmed = (stdout || '').trim();
  const firstBrace = trimmed.indexOf('{');
  assert.notEqual(firstBrace, -1, `${label} did not emit JSON\n${stdout}`);
  return JSON.parse(trimmed.slice(firstBrace));
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
  const args = [
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
  ];

  const child = spawn('npx', args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      REPRINT_PUSH_LAB_AUTH_BOOTSTRAP: '1',
      REPRINT_PUSH_LAB_AUTH_ADMIN_USER: credentials.username,
      REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: credentials.applicationPassword,
      NODE_OPTIONS: appendNodeOption(process.env.NODE_OPTIONS, localhostListenPreloadOption()),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });

  await waitForServer(child, baseUrl, () => output);

  return { name, baseUrl, child };
}

async function stopPlaygroundServer(server) {
  if (server.child.exitCode !== null) {
    return;
  }
  server.child.kill('SIGTERM');
  await waitForExit(server.child, 12_000);
}

async function waitForServer(child, baseUrl, getLogs) {
  const deadline = Date.now() + serverStartupTimeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Playground server exited early with ${child.exitCode}\n${getLogs()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/wp-json/`);
      if (response.status === 200) {
        await response.arrayBuffer();
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, readinessProbeIntervalMs));
  }
  throw new Error(`Timed out waiting for Playground server at ${baseUrl}\n${getLogs()}`);
}

async function waitForExit(child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill('SIGKILL');
  while (child.exitCode === null) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function findLocalPort() {
  for (;;) {
    const port = 30000 + Math.floor(Math.random() * 20000);
    if (await isPortFree(port)) {
      return port;
    }
  }
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const socket = net.createServer();
    socket.once('error', () => resolve(false));
    socket.once('listening', () => socket.close(() => resolve(true)));
    socket.listen(port, '127.0.0.1');
  });
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
