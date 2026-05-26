import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadAuthSessionSource,
  resolveAuthSessionSourceCredentials,
} from '../scripts/playground/auth-session-source.js';
import {
  buildAuthSessionSourceCommand,
  resolveAuthSessionSourceCommand,
} from '../scripts/playground/auth-session-source-command.js';
import {
  bindPackagedProductionPluginRuntimeSource,
  isPackagedProductionPluginSourceCommand,
  resolvePackagedProductionPluginAuthSessionRequest,
  resolvePackagedProductionPluginAuthSessionSource,
  resolvePackagedProductionPluginSourceCommand,
} from '../scripts/playground/packaged-production-plugin-source-command.js';
import {
  packagedProductionPluginPreflightReady,
  packagedProductionPluginServerReady,
  packagedProductionPluginSnapshotReady,
} from '../scripts/playground/packaged-production-plugin-readiness.js';
import {
  evaluateProductionAuthSessionLifecycle,
  evaluateProductionAuthSessionLifecycleSummary,
  isExpiredAuthSession,
  summarizeProductionAuthSessionLifecycleTrace,
} from '../scripts/playground/production-auth-session-lifecycle.js';
import {
  loadBlueprintSnapshotFixture,
  resolveBlueprintSnapshotFixturePath,
} from '../scripts/playground/blueprint-snapshot-fixture.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const muPluginDir = path.join(repoRoot, 'scripts/playground/rest-mu-plugins');
const serverStartupTimeoutMs = 1_500;
const playgroundServerTimeoutMs = 8;
const serverFetchTimeoutMs = 3_000;
const playgroundStopTimeoutMs = 3_000;
const runLivePlaygroundTopologyTests = process.env.REPRINT_RUN_PLAYGROUND_LIVE_TESTS === '1';
const maybeTest = runLivePlaygroundTopologyTests ? test : test.skip;
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const liveCredentials = {
  username: 'reprint_push_admin',
  password: 'reprint-push-admin-app-password',
};
const proofSubprocessTimeoutMs = 30_000;
const proofSubprocessKillSignal = 'SIGTERM';
const liveProofSubprocessTimeoutMs = 15_000;
const liveProofSubprocessKillSignal = 'SIGKILL';
const liveProofInnerTimeoutMs = Math.max(1_000, Math.min(3_000, liveProofSubprocessTimeoutMs - 8_000));
// Give the verifier enough time to reach its own bounded readiness failure and
// emit probe diagnostics before the outer subprocess timeout can kill it.
const liveProofLaunchTimeoutMs = Math.max(1_000, Math.min(7_000, liveProofSubprocessTimeoutMs - 4_000));
// The checked release verifier now allows the shared remote-changed and
// local-edited Playground startup path to use its full bounded readiness
// window, so the focused subprocess proof needs a matching inner budget.
const releaseVerifyInnerTimeoutMs = Math.max(1_000, Math.min(24_000, proofSubprocessTimeoutMs - 6_000));
const releaseVerifySlowPathTimeoutMs = 15_000;
const releaseVerifySlowPathInnerTimeoutMs = Math.max(1_000, Math.min(6_000, releaseVerifySlowPathTimeoutMs - 6_000));
const proofSubprocessOptions = {
  timeout: proofSubprocessTimeoutMs,
  killSignal: proofSubprocessKillSignal,
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 20,
};
const releaseVerifyProofSubprocessOptions = {
  timeout: proofSubprocessTimeoutMs,
  killSignal: proofSubprocessKillSignal,
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 20,
  shell: false,
};

const activePlaygroundChildren = new Set();
process.on('exit', stopAllPlaygroundChildrenSync);
process.on('SIGINT', () => {
  stopAllPlaygroundChildrenSync();
});
process.on('SIGTERM', () => {
  stopAllPlaygroundChildrenSync();
});

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
    activePlaygroundChildren.delete(child);
  }
}

function spawnReleaseVerify(env = {}, options = {}) {
  const timeout = boundedReleaseVerifyTimeout(options.timeout ?? proofSubprocessTimeoutMs);
  const killSignal = options.killSignal ?? proofSubprocessKillSignal;
  const proof = spawnReleaseVerifySync(
    process.execPath,
    ['scripts/playground/production-shaped-release-verify.mjs'],
    {
      ...process.env,
      ...env,
    },
    {
      timeout,
      killSignal,
    },
  );
  assertReleaseVerifyProof(proof, 'production-shaped release verify', timeout);
  return proof;
}

function runReleaseVerifySync(env, timeout, killSignal, label) {
  const proof = spawnReleaseVerifySync(
    process.execPath,
    ['scripts/playground/production-shaped-release-verify.mjs'],
    env,
    {
      timeout: boundedReleaseVerifyTimeout(timeout),
      killSignal,
    },
  );
  assertReleaseVerifyProof(proof, label, timeout);
  return proof;
}

function spawnLiveReleaseVerify(env = {}, options = {}) {
  const timeout = options.timeout ?? liveProofSubprocessTimeoutMs;
  const boundedTimeout = Math.max(1_000, Math.min(timeout, liveProofLaunchTimeoutMs));
  return spawnProductionShapedReleaseVerifyCommand(
    {
      ...process.env,
      ...env,
    },
    liveProofSpawnOptions(boundedTimeout, options.killSignal),
    'live release verify',
  );
}

function boundedLiveReleaseVerifyOptions(options = {}) {
  return {
    timeout: options.timeout ?? liveProofInnerTimeoutMs,
    killSignal: options.killSignal ?? liveProofSubprocessKillSignal,
  };
}

function spawnProductionShapedReleaseVerify(env, options, label) {
  return spawnProductionShapedReleaseVerifyCommand(env, options, label);
}

function spawnProductionShapedReleaseVerifyCommand(env, options, label) {
  const timeout = boundedReleaseVerifyTimeout(options.timeout ?? releaseVerifyInnerTimeoutMs);
  const proof = spawnReleaseVerifySync(process.execPath, ['scripts/playground/production-shaped-release-verify.mjs'], env, {
    timeout,
    killSignal: options.killSignal ?? proofSubprocessKillSignal,
  });
  assertReleaseVerifyProof(proof, label, timeout);
  return proof;
}

function boundedReleaseVerifyTimeout(timeout) {
  const outerBudget = Math.max(1_000, proofSubprocessTimeoutMs - 6_000);
  return Math.max(1_000, Math.min(timeout, releaseVerifyInnerTimeoutMs, outerBudget));
}

function spawnProductionShapedReleaseVerifyWithDiagnostics(env, options, label) {
  return spawnProductionShapedReleaseVerifyCommand(env, options, label);
}

function liveProofSpawnOptions(timeout, killSignal = liveProofSubprocessKillSignal) {
  return {
    timeout,
    killSignal,
  };
}

function assertReleaseVerifyProof(proof, label, timeoutMs) {
  if (proof.error) {
    stopAllPlaygroundChildrenSync();
    reportSpawnFailure(proof);
    const timeoutNote = proof.error.code === 'ETIMEDOUT' && timeoutMs ? ` after ${timeoutMs}ms` : '';
    assert.fail(formatSpawnFailure(`${label} failed${timeoutNote} with explicit spawn error handling`, proof));
  }

  if (proof.signal) {
    stopAllPlaygroundChildrenSync();
    reportSpawnFailure(proof);
    assert.fail(formatSpawnFailure(`${label} terminated by ${proof.signal}${timeoutMs ? ` after ${timeoutMs}ms` : ''} with explicit spawn signal handling`, proof));
  }

  if (proof.status === null) {
    stopAllPlaygroundChildrenSync();
    reportSpawnFailure(proof);
    assert.fail(`${label} exited without a status with explicit spawn status handling\nstdout:\n${proof.stdout ?? ''}\nstderr:\n${proof.stderr ?? ''}`);
  }
}

function assertLiveReleaseVerifyProof(proof, label, timeoutMs) {
  if (proof.error) {
    stopAllPlaygroundChildrenSync();
    reportSpawnFailure(proof);
    const timeoutNote = proof.error.code === 'ETIMEDOUT' && timeoutMs ? ` after ${timeoutMs}ms` : '';
    assert.fail(formatSpawnFailure(`${label} failed${timeoutNote} with explicit spawn error handling`, proof));
  }
  if (proof.signal) {
    stopAllPlaygroundChildrenSync();
    reportSpawnFailure(proof);
    assert.fail(formatSpawnFailure(`${label} terminated by ${proof.signal}${timeoutMs ? ` after ${timeoutMs}ms` : ''} with explicit spawn signal handling`, proof));
  }
  if (proof.status === null) {
    stopAllPlaygroundChildrenSync();
    reportSpawnFailure(proof);
    assert.fail(`${label} exited without a status with explicit spawn status handling\nstdout:\n${proof.stdout ?? ''}\nstderr:\n${proof.stderr ?? ''}`);
  }
}

function assertSpawnCompletedWithoutSpawnError(proof, label, timeoutMs) {
  if (proof.error) {
    stopAllPlaygroundChildrenSync();
    reportSpawnFailure(proof);
    const timeoutNote = proof.error.code === 'ETIMEDOUT' && timeoutMs ? ` after ${timeoutMs}ms` : '';
    throw new Error(formatSpawnFailure(`${label} failed${timeoutNote} with explicit spawn error handling`, proof));
  }
  if (proof.signal) {
    stopAllPlaygroundChildrenSync();
    reportSpawnFailure(proof);
    throw new Error(formatSpawnFailure(`${label} terminated by ${proof.signal}${timeoutMs ? ` after ${timeoutMs}ms` : ''} with explicit spawn signal handling`, proof));
  }
  if (proof.status === null) {
    stopAllPlaygroundChildrenSync();
    reportSpawnFailure(proof);
    throw new Error(`${label} exited without a status with explicit spawn status handling\nstdout:\n${proof.stdout ?? ''}\nstderr:\n${proof.stderr ?? ''}`);
  }
}

function assertSpawnTerminationProof(proof, label, timeoutMs) {
  if (proof.error || proof.signal) {
    stopAllPlaygroundChildrenSync();
    reportSpawnFailure(proof);
    if (proof.error) {
      const timeoutNote = proof.error.code === 'ETIMEDOUT' && timeoutMs ? ` after ${timeoutMs}ms` : '';
      throw new Error(formatSpawnFailure(`${label} failed${timeoutNote} with explicit spawn error handling`, proof));
    }
    throw new Error(formatSpawnFailure(`${label} terminated by ${proof.signal}${timeoutMs ? ` after ${timeoutMs}ms` : ''} with explicit spawn signal handling`, proof));
  }
  if (proof.status === null) {
    stopAllPlaygroundChildrenSync();
    reportSpawnFailure(proof);
    throw new Error(`${label} exited without a status with explicit spawn status handling\nstdout:\n${proof.stdout ?? ''}\nstderr:\n${proof.stderr ?? ''}`);
  }
}

function spawnBoundedSync(command, args, options, label) {
  const boundedOptions = {
    shell: false,
    ...options,
    timeout: options.timeout ?? proofSubprocessTimeoutMs,
    killSignal: options.killSignal ?? 'SIGKILL',
  };
  const proof = spawnSync(command, args, boundedOptions);
  if (proof.error || proof.signal || proof.status === null) {
    failBoundedSpawnProof(proof, command, args);
    const timeoutNote = proof.error?.code === 'ETIMEDOUT' && boundedOptions.timeout ? ` after ${boundedOptions.timeout}ms` : '';
    if (proof.error) {
      throw new Error(formatSpawnFailure(`${label} failed${timeoutNote} with explicit spawn error handling`, proof));
    }
    if (proof.signal) {
      throw new Error(formatSpawnFailure(`${label} terminated by ${proof.signal}${boundedOptions.timeout ? ` after ${boundedOptions.timeout}ms` : ''} with explicit spawn signal handling`, proof));
    }
    throw new Error(`${label} exited without a status with explicit spawn status handling\nstdout:\n${proof.stdout ?? ''}\nstderr:\n${proof.stderr ?? ''}`);
  }
  assertBoundedSpawnProof(proof, command, args, label, boundedOptions.timeout);
  return proof;
}

function failBoundedSpawnProof(proof, command, args) {
  stopAllPlaygroundChildrenSync();
  reportBoundedSpawnFailure(proof, command, args);
  writeSpawnOutputTail(proof, `${command} ${args.join(' ')}`);
}

function failReleaseVerifySpawnProof(proof, command, args, label = 'release verify', timeoutMs = null) {
  failBoundedSpawnProof(proof, command, args);
  assertReleaseVerifySpawnFailure(proof, label, timeoutMs);
}

function spawnReleaseVerifySync(command, args, env, options = {}) {
  const timeout = Math.max(1_000, Math.min(options.timeout ?? releaseVerifyInnerTimeoutMs, proofSubprocessTimeoutMs));
  const killSignal = options.killSignal ?? proofSubprocessKillSignal;
  const proof = spawnBoundedReleaseVerify(command, args, env, {
    timeout,
    killSignal,
  });
  if (proof.error || proof.signal || proof.status === null) {
    failReleaseVerifySpawnProof(proof, command, args, 'release verify', timeout);
  }
  return proof;
}

function spawnBoundedReleaseVerify(command, args, env, options = {}, label = 'release verify') {
  const timeoutCeiling = Math.max(1_000, proofSubprocessTimeoutMs - 2_000);
  const timeout = Math.max(1_000, Math.min(options.timeout ?? proofSubprocessTimeoutMs, timeoutCeiling));
  const killSignal = options.killSignal ?? proofSubprocessKillSignal;
  const proof = spawnSync(command, args, {
    cwd: repoRoot,
    shell: false,
    timeout,
    killSignal,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
    env,
  });

  if (proof.error || proof.signal || proof.status === null) {
    stopAllPlaygroundChildrenSync();
    reportSpawnFailure(proof);
    const timeoutNote = proof.error?.code === 'ETIMEDOUT' && timeout ? ` after ${timeout}ms` : '';
    if (proof.error) {
      throw new Error(formatSpawnFailure(`${label} failed${timeoutNote} with explicit spawn error handling`, proof));
    }
    if (proof.signal) {
      throw new Error(formatSpawnFailure(`${label} terminated by ${proof.signal}${timeout ? ` after ${timeout}ms` : ''} with explicit spawn signal handling`, proof));
    }
    throw new Error(`${label} exited without a status with explicit spawn status handling\nstdout:\n${proof.stdout ?? ''}\nstderr:\n${proof.stderr ?? ''}`);
  }

  return proof;
}

function spawnProductionShapedReleaseVerifySync(env, options = {}, label = 'production-shaped release verify') {
  const timeoutCeiling = Math.max(1_000, liveProofSubprocessTimeoutMs - 2_000);
  const timeout = Math.max(1_000, Math.min(options.timeout ?? releaseVerifyInnerTimeoutMs, timeoutCeiling));
  const killSignal = options.killSignal ?? proofSubprocessKillSignal;
  const proof = spawnBoundedReleaseVerify(
    process.execPath,
    ['scripts/playground/production-shaped-release-verify.mjs'],
    env,
    {
      timeout,
      killSignal,
    },
    label,
  );
  return proof;
}

function assertBoundedSpawnProof(proof, command, args, label, timeoutMs) {
  if (!proof.error && !proof.signal && proof.status !== null) {
    return;
  }

  stopAllPlaygroundChildrenSync();
  reportBoundedSpawnFailure(proof, command, args);
  const timeoutNote = timeoutMs ? ` after ${timeoutMs}ms` : '';
  const failureLabel = `${label} with bounded spawn handling`;

  if (proof.error) {
    throw new Error(formatSpawnFailure(`${failureLabel} failed${proof.error.code === 'ETIMEDOUT' ? timeoutNote : ''}`, proof));
  }
  if (proof.signal) {
    throw new Error(formatSpawnFailure(`${failureLabel} terminated by ${proof.signal}${timeoutNote}`, proof));
  }
  throw new Error(formatSpawnFailure(`${failureLabel} exited without a status`, proof));
}

function assertReleaseVerifySpawnFailure(proof, label, timeoutMs) {
  stopAllPlaygroundChildrenSync();
  reportSpawnFailure(proof);
  const timeoutNote = proof.error?.code === 'ETIMEDOUT' && timeoutMs ? ` after ${timeoutMs}ms` : '';
  if (proof.error) {
    throw new Error(formatSpawnFailure(`${label} failed${timeoutNote} with explicit spawn error handling`, proof));
  }
  if (proof.signal) {
    throw new Error(formatSpawnFailure(`${label} terminated by ${proof.signal}${timeoutMs ? ` after ${timeoutMs}ms` : ''} with explicit spawn signal handling`, proof));
  }
  throw new Error(`${label} exited without a status with explicit spawn status handling\nstdout:\n${proof.stdout ?? ''}\nstderr:\n${proof.stderr ?? ''}`);
}

function spawnReleaseVerifySlowPathBounded(env = {}, options = {}) {
  const timeout = options.timeout ?? releaseVerifySlowPathTimeoutMs;
  const boundedTimeout = Math.max(1_000, Math.min(timeout, releaseVerifySlowPathInnerTimeoutMs));
  const proof = spawnProductionShapedReleaseVerifySync(
    {
      ...process.env,
      ...env,
    },
    {
      timeout: boundedTimeout,
      killSignal: options.killSignal ?? proofSubprocessKillSignal,
    },
  );
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

function reportSpawnFailure(proof) {
  stopAllPlaygroundChildrenSync();
  process.stderr.write(`${describeSpawnProof(proof)}\n`);
  writeSpawnOutputTail(proof);
}

function reportBoundedSpawnFailure(proof, command, args) {
  stopAllPlaygroundChildrenSync();
  process.stderr.write(`${describeSpawnProof(proof)}\n`);
  writeSpawnOutputTail(proof, `${command} ${args.join(' ')}`);
}

function writeSpawnOutputTail(proof, commandLabel = '') {
  const tails = [
    ['stdout', (proof.stdout ?? '').trimEnd()],
    ['stderr', (proof.stderr ?? '').trimEnd()],
  ].filter(([, tail]) => tail);
  if (tails.length === 0) {
    return;
  }

  let structuredTail = null;
  for (const [channel, tail] of tails) {
    const slicedTail = tail.slice(-4000);
    const parsedTail = parseStructuredTail(slicedTail);
    if (commandLabel) {
      process.stderr.write(`${commandLabel} ${channel} tail:\n${slicedTail}\n`);
    } else {
      process.stderr.write(`${channel} tail:\n${slicedTail}\n`);
    }
    if (
      !structuredTail &&
      parsedTail &&
      (parsedTail.route !== null || parsedTail.status !== null || parsedTail.body !== null)
    ) {
      structuredTail = parsedTail;
    }
  }

  if (structuredTail) {
    const structuredTailText = `Last route/status/body: ${JSON.stringify(structuredTail, null, 2)}\n`;
    process.stderr.write(structuredTailText);
    process.stdout.write(structuredTailText);
  }
}

function parseStructuredTail(text) {
  const start = text.lastIndexOf('{');
  if (start === -1) {
    return null;
  }
  try {
    const parsed = JSON.parse(text.slice(start));
    const lastProbe = parsed.lastProbe ?? parsed.lastProbeSummary ?? parsed.lastProbeResult ?? null;
    const topLevel = parsed.lastProbe
      ? parsed
      : parsed?.summary
        ? parsed.summary
        : parsed;
    return {
      route: lastProbe?.route ?? topLevel?.route ?? parsed?.route ?? null,
      status: lastProbe?.status ?? topLevel?.status ?? parsed?.status ?? null,
      body: lastProbe?.body ?? topLevel?.body ?? parsed?.body ?? null,
    };
  } catch {
    return null;
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

function assertReleaseVerifySpawnProof(proof, label, timeoutMs) {
  if (proof.error) {
    reportSpawnFailure(proof);
    const timeoutNote = proof.error.code === 'ETIMEDOUT' && timeoutMs ? ` after ${timeoutMs}ms` : '';
    throw new Error(formatSpawnFailure(`${label} failed${timeoutNote} with explicit spawn error handling`, proof));
  }
  if (proof.signal) {
    reportSpawnFailure(proof);
    throw new Error(formatSpawnFailure(`${label} terminated by ${proof.signal}${timeoutMs ? ` after ${timeoutMs}ms` : ''} with explicit spawn signal handling`, proof));
  }
  if (proof.status === null) {
    reportSpawnFailure(proof);
    throw new Error(`${label} exited without a status with explicit spawn status handling\nstdout:\n${proof.stdout ?? ''}\nstderr:\n${proof.stderr ?? ''}`);
  }
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
  const proof = spawnProductionShapedReleaseVerify(
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
    boundedLiveReleaseVerifyOptions({ timeout: Math.max(1_000, Math.min(releaseVerifySlowPathTimeoutMs, liveProofInnerTimeoutMs)) }),
    'durable journal release verify',
  );
  assertReleaseVerifySpawnProof(proof, 'durable journal release verify', liveProofInnerTimeoutMs);
  assert.equal(proof.status, 1, proof.stderr);
  assert.match(proof.stdout, /"code": "PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED"/);
});

test('production-shaped release verify request state marks synthesized packaged production auth/session sources as packaged requests', () => {
  const request = resolvePackagedProductionPluginAuthSessionRequest({
    sourceUrl: 'http://127.0.0.1:8080',
    username: liveCredentials.username,
    applicationPassword: liveCredentials.password,
  });

  assert.equal(request.requested, true);
  assert.equal(isPackagedProductionPluginSourceCommand(request.command), true);
  assert.match(request.command, /^REPRINT_PUSH_PACKAGED_PRODUCTION_PLUGIN=1 /);
  assert.deepEqual(request.source, {
    ok: true,
    sourceUrl: 'http://127.0.0.1:8080',
    username: liveCredentials.username,
    applicationPassword: liveCredentials.password,
  });
});

test('production-shaped release verify command consumes the production auth/session source command when provided', () => {
  const sourceCommand = buildAuthSessionSourceCommand({
    sourceUrl: 'http://127.0.0.1:8080',
    username: 'reprint_push_admin',
    applicationPassword: 'reprint-push-admin-app-password',
  });
  const source = loadAuthSessionSource(sourceCommand, {
    ...process.env,
    NODE_NO_WARNINGS: '1',
  }, repoRoot);
  assert.deepEqual(source, {
    ok: true,
    sourceUrl: 'http://127.0.0.1:8080',
    username: 'reprint_push_admin',
    applicationPassword: 'reprint-push-admin-app-password',
  });
});

test('production auth/session source loader fails closed when required fields are missing', () => {
  const source = loadAuthSessionSource(
    `${process.execPath} -e "process.stdout.write(JSON.stringify({sourceUrl:'http://127.0.0.1:8080', username:'reprint_push_admin'}))"`,
    {
      ...process.env,
      NODE_NO_WARNINGS: '1',
    },
    repoRoot,
  );

  assert.deepEqual(source, {
    ok: false,
    error: 'Auth session source command must return applicationPassword',
  });
});

test('production auth/session source loader fails closed when required fields are non-string values', () => {
  const source = loadAuthSessionSource(
    `${process.execPath} -e "process.stdout.write(JSON.stringify({sourceUrl:'http://127.0.0.1:8080', username:{owner:'reprint_push_admin'}, applicationPassword:['secret']}))"`,
    {
      ...process.env,
      NODE_NO_WARNINGS: '1',
    },
    repoRoot,
  );

  assert.deepEqual(source, {
    ok: false,
    error: 'Auth session source command must return username',
  });
});

test('production auth/session source loader fails closed when required fields contain control characters', () => {
  const source = loadAuthSessionSource(
    `${process.execPath} -e "process.stdout.write(JSON.stringify({sourceUrl:'http://127.0.0.1:8080/\\npath', username:'reprint_push_admin', applicationPassword:'secret-value'}))"`,
    {
      ...process.env,
      NODE_NO_WARNINGS: '1',
    },
    repoRoot,
  );

  assert.deepEqual(source, {
    ok: false,
    error: 'Auth session source command must return sourceUrl',
  });
});

test('production auth/session source loader fails closed when required fields contain surrounding whitespace', () => {
  const source = loadAuthSessionSource(
    `${process.execPath} -e "process.stdout.write(JSON.stringify({sourceUrl:' http://127.0.0.1:8080 ', username:' reprint_push_admin ', applicationPassword:' secret-value '}))"`,
    {
      ...process.env,
      NODE_NO_WARNINGS: '1',
    },
    repoRoot,
  );

  assert.deepEqual(source, {
    ok: false,
    error: 'Auth session source command must return sourceUrl',
  });
});

test('production-shaped release verify synthesizes the packaged production auth/session source command on the checked release path', () => {
  const expectedSourceCommand = buildAuthSessionSourceCommand({
    sourceUrl: 'http://127.0.0.1:8080',
    username: 'reprint_push_admin',
    applicationPassword: 'reprint-push-admin-app-password',
  });
  const sourceCommand = resolvePackagedProductionPluginSourceCommand({
    sourceUrl: 'http://127.0.0.1:8080',
    username: 'reprint_push_admin',
    applicationPassword: 'reprint-push-admin-app-password',
  });
  assert.equal(sourceCommand, `REPRINT_PUSH_PACKAGED_PRODUCTION_PLUGIN=1 ${expectedSourceCommand}`);
});

test('production-shaped release verify consumes the packaged production auth/session source command on the checked release path', () => {
  const sourceUrl = 'http://127.0.0.1:8080';
  const packagedSource = resolvePackagedProductionPluginAuthSessionSource({
    sourceUrl,
    username: 'reprint_push_admin',
    applicationPassword: 'reprint-push-admin-app-password',
  });

  assert.equal(
    packagedSource.command,
    `REPRINT_PUSH_PACKAGED_PRODUCTION_PLUGIN=1 ${buildAuthSessionSourceCommand({
      sourceUrl,
      username: 'reprint_push_admin',
      applicationPassword: 'reprint-push-admin-app-password',
    })}`,
  );
  assert.deepEqual(packagedSource.source, {
    ok: true,
    sourceUrl,
    username: 'reprint_push_admin',
    applicationPassword: 'reprint-push-admin-app-password',
  });
  assert.equal(packagedSource.source.applicationPassword, 'reprint-push-admin-app-password');
});

test('packaged production plugin source command preserves an explicit command override', () => {
  const sourceCommand = resolvePackagedProductionPluginSourceCommand({
    sourceUrl: 'http://127.0.0.1:8080',
    username: 'reprint_push_admin',
    applicationPassword: 'reprint-push-admin-app-password',
    authSessionSourceCommand: 'custom-source-command',
  });
  assert.equal(sourceCommand, 'REPRINT_PUSH_PACKAGED_PRODUCTION_PLUGIN=1 custom-source-command');
});

test('production-shaped release verify prefers the consumed production auth/session source over stale env credentials', () => {
  const source = {
    ok: true,
    sourceUrl: 'http://127.0.0.1:8080',
    username: 'reprint_push_admin',
    applicationPassword: 'reprint-push-admin-app-password',
  };
  assert.deepEqual(
    resolveAuthSessionSourceCredentials(
      {
        liveSourceUrl: 'http://127.0.0.1:8080',
        username: 'stale-lab-username',
        applicationPassword: 'stale-lab-password',
      },
      source,
    ),
    {
      liveSourceUrl: 'http://127.0.0.1:8080',
      username: 'reprint_push_admin',
      applicationPassword: 'reprint-push-admin-app-password',
    },
  );
});

test('production-shaped release verify can force the production auth/session source to override stale env credentials', () => {
  const source = {
    ok: true,
    sourceUrl: 'http://127.0.0.1:8080',
    username: 'reprint_push_admin',
    applicationPassword: 'reprint-push-admin-app-password',
  };
  assert.deepEqual(
    resolveAuthSessionSourceCredentials(
      {
        liveSourceUrl: 'http://127.0.0.1:9999',
        username: 'stale-lab-username',
        applicationPassword: 'stale-lab-password',
      },
      source,
      { preferSource: true },
    ),
    {
      liveSourceUrl: 'http://127.0.0.1:8080',
      username: 'reprint_push_admin',
      applicationPassword: 'reprint-push-admin-app-password',
    },
  );
});

test('production-shaped release verify ignores malformed direct auth/session source credentials', () => {
  const source = {
    ok: true,
    sourceUrl: ' http://127.0.0.1:8080 ',
    username: ' reprint_push_admin ',
    applicationPassword: ' reprint-push-admin-app-password ',
  };
  assert.deepEqual(
    resolveAuthSessionSourceCredentials(
      {
        liveSourceUrl: 'http://127.0.0.1:9999',
        username: 'stale-lab-username',
        applicationPassword: 'stale-lab-password',
      },
      source,
      { preferSource: true },
    ),
    {
      liveSourceUrl: 'http://127.0.0.1:9999',
      username: 'stale-lab-username',
      applicationPassword: 'stale-lab-password',
    },
  );
});

test('auth-session source command builder emits a shell-safe node snippet', () => {
  const command = buildAuthSessionSourceCommand({
    nodePath: '/opt/node/bin/node',
    sourceUrl: "http://127.0.0.1:8080/path?label=owner's",
    username: "reprint_push_owner'oops",
    applicationPassword: "p@ss'word",
  });

  assert.equal(
    command,
    "REPRINT_PUSH_SOURCE_COMMAND_SOURCE_URL='http://127.0.0.1:8080/path?label=owner'\\''s' REPRINT_PUSH_SOURCE_COMMAND_USERNAME='reprint_push_owner'\\''oops' REPRINT_PUSH_SOURCE_COMMAND_APPLICATION_PASSWORD='p@ss'\\''word' /opt/node/bin/node -e 'process.stdout.write(JSON.stringify({sourceUrl: process.env.REPRINT_PUSH_SOURCE_COMMAND_SOURCE_URL, username: process.env.REPRINT_PUSH_SOURCE_COMMAND_USERNAME, applicationPassword: process.env.REPRINT_PUSH_SOURCE_COMMAND_APPLICATION_PASSWORD}))'",
  );
});

test('auth-session source command builder preserves shell-sensitive credential characters when loaded', () => {
  const sourceUrl = 'http://127.0.0.1:8080/path?label=$USER&quote="double"&tick=`cmd`';
  const username = 'reprint "owner" $USER `tick`';
  const applicationPassword = "p@ss'word \"$HOME\" `danger`";
  const command = buildAuthSessionSourceCommand({
    sourceUrl,
    username,
    applicationPassword,
  });

  const source = loadAuthSessionSource(command, {
    ...process.env,
    NODE_NO_WARNINGS: '1',
  }, repoRoot);

  assert.deepEqual(source, {
    ok: true,
    sourceUrl,
    username,
    applicationPassword,
  });
});

test('auth-session source command builder fails closed when required fields contain surrounding whitespace or control characters', () => {
  assert.throws(
    () => buildAuthSessionSourceCommand({
      sourceUrl: ' http://127.0.0.1:8080 ',
      username: 'reprint_push_admin',
      applicationPassword: 'reprint-push-admin-app-password',
    }),
    /Missing sourceUrl/,
  );

  assert.throws(
    () => buildAuthSessionSourceCommand({
      sourceUrl: 'http://127.0.0.1:8080',
      username: 'reprint_push_admin\n',
      applicationPassword: 'reprint-push-admin-app-password',
    }),
    /Missing username/,
  );

  assert.throws(
    () => buildAuthSessionSourceCommand({
      sourceUrl: 'http://127.0.0.1:8080',
      username: 'reprint_push_admin',
      applicationPassword: ' secret-value ',
    }),
    /Missing applicationPassword/,
  );
});

test('auth-session source loader fails closed when the source command times out', () => {
  const source = loadAuthSessionSource(
    `${process.execPath} -e "setTimeout(() => process.stdout.write('{}'), 250)"`,
    {
      ...process.env,
      NODE_NO_WARNINGS: '1',
    },
    repoRoot,
    {
      timeout: 50,
    },
  );

  assert.equal(source.ok, false);
  assert.match(source.error, /ETIMEDOUT|timed out/i);
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

test('production-shaped release verify fails closed when a required production auth/session source command is invalid', () => {
  const proof = spawnProductionShapedReleaseVerifySync(
    {
      ...process.env,
      REPRINT_PUSH_SOURCE_URL: 'http://127.0.0.1:8080',
      REPRINT_PUSH_REMOTE_URL: 'http://127.0.0.1:8080',
      REPRINT_PUSH_USERNAME: 'stale-lab-username',
      REPRINT_PUSH_APPLICATION_PASSWORD: 'stale-lab-password',
      REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND: `${process.execPath} -e "process.stdout.write(JSON.stringify({sourceUrl:'http://127.0.0.1:8080', username:'reprint_push_admin'}))"`,
      REPRINT_PUSH_REQUIRE_PRODUCTION_AUTH_SESSION: '1',
      NODE_NO_WARNINGS: '1',
    },
    {
      timeout: releaseVerifyInnerTimeoutMs,
      killSignal: proofSubprocessKillSignal,
    },
    'invalid auth/session source release verify',
  );
  assertSpawnCompletedWithoutSpawnError(proof, 'invalid auth/session source release verify', releaseVerifyInnerTimeoutMs);
  assert.equal(proof.status, 1, proof.stderr);
  assert.match(proof.stdout, /"ok": false/);
  assert.match(proof.stdout, /"verdict": "PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED"/);
  assert.match(proof.stdout, /"observed": "invalid-production-auth-session-source"/);
  assert.match(proof.stdout, /"error": "Auth session source command must return applicationPassword"/);
  assert.match(proof.stdout, /"authSessionType": "invalid-production-auth-session-source"/);
});

maybeTest('production-shaped release verify command surfaces the consumed production auth/session source evidence', async () => {
  await withPlaygroundServer('remote-base', path.join(repoRoot, 'fixtures/playground/remote-base.blueprint.json'), async (remoteServer) => {
    const proof = spawnProductionShapedReleaseVerifySync(
      {
        ...process.env,
        REPRINT_PUSH_SOURCE_URL: remoteServer.baseUrl,
        REPRINT_PUSH_REMOTE_URL: remoteServer.baseUrl,
        REPRINT_PUSH_USERNAME: 'stale-lab-username',
        REPRINT_PUSH_APPLICATION_PASSWORD: 'stale-lab-password',
        REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND: buildAuthSessionSourceCommand({
          sourceUrl: remoteServer.baseUrl,
          username: liveCredentials.username,
          applicationPassword: liveCredentials.password,
        }),
        NODE_NO_WARNINGS: '1',
      },
      {
        timeout: liveProofInnerTimeoutMs,
        killSignal: liveProofSubprocessKillSignal,
      },
      'auth/session source evidence release verify',
    );
    assertSpawnCompletedWithoutSpawnError(proof, 'auth/session source evidence release verify', liveProofInnerTimeoutMs);
    assert.match(proof.stdout, /"authSessionSource": \{\s*"command": "[^"]+REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND[^"]+",\s*"ok": true,\s*"sourceUrl": "http:\/\/127\.0\.0\.1:\d+"/);
  });
});

test('packaged production plugin auth/session source helper resolves and loads the packaged source command', () => {
  const expectedCommand = buildAuthSessionSourceCommand({
    sourceUrl: 'http://127.0.0.1:8080',
    username: 'reprint_push_admin',
    applicationPassword: 'reprint-push-admin-app-password',
  });
  const packaged = resolvePackagedProductionPluginAuthSessionSource({
    sourceUrl: 'http://127.0.0.1:8080',
    username: 'reprint_push_admin',
    applicationPassword: 'reprint-push-admin-app-password',
  });

  assert.equal(packaged.command, `REPRINT_PUSH_PACKAGED_PRODUCTION_PLUGIN=1 ${expectedCommand}`);
  assert.deepEqual(packaged.source, {
    ok: true,
    sourceUrl: 'http://127.0.0.1:8080',
    username: 'reprint_push_admin',
    applicationPassword: 'reprint-push-admin-app-password',
  });
});

test('packaged production plugin readiness helper accepts a stable snapshot before signed preflight is ready', () => {
  const readySnapshot = {
    status: 200,
    body: {
      ok: true,
    },
  };
  const notReadyPreflight = {
    status: 502,
    body: {
      code: 'wordpress_not_ready',
    },
  };
  const strictReadyPreflight = {
    status: 200,
    body: {
      ok: true,
      routeProfile: {
        labBacked: false,
      },
      auth: {
        session: {
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
        },
      },
    },
  };

  assert.equal(packagedProductionPluginSnapshotReady(readySnapshot), true);
  assert.equal(packagedProductionPluginPreflightReady(strictReadyPreflight), true);
  assert.equal(
    packagedProductionPluginServerReady({
      snapshot: readySnapshot,
      preflight: notReadyPreflight,
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginServerReady({
      snapshot: readySnapshot,
      preflight: strictReadyPreflight,
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginServerReady({
      snapshot: {
        status: 502,
        body: {
          ok: false,
        },
      },
      preflight: strictReadyPreflight,
    }),
    false,
  );
});

test('packaged production plugin runtime source binding replaces the stale command source URL', () => {
  const bound = bindPackagedProductionPluginRuntimeSource({
    sourceUrl: 'http://127.0.0.1:8080',
    authSessionSource: {
      ok: true,
      sourceUrl: 'http://127.0.0.1:8080',
      username: 'reprint_push_admin',
      applicationPassword: 'reprint-push-admin-app-password',
    },
    runtimeSourceUrl: 'http://127.0.0.1:49152',
  });

  assert.deepEqual(bound, {
    sourceUrl: 'http://127.0.0.1:49152',
    authSessionSource: {
      ok: true,
      sourceUrl: 'http://127.0.0.1:49152',
      username: 'reprint_push_admin',
      applicationPassword: 'reprint-push-admin-app-password',
    },
  });
});

test('packaged production plugin runtime source binding ignores malformed runtime source URLs', () => {
  const authSessionSource = {
    ok: true,
    sourceUrl: 'http://127.0.0.1:8080',
    username: 'reprint_push_admin',
    applicationPassword: 'reprint-push-admin-app-password',
  };

  assert.deepEqual(
    bindPackagedProductionPluginRuntimeSource({
      sourceUrl: 'http://127.0.0.1:8080',
      authSessionSource,
      runtimeSourceUrl: ' http://127.0.0.1:49152 ',
    }),
    {
      sourceUrl: 'http://127.0.0.1:8080',
      authSessionSource,
    },
  );

  assert.deepEqual(
    bindPackagedProductionPluginRuntimeSource({
      sourceUrl: 'http://127.0.0.1:8080',
      authSessionSource,
      runtimeSourceUrl: 'http://127.0.0.1:49152/\u0000broken',
    }),
    {
      sourceUrl: 'http://127.0.0.1:8080',
      authSessionSource,
    },
  );

  assert.deepEqual(
    bindPackagedProductionPluginRuntimeSource({
      sourceUrl: 'http://127.0.0.1:8080',
      authSessionSource,
      runtimeSourceUrl: 49152,
    }),
    {
      sourceUrl: 'http://127.0.0.1:8080',
      authSessionSource,
    },
  );
});

test('production auth/session lifecycle helper requires an active unexpired packaged session', () => {
  assert.deepEqual(
    evaluateProductionAuthSessionLifecycle({
      id: 'psh_01j00000000000000000000000',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
    }),
    {
      ok: true,
      required: 'production-auth-session lifecycle',
      observed: 'production-auth-session',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycle({
      id: 'psh_01j00000000000000000000000',
      type: 'production-auth-session',
      status: 'active',
    }),
    {
      ok: false,
      required: 'unexpired',
      observed: 'missing',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycle({
      id: 'psh_01j00000000000000000000000',
      type: 'production-auth-session',
      status: 'revoked',
      expiresAt: '2099-01-01T00:00:00Z',
    }),
    {
      ok: false,
      required: 'active',
      observed: 'revoked',
    },
  );
});

test('production auth/session lifecycle helper treats invalid or past expiry as expired', () => {
  assert.equal(
    isExpiredAuthSession({ expiresAt: '2000-01-01T00:00:00Z' }, new Date('2000-01-01T00:00:01Z')),
    true,
  );
  assert.equal(
    isExpiredAuthSession({ expiresAt: 'not-a-date' }, new Date('2000-01-01T00:00:01Z')),
    true,
  );
  assert.equal(
    isExpiredAuthSession({ expiresAt: '2099-01-01T00:00:00Z' }, new Date('2000-01-01T00:00:01Z')),
    false,
  );
});

test('production auth/session lifecycle helper fails closed on string-valued cleanup aliases', () => {
  assert.deepEqual(
    evaluateProductionAuthSessionLifecycle({
      id: 'psh_01j00000000000000000000000',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      cleanup: 'true',
    }),
    {
      ok: false,
      required: 'boolean lifecycle flags',
      observed: 'invalid-cleanup',
    },
  );
});

test('production auth/session lifecycle helper fails closed on malformed lifecycle identity fields', () => {
  assert.deepEqual(
    evaluateProductionAuthSessionLifecycle({
      id: ['psh_01j00000000000000000000000'],
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
    }),
    {
      ok: false,
      required: 'string lifecycle fields',
      observed: 'invalid-id',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycle({
      id: 'psh_01j00000000000000000000000',
      type: ['production-auth-session'],
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
    }),
    {
      ok: false,
      required: 'string lifecycle fields',
      observed: 'invalid-type',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycle({
      id: 'psh_01j00000000000000000000000',
      type: 'production-auth-session',
      status: { value: 'active' },
      expiresAt: '2099-01-01T00:00:00Z',
    }),
    {
      ok: false,
      required: 'string lifecycle fields',
      observed: 'invalid-status',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycle({
      id: 'psh_01j00000000000000000000000',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: ['2099-01-01T00:00:00Z'],
    }),
    {
      ok: false,
      required: 'string lifecycle fields',
      observed: 'invalid-expires-at',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycle({
      id: 'psh_01j00000000000000000000000',
      type: ' production-auth-session ',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
    }),
    {
      ok: false,
      required: 'string lifecycle fields',
      observed: 'invalid-type',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycle({
      id: 'psh_01j00000000000000000000000',
      type: 'production-auth-session',
      status: 'active\u0000',
      expiresAt: '2099-01-01T00:00:00Z',
    }),
    {
      ok: false,
      required: 'string lifecycle fields',
      observed: 'invalid-status',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycle({
      id: 'psh_01j00000000000000000000000',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: ' 2099-01-01T00:00:00Z ',
    }),
    {
      ok: false,
      required: 'string lifecycle fields',
      observed: 'invalid-expires-at',
    },
  );
});

test('production auth/session lifecycle summary helper requires a preserved active read', () => {
  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'apply',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
    }),
    {
      ok: true,
      required: 'production-auth-session lifecycle',
      observed: 'active-unexpired-preserved',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'apply',
        id: 'session-02',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        rotated: true,
        preserved: false,
      },
    }),
    {
      ok: false,
      required: 'preserved read',
      observed: 'rotated',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'apply',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
      observations: [
        {
          step: 'preflight',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          preserved: false,
          rotated: false,
        },
        {
          step: 'dry-run',
          id: 'session-02',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          preserved: true,
          rotated: false,
        },
        {
          step: 'apply',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          preserved: true,
          rotated: false,
        },
      ],
    }),
    {
      ok: false,
      required: 'preserved read',
      observed: 'rotated',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'apply',
        id: 'session-02',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
      observations: [
        {
          step: 'preflight',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          preserved: false,
          rotated: false,
        },
        {
          step: 'apply',
          id: 'session-02',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          preserved: true,
          rotated: false,
        },
      ],
    }),
    {
      ok: false,
      required: 'preserved read',
      observed: 'rotated',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'apply',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        cleanedUp: true,
        preserved: true,
      },
    }),
    {
      ok: false,
      required: 'unrevoked',
      observed: 'cleaned-up',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'apply',
        id: 'session-02',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
      rotated: {
        step: 'dry-run',
        rotated: true,
      },
      observations: [
        {
          step: 'preflight',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          preserved: false,
          rotated: false,
        },
        {
          step: 'dry-run',
          id: 'session-02',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          preserved: false,
          rotated: true,
        },
        {
          step: 'apply',
          id: 'session-02',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          preserved: true,
          rotated: false,
        },
      ],
    }),
    {
      ok: false,
      required: 'preserved read',
      observed: 'rotated',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'apply',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
      revoked: {
        step: 'dry-run',
        revoked: true,
      },
      observations: [
        {
          step: 'preflight',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          preserved: false,
          revoked: false,
        },
        {
          step: 'dry-run',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'revoked',
          expiresAt: '2099-01-01T00:00:00Z',
          preserved: true,
          revoked: true,
        },
        {
          step: 'apply',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          preserved: true,
          revoked: false,
        },
      ],
    }),
    {
      ok: false,
      required: 'unrevoked',
      observed: 'revoked',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'apply',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
      observations: [
        {
          step: 'preflight',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          preserved: false,
        },
        {
          step: 'cleanup',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          cleanedUp: true,
          preserved: true,
        },
      ],
    }),
    {
      ok: false,
      required: 'unrevoked',
      observed: 'cleaned-up',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'replay',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
      observations: [
        {
          step: 'preflight',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          preserved: false,
        },
        {
          step: 'replay',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2000-01-01T00:00:00Z',
          preserved: true,
        },
      ],
    }),
    {
      ok: false,
      required: 'unexpired',
      observed: '2000-01-01T00:00:00Z',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
    }),
    {
      ok: false,
      required: 'preserved read',
      observed: 'preflight',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
    }),
    {
      ok: false,
      required: 'issued preflight',
      observed: 'missing',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
    }),
    {
      ok: false,
      required: 'preserved read',
      observed: 'missing',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'recovery-inspect',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
      observations: [
        {
          step: 'preflight',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          preserved: false,
          rotated: false,
        },
        {
          step: 'recovery-inspect',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          preserved: true,
          rotated: false,
        },
      ],
    }),
    {
      ok: true,
      required: 'production-auth-session lifecycle',
      observed: 'active-unexpired-preserved',
    },
  );
});

test('production auth/session lifecycle trace summary preserves issued and read session evidence', () => {
  assert.deepEqual(
    summarizeProductionAuthSessionLifecycleTrace([
      {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        expired: false,
        revoked: false,
        cleanedUp: false,
        rotated: false,
        preserved: false,
      },
      {
        step: 'apply',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        expired: false,
        revoked: false,
        cleanedUp: false,
        rotated: false,
        preserved: true,
      },
    ]),
    {
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        invalidLifecycleFlag: null,
        expired: false,
        revoked: false,
        cleanedUp: false,
        rotated: false,
        preserved: false,
      },
      read: {
        step: 'apply',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        invalidLifecycleFlag: null,
        expired: false,
        revoked: false,
        cleanedUp: false,
        rotated: false,
        preserved: true,
      },
      expired: null,
      revoked: null,
      cleanedUp: null,
      rotated: null,
      preserved: {
        step: 'apply',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        invalidLifecycleFlag: null,
        expired: false,
        revoked: false,
        cleanedUp: false,
        rotated: false,
        preserved: true,
      },
      observations: [
        {
          step: 'preflight',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          invalidLifecycleFlag: null,
          expired: false,
          revoked: false,
          cleanedUp: false,
          rotated: false,
          preserved: false,
        },
        {
          step: 'apply',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          invalidLifecycleFlag: null,
          expired: false,
          revoked: false,
          cleanedUp: false,
          rotated: false,
          preserved: true,
        },
      ],
    },
  );
});

test('production auth/session lifecycle trace summary treats recovery inspect as a preserved read', () => {
  const summary = summarizeProductionAuthSessionLifecycleTrace([
    {
      step: 'preflight',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: false,
    },
    {
      step: 'recovery-inspect',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: true,
    },
  ]);

  assert.equal(summary.read?.step, 'recovery-inspect');
  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary(summary),
    {
      ok: true,
      required: 'production-auth-session lifecycle',
      observed: 'active-unexpired-preserved',
    },
  );
});

test('production auth/session lifecycle trace summary does not treat preflight as a preserved read', () => {
  const summary = summarizeProductionAuthSessionLifecycleTrace([
    {
      step: 'preflight',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: true,
    },
  ]);

  assert.deepEqual(summary, {
    issued: {
      step: 'preflight',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      invalidLifecycleFlag: null,
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: true,
    },
    read: null,
    expired: null,
    revoked: null,
    cleanedUp: null,
    rotated: null,
    preserved: {
      step: 'preflight',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      invalidLifecycleFlag: null,
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: true,
    },
    observations: [
      {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        invalidLifecycleFlag: null,
        expired: false,
        revoked: false,
        cleanedUp: false,
        rotated: false,
        preserved: true,
      },
    ],
  });

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary(summary),
    {
      ok: false,
      required: 'preserved read',
      observed: 'missing',
    },
  );
});

test('production auth/session lifecycle trace summary fails closed when no preflight-issued session exists', () => {
  const summary = summarizeProductionAuthSessionLifecycleTrace([
    {
      step: 'apply',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: true,
    },
    {
      step: 'replay',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: true,
    },
  ]);

  assert.deepEqual(summary, {
    issued: null,
    read: {
      step: 'replay',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      invalidLifecycleFlag: null,
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: true,
    },
    expired: null,
    revoked: null,
    cleanedUp: null,
    rotated: null,
    preserved: {
      step: 'apply',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      invalidLifecycleFlag: null,
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: true,
    },
    observations: [
      {
        step: 'apply',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        invalidLifecycleFlag: null,
        expired: false,
        revoked: false,
        cleanedUp: false,
        rotated: false,
        preserved: true,
      },
      {
        step: 'replay',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        invalidLifecycleFlag: null,
        expired: false,
        revoked: false,
        cleanedUp: false,
        rotated: false,
        preserved: true,
      },
    ],
  });

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary(summary),
    {
      ok: false,
      required: 'issued preflight',
      observed: 'missing',
    },
  );
});

test('production auth/session lifecycle summary fails closed when a preserved read appears before preflight issuance', () => {
  const summary = summarizeProductionAuthSessionLifecycleTrace([
    {
      step: 'apply',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: true,
    },
    {
      step: 'preflight',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: false,
    },
  ]);

  assert.deepEqual(summary, {
    issued: {
      step: 'preflight',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      invalidLifecycleFlag: null,
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: false,
    },
    read: {
      step: 'apply',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      invalidLifecycleFlag: null,
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: true,
    },
    expired: null,
    revoked: null,
    cleanedUp: null,
    rotated: null,
    preserved: {
      step: 'apply',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      invalidLifecycleFlag: null,
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: true,
    },
    observations: [
      {
        step: 'apply',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        invalidLifecycleFlag: null,
        expired: false,
        revoked: false,
        cleanedUp: false,
        rotated: false,
        preserved: true,
      },
      {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        invalidLifecycleFlag: null,
        expired: false,
        revoked: false,
        cleanedUp: false,
        rotated: false,
        preserved: false,
      },
    ],
  });

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary(summary),
    {
      ok: false,
      required: 'issued preflight',
      observed: 'apply',
    },
  );
});

test('production auth/session lifecycle summary fails closed when an intermediate preserved read drops the production auth session type', () => {
  const summary = summarizeProductionAuthSessionLifecycleTrace([
    {
      step: 'preflight',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: false,
    },
    {
      step: 'apply',
      id: 'session-01',
      type: 'lab-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: true,
    },
    {
      step: 'journal',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: true,
    },
  ]);

  assert.deepEqual(summary, {
    issued: {
      step: 'preflight',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      invalidLifecycleFlag: null,
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: false,
    },
    read: {
      step: 'journal',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      invalidLifecycleFlag: null,
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: true,
    },
    expired: null,
    revoked: null,
    cleanedUp: null,
    rotated: null,
    preserved: {
      step: 'apply',
      id: 'session-01',
      type: 'lab-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      invalidLifecycleFlag: null,
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: true,
    },
    observations: [
      {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        invalidLifecycleFlag: null,
        expired: false,
        revoked: false,
        cleanedUp: false,
        rotated: false,
        preserved: false,
      },
      {
        step: 'apply',
        id: 'session-01',
        type: 'lab-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        invalidLifecycleFlag: null,
        expired: false,
        revoked: false,
        cleanedUp: false,
        rotated: false,
        preserved: true,
      },
      {
        step: 'journal',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        invalidLifecycleFlag: null,
        expired: false,
        revoked: false,
        cleanedUp: false,
        rotated: false,
        preserved: true,
      },
    ],
  });

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary(summary),
    {
      ok: false,
      required: 'production-auth-session',
      observed: 'lab-auth-session',
    },
  );
});

test('production auth/session lifecycle summary fails closed when the trace reissues preflight after issuance', () => {
  const summary = summarizeProductionAuthSessionLifecycleTrace([
    {
      step: 'preflight',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: false,
    },
    {
      step: 'apply',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: true,
    },
    {
      step: 'preflight',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: false,
    },
  ]);

  assert.deepEqual(summary, {
    issued: {
      step: 'preflight',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      invalidLifecycleFlag: null,
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: false,
    },
    read: {
      step: 'apply',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      invalidLifecycleFlag: null,
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: true,
    },
    expired: null,
    revoked: null,
    cleanedUp: null,
    rotated: null,
    preserved: {
      step: 'apply',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      invalidLifecycleFlag: null,
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: true,
    },
    observations: [
      {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        invalidLifecycleFlag: null,
        expired: false,
        revoked: false,
        cleanedUp: false,
        rotated: false,
        preserved: false,
      },
      {
        step: 'apply',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        invalidLifecycleFlag: null,
        expired: false,
        revoked: false,
        cleanedUp: false,
        rotated: false,
        preserved: true,
      },
      {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        invalidLifecycleFlag: null,
        expired: false,
        revoked: false,
        cleanedUp: false,
        rotated: false,
        preserved: false,
      },
    ],
  });

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary(summary),
    {
      ok: false,
      required: 'preserved read',
      observed: 'reissued',
    },
  );
});

test('production auth/session lifecycle summary fails closed when the trace includes a non-read cleanup phase without cleanup evidence', () => {
  const summary = summarizeProductionAuthSessionLifecycleTrace([
    {
      step: 'preflight',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: false,
    },
    {
      step: 'cleanup',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: false,
    },
    {
      step: 'journal',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: true,
    },
  ]);

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary(summary),
    {
      ok: false,
      required: 'preserved read',
      observed: 'cleanup',
    },
  );
});

test('production auth/session lifecycle summary fails closed when an intermediate preserved read loses preservation', () => {
  const summary = summarizeProductionAuthSessionLifecycleTrace([
    {
      step: 'preflight',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: false,
    },
    {
      step: 'apply',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: false,
    },
    {
      step: 'journal',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: true,
    },
  ]);

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary(summary),
    {
      ok: false,
      required: 'preserved read',
      observed: 'unpreserved',
    },
  );
});

test('production auth/session lifecycle summary fails closed when preserved-read preservation flags are string values', () => {
  const summary = summarizeProductionAuthSessionLifecycleTrace([
    {
      step: 'preflight',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: false,
    },
    {
      step: 'journal',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: 'false',
    },
  ]);

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary(summary),
    {
      ok: false,
      required: 'boolean lifecycle flags',
      observed: 'invalid-preserved',
    },
  );
});

test('production auth/session lifecycle summary fails closed when an intermediate preserved read omits the session id', () => {
  const summary = summarizeProductionAuthSessionLifecycleTrace([
    {
      step: 'preflight',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: false,
    },
    {
      step: 'apply',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: true,
    },
    {
      step: 'journal',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: true,
    },
  ]);

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary(summary),
    {
      ok: false,
      required: 'preserved read',
      observed: 'rotated',
    },
  );
});

test('production auth/session lifecycle summary fails closed when direct preserved-read preservation flags are string values', () => {
  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'journal',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: 'true',
      },
    }),
    {
      ok: false,
      required: 'boolean lifecycle flags',
      observed: 'invalid-preserved',
    },
  );
});

test('production auth/session lifecycle summary fails closed when direct observations metadata is not an array', () => {
  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'journal',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
      observations: {
        step: 'journal',
      },
    }),
    {
      ok: false,
      required: 'preserved read',
      observed: 'invalid-observations',
    },
  );
});

test('production auth/session lifecycle summary fails closed when direct issued metadata is an array', () => {
  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: [{
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      }],
      read: {
        step: 'journal',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
    }),
    {
      ok: false,
      required: 'issued preflight',
      observed: 'invalid-issued',
    },
  );
});

test('production auth/session lifecycle summary fails closed when direct issued phase metadata is not a string', () => {
  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: ['preflight'],
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'apply',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
    }),
    {
      ok: false,
      required: 'issued preflight',
      observed: 'invalid-step',
    },
  );
});

test('production auth/session lifecycle summary fails closed when direct issued lifecycle identity metadata is malformed', () => {
  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: ['session-01'],
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'apply',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
    }),
    {
      ok: false,
      required: 'string lifecycle fields',
      observed: 'invalid-id',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: ['production-auth-session'],
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'apply',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
    }),
    {
      ok: false,
      required: 'string lifecycle fields',
      observed: 'invalid-type',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: ' active ',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'apply',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
    }),
    {
      ok: false,
      required: 'string lifecycle fields',
      observed: 'invalid-status',
    },
  );
});

test('production auth/session lifecycle summary fails closed when direct preserved-read metadata is an array', () => {
  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: [{
        step: 'journal',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      }],
    }),
    {
      ok: false,
      required: 'preserved read',
      observed: 'invalid-read',
    },
  );
});

test('production auth/session lifecycle summary fails closed when direct preserved-read phase metadata is not a string', () => {
  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: ['apply'],
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
    }),
    {
      ok: false,
      required: 'preserved read',
      observed: 'invalid-step',
    },
  );
});

test('production auth/session lifecycle summary fails closed when direct preserved-read lifecycle identity metadata is malformed', () => {
  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'apply',
        id: ['session-01'],
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
    }),
    {
      ok: false,
      required: 'string lifecycle fields',
      observed: 'invalid-id',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'apply',
        id: 'session-01',
        type: ['production-auth-session'],
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
    }),
    {
      ok: false,
      required: 'string lifecycle fields',
      observed: 'invalid-type',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'apply',
        id: 'session-01',
        type: 'production-auth-session',
        status: ' active ',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
    }),
    {
      ok: false,
      required: 'string lifecycle fields',
      observed: 'invalid-status',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'apply',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z\u0000',
        preserved: true,
      },
    }),
    {
      ok: false,
      required: 'string lifecycle fields',
      observed: 'invalid-expires-at',
    },
  );
});

test('production auth/session lifecycle summary fails closed when direct issued lifecycle flags are malformed', () => {
  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        cleanup: 'true',
      },
      read: {
        step: 'apply',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
    }),
    {
      ok: false,
      required: 'boolean lifecycle flags',
      observed: 'invalid-cleanup',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        rotated: 'true',
      },
      read: {
        step: 'apply',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
    }),
    {
      ok: false,
      required: 'boolean lifecycle flags',
      observed: 'invalid-rotated',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: 'true',
      },
      read: {
        step: 'apply',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
    }),
    {
      ok: false,
      required: 'boolean lifecycle flags',
      observed: 'invalid-preserved',
    },
  );
});

test('production auth/session lifecycle summary fails closed when an intermediate preserved-read lifecycle identity field is malformed', () => {
  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'apply',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
      observations: [
        {
          step: 'preflight',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          preserved: false,
        },
        {
          step: 'apply',
          id: ' session-01 ',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          preserved: true,
        },
      ],
    }),
    {
      ok: false,
      required: 'string lifecycle fields',
      observed: 'invalid-id',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'apply',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
      observations: [
        {
          step: 'preflight',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          preserved: false,
        },
        {
          step: 'apply',
          id: 'session-01',
          type: 'production-auth-session',
          status: ['active'],
          expiresAt: '2099-01-01T00:00:00Z',
          preserved: true,
        },
      ],
    }),
    {
      ok: false,
      required: 'string lifecycle fields',
      observed: 'invalid-status',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'apply',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
      observations: [
        {
          step: 'preflight',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          preserved: false,
        },
        {
          step: 'apply',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z\u0000',
          preserved: true,
        },
      ],
    }),
    {
      ok: false,
      required: 'string lifecycle fields',
      observed: 'invalid-expires-at',
    },
  );
});

test('production auth/session lifecycle summary fails closed when direct observations include non-object entries', () => {
  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'journal',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
      observations: ['invalid-entry'],
    }),
    {
      ok: false,
      required: 'preserved read',
      observed: 'invalid-observation',
    },
  );
});

test('production auth/session lifecycle summary fails closed when an intermediate observation phase is not a string', () => {
  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'apply',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
      observations: [
        {
          step: 'preflight',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          preserved: false,
        },
        {
          step: ['apply'],
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          preserved: true,
        },
      ],
    }),
    {
      ok: false,
      required: 'preserved read',
      observed: 'invalid-step',
    },
  );
});

test('production auth/session lifecycle summary fails closed when direct preserved-read cleanup aliases are string values', () => {
  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'journal',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
        cleanup: 'true',
      },
    }),
    {
      ok: false,
      required: 'boolean lifecycle flags',
      observed: 'invalid-cleanup',
    },
  );
});

test('production auth/session lifecycle summary fails closed when direct revoked metadata is a string value', () => {
  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'journal',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
      revoked: 'true',
    }),
    {
      ok: false,
      required: 'boolean lifecycle flags',
      observed: 'invalid-revoked',
    },
  );
});

test('production auth/session lifecycle summary fails closed when direct expired metadata is an array', () => {
  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'journal',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
      expired: ['2099-01-01T00:00:00Z'],
    }),
    {
      ok: false,
      required: 'boolean lifecycle flags',
      observed: 'invalid-expired',
    },
  );
});

test('production auth/session lifecycle summary fails closed when direct preserved metadata is a string value', () => {
  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'journal',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
      preserved: 'true',
    }),
    {
      ok: false,
      required: 'boolean lifecycle flags',
      observed: 'invalid-preserved',
    },
  );
});

test('production auth/session lifecycle summary fails closed when direct cleaned-up metadata is a string value', () => {
  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'journal',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
      cleanedUp: 'true',
    }),
    {
      ok: false,
      required: 'boolean lifecycle flags',
      observed: 'invalid-cleanedUp',
    },
  );
});

test('production auth/session lifecycle summary fails closed when direct rotated metadata is a string value', () => {
  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'journal',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
      rotated: 'true',
    }),
    {
      ok: false,
      required: 'boolean lifecycle flags',
      observed: 'invalid-rotated',
    },
  );
});

test('production auth/session lifecycle summary fails closed when top-level summary marker objects carry malformed metadata', () => {
  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'journal',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
      revoked: {
        step: 'dry-run',
        id: 'session-01',
        type: 'production-auth-session',
        status: ' revoked ',
        expiresAt: '2099-01-01T00:00:00Z',
        revoked: true,
      },
    }),
    {
      ok: false,
      required: 'string lifecycle fields',
      observed: 'invalid-status',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'journal',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
      expired: {
        step: 'journal',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z\u0000',
        expired: true,
      },
    }),
    {
      ok: false,
      required: 'string lifecycle fields',
      observed: 'invalid-expires-at',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'journal',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
      cleanedUp: {
        step: 'cleanup',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        cleanup: 'true',
      },
    }),
    {
      ok: false,
      required: 'boolean lifecycle flags',
      observed: 'invalid-cleanup',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'journal',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
      preserved: {
        step: 'journal',
        id: ' session-01 ',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
    }),
    {
      ok: false,
      required: 'string lifecycle fields',
      observed: 'invalid-id',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'journal',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
      rotated: {
        step: ['journal'],
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        rotated: true,
      },
    }),
    {
      ok: false,
      required: 'preserved read',
      observed: 'invalid-step',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'journal',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
      revoked: {
        id: 'session-01',
        type: 'production-auth-session',
        status: 'revoked',
        expiresAt: '2099-01-01T00:00:00Z',
        revoked: true,
      },
    }),
    {
      ok: false,
      required: 'preserved read',
      observed: 'missing-phase',
    },
  );
});

test('production auth/session lifecycle summary fails closed when top-level summary marker objects point to a different session id', () => {
  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'journal',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
      revoked: {
        step: 'journal',
        id: 'session-02',
        type: 'production-auth-session',
        status: 'revoked',
        expiresAt: '2099-01-01T00:00:00Z',
        revoked: true,
      },
    }),
    {
      ok: false,
      required: 'preserved read',
      observed: 'rotated',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'journal',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
      cleanedUp: {
        step: 'cleanup',
        id: 'session-02',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        cleanedUp: true,
        preserved: true,
      },
    }),
    {
      ok: false,
      required: 'preserved read',
      observed: 'rotated',
    },
  );
});

test('production auth/session lifecycle summary fails closed when an intermediate preserved-read cleanup alias is a string value', () => {
  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'journal',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
      observations: [
        {
          step: 'preflight',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          preserved: false,
        },
        {
          step: 'apply',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          preserved: true,
          cleanup: 'true',
        },
      ],
    }),
    {
      ok: false,
      required: 'boolean lifecycle flags',
      observed: 'invalid-cleanup',
    },
  );
});

test('production auth/session lifecycle summary fails closed when an intermediate preserved-read lifecycle flag is malformed', () => {
  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'journal',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
      observations: [
        {
          step: 'preflight',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          preserved: false,
        },
        {
          step: 'apply',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          preserved: true,
          revoked: 'true',
        },
      ],
    }),
    {
      ok: false,
      required: 'boolean lifecycle flags',
      observed: 'invalid-revoked',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'journal',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
      observations: [
        {
          step: 'preflight',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          preserved: false,
        },
        {
          step: 'apply',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          preserved: true,
          expired: 'true',
        },
      ],
    }),
    {
      ok: false,
      required: 'boolean lifecycle flags',
      observed: 'invalid-expired',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'journal',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
      observations: [
        {
          step: 'preflight',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          preserved: false,
        },
        {
          step: 'apply',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          preserved: true,
          cleanedUp: 'true',
        },
      ],
    }),
    {
      ok: false,
      required: 'boolean lifecycle flags',
      observed: 'invalid-cleanedUp',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'journal',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
      observations: [
        {
          step: 'preflight',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          preserved: false,
        },
        {
          step: 'apply',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          preserved: true,
          rotated: 'true',
        },
      ],
    }),
    {
      ok: false,
      required: 'boolean lifecycle flags',
      observed: 'invalid-rotated',
    },
  );
});

test('production auth/session lifecycle summary fails closed when a direct summary reports cleanup through the alias', () => {
  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
        step: 'journal',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
      cleanup: true,
    }),
    {
      ok: false,
      required: 'unrevoked',
      observed: 'cleaned-up',
    },
  );
});

test('production auth/session lifecycle summary fails closed when preserved-read session ids contain only trimmed matches', () => {
  const summary = summarizeProductionAuthSessionLifecycleTrace([
    {
      step: 'preflight',
      id: ' session-01 ',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: false,
    },
    {
      step: 'journal',
      id: ' session-01 ',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: true,
    },
  ]);

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary(summary),
    {
      ok: false,
      required: 'string lifecycle fields',
      observed: 'invalid-id',
    },
  );
});

test('production auth/session lifecycle summary fails closed when preserved-read session ids contain control characters', () => {
  const summary = summarizeProductionAuthSessionLifecycleTrace([
    {
      step: 'preflight',
      id: 'session-01\n',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: false,
    },
    {
      step: 'journal',
      id: 'session-01\n',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: true,
    },
  ]);

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary(summary),
    {
      ok: false,
      required: 'string lifecycle fields',
      observed: 'invalid-id',
    },
  );
});

test('production auth/session lifecycle summary fails closed when a preserved read uses the cleanup alias', () => {
  const summary = summarizeProductionAuthSessionLifecycleTrace([
    {
      step: 'preflight',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: false,
    },
    {
      step: 'journal',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      expired: false,
      revoked: false,
      cleanup: true,
      rotated: false,
      preserved: true,
    },
  ]);

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary(summary),
    {
      ok: false,
      required: 'unrevoked',
      observed: 'cleaned-up',
    },
  );
});

test('production auth/session lifecycle summary fails closed when an intermediate observation omits its phase step', () => {
  const summary = summarizeProductionAuthSessionLifecycleTrace([
    {
      step: 'preflight',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: false,
    },
    {
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: true,
    },
    {
      step: 'journal',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: true,
    },
  ]);

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary(summary),
    {
      ok: false,
      required: 'preserved read',
      observed: 'missing-phase',
    },
  );
});

test('production auth/session lifecycle summary fails closed when an intermediate trace entry is not an object', () => {
  const summary = summarizeProductionAuthSessionLifecycleTrace([
    {
      step: 'preflight',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: false,
    },
    'corrupted-trace-entry',
    {
      step: 'journal',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: true,
    },
  ]);

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary(summary),
    {
      ok: false,
      required: 'preserved read',
      observed: 'missing-phase',
    },
  );
});

maybeTest('production-shaped release verify command consumes the packaged production auth/session source command when production auth/session is required', async () => {
  await withPlaygroundServer('remote-base', path.join(repoRoot, 'fixtures/playground/remote-base.blueprint.json'), async (remoteServer) => {
    const expectedSourceCommand = resolvePackagedProductionPluginSourceCommand({
      sourceUrl: remoteServer.baseUrl,
      username: liveCredentials.username,
      applicationPassword: liveCredentials.password,
    });
    const proof = spawnProductionShapedReleaseVerifySync(
      {
        ...process.env,
        REPRINT_PUSH_SOURCE_URL: remoteServer.baseUrl,
        REPRINT_PUSH_REMOTE_URL: remoteServer.baseUrl,
        REPRINT_PUSH_USERNAME: 'stale-lab-username',
        REPRINT_PUSH_APPLICATION_PASSWORD: 'stale-lab-password',
        REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND: buildAuthSessionSourceCommand({
          sourceUrl: remoteServer.baseUrl,
          username: liveCredentials.username,
          applicationPassword: liveCredentials.password,
        }),
        REPRINT_PUSH_REQUIRE_PRODUCTION_AUTH_SESSION: '1',
        NODE_NO_WARNINGS: '1',
      },
      {
        timeout: releaseVerifyInnerTimeoutMs,
        killSignal: liveProofSubprocessKillSignal,
      },
      'packaged auth/session source release verify',
    );
    assertSpawnCompletedWithoutSpawnError(proof, 'packaged auth/session source release verify', releaseVerifyInnerTimeoutMs);
    assert.equal(proof.status, 0, proof.stderr);
    assert.match(
      proof.stdout,
      new RegExp(`"authSessionSource": \\{\\s*"command": ${JSON.stringify(expectedSourceCommand)},\\s*"ok": true,\\s*"sourceUrl": "http:\\/\\/127\\.0\\.0\\.1:\\d+"`),
    );
    assert.match(proof.stdout, /"liveAuthSessionSource": \{[\s\S]*"requiredCommand": "REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND"/);
    assert.match(proof.stdout, /"preflight": \{\s*"status": 200,\s*"authSessionType": "production-auth-session"/);
    assert.match(
      proof.stdout,
      /"authSessionLifecycle": \{\s*"history": \[[\s\S]*?"minted": \{\s*"id": "[^"]+",\s*"type": "production-auth-session",\s*"status": "active",\s*"expiresAt": "[^"]+",\s*"expired": false,\s*"revoked": false,\s*"cleanedUp": false\s*\}/,
    );
    assert.match(
      proof.stdout,
      /"authSessionLifecycleSummary": \{\s*"issued": \{\s*"step": "preflight",\s*"id": "[^"]+",\s*"type": "production-auth-session",\s*"status": "active",\s*"expiresAt": "[^"]+",\s*"expired": false,\s*"revoked": false,\s*"cleanedUp": false,\s*"rotated": false,\s*"preserved": false\s*\}/,
    );
    assert.match(
      proof.stdout,
      /"authSessionLifecycleSummary": \{[\s\S]*?"read": \{\s*"step": "(dry-run|apply|replay|journal)",\s*"id": "[^"]+",\s*"type": "production-auth-session",\s*"status": "active",\s*"expiresAt": "[^"]+",\s*"expired": false,\s*"revoked": false,\s*"cleanedUp": false,\s*"rotated": false,\s*"preserved": true\s*\}/,
    );
  });
});

maybeTest('production-shaped release verify reports trusted recovery journal state on the packaged checked path', async () => {
  const proof = spawnProductionShapedReleaseVerifySync(
    {
      ...process.env,
      REPRINT_PUSH_REQUIRE_PRODUCTION_AUTH_SESSION: '1',
      NODE_NO_WARNINGS: '1',
    },
    {
      timeout: releaseVerifyInnerTimeoutMs,
      killSignal: liveProofSubprocessKillSignal,
    },
    'packaged recovery journal release verify',
  );
  assertSpawnCompletedWithoutSpawnError(proof, 'packaged recovery journal release verify', releaseVerifyInnerTimeoutMs);
  assert.equal(proof.status, 0, proof.stderr);
  assert.match(proof.stdout, /"recoveryInspect": \{[\s\S]*"journalState": "ok"/);
  assert.match(proof.stdout, /"durableJournal": \{[\s\S]*"staleClaimRejected": true/);
  assert.match(
    proof.stdout,
    /"liveLeaseFence": \{\s*"boundary": "wpdb-single-statement-cas",\s*"claimKeyUnique": true,\s*"monotonicSequence": true,\s*"restartReadable": true,\s*"staleClaimRejected": true\s*\}/,
  );
});

maybeTest('production-shaped release proof runs the live preflight branch against a local Playground source', async () => {
  await withPlaygroundServer('remote-base', path.join(repoRoot, 'fixtures/playground/remote-base.blueprint.json'), async (remoteServer) => {
    const proof = spawnProductionShapedReleaseVerifySync(
      {
        ...process.env,
        REPRINT_PUSH_SOURCE_URL: remoteServer.baseUrl,
        REPRINT_PUSH_REMOTE_URL: remoteServer.baseUrl,
        REPRINT_PUSH_LAB_AUTH_ADMIN_USER: liveCredentials.username,
        REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: liveCredentials.password,
      },
      {
        timeout: liveProofInnerTimeoutMs,
        killSignal: liveProofSubprocessKillSignal,
      },
      'live release proof',
    );
    assertReleaseVerifySpawnProof(proof, 'live release proof', liveProofInnerTimeoutMs);
    assert.equal(proof.status, 0, proof.stderr);
    assert.match(proof.stdout, /"releaseProof": \{\s*"status": 0,\s*"code": "LIVE_PREFLIGHT_OK"\s*\}/);
    assert.match(proof.stdout, /"sourceUrl": "http:\/\/127\.0\.0\.1:\d+"/);
    assert.match(proof.stdout, /"routeProfile": \{\s*"profile": "production-shaped"/);
    assert.match(proof.stdout, /"session": \{\s*"id": "[A-Za-z0-9_-]{32,160}"/);
  });
});

maybeTest('production-shaped release verify command runs the live protocol branch with local Playground source and local edited site', () => {
  return withPlaygroundServer('remote-base', path.join(repoRoot, 'fixtures/playground/remote-base.blueprint.json'), async (remoteServer) => {
    const proof = spawnProductionShapedReleaseVerifySync(
      {
        ...process.env,
        REPRINT_PUSH_SOURCE_URL: remoteServer.baseUrl,
        REPRINT_PUSH_REMOTE_URL: remoteServer.baseUrl,
        REPRINT_PUSH_LAB_AUTH_ADMIN_USER: liveCredentials.username,
        REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: liveCredentials.password,
        NODE_NO_WARNINGS: '1',
      },
      {
        timeout: liveProofInnerTimeoutMs,
        killSignal: liveProofSubprocessKillSignal,
      },
      'live release verify',
    );
    assertSpawnCompletedWithoutSpawnError(proof, 'live release verify', liveProofInnerTimeoutMs);
    assert.equal(proof.status, 0, proof.stderr);
    assert.match(proof.stdout, /"ok": true/);
    assert.match(proof.stdout, /"sourceUrl": "http:\/\/127\.0\.0\.1:\d+"/);
    assert.match(proof.stdout, /"topology": \{\s*"remoteBase": "http:\/\/127\.0\.0\.1:\d+"/);
    assert.match(proof.stdout, /"remoteChanged": "(http:\/\/127\.0\.0\.1:\d+|remote-changed)"/);
    assert.match(proof.stdout, /"localEdited": "(http:\/\/127\.0\.0\.1:\d+|local-edited)"/);
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
    assert.match(proof.stdout, /"firstRemainingProductionBoundary": null/);
    assert.match(proof.stdout, /"verdict": "LIVE_RELEASE_BOUNDARY_OK"/);
    assert.match(
      proof.stdout,
      /"gateDependencies": \{\s*"productionAuthSession": "production-backed auth\/session issuance, read, expiry, rotation, revocation, and cleanup on the checked release path",\s*"durableJournal": "production durable journal storage with lease fencing, restart-readable artifacts, and release-path consumption",\s*"replayAndRetry": "checked live replay equivalence plus preserved-remote retry on the release verifier path"\s*\}/,
    );
    assert.match(proof.stdout, /"releaseProof": \{\s*"ok": true,\s*"mode": "apply"/);
    assert.match(proof.stdout, /"durableJournal": \{\s*"proof": \{\s*"status": 0,\s*"journal": \{/);
    assert.match(proof.stdout, /"productionAdapter": "openProductionRecoveryJournal"/);
    assert.match(proof.stdout, /"ownsJournal": true/);
    assert.match(proof.stdout, /"restartReadable": true/);
    assert.match(proof.stdout, /"staleClaimRejected": true/);
    assert.match(proof.stdout, /"checkedAccepted": true/);
    assert.match(
      proof.stdout,
      /"leaseFence": \{\s*"storageGuard": "filesystem-compare-rename",\s*"fsyncEvidence": true,\s*"monotonicSequence": true,\s*"staleClaimRejected": true\s*\}/,
    );
    assert.match(proof.stdout, /"consumed": true/);
    assert.match(
      proof.stdout,
      /"releaseProof": \{\s*"ok": true[\s\S]*?"authSessionLifecycle": \{\s*"minted": \{\s*"id": "[^"]+",\s*"type": "production-auth-session",\s*"status": "active",\s*"expiresAt": "[^"]+",\s*"expired": false\s*\},\s*"read": \{\s*"id": "[^"]+",\s*"type": "production-auth-session",\s*"status": "active",\s*"expiresAt": "[^"]+",\s*"expired": false\s*\}/,
    );
    assert.match(
      proof.stdout,
      /"authSessionLifecycleSummary": \{\s*"issued": \{\s*"step": "preflight",\s*"id": "[^"]+",\s*"type": "production-auth-session",\s*"status": "active",\s*"expiresAt": "[^"]+",\s*"expired": false,\s*"revoked": false,\s*"cleanedUp": false,\s*"rotated": false,\s*"preserved": false\s*\},\s*"read": \{\s*"step": "(journal|replay|apply|dry-run)",\s*"id": "[^"]+",\s*"type": "production-auth-session",\s*"status": "active",\s*"expiresAt": "[^"]+",\s*"expired": false,\s*"revoked": false,\s*"cleanedUp": false,\s*"rotated": false,\s*"preserved": true\s*\}/,
    );
    assert.match(
      proof.stdout,
      /"authSessionLifecycle": \{\s*"minted": \{\s*"id": "[^"]+",\s*"type": "production-auth-session",\s*"status": "active",\s*"expiresAt": "[^"]+",\s*"expired": false\s*\},\s*"read": \{\s*"id": "[^"]+",\s*"type": "production-auth-session",\s*"status": "active",\s*"expiresAt": "[^"]+",\s*"expired": false\s*\}/,
    );
    assert.match(
      proof.stdout,
      /"authSessionLifecycleTrace": \[[\s\S]*?\{\s*"step": "(dry-run|apply|replay|journal)",\s*"id": "[^"]+",\s*"type": "production-auth-session",\s*"status": "active",\s*"expiresAt": "[^"]+",\s*"expired": false,\s*"rotated": false,\s*"preserved": true\s*\}/,
    );
    assert.match(proof.stdout, /"releaseProof": \{\s*"ok": true,\s*"mode": "apply"/);
    assert.match(
      proof.stdout,
      /"staleClaimRetry": \{\s*"abandoned": \{\s*"status": 500,\s*"ok": false,\s*"code": "LAB_SIMULATED_STALE_CLAIM_ALL_OLD"/,
    );
    assert.match(
      proof.stdout,
      /"apply": \{[\s\S]*?"idempotency": \{\s*"replayed": true,\s*"freshMutationWork": false,\s*"status": "replayed",\s*"conflict": false,\s*"staleClaimRetry": true\s*\}/,
    );
    assert.match(proof.stdout, /"releaseProof": \{[\s\S]*?"retryAttempts": 2[\s\S]*?\}/);
    assert.match(proof.stdout, /"remoteSnapshot": \{\s*"status": 200,\s*"ok": true,\s*"retryAttempts": 2/);
    assert.match(proof.stdout, /"replayEquivalence": \{\s*"equivalent": true,\s*"mismatches": \[\]\s*\}/);
    assert.match(proof.stdout, /"preflight": \{\s*"status": 200,\s*"ok": true,\s*"mode": "preflight"/);
  });
});

maybeTest('production-shaped release verify command fails closed when remote drift appears after the authenticated snapshot', () => {
  return withPlaygroundServer('remote-base', path.join(repoRoot, 'fixtures/playground/remote-base.blueprint.json'), async (remoteServer) => {
    const proof = spawnProductionShapedReleaseVerify(
      {
        REPRINT_PUSH_SOURCE_URL: remoteServer.baseUrl,
        REPRINT_PUSH_REMOTE_URL: remoteServer.baseUrl,
        REPRINT_PUSH_LAB_AUTH_ADMIN_USER: liveCredentials.username,
        REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: liveCredentials.password,
        REPRINT_PUSH_LAB_DRIFT_AFTER_SNAPSHOT: 'post-title',
        NODE_NO_WARNINGS: '1',
      },
      boundedLiveReleaseVerifyOptions({ timeout: liveProofInnerTimeoutMs }),
      'drift release verify',
    );
    assertSpawnCompletedWithoutSpawnError(proof, 'drift release verify', liveProofInnerTimeoutMs);
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
  assert.equal(proof.status, 0, proof.stderr);
  assert.match(proof.stderr, /apply-revalidation: waiting for Playground at http:\/\/127\.0\.0\.1:\d+/);
  assert.match(proof.stderr, /apply-revalidation: probe \/wp-json\//);
});

test('production-shaped release verify command reports the checked retained-source proof summary', () => {
  const proof = spawnReleaseVerifySlowPathBounded(
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
    {
      timeout: releaseVerifySlowPathTimeoutMs,
      killSignal: proofSubprocessKillSignal,
    },
  );
  assertReleaseVerifySpawnProof(proof, 'retained-source release verify', releaseVerifySlowPathTimeoutMs);
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

test('production-shaped release verify tracks distinct cached blueprint snapshots for local and remote drift fixtures', () => {
  const localBlueprintPath = path.join(repoRoot, 'fixtures/playground/local-edited.blueprint.json');
  const remoteBlueprintPath = path.join(repoRoot, 'fixtures/playground/remote-changed.blueprint.json');
  const localFixture = loadBlueprintSnapshotFixture('local-edited', localBlueprintPath);
  const remoteFixture = loadBlueprintSnapshotFixture('remote-changed', remoteBlueprintPath);

  assert.equal(
    resolveBlueprintSnapshotFixturePath(localBlueprintPath),
    path.join(repoRoot, 'fixtures/playground/local-edited.snapshot.json'),
  );
  assert.equal(
    resolveBlueprintSnapshotFixturePath(remoteBlueprintPath),
    path.join(repoRoot, 'fixtures/playground/remote-changed.snapshot.json'),
  );
  assert.equal(localFixture.meta.fixture, 'local-edited');
  assert.equal(remoteFixture.meta.fixture, 'remote-changed');
  assert.equal(localFixture.db.wp_posts['ID:1001'].post_content, 'Local edited content');
  assert.equal(remoteFixture.db.wp_posts['ID:1001'].post_content, 'Remote edited content');
  assert.equal(localFixture.files['wp-content/uploads/reprint-push/local-only.txt'], 'local-only upload content');
  assert.equal(remoteFixture.files['wp-content/uploads/reprint-push/remote-only.txt'], 'remote-only upload content');
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
    activePlaygroundChildren.delete(child);
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
      try {
        await stopPlaygroundChild(child);
      } catch (cleanupError) {
        process.stderr.write(
          `${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}\n`,
        );
      }
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
  const lastProbe = lastProbes.at(-1) ?? null;
  const summary = {
    message,
    lastProbe,
    lastError: lastError?.message ?? null,
  };
  process.stderr.write(`${message}\n`);
  if (lastProbe) {
    const probeLine = `Last playground probe route=${lastProbe.route} status=${lastProbe.status} ok=${lastProbe.ok} body=${lastProbe.body ?? ''}\n`;
    process.stderr.write(probeLine);
    process.stdout.write(probeLine);
  }
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
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  const waitForSignal = () =>
    new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeoutHandle);
        child.off('exit', onExit);
        child.off('close', onExit);
      };

      const onExit = () => {
        cleanup();
        resolve();
      };

      const timeoutHandle = setTimeout(() => {
        cleanup();
        reject(new Error(`Playground server did not exit within ${timeoutMs}ms`));
      }, timeoutMs);

      child.once('exit', onExit);
      child.once('close', onExit);
    });

  try {
    await waitForSignal();
  } catch (error) {
    const initialError = error instanceof Error ? error : new Error(String(error));
    child.kill('SIGKILL');
    try {
      await Promise.race([
        waitForSignal(),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Playground server did not exit after SIGKILL')), 2_000);
        }),
      ]);
    } catch {
      throw initialError;
    }
  }
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
  const cleanupFailures = [];
  for (const [command, args] of [
    ['pkill', [signalFlag, '-g', String(child.pid)]],
    ['pkill', [signalFlag, '-P', String(child.pid)]],
    ['kill', [signalFlag, String(child.pid)]],
  ]) {
    try {
      const proof = spawnBoundedSync(command, args, {
        cwd: repoRoot,
        env: process.env,
        encoding: 'utf8',
        timeout: 2_000,
        killSignal: 'SIGKILL',
      }, `process cleanup ${command}`);
      const benignMissingProcess =
        (command === 'pkill' && proof.status === 1 && !proof.error && !proof.signal) ||
        (command === 'kill' && proof.status === 1 && !proof.error && !proof.signal && /No such process/i.test(`${proof.stderr ?? ''}`));
      if (proof.error || proof.signal || proof.status === null || (proof.status !== 0 && !benignMissingProcess)) {
        cleanupFailures.push(formatSpawnFailure(`process cleanup ${command} failed`, proof));
      }
    } catch (error) {
      cleanupFailures.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (cleanupFailures.length > 0) {
    throw new Error(`process cleanup failed for pid ${child.pid}\n${cleanupFailures.join('\n')}`);
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
