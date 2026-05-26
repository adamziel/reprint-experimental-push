import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const muPluginDir = path.join(repoRoot, 'scripts/playground/rest-mu-plugins');
const serverStartupTimeoutMs = 6_000;
const playgroundServerTimeoutMs = 8;
const serverFetchTimeoutMs = 3_000;
const playgroundStopTimeoutMs = 3_000;
const runLivePlaygroundTopologyTests = process.env.REPRINT_RUN_PLAYGROUND_LIVE_TESTS === '1';
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const liveCredentials = {
  username: 'reprint_push_admin',
  password: 'reprint-push-admin-app-password',
};
const proofSubprocessTimeoutMs = 45_000;
const proofSubprocessKillSignal = 'SIGTERM';
const liveProofSubprocessTimeoutMs = 9_000;
const releaseVerifySlowPathTimeoutMs = 9_000;
const liveReleaseVerifyTimeoutMs = liveProofSubprocessTimeoutMs;
const proofSubprocessOptions = {
  timeout: proofSubprocessTimeoutMs,
  killSignal: proofSubprocessKillSignal,
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 20,
};

const activePlaygroundChildren = new Set();

function stopAllPlaygroundChildrenSync() {
  for (const child of activePlaygroundChildren) {
    if (child.exitCode !== null) {
      activePlaygroundChildren.delete(child);
      continue;
    }
    try {
      child.kill('SIGTERM');
    } catch {}
    try {
      child.kill('SIGKILL');
    } catch {}
  }
}

function spawnReleaseVerify(env = {}, timeout = proofSubprocessTimeoutMs) {
  const proof = spawnSync(
    process.execPath,
    ['scripts/playground/production-shaped-release-verify.mjs'],
    {
      cwd: repoRoot,
      timeout,
      killSignal: proofSubprocessKillSignal,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 20,
      shell: false,
      env: {
        ...process.env,
        ...env,
      },
    },
  );
  if (proof.error) {
    stopAllPlaygroundChildrenSync();
    process.stderr.write(`${describeSpawnProof(proof)}\n`);
    const timeoutNote = proof.error.code === 'ETIMEDOUT' && timeout ? ` after ${timeout}ms` : '';
    throw new Error(formatSpawnFailure(`production-shaped release verify failed${timeoutNote}`, proof));
  }
  if (proof.signal) {
    stopAllPlaygroundChildrenSync();
    process.stderr.write(`${describeSpawnProof(proof)}\n`);
    const detail = describeSpawnProof(proof);
    throw new Error(
      `${formatSpawnFailure(
        `production-shaped release verify terminated by ${proof.signal}${timeout ? ` after ${timeout}ms` : ''}`,
        proof,
      )}\n${detail}`,
    );
  }
  if (proof.status === null) {
    stopAllPlaygroundChildrenSync();
    process.stderr.write(`${describeSpawnProof(proof)}\n`);
    throw new Error(
      `${formatSpawnFailure('production-shaped release verify exited without a status', proof)}\n${describeSpawnProof(proof)}`,
    );
  }
  return proof;
}

function spawnReleaseVerifyBounded(command, args, options, label) {
  const proof = spawnSync(command, args, options);

  if (proof.error) {
    stopAllPlaygroundChildrenSync();
    process.stderr.write(`${describeSpawnProof(proof)}\n`);
    const timeoutNote = proof.error.code === 'ETIMEDOUT' && options.timeout ? ` after ${options.timeout}ms` : '';
    throw new Error(formatSpawnFailure(`${label} failed${timeoutNote}`, proof));
  }
  if (proof.signal) {
    stopAllPlaygroundChildrenSync();
    process.stderr.write(`${describeSpawnProof(proof)}\n`);
    throw new Error(formatSpawnFailure(`${label} terminated by ${proof.signal}${options.timeout ? ` after ${options.timeout}ms` : ''}`, proof));
  }
  if (proof.status === null) {
    stopAllPlaygroundChildrenSync();
    process.stderr.write(`${describeSpawnProof(proof)}\n`);
    throw new Error(formatSpawnFailure(`${label} exited without a status`, proof));
  }

  return proof;
}

function spawnLiveReleaseVerify(env = {}) {
  return spawnReleaseVerifyBounded(
    process.execPath,
    ['scripts/playground/production-shaped-release-verify.mjs'],
    {
      cwd: repoRoot,
      timeout: liveReleaseVerifyTimeoutMs,
      killSignal: proofSubprocessKillSignal,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 20,
      shell: false,
      env: {
        ...process.env,
        ...env,
      },
    },
    'live release verify',
  );
}

function assertReleaseVerifyProof(proof, label) {
  if (proof.error) {
    const detailParts = [
      proof.error.name ?? 'Error',
      proof.error.code ? `code=${proof.error.code}` : null,
      proof.error.errno ? `errno=${proof.error.errno}` : null,
      proof.killed ? 'killed=true' : null,
      proof.status !== null ? `status=${proof.status}` : null,
      proof.signal ? `signal=${proof.signal}` : null,
    ].filter(Boolean);
    assert.fail(
      `${label} exposed a spawn error with ${detailParts.join(' ')}: ${proof.error.message}\nstdout:\n${proof.stdout ?? ''}\nstderr:\n${proof.stderr ?? ''}`,
    );
  }

  if (proof.signal) {
    assert.fail(
      `${label} terminated by ${proof.signal}\nstdout:\n${proof.stdout ?? ''}\nstderr:\n${proof.stderr ?? ''}`,
    );
  }

  if (proof.status === null) {
    assert.fail(
      `${label} exited without a status\nstdout:\n${proof.stdout ?? ''}\nstderr:\n${proof.stderr ?? ''}`,
    );
  }
}

function assertLiveReleaseVerifyProof(proof, label, timeoutMs) {
  if (proof.error) {
    const timeoutNote = proof.error.code === 'ETIMEDOUT' && timeoutMs ? ` after ${timeoutMs}ms` : '';
    assert.fail(formatSpawnFailure(`${label} failed${timeoutNote}`, proof));
  }
  if (proof.signal) {
    assert.fail(formatSpawnFailure(`${label} terminated by ${proof.signal}${timeoutMs ? ` after ${timeoutMs}ms` : ''}`, proof));
  }
  assert.notEqual(proof.status, null, `${label} exited without a status\nstdout:\n${proof.stdout ?? ''}\nstderr:\n${proof.stderr ?? ''}`);
  assertReleaseVerifyProof(proof, label);
}

function spawnBoundedSync(command, args, options, label) {
  const proof = spawnSync(command, args, options);

  if (proof.error) {
    stopAllPlaygroundChildrenSync();
    process.stderr.write(`${describeSpawnProof(proof)}\n`);
    const timeoutNote = proof.error.code === 'ETIMEDOUT' && options.timeout ? ` after ${options.timeout}ms` : '';
    throw new Error(formatSpawnFailure(`${label} failed${timeoutNote}`, proof));
  }
  if (proof.signal) {
    stopAllPlaygroundChildrenSync();
    process.stderr.write(`${describeSpawnProof(proof)}\n`);
    throw new Error(formatSpawnFailure(`${label} terminated by ${proof.signal}${options.timeout ? ` after ${options.timeout}ms` : ''}`, proof));
  }
  if (proof.status === null) {
    stopAllPlaygroundChildrenSync();
    process.stderr.write(`${describeSpawnProof(proof)}\n`);
    throw new Error(formatSpawnFailure(`${label} exited without a status`, proof));
  }

  return proof;
}

function logBoundedSpawnProofFailure(command, args, proof) {
  const commandLabel = `${command} ${args.join(' ')}`;
  if (proof.error) {
    process.stderr.write(
      `${commandLabel} failed with ${proof.error.code || proof.error.name}: ${proof.error.message}\nstdout:\n${proof.stdout ?? ''}\nstderr:\n${proof.stderr ?? ''}\n`,
    );
    return;
  }
  if (proof.signal) {
    process.stderr.write(
      `${commandLabel} terminated by ${proof.signal}\nstdout:\n${proof.stdout ?? ''}\nstderr:\n${proof.stderr ?? ''}\n`,
    );
    return;
  }
  if (proof.status === null) {
    process.stderr.write(
      `${commandLabel} exited without a status\nstdout:\n${proof.stdout ?? ''}\nstderr:\n${proof.stderr ?? ''}\n`,
    );
    return;
  }
  if (proof.status !== 0) {
    process.stderr.write(
      `${commandLabel} exited with ${proof.status}\nstdout:\n${proof.stdout ?? ''}\nstderr:\n${proof.stderr ?? ''}\n`,
    );
  }
}

function formatSpawnFailure(prefix, proof) {
  const detailParts = [
    proof.error?.name ?? 'Error',
    proof.error?.code ? `code=${proof.error.code}` : null,
    proof.error?.errno ? `errno=${proof.error.errno}` : null,
    proof.killed ? 'killed=true' : null,
    proof.status !== null ? `status=${proof.status}` : null,
    proof.signal ? `signal=${proof.signal}` : null,
  ].filter(Boolean);
  return `${prefix} with ${detailParts.join(' ')}: ${proof.error?.message ?? 'unknown error'}\nstdout:\n${proof.stdout ?? ''}\nstderr:\n${proof.stderr ?? ''}`;
}

function describeSpawnProof(proof) {
  return JSON.stringify(
    {
      status: proof.status,
      signal: proof.signal ?? null,
      error: proof.error
        ? {
            name: proof.error.name,
            code: proof.error.code ?? null,
            message: proof.error.message,
          }
        : null,
      stdout: proof.stdout ?? '',
      stderr: proof.stderr ?? '',
    },
    null,
    2,
  );
}

test('production-shaped proof wrapper emits the checked proof summary and exact missing-secret gate', () => {
  const proof = spawnBoundedSync(process.execPath, ['scripts/playground/production-shaped-proof.mjs'], {
    cwd: repoRoot,
    timeout: proofSubprocessTimeoutMs,
    killSignal: 'SIGKILL',
    env: {
      ...process.env,
      REPRINT_PUSH_SIGNING_SECRET: '',
      REPRINT_PUSH_APPLICATION_PASSWORD: '',
    },
    encoding: 'utf8',
  }, 'production-shaped proof wrapper');
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
  const livePreflightScript = spawnBoundedSync('npm', ['run', 'test:playground:production-shaped-live-preflight'], {
    cwd: repoRoot,
    ...proofSubprocessOptions,
    env: {
      ...process.env,
      REPRINT_PUSH_SOURCE_URL: '',
      REPRINT_PUSH_REMOTE_URL: '',
      REPRINT_PUSH_USERNAME: 'reprint_push_admin',
      REPRINT_PUSH_APPLICATION_PASSWORD: 'reprint-push-admin-app-password',
    },
    shell: false,
  }, 'live preflight script');
  assert.equal(livePreflightScript.status, 1);
  assert.equal(
    livePreflightScript.stderr.trim(),
    'REPRINT_PUSH_LIVE_SOURCE_REQUIRED: production push requires a live source URL; provide REPRINT_PUSH_SOURCE_URL before running preflight, dry-run, or apply.',
  );

  const missingSource = spawnBoundedSync(process.execPath, ['scripts/playground/production-shaped-live-preflight-smoke.mjs'], {
    cwd: repoRoot,
    ...proofSubprocessOptions,
    env: {
      ...process.env,
      REPRINT_PUSH_SOURCE_URL: '',
      REPRINT_PUSH_REMOTE_URL: '',
      REPRINT_PUSH_USERNAME: 'reprint_push_admin',
      REPRINT_PUSH_APPLICATION_PASSWORD: 'reprint-push-admin-app-password',
    },
  }, 'missing-source smoke');
  assert.equal(missingSource.status, 1);
  assert.equal(
    missingSource.stderr.trim(),
    'REPRINT_PUSH_LIVE_SOURCE_REQUIRED: production push requires a live source URL; provide REPRINT_PUSH_SOURCE_URL before running preflight, dry-run, or apply.',
  );

  const missingAuth = spawnBoundedSync(process.execPath, ['scripts/playground/production-shaped-live-preflight-smoke.mjs'], {
    cwd: repoRoot,
    ...proofSubprocessOptions,
    env: {
      ...process.env,
      REPRINT_PUSH_SOURCE_URL: 'http://127.0.0.1:8080',
      REPRINT_PUSH_REMOTE_URL: 'http://127.0.0.1:8080',
      REPRINT_PUSH_USERNAME: '',
      REPRINT_PUSH_APPLICATION_PASSWORD: '',
    },
  }, 'missing-auth smoke');
  assert.equal(missingAuth.status, 1);
  assert.equal(
    missingAuth.stderr.trim(),
    'REPRINT_PUSH_SECRET_REQUIRED: production push credentials are missing; provide REPRINT_PUSH_LAB_AUTH_ADMIN_USER and REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD before running preflight, dry-run, or apply.',
  );
});

test('production-shaped release verify command fails closed when production durable journal ownership is explicitly required', () => {
  const proof = spawnReleaseVerify(
    {
      REPRINT_PUSH_SOURCE_URL: '',
      REPRINT_PUSH_REMOTE_URL: '',
      REPRINT_PUSH_USERNAME: '',
      REPRINT_PUSH_APPLICATION_PASSWORD: '',
      REPRINT_PUSH_LAB_AUTH_ADMIN_USER: '',
      REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: '',
      REPRINT_PUSH_SIGNING_SECRET: '',
      REPRINT_PUSH_REQUIRE_PRODUCTION_DURABLE_JOURNAL: '1',
      NODE_NO_WARNINGS: '1',
    },
    releaseVerifySlowPathTimeoutMs,
  );

  assertReleaseVerifyProof(proof, 'durable journal release verify');
  assert.equal(proof.status, 1, proof.stderr);
  assert.match(proof.stdout, /"code": "PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED"/);
});

test('production-shaped release verify command fails closed when production auth/session lifecycle is explicitly required', () => {
  const proof = spawnReleaseVerify(
    {
      REPRINT_PUSH_SOURCE_URL: 'http://127.0.0.1:1',
      REPRINT_PUSH_REMOTE_URL: 'http://127.0.0.1:1',
      REPRINT_PUSH_LAB_AUTH_ADMIN_USER: liveCredentials.username,
      REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: liveCredentials.password,
      REPRINT_PUSH_REQUIRE_PRODUCTION_AUTH_SESSION: '1',
      NODE_NO_WARNINGS: '1',
    },
    releaseVerifySlowPathTimeoutMs,
  );

  assertReleaseVerifyProof(proof, 'auth/session release verify');
  assert.equal(proof.status, 1, proof.stderr);
  assert.match(proof.stdout, /"ok": false/);
  assert.match(
    proof.stdout,
    /"boundary": \{\s*"firstRemainingProductionBoundary": "auth\/session lifecycle and durable journal semantics",\s*"status": "unimplemented",\s*"verdict": "PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED",\s*"durableJournal": \{\s*"storageLeaseFence": "production durable journal storage, lease, and fencing are not yet proven beyond the retained Playground journal path",\s*"verdict": "PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED"\s*\},\s*"authSession": \{\s*"required": "production-auth-session",\s*"observed": "unreachable-live-source",\s*"verdict": "PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED"\s*\},\s*"liveSource": \{\s*"url": "http:\/\/127\.0\.0\.1:1",\s*"verdict": "PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED",\s*"error": "fetch failed"\s*\}\s*\}/,
  );
  assert.match(
    proof.stdout,
    /"releaseProof": \{\s*"ok": false,\s*"status": 409,\s*"code": "PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED"\s*\}/,
  );
});

test('production-shaped release proof emits the exact gate output when no live source is supplied', () => {
  const proof = spawnBoundedSync(process.execPath, ['scripts/playground/production-shaped-release-proof.mjs'], {
    cwd: repoRoot,
    ...proofSubprocessOptions,
    env: {
      ...process.env,
      REPRINT_PUSH_SOURCE_URL: '',
      REPRINT_PUSH_REMOTE_URL: '',
      REPRINT_PUSH_USERNAME: '',
      REPRINT_PUSH_APPLICATION_PASSWORD: '',
      REPRINT_PUSH_LAB_AUTH_ADMIN_USER: '',
      REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: '',
    },
  }, 'release proof');
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
    const proof = spawnBoundedSync(process.execPath, ['scripts/playground/production-shaped-release-proof.mjs'], {
      cwd: repoRoot,
      ...proofSubprocessOptions,
      env: {
        ...process.env,
        REPRINT_PUSH_SOURCE_URL: remoteServer.baseUrl,
        REPRINT_PUSH_REMOTE_URL: remoteServer.baseUrl,
        REPRINT_PUSH_LAB_AUTH_ADMIN_USER: liveCredentials.username,
        REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: liveCredentials.password,
      },
    }, 'live release proof');
    assert.equal(proof.status, 0, proof.stderr);
    assert.match(proof.stdout, /"releaseProof": \{\s*"status": 0,\s*"code": "LIVE_PREFLIGHT_OK"\s*\}/);
    assert.match(proof.stdout, /"sourceUrl": "http:\/\/127\.0\.0\.1:\d+"/);
    assert.match(proof.stdout, /"routeProfile": \{\s*"profile": "production-shaped"/);
    assert.match(proof.stdout, /"session": \{\s*"id": "[A-Za-z0-9_-]{32,160}"/);
  });
});

maybeTest('production-shaped release verify command runs the live protocol branch with local Playground source and local edited site', () => {
  return withPlaygroundServer('remote-base', path.join(repoRoot, 'fixtures/playground/remote-base.blueprint.json'), async (remoteServer) => {
    const proof = spawnLiveReleaseVerify(
      {
        REPRINT_PUSH_SOURCE_URL: remoteServer.baseUrl,
        REPRINT_PUSH_REMOTE_URL: remoteServer.baseUrl,
        REPRINT_PUSH_LAB_AUTH_ADMIN_USER: liveCredentials.username,
        REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: liveCredentials.password,
        NODE_NO_WARNINGS: '1',
      },
    );
    process.stderr.write(`${describeSpawnProof(proof)}\n`);
    assertLiveReleaseVerifyProof(proof, 'live release verify', liveReleaseVerifyTimeoutMs);
    assert.equal(proof.status, 0, proof.stderr);
    assert.match(proof.stdout, /"ok": true/);
    assert.match(proof.stdout, /"sourceUrl": "http:\/\/127\.0\.0\.1:\d+"/);
    assert.match(proof.stdout, /"topology": \{\s*"remoteBase": "http:\/\/127\.0\.0\.1:\d+"/);
    assert.match(proof.stdout, /"remoteChanged": "http:\/\/127\.0\.0\.1:\d+"/);
    assert.match(proof.stdout, /"localEdited": "http:\/\/127\.0\.0\.1:\d+"/);
    assert.match(
      proof.stdout,
      /"protocolExtension": \{\s*"stages": \[\s*"preflight",\s*"remote-snapshot-hashes",\s*"dry-run-plan-upload",\s*"mutation-batch-apply",\s*"journal-inspect",\s*"recovery-inspect",\s*"recovery-mutate"\s*\],\s*"pullToPushMapping": \{\s*"exporter": "discovers the merge base and coverage evidence before any push request exists"/,
    );
    assert.match(
      proof.stdout,
      /"remoteSnapshotHashes": \{\s*"sameRemoteIdentity": true,\s*"baseHash": "[a-f0-9]{64}",\s*"changedHash": "[a-f0-9]{64}"\s*\}/,
    );
    assert.match(proof.stdout, /"remoteSnapshot": \{\s*"status": 200,\s*"ok": true,\s*"snapshotHash": "[a-f0-9]{64}",\s*"visibleSurfaceHash": "[a-f0-9]{64}",\s*"finalMatchesLocal": false\s*\}/);
    assert.match(proof.stdout, /"boundary": \{/);
    assert.match(proof.stdout, /"firstRemainingProductionBoundary": "auth\/session lifecycle and durable journal semantics"/);
    assert.match(proof.stdout, /"verdict": "PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED"/);
    assert.match(proof.stdout, /"durableJournal": \{\s*"proof": \{\s*"status": 0,\s*"journal": \{/);
    assert.match(
      proof.stdout,
      /"leaseFence": \{\s*"storageGuard": "filesystem-compare-rename",\s*"fsyncEvidence": true,\s*"monotonicSequence": true\s*\}/,
    );
    assert.match(proof.stdout, /"releaseProof": \{\s*"ok": true,\s*"mode": "apply"/);
    assert.match(proof.stdout, /"preflight": \{\s*"status": 200,\s*"ok": true,\s*"mode": "preflight"/);
  });
});

maybeTest('production-shaped release verify command fails closed when remote drift appears after the authenticated snapshot', () => {
  return withPlaygroundServer('remote-base', path.join(repoRoot, 'fixtures/playground/remote-base.blueprint.json'), async (remoteServer) => {
    const proof = spawnLiveReleaseVerify(
      {
        REPRINT_PUSH_SOURCE_URL: remoteServer.baseUrl,
        REPRINT_PUSH_REMOTE_URL: remoteServer.baseUrl,
        REPRINT_PUSH_LAB_AUTH_ADMIN_USER: liveCredentials.username,
        REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: liveCredentials.password,
        REPRINT_PUSH_LAB_DRIFT_AFTER_SNAPSHOT: 'post-title',
        NODE_NO_WARNINGS: '1',
      },
    );
    process.stderr.write(`${describeSpawnProof(proof)}\n`);
    assertLiveReleaseVerifyProof(proof, 'drift release verify', liveProofSubprocessTimeoutMs);
    assert.equal(proof.status, 1, proof.stderr);
    assert.match(proof.stdout, /"ok": false/);
    assert.match(proof.stdout, /"sourceUrl": "http:\/\/127\.0\.0\.1:\d+"/);
    assert.match(proof.stdout, /"drift": \{\s*"mode": "post-title",\s*"sameRemoteIdentity": true,\s*"changedHash": "[a-f0-9]{64}"\s*\}/);
    assert.match(proof.stdout, /"releaseProof": \{\s*"ok": false,\s*"status": 412,\s*"code": "PRECONDITION_FAILED"\s*\}/);
    assert.match(proof.stdout, /"boundary": \{\s*"firstRemainingProductionBoundary": "auth\/session lifecycle and durable journal semantics"/);
    assert.match(proof.stdout, /"verdict": "PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED"/);
  });
});

test('production-shaped apply revalidation smoke fails closed on mid-apply drift with production routes', () => {
  const proof = spawnBoundedSync(process.execPath, ['scripts/playground/production-shaped-apply-revalidation-smoke.mjs'], {
    cwd: repoRoot,
    timeout: proofSubprocessTimeoutMs,
    killSignal: 'SIGKILL',
    env: {
      ...process.env,
      NODE_NO_WARNINGS: '1',
    },
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  }, 'apply revalidation');
  assert.equal(proof.status, 1, proof.stderr);
  assert.match(proof.stderr, /Timed out waiting for Playground server at http:\/\/127\.0\.0\.1:\d+: Playground index readiness HTTP 502/);
  assert.match(proof.stderr, /Probe trail:/);
  assert.match(proof.stderr, /"route": "\/wp-json\/"/);
  assert.match(proof.stderr, /"status": 502/);
  assert.match(proof.stderr, /"body": "WordPress is not ready yet"/);
});

test('production-shaped release verify command reports the checked retained-source proof summary', () => {
  const proof = spawnReleaseVerify(
    {
      REPRINT_PUSH_SOURCE_URL: '',
      REPRINT_PUSH_REMOTE_URL: '',
      REPRINT_PUSH_LAB_AUTH_ADMIN_USER: '',
      REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: '',
      REPRINT_PUSH_USERNAME: '',
      REPRINT_PUSH_APPLICATION_PASSWORD: '',
      REPRINT_PUSH_SIGNING_SECRET: '',
      NODE_NO_WARNINGS: '1',
    },
    releaseVerifySlowPathTimeoutMs,
  );
  assertLiveReleaseVerifyProof(proof, 'retained-source release verify', releaseVerifySlowPathTimeoutMs);
  assert.equal(proof.status, 1, proof.stderr);
  assert.match(proof.stdout, /"releaseProof": \{/);
  assert.match(proof.stdout, /"ok": true/);
  assert.match(proof.stdout, /"code": "RETAINED_SOURCE_SUMMARY_OK"/);
  assert.match(proof.stdout, /"sourceUrl": "http:\/\/127\.0\.0\.1:\d+"/);
  assert.match(proof.stdout, /"protocolExtension": \{/);
  assert.match(
    proof.stdout,
    /"boundary": \{\s*"firstRemainingProductionBoundary": "auth\/session lifecycle and durable journal semantics"/,
  );
  assert.match(proof.stdout, /"verdict": "PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED"/);
  assert.match(proof.stdout, /"durableJournal": \{\s*"proof": \{\s*"status": 0,\s*"journal": \{/);
  assert.match(proof.stdout, /"rows": 17,\s*"applyCommitted": true,\s*"mutationApplied": 7,\s*"idempotencyOpened": 1/);
  assert.match(proof.stdout, /"leaseFence": \{\s*"storageGuard": "filesystem-compare-rename",\s*"fsyncEvidence": true,\s*"monotonicSequence": true\s*\}/);
});

maybeTest('production-shaped live topology proof runs preflight against a local Playground source and reports the topology', () => {
  const proof = spawnBoundedSync(process.execPath, ['scripts/playground/production-shaped-live-topology-proof.mjs'], {
    cwd: repoRoot,
    ...proofSubprocessOptions,
    env: {
      ...process.env,
      NODE_NO_WARNINGS: '1',
    },
  }, 'live topology proof');
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
  const proof = spawnBoundedSync(process.execPath, ['scripts/playground/production-shaped-live-protocol-proof.mjs'], {
    cwd: repoRoot,
    ...proofSubprocessOptions,
    env: {
      ...process.env,
      NODE_NO_WARNINGS: '1',
    },
  }, 'live protocol proof');
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
  const proof = spawnBoundedSync(process.execPath, ['scripts/playground/production-shaped-topology-proof.mjs'], {
    cwd: repoRoot,
    ...proofSubprocessOptions,
    env: {
      ...process.env,
      NODE_NO_WARNINGS: '1',
    },
  }, 'topology proof');
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

  const child = spawn(
    'timeout',
    ['--preserve-status', '--kill-after=1s', `${playgroundServerTimeoutMs}s`, 'npx', ...args],
    {
      cwd: repoRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  activePlaygroundChildren.add(child);

  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });

  try {
    await waitForServer(child, baseUrl, () => output);
  } catch (error) {
    process.stderr.write(`${output}\n`);
    try {
      await stopPlaygroundChild(child);
    } catch (cleanupError) {
      process.stderr.write(
        `${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}\n`,
      );
    }
    throw error;
  }

  return { name, baseUrl, port, child };
}

async function stopPlaygroundServer(server) {
  await stopPlaygroundChild(server.child);
  activePlaygroundChildren.delete(server.child);
}

async function waitForServer(child, baseUrl, getLogs) {
  const deadline = Date.now() + serverStartupTimeoutMs;
  let lastError = null;
  const lastProbes = [];
  let consecutiveIndex502s = 0;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      const exitLabel =
        child.exitCode !== null ? `exited early with ${child.exitCode}` : `terminated by ${child.signalCode}`;
      const failureText = formatPlaygroundStartupFailure(
        `Playground server ${exitLabel}`,
        lastError,
        lastProbes,
        getLogs(),
      );
      writePlaygroundFailure(failureText, lastProbes, getLogs(), lastError);
      await stopPlaygroundChild(child);
      await waitForExit(child, 2_000).catch(() => {});
      throw new Error(failureText);
    }
    try {
      const response = await fetchWithTimeout(`${baseUrl}/wp-json/`, {
        headers: { connection: 'close' },
      });
      const responseBody = await response.clone().text().catch(() => '');
      lastProbes.push({
        route: '/wp-json/',
        status: response.status,
        ok: response.ok,
        body: responseBody.slice(0, 500),
      });
      process.stderr.write(
        `Playground probe ${baseUrl}/wp-json/ -> ${response.status} ${responseBody.slice(0, 160).replace(/\s+/g, ' ').trim()}\n`,
      );
      if (response.status === 200) {
        consecutiveIndex502s = 0;
        await response.arrayBuffer();
        const snapshot = await fetchWithTimeout(`${baseUrl}/wp-json/reprint-push-lab/v1/snapshot`, {
          headers: {
            Authorization: `Basic ${Buffer.from(`${liveCredentials.username}:${liveCredentials.password}`).toString('base64')}`,
            connection: 'close',
          },
        });
        const snapshotBody = await snapshot.clone().text().catch(() => '');
        lastProbes.push({
          route: '/wp-json/reprint-push-lab/v1/snapshot',
          status: snapshot.status,
          ok: snapshot.ok,
          body: snapshotBody.slice(0, 500),
        });
        process.stderr.write(
          `Playground probe ${baseUrl}/wp-json/reprint-push-lab/v1/snapshot -> ${snapshot.status} ${snapshotBody.slice(0, 160).replace(/\s+/g, ' ').trim()}\n`,
        );
        if (snapshot.status === 200) {
          await snapshot.arrayBuffer();
          return;
        }
        lastError = new Error(`Playground lab snapshot readiness HTTP ${snapshot.status}`);
      } else {
        lastError = new Error(`Playground index readiness HTTP ${response.status}`);
        consecutiveIndex502s = response.status === 502 ? consecutiveIndex502s + 1 : 0;
      }
      if (consecutiveIndex502s >= 1) {
        break;
      }
    } catch (error) {
      lastError = error;
      consecutiveIndex502s = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const failureText = formatPlaygroundStartupFailure(
    `Timed out waiting for Playground server at ${baseUrl}`,
    lastError,
    lastProbes,
    getLogs(),
  );
  writePlaygroundFailure(failureText, lastProbes, getLogs(), lastError);
  try {
    await stopPlaygroundChild(child);
  } catch (cleanupError) {
    process.stderr.write(
      `${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}\n`,
    );
  }
  throw new Error(failureText);
}

function writePlaygroundFailure(message, lastProbes, logs, lastError) {
  const summary = {
    message,
    lastProbe: lastProbes.at(-1) ?? null,
    lastError: lastError?.message ?? null,
  };
  process.stderr.write(`${message}\n`);
  process.stderr.write(`${JSON.stringify(summary)}\n`);
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  if (logs) {
    process.stderr.write(`${logs}\n`);
  }
}

function formatPlaygroundStartupFailure(prefix, lastError, lastProbes, logs) {
  const probeText = lastProbes.length
    ? `\nProbe trail: ${JSON.stringify(lastProbes.slice(-4), null, 2)}`
    : '';
  const lastProbe = lastProbes.at(-1);
  const lastProbeText = lastProbe
    ? `\nLast probe: ${JSON.stringify(
        {
          route: lastProbe.route,
          status: lastProbe.status,
          ok: lastProbe.ok,
          body: lastProbe.body,
        },
        null,
        2,
      )}`
    : '';
  const errorText = lastError?.message || 'unknown';
  return `${prefix}: ${errorText}${probeText}${lastProbeText}\n${logs}`;
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Timed out fetching ${url}`)), serverFetchTimeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
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
  const forcedDeadline = Date.now() + 2_000;
  while (Date.now() < forcedDeadline) {
    if (child.exitCode !== null) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Playground server did not exit after SIGKILL`);
}

async function stopPlaygroundChild(child) {
  if (child.exitCode !== null) {
    activePlaygroundChildren.delete(child);
    return;
  }
  stopProcessGroup(child, 'SIGTERM');
  stopParentProcesses(child, 'SIGTERM');
  try {
    await waitForExit(child, playgroundStopTimeoutMs);
  } catch (error) {
    stopProcessGroup(child, 'SIGKILL');
    stopParentProcesses(child, 'SIGKILL');
    try {
      await waitForExit(child, playgroundStopTimeoutMs);
    } catch {
      process.stderr.write('Playground server did not exit after SIGKILL\n');
      if (typeof child.pid === 'number') {
        process.stderr.write(`Playground child pid still active: ${child.pid}\n`);
      }
    }
    if (error instanceof Error) {
      process.stderr.write(`${error.message}\n`);
    }
    if (child.exitCode === null) {
      throw new Error(`Playground server did not exit cleanly after SIGKILL`);
    }
  }
  activePlaygroundChildren.delete(child);
}

function stopProcessGroup(child, signal) {
  if (typeof child.pid === 'number') {
    try {
      process.kill(-child.pid, signal);
    } catch {
      // Fall back to the wrapper PID if the process group is already gone.
    }
    try {
      process.kill(child.pid, signal);
      return;
    } catch {
      // Fall back to the child.kill() path below if the PID is already gone.
    }
  }
  child.kill(signal);
}

function stopParentProcesses(child, signal) {
  if (typeof child.pid !== 'number') {
    return;
  }
  const signalFlag = signal === 'SIGKILL' ? '-KILL' : '-TERM';
  for (const [command, args] of [
    ['pkill', [signalFlag, '-g', String(child.pid)]],
    ['pkill', [signalFlag, '-P', String(child.pid)]],
    ['kill', [signalFlag, String(child.pid)]],
  ]) {
    const proof = spawnBoundedSync(command, args, {
      cwd: repoRoot,
      env: process.env,
      encoding: 'utf8',
      timeout: 2_000,
      killSignal: 'SIGKILL',
    }, `process cleanup ${command}`);
    if (proof.status !== 0) {
      logBoundedSpawnProofFailure(command, args, proof);
    }
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
