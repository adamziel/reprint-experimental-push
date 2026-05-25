import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

test('production-shaped live topology proof runs preflight against a local Playground source and reports the topology', () => {
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

test('production-shaped live protocol proof runs the real preflight plus snapshot, dry-run, and apply boundary', () => {
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
