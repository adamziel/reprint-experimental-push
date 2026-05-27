import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
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
  labMaxConsecutiveNotReadyProbes,
  labReadinessBodyRetryable,
  labReadinessErrorRetryable,
  labNotReadyProbeLimitReached,
  labNextTimeoutProbeCount,
  labReadinessProbeTimedOut,
  labSnapshotReady,
  labSnapshotRetryable,
} from '../scripts/playground/lab-playground-readiness.js';
import {
  packagedProductionPluginClassifyBoundedStartup,
  packagedProductionPluginClassifyTimeoutFallbackStartup,
  packagedProductionPluginMalformedTerminalIndexProbe,
  packagedProductionPluginMaxConsecutiveNotReadyProbes,
  packagedProductionPluginNextNotReadyProbeCount,
  packagedProductionPluginNextRouteNotReadyProbeCounts,
  packagedProductionPluginNextTimeoutProbeCount,
  packagedProductionPluginNotReadyProbeLimitReached,
  packagedProductionPluginPackagedRouteStartupStillWithinBudget,
  packagedProductionPluginPackagedRouteStartupLimitReached,
  packagedProductionPluginPreflightTerminalContext,
  packagedProductionPluginPreflightTerminal,
  packagedProductionPluginReadinessBodyRetryable,
  packagedProductionPluginReadinessErrorRetryable,
  packagedProductionPluginReadinessProbeTimedOut,
  packagedProductionPluginReadinessWordPressNotReady,
  packagedProductionPluginPreflightReady,
  packagedProductionPluginPreflightRetryable,
  packagedProductionPluginRestIndexReady,
  packagedProductionPluginRestIndexRetryable,
  packagedProductionPluginResetRouteNotReadyProbeCounts,
  packagedProductionPluginRetryableRouteProbeWhileIndexProbeTimedOut,
  packagedProductionPluginRouteRetryableWhilePackagedRouteStarting,
  packagedProductionPluginRouteRetryableWhileWordPressStarting,
  packagedProductionPluginServerReady,
  packagedProductionPluginSnapshotProbeContext,
  packagedProductionPluginSnapshotReady,
  packagedProductionPluginSnapshotTerminal,
  packagedProductionPluginSnapshotRetryable,
  packagedProductionPluginTimedOutRouteProbeWhilePackagedRouteStarting,
  packagedProductionPluginTimedOutRouteProbeWhileWordPressStarting,
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
const serverStartupTimeoutMs = 120_000;
const playgroundServerTimeoutMs = 40;
const serverFetchTimeoutMs = 3_000;
const playgroundStopTimeoutMs = 3_000;
const readinessProbeIntervalMs = 500;
const readinessFailureBodyLimit = 240;
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
const maxNotReadyReadinessProbes = Math.max(labMaxConsecutiveNotReadyProbes, maxReadinessProbes);
const maxSnapshotStartupAfterGlobalReadyProbes = Math.max(
  labMaxConsecutiveNotReadyProbes,
  Math.ceil(15_000 / (serverFetchTimeoutMs + readinessProbeIntervalMs)),
);
const maxSnapshotTimeoutFallbackProbes = Math.max(
  labMaxConsecutiveNotReadyProbes,
  Math.ceil(15_000 / (serverFetchTimeoutMs + readinessProbeIntervalMs)),
);
const maxPackagedRouteStartupAfterGlobalReadyProbes = Math.max(
  packagedProductionPluginMaxConsecutiveNotReadyProbes,
  Math.ceil(15_000 / (serverFetchTimeoutMs + readinessProbeIntervalMs)),
);
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
const packagedReadinessHelperBoundary = 'async function fetchPackagedWordPressIndexProbe(';

function wrapNestedStartupValue(pathSegments, leafValue) {
  return pathSegments.reduceRight((nestedValue, key) => ({ [key]: nestedValue }), leafValue);
}

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

function buildPackagedReleaseVerifierWaitHelper(overrides = {}) {
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );
  const start = verifierSource.indexOf('async function waitForPackagedProductionPluginServer(child, baseUrl, getOutput) {');
  assert.notEqual(start, -1, 'expected packaged verifier readiness helper in verifier source');
  const end = verifierSource.indexOf(packagedReadinessHelperBoundary, start);
  assert.notEqual(end, -1, 'expected packaged verifier readiness helper boundary in verifier source');
  const helperSource = verifierSource.slice(start, end);

  const unexpectedAsyncDependency = async () => {
    throw new Error('unexpected packaged readiness helper dependency call during early-exit runtime proof');
  };
  const unexpectedSyncDependency = () => {
    throw new Error('unexpected packaged readiness helper dependency call during early-exit runtime proof');
  };
  const compileHelper = new Function(
    'packagedServerStartupTimeoutMs',
    'packagedServerFetchTimeoutMs',
    'packagedProductionPluginNextRouteNotReadyProbeCounts',
    'packagedProductionPluginResetRouteNotReadyProbeCounts',
    'packagedProductionPluginReadinessBodyRetryable',
    'packagedProductionPluginPreflightTerminalContext',
    'packagedProductionPluginRouteStartupClassificationReady',
    'fetchPackagedWordPressIndexProbe',
    'buildPackagedTimeoutFallbackProbe',
    'packagedProductionPluginClassifyBoundedStartup',
    'packagedProductionPluginGlobalStartupStillWithinBudget',
    'sleepUnlessChildExit',
    'throwPlaygroundReadinessFailure',
    'packagedProductionPluginPackagedRouteStartupLimitReached',
    'packagedProductionPluginPackagedRouteStartupStillWithinBudget',
    'packagedProductionPluginMalformedTerminalIndexProbe',
    'packagedProductionPluginServerReady',
    'packagedProductionPluginSnapshotRetryable',
    'packagedProductionPluginSnapshotProbeContext',
    'packagedProductionPluginPreflightReady',
    'packagedProductionPluginPreflightRetryable',
    'fetchPackagedPreflightProbe',
    'packagedProductionPluginReadinessErrorRetryable',
    'packagedProductionPluginReadinessProbeTimedOut',
    'fetchPackagedTimeoutFallbackProbes',
    'packagedProductionPluginClassifyTimeoutFallbackStartup',
    'packagedProductionPluginNotReadyProbeLimitReached',
    'packagedProductionPluginNextTimeoutProbeCount',
    'packagedProductionPluginMaxConsecutiveNotReadyProbes',
    'readinessProbeIntervalMs',
    'maxPackagedRouteStartupAfterGlobalReadyProbes',
    'maxPackagedStartupNotReadyProbeCount',
    'activePlaygroundChildren',
    'formatPlaygroundStartupFailure',
    'writePlaygroundFailure',
    'stopSpawnedServer',
    'fetchTextWithTimeout',
    'authHeaders',
    'signedHeadersForProductionPreflight',
    'readinessFailureBodyLimit',
    `${helperSource}\nreturn waitForPackagedProductionPluginServer;`,
  );

  return compileHelper(
    overrides.packagedServerStartupTimeoutMs ?? 1_000,
    overrides.packagedServerFetchTimeoutMs ?? 100,
    packagedProductionPluginNextRouteNotReadyProbeCounts,
    packagedProductionPluginResetRouteNotReadyProbeCounts,
    packagedProductionPluginReadinessBodyRetryable,
    packagedProductionPluginPreflightTerminalContext,
    overrides.packagedProductionPluginRouteStartupClassificationReady ?? unexpectedSyncDependency,
    overrides.fetchPackagedWordPressIndexProbe ?? unexpectedAsyncDependency,
    overrides.buildPackagedTimeoutFallbackProbe ?? unexpectedSyncDependency,
    packagedProductionPluginClassifyBoundedStartup,
    overrides.packagedProductionPluginGlobalStartupStillWithinBudget ?? unexpectedSyncDependency,
    overrides.sleepUnlessChildExit ?? unexpectedAsyncDependency,
    overrides.throwPlaygroundReadinessFailure ?? unexpectedAsyncDependency,
    packagedProductionPluginPackagedRouteStartupLimitReached,
    packagedProductionPluginPackagedRouteStartupStillWithinBudget,
    packagedProductionPluginMalformedTerminalIndexProbe,
    packagedProductionPluginServerReady,
    packagedProductionPluginSnapshotRetryable,
    packagedProductionPluginSnapshotProbeContext,
    packagedProductionPluginPreflightReady,
    packagedProductionPluginPreflightRetryable,
    overrides.fetchPackagedPreflightProbe ?? unexpectedAsyncDependency,
    packagedProductionPluginReadinessErrorRetryable,
    packagedProductionPluginReadinessProbeTimedOut,
    overrides.fetchPackagedTimeoutFallbackProbes ?? unexpectedAsyncDependency,
    overrides.packagedProductionPluginClassifyTimeoutFallbackStartup ?? packagedProductionPluginClassifyTimeoutFallbackStartup,
    overrides.packagedProductionPluginNotReadyProbeLimitReached ?? packagedProductionPluginNotReadyProbeLimitReached,
    overrides.packagedProductionPluginNextTimeoutProbeCount ?? packagedProductionPluginNextTimeoutProbeCount,
    packagedProductionPluginMaxConsecutiveNotReadyProbes,
    1,
    packagedProductionPluginMaxConsecutiveNotReadyProbes,
    packagedProductionPluginMaxConsecutiveNotReadyProbes,
    new Set(),
    overrides.formatPlaygroundStartupFailure ?? formatPlaygroundStartupFailure,
    overrides.writePlaygroundFailure ?? writePlaygroundFailure,
    overrides.stopSpawnedServer ?? unexpectedAsyncDependency,
    overrides.fetchTextWithTimeout ?? unexpectedAsyncDependency,
    overrides.authHeaders ?? (() => ({})),
    overrides.signedHeadersForProductionPreflight ?? (() => ({})),
    500,
  );
}

function buildPackagedSmokeWaitHelper(overrides = {}) {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );
  const start = smokeSource.indexOf('async function waitForServer(child, baseUrl, logs) {');
  assert.notEqual(start, -1, 'expected packaged smoke readiness helper in smoke source');
  const end = smokeSource.indexOf(packagedReadinessHelperBoundary, start);
  assert.notEqual(end, -1, 'expected packaged smoke readiness helper boundary in smoke source');
  const helperSource = smokeSource.slice(start, end);

  const unexpectedAsyncDependency = async () => {
    throw new Error('unexpected packaged smoke readiness helper dependency call during runtime proof');
  };
  const unexpectedSyncDependency = () => {
    throw new Error('unexpected packaged smoke readiness helper dependency call during runtime proof');
  };
  const fallbackFormatPackagedReadinessFailure = (
    prefix,
    lastError,
    lastProbes,
    logs,
    context = null,
    lastTimeoutFallbackProbes = null,
  ) => {
    const lines = [prefix];
    if (lastError?.message) {
      lines.push(`Last readiness error: ${lastError.message}`);
    }
    if (lastProbes?.length) {
      const lastProbe = lastProbes.at(-1);
      lines.push(`Last readiness probe route: ${lastProbe.route}`);
      lines.push(`Last readiness probe status: ${lastProbe.status}`);
      lines.push(`Last readiness probe body: ${JSON.stringify(lastProbe.body, null, 2)}`);
    }
    if (lastTimeoutFallbackProbes?.preflightProbe) {
      lines.push(`Last timeout fallback preflight route: ${lastTimeoutFallbackProbes.preflightProbe.route}`);
    }
    if (lastTimeoutFallbackProbes?.indexProbe) {
      lines.push(`Last timeout fallback index route: ${lastTimeoutFallbackProbes.indexProbe.route}`);
    }
    if (context && typeof context === 'object' && Object.keys(context).length > 0) {
      lines.push(`Readiness context: ${JSON.stringify(context, null, 2)}`);
    }
    if (Array.isArray(logs) && logs.length > 0) {
      lines.push(logs.join(''));
    }
    return lines.join('\n');
  };
  const compileHelper = new Function(
    'serverStartupTimeoutMs',
    'readinessProbeFetchTimeoutMs',
    'packagedProductionPluginNextRouteNotReadyProbeCounts',
    'packagedProductionPluginResetRouteNotReadyProbeCounts',
    'packagedProductionPluginReadinessBodyRetryable',
    'packagedProductionPluginPreflightTerminalContext',
    'packagedProductionPluginRouteStartupClassificationReady',
    'fetchPackagedWordPressIndexProbe',
    'buildPackagedTimeoutFallbackProbe',
    'packagedProductionPluginClassifyBoundedStartup',
    'packagedProductionPluginGlobalStartupStillWithinBudget',
    'sleepUnlessChildExit',
    'formatPackagedReadinessFailure',
    'packagedProductionPluginPackagedRouteStartupLimitReached',
    'packagedProductionPluginPackagedRouteStartupStillWithinBudget',
    'packagedProductionPluginMalformedTerminalIndexProbe',
    'packagedProductionPluginServerReady',
    'packagedProductionPluginSnapshotRetryable',
    'packagedProductionPluginSnapshotProbeContext',
    'packagedProductionPluginPreflightReady',
    'packagedProductionPluginPreflightRetryable',
    'fetchPackagedPreflightProbe',
    'packagedProductionPluginReadinessErrorRetryable',
    'packagedProductionPluginReadinessProbeTimedOut',
    'fetchPackagedTimeoutFallbackProbes',
    'packagedProductionPluginClassifyTimeoutFallbackStartup',
    'packagedProductionPluginNotReadyProbeLimitReached',
    'packagedProductionPluginNextTimeoutProbeCount',
    'packagedProductionPluginMaxConsecutiveNotReadyProbes',
    'readinessProbeIntervalMs',
    'maxPackagedRouteStartupAfterGlobalReadyProbes',
    'maxPackagedStartupNotReadyProbeCount',
    'fetchTextWithTimeout',
    'authHeaders',
    'signedHeadersForPreflight',
    'writeStageProgress',
    'readinessFailureBodyLimit',
    `${helperSource}\nreturn waitForServer;`,
  );

  return compileHelper(
    1_000,
    100,
    packagedProductionPluginNextRouteNotReadyProbeCounts,
    packagedProductionPluginResetRouteNotReadyProbeCounts,
    packagedProductionPluginReadinessBodyRetryable,
    packagedProductionPluginPreflightTerminalContext,
    overrides.packagedProductionPluginRouteStartupClassificationReady ?? unexpectedSyncDependency,
    overrides.fetchPackagedWordPressIndexProbe ?? unexpectedAsyncDependency,
    overrides.buildPackagedTimeoutFallbackProbe ?? unexpectedSyncDependency,
    packagedProductionPluginClassifyBoundedStartup,
    overrides.packagedProductionPluginGlobalStartupStillWithinBudget ?? unexpectedSyncDependency,
    overrides.sleepUnlessChildExit ?? unexpectedAsyncDependency,
    overrides.formatPackagedReadinessFailure ?? fallbackFormatPackagedReadinessFailure,
    packagedProductionPluginPackagedRouteStartupLimitReached,
    packagedProductionPluginPackagedRouteStartupStillWithinBudget,
    packagedProductionPluginMalformedTerminalIndexProbe,
    packagedProductionPluginServerReady,
    packagedProductionPluginSnapshotRetryable,
    packagedProductionPluginSnapshotProbeContext,
    packagedProductionPluginPreflightReady,
    packagedProductionPluginPreflightRetryable,
    overrides.fetchPackagedPreflightProbe ?? unexpectedAsyncDependency,
    packagedProductionPluginReadinessErrorRetryable,
    packagedProductionPluginReadinessProbeTimedOut,
    overrides.fetchPackagedTimeoutFallbackProbes ?? unexpectedAsyncDependency,
    overrides.packagedProductionPluginClassifyTimeoutFallbackStartup ?? packagedProductionPluginClassifyTimeoutFallbackStartup,
    overrides.packagedProductionPluginNotReadyProbeLimitReached ?? packagedProductionPluginNotReadyProbeLimitReached,
    overrides.packagedProductionPluginNextTimeoutProbeCount ?? packagedProductionPluginNextTimeoutProbeCount,
    packagedProductionPluginMaxConsecutiveNotReadyProbes,
    1,
    packagedProductionPluginMaxConsecutiveNotReadyProbes,
    packagedProductionPluginMaxConsecutiveNotReadyProbes,
    overrides.fetchTextWithTimeout ?? unexpectedAsyncDependency,
    overrides.authHeaders ?? (() => ({})),
    overrides.signedHeadersForPreflight ?? (() => ({})),
    overrides.writeStageProgress ?? (() => {}),
    500,
  );
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

test('production plugin package smoke synthesizes a packaged source command before the runtime server URL is known', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );

  assert.match(
    smokeSource,
    /sourceUrl:\s*resolvedCredentials\.liveSourceUrl\s*\|\|\s*'http:\/\/127\.0\.0\.1:8080'/,
  );
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
    smokeSource.includes('$past = 1;'),
    'expected packaged smoke blueprint to use a fixed expired timestamp for cleanup seeds',
  );
  assert.ok(
    smokeSource.includes('$future = 2147483647;'),
    'expected packaged smoke blueprint to use a fixed future timestamp for retained signed artifacts',
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

test('production plugin package smoke signs packaged journal inspect requests with the preflight session', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );

  assert.match(
    smokeSource,
    /signedHeadersForRequest\('GET',\s*'\/wp-json\/reprint\/v1\/push\/db-journal\?limit=1',\s*\{\s*session:\s*preflight\.body\.session\.id,\s*idempotencyKey:\s*'production-plugin-package-journal-inspect',/,
  );
  assert.match(
    smokeSource,
    /headers\['X-Reprint-Push-Session'\] = session;/,
  );
  assert.match(
    smokeSource,
    /headers\['X-Reprint-Push-Idempotency-Key'\] = idempotencyKey;/,
  );
});

test('production plugin package smoke derives unique signed probe nonces inside one process', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );

  assert.match(
    smokeSource,
    /let signedRequestNonceSequence = 0;/,
  );
  assert.match(
    smokeSource,
    /const nonce = createSignedRequestNonce\(auth\.username\);/,
  );
  assert.match(
    smokeSource,
    /function createSignedRequestNonce\(username\) \{\s*signedRequestNonceSequence \+= 1;\s*return `production-plugin-package-\$\{username\}-\$\{process\.pid\}-\$\{Date\.now\(\)\}-\$\{signedRequestNonceSequence\}`;\s*\}/s,
  );
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
          id: 'session_123',
          type: 'production-auth-session',
          status: 'active',
          expiresAt: '2099-01-01T00:00:00Z',
        },
      },
      session: {
        id: 'session_123',
        type: 'production-auth-session',
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
    }),
    true,
  );
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
    packagedProductionPluginPreflightRetryable(
      {
        status: 401,
        body: {
          code: 'reprint_push_lab_auth_required',
          message: 'Authenticated push routes require WordPress Application Password basic auth.',
        },
      },
      {
        packagedStartup: true,
      },
    ),
    true,
  );
  assert.equal(
    packagedProductionPluginPreflightRetryable(
      {
        status: 401,
        body: {
          code: 'reprint_push_lab_auth_required',
          message: 'Authenticated push routes require WordPress Application Password basic auth.',
        },
      },
      {
        indexProbe: {
          status: 503,
          body: 'WordPress is not ready yet',
        },
      },
    ),
    true,
  );
  assert.equal(
    packagedProductionPluginPreflightRetryable(
      {
        status: 401,
        body: {
          code: 'reprint_push_lab_auth_required',
          message: 'Authenticated push routes require WordPress Application Password basic auth.',
        },
      },
      {
        snapshotProbe: {
          status: 502,
          body: 'WordPress is not ready yet',
        },
      },
    ),
    true,
  );
  assert.equal(
    packagedProductionPluginPreflightRetryable(
      {
        status: 401,
        body: {
          code: 'reprint_push_lab_auth_required',
          message: 'Authenticated push routes require WordPress Application Password basic auth.',
        },
      },
      {
        indexProbe: {
          status: 404,
          body: 'Notice: startup wrapper\n{"details":{"error_code":"rest_no_route"}}',
        },
      },
    ),
    true,
  );
  assert.equal(
    packagedProductionPluginPreflightRetryable(
      {
        status: 401,
        body: {
          code: 'reprint_push_lab_auth_required',
          message: 'Authenticated push routes require WordPress Application Password basic auth.',
        },
      },
      {
        snapshotProbe: {
          status: 404,
          body: 'Notice: startup wrapper\n{"details":{"error_code":"rest_no_route"}}',
        },
      },
    ),
    true,
  );
  assert.equal(
    packagedProductionPluginPreflightRetryable(
      {
        status: 401,
        body: {
          code: 'reprint_push_lab_auth_required',
          message: 'Authenticated push routes require WordPress Application Password basic auth.',
        },
      },
      {
        indexProbe: {
          status: 500,
          body: 'Internal Server Error',
        },
      },
    ),
    false,
  );
  assert.equal(
    packagedProductionPluginPreflightRetryable(
      {
        status: 401,
        body: {
          code: 'reprint_push_lab_auth_required',
          message: 'Authenticated push routes require WordPress Application Password basic auth.',
        },
      },
      {
        snapshotProbe: {
          status: 500,
          body: 'Internal Server Error',
        },
      },
    ),
    false,
  );
  assert.equal(
    packagedProductionPluginPreflightTerminal(
      {
        status: 401,
        body: {
          code: 'reprint_push_lab_auth_required',
          message: 'Authenticated push routes require WordPress Application Password basic auth.',
        },
      },
      {
        indexProbe: {
          status: 500,
          body: 'Internal Server Error',
        },
      },
    ),
    true,
  );
  assert.equal(
    packagedProductionPluginPreflightTerminal(
      {
        status: 401,
        body: {
          code: 'reprint_push_lab_auth_required',
          message: 'Authenticated push routes require WordPress Application Password basic auth.',
        },
      },
      {
        snapshotProbe: {
          status: 500,
          body: 'Internal Server Error',
        },
      },
    ),
    true,
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
    packagedProductionPluginSnapshotRetryable({
      status: 500,
      body: {
        error: {
          code: 'wordpress_not_ready',
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
          code: 'rest_no_route',
        },
      },
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginSnapshotRetryable({
      status: 500,
      body: {
        payload: {
          issue: {
            errorCode: 'wordpress_not_ready',
          },
        },
      },
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginPreflightRetryable({
      status: 503,
      body: {
        payload: {
          issue: {
            error_code: 'rest_no_route',
          },
        },
      },
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginSnapshotRetryable({
      status: 500,
      body: {
        warning: {
          response: {
            payload: {
              issue: {
                details: {
                  errorCode: 'wordpress_not_ready',
                },
              },
            },
          },
        },
      },
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginSnapshotRetryable({
      status: 500,
      body: {
        warning: {
          response: {
            payload: {
              issue: {
                details: {
                  nested: {
                    errorCode: 'wordpress_not_ready',
                  },
                },
              },
            },
          },
        },
      },
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginSnapshotRetryable({
      status: 500,
      body: wrapNestedStartupValue(
        [
          'level01',
          'level02',
          'level03',
          'level04',
          'level05',
          'level06',
          'level07',
          'level08',
          'level09',
          'level10',
          'level11',
          'level12',
        ],
        { errorCode: 'wordpress_not_ready' },
      ),
    }),
    true,
  );
  const packagedCyclicStartupBody = {
    warning: null,
  };
  packagedCyclicStartupBody.warning = packagedCyclicStartupBody;
  packagedCyclicStartupBody.payload = {
    issue: {
      details: {
        error_description: 'No route was found matching the URL and request method.',
      },
    },
  };
  assert.equal(
    packagedProductionPluginPreflightRetryable({
      status: 503,
      body: packagedCyclicStartupBody,
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginPreflightRetryable({
      status: 503,
      body: {
        warning: {
          response: {
            payload: {
              issue: {
                details: {
                  error_description: 'No route was found matching the URL and request method.',
                },
              },
            },
          },
        },
      },
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginPreflightRetryable({
      status: 503,
      body: {
        warning: {
          response: {
            payload: {
              issue: {
                details: {
                  nested: {
                    error_description: 'No route was found matching the URL and request method.',
                  },
                },
              },
            },
          },
        },
      },
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginSnapshotRetryable({
      status: 500,
      body: {
        errors: [
          {
            detail: {
              text: 'WordPress is not ready yet',
            },
          },
        ],
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
    packagedProductionPluginPreflightRetryable({
      status: 503,
      body: {
        response: {
          payload: {
            errors: [
              'No route was found matching the URL and request method.',
            ],
          },
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
    packagedProductionPluginPreflightReady({
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
            cleanedUp: true,
          },
        },
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
            cleanedUp: true,
          },
        },
      },
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginPreflightReady({
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
            expiresAt: '2000-01-01T00:00:00Z',
          },
        },
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
          profile: 'production-shaped',
          restNamespace: 'reprint/v1',
          routePrefix: '/push',
          labBacked: false,
        },
        auth: {
          session: {
            type: 'production-auth-session',
            status: 'active',
            expiresAt: '2000-01-01T00:00:00Z',
          },
        },
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
          labBacked: false,
        },
        auth: {},
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
          profile: 'production-shaped',
          restNamespace: 'reprint/v1',
          routePrefix: '/push',
          labBacked: false,
        },
        auth: {},
      },
    }),
    true,
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
    packagedProductionPluginPreflightTerminal(
      {
        status: 401,
        body: {
          code: 'reprint_push_lab_auth_required',
        },
      },
      {
        packagedStartup: true,
      },
    ),
    false,
  );
  assert.equal(
    packagedProductionPluginPreflightTerminal(
      {
        status: 401,
        body: {
          code: 'reprint_push_lab_auth_required',
          message: 'Authenticated push routes require WordPress Application Password basic auth.',
        },
      },
      {
        indexProbe: {
          status: 503,
          body: 'WordPress is not ready yet',
        },
      },
    ),
    false,
  );
  assert.equal(
    packagedProductionPluginPreflightTerminal(
      {
        status: 401,
        body: {
          code: 'reprint_push_lab_auth_required',
          message: 'Authenticated push routes require WordPress Application Password basic auth.',
        },
      },
      {
        snapshotProbe: {
          status: 404,
          body: 'Notice: startup wrapper\n{"details":{"error_code":"rest_no_route"}}',
        },
      },
    ),
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

test('packaged production plugin timeout fallback classification separates startup branches', () => {
  assert.deepEqual(
    packagedProductionPluginClassifyTimeoutFallbackStartup(
      { retryable: true, status: 503, body: 'WordPress is not ready yet' },
      { status: 503, body: 'WordPress is not ready yet' },
    ),
    {
      kind: 'retryable-route-wordpress-starting',
      globalWordPressStartup: true,
    },
  );
  assert.deepEqual(
    packagedProductionPluginClassifyTimeoutFallbackStartup(
      { retryable: true, status: 404, body: 'No route was found matching the URL and request method.' },
      { status: 200, body: '{"namespaces":["reprint/v1"]}' },
    ),
    {
      kind: 'retryable-route-packaged-route-starting',
      packagedRouteStartup: true,
    },
  );
  assert.deepEqual(
    packagedProductionPluginClassifyTimeoutFallbackStartup(
      { retryable: true, status: 404, body: 'No route was found matching the URL and request method.' },
      { status: 200, body: '<!doctype html><html><body>not a REST index</body></html>', parsedBody: null },
    ),
    {
      kind: 'retryable-route-index-terminal',
      indexTerminal: true,
    },
  );
  assert.deepEqual(
    packagedProductionPluginClassifyTimeoutFallbackStartup(
      { retryable: true, status: 404, body: 'No route was found matching the URL and request method.' },
      { timedOut: true },
    ),
    {
      kind: 'retryable-route-index-timeout',
      indexProbeTimedOut: true,
    },
  );
  assert.equal(
    packagedProductionPluginRetryableRouteProbeWhileIndexProbeTimedOut(
      { retryable: true, status: 404, body: 'No route was found matching the URL and request method.' },
      { timedOut: true },
    ),
    true,
  );
  assert.equal(
    packagedProductionPluginRetryableRouteProbeWhileIndexProbeTimedOut(
      { retryable: true, status: 404, body: 'No route was found matching the URL and request method.' },
      { status: 200, body: '{"namespaces":["reprint/v1"]}' },
    ),
    false,
  );
  assert.equal(
    packagedProductionPluginRetryableRouteProbeWhileIndexProbeTimedOut(
      { retryable: false, status: 404, body: 'No route was found matching the URL and request method.' },
      { timedOut: true },
    ),
    false,
  );
  assert.deepEqual(
    packagedProductionPluginClassifyTimeoutFallbackStartup(
      { timedOut: true },
      { timedOut: true },
    ),
    {
      kind: 'timed-out-route-index-timeout',
      indexProbeTimedOut: true,
    },
  );
  assert.deepEqual(
    packagedProductionPluginClassifyTimeoutFallbackStartup(
      { timedOut: true },
      { status: 503, body: 'WordPress is not ready yet' },
    ),
    {
      kind: 'timed-out-route-wordpress-starting',
      globalWordPressStartup: true,
    },
  );
  assert.deepEqual(
    packagedProductionPluginClassifyTimeoutFallbackStartup(
      { timedOut: true },
      { status: 200, body: '{"namespaces":["reprint/v1"]}' },
    ),
    {
      kind: 'timed-out-route-packaged-route-starting',
      packagedRouteStartup: true,
    },
  );
  assert.deepEqual(
    packagedProductionPluginClassifyTimeoutFallbackStartup(
      { timedOut: true },
      { status: 200, body: '<!doctype html><html><body>not a REST index</body></html>', parsedBody: null },
    ),
    {
      kind: 'timed-out-route-index-terminal',
      indexTerminal: true,
    },
  );
  assert.equal(
    packagedProductionPluginClassifyTimeoutFallbackStartup(
      { terminal: true, status: 500, body: 'fatal' },
      { status: 500, body: 'fatal' },
    ),
    null,
  );
});

test('packaged readiness helper fails closed on malformed 200 index startup bodies', () => {
  const retryableRouteProbe = {
    retryable: true,
    status: 404,
    body: 'No route was found matching the URL and request method.',
  };

  assert.deepEqual(
    packagedProductionPluginClassifyBoundedStartup(
      retryableRouteProbe,
      {
        status: 200,
        body: '"WordPress is not ready yet"',
        parsedBody: 'WordPress is not ready yet',
      },
    ),
    {
      kind: 'retryable-route-index-terminal',
      indexTerminal: true,
    },
  );
  assert.equal(
    packagedProductionPluginMalformedTerminalIndexProbe({
      status: 200,
      body: '"WordPress is not ready yet"',
      parsedBody: 'WordPress is not ready yet',
    }),
    true,
  );

  assert.deepEqual(
    packagedProductionPluginClassifyTimeoutFallbackStartup(
      retryableRouteProbe,
      {
        status: 200,
        body: '{"message":"WordPress is not ready yet"}',
        parsedBody: {
          message: 'WordPress is not ready yet',
        },
      },
    ),
    {
      kind: 'retryable-route-index-terminal',
      indexTerminal: true,
    },
  );
  assert.equal(
    packagedProductionPluginMalformedTerminalIndexProbe({
      status: 200,
      body: '{"message":"WordPress is not ready yet"}',
      parsedBody: {
        message: 'WordPress is not ready yet',
      },
    }),
    true,
  );

  assert.equal(
    packagedProductionPluginReadinessBodyRetryable(
      200,
      '{"message":"WordPress is not ready yet"}',
    ),
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
    false,
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
      502,
      'Warning: startup wrapper\n{"error":{"code":"wordpress_not_ready"}}',
    ),
    true,
  );
  assert.equal(
    packagedProductionPluginReadinessBodyRetryable(
      404,
      'Notice: startup wrapper\n{"details":{"error_code":"rest_no_route"}}',
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
    packagedProductionPluginReadinessWordPressNotReady(
      200,
      '<!doctype html><html><body>WordPress is not ready yet</body></html>',
    ),
    true,
  );
  assert.equal(
    packagedProductionPluginReadinessWordPressNotReady(
      502,
      '{"message":"WordPress is not ready yet"}',
    ),
    true,
  );
  assert.equal(
    packagedProductionPluginReadinessWordPressNotReady(
      503,
      'wordpress is NOT ready yet',
    ),
    true,
  );
  assert.equal(
    packagedProductionPluginReadinessWordPressNotReady(
      404,
      '<!doctype html><html><body>No route was found matching the URL and request method.</body></html>',
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
    0,
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
  assert.equal(
    packagedProductionPluginPackagedRouteStartupLimitReached(
      packagedProductionPluginMaxConsecutiveNotReadyProbes - 1,
    ),
    false,
  );
  assert.equal(
    packagedProductionPluginPackagedRouteStartupLimitReached(
      packagedProductionPluginMaxConsecutiveNotReadyProbes,
    ),
    true,
  );
  assert.equal(
    packagedProductionPluginPackagedRouteStartupStillWithinBudget(
      packagedProductionPluginMaxConsecutiveNotReadyProbes - 1,
    ),
    true,
  );
  assert.equal(
    packagedProductionPluginPackagedRouteStartupStillWithinBudget(
      packagedProductionPluginMaxConsecutiveNotReadyProbes,
    ),
    false,
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
  routeProbeCounts = packagedProductionPluginNextRouteNotReadyProbeCounts(
    routeProbeCounts,
    'unknown-route',
    502,
    '<!doctype html><html><body>WordPress is not ready yet</body></html>',
  );
  assert.deepEqual(routeProbeCounts, { snapshot: 0, preflight: 1 });
  routeProbeCounts = packagedProductionPluginResetRouteNotReadyProbeCounts(
    routeProbeCounts,
    'preflight',
  );
  assert.deepEqual(routeProbeCounts, { snapshot: 0, preflight: 0 });
  assert.deepEqual(
    packagedProductionPluginResetRouteNotReadyProbeCounts(
      { snapshot: 2, preflight: 3 },
      'snapshot',
      'unknown-route',
      'preflight',
    ),
    { snapshot: 0, preflight: 0 },
  );
  assert.equal(packagedProductionPluginReadinessErrorRetryable(new Error('transient fetch failure')), true);
  assert.equal(
    packagedProductionPluginReadinessErrorRetryable({
      isPlaygroundReadinessFailure: true,
    }),
    false,
  );
  assert.equal(
    packagedProductionPluginReadinessProbeTimedOut(
      new Error('Timed out fetching http://127.0.0.1:9400/wp-json/reprint/v1/push/snapshot'),
    ),
    true,
  );
  assert.equal(
    packagedProductionPluginReadinessProbeTimedOut(new Error('transient fetch failure')),
    false,
  );
  assert.equal(
    packagedProductionPluginNextTimeoutProbeCount(
      0,
      new Error('Timed out fetching http://127.0.0.1:9400/wp-json/reprint/v1/push/snapshot'),
    ),
    1,
  );
  assert.equal(
    packagedProductionPluginNextTimeoutProbeCount(
      packagedProductionPluginMaxConsecutiveNotReadyProbes - 1,
      new Error('Timed out fetching http://127.0.0.1:9400/wp-json/'),
    ),
    packagedProductionPluginMaxConsecutiveNotReadyProbes,
  );
  assert.equal(
    packagedProductionPluginNextTimeoutProbeCount(
      3,
      new Error('socket hang up'),
    ),
    0,
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
    false,
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
    packagedProductionPluginRouteRetryableWhilePackagedRouteStarting(
      502,
      '<!doctype html><html><body>WordPress is not ready yet</body></html>',
      200,
      '{\"namespaces\":[\"reprint/v1\"]}',
    ),
    true,
  );
  assert.equal(
    packagedProductionPluginRouteRetryableWhilePackagedRouteStarting(
      404,
      '<!doctype html><html><body>No route was found matching the URL and request method.</body></html>',
      200,
      '{\"namespaces\":[\"reprint/v1\"]}',
    ),
    true,
  );
  assert.equal(
    packagedProductionPluginRouteRetryableWhilePackagedRouteStarting(
      404,
      '<!doctype html><html><body>No route was found matching the URL and request method.</body></html>',
      200,
      '<!doctype html><html><body>not a REST index</body></html>',
    ),
    false,
  );
  assert.equal(
    packagedProductionPluginRouteRetryableWhilePackagedRouteStarting(
      502,
      '<!doctype html><html><body>WordPress is not ready yet</body></html>',
      502,
      '<!doctype html><html><body>WordPress is not ready yet</body></html>',
    ),
    false,
  );
  assert.equal(
    packagedProductionPluginRouteRetryableWhilePackagedRouteStarting(
      401,
      '<!doctype html><html><body>unauthorized packaged route</body></html>',
      200,
      '{\"namespaces\":[\"reprint/v1\"]}',
    ),
    false,
  );
  assert.equal(
    packagedProductionPluginRouteRetryableWhilePackagedRouteStarting(
      502,
      '<!doctype html><html><body>WordPress is not ready yet</body></html>',
      401,
      '<!doctype html><html><body>unauthorized index probe</body></html>',
    ),
    false,
  );
  assert.equal(
    packagedProductionPluginRouteRetryableWhilePackagedRouteStarting(
      404,
      '<!doctype html><html><body>No route was found matching the URL and request method.</body></html>',
      500,
      '<!doctype html><html><body>fatal index bootstrap mismatch</body></html>',
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
  assert.equal(
    packagedProductionPluginTimedOutRouteProbeWhileWordPressStarting(
      { timedOut: true },
      502,
      '<!doctype html><html><body>WordPress is not ready yet</body></html>',
    ),
    true,
  );
  assert.equal(
    packagedProductionPluginTimedOutRouteProbeWhileWordPressStarting(
      { timedOut: true },
      404,
      '<!doctype html><html><body>No route was found matching the URL and request method.</body></html>',
    ),
    true,
  );
  assert.equal(
    packagedProductionPluginTimedOutRouteProbeWhileWordPressStarting(
      { timedOut: false },
      502,
      '<!doctype html><html><body>WordPress is not ready yet</body></html>',
    ),
    false,
  );
  assert.equal(
    packagedProductionPluginTimedOutRouteProbeWhilePackagedRouteStarting(
      { timedOut: true },
      200,
      '{"namespaces":["reprint/v1"]}',
    ),
    true,
  );
  assert.equal(
    packagedProductionPluginTimedOutRouteProbeWhilePackagedRouteStarting(
      { timedOut: true },
      200,
      '<!doctype html><html><body>not a REST index</body></html>',
    ),
    false,
  );
  assert.equal(
    packagedProductionPluginTimedOutRouteProbeWhilePackagedRouteStarting(
      { timedOut: true },
      502,
      '<!doctype html><html><body>WordPress is not ready yet</body></html>',
    ),
    false,
  );
  assert.equal(
    packagedProductionPluginTimedOutRouteProbeWhilePackagedRouteStarting(
      { timedOut: false },
      200,
      '{"namespaces":["reprint/v1"]}',
    ),
    false,
  );
});

test('packaged release verifier readiness helper uses the provided output collector in wedged packaged-route failures', () => {
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );
  const start = verifierSource.indexOf('async function waitForPackagedProductionPluginServer(');
  assert.notEqual(start, -1, 'expected packaged readiness helper in release verifier source');
  const end = verifierSource.indexOf(packagedReadinessHelperBoundary, start);
  assert.notEqual(end, -1, 'expected packaged readiness helper boundary in release verifier source');
  const helperSource = verifierSource.slice(start, end);

  assert.match(helperSource, /getOutput\(\)/);
  assert.doesNotMatch(helperSource, /getLogs\(\)/);
});

test('packaged release verifier readiness helper fails fast on signaled child termination', () => {
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );
  const start = verifierSource.indexOf('async function waitForPackagedProductionPluginServer(child, baseUrl, getOutput) {');
  assert.notEqual(start, -1, 'expected packaged verifier readiness helper in verifier source');
  const end = verifierSource.indexOf(packagedReadinessHelperBoundary, start);
  assert.notEqual(end, -1, 'expected packaged verifier readiness helper boundary in verifier source');
  const helperSource = verifierSource.slice(start, end);

  assert.match(helperSource, /child\.exitCode !== null \|\| child\.signalCode !== null/);
  assert.match(helperSource, /terminated by \$\{child\.signalCode\}/);
  assert.match(helperSource, /writePlaygroundFailure\(message, lastProbes, getOutput\(\), lastError, lastTimeoutFallbackProbes\);/);
});

test('packaged release verifier readiness helper reports early child exit codes', () => {
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );
  const start = verifierSource.indexOf('async function waitForPackagedProductionPluginServer(child, baseUrl, getOutput) {');
  assert.notEqual(start, -1, 'expected packaged verifier readiness helper in verifier source');
  const end = verifierSource.indexOf(packagedReadinessHelperBoundary, start);
  assert.notEqual(end, -1, 'expected packaged verifier readiness helper boundary in verifier source');
  const helperSource = verifierSource.slice(start, end);

  assert.match(helperSource, /child\.exitCode !== null \?\s*`exited early with \$\{child\.exitCode\}`\s*:\s*`terminated by \$\{child\.signalCode\}`/);
  assert.match(helperSource, /Packaged production plugin server \$\{exitLabel\}/);
  assert.match(helperSource, /writePlaygroundFailure\(message, lastProbes, getOutput\(\), lastError, lastTimeoutFallbackProbes\);/);
});

test('packaged release verifier readiness helper fails closed when the Playground child exits before packaged probing completes', async () => {
  let stoppedChild = null;
  const helper = buildPackagedReleaseVerifierWaitHelper({
    stopSpawnedServer: async (child) => {
      stoppedChild = child;
    },
  });
  const child = {
    exitCode: 23,
    signalCode: null,
    pid: 7123,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', () => 'packaged server boot log'),
    (error) => {
      assert.match(error.message, /Packaged production plugin server exited early with 23/);
      assert.match(error.message, /packaged server boot log/);
      return true;
    },
  );

  assert.equal(stoppedChild, child);
});

test('packaged release verifier readiness helper fails closed when the Playground child is signaled before packaged probing completes', async () => {
  let stoppedChild = null;
  const helper = buildPackagedReleaseVerifierWaitHelper({
    stopSpawnedServer: async (child) => {
      stoppedChild = child;
    },
  });
  const child = {
    exitCode: null,
    signalCode: 'SIGTERM',
    pid: 9451,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', () => 'packaged server boot log'),
    (error) => {
      assert.match(error.message, /Packaged production plugin server terminated by SIGTERM/);
      assert.match(error.message, /packaged server boot log/);
      return true;
    },
  );

  assert.equal(stoppedChild, child);
});

test('packaged release verifier readiness helper preserves timeout fallback probes when the snapshot probe times out and /wp-json/ becomes terminal', async () => {
  const timeoutError = new Error('Timed out fetching http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot after 100ms');
  timeoutError.name = 'TimeoutError';
  const timeoutFallbackProbes = {
    preflightProbe: {
      route: '/wp-json/reprint/v1/push/preflight',
      status: 404,
      ok: false,
      body: '{"code":"rest_no_route","message":"No route was found matching the URL and request method."}',
      parsedBody: {
        code: 'rest_no_route',
        message: 'No route was found matching the URL and request method.',
      },
      ready: false,
      retryable: true,
      terminal: false,
    },
    indexProbe: {
      route: '/wp-json/',
      status: 401,
      ok: false,
      body: '{"code":"rest_forbidden","message":"forbidden"}',
      parsedBody: {
        code: 'rest_forbidden',
        message: 'forbidden',
      },
      ready: false,
      retryable: false,
      terminal: true,
    },
  };
  const captured = {
    prefix: null,
    logs: null,
    context: null,
    lastError: null,
    lastProbes: null,
    lastTimeoutFallbackProbes: null,
  };
  const helper = buildPackagedReleaseVerifierWaitHelper({
    fetchTextWithTimeout: async () => {
      throw timeoutError;
    },
    fetchPackagedTimeoutFallbackProbes: async () => timeoutFallbackProbes,
    packagedProductionPluginClassifyTimeoutFallbackStartup: () => ({
      kind: 'retryable-route-index-terminal',
    }),
    throwPlaygroundReadinessFailure: async (child, prefix, lastError, lastProbes, logs, context, lastTimeoutFallbackProbes) => {
      captured.prefix = prefix;
      captured.logs = logs;
      captured.context = context;
      captured.lastError = lastError;
      captured.lastProbes = lastProbes;
      captured.lastTimeoutFallbackProbes = lastTimeoutFallbackProbes;
      const error = new Error(prefix);
      error.isPlaygroundReadinessFailure = true;
      throw error;
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9452,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', () => 'packaged server boot log'),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight stayed startup-shaped while \/wp-json\/ returned a terminal readiness failure HTTP 401 after the snapshot probe timed out/,
      );
      return true;
    },
  );

  assert.equal(captured.prefix, 'Packaged production plugin signed preflight stayed startup-shaped while /wp-json/ returned a terminal readiness failure HTTP 401 after the snapshot probe timed out at http://127.0.0.1:65535');
  assert.equal(captured.logs, 'packaged server boot log');
  assert.equal(captured.lastError, timeoutError);
  assert.deepEqual(captured.lastTimeoutFallbackProbes, timeoutFallbackProbes);
  assert.deepEqual(captured.lastProbes, [timeoutFallbackProbes.preflightProbe]);
  assert.deepEqual(captured.context, {
    childPid: 9452,
    packagedProductionPlugin: true,
    indexTerminal: true,
    preflightTerminal: true,
    timeoutFallback: true,
  });
});

test('packaged release verifier readiness helper waits through global-startup timeout fallback when signed preflight stays startup-shaped', async () => {
  const timeoutError = new Error('Timed out fetching http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot after 100ms');
  timeoutError.name = 'TimeoutError';
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const readyPreflightBody = JSON.stringify({
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
  });
  const timeoutFallbackProbes = {
    preflightProbe: {
      route: '/wp-json/reprint/v1/push/preflight',
      status: 404,
      ok: false,
      body: '{"code":"rest_no_route","message":"No route was found matching the URL and request method."}',
      parsedBody: {
        code: 'rest_no_route',
        message: 'No route was found matching the URL and request method.',
      },
      ready: false,
      retryable: true,
      terminal: false,
    },
    indexProbe: {
      route: '/wp-json/',
      status: 503,
      ok: false,
      body: 'WordPress is not ready yet',
      parsedBody: null,
      ready: false,
      retryable: true,
      terminal: false,
    },
  };
  const fetchCalls = [];
  const sleepCalls = [];
  let snapshotAttempts = 0;
  const helper = buildPackagedReleaseVerifierWaitHelper({
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        snapshotAttempts += 1;
        if (snapshotAttempts === 1) {
          throw timeoutError;
        }
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readyPreflightBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedTimeoutFallbackProbes: async () => timeoutFallbackProbes,
    sleepUnlessChildExit: async (ms, child) => {
      sleepCalls.push({ ms, child });
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9455,
  };

  await helper(child, 'http://127.0.0.1:65535', () => 'packaged server boot log');

  assert.equal(sleepCalls.length, 1);
  assert.equal(sleepCalls[0].ms, 1);
  assert.equal(sleepCalls[0].child, child);
  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged release verifier readiness helper waits through packaged-route startup timeout fallback when signed preflight stays startup-shaped', async () => {
  const timeoutError = new Error('Timed out fetching http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot after 100ms');
  timeoutError.name = 'TimeoutError';
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const readyPreflightBody = JSON.stringify({
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
  });
  const timeoutFallbackProbes = {
    preflightProbe: {
      route: '/wp-json/reprint/v1/push/preflight',
      status: 404,
      ok: false,
      body: '{"code":"rest_no_route","message":"No route was found matching the URL and request method."}',
      parsedBody: {
        code: 'rest_no_route',
        message: 'No route was found matching the URL and request method.',
      },
      ready: false,
      retryable: true,
      terminal: false,
    },
    indexProbe: {
      route: '/wp-json/',
      status: 200,
      ok: true,
      body: '{"namespaces":["reprint/v1"],"routes":{"/reprint/v1/push/snapshot":{}}}',
      parsedBody: {
        namespaces: ['reprint/v1'],
        routes: {
          '/reprint/v1/push/snapshot': {},
        },
      },
      ready: true,
      retryable: false,
      terminal: false,
    },
  };
  const fetchCalls = [];
  const sleepCalls = [];
  let snapshotAttempts = 0;
  const helper = buildPackagedReleaseVerifierWaitHelper({
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        snapshotAttempts += 1;
        if (snapshotAttempts === 1) {
          throw timeoutError;
        }
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readyPreflightBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedTimeoutFallbackProbes: async () => timeoutFallbackProbes,
    sleepUnlessChildExit: async (ms, child) => {
      sleepCalls.push({ ms, child });
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9459,
  };

  await helper(child, 'http://127.0.0.1:65535', () => 'packaged server boot log');

  assert.equal(sleepCalls.length, 1);
  assert.equal(sleepCalls[0].ms, 1);
  assert.equal(sleepCalls[0].child, child);
  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged release verifier readiness helper preserves index-timeout fallback probes when signed preflight stays startup-shaped', async () => {
  const timeoutError = new Error('Timed out fetching http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot after 100ms');
  timeoutError.name = 'TimeoutError';
  const timeoutFallbackProbes = {
    preflightProbe: {
      route: '/wp-json/reprint/v1/push/preflight',
      status: 404,
      ok: false,
      body: '{"code":"rest_no_route","message":"No route was found matching the URL and request method."}',
      parsedBody: {
        code: 'rest_no_route',
        message: 'No route was found matching the URL and request method.',
      },
      ready: false,
      retryable: true,
      terminal: false,
    },
    indexProbe: {
      route: '/wp-json/',
      status: 0,
      ok: false,
      body: 'Timed out fetching http://127.0.0.1:65535/wp-json/ after 100ms',
      ready: false,
      retryable: false,
      terminal: false,
      timedOut: true,
    },
  };
  const captured = {
    prefix: null,
    logs: null,
    context: null,
    lastError: null,
    lastProbes: null,
    lastTimeoutFallbackProbes: null,
  };
  const helper = buildPackagedReleaseVerifierWaitHelper({
    fetchTextWithTimeout: async () => {
      throw timeoutError;
    },
    fetchPackagedTimeoutFallbackProbes: async () => timeoutFallbackProbes,
    packagedProductionPluginClassifyTimeoutFallbackStartup: () => ({
      kind: 'retryable-route-index-timeout',
    }),
    throwPlaygroundReadinessFailure: async (child, prefix, lastError, lastProbes, logs, context, lastTimeoutFallbackProbes) => {
      captured.prefix = prefix;
      captured.logs = logs;
      captured.context = context;
      captured.lastError = lastError;
      captured.lastProbes = lastProbes;
      captured.lastTimeoutFallbackProbes = lastTimeoutFallbackProbes;
      throw new Error(prefix);
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9456,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', () => 'packaged server boot log'),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight stayed startup-shaped while \/wp-json\/ timed out after the snapshot probe timed out/,
      );
      return true;
    },
  );

  assert.equal(captured.prefix, 'Packaged production plugin signed preflight stayed startup-shaped while /wp-json/ timed out after the snapshot probe timed out at http://127.0.0.1:65535');
  assert.equal(captured.logs, 'packaged server boot log');
  assert.equal(captured.lastError, timeoutError);
  assert.deepEqual(captured.lastTimeoutFallbackProbes, timeoutFallbackProbes);
  assert.deepEqual(captured.lastProbes, [timeoutFallbackProbes.preflightProbe]);
  assert.deepEqual(captured.context, {
    childPid: 9456,
    packagedProductionPlugin: true,
    indexProbeTimedOut: true,
  });
});

test('packaged release verifier readiness helper preserves timeout fallback probes when signed preflight and /wp-json/ both time out', async () => {
  const timeoutError = new Error('Timed out fetching http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot after 100ms');
  timeoutError.name = 'TimeoutError';
  const timeoutFallbackProbes = {
    preflightProbe: {
      route: '/wp-json/reprint/v1/push/preflight',
      status: 0,
      ok: false,
      body: 'Timed out fetching http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight after 100ms',
      ready: false,
      retryable: false,
      terminal: false,
      timedOut: true,
    },
    indexProbe: {
      route: '/wp-json/',
      status: 0,
      ok: false,
      body: 'Timed out fetching http://127.0.0.1:65535/wp-json/ after 100ms',
      ready: false,
      retryable: false,
      terminal: false,
      timedOut: true,
    },
  };
  const captured = {
    prefix: null,
    logs: null,
    context: null,
    lastError: null,
    lastProbes: null,
    lastTimeoutFallbackProbes: null,
  };
  const helper = buildPackagedReleaseVerifierWaitHelper({
    fetchTextWithTimeout: async () => {
      throw timeoutError;
    },
    fetchPackagedTimeoutFallbackProbes: async () => timeoutFallbackProbes,
    packagedProductionPluginClassifyTimeoutFallbackStartup: () => ({
      kind: 'timed-out-route-index-timeout',
    }),
    throwPlaygroundReadinessFailure: async (child, prefix, lastError, lastProbes, logs, context, lastTimeoutFallbackProbes) => {
      captured.prefix = prefix;
      captured.logs = logs;
      captured.context = context;
      captured.lastError = lastError;
      captured.lastProbes = lastProbes;
      captured.lastTimeoutFallbackProbes = lastTimeoutFallbackProbes;
      throw new Error(prefix);
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9453,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', () => 'packaged server boot log'),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight probe timed out while \/wp-json\/ also timed out after the snapshot probe timed out/,
      );
      return true;
    },
  );

  assert.equal(captured.prefix, 'Packaged production plugin signed preflight probe timed out while /wp-json/ also timed out after the snapshot probe timed out at http://127.0.0.1:65535');
  assert.equal(captured.logs, 'packaged server boot log');
  assert.equal(captured.lastError, timeoutError);
  assert.deepEqual(captured.lastTimeoutFallbackProbes, timeoutFallbackProbes);
  assert.deepEqual(captured.lastProbes, [timeoutFallbackProbes.preflightProbe]);
  assert.deepEqual(captured.context, {
    childPid: 9453,
    packagedProductionPlugin: true,
    indexProbeTimedOut: true,
  });
});

test('packaged release verifier readiness helper preserves invalid timeout fallback probes when signed preflight times out and /wp-json/ returns an invalid body', async () => {
  const timeoutError = new Error('Timed out fetching http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot after 100ms');
  timeoutError.name = 'TimeoutError';
  const timeoutFallbackProbes = {
    preflightProbe: {
      route: '/wp-json/reprint/v1/push/preflight',
      status: 0,
      ok: false,
      body: 'Timed out fetching http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight after 100ms',
      ready: false,
      retryable: false,
      terminal: false,
      timedOut: true,
    },
    indexProbe: {
      route: '/wp-json/',
      status: 200,
      ok: true,
      body: '<!doctype html><html><body>not a REST index</body></html>',
      parsedBody: null,
      ready: false,
      retryable: false,
      terminal: true,
    },
  };
  const captured = {
    prefix: null,
    logs: null,
    context: null,
    lastError: null,
    lastProbes: null,
    lastTimeoutFallbackProbes: null,
  };
  const helper = buildPackagedReleaseVerifierWaitHelper({
    fetchTextWithTimeout: async () => {
      throw timeoutError;
    },
    fetchPackagedTimeoutFallbackProbes: async () => timeoutFallbackProbes,
    packagedProductionPluginClassifyTimeoutFallbackStartup: () => ({
      kind: 'timed-out-route-index-terminal',
    }),
    throwPlaygroundReadinessFailure: async (child, prefix, lastError, lastProbes, logs, context, lastTimeoutFallbackProbes) => {
      captured.prefix = prefix;
      captured.logs = logs;
      captured.context = context;
      captured.lastError = lastError;
      captured.lastProbes = lastProbes;
      captured.lastTimeoutFallbackProbes = lastTimeoutFallbackProbes;
      throw new Error(prefix);
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9454,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', () => 'packaged server boot log'),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight probe timed out while \/wp-json\/ returned an invalid readiness body after the snapshot probe timed out/,
      );
      return true;
    },
  );

  assert.equal(captured.prefix, 'Packaged production plugin signed preflight probe timed out while /wp-json/ returned an invalid readiness body after the snapshot probe timed out at http://127.0.0.1:65535');
  assert.equal(captured.logs, 'packaged server boot log');
  assert.equal(captured.lastError, timeoutError);
  assert.deepEqual(captured.lastTimeoutFallbackProbes, timeoutFallbackProbes);
  assert.deepEqual(captured.lastProbes, [timeoutFallbackProbes.preflightProbe]);
  assert.deepEqual(captured.context, {
    childPid: 9454,
    packagedProductionPlugin: true,
    invalidReadinessBody: true,
    indexTerminal: true,
    preflightTerminal: true,
    timeoutFallback: true,
  });
});

test('packaged release verifier readiness helper fails closed when signed preflight returns an invalid readiness body after the snapshot probe times out', async () => {
  const timeoutError = new Error('Timed out fetching http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot');
  const captured = {
    prefix: null,
    logs: null,
    context: null,
    lastError: null,
    lastProbes: null,
    lastTimeoutFallbackProbes: null,
  };
  const helper = buildPackagedReleaseVerifierWaitHelper({
    packagedProductionPluginClassifyTimeoutFallbackStartup: () => {
      throw new Error('unexpected timeout fallback startup classification during invalid signed-preflight runtime proof');
    },
    sleepUnlessChildExit: async () => {
      throw new Error('unexpected readiness sleep during timeout invalid signed-preflight runtime proof');
    },
    fetchTextWithTimeout: async (url) => {
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        throw timeoutError;
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedTimeoutFallbackProbes: async () => ({
      preflightProbe: {
        route: '/wp-json/reprint/v1/push/preflight',
        status: 200,
        ok: true,
        body: JSON.stringify({
          ok: true,
          routeProfile: {
            profile: 'production-shaped',
            restNamespace: 'reprint/v1',
            routePrefix: '/push',
            labBacked: false,
          },
        }),
        parsedBody: null,
        ready: false,
        retryable: false,
        terminal: true,
      },
      indexProbe: null,
    }),
    throwPlaygroundReadinessFailure: async (child, prefix, lastError, lastProbes, logs, context, lastTimeoutFallbackProbes) => {
      captured.prefix = prefix;
      captured.logs = logs;
      captured.context = context;
      captured.lastError = lastError;
      captured.lastProbes = lastProbes;
      captured.lastTimeoutFallbackProbes = lastTimeoutFallbackProbes;
      throw new Error(prefix);
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 94545,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', () => 'packaged server boot log'),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight returned an invalid readiness body while the snapshot probe timed out at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );

  assert.equal(captured.prefix, 'Packaged production plugin signed preflight returned an invalid readiness body while the snapshot probe timed out at http://127.0.0.1:65535');
  assert.equal(captured.logs, 'packaged server boot log');
  assert.equal(captured.lastError, timeoutError);
  assert.equal(captured.context?.invalidReadinessBody, true);
  assert.equal(captured.context?.timeoutFallback, true);
  assert.deepEqual(captured.lastTimeoutFallbackProbes, {
    preflightProbe: {
      route: '/wp-json/reprint/v1/push/preflight',
      status: 200,
      ok: true,
      body: JSON.stringify({
        ok: true,
        routeProfile: {
          profile: 'production-shaped',
          restNamespace: 'reprint/v1',
          routePrefix: '/push',
          labBacked: false,
        },
      }),
      parsedBody: null,
      ready: false,
      retryable: false,
      terminal: true,
    },
    indexProbe: null,
  });
  assert.deepEqual(captured.lastProbes, [captured.lastTimeoutFallbackProbes.preflightProbe]);
  assert.deepEqual(captured.context, {
    childPid: 94545,
    invalidReadinessBody: true,
    packagedProductionPlugin: true,
    preflightTerminal: true,
    timeoutFallback: true,
  });
});

test('packaged release verifier readiness helper fails closed when signed preflight returns a terminal response after the snapshot probe times out', async () => {
  const timeoutError = new Error('Timed out fetching http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot');
  const captured = {
    prefix: null,
    logs: null,
    context: null,
    lastError: null,
    lastProbes: null,
    lastTimeoutFallbackProbes: null,
  };
  const helper = buildPackagedReleaseVerifierWaitHelper({
    packagedProductionPluginClassifyTimeoutFallbackStartup: () => {
      throw new Error('unexpected timeout fallback startup classification during terminal signed-preflight runtime proof');
    },
    sleepUnlessChildExit: async () => {
      throw new Error('unexpected readiness sleep during timeout terminal signed-preflight runtime proof');
    },
    fetchTextWithTimeout: async (url) => {
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        throw timeoutError;
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedTimeoutFallbackProbes: async () => ({
      preflightProbe: {
        route: '/wp-json/reprint/v1/push/preflight',
        status: 401,
        ok: false,
        body: JSON.stringify({
          code: 'reprint_push_lab_auth_required',
          message: 'auth required',
        }),
        parsedBody: {
          code: 'reprint_push_lab_auth_required',
          message: 'auth required',
        },
        ready: false,
        retryable: false,
        terminal: true,
      },
      indexProbe: null,
    }),
    throwPlaygroundReadinessFailure: async (child, prefix, lastError, lastProbes, logs, context, lastTimeoutFallbackProbes) => {
      captured.prefix = prefix;
      captured.logs = logs;
      captured.context = context;
      captured.lastError = lastError;
      captured.lastProbes = lastProbes;
      captured.lastTimeoutFallbackProbes = lastTimeoutFallbackProbes;
      throw new Error(prefix);
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 94546,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', () => 'packaged server boot log'),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight became terminal while the snapshot probe timed out at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );

  assert.equal(captured.prefix, 'Packaged production plugin signed preflight became terminal while the snapshot probe timed out at http://127.0.0.1:65535');
  assert.equal(captured.logs, 'packaged server boot log');
  assert.equal(captured.lastError, timeoutError);
  assert.deepEqual(captured.lastTimeoutFallbackProbes, {
    preflightProbe: {
      route: '/wp-json/reprint/v1/push/preflight',
      status: 401,
      ok: false,
      body: JSON.stringify({
        code: 'reprint_push_lab_auth_required',
        message: 'auth required',
      }),
      parsedBody: {
        code: 'reprint_push_lab_auth_required',
        message: 'auth required',
      },
      ready: false,
      retryable: false,
      terminal: true,
    },
    indexProbe: null,
  });
  assert.deepEqual(captured.lastProbes, [captured.lastTimeoutFallbackProbes.preflightProbe]);
  assert.deepEqual(captured.context, {
    childPid: 94546,
    packagedProductionPlugin: true,
    preflightTerminal: true,
    timeoutFallback: true,
  });
});

test('packaged release verifier readiness helper preserves terminal timeout fallback probes when signed preflight times out and /wp-json/ returns a terminal body', async () => {
  const timeoutError = new Error('Timed out fetching http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot after 100ms');
  timeoutError.name = 'TimeoutError';
  const timeoutFallbackProbes = {
    preflightProbe: {
      route: '/wp-json/reprint/v1/push/preflight',
      status: 0,
      ok: false,
      body: 'Timed out fetching http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight after 100ms',
      ready: false,
      retryable: false,
      terminal: false,
      timedOut: true,
    },
    indexProbe: {
      route: '/wp-json/',
      status: 401,
      ok: false,
      body: '{"code":"rest_forbidden","message":"forbidden"}',
      parsedBody: {
        code: 'rest_forbidden',
        message: 'forbidden',
      },
      ready: false,
      retryable: false,
      terminal: true,
    },
  };
  const captured = {
    prefix: null,
    logs: null,
    context: null,
    lastError: null,
    lastProbes: null,
    lastTimeoutFallbackProbes: null,
  };
  const helper = buildPackagedReleaseVerifierWaitHelper({
    fetchTextWithTimeout: async () => {
      throw timeoutError;
    },
    fetchPackagedTimeoutFallbackProbes: async () => timeoutFallbackProbes,
    packagedProductionPluginClassifyTimeoutFallbackStartup: () => ({
      kind: 'timed-out-route-index-terminal',
    }),
    throwPlaygroundReadinessFailure: async (child, prefix, lastError, lastProbes, logs, context, lastTimeoutFallbackProbes) => {
      captured.prefix = prefix;
      captured.logs = logs;
      captured.context = context;
      captured.lastError = lastError;
      captured.lastProbes = lastProbes;
      captured.lastTimeoutFallbackProbes = lastTimeoutFallbackProbes;
      throw new Error(prefix);
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9455,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', () => 'packaged server boot log'),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight probe timed out while \/wp-json\/ returned a terminal readiness failure HTTP 401 after the snapshot probe timed out/,
      );
      return true;
    },
  );

  assert.equal(captured.prefix, 'Packaged production plugin signed preflight probe timed out while /wp-json/ returned a terminal readiness failure HTTP 401 after the snapshot probe timed out at http://127.0.0.1:65535');
  assert.equal(captured.logs, 'packaged server boot log');
  assert.equal(captured.lastError, timeoutError);
  assert.deepEqual(captured.lastTimeoutFallbackProbes, timeoutFallbackProbes);
  assert.deepEqual(captured.lastProbes, [timeoutFallbackProbes.preflightProbe]);
  assert.deepEqual(captured.context, {
    childPid: 9455,
    packagedProductionPlugin: true,
    indexTerminal: true,
    preflightTerminal: true,
    timeoutFallback: true,
  });
});

test('packaged release verifier readiness helper waits through packaged-route startup after global WordPress readiness', async () => {
  const snapshotStartupBody = JSON.stringify({
    code: 'rest_no_route',
    message: 'No route was found matching the URL and request method.',
  });
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const readyPreflightBody = JSON.stringify({
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
  });
  const fetchCalls = [];
  const sleepCalls = [];
  const helper = buildPackagedReleaseVerifierWaitHelper({
    packagedProductionPluginRouteStartupClassificationReady: () => true,
    packagedProductionPluginGlobalStartupStillWithinBudget: () => false,
    buildPackagedTimeoutFallbackProbe: () => {
      throw new Error('unexpected timeout fallback probe during packaged-route startup budget runtime proof');
    },
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        if (fetchCalls.filter((entry) => entry.endsWith('/wp-json/reprint/v1/push/snapshot')).length === 1) {
          return {
            response: {
              status: 404,
              ok: false,
            },
            bodyText: snapshotStartupBody,
          };
        }
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readyPreflightBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => ({
      route: '/wp-json/reprint/v1/push/preflight',
      status: 404,
      ok: false,
      body: snapshotStartupBody,
      parsedBody: {
        code: 'rest_no_route',
        message: 'No route was found matching the URL and request method.',
      },
      ready: false,
      retryable: true,
      terminal: false,
    }),
    fetchPackagedWordPressIndexProbe: async () => ({
      route: '/wp-json/',
      status: 200,
      ok: true,
      body: JSON.stringify({ namespaces: ['reprint/v1'] }),
      parsedBody: {
        namespaces: ['reprint/v1'],
      },
      ready: true,
      retryable: false,
      terminal: false,
    }),
    fetchPackagedTimeoutFallbackProbes: async () => {
      throw new Error('unexpected timeout fallback fetch in packaged-route startup runtime proof');
    },
    sleepUnlessChildExit: async (ms, child) => {
      sleepCalls.push({ ms, child });
    },
    throwPlaygroundReadinessFailure: async (child, prefix) => {
      const error = new Error(prefix);
      error.isPlaygroundReadinessFailure = true;
      throw error;
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9455,
  };

  await helper(child, 'http://127.0.0.1:65535', () => 'packaged server boot log');

  assert.equal(sleepCalls.length, 1);
  assert.equal(sleepCalls[0].ms, 1);
  assert.equal(sleepCalls[0].child, child);
  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged release verifier readiness helper keeps waiting through packaged-route startup after terminal signed preflight while snapshot startup is still in progress', async () => {
  const snapshotStartupBody = JSON.stringify({
    code: 'rest_no_route',
    message: 'No route was found matching the URL and request method.',
  });
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const readyPreflightBody = JSON.stringify({
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
  });
  const fetchCalls = [];
  const sleepCalls = [];
  let snapshotAttempts = 0;
  let preflightFallbackAttempts = 0;
  const helper = buildPackagedReleaseVerifierWaitHelper({
    packagedProductionPluginRouteStartupClassificationReady: () => true,
    packagedProductionPluginGlobalStartupStillWithinBudget: () => false,
    buildPackagedTimeoutFallbackProbe: () => {
      throw new Error('unexpected timeout fallback probe during terminal packaged-route startup runtime proof');
    },
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        snapshotAttempts += 1;
        if (snapshotAttempts === 1) {
          return {
            response: {
              status: 404,
              ok: false,
            },
            bodyText: snapshotStartupBody,
          };
        }
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readyPreflightBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => {
      preflightFallbackAttempts += 1;
      if (preflightFallbackAttempts !== 1) {
        throw new Error('unexpected extra snapshot-startup fallback preflight probe');
      }
      return {
        route: '/wp-json/reprint/v1/push/preflight',
        status: 401,
        ok: false,
        body: JSON.stringify({
          code: 'rest_forbidden',
          message: 'forbidden',
        }),
        parsedBody: {
          code: 'rest_forbidden',
          message: 'forbidden',
        },
        ready: false,
        retryable: false,
        terminal: true,
      };
    },
    fetchPackagedWordPressIndexProbe: async () => ({
      route: '/wp-json/',
      status: 200,
      ok: true,
      body: JSON.stringify({ namespaces: ['reprint/v1'] }),
      parsedBody: {
        namespaces: ['reprint/v1'],
      },
      ready: true,
      retryable: false,
      terminal: false,
    }),
    fetchPackagedTimeoutFallbackProbes: async () => {
      throw new Error('unexpected timeout fallback fetch in terminal packaged-route startup runtime proof');
    },
    sleepUnlessChildExit: async (ms, child) => {
      sleepCalls.push({ ms, child });
    },
    throwPlaygroundReadinessFailure: async (child, prefix) => {
      const error = new Error(prefix);
      error.isPlaygroundReadinessFailure = true;
      throw error;
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9456,
  };

  await helper(child, 'http://127.0.0.1:65535', () => 'packaged server boot log');

  assert.equal(sleepCalls.length, 1);
  assert.equal(sleepCalls[0].ms, 1);
  assert.equal(sleepCalls[0].child, child);
  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged release verifier readiness helper fails closed when terminal signed preflight keeps the packaged route in startup past the post-global-ready budget', async () => {
  const snapshotStartupBody = JSON.stringify({
    code: 'rest_no_route',
    message: 'No route was found matching the URL and request method.',
  });
  const helper = buildPackagedReleaseVerifierWaitHelper({
    packagedProductionPluginRouteStartupClassificationReady: () => true,
    packagedProductionPluginGlobalStartupStillWithinBudget: () => false,
    buildPackagedTimeoutFallbackProbe: () => {
      throw new Error('unexpected timeout fallback probe during terminal packaged-route startup limit runtime proof');
    },
    fetchTextWithTimeout: async (url) => {
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 404,
            ok: false,
          },
          bodyText: snapshotStartupBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => ({
      route: '/wp-json/reprint/v1/push/preflight',
      status: 401,
      ok: false,
      body: JSON.stringify({
        code: 'rest_forbidden',
        message: 'forbidden',
      }),
      parsedBody: {
        code: 'rest_forbidden',
        message: 'forbidden',
      },
      ready: false,
      retryable: false,
      terminal: true,
    }),
    fetchPackagedWordPressIndexProbe: async () => ({
      route: '/wp-json/',
      status: 200,
      ok: true,
      body: JSON.stringify({ namespaces: ['reprint/v1'] }),
      parsedBody: {
        namespaces: ['reprint/v1'],
      },
      ready: true,
      retryable: false,
      terminal: false,
    }),
    fetchPackagedTimeoutFallbackProbes: async () => {
      throw new Error('unexpected timeout fallback fetch in terminal packaged-route startup limit runtime proof');
    },
    sleepUnlessChildExit: async (ms, child) => {
      sleepCalls.push({ ms, child });
    },
    throwPlaygroundReadinessFailure: async (child, prefix) => {
      const error = new Error(prefix);
      error.isPlaygroundReadinessFailure = true;
      throw error;
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9463,
  };
  const sleepCalls = [];

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', () => 'packaged server boot log'),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin snapshot stayed startup-shaped after global WordPress startup HTTP 200 for 4 consecutive responses \(limit 4\)/,
      );
      return true;
    },
  );

  assert.equal(sleepCalls.length, 3);
  assert.deepEqual(
    sleepCalls.map(({ ms, child: sleptChild }) => ({ ms, child: sleptChild })),
    [
      { ms: 1, child },
      { ms: 1, child },
      { ms: 1, child },
    ],
  );
});

test('packaged release verifier readiness helper fails closed when packaged-route startup exceeds the post-global-ready budget', async () => {
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const startupPreflightBody = JSON.stringify({
    code: 'rest_no_route',
    message: 'No route was found matching the URL and request method.',
  });
  const fetchCalls = [];
  const sleepCalls = [];
  const helper = buildPackagedReleaseVerifierWaitHelper({
    packagedProductionPluginRouteStartupClassificationReady: () => true,
    packagedProductionPluginGlobalStartupStillWithinBudget: () => false,
    buildPackagedTimeoutFallbackProbe: () => {
      throw new Error('unexpected timeout fallback probe during packaged-route startup limit runtime proof');
    },
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 404,
            ok: false,
          },
          bodyText: startupPreflightBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => {
      throw new Error('unexpected snapshot-startup fallback preflight probe');
    },
    fetchPackagedWordPressIndexProbe: async () => ({
      route: '/wp-json/',
      status: 200,
      ok: true,
      body: JSON.stringify({ namespaces: ['reprint/v1'] }),
      parsedBody: {
        namespaces: ['reprint/v1'],
      },
      ready: true,
      retryable: false,
      terminal: false,
    }),
    fetchPackagedTimeoutFallbackProbes: async () => {
      throw new Error('unexpected timeout fallback fetch in packaged-route startup limit runtime proof');
    },
    sleepUnlessChildExit: async (ms, child) => {
      sleepCalls.push({ ms, child });
    },
    throwPlaygroundReadinessFailure: async (child, prefix) => {
      const error = new Error(prefix);
      error.isPlaygroundReadinessFailure = true;
      throw error;
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9463,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', () => 'packaged server boot log'),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight stayed startup-shaped after global WordPress startup HTTP 200 for 4 consecutive responses \(limit 4\)/,
      );
      return true;
    },
  );

  assert.equal(sleepCalls.length, 3);
  assert.deepEqual(
    sleepCalls.map(({ ms, child: sleptChild }) => ({ ms, child: sleptChild })),
    [
      { ms: 1, child },
      { ms: 1, child },
      { ms: 1, child },
    ],
  );
  assert.equal(fetchCalls.length, 8);
});

test('packaged release verifier readiness helper waits through global WordPress startup before the packaged route is ready', async () => {
  const snapshotStartupBody = JSON.stringify({
    code: 'rest_no_route',
    message: 'No route was found matching the URL and request method.',
  });
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const readyPreflightBody = JSON.stringify({
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
  });
  const fetchCalls = [];
  const sleepCalls = [];
  const helper = buildPackagedReleaseVerifierWaitHelper({
    packagedProductionPluginRouteStartupClassificationReady: () => true,
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        if (fetchCalls.filter((entry) => entry.endsWith('/wp-json/reprint/v1/push/snapshot')).length === 1) {
          return {
            response: {
              status: 404,
              ok: false,
            },
            bodyText: snapshotStartupBody,
          };
        }
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readyPreflightBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => ({
      route: '/wp-json/reprint/v1/push/preflight',
      status: 404,
      ok: false,
      body: snapshotStartupBody,
      parsedBody: {
        code: 'rest_no_route',
        message: 'No route was found matching the URL and request method.',
      },
      ready: false,
      retryable: true,
      terminal: false,
    }),
    fetchPackagedWordPressIndexProbe: async () => ({
      route: '/wp-json/',
      status: 503,
      ok: false,
      body: 'WordPress is not ready yet',
      parsedBody: null,
      ready: false,
      retryable: true,
      terminal: false,
    }),
    fetchPackagedTimeoutFallbackProbes: async () => {
      throw new Error('unexpected timeout fallback fetch in packaged global-startup runtime proof');
    },
    sleepUnlessChildExit: async (ms, child) => {
      sleepCalls.push({ ms, child });
    },
    throwPlaygroundReadinessFailure: async (child, prefix) => {
      const error = new Error(prefix);
      error.isPlaygroundReadinessFailure = true;
      throw error;
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9455,
  };

  await helper(child, 'http://127.0.0.1:65535', () => 'packaged server boot log');

  assert.equal(sleepCalls.length, 1);
  assert.equal(sleepCalls[0].ms, 1);
  assert.equal(sleepCalls[0].child, child);
  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged release verifier readiness helper waits through global WordPress startup after snapshot timeouts', async () => {
  const timeoutError = new Error('Timed out fetching http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot');
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const readyPreflightBody = JSON.stringify({
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
  });
  const fetchCalls = [];
  const sleepCalls = [];
  let snapshotAttempts = 0;
  const helper = buildPackagedReleaseVerifierWaitHelper({
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        snapshotAttempts += 1;
        if (snapshotAttempts === 1) {
          throw timeoutError;
        }
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readyPreflightBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedTimeoutFallbackProbes: async () => ({
      preflightProbe: {
        route: '/wp-json/reprint/v1/push/preflight',
        status: 404,
        ok: false,
        body: JSON.stringify({
          code: 'rest_no_route',
          message: 'No route was found matching the URL and request method.',
        }),
        parsedBody: {
          code: 'rest_no_route',
          message: 'No route was found matching the URL and request method.',
        },
        ready: false,
        retryable: true,
        terminal: false,
      },
      indexProbe: {
        route: '/wp-json/',
        status: 503,
        ok: false,
        body: 'WordPress is not ready yet',
        parsedBody: null,
        ready: false,
        retryable: true,
        terminal: false,
      },
    }),
    sleepUnlessChildExit: async (ms, child) => {
      sleepCalls.push({ ms, child });
    },
    throwPlaygroundReadinessFailure: async (child, prefix) => {
      const error = new Error(prefix);
      error.isPlaygroundReadinessFailure = true;
      throw error;
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9457,
  };

  await helper(child, 'http://127.0.0.1:65535', () => 'packaged server boot log');

  assert.equal(sleepCalls.length, 1);
  assert.equal(sleepCalls[0].ms, 1);
  assert.equal(sleepCalls[0].child, child);
  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged release verifier readiness helper waits through packaged-route startup after snapshot timeouts', async () => {
  const timeoutError = new Error('Timed out fetching http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot');
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const readyPreflightBody = JSON.stringify({
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
  });
  const fetchCalls = [];
  const sleepCalls = [];
  let snapshotAttempts = 0;
  const helper = buildPackagedReleaseVerifierWaitHelper({
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        snapshotAttempts += 1;
        if (snapshotAttempts === 1) {
          throw timeoutError;
        }
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readyPreflightBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedTimeoutFallbackProbes: async () => ({
      preflightProbe: {
        route: '/wp-json/reprint/v1/push/preflight',
        status: 404,
        ok: false,
        body: JSON.stringify({
          code: 'rest_no_route',
          message: 'No route was found matching the URL and request method.',
        }),
        parsedBody: {
          code: 'rest_no_route',
          message: 'No route was found matching the URL and request method.',
        },
        ready: false,
        retryable: true,
        terminal: false,
      },
      indexProbe: {
        route: '/wp-json/',
        status: 200,
        ok: true,
        body: JSON.stringify({ namespaces: ['reprint/v1'] }),
        parsedBody: {
          namespaces: ['reprint/v1'],
        },
        ready: true,
        retryable: false,
        terminal: false,
      },
    }),
    sleepUnlessChildExit: async (ms, child) => {
      sleepCalls.push({ ms, child });
    },
    throwPlaygroundReadinessFailure: async (child, prefix) => {
      const error = new Error(prefix);
      error.isPlaygroundReadinessFailure = true;
      throw error;
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9458,
  };

  await helper(child, 'http://127.0.0.1:65535', () => 'packaged server boot log');

  assert.equal(sleepCalls.length, 1);
  assert.equal(sleepCalls[0].ms, 1);
  assert.equal(sleepCalls[0].child, child);
  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged release verifier readiness helper waits through global WordPress startup after snapshot readiness reaches signed preflight', async () => {
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const startupPreflightBody = JSON.stringify({
    code: 'rest_no_route',
    message: 'No route was found matching the URL and request method.',
  });
  const readyPreflightBody = JSON.stringify({
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
  });
  const fetchCalls = [];
  const sleepCalls = [];
  let preflightAttempts = 0;
  const helper = buildPackagedReleaseVerifierWaitHelper({
    packagedProductionPluginRouteStartupClassificationReady: () => true,
    packagedProductionPluginGlobalStartupStillWithinBudget: () => true,
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        preflightAttempts += 1;
        return {
          response: {
            status: preflightAttempts === 1 ? 404 : 200,
            ok: preflightAttempts !== 1,
          },
          bodyText: preflightAttempts === 1 ? startupPreflightBody : readyPreflightBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => {
      throw new Error('unexpected snapshot-startup fallback preflight probe');
    },
    fetchPackagedTimeoutFallbackProbes: async () => {
      throw new Error('unexpected timeout fallback probes during packaged-route startup budget runtime proof');
    },
    fetchPackagedWordPressIndexProbe: async () => ({
      route: '/wp-json/',
      status: 503,
      ok: false,
      body: 'WordPress is not ready yet',
      parsedBody: null,
      ready: false,
      retryable: true,
      terminal: false,
    }),
    sleepUnlessChildExit: async (ms, child) => {
      sleepCalls.push({ ms, child });
    },
    throwPlaygroundReadinessFailure: async (child, prefix) => {
      const error = new Error(prefix);
      error.isPlaygroundReadinessFailure = true;
      throw error;
    },
    stopSpawnedServer: async () => {
      throw new Error('unexpected server stop during packaged-route startup budget runtime proof');
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9460,
  };

  await helper(child, 'http://127.0.0.1:65535', () => 'packaged server boot log');

  assert.equal(sleepCalls.length, 1);
  assert.equal(sleepCalls[0].ms, 1);
  assert.equal(sleepCalls[0].child, child);
  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged release verifier readiness helper waits through packaged-route startup after snapshot readiness reaches signed preflight', async () => {
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const startupPreflightBody = JSON.stringify({
    code: 'rest_no_route',
    message: 'No route was found matching the URL and request method.',
  });
  const readyPreflightBody = JSON.stringify({
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
  });
  const fetchCalls = [];
  const sleepCalls = [];
  let preflightAttempts = 0;
  const helper = buildPackagedReleaseVerifierWaitHelper({
    packagedProductionPluginRouteStartupClassificationReady: () => true,
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        preflightAttempts += 1;
        return {
          response: {
            status: preflightAttempts === 1 ? 404 : 200,
            ok: preflightAttempts !== 1,
          },
          bodyText: preflightAttempts === 1 ? startupPreflightBody : readyPreflightBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => {
      throw new Error('unexpected snapshot-startup fallback preflight probe');
    },
    fetchPackagedTimeoutFallbackProbes: async () => {
      throw new Error('unexpected timeout fallback probes during packaged-route startup budget runtime proof');
    },
    fetchPackagedWordPressIndexProbe: async () => ({
      route: '/wp-json/',
      status: 200,
      ok: true,
      body: JSON.stringify({ namespaces: ['reprint/v1'] }),
      parsedBody: {
        namespaces: ['reprint/v1'],
      },
      ready: true,
      retryable: false,
      terminal: false,
    }),
    sleepUnlessChildExit: async (ms, child) => {
      sleepCalls.push({ ms, child });
    },
    throwPlaygroundReadinessFailure: async (child, prefix) => {
      const error = new Error(prefix);
      error.isPlaygroundReadinessFailure = true;
      throw error;
    },
    stopSpawnedServer: async () => {
      throw new Error('unexpected server stop during packaged-route startup budget runtime proof');
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9460,
  };

  await helper(child, 'http://127.0.0.1:65535', () => 'packaged server boot log');

  assert.equal(sleepCalls.length, 1);
  assert.equal(sleepCalls[0].ms, 1);
  assert.equal(sleepCalls[0].child, child);
  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged release verifier readiness helper fails closed when the snapshot route returns a terminal response', async () => {
  const terminalSnapshotBody = JSON.stringify({
    code: 'rest_forbidden',
    message: 'forbidden',
  });
  const fetchCalls = [];
  const helper = buildPackagedReleaseVerifierWaitHelper({
    packagedProductionPluginRouteStartupClassificationReady: () => {
      throw new Error('unexpected route startup classification during terminal snapshot runtime proof');
    },
    fetchPackagedWordPressIndexProbe: async () => {
      throw new Error('unexpected /wp-json/ probe during terminal snapshot runtime proof');
    },
    packagedProductionPluginRouteStartupClassificationReady: () => false,
    sleepUnlessChildExit: async () => {
      throw new Error('unexpected readiness sleep during terminal snapshot runtime proof');
    },
    fetchPackagedTimeoutFallbackProbes: async () => {
      throw new Error('unexpected timeout fallback probes during terminal snapshot runtime proof');
    },
    fetchPackagedPreflightProbe: async () => {
      return {
        route: '/wp-json/reprint/v1/push/preflight',
        status: 200,
        ok: true,
        body: JSON.stringify({
          ok: false,
        }),
        parsedBody: {
          ok: false,
        },
        ready: false,
        retryable: false,
        terminal: false,
      };
    },
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 401,
            ok: false,
          },
          bodyText: terminalSnapshotBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    throwPlaygroundReadinessFailure: async (child, prefix) => {
      const error = new Error(prefix);
      error.isPlaygroundReadinessFailure = true;
      throw error;
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9462,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', () => 'packaged server boot log'),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin snapshot returned a terminal readiness failure at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );

  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
  ]);
});

test('packaged release verifier readiness helper fails closed when the snapshot route returns an invalid readiness body', async () => {
  const invalidSnapshotBody = '<!doctype html><html><body>not a snapshot response</body></html>';
  const fetchCalls = [];
  const helper = buildPackagedReleaseVerifierWaitHelper({
    packagedProductionPluginRouteStartupClassificationReady: () => {
      throw new Error('unexpected route startup classification during invalid snapshot runtime proof');
    },
    fetchPackagedWordPressIndexProbe: async () => {
      throw new Error('unexpected /wp-json/ probe during invalid snapshot runtime proof');
    },
    sleepUnlessChildExit: async () => {
      throw new Error('unexpected readiness sleep during invalid snapshot runtime proof');
    },
    fetchPackagedTimeoutFallbackProbes: async () => {
      throw new Error('unexpected timeout fallback probes during invalid snapshot runtime proof');
    },
    fetchPackagedPreflightProbe: async () => {
      throw new Error('unexpected snapshot-startup fallback preflight probe');
    },
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: invalidSnapshotBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    throwPlaygroundReadinessFailure: async (child, prefix) => {
      const error = new Error(prefix);
      error.isPlaygroundReadinessFailure = true;
      throw error;
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9463,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', () => 'packaged server boot log'),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin snapshot returned an invalid readiness body at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );

  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
  ]);
});

test('packaged release verifier readiness helper fails closed when signed preflight returns a terminal response after snapshot readiness succeeds', async () => {
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const terminalPreflightBody = JSON.stringify({
    code: 'rest_forbidden',
    message: 'forbidden',
  });
  const fetchCalls = [];
  const helper = buildPackagedReleaseVerifierWaitHelper({
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 401,
            ok: false,
          },
          bodyText: terminalPreflightBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => {
      throw new Error('unexpected snapshot-startup fallback preflight probe');
    },
    throwPlaygroundReadinessFailure: async (child, prefix) => {
      const error = new Error(prefix);
      error.isPlaygroundReadinessFailure = true;
      throw error;
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9463,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', () => 'packaged server boot log'),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight returned an invalid readiness body at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );

  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged release verifier readiness helper fails closed when signed preflight returns an invalid readiness body after snapshot readiness succeeds', async () => {
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const invalidPreflightBody = JSON.stringify({
    ok: true,
    routeProfile: {
      profile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      labBacked: false,
    },
  });
  const fetchCalls = [];
  const helper = buildPackagedReleaseVerifierWaitHelper({
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: invalidPreflightBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => {
      throw new Error('unexpected snapshot-startup fallback preflight probe');
    },
    throwPlaygroundReadinessFailure: async (child, prefix) => {
      const error = new Error(prefix);
      error.isPlaygroundReadinessFailure = true;
      throw error;
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9464,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', () => 'packaged server boot log'),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight returned an invalid readiness body at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );

  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged release verifier readiness helper fails closed when signed preflight keeps a broken top-level session envelope after snapshot readiness succeeds', async () => {
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const brokenSessionEnvelopeBody = JSON.stringify({
    ok: true,
    routeProfile: {
      profile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      labBacked: false,
    },
    auth: {
      session: {
        status: 'active',
        type: 'production-auth-session',
        expiresAt: '2099-01-01T00:00:00Z',
      },
    },
    session: {
      type: 'production-auth-session',
    },
  });
  const fetchCalls = [];
  const helper = buildPackagedReleaseVerifierWaitHelper({
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: brokenSessionEnvelopeBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => {
      throw new Error('unexpected snapshot-startup fallback preflight probe');
    },
    throwPlaygroundReadinessFailure: async (child, prefix) => {
      const error = new Error(prefix);
      error.isPlaygroundReadinessFailure = true;
      throw error;
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9464,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', () => 'packaged server boot log'),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight returned an invalid readiness body at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );

  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged release verifier readiness helper fails closed when signed preflight session identities diverge after snapshot readiness succeeds', async () => {
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const mismatchedSessionBody = JSON.stringify({
    ok: true,
    routeProfile: {
      profile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      labBacked: false,
    },
    auth: {
      session: {
        id: 'session_456',
        status: 'active',
        type: 'production-auth-session',
        expiresAt: '2099-01-01T00:00:00Z',
      },
    },
    session: {
      id: 'session_123',
      type: 'production-auth-session',
    },
  });
  const fetchCalls = [];
  const helper = buildPackagedReleaseVerifierWaitHelper({
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: mismatchedSessionBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => {
      throw new Error('unexpected snapshot-startup fallback preflight probe');
    },
    throwPlaygroundReadinessFailure: async (child, prefix) => {
      const error = new Error(prefix);
      error.isPlaygroundReadinessFailure = true;
      throw error;
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9464,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', () => 'packaged server boot log'),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight returned an invalid readiness body at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );

  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged release verifier readiness helper fails closed when signed preflight auth session has the wrong type after snapshot readiness succeeds', async () => {
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const wrongTypeAuthSessionBody = JSON.stringify({
    ok: true,
    routeProfile: {
      profile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      labBacked: false,
    },
    auth: {
      session: {
        id: 'session_123',
        status: 'active',
        type: 'lab-signed-push-session',
        expiresAt: '2099-01-01T00:00:00Z',
      },
    },
    session: {
      id: 'session_123',
      type: 'production-auth-session',
    },
  });
  const fetchCalls = [];
  const helper = buildPackagedReleaseVerifierWaitHelper({
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: wrongTypeAuthSessionBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => {
      throw new Error('unexpected snapshot-startup fallback preflight probe');
    },
    throwPlaygroundReadinessFailure: async (child, prefix) => {
      const error = new Error(prefix);
      error.isPlaygroundReadinessFailure = true;
      throw error;
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9464,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', () => 'packaged server boot log'),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight returned an invalid readiness body at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );

  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged release verifier readiness helper fails closed when signed preflight auth session is missing a status after snapshot readiness succeeds', async () => {
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const missingStatusAuthSessionBody = JSON.stringify({
    ok: true,
    routeProfile: {
      profile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      labBacked: false,
    },
    auth: {
      session: {
        id: 'session_123',
        type: 'production-auth-session',
        expiresAt: '2099-01-01T00:00:00Z',
      },
    },
    session: {
      id: 'session_123',
      type: 'production-auth-session',
    },
  });
  const fetchCalls = [];
  const helper = buildPackagedReleaseVerifierWaitHelper({
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: missingStatusAuthSessionBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => {
      throw new Error('unexpected snapshot-startup fallback preflight probe');
    },
    throwPlaygroundReadinessFailure: async (child, prefix) => {
      const error = new Error(prefix);
      error.isPlaygroundReadinessFailure = true;
      throw error;
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9464,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', () => 'packaged server boot log'),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight returned an invalid readiness body at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );

  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged release verifier readiness helper fails closed when signed preflight auth session is revoked after snapshot readiness succeeds', async () => {
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const revokedAuthSessionBody = JSON.stringify({
    ok: true,
    routeProfile: {
      profile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      labBacked: false,
    },
    auth: {
      session: {
        id: 'session_123',
        status: 'revoked',
        type: 'production-auth-session',
        expiresAt: '2099-01-01T00:00:00Z',
      },
    },
    session: {
      id: 'session_123',
      type: 'production-auth-session',
    },
  });
  const fetchCalls = [];
  const helper = buildPackagedReleaseVerifierWaitHelper({
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: revokedAuthSessionBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => {
      throw new Error('unexpected snapshot-startup fallback preflight probe');
    },
    throwPlaygroundReadinessFailure: async (child, prefix) => {
      const error = new Error(prefix);
      error.isPlaygroundReadinessFailure = true;
      throw error;
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9464,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', () => 'packaged server boot log'),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight returned an invalid readiness body at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );

  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged release verifier readiness helper fails closed when signed preflight auth session is explicitly revoked after snapshot readiness succeeds', async () => {
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const explicitlyRevokedAuthSessionBody = JSON.stringify({
    ok: true,
    routeProfile: {
      profile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      labBacked: false,
    },
    auth: {
      session: {
        id: 'session_123',
        status: 'active',
        type: 'production-auth-session',
        expiresAt: '2099-01-01T00:00:00Z',
        revoked: true,
      },
    },
    session: {
      id: 'session_123',
      type: 'production-auth-session',
    },
  });
  const fetchCalls = [];
  const helper = buildPackagedReleaseVerifierWaitHelper({
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: explicitlyRevokedAuthSessionBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => {
      throw new Error('unexpected snapshot-startup fallback preflight probe');
    },
    throwPlaygroundReadinessFailure: async (child, prefix) => {
      const error = new Error(prefix);
      error.isPlaygroundReadinessFailure = true;
      throw error;
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9464,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', () => 'packaged server boot log'),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight returned an invalid readiness body at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );

  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged release verifier readiness helper fails closed when signed preflight auth session is explicitly rotated after snapshot readiness succeeds', async () => {
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const explicitlyRotatedAuthSessionBody = JSON.stringify({
    ok: true,
    routeProfile: {
      profile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      labBacked: false,
    },
    auth: {
      session: {
        id: 'session_123',
        status: 'active',
        type: 'production-auth-session',
        expiresAt: '2099-01-01T00:00:00Z',
        rotated: true,
      },
    },
    session: {
      id: 'session_123',
      type: 'production-auth-session',
    },
  });
  const fetchCalls = [];
  const helper = buildPackagedReleaseVerifierWaitHelper({
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: explicitlyRotatedAuthSessionBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => {
      throw new Error('unexpected snapshot-startup fallback preflight probe');
    },
    throwPlaygroundReadinessFailure: async (child, prefix) => {
      const error = new Error(prefix);
      error.isPlaygroundReadinessFailure = true;
      throw error;
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9464,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', () => 'packaged server boot log'),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight returned an invalid readiness body at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );

  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged release verifier readiness helper fails closed when signed preflight auth session is cleaned up after snapshot readiness succeeds', async () => {
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const cleanedUpAuthSessionBody = JSON.stringify({
    ok: true,
    routeProfile: {
      profile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      labBacked: false,
    },
    auth: {
      session: {
        id: 'session_123',
        status: 'active',
        type: 'production-auth-session',
        expiresAt: '2099-01-01T00:00:00Z',
        cleanedUp: true,
      },
    },
    session: {
      id: 'session_123',
      type: 'production-auth-session',
    },
  });
  const fetchCalls = [];
  const helper = buildPackagedReleaseVerifierWaitHelper({
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: cleanedUpAuthSessionBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => {
      throw new Error('unexpected snapshot-startup fallback preflight probe');
    },
    throwPlaygroundReadinessFailure: async (child, prefix) => {
      const error = new Error(prefix);
      error.isPlaygroundReadinessFailure = true;
      throw error;
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9464,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', () => 'packaged server boot log'),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight returned an invalid readiness body at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );

  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged release verifier readiness helper fails closed when signed preflight auth session carries the cleanup alias after snapshot readiness succeeds', async () => {
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const cleanupAliasAuthSessionBody = JSON.stringify({
    ok: true,
    routeProfile: {
      profile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      labBacked: false,
    },
    auth: {
      session: {
        id: 'session_123',
        status: 'active',
        type: 'production-auth-session',
        expiresAt: '2099-01-01T00:00:00Z',
        cleanup: true,
      },
    },
    session: {
      id: 'session_123',
      type: 'production-auth-session',
    },
  });
  const fetchCalls = [];
  const helper = buildPackagedReleaseVerifierWaitHelper({
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: cleanupAliasAuthSessionBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => {
      throw new Error('unexpected snapshot-startup fallback preflight probe');
    },
    throwPlaygroundReadinessFailure: async (child, prefix) => {
      const error = new Error(prefix);
      error.isPlaygroundReadinessFailure = true;
      throw error;
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9464,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', () => 'packaged server boot log'),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight returned an invalid readiness body at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );

  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged release verifier readiness helper fails closed when signed preflight auth session is expired after snapshot readiness succeeds', async () => {
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const expiredAuthSessionBody = JSON.stringify({
    ok: true,
    routeProfile: {
      profile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      labBacked: false,
    },
    auth: {
      session: {
        id: 'session_123',
        status: 'active',
        type: 'production-auth-session',
        expiresAt: '2000-01-01T00:00:00Z',
      },
    },
    session: {
      id: 'session_123',
      type: 'production-auth-session',
    },
  });
  const fetchCalls = [];
  const helper = buildPackagedReleaseVerifierWaitHelper({
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: expiredAuthSessionBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => {
      throw new Error('unexpected snapshot-startup fallback preflight probe');
    },
    throwPlaygroundReadinessFailure: async (child, prefix) => {
      const error = new Error(prefix);
      error.isPlaygroundReadinessFailure = true;
      throw error;
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9464,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', () => 'packaged server boot log'),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight returned an invalid readiness body at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );

  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged release verifier readiness helper fails closed when signed preflight auth session has an invalid expiry after snapshot readiness succeeds', async () => {
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const invalidExpiryAuthSessionBody = JSON.stringify({
    ok: true,
    routeProfile: {
      profile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      labBacked: false,
    },
    auth: {
      session: {
        id: 'session_123',
        status: 'active',
        type: 'production-auth-session',
        expiresAt: 'not-a-date',
      },
    },
    session: {
      id: 'session_123',
      type: 'production-auth-session',
    },
  });
  const fetchCalls = [];
  const helper = buildPackagedReleaseVerifierWaitHelper({
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: invalidExpiryAuthSessionBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => {
      throw new Error('unexpected snapshot-startup fallback preflight probe');
    },
    throwPlaygroundReadinessFailure: async (child, prefix) => {
      const error = new Error(prefix);
      error.isPlaygroundReadinessFailure = true;
      throw error;
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9464,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', () => 'packaged server boot log'),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight returned an invalid readiness body at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );

  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged release verifier readiness helper fails closed when signed preflight auth session is missing an expiry after snapshot readiness succeeds', async () => {
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const missingExpiryAuthSessionBody = JSON.stringify({
    ok: true,
    routeProfile: {
      profile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      labBacked: false,
    },
    auth: {
      session: {
        id: 'session_123',
        status: 'active',
        type: 'production-auth-session',
      },
    },
    session: {
      id: 'session_123',
      type: 'production-auth-session',
    },
  });
  const fetchCalls = [];
  const helper = buildPackagedReleaseVerifierWaitHelper({
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: missingExpiryAuthSessionBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => {
      throw new Error('unexpected snapshot-startup fallback preflight probe');
    },
    throwPlaygroundReadinessFailure: async (child, prefix) => {
      const error = new Error(prefix);
      error.isPlaygroundReadinessFailure = true;
      throw error;
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9464,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', () => 'packaged server boot log'),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight returned an invalid readiness body at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );

  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged release verifier readiness helper fails closed when signed preflight returns a terminal response while snapshot startup is still in progress', async () => {
  const snapshotStartupBody = JSON.stringify({
    code: 'rest_no_route',
    message: 'No route was found matching the URL and request method.',
  });
  const fetchCalls = [];
  const helper = buildPackagedReleaseVerifierWaitHelper({
    packagedProductionPluginRouteStartupClassificationReady: () => {
      throw new Error('unexpected route startup classification during snapshot-startup terminal signed-preflight runtime proof');
    },
    fetchPackagedWordPressIndexProbe: async () => {
      throw new Error('unexpected /wp-json/ probe during snapshot-startup terminal signed-preflight runtime proof');
    },
    sleepUnlessChildExit: async () => {
      throw new Error('unexpected readiness sleep during snapshot-startup terminal signed-preflight runtime proof');
    },
    fetchPackagedTimeoutFallbackProbes: async () => {
      throw new Error('unexpected timeout fallback probes during snapshot-startup terminal signed-preflight runtime proof');
    },
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 404,
            ok: false,
          },
          bodyText: snapshotStartupBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => ({
      route: '/wp-json/reprint/v1/push/preflight',
      status: 401,
      ok: false,
      body: JSON.stringify({
        code: 'rest_forbidden',
        message: 'forbidden',
      }),
      parsedBody: {
        code: 'rest_forbidden',
        message: 'forbidden',
      },
      ready: false,
      retryable: false,
      terminal: true,
    }),
    throwPlaygroundReadinessFailure: async (child, prefix) => {
      const error = new Error(prefix);
      error.isPlaygroundReadinessFailure = true;
      throw error;
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9464,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', () => 'packaged server boot log'),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight became terminal while snapshot still reported startup-shaped readiness at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );

  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
  ]);
});

test('packaged release verifier readiness helper fails closed when signed preflight returns an invalid readiness body while snapshot startup is still in progress', async () => {
  const snapshotStartupBody = JSON.stringify({
    code: 'rest_no_route',
    message: 'No route was found matching the URL and request method.',
  });
  const fetchCalls = [];
  let capturedContext = null;
  const helper = buildPackagedReleaseVerifierWaitHelper({
    packagedProductionPluginRouteStartupClassificationReady: () => {
      throw new Error('unexpected route startup classification during snapshot-startup invalid signed-preflight runtime proof');
    },
    fetchPackagedWordPressIndexProbe: async () => {
      throw new Error('unexpected /wp-json/ probe during snapshot-startup invalid signed-preflight runtime proof');
    },
    sleepUnlessChildExit: async () => {
      throw new Error('unexpected readiness sleep during snapshot-startup invalid signed-preflight runtime proof');
    },
    fetchPackagedTimeoutFallbackProbes: async () => {
      throw new Error('unexpected timeout fallback probes during snapshot-startup invalid signed-preflight runtime proof');
    },
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 404,
            ok: false,
          },
          bodyText: snapshotStartupBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => ({
      route: '/wp-json/reprint/v1/push/preflight',
      status: 200,
      ok: true,
      body: JSON.stringify({
        ok: true,
        routeProfile: {
          profile: 'production-shaped',
          restNamespace: 'reprint/v1',
          routePrefix: '/push',
          labBacked: false,
        },
      }),
      parsedBody: null,
      ready: false,
      retryable: false,
      terminal: true,
    }),
    throwPlaygroundReadinessFailure: async (child, prefix, lastError, lastProbes, logs, context) => {
      capturedContext = context;
      const error = new Error(prefix);
      error.isPlaygroundReadinessFailure = true;
      throw error;
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9465,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', () => 'packaged server boot log'),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight returned an invalid readiness body while snapshot still reported startup-shaped readiness at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );

  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
  ]);
  assert.equal(capturedContext?.invalidReadinessBody, true);
  assert.equal(capturedContext?.snapshotStartupFallback, true);
  assert.equal(capturedContext?.snapshotNotReadyProbeCount, 1);
  assert.equal(capturedContext?.preflightTerminal, true);
});

test('packaged production plugin smoke readiness helper waits through packaged-route startup after global WordPress readiness', async () => {
  const snapshotStartupBody = JSON.stringify({
    code: 'rest_no_route',
    message: 'No route was found matching the URL and request method.',
  });
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const readyPreflightBody = JSON.stringify({
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
  });
  const fetchCalls = [];
  const sleepCalls = [];
  const helper = buildPackagedSmokeWaitHelper({
    packagedProductionPluginRouteStartupClassificationReady: () => true,
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        if (fetchCalls.filter((entry) => entry.endsWith('/wp-json/reprint/v1/push/snapshot')).length === 1) {
          return {
            response: {
              status: 404,
              ok: false,
            },
            bodyText: snapshotStartupBody,
          };
        }
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readyPreflightBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => ({
      route: '/wp-json/reprint/v1/push/preflight',
      status: 404,
      ok: false,
      body: snapshotStartupBody,
      parsedBody: {
        code: 'rest_no_route',
        message: 'No route was found matching the URL and request method.',
      },
      ready: false,
      retryable: true,
      terminal: false,
    }),
    fetchPackagedWordPressIndexProbe: async () => ({
      route: '/wp-json/',
      status: 200,
      ok: true,
      body: JSON.stringify({ namespaces: ['reprint/v1'] }),
      parsedBody: {
        namespaces: ['reprint/v1'],
      },
      ready: true,
      retryable: false,
      terminal: false,
    }),
    fetchPackagedTimeoutFallbackProbes: async () => {
      throw new Error('unexpected timeout fallback fetch in packaged smoke route-startup runtime proof');
    },
    sleepUnlessChildExit: async (ms, child) => {
      sleepCalls.push({ ms, child });
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9456,
  };

  await helper(child, 'http://127.0.0.1:65535', ['packaged smoke boot log']);

  assert.equal(sleepCalls.length, 1);
  assert.equal(sleepCalls[0].ms, 1);
  assert.equal(sleepCalls[0].child, child);
  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged production plugin smoke readiness helper waits through global WordPress startup before the packaged route is ready', async () => {
  const snapshotStartupBody = JSON.stringify({
    code: 'rest_no_route',
    message: 'No route was found matching the URL and request method.',
  });
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const readyPreflightBody = JSON.stringify({
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
  });
  const fetchCalls = [];
  const sleepCalls = [];
  const helper = buildPackagedSmokeWaitHelper({
    packagedProductionPluginRouteStartupClassificationReady: () => true,
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        if (fetchCalls.filter((entry) => entry.endsWith('/wp-json/reprint/v1/push/snapshot')).length === 1) {
          return {
            response: {
              status: 404,
              ok: false,
            },
            bodyText: snapshotStartupBody,
          };
        }
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readyPreflightBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => ({
      route: '/wp-json/reprint/v1/push/preflight',
      status: 404,
      ok: false,
      body: snapshotStartupBody,
      parsedBody: {
        code: 'rest_no_route',
        message: 'No route was found matching the URL and request method.',
      },
      ready: false,
      retryable: true,
      terminal: false,
    }),
    fetchPackagedWordPressIndexProbe: async () => ({
      route: '/wp-json/',
      status: 503,
      ok: false,
      body: 'WordPress is not ready yet',
      parsedBody: null,
      ready: false,
      retryable: true,
      terminal: false,
    }),
    fetchPackagedTimeoutFallbackProbes: async () => {
      throw new Error('unexpected timeout fallback fetch in packaged smoke global-startup runtime proof');
    },
    sleepUnlessChildExit: async (ms, child) => {
      sleepCalls.push({ ms, child });
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9456,
  };

  await helper(child, 'http://127.0.0.1:65535', ['packaged smoke boot log']);

  assert.equal(sleepCalls.length, 1);
  assert.equal(sleepCalls[0].ms, 1);
  assert.equal(sleepCalls[0].child, child);
  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged production plugin smoke readiness helper waits through global WordPress startup after snapshot timeouts', async () => {
  const timeoutError = new Error('Timed out fetching http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot');
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const readyPreflightBody = JSON.stringify({
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
  });
  const fetchCalls = [];
  const sleepCalls = [];
  let snapshotAttempts = 0;
  const helper = buildPackagedSmokeWaitHelper({
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        snapshotAttempts += 1;
        if (snapshotAttempts === 1) {
          throw timeoutError;
        }
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readyPreflightBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedTimeoutFallbackProbes: async () => ({
      preflightProbe: {
        route: '/wp-json/reprint/v1/push/preflight',
        status: 404,
        ok: false,
        body: JSON.stringify({
          code: 'rest_no_route',
          message: 'No route was found matching the URL and request method.',
        }),
        parsedBody: {
          code: 'rest_no_route',
          message: 'No route was found matching the URL and request method.',
        },
        ready: false,
        retryable: true,
        terminal: false,
      },
      indexProbe: {
        route: '/wp-json/',
        status: 503,
        ok: false,
        body: 'WordPress is not ready yet',
        parsedBody: null,
        ready: false,
        retryable: true,
        terminal: false,
      },
    }),
    sleepUnlessChildExit: async (ms, child) => {
      sleepCalls.push({ ms, child });
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9457,
  };

  await helper(child, 'http://127.0.0.1:65535', ['packaged smoke boot log']);

  assert.equal(sleepCalls.length, 1);
  assert.equal(sleepCalls[0].ms, 1);
  assert.equal(sleepCalls[0].child, child);
  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged production plugin smoke readiness helper waits through packaged-route startup after snapshot timeouts', async () => {
  const timeoutError = new Error('Timed out fetching http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot');
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const readyPreflightBody = JSON.stringify({
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
  });
  const fetchCalls = [];
  const sleepCalls = [];
  let snapshotAttempts = 0;
  const helper = buildPackagedSmokeWaitHelper({
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        snapshotAttempts += 1;
        if (snapshotAttempts === 1) {
          throw timeoutError;
        }
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readyPreflightBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedTimeoutFallbackProbes: async () => ({
      preflightProbe: {
        route: '/wp-json/reprint/v1/push/preflight',
        status: 404,
        ok: false,
        body: JSON.stringify({
          code: 'rest_no_route',
          message: 'No route was found matching the URL and request method.',
        }),
        parsedBody: {
          code: 'rest_no_route',
          message: 'No route was found matching the URL and request method.',
        },
        ready: false,
        retryable: true,
        terminal: false,
      },
      indexProbe: {
        route: '/wp-json/',
        status: 200,
        ok: true,
        body: JSON.stringify({ namespaces: ['reprint/v1'] }),
        parsedBody: {
          namespaces: ['reprint/v1'],
        },
        ready: true,
        retryable: false,
        terminal: false,
      },
    }),
    sleepUnlessChildExit: async (ms, child) => {
      sleepCalls.push({ ms, child });
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9458,
  };

  await helper(child, 'http://127.0.0.1:65535', ['packaged smoke boot log']);

  assert.equal(sleepCalls.length, 1);
  assert.equal(sleepCalls[0].ms, 1);
  assert.equal(sleepCalls[0].child, child);
  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged production plugin smoke readiness helper fails closed when signed preflight returns an invalid readiness body after the snapshot probe times out', async () => {
  const timeoutError = new Error('Timed out fetching http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot');
  const helper = buildPackagedSmokeWaitHelper({
    packagedProductionPluginClassifyTimeoutFallbackStartup: () => {
      throw new Error('unexpected timeout fallback startup classification during packaged smoke invalid signed-preflight runtime proof');
    },
    sleepUnlessChildExit: async () => {
      throw new Error('unexpected readiness sleep during packaged smoke timeout invalid signed-preflight runtime proof');
    },
    fetchTextWithTimeout: async (url) => {
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        throw timeoutError;
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedTimeoutFallbackProbes: async () => ({
      preflightProbe: {
        route: '/wp-json/reprint/v1/push/preflight',
        status: 200,
        ok: true,
        body: JSON.stringify({
          ok: true,
          routeProfile: {
            profile: 'production-shaped',
            restNamespace: 'reprint/v1',
            routePrefix: '/push',
            labBacked: false,
          },
        }),
        parsedBody: null,
        ready: false,
        retryable: false,
        terminal: true,
      },
      indexProbe: null,
    }),
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9468,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', ['packaged smoke boot log']),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight returned an invalid readiness body while the snapshot probe timed out at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );
});

test('packaged production plugin smoke readiness helper fails closed when signed preflight returns a terminal response after the snapshot probe times out', async () => {
  const timeoutError = new Error('Timed out fetching http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot');
  const helper = buildPackagedSmokeWaitHelper({
    packagedProductionPluginClassifyTimeoutFallbackStartup: () => {
      throw new Error('unexpected timeout fallback startup classification during packaged smoke terminal signed-preflight runtime proof');
    },
    sleepUnlessChildExit: async () => {
      throw new Error('unexpected readiness sleep during packaged smoke timeout terminal signed-preflight runtime proof');
    },
    fetchTextWithTimeout: async (url) => {
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        throw timeoutError;
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedTimeoutFallbackProbes: async () => ({
      preflightProbe: {
        route: '/wp-json/reprint/v1/push/preflight',
        status: 401,
        ok: false,
        body: JSON.stringify({
          code: 'reprint_push_lab_auth_required',
          message: 'auth required',
        }),
        parsedBody: {
          code: 'reprint_push_lab_auth_required',
          message: 'auth required',
        },
        ready: false,
        retryable: false,
        terminal: true,
      },
      indexProbe: null,
    }),
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9469,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', ['packaged smoke boot log']),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight became terminal while the snapshot probe timed out at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );
});

test('packaged production plugin smoke readiness helper waits through packaged-route startup after snapshot readiness reaches signed preflight', async () => {
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const startupPreflightBody = JSON.stringify({
    code: 'rest_no_route',
    message: 'No route was found matching the URL and request method.',
  });
  const readyPreflightBody = JSON.stringify({
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
  });
  const fetchCalls = [];
  const sleepCalls = [];
  let preflightAttempts = 0;
  const helper = buildPackagedSmokeWaitHelper({
    packagedProductionPluginRouteStartupClassificationReady: () => true,
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        preflightAttempts += 1;
        return {
          response: {
            status: preflightAttempts === 1 ? 404 : 200,
            ok: preflightAttempts !== 1,
          },
          bodyText: preflightAttempts === 1 ? startupPreflightBody : readyPreflightBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => {
      throw new Error('unexpected snapshot-startup fallback preflight probe');
    },
    fetchPackagedWordPressIndexProbe: async () => ({
      route: '/wp-json/',
      status: 200,
      ok: true,
      body: JSON.stringify({ namespaces: ['reprint/v1'] }),
      parsedBody: {
        namespaces: ['reprint/v1'],
      },
      ready: true,
      retryable: false,
      terminal: false,
    }),
    sleepUnlessChildExit: async (ms, child) => {
      sleepCalls.push({ ms, child });
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9461,
  };

  await helper(child, 'http://127.0.0.1:65535', ['packaged smoke boot log']);

  assert.equal(sleepCalls.length, 1);
  assert.equal(sleepCalls[0].ms, 1);
  assert.equal(sleepCalls[0].child, child);
  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged production plugin smoke readiness helper keeps waiting through packaged-route startup after terminal signed preflight while snapshot startup is still in progress', async () => {
  const snapshotStartupBody = JSON.stringify({
    code: 'rest_no_route',
    message: 'No route was found matching the URL and request method.',
  });
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const readyPreflightBody = JSON.stringify({
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
  });
  const fetchCalls = [];
  const sleepCalls = [];
  let snapshotAttempts = 0;
  let preflightFallbackAttempts = 0;
  const helper = buildPackagedSmokeWaitHelper({
    packagedProductionPluginRouteStartupClassificationReady: () => true,
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        snapshotAttempts += 1;
        if (snapshotAttempts === 1) {
          return {
            response: {
              status: 404,
              ok: false,
            },
            bodyText: snapshotStartupBody,
          };
        }
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readyPreflightBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => {
      preflightFallbackAttempts += 1;
      if (preflightFallbackAttempts !== 1) {
        throw new Error('unexpected extra snapshot-startup fallback preflight probe');
      }
      return {
        route: '/wp-json/reprint/v1/push/preflight',
        status: 401,
        ok: false,
        body: JSON.stringify({
          code: 'rest_forbidden',
          message: 'forbidden',
        }),
        parsedBody: {
          code: 'rest_forbidden',
          message: 'forbidden',
        },
        ready: false,
        retryable: false,
        terminal: true,
      };
    },
    fetchPackagedWordPressIndexProbe: async () => ({
      route: '/wp-json/',
      status: 200,
      ok: true,
      body: JSON.stringify({ namespaces: ['reprint/v1'] }),
      parsedBody: {
        namespaces: ['reprint/v1'],
      },
      ready: true,
      retryable: false,
      terminal: false,
    }),
    sleepUnlessChildExit: async (ms, child) => {
      sleepCalls.push({ ms, child });
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9462,
  };

  await helper(child, 'http://127.0.0.1:65535', ['packaged smoke boot log']);

  assert.equal(sleepCalls.length, 1);
  assert.equal(sleepCalls[0].ms, 1);
  assert.equal(sleepCalls[0].child, child);
  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged production plugin smoke readiness helper fails closed when terminal signed preflight keeps the packaged route in startup past the post-global-ready budget', async () => {
  const snapshotStartupBody = JSON.stringify({
    code: 'rest_no_route',
    message: 'No route was found matching the URL and request method.',
  });
  const helper = buildPackagedSmokeWaitHelper({
    packagedProductionPluginRouteStartupClassificationReady: () => true,
    fetchTextWithTimeout: async (url) => {
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 404,
            ok: false,
          },
          bodyText: snapshotStartupBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => ({
      route: '/wp-json/reprint/v1/push/preflight',
      status: 401,
      ok: false,
      body: JSON.stringify({
        code: 'rest_forbidden',
        message: 'forbidden',
      }),
      parsedBody: {
        code: 'rest_forbidden',
        message: 'forbidden',
      },
      ready: false,
      retryable: false,
      terminal: true,
    }),
    fetchPackagedWordPressIndexProbe: async () => ({
      route: '/wp-json/',
      status: 200,
      ok: true,
      body: JSON.stringify({ namespaces: ['reprint/v1'] }),
      parsedBody: {
        namespaces: ['reprint/v1'],
      },
      ready: true,
      retryable: false,
      terminal: false,
    }),
    sleepUnlessChildExit: async (ms, child) => {
      sleepCalls.push({ ms, child });
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9463,
  };
  const sleepCalls = [];

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', ['packaged smoke boot log']),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin snapshot stayed startup-shaped after global WordPress startup HTTP 200 for 4 consecutive responses \(limit 4\)/,
      );
      assert.match(error.message, /"packagedRouteStartup": true/);
      assert.match(error.message, /"snapshotNotReadyProbeCount": 4/);
      return true;
    },
  );

  assert.equal(sleepCalls.length, 3);
  assert.deepEqual(
    sleepCalls.map(({ ms, child: sleptChild }) => ({ ms, child: sleptChild })),
    [
      { ms: 1, child },
      { ms: 1, child },
      { ms: 1, child },
    ],
  );
});

test('packaged production plugin smoke readiness helper fails closed when the snapshot route returns a terminal response', async () => {
  const terminalSnapshotBody = JSON.stringify({
    code: 'rest_forbidden',
    message: 'forbidden',
  });
  const fetchCalls = [];
  const helper = buildPackagedSmokeWaitHelper({
    packagedProductionPluginRouteStartupClassificationReady: () => {
      throw new Error('unexpected route startup classification during terminal snapshot runtime proof');
    },
    fetchPackagedWordPressIndexProbe: async () => {
      throw new Error('unexpected /wp-json/ probe during terminal snapshot runtime proof');
    },
    packagedProductionPluginRouteStartupClassificationReady: () => false,
    sleepUnlessChildExit: async () => {
      throw new Error('unexpected readiness sleep during terminal snapshot runtime proof');
    },
    fetchPackagedTimeoutFallbackProbes: async () => {
      throw new Error('unexpected timeout fallback probes during terminal snapshot runtime proof');
    },
    fetchPackagedPreflightProbe: async () => {
      return {
        route: '/wp-json/reprint/v1/push/preflight',
        status: 200,
        ok: true,
        body: JSON.stringify({
          ok: false,
        }),
        parsedBody: {
          ok: false,
        },
        ready: false,
        retryable: false,
        terminal: false,
      };
    },
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 401,
            ok: false,
          },
          bodyText: terminalSnapshotBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9463,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', ['packaged smoke boot log']),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin snapshot returned a terminal readiness failure at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );

  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
  ]);
});

test('packaged production plugin smoke readiness helper fails closed when the snapshot route returns an invalid readiness body', async () => {
  const invalidSnapshotBody = '<!doctype html><html><body>not a snapshot response</body></html>';
  const fetchCalls = [];
  const helper = buildPackagedSmokeWaitHelper({
    packagedProductionPluginRouteStartupClassificationReady: () => {
      throw new Error('unexpected route startup classification during invalid snapshot runtime proof');
    },
    fetchPackagedWordPressIndexProbe: async () => {
      throw new Error('unexpected /wp-json/ probe during invalid snapshot runtime proof');
    },
    sleepUnlessChildExit: async () => {
      throw new Error('unexpected readiness sleep during invalid snapshot runtime proof');
    },
    fetchPackagedTimeoutFallbackProbes: async () => {
      throw new Error('unexpected timeout fallback probes during invalid snapshot runtime proof');
    },
    fetchPackagedPreflightProbe: async () => {
      throw new Error('unexpected snapshot-startup fallback preflight probe');
    },
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: invalidSnapshotBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9464,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', ['packaged smoke boot log']),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin snapshot returned an invalid readiness body at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );

  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
  ]);
});

test('packaged production plugin smoke readiness helper fails closed when signed preflight returns a terminal response after snapshot readiness succeeds', async () => {
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const terminalPreflightBody = JSON.stringify({
    code: 'rest_forbidden',
    message: 'forbidden',
  });
  const fetchCalls = [];
  const helper = buildPackagedSmokeWaitHelper({
    packagedProductionPluginRouteStartupClassificationReady: () => {
      throw new Error('unexpected route startup classification during terminal signed-preflight runtime proof');
    },
    fetchPackagedWordPressIndexProbe: async () => {
      throw new Error('unexpected /wp-json/ probe during terminal signed-preflight runtime proof');
    },
    sleepUnlessChildExit: async () => {
      throw new Error('unexpected readiness sleep during terminal signed-preflight runtime proof');
    },
    fetchPackagedTimeoutFallbackProbes: async () => {
      throw new Error('unexpected timeout fallback probes during terminal signed-preflight runtime proof');
    },
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 401,
            ok: false,
          },
          bodyText: terminalPreflightBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => {
      throw new Error('unexpected snapshot-startup fallback preflight probe');
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9464,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', ['packaged smoke boot log']),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight returned an invalid readiness body at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );

  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged production plugin smoke readiness helper fails closed when signed preflight returns an invalid readiness body after snapshot readiness succeeds', async () => {
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const invalidPreflightBody = JSON.stringify({
    ok: true,
    routeProfile: {
      profile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      labBacked: false,
    },
  });
  const fetchCalls = [];
  const helper = buildPackagedSmokeWaitHelper({
    packagedProductionPluginRouteStartupClassificationReady: () => {
      throw new Error('unexpected route startup classification during invalid signed-preflight runtime proof');
    },
    fetchPackagedWordPressIndexProbe: async () => {
      throw new Error('unexpected /wp-json/ probe during invalid signed-preflight runtime proof');
    },
    sleepUnlessChildExit: async () => {
      throw new Error('unexpected readiness sleep during invalid signed-preflight runtime proof');
    },
    fetchPackagedTimeoutFallbackProbes: async () => {
      throw new Error('unexpected timeout fallback probes during invalid signed-preflight runtime proof');
    },
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: invalidPreflightBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => {
      throw new Error('unexpected snapshot-startup fallback preflight probe');
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9465,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', ['packaged smoke boot log']),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight returned an invalid readiness body at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );

  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged production plugin smoke readiness helper fails closed when signed preflight keeps a broken top-level session envelope after snapshot readiness succeeds', async () => {
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const brokenSessionEnvelopeBody = JSON.stringify({
    ok: true,
    routeProfile: {
      profile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      labBacked: false,
    },
    auth: {
      session: {
        status: 'active',
        type: 'production-auth-session',
        expiresAt: '2099-01-01T00:00:00Z',
      },
    },
    session: {
      type: 'production-auth-session',
    },
  });
  const fetchCalls = [];
  const helper = buildPackagedSmokeWaitHelper({
    packagedProductionPluginRouteStartupClassificationReady: () => {
      throw new Error('unexpected route startup classification during broken top-level session runtime proof');
    },
    fetchPackagedWordPressIndexProbe: async () => {
      throw new Error('unexpected /wp-json/ probe during broken top-level session runtime proof');
    },
    sleepUnlessChildExit: async () => {
      throw new Error('unexpected readiness sleep during broken top-level session runtime proof');
    },
    fetchPackagedTimeoutFallbackProbes: async () => {
      throw new Error('unexpected timeout fallback probes during broken top-level session runtime proof');
    },
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: brokenSessionEnvelopeBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => {
      throw new Error('unexpected snapshot-startup fallback preflight probe');
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9466,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', ['packaged smoke boot log']),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight returned an invalid readiness body at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );

  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged production plugin smoke readiness helper fails closed when signed preflight session identities diverge after snapshot readiness succeeds', async () => {
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const mismatchedSessionBody = JSON.stringify({
    ok: true,
    routeProfile: {
      profile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      labBacked: false,
    },
    auth: {
      session: {
        id: 'session_456',
        status: 'active',
        type: 'production-auth-session',
        expiresAt: '2099-01-01T00:00:00Z',
      },
    },
    session: {
      id: 'session_123',
      type: 'production-auth-session',
    },
  });
  const fetchCalls = [];
  const helper = buildPackagedSmokeWaitHelper({
    packagedProductionPluginRouteStartupClassificationReady: () => {
      throw new Error('unexpected route startup classification during mismatched session runtime proof');
    },
    fetchPackagedWordPressIndexProbe: async () => {
      throw new Error('unexpected /wp-json/ probe during mismatched session runtime proof');
    },
    sleepUnlessChildExit: async () => {
      throw new Error('unexpected readiness sleep during mismatched session runtime proof');
    },
    fetchPackagedTimeoutFallbackProbes: async () => {
      throw new Error('unexpected timeout fallback probes during mismatched session runtime proof');
    },
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: mismatchedSessionBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => {
      throw new Error('unexpected snapshot-startup fallback preflight probe');
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9466,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', ['packaged smoke boot log']),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight returned an invalid readiness body at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );

  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged production plugin smoke readiness helper fails closed when signed preflight auth session has the wrong type after snapshot readiness succeeds', async () => {
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const wrongTypeAuthSessionBody = JSON.stringify({
    ok: true,
    routeProfile: {
      profile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      labBacked: false,
    },
    auth: {
      session: {
        id: 'session_123',
        status: 'active',
        type: 'lab-signed-push-session',
        expiresAt: '2099-01-01T00:00:00Z',
      },
    },
    session: {
      id: 'session_123',
      type: 'production-auth-session',
    },
  });
  const fetchCalls = [];
  const helper = buildPackagedSmokeWaitHelper({
    packagedProductionPluginRouteStartupClassificationReady: () => {
      throw new Error('unexpected route startup classification during wrong-type auth session runtime proof');
    },
    fetchPackagedWordPressIndexProbe: async () => {
      throw new Error('unexpected /wp-json/ probe during wrong-type auth session runtime proof');
    },
    sleepUnlessChildExit: async () => {
      throw new Error('unexpected readiness sleep during wrong-type auth session runtime proof');
    },
    fetchPackagedTimeoutFallbackProbes: async () => {
      throw new Error('unexpected timeout fallback probes during wrong-type auth session runtime proof');
    },
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: wrongTypeAuthSessionBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => {
      throw new Error('unexpected snapshot-startup fallback preflight probe');
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9466,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', ['packaged smoke boot log']),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight returned an invalid readiness body at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );

  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged production plugin smoke readiness helper fails closed when signed preflight auth session is missing a status after snapshot readiness succeeds', async () => {
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const missingStatusAuthSessionBody = JSON.stringify({
    ok: true,
    routeProfile: {
      profile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      labBacked: false,
    },
    auth: {
      session: {
        id: 'session_123',
        type: 'production-auth-session',
        expiresAt: '2099-01-01T00:00:00Z',
      },
    },
    session: {
      id: 'session_123',
      type: 'production-auth-session',
    },
  });
  const fetchCalls = [];
  const helper = buildPackagedSmokeWaitHelper({
    packagedProductionPluginRouteStartupClassificationReady: () => {
      throw new Error('unexpected route startup classification during missing-status auth session runtime proof');
    },
    fetchPackagedWordPressIndexProbe: async () => {
      throw new Error('unexpected /wp-json/ probe during missing-status auth session runtime proof');
    },
    sleepUnlessChildExit: async () => {
      throw new Error('unexpected readiness sleep during missing-status auth session runtime proof');
    },
    fetchPackagedTimeoutFallbackProbes: async () => {
      throw new Error('unexpected timeout fallback probes during missing-status auth session runtime proof');
    },
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: missingStatusAuthSessionBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => {
      throw new Error('unexpected snapshot-startup fallback preflight probe');
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9466,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', ['packaged smoke boot log']),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight returned an invalid readiness body at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );

  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged production plugin smoke readiness helper fails closed when signed preflight auth session is revoked after snapshot readiness succeeds', async () => {
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const revokedAuthSessionBody = JSON.stringify({
    ok: true,
    routeProfile: {
      profile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      labBacked: false,
    },
    auth: {
      session: {
        id: 'session_123',
        status: 'revoked',
        type: 'production-auth-session',
        expiresAt: '2099-01-01T00:00:00Z',
      },
    },
    session: {
      id: 'session_123',
      type: 'production-auth-session',
    },
  });
  const fetchCalls = [];
  const helper = buildPackagedSmokeWaitHelper({
    packagedProductionPluginRouteStartupClassificationReady: () => {
      throw new Error('unexpected route startup classification during revoked auth session runtime proof');
    },
    fetchPackagedWordPressIndexProbe: async () => {
      throw new Error('unexpected /wp-json/ probe during revoked auth session runtime proof');
    },
    sleepUnlessChildExit: async () => {
      throw new Error('unexpected readiness sleep during revoked auth session runtime proof');
    },
    fetchPackagedTimeoutFallbackProbes: async () => {
      throw new Error('unexpected timeout fallback probes during revoked auth session runtime proof');
    },
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: revokedAuthSessionBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => {
      throw new Error('unexpected snapshot-startup fallback preflight probe');
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9466,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', ['packaged smoke boot log']),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight returned an invalid readiness body at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );

  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged production plugin smoke readiness helper fails closed when signed preflight auth session is explicitly revoked after snapshot readiness succeeds', async () => {
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const explicitlyRevokedAuthSessionBody = JSON.stringify({
    ok: true,
    routeProfile: {
      profile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      labBacked: false,
    },
    auth: {
      session: {
        id: 'session_123',
        status: 'active',
        type: 'production-auth-session',
        expiresAt: '2099-01-01T00:00:00Z',
        revoked: true,
      },
    },
    session: {
      id: 'session_123',
      type: 'production-auth-session',
    },
  });
  const fetchCalls = [];
  const helper = buildPackagedSmokeWaitHelper({
    packagedProductionPluginRouteStartupClassificationReady: () => {
      throw new Error('unexpected route startup classification during explicitly revoked auth session runtime proof');
    },
    fetchPackagedWordPressIndexProbe: async () => {
      throw new Error('unexpected /wp-json/ probe during explicitly revoked auth session runtime proof');
    },
    sleepUnlessChildExit: async () => {
      throw new Error('unexpected readiness sleep during explicitly revoked auth session runtime proof');
    },
    fetchPackagedTimeoutFallbackProbes: async () => {
      throw new Error('unexpected timeout fallback probes during explicitly revoked auth session runtime proof');
    },
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: explicitlyRevokedAuthSessionBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => {
      throw new Error('unexpected snapshot-startup fallback preflight probe');
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9466,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', ['packaged smoke boot log']),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight returned an invalid readiness body at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );

  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged production plugin smoke readiness helper fails closed when signed preflight auth session is explicitly rotated after snapshot readiness succeeds', async () => {
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const explicitlyRotatedAuthSessionBody = JSON.stringify({
    ok: true,
    routeProfile: {
      profile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      labBacked: false,
    },
    auth: {
      session: {
        id: 'session_123',
        status: 'active',
        type: 'production-auth-session',
        expiresAt: '2099-01-01T00:00:00Z',
        rotated: true,
      },
    },
    session: {
      id: 'session_123',
      type: 'production-auth-session',
    },
  });
  const fetchCalls = [];
  const helper = buildPackagedSmokeWaitHelper({
    packagedProductionPluginRouteStartupClassificationReady: () => {
      throw new Error('unexpected route startup classification during explicitly rotated auth session runtime proof');
    },
    fetchPackagedWordPressIndexProbe: async () => {
      throw new Error('unexpected /wp-json/ probe during explicitly rotated auth session runtime proof');
    },
    sleepUnlessChildExit: async () => {
      throw new Error('unexpected readiness sleep during explicitly rotated auth session runtime proof');
    },
    fetchPackagedTimeoutFallbackProbes: async () => {
      throw new Error('unexpected timeout fallback probes during explicitly rotated auth session runtime proof');
    },
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: explicitlyRotatedAuthSessionBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => {
      throw new Error('unexpected snapshot-startup fallback preflight probe');
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9466,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', ['packaged smoke boot log']),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight returned an invalid readiness body at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );

  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged production plugin smoke readiness helper fails closed when signed preflight auth session is cleaned up after snapshot readiness succeeds', async () => {
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const cleanedUpAuthSessionBody = JSON.stringify({
    ok: true,
    routeProfile: {
      profile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      labBacked: false,
    },
    auth: {
      session: {
        id: 'session_123',
        status: 'active',
        type: 'production-auth-session',
        expiresAt: '2099-01-01T00:00:00Z',
        cleanedUp: true,
      },
    },
    session: {
      id: 'session_123',
      type: 'production-auth-session',
    },
  });
  const fetchCalls = [];
  const helper = buildPackagedSmokeWaitHelper({
    packagedProductionPluginRouteStartupClassificationReady: () => {
      throw new Error('unexpected route startup classification during cleaned-up auth session runtime proof');
    },
    fetchPackagedWordPressIndexProbe: async () => {
      throw new Error('unexpected /wp-json/ probe during cleaned-up auth session runtime proof');
    },
    sleepUnlessChildExit: async () => {
      throw new Error('unexpected readiness sleep during cleaned-up auth session runtime proof');
    },
    fetchPackagedTimeoutFallbackProbes: async () => {
      throw new Error('unexpected timeout fallback probes during cleaned-up auth session runtime proof');
    },
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: cleanedUpAuthSessionBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => {
      throw new Error('unexpected snapshot-startup fallback preflight probe');
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9466,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', ['packaged smoke boot log']),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight returned an invalid readiness body at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );

  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged production plugin smoke readiness helper fails closed when signed preflight auth session carries the cleanup alias after snapshot readiness succeeds', async () => {
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const cleanupAliasAuthSessionBody = JSON.stringify({
    ok: true,
    routeProfile: {
      profile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      labBacked: false,
    },
    auth: {
      session: {
        id: 'session_123',
        status: 'active',
        type: 'production-auth-session',
        expiresAt: '2099-01-01T00:00:00Z',
        cleanup: true,
      },
    },
    session: {
      id: 'session_123',
      type: 'production-auth-session',
    },
  });
  const fetchCalls = [];
  const helper = buildPackagedSmokeWaitHelper({
    packagedProductionPluginRouteStartupClassificationReady: () => {
      throw new Error('unexpected route startup classification during cleanup-alias auth session runtime proof');
    },
    fetchPackagedWordPressIndexProbe: async () => {
      throw new Error('unexpected /wp-json/ probe during cleanup-alias auth session runtime proof');
    },
    sleepUnlessChildExit: async () => {
      throw new Error('unexpected readiness sleep during cleanup-alias auth session runtime proof');
    },
    fetchPackagedTimeoutFallbackProbes: async () => {
      throw new Error('unexpected timeout fallback probes during cleanup-alias auth session runtime proof');
    },
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: cleanupAliasAuthSessionBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => {
      throw new Error('unexpected snapshot-startup fallback preflight probe');
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9466,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', ['packaged smoke boot log']),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight returned an invalid readiness body at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );

  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged production plugin smoke readiness helper fails closed when signed preflight auth session is expired after snapshot readiness succeeds', async () => {
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const expiredAuthSessionBody = JSON.stringify({
    ok: true,
    routeProfile: {
      profile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      labBacked: false,
    },
    auth: {
      session: {
        id: 'session_123',
        status: 'active',
        type: 'production-auth-session',
        expiresAt: '2000-01-01T00:00:00Z',
      },
    },
    session: {
      id: 'session_123',
      type: 'production-auth-session',
    },
  });
  const fetchCalls = [];
  const helper = buildPackagedSmokeWaitHelper({
    packagedProductionPluginRouteStartupClassificationReady: () => {
      throw new Error('unexpected route startup classification during expired auth session runtime proof');
    },
    fetchPackagedWordPressIndexProbe: async () => {
      throw new Error('unexpected /wp-json/ probe during expired auth session runtime proof');
    },
    sleepUnlessChildExit: async () => {
      throw new Error('unexpected readiness sleep during expired auth session runtime proof');
    },
    fetchPackagedTimeoutFallbackProbes: async () => {
      throw new Error('unexpected timeout fallback probes during expired auth session runtime proof');
    },
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: expiredAuthSessionBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => {
      throw new Error('unexpected snapshot-startup fallback preflight probe');
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9466,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', ['packaged smoke boot log']),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight returned an invalid readiness body at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );

  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged production plugin smoke readiness helper fails closed when signed preflight auth session has an invalid expiry after snapshot readiness succeeds', async () => {
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const invalidExpiryAuthSessionBody = JSON.stringify({
    ok: true,
    routeProfile: {
      profile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      labBacked: false,
    },
    auth: {
      session: {
        id: 'session_123',
        status: 'active',
        type: 'production-auth-session',
        expiresAt: 'not-a-date',
      },
    },
    session: {
      id: 'session_123',
      type: 'production-auth-session',
    },
  });
  const fetchCalls = [];
  const helper = buildPackagedSmokeWaitHelper({
    packagedProductionPluginRouteStartupClassificationReady: () => {
      throw new Error('unexpected route startup classification during invalid expiry auth session runtime proof');
    },
    fetchPackagedWordPressIndexProbe: async () => {
      throw new Error('unexpected /wp-json/ probe during invalid expiry auth session runtime proof');
    },
    sleepUnlessChildExit: async () => {
      throw new Error('unexpected readiness sleep during invalid expiry auth session runtime proof');
    },
    fetchPackagedTimeoutFallbackProbes: async () => {
      throw new Error('unexpected timeout fallback probes during invalid expiry auth session runtime proof');
    },
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: invalidExpiryAuthSessionBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => {
      throw new Error('unexpected snapshot-startup fallback preflight probe');
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9466,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', ['packaged smoke boot log']),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight returned an invalid readiness body at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );

  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged production plugin smoke readiness helper fails closed when signed preflight auth session is missing an expiry after snapshot readiness succeeds', async () => {
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const missingExpiryAuthSessionBody = JSON.stringify({
    ok: true,
    routeProfile: {
      profile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      labBacked: false,
    },
    auth: {
      session: {
        id: 'session_123',
        status: 'active',
        type: 'production-auth-session',
      },
    },
    session: {
      id: 'session_123',
      type: 'production-auth-session',
    },
  });
  const fetchCalls = [];
  const helper = buildPackagedSmokeWaitHelper({
    packagedProductionPluginRouteStartupClassificationReady: () => {
      throw new Error('unexpected route startup classification during missing expiry auth session runtime proof');
    },
    fetchPackagedWordPressIndexProbe: async () => {
      throw new Error('unexpected /wp-json/ probe during missing expiry auth session runtime proof');
    },
    sleepUnlessChildExit: async () => {
      throw new Error('unexpected readiness sleep during missing expiry auth session runtime proof');
    },
    fetchPackagedTimeoutFallbackProbes: async () => {
      throw new Error('unexpected timeout fallback probes during missing expiry auth session runtime proof');
    },
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: missingExpiryAuthSessionBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => {
      throw new Error('unexpected snapshot-startup fallback preflight probe');
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9466,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', ['packaged smoke boot log']),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight returned an invalid readiness body at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );

  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged production plugin smoke readiness helper fails closed when signed preflight returns an invalid readiness body while snapshot startup is still in progress', async () => {
  const snapshotStartupBody = JSON.stringify({
    code: 'rest_no_route',
    message: 'No route was found matching the URL and request method.',
  });
  const fetchCalls = [];
  const helper = buildPackagedSmokeWaitHelper({
    packagedProductionPluginRouteStartupClassificationReady: () => {
      throw new Error('unexpected route startup classification during snapshot-startup invalid signed-preflight runtime proof');
    },
    fetchPackagedWordPressIndexProbe: async () => {
      throw new Error('unexpected /wp-json/ probe during snapshot-startup invalid signed-preflight runtime proof');
    },
    sleepUnlessChildExit: async () => {
      throw new Error('unexpected readiness sleep during snapshot-startup invalid signed-preflight runtime proof');
    },
    fetchPackagedTimeoutFallbackProbes: async () => {
      throw new Error('unexpected timeout fallback probes during snapshot-startup invalid signed-preflight runtime proof');
    },
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 404,
            ok: false,
          },
          bodyText: snapshotStartupBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => ({
      route: '/wp-json/reprint/v1/push/preflight',
      status: 200,
      ok: true,
      body: JSON.stringify({
        ok: true,
        routeProfile: {
          profile: 'production-shaped',
          restNamespace: 'reprint/v1',
          routePrefix: '/push',
          labBacked: false,
        },
      }),
      parsedBody: null,
      ready: false,
      retryable: false,
      terminal: true,
    }),
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9466,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', ['packaged smoke boot log']),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight returned an invalid readiness body while snapshot still reported startup-shaped readiness at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );

  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
  ]);
});

test('packaged production plugin smoke readiness helper fails closed when signed preflight returns a terminal response while snapshot startup is still in progress', async () => {
  const snapshotStartupBody = JSON.stringify({
    code: 'rest_no_route',
    message: 'No route was found matching the URL and request method.',
  });
  const fetchCalls = [];
  const helper = buildPackagedSmokeWaitHelper({
    packagedProductionPluginRouteStartupClassificationReady: () => {
      throw new Error('unexpected route startup classification during snapshot-startup terminal signed-preflight runtime proof');
    },
    fetchPackagedWordPressIndexProbe: async () => {
      throw new Error('unexpected /wp-json/ probe during snapshot-startup terminal signed-preflight runtime proof');
    },
    sleepUnlessChildExit: async () => {
      throw new Error('unexpected readiness sleep during snapshot-startup terminal signed-preflight runtime proof');
    },
    fetchPackagedTimeoutFallbackProbes: async () => {
      throw new Error('unexpected timeout fallback probes during snapshot-startup terminal signed-preflight runtime proof');
    },
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 404,
            ok: false,
          },
          bodyText: snapshotStartupBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => ({
      route: '/wp-json/reprint/v1/push/preflight',
      status: 401,
      ok: false,
      body: JSON.stringify({
        code: 'rest_forbidden',
        message: 'forbidden',
      }),
      parsedBody: {
        code: 'rest_forbidden',
        message: 'forbidden',
      },
      ready: false,
      retryable: false,
      terminal: true,
    }),
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9467,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', ['packaged smoke boot log']),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight became terminal while snapshot still reported startup-shaped readiness at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );

  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
  ]);
});

test('packaged production plugin smoke readiness helper waits through global WordPress startup after snapshot readiness reaches signed preflight', async () => {
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const startupPreflightBody = JSON.stringify({
    code: 'rest_no_route',
    message: 'No route was found matching the URL and request method.',
  });
  const readyPreflightBody = JSON.stringify({
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
  });
  const fetchCalls = [];
  const sleepCalls = [];
  let preflightAttempts = 0;
  const helper = buildPackagedSmokeWaitHelper({
    packagedProductionPluginRouteStartupClassificationReady: () => true,
    packagedProductionPluginGlobalStartupStillWithinBudget: () => true,
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        preflightAttempts += 1;
        return {
          response: {
            status: preflightAttempts === 1 ? 404 : 200,
            ok: preflightAttempts !== 1,
          },
          bodyText: preflightAttempts === 1 ? startupPreflightBody : readyPreflightBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => {
      throw new Error('unexpected snapshot-startup fallback preflight probe');
    },
    fetchPackagedWordPressIndexProbe: async () => ({
      route: '/wp-json/',
      status: 503,
      ok: false,
      body: 'WordPress is not ready yet',
      parsedBody: null,
      ready: false,
      retryable: true,
      terminal: false,
    }),
    fetchPackagedTimeoutFallbackProbes: async () => {
      throw new Error('unexpected timeout fallback fetch in packaged smoke global-startup-after-preflight runtime proof');
    },
    sleepUnlessChildExit: async (ms, child) => {
      sleepCalls.push({ ms, child });
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9462,
  };

  await helper(child, 'http://127.0.0.1:65535', ['packaged smoke boot log']);

  assert.equal(sleepCalls.length, 1);
  assert.equal(sleepCalls[0].ms, 1);
  assert.equal(sleepCalls[0].child, child);
  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged production plugin smoke readiness helper fails closed when packaged-route startup exceeds the post-global-ready budget', async () => {
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const startupPreflightBody = JSON.stringify({
    code: 'rest_no_route',
    message: 'No route was found matching the URL and request method.',
  });
  const fetchCalls = [];
  const sleepCalls = [];
  const helper = buildPackagedSmokeWaitHelper({
    packagedProductionPluginRouteStartupClassificationReady: () => true,
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 404,
            ok: false,
          },
          bodyText: startupPreflightBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedPreflightProbe: async () => {
      throw new Error('unexpected snapshot-startup fallback preflight probe');
    },
    fetchPackagedWordPressIndexProbe: async () => ({
      route: '/wp-json/',
      status: 200,
      ok: true,
      body: JSON.stringify({ namespaces: ['reprint/v1'] }),
      parsedBody: {
        namespaces: ['reprint/v1'],
      },
      ready: true,
      retryable: false,
      terminal: false,
    }),
    sleepUnlessChildExit: async (ms, child) => {
      sleepCalls.push({ ms, child });
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9462,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', ['packaged smoke boot log']),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight stayed startup-shaped after global WordPress startup HTTP 200 for 4 consecutive responses \(limit 4\)/,
      );
      assert.match(error.message, /"packagedRouteStartup": true/);
      assert.match(error.message, /"preflightNotReadyProbeCount": 4/);
      return true;
    },
  );

  assert.equal(sleepCalls.length, 3);
  assert.deepEqual(
    sleepCalls.map(({ ms, child: sleptChild }) => ({ ms, child: sleptChild })),
    [
      { ms: 1, child },
      { ms: 1, child },
      { ms: 1, child },
    ],
  );
  assert.equal(fetchCalls.length, 8);
});

test('packaged production plugin smoke readiness helper preserves timeout fallback probes when signed preflight and /wp-json/ both time out', async () => {
  const timeoutError = new Error('Timed out fetching http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot after 100ms');
  timeoutError.name = 'TimeoutError';
  const timeoutFallbackProbes = {
    preflightProbe: {
      route: '/wp-json/reprint/v1/push/preflight',
      status: 0,
      ok: false,
      body: 'Timed out fetching http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight after 100ms',
      ready: false,
      retryable: false,
      terminal: false,
      timedOut: true,
    },
    indexProbe: {
      route: '/wp-json/',
      status: 0,
      ok: false,
      body: 'Timed out fetching http://127.0.0.1:65535/wp-json/ after 100ms',
      ready: false,
      retryable: false,
      terminal: false,
      timedOut: true,
    },
  };
  const helper = buildPackagedSmokeWaitHelper({
    fetchTextWithTimeout: async () => {
      throw timeoutError;
    },
    fetchPackagedTimeoutFallbackProbes: async () => timeoutFallbackProbes,
    packagedProductionPluginClassifyTimeoutFallbackStartup: () => ({
      kind: 'timed-out-route-index-timeout',
    }),
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9459,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', ['packaged smoke boot log']),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight probe timed out while \/wp-json\/ also timed out after the snapshot probe timed out/,
      );
      assert.match(
        error.message,
        /Last timeout fallback preflight route: \/wp-json\/reprint\/v1\/push\/preflight/,
      );
      assert.match(
        error.message,
        /Last timeout fallback index route: \/wp-json\//,
      );
      return true;
    },
  );
});

test('packaged production plugin smoke readiness helper waits through global-startup timeout fallback when signed preflight stays startup-shaped', async () => {
  const timeoutError = new Error('Timed out fetching http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot after 100ms');
  timeoutError.name = 'TimeoutError';
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const readyPreflightBody = JSON.stringify({
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
  });
  const timeoutFallbackProbes = {
    preflightProbe: {
      route: '/wp-json/reprint/v1/push/preflight',
      status: 404,
      ok: false,
      body: '{"code":"rest_no_route","message":"No route was found matching the URL and request method."}',
      parsedBody: {
        code: 'rest_no_route',
        message: 'No route was found matching the URL and request method.',
      },
      ready: false,
      retryable: true,
      terminal: false,
    },
    indexProbe: {
      route: '/wp-json/',
      status: 503,
      ok: false,
      body: 'WordPress is not ready yet',
      parsedBody: null,
      ready: false,
      retryable: true,
      terminal: false,
    },
  };
  const fetchCalls = [];
  const sleepCalls = [];
  let snapshotAttempts = 0;
  const helper = buildPackagedSmokeWaitHelper({
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        snapshotAttempts += 1;
        if (snapshotAttempts === 1) {
          throw timeoutError;
        }
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readyPreflightBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedTimeoutFallbackProbes: async () => timeoutFallbackProbes,
    sleepUnlessChildExit: async (ms, child) => {
      sleepCalls.push({ ms, child });
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9460,
  };

  await helper(child, 'http://127.0.0.1:65535', ['packaged smoke boot log']);

  assert.equal(sleepCalls.length, 1);
  assert.equal(sleepCalls[0].ms, 1);
  assert.equal(sleepCalls[0].child, child);
  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged production plugin smoke readiness helper waits through packaged-route startup timeout fallback when signed preflight stays startup-shaped', async () => {
  const timeoutError = new Error('Timed out fetching http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot after 100ms');
  timeoutError.name = 'TimeoutError';
  const readySnapshotBody = JSON.stringify({
    ok: true,
    snapshot: {},
  });
  const readyPreflightBody = JSON.stringify({
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
  });
  const timeoutFallbackProbes = {
    preflightProbe: {
      route: '/wp-json/reprint/v1/push/preflight',
      status: 404,
      ok: false,
      body: '{"code":"rest_no_route","message":"No route was found matching the URL and request method."}',
      parsedBody: {
        code: 'rest_no_route',
        message: 'No route was found matching the URL and request method.',
      },
      ready: false,
      retryable: true,
      terminal: false,
    },
    indexProbe: {
      route: '/wp-json/',
      status: 200,
      ok: true,
      body: '{"namespaces":["reprint/v1"],"routes":{"/reprint/v1/push/snapshot":{}}}',
      parsedBody: {
        namespaces: ['reprint/v1'],
        routes: {
          '/reprint/v1/push/snapshot': {},
        },
      },
      ready: true,
      retryable: false,
      terminal: false,
    },
  };
  const fetchCalls = [];
  const sleepCalls = [];
  let snapshotAttempts = 0;
  const helper = buildPackagedSmokeWaitHelper({
    fetchTextWithTimeout: async (url) => {
      fetchCalls.push(url);
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        snapshotAttempts += 1;
        if (snapshotAttempts === 1) {
          throw timeoutError;
        }
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readySnapshotBody,
        };
      }
      if (url.endsWith('/wp-json/reprint/v1/push/preflight')) {
        return {
          response: {
            status: 200,
            ok: true,
          },
          bodyText: readyPreflightBody,
        };
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedTimeoutFallbackProbes: async () => timeoutFallbackProbes,
    sleepUnlessChildExit: async (ms, child) => {
      sleepCalls.push({ ms, child });
    },
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9461,
  };

  await helper(child, 'http://127.0.0.1:65535', ['packaged smoke boot log']);

  assert.equal(sleepCalls.length, 1);
  assert.equal(sleepCalls[0].ms, 1);
  assert.equal(sleepCalls[0].child, child);
  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot',
    'http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight',
  ]);
});

test('packaged production plugin smoke readiness helper preserves timeout fallback probes when the snapshot probe times out and /wp-json/ becomes terminal', async () => {
  const timeoutError = new Error('Timed out fetching http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot after 100ms');
  timeoutError.name = 'TimeoutError';
  const timeoutFallbackProbes = {
    preflightProbe: {
      route: '/wp-json/reprint/v1/push/preflight',
      status: 404,
      ok: false,
      body: '{"code":"rest_no_route","message":"No route was found matching the URL and request method."}',
      parsedBody: {
        code: 'rest_no_route',
        message: 'No route was found matching the URL and request method.',
      },
      ready: false,
      retryable: true,
      terminal: false,
    },
    indexProbe: {
      route: '/wp-json/',
      status: 401,
      ok: false,
      body: '{"code":"rest_forbidden","message":"forbidden"}',
      parsedBody: {
        code: 'rest_forbidden',
        message: 'forbidden',
      },
      ready: false,
      retryable: false,
      terminal: true,
    },
  };
  const helper = buildPackagedSmokeWaitHelper({
    fetchTextWithTimeout: async () => {
      throw timeoutError;
    },
    fetchPackagedTimeoutFallbackProbes: async () => timeoutFallbackProbes,
    packagedProductionPluginClassifyTimeoutFallbackStartup: () => ({
      kind: 'retryable-route-index-terminal',
    }),
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9460,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', ['packaged smoke boot log']),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight stayed startup-shaped while \/wp-json\/ returned a terminal readiness failure HTTP 401 after the snapshot probe timed out/,
      );
      assert.match(
        error.message,
        /Last timeout fallback preflight route: \/wp-json\/reprint\/v1\/push\/preflight/,
      );
      assert.match(
        error.message,
        /Last timeout fallback index route: \/wp-json\//,
      );
      assert.match(
        error.message,
        /indexTerminal/,
      );
      return true;
    },
  );
});

test('packaged production plugin smoke readiness helper preserves index-timeout fallback probes when signed preflight stays startup-shaped', async () => {
  const timeoutError = new Error('Timed out fetching http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot after 100ms');
  timeoutError.name = 'TimeoutError';
  const timeoutFallbackProbes = {
    preflightProbe: {
      route: '/wp-json/reprint/v1/push/preflight',
      status: 404,
      ok: false,
      body: '{"code":"rest_no_route","message":"No route was found matching the URL and request method."}',
      parsedBody: {
        code: 'rest_no_route',
        message: 'No route was found matching the URL and request method.',
      },
      ready: false,
      retryable: true,
      terminal: false,
    },
    indexProbe: {
      route: '/wp-json/',
      status: 0,
      ok: false,
      body: 'Timed out fetching http://127.0.0.1:65535/wp-json/ after 100ms',
      ready: false,
      retryable: false,
      terminal: false,
      timedOut: true,
    },
  };
  const helper = buildPackagedSmokeWaitHelper({
    fetchTextWithTimeout: async () => {
      throw timeoutError;
    },
    fetchPackagedTimeoutFallbackProbes: async () => timeoutFallbackProbes,
    packagedProductionPluginClassifyTimeoutFallbackStartup: () => ({
      kind: 'retryable-route-index-timeout',
    }),
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9461,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', ['packaged smoke boot log']),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight stayed startup-shaped while \/wp-json\/ timed out after the snapshot probe timed out/,
      );
      assert.match(
        error.message,
        /Last timeout fallback preflight route: \/wp-json\/reprint\/v1\/push\/preflight/,
      );
      assert.match(
        error.message,
        /Last timeout fallback index route: \/wp-json\//,
      );
      assert.match(
        error.message,
        /indexProbeTimedOut/,
      );
      return true;
    },
  );
});

test('packaged production plugin smoke readiness helper preserves invalid timeout fallback probes when signed preflight times out and /wp-json/ returns an invalid body', async () => {
  const timeoutError = new Error('Timed out fetching http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot after 100ms');
  timeoutError.name = 'TimeoutError';
  const timeoutFallbackProbes = {
    preflightProbe: {
      route: '/wp-json/reprint/v1/push/preflight',
      status: 0,
      ok: false,
      body: 'Timed out fetching http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight after 100ms',
      ready: false,
      retryable: false,
      terminal: false,
      timedOut: true,
    },
    indexProbe: {
      route: '/wp-json/',
      status: 200,
      ok: true,
      body: '<!doctype html><html><body>not a REST index</body></html>',
      parsedBody: null,
      ready: false,
      retryable: false,
      terminal: true,
    },
  };
  const helper = buildPackagedSmokeWaitHelper({
    fetchTextWithTimeout: async () => {
      throw timeoutError;
    },
    fetchPackagedTimeoutFallbackProbes: async () => timeoutFallbackProbes,
    packagedProductionPluginClassifyTimeoutFallbackStartup: () => ({
      kind: 'timed-out-route-index-terminal',
    }),
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9460,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', ['packaged smoke boot log']),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight probe timed out while \/wp-json\/ returned an invalid readiness body after the snapshot probe timed out/,
      );
      assert.match(
        error.message,
        /Last timeout fallback preflight route: \/wp-json\/reprint\/v1\/push\/preflight/,
      );
      assert.match(
        error.message,
        /Last timeout fallback index route: \/wp-json\//,
      );
      assert.match(
        error.message,
        /invalidReadinessBody/,
      );
      return true;
    },
  );
});

test('packaged production plugin smoke readiness helper fails closed when signed preflight returns an invalid readiness body after the snapshot probe times out', async () => {
  const timeoutError = new Error('Timed out fetching http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot');
  const helper = buildPackagedSmokeWaitHelper({
    packagedProductionPluginClassifyTimeoutFallbackStartup: () => {
      throw new Error('unexpected timeout fallback startup classification during invalid signed-preflight runtime proof');
    },
    sleepUnlessChildExit: async () => {
      throw new Error('unexpected readiness sleep during timeout invalid signed-preflight runtime proof');
    },
    fetchTextWithTimeout: async (url) => {
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        throw timeoutError;
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedTimeoutFallbackProbes: async () => ({
      preflightProbe: {
        route: '/wp-json/reprint/v1/push/preflight',
        status: 200,
        ok: true,
        body: JSON.stringify({
          ok: true,
          routeProfile: {
            profile: 'production-shaped',
            restNamespace: 'reprint/v1',
            routePrefix: '/push',
            labBacked: false,
          },
        }),
        parsedBody: null,
        ready: false,
        retryable: false,
        terminal: true,
      },
      indexProbe: null,
    }),
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9467,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', ['packaged smoke boot log']),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight returned an invalid readiness body while the snapshot probe timed out at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );
});

test('packaged production plugin smoke readiness helper fails closed when signed preflight returns a terminal response after the snapshot probe times out', async () => {
  const timeoutError = new Error('Timed out fetching http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot');
  const helper = buildPackagedSmokeWaitHelper({
    packagedProductionPluginClassifyTimeoutFallbackStartup: () => {
      throw new Error('unexpected timeout fallback startup classification during terminal signed-preflight runtime proof');
    },
    sleepUnlessChildExit: async () => {
      throw new Error('unexpected readiness sleep during timeout terminal signed-preflight runtime proof');
    },
    fetchTextWithTimeout: async (url) => {
      if (url.endsWith('/wp-json/reprint/v1/push/snapshot')) {
        throw timeoutError;
      }
      throw new Error(`unexpected readiness fetch ${url}`);
    },
    fetchPackagedTimeoutFallbackProbes: async () => ({
      preflightProbe: {
        route: '/wp-json/reprint/v1/push/preflight',
        status: 401,
        ok: false,
        body: JSON.stringify({
          code: 'reprint_push_lab_auth_required',
          message: 'auth required',
        }),
        parsedBody: {
          code: 'reprint_push_lab_auth_required',
          message: 'auth required',
        },
        ready: false,
        retryable: false,
        terminal: true,
      },
      indexProbe: null,
    }),
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9468,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', ['packaged smoke boot log']),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight became terminal while the snapshot probe timed out at http:\/\/127\.0\.0\.1:65535/,
      );
      return true;
    },
  );
});

test('packaged production plugin smoke readiness helper preserves terminal timeout fallback probes when signed preflight times out and /wp-json/ returns a terminal body', async () => {
  const timeoutError = new Error('Timed out fetching http://127.0.0.1:65535/wp-json/reprint/v1/push/snapshot after 100ms');
  timeoutError.name = 'TimeoutError';
  const timeoutFallbackProbes = {
    preflightProbe: {
      route: '/wp-json/reprint/v1/push/preflight',
      status: 0,
      ok: false,
      body: 'Timed out fetching http://127.0.0.1:65535/wp-json/reprint/v1/push/preflight after 100ms',
      ready: false,
      retryable: false,
      terminal: false,
      timedOut: true,
    },
    indexProbe: {
      route: '/wp-json/',
      status: 401,
      ok: false,
      body: '{"code":"rest_forbidden","message":"forbidden"}',
      parsedBody: {
        code: 'rest_forbidden',
        message: 'forbidden',
      },
      ready: false,
      retryable: false,
      terminal: true,
    },
  };
  const helper = buildPackagedSmokeWaitHelper({
    fetchTextWithTimeout: async () => {
      throw timeoutError;
    },
    fetchPackagedTimeoutFallbackProbes: async () => timeoutFallbackProbes,
    packagedProductionPluginClassifyTimeoutFallbackStartup: () => ({
      kind: 'timed-out-route-index-terminal',
    }),
  });
  const child = {
    exitCode: null,
    signalCode: null,
    pid: 9461,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', ['packaged smoke boot log']),
    (error) => {
      assert.match(
        error.message,
        /Packaged production plugin signed preflight probe timed out while \/wp-json\/ returned a terminal readiness failure HTTP 401 after the snapshot probe timed out/,
      );
      assert.match(
        error.message,
        /Last timeout fallback preflight route: \/wp-json\/reprint\/v1\/push\/preflight/,
      );
      assert.match(
        error.message,
        /Last timeout fallback index route: \/wp-json\//,
      );
      assert.match(
        error.message,
        /indexTerminal/,
      );
      return true;
    },
  );
});

test('packaged production plugin smoke readiness helper fails fast on signaled child termination', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );
  const start = smokeSource.indexOf('async function waitForServer(child, baseUrl, logs) {');
  assert.notEqual(start, -1, 'expected packaged smoke readiness helper in smoke source');
  const end = smokeSource.indexOf(packagedReadinessHelperBoundary, start);
  assert.notEqual(end, -1, 'expected packaged smoke readiness helper boundary in smoke source');
  const helperSource = smokeSource.slice(start, end);

  assert.match(helperSource, /child\.exitCode !== null \|\| child\.signalCode !== null/);
  assert.match(helperSource, /terminated by \$\{child\.signalCode\}/);
});

test('packaged production plugin smoke readiness helper reports early child exit codes', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );
  const start = smokeSource.indexOf('async function waitForServer(child, baseUrl, logs) {');
  assert.notEqual(start, -1, 'expected packaged smoke readiness helper in smoke source');
  const end = smokeSource.indexOf(packagedReadinessHelperBoundary, start);
  assert.notEqual(end, -1, 'expected packaged smoke readiness helper boundary in smoke source');
  const helperSource = smokeSource.slice(start, end);

  assert.match(helperSource, /child\.exitCode !== null\s*\?\s*`exited early with \$\{child\.exitCode\}`\s*:\s*`terminated by \$\{child\.signalCode\}`/);
  assert.match(helperSource, /Playground server \$\{exitLabel\}/);
});

test('packaged production plugin smoke readiness helper fails closed when the Playground child exits before packaged probing completes', async () => {
  const helper = buildPackagedSmokeWaitHelper();
  const child = {
    exitCode: 23,
    signalCode: null,
    pid: 7123,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', ['packaged server boot log']),
    (error) => {
      assert.match(error.message, /Playground server exited early with 23/);
      assert.match(error.message, /packaged server boot log/);
      return true;
    },
  );
});

test('packaged production plugin smoke readiness helper fails closed when the Playground child is signaled before packaged probing completes', async () => {
  const helper = buildPackagedSmokeWaitHelper();
  const child = {
    exitCode: null,
    signalCode: 'SIGTERM',
    pid: 9451,
  };

  await assert.rejects(
    helper(child, 'http://127.0.0.1:65535', ['packaged server boot log']),
    (error) => {
      assert.match(error.message, /Playground server terminated by SIGTERM/);
      assert.match(error.message, /packaged server boot log/);
      return true;
    },
  );
});

test('packaged production plugin smoke readiness helper preserves timeout fallback probe details', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );
  const start = smokeSource.indexOf('async function waitForServer(child, baseUrl, logs) {');
  assert.notEqual(start, -1, 'expected packaged smoke readiness helper in smoke source');
  const end = smokeSource.indexOf(packagedReadinessHelperBoundary, start);
  assert.notEqual(end, -1, 'expected packaged smoke readiness helper boundary in smoke source');
  const helperSource = smokeSource.slice(start, end);

  assert.match(helperSource, /let lastTimeoutFallbackProbes = null;/);
  assert.match(helperSource, /lastTimeoutFallbackProbes = \{ preflightProbe, indexProbe \};/);
  assert.match(helperSource, /Last timeout fallback preflight route:/);
  assert.match(helperSource, /Last timeout fallback index route:/);
  assert.match(
    helperSource,
    /describePackagedReadinessFailure\(\s*lastProbes\.at\(-1\) \?\? null,\s*lastTimeoutFallbackProbes,\s*lastProbes,\s*context,\s*\)/,
  );
});

test('packaged release verifier readiness helper preserves timeout fallback probe details', () => {
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );
  const start = verifierSource.indexOf('async function waitForPackagedProductionPluginServer(child, baseUrl, getOutput) {');
  assert.notEqual(start, -1, 'expected packaged verifier readiness helper in verifier source');
  const end = verifierSource.indexOf(packagedReadinessHelperBoundary, start);
  assert.notEqual(end, -1, 'expected packaged verifier readiness helper boundary in verifier source');
  const helperSource = verifierSource.slice(start, end);

  assert.match(helperSource, /let lastTimeoutFallbackProbes = null;/);
  assert.match(helperSource, /lastTimeoutFallbackProbes = \{ preflightProbe, indexProbe \};/);
  assert.match(helperSource, /lastTimeoutFallbackProbes,\s*\);/);
  assert.match(verifierSource, /Timeout fallback probes: \$\{JSON\.stringify\(lastTimeoutFallbackProbes, null, 2\)\}/);
});

test('packaged release verifier readiness helper preserves bounded readiness probe history', () => {
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );
  const start = verifierSource.indexOf('async function waitForPackagedProductionPluginServer(child, baseUrl, getOutput) {');
  assert.notEqual(start, -1, 'expected packaged verifier readiness helper in verifier source');
  const end = verifierSource.indexOf(packagedReadinessHelperBoundary, start);
  assert.notEqual(end, -1, 'expected packaged verifier readiness helper boundary in verifier source');
  const helperSource = verifierSource.slice(start, end);

  assert.match(helperSource, /const lastProbes = \[\];/);
  assert.match(helperSource, /lastProbes\.push\(preflightProbe\);/);
  assert.match(helperSource, /lastProbes\.push\(indexProbe\);/);
  assert.match(helperSource, /writePlaygroundFailure\(message, lastProbes, getOutput\(\), lastError, lastTimeoutFallbackProbes\);/);
  assert.match(verifierSource, /Probe trail: \$\{JSON\.stringify\(lastProbes\.slice\(-4\), null, 2\)\}/);
  assert.match(verifierSource, /Last probe: \$\{JSON\.stringify\(/);
  assert.match(verifierSource, /Last route\/status\/body: \$\{JSON\.stringify\(/);
});

test('packaged production plugin smoke readiness helper preserves bounded readiness probe history', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );
  const start = smokeSource.indexOf('async function waitForServer(child, baseUrl, logs) {');
  assert.notEqual(start, -1, 'expected packaged smoke readiness helper in smoke source');
  const end = smokeSource.indexOf(packagedReadinessHelperBoundary, start);
  assert.notEqual(end, -1, 'expected packaged smoke readiness helper boundary in smoke source');
  const helperSource = smokeSource.slice(start, end);

  assert.match(helperSource, /const lastProbes = \[\];/);
  assert.match(helperSource, /lastProbes\.push\(preflightProbe\);/);
  assert.match(helperSource, /lastProbes\.push\(indexProbe\);/);
  assert.match(helperSource, /formatPackagedReadinessFailure\(/);
  assert.match(helperSource, /function describePackagedReadinessProbes\(lastProbes\)/);
  assert.match(helperSource, /Readiness probe \$\{index \+ 1\} route:/);
});

test('packaged readiness helper only treats the production namespace index as ready', () => {
  const productionOnlyIndex = JSON.stringify({
    namespaces: ['reprint/v1'],
    routes: {
      '/reprint/v1/push/snapshot': {},
    },
  });
  const labOnlyIndex = JSON.stringify({
    namespaces: ['reprint-push-lab/v1'],
    routes: {
      '/reprint-push-lab/v1/snapshot': {},
    },
  });
  const mixedIndex = JSON.stringify({
    namespaces: ['reprint/v1', 'reprint-push-lab/v1'],
    routes: {
      '/reprint/v1/push/snapshot': {},
      '/reprint-push-lab/v1/snapshot': {},
    },
  });

  assert.equal(packagedProductionPluginRestIndexReady(200, productionOnlyIndex), true);
  assert.equal(packagedProductionPluginRestIndexReady(200, labOnlyIndex), true);
  assert.equal(packagedProductionPluginRestIndexReady(200, mixedIndex), true);
  assert.equal(packagedProductionPluginRestIndexReady(200, '{"routes":[]}'), false);
  assert.equal(packagedProductionPluginRestIndexReady(502, productionOnlyIndex), false);
});

test('packaged readiness helper treats startup and malformed rest-index probes as retryable only while startup-shaped', () => {
  assert.equal(
    packagedProductionPluginRestIndexRetryable({
      status: 502,
      body: { code: 'wordpress_not_ready', message: 'WordPress is not ready yet' },
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginRestIndexRetryable({
      status: 404,
      body: { code: 'rest_no_route', message: 'No route was found matching the URL and request method.' },
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginRestIndexRetryable({
      status: 200,
      body: '{"routes":[]}',
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginRestIndexRetryable({
      status: 200,
      body: JSON.stringify({
        namespaces: ['reprint/v1'],
        routes: { '/reprint/v1/push/snapshot': {} },
      }),
    }),
    false,
  );
  assert.equal(
    packagedProductionPluginRestIndexRetryable({
      status: 401,
      body: { code: 'rest_forbidden', message: 'Sorry, you are not allowed to do that.' },
    }),
    false,
  );
});

test('packaged readiness fetch helpers abort probe fetches when the Playground child exits mid-probe', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );

  for (const source of [smokeSource, verifierSource]) {
    assert.match(source, /fetchWithTimeout\([^)]*child = null\)/);
    assert.match(source, /createChildExitWatcher\(child, url, controller\)/);
    assert.match(source, /error\.isPlaygroundReadinessFailure = true/);
    assert.match(source, /fetchPackagedWordPressIndexProbe\(baseUrl, child\)/);
  }
});

test('packaged readiness helpers keep response body reads inside the child-aware timeout wrapper', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );

  for (const source of [smokeSource, verifierSource]) {
    assert.match(source, /async function fetchTextWithTimeout\(url, init = \{\}, timeoutMs = [^,]+, child = null\)/);
    assert.match(source, /const bodyTextPromise = response\.text\(\)/);
    assert.match(source, /Promise\.race\(\[bodyTextPromise, childExitWatcher\.promise\]\)/);
    assert.match(source, /const \{ response: snapshot(?:Response)?, bodyText: snapshotText \} = await fetchTextWithTimeout\(/);
    assert.match(source, /const \{ response: preflight(?:Response)?, bodyText: preflightText \} = await fetchTextWithTimeout\(/);
  }
});

test('packaged readiness helpers do not sleep through child exits between probes', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );

  for (const source of [smokeSource, verifierSource]) {
    assert.match(source, /await sleepUnlessChildExit\(.*child\)/);
    assert.match(source, /function sleepUnlessChildExit\(ms, child\)/);
    assert.match(source, /child\.once\('exit', onExit\)/);
    assert.match(source, /child\.once\('close', onExit\)/);
  }
});

test('packaged readiness helpers fail fast when both the packaged route and /wp-json/ stay startup-shaped', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );

  for (const source of [smokeSource, verifierSource]) {
    assert.match(source, /stayed startup-shaped while \/wp-json\/ kept reporting global WordPress startup HTTP/);
    assert.doesNotMatch(source, /still waiting on global WordPress startup HTTP/);
  }
});

test('packaged release verifier tags packaged-route startup failures after global WordPress readiness', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );
  const smokeStart = smokeSource.indexOf('async function waitForServer(child, baseUrl, logs) {');
  assert.notEqual(smokeStart, -1, 'expected packaged smoke readiness helper in smoke source');
  const smokeEnd = smokeSource.indexOf(packagedReadinessHelperBoundary, smokeStart);
  assert.notEqual(smokeEnd, -1, 'expected packaged smoke readiness helper boundary in smoke source');
  const smokeHelperSource = smokeSource.slice(smokeStart, smokeEnd);
  const start = verifierSource.indexOf('async function waitForPackagedProductionPluginServer(child, baseUrl, getOutput) {');
  assert.notEqual(start, -1, 'expected packaged verifier readiness helper in verifier source');
  const end = verifierSource.indexOf(packagedReadinessHelperBoundary, start);
  assert.notEqual(end, -1, 'expected packaged verifier readiness helper boundary in verifier source');
  const helperSource = verifierSource.slice(start, end);

  assert.match(
    smokeHelperSource,
    /snapshot stayed startup-shaped while \/wp-json\/ kept reporting global WordPress startup HTTP[\s\S]*?packagedProductionPlugin:\s*true,\s*globalWordPressStartup:\s*true,\s*snapshotNotReadyProbeCount/s,
  );
  assert.match(
    smokeHelperSource,
    /snapshot stayed startup-shaped after global WordPress startup HTTP[\s\S]*?packagedProductionPlugin:\s*true,\s*packagedRouteStartup:\s*true,\s*snapshotNotReadyProbeCount/s,
  );
  assert.match(
    smokeHelperSource,
    /preflight stayed startup-shaped while \/wp-json\/ kept reporting global WordPress startup HTTP[\s\S]*?packagedProductionPlugin:\s*true,\s*globalWordPressStartup:\s*true,\s*preflightNotReadyProbeCount/s,
  );
  assert.match(
    smokeHelperSource,
    /preflight stayed startup-shaped after global WordPress startup HTTP[\s\S]*?packagedProductionPlugin:\s*true,\s*packagedRouteStartup:\s*true,\s*preflightNotReadyProbeCount/s,
  );
  assert.match(
    helperSource,
    /snapshot stayed startup-shaped after global WordPress startup HTTP[\s\S]*?packagedProductionPlugin:\s*true,\s*packagedRouteStartup:\s*true,\s*snapshotNotReadyProbeCount/s,
  );
  assert.match(
    helperSource,
    /preflight stayed startup-shaped after global WordPress startup HTTP[\s\S]*?packagedProductionPlugin:\s*true,\s*packagedRouteStartup:\s*true,\s*preflightNotReadyProbeCount/s,
  );
});

test('packaged readiness helpers retry bounded port collisions before failing startup', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );

  assert.match(smokeSource, /for \(let attempt = 1; attempt <= 3; attempt \+= 1\) \{/);
  assert.match(smokeSource, /if \(!\/EADDRINUSE\/i\.test\(combinedLogs\) \|\| attempt === 3\) \{/);
  assert.match(smokeSource, /Unable to start Playground server for \$\{name\} after retrying port collisions/);

  assert.match(verifierSource, /for \(let attempt = 1; attempt <= 3; attempt \+= 1\) \{/);
  assert.match(verifierSource, /if \(!\/EADDRINUSE\/i\.test\(logs\) \|\| attempt === 3\) \{/);
  assert.match(verifierSource, /Unable to start packaged Playground server for \$\{name\} after retrying port collisions/);
});

test('packaged readiness helpers reset snapshot startup counters before signed preflight probes', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );

  for (const source of [smokeSource, verifierSource]) {
    assert.match(
      source,
      /packagedProductionPluginResetRouteNotReadyProbeCounts\(\s*notReadyProbeCounts,\s*'snapshot',\s*\);[\s\S]*?(?:const\s+preflightProbe\s*=\s*await\s+fetchPackagedPreflightProbe|const\s+\{\s*response:\s*preflight|const\s+\{\s*response:\s*preflightResponse)/s,
    );
  }
});

test('packaged readiness helpers can accept signed preflight readiness before snapshot settles', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );

  for (const source of [smokeSource, verifierSource]) {
    assert.match(
      source,
      /const preflightProbe = await fetchPackagedPreflightProbe\(\s*baseUrl,\s*child(?:,\s*\{[\s\S]*?packagedStartup:\s*true[\s\S]*?\})?\s*\);/s,
    );
    assert.match(source, /if \(preflightProbe\.ready\) \{\s*return;\s*\}/);
    assert.match(source, /preflight became terminal while snapshot still reported startup-shaped readiness/);
  }

  assert.match(
    smokeSource,
    /packagedProductionPluginPreflightTerminalContext\([\s\S]*?snapshotStartupFallback:\s*true[\s\S]*?\)/s,
  );
  assert.match(
    verifierSource,
    /packagedProductionPluginPreflightTerminalContext\([\s\S]*?childPid:\s*child\.pid\s*\?\?\s*null[\s\S]*?snapshotStartupFallback:\s*true[\s\S]*?\)/s,
  );
});

test('packaged readiness helpers fall back to signed preflight and index probes after snapshot timeouts', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );

  for (const source of [smokeSource, verifierSource]) {
    assert.match(source, /if \(packagedProductionPluginReadinessProbeTimedOut\(error\)\) \{/);
    assert.match(source, /fetchPackagedTimeoutFallbackProbes\(/);
    assert.match(source, /packagedStartup:\s*true/);
    assert.match(source, /if \(preflightProbe\.ready\) \{\s*return;\s*\}/);
    assert.match(source, /packagedProductionPluginReadinessBodyRetryable\(indexProbe\?\.status, indexProbe\?\.body \|\| ''\)/);
    assert.match(
      source,
      /packagedProductionPluginPreflightRetryable\(\s*\{\s*status:\s*preflightProbe\.status,\s*body:\s*preflightProbe\.parsedBody \?\? preflightProbe\.body,\s*\},\s*\{\s*\.\.\.readinessContext,\s*indexProbe\s*\},\s*\)/s,
    );
    assert.match(source, /timeoutProbeCount = 0;\s*await sleepUnlessChildExit\(readinessProbeIntervalMs, child\);\s*continue;/);
  }
});

test('packaged readiness helpers emit phase breadcrumbs before bounded startup failures', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );

  assert.match(smokeSource, /probing packaged snapshot readiness at \$\{baseUrl\}/);
  assert.match(smokeSource, /snapshot is still startup-shaped; probing signed preflight readiness at \$\{baseUrl\}/);
  assert.match(smokeSource, /snapshot responded; probing signed preflight readiness at \$\{baseUrl\}/);
  assert.match(smokeSource, /snapshot probe timed out; falling back to signed preflight and \/wp-json\/ readiness probes at \$\{baseUrl\}/);

  assert.match(verifierSource, /\[production-shaped-release-verify\] \$\{message\}\\n/);
  assert.match(verifierSource, /probing packaged snapshot readiness at \$\{baseUrl\}/);
  assert.match(verifierSource, /snapshot is still startup-shaped; probing signed preflight readiness at \$\{baseUrl\}/);
  assert.match(verifierSource, /snapshot responded; probing signed preflight readiness at \$\{baseUrl\}/);
  assert.match(verifierSource, /snapshot probe timed out; falling back to signed preflight and \/wp-json\/ readiness probes at \$\{baseUrl\}/);
});

test('packaged readiness timeout fallback classifies global WordPress versus packaged-route startup', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );

  assert.match(
    smokeSource,
    /signed preflight stayed startup-shaped while \/wp-json\/ kept reporting global WordPress startup HTTP \$\{indexProbe[\s\S]*?for \$\{timeoutFallbackPreflightNotReadyProbeCount\} consecutive response\$\{timeoutFallbackPreflightNotReadyProbeCount === 1 \? '' : 's'\} \(limit \$\{maxPackagedStartupNotReadyProbeCount\}\) after the snapshot probe timed out/,
  );
  assert.match(
    smokeSource,
    /signed preflight probe timed out while \/wp-json\/ kept reporting global WordPress startup HTTP \$\{indexProbe\.status\} after the snapshot probe timed out/,
  );
  assert.match(
    smokeSource,
    /signed preflight stayed startup-shaped after global WordPress startup HTTP \$\{indexProbe[\s\S]*?for \$\{timeoutFallbackPreflightNotReadyProbeCount\} consecutive response\$\{timeoutFallbackPreflightNotReadyProbeCount === 1 \? '' : 's'\} \(limit \$\{maxPackagedRouteStartupAfterGlobalReadyProbes\}\) while the snapshot probe timed out/,
  );
  assert.match(
    smokeSource,
    /signed preflight stayed startup-shaped while \/wp-json\/ timed out after the snapshot probe timed out/,
  );
  assert.match(
    smokeSource,
    /signed preflight stayed startup-shaped while \/wp-json\/ kept reporting global WordPress startup HTTP \$\{indexProbe[\s\S]*?after the snapshot probe timed out[\s\S]*?globalWordPressStartup:\s*true[\s\S]*?preflightNotReadyProbeCount:\s*timeoutFallbackPreflightNotReadyProbeCount/s,
  );
  assert.match(
    smokeSource,
    /signed preflight probe timed out while \/wp-json\/ kept reporting global WordPress startup HTTP \$\{indexProbe\.status\} after the snapshot probe timed out[\s\S]*?globalWordPressStartup:\s*true/s,
  );
  assert.match(
    smokeSource,
    /signed preflight stayed startup-shaped after global WordPress startup HTTP \$\{indexProbe[\s\S]*?while the snapshot probe timed out[\s\S]*?packagedRouteStartup:\s*true[\s\S]*?preflightNotReadyProbeCount:\s*timeoutFallbackPreflightNotReadyProbeCount/s,
  );
  assert.match(
    smokeSource,
    /signed preflight stayed startup-shaped while \/wp-json\/ timed out after the snapshot probe timed out[\s\S]*?indexProbeTimedOut:\s*true/s,
  );
  assert.match(
    smokeSource,
    /signed preflight stayed startup-shaped while \/wp-json\/ returned a terminal readiness failure HTTP \$\{indexProbe(?:\?\.status \?\? 0|\.status)\} after the snapshot probe timed out[\s\S]*?indexTerminal:\s*true/s,
  );
  assert.match(
    smokeSource,
    /signed preflight probe timed out after global WordPress startup HTTP \$\{indexProbe\.status\} while the snapshot probe timed out[\s\S]*?packagedRouteStartup:\s*true/s,
  );
  assert.match(
    smokeSource,
    /signed preflight probe timed out while \/wp-json\/ returned a terminal readiness failure HTTP \$\{indexProbe\.status\} after the snapshot probe timed out[\s\S]*?indexTerminal:\s*true/s,
  );
  assert.match(
    smokeSource,
    /signed preflight probe timed out while \/wp-json\/ also timed out after the snapshot probe timed out[\s\S]*?indexProbeTimedOut:\s*true/s,
  );
  assert.match(
    smokeSource,
    /signed preflight stayed startup-shaped while \/wp-json\/ returned a terminal readiness failure HTTP \$\{indexProbe(?:\?\.status \?\? 0|\.status)\} after the snapshot probe timed out/,
  );
  assert.match(
    verifierSource,
    /signed preflight stayed startup-shaped while \/wp-json\/ kept reporting global WordPress startup HTTP \$\{indexProbe[\s\S]*?after the snapshot probe timed out[\s\S]*?globalWordPressStartup:\s*true[\s\S]*?preflightNotReadyProbeCount:\s*timeoutFallbackPreflightNotReadyProbeCount/s,
  );
  assert.match(
    verifierSource,
    /signed preflight probe timed out while \/wp-json\/ kept reporting global WordPress startup HTTP \$\{indexProbe\.status\} after the snapshot probe timed out[\s\S]*?globalWordPressStartup:\s*true/s,
  );
  assert.match(
    verifierSource,
    /signed preflight stayed startup-shaped after global WordPress startup HTTP \$\{indexProbe[\s\S]*?while the snapshot probe timed out[\s\S]*?packagedRouteStartup:\s*true[\s\S]*?preflightNotReadyProbeCount:\s*timeoutFallbackPreflightNotReadyProbeCount/s,
  );
  assert.match(
    verifierSource,
    /signed preflight stayed startup-shaped while \/wp-json\/ timed out after the snapshot probe timed out[\s\S]*?indexProbeTimedOut:\s*true/s,
  );
  assert.match(
    verifierSource,
    /signed preflight stayed startup-shaped while \/wp-json\/ returned a terminal readiness failure HTTP \$\{indexProbe(?:\?\.status \?\? 0|\.status)\} after the snapshot probe timed out[\s\S]*?indexTerminal:\s*true/s,
  );
  assert.match(
    verifierSource,
    /signed preflight probe timed out while \/wp-json\/ also timed out after the snapshot probe timed out[\s\S]*?indexProbeTimedOut:\s*true/s,
  );
  assert.match(
    verifierSource,
    /signed preflight probe timed out after global WordPress startup HTTP \$\{indexProbe\.status\} while the snapshot probe timed out[\s\S]*?packagedRouteStartup:\s*true/s,
  );
  assert.match(
    verifierSource,
    /signed preflight probe timed out while \/wp-json\/ returned a terminal readiness failure HTTP \$\{indexProbe\.status\} after the snapshot probe timed out[\s\S]*?indexTerminal:\s*true/s,
  );
  for (const source of [smokeSource, verifierSource]) {
    assert.match(
      source,
      /const timeoutFallbackPreflightNotReadyProbeCount =\s*\(notReadyProbeCounts\.preflight \?\? 0\) \+ 1;/,
    );
    assert.match(
      source,
      /notReadyProbeCounts = \{\s*\.\.\.notReadyProbeCounts,\s*preflight: timeoutFallbackPreflightNotReadyProbeCount,\s*\};/s,
    );
    assert.match(
      source,
      /packagedProductionPluginGlobalStartupStillWithinBudget\(\s*timeoutFallbackPreflightNotReadyProbeCount,\s*\)[\s\S]*?timeoutProbeCount = 0;\s*await sleepUnlessChildExit\(readinessProbeIntervalMs, child\);\s*continue;/s,
    );
    assert.match(
      source,
      /packagedProductionPluginPackagedRouteStartupStillWithinBudget\(\s*timeoutFallbackPreflightNotReadyProbeCount,\s*maxPackagedRouteStartupAfterGlobalReadyProbes,\s*\)[\s\S]*?timeoutProbeCount = 0;\s*await sleepUnlessChildExit\(readinessProbeIntervalMs, child\);\s*continue;/s,
    );
  }
  assert.match(
    smokeSource,
    /packagedProductionPluginResetRouteNotReadyProbeCounts\(\s*notReadyProbeCounts,\s*'preflight',\s*\)[\s\S]*?preflight became terminal while the snapshot probe timed out[\s\S]*?packagedProductionPluginPreflightTerminalContext\([\s\S]*?timeoutFallback:\s*true[\s\S]*?\)/s,
  );
  assert.match(
    smokeSource,
    /const malformedTimeoutFallbackPreflightBody =[\s\S]*?preflightProbe\.parsedBody === null[\s\S]*?!packagedProductionPluginReadinessBodyRetryable\([\s\S]*?preflightProbe\.status,[\s\S]*?preflightProbe\.body \|\| ''[\s\S]*?\)/s,
  );
  assert.match(
    smokeSource,
    /packagedProductionPluginResetRouteNotReadyProbeCounts\(\s*notReadyProbeCounts,\s*'preflight',\s*\)[\s\S]*?preflight returned an invalid readiness body while the snapshot probe timed out[\s\S]*?packagedProductionPluginPreflightTerminalContext\([\s\S]*?timeoutFallback:\s*true[\s\S]*?\)/s,
  );
  assert.match(
    smokeSource,
    /const malformedSnapshotFallbackPreflightBody =[\s\S]*?preflightProbe\.parsedBody === null[\s\S]*?!packagedProductionPluginReadinessBodyRetryable\([\s\S]*?preflightProbe\.status,[\s\S]*?preflightProbe\.body \|\| ''[\s\S]*?\)/s,
  );
  assert.match(
    smokeSource,
    /preflight returned an invalid readiness body while snapshot still reported startup-shaped readiness at \$\{baseUrl\}[\s\S]*?packagedProductionPluginResetRouteNotReadyProbeCounts\(\s*notReadyProbeCounts,\s*'preflight',\s*\)[\s\S]*?packagedProductionPluginPreflightTerminalContext\([\s\S]*?snapshotNotReadyProbeCount,[\s\S]*?invalidReadinessBody:\s*true[\s\S]*?snapshotStartupFallback:\s*true[\s\S]*?\)/s,
  );
  assert.match(
    verifierSource,
    /packagedProductionPluginResetRouteNotReadyProbeCounts\(\s*notReadyProbeCounts,\s*'preflight',\s*\)[\s\S]*?preflight became terminal while the snapshot probe timed out[\s\S]*?packagedProductionPluginPreflightTerminalContext\([\s\S]*?childPid:\s*child\.pid\s*\?\?\s*null[\s\S]*?timeoutFallback:\s*true[\s\S]*?\)/s,
  );
  assert.match(
    verifierSource,
    /const malformedTimeoutFallbackPreflightBody =[\s\S]*?preflightProbe\.parsedBody === null[\s\S]*?!packagedProductionPluginReadinessBodyRetryable\([\s\S]*?preflightProbe\.status,[\s\S]*?preflightProbe\.body \|\| ''[\s\S]*?\)/s,
  );
  assert.match(
    verifierSource,
    /packagedProductionPluginResetRouteNotReadyProbeCounts\(\s*notReadyProbeCounts,\s*'preflight',\s*\)[\s\S]*?preflight returned an invalid readiness body while the snapshot probe timed out[\s\S]*?packagedProductionPluginPreflightTerminalContext\([\s\S]*?childPid:\s*child\.pid\s*\?\?\s*null[\s\S]*?timeoutFallback:\s*true[\s\S]*?\)/s,
  );
  assert.match(
    verifierSource,
    /const malformedSnapshotFallbackPreflightBody =[\s\S]*?preflightProbe\.parsedBody === null[\s\S]*?!packagedProductionPluginReadinessBodyRetryable\([\s\S]*?preflightProbe\.status,[\s\S]*?preflightProbe\.body \|\| ''[\s\S]*?\)/s,
  );
  assert.match(
    verifierSource,
    /preflight returned an invalid readiness body while snapshot still reported startup-shaped readiness at \$\{baseUrl\}[\s\S]*?packagedProductionPluginResetRouteNotReadyProbeCounts\(\s*notReadyProbeCounts,\s*'preflight',\s*\)[\s\S]*?packagedProductionPluginPreflightTerminalContext\([\s\S]*?childPid:\s*child\.pid\s*\?\?\s*null[\s\S]*?snapshotNotReadyProbeCount,[\s\S]*?invalidReadinessBody:\s*true[\s\S]*?snapshotStartupFallback:\s*true[\s\S]*?\)/s,
  );
  assert.match(
    smokeSource,
    /signed preflight stayed startup-shaped while \/wp-json\/ returned a terminal readiness failure HTTP \$\{indexProbe(?:\?\.status \?\? 0|\.status)\}[\s\S]*?packagedProductionPluginPreflightTerminalContext\([\s\S]*?indexTerminal:\s*true/s,
  );
  assert.match(
    verifierSource,
    /signed preflight stayed startup-shaped while \/wp-json\/ returned a terminal readiness failure HTTP \$\{indexProbe(?:\?\.status \?\? 0|\.status)\}[\s\S]*?packagedProductionPluginPreflightTerminalContext\([\s\S]*?childPid:\s*child\.pid\s*\?\?\s*null[\s\S]*?indexTerminal:\s*true/s,
  );
  assert.match(
    smokeSource,
    /packagedProductionPluginPreflightTerminalContext\([\s\S]*?timeoutFallback:\s*true[\s\S]*?\)/s,
  );
  assert.match(
    verifierSource,
    /packagedProductionPluginPreflightTerminalContext\([\s\S]*?childPid:\s*child\.pid\s*\?\?\s*null[\s\S]*?timeoutFallback:\s*true[\s\S]*?\)/s,
  );
  assert.match(smokeSource, /packagedProductionPluginMalformedTerminalIndexProbe\(indexProbe\)/);
  assert.match(
    smokeSource,
    /returned an invalid readiness body after \$\{snapshotNotReadyProbeCount\} consecutive response[\s\S]*?invalidReadinessBody:\s*true[\s\S]*?indexTerminal:\s*true/s,
  );
  assert.match(
    smokeSource,
    /returned an invalid readiness body after \$\{preflightNotReadyProbeCount\} consecutive response[\s\S]*?invalidReadinessBody:\s*true[\s\S]*?indexTerminal:\s*true/s,
  );
  assert.match(
    smokeSource,
    /returned an invalid readiness body after the snapshot probe timed out at \$\{baseUrl\}[\s\S]*?invalidReadinessBody:\s*true[\s\S]*?indexTerminal:\s*true/s,
  );
  assert.match(verifierSource, /packagedProductionPluginMalformedTerminalIndexProbe\(indexProbe\)/);
  assert.match(
    verifierSource,
    /returned an invalid readiness body after \$\{snapshotNotReadyProbeCount\} consecutive response[\s\S]*?invalidReadinessBody:\s*true[\s\S]*?indexTerminal:\s*true/s,
  );
  assert.match(
    verifierSource,
    /returned an invalid readiness body after \$\{preflightNotReadyProbeCount\} consecutive response[\s\S]*?invalidReadinessBody:\s*true[\s\S]*?indexTerminal:\s*true/s,
  );
  assert.match(
    verifierSource,
    /returned an invalid readiness body after the snapshot probe timed out at \$\{baseUrl\}[\s\S]*?invalidReadinessBody:\s*true[\s\S]*?indexTerminal:\s*true/s,
  );
  assert.match(
    verifierSource,
    /preflight probe timed out while \/wp-json\/ returned an invalid readiness body after the snapshot probe timed out at \$\{baseUrl\}[\s\S]*?invalidReadinessBody:\s*true[\s\S]*?indexTerminal:\s*true/s,
  );
  assert.match(smokeSource, /packagedProductionPluginClassifyTimeoutFallbackStartup\(/);
  assert.match(verifierSource, /packagedProductionPluginClassifyTimeoutFallbackStartup\(/);
});

test('packaged readiness helper builds consistent preflight terminal context', () => {
  assert.deepEqual(
    packagedProductionPluginPreflightTerminalContext(
      { childPid: 123 },
      { snapshotStartupFallback: true },
    ),
    {
      childPid: 123,
      packagedProductionPlugin: true,
      preflightTerminal: true,
      snapshotStartupFallback: true,
    },
  );

  assert.deepEqual(
    packagedProductionPluginPreflightTerminalContext(
      {},
      { timeoutFallback: true },
    ),
    {
      packagedProductionPlugin: true,
      preflightTerminal: true,
      timeoutFallback: true,
    },
  );

  assert.deepEqual(
    packagedProductionPluginPreflightTerminalContext(
      {
        childPid: 456,
        indexTerminal: true,
        invalidReadinessBody: true,
      },
      { timeoutFallback: true },
    ),
    {
      childPid: 456,
      packagedProductionPlugin: true,
      preflightTerminal: true,
      indexTerminal: true,
      invalidReadinessBody: true,
      timeoutFallback: true,
    },
  );
});

test('packaged production plugin smoke preserves timeout fallback probes when legacy failure calls pass them in the context slot', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );

  assert.match(
    smokeSource,
    /lastTimeoutFallbackProbes === null[\s\S]*'preflightProbe' in context \|\| 'indexProbe' in context[\s\S]*lastTimeoutFallbackProbes = context;[\s\S]*context = null;/,
  );
});

test('release verifier preserves timeout fallback probes when legacy failure calls pass them in the context slot', () => {
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );

  assert.match(
    verifierSource,
    /lastTimeoutFallbackProbes === null[\s\S]*'preflightProbe' in context \|\| 'indexProbe' in context[\s\S]*lastTimeoutFallbackProbes = context;[\s\S]*context = null;/,
  );
});

test('packaged readiness timeout fallback classifier distinguishes terminal index failures', () => {
  assert.deepEqual(
    packagedProductionPluginClassifyBoundedStartup(
      { retryable: true, status: 503, body: 'WordPress is not ready yet' },
      { status: 500, body: 'Internal Server Error' },
    ),
    {
      kind: 'retryable-route-index-terminal',
      indexTerminal: true,
    },
  );

  assert.deepEqual(
    packagedProductionPluginClassifyTimeoutFallbackStartup(
      { retryable: true, status: 503, body: 'WordPress is not ready yet' },
      { status: 500, body: 'Internal Server Error' },
    ),
    {
      kind: 'retryable-route-index-terminal',
      indexTerminal: true,
    },
  );

  assert.deepEqual(
    packagedProductionPluginClassifyTimeoutFallbackStartup(
      { timedOut: true },
      { status: 500, body: 'Internal Server Error' },
    ),
    {
      kind: 'timed-out-route-index-terminal',
      indexTerminal: true,
    },
  );
});

test('packaged readiness helpers clear stale timeout fallback probes once the snapshot probe recovers', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );

  for (const source of [smokeSource, verifierSource]) {
    assert.match(
      source,
      /timeoutProbeCount = 0;\s*\/\/ A successful snapshot fetch supersedes any older timeout-fallback[\s\S]*?lastTimeoutFallbackProbes = null;/,
    );
  }
});

test('packaged bounded startup classifier distinguishes global WordPress versus packaged-route startup', () => {
  assert.deepEqual(
    packagedProductionPluginClassifyBoundedStartup(
      { retryable: true, status: 503, body: 'WordPress is not ready yet' },
      { status: 503, body: 'WordPress is not ready yet' },
    ),
    {
      kind: 'retryable-route-wordpress-starting',
      globalWordPressStartup: true,
    },
  );

  assert.deepEqual(
    packagedProductionPluginClassifyBoundedStartup(
      { retryable: true, status: 404, body: 'No route was found matching the URL and request method.' },
      { status: 200, body: '{"namespaces":["reprint/v1"]}' },
    ),
    {
      kind: 'retryable-route-packaged-route-starting',
      packagedRouteStartup: true,
    },
  );
  assert.deepEqual(
    packagedProductionPluginClassifyBoundedStartup(
      { retryable: true, status: 404, body: 'No route was found matching the URL and request method.' },
      { status: 200, body: '<!doctype html><html><body>not a REST index</body></html>', parsedBody: null },
    ),
    {
      kind: 'retryable-route-index-terminal',
      indexTerminal: true,
    },
  );

  assert.equal(
    packagedProductionPluginClassifyBoundedStartup(
      { retryable: false, status: 404, body: 'No route was found matching the URL and request method.' },
      { status: 503, body: 'WordPress is not ready yet' },
    ),
    null,
  );
});

test('packaged readiness startup classifiers consume the exported rest-index helper surface', () => {
  const helperSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/packaged-production-plugin-readiness.js'),
    'utf8',
  );

  assert.match(
    helperSource,
    /packagedProductionPluginRouteRetryableWhileWordPressStarting[\s\S]*?packagedProductionPluginRestIndexRetryable\(/s,
  );
  assert.match(
    helperSource,
    /packagedProductionPluginRouteRetryableWhilePackagedRouteStarting[\s\S]*?packagedProductionPluginRestIndexReady\([\s\S]*?!packagedProductionPluginRestIndexRetryable\(/s,
  );
  assert.match(
    helperSource,
    /packagedProductionPluginTimedOutRouteProbeWhileWordPressStarting[\s\S]*?packagedProductionPluginRestIndexRetryable\(/s,
  );
  assert.match(
    helperSource,
    /packagedProductionPluginTimedOutRouteProbeWhilePackagedRouteStarting[\s\S]*?packagedProductionPluginRestIndexReady\([\s\S]*?!packagedProductionPluginRestIndexRetryable\(/s,
  );
});

test('packaged readiness helpers treat signed preflight as the bootstrap authority before terminal snapshot auth failures', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );

  for (const source of [smokeSource, verifierSource]) {
    assert.match(source, /fetchPackagedPreflightProbe\(baseUrl, child(?:, \{[\s\S]*?packagedStartup:\s*true,[\s\S]*?snapshotProbe:[\s\S]*?\})?\)/s);
    assert.match(source, /if \(preflightProbe\.ready\) \{\s*return;\s*\}/);
    assert.match(source, /if \(preflightProbe\.retryable\) \{[\s\S]*?await sleepUnlessChildExit\(readinessProbeIntervalMs, child\);\s*continue;\s*\}/s);
    assert.match(source, /packagedProductionPluginSnapshotRetryable/s);
  }
});

test('packaged readiness helpers pass snapshot startup context into signed preflight probes', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );

  for (const source of [smokeSource, verifierSource]) {
    assert.match(
      source,
      /fetchPackagedPreflightProbe\(baseUrl, child, \{[\s\S]*?packagedStartup:\s*true,[\s\S]*?snapshotProbe:\s*\{[\s\S]*?status:\s*snapshot(?:Response)?\.status,[\s\S]*?body:\s*snapshotText,[\s\S]*?\}[\s\S]*?\}\)/s,
    );
    assert.match(
      source,
      /probe\.retryable = packagedProductionPluginPreflightRetryable\(\s*\{ status: response\.status, body \},\s*readinessContext,\s*\);/s,
    );
  }
});

test('packaged readiness helpers recompute parsed signed preflight retryability with the current index probe', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );

  for (const source of [smokeSource, verifierSource]) {
    assert.ok(
      source.includes('const packagedPreflightReadinessContext = {')
      && source.includes('packagedStartup: true')
      && source.includes('snapshotProbe: packagedProductionPluginSnapshotProbeContext(activeSnapshotProbe)'),
      'expected packaged signed preflight parsed-body path to keep an explicit readiness context',
    );
    assert.ok(
      source.includes("const indexProbe = await fetchPackagedWordPressIndexProbe(baseUrl, child).catch((indexError) =>")
      && source.includes("buildPackagedTimeoutFallbackProbe('/wp-json/', indexError)"),
      'expected packaged signed preflight parsed-body path to preserve index timeouts as bounded fallback probes',
    );
    assert.ok(
      source.includes('const preflightRetryableWithIndex = packagedProductionPluginPreflightRetryable('),
      'expected packaged signed preflight parsed-body path to recompute retryability with the current index probe',
    );
    assert.ok(
      source.includes('snapshotProbe: packagedProductionPluginSnapshotProbeContext(activeSnapshotProbe)')
      && source.includes('indexProbe,'),
      'expected packaged signed preflight parsed-body path to recheck against the current index probe while preserving snapshot timeout context',
    );
    assert.ok(
      source.includes('if (!preflightRetryableWithIndex) {'),
      'expected packaged signed preflight parsed-body path to fail closed when the recomputed retryability turns terminal',
    );
  }
});

test('packaged readiness helpers preserve bounded index timeout probes during snapshot startup fallback', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );

  for (const source of [smokeSource, verifierSource]) {
    assert.match(
      source,
      /snapshot is still startup-shaped; probing signed preflight readiness at \$\{baseUrl\}[\s\S]*?const indexProbe = await fetchPackagedWordPressIndexProbe\(baseUrl, child\)\.catch\(\(indexError\) =>[\s\S]*?buildPackagedTimeoutFallbackProbe\('\/wp-json\/', indexError\),[\s\S]*?\);/s,
    );
  }
});

test('packaged snapshot probe context preserves timed-out fallback probes', () => {
  assert.deepEqual(
    packagedProductionPluginSnapshotProbeContext({
      timedOut: true,
      status: undefined,
      body: '',
    }),
    {
      status: undefined,
      body: '',
      timedOut: true,
    },
  );
  assert.deepEqual(
    packagedProductionPluginSnapshotProbeContext({
      status: 404,
      body: 'No route was found matching the URL and request method.',
    }),
    {
      status: 404,
      body: 'No route was found matching the URL and request method.',
    },
  );
  assert.equal(packagedProductionPluginSnapshotProbeContext(null), null);
});

test('packaged readiness helpers keep packaged-route startup on the tighter post-global-startup budget', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );

  for (const source of [smokeSource, verifierSource]) {
    assert.match(
      source,
      /startupBranch\?\.kind === 'retryable-route-packaged-route-starting'[\s\S]*?packagedProductionPluginPackagedRouteStartupStillWithinBudget\([\s\S]*?await sleepUnlessChildExit\(readinessProbeIntervalMs, child\);[\s\S]*?continue;/s,
    );
  }
});

test('packaged snapshot startup fallback keeps the packaged-route post-global-ready budget after signed preflight turns terminal', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );

  for (const source of [smokeSource, verifierSource]) {
    assert.match(
      source,
      /signed preflight became terminal while snapshot still reported startup-shaped readiness at \$\{baseUrl\}[\s\S]*?startupBranch\?\.kind === 'retryable-route-packaged-route-starting'[\s\S]*?packagedProductionPluginPackagedRouteStartupStillWithinBudget\([\s\S]*?await sleepUnlessChildExit\(readinessProbeIntervalMs, child\);[\s\S]*?continue;/s,
    );
    assert.match(
      source,
      /signed preflight returned an invalid readiness body while snapshot still reported startup-shaped readiness at \$\{baseUrl\}[\s\S]*?startupBranch\?\.kind === 'retryable-route-packaged-route-starting'[\s\S]*?packagedProductionPluginPackagedRouteStartupStillWithinBudget\([\s\S]*?await sleepUnlessChildExit\(readinessProbeIntervalMs, child\);[\s\S]*?continue;/s,
    );
  }
});

test('packaged preflight retryability turns terminal once the live index probe shows startup is over', () => {
  const preflight = {
    status: 401,
    body: {
      code: 'reprint_push_lab_auth_required',
      message: 'Authenticated push routes require WordPress Application Password basic auth.',
    },
  };
  const terminalIndexProbe = {
    status: 500,
    body: 'Internal Server Error',
  };

  assert.equal(
    packagedProductionPluginPreflightRetryable(preflight, { packagedStartup: true }),
    true,
  );
  assert.equal(
    packagedProductionPluginPreflightRetryable(preflight, { indexProbe: terminalIndexProbe }),
    false,
  );
  assert.equal(
    packagedProductionPluginPreflightTerminal(preflight, { indexProbe: terminalIndexProbe }),
    true,
  );
});

test('packaged preflight retryability turns terminal once snapshot readiness has already succeeded', () => {
  const preflight = {
    status: 401,
    body: {
      code: 'reprint_push_lab_auth_required',
      message: 'Authenticated push routes require WordPress Application Password basic auth.',
    },
  };
  const readySnapshotProbe = {
    status: 200,
    body: JSON.stringify({
      ok: true,
      snapshot: {},
    }),
  };

  assert.equal(
    packagedProductionPluginPreflightRetryable(preflight, {
      packagedStartup: true,
      snapshotProbe: readySnapshotProbe,
    }),
    false,
  );
  assert.equal(
    packagedProductionPluginPreflightTerminal(preflight, {
      packagedStartup: true,
      snapshotProbe: readySnapshotProbe,
    }),
    true,
  );
});

test('packaged preflight retryability ignores timed-out index overrides and falls back to startup context', () => {
  const preflight = {
    status: 401,
    body: {
      code: 'reprint_push_lab_auth_required',
      message: 'Authenticated push routes require WordPress Application Password basic auth.',
    },
  };
  const startupSnapshotProbe = {
    status: 404,
    body: 'No route was found matching the URL and request method.',
  };

  assert.equal(
    packagedProductionPluginPreflightRetryable(preflight, {
      packagedStartup: true,
      snapshotProbe: startupSnapshotProbe,
      indexProbe: { timedOut: true },
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginPreflightTerminal(preflight, {
      packagedStartup: true,
      snapshotProbe: startupSnapshotProbe,
      indexProbe: { timedOut: true },
    }),
    false,
  );
});

test('packaged preflight retryability ignores timed-out snapshot overrides and falls back to startup context', () => {
  const preflight = {
    status: 401,
    body: {
      code: 'reprint_push_lab_auth_required',
      message: 'Authenticated push routes require WordPress Application Password basic auth.',
    },
  };

  assert.equal(
    packagedProductionPluginPreflightRetryable(preflight, {
      packagedStartup: true,
      snapshotProbe: { timedOut: true },
      indexProbe: { timedOut: true },
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginPreflightTerminal(preflight, {
      packagedStartup: true,
      snapshotProbe: { timedOut: true },
      indexProbe: { timedOut: true },
    }),
    false,
  );
});

test('packaged preflight retryability lets a live index probe override stale packaged-startup hints', () => {
  const preflight = {
    status: 401,
    body: {
      code: 'reprint_push_lab_auth_required',
      message: 'Authenticated push routes require WordPress Application Password basic auth.',
    },
  };
  const startupSnapshotProbe = {
    status: 404,
    body: 'No route was found matching the URL and request method.',
  };
  const terminalIndexProbe = {
    status: 200,
    body: '{"namespaces":["reprint/v1"]}',
  };
  const startupIndexProbe = {
    status: 503,
    body: 'WordPress is not ready yet',
  };

  assert.equal(
    packagedProductionPluginPreflightRetryable(preflight, {
      packagedStartup: true,
      snapshotProbe: startupSnapshotProbe,
      indexProbe: terminalIndexProbe,
    }),
    false,
  );
  assert.equal(
    packagedProductionPluginPreflightTerminal(preflight, {
      packagedStartup: true,
      snapshotProbe: startupSnapshotProbe,
      indexProbe: terminalIndexProbe,
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginPreflightRetryable(preflight, {
      packagedStartup: true,
      snapshotProbe: startupSnapshotProbe,
      indexProbe: startupIndexProbe,
    }),
    true,
  );
});

test('packaged readiness helpers pass the active snapshot probe into the first signed-preflight retryability check', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );

  for (const source of [smokeSource, verifierSource]) {
    assert.match(
      source,
      /const packagedPreflightReadinessContext = \{\s*packagedStartup: true,\s*snapshotProbe: packagedProductionPluginSnapshotProbeContext\(activeSnapshotProbe\),\s*\};/,
    );
  }
});

test('packaged preflight retryability keeps packaged-route startup retryable after global WordPress readiness', () => {
  const preflight = {
    status: 404,
    body: {
      code: 'rest_no_route',
      message: 'No route was found matching the URL and request method.',
    },
  };
  const readyIndexProbe = {
    status: 200,
    body: JSON.stringify({ namespaces: ['reprint/v1'] }),
  };

  assert.equal(
    packagedProductionPluginPreflightRetryable(preflight, {
      packagedStartup: true,
      indexProbe: readyIndexProbe,
    }),
    true,
  );
  assert.equal(
    packagedProductionPluginPreflightTerminal(preflight, {
      packagedStartup: true,
      indexProbe: readyIndexProbe,
    }),
    false,
  );
  assert.deepEqual(
    packagedProductionPluginClassifyBoundedStartup(
      {
        retryable: true,
        status: preflight.status,
        body: JSON.stringify(preflight.body),
      },
      readyIndexProbe,
    ),
    {
      kind: 'retryable-route-packaged-route-starting',
      packagedRouteStartup: true,
    },
  );
});

test('packaged timeout fallback helpers preserve packaged startup context for signed preflight probes', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );

  for (const source of [smokeSource, verifierSource]) {
    assert.match(
      source,
      /async function fetchPackagedTimeoutFallbackProbes\(baseUrl, child = null, readinessContext = \{\}\)/,
    );
    assert.match(
      source,
      /const preflightProbe = await fetchPackagedPreflightProbe\(baseUrl, child, readinessContext\)\.catch/,
    );
    assert.match(
      source,
      /packagedProductionPluginPreflightRetryable\(\s*\{\s*status: preflightProbe\.status,\s*body: preflightProbe\.parsedBody \?\? preflightProbe\.body,\s*\},\s*\{ \.\.\.readinessContext, indexProbe \},\s*\)/s,
    );
  }
});

test('packaged signed preflight startup branches use the timeout-fallback classifier when /wp-json/ may time out', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );

  for (const source of [smokeSource, verifierSource]) {
    assert.match(
      source,
      /const startupBranch = packagedProductionPluginClassifyTimeoutFallbackStartup\(\s*\{\s*retryable:\s*true,\s*status:\s*preflight(?:Response)?\.status,\s*body:\s*preflightText,\s*\},\s*indexProbe,\s*\)/s,
    );
  }
});

test('packaged readiness helpers keep bounded and timeout-fallback startup classifiers split by readiness path', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );

  for (const source of [smokeSource, verifierSource]) {
    const boundedStartupClassifierCount =
      (source.match(/packagedProductionPluginClassifyBoundedStartup\(/g) || []).length;
    const timeoutFallbackStartupClassifierCount =
      (source.match(/packagedProductionPluginClassifyTimeoutFallbackStartup\(/g) || []).length;

    assert.equal(boundedStartupClassifierCount, 6);
    assert.equal(timeoutFallbackStartupClassifierCount, 4);
  }
});

test('packaged readiness helpers distinguish signed preflight timeouts after snapshot responses from snapshot timeouts', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );

  for (const source of [smokeSource, verifierSource]) {
    assert.match(
      source,
      /activePackagedReadinessPhase === 'preflight' && activeSnapshotProbe !== null/,
    );
    assert.match(
      source,
      /signed preflight probe timed out after snapshot responded; probing \/wp-json\/ readiness at \$\{baseUrl\}/,
    );
    assert.match(
      source,
      /const preflightProbe = buildPackagedTimeoutFallbackProbe\('\/wp-json\/reprint\/v1\/push\/preflight', error\);/,
    );
    assert.match(
      source,
      /const indexProbe = await fetchPackagedWordPressIndexProbe\(baseUrl, child\)\.catch\(\(indexError\) =>\s*buildPackagedTimeoutFallbackProbe\('\/wp-json\/', indexError\),\s*\);/s,
    );
    assert.ok(
      source.includes('Packaged production plugin signed preflight probe timed out while /wp-json/ kept reporting global WordPress startup HTTP ${indexProbe?.status ?? 0} after ${activeSnapshotNotReadyProbeCount} consecutive startup-shaped snapshot response${activeSnapshotNotReadyProbeCount === 1 ? \'\' : \'s\'} at ${baseUrl}')
      || source.includes('Packaged production plugin signed preflight probe timed out while /wp-json/ kept reporting global WordPress startup HTTP ${indexProbe?.status ?? 0} after ${activeSnapshotNotReadyProbeCount} consecutive startup-shaped snapshot response${activeSnapshotNotReadyProbeCount === 1 ? "" : "s"} at ${baseUrl}'),
      'expected packaged signed preflight timeout branch to retain snapshot-count-aware global-startup diagnostics',
    );
    assert.ok(
      source.includes('Packaged production plugin signed preflight probe timed out after snapshot responded at ${baseUrl}'),
      'expected packaged signed preflight timeout branch to distinguish snapshot responses from snapshot timeouts',
    );
    assert.match(
      source,
      /signed preflight probe timed out while \/wp-json\/ returned an invalid readiness body after snapshot responded at \$\{baseUrl\}[\s\S]*?packagedProductionPluginPreflightTerminalContext\([\s\S]*?invalidReadinessBody:\s*true[\s\S]*?snapshotNotReadyProbeCount:\s*activeSnapshotNotReadyProbeCount[\s\S]*?timeoutFallback:\s*true[\s\S]*?\)/s,
    );
  }
});

test('packaged timeout fallback helpers preserve parsed preflight bodies when retryability is recomputed', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );

  for (const source of [smokeSource, verifierSource]) {
    assert.match(
      source,
      /const probe = \{[\s\S]*?body: bodyText\.slice\(0, readinessFailureBodyLimit\),[\s\S]*?parsedBody: null,[\s\S]*?ready: false/s,
    );
    assert.match(
      source,
      /if \(body !== null\) \{\s*probe\.parsedBody = body;\s*probe\.ready = packagedProductionPluginPreflightReady/s,
    );
    assert.match(
      source,
      /packagedProductionPluginPreflightRetryable\(\s*\{\s*status: preflightProbe\.status,\s*body: preflightProbe\.parsedBody \?\? preflightProbe\.body,\s*\},\s*\{ \.\.\.readinessContext, indexProbe \},\s*\)/s,
    );
  }
});

test('packaged smoke readiness helper fails closed on non-retryable route responses without waiting for classifier-specific terminal flags', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );
  const start = smokeSource.indexOf('async function waitForServer(child, baseUrl, logs) {');
  assert.notEqual(start, -1, 'expected packaged smoke readiness helper in smoke source');
  const end = smokeSource.indexOf(packagedReadinessHelperBoundary, start);
  assert.notEqual(end, -1, 'expected packaged smoke readiness helper boundary in smoke source');
  const helperSource = smokeSource.slice(start, end);

  assert.doesNotMatch(helperSource, /if \(packagedProductionPluginSnapshotTerminal/);
  assert.doesNotMatch(helperSource, /if \(packagedProductionPluginPreflightTerminal/);
  assert.match(
    helperSource,
    /packagedProductionPluginResetRouteNotReadyProbeCounts\(\s*notReadyProbeCounts,\s*'snapshot',\s*\);\s*throw new Error\(\s*formatPackagedReadinessFailure\(\s*`Packaged production plugin snapshot returned a terminal readiness failure at \$\{baseUrl\}`/s,
  );
  assert.match(
    helperSource,
    /packagedProductionPluginResetRouteNotReadyProbeCounts\(\s*notReadyProbeCounts,\s*'preflight',\s*\);\s*throw new Error\(\s*formatPackagedReadinessFailure\(\s*`Packaged production plugin signed preflight returned a terminal readiness failure at \$\{baseUrl\}`/s,
  );
  assert.match(
    helperSource,
    /snapshot stayed startup-shaped while \/wp-json\/ returned a terminal readiness failure HTTP \$\{indexProbe\.status\} after \$\{snapshotNotReadyProbeCount\} consecutive response/s,
  );
  assert.match(
    helperSource,
    /preflight stayed startup-shaped while \/wp-json\/ returned a terminal readiness failure HTTP \$\{indexProbe\.status\} after \$\{preflightNotReadyProbeCount\} consecutive response/s,
  );
  assert.match(
    helperSource,
    /Packaged production plugin signed preflight returned a terminal readiness failure at \$\{baseUrl\}[\s\S]*?packagedProductionPluginPreflightTerminalContext\(\{\}\)/s,
  );
  assert.match(
    helperSource,
    /Packaged production plugin signed preflight returned an invalid readiness body while snapshot still reported startup-shaped readiness at \$\{baseUrl\}/s,
  );
  assert.match(
    helperSource,
    /Packaged production plugin signed preflight became terminal while snapshot still reported startup-shaped readiness at \$\{baseUrl\}/s,
  );
  assert.match(
    helperSource,
    /Packaged production plugin signed preflight returned an invalid readiness body while the snapshot probe timed out at \$\{baseUrl\}/s,
  );
  assert.match(
    helperSource,
    /Packaged production plugin signed preflight became terminal while the snapshot probe timed out at \$\{baseUrl\}/s,
  );
  assert.doesNotMatch(
    helperSource,
    /Packaged production plugin preflight returned an invalid readiness body while snapshot still reported startup-shaped readiness at \$\{baseUrl\}/s,
  );
  assert.doesNotMatch(
    helperSource,
    /Packaged production plugin preflight became terminal while snapshot still reported startup-shaped readiness at \$\{baseUrl\}/s,
  );
  assert.doesNotMatch(
    helperSource,
    /Packaged production plugin preflight returned a terminal readiness failure at \$\{baseUrl\}/s,
  );
  assert.doesNotMatch(
    helperSource,
    /Packaged production plugin preflight returned an invalid readiness body while the snapshot probe timed out at \$\{baseUrl\}/s,
  );
  assert.doesNotMatch(
    helperSource,
    /Packaged production plugin preflight became terminal while the snapshot probe timed out at \$\{baseUrl\}/s,
  );
  assert.match(
    helperSource,
    /if \(!preflightRetryableWithIndex\) \{[\s\S]*?const malformedIndexBody =[\s\S]*?Packaged production plugin signed preflight stayed startup-shaped while \/wp-json\/ returned an invalid readiness body after \$\{preflightNotReadyProbeCount\} consecutive response\$\{preflightNotReadyProbeCount === 1 \? '' : 's'\} at \$\{baseUrl\}[\s\S]*?invalidReadinessBody:\s*true[\s\S]*?indexTerminal:\s*true[\s\S]*?preflightNotReadyProbeCount,/s,
  );
  assert.match(
    helperSource,
    /if \(!preflightRetryableWithIndex\) \{[\s\S]*?Packaged production plugin signed preflight stayed startup-shaped while \/wp-json\/ returned a terminal readiness failure HTTP \$\{indexProbe\.status\} after \$\{preflightNotReadyProbeCount\} consecutive response\$\{preflightNotReadyProbeCount === 1 \? '' : 's'\} at \$\{baseUrl\}/s,
  );
  assert.match(
    helperSource,
    /Packaged production plugin signed preflight stayed startup-shaped while \/wp-json\/ returned a terminal readiness failure HTTP \$\{indexProbe(?:\?\.status \?\? 0|\.status)\}[\s\S]*?packagedProductionPluginPreflightTerminalContext\([\s\S]*?indexTerminal:\s*true/s,
  );
});

test('packaged release verifier readiness helper fails closed on non-retryable route responses without waiting for classifier-specific terminal flags', () => {
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );
  const start = verifierSource.indexOf('async function waitForPackagedProductionPluginServer(child, baseUrl, getOutput) {');
  assert.notEqual(start, -1, 'expected packaged verifier readiness helper in verifier source');
  const end = verifierSource.indexOf(packagedReadinessHelperBoundary, start);
  assert.notEqual(end, -1, 'expected packaged verifier readiness helper boundary in verifier source');
  const helperSource = verifierSource.slice(start, end);

  assert.doesNotMatch(helperSource, /if \(packagedProductionPluginSnapshotTerminal/);
  assert.doesNotMatch(helperSource, /if \(packagedProductionPluginPreflightTerminal/);
  assert.match(
    helperSource,
    /packagedProductionPluginResetRouteNotReadyProbeCounts\(\s*notReadyProbeCounts,\s*'snapshot',\s*\);\s*await throwPlaygroundReadinessFailure\(\s*child,\s*`Packaged production plugin snapshot returned a terminal readiness failure at \$\{baseUrl\}/s,
  );
  assert.match(
    helperSource,
    /packagedProductionPluginResetRouteNotReadyProbeCounts\(\s*notReadyProbeCounts,\s*'preflight',\s*\);\s*await throwPlaygroundReadinessFailure\(\s*child,\s*`Packaged production plugin signed preflight returned a terminal readiness failure at \$\{baseUrl\}/s,
  );
  assert.match(
    helperSource,
    /Packaged production plugin signed preflight returned a terminal readiness failure at \$\{baseUrl\}[\s\S]*?packagedProductionPluginPreflightTerminalContext\(\{\s*childPid:\s*child\.pid\s*\?\?\s*null,\s*\}\)/s,
  );
  assert.match(
    helperSource,
    /Packaged production plugin signed preflight returned an invalid readiness body while snapshot still reported startup-shaped readiness at \$\{baseUrl\}/s,
  );
  assert.match(
    helperSource,
    /Packaged production plugin signed preflight became terminal while snapshot still reported startup-shaped readiness at \$\{baseUrl\}/s,
  );
  assert.match(
    helperSource,
    /Packaged production plugin signed preflight returned an invalid readiness body while the snapshot probe timed out at \$\{baseUrl\}/s,
  );
  assert.match(
    helperSource,
    /Packaged production plugin signed preflight became terminal while the snapshot probe timed out at \$\{baseUrl\}/s,
  );
  assert.doesNotMatch(
    helperSource,
    /Packaged production plugin preflight returned an invalid readiness body while snapshot still reported startup-shaped readiness at \$\{baseUrl\}/s,
  );
  assert.doesNotMatch(
    helperSource,
    /Packaged production plugin preflight became terminal while snapshot still reported startup-shaped readiness at \$\{baseUrl\}/s,
  );
  assert.doesNotMatch(
    helperSource,
    /Packaged production plugin preflight returned a terminal readiness failure at \$\{baseUrl\}/s,
  );
  assert.doesNotMatch(
    helperSource,
    /Packaged production plugin preflight returned an invalid readiness body while the snapshot probe timed out at \$\{baseUrl\}/s,
  );
  assert.doesNotMatch(
    helperSource,
    /Packaged production plugin preflight became terminal while the snapshot probe timed out at \$\{baseUrl\}/s,
  );
  assert.match(
    helperSource,
    /if \(!preflightRetryableWithIndex\) \{[\s\S]*?const malformedIndexBody =[\s\S]*?Packaged production plugin signed preflight stayed startup-shaped while \/wp-json\/ returned an invalid readiness body after \$\{preflightNotReadyProbeCount\} consecutive response\$\{preflightNotReadyProbeCount === 1 \? '' : 's'\} at \$\{baseUrl\}[\s\S]*?invalidReadinessBody:\s*true[\s\S]*?indexTerminal:\s*true[\s\S]*?preflightNotReadyProbeCount,/s,
  );
  assert.match(
    helperSource,
    /if \(!preflightRetryableWithIndex\) \{[\s\S]*?Packaged production plugin signed preflight stayed startup-shaped while \/wp-json\/ returned a terminal readiness failure HTTP \$\{indexProbe\.status\} after \$\{preflightNotReadyProbeCount\} consecutive response\$\{preflightNotReadyProbeCount === 1 \? '' : 's'\} at \$\{baseUrl\}/s,
  );
  assert.match(
    helperSource,
    /Packaged production plugin signed preflight stayed startup-shaped while \/wp-json\/ returned a terminal readiness failure HTTP \$\{indexProbe(?:\?\.status \?\? 0|\.status)\}[\s\S]*?packagedProductionPluginPreflightTerminalContext\([\s\S]*?childPid:\s*child\.pid\s*\?\?\s*null[\s\S]*?indexTerminal:\s*true/s,
  );
  assert.match(
    helperSource,
    /snapshot stayed startup-shaped while \/wp-json\/ returned a terminal readiness failure HTTP \$\{indexProbe\.status\} after \$\{snapshotNotReadyProbeCount\} consecutive response[\s\S]*?await throwPlaygroundReadinessFailure\(\s*child,/s,
  );
  assert.match(
    helperSource,
    /preflight stayed startup-shaped while \/wp-json\/ returned a terminal readiness failure HTTP \$\{indexProbe\.status\} after \$\{preflightNotReadyProbeCount\} consecutive response[\s\S]*?await throwPlaygroundReadinessFailure\(\s*child,/s,
  );
  assert.match(
    helperSource,
    /Packaged production plugin snapshot returned an invalid readiness body at \$\{baseUrl\}/s,
  );
  assert.match(
    helperSource,
    /notReadyProbeCounts = packagedProductionPluginResetRouteNotReadyProbeCounts\(\s*notReadyProbeCounts,\s*'snapshot',\s*\);\s*await throwPlaygroundReadinessFailure\(\s*child,\s*`Packaged production plugin snapshot returned an invalid readiness body at \$\{baseUrl\}`/s,
  );
  assert.match(
    helperSource,
    /Packaged production plugin signed preflight returned an invalid readiness body at \$\{baseUrl\}/s,
  );
  assert.match(
    helperSource,
    /notReadyProbeCounts = packagedProductionPluginResetRouteNotReadyProbeCounts\(\s*notReadyProbeCounts,\s*'preflight',\s*\);\s*await throwPlaygroundReadinessFailure\(\s*child,\s*`Packaged production plugin signed preflight returned an invalid readiness body at \$\{baseUrl\}`/s,
  );
  assert.match(
    helperSource,
    /Packaged production plugin signed preflight returned an invalid readiness body at \$\{baseUrl\}[\s\S]*?packagedProductionPluginPreflightTerminalContext\(\{[\s\S]*?childPid:\s*child\.pid\s*\?\?\s*null,[\s\S]*?invalidReadinessBody:\s*true[\s\S]*?\}\)/s,
  );
  assert.match(
    helperSource,
    /Packaged production plugin snapshot hit the bounded readiness failure after \$\{snapshotNotReadyProbeCount\} consecutive startup-shaped response/s,
  );
  assert.match(
    helperSource,
    /Packaged production plugin signed preflight hit the bounded readiness failure after \$\{preflightNotReadyProbeCount\} consecutive startup-shaped response/s,
  );
  assert.match(
    helperSource,
    /Packaged production plugin readiness hit \$\{timeoutProbeCount\} consecutive probe timeout\$\{timeoutProbeCount === 1 \? '' : 's'\}/s,
  );
});

test('packaged readiness helper inventories keep verifier and smoke runtime branches aligned', () => {
  const proofSource = readFileSync(
    path.join(repoRoot, 'test/production-shaped-proof.test.js'),
    'utf8',
  );
  const releasePrefix = 'packaged release verifier readiness helper ';
  const smokePrefixes = [
    'packaged production plugin smoke readiness helper ',
    'packaged smoke readiness helper ',
  ];
  const verifierInfrastructureOnly = new Set([
    'uses the provided output collector in wedged packaged-route failures',
    'fails fast on signaled child termination',
    'reports early child exit codes',
  ]);
  const runtimeBranchPattern = /(fails closed|keeps waiting|waits through|preserves timeout fallback probes)/;
  const names = [...proofSource.matchAll(/test\('([^']+)'/g)].map((match) => match[1]);
  const verifierBranches = new Set();
  const smokeBranches = new Set();

  for (const name of names) {
    if (name.startsWith(releasePrefix)) {
      const suffix = name.slice(releasePrefix.length);
      if (
        runtimeBranchPattern.test(suffix)
        && !verifierInfrastructureOnly.has(suffix)
      ) {
        verifierBranches.add(suffix);
      }
      continue;
    }

    const smokePrefix = smokePrefixes.find((prefix) => name.startsWith(prefix));
    if (!smokePrefix) {
      continue;
    }

    const suffix = name.slice(smokePrefix.length);
    if (runtimeBranchPattern.test(suffix)) {
      smokeBranches.add(suffix);
    }
  }

  assert.deepEqual(
    [...verifierBranches].sort(),
    [...smokeBranches].sort(),
  );
});

test('packaged smoke readiness helper formats malformed snapshot and preflight bodies as bounded readiness failures', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );
  const start = smokeSource.indexOf('async function waitForServer(child, baseUrl, logs) {');
  assert.notEqual(start, -1, 'expected packaged smoke readiness helper in smoke source');
  const end = smokeSource.indexOf(packagedReadinessHelperBoundary, start);
  assert.notEqual(end, -1, 'expected packaged smoke readiness helper boundary in smoke source');
  const helperSource = smokeSource.slice(start, end);

  assert.match(
    helperSource,
    /packagedProductionPluginResetRouteNotReadyProbeCounts\(\s*notReadyProbeCounts,\s*'snapshot',\s*\);\s*throw new Error\(\s*formatPackagedReadinessFailure\(\s*`Packaged production plugin snapshot returned an invalid readiness body at \$\{baseUrl\}`/s,
  );
  assert.match(
    helperSource,
    /Packaged production plugin signed preflight returned an invalid readiness body at \$\{baseUrl\}[\s\S]*?packagedProductionPluginResetRouteNotReadyProbeCounts\(\s*notReadyProbeCounts,\s*'preflight',\s*\)[\s\S]*?packagedProductionPluginPreflightTerminalContext\(\{[\s\S]*?invalidReadinessBody:\s*true[\s\S]*?\}\)/s,
  );
  assert.match(
    helperSource,
    /returned an invalid readiness body after \$\{snapshotNotReadyProbeCount\} consecutive response[\s\S]*?invalidReadinessBody:\s*true[\s\S]*?indexTerminal:\s*true/s,
  );
  assert.match(
    helperSource,
    /returned an invalid readiness body after \$\{preflightNotReadyProbeCount\} consecutive response[\s\S]*?invalidReadinessBody:\s*true[\s\S]*?indexTerminal:\s*true/s,
  );
  assert.match(
    helperSource,
    /returned an invalid readiness body after the snapshot probe timed out at \$\{baseUrl\}[\s\S]*?invalidReadinessBody:\s*true[\s\S]*?indexTerminal:\s*true/s,
  );
  assert.match(
    helperSource,
    /snapshot still reported startup-shaped readiness at \$\{baseUrl\}[\s\S]*?const indexProbe = await fetchPackagedWordPressIndexProbe\(baseUrl, child\)\.catch\(\(indexError\) =>[\s\S]*?buildPackagedTimeoutFallbackProbe\('\/wp-json\/', indexError\),[\s\S]*?\);/s,
  );
  assert.match(
    helperSource,
    /const indexProbe = await fetchPackagedWordPressIndexProbe\(baseUrl, child\)\.catch\(\(indexError\) =>[\s\S]*?buildPackagedTimeoutFallbackProbe\('\/wp-json\/', indexError\),[\s\S]*?\);[\s\S]*?preflight stayed startup-shaped while \/wp-json\/ kept reporting global WordPress startup HTTP/s,
  );
  assert.doesNotMatch(
    helperSource,
    /Expected JSON from GET \/wp-json\/reprint\/v1\/push\/snapshot/,
  );
  assert.doesNotMatch(
    helperSource,
    /Expected JSON from GET \/wp-json\/reprint\/v1\/push\/preflight/,
  );
});

test('packaged snapshot readiness helper enforces the bounded classifier before retryable preflight loops continue', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );
  const smokeStart = smokeSource.indexOf('if (!packagedProductionPluginServerReady({ snapshot: { status: snapshotResponse.status, body: snapshotBody } })) {');
  assert.notEqual(smokeStart, -1, 'expected packaged smoke snapshot readiness branch');
  const smokeEnd = smokeSource.indexOf('notReadyProbeCounts = packagedProductionPluginResetRouteNotReadyProbeCounts(', smokeStart);
  assert.notEqual(smokeEnd, -1, 'expected packaged smoke snapshot readiness branch boundary');
  const smokeBranch = smokeSource.slice(smokeStart, smokeEnd);
  assert.match(
    smokeBranch,
    /if \(\s*preflightProbe\.retryable\s*&&\s*packagedProductionPluginRouteStartupClassificationReady\(\s*snapshotNotReadyProbeCount,\s*\)\s*\)\s*\{[\s\S]*?fetchPackagedWordPressIndexProbe\(baseUrl, child\)[\s\S]*?retryable-route-wordpress-starting[\s\S]*?packagedProductionPluginGlobalStartupStillWithinBudget\(snapshotNotReadyProbeCount\)[\s\S]*?retryable-route-packaged-route-starting[\s\S]*?retryable-route-index-terminal[\s\S]*?Packaged production plugin snapshot hit the bounded readiness failure/s,
  );

  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );
  const verifierStart = verifierSource.indexOf('if (!packagedProductionPluginServerReady({');
  assert.notEqual(verifierStart, -1, 'expected packaged verifier snapshot readiness branch');
  const verifierEnd = verifierSource.indexOf('notReadyProbeCounts = packagedProductionPluginResetRouteNotReadyProbeCounts(', verifierStart);
  assert.notEqual(verifierEnd, -1, 'expected packaged verifier snapshot readiness branch boundary');
  const verifierBranch = verifierSource.slice(verifierStart, verifierEnd);
  assert.match(
    verifierBranch,
    /fetchPackagedWordPressIndexProbe\(baseUrl, child\)/,
  );
  assert.match(
    verifierBranch,
    /packagedProductionPluginGlobalStartupStillWithinBudget\(snapshotNotReadyProbeCount\)/,
  );
  assert.match(
    verifierBranch,
    /globalWordPressStartup:\s*true/s,
  );
  assert.match(
    verifierBranch,
    /packagedProductionPluginPackagedRouteStartupLimitReached\(\s*snapshotNotReadyProbeCount,\s*maxPackagedRouteStartupAfterGlobalReadyProbes,\s*\)/,
  );
  assert.match(
    verifierBranch,
    /packagedRouteStartup:\s*true/s,
  );
  assert.match(
    verifierBranch,
    /startupBranch\?\.kind === 'retryable-route-index-terminal'/,
  );
  assert.match(
    verifierBranch,
    /indexTerminal:\s*true/s,
  );
  assert.match(
    verifierBranch,
    /maxNotReadyProbeCount:\s*maxPackagedStartupNotReadyProbeCount/s,
  );
  assert.match(
    smokeSource,
    /preflightProbe\.retryable = packagedProductionPluginPreflightRetryable\(\s*\{\s*status:\s*preflightProbe\.status,\s*body:\s*preflightProbe\.parsedBody \?\? preflightProbe\.body,\s*\},\s*\{\s*\.\.\.readinessContext,\s*indexProbe\s*\},\s*\);/s,
  );
  assert.match(
    verifierSource,
    /preflightProbe\.retryable = packagedProductionPluginPreflightRetryable\(\s*\{\s*status:\s*preflightProbe\.status,\s*body:\s*preflightProbe\.parsedBody \?\? preflightProbe\.body,\s*\},\s*\{\s*\.\.\.readinessContext,\s*indexProbe\s*\},\s*\);/s,
  );
});

test('packaged readiness helpers keep a bounded widened route-startup budget after global WordPress readiness', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );

  for (const source of [smokeSource, verifierSource]) {
    assert.match(
      source,
      /const maxPackagedRouteStartupAfterGlobalReadyProbes = Math\.max\(\s*packagedProductionPluginMaxConsecutiveNotReadyProbes,\s*Math\.ceil\(15_000 \/ \((?:packagedServerFetchTimeoutMs|readinessProbeFetchTimeoutMs) \+ readinessProbeIntervalMs\)\),\s*\);/s,
    );
    assert.match(
      source,
      /function packagedProductionPluginGlobalStartupStillWithinBudget\(notReadyProbeCount\)/,
    );
    assert.match(
      source,
      /function packagedProductionPluginRouteStartupClassificationReady\(notReadyProbeCount\)/,
    );
    assert.match(
      source,
      /Packaged production plugin snapshot stayed startup-shaped after global WordPress startup HTTP[\s\S]*?limit \$\{maxPackagedRouteStartupAfterGlobalReadyProbes\}/s,
    );
    assert.match(
      source,
      /Packaged production plugin signed preflight stayed startup-shaped after global WordPress startup HTTP[\s\S]*?limit \$\{maxPackagedRouteStartupAfterGlobalReadyProbes\}/s,
    );
  }

  assert.match(
    verifierSource,
    /Packaged production plugin signed preflight stayed startup-shaped after global WordPress startup HTTP \$\{indexProbe\.status\} for \$\{preflightNotReadyProbeCount\} consecutive response\$\{preflightNotReadyProbeCount === 1 \? '' : 's'\} \(limit \$\{maxPackagedRouteStartupAfterGlobalReadyProbes\}\)[\s\S]*?packagedRouteStartup:\s*true[\s\S]*?preflightNotReadyProbeCount,/s,
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
    labSnapshotRetryable({
      status: 503,
      body: {
        error: {
          message: 'WordPress is not ready yet',
        },
      },
    }),
    true,
  );
  assert.equal(
    labSnapshotRetryable({
      status: 500,
      body: {
        details: {
          error: 'No route was found matching the URL and request method.',
        },
      },
    }),
    true,
  );
  assert.equal(
    labSnapshotRetryable({
      status: 503,
      body: {
        response: {
          errors: [
            {
              text: 'WordPress is not ready yet',
            },
          ],
        },
      },
    }),
    true,
  );
  assert.equal(
    labSnapshotRetryable({
      status: 503,
      body: {
        error: {
          code: 'wordpress_not_ready',
        },
      },
    }),
    true,
  );
  assert.equal(
    labSnapshotRetryable({
      status: 500,
      body: {
        details: {
          code: 'rest_no_route',
        },
      },
    }),
    true,
  );
  assert.equal(
    labSnapshotRetryable({
      status: 503,
      body: {
        payload: {
          issue: {
            errorCode: 'wordpress_not_ready',
          },
        },
      },
    }),
    true,
  );
  assert.equal(
    labSnapshotRetryable({
      status: 500,
      body: {
        payload: {
          issue: {
            error_code: 'rest_no_route',
          },
        },
      },
    }),
    true,
  );
  assert.equal(
    labSnapshotRetryable({
      status: 503,
      body: {
        warning: {
          response: {
            payload: {
              issue: {
                details: {
                  errorCode: 'wordpress_not_ready',
                },
              },
            },
          },
        },
      },
    }),
    true,
  );
  assert.equal(
    labSnapshotRetryable({
      status: 503,
      body: {
        warning: {
          response: {
            payload: {
              issue: {
                details: {
                  nested: {
                    errorCode: 'wordpress_not_ready',
                  },
                },
              },
            },
          },
        },
      },
    }),
    true,
  );
  assert.equal(
    labSnapshotRetryable({
      status: 500,
      body: {
        warning: {
          response: {
            payload: {
              issue: {
                details: {
                  error_description: 'No route was found matching the URL and request method.',
                },
              },
            },
          },
        },
      },
    }),
    true,
  );
  assert.equal(
    labSnapshotRetryable({
      status: 500,
      body: {
        warning: {
          response: {
            payload: {
              issue: {
                details: {
                  nested: {
                    error_description: 'No route was found matching the URL and request method.',
                  },
                },
              },
            },
          },
        },
      },
    }),
    true,
  );
  assert.equal(
    labSnapshotRetryable({
      status: 503,
      body: wrapNestedStartupValue(
        [
          'level01',
          'level02',
          'level03',
          'level04',
          'level05',
          'level06',
          'level07',
          'level08',
          'level09',
          'level10',
          'level11',
          'level12',
        ],
        { errorCode: 'wordpress_not_ready' },
      ),
    }),
    true,
  );
  const labCyclicStartupBody = {
    warning: null,
  };
  labCyclicStartupBody.warning = labCyclicStartupBody;
  labCyclicStartupBody.payload = {
    issue: {
      details: {
        error_description: 'No route was found matching the URL and request method.',
      },
    },
  };
  assert.equal(
    labSnapshotRetryable({
      status: 500,
      body: labCyclicStartupBody,
    }),
    true,
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
      503,
      '<!doctype html><html><body>WordPress is not ready yet</body></html>',
    ),
    true,
  );
  assert.equal(
    labReadinessBodyRetryable(
      500,
      '<!doctype html><html><body>No route was found matching the URL and request method.</body></html>',
    ),
    true,
  );
  assert.equal(
    labReadinessBodyRetryable(
      502,
      'Warning: startup wrapper\n{"error":{"code":"wordpress_not_ready"}}',
    ),
    true,
  );
  assert.equal(
    labReadinessBodyRetryable(
      404,
      'Notice: startup wrapper\n{"details":{"error_code":"rest_no_route"}}',
    ),
    true,
  );
  assert.equal(
    labReadinessBodyRetryable(
      200,
      '<!doctype html><html><body>WordPress is not ready yet</body></html>',
    ),
    true,
  );
  assert.equal(
    labReadinessBodyRetryable(
      200,
      'Warning: startup wrapper\n{"error":{"code":"wordpress_not_ready"}}',
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

  assert.deepEqual(
    evaluateProductionAuthSessionLifecycle({
      id: 'psh_01j00000000000000000000000',
      type: 'production-auth-session',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
      rotated: true,
    }),
    {
      ok: false,
      required: 'unrevoked',
      observed: 'rotated',
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
  const baseBlueprintPath = path.join(repoRoot, 'fixtures/playground/remote-base.blueprint.json');
  const localBlueprintPath = path.join(repoRoot, 'fixtures/playground/local-edited.blueprint.json');
  const remoteBlueprintPath = path.join(repoRoot, 'fixtures/playground/remote-changed.blueprint.json');
  const baseFixture = loadBlueprintSnapshotFixture('remote-base', baseBlueprintPath);
  const localFixture = loadBlueprintSnapshotFixture('local-edited', localBlueprintPath);
  const remoteFixture = loadBlueprintSnapshotFixture('remote-changed', remoteBlueprintPath);

  assert.equal(
    resolveBlueprintSnapshotFixturePath(baseBlueprintPath),
    path.join(repoRoot, 'fixtures/playground/remote-base.snapshot.json'),
  );
  assert.equal(
    resolveBlueprintSnapshotFixturePath(localBlueprintPath),
    path.join(repoRoot, 'fixtures/playground/local-edited.snapshot.json'),
  );
  assert.equal(
    resolveBlueprintSnapshotFixturePath(remoteBlueprintPath),
    path.join(repoRoot, 'fixtures/playground/remote-changed.snapshot.json'),
  );
  assert.equal(baseFixture.meta.fixture, 'remote-base');
  assert.equal(localFixture.meta.fixture, 'local-edited');
  assert.equal(remoteFixture.meta.fixture, 'remote-changed');
  assert.equal(baseFixture.db.wp_posts['ID:1001'].post_content, 'Base content from source');
  assert.equal(localFixture.db.wp_posts['ID:1001'].post_content, 'Local edited content');
  assert.equal(remoteFixture.db.wp_posts['ID:1001'].post_content, 'Remote edited content');
  assert.equal(baseFixture.files['wp-content/uploads/reprint-push/shared.txt'], 'base upload content');
  assert.equal(localFixture.files['wp-content/uploads/reprint-push/local-only.txt'], 'local-only upload content');
  assert.equal(remoteFixture.files['wp-content/uploads/reprint-push/remote-only.txt'], 'remote-only upload content');
});

test('production-shaped release verify reuses the tracked remote-base blueprint snapshot for packaged sources', () => {
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );

  assert.match(
    verifierSource,
    /const remoteBaseSnapshot = packagedSourceFixture\s*\?\s*exportSnapshotFromBlueprint\('remote-base', remoteBaseFixturePath\)\s*:\s*await exportSnapshot\('remote-base', liveSourceUrl\);/s,
  );
  assert.doesNotMatch(
    verifierSource,
    /const remoteBaseSnapshot = packagedSourceFixture\s*\?\s*await exportProductionSnapshot\('remote-base', liveSourceUrl\)/s,
  );
});

test('production-shaped release verify bounds fallback packaged blueprint snapshot exports', () => {
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );

  assert.match(
    verifierSource,
    /const packagedSnapshotExportTimeoutMs = 45_000;/,
  );
  assert.match(
    verifierSource,
    /timeout: packagedSnapshotExportTimeoutMs,\s*killSignal: 'SIGTERM',/s,
  );
  assert.match(
    verifierSource,
    /Playground snapshot export failed for \$\{name\}\$\{timeoutNote\}\\nSTDOUT:\\n\$\{result\.stdout\}\\nSTDERR:\\n\$\{result\.stderr\}\\n\$\{result\.error\.message\}/,
  );
});

test('packaged production plugin smoke derives the tracked fixture name from the blueprint path', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );

  assert.match(
    smokeSource,
    /const expectedFixture = path\.basename\(blueprintPath\)\.replace\(\/\\\.blueprint\\\.json\$\/u, ''\);/,
  );
  assert.match(
    smokeSource,
    /loadBlueprintSnapshotFixture\(expectedFixture, blueprintPath\)/,
  );
});

test('shared lab waitForServer probes snapshot even when /wp-json/ returns a startup-shaped HTTP 200 body', async () => {
  let indexCalls = 0;
  let snapshotCalls = 0;
  const server = createServer((request, response) => {
    if (request.url === '/wp-json/') {
      indexCalls += 1;
      response.statusCode = 200;
      if (indexCalls === 1) {
        response.setHeader('content-type', 'text/html; charset=utf-8');
        response.end('<!doctype html><html><body>WordPress is not ready yet</body></html>');
        return;
      }
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ namespaces: ['reprint-push-lab/v1'] }));
      return;
    }

    if (request.url === '/wp-json/reprint-push-lab/v1/snapshot') {
      snapshotCalls += 1;
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ ok: true, snapshot: {} }));
      return;
    }

    response.statusCode = 404;
    response.end('not found');
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object' && typeof address.port === 'number');

  try {
    await waitForServer(
      {
        exitCode: null,
        signalCode: null,
        pid: null,
      },
      `http://127.0.0.1:${address.port}`,
      () => '',
    );
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  assert.equal(indexCalls, 1);
  assert.equal(snapshotCalls, 1);
});

test('shared lab readiness helpers track consecutive timeout probes', () => {
  assert.equal(labMaxConsecutiveNotReadyProbes, 4);
  assert.equal(
    labReadinessProbeTimedOut(
      new Error('Timed out fetching http://127.0.0.1:9400/wp-json/'),
    ),
    true,
  );
  assert.equal(
    labReadinessProbeTimedOut(new Error('socket hang up')),
    false,
  );
  assert.equal(
    labNextTimeoutProbeCount(
      0,
      new Error('Timed out fetching http://127.0.0.1:9400/wp-json/'),
    ),
    1,
  );
  assert.equal(
    labNextTimeoutProbeCount(
      3,
      new Error('socket hang up'),
    ),
    0,
  );
  assert.equal(labNotReadyProbeLimitReached(labMaxConsecutiveNotReadyProbes - 1), false);
  assert.equal(labNotReadyProbeLimitReached(labMaxConsecutiveNotReadyProbes), true);
  assert.equal(labNotReadyProbeLimitReached(5, 6), false);
  assert.equal(labNotReadyProbeLimitReached(6, 6), true);
});

test('shared lab waitForServer keeps index and snapshot body reads child-aware', () => {
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );

  const sharedWaitStart = verifierSource.indexOf('async function waitForServer(child, baseUrl, getLogs) {');
  assert.notEqual(sharedWaitStart, -1, 'expected shared waitForServer helper in release verifier source');
  const sharedWaitEnd = verifierSource.indexOf('\nfunction describeLastProbe(', sharedWaitStart);
  assert.notEqual(sharedWaitEnd, -1, 'expected shared waitForServer helper boundary in release verifier source');
  const sharedWaitSource = verifierSource.slice(sharedWaitStart, sharedWaitEnd);

  assert.match(
    sharedWaitSource,
    /const \{ response, bodyText: responseBody \} = await fetchTextWithTimeout\([\s\S]*serverFetchTimeoutMs,\s*child\);/,
  );
  assert.match(
    sharedWaitSource,
    /\(\{\s*response:\s*snapshot,\s*bodyText:\s*snapshotBody\s*\}\s*=\s*await fetchTextWithTimeout\([\s\S]*serverFetchTimeoutMs,\s*child\)\);/,
  );
  assert.match(sharedWaitSource, /let timeoutProbeCount = 0;/);
  assert.match(sharedWaitSource, /let snapshotNotReadyProbeCount = 0;/);
  assert.match(sharedWaitSource, /timeoutProbeCount = 0;\s*const responsePreview = responseBody\.slice/);
  assert.match(sharedWaitSource, /timeoutProbeCount = 0;\s*const responsePreview = responseBody\.slice\(0, readinessFailureBodyLimit\);/);
  assert.match(sharedWaitSource, /timeoutProbeCount = 0;\s*const snapshotPreview = snapshotBody\.slice\(0, readinessFailureBodyLimit\);/);
  assert.match(sharedWaitSource, /timeoutProbeCount = labNextTimeoutProbeCount\(timeoutProbeCount, error\);/);
  assert.match(
    verifierSource,
    /const maxNotReadyReadinessProbes = Math\.max\(labMaxConsecutiveNotReadyProbes, maxReadinessProbes\);/,
  );
  assert.match(
    verifierSource,
    /const maxSnapshotStartupAfterGlobalReadyProbes = Math\.max\(\s*labMaxConsecutiveNotReadyProbes,\s*Math\.ceil\(15_000 \/ \(serverFetchTimeoutMs \+ readinessProbeIntervalMs\)\),\s*\);/s,
  );
  assert.match(
    verifierSource,
    /const maxSnapshotTimeoutFallbackProbes = Math\.max\(\s*labMaxConsecutiveNotReadyProbes,\s*Math\.ceil\(15_000 \/ \(serverFetchTimeoutMs \+ readinessProbeIntervalMs\)\),\s*\);/s,
  );
  assert.match(sharedWaitSource, /if \(labReadinessProbeTimedOut\(error\) && labNotReadyProbeLimitReached\(timeoutProbeCount\)\)/);
  assert.match(sharedWaitSource, /if \(labNotReadyProbeLimitReached\(notReadyProbeCount, maxNotReadyReadinessProbes\)\)/);
  assert.match(sharedWaitSource, /if \(labNotReadyProbeLimitReached\(snapshotTimeoutProbeCount, maxSnapshotTimeoutFallbackProbes\)\)/);
  assert.match(sharedWaitSource, /if \(response\.status !== 200 && readinessProbeCount >= maxReadinessProbes\)/);
  assert.match(
    sharedWaitSource,
    /Playground server reported the bounded readiness failure \$\{response\.status\} after \$\{readinessProbeCount\} \/wp-json\/ probes \(\$\{notReadyProbeCount\} consecutive not-ready response\$\{notReadyProbeCount === 1 \? '' : 's'\}; limit \$\{maxNotReadyReadinessProbes\}\)/,
  );
  assert.match(
    sharedWaitSource,
    /Playground server stayed in readiness response \$\{response\.status\} after \$\{readinessProbeCount\} \/wp-json\/ probes/,
  );
  assert.match(
    sharedWaitSource,
    /Playground lab snapshot stayed startup-shaped after global WordPress readiness HTTP \$\{response\.status\} for \$\{snapshotNotReadyProbeCount\} consecutive response\$\{snapshotNotReadyProbeCount === 1 \? '' : 's'\} \(limit \$\{maxSnapshotStartupAfterGlobalReadyProbes\}\)/,
  );
  assert.match(
    sharedWaitSource,
    /Playground index readiness HTTP \$\{response\.status\}: \$\{readinessHint\}; \$\{routeSummary\}/,
  );
  assert.match(sharedWaitSource, /notReadyProbeCount,\s*readinessProbeCount,/);
  assert.match(sharedWaitSource, /snapshotNotReadyProbeCount,\s*globalWordPressReady:\s*true,/);
  assert.match(sharedWaitSource, /childPid:\s*child\.pid\s*\?\?\s*null,\s*readinessProbeCount,/);
  assert.match(sharedWaitSource, /await sleepUnlessChildExit\(readinessProbeIntervalMs, child\)/);
  assert.doesNotMatch(sharedWaitSource, /await response\.arrayBuffer\(\)/);
  assert.doesNotMatch(sharedWaitSource, /await snapshot\.arrayBuffer\(\)/);
  assert.doesNotMatch(sharedWaitSource, /await new Promise\(\(resolve\) => setTimeout\(resolve, readinessProbeIntervalMs\)\)/);
});

test('shared lab waitForServer runtime helper keeps the readiness-exhaustion guard aligned', () => {
  const proofSource = readFileSync(
    path.join(repoRoot, 'test/production-shaped-proof.test.js'),
    'utf8',
  );

  const sharedWaitStart = proofSource.lastIndexOf('async function waitForServer(child, baseUrl, getLogs) {');
  assert.notEqual(sharedWaitStart, -1, 'expected shared waitForServer helper in proof test source');
  const sharedWaitEnd = proofSource.indexOf('\nfunction describeLastProbe(', sharedWaitStart);
  assert.notEqual(sharedWaitEnd, -1, 'expected shared waitForServer helper boundary in proof test source');
  const sharedWaitSource = proofSource.slice(sharedWaitStart, sharedWaitEnd);

  assert.match(
    sharedWaitSource,
    /if \(response\.status !== 200 && readinessProbeCount >= maxReadinessProbes\) \{/,
  );
  assert.match(
    sharedWaitSource,
    /const failureText = formatPlaygroundStartupFailure\([\s\S]*?childPid:\s*child\.pid\s*\?\?\s*null[\s\S]*?\);/s,
  );
});

test('release verifier keeps the extended shared Playground startup budget for remote-changed and local-edited', () => {
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );

  assert.match(
    verifierSource,
    /const serverStartupTimeoutMs = 120_000;/,
  );
  assert.match(
    verifierSource,
    /shared remote-changed\/local-edited fixtures routinely take[\s\S]*longer to clear global WordPress startup/,
  );
});

test('packaged production plugin smoke keeps the extended packaged startup budget aligned with release verify', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );

  assert.match(
    smokeSource,
    /const serverStartupTimeoutMs = 45_000;/,
  );
  assert.match(
    verifierSource,
    /const packagedPlaygroundTimeoutSeconds = 45;/,
  );
  assert.match(
    smokeSource,
    /packaged release verifier[\s\S]*does not fail early on the same bounded[\s\S]*readiness path/,
  );
});

test('packaged production plugin smoke reuses tracked blueprint snapshots before spawning expensive exports', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );

  assert.match(smokeSource, /import \{ loadBlueprintSnapshotFixture \} from '\.\/blueprint-snapshot-fixture\.js';/);
  assert.match(smokeSource, /const trackedSnapshot = loadBlueprintSnapshotFixture\([^,]+, blueprintPath\);/);
  assert.match(
    smokeSource,
    /if \(trackedSnapshot\) \{\s*writeStageProgress\(`using tracked snapshot fixture for \$\{[^}]+\}`\);\s*return trackedSnapshot;\s*\}/s,
  );
});

test('packaged production plugin smoke bounds snapshot exports and emits stage progress before startup probes', () => {
  const smokeSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs'),
    'utf8',
  );

  assert.match(smokeSource, /const snapshotExportTimeoutMs = 45_000;/);
  assert.match(smokeSource, /writeStageProgress\(`exporting snapshot fixture for \$\{name\}`\);/);
  assert.match(smokeSource, /timeout: snapshotExportTimeoutMs,\s*killSignal: 'SIGTERM',/s);
  assert.match(smokeSource, /writeStageProgress\(`starting packaged Playground server \$\{name\}`\);/);
});

test('shared lab waitForServer tolerates more than four startup-shaped /wp-json/ responses inside the bounded startup window', async () => {
  let indexCalls = 0;
  let snapshotCalls = 0;
  const readyAfterIndexCalls = labMaxConsecutiveNotReadyProbes + 2;
  const server = createServer((request, response) => {
    if (request.url === '/wp-json/') {
      indexCalls += 1;
      if (indexCalls < readyAfterIndexCalls) {
        response.statusCode = 502;
        response.setHeader('content-type', 'text/html; charset=utf-8');
        response.end('<!doctype html><html><body>WordPress is not ready yet</body></html>');
        return;
      }
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ namespaces: ['reprint-push-lab/v1'] }));
      return;
    }

    if (request.url === '/wp-json/reprint-push-lab/v1/snapshot') {
      snapshotCalls += 1;
      if (indexCalls < readyAfterIndexCalls) {
        response.statusCode = 502;
        response.setHeader('content-type', 'text/html; charset=utf-8');
        response.end('<!doctype html><html><body>WordPress is not ready yet</body></html>');
        return;
      }
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ ok: true, snapshot: {} }));
      return;
    }

    response.statusCode = 404;
    response.end('not found');
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object' && typeof address.port === 'number');

  try {
    await waitForServer(
      {
        exitCode: null,
        signalCode: null,
        pid: null,
      },
      `http://127.0.0.1:${address.port}`,
      () => '',
    );
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  assert.equal(indexCalls, readyAfterIndexCalls);
  assert.equal(snapshotCalls, readyAfterIndexCalls);
});

test('shared lab waitForServer tolerates more than four startup-shaped no-route responses inside the bounded startup window', async () => {
  let indexCalls = 0;
  let snapshotCalls = 0;
  const readyAfterIndexCalls = labMaxConsecutiveNotReadyProbes + 2;
  const server = createServer((request, response) => {
    if (request.url === '/wp-json/') {
      indexCalls += 1;
      if (indexCalls < readyAfterIndexCalls) {
        response.statusCode = 404;
        response.setHeader('content-type', 'application/json; charset=utf-8');
        response.end(JSON.stringify({
          code: 'rest_no_route',
          message: 'No route was found matching the URL and request method.',
        }));
        return;
      }
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ namespaces: ['reprint-push-lab/v1'] }));
      return;
    }

    if (request.url === '/wp-json/reprint-push-lab/v1/snapshot') {
      snapshotCalls += 1;
      if (indexCalls < readyAfterIndexCalls) {
        response.statusCode = 404;
        response.setHeader('content-type', 'application/json; charset=utf-8');
        response.end(JSON.stringify({
          code: 'rest_no_route',
          message: 'No route was found matching the URL and request method.',
        }));
        return;
      }
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ ok: true, snapshot: {} }));
      return;
    }

    response.statusCode = 404;
    response.end('not found');
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object' && typeof address.port === 'number');

  try {
    await waitForServer(
      {
        exitCode: null,
        signalCode: null,
        pid: null,
      },
      `http://127.0.0.1:${address.port}`,
      () => '',
    );
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  assert.equal(indexCalls, readyAfterIndexCalls);
  assert.equal(snapshotCalls, readyAfterIndexCalls);
});

test('shared lab waitForServer fails closed when the startup deadline expires after retryable probes', async () => {
  let indexCalls = 0;
  let snapshotCalls = 0;
  const sockets = new Set();
  const server = createServer((request, response) => {
    if (request.url === '/wp-json/') {
      indexCalls += 1;
      response.statusCode = 502;
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end('<!doctype html><html><body>WordPress is not ready yet</body></html>');
      return;
    }

    if (request.url === '/wp-json/reprint-push-lab/v1/snapshot') {
      snapshotCalls += 1;
      response.statusCode = 502;
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end('<!doctype html><html><body>WordPress is not ready yet</body></html>');
      return;
    }

    response.statusCode = 404;
    response.end('not found');
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => {
      sockets.delete(socket);
    });
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object' && typeof address.port === 'number');

  const child = {
    exitCode: null,
    signalCode: null,
    pid: null,
    kill() {
      this.exitCode = 1;
      return true;
    },
  };

  const originalDateNow = Date.now;
  let dateNowCalls = 0;
  Date.now = () => {
    dateNowCalls += 1;
    if (dateNowCalls <= 2) {
      return 0;
    }
    return serverStartupTimeoutMs + 1;
  };

  try {
    await assert.rejects(
      waitForServer(
        child,
        `http://127.0.0.1:${address.port}`,
        () => '',
      ),
      (error) => {
        assert.match(error.message, /Timed out waiting for Playground server at http:\/\/127\.0\.0\.1:/);
        assert.match(error.message, /Playground index readiness HTTP 502: WordPress is not ready yet/);
        assert.equal(error.context?.notReadyProbeCount, 1);
        assert.equal(error.context?.childPid ?? null, null);
        assert.equal(error.lastProbe?.route, '/wp-json/reprint-push-lab/v1/snapshot');
        assert.equal(error.lastProbe?.status, 502);
        return true;
      },
    );
  } finally {
    Date.now = originalDateNow;
    for (const socket of sockets) {
      socket.destroy();
    }
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  assert.equal(indexCalls, 1);
  assert.equal(snapshotCalls, 1);
});

test('shared lab waitForServer fails with bounded timeout diagnostics after consecutive readiness probe timeouts', async () => {
  const sockets = new Set();
  const server = createServer(() => {
    // Intentionally never respond so fetchWithTimeout() exercises the bounded timeout path.
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => {
      sockets.delete(socket);
    });
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object' && typeof address.port === 'number');

  const child = {
    exitCode: null,
    signalCode: null,
    pid: null,
    kill() {
      this.exitCode = 1;
      return true;
    },
  };

  try {
    await assert.rejects(
      waitForServer(
        child,
        `http://127.0.0.1:${address.port}`,
        () => '',
      ),
      (error) => {
        assert.match(error.message, /Playground server hit 4 consecutive readiness probe timeouts/);
        assert.equal(error.context?.timeoutProbeCount, 4);
        assert.equal(error.context?.childPid ?? null, null);
        return true;
      },
    );
  } finally {
    for (const socket of sockets) {
      socket.destroy();
    }
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
});

test('shared lab waitForServer fails with bounded timeout diagnostics when snapshot probes time out after global readiness', async () => {
  let indexCalls = 0;
  let snapshotCalls = 0;
  const sockets = new Set();
  const server = createServer((request, response) => {
    if (request.url === '/wp-json/') {
      indexCalls += 1;
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({
        name: 'Reprint Playground',
      }));
      return;
    }

    if (request.url === '/wp-json/reprint-push-lab/v1/snapshot') {
      snapshotCalls += 1;
      // Intentionally never respond so fetchWithTimeout() exercises the
      // global-ready snapshot timeout path.
      return;
    }

    response.statusCode = 404;
    response.end('not found');
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => {
      sockets.delete(socket);
    });
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object' && typeof address.port === 'number');

  const child = {
    exitCode: null,
    signalCode: null,
    pid: null,
    kill() {
      this.exitCode = 1;
      return true;
    },
  };

  try {
    await assert.rejects(
      waitForServer(
        child,
        `http://127.0.0.1:${address.port}`,
        () => '',
      ),
      (error) => {
        assert.match(error.message, /Playground lab snapshot probe timed out after global WordPress readiness HTTP 200 after 5 consecutive timeouts/);
        assert.equal(error.context?.timeoutProbeCount, maxSnapshotTimeoutFallbackProbes);
        assert.equal(error.context?.timeoutProbeLimit, maxSnapshotTimeoutFallbackProbes);
        assert.equal(error.context?.globalWordPressReady, true);
        assert.equal(error.context?.snapshotProbeTimedOut, true);
        assert.equal(error.context?.childPid ?? null, null);
        assert.equal(error.lastProbe?.route, '/wp-json/');
        assert.equal(error.lastProbe?.status, 200);
        return true;
      },
    );
  } finally {
    for (const socket of sockets) {
      socket.destroy();
    }
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  assert.equal(indexCalls, maxSnapshotTimeoutFallbackProbes);
  assert.equal(snapshotCalls, maxSnapshotTimeoutFallbackProbes);
});

test('shared lab waitForServer fails closed when the Playground child exits before readiness probing completes', async () => {
  await assert.rejects(
    waitForServer(
      {
        exitCode: 23,
        signalCode: null,
        pid: null,
        kill() {
          return true;
        },
      },
      'http://127.0.0.1:65535',
      () => 'server boot log',
    ),
    (error) => {
      assert.match(error.message, /Playground server exited early with 23/);
      assert.match(error.message, /server boot log/);
      assert.equal(error.context?.childPid ?? null, null);
      return true;
    },
  );
});

test('shared lab waitForServer fails closed when the Playground child is signaled before readiness probing completes', async () => {
  await assert.rejects(
    waitForServer(
      {
        exitCode: null,
        signalCode: 'SIGTERM',
        pid: null,
        kill() {
          return true;
        },
      },
      'http://127.0.0.1:65535',
      () => 'server boot log',
    ),
    (error) => {
      assert.match(error.message, /Playground server terminated by SIGTERM/);
      assert.match(error.message, /server boot log/);
      assert.equal(error.context?.childPid ?? null, null);
      return true;
    },
  );
});

test('shared lab waitForServer resets timeout diagnostics after a successful readiness probe', async () => {
  let indexCalls = 0;
  let snapshotCalls = 0;
  const sockets = new Set();
  const server = createServer((request, response) => {
    if (request.url === '/wp-json/') {
      indexCalls += 1;
      if (indexCalls === 1 || indexCalls >= 3) {
        return;
      }
      response.statusCode = 502;
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end('<!doctype html><html><body>WordPress is not ready yet</body></html>');
      return;
    }

    if (request.url === '/wp-json/reprint-push-lab/v1/snapshot') {
      snapshotCalls += 1;
      response.statusCode = 502;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({
        code: 'wordpress_not_ready',
        message: 'WordPress is not ready yet',
      }));
      return;
    }

    response.statusCode = 404;
    response.end('not found');
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => {
      sockets.delete(socket);
    });
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object' && typeof address.port === 'number');

  const child = {
    exitCode: null,
    signalCode: null,
    pid: null,
    kill() {
      this.exitCode = 1;
      return true;
    },
  };

  try {
    await assert.rejects(
      waitForServer(
        child,
        `http://127.0.0.1:${address.port}`,
        () => '',
      ),
      (error) => {
        assert.match(error.message, /Playground server hit 4 consecutive readiness probe timeouts/);
        assert.equal(error.context?.timeoutProbeCount, 4);
        return true;
      },
    );
  } finally {
    for (const socket of sockets) {
      socket.destroy();
    }
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  assert.equal(indexCalls, 6);
  assert.equal(snapshotCalls, 1);
});

test('shared lab waitForServer accepts a ready snapshot even while /wp-json/ still reports startup-shaped 502s', async () => {
  let indexCalls = 0;
  let snapshotCalls = 0;
  const server = createServer((request, response) => {
    if (request.url === '/wp-json/') {
      indexCalls += 1;
      response.statusCode = 502;
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end('<!doctype html><html><body>WordPress is not ready yet</body></html>');
      return;
    }

    if (request.url === '/wp-json/reprint-push-lab/v1/snapshot') {
      snapshotCalls += 1;
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ ok: true, snapshot: { source: 'ready-before-index' } }));
      return;
    }

    response.statusCode = 404;
    response.end('not found');
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object' && typeof address.port === 'number');

  try {
    await waitForServer(
      {
        exitCode: null,
        signalCode: null,
        pid: null,
      },
      `http://127.0.0.1:${address.port}`,
      () => '',
    );
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  assert.equal(indexCalls, 1);
  assert.equal(snapshotCalls, 1);
});

test('shared lab waitForServer accepts a ready snapshot even while /wp-json/ still reports startup-shaped no-route failures', async () => {
  let indexCalls = 0;
  let snapshotCalls = 0;
  const server = createServer((request, response) => {
    if (request.url === '/wp-json/') {
      indexCalls += 1;
      response.statusCode = 404;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({
        code: 'rest_no_route',
        message: 'No route was found matching the URL and request method.',
      }));
      return;
    }

    if (request.url === '/wp-json/reprint-push-lab/v1/snapshot') {
      snapshotCalls += 1;
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ ok: true, snapshot: { source: 'ready-before-index-no-route' } }));
      return;
    }

    response.statusCode = 404;
    response.end('not found');
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object' && typeof address.port === 'number');

  try {
    await waitForServer(
      {
        exitCode: null,
        signalCode: null,
        pid: null,
      },
      `http://127.0.0.1:${address.port}`,
      () => '',
    );
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  assert.equal(indexCalls, 1);
  assert.equal(snapshotCalls, 1);
});

test('shared lab waitForServer fails closed when snapshot is terminal while /wp-json/ still reports startup-shaped 502s', async () => {
  let indexCalls = 0;
  let snapshotCalls = 0;
  const server = createServer((request, response) => {
    if (request.url === '/wp-json/') {
      indexCalls += 1;
      response.statusCode = 502;
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end('<!doctype html><html><body>WordPress is not ready yet</body></html>');
      return;
    }

    if (request.url === '/wp-json/reprint-push-lab/v1/snapshot') {
      snapshotCalls += 1;
      response.statusCode = 500;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({
        ok: false,
        code: 'snapshot_terminal_failure',
        message: 'snapshot storage failed',
      }));
      return;
    }

    response.statusCode = 404;
    response.end('not found');
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object' && typeof address.port === 'number');

  try {
    await assert.rejects(
      waitForServer(
        {
          exitCode: null,
          signalCode: null,
          pid: null,
          kill() {
            this.exitCode = 1;
            return true;
          },
        },
        `http://127.0.0.1:${address.port}`,
        () => '',
      ),
      (error) => {
        assert.match(error.message, /Playground lab snapshot returned a terminal readiness failure/);
        assert.equal(error.context?.childPid ?? null, null);
        return true;
      },
    );
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  assert.equal(indexCalls, 1);
  assert.equal(snapshotCalls, 1);
});

test('shared lab waitForServer fails closed when snapshot is terminal while /wp-json/ still reports startup-shaped no-route failures', async () => {
  let indexCalls = 0;
  let snapshotCalls = 0;
  const server = createServer((request, response) => {
    if (request.url === '/wp-json/') {
      indexCalls += 1;
      response.statusCode = 404;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({
        code: 'rest_no_route',
        message: 'No route was found matching the URL and request method.',
      }));
      return;
    }

    if (request.url === '/wp-json/reprint-push-lab/v1/snapshot') {
      snapshotCalls += 1;
      response.statusCode = 500;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({
        ok: false,
        code: 'snapshot_terminal_failure',
        message: 'snapshot storage failed',
      }));
      return;
    }

    response.statusCode = 404;
    response.end('not found');
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object' && typeof address.port === 'number');

  try {
    await assert.rejects(
      waitForServer(
        {
          exitCode: null,
          signalCode: null,
          pid: null,
          kill() {
            this.exitCode = 1;
            return true;
          },
        },
        `http://127.0.0.1:${address.port}`,
        () => '',
      ),
      (error) => {
        assert.match(error.message, /Playground lab snapshot returned a terminal readiness failure/);
        assert.equal(error.context?.childPid ?? null, null);
        return true;
      },
    );
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  assert.equal(indexCalls, 1);
  assert.equal(snapshotCalls, 1);
});

test('shared lab waitForServer fails closed when snapshot JSON is invalid while /wp-json/ still reports startup-shaped 502s', async () => {
  let indexCalls = 0;
  let snapshotCalls = 0;
  const server = createServer((request, response) => {
    if (request.url === '/wp-json/') {
      indexCalls += 1;
      response.statusCode = 502;
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end('<!doctype html><html><body>WordPress is not ready yet</body></html>');
      return;
    }

    if (request.url === '/wp-json/reprint-push-lab/v1/snapshot') {
      snapshotCalls += 1;
      response.statusCode = 500;
      response.setHeader('content-type', 'text/plain; charset=utf-8');
      response.end('snapshot storage failed before JSON payload');
      return;
    }

    response.statusCode = 404;
    response.end('not found');
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object' && typeof address.port === 'number');

  try {
    await assert.rejects(
      waitForServer(
        {
          exitCode: null,
          signalCode: null,
          pid: null,
          kill() {
            this.exitCode = 1;
            return true;
          },
        },
        `http://127.0.0.1:${address.port}`,
        () => '',
      ),
      (error) => {
        assert.match(error.message, /Playground lab snapshot returned an invalid readiness body/);
        assert.equal(error.context?.childPid ?? null, null);
        return true;
      },
    );
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  assert.equal(indexCalls, 1);
  assert.equal(snapshotCalls, 1);
});

test('shared lab waitForServer fails closed when snapshot JSON is invalid while /wp-json/ still reports startup-shaped no-route failures', async () => {
  let indexCalls = 0;
  let snapshotCalls = 0;
  const server = createServer((request, response) => {
    if (request.url === '/wp-json/') {
      indexCalls += 1;
      response.statusCode = 404;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({
        code: 'rest_no_route',
        message: 'No route was found matching the URL and request method.',
      }));
      return;
    }

    if (request.url === '/wp-json/reprint-push-lab/v1/snapshot') {
      snapshotCalls += 1;
      response.statusCode = 500;
      response.setHeader('content-type', 'text/plain; charset=utf-8');
      response.end('snapshot storage failed before JSON payload');
      return;
    }

    response.statusCode = 404;
    response.end('not found');
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object' && typeof address.port === 'number');

  try {
    await assert.rejects(
      waitForServer(
        {
          exitCode: null,
          signalCode: null,
          pid: null,
          kill() {
            this.exitCode = 1;
            return true;
          },
        },
        `http://127.0.0.1:${address.port}`,
        () => '',
      ),
      (error) => {
        assert.match(error.message, /Playground lab snapshot returned an invalid readiness body/);
        assert.equal(error.context?.childPid ?? null, null);
        return true;
      },
    );
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  assert.equal(indexCalls, 1);
  assert.equal(snapshotCalls, 1);
});

test('shared lab waitForServer fails closed after bounded snapshot timeouts while /wp-json/ still reports startup-shaped 502s', async () => {
  let indexCalls = 0;
  let snapshotCalls = 0;
  const sockets = new Set();
  const server = createServer((request, response) => {
    if (request.url === '/wp-json/') {
      indexCalls += 1;
      response.statusCode = 502;
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end('<!doctype html><html><body>WordPress is not ready yet</body></html>');
      return;
    }

    if (request.url === '/wp-json/reprint-push-lab/v1/snapshot') {
      snapshotCalls += 1;
      return;
    }

    response.statusCode = 404;
    response.end('not found');
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object' && typeof address.port === 'number');

  try {
    await assert.rejects(
      waitForServer(
        {
          exitCode: null,
          signalCode: null,
          pid: null,
          kill() {
            this.exitCode = 1;
            return true;
          },
        },
        `http://127.0.0.1:${address.port}`,
        () => '',
      ),
      (error) => {
        assert.match(error.message, /snapshot probe timed out while \/wp-json\/ still reported startup-shaped readiness HTTP 502/);
        assert.equal(error.context?.snapshotProbeTimedOut, true);
        assert.equal(error.context?.timeoutProbeCount, maxSnapshotTimeoutFallbackProbes);
        assert.equal(error.context?.timeoutProbeLimit, maxSnapshotTimeoutFallbackProbes);
        assert.equal(error.context?.startupIndexStatus, 502);
        return true;
      },
    );
  } finally {
    for (const socket of sockets) {
      socket.destroy();
    }
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  assert.equal(indexCalls, maxSnapshotTimeoutFallbackProbes);
  assert.equal(snapshotCalls, maxSnapshotTimeoutFallbackProbes);
});

test('shared lab waitForServer fails closed after bounded snapshot timeouts while /wp-json/ still reports startup-shaped no-route failures', async () => {
  let indexCalls = 0;
  let snapshotCalls = 0;
  const sockets = new Set();
  const server = createServer((request, response) => {
    if (request.url === '/wp-json/') {
      indexCalls += 1;
      response.statusCode = 404;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({
        code: 'rest_no_route',
        message: 'No route was found matching the URL and request method.',
      }));
      return;
    }

    if (request.url === '/wp-json/reprint-push-lab/v1/snapshot') {
      snapshotCalls += 1;
      return;
    }

    response.statusCode = 404;
    response.end('not found');
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object' && typeof address.port === 'number');

  try {
    await assert.rejects(
      waitForServer(
        {
          exitCode: null,
          signalCode: null,
          pid: null,
          kill() {
            this.exitCode = 1;
            return true;
          },
        },
        `http://127.0.0.1:${address.port}`,
        () => '',
      ),
      (error) => {
        assert.match(error.message, /snapshot probe timed out while \/wp-json\/ still reported startup-shaped readiness HTTP 404/);
        assert.equal(error.context?.snapshotProbeTimedOut, true);
        assert.equal(error.context?.timeoutProbeCount, maxSnapshotTimeoutFallbackProbes);
        assert.equal(error.context?.timeoutProbeLimit, maxSnapshotTimeoutFallbackProbes);
        assert.equal(error.context?.startupIndexStatus, 404);
        return true;
      },
    );
  } finally {
    for (const socket of sockets) {
      socket.destroy();
    }
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  assert.equal(indexCalls, maxSnapshotTimeoutFallbackProbes);
  assert.equal(snapshotCalls, maxSnapshotTimeoutFallbackProbes);
});

test('shared lab waitForServer tolerates more than four startup-shaped snapshot responses after global WordPress readiness', async () => {
  let indexCalls = 0;
  let snapshotCalls = 0;
  const readyAfterSnapshotCalls = labMaxConsecutiveNotReadyProbes + 1;
  const server = createServer((request, response) => {
    if (request.url === '/wp-json/') {
      indexCalls += 1;
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ namespaces: ['reprint-push-lab/v1'] }));
      return;
    }

    if (request.url === '/wp-json/reprint-push-lab/v1/snapshot') {
      snapshotCalls += 1;
      if (snapshotCalls < readyAfterSnapshotCalls) {
        response.statusCode = 502;
        response.setHeader('content-type', 'application/json; charset=utf-8');
        response.end(JSON.stringify({
          code: 'wordpress_not_ready',
          message: 'WordPress is not ready yet',
        }));
        return;
      }
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ ok: true, snapshot: {} }));
      return;
    }

    response.statusCode = 404;
    response.end('not found');
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object' && typeof address.port === 'number');

  try {
    await waitForServer(
      {
        exitCode: null,
        signalCode: null,
        pid: null,
      },
      `http://127.0.0.1:${address.port}`,
      () => '',
    );
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  assert.equal(indexCalls, readyAfterSnapshotCalls);
  assert.equal(snapshotCalls, readyAfterSnapshotCalls);
  assert.ok(
    maxSnapshotStartupAfterGlobalReadyProbes >= readyAfterSnapshotCalls,
    'expected widened post-global-ready snapshot startup budget',
  );
});

test('shared lab waitForServer fails closed when snapshot stays startup-shaped after global WordPress readiness', async () => {
  let indexCalls = 0;
  let snapshotCalls = 0;
  const server = createServer((request, response) => {
    if (request.url === '/wp-json/') {
      indexCalls += 1;
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ namespaces: ['reprint-push-lab/v1'] }));
      return;
    }

    if (request.url === '/wp-json/reprint-push-lab/v1/snapshot') {
      snapshotCalls += 1;
      response.statusCode = 502;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({
        code: 'wordpress_not_ready',
        message: 'WordPress is not ready yet',
      }));
      return;
    }

    response.statusCode = 404;
    response.end('not found');
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object' && typeof address.port === 'number');

  try {
    await assert.rejects(
      waitForServer(
        {
          exitCode: null,
          signalCode: null,
          pid: null,
          kill() {
            this.exitCode = 1;
            return true;
          },
        },
        `http://127.0.0.1:${address.port}`,
        () => '',
      ),
      (error) => {
        assert.match(error.message, /Playground lab snapshot stayed startup-shaped after global WordPress readiness HTTP 200/);
        assert.equal(error.context?.snapshotNotReadyProbeCount, maxSnapshotStartupAfterGlobalReadyProbes);
        assert.equal(error.context?.globalWordPressReady, true);
        return true;
      },
    );
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  assert.equal(indexCalls, maxSnapshotStartupAfterGlobalReadyProbes);
  assert.equal(snapshotCalls, maxSnapshotStartupAfterGlobalReadyProbes);
});

test('shared lab waitForServer fails closed when snapshot keeps returning malformed startup-shaped bodies after global WordPress readiness', async () => {
  let indexCalls = 0;
  let snapshotCalls = 0;
  const server = createServer((request, response) => {
    if (request.url === '/wp-json/') {
      indexCalls += 1;
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ namespaces: ['reprint-push-lab/v1'] }));
      return;
    }

    if (request.url === '/wp-json/reprint-push-lab/v1/snapshot') {
      snapshotCalls += 1;
      response.statusCode = 502;
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end('<!doctype html><html><body>WordPress is not ready yet</body></html>');
      return;
    }

    response.statusCode = 404;
    response.end('not found');
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object' && typeof address.port === 'number');

  try {
    await assert.rejects(
      waitForServer(
        {
          exitCode: null,
          signalCode: null,
          pid: null,
          kill() {
            this.exitCode = 1;
            return true;
          },
        },
        `http://127.0.0.1:${address.port}`,
        () => '',
      ),
      (error) => {
        assert.match(error.message, /Playground lab snapshot stayed startup-shaped after global WordPress readiness HTTP 200/);
        assert.equal(error.context?.snapshotNotReadyProbeCount, maxSnapshotStartupAfterGlobalReadyProbes);
        assert.equal(error.context?.globalWordPressReady, true);
        return true;
      },
    );
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  assert.equal(indexCalls, maxSnapshotStartupAfterGlobalReadyProbes);
  assert.equal(snapshotCalls, maxSnapshotStartupAfterGlobalReadyProbes);
});

test('shared lab waitForServer fails closed when snapshot turns terminal after global WordPress readiness', async () => {
  let indexCalls = 0;
  let snapshotCalls = 0;
  const server = createServer((request, response) => {
    if (request.url === '/wp-json/') {
      indexCalls += 1;
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ namespaces: ['reprint-push-lab/v1'] }));
      return;
    }

    if (request.url === '/wp-json/reprint-push-lab/v1/snapshot') {
      snapshotCalls += 1;
      response.statusCode = 500;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({
        ok: false,
        code: 'snapshot_terminal_failure',
        message: 'snapshot storage failed after global readiness',
      }));
      return;
    }

    response.statusCode = 404;
    response.end('not found');
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object' && typeof address.port === 'number');

  try {
    await assert.rejects(
      waitForServer(
        {
          exitCode: null,
          signalCode: null,
          pid: null,
          kill() {
            this.exitCode = 1;
            return true;
          },
        },
        `http://127.0.0.1:${address.port}`,
        () => '',
      ),
      (error) => {
        assert.match(error.message, /Playground lab snapshot returned a terminal readiness failure/);
        assert.equal(error.context?.childPid ?? null, null);
        assert.equal(error.context?.globalWordPressReady, undefined);
        return true;
      },
    );
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  assert.equal(indexCalls, 1);
  assert.equal(snapshotCalls, 1);
});

test('shared lab waitForServer fails closed when snapshot returns an invalid non-startup body after global WordPress readiness', async () => {
  let indexCalls = 0;
  let snapshotCalls = 0;
  const server = createServer((request, response) => {
    if (request.url === '/wp-json/') {
      indexCalls += 1;
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ namespaces: ['reprint-push-lab/v1'] }));
      return;
    }

    if (request.url === '/wp-json/reprint-push-lab/v1/snapshot') {
      snapshotCalls += 1;
      response.statusCode = 500;
      response.setHeader('content-type', 'text/plain; charset=utf-8');
      response.end('snapshot storage failed after global readiness before JSON payload');
      return;
    }

    response.statusCode = 404;
    response.end('not found');
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object' && typeof address.port === 'number');

  try {
    await assert.rejects(
      waitForServer(
        {
          exitCode: null,
          signalCode: null,
          pid: null,
          kill() {
            this.exitCode = 1;
            return true;
          },
        },
        `http://127.0.0.1:${address.port}`,
        () => '',
      ),
      (error) => {
        assert.match(error.message, /Playground lab snapshot returned an invalid readiness body/);
        assert.equal(error.context?.childPid ?? null, null);
        assert.equal(error.context?.globalWordPressReady, undefined);
        return true;
      },
    );
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  assert.equal(indexCalls, 1);
  assert.equal(snapshotCalls, 1);
});

test('shared lab waitForServer preserves snapshot-timeout context across the next /wp-json/ failure branch', () => {
  const verifierSource = readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );

  assert.match(
    verifierSource,
    /lastSnapshotTimeoutContext = \{\s*timeoutProbeCount:\s*snapshotTimeoutProbeCount,\s*startupIndexStatus:\s*response\.status,\s*\}/s,
  );
  assert.match(
    verifierSource,
    /Playground \/wp-json\/ returned a terminal readiness failure HTTP \$\{response\.status\} after the snapshot probe timed out at \$\{baseUrl\}/,
  );
  assert.match(
    verifierSource,
    /snapshotProbeTimedOut:\s*true,\s*\.\.\.lastSnapshotTimeoutContext,\s*indexTerminal:\s*true/s,
  );
  assert.match(
    verifierSource,
    /Playground \/wp-json\/ probe timed out after the snapshot probe timed out at \$\{baseUrl\}/,
  );
  assert.match(
    verifierSource,
    /snapshotProbeTimedOut:\s*true,\s*\.\.\.lastSnapshotTimeoutContext,\s*indexProbeTimedOut:\s*true/s,
  );
});

test('shared lab waitForServer clears snapshot-timeout context after the snapshot recovers into a retryable response', async () => {
  let indexCalls = 0;
  let snapshotCalls = 0;
  const sockets = new Set();
  const server = createServer((request, response) => {
    if (request.url === '/wp-json/') {
      indexCalls += 1;
      if (indexCalls <= 2) {
        response.statusCode = 502;
        response.setHeader('content-type', 'text/html; charset=utf-8');
        response.end('<!doctype html><html><body>WordPress is not ready yet</body></html>');
        return;
      }

      response.statusCode = 500;
      response.setHeader('content-type', 'text/plain; charset=utf-8');
      response.end('terminal index failure after snapshot recovery');
      return;
    }

    if (request.url === '/wp-json/reprint-push-lab/v1/snapshot') {
      snapshotCalls += 1;
      if (snapshotCalls === 1) {
        return;
      }

      response.statusCode = 502;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({
        code: 'wordpress_not_ready',
        message: 'WordPress is not ready yet',
      }));
      return;
    }

    response.statusCode = 404;
    response.end('not found');
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object' && typeof address.port === 'number');

  try {
    await assert.rejects(
      waitForServer(
        {
          exitCode: null,
          signalCode: null,
          pid: null,
          kill() {
            this.exitCode = 1;
            return true;
          },
        },
        `http://127.0.0.1:${address.port}`,
        () => '',
      ),
      (error) => {
        assert.match(error.message, /Playground \/wp-json\/ returned a terminal readiness failure HTTP 500/);
        assert.doesNotMatch(error.message, /after the snapshot probe timed out/);
        assert.equal(error.context?.snapshotProbeTimedOut, undefined);
        assert.equal(error.context?.indexTerminal, true);
        return true;
      },
    );
  } finally {
    for (const socket of sockets) {
      socket.destroy();
    }
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  assert.equal(indexCalls, 3);
  assert.equal(snapshotCalls, 2);
});

test('shared lab waitForServer fails closed when /wp-json/ turns terminal after the snapshot probe timed out', async () => {
  let indexCalls = 0;
  let snapshotCalls = 0;
  const sockets = new Set();
  const server = createServer((request, response) => {
    if (request.url === '/wp-json/') {
      indexCalls += 1;
      if (indexCalls === 1) {
        response.statusCode = 502;
        response.setHeader('content-type', 'text/html; charset=utf-8');
        response.end('<!doctype html><html><body>WordPress is not ready yet</body></html>');
        return;
      }

      response.statusCode = 500;
      response.setHeader('content-type', 'text/plain; charset=utf-8');
      response.end('terminal index failure after snapshot timeout');
      return;
    }

    if (request.url === '/wp-json/reprint-push-lab/v1/snapshot') {
      snapshotCalls += 1;
      return;
    }

    response.statusCode = 404;
    response.end('not found');
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object' && typeof address.port === 'number');

  try {
    await assert.rejects(
      waitForServer(
        {
          exitCode: null,
          signalCode: null,
          pid: null,
          kill() {
            this.exitCode = 1;
            return true;
          },
        },
        `http://127.0.0.1:${address.port}`,
        () => '',
      ),
      (error) => {
        assert.match(error.message, /Playground \/wp-json\/ returned a terminal readiness failure HTTP 500 after the snapshot probe timed out/);
        assert.equal(error.context?.snapshotProbeTimedOut, true);
        assert.equal(error.context?.timeoutProbeCount, 1);
        assert.equal(error.context?.startupIndexStatus, 502);
        assert.equal(error.context?.indexTerminal, true);
        return true;
      },
    );
  } finally {
    for (const socket of sockets) {
      socket.destroy();
    }
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  assert.equal(indexCalls, 2);
  assert.equal(snapshotCalls, 1);
});

test('shared lab waitForServer fails closed when /wp-json/ times out after the snapshot probe timed out', async () => {
  let indexCalls = 0;
  let snapshotCalls = 0;
  const sockets = new Set();
  const server = createServer((request, response) => {
    if (request.url === '/wp-json/') {
      indexCalls += 1;
      if (indexCalls === 1) {
        response.statusCode = 502;
        response.setHeader('content-type', 'text/html; charset=utf-8');
        response.end('<!doctype html><html><body>WordPress is not ready yet</body></html>');
        return;
      }

      return;
    }

    if (request.url === '/wp-json/reprint-push-lab/v1/snapshot') {
      snapshotCalls += 1;
      return;
    }

    response.statusCode = 404;
    response.end('not found');
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object' && typeof address.port === 'number');

  try {
    await assert.rejects(
      waitForServer(
        {
          exitCode: null,
          signalCode: null,
          pid: null,
          kill() {
            this.exitCode = 1;
            return true;
          },
        },
        `http://127.0.0.1:${address.port}`,
        () => '',
      ),
      (error) => {
        assert.match(error.message, /Playground \/wp-json\/ probe timed out after the snapshot probe timed out/);
        assert.equal(error.context?.snapshotProbeTimedOut, true);
        assert.equal(error.context?.timeoutProbeCount, 1);
        assert.equal(error.context?.startupIndexStatus, 502);
        assert.equal(error.context?.indexProbeTimedOut, true);
        return true;
      },
    );
  } finally {
    for (const socket of sockets) {
      socket.destroy();
    }
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  assert.equal(indexCalls, 2);
  assert.equal(snapshotCalls, 1);
});

test('live Playground proof helpers keep lab readiness probes child-aware', () => {
  const liveSources = [
    readFileSync(
      path.join(repoRoot, 'scripts/playground/production-shaped-live-topology-proof.mjs'),
      'utf8',
    ),
    readFileSync(
      path.join(repoRoot, 'scripts/playground/production-shaped-live-protocol-proof.mjs'),
      'utf8',
    ),
  ];

  for (const source of liveSources) {
    assert.match(source, /async function fetchTextWithTimeout\(url, options = \{\}, timeoutMs = [^,]+, child = null\)/);
    assert.match(source, /const bodyTextPromise = response\.text\(\)/);
    assert.match(source, /Promise\.race\(\[bodyTextPromise, childExitWatcher\.promise\]\)/);
    assert.match(source, /createChildExitWatcher\(child, url, controller\)/);
    assert.match(source, /error\.isPlaygroundReadinessFailure = true/);
    assert.match(source, /timeoutProbeCount = labNextTimeoutProbeCount\(timeoutProbeCount, error\);/);
    assert.match(source, /if \(labReadinessProbeTimedOut\(error\) && timeoutProbeCount >= maxConsecutiveTimeoutProbes\)/);
    assert.match(source, /await sleepUnlessChildExit\(readinessProbeIntervalMs, child\)/);
    assert.match(source, /const \{ response, bodyText: responseBody \} = await fetchTextWithTimeout\([\s\S]*serverFetchTimeoutMs,\s*child\);/);
    assert.match(source, /const \{ response: snapshot, bodyText: snapshotBody \} = await fetchTextWithTimeout\([\s\S]*serverFetchTimeoutMs,\s*child\);/);
    assert.doesNotMatch(source, /await response\.arrayBuffer\(\)/);
    assert.doesNotMatch(source, /await snapshot\.arrayBuffer\(\)/);
    assert.doesNotMatch(source, /await new Promise\(\(resolve\) => setTimeout\(resolve, readinessProbeIntervalMs\)\)/);
  }
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
  let snapshotNotReadyProbeCount = 0;
  let timeoutProbeCount = 0;
  let snapshotTimeoutProbeCount = 0;
  let lastSnapshotTimeoutContext = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      const exitLabel =
        child.exitCode !== null ? `exited early with ${child.exitCode}` : `terminated by ${child.signalCode}`;
      const failureText = formatPlaygroundStartupFailure(
        `Playground server ${exitLabel}`,
        lastError,
        lastProbes,
        getLogs(),
        { childPid: child.pid ?? null },
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
      timeoutProbeCount = 0;
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
      const readinessRetryable = labReadinessBodyRetryable(response.status, responseBody);
      if (response.status === 200 && !readinessRetryable) {
        notReadyProbeCount = 0;
        await response.arrayBuffer();
        let snapshot;
        try {
          snapshot = await fetchWithTimeout(`${baseUrl}/wp-json/reprint-push-lab/v1/snapshot`, {
            headers: {
              Authorization: `Basic ${Buffer.from(`${liveCredentials.username}:${liveCredentials.password}`).toString('base64')}`,
              connection: 'close',
            },
          });
        } catch (error) {
          if (labReadinessProbeTimedOut(error)) {
            lastError = error;
            snapshotTimeoutProbeCount = labNextTimeoutProbeCount(snapshotTimeoutProbeCount, error);
            lastSnapshotTimeoutContext = {
              timeoutProbeCount: snapshotTimeoutProbeCount,
              globalWordPressReady: true,
            };
            if (labNotReadyProbeLimitReached(snapshotTimeoutProbeCount, maxSnapshotTimeoutFallbackProbes)) {
              await throwPlaygroundReadinessFailure(
                child,
                `Playground lab snapshot probe timed out after global WordPress readiness HTTP ${response.status} after ${snapshotTimeoutProbeCount} consecutive timeout${snapshotTimeoutProbeCount === 1 ? '' : 's'}`,
                lastError,
                lastProbes,
                getLogs(),
                {
                  childPid: child.pid ?? null,
                  timeoutProbeCount: snapshotTimeoutProbeCount,
                  timeoutProbeLimit: maxSnapshotTimeoutFallbackProbes,
                  globalWordPressReady: true,
                  snapshotProbeTimedOut: true,
                },
              );
            }
            await new Promise((resolve) => setTimeout(resolve, readinessProbeIntervalMs));
            continue;
          }
          throw error;
        }
        snapshotTimeoutProbeCount = 0;
        lastSnapshotTimeoutContext = null;
        timeoutProbeCount = 0;
        const snapshotBody = await snapshot.clone().text().catch(() => '');
        lastProbes.push({
          route: '/wp-json/reprint-push-lab/v1/snapshot',
          status: snapshot.status,
          ok: snapshot.ok,
          body: snapshotBody.slice(0, readinessFailureBodyLimit),
        });
        process.stderr.write(
          `Playground probe ${baseUrl}/wp-json/reprint-push-lab/v1/snapshot -> ${snapshot.status} ${snapshotBody.slice(0, 160).replace(/\s+/g, ' ').trim()}\n`,
        );
        let snapshotJson = null;
        try {
          snapshotJson = JSON.parse(snapshotBody);
        } catch (error) {
          if (labReadinessBodyRetryable(snapshot.status, snapshotBody)) {
            snapshotNotReadyProbeCount += 1;
            lastError = new Error(
              `Playground lab snapshot readiness HTTP ${snapshot.status}; ${describeLastProbe(lastProbes.at(-1))}`,
            );
            if (labNotReadyProbeLimitReached(snapshotNotReadyProbeCount, maxSnapshotStartupAfterGlobalReadyProbes)) {
              await throwPlaygroundReadinessFailure(
                child,
                `Playground lab snapshot stayed startup-shaped after global WordPress readiness HTTP ${response.status} for ${snapshotNotReadyProbeCount} consecutive response${snapshotNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxSnapshotStartupAfterGlobalReadyProbes})`,
                lastError,
                lastProbes,
                getLogs(),
                {
                  childPid: child.pid ?? null,
                  snapshotNotReadyProbeCount,
                  globalWordPressReady: true,
                },
              );
            }
            await new Promise((resolve) => setTimeout(resolve, readinessProbeIntervalMs));
            continue;
          }
          snapshotNotReadyProbeCount = 0;
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
          snapshotNotReadyProbeCount = 0;
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
          snapshotNotReadyProbeCount += 1;
          if (labNotReadyProbeLimitReached(snapshotNotReadyProbeCount, maxSnapshotStartupAfterGlobalReadyProbes)) {
            await throwPlaygroundReadinessFailure(
              child,
              `Playground lab snapshot stayed startup-shaped after global WordPress readiness HTTP ${response.status} for ${snapshotNotReadyProbeCount} consecutive response${snapshotNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxSnapshotStartupAfterGlobalReadyProbes})`,
              lastError,
              lastProbes,
              getLogs(),
              {
                childPid: child.pid ?? null,
                snapshotNotReadyProbeCount,
                globalWordPressReady: true,
              },
            );
          }
          await new Promise((resolve) => setTimeout(resolve, readinessProbeIntervalMs));
          continue;
        }
        snapshotNotReadyProbeCount = 0;
        await throwPlaygroundReadinessFailure(
          child,
          `Playground lab snapshot returned a terminal readiness failure at ${baseUrl}`,
          lastError,
          lastProbes,
          getLogs(),
          { childPid: child.pid ?? null },
        );
      } else {
        const readinessHint = readinessRetryable
          ? responseBody.match(/WordPress is not ready yet/i)?.[0]
            ?? responseBody.match(/No route was found matching the URL and request method\.?/i)?.[0]
            ?? responseBody.match(/wordpress_not_ready|rest_no_route/i)?.[0]
            ?? 'startup route is not ready yet'
          : null;
        const routeSummary = describeLastProbe(lastProbes.at(-1));
        lastError = new Error(
          readinessRetryable
            ? `Playground index readiness HTTP ${response.status}: ${readinessHint}; ${routeSummary}`
            : `Playground index readiness HTTP ${response.status}; ${routeSummary}`,
        );
        const readinessProbeCount = lastProbes.filter((probe) => probe.route === '/wp-json/').length;
        if (readinessRetryable) {
          let snapshot;
          try {
            snapshot = await fetchWithTimeout(`${baseUrl}/wp-json/reprint-push-lab/v1/snapshot`, {
              headers: {
                Authorization: `Basic ${Buffer.from(`${liveCredentials.username}:${liveCredentials.password}`).toString('base64')}`,
                connection: 'close',
              },
            });
          } catch (error) {
            if (labReadinessProbeTimedOut(error)) {
              lastError = error;
              snapshotTimeoutProbeCount = labNextTimeoutProbeCount(snapshotTimeoutProbeCount, error);
              lastSnapshotTimeoutContext = {
                timeoutProbeCount: snapshotTimeoutProbeCount,
                startupIndexStatus: response.status,
              };
              if (labNotReadyProbeLimitReached(snapshotTimeoutProbeCount, maxSnapshotTimeoutFallbackProbes)) {
                await throwPlaygroundReadinessFailure(
                  child,
                  `Playground lab snapshot probe timed out while /wp-json/ still reported startup-shaped readiness HTTP ${response.status} after ${snapshotTimeoutProbeCount} consecutive timeout${snapshotTimeoutProbeCount === 1 ? '' : 's'}`,
                  lastError,
                  lastProbes,
                  getLogs(),
                  {
                    childPid: child.pid ?? null,
                    timeoutProbeCount: snapshotTimeoutProbeCount,
                    timeoutProbeLimit: maxSnapshotTimeoutFallbackProbes,
                    startupIndexStatus: response.status,
                    snapshotProbeTimedOut: true,
                  },
                );
              }
              await new Promise((resolve) => setTimeout(resolve, readinessProbeIntervalMs));
              continue;
            }
            throw error;
          }
          timeoutProbeCount = 0;
          snapshotTimeoutProbeCount = 0;
          lastSnapshotTimeoutContext = null;
          const snapshotBody = await snapshot.clone().text().catch(() => '');
          lastProbes.push({
            route: '/wp-json/reprint-push-lab/v1/snapshot',
            status: snapshot.status,
            ok: snapshot.ok,
            body: snapshotBody.slice(0, readinessFailureBodyLimit),
          });
          process.stderr.write(
            `Playground probe ${baseUrl}/wp-json/reprint-push-lab/v1/snapshot -> ${snapshot.status} ${snapshotBody.slice(0, 160).replace(/\s+/g, ' ').trim()}\n`,
          );
          let snapshotJson = null;
          try {
            snapshotJson = JSON.parse(snapshotBody);
          } catch (error) {
            if (!labReadinessBodyRetryable(snapshot.status, snapshotBody)) {
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
          }
          if (snapshotJson !== null) {
            if (labSnapshotReady({
              status: snapshot.status,
              body: snapshotJson,
            })) {
              await snapshot.arrayBuffer();
              return;
            }
            if (!labSnapshotRetryable({
              status: snapshot.status,
              body: snapshotJson,
            })) {
              lastError = new Error(
                `Playground lab snapshot readiness HTTP ${snapshot.status}; ${describeLastProbe(lastProbes.at(-1))}`,
              );
              await throwPlaygroundReadinessFailure(
                child,
                `Playground lab snapshot returned a terminal readiness failure at ${baseUrl}`,
                lastError,
                lastProbes,
                getLogs(),
                { childPid: child.pid ?? null },
              );
            }
          }
          notReadyProbeCount += 1;
          if (labNotReadyProbeLimitReached(notReadyProbeCount, maxNotReadyReadinessProbes)) {
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
        snapshotNotReadyProbeCount = 0;
        if (!readinessRetryable) {
          const failureContext = lastSnapshotTimeoutContext !== null
            ? {
              childPid: child.pid ?? null,
              snapshotProbeTimedOut: true,
              ...lastSnapshotTimeoutContext,
              indexTerminal: true,
            }
            : {
              childPid: child.pid ?? null,
              indexTerminal: true,
            };
          const failureMessage = lastSnapshotTimeoutContext !== null
            ? `Playground /wp-json/ returned a terminal readiness failure HTTP ${response.status} after the snapshot probe timed out at ${baseUrl}`
            : `Playground /wp-json/ returned a terminal readiness failure HTTP ${response.status} at ${baseUrl}`;
          await throwPlaygroundReadinessFailure(
            child,
            failureMessage,
            lastError,
            lastProbes,
            getLogs(),
            failureContext,
          );
        }
        snapshotTimeoutProbeCount = 0;
        lastSnapshotTimeoutContext = null;
        if (response.status !== 200 && readinessProbeCount >= maxReadinessProbes) {
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
      snapshotNotReadyProbeCount = 0;
      if (lastSnapshotTimeoutContext !== null && labReadinessProbeTimedOut(error)) {
        await throwPlaygroundReadinessFailure(
          child,
          `Playground /wp-json/ probe timed out after the snapshot probe timed out at ${baseUrl}`,
          lastError,
          lastProbes,
          getLogs(),
          {
            childPid: child.pid ?? null,
            snapshotProbeTimedOut: true,
            ...lastSnapshotTimeoutContext,
            indexProbeTimedOut: true,
          },
        );
      }
      snapshotTimeoutProbeCount = 0;
      lastSnapshotTimeoutContext = null;
      timeoutProbeCount = labNextTimeoutProbeCount(timeoutProbeCount, error);
      if (labReadinessProbeTimedOut(error) && labNotReadyProbeLimitReached(timeoutProbeCount)) {
        await throwPlaygroundReadinessFailure(
          child,
          `Playground server hit ${timeoutProbeCount} consecutive readiness probe timeout${timeoutProbeCount === 1 ? '' : 's'}`,
          lastError,
          lastProbes,
          getLogs(),
          {
            childPid: child.pid ?? null,
            timeoutProbeCount,
          },
        );
      }
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
