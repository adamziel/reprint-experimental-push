#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  applyRevalidationRetryable,
  hasExplicitCheckedBoundaryRequest,
  resolveCheckedReleaseRequirementEnv,
  resolveCheckedLiveBoundaryEnv,
  resolveLiveApplyRevalidationEnv,
  shouldRequestCheckedLivePackagedBoundary,
} from './production-shaped-live-release-verify-lib.js';
import { releaseVerifyFixtureCredentials } from './release-verify-credentials.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const muPluginDir = path.join(repoRoot, 'scripts/playground/rest-mu-plugins');
const remoteBaseFixturePath = path.join(repoRoot, 'fixtures/playground/remote-base.blueprint.json');
const localEditedFixturePath = path.join(repoRoot, 'fixtures/playground/local-edited.blueprint.json');
const serverStartupTimeoutMs = 30_000;
const readinessProbeIntervalMs = 500;
const readinessFailureBodyLimit = 240;
const maxNotReadyReadinessProbes = Math.max(4, Math.ceil(serverStartupTimeoutMs / readinessProbeIntervalMs));
const requireRealReleaseBoundary = process.env.REPRINT_PUSH_REQUIRE_REAL_RELEASE_BOUNDARY === '1';
const checkedReleaseCommand = 'npm run verify:release';
const requiredPreservedRemoteRetryPath = process.env.REPRINT_PUSH_SIMULATE_PRESERVED_REMOTE_RETRY_PATH || '/snapshot';

const credentials = {
  username: releaseVerifyFixtureCredentials.username,
  applicationPassword: releaseVerifyFixtureCredentials.applicationPassword,
};
const explicitLiveSourceUrl = process.env.REPRINT_PUSH_SOURCE_URL || process.env.REPRINT_PUSH_REMOTE_URL || '';
const explicitApplyRevalidationSourceUrl = process.env.REPRINT_PUSH_APPLY_REVALIDATION_SOURCE_URL || '';
const explicitLiveRemoteChangedUrl = process.env.REPRINT_PUSH_REMOTE_CHANGED_URL || '';
const explicitLiveLocalUrl = process.env.REPRINT_PUSH_LOCAL_URL || '';
const explicitLiveUsername = process.env.REPRINT_PUSH_USERNAME || process.env.REPRINT_PUSH_LAB_AUTH_ADMIN_USER || '';
const explicitLiveApplicationPassword =
  process.env.REPRINT_PUSH_APPLICATION_PASSWORD || process.env.REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD || '';
const explicitAuthSessionSourceCommand = process.env.REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND || '';
const explicitCheckedBoundaryRequested = hasExplicitCheckedBoundaryRequest({
  liveSourceUrl: explicitLiveSourceUrl,
  username: explicitLiveUsername,
  applicationPassword: explicitLiveApplicationPassword,
  authSessionSourceCommand: explicitAuthSessionSourceCommand,
});
const packagedBoundaryRequested = shouldRequestCheckedLivePackagedBoundary({
  authSessionSourceCommand: explicitAuthSessionSourceCommand,
  liveSourceUrl: explicitLiveSourceUrl,
  username: explicitLiveUsername,
  applicationPassword: explicitLiveApplicationPassword,
  fixtureUsername: credentials.username,
  fixtureApplicationPassword: credentials.applicationPassword,
});
const innerVerifyTimeoutMs = packagedBoundaryRequested ? 180_000 : 90_000;
const applyRevalidationTimeoutMs = packagedBoundaryRequested ? 90_000 : 75_000;
const applyRevalidationRetries = packagedBoundaryRequested ? 2 : 1;

const realReleaseGate = requireRealReleaseBoundary ? resolveRealReleaseBoundaryGate() : null;
if (realReleaseGate) {
  emitRealReleaseBoundaryGateAndExit(realReleaseGate);
} else if (packagedBoundaryRequested) {
  const failedVerify = await withPlaygroundServer('remote-base', remoteBaseFixturePath, async (remoteServer) => {
    return withPlaygroundServer('local-edited', localEditedFixturePath, async (localServer) => {
      const verify = runCheckedReleaseVerify();
      if (verify.status !== 0) {
        return verify;
      }
      const applyRevalidation = runApplyRevalidationProof({
        ...resolveApplyRevalidationAuthEnv({
          sourceUrl: remoteServer.baseUrl,
          localUrl: localServer.baseUrl,
          packagedBoundaryRequested: true,
        }),
      }, { packagedBoundaryRequested: true });
      emitCombinedReleaseProof(verify.proof, applyRevalidation, { packagedBoundaryRequested: true });
      return null;
    });
  });
  if (failedVerify) {
    emitReleaseFailureAndExit(failedVerify);
  }
} else if (explicitCheckedBoundaryRequested) {
  if (
    explicitLiveSourceUrl
    && !explicitAuthSessionSourceCommand
    && (!explicitLiveUsername || !explicitLiveApplicationPassword)
  ) {
    emitMissingExplicitCredentialGateAndExit();
  }

  const liveBoundaryEnv = resolveCheckedLiveBoundaryEnv({
    sourceUrl: explicitLiveSourceUrl,
    remoteChangedUrl: explicitLiveRemoteChangedUrl,
    localUrl: explicitLiveLocalUrl,
    username: explicitLiveUsername,
    applicationPassword: explicitLiveApplicationPassword,
    authSessionSourceCommand: explicitAuthSessionSourceCommand,
    fallbackUsername: credentials.username,
    fallbackApplicationPassword: credentials.applicationPassword,
    allowCredentialFallback: false,
  });
  const verify = runCheckedReleaseVerify(liveBoundaryEnv);
  if (verify.status !== 0 || verify.proof?.ok !== true) {
    emitReleaseFailureAndExit(verify);
  }
  const applyRevalidation = runApplyRevalidationProof(resolveApplyRevalidationAuthEnv({
    // Keep apply-time revalidation on an independently preserved base when the
    // explicit wrapper provides one. The checked release verify leg can advance
    // its source remote, which would otherwise collapse the follow-up
    // apply-revalidation plan to zero mutations.
    sourceUrl: explicitApplyRevalidationSourceUrl || explicitLiveSourceUrl,
    remoteChangedUrl: explicitLiveRemoteChangedUrl,
    localUrl: explicitLiveLocalUrl,
    packagedBoundaryRequested: false,
    username: explicitLiveUsername,
    applicationPassword: explicitLiveApplicationPassword,
    authSessionSourceCommand: explicitAuthSessionSourceCommand,
  }));
  const pluginDriverOwnership = requireRealReleaseBoundary ? runPluginDriverOwnershipProof() : null;
  emitCombinedReleaseProof(verify.proof, applyRevalidation, {
    pluginDriverOwnership,
    requireRealReleaseBoundary,
  });
} else {
  const failedVerify = await withPlaygroundServer('remote-base', remoteBaseFixturePath, async (remoteServer) => {
    const verify = runCheckedReleaseVerify(
      resolveCheckedLiveBoundaryEnv({
        sourceUrl: remoteServer.baseUrl,
        fallbackUsername: credentials.username,
        fallbackApplicationPassword: credentials.applicationPassword,
        allowCredentialFallback: true,
      }),
    );
    if (verify.status !== 0) {
      return verify;
    }
    const applyRevalidation = runApplyRevalidationProof(
      resolveApplyRevalidationAuthEnv({
        sourceUrl: remoteServer.baseUrl,
        packagedBoundaryRequested: false,
      }),
    );
    emitCombinedReleaseProof(verify.proof, applyRevalidation);
    return null;
  });
  if (failedVerify) {
    emitReleaseFailureAndExit(failedVerify);
  }
}

function resolveApplyRevalidationAuthEnv({
  sourceUrl = '',
  remoteChangedUrl = '',
  localUrl = '',
  packagedBoundaryRequested = false,
  username = credentials.username,
  applicationPassword = credentials.applicationPassword,
  authSessionSourceCommand = '',
}) {
  return resolveLiveApplyRevalidationEnv({
    sourceUrl: sourceUrl || explicitLiveSourceUrl,
    remoteChangedUrl: remoteChangedUrl || explicitLiveRemoteChangedUrl,
    localUrl,
    packagedBoundaryRequested,
    username,
    applicationPassword,
    authSessionSourceCommand,
    fallbackUsername: credentials.username,
    fallbackApplicationPassword: credentials.applicationPassword,
    allowCredentialFallback: packagedBoundaryRequested || !sourceUrl,
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
      ...resolveCheckedReleaseRequirementEnv(),
      ...envOverrides,
      NODE_NO_WARNINGS: '1',
    },
  });

  process.stderr.write(verify.stderr || '');
  assert.equal(verify.error, undefined, verify.error?.stack || verify.stderr || verify.stdout);
  assert.equal(verify.signal, null, verify.stderr || verify.stdout);

  let proof = null;
  try {
    proof = parseJsonOutput(verify.stdout, 'checked live release verify');
  } catch (error) {
    if (verify.status === 0) {
      throw error;
    }
  }

  if (verify.status !== 0) {
    assert.ok(proof, verify.stderr || verify.stdout);
  }

  return {
    status: verify.status,
    proof,
  };
}

function runApplyRevalidationProof(envOverrides = {}, options = {}) {
  let proof = spawnApplyRevalidationProof(envOverrides);

  for (let attempt = 0; attempt < applyRevalidationRetries && applyRevalidationRetryable(proof); attempt += 1) {
    proof = spawnApplyRevalidationProof(envOverrides);
  }

  process.stderr.write(proof.stderr || '');
  assert.equal(proof.error, undefined, proof.error?.stack || proof.stderr || proof.stdout);
  assert.equal(proof.signal, null, proof.stderr || proof.stdout);
  assert.equal(proof.status, 0, proof.stderr || proof.stdout);

  const summary = parseJsonOutput(
    proof.stdout,
    'apply revalidation proof',
    `${proof.stdout || ''}${proof.stderr ? `\n${proof.stderr}` : ''}`,
  );
  return {
    ok: summary.ok === true,
    topology: summary.topology || null,
    authSessionSource: summary.authSessionSource || null,
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
    boundary: normalizeApplyRevalidationBoundary(summary.boundary, options),
  };
}

function spawnApplyRevalidationProof(envOverrides = {}) {
  return spawnSync(process.execPath, ['scripts/playground/production-shaped-apply-revalidation-smoke.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: applyRevalidationTimeoutMs,
    killSignal: 'SIGKILL',
    maxBuffer: 1024 * 1024 * 20,
    env: {
      ...process.env,
      ...resolveCheckedReleaseRequirementEnv(),
      ...envOverrides,
      NODE_NO_WARNINGS: '1',
    },
  });
}

function emitCombinedReleaseProof(verify, applyRevalidation, options = {}) {
  const normalizedApplyRevalidation = normalizeApplyRevalidationProof(applyRevalidation, options);
  const releaseBoundaryVerification = buildReleaseBoundaryVerification({
    verify,
    applyRevalidation: normalizedApplyRevalidation,
    pluginDriverOwnership: options.pluginDriverOwnership || null,
  });
  const combinedProof = {
    ...verify,
    applyRevalidation: normalizedApplyRevalidation,
    ...(options.pluginDriverOwnership ? { pluginDriverOwnership: options.pluginDriverOwnership } : {}),
    releaseBoundaryVerification,
  };
  if (options.requireRealReleaseBoundary && releaseBoundaryVerification.ok !== true) {
    const diagnostics = buildFailClosedDiagnostics({
      reason: 'incomplete-release-boundary-proof',
      missing: releaseBoundaryVerification.missingProofs,
    });
    process.stdout.write(
      JSON.stringify(
        {
          ...combinedProof,
          ok: false,
          failClosedDiagnostics: diagnostics,
          nextCommand: diagnostics.nextCommand,
        },
        null,
        2,
      ),
    );
    process.stdout.write('\n');
    process.exit(1);
  }

  process.stdout.write(
    JSON.stringify(
      combinedProof,
      null,
      2,
    ),
  );
  process.stdout.write('\n');
}

export function normalizeApplyRevalidationProof(applyRevalidation, { packagedBoundaryRequested = false } = {}) {
  if (!applyRevalidation || !packagedBoundaryRequested) {
    return applyRevalidation;
  }

  return {
    ...applyRevalidation,
    boundary: normalizeApplyRevalidationBoundary(applyRevalidation.boundary, { packagedBoundaryRequested }),
  };
}

export function normalizeApplyRevalidationBoundary(boundary, { packagedBoundaryRequested = false } = {}) {
  if (!boundary || !packagedBoundaryRequested) {
    return boundary || null;
  }

  const nextBoundary = {
    ...boundary,
    firstRemainingProductionBoundary: 'explicit live production-owned release boundary',
    status: 'support-only',
    verdict: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
    liveSource: {
      required: 'REPRINT_PUSH_SOURCE_URL',
      observed: 'packaged-production-plugin-fallback',
      verdict: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
    },
  };

  if (nextBoundary.authSession?.verdict === 'LIVE_RELEASE_BOUNDARY_OK') {
    nextBoundary.authSession = {
      ...nextBoundary.authSession,
      verdict: 'PACKAGED_RELEASE_BOUNDARY_OK',
    };
  }

  if (nextBoundary.durableJournal?.verdict === 'LIVE_RELEASE_BOUNDARY_OK') {
    nextBoundary.durableJournal = {
      ...nextBoundary.durableJournal,
      verdict: 'PACKAGED_RELEASE_BOUNDARY_OK',
    };
  }

  if (nextBoundary.replayAndRetry?.verdict === 'LIVE_RELEASE_BOUNDARY_OK') {
    nextBoundary.replayAndRetry = {
      ...nextBoundary.replayAndRetry,
      verdict: 'PACKAGED_RELEASE_BOUNDARY_OK',
    };
  }

  return nextBoundary;
}

function emitReleaseFailureAndExit(verify) {
  process.stdout.write(JSON.stringify(annotateFailClosedProof(verify.proof), null, 2));
  process.stdout.write('\n');
  process.exit(verify.status || 1);
}

function resolveRealReleaseBoundaryGate() {
  if (!explicitLiveSourceUrl && !explicitAuthSessionSourceCommand) {
    return {
      code: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      observed: 'missing-live-source',
      missing: ['REPRINT_PUSH_SOURCE_URL'],
      reason: 'live-source-required',
    };
  }

  if (
    explicitLiveSourceUrl
    && !explicitAuthSessionSourceCommand
    && (!explicitLiveUsername || !explicitLiveApplicationPassword)
  ) {
    return {
      code: 'REPRINT_PUSH_SECRET_REQUIRED',
      observed: 'missing-production-credentials',
      missing: [
        ...(!explicitLiveUsername ? ['REPRINT_PUSH_USERNAME'] : []),
        ...(!explicitLiveApplicationPassword ? ['REPRINT_PUSH_APPLICATION_PASSWORD'] : []),
      ],
      reason: 'production-credentials-required',
    };
  }

  return null;
}

function emitRealReleaseBoundaryGateAndExit(gate) {
  const diagnostics = buildFailClosedDiagnostics(gate);
  process.stdout.write(
    JSON.stringify(
      {
        ok: false,
        topology: {
          sourceUrl: explicitLiveSourceUrl || null,
          remoteBase: null,
          remoteChanged: explicitLiveRemoteChangedUrl || null,
          localEdited: explicitLiveLocalUrl || null,
        },
        boundary: {
          firstRemainingProductionBoundary: 'explicit live production-owned release boundary',
          status: 'blocked',
          verdict: gate.code,
          liveSource: {
            required: 'REPRINT_PUSH_SOURCE_URL or REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND',
            observed: gate.observed,
            verdict: gate.code,
          },
          authSession: {
            required: 'production-auth-session issuance and preserved readback',
            observed: gate.observed,
            verdict: gate.code === 'REPRINT_PUSH_SECRET_REQUIRED'
              ? 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED'
              : gate.code,
          },
          durableJournal: {
            storageLeaseFence: 'not checked because the live release source gate failed closed',
            verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
          },
        },
        preflight: {
          status: 0,
          authSessionType: gate.observed,
          routeProfile: 'production-shaped',
          session: {
            id: '',
            type: gate.observed,
          },
        },
        releaseProof: {
          ok: false,
          status: 1,
          code: gate.code,
        },
        authSessionSource: null,
        failClosedDiagnostics: diagnostics,
        nextCommand: diagnostics.nextCommand,
      },
      null,
      2,
    ),
  );
  process.stdout.write('\n');
  process.exit(1);
}

function emitMissingExplicitCredentialGateAndExit() {
  const diagnostics = buildFailClosedDiagnostics({
    code: 'REPRINT_PUSH_SECRET_REQUIRED',
    observed: 'missing-production-credentials',
    missing: [
      ...(!explicitLiveUsername ? ['REPRINT_PUSH_USERNAME'] : []),
      ...(!explicitLiveApplicationPassword ? ['REPRINT_PUSH_APPLICATION_PASSWORD'] : []),
    ],
    reason: 'production-credentials-required',
  });
  process.stdout.write(
    JSON.stringify(
      {
        ok: false,
        topology: {
          sourceUrl: explicitLiveSourceUrl,
          remoteBase: null,
          remoteChanged: null,
          localEdited: null,
        },
        boundary: {
          firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
          status: 'unimplemented',
          verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
          durableJournal: {
            storageLeaseFence: 'production durable journal storage, lease, and fencing are not yet proven beyond the retained Playground journal path',
            verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
          },
          authSession: {
            required: 'production-auth-session',
            observed: 'missing-production-credentials',
            verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
          },
          liveAuthSessionSource: {
            requiredCommand: 'REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND',
            verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
            observed: 'missing-production-credentials',
          },
        },
        preflight: {
          status: 0,
          authSessionType: 'missing-production-credentials',
          routeProfile: 'production-shaped',
          session: {
            id: '',
            type: 'missing-production-credentials',
          },
        },
        releaseProof: {
          ok: false,
          status: 1,
          code: 'REPRINT_PUSH_SECRET_REQUIRED',
        },
        authSessionSource: null,
        failClosedDiagnostics: diagnostics,
        nextCommand: diagnostics.nextCommand,
      },
      null,
      2,
    ),
  );
  process.stdout.write('\n');
  process.exit(1);
}

function runPluginDriverOwnershipProof() {
  const proof = spawnSync(process.execPath, ['scripts/playground/production-plugin-package-smoke.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 120_000,
    killSignal: 'SIGKILL',
    maxBuffer: 1024 * 1024 * 20,
    env: {
      ...process.env,
      REPRINT_PUSH_PACKAGE_SMOKE_MODE: 'driver-guard-only',
      REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO: 'driver-verifier-guards',
      NODE_NO_WARNINGS: '1',
    },
  });

  process.stderr.write(proof.stderr || '');
  assert.equal(proof.error, undefined, proof.error?.stack || proof.stderr || proof.stdout);
  assert.equal(proof.signal, null, proof.stderr || proof.stdout);
  assert.equal(proof.status, 0, proof.stderr || proof.stdout);

  return normalizePluginDriverOwnershipProof(
    parseJsonOutput(
      proof.stdout,
      'plugin driver ownership proof',
      `${proof.stdout || ''}${proof.stderr ? `\n${proof.stderr}` : ''}`,
    ),
  );
}

function normalizePluginDriverOwnershipProof(summary) {
  const receiptGuard = summary.driverReceiptRevokedCredentialGuard || {};
  const ownership = {
    revokedCredentialApplyRejected: receiptGuard.applyRejectedCode === 'reprint_push_lab_auth_required',
    rowRetainedAfterReject: receiptGuard.rowRetainedAfterReject === true,
    payloadPreservedAfterReject: receiptGuard.payloadModeAfterReject === 'base',
    missingExportRowsCallbackRejected: summary.driverExportGuard?.exportFailed === true
      && summary.driverExportGuard?.missingExportRowsCallback === true,
    missingApplyRowCallbackRejected: summary.driverApplyGuard?.exportFailed === true
      && summary.driverApplyGuard?.missingApplyRowCallback === true,
    missingValidateMutationCallbackRejected: summary.driverValidateGuard?.exportFailed === true
      && summary.driverValidateGuard?.missingValidateMutationCallback === true,
    missingDriverNameRejected: summary.driverMissingNameGuard?.exportFailed === true
      && summary.driverMissingNameGuard?.missingDriverName === true,
    missingPluginOwnerRejected: summary.driverPluginOwnerGuard?.exportFailed === true
      && summary.driverPluginOwnerGuard?.missingPluginOwner === true,
    missingTableRejected: summary.driverMissingTableGuard?.exportFailed === true
      && summary.driverMissingTableGuard?.missingTable === true,
    duplicateDriverNameRejected: summary.driverDuplicateNameGuard?.exportFailed === true
      && summary.driverDuplicateNameGuard?.duplicateDriverName === true,
    duplicateTableRejected: summary.driverDuplicateTableGuard?.exportFailed === true
      && summary.driverDuplicateTableGuard?.duplicateTable === true,
  };

  return {
    ok: Object.values(ownership).every((value) => value === true),
    status: 0,
    mode: summary.mode || 'driver-guard-only',
    scenario: 'driver-verifier-guards',
    package: summary.package || null,
    ownership,
    rejectedRemoteEvidence: {
      resourceKey: receiptGuard.resourceKey || '',
      applyRejectedCode: receiptGuard.applyRejectedCode || '',
      rowRetainedAfterReject: receiptGuard.rowRetainedAfterReject === true,
      updatedMarkerAfterReject: receiptGuard.updatedMarkerAfterReject || '',
      payloadModeAfterReject: receiptGuard.payloadModeAfterReject || '',
    },
  };
}

function buildReleaseBoundaryVerification({ verify, applyRevalidation, pluginDriverOwnership }) {
  const endpoint = buildEndpointVerification(verify);
  const authSession = buildAuthSessionVerification(verify);
  const durableJournal = buildDurableJournalVerification(verify);
  const preservedRemoteRetry = buildPreservedRemoteRetryVerification(verify);
  const rejectedRemoteEvidence = buildRejectedRemoteEvidenceVerification(applyRevalidation);
  const applyTimeRevalidation = buildApplyTimeRevalidationVerification(verify);
  const pluginDriver = buildPluginDriverVerification(pluginDriverOwnership);
  const sections = {
    endpoint,
    authSession,
    durableJournal,
    preservedRemoteRetry,
    rejectedRemoteEvidence,
    applyTimeRevalidation,
    pluginDriver,
  };
  const missingProofs = Object.entries(sections)
    .filter(([, section]) => section.proven !== true)
    .map(([name]) => name);

  return {
    ok: missingProofs.length === 0,
    checkedCommand: checkedReleaseCommand,
    requiredProofs: Object.keys(sections),
    missingProofs,
    endpoint,
    authSession,
    durableJournal,
    preservedRemoteRetry,
    rejectedRemoteEvidence,
    applyTimeRevalidation,
    pluginDriver,
  };
}

function buildEndpointVerification(verify) {
  const routeProfile = verify.preflight?.routeProfile || {};
  return {
    proven: verify.preflight?.status === 200
      && routeProfile.profile === 'production-shaped'
      && routeProfile.labBacked === false,
    status: verify.preflight?.status ?? null,
    routeProfile,
  };
}

function buildAuthSessionVerification(verify) {
  const issued = verify.authSessionLifecycleSummary?.issued
    || verify.releaseProof?.authSessionLifecycle?.minted
    || null;
  const read = verify.authSessionLifecycleSummary?.read
    || verify.releaseProof?.authSessionLifecycle?.read
    || null;
  const sourceUrl = verify.topology?.sourceUrl || verify.authSessionSource?.sourceUrl || '';
  const authSessionSourceUrl = verify.authSessionSource?.sourceUrl || sourceUrl;
  const sameSession = Boolean(issued?.id && read?.id && issued.id === read.id);
  const sameSourceAtIssuanceReadback = Boolean(sourceUrl && authSessionSourceUrl === sourceUrl && issued && read);
  const issuedActive = issued?.type === 'production-auth-session'
    && issued?.status === 'active'
    && issued?.expired === false;
  const readActive = read?.type === 'production-auth-session'
    && read?.status === 'active'
    && read?.expired === false
    && read?.preserved === true;

  return {
    proven: sameSession && sameSourceAtIssuanceReadback && issuedActive && readActive,
    sourceUrl,
    issued: summarizeAuthSessionObservation(issued, sourceUrl),
    read: summarizeAuthSessionObservation(read, sourceUrl),
    sameSession,
    sameSourceAtIssuanceReadback,
  };
}

function summarizeAuthSessionObservation(observation, sourceUrl) {
  if (!observation || typeof observation !== 'object') {
    return null;
  }

  return {
    step: observation.step || null,
    id: observation.id || null,
    type: observation.type || null,
    status: observation.status || null,
    expiresAt: observation.expiresAt || null,
    authUser: observation.authUser || null,
    expired: observation.expired === true,
    revoked: observation.revoked === true,
    cleanedUp: observation.cleanedUp === true,
    rotated: observation.rotated === true,
    preserved: observation.preserved === true,
    sourceUrl,
  };
}

function buildDurableJournalVerification(verify) {
  const journal = verify.durableJournal?.proof?.journal || verify.releaseProof?.dbJournal || null;
  const ownership = verify.durableJournal?.ownership || journal?.ownership || null;
  const leaseFence = verify.durableJournal?.proof?.leaseFence
    || verify.durableJournal?.liveLeaseFence
    || journal?.leaseFence
    || null;
  const storageGuard = leaseFence?.storageGuard || leaseFence?.boundary || journal?.storageGuard?.boundary || null;

  return {
    proven: verify.durableJournal?.checkedAccepted === true
      && ownership?.ownsJournal === true
      && ownership?.restartReadable === true
      && leaseFence?.restartReadable === true
      && leaseFence?.staleClaimRejected === true
      && storageGuard === 'wpdb-single-statement-cas',
    checkedAccepted: verify.durableJournal?.checkedAccepted === true,
    ownership,
    leaseFence,
    storageGuard,
    rows: verify.durableJournal?.rows ?? null,
    applyCommitted: verify.durableJournal?.applyCommitted === true,
  };
}

function buildPreservedRemoteRetryVerification(verify) {
  const replayAndRetry = verify.releaseProof?.replayAndRetry
    || verify.replayAndRetry
    || verify.boundary?.replayAndRetry
    || null;
  const retryAttempts = replayAndRetry?.retryAttempts || verify.releaseProof?.retryAttempts || 0;

  return {
    proven: retryAttempts >= 2
      && replayAndRetry?.observed === (replayAndRetry?.required || requiredPreservedRemoteRetryPath)
      && ['PRESERVED_REMOTE_RETRY_PROVEN', 'LIVE_RELEASE_BOUNDARY_OK', 'PACKAGED_RELEASE_BOUNDARY_OK']
        .includes(replayAndRetry?.verdict),
    required: replayAndRetry?.required || requiredPreservedRemoteRetryPath,
    observed: replayAndRetry?.observed || null,
    retryAttempts,
    verdict: replayAndRetry?.verdict || null,
  };
}

function buildRejectedRemoteEvidenceVerification(applyRevalidation) {
  const apply = applyRevalidation?.apply || null;
  return {
    proven: apply?.status === 412
      && apply?.code === 'PRECONDITION_FAILED'
      && apply?.preconditionCheck === 'just-in-time'
      && apply?.recovery?.required === true
      && apply?.recovery?.state === 'blocked-recovery',
    apply,
  };
}

function buildApplyTimeRevalidationVerification(verify) {
  const evidence = verify.releaseProof?.apply?.applyRevalidation || null;

  return {
    proven: evidence?.required === 'fresh-live-hashes-before-first-mutation'
      && evidence?.phase === 'before-first-mutation'
      && evidence?.checkedAgainst === 'live-remote'
      && Number.isInteger(evidence?.verifiedCount)
      && evidence.verifiedCount > 0
      && Number.isInteger(evidence?.claim?.activeClaimSequence)
      && evidence.claim.activeClaimSequence > 0,
    evidence,
  };
}

function buildPluginDriverVerification(pluginDriverOwnership) {
  return {
    proven: pluginDriverOwnership?.ok === true,
    ...(pluginDriverOwnership || {
      ok: false,
      status: null,
      mode: 'driver-guard-only',
      scenario: 'driver-verifier-guards',
    }),
  };
}

function annotateFailClosedProof(proof) {
  if (!requireRealReleaseBoundary || !proof || typeof proof !== 'object') {
    return proof;
  }
  const diagnostics = buildFailClosedDiagnostics({
    reason: proof.preflight?.authSessionType || proof.releaseProof?.code || 'release-boundary-proof-failed',
    missing: [],
  });
  return {
    ...proof,
    failClosedDiagnostics: diagnostics,
    nextCommand: diagnostics.nextCommand,
  };
}

function buildFailClosedDiagnostics({ code = '', observed = '', missing = [], reason = '' } = {}) {
  return {
    checkedCommand: checkedReleaseCommand,
    failClosed: true,
    reason: reason || code || observed || 'release-boundary-input-required',
    missing,
    nextCommand: buildNextReleaseVerifyCommand(),
    secretRedaction: 'REPRINT_PUSH_APPLICATION_PASSWORD is required when no auth-session source command is supplied; the verifier reports only whether it is present.',
    requiredProofs: [
      'real production-shaped Reprint endpoint',
      'auth/session issuance and readback',
      'same source at issuance/readback',
      'durable restart-readable journal ownership with lease fencing',
      'preserved rejected-remote evidence',
      'apply-time revalidation before first mutation',
      'plugin-driver ownership',
    ],
  };
}

function buildNextReleaseVerifyCommand() {
  return [
    shellEnvAssignment('REPRINT_PUSH_SOURCE_URL', explicitLiveSourceUrl || '<production Reprint URL>'),
    shellEnvAssignment('REPRINT_PUSH_USERNAME', explicitLiveUsername || '<WordPress application-password user>'),
    shellEnvAssignment(
      'REPRINT_PUSH_APPLICATION_PASSWORD',
      explicitLiveApplicationPassword ? '$REPRINT_PUSH_APPLICATION_PASSWORD' : '<application password>',
      { allowExpansion: Boolean(explicitLiveApplicationPassword) },
    ),
    checkedReleaseCommand,
  ].join(' ');
}

function shellEnvAssignment(name, value, { allowExpansion = false } = {}) {
  return `${name}=${allowExpansion ? `"${value}"` : shellQuote(value)}`;
}

function shellQuote(value) {
  const stringValue = String(value);
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(stringValue)) {
    return stringValue;
  }
  return `'${stringValue.replace(/'/g, "'\\''")}'`;
}

function parseJsonOutput(stdout, label, details = stdout) {
  const trimmed = (stdout || '').trim();
  const firstBrace = trimmed.indexOf('{');
  assert.notEqual(firstBrace, -1, `${label} did not emit JSON\n${details}`);
  return JSON.parse(extractFirstJsonObject(trimmed.slice(firstBrace), label, details));
}

function extractFirstJsonObject(text, label, details) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(0, index + 1);
      }
    }
  }

  throw new assert.AssertionError({
    message: `${label} emitted unterminated JSON\n${details}`,
    actual: text,
    expected: 'complete JSON object',
    operator: 'extractFirstJsonObject',
  });
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
  for (let attempt = 1; attempt <= 3; attempt += 1) {
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

    try {
      await waitForServer(child, baseUrl, () => output);
      return { name, baseUrl, child };
    } catch (error) {
      const logs = `${output}\n${error instanceof Error ? error.message : String(error)}`;
      await stopPlaygroundChild(child).catch(() => {});
      if (!/EADDRINUSE/i.test(logs) || attempt === 3) {
        throw error;
      }
    }
  }

  throw new Error(`Unable to start Playground server for ${name} after retrying port collisions`);
}

async function stopPlaygroundServer(server) {
  await stopPlaygroundChild(server.child);
}

async function stopPlaygroundChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill('SIGTERM');
  await waitForExit(child, 12_000);
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
      throw createPlaygroundStartupError(
        `Playground server ${exitLabel}`,
        lastError,
        lastProbes,
        getLogs(),
      );
    }
    try {
      const response = await fetch(`${baseUrl}/wp-json/`, {
        headers: { connection: 'close' },
      });
      const responseBody = await response.text();
      lastProbes.push({
        route: '/wp-json/',
        status: response.status,
        ok: response.ok,
        body: responseBody.slice(0, readinessFailureBodyLimit),
      });
      if (response.status === 200) {
        return;
      }
      lastError = new Error(`Playground index readiness HTTP ${response.status}`);
      if (isWordPressNotReadyResponse(response.status, responseBody)) {
        consecutiveNotReadyResponses += 1;
        if (consecutiveNotReadyResponses >= maxNotReadyReadinessProbes) {
          throw createPlaygroundStartupError(
            `Playground server reported the bounded readiness failure ${response.status} after ${lastProbes.length} /wp-json/ probes (${consecutiveNotReadyResponses} consecutive not-ready responses; limit ${maxNotReadyReadinessProbes})`,
            lastError,
            lastProbes,
            getLogs(),
          );
        }
      } else {
        consecutiveNotReadyResponses = 0;
      }
    } catch (error) {
      if (error?.isPlaygroundStartupFailure === true) {
        throw error;
      }
      lastError = error;
      consecutiveNotReadyResponses = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, readinessProbeIntervalMs));
  }
  throw createPlaygroundStartupError(
    `Timed out waiting for Playground server at ${baseUrl}`,
    lastError,
    lastProbes,
    getLogs(),
  );
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

function isWordPressNotReadyResponse(status, body = '') {
  return status === 502 && /WordPress is not ready yet/i.test(body);
}

function createPlaygroundStartupError(prefix, lastError, lastProbes, logs) {
  const probeTrail = lastProbes.length
    ? `\nProbe trail: ${JSON.stringify(lastProbes.slice(-4), null, 2)}`
    : '';
  const lastProbe = lastProbes.at(-1) ?? null;
  const lastProbeText = lastProbe
    ? `\nLast probe: ${JSON.stringify(lastProbe, null, 2)}`
    : '';
  const message = `${prefix}: ${lastError?.message || 'unknown'}${probeTrail}${lastProbeText}\n${logs}`;
  const error = new Error(message);
  error.isPlaygroundStartupFailure = true;
  return error;
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
