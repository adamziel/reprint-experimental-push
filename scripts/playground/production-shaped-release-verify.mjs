#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticatedHttpClient, runAuthenticatedHttpPush } from '../../src/authenticated-http-push-client.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const muPluginDir = path.join(repoRoot, 'scripts/playground/rest-mu-plugins');
const serverStartupTimeoutMs = 120_000;
const credentials = {
  username: 'reprint_push_admin',
  password: 'reprint-push-admin-app-password',
};

const liveSourceUrl = process.env.REPRINT_PUSH_SOURCE_URL || process.env.REPRINT_PUSH_REMOTE_URL || '';
const username = process.env.REPRINT_PUSH_LAB_AUTH_ADMIN_USER || process.env.REPRINT_PUSH_USERNAME || '';
const applicationPassword = process.env.REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD || process.env.REPRINT_PUSH_APPLICATION_PASSWORD || '';

if (!liveSourceUrl) {
  const missingSourceResult = spawnSync(process.execPath, ['scripts/playground/production-shaped-live-source-gate-smoke.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      REPRINT_PUSH_SOURCE_URL: '',
      REPRINT_PUSH_REMOTE_URL: '',
      NODE_NO_WARNINGS: '1',
    },
  });

  assert.equal(missingSourceResult.status, 1, 'release verify must fail with the missing-live-source gate when no source is provided');
  process.stdout.write(missingSourceResult.stderr || '');
  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        boundary: {
          firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
          status: 'unimplemented',
          verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
        },
        releaseProof: {
          status: 1,
          code: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
        },
      },
      null,
      2,
    ),
  );
  process.stdout.write('\n');
  process.exit(0);
}

if (!username || !applicationPassword) {
  const missingSecretResult = spawnSync(process.execPath, ['scripts/playground/production-shaped-missing-secret-smoke.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      REPRINT_PUSH_SIGNING_SECRET: '',
      REPRINT_PUSH_APPLICATION_PASSWORD: '',
      NODE_NO_WARNINGS: '1',
    },
  });

  assert.equal(missingSecretResult.status, 1, 'release verify must fail with the missing-secret gate when credentials are absent');
  process.stdout.write(missingSecretResult.stderr || '');
  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        boundary: {
          firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
          status: 'unimplemented',
          verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
        },
        releaseProof: {
          status: 1,
          code: 'REPRINT_PUSH_SECRET_REQUIRED',
        },
      },
      null,
      2,
    ),
  );
  process.stdout.write('\n');
  process.exit(0);
}

const remoteServer = await startPlaygroundServer(
  'remote-base',
  path.join(repoRoot, 'fixtures/playground/remote-base.blueprint.json'),
);
try {
  const remoteChangedServer = await startPlaygroundServer(
    'remote-changed',
    path.join(repoRoot, 'fixtures/playground/remote-changed.blueprint.json'),
  );
  try {
    const localServer = await startPlaygroundServer(
      'local-edited',
      path.join(repoRoot, 'fixtures/playground/local-edited.blueprint.json'),
    );
    try {
      const client = authenticatedHttpClient({
        sourceUrl: remoteServer.baseUrl,
        credential: credentials,
        routeProfile: 'production-shaped',
      });

      const preflight = await client.signedGet('/preflight');
      assert.equal(preflight.status, 200, `production-shaped release verify preflight HTTP ${preflight.status}`);
      assert.equal(preflight.body.ok, true);

      const proof = await runAuthenticatedHttpPush({
        sourceUrl: remoteServer.baseUrl,
        base: await exportSnapshot('remote-base', remoteServer.baseUrl),
        local: withoutUnmappedGraphPostmeta(await exportSnapshot('local-edited', localServer.baseUrl)),
        username: credentials.username,
        applicationPassword: credentials.password,
        idempotencyKey: 'production-shaped-release-verify-001',
        routeProfile: 'production-shaped',
        dryRunOnly: false,
        labDriftAfterSnapshot: '',
        now: new Date('2026-05-25T10:12:00.000Z'),
      });

      assert.equal(proof.ok, true, JSON.stringify(proof, null, 2));
      assert.equal(proof.preflight.status, 200);
      assert.equal(preflight.body.auth.session.type, 'application-password-basic');
      assert.equal(preflight.body.session.type, 'lab-signed-push-session');
      assert.match(preflight.body.session.id, /^[A-Za-z0-9_-]{32,160}$/);
      assert.equal(proof.dryRun.status, 200);
      assert.equal(proof.apply.status, 200);
      assert.equal(proof.recoveryInspect.status, 200);
      assert.equal(proof.after.status, 200);
      assert.equal(proof.after.finalMatchesLocal, true);
      assert.ok(proof.dryRun.receiptHash, 'dry-run receipt hash missing');
      assert.equal(proof.dbJournal.status, 200);
      assert.ok(proof.dbJournal.rows > 0, 'journal readback must return durable rows');
      assert.equal(proof.dbJournal.applyCommitted, true, 'journal readback must show an apply-committed row');
      assert.ok(
        proof.dbJournal.mutationApplied > 0 || proof.dbJournal.idempotencyOpened > 0,
        'journal readback must show durable mutation evidence',
      );

      const remoteChangedSnapshot = await exportSnapshot('remote-changed', remoteChangedServer.baseUrl);
      const remoteBaseSnapshot = await exportSnapshot('remote-base', remoteServer.baseUrl);
      const liveDrift = {
        sameRemoteIdentity: true,
        baseHash: snapshotHash(remoteBaseSnapshot),
        changedHash: snapshotHash(remoteChangedSnapshot),
        changedFixture: remoteChangedSnapshot.meta?.fixture,
      };

      process.stdout.write(
        JSON.stringify(
          {
            ok: true,
            topology: {
              remoteBase: remoteServer.baseUrl,
              remoteChanged: remoteChangedServer.baseUrl,
              localEdited: localServer.baseUrl,
            },
            liveDrift,
            boundary: {
              firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
              status: 'unimplemented',
              verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
            },
            preflight: {
              status: preflight.status,
              authSessionType: preflight.body.auth.session.type,
              routeProfile: preflight.body.routeProfile,
              session: {
                id: preflight.body.session.id,
                type: preflight.body.session.type,
              },
            },
            durableJournal: {
              rows: proof.dbJournal.rows,
              applyCommitted: proof.dbJournal.applyCommitted,
              mutationApplied: proof.dbJournal.mutationApplied,
              idempotencyOpened: proof.dbJournal.idempotencyOpened,
            },
            releaseProof: proof,
          },
          null,
          2,
        ),
      );
      process.stdout.write('\n');
    } finally {
      await stopPlaygroundServer(localServer);
    }
  } finally {
    await stopPlaygroundServer(remoteChangedServer);
  }
} finally {
  await stopPlaygroundServer(remoteServer);
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
  return { name, baseUrl, child };
}

async function stopPlaygroundServer(server) {
  if (server.child.exitCode !== null) {
    return;
  }
  server.child.kill('SIGTERM');
  await waitForExit(server.child, 12_000);
}

async function exportSnapshot(name, baseUrl) {
  const response = await fetch(`${baseUrl}/wp-json/reprint-push-lab/v1/snapshot`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`,
    },
  });
  assert.equal(response.status, 200, `${name} snapshot HTTP ${response.status}`);
  const body = await response.json();
  assert.equal(body.ok, true, `${name} snapshot body not ok`);
  return body.snapshot;
}

function withoutUnmappedGraphPostmeta(snapshot) {
  const next = JSON.parse(JSON.stringify(snapshot));
  delete next.db?.wp_postmeta?.['post_id:2001:meta_key:_reprint_push_forms_schema'];
  if (next.db?.wp_postmeta && Object.keys(next.db.wp_postmeta).length === 0) {
    delete next.db.wp_postmeta;
  }
  return next;
}

function snapshotHash(snapshot) {
  return createHash('sha256').update(JSON.stringify(snapshot), 'utf8').digest('hex');
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
