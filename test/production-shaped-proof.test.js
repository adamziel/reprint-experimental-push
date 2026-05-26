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
  labReadinessBodyRetryable,
  labReadinessErrorRetryable,
  labSnapshotReady,
  labSnapshotRetryable,
} from '../scripts/playground/lab-playground-readiness.js';
import {
  packagedProductionPluginMaxConsecutiveNotReadyProbes,
  packagedProductionPluginNextNotReadyProbeCount,
  packagedProductionPluginNextRouteNotReadyProbeCounts,
  packagedProductionPluginNotReadyProbeLimitReached,
  packagedProductionPluginPreflightTerminal,
  packagedProductionPluginReadinessBodyRetryable,
  packagedProductionPluginReadinessErrorRetryable,
  packagedProductionPluginPreflightReady,
  packagedProductionPluginPreflightRetryable,
  packagedProductionPluginResetRouteNotReadyProbeCounts,
  packagedProductionPluginRouteRetryableWhileWordPressStarting,
  packagedProductionPluginServerReady,
  packagedProductionPluginSnapshotReady,
  packagedProductionPluginSnapshotTerminal,
  packagedProductionPluginSnapshotRetryable,
} from '../scripts/playground/packaged-production-plugin-readiness.js';
import {
  evaluateProductionAuthSessionLifecycle,
  isExpiredAuthSession,
} from '../scripts/playground/production-auth-session-lifecycle.js';
import {
  loadBlueprintSnapshotFixture,
  resolveBlueprintSnapshotFixturePath,
} from '../scripts/playground/blueprint-snapshot-fixture.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const muPluginDir = path.join(repoRoot, 'scripts/playground/rest-mu-plugins');
const serverStartupTimeoutMs = 30_000;
const playgroundServerTimeoutMs = 40;
const serverFetchTimeoutMs = 3_000;
const playgroundStopTimeoutMs = 3_000;
const readinessProbeIntervalMs = 500;
const readinessFailureBodyLimit = 500;
const runLivePlaygroundTopologyTests = process.env.REPRINT_RUN_PLAYGROUND_LIVE_TESTS === '1';
const maybeTest = runLivePlaygroundTopologyTests ? test : test.skip;
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const liveCredentials = {
  username: 'reprint_push_admin',
  password: 'reprint-push-admin-app-password',
};
const proofSubprocessTimeoutMs = 45_000;
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
const releaseVerifyInnerTimeoutMs = Math.max(1_000, Math.min(36_000, proofSubprocessTimeoutMs - 6_000));
const releaseVerifySlowPathTimeoutMs = 15_000;
const releaseVerifySlowPathInnerTimeoutMs = Math.max(1_000, Math.min(6_000, releaseVerifySlowPathTimeoutMs - 6_000));
const maxReadinessProbes = Math.max(10, Math.ceil(serverStartupTimeoutMs / readinessProbeIntervalMs));
const maxNotReadyReadinessProbes = Math.max(4, Math.ceil(serverStartupTimeoutMs / 500));
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
  // Production-shaped release verify callers need the full release-proof
  // budget, not the shorter live-topology subprocess ceiling.
  const timeoutCeiling = Math.max(1_000, proofSubprocessTimeoutMs - 2_000);
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

test('auth-session source command builder emits a shell-safe node snippet', () => {
  const command = buildAuthSessionSourceCommand({
    nodePath: '/opt/node/bin/node',
    sourceUrl: "http://127.0.0.1:8080/path?label=owner's",
    username: "reprint_push_owner'oops",
    applicationPassword: "p@ss'word",
  });

  assert.equal(
    command,
    `/opt/node/bin/node -e "process.stdout.write(JSON.stringify({sourceUrl:'http://127.0.0.1:8080/path?label=owner'\\''s', username:'reprint_push_owner'\\''oops', applicationPassword:'p@ss'\\''word'}))"`,
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

test('packaged production plugin readiness helper retries only startup-shaped packaged preflight failures', () => {
  const readySnapshot = {
    status: 200,
    body: {
      ok: true,
      snapshot: {},
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
        profile: 'production-shaped',
        restNamespace: 'reprint/v1',
        routePrefix: '/push',
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
  assert.equal(packagedProductionPluginSnapshotRetryable(notReadyPreflight), true);
  assert.equal(packagedProductionPluginPreflightRetryable(notReadyPreflight), true);
  assert.equal(
    packagedProductionPluginServerReady({
      snapshot: readySnapshot,
      preflight: notReadyPreflight,
    }),
    false,
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
  assert.equal(
    packagedProductionPluginSnapshotReady({
      status: 200,
      body: {
        ok: true,
      },
    }),
    false,
  );
  assert.equal(
    packagedProductionPluginServerReady({
      snapshot: {
        status: 200,
        body: {
          ok: true,
        },
      },
      preflight: strictReadyPreflight,
    }),
    false,
  );
  assert.equal(
    packagedProductionPluginPreflightRetryable({
      status: 401,
      body: {
        code: 'reprint_push_lab_auth_required',
        message: 'Authenticated push routes require WordPress Application Password basic auth.',
      },
    }),
    false,
  );
  assert.equal(
    packagedProductionPluginSnapshotRetryable({
      status: 401,
      body: {
        code: 'reprint_push_lab_auth_required',
      },
    }),
    false,
  );
  assert.equal(
    packagedProductionPluginSnapshotRetryable({
      status: 404,
      body: {
        code: 'rest_no_route',
        message: 'No route was found matching the URL and request method.',
      },
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginSnapshotRetryable({
      status: 500,
      body: {
        code: 'rest_no_route',
        message: 'No route was found matching the URL and request method.',
      },
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginPreflightRetryable({
      status: 404,
      body: {
        code: 'rest_no_route',
        message: 'No route was found matching the URL and request method.',
      },
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginPreflightRetryable({
      status: 500,
      body: {
        code: 'rest_no_route',
        message: 'No route was found matching the URL and request method.',
      },
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginSnapshotRetryable({
      status: 500,
      body: {
        code: 'wordpress_not_ready',
        message: 'WordPress is not ready yet',
      },
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginPreflightRetryable({
      status: 503,
      body: {
        code: 'wordpress_not_ready',
        message: 'WordPress is not ready yet',
      },
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginSnapshotRetryable({
      status: 500,
      body: {
        message: 'WordPress is not ready yet',
      },
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginPreflightRetryable({
      status: 503,
      body: {
        message: 'WordPress is not ready yet',
      },
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginSnapshotRetryable({
      status: 500,
      body: 'WordPress is not ready yet',
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginPreflightRetryable({
      status: 503,
      body: 'WordPress is not ready yet',
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginSnapshotRetryable({
      status: 500,
      body: {
        data: {
          message: 'WordPress is not ready yet',
        },
      },
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginPreflightRetryable({
      status: 503,
      body: {
        data: {
          message: 'No route was found matching the URL and request method.',
        },
      },
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginSnapshotRetryable({
      status: 500,
      body: {
        error: {
          message: 'WordPress is not ready yet',
        },
      },
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginPreflightRetryable({
      status: 503,
      body: {
        details: {
          error: 'No route was found matching the URL and request method.',
        },
      },
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginSnapshotRetryable({
      status: 500,
      body: {
        message: 'No route was found matching the URL and request method',
      },
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginPreflightRetryable({
      status: 503,
      body: {
        data: {
          message: 'No route was found matching the URL and request method   ',
        },
      },
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginSnapshotRetryable({
      status: 500,
      body: {
        code: 'startup_mismatch',
        message: 'No route was found matching the URL and request method.',
      },
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginPreflightRetryable({
      status: 503,
      body: {
        code: 'startup_mismatch',
        message: 'No route was found matching the URL and request method.',
      },
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginPreflightRetryable({
      status: 200,
      body: {
        ok: true,
        routeProfile: {
          profile: 'production-shaped',
          restNamespace: 'reprint/v1',
          routePrefix: '/push',
          labBacked: true,
        },
        auth: {
          session: {
            type: 'lab-signed-push-session',
            status: 'active',
            expiresAt: '2099-01-01T00:00:00Z',
          },
        },
      },
    }),
    false,
  );
  assert.equal(
    packagedProductionPluginPreflightRetryable({
      status: 200,
      body: {
        ok: true,
        routeProfile: {
          profile: 'production-shaped',
          restNamespace: 'reprint/v1',
          routePrefix: '/push',
          labBacked: false,
        },
        auth: {
          session: {
            type: 'production-auth-session',
            status: 'revoked',
            expiresAt: '2099-01-01T00:00:00Z',
          },
        },
      },
    }),
    false,
  );
  assert.equal(
    packagedProductionPluginPreflightRetryable(strictReadyPreflight),
    false,
  );
  assert.equal(
    packagedProductionPluginSnapshotTerminal({
      status: 200,
      body: {
        ok: true,
      },
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginSnapshotTerminal({
      status: 404,
      body: {
        code: 'rest_no_route',
      },
    }),
    false,
  );
  assert.equal(
    packagedProductionPluginPreflightTerminal({
      status: 200,
      body: {
        ok: true,
        routeProfile: {
          profile: 'lab-authenticated',
          restNamespace: 'reprint/v1',
          routePrefix: '/push',
          labBacked: false,
        },
        auth: strictReadyPreflight.body.auth,
      },
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginPreflightTerminal({
      status: 502,
      body: {
        code: 'wordpress_not_ready',
      },
    }),
    false,
  );
  assert.equal(
    packagedProductionPluginPreflightReady({
      status: 200,
      body: {
        ok: true,
        routeProfile: {
          profile: 'lab-authenticated',
          restNamespace: 'reprint/v1',
          routePrefix: '/push',
          labBacked: false,
        },
        auth: strictReadyPreflight.body.auth,
      },
    }),
    false,
  );
  assert.equal(
    packagedProductionPluginPreflightReady({
      status: 200,
      body: {
        ok: true,
        routeProfile: {
          profile: 'production-shaped',
          restNamespace: 'reprint-push-lab/v1',
          routePrefix: '/push',
          labBacked: false,
        },
        auth: strictReadyPreflight.body.auth,
      },
    }),
    false,
  );
  assert.equal(
    packagedProductionPluginPreflightReady({
      status: 200,
      body: {
        ok: true,
        routeProfile: {
          profile: 'production-shaped',
          restNamespace: 'reprint/v1',
          routePrefix: '/authenticated',
          labBacked: false,
        },
        auth: strictReadyPreflight.body.auth,
      },
    }),
    false,
  );
  assert.equal(
    packagedProductionPluginPreflightRetryable({
      status: 200,
      body: {
        ok: true,
        routeProfile: {
          profile: 'lab-authenticated',
          restNamespace: 'reprint/v1',
          routePrefix: '/push',
          labBacked: false,
        },
        auth: strictReadyPreflight.body.auth,
      },
    }),
    false,
  );
});

test('packaged production plugin readiness helper does not retry terminal readiness failures', () => {
  assert.equal(
    packagedProductionPluginReadinessBodyRetryable(
      502,
      '<!doctype html><html><body>WordPress is not ready yet</body></html>',
    ),
    true,
  );
  assert.equal(
    packagedProductionPluginReadinessBodyRetryable(
      200,
      '<!doctype html><html><body>WordPress is not ready yet</body></html>',
    ),
    true,
  );
  assert.equal(
    packagedProductionPluginReadinessBodyRetryable(
      404,
      '<!doctype html><html><body>No route was found matching the URL and request method.</body></html>',
    ),
    true,
  );
  assert.equal(
    packagedProductionPluginReadinessBodyRetryable(
      500,
      '<!doctype html><html><body>No route was found matching the URL and request method.</body></html>',
    ),
    true,
  );
  assert.equal(
    packagedProductionPluginReadinessBodyRetryable(
      500,
      'No route was found matching the URL and request method',
    ),
    true,
  );
  assert.equal(
    packagedProductionPluginReadinessBodyRetryable(
      500,
      'No route was found matching the URL and request method   ',
    ),
    true,
  );
  assert.equal(
    packagedProductionPluginReadinessBodyRetryable(
      200,
      '<!doctype html><html><body>fatal startup mismatch</body></html>',
    ),
    false,
  );
  assert.equal(
    packagedProductionPluginReadinessBodyRetryable(
      401,
      '<!doctype html><html><body>unauthorized packaged route</body></html>',
    ),
    false,
  );
  assert.equal(
    packagedProductionPluginNextNotReadyProbeCount(
      0,
      200,
      '<!doctype html><html><body>WordPress is not ready yet</body></html>',
    ),
    1,
  );
  assert.equal(
    packagedProductionPluginNextNotReadyProbeCount(
      3,
      500,
      '<!doctype html><html><body>No route was found matching the URL and request method.</body></html>',
    ),
    4,
  );
  assert.equal(
    packagedProductionPluginNextNotReadyProbeCount(
      0,
      502,
      '<!doctype html><html><body>WordPress is not ready yet</body></html>',
    ),
    1,
  );
  assert.equal(
    packagedProductionPluginNextNotReadyProbeCount(
      packagedProductionPluginMaxConsecutiveNotReadyProbes - 1,
      502,
      '<!doctype html><html><body>WordPress is not ready yet</body></html>',
    ),
    packagedProductionPluginMaxConsecutiveNotReadyProbes,
  );
  assert.equal(
    packagedProductionPluginNextNotReadyProbeCount(
      3,
      404,
      '<!doctype html><html><body>No route was found matching the URL and request method.</body></html>',
    ),
    4,
  );
  assert.equal(
    packagedProductionPluginNextNotReadyProbeCount(
      3,
      200,
      '{\"ok\":true}',
    ),
    0,
  );
  assert.equal(
    packagedProductionPluginNotReadyProbeLimitReached(
      packagedProductionPluginMaxConsecutiveNotReadyProbes - 1,
    ),
    false,
  );
  assert.equal(
    packagedProductionPluginNotReadyProbeLimitReached(
      packagedProductionPluginMaxConsecutiveNotReadyProbes,
    ),
    true,
  );
  let routeProbeCounts = { snapshot: 0, preflight: 0 };
  routeProbeCounts = packagedProductionPluginNextRouteNotReadyProbeCounts(
    routeProbeCounts,
    'snapshot',
    502,
    '<!doctype html><html><body>WordPress is not ready yet</body></html>',
  );
  assert.deepEqual(routeProbeCounts, { snapshot: 1, preflight: 0 });
  routeProbeCounts = packagedProductionPluginNextRouteNotReadyProbeCounts(
    routeProbeCounts,
    'preflight',
    404,
    '<!doctype html><html><body>No route was found matching the URL and request method.</body></html>',
  );
  assert.deepEqual(routeProbeCounts, { snapshot: 1, preflight: 1 });
  routeProbeCounts = packagedProductionPluginNextRouteNotReadyProbeCounts(
    routeProbeCounts,
    'snapshot',
    200,
    '{"ok":true}',
  );
  assert.deepEqual(routeProbeCounts, { snapshot: 0, preflight: 1 });
  routeProbeCounts = packagedProductionPluginResetRouteNotReadyProbeCounts(
    routeProbeCounts,
    'preflight',
  );
  assert.deepEqual(routeProbeCounts, { snapshot: 0, preflight: 0 });
  assert.equal(packagedProductionPluginReadinessErrorRetryable(new Error('transient fetch failure')), true);
  assert.equal(
    packagedProductionPluginReadinessErrorRetryable({
      isPlaygroundReadinessFailure: true,
    }),
    false,
  );
  assert.equal(
    packagedProductionPluginRouteRetryableWhileWordPressStarting(
      502,
      '<!doctype html><html><body>WordPress is not ready yet</body></html>',
      502,
      '<!doctype html><html><body>WordPress is not ready yet</body></html>',
    ),
    true,
  );
  assert.equal(
    packagedProductionPluginRouteRetryableWhileWordPressStarting(
      404,
      '<!doctype html><html><body>No route was found matching the URL and request method.</body></html>',
      502,
      '<!doctype html><html><body>WordPress is not ready yet</body></html>',
    ),
    true,
  );
  assert.equal(
    packagedProductionPluginRouteRetryableWhileWordPressStarting(
      502,
      '<!doctype html><html><body>WordPress is not ready yet</body></html>',
      200,
      '<!doctype html><html><body>WordPress is not ready yet</body></html>',
    ),
    true,
  );
  assert.equal(
    packagedProductionPluginRouteRetryableWhileWordPressStarting(
      500,
      '<!doctype html><html><body>No route was found matching the URL and request method.</body></html>',
      503,
      '<!doctype html><html><body>WordPress is not ready yet</body></html>',
    ),
    true,
  );
  assert.equal(
    packagedProductionPluginRouteRetryableWhileWordPressStarting(
      502,
      '<!doctype html><html><body>WordPress is not ready yet</body></html>',
      404,
      '<!doctype html><html><body>No route was found matching the URL and request method.</body></html>',
    ),
    true,
  );
  assert.equal(
    packagedProductionPluginRouteRetryableWhileWordPressStarting(
      404,
      '<!doctype html><html><body>No route was found matching the URL and request method.</body></html>',
      500,
      'No route was found matching the URL and request method',
    ),
    true,
  );
  assert.equal(
    packagedProductionPluginRouteRetryableWhileWordPressStarting(
      502,
      '<!doctype html><html><body>WordPress is not ready yet</body></html>',
      200,
      '{\"namespaces\":[\"reprint/v1\"]}',
    ),
    false,
  );
  assert.equal(
    packagedProductionPluginRouteRetryableWhileWordPressStarting(
      401,
      '<!doctype html><html><body>unauthorized packaged route</body></html>',
      502,
      '<!doctype html><html><body>WordPress is not ready yet</body></html>',
    ),
    false,
  );
});

test('lab Playground readiness helper rejects malformed ready responses and retries only startup-shaped failures', () => {
  const readySnapshot = {
    status: 200,
    body: {
      ok: true,
      snapshot: {},
    },
  };

  assert.equal(labSnapshotReady(readySnapshot), true);
  assert.equal(
    labSnapshotReady({
      status: 200,
      body: {
        ok: true,
      },
    }),
    false,
  );
  assert.equal(
    labSnapshotRetryable({
      status: 502,
      body: {
        code: 'wordpress_not_ready',
      },
    }),
    true,
  );
  assert.equal(
    labSnapshotRetryable({
      status: 404,
      body: {
        code: 'rest_no_route',
        message: 'No route was found matching the URL and request method.',
      },
    }),
    true,
  );
  assert.equal(
    labSnapshotRetryable({
      status: 401,
      body: {
        code: 'reprint_push_lab_auth_required',
      },
    }),
    false,
  );
  assert.equal(
    labReadinessBodyRetryable(
      502,
      '<!doctype html><html><body>WordPress is not ready yet</body></html>',
    ),
    true,
  );
  assert.equal(
    labReadinessBodyRetryable(
      404,
      '<!doctype html><html><body>No route was found matching the URL and request method.</body></html>',
    ),
    true,
  );
  assert.equal(
    labReadinessBodyRetryable(
      200,
      '<!doctype html><html><body>snapshot route returned broken html</body></html>',
    ),
    false,
  );
  assert.equal(labReadinessErrorRetryable(new Error('transient fetch failure')), true);
  assert.equal(
    labReadinessErrorRetryable({
      isPlaygroundReadinessFailure: true,
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
      /"authSessionLifecycleSummary": \{\s*"issued": \{\s*"step": "preflight",\s*"status": "active",\s*"expired": false,\s*"revoked": false,\s*"cleanedUp": false,\s*"rotated": false,\s*"preserved": false\s*\}/,
    );
    assert.match(
      proof.stdout,
      /"authSessionLifecycleSummary": \{[\s\S]*?"read": \{\s*"step": "(dry-run|apply|replay|journal)",\s*"status": "active",\s*"expired": false,\s*"revoked": false,\s*"cleanedUp": false,\s*"rotated": false,\s*"preserved": true\s*\}/,
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
      /"authSessionLifecycleSummary": \{\s*"issued": \{\s*"step": "preflight",\s*"status": "active",\s*"expired": false,\s*"revoked": false,\s*"cleanedUp": false,\s*"rotated": false,\s*"preserved": false\s*\},\s*"read": \{\s*"step": "(journal|replay|apply|dry-run)",\s*"status": "active",\s*"expired": false,\s*"revoked": false,\s*"cleanedUp": false,\s*"rotated": false,\s*"preserved": true\s*\}/,
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

  const child = spawn('npx', args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      REPRINT_PUSH_LAB_AUTH_BOOTSTRAP: '1',
      REPRINT_PUSH_LAB_AUTH_ADMIN_USER: liveCredentials.username,
      REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: liveCredentials.password,
      NODE_OPTIONS: appendNodeOption(process.env.NODE_OPTIONS, localhostListenPreloadOption()),
    },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
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
  let notReadyProbeCount = 0;
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
      const responsePreview = responseBody.slice(0, readinessFailureBodyLimit);
      lastProbes.push({
        route: '/wp-json/',
        status: response.status,
        ok: response.ok,
        body: responsePreview,
      });
      process.stderr.write(
        `Playground probe ${baseUrl}/wp-json/ -> ${response.status} ${responsePreview.slice(0, 160).replace(/\s+/g, ' ').trim()}\n`,
      );
      if (response.status === 200) {
        notReadyProbeCount = 0;
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
        let snapshotJson = null;
        try {
          snapshotJson = JSON.parse(snapshotBody);
        } catch (error) {
          if (labReadinessBodyRetryable(snapshot.status, snapshotBody)) {
            lastError = new Error(
              `Playground lab snapshot readiness HTTP ${snapshot.status}; ${describeLastProbe(lastProbes.at(-1))}`,
            );
            await new Promise((resolve) => setTimeout(resolve, readinessProbeIntervalMs));
            continue;
          }
          lastError = error;
          await throwPlaygroundReadinessFailure(
            child,
            `Playground lab snapshot returned an invalid readiness body at ${baseUrl}`,
            lastError,
            lastProbes,
            getLogs(),
            { childPid: child.pid ?? null },
          );
        }
        if (labSnapshotReady({
          status: snapshot.status,
          body: snapshotJson,
        })) {
          await snapshot.arrayBuffer();
          return;
        }
        lastError = new Error(
          `Playground lab snapshot readiness HTTP ${snapshot.status}; ${describeLastProbe(lastProbes.at(-1))}`,
        );
        if (labSnapshotRetryable({
          status: snapshot.status,
          body: snapshotJson,
        })) {
          await new Promise((resolve) => setTimeout(resolve, readinessProbeIntervalMs));
          continue;
        }
        await throwPlaygroundReadinessFailure(
          child,
          `Playground lab snapshot returned a terminal readiness failure at ${baseUrl}`,
          lastError,
          lastProbes,
          getLogs(),
          { childPid: child.pid ?? null },
        );
      } else {
        const readinessHint = isWordPressNotReadyResponse(response.status, responseBody)
          ? 'WordPress is not ready yet'
          : null;
        const routeSummary = describeLastProbe(lastProbes.at(-1));
        lastError = new Error(
          readinessHint
            ? `Playground index readiness HTTP 502: ${readinessHint}; ${routeSummary}`
            : `Playground index readiness HTTP ${response.status}; ${routeSummary}`,
        );
        const readinessProbeCount = lastProbes.filter((probe) => probe.route === '/wp-json/').length;
        if (readinessHint) {
          notReadyProbeCount += 1;
          if (notReadyProbeCount >= maxNotReadyReadinessProbes) {
            await throwPlaygroundReadinessFailure(
              child,
              `Playground server reported the bounded readiness failure ${response.status} after ${readinessProbeCount} /wp-json/ probes (${notReadyProbeCount} consecutive not-ready response${notReadyProbeCount === 1 ? '' : 's'}; limit ${maxNotReadyReadinessProbes})`,
              lastError,
              lastProbes,
              getLogs(),
              {
                childPid: child.pid ?? null,
                notReadyProbeCount,
                readinessProbeCount,
              },
            );
          }
          await new Promise((resolve) => setTimeout(resolve, readinessProbeIntervalMs));
          continue;
        }
        notReadyProbeCount = 0;
        if (readinessProbeCount >= maxReadinessProbes) {
          await throwPlaygroundReadinessFailure(
            child,
            `Playground server stayed in readiness response ${response.status} after ${readinessProbeCount} /wp-json/ probes`,
            lastError,
            lastProbes,
            getLogs(),
            {
              childPid: child.pid ?? null,
              readinessProbeCount,
            },
          );
        }
      }
    } catch (error) {
      if (!labReadinessErrorRetryable(error)) {
        throw error;
      }
      lastError = error;
      notReadyProbeCount = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, readinessProbeIntervalMs));
  }
  await throwPlaygroundReadinessFailure(
    child,
    `Timed out waiting for Playground server at ${baseUrl}`,
    lastError,
    lastProbes,
    getLogs(),
    {
      childPid: child.pid ?? null,
      notReadyProbeCount,
    },
  );
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

function describeLastProbe(probe) {
  if (!probe) {
    return 'route/status/body: unavailable';
  }
  return `route/status/body: ${JSON.stringify(
    {
      route: probe.route ?? null,
      status: probe.status ?? null,
      body: probe.body ?? null,
    },
    null,
    2,
  )}`;
}

async function throwPlaygroundReadinessFailure(child, prefix, lastError, lastProbes, logs, context = {}) {
  const diagnostic = formatPlaygroundStartupFailure(prefix, lastError, lastProbes, logs, context);
  writePlaygroundFailure(diagnostic, lastProbes, logs, lastError);
  try {
    await stopPlaygroundChild(child);
  } catch (cleanupError) {
    process.stderr.write(
      `${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}\n`,
    );
  }
  const finalError = new Error(diagnostic);
  finalError.isPlaygroundReadinessFailure = true;
  finalError.cause = lastError ?? null;
  finalError.lastProbe = lastProbes.at(-1) ?? null;
  finalError.context = context;
  throw finalError;
}

function formatPlaygroundStartupFailure(prefix, lastError, lastProbes, logs, context = {}) {
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
  const contextText = Object.keys(context).length
    ? `\nContext: ${JSON.stringify(context, null, 2)}`
    : '';
  return `${prefix}: ${errorText}${probeText}${lastProbeText}${contextText}\n${logs}`;
}

function isWordPressNotReadyResponse(status, body) {
  return status === 502 && /WordPress is not ready yet/i.test(body);
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
