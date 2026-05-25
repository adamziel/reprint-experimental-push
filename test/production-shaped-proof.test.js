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
