import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadAuthSessionSource,
  resolveAuthSessionRequestState,
  resolveAuthSessionSourceCredentials,
} from '../scripts/playground/auth-session-source.js';
import {
  releaseVerifyFixtureCredentials,
  resolveReleaseVerifyCredentials,
} from '../scripts/playground/release-verify-credentials.js';
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
  shouldRequestPackagedProductionPluginAuthSession,
} from '../scripts/playground/packaged-production-plugin-source-command.js';
import {
  packagedProductionPluginMaxConsecutiveNotReadyProbes,
  packagedProductionPluginNextRouteNotReadyProbeCounts,
  packagedProductionPluginNextTimeoutProbeCount,
  packagedProductionPluginNotReadyProbeLimitReached,
  packagedProductionPluginPreflightRetryable,
  packagedProductionPluginPreflightReady,
  packagedProductionPluginReadinessBodyRetryable,
  packagedProductionPluginReadinessErrorRetryable,
  packagedProductionPluginReadinessProbeTimedOut,
  packagedProductionPluginRestIndexReady,
  packagedProductionPluginRestIndexRetryable,
  packagedProductionPluginResetRouteNotReadyProbeCounts,
  packagedProductionPluginServerReady,
  packagedProductionPluginSnapshotRetryable,
  packagedProductionPluginSnapshotReady,
} from '../scripts/playground/packaged-production-plugin-readiness.js';
import {
  applyRevalidationRetryable,
  hasExplicitCheckedBoundaryRequest,
  resolveCheckedReleaseRequirementEnv,
  resolveCheckedReleaseTopology,
  resolveCheckedLiveBoundaryEnv,
  resolveLiveApplyRevalidationEnv,
  shouldRequestCheckedLivePackagedBoundary,
  shouldUseProductionSnapshotExport,
} from '../scripts/playground/production-shaped-live-release-verify-lib.js';
import {
  evaluateCheckedReleaseAuthSessionLifecycleSummary,
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
const runLivePlaygroundTopologyTests = process.env.REPRINT_RUN_PLAYGROUND_LIVE_TESTS === '1';
const maybeTest = runLivePlaygroundTopologyTests ? test : test.skip;
// The opt-in live wrapper proof can start three separate Playground sources
// before it even enters the checked release verifier, so give the helper
// servers the same bounded startup shape as the release wrapper instead of
// failing during the pre-proof bootstrap.
const serverStartupTimeoutMs = runLivePlaygroundTopologyTests ? 30_000 : 1_500;
// The opt-in explicit checked-live proof boots three helper sources before the
// wrapper child consumes them, so the helper process timeout must cover both
// startup and the downstream wrapper run instead of expiring the first source
// mid-proof.
const playgroundServerTimeoutMs = runLivePlaygroundTopologyTests ? 180 : 8;
const serverFetchTimeoutMs = 3_000;
const playgroundStopTimeoutMs = 3_000;
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const liveCredentials = {
  username: 'reprint_push_admin',
  password: 'reprint-push-admin-app-password',
};
const proofSubprocessTimeoutMs = 30_000;
const packagedProofSubprocessTimeoutMs = 60_000;
const proofSubprocessKillSignal = 'SIGTERM';
const liveProofSubprocessTimeoutMs = 15_000;
const liveProofSubprocessKillSignal = 'SIGKILL';
const liveProofInnerTimeoutMs = Math.max(1_000, Math.min(3_000, liveProofSubprocessTimeoutMs - 8_000));
const liveWrapperSubprocessTimeoutMs = 180_000;
const livePlaygroundMaxConsecutiveNotReadyProbes = runLivePlaygroundTopologyTests
  ? Math.max(
      packagedProductionPluginMaxConsecutiveNotReadyProbes,
      Math.ceil(serverStartupTimeoutMs / 500),
    )
  : Math.max(4, packagedProductionPluginMaxConsecutiveNotReadyProbes);
// Give the verifier enough time to reach its own bounded readiness failure and
// emit probe diagnostics before the outer subprocess timeout can kill it.
const liveProofLaunchTimeoutMs = Math.max(1_000, Math.min(7_000, liveProofSubprocessTimeoutMs - 4_000));
// The checked release verifier now allows the shared remote-changed and
// local-edited Playground startup path to use its full bounded readiness
// window, so the focused subprocess proof needs a matching inner budget.
const releaseVerifyInnerTimeoutMs = Math.max(1_000, Math.min(24_000, proofSubprocessTimeoutMs - 6_000));
const packagedReleaseVerifyInnerTimeoutMs = Math.max(
  1_000,
  Math.min(36_000, packagedProofSubprocessTimeoutMs - 6_000),
);
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
  const timeout = resolveProductionShapedReleaseVerifySyncTimeout(env, options.timeout);
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

function requiresPackagedReleaseVerifyBudget(env = {}) {
  return env.REPRINT_PUSH_REQUIRE_PRODUCTION_AUTH_SESSION === '1'
    || env.REPRINT_PUSH_PACKAGED_PRODUCTION_PLUGIN === '1';
}

function resolveProductionShapedReleaseVerifySyncTimeout(env = {}, requestedTimeout) {
  const packagedProof = requiresPackagedReleaseVerifyBudget(env);
  const timeoutBudgetMs = packagedProof ? packagedProofSubprocessTimeoutMs : liveProofSubprocessTimeoutMs;
  const defaultTimeoutMs = packagedProof ? packagedReleaseVerifyInnerTimeoutMs : releaseVerifyInnerTimeoutMs;
  const timeoutCeiling = Math.max(1_000, timeoutBudgetMs - 2_000);
  return Math.max(1_000, Math.min(requestedTimeout ?? defaultTimeoutMs, timeoutCeiling));
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

test('production-shaped release verify requests the packaged auth/session source only for the default checked path', () => {
  assert.equal(
    shouldRequestPackagedProductionPluginAuthSession({
      requireProductionAuthSession: true,
      fixtureUsername: liveCredentials.username,
      fixtureApplicationPassword: liveCredentials.password,
    }),
    true,
  );
  assert.equal(
    shouldRequestPackagedProductionPluginAuthSession({
      requireProductionAuthSession: true,
      liveSourceUrl: 'http://127.0.0.1:65535',
      fixtureUsername: liveCredentials.username,
      fixtureApplicationPassword: liveCredentials.password,
    }),
    false,
  );
  assert.equal(
    shouldRequestPackagedProductionPluginAuthSession({
      requireProductionAuthSession: true,
      username: 'explicit-user',
      applicationPassword: 'explicit-pass',
      fixtureUsername: liveCredentials.username,
      fixtureApplicationPassword: liveCredentials.password,
    }),
    false,
  );
  assert.equal(
    shouldRequestPackagedProductionPluginAuthSession({
      requireProductionAuthSession: true,
      authSessionSourceCommand: 'custom-source-command',
      fixtureUsername: liveCredentials.username,
      fixtureApplicationPassword: liveCredentials.password,
    }),
    false,
  );
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

test('production auth/session source loader fails closed when sourceUrl is malformed', () => {
  const source = loadAuthSessionSource(
    `${process.execPath} -e "process.stdout.write(JSON.stringify({sourceUrl:'not-a-url', username:'reprint_push_admin', applicationPassword:'secret-value'}))"`,
    {
      ...process.env,
      NODE_NO_WARNINGS: '1',
    },
    repoRoot,
  );

  assert.deepEqual(source, {
    ok: false,
    error: 'Auth session source command must return a supported https or loopback sourceUrl',
  });
});

test('production auth/session source loader fails closed when sourceUrl is insecure remote http', () => {
  const source = loadAuthSessionSource(
    `${process.execPath} -e "process.stdout.write(JSON.stringify({sourceUrl:'http://example.com/push', username:'reprint_push_admin', applicationPassword:'secret-value'}))"`,
    {
      ...process.env,
      NODE_NO_WARNINGS: '1',
    },
    repoRoot,
  );

  assert.deepEqual(source, {
    ok: false,
    error: 'Auth session source command must return a supported https or loopback sourceUrl',
  });
});

test('production auth/session source loader accepts https and ipv6 loopback sourceUrl values', () => {
  const httpsRemoteSource = loadAuthSessionSource(
    `${process.execPath} -e "process.stdout.write(JSON.stringify({sourceUrl:'https://example.com/push', username:'reprint_push_admin', applicationPassword:'secret-value'}))"`,
    {
      ...process.env,
      NODE_NO_WARNINGS: '1',
    },
    repoRoot,
  );
  assert.deepEqual(httpsRemoteSource, {
    ok: true,
    sourceUrl: 'https://example.com/push',
    username: 'reprint_push_admin',
    applicationPassword: 'secret-value',
  });

  const ipv6LoopbackSource = loadAuthSessionSource(
    `${process.execPath} -e "process.stdout.write(JSON.stringify({sourceUrl:'http://[::1]:8080/push', username:'reprint_push_admin', applicationPassword:'secret-value'}))"`,
    {
      ...process.env,
      NODE_NO_WARNINGS: '1',
    },
    repoRoot,
  );
  assert.deepEqual(ipv6LoopbackSource, {
    ok: true,
    sourceUrl: 'http://[::1]:8080/push',
    username: 'reprint_push_admin',
    applicationPassword: 'secret-value',
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

test('production plugin package smoke seeds signed session and nonce options with hashed ids', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );

  assert.match(
    smokeSource,
    /add_option\('reprint_push_lab_signed_session_' \. hash\('sha256', \$expired_session_id\)/,
  );
  assert.match(
    smokeSource,
    /add_option\('reprint_push_lab_signed_session_' \. hash\('sha256', \$future_session_id\)/,
  );
  assert.match(
    smokeSource,
    /add_option\('reprint_push_lab_signed_nonce_' \. hash\('sha256', \$expired_nonce\)/,
  );
  assert.match(
    smokeSource,
    /add_option\('reprint_push_lab_signed_nonce_' \. hash\('sha256', \$future_nonce\)/,
  );
});

test('production plugin package smoke leaves one expired signed session for preflight cleanup to delete', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );

  assert.ok(
    smokeSource.includes("$cleanup_expired_session_id = str_repeat('e', 64);")
    || smokeSource.includes("$cleanup_expired_session_id = str_repeat(\\'e\\', 64);"),
    'expected packaged smoke blueprint to seed an untouched expired session for cleanup',
  );
  assert.ok(
    smokeSource.includes("add_option('reprint_push_lab_signed_session_' . hash('sha256', $cleanup_expired_session_id), array('schemaVersion'=>1,'expiresAtUnix'=>$past,'fixture'=>'cleanup-expired-session'), '', 'no');"),
    'expected packaged smoke blueprint to leave one expired signed session for preflight cleanup',
  );
});

test('production plugin package smoke includes the revoked packaged driver credential guard summary', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );

  assert.match(smokeSource, /driverReceiptRevokedCredentialGuard/);
  assert.match(smokeSource, /revoke-application-password/);
  assert.match(smokeSource, /applyRejectedCode: revokedCredentialApply\.body\?\.code/);
  assert.match(smokeSource, /payloadModeAfterReject/);
});

test('production plugin package smoke supports driver-guard-only mode', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );

  assert.match(smokeSource, /const smokeMode = process\.env\.REPRINT_PUSH_PACKAGE_SMOKE_MODE \|\| 'full';/);
  assert.match(smokeSource, /const runDriverGuardOnly = smokeMode === 'driver-guard-only';/);
  assert.match(smokeSource, /mode: smokeMode,/);
  assert.match(smokeSource, /if \(!runDriverGuardOnly\) \{/);
});

maybeTest('production plugin package smoke rejects revoked packaged driver credentials without mutating the remote row', () => {
  const proof = spawnBoundedSync(process.execPath, ['scripts/playground/production-plugin-package-smoke.mjs'], {
    cwd: repoRoot,
    timeout: 90_000,
    killSignal: 'SIGKILL',
    env: {
      ...process.env,
      NODE_NO_WARNINGS: '1',
    },
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  }, 'production plugin package smoke');
  assert.equal(proof.status, 0, proof.stderr);
  assert.match(proof.stdout, /"driverReceiptRevokedCredentialGuard": \{/);
  assert.match(proof.stdout, /"applyRejectedCode": "reprint_push_lab_auth_required"/);
  assert.match(proof.stdout, /"revokeDeleted": true/);
  assert.match(proof.stdout, /"rowRetainedAfterReject": true/);
  assert.match(proof.stdout, /"updatedMarkerAfterReject": "base"/);
  assert.match(proof.stdout, /"payloadModeAfterReject": "base"/);
});

test('production-shaped release verify source runs the packaged plugin driver revoked credential guard in bounded mode', () => {
  const verifySource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );

  assert.match(verifySource, /REPRINT_PUSH_PACKAGE_SMOKE_MODE: 'driver-guard-only'/);
  assert.match(verifySource, /timeout: 90_000/);
  assert.match(verifySource, /REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO: 'driver-receipt-guards'/);
  assert.match(verifySource, /packagedRevokedCredentialGuard: summary\.driverReceiptRevokedCredentialGuard \|\| null/);
  assert.match(verifySource, /const packagedPluginDriverProof = packagedSourceFixture\s*\?\s*summarizePackagedPluginDriverProof\(\)\s*:\s*null;/);
  assert.match(verifySource, /\.\.\.\(packagedPluginDriverProof \? \{ pluginDriver: packagedPluginDriverProof \} : \{\}\)/);
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

test('production-shaped release verify keeps fixture bootstrap credentials separate from live source credentials', () => {
  const resolved = resolveReleaseVerifyCredentials({
    liveSourceUrl: 'http://127.0.0.1:8080',
    username: 'custom-live-user',
    applicationPassword: 'custom-live-password',
  });

  assert.deepEqual(resolved.fixture, releaseVerifyFixtureCredentials);
  assert.deepEqual(resolved.live, {
    liveSourceUrl: 'http://127.0.0.1:8080',
    username: 'custom-live-user',
    applicationPassword: 'custom-live-password',
  });
});

test('production-shaped release verify request state carries explicit direct credentials into the checked verifier before source override', () => {
  assert.deepEqual(
    resolveAuthSessionRequestState(
      {
        liveSourceUrl: 'http://127.0.0.1:9090',
        username: 'trusted-runtime-username',
        applicationPassword: 'trusted-runtime-password',
        fallbackUsername: 'reprint_push_admin',
        fallbackApplicationPassword: 'reprint-push-admin-app-password',
      },
      null,
    ),
    {
      liveSourceUrl: 'http://127.0.0.1:9090',
      username: 'trusted-runtime-username',
      applicationPassword: 'trusted-runtime-password',
      credentials: {
        username: 'trusted-runtime-username',
        password: 'trusted-runtime-password',
      },
    },
  );
});

test('production-shaped release verify sync timeout widens for packaged proofs', () => {
  assert.equal(
    resolveProductionShapedReleaseVerifySyncTimeout({
      REPRINT_PUSH_REQUIRE_PRODUCTION_AUTH_SESSION: '1',
    }),
    packagedReleaseVerifyInnerTimeoutMs,
  );
  assert.equal(
    resolveProductionShapedReleaseVerifySyncTimeout(
      { REPRINT_PUSH_PACKAGED_PRODUCTION_PLUGIN: '1' },
      packagedProofSubprocessTimeoutMs + 5_000,
    ),
    packagedProofSubprocessTimeoutMs - 2_000,
  );
});

test('production-shaped release verify sync timeout stays on the live budget without packaged proof requirements', () => {
  assert.equal(resolveProductionShapedReleaseVerifySyncTimeout({}), liveProofSubprocessTimeoutMs - 2_000);
  assert.equal(
    resolveProductionShapedReleaseVerifySyncTimeout({}, liveProofSubprocessTimeoutMs + 5_000),
    liveProofSubprocessTimeoutMs - 2_000,
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

test('checked release verifier uses the production snapshot export for packaged or explicit live sources', () => {
  assert.equal(
    shouldUseProductionSnapshotExport({
      packagedBoundaryRequested: true,
      explicitSourceUrl: '',
    }),
    true,
  );
  assert.equal(
    shouldUseProductionSnapshotExport({
      packagedBoundaryRequested: false,
      explicitSourceUrl: 'https://example.test',
    }),
    true,
  );
  assert.equal(
    shouldUseProductionSnapshotExport({
      packagedBoundaryRequested: false,
      explicitSourceUrl: '',
    }),
    false,
  );
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
  assert.equal(packagedProductionPluginSnapshotRetryable(notReadyPreflight), true);
  assert.equal(packagedProductionPluginPreflightRetryable(notReadyPreflight), true);
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
      status: 401,
      body: {
        code: 'reprint_push_lab_auth_required',
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
          labBacked: false,
        },
        auth: {
          session: {
            type: 'production-auth-session',
            status: 'revoked',
            expiresAt: '2099-01-01T00:00:00Z',
            revoked: true,
          },
        },
      },
    }),
    false,
  );
});

test('packaged production plugin readiness helper waits for the packaged REST index before route probes', () => {
  assert.equal(
    packagedProductionPluginRestIndexRetryable({
      status: 502,
      body: {
        code: 'wordpress_not_ready',
      },
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginRestIndexReady({
      status: 200,
      body: {
        namespaces: ['wp/v2'],
        routes: {
          '/wp/v2/posts': {},
        },
      },
    }),
    false,
  );
  assert.equal(
    packagedProductionPluginRestIndexRetryable({
      status: 200,
      body: {
        namespaces: ['wp/v2'],
        routes: {
          '/wp/v2/posts': {},
        },
      },
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginRestIndexReady({
      status: 200,
      body: {
        namespaces: ['wp/v2', 'reprint/v1'],
        routes: {
          '/reprint/v1/push/snapshot': {},
        },
      },
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginRestIndexReady({
      status: 200,
      body: {
        namespaces: ['wp/v2', 'reprint/v1', 'reprint-push-lab/v1'],
        routes: {
          '/reprint/v1/push/snapshot': {},
          '/reprint-push-lab/v1/snapshot': {},
        },
      },
    }),
    false,
  );
});

test('packaged production plugin readiness helper bounds repeated not-ready probes and fetch timeouts', () => {
  let routeCounts = {
    snapshot: 0,
    preflight: 0,
  };
  for (let attempt = 1; attempt <= packagedProductionPluginMaxConsecutiveNotReadyProbes; attempt += 1) {
    routeCounts = packagedProductionPluginNextRouteNotReadyProbeCounts(
      routeCounts,
      'snapshot',
      502,
      'WordPress is not ready yet',
    );
  }
  assert.equal(routeCounts.snapshot, packagedProductionPluginMaxConsecutiveNotReadyProbes);
  assert.equal(packagedProductionPluginNotReadyProbeLimitReached(routeCounts.snapshot), true);
  routeCounts = packagedProductionPluginResetRouteNotReadyProbeCounts(routeCounts, 'snapshot');
  assert.equal(routeCounts.snapshot, 0);
  assert.equal(routeCounts.preflight, 0);

  routeCounts = packagedProductionPluginNextRouteNotReadyProbeCounts(
    routeCounts,
    'preflight',
    404,
    'No route was found matching the URL and request method.',
  );
  assert.equal(routeCounts.preflight, 1);
  assert.equal(
    packagedProductionPluginReadinessBodyRetryable(
      404,
      'No route was found matching the URL and request method.',
    ),
    true,
  );

  const timedOutFetch = new Error('Timed out fetching http://127.0.0.1:8080/wp-json/reprint/v1/push/snapshot');
  assert.equal(packagedProductionPluginReadinessProbeTimedOut(timedOutFetch), true);
  assert.equal(packagedProductionPluginNextTimeoutProbeCount(0, timedOutFetch), 1);
  assert.equal(packagedProductionPluginReadinessErrorRetryable(timedOutFetch), true);

  const readinessFailure = new Error('bounded readiness failure');
  readinessFailure.isPlaygroundReadinessFailure = true;
  assert.equal(packagedProductionPluginReadinessErrorRetryable(readinessFailure), false);
});

test('packaged production plugin readiness helper falls back to signed preflight and index probes after snapshot timeouts', () => {
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );

  assert.match(
    verifierSource,
    /if \(packagedProductionPluginReadinessProbeTimedOut\(error\)\) \{\s*const \{ preflightProbe, indexProbe \} = await fetchPackagedTimeoutFallbackProbes\(baseUrl\);/s,
  );
  assert.match(verifierSource, /if \(preflightProbe\.ready\) \{\s*return;\s*\}/);
  assert.match(verifierSource, /if \(preflightProbe\.retryable\) \{\s*lastError = error;\s*timeoutProbeCount = 0;\s*await sleep\(readinessProbeIntervalMs\);\s*continue;\s*\}/s);
  assert.match(verifierSource, /if \(packagedProductionPluginReadinessBodyRetryable\(indexProbe\?\.status, indexProbe\?\.body \|\| ''\)\) \{\s*lastError = error;\s*timeoutProbeCount = 0;\s*await sleep\(readinessProbeIntervalMs\);\s*continue;\s*\}/s);
});

test('packaged production plugin readiness helper fails closed when timeout fallback preflight becomes terminal', () => {
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );

  assert.match(verifierSource, /Packaged production plugin preflight became terminal while the snapshot probe timed out/);
  assert.match(verifierSource, /async function fetchPackagedTimeoutFallbackProbes\(baseUrl\)/);
  assert.match(verifierSource, /function buildPackagedTimeoutFallbackProbe\(route, error\)/);
  assert.match(verifierSource, /if \(!packagedProductionPluginReadinessProbeTimedOut\(error\)\) \{\s*throw error;\s*\}/s);
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
      required: 'unrevoked',
      observed: 'revoked',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycle({
      id: 'psh_01j00000000000000000000000',
      type: 'production-auth-session',
      status: 'cleaned-up',
      expiresAt: '2099-01-01T00:00:00Z',
    }),
    {
      ok: false,
      required: 'unrevoked',
      observed: 'cleaned-up',
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

test('production auth/session lifecycle helper fails closed on malformed lifecycle flags', () => {
  assert.deepEqual(
    evaluateProductionAuthSessionLifecycle({
      id: 'psh_01j00000000000000000000000',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      cleanup: 'yes',
    }),
    {
      ok: false,
      required: 'boolean lifecycle flags',
      observed: 'invalid-cleanup',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycle({
      id: 'psh_01j00000000000000000000000',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      preserved: 'yes',
    }),
    {
      ok: false,
      required: 'boolean lifecycle flags',
      observed: 'invalid-preserved',
    },
  );
});

test('production auth/session lifecycle helper fails closed on malformed string lifecycle fields', () => {
  assert.deepEqual(
    evaluateProductionAuthSessionLifecycle({
      id: ' psh_01j00000000000000000000000 ',
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
      type: 'production-auth-session',
      status: ['active'],
      expiresAt: '2099-01-01T00:00:00Z',
    }),
    {
      ok: false,
      required: 'string lifecycle fields',
      observed: 'invalid-status',
    },
  );
});

test('production auth/session lifecycle summary helper requires a preserved active read', () => {
  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        authUser: 'reprint_push_admin',
      },
      read: {
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        authUser: 'reprint_push_admin',
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
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        authUser: 'reprint_push_admin',
      },
      read: {
        id: 'session-02',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        authUser: 'reprint_push_admin',
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
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        authUser: 'reprint_push_admin',
      },
      read: {
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        authUser: 'reprint_push_admin',
        preserved: true,
      },
      observations: [
        {
          step: 'preflight',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          authUser: 'reprint_push_admin',
          preserved: false,
          rotated: false,
        },
        {
          step: 'dry-run',
          id: '',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          authUser: 'reprint_push_admin',
          preserved: false,
          rotated: false,
        },
        {
          step: 'apply',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          authUser: 'reprint_push_admin',
          preserved: true,
          rotated: false,
        },
      ],
    }),
    {
      ok: false,
      required: 'preserved read',
      observed: 'missing-session-id',
    },
  );

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        authUser: 'reprint_push_admin',
      },
      read: {
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        authUser: 'reprint_push_admin',
        preserved: true,
      },
      observations: [
        {
          step: 'preflight',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          authUser: 'reprint_push_admin',
          preserved: false,
          rotated: false,
        },
        {
          step: 'dry-run',
          id: 'session-02',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          authUser: 'reprint_push_admin',
          preserved: true,
          rotated: false,
        },
        {
          step: 'apply',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          authUser: 'reprint_push_admin',
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
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
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
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      read: {
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
      required: 'preserved read',
      observed: 'missing',
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
        step: 'apply',
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
      observed: 'apply',
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
        authUser: 'reprint_push_admin',
      },
      read: {
        step: 'apply',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        authUser: 'reprint_push_admin',
        preserved: true,
      },
      observations: [
        {
          step: 'preflight',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          authUser: 'reprint_push_admin',
          preserved: false,
          rotated: false,
        },
      ],
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
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        authUser: 'reprint_push_admin',
      },
      read: {
        step: 'apply',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        authUser: 'reprint_push_admin',
        preserved: true,
      },
      observations: [
        {
          step: 'preflight',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          authUser: 'reprint_push_admin',
          preserved: false,
          rotated: false,
        },
        {
          step: 'cleanup',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          authUser: 'reprint_push_admin',
          preserved: true,
          rotated: false,
        },
      ],
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
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        authUser: 'reprint_push_admin',
      },
      read: {
        step: 'journal',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        authUser: 'reprint_push_admin',
        preserved: true,
      },
      observations: [
        {
          step: 'preflight',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          authUser: 'reprint_push_admin',
          preserved: false,
          rotated: false,
        },
        {
          step: 'unsupported-phase',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          authUser: 'reprint_push_admin',
          preserved: true,
          rotated: false,
        },
        {
          step: 'journal',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          authUser: 'reprint_push_admin',
          preserved: true,
          rotated: false,
        },
      ],
    }),
    {
      ok: false,
      required: 'preserved read',
      observed: 'unsupported-phase',
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
        step: 'apply',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
      observations: [
        {
          step: 'apply',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          authUser: 'reprint_push_admin',
          preserved: true,
          rotated: false,
        },
        {
          step: 'preflight',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          preserved: false,
          rotated: false,
        },
      ],
    }),
    {
      ok: false,
      required: 'issued preflight',
      observed: 'apply',
    },
  );
});

test('checked release auth/session lifecycle helper requires replay or journal boundary preservation', () => {
  assert.deepEqual(
    evaluateCheckedReleaseAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        authUser: 'reprint_push_admin',
        expired: false,
        revoked: false,
        cleanedUp: false,
        rotated: false,
        preserved: false,
      },
      read: {
        step: 'dry-run',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        authUser: 'reprint_push_admin',
        expired: false,
        revoked: false,
        cleanedUp: false,
        rotated: false,
        preserved: true,
      },
      preserved: {
        step: 'dry-run',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        authUser: 'reprint_push_admin',
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
          authUser: 'reprint_push_admin',
          expired: false,
          revoked: false,
          cleanedUp: false,
          rotated: false,
          preserved: false,
        },
        {
          step: 'dry-run',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          authUser: 'reprint_push_admin',
          expired: false,
          revoked: false,
          cleanedUp: false,
          rotated: false,
          preserved: true,
        },
      ],
    }),
    {
      ok: false,
      required: 'release-boundary preserved read',
      observed: 'dry-run',
    },
  );

  assert.deepEqual(
    evaluateCheckedReleaseAuthSessionLifecycleSummary({
      issued: {
        step: 'preflight',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        authUser: 'reprint_push_admin',
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
        authUser: 'reprint_push_admin',
        expired: false,
        revoked: false,
        cleanedUp: false,
        rotated: false,
        preserved: true,
      },
      preserved: {
        step: 'dry-run',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        authUser: 'reprint_push_admin',
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
          authUser: 'reprint_push_admin',
          expired: false,
          revoked: false,
          cleanedUp: false,
          rotated: false,
          preserved: false,
        },
        {
          step: 'dry-run',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          authUser: 'reprint_push_admin',
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
          authUser: 'reprint_push_admin',
          expired: false,
          revoked: false,
          cleanedUp: false,
          rotated: false,
          preserved: true,
        },
      ],
    }),
    {
      ok: true,
      required: 'checked release production-auth-session lifecycle',
      observed: 'journal',
    },
  );
});

test('production auth/session lifecycle summary fails closed on authenticated identity continuity drift', () => {
  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        authUser: 'reprint_push_admin',
      },
      read: {
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        authUser: 'different-user',
        preserved: true,
      },
      observations: [
        {
          step: 'preflight',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          authUser: 'reprint_push_admin',
          preserved: false,
          rotated: false,
        },
        {
          step: 'recovery-inspect',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          authUser: 'different-user',
          preserved: true,
          rotated: false,
        },
      ],
    }),
    {
      ok: false,
      required: 'authenticated identity continuity',
      observed: 'different-user',
    },
  );
});

test('production auth/session lifecycle summary fails closed when the issued preflight drops the authenticated identity', () => {
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
        authUser: 'reprint_push_admin',
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
          step: 'journal',
          id: 'session-01',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
          authUser: 'reprint_push_admin',
          preserved: true,
          rotated: false,
        },
      ],
    }),
    {
      ok: false,
      required: 'authenticated identity continuity',
      observed: 'missing-user-login',
    },
  );
});

test('production auth/session lifecycle summary fails closed when a preserved read drops the authenticated identity', () => {
  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary({
      issued: {
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        authUser: 'reprint_push_admin',
      },
      read: {
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
          authUser: 'reprint_push_admin',
          preserved: false,
          rotated: false,
        },
        {
          step: 'journal',
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
      required: 'authenticated identity continuity',
      observed: 'missing-user-login',
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
      ],
    },
  );
});

test('production auth/session lifecycle trace summary preserves status-only revoked and cleaned-up markers', () => {
  const revokedSummary = summarizeProductionAuthSessionLifecycleTrace([
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
      status: 'revoked',
      expiresAt: '2099-01-01T00:00:00Z',
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: true,
    },
  ]);

  assert.equal(revokedSummary.revoked?.status, 'revoked');
  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary(revokedSummary),
    {
      ok: false,
      required: 'unrevoked',
      observed: 'revoked',
    },
  );

  const cleanedUpSummary = summarizeProductionAuthSessionLifecycleTrace([
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
      status: 'cleaned-up',
      expiresAt: '2099-01-01T00:00:00Z',
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: true,
    },
  ]);

  assert.equal(cleanedUpSummary.cleanedUp?.status, 'cleaned-up');
  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary(cleanedUpSummary),
    {
      ok: false,
      required: 'unrevoked',
      observed: 'cleaned-up',
    },
  );
});

test('production auth/session lifecycle trace summary preserves status-only expired markers', () => {
  const expiredSummary = summarizeProductionAuthSessionLifecycleTrace([
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
      status: 'expired',
      expiresAt: '2099-01-01T00:00:00Z',
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: true,
    },
  ]);

  assert.equal(expiredSummary.expired?.status, 'expired');
  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary(expiredSummary),
    {
      ok: false,
      required: 'unexpired',
      observed: 'expired',
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
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: false,
    },
    read: null,
    expired: null,
    revoked: null,
    cleanedUp: null,
    rotated: null,
    preserved: null,
    observations: [
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

test('production auth/session lifecycle trace summary treats recovery inspect as a preserved read', () => {
  const summary = summarizeProductionAuthSessionLifecycleTrace([
    {
      step: 'preflight',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      authUser: 'reprint_push_admin',
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
      authUser: 'reprint_push_admin',
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
      authUser: 'reprint_push_admin',
      expired: false,
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: false,
    },
    read: {
      step: 'recovery-inspect',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      authUser: 'reprint_push_admin',
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
      step: 'recovery-inspect',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      authUser: 'reprint_push_admin',
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
        authUser: 'reprint_push_admin',
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
        authUser: 'reprint_push_admin',
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
      ok: true,
      required: 'production-auth-session lifecycle',
      observed: 'active-unexpired-preserved',
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

test('production auth/session lifecycle summary fails closed when an intermediate read is unpreserved before a later preserved read', () => {
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

test('production auth/session lifecycle summary fails closed when direct preserved summary carries stale lifecycle fields', () => {
  const summary = {
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
      step: 'apply',
      id: 'session-01',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2098-01-01T00:00:00Z',
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
        step: 'dry-run',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
      {
        step: 'apply',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
      {
        step: 'journal',
        id: 'session-01',
        type: 'production-auth-session',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
        preserved: true,
      },
    ],
  };

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycleSummary(summary),
    {
      ok: false,
      required: 'preserved read',
      observed: 'stale-preserved-summary',
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
        timeout: packagedReleaseVerifyInnerTimeoutMs,
        killSignal: liveProofSubprocessKillSignal,
      },
      'packaged auth/session source release verify',
    );
    assertSpawnCompletedWithoutSpawnError(proof, 'packaged auth/session source release verify', packagedReleaseVerifyInnerTimeoutMs);
    assert.equal(proof.status, 0, proof.stderr);
    assert.match(
      proof.stdout,
      new RegExp(`"authSessionSource": \\{\\s*"command": ${JSON.stringify(expectedSourceCommand)},\\s*"ok": true,\\s*"sourceUrl": "http:\\/\\/127\\.0\\.0\\.1:\\d+"`),
    );
    assert.match(proof.stdout, /"liveAuthSessionSource": \{[\s\S]*"requiredCommand": "REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND"/);
    assert.match(proof.stdout, /"preflight": \{\s*"status": 200,\s*"authSessionType": "production-auth-session"/);
    assert.match(
      proof.stdout,
      /"authSessionLifecycle": \{\s*"history": \[[\s\S]*?"minted": \{\s*"id": "[^"]+",\s*"type": "production-auth-session",\s*"status": "active",\s*"expiresAt": "[^"]+",\s*"authUser": "[^"]+",\s*"expired": false,\s*"revoked": false,\s*"cleanedUp": false\s*\}/,
    );
    assert.match(
      proof.stdout,
      /"authSessionLifecycleSummary": \{\s*"issued": \{\s*"step": "preflight",\s*"id": "[^"]+",\s*"type": "production-auth-session",\s*"status": "active",\s*"expiresAt": "[^"]+",\s*"authUser": "[^"]+",\s*"expired": false,\s*"revoked": false,\s*"cleanedUp": false,\s*"rotated": false,\s*"preserved": false\s*\}/,
    );
    assert.match(
      proof.stdout,
      /"authSessionLifecycleSummary": \{[\s\S]*?"read": \{\s*"step": "(dry-run|apply|replay|journal)",\s*"id": "[^"]+",\s*"type": "production-auth-session",\s*"status": "active",\s*"expiresAt": "[^"]+",\s*"authUser": "[^"]+",\s*"expired": false,\s*"revoked": false,\s*"cleanedUp": false,\s*"rotated": false,\s*"preserved": true\s*\}/,
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
      timeout: packagedReleaseVerifyInnerTimeoutMs,
      killSignal: liveProofSubprocessKillSignal,
    },
    'packaged recovery journal release verify',
  );
  assertSpawnCompletedWithoutSpawnError(proof, 'packaged recovery journal release verify', packagedReleaseVerifyInnerTimeoutMs);
  assert.equal(proof.status, 0, proof.stderr);
  assert.match(proof.stdout, /"recoveryInspect": \{[\s\S]*"journalState": "ok"/);
  assert.match(proof.stdout, /"recoveryInspect": \{[\s\S]*"journal": \{[\s\S]*"productionAdapter": "wpdb-single-statement-cas"[\s\S]*"supportedSurface": "claim-fenced-restart-readable"/);
  assert.match(proof.stdout, /"durableJournal": \{[\s\S]*"staleClaimRejected": true/);
  assert.match(
    proof.stdout,
    /"liveLeaseFence": \{\s*"boundary": "wpdb-single-statement-cas",\s*"claimKeyUnique": true,\s*"monotonicSequence": true,\s*"restartReadable": true,\s*"staleClaimRejected": true\s*\}/,
  );
});

test('production-shaped live release verify preserves explicit checked-boundary env instead of synthesizing a local source', () => {
  const explicitSourceCommand = buildAuthSessionSourceCommand({
    sourceUrl: 'http://127.0.0.1:49152',
    username: 'live-user',
    applicationPassword: 'live-app-password',
  });

  assert.equal(
    hasExplicitCheckedBoundaryRequest({
      liveSourceUrl: 'http://127.0.0.1:49152',
      authSessionSourceCommand: explicitSourceCommand,
    }),
    true,
  );

  assert.deepEqual(
    resolveCheckedLiveBoundaryEnv({
      sourceUrl: 'http://127.0.0.1:49152',
      fallbackUsername: liveCredentials.username,
      fallbackApplicationPassword: liveCredentials.password,
    }),
    {
      REPRINT_PUSH_REQUIRE_PRODUCTION_AUTH_SESSION: '1',
      REPRINT_PUSH_REQUIRE_PRODUCTION_DURABLE_JOURNAL: '1',
      REPRINT_PUSH_SOURCE_URL: 'http://127.0.0.1:49152',
      REPRINT_PUSH_REMOTE_URL: 'http://127.0.0.1:49152',
      REPRINT_PUSH_USERNAME: liveCredentials.username,
      REPRINT_PUSH_APPLICATION_PASSWORD: liveCredentials.password,
      REPRINT_PUSH_LAB_AUTH_ADMIN_USER: liveCredentials.username,
      REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: liveCredentials.password,
      REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND: buildAuthSessionSourceCommand({
        sourceUrl: 'http://127.0.0.1:49152',
        username: liveCredentials.username,
        applicationPassword: liveCredentials.password,
      }),
    },
  );

  assert.deepEqual(
    resolveCheckedLiveBoundaryEnv({
      sourceUrl: 'http://127.0.0.1:49152',
      authSessionSourceCommand: explicitSourceCommand,
      fallbackUsername: liveCredentials.username,
      fallbackApplicationPassword: liveCredentials.password,
    }),
    {
      REPRINT_PUSH_REQUIRE_PRODUCTION_AUTH_SESSION: '1',
      REPRINT_PUSH_REQUIRE_PRODUCTION_DURABLE_JOURNAL: '1',
      REPRINT_PUSH_SOURCE_URL: 'http://127.0.0.1:49152',
      REPRINT_PUSH_REMOTE_URL: 'http://127.0.0.1:49152',
      REPRINT_PUSH_USERNAME: liveCredentials.username,
      REPRINT_PUSH_APPLICATION_PASSWORD: liveCredentials.password,
      REPRINT_PUSH_LAB_AUTH_ADMIN_USER: liveCredentials.username,
      REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: liveCredentials.password,
      REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND: explicitSourceCommand,
    },
  );

  assert.deepEqual(
    resolveLiveApplyRevalidationEnv({
      sourceUrl: 'http://127.0.0.1:49152',
      remoteChangedUrl: 'http://127.0.0.1:49154',
      localUrl: 'http://127.0.0.1:49153',
      authSessionSourceCommand: explicitSourceCommand,
      fallbackUsername: liveCredentials.username,
      fallbackApplicationPassword: liveCredentials.password,
    }),
    {
      REPRINT_PUSH_REQUIRE_PRODUCTION_AUTH_SESSION: '1',
      REPRINT_PUSH_REQUIRE_PRODUCTION_DURABLE_JOURNAL: '1',
      REPRINT_PUSH_SOURCE_URL: 'http://127.0.0.1:49152',
      REPRINT_PUSH_REMOTE_URL: 'http://127.0.0.1:49152',
      REPRINT_PUSH_REMOTE_CHANGED_URL: 'http://127.0.0.1:49154',
      REPRINT_PUSH_LOCAL_URL: 'http://127.0.0.1:49153',
      REPRINT_PUSH_USERNAME: liveCredentials.username,
      REPRINT_PUSH_APPLICATION_PASSWORD: liveCredentials.password,
      REPRINT_PUSH_LAB_AUTH_ADMIN_USER: liveCredentials.username,
      REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: liveCredentials.password,
      REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND: explicitSourceCommand,
    },
  );

  assert.deepEqual(
    resolveCheckedLiveBoundaryEnv({
      sourceUrl: 'http://127.0.0.1:49152',
      username: 'explicit-user',
      applicationPassword: 'explicit-app-password',
      fallbackUsername: liveCredentials.username,
      fallbackApplicationPassword: liveCredentials.password,
    }),
    {
      REPRINT_PUSH_REQUIRE_PRODUCTION_AUTH_SESSION: '1',
      REPRINT_PUSH_REQUIRE_PRODUCTION_DURABLE_JOURNAL: '1',
      REPRINT_PUSH_SOURCE_URL: 'http://127.0.0.1:49152',
      REPRINT_PUSH_REMOTE_URL: 'http://127.0.0.1:49152',
      REPRINT_PUSH_USERNAME: 'explicit-user',
      REPRINT_PUSH_APPLICATION_PASSWORD: 'explicit-app-password',
      REPRINT_PUSH_LAB_AUTH_ADMIN_USER: 'explicit-user',
      REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: 'explicit-app-password',
      REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND: buildAuthSessionSourceCommand({
        sourceUrl: 'http://127.0.0.1:49152',
        username: 'explicit-user',
        applicationPassword: 'explicit-app-password',
      }),
    },
  );

  assert.deepEqual(
    resolveLiveApplyRevalidationEnv({
      sourceUrl: 'http://127.0.0.1:49152',
      remoteChangedUrl: 'http://127.0.0.1:49154',
      localUrl: 'http://127.0.0.1:49153',
      username: 'explicit-user',
      applicationPassword: 'explicit-app-password',
      fallbackUsername: liveCredentials.username,
      fallbackApplicationPassword: liveCredentials.password,
    }),
    {
      REPRINT_PUSH_REQUIRE_PRODUCTION_AUTH_SESSION: '1',
      REPRINT_PUSH_REQUIRE_PRODUCTION_DURABLE_JOURNAL: '1',
      REPRINT_PUSH_SOURCE_URL: 'http://127.0.0.1:49152',
      REPRINT_PUSH_REMOTE_URL: 'http://127.0.0.1:49152',
      REPRINT_PUSH_REMOTE_CHANGED_URL: 'http://127.0.0.1:49154',
      REPRINT_PUSH_LOCAL_URL: 'http://127.0.0.1:49153',
      REPRINT_PUSH_USERNAME: 'explicit-user',
      REPRINT_PUSH_APPLICATION_PASSWORD: 'explicit-app-password',
      REPRINT_PUSH_LAB_AUTH_ADMIN_USER: 'explicit-user',
      REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: 'explicit-app-password',
      REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND: buildAuthSessionSourceCommand({
        sourceUrl: 'http://127.0.0.1:49152',
        username: 'explicit-user',
        applicationPassword: 'explicit-app-password',
      }),
    },
  );

  assert.deepEqual(resolveCheckedReleaseRequirementEnv(), {
    REPRINT_PUSH_REQUIRE_PRODUCTION_AUTH_SESSION: '1',
    REPRINT_PUSH_REQUIRE_PRODUCTION_DURABLE_JOURNAL: '1',
  });

  assert.deepEqual(
    resolveCheckedReleaseTopology({
      remoteBaseUrl: 'http://127.0.0.1:49152',
      explicitSourceUrl: 'http://127.0.0.1:49152',
      explicitRemoteChangedUrl: 'http://127.0.0.1:49154',
      explicitLocalUrl: 'http://127.0.0.1:49153',
      packagedBoundaryRequested: false,
    }),
    {
      remoteBase: 'http://127.0.0.1:49152',
      remoteChanged: 'http://127.0.0.1:49154',
      localEdited: 'http://127.0.0.1:49153',
    },
  );

  assert.deepEqual(
    resolveCheckedReleaseTopology({
      remoteBaseUrl: 'http://127.0.0.1:49152',
      explicitSourceUrl: 'http://127.0.0.1:49152',
      explicitLocalUrl: '',
      packagedBoundaryRequested: true,
    }),
    {
      remoteBase: 'http://127.0.0.1:49152',
      remoteChanged: 'remote-changed',
      localEdited: 'local-edited',
    },
  );
});

test('production-shaped live release verify forces checked release requirements into child proofs', () => {
  const source = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-live-release-verify.mjs'),
    'utf8',
  );

  assert.match(source, /resolveCheckedReleaseRequirementEnv/);
  assert.match(source, /\.\.\.resolveCheckedReleaseRequirementEnv\(\),\s*\.\.\.envOverrides,/);
  assert.match(
    source,
    /runCheckedReleaseVerify\(\s*resolveCheckedLiveBoundaryEnv\(\{\s*sourceUrl: remoteServer\.baseUrl,/,
  );
});

test('production-shaped live release verify bounds repeated startup-shaped 502 responses before the outer wrapper times out', () => {
  const source = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-live-release-verify.mjs'),
    'utf8',
  );

  assert.match(source, /const maxNotReadyReadinessProbes = Math\.max\(4,/);
  assert.match(source, /isWordPressNotReadyResponse\(response\.status, responseBody\)/);
  assert.match(source, /consecutiveNotReadyResponses >= maxNotReadyReadinessProbes/);
  assert.match(source, /Playground server reported the bounded readiness failure/);
  assert.match(source, /Probe trail:/);
  assert.match(source, /Last probe:/);
});

test('production-shaped live release verify stops failed Playground children during startup before rethrowing', () => {
  const source = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-live-release-verify.mjs'),
    'utf8',
  );

  assert.match(source, /async function stopPlaygroundChild\(child\)/);
  assert.match(
    source,
    /try \{\s*await waitForServer\(child, baseUrl, \(\) => output\);\s*\} catch \(error\) \{\s*await stopPlaygroundChild\(child\)\.catch\(\(\) => \{\}\);\s*throw error;\s*\}/s,
  );
});

test('production-shaped live release verify defaults the checked live branch to the packaged auth/session boundary', () => {
  assert.equal(
    shouldRequestCheckedLivePackagedBoundary({
      fixtureUsername: liveCredentials.username,
      fixtureApplicationPassword: liveCredentials.password,
    }),
    true,
  );

  assert.equal(
    shouldRequestCheckedLivePackagedBoundary({
      liveSourceUrl: 'http://127.0.0.1:49152',
      fixtureUsername: liveCredentials.username,
      fixtureApplicationPassword: liveCredentials.password,
    }),
    false,
  );

  assert.equal(
    shouldRequestCheckedLivePackagedBoundary({
      authSessionSourceCommand: buildAuthSessionSourceCommand({
        sourceUrl: 'http://127.0.0.1:49152',
        username: liveCredentials.username,
        applicationPassword: liveCredentials.password,
      }),
      fixtureUsername: liveCredentials.username,
      fixtureApplicationPassword: liveCredentials.password,
    }),
    false,
  );
});

maybeTest('production-shaped live release verify command proves the packaged checked boundary end to end by default', () => {
  const proof = spawnBoundedSync(
    process.execPath,
    ['scripts/playground/production-shaped-live-release-verify.mjs'],
    {
      cwd: repoRoot,
      timeout: liveWrapperSubprocessTimeoutMs,
      killSignal: 'SIGKILL',
      env: {
        ...process.env,
        NODE_NO_WARNINGS: '1',
      },
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 20,
    },
    'live release verify wrapper',
  );

  assertLiveReleaseVerifyProof(proof, 'live release verify wrapper', liveWrapperSubprocessTimeoutMs);
  assert.equal(proof.status, 0, proof.stderr);
  const summary = JSON.parse(proof.stdout);

  assert.equal(summary.ok, true);
  assert.equal(summary.boundary?.verdict, 'PACKAGED_RELEASE_BOUNDARY_OK');
  assert.equal(summary.boundary?.authSession?.required, 'checked release production-auth-session lifecycle');
  assert.equal(summary.boundary?.authSession?.observed, 'journal');
  assert.equal(summary.boundary?.authSession?.verdict, 'PACKAGED_RELEASE_BOUNDARY_OK');
  assert.equal(summary.preflight?.routeProfile?.profile, 'production-shaped');
  assert.equal(summary.preflight?.routeProfile?.labBacked, false);
  assert.equal(summary.releaseProof?.authSessionLifecycle?.minted?.type, 'production-auth-session');
  assert.equal(summary.releaseProof?.authSessionLifecycle?.minted?.status, 'active');
  assert.equal(summary.releaseProof?.authSessionLifecycle?.minted?.expired, false);
  assert.equal(summary.releaseProof?.authSessionLifecycle?.read?.type, 'production-auth-session');
  assert.equal(summary.releaseProof?.authSessionLifecycle?.read?.status, 'active');
  assert.equal(summary.releaseProof?.authSessionLifecycle?.read?.expired, false);
  assert.equal(summary.durableJournal?.checkedAccepted, true);
  assert.equal(summary.boundary?.replayAndRetry?.required, '/snapshot');
  assert.equal(summary.boundary?.replayAndRetry?.observed, '/snapshot');
  assert.equal(summary.boundary?.replayAndRetry?.retryAttempts, 2);
  assert.equal(summary.boundary?.replayAndRetry?.verdict, 'LIVE_RELEASE_BOUNDARY_OK');
  assert.equal(summary.applyRevalidation?.ok, true);
  assert.equal(summary.applyRevalidation?.boundary?.firstRemainingProductionBoundary, null);
  assert.equal(summary.applyRevalidation?.boundary?.verdict, 'LIVE_RELEASE_BOUNDARY_OK');
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
    return withPlaygroundServer('remote-changed', path.join(repoRoot, 'fixtures/playground/remote-changed.blueprint.json'), async (remoteChangedServer) => {
      return withPlaygroundServer('local-edited', path.join(repoRoot, 'fixtures/playground/local-edited.blueprint.json'), async (localServer) => {
        const proof = spawnProductionShapedReleaseVerifySync(
          {
            ...process.env,
            REPRINT_PUSH_SOURCE_URL: remoteServer.baseUrl,
            REPRINT_PUSH_REMOTE_URL: remoteServer.baseUrl,
            REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedServer.baseUrl,
            REPRINT_PUSH_LOCAL_URL: localServer.baseUrl,
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
        assert.match(
          proof.stdout,
          new RegExp(`"remoteChanged": ${JSON.stringify(remoteChangedServer.baseUrl)}`),
        );
        assert.match(
          proof.stdout,
          new RegExp(`"localEdited": ${JSON.stringify(localServer.baseUrl)}`),
        );
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
          /"boundary": \{[\s\S]*"replayAndRetry": \{\s*"required": "\/snapshot",\s*"observed": "\/snapshot",\s*"retryAttempts": 2,\s*"verdict": "LIVE_RELEASE_BOUNDARY_OK"\s*\}/,
        );
        assert.match(
          proof.stdout,
          /"gateDependencies": \{\s*"productionAuthSession": "production-backed auth\/session issuance, read, expiry, rotation, revocation, and cleanup on the checked release path",\s*"durableJournal": "production durable journal storage with lease fencing, restart-readable artifacts, and release-path consumption",\s*"replayAndRetry": "checked live replay equivalence plus preserved-remote retry on the release verifier path"\s*\}/,
        );
        assert.match(proof.stdout, /"releaseProof": \{\s*"ok": true,\s*"mode": "apply"/);
        assert.match(proof.stdout, /"durableJournal": \{\s*"proof": \{\s*"status": 0,\s*"journal": \{/);
        assert.match(proof.stdout, /"recoveryInspect": \{[\s\S]*"journal": \{[\s\S]*"productionAdapter": "wpdb-single-statement-cas"[\s\S]*"supportedSurface": "claim-fenced-restart-readable"/);
        assert.match(proof.stdout, /"ownsJournal": true/);
        assert.match(proof.stdout, /"restartReadable": true/);
        assert.match(proof.stdout, /"staleClaimRejected": true/);
        assert.match(proof.stdout, /"checkedAccepted": true/);
        assert.match(
          proof.stdout,
          /"leaseFence": \{[\s\S]*"storageGuard": "wpdb-single-statement-cas"[\s\S]*"fsyncEvidence": true[\s\S]*"staleClaimRejected": true/,
        );
        assert.match(proof.stdout, /"consumed": true/);
        assert.match(
          proof.stdout,
          /"releaseProof": \{\s*"ok": true[\s\S]*?"authSessionLifecycle": \{\s*"minted": \{\s*"id": "[^"]+",\s*"type": "production-auth-session",\s*"status": "active",\s*"expiresAt": "[^"]+",\s*"authUser": "[^"]+",\s*"expired": false\s*\},\s*"read": \{\s*"id": "[^"]+",\s*"type": "production-auth-session",\s*"status": "active",\s*"expiresAt": "[^"]+",\s*"authUser": "[^"]+",\s*"expired": false\s*\}/,
        );
        assert.match(
          proof.stdout,
          /"authSessionLifecycleSummary": \{\s*"issued": \{\s*"step": "preflight",\s*"id": "[^"]+",\s*"type": "production-auth-session",\s*"status": "active",\s*"expiresAt": "[^"]+",\s*"authUser": "[^"]+",\s*"expired": false,\s*"revoked": false,\s*"cleanedUp": false,\s*"rotated": false,\s*"preserved": false\s*\},\s*"read": \{\s*"step": "(journal|replay)",\s*"id": "[^"]+",\s*"type": "production-auth-session",\s*"status": "active",\s*"expiresAt": "[^"]+",\s*"authUser": "[^"]+",\s*"expired": false,\s*"revoked": false,\s*"cleanedUp": false,\s*"rotated": false,\s*"preserved": true\s*\}/,
        );
        assert.match(
          proof.stdout,
          /"authSessionLifecycle": \{\s*"minted": \{\s*"id": "[^"]+",\s*"type": "production-auth-session",\s*"status": "active",\s*"expiresAt": "[^"]+",\s*"authUser": "[^"]+",\s*"expired": false\s*\},\s*"read": \{\s*"id": "[^"]+",\s*"type": "production-auth-session",\s*"status": "active",\s*"expiresAt": "[^"]+",\s*"authUser": "[^"]+",\s*"expired": false\s*\}/,
        );
        assert.match(
          proof.stdout,
          /"authSessionLifecycleTrace": \[[\s\S]*?\{\s*"step": "(dry-run|apply|replay|journal)",\s*"id": "[^"]+",\s*"type": "production-auth-session",\s*"status": "active",\s*"expiresAt": "[^"]+",\s*"authUser": "[^"]+",\s*"expired": false,\s*"rotated": false,\s*"preserved": true\s*\}/,
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
        assert.match(
          proof.stdout,
          /"replayAndRetry": \{\s*"required": "\/snapshot",\s*"observed": "\/snapshot",\s*"retryAttempts": 2,\s*"verdict": "PRESERVED_REMOTE_RETRY_PROVEN"\s*\}/,
        );
        assert.match(proof.stdout, /"applyRevalidation": \{\s*"ok": true,/);
        assert.match(
          proof.stdout,
          new RegExp(`"applyRevalidation": \\{[\\s\\S]*"topology": \\{\\s*"sourceUrl": ${JSON.stringify(remoteServer.baseUrl)},\\s*"remoteBase": ${JSON.stringify(remoteServer.baseUrl)},\\s*"remoteChanged": ${JSON.stringify(remoteChangedServer.baseUrl)},\\s*"localEdited": ${JSON.stringify(localServer.baseUrl)},\\s*"externalTopology": true`),
        );
        assert.match(
          proof.stdout,
          /"applyRevalidation": \{[\s\S]*"apply": \{\s*"status": 412,\s*"code": "PRECONDITION_FAILED",\s*"preconditionCheck": "just-in-time",\s*"recovery": \{\s*"required": true,\s*"state": "blocked-recovery"/,
        );
        assert.match(
          proof.stdout,
          /"applyRevalidation": \{[\s\S]*"replayAndRetry": \{\s*"required": "\/snapshot",\s*"observed": "\/snapshot",\s*"retryAttempts": 2,\s*"verdict": "PRESERVED_REMOTE_RETRY_PROVEN"\s*\}[\s\S]*"boundary": \{\s*"firstRemainingProductionBoundary": null,\s*"verdict": "LIVE_RELEASE_BOUNDARY_OK"[\s\S]*"authSession": \{\s*"required": "production-auth-session lifecycle",\s*"observed": "active-unexpired-preserved",\s*"verdict": "LIVE_RELEASE_BOUNDARY_OK"\s*\}[\s\S]*"durableJournal": \{\s*"verdict": "LIVE_RELEASE_BOUNDARY_OK"\s*\}[\s\S]*"replayAndRetry": \{\s*"required": "\/snapshot",\s*"observed": "\/snapshot",\s*"retryAttempts": 2,\s*"verdict": "LIVE_RELEASE_BOUNDARY_OK"\s*\}/,
        );
        assert.match(proof.stdout, /"preflight": \{\s*"status": 200,\s*"ok": true,\s*"mode": "preflight"/);
      });
    });
  });
});

maybeTest('production-shaped live release verify command proves the explicit checked live boundary end to end', () => {
  return withPlaygroundServer('remote-base', path.join(repoRoot, 'fixtures/playground/remote-base.blueprint.json'), async (remoteServer) => {
    return withPlaygroundServer('remote-base-apply', path.join(repoRoot, 'fixtures/playground/remote-base.blueprint.json'), async (applyRemoteServer) => {
      return withPlaygroundServer('remote-changed', path.join(repoRoot, 'fixtures/playground/remote-changed.blueprint.json'), async (remoteChangedServer) => {
        return withPlaygroundServer('local-edited', path.join(repoRoot, 'fixtures/playground/local-edited.blueprint.json'), async (localServer) => {
        const proof = spawnBoundedSync(
          process.execPath,
          ['scripts/playground/production-shaped-live-release-verify.mjs'],
          {
            cwd: repoRoot,
            timeout: liveWrapperSubprocessTimeoutMs,
            killSignal: 'SIGKILL',
            env: {
              ...process.env,
              REPRINT_PUSH_SOURCE_URL: remoteServer.baseUrl,
              REPRINT_PUSH_REMOTE_URL: remoteServer.baseUrl,
              REPRINT_PUSH_APPLY_REVALIDATION_SOURCE_URL: applyRemoteServer.baseUrl,
              REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedServer.baseUrl,
              REPRINT_PUSH_LOCAL_URL: localServer.baseUrl,
              REPRINT_PUSH_LAB_AUTH_ADMIN_USER: liveCredentials.username,
              REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: liveCredentials.password,
              NODE_NO_WARNINGS: '1',
            },
            encoding: 'utf8',
            maxBuffer: 1024 * 1024 * 20,
          },
          'explicit live release verify wrapper',
        );

        assertLiveReleaseVerifyProof(proof, 'explicit live release verify wrapper', liveWrapperSubprocessTimeoutMs);
        assert.equal(proof.status, 0, proof.stderr);
        const summary = JSON.parse(proof.stdout);

        assert.equal(summary.ok, true);
        assert.equal(summary.topology?.sourceUrl, remoteServer.baseUrl);
        assert.equal(summary.topology?.remoteBase, remoteServer.baseUrl);
        assert.equal(summary.topology?.remoteChanged, remoteChangedServer.baseUrl);
        assert.equal(summary.topology?.localEdited, localServer.baseUrl);
        assert.equal(summary.boundary?.firstRemainingProductionBoundary, null);
        assert.equal(summary.boundary?.verdict, 'LIVE_RELEASE_BOUNDARY_OK');
        assert.equal(summary.boundary?.authSession?.verdict, 'LIVE_RELEASE_BOUNDARY_OK');
        assert.equal(summary.boundary?.durableJournal?.verdict, 'LIVE_RELEASE_BOUNDARY_OK');
        assert.equal(summary.boundary?.replayAndRetry?.verdict, 'LIVE_RELEASE_BOUNDARY_OK');
        assert.equal(summary.releaseProof?.authSessionLifecycle?.minted?.type, 'production-auth-session');
        assert.equal(summary.releaseProof?.authSessionLifecycle?.minted?.status, 'active');
        assert.equal(summary.releaseProof?.authSessionLifecycle?.minted?.expired, false);
        assert.equal(summary.releaseProof?.authSessionLifecycle?.read?.type, 'production-auth-session');
        assert.equal(summary.releaseProof?.authSessionLifecycle?.read?.status, 'active');
        assert.equal(summary.releaseProof?.authSessionLifecycle?.read?.expired, false);
        assert.equal(summary.durableJournal?.checkedAccepted, true);
        assert.match(summary.durableJournal?.proof?.journal?.claim?.activeClaimId || '', /^[A-Za-z0-9_-]{16,160}$/);
        assert.equal(
          summary.durableJournal?.proof?.journal?.claim?.activeClaimId,
          summary.durableJournal?.proof?.journal?.claim?.activeClaimKeyHash,
        );
        assert.match(summary.durableJournal?.proof?.journal?.claim?.previousClaimId || '', /^[A-Za-z0-9_-]{16,160}$/);
        assert.equal(
          summary.durableJournal?.proof?.journal?.claim?.previousClaimId,
          summary.durableJournal?.proof?.journal?.claim?.previousClaimKeyHash,
        );
        assert.equal(
          summary.durableJournal?.proof?.journal?.writerLease?.claimId,
          summary.durableJournal?.proof?.journal?.claim?.activeClaimId,
        );
        assert.equal(
          summary.durableJournal?.proof?.journal?.leaseFence?.writerLease?.claimId,
          summary.durableJournal?.proof?.journal?.claim?.activeClaimId,
        );
        assert.equal(summary.applyRevalidation?.ok, true);
        assert.equal(summary.applyRevalidation?.boundary?.firstRemainingProductionBoundary, null);
        assert.equal(summary.applyRevalidation?.boundary?.verdict, 'LIVE_RELEASE_BOUNDARY_OK');
        });
      });
    });
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

maybeTest('production-shaped release verify command fails closed when preserved-remote retry proof is required but not observed', () => {
  return withPlaygroundServer('remote-base', path.join(repoRoot, 'fixtures/playground/remote-base.blueprint.json'), async (remoteServer) => {
    const proof = spawnProductionShapedReleaseVerify(
      {
        REPRINT_PUSH_SOURCE_URL: remoteServer.baseUrl,
        REPRINT_PUSH_REMOTE_URL: remoteServer.baseUrl,
        REPRINT_PUSH_LAB_AUTH_ADMIN_USER: liveCredentials.username,
        REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: liveCredentials.password,
        REPRINT_PUSH_SIMULATE_PRESERVED_REMOTE_RETRY_PATH: '/unmatched-read-path',
        NODE_NO_WARNINGS: '1',
      },
      boundedLiveReleaseVerifyOptions({ timeout: liveProofInnerTimeoutMs }),
      'preserved-remote retry release verify',
    );
    assertSpawnCompletedWithoutSpawnError(proof, 'preserved-remote retry release verify', liveProofInnerTimeoutMs);
    assert.equal(proof.status, 1, proof.stderr);
    assert.match(proof.stdout, /"ok": false/);
    assert.match(proof.stdout, /"code": "PRESERVED_REMOTE_RETRY_REQUIRED"/);
    assert.match(
      proof.stdout,
      /"boundary": \{\s*"firstRemainingProductionBoundary": "replay and preserved-remote retry on the checked release path",\s*"status": "unimplemented",\s*"verdict": "PRESERVED_REMOTE_RETRY_REQUIRED"/,
    );
    assert.match(
      proof.stdout,
      /"replayAndRetry": \{\s*"required": "\/unmatched-read-path",\s*"observed": "missing-transient-retry",\s*"retryAttempts": 1,\s*"verdict": "PRESERVED_REMOTE_RETRY_REQUIRED"\s*\}/,
    );
    assert.match(proof.stdout, /"releaseProof": \{\s*"ok": false,\s*"status": 1,\s*"code": "PRESERVED_REMOTE_RETRY_REQUIRED"/);
  });
});

test('production-shaped live release verify retries transient apply revalidation timeouts after the apply step starts', () => {
  assert.equal(
    applyRevalidationRetryable({
      status: 1,
      stdout: '',
      stderr: [
        'apply-revalidation: waiting for Playground at http://127.0.0.1:8080',
        'apply-revalidation: apply /apply',
        'TimeoutError: The operation was aborted due to timeout',
      ].join('\n'),
    }),
    true,
  );

  assert.equal(
    applyRevalidationRetryable({
      status: 1,
      stdout: '',
      stderr: 'TimeoutError: The operation was aborted due to timeout',
    }),
    false,
  );
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
  let consecutiveNotReadyResponses = 0;
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
        consecutiveNotReadyResponses = 0;
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
        if (isWordPressNotReadyResponse(snapshot.status, snapshotBody)) {
          consecutiveNotReadyResponses += 1;
        } else {
          consecutiveNotReadyResponses = 0;
        }
      } else {
        lastError = new Error(`Playground index readiness HTTP ${response.status}`);
        if (isWordPressNotReadyResponse(response.status, responseBody)) {
          consecutiveNotReadyResponses += 1;
        } else {
          consecutiveNotReadyResponses = 0;
        }
      }
      if (consecutiveNotReadyResponses >= livePlaygroundMaxConsecutiveNotReadyProbes) {
        break;
      }
    } catch (error) {
      lastError = error;
      consecutiveNotReadyResponses = 0;
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

function isWordPressNotReadyResponse(status, body = '') {
  return status === 502 && /WordPress is not ready yet/i.test(body);
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
