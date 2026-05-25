import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const muPluginDir = path.join(repoRoot, 'scripts/playground/rest-mu-plugins');
const serverStartupTimeoutMs = 120_000;
const runLivePlaygroundTopologyTests = process.env.REPRINT_RUN_PLAYGROUND_LIVE_TESTS === '1';
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const liveCredentials = {
  username: 'reprint_push_admin',
  password: 'reprint-push-admin-app-password',
};

test('production-shaped proof wrapper emits the checked proof summary and exact missing-secret gate', () => {
  const proof = spawnSync(process.execPath, ['scripts/playground/production-shaped-proof.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      REPRINT_PUSH_SIGNING_SECRET: '',
      REPRINT_PUSH_APPLICATION_PASSWORD: '',
    },
    encoding: 'utf8',
  });

  assert.equal(proof.status, 0);
  assert.match(proof.stdout, /"protocol": \{\s*"status": 0\s*\}/);
  assert.match(
    proof.stdout,
    /"missingSecret": \{\s*"status": 1,\s*"code": "REPRINT_PUSH_SECRET_REQUIRED",\s*"stderr": "REPRINT_PUSH_SECRET_REQUIRED: production push credentials are missing; provide REPRINT_PUSH_SIGNING_SECRET or REPRINT_PUSH_APPLICATION_PASSWORD before running preflight, dry-run, or apply\."\s*\}/,
  );
  assert.match(
    proof.stdout,
    /"missingLiveSource": \{\s*"status": 1,\s*"code": "REPRINT_PUSH_LIVE_SOURCE_REQUIRED",\s*"stderr": "REPRINT_PUSH_LIVE_SOURCE_REQUIRED: production push requires a live source URL; provide REPRINT_PUSH_SOURCE_URL before running preflight, dry-run, or apply\."\s*\}/,
  );
  assert.equal(proof.stderr, '');
  assert.ok(proof.stdout.includes('protocol'));
  assert.ok(proof.stdout.includes('missingSecret'));
  assert.ok(proof.stdout.includes('missingLiveSource'));
});

test('production-shaped live preflight smoke fails fast when the live source or auth inputs are missing', () => {
  const livePreflightScript = spawnSync('npm', ['run', 'test:playground:production-shaped-live-preflight'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      REPRINT_PUSH_SOURCE_URL: '',
      REPRINT_PUSH_REMOTE_URL: '',
      REPRINT_PUSH_USERNAME: 'reprint_push_admin',
      REPRINT_PUSH_APPLICATION_PASSWORD: 'reprint-push-admin-app-password',
    },
    encoding: 'utf8',
    shell: false,
  });

  assert.equal(livePreflightScript.status, 1);
  assert.equal(
    livePreflightScript.stderr.trim(),
    'REPRINT_PUSH_LIVE_SOURCE_REQUIRED: production push requires a live source URL; provide REPRINT_PUSH_SOURCE_URL before running preflight, dry-run, or apply.',
  );

  const missingSource = spawnSync(process.execPath, ['scripts/playground/production-shaped-live-preflight-smoke.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      REPRINT_PUSH_SOURCE_URL: '',
      REPRINT_PUSH_REMOTE_URL: '',
      REPRINT_PUSH_USERNAME: 'reprint_push_admin',
      REPRINT_PUSH_APPLICATION_PASSWORD: 'reprint-push-admin-app-password',
    },
    encoding: 'utf8',
  });

  assert.equal(missingSource.status, 1);
  assert.equal(
    missingSource.stderr.trim(),
    'REPRINT_PUSH_LIVE_SOURCE_REQUIRED: production push requires a live source URL; provide REPRINT_PUSH_SOURCE_URL before running preflight, dry-run, or apply.',
  );

  const missingAuth = spawnSync(process.execPath, ['scripts/playground/production-shaped-live-preflight-smoke.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      REPRINT_PUSH_SOURCE_URL: 'http://127.0.0.1:8080',
      REPRINT_PUSH_REMOTE_URL: 'http://127.0.0.1:8080',
      REPRINT_PUSH_USERNAME: '',
      REPRINT_PUSH_APPLICATION_PASSWORD: '',
    },
    encoding: 'utf8',
  });

  assert.equal(missingAuth.status, 1);
  assert.equal(
    missingAuth.stderr.trim(),
    'REPRINT_PUSH_SECRET_REQUIRED: production push credentials are missing; provide REPRINT_PUSH_LAB_AUTH_ADMIN_USER and REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD before running preflight, dry-run, or apply.',
  );
});

test('production-shaped release proof emits the exact gate output when no live source is supplied', () => {
  const proof = spawnSync(process.execPath, ['scripts/playground/production-shaped-release-proof.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      REPRINT_PUSH_SOURCE_URL: '',
      REPRINT_PUSH_REMOTE_URL: '',
      REPRINT_PUSH_USERNAME: '',
      REPRINT_PUSH_APPLICATION_PASSWORD: '',
      REPRINT_PUSH_LAB_AUTH_ADMIN_USER: '',
      REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: '',
    },
    encoding: 'utf8',
  });

  assert.equal(proof.status, 0);
  assert.match(proof.stdout, /"releaseProof": \{\s*"status": 0\s*\}/);
  assert.match(
    proof.stdout,
    /"missingSecret": \{\s*"status": 1,\s*"code": "REPRINT_PUSH_SECRET_REQUIRED",\s*"stderr": "REPRINT_PUSH_SECRET_REQUIRED: production push credentials are missing; provide REPRINT_PUSH_SIGNING_SECRET or REPRINT_PUSH_APPLICATION_PASSWORD before running preflight, dry-run, or apply\."\s*\}/,
  );
  assert.match(
    proof.stdout,
    /"missingLiveSource": \{\s*"status": 1,\s*"code": "REPRINT_PUSH_LIVE_SOURCE_REQUIRED",\s*"stderr": "REPRINT_PUSH_LIVE_SOURCE_REQUIRED: production push requires a live source URL; provide REPRINT_PUSH_SOURCE_URL before running preflight, dry-run, or apply\."\s*\}/,
  );
});

const maybeTest = runLivePlaygroundTopologyTests ? test : test.skip;

maybeTest('production-shaped release proof runs the live preflight branch against a local Playground source', async () => {
  await withPlaygroundServer('remote-base', path.join(repoRoot, 'fixtures/playground/remote-base.blueprint.json'), async (remoteServer) => {
    const proof = spawnSync(process.execPath, ['scripts/playground/production-shaped-release-proof.mjs'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        REPRINT_PUSH_SOURCE_URL: remoteServer.baseUrl,
        REPRINT_PUSH_REMOTE_URL: remoteServer.baseUrl,
        REPRINT_PUSH_LAB_AUTH_ADMIN_USER: liveCredentials.username,
        REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: liveCredentials.password,
      },
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 20,
    });

    assert.equal(proof.status, 0, proof.stderr);
    assert.match(proof.stdout, /"releaseProof": \{\s*"status": 0,\s*"code": "LIVE_PREFLIGHT_OK"\s*\}/);
    assert.match(proof.stdout, /"sourceUrl": "http:\/\/127\.0\.0\.1:\d+"/);
    assert.match(proof.stdout, /"routeProfile": \{\s*"profile": "production-shaped"/);
    assert.match(proof.stdout, /"session": \{\s*"id": "[A-Za-z0-9_-]{32,160}"/);
  });
});

maybeTest('production-shaped release verify command runs the live protocol branch with local Playground source and local edited site', () => {
  return withPlaygroundServer('remote-base', path.join(repoRoot, 'fixtures/playground/remote-base.blueprint.json'), async (remoteServer) => {
    const proof = spawnSync(process.execPath, ['scripts/playground/production-shaped-release-verify.mjs'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        REPRINT_PUSH_SOURCE_URL: remoteServer.baseUrl,
        REPRINT_PUSH_REMOTE_URL: remoteServer.baseUrl,
        REPRINT_PUSH_LAB_AUTH_ADMIN_USER: liveCredentials.username,
        REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: liveCredentials.password,
        NODE_NO_WARNINGS: '1',
      },
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 20,
    });

    assert.equal(proof.status, 0, proof.stderr);
    assert.match(proof.stdout, /"ok": true/);
    assert.match(proof.stdout, /"topology": \{\s*"remoteBase": "http:\/\/127\.0\.0\.1:\d+"/);
    assert.match(proof.stdout, /"remoteChanged": "http:\/\/127\.0\.0\.1:\d+"/);
    assert.match(proof.stdout, /"localEdited": "http:\/\/127\.0\.0\.1:\d+"/);
    assert.match(proof.stdout, /"boundary": \{/);
    assert.match(proof.stdout, /"firstRemainingProductionBoundary": "auth\/session lifecycle and durable journal semantics"/);
    assert.match(proof.stdout, /"verdict": "PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED"/);
    assert.match(proof.stdout, /"durableJournal": \{\s*"proof": \{\s*"status": 0,\s*"journal": \{/);
    assert.match(proof.stdout, /"releaseProof": \{\s*"ok": true,\s*"mode": "apply"/);
    assert.match(proof.stdout, /"preflight": \{\s*"status": 200,\s*"ok": true,\s*"mode": "preflight"/);
  });
});

maybeTest('production-shaped release verify command fails closed when remote drift appears after the authenticated snapshot', () => {
  return withPlaygroundServer('remote-base', path.join(repoRoot, 'fixtures/playground/remote-base.blueprint.json'), async (remoteServer) => {
    const proof = spawnSync(process.execPath, ['scripts/playground/production-shaped-release-verify.mjs'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        REPRINT_PUSH_SOURCE_URL: remoteServer.baseUrl,
        REPRINT_PUSH_REMOTE_URL: remoteServer.baseUrl,
        REPRINT_PUSH_LAB_AUTH_ADMIN_USER: liveCredentials.username,
        REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: liveCredentials.password,
        REPRINT_PUSH_LAB_DRIFT_AFTER_SNAPSHOT: 'post-title',
        NODE_NO_WARNINGS: '1',
      },
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 20,
    });

    assert.equal(proof.status, 1, proof.stderr);
    assert.match(proof.stdout, /"ok": false/);
    assert.match(proof.stdout, /"drift": \{\s*"mode": "post-title",\s*"sameRemoteIdentity": true,\s*"changedHash": "[a-f0-9]{64}"\s*\}/);
    assert.match(proof.stdout, /"releaseProof": \{\s*"ok": false,\s*"status": 412,\s*"code": "PRECONDITION_FAILED"\s*\}/);
    assert.match(proof.stdout, /"boundary": \{\s*"firstRemainingProductionBoundary": "auth\/session lifecycle and durable journal semantics"/);
    assert.match(proof.stdout, /"verdict": "PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED"/);
  });
});

test('production-shaped release verify command fails closed on the explicit live-source and secret gates', () => {
  const proof = spawnSync(process.execPath, ['scripts/playground/production-shaped-release-verify.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      REPRINT_PUSH_SOURCE_URL: '',
      REPRINT_PUSH_REMOTE_URL: '',
      REPRINT_PUSH_LAB_AUTH_ADMIN_USER: '',
      REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: '',
      REPRINT_PUSH_USERNAME: '',
      REPRINT_PUSH_APPLICATION_PASSWORD: '',
      REPRINT_PUSH_SIGNING_SECRET: '',
      NODE_NO_WARNINGS: '1',
    },
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  });

  assert.equal(proof.status, 1, proof.stderr);
  assert.match(proof.stdout, /REPRINT_PUSH_LIVE_SOURCE_REQUIRED: production push requires a live source URL; provide REPRINT_PUSH_SOURCE_URL before running preflight, dry-run, or apply\./);
  assert.match(proof.stdout, /"releaseProof": \{\s*"status": 1,\s*"code": "REPRINT_PUSH_LIVE_SOURCE_REQUIRED"\s*\}/);
  assert.match(
    proof.stdout,
    /"boundary": \{\s*"firstRemainingProductionBoundary": "auth\/session lifecycle and durable journal semantics"/,
  );
  assert.match(proof.stdout, /"verdict": "PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED"/);
  assert.match(proof.stdout, /"durableJournal": \{\s*"storageLeaseFence": "production durable journal storage, lease, and fencing are not yet proven beyond the retained Playground journal path"/);
});

maybeTest('production-shaped live topology proof runs preflight against a local Playground source and reports the topology', () => {
  const proof = spawnSync(process.execPath, ['scripts/playground/production-shaped-live-topology-proof.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_NO_WARNINGS: '1',
    },
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  });

  assert.equal(proof.status, 0, proof.stderr);
  assert.match(proof.stdout, /"ok": true/);
  assert.match(proof.stdout, /"remoteBase": "remote-base"/);
  assert.match(proof.stdout, /"localEdited": "local-edited"/);
  assert.match(proof.stdout, /"remoteChanged": "remote-changed"/);
  assert.match(proof.stdout, /"routeProfile": \{\s*"profile": "production-shaped"/);
  assert.match(proof.stdout, /"restNamespace": "reprint\/v1"/);
  assert.match(proof.stdout, /"routePrefix": "\/push"/);
  assert.match(proof.stdout, /"indexStatus": 200/);
});

maybeTest('production-shaped live protocol proof runs the real preflight plus snapshot, dry-run, and apply boundary', () => {
  const proof = spawnSync(process.execPath, ['scripts/playground/production-shaped-live-protocol-proof.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_NO_WARNINGS: '1',
    },
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  });

  assert.equal(proof.status, 0, proof.stderr);
  assert.match(proof.stdout, /"ok": true/);
  assert.match(proof.stdout, /"mode": "apply"/);
  assert.match(proof.stdout, /"routeProfile": \{\s*"profile": "production-shaped"/);
  assert.match(proof.stdout, /"session": \{\s*"id": "[A-Za-z0-9_-]{32,160}"/);
  assert.match(proof.stdout, /"dryRun": \{/);
  assert.match(proof.stdout, /"apply": \{/);
  assert.match(proof.stdout, /"recoveryInspect": \{/);
  assert.match(proof.stdout, /"dbJournal": \{/);
});

test('production-shaped topology proof wrapper emits the fixed one-remote one-local one-drift harness', () => {
  const proof = spawnSync(process.execPath, ['scripts/playground/production-shaped-topology-proof.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_NO_WARNINGS: '1',
    },
    encoding: 'utf8',
  });

  assert.equal(proof.status, 0);
  assert.match(proof.stdout, /"remoteBase": "remote-base"/);
  assert.match(proof.stdout, /"localEdited": "local-edited"/);
  assert.match(proof.stdout, /"remoteChanged": "remote-changed"/);
  assert.match(proof.stdout, /"runner": "runner"/);
  assert.match(proof.stdout, /"ingressPort": 8080/);
  assert.match(proof.stdout, /"proxyPolicy": "local-only"/);
  assert.match(proof.stdout, /"tunnels": "disallowed"/);
});

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
    env: process.env,
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

  return { name, baseUrl, port, child };
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
    await new Promise((resolve) => setTimeout(resolve, 500));
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
