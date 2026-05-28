#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  applyRevalidationRetryable,
  buildDurableRecoveryJournalReleaseProof,
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
const serverStartupTimeoutMs = 30_000;
const readinessProbeIntervalMs = 500;
const readinessFailureBodyLimit = 240;
const maxNotReadyReadinessProbes = Math.max(4, Math.ceil(serverStartupTimeoutMs / readinessProbeIntervalMs));

const credentials = {
  username: releaseVerifyFixtureCredentials.username,
  applicationPassword: releaseVerifyFixtureCredentials.applicationPassword,
};
const configuredLiveSourceUrl = process.env.REPRINT_PUSH_SOURCE_URL || '';
const configuredRemoteUrl = process.env.REPRINT_PUSH_REMOTE_URL || '';
const explicitLiveSourceUrl = configuredLiveSourceUrl;
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
const innerVerifyTimeoutMs = positiveIntegerEnv(
  'REPRINT_PUSH_LIVE_RELEASE_VERIFY_TIMEOUT_MS',
  packagedBoundaryRequested ? 180_000 : 90_000,
);
const applyRevalidationTimeoutMs = 240_000;
const applyRevalidationRetries = packagedBoundaryRequested ? 2 : 1;

const topologyBlocker = resolveReleaseTopologyBlocker();
if (topologyBlocker) {
  emitTopologyGateFailureAndExit(topologyBlocker);
}

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
emitCombinedReleaseProof(verify.proof, applyRevalidation);

function resolveReleaseTopologyBlocker() {
  if (!configuredLiveSourceUrl) {
    return {
      code: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      observed: 'missing-live-source',
      reason: 'REPRINT_PUSH_SOURCE_URL is required before the release verifier can run preflight, dry-run, apply, or recovery.',
      boundary: {
        firstRemainingProductionBoundary: 'explicit live production-owned release boundary',
        status: 'blocked',
        verdict: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
        liveSource: {
          required: 'REPRINT_PUSH_SOURCE_URL',
          observed: 'missing-live-source',
          verdict: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
        },
      },
    };
  }

  if (configuredRemoteUrl && !sameReleaseTopologyUrl(configuredLiveSourceUrl, configuredRemoteUrl)) {
    return {
      code: 'REPRINT_PUSH_SOURCE_URL_MISMATCH',
      observed: 'wrong-source-url',
      reason: 'REPRINT_PUSH_REMOTE_URL must match REPRINT_PUSH_SOURCE_URL on the checked release path.',
      boundary: {
        firstRemainingProductionBoundary: 'source/local/changed production topology',
        status: 'blocked',
        verdict: 'REPRINT_PUSH_SOURCE_URL_MISMATCH',
        liveSource: {
          required: configuredLiveSourceUrl,
          observed: configuredRemoteUrl,
          verdict: 'REPRINT_PUSH_SOURCE_URL_MISMATCH',
        },
      },
    };
  }

  if (packagedBoundaryRequested) {
    return {
      code: 'REPRINT_PUSH_PACKAGED_FALLBACK_REJECTED',
      observed: 'packaged-production-plugin-fallback',
      reason: 'Packaged production-plugin fallback is support evidence only and cannot move release gates.',
      boundary: {
        firstRemainingProductionBoundary: 'explicit live production-owned release boundary',
        status: 'blocked',
        verdict: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
        liveSource: {
          required: 'non-packaged REPRINT_PUSH_SOURCE_URL',
          observed: 'packaged-production-plugin-fallback',
          verdict: 'REPRINT_PUSH_PACKAGED_FALLBACK_REJECTED',
        },
      },
    };
  }

  if (!explicitLiveRemoteChangedUrl) {
    return {
      code: 'REPRINT_PUSH_REMOTE_CHANGED_URL_REQUIRED',
      observed: 'missing-remote-changed-source',
      reason: 'REPRINT_PUSH_REMOTE_CHANGED_URL is required to prove stale remote replay fails before mutation.',
      boundary: {
        firstRemainingProductionBoundary: 'source/local/changed production topology',
        status: 'blocked',
        verdict: 'REPRINT_PUSH_REMOTE_CHANGED_URL_REQUIRED',
        topology: {
          required: 'REPRINT_PUSH_REMOTE_CHANGED_URL',
          observed: {
            sourceUrl: configuredLiveSourceUrl,
            remoteChangedUrl: '',
            localUrl: explicitLiveLocalUrl || '',
          },
        },
      },
    };
  }

  if (!explicitLiveLocalUrl) {
    return {
      code: 'REPRINT_PUSH_LOCAL_URL_REQUIRED',
      observed: 'missing-local-edited-site',
      reason: 'REPRINT_PUSH_LOCAL_URL is required to prove the local edited site boundary.',
      boundary: {
        firstRemainingProductionBoundary: 'source/local/changed production topology',
        status: 'blocked',
        verdict: 'REPRINT_PUSH_LOCAL_URL_REQUIRED',
        topology: {
          required: 'REPRINT_PUSH_LOCAL_URL',
          observed: {
            sourceUrl: configuredLiveSourceUrl,
            remoteChangedUrl: explicitLiveRemoteChangedUrl,
            localUrl: '',
          },
        },
      },
    };
  }

  return null;
}

function positiveIntegerEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
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
  const effectiveSourceUrl = sourceUrl || explicitLiveSourceUrl;
  const reuseAuthSessionSourceCommand = Boolean(
    authSessionSourceCommand
    && effectiveSourceUrl
    && sameReleaseTopologyUrl(effectiveSourceUrl, explicitLiveSourceUrl),
  );
  return resolveLiveApplyRevalidationEnv({
    sourceUrl: effectiveSourceUrl,
    remoteChangedUrl: remoteChangedUrl || explicitLiveRemoteChangedUrl,
    localUrl,
    packagedBoundaryRequested,
    username,
    applicationPassword,
    authSessionSourceCommand: reuseAuthSessionSourceCommand ? authSessionSourceCommand : '',
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
      readOnly: summary.dryRun?.readOnly || null,
      receiptBinding: summary.dryRun?.receiptBinding || null,
    },
    apply: summary.apply || null,
    replay: summary.replay || null,
    recoveryInspect: summary.recoveryInspect || null,
    dbJournal: summary.dbJournal || null,
    missingReceipt: summary.missingReceipt || null,
    boundary: normalizeApplyRevalidationBoundary(summary.boundary, options),
  };
}

function summarizeCheckedReleaseApplyRevalidationProof(verify, options = {}) {
  const releaseProof = verify?.releaseProof || {};
  const dryRun = releaseProof.dryRun || {};
  const apply = releaseProof.apply || {};
  const applyRevalidation = apply.applyRevalidation || dryRun.applyRevalidation || null;

  return {
    ok: verify?.ok === true
      && applyRevalidation?.phase === 'before-first-mutation'
      && applyRevalidation?.checkedAgainst === 'live-remote',
    topology: verify?.topology || null,
    authSessionSource: verify?.authSessionSource || null,
    preflight: {
      status: verify?.preflight?.status ?? null,
      routeProfile: verify?.preflight?.routeProfile?.profile || verify?.preflight?.routeProfile || null,
      sessionType: verify?.preflight?.session?.type || null,
    },
    dryRun: {
      status: dryRun.status ?? null,
      mode: dryRun.mode || null,
      receiptHash: dryRun.receiptHash || null,
    },
    apply,
    recoveryInspect: releaseProof.recoveryInspect || null,
    boundary: normalizeApplyRevalidationBoundary(verify?.boundary, options),
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
  const releaseMovement = resolveReleaseMovement(verify, normalizedApplyRevalidation, options);
  const durableRecoveryJournalProof = buildDurableRecoveryJournalReleaseProof({
    releaseSummary: verify,
    applyRevalidation: normalizedApplyRevalidation,
  });
  assert.equal(
    durableRecoveryJournalProof.ok,
    true,
    `durable recovery journal release-boundary proof failed:\n${JSON.stringify(durableRecoveryJournalProof, null, 2)}`,
  );

  process.stdout.write(
    JSON.stringify(
      {
        ...verify,
        gate2DurableRecoveryJournal: durableRecoveryJournalProof,
        applyRevalidation: normalizedApplyRevalidation,
        topologyEvidence: buildReleaseTopologyEvidence({
          verify,
          applyRevalidation: normalizedApplyRevalidation,
          options,
          releaseMovement,
        }),
        releaseMovement,
      },
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

function resolveReleaseMovement(verify, applyRevalidation, { packagedBoundaryRequested = false } = {}) {
  if (packagedBoundaryRequested) {
    return {
      allowed: false,
      gates: '0/4',
      reason: 'packaged production-plugin fallback is support evidence only',
    };
  }

  const liveBoundaryOk = verify?.boundary?.verdict === 'LIVE_RELEASE_BOUNDARY_OK'
    && verify?.boundary?.firstRemainingProductionBoundary === null;
  const applyBoundaryOk = applyRevalidation?.boundary?.verdict === 'LIVE_RELEASE_BOUNDARY_OK'
    && applyRevalidation?.boundary?.firstRemainingProductionBoundary === null;
  const topologyComplete = Boolean(
    configuredLiveSourceUrl
    && explicitLiveRemoteChangedUrl
    && explicitLiveLocalUrl,
  );
  const allowed = verify?.ok === true
    && applyRevalidation?.ok === true
    && liveBoundaryOk
    && applyBoundaryOk
    && topologyComplete;

  return {
    allowed,
    gates: allowed ? 'candidate-for-review' : '0/4',
    reason: allowed
      ? 'checked live source/local/changed topology passed without packaged fallback'
      : 'release movement requires live source/local/changed topology and LIVE_RELEASE_BOUNDARY_OK on verify and apply revalidation',
  };
}

function buildReleaseTopologyEvidence({
  verify = null,
  applyRevalidation = null,
  options = {},
  releaseMovement = null,
  blocker = null,
} = {}) {
  const sourceUrl = configuredLiveSourceUrl || verify?.topology?.sourceUrl || '';
  const remoteChangedUrl = explicitLiveRemoteChangedUrl || verify?.topology?.remoteChanged || '';
  const localEditedUrl = explicitLiveLocalUrl || verify?.topology?.localEdited || '';
  const applySourceUrl = explicitApplyRevalidationSourceUrl || applyRevalidation?.topology?.sourceUrl || sourceUrl;
  const packagedFallbackSource = Boolean(sourceUrl && (options.packagedBoundaryRequested || packagedBoundaryRequested));
  const sourceKind = packagedFallbackSource
    ? 'packaged plugin fallback'
    : classifyServiceKind(sourceUrl);

  return {
    gate: 'GATE-3',
    checkedCommand: 'timeout 300s npm run verify:release',
    runner: {
      script: 'scripts/playground/production-shaped-live-release-verify.mjs',
      process: 'node',
      routeProfile: 'production-shaped',
      packagedFallbackAllowed: false,
    },
    ports: {
      sandboxIngress: 8080,
      source: urlPort(sourceUrl),
      remoteChanged: urlPort(remoteChangedUrl),
      localEdited: urlPort(localEditedUrl),
      applyRevalidationSource: urlPort(applySourceUrl),
    },
    services: {
      source: serviceEvidence('source', sourceUrl, sourceKind),
      remoteChanged: serviceEvidence('remote changed/drift source', remoteChangedUrl, classifyServiceKind(remoteChangedUrl)),
      localEdited: serviceEvidence('local edited site', localEditedUrl, classifyServiceKind(localEditedUrl)),
      applyRevalidationSource: serviceEvidence(
        'apply revalidation source',
        applySourceUrl,
        classifyServiceKind(applySourceUrl),
      ),
    },
    topology: {
      sourceUrl,
      localEditedSite: localEditedUrl,
      remoteChangedDriftSource: remoteChangedUrl,
      sameRemoteIdentity: verify?.remoteSnapshotHashes?.sameRemoteIdentity ?? null,
      sourceCommand: redactAuthSessionSourceCommand(
        verify?.authSessionSource?.command || explicitAuthSessionSourceCommand || '',
      ),
      sourceCommandReadbackUrl: verify?.authSessionSource?.sourceUrl || '',
      packagedFallbackSource,
      blocker: blocker?.code || null,
    },
    releaseMovement: releaseMovement || {
      allowed: false,
      gates: '0/4',
      reason: 'release movement has not been evaluated',
    },
  };
}

function redactAuthSessionSourceCommand(command = '') {
  return String(command || '')
    .replace(/(['"]--application-password=)[^'"]*(['"])/g, '$1<redacted>$2')
    .replace(/(--application-password=)[^\s'"]+/g, '$1<redacted>')
    .replace(/(--application-password)(\s+)(?:'[^']*'|"[^"]*"|[^\s]+)/g, '$1$2<redacted>')
    .replace(
      /\b(REPRINT_PUSH_(?:APPLICATION_PASSWORD|LAB_AUTH_ADMIN_APP_PASSWORD)=)(?:'[^']*'|"[^"]*"|[^\s]+)/g,
      '$1<redacted>',
    );
}

function serviceEvidence(role, url, kind) {
  return {
    role,
    url: url || null,
    kind,
    port: urlPort(url),
    isPlayground: kind === 'Playground/local loopback WordPress',
    isDocker: kind === 'Docker/local loopback WordPress',
    isRealWp: kind === 'real WP over https',
    isPackagedPlugin: kind === 'packaged plugin fallback',
    isLiveSource: Boolean(url) && kind !== 'missing' && kind !== 'packaged plugin fallback',
  };
}

function classifyServiceKind(url) {
  if (!url) {
    return 'missing';
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return 'invalid URL';
  }

  if (parsed.protocol === 'https:') {
    return 'real WP over https';
  }

  if (isLoopbackHost(parsed.hostname)) {
    return parsed.port === '8080'
      ? 'Docker/local loopback WordPress'
      : 'Playground/local loopback WordPress';
  }

  return 'real WP over http';
}

function urlPort(url) {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);
    if (parsed.port) {
      return Number(parsed.port);
    }
    return parsed.protocol === 'https:' ? 443 : parsed.protocol === 'http:' ? 80 : null;
  } catch {
    return null;
  }
}

function sameReleaseTopologyUrl(left, right) {
  const normalizedLeft = normalizeReleaseTopologyUrl(left);
  const normalizedRight = normalizeReleaseTopologyUrl(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function normalizeReleaseTopologyUrl(value) {
  if (!value) {
    return '';
  }

  try {
    const parsed = new URL(value);
    parsed.hash = '';
    parsed.search = '';
    if (!parsed.pathname.endsWith('/')) {
      parsed.pathname += '/';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

function isLoopbackHost(hostname) {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname === '[::1]'
    || hostname.startsWith('127.');
}

function emitReleaseFailureAndExit(verify) {
  const exitCode = verify.status || 1;
  const reason = verify.proof?.releaseProof?.code
    || verify.proof?.boundary?.verdict
    || 'CHECKED_RELEASE_VERIFIER_FAILED';
  const releaseMovement = {
    allowed: false,
    gates: '0/4',
    reason,
  };
  const statusMarker = formatVerifyReleaseFailureStatusMarker({ exitCode, reason });
  emitVerifyReleaseFailurePayload({
    ...(verify.proof || {}),
    statusMarker,
    mutationAttempted: false,
    topologyEvidence: buildReleaseTopologyEvidence({
      verify: verify.proof || null,
      applyRevalidation: null,
      options: {},
      releaseMovement,
    }),
    releaseMovement,
  }, statusMarker);
  process.exit(exitCode);
}

function emitTopologyGateFailureAndExit(blocker) {
  const exitCode = 1;
  const releaseMovement = {
    allowed: false,
    gates: '0/4',
    reason: blocker.reason,
  };
  const statusMarker = formatVerifyReleaseFailureStatusMarker({ exitCode, reason: blocker.code });
  const payload = {
    ok: false,
    statusMarker,
    mutationAttempted: false,
    topology: {
      sourceUrl: configuredLiveSourceUrl,
      remoteBase: configuredLiveSourceUrl || null,
      remoteChanged: explicitLiveRemoteChangedUrl || null,
      localEdited: explicitLiveLocalUrl || null,
    },
    boundary: blocker.boundary,
    releaseProof: {
      ok: false,
      status: exitCode,
      code: blocker.code,
    },
    topologyEvidence: buildReleaseTopologyEvidence({
      verify: null,
      applyRevalidation: null,
      options: { packagedBoundaryRequested },
      releaseMovement,
      blocker,
    }),
    releaseMovement,
  };
  if (blocker.code === 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED') {
    process.stderr.write(
      'REPRINT_PUSH_LIVE_SOURCE_REQUIRED: production push requires REPRINT_PUSH_SOURCE_URL; gates remain 0/4 and packaged fallback is not allowed for release movement.\n',
    );
  }
  emitVerifyReleaseFailurePayload(payload, statusMarker);
  process.exit(exitCode);
}

function emitMissingExplicitCredentialGateAndExit() {
  const exitCode = 1;
  const releaseMovement = {
    allowed: false,
    gates: '0/4',
    reason: 'explicit live source URL is present but production credentials are missing',
  };
  const statusMarker = formatVerifyReleaseFailureStatusMarker({
    exitCode,
    reason: 'REPRINT_PUSH_SECRET_REQUIRED',
  });
  emitVerifyReleaseFailurePayload(
    {
      ok: false,
      statusMarker,
      mutationAttempted: false,
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
        status: exitCode,
        code: 'REPRINT_PUSH_SECRET_REQUIRED',
      },
      authSessionSource: null,
      topologyEvidence: buildReleaseTopologyEvidence({
        verify: null,
        applyRevalidation: null,
        releaseMovement,
      }),
      releaseMovement,
    },
    statusMarker,
  );
  process.exit(exitCode);
}

function emitVerifyReleaseFailurePayload(payload, statusMarker) {
  process.stdout.write(JSON.stringify(payload, null, 2));
  process.stdout.write(`\n${statusMarker}\n`);
}

function formatVerifyReleaseFailureStatusMarker({
  exitCode = 1,
  reason = 'UNKNOWN_VERIFY_RELEASE_FAILURE',
  mutationAttempted = false,
} = {}) {
  return `[verify-release:held exit=${sanitizeStatusMarkerToken(exitCode)} reason=${sanitizeStatusMarkerToken(reason)} mutationAttempted=${mutationAttempted === true ? 'true' : 'false'}]`;
}

function sanitizeStatusMarkerToken(value) {
  return String(value ?? '')
    .trim()
    .replace(/[\s\]]+/g, '-')
    .replace(/[^\w./:@+-]/g, '-')
    || 'unknown';
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
    return await run(server);
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
