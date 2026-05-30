#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import fs from 'node:fs';
import { writeSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  authenticatedHttpClient,
  dbJournalProofIsAcceptable,
  runAuthenticatedHttpPush,
} from '../../src/authenticated-http-push-client.js';
import { applyPlan, PushPlanError } from '../../src/apply.js';
import { createPushPlan } from '../../src/planner.js';
import { resourceHash, getResource } from '../../src/resources.js';
import { ABSENT, digest } from '../../src/stable-json.js';
import {
  describeAuthSessionSourceMetadataDrift,
  loadAuthSessionSourceFromRuntimeEnvironment,
  resolveAuthSessionRequestState,
} from './auth-session-source.js';
import {
  releaseVerifyFixtureCredentials,
  resolveReleaseVerifyCredentials,
} from './release-verify-credentials.js';
import {
  evaluateCheckedReleaseAuthSessionLifecycleSummary,
  evaluateProductionAuthSessionLifecycle,
  evaluateProductionAuthSessionLifecycleSummary,
  summarizeProductionAuthSessionLifecycleTrace,
} from './production-auth-session-lifecycle.js';
import {
  bindPackagedProductionPluginRuntimeSource,
  isPackagedProductionPluginSourceCommand,
  resolvePackagedProductionPluginAuthSessionRequest,
  resolvePackagedProductionPluginAuthSessionSource,
  shouldRequestPackagedProductionPluginAuthSession,
} from './packaged-production-plugin-source-command.js';
import {
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
  packagedProductionPluginSnapshotRetryable,
  packagedProductionPluginServerReady,
} from './packaged-production-plugin-readiness.js';
import {
  resolveCheckedReleaseTopology,
  shouldUseProductionSnapshotExport,
} from './production-shaped-live-release-verify-lib.js';
import { loadBlueprintSnapshotFixture } from './blueprint-snapshot-fixture.js';
import {
  arbitraryPluginFixturePackageBoundary,
  summarizeArbitraryPluginFixturePackageEvidence,
} from './production-plugin-package-scenarios.js';
import {
  appendRecoveryClaimOpened,
  checkedDurableJournalBoundarySatisfied,
  consumeProductionRecoveryJournal,
  openProductionRecoveryJournal,
} from '../../src/recovery-journal.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const isMainModule = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
const muPluginDir = path.join(repoRoot, 'scripts/playground/rest-mu-plugins');
const readinessProbeIntervalMs = 200;
const readinessFailureBodyLimit = 240;
// The release verifier starts remote-base, remote-changed, and local-edited in
// sequence, so the shared readiness helper needs a longer bounded window than
// the earlier single-server smoke path.
const serverStartupTimeoutMs = 30_000;
const serverFetchTimeoutMs = 1_000;
const packagedPlaygroundTimeoutSeconds = 45;
const packagedServerStartupTimeoutMs = packagedPlaygroundTimeoutSeconds * 1_000;
const packagedServerFetchTimeoutMs = 3_000;
const maxReadinessProbes = Math.max(10, Math.ceil(serverStartupTimeoutMs / readinessProbeIntervalMs));
const maxNotReadyReadinessProbes = Math.max(4, Math.ceil(serverStartupTimeoutMs / readinessProbeIntervalMs));
const requireProductionDurableJournal = process.env.REPRINT_PUSH_REQUIRE_PRODUCTION_DURABLE_JOURNAL === '1';
const requireProductionAuthSession = process.env.REPRINT_PUSH_REQUIRE_PRODUCTION_AUTH_SESSION === '1';
const labAuthSessionDrift = process.env.REPRINT_PUSH_LAB_AUTH_SESSION_DRIFT || '';
const requiredPreservedRemoteRetryPath = process.env.REPRINT_PUSH_SIMULATE_PRESERVED_REMOTE_RETRY_PATH || '/snapshot';
const authenticatedRequestTimeoutMs = positiveIntegerEnv('REPRINT_PUSH_AUTHENTICATED_REQUEST_TIMEOUT_MS', 10_000);
const explicitReleaseVerifySourceUrl = process.env.REPRINT_PUSH_SOURCE_URL || '';
const explicitReleaseVerifyRemoteChangedUrl = process.env.REPRINT_PUSH_REMOTE_CHANGED_URL || '';
const explicitReleaseVerifyLocalUrl = process.env.REPRINT_PUSH_LOCAL_URL || '';
const explicitReleaseVerifyUsername = process.env.REPRINT_PUSH_LAB_AUTH_ADMIN_USER || process.env.REPRINT_PUSH_USERNAME || '';
const explicitReleaseVerifyApplicationPassword = process.env.REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD || process.env.REPRINT_PUSH_APPLICATION_PASSWORD || '';
let liveSourceUrl = process.env.REPRINT_PUSH_SOURCE_URL || '';
let username = process.env.REPRINT_PUSH_LAB_AUTH_ADMIN_USER || process.env.REPRINT_PUSH_USERNAME || '';
let applicationPassword = process.env.REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD || process.env.REPRINT_PUSH_APPLICATION_PASSWORD || '';
const liveAuthSessionSourceBlocker = {
  requiredCommand: 'REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND',
  verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
};
let authSessionSourceCommand = process.env.REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND || '';
let authSessionSource = loadAuthSessionSourceFromRuntimeEnvironment(
  authSessionSourceCommand,
  process.env,
  process.cwd(),
  {
    sourceUrl: explicitReleaseVerifySourceUrl,
    remoteUrl: explicitReleaseVerifyRemoteChangedUrl,
    localUrl: explicitReleaseVerifyLocalUrl,
    requireExactSourceUrl: requireProductionAuthSession && Boolean(explicitReleaseVerifySourceUrl),
    checkedSourceUrl: explicitReleaseVerifySourceUrl,
  },
);
let packagedProductionPluginAuthSessionSource = null;
let packagedProductionPluginRequested = isPackagedProductionPluginSourceCommand(authSessionSourceCommand);
const requireExplicitLiveCheckedBoundary =
  requireProductionAuthSession
  && requireProductionDurableJournal
  && !explicitReleaseVerifySourceUrl;
const fixtureCredentials = {
  username: releaseVerifyFixtureCredentials.username,
  password: releaseVerifyFixtureCredentials.applicationPassword,
};
const resolvedAuthSessionRequest = resolveAuthSessionRequestState({
  liveSourceUrl,
  remoteUrl: explicitReleaseVerifyRemoteChangedUrl,
  localUrl: explicitReleaseVerifyLocalUrl,
  username,
  applicationPassword,
  fallbackUsername: fixtureCredentials.username,
  fallbackApplicationPassword: fixtureCredentials.password,
}, authSessionSource, {
  preferSource: requireProductionAuthSession,
});
liveSourceUrl = explicitReleaseVerifySourceUrl || resolvedAuthSessionRequest.liveSourceUrl;
username = resolvedAuthSessionRequest.username;
applicationPassword = resolvedAuthSessionRequest.applicationPassword;

if (
  !requireExplicitLiveCheckedBoundary
  && shouldRequestPackagedProductionPluginAuthSession({
  requireProductionAuthSession,
  authSessionSourceCommand,
  liveSourceUrl: explicitReleaseVerifySourceUrl,
  username: explicitReleaseVerifyUsername,
  applicationPassword: explicitReleaseVerifyApplicationPassword,
  fixtureUsername: fixtureCredentials.username,
  fixtureApplicationPassword: fixtureCredentials.password,
})) {
  const packagedProductionPluginAuthSessionRequest = resolvePackagedProductionPluginAuthSessionRequest({
    sourceUrl: liveSourceUrl || 'http://127.0.0.1:8080',
    username: resolvedAuthSessionRequest.credentials.username,
    applicationPassword: resolvedAuthSessionRequest.credentials.password,
    authSessionSourceCommand,
  });
  packagedProductionPluginAuthSessionSource = packagedProductionPluginAuthSessionRequest;
  packagedProductionPluginRequested = packagedProductionPluginAuthSessionRequest.requested;
}

if (packagedProductionPluginAuthSessionSource?.source.ok) {
  authSessionSourceCommand = packagedProductionPluginAuthSessionSource.command;
  authSessionSource = packagedProductionPluginAuthSessionSource.source;
  if (!liveSourceUrl) {
    liveSourceUrl = packagedProductionPluginAuthSessionSource.source.sourceUrl || liveSourceUrl;
  }
  if (!username) {
    username = packagedProductionPluginAuthSessionSource.source.username || username;
  }
  if (!applicationPassword) {
    applicationPassword = packagedProductionPluginAuthSessionSource.source.applicationPassword || applicationPassword;
  }
}

function summarizeAuthSessionSource(command, source) {
  if (!command) {
    return null;
  }

  return {
    command: redactAuthSessionSourceCommand(command),
    ok: Boolean(source?.ok),
    sourceUrl: source?.sourceUrl || '',
    username: source?.username || '',
    applicationPasswordPresent: source?.applicationPasswordPresent === true || Boolean(source?.applicationPassword),
    error: source?.error || '',
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
    )
    .replace(/(applicationPassword\s*:\s*['"])[^'"]+(['"])/g, '$1<redacted>$2')
    .replace(/(applicationPassword\\?"\s*:\s*\\?")[^"\\]+(\\?")/g, '$1<redacted>$2');
}

export function resolveAuthSessionBoundaryProof({
  liveSourceUrlEnv = '',
  effectiveSourceUrl = '',
  authSessionSourceCommand = '',
  authSessionSource = null,
  authSessionLifecycleSummary = null,
  packagedSourceFixture = false,
} = {}) {
  const issued = normalizeAuthSessionBoundaryObservation(authSessionLifecycleSummary?.issued);
  const read = normalizeAuthSessionBoundaryObservation(authSessionLifecycleSummary?.read);
  const liveSourceMatchesCommand = authSessionSourceMatchesLiveSource(
    authSessionSource?.sourceUrl,
    liveSourceUrlEnv || effectiveSourceUrl,
  );
  const sourceCommandPresent = Boolean(String(authSessionSourceCommand || '').trim());
  const userContinuity = issued.userLogin
    && read.userLogin
    && issued.userLogin === read.userLogin;
  const userIdContinuity = issued.userId === null
    ? read.userId === null
    : issued.userId === read.userId;
  const manageOptionsContinuity = issued.capabilities.manage_options === true
    && read.capabilities.manage_options === true;
  const sameSession = issued.sessionId
    && read.sessionId
    && issued.sessionId === read.sessionId;
  const sameSourceAtReadback = normalizeReleaseBoundarySourceUrl(effectiveSourceUrl)
    === normalizeReleaseBoundarySourceUrl(liveSourceUrlEnv || effectiveSourceUrl);
  const liveSuccessCandidate = !packagedSourceFixture && Boolean(liveSourceUrlEnv || effectiveSourceUrl);
  const acceptedForReleaseSuccess = liveSuccessCandidate
    && sourceCommandPresent
    && authSessionSource?.ok === true
    && liveSourceMatchesCommand
    && sameSourceAtReadback
    && sameSession
    && userContinuity
    && userIdContinuity
    && manageOptionsContinuity;
  const userIdentity = buildAuthSessionUserIdentityBinding({
    issued,
    read,
    sameSession,
    sameUserLogin: Boolean(userContinuity),
    sameUserId: userIdContinuity,
    manageOptions: manageOptionsContinuity,
  });

  return {
    required: 'same live auth/session source at issuance and readback',
    exactLiveSourceUrlEnv: liveSourceUrlEnv || '',
    effectiveSourceUrl,
    sourceCommand: {
      issuance: authSessionSourceCommand || '',
      readback: authSessionSourceCommand || '',
      sameCommand: sourceCommandPresent,
    },
    source: {
      commandOk: authSessionSource?.ok === true,
      commandSourceUrl: authSessionSource?.sourceUrl || '',
      matchesLiveSourceUrl: liveSourceMatchesCommand,
      sameSourceAtReadback,
    },
    issuance: {
      step: issued.step,
      sourceUrl: effectiveSourceUrl,
      sessionId: issued.sessionId,
      userLogin: issued.userLogin,
      userId: issued.userId,
      capabilities: issued.capabilities,
    },
    readback: {
      step: read.step,
      sourceUrl: effectiveSourceUrl,
      sessionId: read.sessionId,
      userLogin: read.userLogin,
      userId: read.userId,
      capabilities: read.capabilities,
    },
    identityContinuity: {
      sameSession,
      sameUserLogin: Boolean(userContinuity),
      sameUserId: userIdContinuity,
      manageOptions: manageOptionsContinuity,
    },
    userIdentity,
    forgedSessionSourceAccepted: false,
    packagedFixtureCredentialFallback: {
      observed: packagedSourceFixture ? 'packaged-production-plugin-fallback' : 'disabled',
      acceptedForReleaseSuccess: false,
    },
    verdict: acceptedForReleaseSuccess
      ? 'AUTH_SESSION_BOUNDARY_OK'
      : packagedSourceFixture
        ? 'PACKAGED_RELEASE_BOUNDARY_SUPPORT_ONLY'
        : 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED',
  };
}

const authSessionUserIdentityScope = 'reprint-push-lab:authenticated-http-push';

function buildAuthSessionUserIdentityBinding({
  issued,
  read,
  sameSession = false,
  sameUserLogin = false,
  sameUserId = false,
  manageOptions = false,
} = {}) {
  const issuedUserIdentityHash = hashAuthSessionUserIdentity(issued);
  const readbackUserIdentityHash = hashAuthSessionUserIdentity(read);
  const issuedSessionHash = hashAuthSessionSessionId(issued?.sessionId);
  const readbackSessionHash = hashAuthSessionSessionId(read?.sessionId);
  const sameUserIdentityHash = Boolean(
    issuedUserIdentityHash
    && readbackUserIdentityHash
    && issuedUserIdentityHash === readbackUserIdentityHash,
  );
  const ok = Boolean(sameSession && sameUserLogin && sameUserId && sameUserIdentityHash);

  return {
    required: 'same authenticated WordPress user identity bound to the short-lived push session',
    ok,
    observed: ok ? 'same-session-user-identity' : 'mismatched-session-user-identity',
    verdict: ok ? 'AUTH_SESSION_USER_IDENTITY_BOUND' : 'AUTH_SESSION_USER_IDENTITY_REQUIRED',
    scopeHash: createHash('sha256').update(authSessionUserIdentityScope, 'utf8').digest('hex'),
    sameSession: Boolean(sameSession),
    sameUserLogin: Boolean(sameUserLogin),
    sameUserId: sameUserId === true,
    sameUserIdentityHash,
    manageOptions: manageOptions === true,
    issued: {
      step: issued?.step || null,
      sessionHash: issuedSessionHash,
      userIdentityHash: issuedUserIdentityHash,
    },
    readback: {
      step: read?.step || null,
      sessionHash: readbackSessionHash,
      userIdentityHash: readbackUserIdentityHash,
    },
  };
}

function hashAuthSessionUserIdentity(observation) {
  if (
    !observation
    || typeof observation.userLogin !== 'string'
    || observation.userLogin === ''
    || !Number.isInteger(observation.userId)
    || observation.userId <= 0
  ) {
    return '';
  }

  return createHash('sha256')
    .update(`${observation.userId}\n${observation.userLogin}\n${authSessionUserIdentityScope}`, 'utf8')
    .digest('hex');
}

function hashAuthSessionSessionId(sessionId) {
  if (typeof sessionId !== 'string' || sessionId.trim() === '') {
    return '';
  }

  return createHash('sha256').update(sessionId, 'utf8').digest('hex');
}

function positiveIntegerEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeAuthSessionBoundaryObservation(observation) {
  if (!observation || typeof observation !== 'object') {
    return {
      step: null,
      sessionId: null,
      userLogin: '',
      userId: null,
      capabilities: {},
    };
  }

  return {
    step: observation.step || null,
    sessionId: typeof observation.id === 'string' && observation.id.trim()
      ? observation.id
      : null,
    userLogin: typeof observation.authUser === 'string' && observation.authUser.trim()
      ? observation.authUser.trim()
      : '',
    userId: Number.isInteger(observation.authUserId) && observation.authUserId > 0
      ? observation.authUserId
      : null,
    capabilities: normalizeAuthSessionBoundaryCapabilities(observation.authCapabilities),
  };
}

function normalizeAuthSessionBoundaryCapabilities(capabilities) {
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) {
    return {};
  }

  return {
    ...(Object.prototype.hasOwnProperty.call(capabilities, 'manage_options')
      ? { manage_options: capabilities.manage_options === true }
      : {}),
  };
}

function authSessionSourceMatchesLiveSource(sourceUrl, liveSourceUrl) {
  const normalizedSourceUrl = normalizeReleaseBoundarySourceUrl(sourceUrl);
  const normalizedLiveSourceUrl = normalizeReleaseBoundarySourceUrl(liveSourceUrl);
  return Boolean(normalizedSourceUrl && normalizedLiveSourceUrl && normalizedSourceUrl === normalizedLiveSourceUrl);
}

function normalizeReleaseBoundarySourceUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return '';
  }

  try {
    const parsed = new URL(value.trim());
    parsed.username = '';
    parsed.password = '';
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

export const productionPluginDriverBoundary = Object.freeze({
  driver: 'reprint-push-release-state',
  owner: 'reprint-push',
  table: 'wp_reprint_push_release_state',
  rowId: 'state_id:1',
  resourceKey: 'row:["wp_reprint_push_release_state","state_id:1"]',
  allowlist: Object.freeze({
    resourceKeys: Object.freeze(['row:["wp_reprint_push_release_state","state_id:1"]']),
    rowIds: Object.freeze(['state_id:1']),
    payloadModes: Object.freeze(['base', 'local-update', 'remote-changed']),
    supportsDelete: false,
  }),
});

export const wpOptionsDriverReleaseVerifierBoundary = Object.freeze({
  driver: 'wp-option',
  owner: 'forms',
  table: 'wp_options',
  rowId: 'option_name:forms_settings',
  resourceKey: 'row:["wp_options","option_name:forms_settings"]',
  allowlist: Object.freeze({
    resourceKeys: Object.freeze(['row:["wp_options","option_name:forms_settings"]']),
    supportsDelete: false,
  }),
});

export const driverApplyValidationHookReleaseVerifierBoundary = Object.freeze({
  driver: 'wp-option',
  owner: 'forms',
  table: 'wp_options',
  rowId: 'option_name:rpp_0498_forms_apply_validation',
  resourceKey: 'row:["wp_options","option_name:rpp_0498_forms_apply_validation"]',
  applyValidationHook: 'wp-option:validate-apply',
  allowlist: Object.freeze({
    resourceKeys: Object.freeze(['row:["wp_options","option_name:rpp_0498_forms_apply_validation"]']),
    supportsDelete: false,
  }),
});

const coreWordPressDriverBoundaryTables = new Set([
  'wp_options',
  'wp_postmeta',
  'wp_termmeta',
  'wp_usermeta',
]);

const wpPostmetaReleaseVerifierBoundary = Object.freeze({
  driver: 'wp-postmeta',
  driverAliases: Object.freeze(['wp-postmeta', 'wp-post-meta']),
  table: 'wp_postmeta',
  proofKind: 'wp-postmeta-driver-semantics',
});

const wpTermmetaReleaseVerifierBoundary = Object.freeze({
  driver: 'wp-termmeta',
  driverAliases: Object.freeze(['wp-termmeta', 'wp-term-meta']),
  table: 'wp_termmeta',
  proofKind: 'wp-termmeta-driver-semantics',
});

export function summarizeWpOptionsDriverReleaseVerifierProof({
  now = new Date('2026-05-30T10:48:40.000Z'),
} = {}) {
  try {
    return buildWpOptionsDriverReleaseVerifierProof(now);
  } catch (error) {
    return {
      rpp: 'RPP-0484',
      evidenceSource: 'release-verifier-wp-options-driver-semantics-v5',
      status: 'blocked',
      verdict: 'WP_OPTIONS_DRIVER_REMOTE_DRIFT_REQUIRED',
      productionBacked: false,
      releaseEligible: false,
      releaseGate: 'NO-GO',
      driver: wpOptionsDriverReleaseVerifierBoundary.driver,
      owner: wpOptionsDriverReleaseVerifierBoundary.owner,
      resource: wpOptionsDriverReleaseVerifierResourceEvidence(),
      rawValuesIncluded: false,
      error: {
        name: error instanceof Error ? error.name : 'Error',
        code: error?.code || null,
      },
    };
  }
}

export function summarizeDriverAuditEvidenceRedactionReleaseVerifierProof({
  now = new Date('2026-05-30T10:49:00.000Z'),
} = {}) {
  try {
    return buildDriverAuditEvidenceRedactionReleaseVerifierProof(now);
  } catch (error) {
    return {
      rpp: 'RPP-0499',
      evidenceSource: 'release-verifier-driver-audit-evidence-redaction-v5',
      status: 'blocked',
      verdict: 'DRIVER_AUDIT_EVIDENCE_REDACTION_REQUIRED',
      productionBacked: false,
      releaseEligible: false,
      releaseGate: 'NO-GO',
      driver: wpOptionsDriverReleaseVerifierBoundary.driver,
      owner: wpOptionsDriverReleaseVerifierBoundary.owner,
      resource: wpOptionsDriverReleaseVerifierResourceEvidence(),
      rawValuesIncluded: false,
      error: {
        name: error instanceof Error ? error.name : 'Error',
        code: error?.code || null,
      },
    };
  }
}

function buildDriverAuditEvidenceRedactionReleaseVerifierProof(now) {
  const boundary = wpOptionsDriverReleaseVerifierBoundary;
  const resource = wpOptionsDriverReleaseVerifierResourceEvidence();
  const rawFixtures = {
    base: 'rpp-0499-release-verifier-audit-base-option',
    local: 'rpp-0499-release-verifier-audit-local-option',
    ownerContextDrift: '<?php /* rpp-0499 release verifier audit owner-context drift */',
    staleRemoteDrift: 'rpp-0499-release-verifier-audit-stale-remote-drift-option',
    staleRemoteOnly: 'rpp-0499-release-verifier-audit-remote-only-field',
  };
  const ownerContextBase = wpOptionsDriverReleaseVerifierSnapshot(rawFixtures.base);
  const ownerContextLocal = wpOptionsDriverReleaseVerifierSnapshot(rawFixtures.base);
  ownerContextLocal.db[boundary.table][boundary.rowId].option_value.mode = rawFixtures.local;
  ownerContextLocal.meta = wpOptionsDriverReleaseVerifierPolicy();
  const ownerContextRemote = wpOptionsDriverReleaseVerifierSnapshot(rawFixtures.base);
  ownerContextRemote.files['wp-content/plugins/forms/forms.php'] = rawFixtures.ownerContextDrift;
  const ownerContextRowResource = {
    type: 'row',
    table: boundary.table,
    id: boundary.rowId,
    key: boundary.resourceKey,
  };
  const ownerContextPlan = createPushPlan({
    base: ownerContextBase,
    local: ownerContextLocal,
    remote: ownerContextRemote,
    now,
  });
  const ownerContextBlocker =
    ownerContextPlan.blockers.find((entry) => entry.resourceKey === boundary.resourceKey) || null;
  const ownerContextRemoteBeforeJson = JSON.stringify(ownerContextRemote);
  const ownerContextRowHashBefore = resourceHash(ownerContextRemote, ownerContextRowResource);
  const ownerContextRemoteHashBefore = sha256Evidence(ownerContextRemote);
  let ownerContextApplyError = null;
  try {
    applyPlan(ownerContextRemote, ownerContextPlan, { mutateRemote: true });
  } catch (error) {
    ownerContextApplyError = error;
  }
  const ownerContextRowHashAfter = resourceHash(ownerContextRemote, ownerContextRowResource);
  const ownerContextRemoteHashAfter = sha256Evidence(ownerContextRemote);
  const ownerContextRemoteDataPreserved =
    ownerContextRowHashAfter === ownerContextRowHashBefore
    && ownerContextRemoteHashAfter === ownerContextRemoteHashBefore
    && JSON.stringify(ownerContextRemote) === ownerContextRemoteBeforeJson;
  const ownerContextDecisionEvidence = ownerContextBlocker?.driverAuditEvidence || null;
  const ownerContextEvidenceRedacted =
    ownerContextDecisionEvidence?.redaction === 'hash-only'
    && ownerContextDecisionEvidence?.rawValuesIncluded === false;
  const ownerContextOk =
    ownerContextPlan.status === 'blocked'
    && ownerContextPlan.summary.mutations === 0
    && ownerContextBlocker?.class === 'stale-plugin-owner-context'
    && ownerContextBlocker?.resourceKey === boundary.resourceKey
    && ownerContextBlocker?.pluginOwner === boundary.owner
    && ownerContextBlocker?.driver === boundary.driver
    && ownerContextDecisionEvidence?.reasonCode === 'PLUGIN_DRIVER_REMOTE_DRIFT_PRESERVED'
    && ownerContextDecisionEvidence?.decision === 'blocked'
    && ownerContextEvidenceRedacted
    && ownerContextApplyError instanceof PushPlanError
    && ownerContextApplyError.code === 'PLAN_NOT_READY'
    && ownerContextRemoteDataPreserved;

  const base = wpOptionsDriverReleaseVerifierSnapshot(rawFixtures.base);
  const local = wpOptionsDriverReleaseVerifierSnapshot(rawFixtures.base);
  local.db[boundary.table][boundary.rowId].option_value.mode = rawFixtures.local;
  local.meta = wpOptionsDriverReleaseVerifierPolicy();
  const remote = wpOptionsDriverReleaseVerifierSnapshot(rawFixtures.base);
  const plan = createPushPlan({ base, local, remote, now });
  const mutation = plan.mutations.find((entry) => entry.resourceKey === boundary.resourceKey) || null;
  const precondition = plan.preconditions.find((entry) => entry.resourceKey === boundary.resourceKey) || null;
  const plannerAuditEvidence = mutation?.pluginOwnedResource?.auditEvidence || null;
  const driverDecisionEvidence = mutation?.pluginOwnedResource?.driverAuditEvidence || null;
  const driftedRemote = cloneReleaseVerifierJson(remote);
  driftedRemote.db[boundary.table][boundary.rowId].option_value.mode = rawFixtures.staleRemoteDrift;
  driftedRemote.db[boundary.table][boundary.rowId].option_value.remoteOnly = rawFixtures.staleRemoteOnly;
  const rowHashBefore = mutation ? resourceHash(driftedRemote, mutation.resource) : null;
  const remoteHashBefore = sha256Evidence(driftedRemote);
  let beforeMutationCalls = 0;
  let staleError = null;
  try {
    applyPlan(driftedRemote, plan, {
      mutateRemote: true,
      beforeMutation() {
        beforeMutationCalls += 1;
      },
    });
  } catch (error) {
    staleError = error;
  }
  const rowHashAfter = mutation ? resourceHash(driftedRemote, mutation.resource) : null;
  const remoteHashAfter = sha256Evidence(driftedRemote);
  const stalePreconditionFailed = staleError instanceof PushPlanError
    && staleError.code === 'PRECONDITION_FAILED';
  const staleRemoteDataPreserved = rowHashBefore !== null
    && rowHashAfter === rowHashBefore
    && remoteHashAfter === remoteHashBefore;
  const exactMutation = mutation?.resource?.type === 'row'
    && mutation.resource.table === boundary.table
    && mutation.resource.id === boundary.rowId
    && mutation.pluginOwnedResource?.pluginOwner === boundary.owner
    && mutation.pluginOwnedResource?.driver === boundary.driver
    && mutation.pluginOwnedResource?.supportsDelete === false;
  const exactPrecondition = precondition?.resourceKey === boundary.resourceKey
    && precondition?.expectedHash === mutation?.remoteBeforeHash
    && precondition?.checkedAgainst === 'live-remote';
  const plannerAuditEvidenceRedacted =
    plannerAuditEvidence?.evidenceSource === 'planner-plugin-driver-audit'
    && plannerAuditEvidence?.format === 'hash-only'
    && plannerAuditEvidence?.rawValuesIncluded === false;
  const driverDecisionEvidenceRedacted =
    driverDecisionEvidence?.operation === 'plugin-driver-audit'
    && driverDecisionEvidence?.redaction === 'hash-only'
    && driverDecisionEvidence?.rawValuesIncluded === false;
  const acceptedAuditOk =
    plan.status === 'ready'
    && plan.summary.mutations === 1
    && plan.summary.blockers === 0
    && exactMutation
    && exactPrecondition
    && plannerAuditEvidenceRedacted
    && driverDecisionEvidenceRedacted
    && driverDecisionEvidence?.reasonCode === 'PLUGIN_DRIVER_DECISION_SUPPORTED'
    && driverDecisionEvidence?.decision === 'supported';
  const staleRemoteOk =
    stalePreconditionFailed
    && beforeMutationCalls === 0
    && staleError.details?.expectedHash === mutation?.remoteBeforeHash
    && staleError.details?.actualHash === rowHashBefore
    && staleRemoteDataPreserved;
  const evidenceSurfaceJson = JSON.stringify([
    ownerContextBlocker,
    ownerContextApplyError?.details || null,
    plannerAuditEvidence,
    driverDecisionEvidence,
    staleError?.details || null,
  ]);
  const rawEvidenceValuesIncluded = Object.values(rawFixtures).some((raw) =>
    evidenceSurfaceJson.includes(raw));
  const rawEvidenceFieldNamesIncluded =
    evidenceSurfaceJson.includes('option_value') || evidenceSurfaceJson.includes('__pluginOwner');
  const evidenceSurfacesRedacted = !rawEvidenceValuesIncluded && !rawEvidenceFieldNamesIncluded;
  const ok = ownerContextOk && acceptedAuditOk && staleRemoteOk && evidenceSurfacesRedacted;

  const proof = {
    rpp: 'RPP-0499',
    evidenceSource: 'release-verifier-driver-audit-evidence-redaction-v5',
    status: ok ? 'support_only' : 'blocked',
    verdict: ok
      ? 'DRIVER_AUDIT_EVIDENCE_REDACTED_REMOTE_DRIFT_PRESERVED'
      : 'DRIVER_AUDIT_EVIDENCE_REDACTION_REQUIRED',
    productionBacked: false,
    releaseEligible: false,
    releaseGate: 'NO-GO',
    driver: boundary.driver,
    owner: boundary.owner,
    resource,
    rawValuesIncluded: rawEvidenceValuesIncluded,
    releaseVerifier: {
      checkedBy: 'scripts/playground/production-shaped-release-verify.mjs',
      check: 'plugin-driver-audit-evidence-redaction',
      variant: 'v5',
      remoteDriftPreservesPluginOwnedData: ownerContextRemoteDataPreserved && staleRemoteDataPreserved,
    },
    blockedOwnerContextDrift: {
      status: ownerContextPlan.status,
      mutationCount: ownerContextPlan.mutations.length,
      blockerCount: ownerContextPlan.blockers.length,
      blockerClass: ownerContextBlocker?.class || null,
      resourceKey: ownerContextBlocker?.resourceKey || null,
      pluginOwner: ownerContextBlocker?.pluginOwner || null,
      driver: ownerContextBlocker?.driver || null,
      reasonCode: ownerContextDecisionEvidence?.reasonCode || null,
      decision: ownerContextDecisionEvidence?.decision || null,
      driverDecisionEvidenceHash: ownerContextDecisionEvidence
        ? sha256Evidence(ownerContextDecisionEvidence)
        : null,
      blockerHash: ownerContextBlocker ? sha256Evidence({
        class: ownerContextBlocker.class,
        resourceKey: ownerContextBlocker.resourceKey,
        pluginOwner: ownerContextBlocker.pluginOwner,
        driver: ownerContextBlocker.driver,
        policySource: ownerContextBlocker.policySource,
        baseHash: ownerContextBlocker.baseHash,
        localHash: ownerContextBlocker.localHash,
        remoteHash: ownerContextBlocker.remoteHash,
        driverAuditEvidence: ownerContextBlocker.driverAuditEvidence,
        ownerContextRefusalEvidence: ownerContextBlocker.ownerContextRefusalEvidence,
      }) : null,
      applyRefusalCode: ownerContextApplyError?.code || null,
      applyRefusalDetailsHash: ownerContextApplyError
        ? sha256Evidence(ownerContextApplyError.details || null)
        : null,
      rowHashBefore: `sha256:${ownerContextRowHashBefore}`,
      rowHashAfter: `sha256:${ownerContextRowHashAfter}`,
      remoteHashBefore: ownerContextRemoteHashBefore,
      remoteHashAfter: ownerContextRemoteHashAfter,
      remoteDataPreserved: ownerContextRemoteDataPreserved,
      evidenceRedacted: ownerContextEvidenceRedacted,
    },
    acceptedAuditEvidence: mutation ? {
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      changeKind: mutation.changeKind,
      pluginOwner: mutation.pluginOwnedResource?.pluginOwner || null,
      driver: mutation.pluginOwnedResource?.driver || null,
      policySource: mutation.pluginOwnedResource?.policySource || null,
      supportsDelete: mutation.pluginOwnedResource?.supportsDelete === true,
      ownerContextRequired: mutation.pluginOwnedResource?.ownerContextRequired === true,
      exactMutation,
      plannerAudit: plannerAuditEvidence ? {
        evidenceSource: plannerAuditEvidence.evidenceSource,
        format: plannerAuditEvidence.format,
        rawValuesIncluded: plannerAuditEvidence.rawValuesIncluded === true,
        plannerAuditEvidenceHash: sha256Evidence(plannerAuditEvidence),
        ownerContextHash: plannerAuditEvidence.ownerContextHash
          ? `sha256:${plannerAuditEvidence.ownerContextHash}`
          : null,
      } : null,
      driverDecision: driverDecisionEvidence ? {
        operation: driverDecisionEvidence.operation,
        reasonCode: driverDecisionEvidence.reasonCode,
        decision: driverDecisionEvidence.decision,
        redaction: driverDecisionEvidence.redaction,
        rawValuesIncluded: driverDecisionEvidence.rawValuesIncluded === true,
        driverDecisionEvidenceHash: sha256Evidence(driverDecisionEvidence),
      } : null,
      baseHash: mutation.baseHash,
      localHash: mutation.localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      mutationHash: sha256Evidence({
        resourceKey: mutation.resourceKey,
        action: mutation.action,
        baseHash: mutation.baseHash,
        localHash: mutation.localHash,
        remoteBeforeHash: mutation.remoteBeforeHash,
      }),
    } : null,
    precondition: precondition ? {
      resourceKey: precondition.resourceKey,
      expectedHash: precondition.expectedHash,
      checkedAgainst: precondition.checkedAgainst,
      exactPrecondition,
      preconditionHash: sha256Evidence(precondition),
    } : null,
    staleRemotePreservation: {
      preMutation: stalePreconditionFailed,
      code: staleError?.code || null,
      beforeMutationCalls,
      detailsHash: staleError ? sha256Evidence(staleError.details || null) : null,
      expectedHashMatchesMutation: staleError?.details?.expectedHash === mutation?.remoteBeforeHash,
      actualHashMatchesRowBefore: staleError?.details?.actualHash === rowHashBefore,
      rowHashBefore: rowHashBefore ? `sha256:${rowHashBefore}` : null,
      rowHashAfter: rowHashAfter ? `sha256:${rowHashAfter}` : null,
      remoteHashBefore,
      remoteHashAfter,
      remoteDataPreserved: staleRemoteDataPreserved,
    },
    redaction: {
      format: 'hash-only',
      surfaces: [
        'blocked-driver-decision-evidence',
        'planner-audit-evidence',
        'supported-driver-decision-evidence',
        'apply-refusal-details',
        'stale-precondition-details',
        'release-verifier-proof',
      ],
      evidenceSurfacesRedacted,
      rawValuesIncluded: rawEvidenceValuesIncluded,
      rawFieldNamesIncluded: rawEvidenceFieldNamesIncluded,
      checkedFixtureCount: Object.keys(rawFixtures).length,
    },
  };
  proof.proofHash = sha256Evidence({
    releaseVerifier: proof.releaseVerifier,
    blockedOwnerContextDrift: proof.blockedOwnerContextDrift,
    acceptedAuditEvidence: proof.acceptedAuditEvidence,
    precondition: proof.precondition,
    staleRemotePreservation: proof.staleRemotePreservation,
    redaction: proof.redaction,
  });

  const serialized = JSON.stringify(proof);
  const leakedRawFixture = Object.values(rawFixtures).some((raw) => serialized.includes(raw));
  const leakedRawFieldName = serialized.includes('option_value') || serialized.includes('__pluginOwner');
  if (leakedRawFixture || leakedRawFieldName || rawEvidenceValuesIncluded || rawEvidenceFieldNamesIncluded) {
    return {
      rpp: proof.rpp,
      evidenceSource: proof.evidenceSource,
      status: 'blocked',
      verdict: 'DRIVER_AUDIT_EVIDENCE_REDACTION_REQUIRED',
      productionBacked: false,
      releaseEligible: false,
      releaseGate: 'NO-GO',
      driver: boundary.driver,
      owner: boundary.owner,
      resource,
      rawValuesIncluded: leakedRawFixture || rawEvidenceValuesIncluded,
      redaction: {
        format: 'hash-only',
        rawValuesIncluded: leakedRawFixture || rawEvidenceValuesIncluded,
        rawFieldNamesIncluded: leakedRawFieldName || rawEvidenceFieldNamesIncluded,
        checkedFixtureCount: Object.keys(rawFixtures).length,
      },
      proofHash: sha256Evidence({
        verdict: 'DRIVER_AUDIT_EVIDENCE_REDACTION_REQUIRED',
        resource,
      }),
    };
  }
  return proof;
}

function buildWpOptionsDriverReleaseVerifierProof(now) {
  const boundary = wpOptionsDriverReleaseVerifierBoundary;
  const rawFixtures = {
    base: 'rpp-0484-release-verifier-base-option',
    local: 'rpp-0484-release-verifier-local-option',
    drift: 'rpp-0484-release-verifier-remote-drift-option',
  };
  const base = wpOptionsDriverReleaseVerifierSnapshot(rawFixtures.base);
  const local = wpOptionsDriverReleaseVerifierSnapshot(rawFixtures.base);
  local.db[boundary.table][boundary.rowId].option_value.mode = rawFixtures.local;
  local.meta = {
    pushPolicy: {
      pluginOwnedResources: {
        allowedResources: [
          {
            resourceKey: boundary.resourceKey,
            pluginOwner: boundary.owner,
            driver: boundary.driver,
            supportsDelete: false,
          },
        ],
      },
    },
  };
  const remote = wpOptionsDriverReleaseVerifierSnapshot(rawFixtures.base);
  const plan = createPushPlan({ base, local, remote, now });
  const mutation = plan.mutations.find((entry) => entry.resourceKey === boundary.resourceKey) || null;
  const precondition = plan.preconditions.find((entry) => entry.resourceKey === boundary.resourceKey) || null;
  const driftedRemote = cloneReleaseVerifierJson(remote);
  driftedRemote.db[boundary.table][boundary.rowId].option_value.mode = rawFixtures.drift;
  driftedRemote.db[boundary.table][boundary.rowId].option_value.remoteOnly = true;

  const rowHashBefore = mutation ? resourceHash(driftedRemote, mutation.resource) : null;
  const remoteHashBefore = sha256Evidence(driftedRemote);
  let staleError = null;
  let unexpectedApplyResult = null;
  try {
    unexpectedApplyResult = applyPlan(driftedRemote, plan);
  } catch (error) {
    staleError = error;
  }
  const rowHashAfter = mutation ? resourceHash(driftedRemote, mutation.resource) : null;
  const remoteHashAfter = sha256Evidence(driftedRemote);

  const stalePreconditionFailed = staleError instanceof PushPlanError
    && staleError.code === 'PRECONDITION_FAILED';
  const remoteDataPreserved = rowHashBefore !== null
    && rowHashAfter === rowHashBefore
    && remoteHashAfter === remoteHashBefore;
  const exactMutation = mutation?.resource?.type === 'row'
    && mutation.resource.table === boundary.table
    && mutation.resource.id === boundary.rowId
    && mutation.pluginOwnedResource?.pluginOwner === boundary.owner
    && mutation.pluginOwnedResource?.driver === boundary.driver
    && mutation.pluginOwnedResource?.supportsDelete === false;
  const exactPrecondition = precondition?.resourceKey === boundary.resourceKey
    && precondition?.expectedHash === mutation?.remoteBeforeHash
    && precondition?.checkedAgainst === 'live-remote';
  const ok = plan.status === 'ready'
    && plan.summary.mutations === 1
    && plan.summary.conflicts === 0
    && plan.summary.blockers === 0
    && exactMutation
    && exactPrecondition
    && stalePreconditionFailed
    && staleError.details?.expectedHash === mutation.remoteBeforeHash
    && staleError.details?.actualHash === rowHashBefore
    && remoteDataPreserved;

  const proof = {
    rpp: 'RPP-0484',
    evidenceSource: 'release-verifier-wp-options-driver-semantics-v5',
    status: ok ? 'support_only' : 'blocked',
    verdict: ok
      ? 'WP_OPTIONS_DRIVER_REMOTE_DRIFT_PRESERVED'
      : 'WP_OPTIONS_DRIVER_REMOTE_DRIFT_REQUIRED',
    productionBacked: false,
    releaseEligible: false,
    releaseGate: 'NO-GO',
    driver: boundary.driver,
    owner: boundary.owner,
    resource: wpOptionsDriverReleaseVerifierResourceEvidence(),
    rawValuesIncluded: false,
    allowlist: {
      resourceKey: boundary.resourceKey,
      pluginOwner: boundary.owner,
      driver: boundary.driver,
      supportsDelete: false,
      policySource: 'local-snapshot',
    },
    plan: {
      status: plan.status,
      summary: {
        mutations: plan.summary.mutations,
        conflicts: plan.summary.conflicts,
        blockers: plan.summary.blockers,
      },
      mutationCount: plan.mutations.length,
      preconditionCount: plan.preconditions.length,
      hash: sha256Evidence(plan),
    },
    mutationBoundary: mutation ? {
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      changeKind: mutation.changeKind,
      pluginOwner: mutation.pluginOwnedResource?.pluginOwner || null,
      driver: mutation.pluginOwnedResource?.driver || null,
      policySource: mutation.pluginOwnedResource?.policySource || null,
      supportsDelete: mutation.pluginOwnedResource?.supportsDelete === true,
      ownerContextRequired: mutation.pluginOwnedResource?.ownerContextRequired === true,
      exactMutation,
      baseHash: mutation.baseHash,
      localHash: mutation.localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      auditEvidenceHash: sha256Evidence(mutation.pluginOwnedResource?.auditEvidence || null),
      driverDecisionEvidenceHash: sha256Evidence(mutation.pluginOwnedResource?.driverAuditEvidence || null),
      mutationHash: sha256Evidence({
        resourceKey: mutation.resourceKey,
        action: mutation.action,
        baseHash: mutation.baseHash,
        localHash: mutation.localHash,
        remoteBeforeHash: mutation.remoteBeforeHash,
      }),
    } : null,
    precondition: precondition ? {
      resourceKey: precondition.resourceKey,
      expectedHash: precondition.expectedHash,
      checkedAgainst: precondition.checkedAgainst,
      exactPrecondition,
      preconditionHash: sha256Evidence(precondition),
    } : null,
    staleRemotePreservation: {
      preMutation: stalePreconditionFailed,
      code: staleError?.code || null,
      detailsHash: staleError ? sha256Evidence(staleError.details || null) : null,
      expectedHashMatchesMutation: staleError?.details?.expectedHash === mutation?.remoteBeforeHash,
      actualHashMatchesRowBefore: staleError?.details?.actualHash === rowHashBefore,
      rowHashBefore: rowHashBefore ? `sha256:${rowHashBefore}` : null,
      rowHashAfter: rowHashAfter ? `sha256:${rowHashAfter}` : null,
      remoteHashBefore,
      remoteHashAfter,
      remoteDataPreserved,
      unexpectedApplyMutationCount: unexpectedApplyResult?.appliedMutations ?? 0,
    },
    redaction: {
      format: 'hash-only',
      rawValuesIncluded: false,
      checkedFixtureCount: Object.keys(rawFixtures).length,
    },
  };
  proof.proofHash = sha256Evidence({
    plan: proof.plan,
    mutationBoundary: proof.mutationBoundary,
    precondition: proof.precondition,
    staleRemotePreservation: proof.staleRemotePreservation,
  });
  if (Object.values(rawFixtures).some((raw) => JSON.stringify(proof).includes(raw))) {
    return {
      rpp: proof.rpp,
      evidenceSource: proof.evidenceSource,
      status: 'blocked',
      verdict: 'WP_OPTIONS_DRIVER_EVIDENCE_REDACTION_REQUIRED',
      productionBacked: false,
      releaseEligible: false,
      releaseGate: 'NO-GO',
      driver: boundary.driver,
      owner: boundary.owner,
      resource: proof.resource,
      rawValuesIncluded: true,
      redaction: {
        format: 'hash-only',
        rawValuesIncluded: true,
        checkedFixtureCount: Object.keys(rawFixtures).length,
      },
      proofHash: sha256Evidence({
        verdict: 'WP_OPTIONS_DRIVER_EVIDENCE_REDACTION_REQUIRED',
        resource: proof.resource,
      }),
    };
  }
  return proof;
}

function wpOptionsDriverReleaseVerifierResourceEvidence() {
  const boundary = wpOptionsDriverReleaseVerifierBoundary;
  return {
    resourceKey: boundary.resourceKey,
    table: boundary.table,
    rowId: boundary.rowId,
  };
}

function wpOptionsDriverReleaseVerifierPolicy() {
  const boundary = wpOptionsDriverReleaseVerifierBoundary;
  return {
    pushPolicy: {
      pluginOwnedResources: {
        allowedResources: [
          {
            resourceKey: boundary.resourceKey,
            pluginOwner: boundary.owner,
            driver: boundary.driver,
            supportsDelete: false,
          },
        ],
      },
    },
  };
}

function wpOptionsDriverReleaseVerifierSnapshot(mode) {
  const boundary = wpOptionsDriverReleaseVerifierBoundary;
  return {
    files: {
      'wp-content/plugins/forms/forms.php': '<?php /* forms plugin release verifier fixture */',
    },
    plugins: {
      [boundary.owner]: {
        version: '1.0.0',
        active: true,
      },
    },
    db: {
      [boundary.table]: {
        [boundary.rowId]: {
          option_name: 'forms_settings',
          option_value: {
            mode,
            nested: { enabled: true },
          },
          autoload: 'no',
          __pluginOwner: boundary.owner,
        },
      },
    },
  };
}

export function summarizeDriverApplyValidationHookReleaseVerifierProof({
  now = new Date('2026-05-30T13:49:08.000Z'),
} = {}) {
  try {
    return buildDriverApplyValidationHookReleaseVerifierProof(now);
  } catch (error) {
    return {
      rpp: 'RPP-0498',
      evidenceSource: 'release-verifier-driver-apply-validation-hook-v5',
      status: 'blocked',
      verdict: 'DRIVER_APPLY_VALIDATION_HOOK_REQUIRED',
      productionBacked: false,
      releaseEligible: false,
      releaseGate: 'NO-GO',
      evidenceScope: 'local-production-shaped',
      driver: driverApplyValidationHookReleaseVerifierBoundary.driver,
      owner: driverApplyValidationHookReleaseVerifierBoundary.owner,
      resource: driverApplyValidationHookReleaseVerifierResourceEvidence(),
      rawValuesIncluded: false,
      error: {
        name: error instanceof Error ? error.name : 'Error',
        code: error?.code || null,
      },
    };
  }
}

function buildDriverApplyValidationHookReleaseVerifierProof(now) {
  const boundary = driverApplyValidationHookReleaseVerifierBoundary;
  const rawFixtures = {
    baseMode: 'rpp-0498-base-private-apply-validation-mode',
    baseToken: 'rpp-0498-base-private-apply-validation-token',
    localMode: 'rpp-0498-local-private-apply-validation-mode',
    localToken: 'rpp-0498-local-private-apply-validation-token',
  };
  const base = driverApplyValidationHookReleaseVerifierSnapshot(rawFixtures.baseMode, rawFixtures.baseToken);
  const local = cloneReleaseVerifierJson(base);
  local.db[boundary.table][boundary.rowId].option_value = {
    mode: rawFixtures.localMode,
    token: rawFixtures.localToken,
  };
  local.meta = {
    pushPolicy: {
      pluginOwnedResources: {
        allowedResources: [
          {
            resourceKey: boundary.resourceKey,
            pluginOwner: boundary.owner,
            driver: boundary.driver,
            supportsDelete: false,
            applyValidation: {
              hook: boundary.applyValidationHook,
              status: 'passed',
            },
          },
        ],
      },
    },
  };
  const remote = driverApplyValidationHookReleaseVerifierSnapshot(rawFixtures.baseMode, rawFixtures.baseToken);
  const remoteBeforeHash = digest(remote);
  const plan = createPushPlan({ base, local, remote, now });
  const mutation = plan.mutations.find((entry) => entry.resourceKey === boundary.resourceKey) || null;
  const precondition = plan.preconditions.find((entry) => entry.resourceKey === boundary.resourceKey) || null;
  const rowBeforeHash = mutation ? resourceHash(remote, mutation.resource) : null;
  const hookEvents = [];
  let applyResult = null;
  let applyError = null;
  try {
    applyResult = applyPlan(remote, plan, {
      mutateRemote: true,
      beforeMutation({ mutation: appliedMutation, mutationIndex, remote: liveRemote, driverApplyValidation }) {
        hookEvents.push({
          mutationIndex,
          resourceKey: appliedMutation.resourceKey,
          liveRemoteHash: digest(liveRemote),
          driverApplyValidation,
        });
      },
    });
  } catch (error) {
    applyError = error;
  }

  const remoteAfterHash = digest(remote);
  const rowAfterHash = mutation ? resourceHash(remote, mutation.resource) : null;
  const driverApplyValidation = hookEvents[0]?.driverApplyValidation || null;
  const plannerApplyValidation = mutation?.pluginOwnedResource?.applyValidationEvidence || null;
  const exactMutation = mutation?.resource?.type === 'row'
    && mutation.resource.table === boundary.table
    && mutation.resource.id === boundary.rowId
    && mutation.action === 'put'
    && mutation.pluginOwnedResource?.pluginOwner === boundary.owner
    && mutation.pluginOwnedResource?.driver === boundary.driver
    && mutation.pluginOwnedResource?.supportsDelete === false;
  const exactPrecondition = precondition?.resourceKey === boundary.resourceKey
    && precondition?.expectedHash === mutation?.remoteBeforeHash
    && precondition?.checkedAgainst === 'live-remote';
  const plannerApplyValidationPassed = plannerApplyValidation?.reasonCode === 'PLUGIN_DRIVER_APPLY_VALIDATION_PASSED'
    && plannerApplyValidation?.operation === 'apply-validation'
    && plannerApplyValidation?.resourceKey === boundary.resourceKey
    && plannerApplyValidation?.pluginOwner === boundary.owner
    && plannerApplyValidation?.driver === boundary.driver
    && plannerApplyValidation?.hook === boundary.applyValidationHook
    && plannerApplyValidation?.supportedHook === true
    && plannerApplyValidation?.status === 'passed';
  const acceptedHook = driverApplyValidation?.reasonCode === 'PLUGIN_DRIVER_APPLY_VALIDATION_ACCEPTED'
    && driverApplyValidation?.operation === 'driver-apply-validation'
    && driverApplyValidation?.outcome === 'accepted'
    && driverApplyValidation?.resourceKey === boundary.resourceKey
    && driverApplyValidation?.pluginOwner === boundary.owner
    && driverApplyValidation?.driver === boundary.driver
    && driverApplyValidation?.supportsDelete === false
    && driverApplyValidation?.action === 'put'
    && driverApplyValidation?.resource?.table === boundary.table
    && driverApplyValidation?.resource?.id === boundary.rowId
    && driverApplyValidation?.planned?.state === 'present'
    && driverApplyValidation?.planned?.hash === mutation?.localHash
    && driverApplyValidation?.remote?.state === 'present'
    && driverApplyValidation?.remote?.hash === mutation?.remoteBeforeHash;
  const journalApplied = applyResult?.journal?.entries?.length === 1
    && applyResult.journal.entries[0]?.status === 'applied'
    && applyResult.journal.entries[0]?.resourceKey === boundary.resourceKey;
  const carriedThroughApply = applyError === null
    && applyResult?.site === remote
    && applyResult?.appliedMutations === 1
    && journalApplied
    && hookEvents.length === 1
    && hookEvents[0]?.resourceKey === boundary.resourceKey
    && hookEvents[0]?.liveRemoteHash === remoteBeforeHash
    && rowBeforeHash !== null
    && rowAfterHash !== null
    && rowAfterHash !== rowBeforeHash
    && remoteAfterHash !== remoteBeforeHash;
  const ok = plan.status === 'ready'
    && plan.summary.mutations === 1
    && plan.summary.conflicts === 0
    && plan.summary.blockers === 0
    && plan.preconditions.length === 1
    && exactMutation
    && exactPrecondition
    && plannerApplyValidationPassed
    && acceptedHook
    && carriedThroughApply;

  const proof = {
    rpp: 'RPP-0498',
    evidenceSource: 'release-verifier-driver-apply-validation-hook-v5',
    status: ok ? 'support_only' : 'blocked',
    verdict: ok
      ? 'DRIVER_APPLY_VALIDATION_HOOK_MUTATION_APPLIED'
      : 'DRIVER_APPLY_VALIDATION_HOOK_REQUIRED',
    productionBacked: false,
    releaseEligible: false,
    releaseGate: 'NO-GO',
    evidenceScope: 'local-production-shaped',
    driver: boundary.driver,
    owner: boundary.owner,
    resource: driverApplyValidationHookReleaseVerifierResourceEvidence(),
    rawValuesIncluded: false,
    allowlist: {
      resourceKey: boundary.resourceKey,
      pluginOwner: boundary.owner,
      driver: boundary.driver,
      supportsDelete: false,
      policySource: 'local-snapshot',
      applyValidation: {
        hook: boundary.applyValidationHook,
        status: 'passed',
      },
    },
    plan: {
      status: plan.status,
      summary: {
        mutations: plan.summary.mutations,
        conflicts: plan.summary.conflicts,
        blockers: plan.summary.blockers,
      },
      mutationCount: plan.mutations.length,
      preconditionCount: plan.preconditions.length,
      hash: sha256Evidence(plan),
    },
    mutationBoundary: mutation ? {
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      changeKind: mutation.changeKind,
      pluginOwner: mutation.pluginOwnedResource?.pluginOwner || null,
      driver: mutation.pluginOwnedResource?.driver || null,
      policySource: mutation.pluginOwnedResource?.policySource || null,
      supportsDelete: mutation.pluginOwnedResource?.supportsDelete === true,
      exactMutation,
      baseHash: mutation.baseHash,
      localHash: mutation.localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      auditEvidenceHash: sha256Evidence(mutation.pluginOwnedResource?.auditEvidence || null),
      driverDecisionEvidenceHash: sha256Evidence(mutation.pluginOwnedResource?.driverAuditEvidence || null),
      applyValidationEvidenceHash: sha256Evidence(plannerApplyValidation || null),
      applyValidationEvidence: plannerApplyValidation ? {
        reasonCode: plannerApplyValidation.reasonCode,
        operation: plannerApplyValidation.operation,
        hook: plannerApplyValidation.hook,
        supportedHook: plannerApplyValidation.supportedHook === true,
        status: plannerApplyValidation.status,
        policySource: plannerApplyValidation.policySource || null,
      } : null,
      mutationHash: sha256Evidence({
        resourceKey: mutation.resourceKey,
        action: mutation.action,
        baseHash: mutation.baseHash,
        localHash: mutation.localHash,
        remoteBeforeHash: mutation.remoteBeforeHash,
      }),
    } : null,
    precondition: precondition ? {
      resourceKey: precondition.resourceKey,
      expectedHash: precondition.expectedHash,
      checkedAgainst: precondition.checkedAgainst,
      exactPrecondition,
      preconditionHash: sha256Evidence(precondition),
    } : null,
    driverApplyValidation: driverApplyValidation ? {
      reasonCode: driverApplyValidation.reasonCode,
      operation: driverApplyValidation.operation,
      outcome: driverApplyValidation.outcome,
      resourceKey: driverApplyValidation.resourceKey,
      pluginOwner: driverApplyValidation.pluginOwner,
      driver: driverApplyValidation.driver,
      supportsDelete: driverApplyValidation.supportsDelete === true,
      action: driverApplyValidation.action,
      resource: {
        type: driverApplyValidation.resource?.type || null,
        table: driverApplyValidation.resource?.table || null,
        id: driverApplyValidation.resource?.id || null,
      },
      planned: {
        state: driverApplyValidation.planned?.state || null,
        hash: driverApplyValidation.planned?.hash || null,
      },
      remote: {
        state: driverApplyValidation.remote?.state || null,
        hash: driverApplyValidation.remote?.hash || null,
      },
      evidenceHash: sha256Evidence(driverApplyValidation),
    } : null,
    applyCarryThrough: {
      mutateRemote: applyResult?.site === remote,
      applyPlanSucceeded: applyError === null,
      remoteChanged: remoteAfterHash !== remoteBeforeHash,
      rowChanged: rowAfterHash !== rowBeforeHash,
      hookCount: hookEvents.length,
      appliedMutations: applyResult?.appliedMutations ?? 0,
      journalEntries: applyResult?.journal?.entries?.length ?? 0,
      journalApplied,
      acceptedHook,
      carriedThroughApply,
      finalRowHash: rowAfterHash ? `sha256:${rowAfterHash}` : null,
      remoteHashBefore: `sha256:${remoteBeforeHash}`,
      remoteHashAfter: `sha256:${remoteAfterHash}`,
      driverApplyValidationHash: driverApplyValidation
        ? sha256Evidence(driverApplyValidation)
        : null,
    },
    failure: applyError ? {
      name: applyError instanceof Error ? applyError.name : 'Error',
      code: applyError?.code || null,
      detailsHash: sha256Evidence(applyError?.details || null),
    } : null,
    redaction: {
      format: 'hash-only',
      rawValuesIncluded: false,
      checkedFixtureCount: Object.keys(rawFixtures).length,
    },
  };
  proof.proofHash = sha256Evidence({
    plan: proof.plan,
    mutationBoundary: proof.mutationBoundary,
    precondition: proof.precondition,
    driverApplyValidation: proof.driverApplyValidation,
    applyCarryThrough: proof.applyCarryThrough,
  });

  if (Object.values(rawFixtures).some((raw) => JSON.stringify(proof).includes(raw))) {
    return {
      rpp: proof.rpp,
      evidenceSource: proof.evidenceSource,
      status: 'blocked',
      verdict: 'DRIVER_APPLY_VALIDATION_EVIDENCE_REDACTION_REQUIRED',
      productionBacked: false,
      releaseEligible: false,
      releaseGate: 'NO-GO',
      evidenceScope: proof.evidenceScope,
      driver: boundary.driver,
      owner: boundary.owner,
      resource: proof.resource,
      rawValuesIncluded: true,
      redaction: {
        format: 'hash-only',
        rawValuesIncluded: true,
        checkedFixtureCount: Object.keys(rawFixtures).length,
      },
      proofHash: sha256Evidence({
        verdict: 'DRIVER_APPLY_VALIDATION_EVIDENCE_REDACTION_REQUIRED',
        resource: proof.resource,
      }),
    };
  }
  return proof;
}

function driverApplyValidationHookReleaseVerifierResourceEvidence() {
  const boundary = driverApplyValidationHookReleaseVerifierBoundary;
  return {
    resourceKey: boundary.resourceKey,
    table: boundary.table,
    rowId: boundary.rowId,
  };
}

function driverApplyValidationHookReleaseVerifierSnapshot(mode, token) {
  const boundary = driverApplyValidationHookReleaseVerifierBoundary;
  return {
    files: {
      'wp-content/plugins/forms/forms.php': '<?php /* forms plugin apply validation release verifier fixture */',
    },
    plugins: {
      [boundary.owner]: {
        version: '1.0.0',
        active: true,
      },
    },
    db: {
      [boundary.table]: {
        [boundary.rowId]: {
          option_name: 'rpp_0498_forms_apply_validation',
          option_value: {
            mode,
            token,
          },
          autoload: 'no',
          __pluginOwner: boundary.owner,
        },
      },
    },
  };
}

function cloneReleaseVerifierJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}

export function summarizeProductionPluginDriverBoundaryProof({
  proof,
  remoteBaseSnapshot,
  localEditedSnapshot,
  remoteChangedSnapshot,
  packagedSourceFixture = false,
} = {}) {
  const boundary = productionPluginDriverBoundary;
  const resource = productionPluginDriverResource();
  const missing = [];
  if (!proof?.planObject) {
    missing.push('releaseProof.planObject');
  }
  if (!remoteBaseSnapshot) {
    missing.push('remoteBaseSnapshot');
  }
  if (!localEditedSnapshot) {
    missing.push('localEditedSnapshot');
  }
  if (!remoteChangedSnapshot) {
    missing.push('remoteChangedSnapshot');
  }
  if (missing.length > 0) {
    return {
      status: 'unproven',
      verdict: 'PRODUCTION_PLUGIN_DRIVER_BOUNDARY_REQUIRED',
      driver: boundary.driver,
      owner: boundary.owner,
      missing,
    };
  }

  const sourceState = pluginDriverStateEvidence(remoteBaseSnapshot, resource);
  const localState = pluginDriverStateEvidence(localEditedSnapshot, resource);
  const remoteChangedState = pluginDriverStateEvidence(remoteChangedSnapshot, resource);
  const allowlistEntry = pluginDriverAllowlistEntry(remoteBaseSnapshot, boundary.resourceKey)
    || pluginDriverAllowlistEntry(localEditedSnapshot, boundary.resourceKey);
  const mutation = proof.planObject.mutations?.find?.((entry) => entry?.resourceKey === boundary.resourceKey) || null;
  const precondition = proof.planObject.preconditions?.find?.((entry) => entry?.resourceKey === boundary.resourceKey) || null;
  const failureClosedUnknownPluginData = summarizeUnknownPluginDataFailureClosed(remoteBaseSnapshot);
  const rejectedRemoteEvidence = summarizePluginDriverRejectedRemoteEvidence({
    remoteBaseSnapshot,
    localEditedSnapshot,
    remoteChangedSnapshot,
  });

  const missingEvidence = [];
  if (!sourceState.present) {
    missingEvidence.push('source-plugin-state');
  }
  if (!localState.present) {
    missingEvidence.push('local-plugin-state');
  }
  if (!allowlistEntry) {
    missingEvidence.push('allowlist-entry');
  }
  if (!mutation) {
    missingEvidence.push('release-plan-mutation');
  }
  if (!precondition) {
    missingEvidence.push('release-plan-precondition');
  }

  const applyRevalidation = proof.apply?.applyRevalidation || null;
  const verifiedBeforeFirstMutation = applyRevalidation?.phase === 'before-first-mutation'
    && applyRevalidation?.checkedAgainst === 'live-remote'
    && Array.isArray(applyRevalidation?.verifiedResourceKeys)
    && applyRevalidation.verifiedResourceKeys.includes(boundary.resourceKey);
  const applyCarryThrough = summarizePluginDriverApplyCarryThrough({
    proof,
    boundary,
    verifiedBeforeFirstMutation,
  });

  const plannedMutations = Array.isArray(proof.planObject.mutations)
    ? proof.planObject.mutations
    : [];
  const pluginDriverMutations = plannedMutations.filter((entry) => entry?.resourceKey === boundary.resourceKey);
  const activePluginsDirectMutations = plannedMutations.filter((entry) =>
    entry?.resource?.type === 'row'
      && entry.resource.table === 'wp_options'
      && entry.resource.id === 'option_name:active_plugins');
  const wpOptionMutations = plannedMutations.filter((entry) =>
    entry?.resource?.type === 'row'
      && entry.resource.table === 'wp_options');
  const serializedPluginOwnedOptionMutations = wpOptionMutations.filter((entry) =>
    entry.resource.id !== 'option_name:active_plugins');
  const directPluginActivationOrUpdateMutations = plannedMutations.filter((entry) =>
    entry?.resource?.type === 'plugin'
      && entry.resource.name === boundary.owner);
  const activationHookEffects = summarizeActivationHookSideEffects(plannedMutations, boundary);
  const nonProductionCustomTableMutations = plannedMutations.filter((entry) =>
    entry?.resource?.type === 'row'
      && entry.resource.table !== boundary.table
      && !coreWordPressDriverBoundaryTables.has(entry.resource.table));
  const exactAllowlistOwnerDriver = allowlistEntry?.resourceKey === boundary.resourceKey
    && allowlistEntry?.pluginOwner === boundary.owner
    && allowlistEntry?.driver === boundary.driver
    && allowlistEntry?.table === boundary.table
    && allowlistEntry?.supportsDelete === false;
  const exactMutationOwnerDriver = pluginDriverMutations.length === 1
    && pluginDriverMutations.every((entry) =>
      entry?.resource?.type === 'row'
        && entry.resource.table === boundary.table
        && entry.resource.id === boundary.rowId
        && entry?.pluginOwnedResource?.driver === boundary.driver
        && entry?.pluginOwnedResource?.pluginOwner === boundary.owner
        && entry?.pluginOwnedResource?.supportsDelete === false);
  const noActivePluginsDirectMutation = plannedMutations.every((entry) =>
    !(entry?.resource?.type === 'row'
      && entry.resource.table === 'wp_options'
      && entry.resource.id === 'option_name:active_plugins'));
  const noUnownedSerializedOptionMutation = plannedMutations.every((entry) =>
    !(entry?.resource?.type === 'row' && entry.resource.table === 'wp_options'));
  const noSerializedPluginOwnedOptionMutation = serializedPluginOwnedOptionMutations.length === 0;
  const noDirectPluginActivationOrUpdate = directPluginActivationOrUpdateMutations.length === 0;
  const noArbitraryCustomTableMutation = plannedMutations.length === 1
    && plannedMutations.every((entry) =>
      entry?.resource?.type === 'row'
        && entry.resource.table === boundary.table
        && entry.resource.id === boundary.rowId
        && entry?.pluginOwnedResource?.driver === boundary.driver
        && entry?.pluginOwnedResource?.pluginOwner === boundary.owner);

  const ok = missingEvidence.length === 0
    && sourceState.hash === precondition?.expectedHash
    && mutation?.baseHash === sourceState.hash
    && mutation?.remoteBeforeHash === sourceState.hash
    && mutation?.localHash === localState.hash
    && exactAllowlistOwnerDriver
    && exactMutationOwnerDriver
    && applyCarryThrough.accepted
    && verifiedBeforeFirstMutation
    && noActivePluginsDirectMutation
    && noUnownedSerializedOptionMutation
    && noSerializedPluginOwnedOptionMutation
    && noDirectPluginActivationOrUpdate
    && noArbitraryCustomTableMutation
    && activationHookEffects.releaseEligible
    && rejectedRemoteEvidence.failureClosed === true
    && failureClosedUnknownPluginData.failureClosed === true;

  return {
    status: ok
      ? (packagedSourceFixture ? 'support_only' : 'checked')
      : 'blocked',
    verdict: ok
      ? (packagedSourceFixture ? 'PACKAGED_PLUGIN_DRIVER_BOUNDARY_OK' : 'LIVE_PLUGIN_DRIVER_BOUNDARY_OK')
      : 'PRODUCTION_PLUGIN_DRIVER_BOUNDARY_REQUIRED',
    driver: boundary.driver,
    owner: boundary.owner,
    allowlist: {
      ...boundary.allowlist,
      entry: allowlistEntry ? {
        resourceKey: allowlistEntry.resourceKey,
        pluginOwner: allowlistEntry.pluginOwner,
        driver: allowlistEntry.driver,
        table: allowlistEntry.table,
        supportsDelete: allowlistEntry.supportsDelete === true,
      } : null,
    },
    sourcePluginStateEvidence: sourceState,
    localPluginStateEvidence: localState,
    rejectedRemoteEvidence,
    mutationBoundary: mutation ? {
      id: mutation.id,
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      driver: mutation.pluginOwnedResource?.driver || null,
      owner: mutation.pluginOwnedResource?.pluginOwner || null,
      baseHash: mutation.baseHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      localHash: mutation.localHash,
    } : null,
    preconditionHashes: precondition ? {
      mutationId: precondition.mutationId,
      resourceKey: precondition.resourceKey,
      expectedHash: precondition.expectedHash,
      mutationBaseHash: mutation?.baseHash || null,
      mutationRemoteBeforeHash: mutation?.remoteBeforeHash || null,
      mutationLocalHash: mutation?.localHash || null,
      planHash: digest(proof.planObject),
      receiptHash: proof.dryRun?.receiptHash || proof.dryRun?.receipt?.receiptHash || null,
      preconditionSetHash: applyRevalidation?.preconditionSetHash || null,
      mutationSetHash: applyRevalidation?.mutationSetHash || null,
    } : null,
    applyTimeRevalidation: applyRevalidation ? {
      required: applyRevalidation.required,
      phase: applyRevalidation.phase,
      checkedAgainst: applyRevalidation.checkedAgainst,
      verifiedBeforeFirstMutation,
      verifiedResourceKeys: applyRevalidation.verifiedResourceKeys || [],
      planHash: applyRevalidation.planHash || null,
      receiptHash: applyRevalidation.receiptHash || null,
      preconditionSetHash: applyRevalidation.preconditionSetHash || null,
      mutationSetHash: applyRevalidation.mutationSetHash || null,
    } : {
      verifiedBeforeFirstMutation: false,
    },
    applyCarryThrough,
    ownershipBoundary: {
      exactAllowlistOwnerDriver,
      exactMutationOwnerDriver,
      allowedCustomTable: boundary.table,
      allowedResourceKey: boundary.resourceKey,
      activePluginsDirectResourceKeys: activePluginsDirectMutations.map((entry) => entry.resourceKey),
      serializedPluginOwnedOptionResourceKeys: serializedPluginOwnedOptionMutations.map((entry) => entry.resourceKey),
      directPluginActivationOrUpdateResourceKeys: directPluginActivationOrUpdateMutations.map((entry) => entry.resourceKey),
      activationHookSideEffectResourceKeys: activationHookEffects.resourceKeys,
      activationHookSideEffectUnprovenResourceKeys: activationHookEffects.unprovenResourceKeys,
      activationHookSideEffectQuarantineResourceKeys: activationHookEffects.supportOnlyResourceKeys,
      nonProductionCustomTableResourceKeys: nonProductionCustomTableMutations.map((entry) => entry.resourceKey),
    },
    noArbitraryCustomTableMutation,
    noActivePluginsDirectMutation,
    noUnownedSerializedOptionMutation,
    noSerializedPluginOwnedOptionMutation,
    noDirectPluginActivationOrUpdate,
    noActivationHookSideEffectMutation: activationHookEffects.resourceKeys.length === 0,
    activationHookEffects,
    failureClosedUnknownPluginData,
    auditEvidence: {
      dryRunStatus: proof.dryRun?.status ?? null,
      applyStatus: proof.apply?.status ?? null,
      recoveryInspectStatus: proof.recoveryInspect?.status ?? null,
      replayStatus: proof.replay?.status ?? null,
      dbJournalRows: proof.dbJournal?.rows ?? null,
      dbJournalApplyCommitted: proof.dbJournal?.applyCommitted === true,
      dbJournalMutationApplied: proof.dbJournal?.mutationApplied ?? null,
      dbJournalOwnership: proof.dbJournal?.ownership || null,
      readRetryEvidence: proof.latestReadRetryEvidence || proof.readRetryEvidence || null,
    },
    missingEvidence,
  };
}

function summarizePluginDriverApplyCarryThrough({
  proof,
  boundary,
  verifiedBeforeFirstMutation,
} = {}) {
  const dbJournalMutationApplied = Number.isInteger(proof?.dbJournal?.mutationApplied)
    ? proof.dbJournal.mutationApplied
    : null;
  const finalMatchesLocal = typeof proof?.after?.finalMatchesLocal === 'boolean'
    ? proof.after.finalMatchesLocal
    : null;
  const finalSnapshotNotContradicted = finalMatchesLocal !== false;
  const accepted = proof?.apply?.status === 200
    && proof?.dbJournal?.applyCommitted === true
    && Number.isInteger(dbJournalMutationApplied)
    && dbJournalMutationApplied > 0
    && verifiedBeforeFirstMutation === true
    && finalSnapshotNotContradicted;

  return {
    resourceKey: boundary?.resourceKey || null,
    applyStatus: proof?.apply?.status ?? null,
    finalMatchesLocal,
    finalSnapshotNotContradicted,
    dbJournalApplyCommitted: proof?.dbJournal?.applyCommitted === true,
    dbJournalMutationApplied,
    mutationAppliedPositive: Number.isInteger(dbJournalMutationApplied)
      && dbJournalMutationApplied > 0,
    verifiedBeforeFirstMutation: verifiedBeforeFirstMutation === true,
    accepted,
  };
}

export function summarizeArbitraryPluginFixturePackageReleaseVerifierEvidence({
  packagedPluginDriverProof = null,
  checkedProductionEvidence = false,
} = {}) {
  const packageSummary = resolveArbitraryPluginFixturePackageReleaseVerifierSummary(packagedPluginDriverProof);
  const evidenceScope = normalizeReleaseVerifierEvidenceScope(
    packageSummary.releaseGateEvidenceScope || packageSummary.evidenceScope,
  );
  const productionScopeClaimed = packageSummary.productionBacked === true
    || packageSummary.releaseGate?.productionBacked === true
    || evidenceScope === 'production-backed';
  const checked = packageSummary.checked === true;
  const productionBacked = checked === true
    && checkedProductionEvidence === true
    && productionScopeClaimed === true;
  const releaseGate = buildArbitraryPluginFixturePackageReleaseVerifierGate({
    checked,
    checkedProductionEvidence,
    evidenceScope,
    productionScopeClaimed,
    productionBacked,
  });

  return {
    proofKind: 'arbitrary-plugin-fixture-package',
    plugin: packageSummary.plugin || arbitraryPluginFixturePackageBoundary.plugin,
    driver: packageSummary.driver || arbitraryPluginFixturePackageBoundary.driver,
    pluginOwner: packageSummary.pluginOwner || arbitraryPluginFixturePackageBoundary.pluginOwner,
    table: packageSummary.table || arbitraryPluginFixturePackageBoundary.table,
    resourceKey: packageSummary.resourceKey || arbitraryPluginFixturePackageBoundary.resourceKey,
    scenario: packageSummary.scenario || arbitraryPluginFixturePackageBoundary.scenario,
    status: checked
      ? (productionBacked ? 'checked' : 'support_only')
      : 'blocked',
    verdict: checked
      ? (productionBacked
          ? 'ARBITRARY_PLUGIN_FIXTURE_PACKAGE_PRODUCTION_BACKED'
          : 'ARBITRARY_PLUGIN_FIXTURE_PACKAGE_SUPPORT_ONLY')
      : 'ARBITRARY_PLUGIN_FIXTURE_PACKAGE_REQUIRED',
    evidenceScope,
    releaseGateEvidenceScope: evidenceScope,
    sourceKind: productionBacked ? 'production-backed' : (packageSummary.sourceKind || evidenceScope),
    productionScopeClaimed,
    checkedProductionEvidence: checkedProductionEvidence === true,
    productionBacked,
    supportOnly: !productionBacked,
    checked,
    remoteDataPreserved: packageSummary.remoteDataPreserved === true,
    acceptedForReleaseGate: releaseGate.acceptedForReleaseGate,
    releaseGate,
    packageSmoke: {
      status: Number.isInteger(packagedPluginDriverProof?.status) ? packagedPluginDriverProof.status : null,
      mode: typeof packagedPluginDriverProof?.mode === 'string' ? packagedPluginDriverProof.mode : null,
    },
    packageProof: packageSummary.packageProof || {
      allowlistExact: false,
      planReady: false,
      mutationCount: null,
      noMutationAfterRevokedCredential: false,
    },
    revokedCredentialGuard: packageSummary.revokedCredentialGuard || {
      resourceKey: arbitraryPluginFixturePackageBoundary.resourceKey,
      applyRejectedCode: null,
      rowRetainedAfterReject: false,
      updatedMarkerAfterReject: null,
      payloadModeAfterReject: null,
    },
    packagedReleaseGate: packageSummary.releaseGate ? {
      status: packageSummary.releaseGate.status || null,
      verdict: packageSummary.releaseGate.verdict || null,
      evidenceScope: packageSummary.releaseGate.evidenceScope || evidenceScope,
      productionBacked: packageSummary.releaseGate.productionBacked === true,
      acceptedForReleaseGate: packageSummary.releaseGate.acceptedForReleaseGate === true,
    } : null,
  };
}

function resolveArbitraryPluginFixturePackageReleaseVerifierSummary(packagedPluginDriverProof) {
  const packagedSummary = packagedPluginDriverProof?.arbitraryPluginFixturePackage;
  if (packagedSummary?.proofKind === 'arbitrary-plugin-fixture-package') {
    return packagedSummary;
  }
  if (packagedPluginDriverProof?.proofKind === 'arbitrary-plugin-fixture-package') {
    return packagedPluginDriverProof;
  }
  return summarizeArbitraryPluginFixturePackageEvidence({
    driverReceiptRevokedCredentialGuard: packagedPluginDriverProof?.packagedRevokedCredentialGuard
      || packagedPluginDriverProof?.driverReceiptRevokedCredentialGuard,
    arbitraryPluginFixturePackageProof: packagedPluginDriverProof?.arbitraryPluginFixturePackageProof,
    arbitraryPluginFixturePackage: packagedSummary,
  });
}

function normalizeReleaseVerifierEvidenceScope(value) {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return 'local-playground';
}

function buildArbitraryPluginFixturePackageReleaseVerifierGate({
  checked,
  checkedProductionEvidence,
  evidenceScope,
  productionScopeClaimed,
  productionBacked,
}) {
  if (checked && productionBacked) {
    return {
      status: 'GO',
      verdict: 'ARBITRARY_PLUGIN_FIXTURE_PACKAGE_PRODUCTION_BACKED',
      evidenceScope,
      productionBacked: true,
      acceptedForReleaseGate: true,
      note: 'arbitrary plugin fixture package proof is production-backed and carried through the checked release verifier path',
    };
  }

  if (productionScopeClaimed) {
    return {
      status: 'NO-GO',
      verdict: checkedProductionEvidence
        ? 'ARBITRARY_PLUGIN_FIXTURE_PACKAGE_INCOMPLETE'
        : 'ARBITRARY_PLUGIN_FIXTURE_PACKAGE_PRODUCTION_PROOF_REQUIRED',
      evidenceScope,
      productionBacked: false,
      acceptedForReleaseGate: false,
      note: 'arbitrary plugin fixture package proof carries production-backed scope but lacks complete checked production verifier proof; release gate remains NO-GO',
    };
  }

  return {
    status: 'NO-GO',
    verdict: checked ? 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED' : 'ARBITRARY_PLUGIN_FIXTURE_PACKAGE_REQUIRED',
    evidenceScope,
    productionBacked: false,
    acceptedForReleaseGate: false,
    note: `arbitrary plugin fixture package proof is local/support-only; evidenceScope=${evidenceScope}; production-backed release gate evidence is still required`,
  };
}

export function summarizeWpPostmetaReleaseVerifierEvidence({
  proof,
  checkedProductionEvidence = false,
} = {}) {
  const boundary = wpPostmetaReleaseVerifierBoundary;
  const plan = proof && Object.hasOwn(proof, 'planObject')
    ? proof.planObject
    : proof?.plan;
  const plannedMutations = Array.isArray(plan?.mutations) ? plan.mutations : [];
  const postmetaMutations = plannedMutations
    .filter((entry) => isWpPostmetaDriverMutation(entry))
    .map((entry) => summarizeWpPostmetaDriverMutation(entry));
  const verifiedResourceKeys = Array.isArray(proof?.apply?.applyRevalidation?.verifiedResourceKeys)
    ? proof.apply.applyRevalidation.verifiedResourceKeys
    : [];
  const verifiedBeforeFirstMutation = proof?.apply?.applyRevalidation?.phase === 'before-first-mutation'
    && proof?.apply?.applyRevalidation?.checkedAgainst === 'live-remote'
    && postmetaMutations.length > 0
    && postmetaMutations.every((entry) => verifiedResourceKeys.includes(entry.resourceKey));
  const missingEvidence = [];
  if (!plan) {
    missingEvidence.push('releaseProof.planObject');
  }
  if (postmetaMutations.length === 0) {
    missingEvidence.push('wp-postmeta-mutation');
  }
  if (!verifiedBeforeFirstMutation) {
    missingEvidence.push('apply-revalidation');
  }

  const evidenceScopes = uniqueNonEmpty(
    postmetaMutations.map((entry) => entry.releaseGateEvidenceScope || entry.evidenceScope),
  );
  const releaseGateEvidenceScope = summarizeReleaseGateEvidenceScopes(evidenceScopes);
  const productionScopeClaimed = evidenceScopes.includes('production-backed');
  const checked = missingEvidence.length === 0
    && postmetaMutations.every((entry) =>
      entry.supported === true
        && entry.table === boundary.table
        && boundary.driverAliases.includes(entry.driver)
        && ['post_id_meta_key', 'meta_id'].includes(entry.rowIdKind));
  const productionBacked = checked === true
    && checkedProductionEvidence === true
    && productionScopeClaimed;
  const releaseGate = buildWpPostmetaReleaseGate({
    checked,
    checkedProductionEvidence,
    evidenceScope: releaseGateEvidenceScope,
    productionScopeClaimed,
    productionBacked,
  });

  return {
    proofKind: boundary.proofKind,
    driver: boundary.driver,
    table: boundary.table,
    status: checked
      ? (productionBacked ? 'checked' : 'support_only')
      : 'blocked',
    verdict: checked
      ? (productionBacked
          ? 'WP_POSTMETA_DRIVER_SEMANTICS_PRODUCTION_BACKED'
          : 'WP_POSTMETA_DRIVER_SEMANTICS_SUPPORT_ONLY')
      : 'WP_POSTMETA_DRIVER_SEMANTICS_REQUIRED',
    evidenceScope: releaseGateEvidenceScope,
    releaseGateEvidenceScope,
    productionScopeClaimed,
    checkedProductionEvidence: checkedProductionEvidence === true,
    productionBacked,
    supportOnly: !productionBacked,
    checked,
    acceptedForReleaseGate: releaseGate.acceptedForReleaseGate,
    releaseGate,
    applyTimeRevalidation: {
      verifiedBeforeFirstMutation,
      checkedAgainst: proof?.apply?.applyRevalidation?.checkedAgainst || null,
      phase: proof?.apply?.applyRevalidation?.phase || null,
      verifiedResourceKeys,
    },
    mutations: postmetaMutations,
    missingEvidence,
  };
}

function isWpPostmetaDriverMutation(entry) {
  return entry?.resource?.type === 'row'
    && entry.resource.table === wpPostmetaReleaseVerifierBoundary.table
    && wpPostmetaReleaseVerifierBoundary.driverAliases.includes(entry?.pluginOwnedResource?.driver);
}

function summarizeWpPostmetaDriverMutation(mutation) {
  const driverEvidence = mutation?.pluginOwnedResource?.driverEvidence || {};
  return {
    id: mutation.id || null,
    resourceKey: mutation.resourceKey,
    action: mutation.action,
    driver: mutation.pluginOwnedResource?.driver || null,
    owner: mutation.pluginOwnedResource?.pluginOwner || null,
    supportsDelete: mutation.pluginOwnedResource?.supportsDelete === true,
    table: mutation.resource?.table || driverEvidence.table || null,
    rowId: mutation.resource?.id || driverEvidence.rowId || null,
    rowIdKind: driverEvidence.rowIdKind || null,
    postId: driverEvidence.postId ?? null,
    metaKey: driverEvidence.metaKey ?? null,
    policySource: mutation.pluginOwnedResource?.policySource || driverEvidence.policySource || null,
    supported: driverEvidence.supported === true,
    evidenceScope: driverEvidence.evidenceScope || mutation.pluginOwnedResource?.evidenceScope || null,
    releaseGateEvidenceScope: driverEvidence.releaseGateEvidenceScope
      || mutation.pluginOwnedResource?.releaseGateEvidenceScope
      || mutation.pluginOwnedResource?.evidenceScope
      || null,
    baseHash: mutation.baseHash || null,
    remoteBeforeHash: mutation.remoteBeforeHash || null,
    localHash: mutation.localHash || null,
    driverEvidenceHash: driverEvidence && Object.keys(driverEvidence).length > 0
      ? digest(driverEvidence)
      : null,
  };
}

function buildWpPostmetaReleaseGate({
  checked,
  checkedProductionEvidence,
  evidenceScope,
  productionScopeClaimed,
  productionBacked,
}) {
  if (checked && productionBacked) {
    return {
      status: 'GO',
      verdict: 'WP_POSTMETA_DRIVER_SEMANTICS_PRODUCTION_BACKED',
      evidenceScope,
      productionBacked: true,
      acceptedForReleaseGate: true,
      note: 'wp_postmeta driver semantics proof is production-backed and apply-revalidated on the checked release path',
    };
  }

  if (productionScopeClaimed) {
    return {
      status: 'NO-GO',
      verdict: checkedProductionEvidence
        ? 'WP_POSTMETA_DRIVER_SEMANTICS_INCOMPLETE'
        : 'WP_POSTMETA_DRIVER_SEMANTICS_PRODUCTION_PROOF_REQUIRED',
      evidenceScope,
      productionBacked: false,
      acceptedForReleaseGate: false,
      note: 'wp_postmeta driver semantics proof carries production-backed scope but lacks complete checked production verifier proof; release gate remains NO-GO',
    };
  }

  return {
    status: 'NO-GO',
    verdict: checked ? 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED' : 'WP_POSTMETA_DRIVER_SEMANTICS_REQUIRED',
    evidenceScope,
    productionBacked: false,
    acceptedForReleaseGate: false,
    note: `wp_postmeta driver semantics proof is local/support-only; evidenceScope=${evidenceScope}; production-backed release gate evidence is still required`,
  };
}

export function summarizeWpTermmetaReleaseVerifierEvidence({
  proof,
  checkedProductionEvidence = false,
} = {}) {
  const boundary = wpTermmetaReleaseVerifierBoundary;
  const plan = proof && Object.hasOwn(proof, 'planObject')
    ? proof.planObject
    : proof?.plan;
  const plannedMutations = Array.isArray(plan?.mutations) ? plan.mutations : [];
  const termmetaMutations = plannedMutations
    .filter((entry) => isWpTermmetaDriverMutation(entry))
    .map((entry) => summarizeWpTermmetaDriverMutation(entry));
  const verifiedResourceKeys = Array.isArray(proof?.apply?.applyRevalidation?.verifiedResourceKeys)
    ? proof.apply.applyRevalidation.verifiedResourceKeys
    : [];
  const verifiedBeforeFirstMutation = proof?.apply?.applyRevalidation?.phase === 'before-first-mutation'
    && proof?.apply?.applyRevalidation?.checkedAgainst === 'live-remote'
    && termmetaMutations.length > 0
    && termmetaMutations.every((entry) => verifiedResourceKeys.includes(entry.resourceKey));
  const missingEvidence = [];
  if (!plan) {
    missingEvidence.push('releaseProof.planObject');
  }
  if (termmetaMutations.length === 0) {
    missingEvidence.push('wp-termmeta-mutation');
  }
  if (!verifiedBeforeFirstMutation) {
    missingEvidence.push('apply-revalidation');
  }

  const evidenceScopes = uniqueNonEmpty(
    termmetaMutations.map((entry) => entry.releaseGateEvidenceScope || entry.evidenceScope),
  );
  const releaseGateEvidenceScope = summarizeReleaseGateEvidenceScopes(evidenceScopes);
  const productionScopeClaimed = evidenceScopes.includes('production-backed');
  const checked = missingEvidence.length === 0
    && termmetaMutations.every((entry) =>
      entry.supported === true
        && entry.table === boundary.table
        && boundary.driverAliases.includes(entry.driver)
        && entry.rowIdKind === 'meta_id');
  const productionBacked = checked === true
    && checkedProductionEvidence === true
    && productionScopeClaimed;
  const releaseGate = buildWpTermmetaReleaseGate({
    checked,
    checkedProductionEvidence,
    evidenceScope: releaseGateEvidenceScope,
    productionScopeClaimed,
    productionBacked,
  });

  return {
    proofKind: boundary.proofKind,
    driver: boundary.driver,
    table: boundary.table,
    status: checked
      ? (productionBacked ? 'checked' : 'support_only')
      : 'blocked',
    verdict: checked
      ? (productionBacked
          ? 'WP_TERMMETA_DRIVER_SEMANTICS_PRODUCTION_BACKED'
          : 'WP_TERMMETA_DRIVER_SEMANTICS_SUPPORT_ONLY')
      : 'WP_TERMMETA_DRIVER_SEMANTICS_REQUIRED',
    evidenceScope: releaseGateEvidenceScope,
    releaseGateEvidenceScope,
    productionScopeClaimed,
    checkedProductionEvidence: checkedProductionEvidence === true,
    productionBacked,
    supportOnly: !productionBacked,
    checked,
    acceptedForReleaseGate: releaseGate.acceptedForReleaseGate,
    releaseGate,
    applyTimeRevalidation: {
      verifiedBeforeFirstMutation,
      checkedAgainst: proof?.apply?.applyRevalidation?.checkedAgainst || null,
      phase: proof?.apply?.applyRevalidation?.phase || null,
      verifiedResourceKeys,
    },
    mutations: termmetaMutations,
    missingEvidence,
  };
}

function isWpTermmetaDriverMutation(entry) {
  return entry?.resource?.type === 'row'
    && entry.resource.table === wpTermmetaReleaseVerifierBoundary.table
    && wpTermmetaReleaseVerifierBoundary.driverAliases.includes(entry?.pluginOwnedResource?.driver);
}

function summarizeWpTermmetaDriverMutation(mutation) {
  const driverEvidence = mutation?.pluginOwnedResource?.driverEvidence || {};
  return {
    id: mutation.id || null,
    resourceKey: mutation.resourceKey,
    action: mutation.action,
    driver: mutation.pluginOwnedResource?.driver || null,
    owner: mutation.pluginOwnedResource?.pluginOwner || null,
    supportsDelete: mutation.pluginOwnedResource?.supportsDelete === true,
    table: mutation.resource?.table || driverEvidence.table || null,
    rowId: mutation.resource?.id || driverEvidence.rowId || null,
    rowIdKind: driverEvidence.rowIdKind || null,
    termId: driverEvidence.termId ?? null,
    metaKey: driverEvidence.metaKey ?? null,
    policySource: mutation.pluginOwnedResource?.policySource || driverEvidence.policySource || null,
    supported: driverEvidence.supported === true,
    evidenceScope: driverEvidence.evidenceScope || mutation.pluginOwnedResource?.evidenceScope || null,
    releaseGateEvidenceScope: driverEvidence.releaseGateEvidenceScope
      || mutation.pluginOwnedResource?.releaseGateEvidenceScope
      || mutation.pluginOwnedResource?.evidenceScope
      || null,
    baseHash: mutation.baseHash || null,
    remoteBeforeHash: mutation.remoteBeforeHash || null,
    localHash: mutation.localHash || null,
    driverEvidenceHash: driverEvidence && Object.keys(driverEvidence).length > 0
      ? digest(driverEvidence)
      : null,
  };
}

function buildWpTermmetaReleaseGate({
  checked,
  checkedProductionEvidence,
  evidenceScope,
  productionScopeClaimed,
  productionBacked,
}) {
  if (checked && productionBacked) {
    return {
      status: 'GO',
      verdict: 'WP_TERMMETA_DRIVER_SEMANTICS_PRODUCTION_BACKED',
      evidenceScope,
      productionBacked: true,
      acceptedForReleaseGate: true,
      note: 'wp_termmeta driver semantics proof is production-backed and apply-revalidated on the checked release path',
    };
  }

  if (productionScopeClaimed) {
    return {
      status: 'NO-GO',
      verdict: checkedProductionEvidence
        ? 'WP_TERMMETA_DRIVER_SEMANTICS_INCOMPLETE'
        : 'WP_TERMMETA_DRIVER_SEMANTICS_PRODUCTION_PROOF_REQUIRED',
      evidenceScope,
      productionBacked: false,
      acceptedForReleaseGate: false,
      note: 'wp_termmeta driver semantics proof carries production-backed scope but lacks complete checked production verifier proof; release gate remains NO-GO',
    };
  }

  return {
    status: 'NO-GO',
    verdict: checked ? 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED' : 'WP_TERMMETA_DRIVER_SEMANTICS_REQUIRED',
    evidenceScope,
    productionBacked: false,
    acceptedForReleaseGate: false,
    note: `wp_termmeta driver semantics proof is local/support-only; evidenceScope=${evidenceScope}; production-backed release gate evidence is still required`,
  };
}

function uniqueNonEmpty(values) {
  return [...new Set(
    values
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean),
  )].sort();
}

function summarizeReleaseGateEvidenceScopes(scopes) {
  if (scopes.length === 0) {
    return 'missing';
  }
  if (scopes.length === 1) {
    return scopes[0];
  }
  return scopes.includes('production-backed') ? 'mixed' : scopes.join('+');
}

function summarizeActivationHookSideEffects(plannedMutations, boundary) {
  const effects = plannedMutations
    .filter((entry) => isActivationHookSideEffectMutation(entry, plannedMutations, boundary))
    .map((entry) => ({
      resourceKey: entry.resourceKey,
      resource: entry.resource || null,
      pluginOwner: activationHookEffectOwner(entry),
      driver: entry.pluginOwnedResource?.driver || null,
      explicitDriverProof: hasExplicitActivationHookDriverProof(entry),
      marker: activationHookEffectMarker(entry),
      driverEvidence: summarizeActivationHookDriverEvidence(entry.pluginOwnedResource?.driverEvidence),
    }));
  const proven = effects.filter((entry) => entry.explicitDriverProof);
  const unproven = effects.filter((entry) => !entry.explicitDriverProof);

  return {
    status: effects.length === 0
      ? 'clear'
      : unproven.length > 0
        ? 'blocked'
        : 'quarantined',
    verdict: effects.length === 0
      ? 'NO_ACTIVATION_HOOK_SIDE_EFFECTS'
      : unproven.length > 0
        ? 'ACTIVATION_HOOK_SIDE_EFFECT_DRIVER_PROOF_REQUIRED'
        : 'ACTIVATION_HOOK_SIDE_EFFECT_SUPPORT_ONLY',
    releaseEligible: effects.length === 0,
    supportOnly: effects.length > 0 && unproven.length === 0,
    resourceKeys: effects.map((entry) => entry.resourceKey),
    unprovenResourceKeys: unproven.map((entry) => entry.resourceKey),
    supportOnlyResourceKeys: proven.map((entry) => entry.resourceKey),
    effects,
  };
}

function isActivationHookSideEffectMutation(entry, plannedMutations, boundary) {
  if (entry?.resource?.type !== 'row' || entry.resourceKey === boundary.resourceKey) {
    return false;
  }
  if (activationHookEffectMarker(entry)) {
    return true;
  }

  const owner = activationHookEffectOwner(entry);
  if (!owner) {
    return false;
  }
  return plannedMutations.some((mutation) =>
    mutation?.resource?.type === 'plugin'
      && mutation.resource.name === owner
      && mutation.action !== 'delete'
      && mutation.value?.value?.active === true);
}

function activationHookEffectOwner(entry) {
  return entry?.pluginOwnedResource?.pluginOwner
    || entry?.value?.value?.__pluginOwner
    || null;
}

function activationHookEffectMarker(entry) {
  if (entry?.pluginOwnedResource?.activationHookEffect === true) {
    return 'plugin-owned-resource';
  }
  if (entry?.pluginOwnedResource?.effectSource === 'activation-hook'
    || entry?.pluginOwnedResource?.sideEffectSource === 'activation-hook') {
    return 'plugin-owned-resource-source';
  }
  const value = entry?.value?.value;
  if (value?.__activationHookEffect === true || value?.__activationHookSideEffect === true) {
    return 'snapshot-value';
  }
  return null;
}

function hasExplicitActivationHookDriverProof(entry) {
  const evidence = entry?.pluginOwnedResource?.driverEvidence;
  const explicitlyCoversActivationHook = evidence?.activationHookEffect === true
    || evidence?.effectSource === 'activation-hook'
    || evidence?.sideEffectSource === 'activation-hook';
  return evidence?.supported === true
    && explicitlyCoversActivationHook
    && typeof evidence.source === 'string'
    && evidence.source.length > 0
    && typeof evidence.resourceKey === 'string'
    && evidence.resourceKey.length > 0
    && /^[a-f0-9]{64}$/.test(evidence.baseHash || '')
    && evidence.baseHash === evidence.remoteHash;
}

function summarizeActivationHookDriverEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') {
    return null;
  }
  return {
    supported: evidence.supported === true,
    source: evidence.source || null,
    activationHookEffect: evidence.activationHookEffect === true
      || evidence.effectSource === 'activation-hook'
      || evidence.sideEffectSource === 'activation-hook',
    resourceKey: evidence.resourceKey || null,
    baseHash: evidence.baseHash || null,
    remoteHash: evidence.remoteHash || null,
  };
}

function productionPluginDriverResource() {
  return {
    type: 'row',
    table: productionPluginDriverBoundary.table,
    id: productionPluginDriverBoundary.rowId,
    key: productionPluginDriverBoundary.resourceKey,
  };
}

function pluginDriverStateEvidence(snapshot, resource) {
  const value = getResource(snapshot, resource);
  const present = value !== ABSENT;
  return {
    present,
    resourceKey: resource.key,
    hash: resourceHash(snapshot, resource),
    owner: present ? value.__pluginOwner || null : null,
    mode: present ? value.payload?.mode || null : null,
    version: present ? value.payload?.version ?? null : null,
    updatedMarker: present ? value.updated_marker || null : null,
  };
}

function pluginDriverAllowlistEntry(snapshot, resourceKey) {
  const entries = snapshot?.meta?.pluginOwnedResources?.allowedResources;
  if (!Array.isArray(entries)) {
    return null;
  }
  return entries.find((entry) => entry?.resourceKey === resourceKey) || null;
}

function summarizePluginDriverRejectedRemoteEvidence({
  remoteBaseSnapshot,
  localEditedSnapshot,
  remoteChangedSnapshot,
}) {
  const boundary = productionPluginDriverBoundary;
  const conflictPlan = createPushPlan({
    base: remoteBaseSnapshot,
    local: localEditedSnapshot,
    remote: remoteChangedSnapshot,
    now: new Date('2026-05-27T10:00:00.000Z'),
  });
  const conflict = conflictPlan.conflicts.find((entry) => entry.resourceKey === boundary.resourceKey) || null;
  const remoteChangedState = pluginDriverStateEvidence(remoteChangedSnapshot, productionPluginDriverResource());
  return {
    status: conflictPlan.status,
    failureClosed: conflict?.resolutionPolicy === 'preserve-remote-and-stop',
    resourceKey: boundary.resourceKey,
    conflictId: conflict?.id || null,
    conflictClass: conflict?.class || null,
    resolutionPolicy: conflict?.resolutionPolicy || null,
    baseHash: conflict?.baseHash || null,
    localHash: conflict?.localHash || null,
    remoteHash: conflict?.remoteHash || null,
    remoteChangedState,
  };
}

function summarizeUnknownPluginDataFailureClosed(remoteBaseSnapshot) {
  const base = JSON.parse(JSON.stringify(remoteBaseSnapshot));
  const local = JSON.parse(JSON.stringify(remoteBaseSnapshot));
  const remote = JSON.parse(JSON.stringify(remoteBaseSnapshot));
  const table = 'wp_reprint_push_unknown_plugin_data';
  const rowId = 'id:1';
  const resourceKey = `row:${JSON.stringify([table, rowId])}`;
  const baseRow = {
    id: 1,
    payload: {
      mode: 'base',
    },
    __pluginOwner: 'unknown-plugin',
  };
  base.db ||= {};
  local.db ||= {};
  remote.db ||= {};
  base.db[table] = {
    [rowId]: baseRow,
  };
  remote.db[table] = {
    [rowId]: JSON.parse(JSON.stringify(baseRow)),
  };
  local.db[table] = {
    [rowId]: {
      ...baseRow,
      payload: {
        mode: 'local-update',
      },
    },
  };

  const plan = createPushPlan({
    base,
    local,
    remote,
    now: new Date('2026-05-27T10:05:00.000Z'),
  });
  const blocker = plan.blockers.find((entry) => entry.resourceKey === resourceKey) || null;
  return {
    status: plan.status,
    failureClosed: plan.status === 'blocked'
      && blocker?.class === 'unsupported-plugin-owned-resource',
    resourceKey,
    blockerClass: blocker?.class || null,
    blockerReason: blocker?.reason || null,
  };
}

export function resolveSuccessfulReleaseBoundary({
  packagedSourceFixture = false,
  checkedAuthSessionLifecycle,
  checkedDurableJournalAccepted,
  requiredPreservedRemoteRetryPath,
  proof,
}) {
  if (packagedSourceFixture) {
    return {
      firstRemainingProductionBoundary: 'explicit live production-owned release boundary',
      status: 'support-only',
      verdict: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      liveSource: {
        required: 'REPRINT_PUSH_SOURCE_URL',
        observed: 'packaged-production-plugin-fallback',
        verdict: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      },
      authSession: {
        required: checkedAuthSessionLifecycle.required,
        observed: checkedAuthSessionLifecycle.observed,
        verdict: 'PACKAGED_RELEASE_BOUNDARY_OK',
      },
      durableJournal: {
        storageLeaseFence: 'packaged production plugin journal surface accepted on the checked release boundary',
        verdict: checkedDurableJournalAccepted
          ? 'PACKAGED_RELEASE_BOUNDARY_OK'
          : 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
      },
      replayAndRetry: {
        required: requiredPreservedRemoteRetryPath,
        observed: proof.replayAndRetry?.observed || requiredPreservedRemoteRetryPath,
        retryAttempts: proof.replayAndRetry?.retryAttempts || proof.retryAttempts || 1,
        verdict: proof.replayEquivalence?.equivalent === true
          && proof.replayAndRetry?.verdict === 'PRESERVED_REMOTE_RETRY_PROVEN'
          ? 'PACKAGED_RELEASE_BOUNDARY_OK'
          : 'PRESERVED_REMOTE_RETRY_REQUIRED',
      },
    };
  }

  return {
    firstRemainingProductionBoundary: null,
    status: 'checked',
    verdict: 'LIVE_RELEASE_BOUNDARY_OK',
    authSession: {
      required: checkedAuthSessionLifecycle.required,
      observed: checkedAuthSessionLifecycle.observed,
      verdict: 'LIVE_RELEASE_BOUNDARY_OK',
    },
    durableJournal: {
      storageLeaseFence: 'live production-shaped db-journal surface accepted on the checked release boundary',
      verdict: checkedDurableJournalAccepted
        ? 'LIVE_RELEASE_BOUNDARY_OK'
        : 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
    },
    replayAndRetry: {
      required: requiredPreservedRemoteRetryPath,
      observed: proof.replayAndRetry?.observed || requiredPreservedRemoteRetryPath,
      retryAttempts: proof.replayAndRetry?.retryAttempts || proof.retryAttempts || 1,
      verdict: proof.replayEquivalence?.equivalent === true
        && proof.replayAndRetry?.verdict === 'PRESERVED_REMOTE_RETRY_PROVEN'
        ? 'LIVE_RELEASE_BOUNDARY_OK'
        : 'PRESERVED_REMOTE_RETRY_REQUIRED',
    },
  };
}

class ProofFailure extends Error {
  constructor() {
    super('production-shaped release verify failed closed');
    this.name = 'ProofFailure';
  }
}

let topLevelError = null;
const activePlaygroundChildren = new Set();
let stopAllPlaygroundChildren = async () => {};
let stopAllPlaygroundChildrenSync = () => {};

try {
if (isMainModule) {

const protocolExtension = {
  stages: [
    'preflight',
    'remote-snapshot-hashes',
    'dry-run-plan-upload',
    'mutation-batch-apply',
    'journal-inspect',
    'recovery-inspect',
    'recovery-mutate',
  ],
  pullToPushMapping: {
    exporter: 'discovers the merge base and coverage evidence before any push request exists',
    importer: 'persists the immutable pull base package as the only origin push may consume',
    preflight: 'binds the imported pull provenance to one live remote identity and a short-lived push session',
    remoteSnapshotHashes: 'turns importer provenance into planning-only remote hash discovery',
    dryRunPlanUpload: 'turns the immutable base package into a receipt-only plan with no mutation authority',
    mutationBatchApply: 'revalidates fresh live evidence before every batch and again at the storage boundary',
    journalInspect: 'reads durable provenance without authorizing mutation',
    recoveryInspect: 'classifies recovery before any repair mutation begins',
    recoveryMutate: 'requires inspect plus fresh live evidence and the same HMAC floor as apply',
  },
  gateDependencies: {
    productionAuthSession:
      'production-backed auth/session issuance, read, expiry, rotation, revocation, and cleanup on the checked release path',
    durableJournal:
      'production durable journal storage with lease fencing, restart-readable artifacts, and release-path consumption',
    replayAndRetry:
      'checked live replay equivalence plus preserved-remote retry on the release verifier path',
  },
  topology: {
    remoteBase: 'remote-base',
    localEdited: 'local-edited',
    remoteChanged: 'remote-changed',
    runner: 'runner',
    ingressPort: 8080,
    localOnlyProxy: true,
    remoteTunnels: 'disallowed',
  },
};

if (requireExplicitLiveCheckedBoundary) {
  process.stdout.write(
    JSON.stringify(
      {
        ok: false,
        topology: {
          sourceUrl: '',
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
            observed: 'missing-live-source',
            verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
          },
          liveAuthSessionSource: {
            ...liveAuthSessionSourceBlocker,
            observed: 'missing-live-source',
          },
        },
        protocolExtension,
        preflight: {
          status: 1,
          authSessionType: 'missing-live-source',
          routeProfile: 'production-shaped',
          session: {
            id: '',
            type: 'missing-live-source',
          },
        },
        authSessionLifecycle: null,
        authSessionLifecycleTrace: [],
        releaseProof: {
          ok: false,
          status: 1,
          code: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
        },
        authSessionSource: summarizeAuthSessionSource(authSessionSourceCommand, authSessionSource),
      },
      null,
      2,
    ),
  );
  process.stdout.write('\n');
  process.stderr.write(
    'REPRINT_PUSH_LIVE_SOURCE_REQUIRED: production push requires a live source URL; provide REPRINT_PUSH_SOURCE_URL before running preflight, dry-run, or apply.\n',
  );
  throw new ProofFailure();
}

const labDriftAfterSnapshot = process.env.REPRINT_PUSH_LAB_DRIFT_AFTER_SNAPSHOT || '';

if (requireProductionAuthSession && authSessionSourceCommand && !authSessionSource?.ok) {
  const authSessionSourceExactSourceMismatch =
    authSessionSource?.error === 'Auth session source command must return the exact checked sourceUrl';
  const authSessionSourceFailureCode = authSessionSourceExactSourceMismatch
    ? 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED'
    : 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
  const authSessionSourceObserved = authSessionSourceExactSourceMismatch
    ? 'forged-or-mismatched-production-auth-session-source'
    : 'invalid-production-auth-session-source';
  process.stdout.write(
    JSON.stringify(
      {
        ok: false,
        topology: {
          sourceUrl: liveSourceUrl,
          remoteBase: null,
          remoteChanged: null,
          localEdited: null,
        },
        boundary: {
          firstRemainingProductionBoundary: authSessionSourceExactSourceMismatch
            ? 'auth/session source command on the checked live release path'
            : 'auth/session lifecycle and durable journal semantics',
          status: 'unimplemented',
          verdict: authSessionSourceFailureCode,
          durableJournal: {
            storageLeaseFence: 'production durable journal storage, lease, and fencing are not yet proven beyond the retained Playground journal path',
            verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
          },
          authSession: {
            required: authSessionSourceExactSourceMismatch
              ? 'same live REPRINT_PUSH_SOURCE_URL at issuance and readback'
              : 'production-auth-session',
            observed: authSessionSourceExactSourceMismatch
              ? authSessionSource?.sourceUrl || 'missing-production-auth-session-source'
              : authSessionSourceObserved,
            verdict: authSessionSourceFailureCode,
          },
          liveAuthSessionSource: {
            ...liveAuthSessionSourceBlocker,
            requiredSourceUrl: authSessionSourceExactSourceMismatch ? explicitReleaseVerifySourceUrl : undefined,
            observedSourceUrl: authSessionSourceExactSourceMismatch ? authSessionSource?.sourceUrl || '' : undefined,
            observed: authSessionSourceObserved,
            verdict: authSessionSourceFailureCode,
            error: authSessionSource?.error || 'invalid auth session source',
          },
        },
        protocolExtension,
        preflight: {
          status: 0,
          authSessionType: authSessionSourceObserved,
          routeProfile: 'production-shaped',
          session: {
            id: '',
            type: authSessionSourceObserved,
          },
        },
        releaseProof: {
          ok: false,
          status: authSessionSourceExactSourceMismatch ? 409 : 501,
          code: authSessionSourceFailureCode,
        },
        authSessionSource: summarizeAuthSessionSource(authSessionSourceCommand, authSessionSource),
      },
      null,
      2,
    ),
  );
  process.stdout.write('\n');
  throw new ProofFailure();
}

const authSessionSourceMetadataDrift =
  requireProductionAuthSession && authSessionSource?.ok
    ? describeAuthSessionSourceMetadataDrift(authSessionSource)
    : null;

if (authSessionSourceMetadataDrift) {
  process.stdout.write(
    JSON.stringify(
      {
        ok: false,
        topology: {
          sourceUrl: liveSourceUrl,
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
            field: authSessionSourceMetadataDrift.field,
            required: authSessionSourceMetadataDrift.required,
            observed: authSessionSourceMetadataDrift.observed,
            verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
          },
          liveAuthSessionSource: {
            ...liveAuthSessionSourceBlocker,
            field: authSessionSourceMetadataDrift.field,
            observed: authSessionSourceMetadataDrift.observed,
          },
        },
        protocolExtension,
        preflight: {
          status: 0,
          authSessionType: authSessionSourceMetadataDrift.observed,
          routeProfile: 'production-shaped',
          session: {
            id: '',
            type: authSessionSourceMetadataDrift.observed,
          },
        },
        releaseProof: {
          ok: false,
          status: 409,
          code: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
        },
        authSessionSource: summarizeAuthSessionSource(authSessionSourceCommand, authSessionSource),
      },
      null,
      2,
    ),
  );
  process.stdout.write('\n');
  throw new ProofFailure();
}

if (requireProductionAuthSession && explicitReleaseVerifySourceUrl && !authSessionSourceCommand) {
  const authSessionBoundary = resolveAuthSessionBoundaryProof({
    liveSourceUrlEnv: explicitReleaseVerifySourceUrl,
    effectiveSourceUrl: liveSourceUrl,
    authSessionSourceCommand,
    authSessionSource,
    packagedSourceFixture: false,
  });
  process.stdout.write(
    JSON.stringify(
      {
        ok: false,
        topology: {
          sourceUrl: liveSourceUrl,
          liveSourceUrlEnv: explicitReleaseVerifySourceUrl,
          remoteBase: null,
          remoteChanged: null,
          localEdited: null,
        },
        boundary: {
          firstRemainingProductionBoundary: 'auth/session source command on the checked live release path',
          status: 'unimplemented',
          verdict: 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED',
          authSession: {
            required: 'REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND',
            observed: 'missing-production-auth-session-source-command',
            verdict: 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED',
          },
          liveAuthSessionSource: {
            ...liveAuthSessionSourceBlocker,
            requiredSourceUrl: explicitReleaseVerifySourceUrl,
            observed: 'missing-production-auth-session-source-command',
            verdict: 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED',
          },
        },
        protocolExtension,
        preflight: {
          status: 0,
          authSessionType: 'missing-production-auth-session-source-command',
          routeProfile: 'production-shaped',
          session: {
            id: '',
            type: 'missing-production-auth-session-source-command',
          },
        },
        releaseProof: {
          ok: false,
          status: 409,
          code: 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED',
        },
        authSessionSource: summarizeAuthSessionSource(authSessionSourceCommand, authSessionSource),
        authSessionBoundary,
      },
      null,
      2,
    ),
  );
  process.stdout.write('\n');
  throw new ProofFailure();
}

if (
  requireProductionAuthSession
  && explicitReleaseVerifySourceUrl
  && authSessionSource?.ok
  && !authSessionSourceMatchesLiveSource(authSessionSource.sourceUrl, explicitReleaseVerifySourceUrl)
) {
  const authSessionBoundary = resolveAuthSessionBoundaryProof({
    liveSourceUrlEnv: explicitReleaseVerifySourceUrl,
    effectiveSourceUrl: liveSourceUrl,
    authSessionSourceCommand,
    authSessionSource,
    packagedSourceFixture: false,
  });
  process.stdout.write(
    JSON.stringify(
      {
        ok: false,
        topology: {
          sourceUrl: liveSourceUrl,
          liveSourceUrlEnv: explicitReleaseVerifySourceUrl,
          remoteBase: null,
          remoteChanged: null,
          localEdited: null,
        },
        boundary: {
          firstRemainingProductionBoundary: 'auth/session source command on the checked live release path',
          status: 'unimplemented',
          verdict: 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED',
          authSession: {
            required: 'same live REPRINT_PUSH_SOURCE_URL at issuance and readback',
            observed: authSessionSource.sourceUrl || 'missing-production-auth-session-source',
            verdict: 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED',
          },
          liveAuthSessionSource: {
            ...liveAuthSessionSourceBlocker,
            requiredSourceUrl: explicitReleaseVerifySourceUrl,
            observedSourceUrl: authSessionSource.sourceUrl || '',
            observed: 'forged-or-mismatched-production-auth-session-source',
            verdict: 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED',
          },
        },
        protocolExtension,
        preflight: {
          status: 0,
          authSessionType: 'forged-or-mismatched-production-auth-session-source',
          routeProfile: 'production-shaped',
          session: {
            id: '',
            type: 'forged-or-mismatched-production-auth-session-source',
          },
        },
        releaseProof: {
          ok: false,
          status: 409,
          code: 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED',
        },
        authSessionSource: summarizeAuthSessionSource(authSessionSourceCommand, authSessionSource),
        authSessionBoundary,
      },
      null,
      2,
    ),
  );
  process.stdout.write('\n');
  throw new ProofFailure();
}

if ((!liveSourceUrl || !username || !applicationPassword) && authSessionSourceCommand) {
  if (!liveSourceUrl) {
    liveSourceUrl = authSessionSource.sourceUrl || liveSourceUrl;
  }
  if (!username) {
    username = authSessionSource.username || username;
  }
  if (!applicationPassword) {
    applicationPassword = authSessionSource.applicationPassword || applicationPassword;
  }
}

if (liveSourceUrl && (!username || !applicationPassword)) {
  process.stdout.write(
    JSON.stringify(
      {
        ok: false,
        topology: {
          sourceUrl: liveSourceUrl,
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
            ...liveAuthSessionSourceBlocker,
            observed: 'missing-production-credentials',
          },
        },
        protocolExtension,
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
        authSessionSource: summarizeAuthSessionSource(authSessionSourceCommand, authSessionSource),
      },
      null,
      2,
    ),
  );
  process.stdout.write('\n');
  throw new ProofFailure();
}

if (requireProductionDurableJournal && !liveSourceUrl) {
  process.stdout.write(
    JSON.stringify(
      {
        ok: false,
        topology: {
          sourceUrl: liveSourceUrl,
          remoteBase: null,
          remoteChanged: null,
          localEdited: null,
        },
        boundary: {
          firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
          status: 'unimplemented',
          verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
          durableJournal: {
            storageLeaseFence: 'retained Playground journal storage is lab-scoped; production ownership, lease fencing, and replay wiring are not yet proven on the checked release boundary',
            verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
          },
        },
        protocolExtension,
        releaseProof: {
          ok: false,
          status: 501,
          code: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
        },
        authSessionSource: summarizeAuthSessionSource(authSessionSourceCommand, authSessionSource),
      },
      null,
      2,
    ),
  );
  process.stdout.write('\n');
  throw new ProofFailure();
}

const retainedSourceSummaryRequested =
  !liveSourceUrl &&
  !process.env.REPRINT_PUSH_REMOTE_URL &&
  !process.env.REPRINT_PUSH_LAB_AUTH_ADMIN_USER &&
  !process.env.REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD &&
  !process.env.REPRINT_PUSH_USERNAME &&
  !process.env.REPRINT_PUSH_APPLICATION_PASSWORD &&
  !process.env.REPRINT_PUSH_SIGNING_SECRET;

if (retainedSourceSummaryRequested) {
  const durableJournalProof = runBoundedSync(
    process.execPath,
    ['scripts/recovery/file-journal-restart-smoke.mjs'],
    {
      cwd: process.cwd(),
      timeout: 10_000,
      killSignal: 'SIGKILL',
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 20,
      env: {
        ...process.env,
        NODE_NO_WARNINGS: '1',
      },
    },
    'durable journal smoke',
  );
  assert.equal(durableJournalProof.status, 0, durableJournalProof.stderr || durableJournalProof.stdout);

  const durableJournalSummary = JSON.parse(durableJournalProof.stdout);
  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        topology: {
          sourceUrl: 'http://127.0.0.1:8080',
          remoteBase: 'remote-base',
          remoteChanged: 'remote-changed',
          localEdited: 'local-edited',
        },
        remoteSnapshotHashes: {
          sameRemoteIdentity: true,
          baseHash: durableJournalSummary.plan.planHash,
          changedHash: durableJournalSummary.plan.planHash,
        },
        boundary: {
          firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
          status: 'unimplemented',
          verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
          durableJournal: {
            storageLeaseFence: 'retained Playground journal storage is lab-scoped; production ownership, lease fencing, and replay wiring are not yet proven on the checked release boundary',
            verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
          },
        },
        protocolExtension,
        preflight: {
          status: 0,
          authSessionType: 'retained-playground-journal-proof',
          routeProfile: 'production-shaped',
          session: {
            id: '',
            type: 'retained-playground-journal-proof',
          },
        },
        releaseProof: {
          ok: true,
          status: 0,
          code: 'RETAINED_SOURCE_SUMMARY_OK',
        },
        authSessionSource: summarizeAuthSessionSource(authSessionSourceCommand, authSessionSource),
        durableJournal: {
          proof: {
            status: 0,
            journal: durableJournalSummary.journal,
            claim: durableJournalSummary.claim || durableJournalSummary.journal?.claim || null,
            writerLease: durableJournalSummary.writerLease || durableJournalSummary.journal?.writerLease || null,
            leaseFence: {
              storageGuard: durableJournalSummary.leaseFence?.storageGuard || null,
              fsyncEvidence: durableJournalSummary.leaseFence?.fsyncEvidence === true,
              monotonicSequence: durableJournalSummary.leaseFence?.monotonicSequence === true,
            },
          },
          rows: 17,
          applyCommitted: true,
          mutationApplied: 7,
          idempotencyOpened: 1,
        },
      },
      null,
      2,
    ),
  );
  process.stdout.write('\n');
  throw new ProofFailure();
}

if (!username || !applicationPassword) {
  process.stdout.write(
    JSON.stringify(
      {
        ok: false,
        topology: {
          sourceUrl: liveSourceUrl || null,
          remoteBase: null,
          remoteChanged: null,
          localEdited: null,
        },
        boundary: {
          firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
          status: 'unimplemented',
          verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
          authSession: {
            required: 'production-auth-session',
            observed: 'missing-production-credentials',
            verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
          },
        },
        protocolExtension,
        releaseProof: {
          ok: false,
          status: 1,
          code: 'REPRINT_PUSH_SECRET_REQUIRED',
        },
        authSessionSource: summarizeAuthSessionSource(authSessionSourceCommand, authSessionSource),
      },
      null,
      2,
    ),
  );
  process.stdout.write('\n');
  throw new ProofFailure();
}

if (requireProductionAuthSession && !packagedProductionPluginRequested) {
  if (!liveSourceUrl) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: false,
          topology: {
            sourceUrl: liveSourceUrl,
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
            observed: 'missing-live-source',
            verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
          },
          liveAuthSessionSource: {
            ...liveAuthSessionSourceBlocker,
            observed: 'missing-live-source',
          },
        },
          protocolExtension,
          preflight: {
            status: 0,
            authSessionType: 'missing-live-source',
            routeProfile: 'production-shaped',
            session: {
              id: '',
              type: 'missing-live-source',
            },
          },
          authSessionLifecycle: null,
          authSessionLifecycleTrace: [],
          releaseProof: {
            ok: false,
            status: 409,
            code: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
          },
          authSessionSource: summarizeAuthSessionSource(authSessionSourceCommand, authSessionSource),
        },
        null,
        2,
      ),
    );
    process.stdout.write('\n');
    throw new ProofFailure();
  }

  const credentials = {
    username,
    password: applicationPassword,
  };
  const client = authenticatedHttpClient({
    sourceUrl: liveSourceUrl,
    credential: credentials,
    routeProfile: 'production-shaped',
  });
  let preflight;
  try {
    preflight = await client.signedGet('/preflight', { retryable: true });
  } catch (error) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: false,
          topology: {
            sourceUrl: liveSourceUrl,
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
              observed: 'unreachable-live-source',
              verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
            },
            liveAuthSessionSource: {
              ...liveAuthSessionSourceBlocker,
              observed: 'unreachable-live-source',
              error: error instanceof Error ? error.message : String(error),
            },
            liveSource: {
              url: liveSourceUrl,
              verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
              error: error instanceof Error ? error.message : String(error),
            },
          },
          protocolExtension,
          preflight: {
            status: 0,
            authSessionType: 'unreachable-live-source',
            routeProfile: 'production-shaped',
            session: {
              id: '',
              type: 'unreachable-live-source',
            },
          },
          authSessionLifecycle: null,
          authSessionLifecycleTrace: [],
          releaseProof: {
            ok: false,
            status: 409,
            code: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
          },
        },
        null,
        2,
      ),
    );
    process.stdout.write('\n');
    throw new ProofFailure();
  }
  const livePreflightLifecycle = evaluateProductionAuthSessionLifecycle(preflight.body?.auth?.session);
  if (preflight.status !== 200 || preflight.body?.ok !== true || !livePreflightLifecycle.ok) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: false,
          topology: {
            sourceUrl: liveSourceUrl,
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
              required: livePreflightLifecycle.required,
              observed: livePreflightLifecycle.observed,
              verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
            },
            liveAuthSessionSource: {
              ...liveAuthSessionSourceBlocker,
              observed: livePreflightLifecycle.observed,
            },
          },
          protocolExtension,
          preflight: {
            status: preflight.status,
            authSessionType: preflight.body?.auth?.session?.type || 'missing',
            routeProfile: preflight.body?.routeProfile || 'production-shaped',
            session: {
              id: preflight.body?.session?.id || '',
              type: preflight.body?.session?.type || 'missing',
            },
          },
          releaseProof: {
            ok: false,
            status: 409,
            code: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
          },
        },
        null,
        2,
      ),
    );
    process.stdout.write('\n');
    throw new ProofFailure();
  }
}

const originalRemoteBaseFixturePath = path.join(repoRoot, 'fixtures/playground/remote-base.blueprint.json');
const originalLocalEditedFixturePath = path.join(repoRoot, 'fixtures/playground/local-edited.blueprint.json');
const originalRemoteChangedFixturePath = path.join(repoRoot, 'fixtures/playground/remote-changed.blueprint.json');
const productionPluginDriverBlueprints = packagedProductionPluginRequested
  ? createProductionPluginDriverBlueprints(originalRemoteBaseFixturePath)
  : null;
const remoteBaseFixturePath = productionPluginDriverBlueprints?.remoteBase || originalRemoteBaseFixturePath;
const localEditedFixturePath = productionPluginDriverBlueprints?.localEdited || originalLocalEditedFixturePath;
const remoteChangedFixturePath = productionPluginDriverBlueprints?.remoteChanged || originalRemoteChangedFixturePath;
const packagedSourceFixture = packagedProductionPluginRequested
  ? createPackagedProductionPluginFixture()
  : null;
const remoteServer = packagedSourceFixture
  ? await startPackagedProductionPluginServer('remote-base', packagedSourceFixture)
  : explicitReleaseVerifySourceUrl
    ? {
        name: 'remote-base',
        baseUrl: liveSourceUrl,
        child: null,
        external: true,
      }
    : await startPlaygroundServer(
      'remote-base',
      remoteBaseFixturePath,
    );
try {
  if (packagedSourceFixture) {
    const packagedRuntimeSource = bindPackagedProductionPluginRuntimeSource({
      sourceUrl: liveSourceUrl,
      authSessionSourceCommand,
      authSessionSource,
      username,
      applicationPassword,
      runtimeSourceUrl: remoteServer.baseUrl,
    });
    liveSourceUrl = packagedRuntimeSource.sourceUrl;
    authSessionSourceCommand = packagedRuntimeSource.authSessionSourceCommand;
    authSessionSource = packagedRuntimeSource.authSessionSource;
  }

  if (!liveSourceUrl) {
    liveSourceUrl = remoteServer.baseUrl;
  }

  const checkedTopology = resolveCheckedReleaseTopology({
    remoteBaseUrl: remoteServer.baseUrl,
    explicitSourceUrl: explicitReleaseVerifySourceUrl,
    explicitRemoteChangedUrl: explicitReleaseVerifyRemoteChangedUrl,
    explicitLocalUrl: explicitReleaseVerifyLocalUrl,
    packagedBoundaryRequested: packagedSourceFixture !== null,
  });
  const localEditedSnapshot = withoutUnmappedGraphPostmeta(
    explicitReleaseVerifyLocalUrl
      ? await exportSnapshot('local-edited', explicitReleaseVerifyLocalUrl)
      : exportSnapshotFromBlueprint('local-edited', localEditedFixturePath),
  );
  const remoteChangedSnapshot = explicitReleaseVerifyRemoteChangedUrl
    ? await exportSnapshot('remote-changed', explicitReleaseVerifyRemoteChangedUrl)
    : exportSnapshotFromBlueprint('remote-changed', remoteChangedFixturePath);
  const checkedLiveRetryProofRequested = packagedSourceFixture !== null
    || Boolean(explicitReleaseVerifyRemoteChangedUrl || explicitReleaseVerifyLocalUrl);
  try {
      const client = authenticatedHttpClient({
        sourceUrl: liveSourceUrl,
        credential: {
          username,
          password: applicationPassword,
        },
        routeProfile: 'production-shaped',
      });

      const preflight = await client.signedGet('/preflight', { retryable: true });
      const checkedPreflightLifecycle = evaluateProductionAuthSessionLifecycle(preflight.body?.auth?.session);
      assert.equal(preflight.status, 200, `production-shaped release verify preflight HTTP ${preflight.status}`);
      assert.equal(preflight.body.ok, true);

      const remoteBaseSnapshot = shouldUseProductionSnapshotExport({
        packagedBoundaryRequested: packagedSourceFixture !== null,
        explicitSourceUrl: explicitReleaseVerifySourceUrl,
      })
        ? await exportProductionSnapshot('remote-base', liveSourceUrl)
        : await exportSnapshot('remote-base', liveSourceUrl);
      const proof = await runAuthenticatedHttpPush({
        sourceUrl: liveSourceUrl,
        base: remoteBaseSnapshot,
        local: localEditedSnapshot,
        username,
        applicationPassword,
        idempotencyKey: 'production-shaped-release-verify-001',
        routeProfile: 'production-shaped',
        dryRunOnly: false,
        requireProductionAuthSession: true,
        simulateStaleClaimRetry: checkedLiveRetryProofRequested,
        // Require preserved-read retry proof on the checked verifier path and
        // allow focused tests to fail closed against a mismatched path.
        simulatePreservedRemoteRetryPath: requiredPreservedRemoteRetryPath,
        proveDurableJournalBoundary: true,
        authSessionSource,
        requestTimeoutMs: authenticatedRequestTimeoutMs,
        labDriftAfterSnapshot,
        labAuthSessionDrift,
        now: new Date('2026-05-25T10:12:00.000Z'),
      });

      if (!proof.ok) {
        const packagedPluginDriverProof = packagedSourceFixture
          ? summarizePackagedPluginDriverProof()
          : null;
        const productionPluginDriverProof = summarizeProductionPluginDriverBoundaryProof({
          proof,
          remoteBaseSnapshot,
          localEditedSnapshot,
          remoteChangedSnapshot,
          packagedSourceFixture: packagedSourceFixture !== null,
        });
        const wpPostmetaReleaseVerifierEvidence = summarizeWpPostmetaReleaseVerifierEvidence({
          proof,
          checkedProductionEvidence: false,
        });
        const wpTermmetaReleaseVerifierEvidence = summarizeWpTermmetaReleaseVerifierEvidence({
          proof,
          checkedProductionEvidence: false,
        });
        const arbitraryPluginFixturePackageReleaseVerifierEvidence =
          summarizeArbitraryPluginFixturePackageReleaseVerifierEvidence({
            packagedPluginDriverProof,
            checkedProductionEvidence: false,
          });
        const pluginDriverProof = {
          productionOwned: productionPluginDriverProof,
          driverApplyValidationHook: summarizeDriverApplyValidationHookReleaseVerifierProof(),
          wpOptionsDriverSemantics: summarizeWpOptionsDriverReleaseVerifierProof(),
          auditEvidenceRedaction: summarizeDriverAuditEvidenceRedactionReleaseVerifierProof(),
          arbitraryPluginFixturePackage: arbitraryPluginFixturePackageReleaseVerifierEvidence,
          coreSemantics: {
            wpPostmeta: wpPostmetaReleaseVerifierEvidence,
            wpTermmeta: wpTermmetaReleaseVerifierEvidence,
          },
          ...(packagedPluginDriverProof ? { packagedGuard: packagedPluginDriverProof } : {}),
        };
        process.stdout.write(
          JSON.stringify(
            {
              ok: false,
              topology: {
                sourceUrl: liveSourceUrl,
                remoteBase: checkedTopology.remoteBase,
                remoteChanged: checkedTopology.remoteChanged,
                localEdited: checkedTopology.localEdited,
              },
              drift: labDriftAfterSnapshot ? {
                mode: labDriftAfterSnapshot,
                sameRemoteIdentity: true,
                changedHash: snapshotHash(
                  explicitReleaseVerifyRemoteChangedUrl
                    ? remoteChangedSnapshot
                    : (proof.remoteSnapshotObject || remoteChangedSnapshot)
                ),
              } : {
                sameRemoteIdentity: true,
              },
              boundary: {
                ...resolveReleaseBoundary(proof),
              },
              protocolExtension,
              preflight: {
                status: preflight.status,
                authSessionType: preflight.body.auth.session.type,
                routeProfile: preflight.body.routeProfile,
                session: {
                  id: preflight.body.session.id,
                  type: preflight.body.session.type,
                },
              },
              releaseProof: {
                ok: false,
                status: proof.dryRun?.status || proof.apply?.status || 1,
                code: proof.code || proof.apply?.body?.code || proof.dryRun?.body?.code || 'APPLY_FAILED',
              },
              plan: proof.plan || null,
              authSessionSource: summarizeAuthSessionSource(authSessionSourceCommand, authSessionSource),
              dryRun: proof.dryRun,
              apply: proof.apply,
              recoveryInspect: proof.recoveryInspect,
              replay: proof.replay,
              replayEquivalence: proof.replayEquivalence,
              after: proof.after,
              dbJournal: proof.dbJournal,
              preservedRemoteRetry: proof.preservedRemoteRetry || null,
              readRetryEvidence: proof.readRetryEvidence || null,
              latestReadRetryEvidence: proof.latestReadRetryEvidence || null,
              pluginDriver: pluginDriverProof,
            },
            null,
            2,
          ),
        );
        process.stdout.write('\n');
        throw new ProofFailure();
      }

      if (requireProductionAuthSession && !checkedPreflightLifecycle.ok) {
        process.stdout.write(
          JSON.stringify(
            {
              ok: false,
              topology: {
                sourceUrl: liveSourceUrl,
                remoteBase: checkedTopology.remoteBase,
                remoteChanged: null,
                localEdited: checkedTopology.localEdited,
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
                  required: checkedPreflightLifecycle.required,
                  observed: checkedPreflightLifecycle.observed,
                  verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
                },
                liveAuthSessionSource: {
                  ...liveAuthSessionSourceBlocker,
                  observed: checkedPreflightLifecycle.observed,
                },
              },
              protocolExtension,
              preflight: {
                status: preflight.status,
                authSessionType: preflight.body.auth.session.type,
                routeProfile: preflight.body.routeProfile,
                session: {
                  id: preflight.body.session.id,
                  type: preflight.body.session.type,
                },
              },
              releaseProof: {
                ok: false,
                status: 409,
                code: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
              },
              authSessionSource: summarizeAuthSessionSource(authSessionSourceCommand, authSessionSource),
              dryRun: proof.dryRun,
              apply: proof.apply,
              recoveryInspect: proof.recoveryInspect,
              replay: proof.replay,
              replayEquivalence: proof.replayEquivalence,
              authSessionLifecycle: proof.authSessionLifecycle,
              authSessionLifecycleTrace: proof.authSessionLifecycleTrace,
              after: proof.after,
              dbJournal: proof.dbJournal,
            },
            null,
            2,
          ),
        );
        process.stdout.write('\n');
        throw new ProofFailure();
      }

      assert.equal(proof.ok, true, JSON.stringify(proof, null, 2));
      assert.equal(proof.preflight.status, 200);
      assert.equal(
        preflight.body.auth.session.type,
        packagedSourceFixture || explicitReleaseVerifySourceUrl
          ? 'production-auth-session'
          : 'application-password-basic',
      );
      if (packagedSourceFixture) {
        assert.equal(preflight.body.auth.session.status, 'active');
        assert.equal(checkedPreflightLifecycle.ok, true);
        assert.match(preflight.body.auth.session.expiresAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      }
      assert.equal(
        preflight.body.session.type,
        packagedSourceFixture || explicitReleaseVerifySourceUrl
          ? 'production-auth-session'
          : 'lab-signed-push-session',
      );
      assert.match(preflight.body.session.id, /^[A-Za-z0-9_-]{32,160}$/);
      assert.equal(proof.dryRun.status, 200);
      assert.equal(proof.apply.status, 200);
      assert.equal(
        proof.apply.applyRevalidation?.required,
        'fresh-live-hashes-before-first-mutation',
        'apply must prove fresh live hashes before the first mutation',
      );
      assert.equal(proof.apply.applyRevalidation?.phase, 'before-first-mutation');
      assert.equal(proof.apply.applyRevalidation?.checkedAgainst, 'live-remote');
      assert.equal(proof.apply.applyRevalidation?.planHash, digest(proof.planObject));
      assert.equal(proof.apply.applyRevalidation?.receiptHash, proof.dryRun.receiptHash);
      assert.equal(proof.apply.applyRevalidation?.verifiedCount, proof.planObject.mutations.length);
      assert.deepEqual(
        proof.apply.applyRevalidation?.verifiedResourceKeys,
        proof.planObject.mutations.map((mutation) => mutation.resourceKey),
      );
      assert.ok(
        Number.isInteger(proof.apply.applyRevalidation?.claim?.activeClaimSequence)
          && proof.apply.applyRevalidation.claim.activeClaimSequence > 0,
        'apply revalidation must bind to an active durable claim before mutation',
      );
      assert.equal(proof.recoveryInspect.status, 200);
      assert.equal(proof.replay.status, 200);
      assert.equal(proof.replay.ok, true);
      assert.equal(proof.replay.idempotency?.replayed, true);
      assert.equal(proof.replay.idempotency?.freshMutationWork, false);
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

      const recoveryInspectJournal = proof.recoveryInspect?.recovery?.journal || null;
      const recoveryInspectJournalAccepted = checkedDurableJournalBoundarySatisfied(recoveryInspectJournal);
      const liveDbJournalAccepted = checkedDurableJournalBoundarySatisfied(proof.dbJournal);
      const durableJournalSummary = recoveryInspectJournalAccepted
          ? {
              journal: recoveryInspectJournal,
              leaseFence: {
                ...(recoveryInspectJournal.leaseFence || {}),
                storageGuard: recoveryInspectJournal.leaseFence?.boundary || null,
                fsyncEvidence: recoveryInspectJournal.leaseFence?.fsyncEvidence === true,
                staleClaimRejected: recoveryInspectJournal.leaseFence?.staleClaimRejected === true,
              },
              consumed: true,
              productionOwnedBySource: true,
            }
          : liveDbJournalAccepted
            ? {
                journal: proof.dbJournal,
                leaseFence: {
                  ...(proof.dbJournal.leaseFence || {}),
                  storageGuard: proof.dbJournal.leaseFence?.boundary || null,
                  fsyncEvidence: proof.dbJournal.leaseFence?.fsyncEvidence === true,
                  staleClaimRejected: proof.dbJournal.leaseFence?.staleClaimRejected === true,
                },
                consumed: true,
                productionOwnedBySource: false,
              }
          : runProductionRecoveryJournalProof({
            plan: proof.planObject,
            current: proof.remoteSnapshotObject,
            artifactRefs: {
              releaseVerifier: 'scripts/playground/production-shaped-release-verify.mjs',
            },
          });

      if (liveDbJournalAccepted) {
        assert.equal(
          durableJournalSummary.journal?.ownership?.productionAdapter,
          'wpdb-single-statement-cas',
          'live db journal must expose the production-owned journal adapter',
        );
        assert.equal(durableJournalSummary.journal?.ownership?.ownsJournal, true);
        assert.equal(durableJournalSummary.journal?.ownership?.restartReadable, true);
        assert.equal(durableJournalSummary.journal?.writerLease?.strategy, 'claim-fenced-single-writer');
        assert.equal(durableJournalSummary.journal?.writerLease?.fsyncEvidence, true);
        assert.equal(durableJournalSummary.journal?.writerLease?.storageGuard, 'wpdb-single-statement-cas');
        assert.equal(durableJournalSummary.journal?.storageGuard?.boundary, 'wpdb-single-statement-cas');
        assert.equal(durableJournalSummary.journal?.storageGuard?.operation, 'update');
        assert.equal(durableJournalSummary.journal?.storageGuard?.outcome, 'applied');
        assert.equal(durableJournalSummary.leaseFence?.boundary, 'wpdb-single-statement-cas');
        assert.equal(durableJournalSummary.leaseFence?.fsyncEvidence, true);
        assert.equal(durableJournalSummary.leaseFence?.claimKeyUnique, true);
        assert.equal(durableJournalSummary.leaseFence?.monotonicSequence, true);
        assert.equal(durableJournalSummary.leaseFence?.restartReadable, true);
        assert.equal(durableJournalSummary.leaseFence?.staleClaimRejected, true);
      } else if (recoveryInspectJournalAccepted) {
        assert.equal(
          durableJournalSummary.journal?.ownership?.productionAdapter,
          'wpdb-single-statement-cas',
          'live recovery inspect must expose the production-owned journal adapter',
        );
        assert.equal(durableJournalSummary.journal?.ownership?.ownsJournal, true);
        assert.equal(durableJournalSummary.journal?.ownership?.restartReadable, true);
        assert.equal(durableJournalSummary.journal?.writerLease?.strategy, 'claim-fenced-single-writer');
        assert.equal(durableJournalSummary.journal?.writerLease?.fsyncEvidence, true);
        assert.equal(durableJournalSummary.journal?.writerLease?.storageGuard, 'wpdb-single-statement-cas');
        assert.equal(durableJournalSummary.leaseFence?.boundary, 'wpdb-single-statement-cas');
        assert.equal(durableJournalSummary.leaseFence?.fsyncEvidence, true);
        assert.equal(durableJournalSummary.leaseFence?.claimKeyUnique, true);
        assert.equal(durableJournalSummary.leaseFence?.monotonicSequence, true);
        assert.equal(durableJournalSummary.leaseFence?.restartReadable, true);
        assert.equal(durableJournalSummary.leaseFence?.staleClaimRejected, true);
      } else {
        assert.ok(Array.isArray(durableJournalSummary.journal?.checked), 'production recovery journal proof must report checked journal files');
        assert.ok(
          durableJournalSummary.journal.checked.length > 0,
          'production recovery journal proof must check at least one persistent journal file',
        );
        assert.equal(
          durableJournalSummary.leaseFence?.storageGuard,
          'filesystem-compare-rename',
          'production recovery journal proof must report the storage guard used for lease fencing',
        );
        assert.equal(durableJournalSummary.leaseFence?.fsyncEvidence, true);
        assert.equal(durableJournalSummary.leaseFence?.monotonicSequence, true);
      }
      const packagedPluginDriverProof = packagedSourceFixture
        ? summarizePackagedPluginDriverProof()
        : null;
      const productionPluginDriverProof = summarizeProductionPluginDriverBoundaryProof({
        proof,
        remoteBaseSnapshot,
        localEditedSnapshot,
        remoteChangedSnapshot,
        packagedSourceFixture: packagedSourceFixture !== null,
      });
      const checkedDurableJournalAccepted = packagedSourceFixture !== null
        ? checkedDurableJournalBoundarySatisfied(proof.dbJournal) || recoveryInspectJournalAccepted
        : liveDbJournalAccepted || recoveryInspectJournalAccepted;
      const wpPostmetaReleaseVerifierEvidence = summarizeWpPostmetaReleaseVerifierEvidence({
        proof,
        checkedProductionEvidence: packagedSourceFixture === null
          && Boolean(explicitReleaseVerifySourceUrl)
          && checkedDurableJournalAccepted,
      });
      const wpTermmetaReleaseVerifierEvidence = summarizeWpTermmetaReleaseVerifierEvidence({
        proof,
        checkedProductionEvidence: packagedSourceFixture === null
          && Boolean(explicitReleaseVerifySourceUrl)
          && checkedDurableJournalAccepted,
      });
      const arbitraryPluginFixturePackageReleaseVerifierEvidence =
        summarizeArbitraryPluginFixturePackageReleaseVerifierEvidence({
          packagedPluginDriverProof,
          checkedProductionEvidence: packagedSourceFixture === null
            && Boolean(explicitReleaseVerifySourceUrl)
            && checkedDurableJournalAccepted,
        });
      const pluginDriverProof = {
        productionOwned: productionPluginDriverProof,
        driverApplyValidationHook: summarizeDriverApplyValidationHookReleaseVerifierProof(),
        wpOptionsDriverSemantics: summarizeWpOptionsDriverReleaseVerifierProof(),
        auditEvidenceRedaction: summarizeDriverAuditEvidenceRedactionReleaseVerifierProof(),
        arbitraryPluginFixturePackage: arbitraryPluginFixturePackageReleaseVerifierEvidence,
        coreSemantics: {
          wpPostmeta: wpPostmetaReleaseVerifierEvidence,
          wpTermmeta: wpTermmetaReleaseVerifierEvidence,
        },
        ...(packagedPluginDriverProof ? { packagedGuard: packagedPluginDriverProof } : {}),
      };
      const checkedProductionPluginDriverAccepted = packagedSourceFixture !== null
        ? productionPluginDriverProof.verdict === 'PACKAGED_PLUGIN_DRIVER_BOUNDARY_OK'
        : productionPluginDriverProof.verdict === 'LIVE_PLUGIN_DRIVER_BOUNDARY_OK';

      if (requireProductionDurableJournal && !checkedDurableJournalAccepted) {
        process.stdout.write(
          JSON.stringify(
            {
              ok: false,
              topology: {
                sourceUrl: liveSourceUrl,
                remoteBase: checkedTopology.remoteBase,
                remoteChanged: null,
                localEdited: checkedTopology.localEdited,
              },
              boundary: {
                firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
                status: 'unimplemented',
                verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
                durableJournal: {
                  storageLeaseFence: 'retained Playground journal storage is lab-scoped; production ownership, lease fencing, and replay wiring are not yet proven on the checked release boundary',
                  verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
                },
              },
              protocolExtension,
              releaseProof: {
                ok: false,
                status: 501,
                code: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
              },
              authSessionSource: summarizeAuthSessionSource(authSessionSourceCommand, authSessionSource),
              durableJournal: {
                proof: {
                  status: 0,
                  journal: durableJournalSummary.journal,
                  leaseFence: {
                    ...durableJournalSummary.leaseFence,
                    staleClaimRejected: durableJournalSummary.leaseFence?.staleClaimRejected === true,
                  },
                },
                rows: proof.dbJournal.rows,
                applyCommitted: proof.dbJournal.applyCommitted,
                mutationApplied: proof.dbJournal.mutationApplied,
                idempotencyOpened: proof.dbJournal.idempotencyOpened,
                scope: proof.dbJournal.scope || null,
                ownership: proof.dbJournal.ownership || null,
                liveLeaseFence: proof.dbJournal.leaseFence || null,
                checkedAccepted: checkedDurableJournalAccepted,
              },
              authSessionLifecycle: proof.authSessionLifecycle,
              authSessionLifecycleTrace: proof.authSessionLifecycleTrace,
              pluginDriver: pluginDriverProof,
            },
            null,
            2,
          ),
        );
        process.stdout.write('\n');
        throw new ProofFailure();
      }

      const liveDrift = {
        sameRemoteIdentity: true,
        baseHash: snapshotHash(remoteBaseSnapshot),
        changedHash: snapshotHash(
          explicitReleaseVerifyRemoteChangedUrl
            ? remoteChangedSnapshot
            : explicitReleaseVerifySourceUrl && packagedSourceFixture === null
              ? (proof.remoteSnapshotObject || remoteBaseSnapshot)
            : remoteChangedSnapshot
        ),
        changedFixture:
          explicitReleaseVerifyRemoteChangedUrl
            ? (remoteChangedSnapshot.meta?.fixture || null)
            : explicitReleaseVerifySourceUrl && packagedSourceFixture === null
              ? (proof.remoteSnapshotObject?.meta?.fixture || null)
            : remoteChangedSnapshot.meta?.fixture,
      };
      if (productionPluginDriverBlueprints && !checkedProductionPluginDriverAccepted) {
        process.stdout.write(
          JSON.stringify(
            {
              ok: false,
              topology: {
                sourceUrl: liveSourceUrl,
                remoteBase: checkedTopology.remoteBase,
                remoteChanged: checkedTopology.remoteChanged,
                localEdited: checkedTopology.localEdited,
              },
              remoteSnapshotHashes: {
                sameRemoteIdentity: true,
                baseHash: liveDrift.baseHash,
                changedHash: liveDrift.changedHash,
              },
              liveDrift,
              boundary: {
                firstRemainingProductionBoundary: 'plugin-driver ownership on the checked release path',
                status: 'support-only',
                verdict: 'PRODUCTION_PLUGIN_DRIVER_BOUNDARY_REQUIRED',
                pluginDriver: productionPluginDriverProof,
              },
              protocolExtension,
              preflight: {
                status: preflight.status,
                authSessionType: preflight.body.auth.session.type,
                routeProfile: preflight.body.routeProfile,
                session: {
                  id: preflight.body.session.id,
                  type: preflight.body.session.type,
                },
              },
              releaseProof: {
                ok: false,
                status: 409,
                code: 'PRODUCTION_PLUGIN_DRIVER_BOUNDARY_REQUIRED',
                mode: proof.mode,
                retryAttempts: proof.retryAttempts,
              },
              authSessionSource: summarizeAuthSessionSource(authSessionSourceCommand, authSessionSource),
              pluginDriver: pluginDriverProof,
            },
            null,
            2,
          ),
        );
        process.stdout.write('\n');
        throw new ProofFailure();
      }
      const authSessionLifecycleSummary =
        proof.authSessionLifecycleSummary
        || summarizeProductionAuthSessionLifecycleTrace(proof.authSessionLifecycleTrace);
      const checkedAuthSessionLifecycle = evaluateCheckedReleaseAuthSessionLifecycleSummary(authSessionLifecycleSummary);
      const authSessionBoundary = resolveAuthSessionBoundaryProof({
        liveSourceUrlEnv: explicitReleaseVerifySourceUrl,
        effectiveSourceUrl: liveSourceUrl,
        authSessionSourceCommand,
        authSessionSource,
        authSessionLifecycleSummary,
        packagedSourceFixture: packagedSourceFixture !== null,
      });
      if (!checkedAuthSessionLifecycle.ok) {
        process.stdout.write(
          JSON.stringify(
            {
              ok: false,
              topology: {
                sourceUrl: liveSourceUrl,
                remoteBase: checkedTopology.remoteBase,
                remoteChanged: checkedTopology.remoteChanged,
                localEdited: checkedTopology.localEdited,
              },
              remoteSnapshotHashes: {
                sameRemoteIdentity: true,
                baseHash: liveDrift.baseHash,
                changedHash: liveDrift.changedHash,
              },
              drift: labDriftAfterSnapshot ? {
                mode: labDriftAfterSnapshot,
                sameRemoteIdentity: true,
                changedHash: liveDrift.changedHash,
              } : {
                sameRemoteIdentity: true,
              },
              liveDrift,
              boundary: {
                firstRemainingProductionBoundary: 'auth/session lifecycle on the checked live release path',
                status: 'unimplemented',
                verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
                authSession: {
                  required: checkedAuthSessionLifecycle.required,
                  observed: checkedAuthSessionLifecycle.observed,
                  verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
                },
                durableJournal: {
                  storageLeaseFence: 'production durable journal storage, lease, and fencing are not yet proven beyond the retained Playground journal path',
                  verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
                },
              },
              protocolExtension,
              preflight: {
                status: preflight.status,
                authSessionType: preflight.body.auth.session.type,
                routeProfile: preflight.body.routeProfile,
                session: {
                  id: preflight.body.session.id,
                  type: preflight.body.session.type,
                },
              },
              releaseProof: {
                ok: false,
                status: 409,
                code: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
                mode: proof.mode,
                retryAttempts: proof.retryAttempts,
              },
              authSessionSource: summarizeAuthSessionSource(authSessionSourceCommand, authSessionSource),
              authSessionBoundary,
              authSessionLifecycle: proof.authSessionLifecycle,
              authSessionLifecycleTrace: proof.authSessionLifecycleTrace,
              authSessionLifecycleSummary,
              replayEquivalence: proof.replayEquivalence,
              durableJournal: {
                proof: {
                  status: 0,
                  journal: durableJournalSummary.journal,
                  leaseFence: {
                    ...durableJournalSummary.leaseFence,
                    staleClaimRejected: durableJournalSummary.leaseFence?.staleClaimRejected === true,
                  },
                },
                rows: proof.dbJournal.rows,
                applyCommitted: proof.dbJournal.applyCommitted,
                mutationApplied: proof.dbJournal.mutationApplied,
                idempotencyOpened: proof.dbJournal.idempotencyOpened,
                scope: proof.dbJournal.scope || null,
                ownership: proof.dbJournal.ownership || null,
                liveLeaseFence: proof.dbJournal.leaseFence || null,
                checkedAccepted: checkedDurableJournalAccepted,
              },
              ...(packagedPluginDriverProof ? { pluginDriver: packagedPluginDriverProof } : {}),
            },
            null,
            2,
          ),
        );
        process.stdout.write('\n');
        throw new ProofFailure();
      }

      if (
        requireProductionAuthSession
        && explicitReleaseVerifySourceUrl
        && packagedSourceFixture === null
        && authSessionBoundary.verdict !== 'AUTH_SESSION_BOUNDARY_OK'
      ) {
        process.stdout.write(
          JSON.stringify(
            {
              ok: false,
              topology: {
                sourceUrl: liveSourceUrl,
                liveSourceUrlEnv: explicitReleaseVerifySourceUrl,
                remoteBase: checkedTopology.remoteBase,
                remoteChanged: checkedTopology.remoteChanged,
                localEdited: checkedTopology.localEdited,
              },
              remoteSnapshotHashes: {
                sameRemoteIdentity: true,
                baseHash: liveDrift.baseHash,
                changedHash: liveDrift.changedHash,
              },
              drift: labDriftAfterSnapshot ? {
                mode: labDriftAfterSnapshot,
                sameRemoteIdentity: true,
                changedHash: liveDrift.changedHash,
              } : {
                sameRemoteIdentity: true,
              },
              liveDrift,
              boundary: {
                firstRemainingProductionBoundary: 'auth/session source and identity continuity on the checked live release path',
                status: 'unimplemented',
                verdict: 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED',
                authSession: {
                  required: authSessionBoundary.required,
                  observed: authSessionBoundary.verdict,
                  verdict: 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED',
                },
                durableJournal: {
                  storageLeaseFence: 'production durable journal storage, lease, and fencing are not yet proven beyond the retained Playground journal path',
                  verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
                },
              },
              protocolExtension,
              preflight: {
                status: preflight.status,
                authSessionType: preflight.body.auth.session.type,
                routeProfile: preflight.body.routeProfile,
                session: {
                  id: preflight.body.session.id,
                  type: preflight.body.session.type,
                },
              },
              releaseProof: {
                ok: false,
                status: 409,
                code: 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED',
                mode: proof.mode,
                retryAttempts: proof.retryAttempts,
              },
              authSessionSource: summarizeAuthSessionSource(authSessionSourceCommand, authSessionSource),
              authSessionBoundary,
              authSessionLifecycle: proof.authSessionLifecycle,
              authSessionLifecycleTrace: proof.authSessionLifecycleTrace,
              authSessionLifecycleSummary,
              replayEquivalence: proof.replayEquivalence,
              durableJournal: {
                proof: {
                  status: 0,
                  journal: durableJournalSummary.journal,
                  leaseFence: {
                    ...durableJournalSummary.leaseFence,
                    staleClaimRejected: durableJournalSummary.leaseFence?.staleClaimRejected === true,
                  },
                },
                rows: proof.dbJournal.rows,
                applyCommitted: proof.dbJournal.applyCommitted,
                mutationApplied: proof.dbJournal.mutationApplied,
                idempotencyOpened: proof.dbJournal.idempotencyOpened,
                scope: proof.dbJournal.scope || null,
                ownership: proof.dbJournal.ownership || null,
                liveLeaseFence: proof.dbJournal.leaseFence || null,
                checkedAccepted: checkedDurableJournalAccepted,
              },
              pluginDriver: pluginDriverProof,
            },
            null,
            2,
          ),
        );
        process.stdout.write('\n');
        throw new ProofFailure();
      }

      if (!checkedDurableJournalAccepted) {
        process.stdout.write(
          JSON.stringify(
            {
              ok: false,
              topology: {
                sourceUrl: liveSourceUrl,
                remoteBase: checkedTopology.remoteBase,
                remoteChanged: checkedTopology.remoteChanged,
                localEdited: checkedTopology.localEdited,
              },
              remoteSnapshotHashes: {
                sameRemoteIdentity: true,
                baseHash: liveDrift.baseHash,
                changedHash: liveDrift.changedHash,
              },
              drift: labDriftAfterSnapshot ? {
                mode: labDriftAfterSnapshot,
                sameRemoteIdentity: true,
                changedHash: liveDrift.changedHash,
              } : {
                sameRemoteIdentity: true,
              },
              liveDrift,
              boundary: {
                firstRemainingProductionBoundary: 'durable journal semantics on the checked live release path',
                status: 'unimplemented',
                verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
                authSession: {
                  required: checkedAuthSessionLifecycle.required,
                  observed: checkedAuthSessionLifecycle.observed,
                  verdict: packagedSourceFixture
                    ? 'PACKAGED_RELEASE_BOUNDARY_OK'
                    : 'PRODUCTION_AUTH_SESSION_LIFECYCLE_PROVEN',
                },
                durableJournal: {
                  storageLeaseFence: 'live production-shaped auth/session is proven, but the live db-journal boundary is still missing production-owned durable journal storage, lease fencing, restart-readable artifacts, or stale-claim rejection on the checked release path',
                  verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
                },
              },
              protocolExtension,
              preflight: {
                status: preflight.status,
                authSessionType: preflight.body.auth.session.type,
                routeProfile: preflight.body.routeProfile,
                session: {
                  id: preflight.body.session.id,
                  type: preflight.body.session.type,
                },
              },
              releaseProof: {
                ok: false,
                status: 501,
                code: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
                mode: proof.mode,
                retryAttempts: proof.retryAttempts,
              },
              authSessionSource: summarizeAuthSessionSource(authSessionSourceCommand, authSessionSource),
              authSessionBoundary,
              authSessionLifecycle: proof.authSessionLifecycle,
              authSessionLifecycleTrace: proof.authSessionLifecycleTrace,
              authSessionLifecycleSummary,
              replayEquivalence: proof.replayEquivalence,
              durableJournal: {
                proof: {
                  status: 0,
                  journal: durableJournalSummary.journal,
                  leaseFence: {
                    ...durableJournalSummary.leaseFence,
                    staleClaimRejected: durableJournalSummary.leaseFence?.staleClaimRejected === true,
                  },
                },
                rows: proof.dbJournal.rows,
                applyCommitted: proof.dbJournal.applyCommitted,
                mutationApplied: proof.dbJournal.mutationApplied,
                idempotencyOpened: proof.dbJournal.idempotencyOpened,
                scope: proof.dbJournal.scope || null,
                ownership: proof.dbJournal.ownership || null,
                liveLeaseFence: proof.dbJournal.leaseFence || null,
                checkedAccepted: checkedDurableJournalAccepted,
              },
              pluginDriver: pluginDriverProof,
            },
            null,
            2,
          ),
        );
        process.stdout.write('\n');
        throw new ProofFailure();
      }

      const checkedReplayEquivalence = proof.replayEquivalence?.equivalent === true;
      const checkedPreservedRemoteRetry = requiredPreservedRemoteRetryPath
        ? proof.replayAndRetry?.verdict === 'PRESERVED_REMOTE_RETRY_PROVEN'
        : true;

      if (!checkedReplayEquivalence || !checkedPreservedRemoteRetry) {
        process.stdout.write(
          JSON.stringify(
            {
              ok: false,
              topology: {
                sourceUrl: liveSourceUrl,
                remoteBase: checkedTopology.remoteBase,
                remoteChanged: checkedTopology.remoteChanged,
                localEdited: checkedTopology.localEdited,
              },
              remoteSnapshotHashes: {
                sameRemoteIdentity: true,
                baseHash: liveDrift.baseHash,
                changedHash: liveDrift.changedHash,
              },
              drift: labDriftAfterSnapshot ? {
                mode: labDriftAfterSnapshot,
                sameRemoteIdentity: true,
                changedHash: liveDrift.changedHash,
              } : {
                sameRemoteIdentity: true,
              },
              liveDrift,
              boundary: {
                firstRemainingProductionBoundary: 'replay and preserved-remote retry on the checked live release path',
                status: 'unimplemented',
                verdict: !checkedReplayEquivalence
                  ? 'REPLAY_NOT_EQUIVALENT'
                  : 'PRESERVED_REMOTE_RETRY_REQUIRED',
                authSession: {
                  required: checkedAuthSessionLifecycle.required,
                  observed: checkedAuthSessionLifecycle.observed,
                  verdict: packagedSourceFixture
                    ? 'PACKAGED_RELEASE_BOUNDARY_OK'
                    : 'PRODUCTION_AUTH_SESSION_LIFECYCLE_PROVEN',
                },
                durableJournal: {
                  storageLeaseFence: 'live production-shaped db-journal surface accepted on the checked release boundary',
                  verdict: packagedSourceFixture ? 'PACKAGED_RELEASE_BOUNDARY_OK' : 'LIVE_RELEASE_BOUNDARY_OK',
                },
                replayAndRetry: checkedPreservedRemoteRetry
                  ? {
                      required: requiredPreservedRemoteRetryPath,
                      observed: proof.replayAndRetry?.observed || requiredPreservedRemoteRetryPath,
                      retryAttempts: proof.replayAndRetry?.retryAttempts || proof.retryAttempts || 1,
                      verdict: 'PRESERVED_REMOTE_RETRY_PROVEN',
                    }
                  : {
                      required: requiredPreservedRemoteRetryPath,
                      observed: proof.replayAndRetry?.observed || 'missing-transient-retry',
                      retryAttempts: proof.replayAndRetry?.retryAttempts || proof.retryAttempts || 1,
                      verdict: 'PRESERVED_REMOTE_RETRY_REQUIRED',
                    },
              },
              protocolExtension,
              preflight: {
                status: preflight.status,
                authSessionType: preflight.body.auth.session.type,
                routeProfile: preflight.body.routeProfile,
                session: {
                  id: preflight.body.session.id,
                  type: preflight.body.session.type,
                },
              },
              releaseProof: {
                ok: false,
                status: 409,
                code: !checkedReplayEquivalence ? 'REPLAY_NOT_EQUIVALENT' : 'PRESERVED_REMOTE_RETRY_REQUIRED',
                mode: proof.mode,
                retryAttempts: proof.retryAttempts,
              },
              authSessionSource: summarizeAuthSessionSource(authSessionSourceCommand, authSessionSource),
              authSessionBoundary,
              authSessionLifecycle: proof.authSessionLifecycle,
              authSessionLifecycleTrace: proof.authSessionLifecycleTrace,
              authSessionLifecycleSummary,
              replayEquivalence: proof.replayEquivalence,
              durableJournal: {
                proof: {
                  status: 0,
                  journal: durableJournalSummary.journal,
                  leaseFence: {
                    ...durableJournalSummary.leaseFence,
                    staleClaimRejected: durableJournalSummary.leaseFence?.staleClaimRejected === true,
                  },
                },
                rows: proof.dbJournal.rows,
                applyCommitted: proof.dbJournal.applyCommitted,
                mutationApplied: proof.dbJournal.mutationApplied,
                idempotencyOpened: proof.dbJournal.idempotencyOpened,
                scope: proof.dbJournal.scope || null,
                ownership: proof.dbJournal.ownership || null,
                liveLeaseFence: proof.dbJournal.leaseFence || null,
                checkedAccepted: checkedDurableJournalAccepted,
              },
              replayAndRetry: proof.replayAndRetry || null,
              pluginDriver: pluginDriverProof,
            },
            null,
            2,
          ),
        );
        process.stdout.write('\n');
        throw new ProofFailure();
      }

      const successfulReleaseBoundary = resolveSuccessfulReleaseBoundary({
        packagedSourceFixture: packagedSourceFixture !== null,
        checkedAuthSessionLifecycle,
        checkedDurableJournalAccepted,
        requiredPreservedRemoteRetryPath,
        proof,
      });

      process.stdout.write(
        JSON.stringify(
        {
          ok: true,
          topology: {
            sourceUrl: liveSourceUrl,
            liveSourceUrlEnv: explicitReleaseVerifySourceUrl,
            remoteBase: checkedTopology.remoteBase,
            remoteChanged: checkedTopology.remoteChanged,
            localEdited: checkedTopology.localEdited,
          },
          remoteSnapshotHashes: {
            sameRemoteIdentity: true,
            baseHash: liveDrift.baseHash,
            changedHash: liveDrift.changedHash,
          },
          drift: labDriftAfterSnapshot ? {
            mode: labDriftAfterSnapshot,
            sameRemoteIdentity: true,
            changedHash: liveDrift.changedHash,
          } : {
            sameRemoteIdentity: true,
          },
          liveDrift,
          boundary: successfulReleaseBoundary,
          protocolExtension,
          preflight: {
              status: preflight.status,
              authSessionType: preflight.body.auth.session.type,
              routeProfile: preflight.body.routeProfile,
              session: {
                id: preflight.body.session.id,
                type: preflight.body.session.type,
              },
            },
            releaseProof: proof,
            authSessionSource: summarizeAuthSessionSource(authSessionSourceCommand, authSessionSource),
            authSessionBoundary,
            authSessionLifecycle: proof.authSessionLifecycle,
            authSessionLifecycleTrace: proof.authSessionLifecycleTrace,
            authSessionLifecycleSummary,
            replayEquivalence: proof.replayEquivalence,
            durableJournal: {
              proof: {
                status: 0,
                journal: durableJournalSummary.journal,
                leaseFence: {
                  ...durableJournalSummary.leaseFence,
                  staleClaimRejected: durableJournalSummary.leaseFence?.staleClaimRejected === true,
                },
              },
              rows: proof.dbJournal.rows,
              applyCommitted: proof.dbJournal.applyCommitted,
              mutationApplied: proof.dbJournal.mutationApplied,
              idempotencyOpened: proof.dbJournal.idempotencyOpened,
              scope: proof.dbJournal.scope || null,
              ownership: proof.dbJournal.ownership || null,
              liveLeaseFence: proof.dbJournal.leaseFence || null,
              checkedAccepted: checkedDurableJournalAccepted,
            },
            pluginDriver: pluginDriverProof,
          },
          null,
          2,
        ),
      );
      process.stdout.write('\n');
    } catch (error) {
      process.stdout.write(
        JSON.stringify(
          {
            ok: false,
            topology: {
              sourceUrl: liveSourceUrl,
              remoteBase: checkedTopology.remoteBase,
              remoteChanged: checkedTopology.remoteChanged,
              localEdited: checkedTopology.localEdited,
            },
            drift: labDriftAfterSnapshot
              ? {
                  mode: labDriftAfterSnapshot,
                  sameRemoteIdentity: true,
                  changedHash: snapshotHash(
                    explicitReleaseVerifyRemoteChangedUrl
                      ? remoteChangedSnapshot
                      : (proof.remoteSnapshotObject || remoteChangedSnapshot)
                  ),
                }
              : {
                  sameRemoteIdentity: true,
                },
            boundary: {
              firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
              status: 'unimplemented',
              verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
              durableJournal: {
                storageLeaseFence: 'production durable journal storage, lease, and fencing are not yet proven beyond the retained Playground journal path',
                verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
              },
            },
            protocolExtension,
            preflight: {
              status: 0,
              authSessionType: 'unreachable-live-source',
              routeProfile: 'production-shaped',
              session: {
                id: '',
                type: 'unreachable-live-source',
              },
            },
            releaseProof: {
              ok: false,
              status: 412,
              code: 'PRECONDITION_FAILED',
            },
            authSessionSource: summarizeAuthSessionSource(authSessionSourceCommand, authSessionSource),
            error: error instanceof Error ? error.message : String(error),
            authSessionLifecycle: null,
            authSessionLifecycleTrace: [],
            authSessionLifecycleSummary: null,
          },
          null,
          2,
        ),
      );
      process.stdout.write('\n');
  }
} finally {
  await stopPlaygroundServer(remoteServer);
  if (packagedSourceFixture) {
    packagedSourceFixture.cleanup();
  }
  if (productionPluginDriverBlueprints) {
    productionPluginDriverBlueprints.cleanup();
  }
}

async function startPlaygroundServer(name, blueprintPath) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const port = await findLocalPort();
    const baseUrl = `http://127.0.0.1:${port}`;
    process.stderr.write(`Starting Playground server ${name} at ${baseUrl} from ${path.basename(blueprintPath)} attempt ${attempt}/3\n`);
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
      'npx',
      args,
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          REPRINT_PUSH_LAB_AUTH_BOOTSTRAP: '1',
          REPRINT_PUSH_LAB_AUTH_ADMIN_USER: fixtureCredentials.username,
          REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: fixtureCredentials.password,
          NODE_OPTIONS: appendNodeOption(process.env.NODE_OPTIONS, localhostListenPreloadOption()),
        },
        detached: true,
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
      process.stderr.write(`Playground server ${name} is ready at ${baseUrl}\n`);
      return { name, baseUrl, child };
    } catch (error) {
      const logs = `${output}\n${error instanceof Error ? error.message : String(error)}`;
      process.stderr.write(`Playground server ${name} failed to become ready at ${baseUrl}\n`);
      process.stderr.write(`${logs.trimEnd()}\n`);
      await stopSpawnedServer(child);
      if (!/EADDRINUSE/i.test(logs) || attempt === 3) {
        throw error;
      }
    } finally {
      activePlaygroundChildren.delete(child);
    }
  }

  throw new Error(`Unable to start Playground server for ${name} after retrying port collisions`);
}

async function stopPlaygroundServer(server) {
  if (!server?.child) {
    return;
  }
  if (server.child.exitCode !== null) {
    return;
  }
  await stopSpawnedServer(server.child);
}

async function startPackagedProductionPluginServer(name, packagedFixture) {
  const port = await findLocalPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  process.stderr.write(`Starting Playground server ${name} at ${baseUrl} from ${path.basename(packagedFixture.blueprintPath)}\n`);
  const args = [
    '--yes',
    '@wp-playground/cli@latest',
    'server',
    '--blueprint',
    packagedFixture.blueprintPath,
    '--mount',
    `${packagedFixture.pluginDir}:/wordpress/wp-content/plugins/reprint-push`,
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
    'npx',
    args,
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        REPRINT_PUSH_LAB_AUTH_BOOTSTRAP: '1',
        REPRINT_PUSH_LAB_AUTH_ADMIN_USER: fixtureCredentials.username,
        REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: fixtureCredentials.password,
        NODE_OPTIONS: appendNodeOption(process.env.NODE_OPTIONS, localhostListenPreloadOption()),
      },
      detached: true,
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
    await waitForPackagedProductionPluginServer(child, baseUrl, () => output);
    process.stderr.write(`Playground server ${name} is ready at ${baseUrl}\n`);
    return { name, baseUrl, child };
  } catch (error) {
    const logs = `${output}\n${error instanceof Error ? error.message : String(error)}`;
    process.stderr.write(`Playground server ${name} failed to become ready at ${baseUrl}\n`);
    process.stderr.write(`${logs.trimEnd()}\n`);
    await stopSpawnedServer(child);
    throw error;
  } finally {
    activePlaygroundChildren.delete(child);
  }
}

async function waitForPackagedProductionPluginServer(child, baseUrl, getOutput) {
  const deadline = Date.now() + packagedServerStartupTimeoutMs;
  let lastError = null;
  const lastProbes = [];
  let timeoutProbeCount = 0;
  let routeNotReadyProbeCounts = {
    snapshot: 0,
    preflight: 0,
  };
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      const message = formatPlaygroundStartupFailure(
        `Packaged Playground server exited early with ${child.exitCode}`,
        lastError,
        lastProbes,
        getOutput(),
        { childPid: child.pid ?? null, packagedProductionPlugin: true },
      );
      writePlaygroundFailure(message, lastProbes, getOutput(), lastError);
      await stopSpawnedServer(child);
      throw new Error(message);
    }
    try {
      let restIndexDeferredFailure = null;
      try {
        const index = await fetchWithTimeout(`${baseUrl}/wp-json/`, {
          headers: {
            connection: 'close',
          },
        }, packagedServerFetchTimeoutMs);
        timeoutProbeCount = 0;
        const indexText = await index.text();
        const indexPreview = indexText.slice(0, readinessFailureBodyLimit);
        lastProbes.push({
          route: '/wp-json/',
          status: index.status,
          ok: index.ok,
          body: indexPreview,
        });
        let indexBody = null;
        try {
          indexBody = JSON.parse(indexText);
        } catch (error) {
          if (isWordPressNotReadyResponse(index.status, indexText)) {
            restIndexDeferredFailure = new Error(`Production plugin package REST index readiness HTTP ${index.status}`);
            indexBody = null;
          } else {
            throw error;
          }
        }
        if (
          !packagedProductionPluginRestIndexReady({
            status: index.status,
            body: indexBody,
          })
        ) {
          const indexFailure = new Error(`Production plugin package REST index readiness HTTP ${index.status}`);
          if (
            packagedProductionPluginRestIndexRetryable({
              status: index.status,
              body: indexBody,
            })
            || packagedProductionPluginReadinessBodyRetryable(index.status, indexText)
          ) {
            // Treat the core REST index as advisory during packaged startup:
            // the production push routes can become ready before /wp-json/
            // stops returning transient not-ready bodies.
            restIndexDeferredFailure = indexFailure;
          } else {
            throw indexFailure;
          }
        }
      } catch (error) {
        if (!packagedProductionPluginReadinessErrorRetryable(error)) {
          throw error;
        }
        timeoutProbeCount = packagedProductionPluginNextTimeoutProbeCount(timeoutProbeCount, error);
        restIndexDeferredFailure = error;
      }
      if (restIndexDeferredFailure) {
        lastError = restIndexDeferredFailure;
      }
      const snapshot = await fetchWithTimeout(`${baseUrl}/wp-json/reprint/v1/push/snapshot`, {
        headers: {
          ...authHeaders(),
          connection: 'close',
        },
      }, packagedServerFetchTimeoutMs);
      const snapshotText = await snapshot.text();
      timeoutProbeCount = 0;
      const snapshotPreview = snapshotText.slice(0, readinessFailureBodyLimit);
      lastProbes.push({
        route: '/wp-json/reprint/v1/push/snapshot',
        status: snapshot.status,
        ok: snapshot.ok,
        body: snapshotPreview,
      });
      routeNotReadyProbeCounts = packagedProductionPluginNextRouteNotReadyProbeCounts(
        routeNotReadyProbeCounts,
        'snapshot',
        snapshot.status,
        snapshotText,
      );
      let snapshotBody = null;
      try {
        snapshotBody = JSON.parse(snapshotText);
      } catch (error) {
        if (isWordPressNotReadyResponse(snapshot.status, snapshotText)) {
          lastError = new Error(`Production plugin package snapshot readiness HTTP ${snapshot.status}`);
          await sleep(readinessProbeIntervalMs);
          continue;
        }
        throw error;
      }
      routeNotReadyProbeCounts = packagedProductionPluginResetRouteNotReadyProbeCounts(
        routeNotReadyProbeCounts,
        'snapshot',
      );
      if (!packagedProductionPluginServerReady({
        snapshot: {
          status: snapshot.status,
          body: snapshotBody,
        },
      })) {
        lastError = new Error(`Production plugin package snapshot readiness HTTP ${snapshot.status}`);
        if (packagedProductionPluginSnapshotRetryable({
          status: snapshot.status,
          body: snapshotBody,
        }) || isWordPressNotReadyResponse(snapshot.status, snapshotText)) {
          await sleep(readinessProbeIntervalMs);
          continue;
        }
        throw lastError;
      }

      const preflight = await fetchWithTimeout(`${baseUrl}/wp-json/reprint/v1/push/preflight`, {
        method: 'GET',
        headers: signedHeadersForProductionPreflight(),
      }, packagedServerFetchTimeoutMs);
      const preflightText = await preflight.text();
      timeoutProbeCount = 0;
      const preview = preflightText.slice(0, readinessFailureBodyLimit);
      lastProbes.push({
        route: '/wp-json/reprint/v1/push/preflight',
        status: preflight.status,
        ok: preflight.ok,
        body: preview,
      });
      routeNotReadyProbeCounts = packagedProductionPluginNextRouteNotReadyProbeCounts(
        routeNotReadyProbeCounts,
        'preflight',
        preflight.status,
        preflightText,
      );
      let preflightBody = null;
      try {
        preflightBody = JSON.parse(preflightText);
      } catch (error) {
        if (isWordPressNotReadyResponse(preflight.status, preflightText)) {
          lastError = new Error(`Production plugin package preflight readiness HTTP ${preflight.status}`);
          await sleep(readinessProbeIntervalMs);
          continue;
        }
        throw error;
      }
      if (packagedProductionPluginPreflightReady({
        status: preflight.status,
        body: preflightBody,
      })) {
        return;
      }
      lastError = new Error(`Production plugin package preflight readiness HTTP ${preflight.status}`);
      if (packagedProductionPluginPreflightRetryable({
        status: preflight.status,
        body: preflightBody,
      })) {
        routeNotReadyProbeCounts = packagedProductionPluginResetRouteNotReadyProbeCounts(
          routeNotReadyProbeCounts,
          'snapshot',
        );
        await sleep(readinessProbeIntervalMs);
        continue;
      }
      throw lastError;
    } catch (error) {
      if (packagedProductionPluginReadinessProbeTimedOut(error)) {
        const { preflightProbe, indexProbe } = await fetchPackagedTimeoutFallbackProbes(baseUrl);
        if (preflightProbe) {
          lastProbes.push(preflightProbe);
          if (preflightProbe.ready) {
            return;
          }
          if (preflightProbe.retryable) {
            lastError = error;
            timeoutProbeCount = 0;
            await sleep(readinessProbeIntervalMs);
            continue;
          }
          if (preflightProbe.terminal) {
            lastError = error;
            await throwPlaygroundReadinessFailure(
              child,
              `Packaged production plugin preflight became terminal while the snapshot probe timed out at ${baseUrl}`,
              lastError,
              lastProbes,
              getOutput(),
              {
                childPid: child.pid ?? null,
                packagedProductionPlugin: true,
              },
            );
          }
        }
        if (indexProbe) {
          lastProbes.push(indexProbe);
        }
        if (packagedProductionPluginReadinessBodyRetryable(indexProbe?.status, indexProbe?.body || '')) {
          lastError = error;
          timeoutProbeCount = 0;
          await sleep(readinessProbeIntervalMs);
          continue;
        }
      }
      lastError = error;
      timeoutProbeCount = packagedProductionPluginNextTimeoutProbeCount(timeoutProbeCount, error);
      if (packagedProductionPluginNotReadyProbeLimitReached(timeoutProbeCount)) {
        break;
      }
      if (!packagedProductionPluginReadinessErrorRetryable(error)) {
        break;
      }
    }
    await sleep(readinessProbeIntervalMs);
  }
  await throwPlaygroundReadinessFailure(
    child,
    `Timed out waiting for packaged Playground server at ${baseUrl}`,
    lastError,
    lastProbes,
    getOutput(),
    {
      childPid: child.pid ?? null,
      packagedProductionPlugin: true,
    },
  );
}

async function fetchPackagedWordPressIndexProbe(baseUrl) {
  const response = await fetchWithTimeout(`${baseUrl}/wp-json/`, {
    headers: { connection: 'close' },
  }, packagedServerFetchTimeoutMs);
  const bodyText = await response.text();
  return {
    route: '/wp-json/',
    status: response.status,
    ok: response.ok,
    body: bodyText.slice(0, readinessFailureBodyLimit),
  };
}

async function fetchPackagedPreflightProbe(baseUrl) {
  const response = await fetchWithTimeout(`${baseUrl}/wp-json/reprint/v1/push/preflight`, {
    method: 'GET',
    headers: {
      connection: 'close',
      ...signedHeadersForProductionPreflight(),
    },
  }, packagedServerFetchTimeoutMs);
  const bodyText = await response.text();

  let body = null;
  try {
    body = JSON.parse(bodyText);
  } catch {}

  const probe = {
    route: '/wp-json/reprint/v1/push/preflight',
    status: response.status,
    ok: response.ok,
    body: bodyText.slice(0, readinessFailureBodyLimit),
    ready: false,
    retryable: false,
    terminal: false,
  };

  if (body !== null) {
    probe.ready = packagedProductionPluginPreflightReady({ status: response.status, body });
    probe.retryable = packagedProductionPluginPreflightRetryable({ status: response.status, body });
    probe.terminal = !probe.ready && !probe.retryable;
    return probe;
  }

  probe.retryable = packagedProductionPluginReadinessBodyRetryable(response.status, bodyText);
  probe.terminal = !probe.retryable;
  return probe;
}

async function fetchPackagedTimeoutFallbackProbes(baseUrl) {
  const preflightProbe = await fetchPackagedPreflightProbe(baseUrl).catch((error) =>
    buildPackagedTimeoutFallbackProbe('/wp-json/reprint/v1/push/preflight', error),
  );
  const indexProbe = await fetchPackagedWordPressIndexProbe(baseUrl).catch((error) =>
    buildPackagedTimeoutFallbackProbe('/wp-json/', error),
  );
  return { preflightProbe, indexProbe };
}

function buildPackagedTimeoutFallbackProbe(route, error) {
  if (!packagedProductionPluginReadinessProbeTimedOut(error)) {
    throw error;
  }

  return {
    route,
    status: 0,
    ok: false,
    body: String(error?.message || error).slice(0, readinessFailureBodyLimit),
    ready: false,
    retryable: false,
    terminal: false,
    timedOut: true,
  };
}

async function stopExitedServer(child) {
  if (child.exitCode !== null) {
    return;
  }
  await stopSpawnedServer(child);
}

async function stopSpawnedServer(child) {
  stopProcessTree(child, 'SIGTERM');
  try {
    await waitForExit(child, 500);
    return;
  } catch {
    stopProcessTree(child, 'SIGKILL');
    try {
      await waitForExit(child, 2_000);
    } catch {
      process.stderr.write('Playground server did not exit after SIGKILL\n');
      if (typeof child.pid === 'number') {
        process.stderr.write(`Playground child pid still active: ${child.pid}\n`);
      }
    }
  }
}

stopAllPlaygroundChildren = async function stopAllPlaygroundChildren() {
  for (const child of activePlaygroundChildren) {
    try {
      await stopSpawnedServer(child);
    } catch {
      stopProcessTree(child, 'SIGKILL');
    }
  }
};

stopAllPlaygroundChildrenSync = function stopAllPlaygroundChildrenSync() {
  for (const child of activePlaygroundChildren) {
    stopProcessTree(child, 'SIGTERM');
    stopProcessTree(child, 'SIGKILL');
  }
};

function stopProcessTree(child, signal) {
  try {
    if (child.pid && process.platform !== 'win32') {
      process.kill(-child.pid, signal);
      return;
    }
  } catch {}
  child.kill(signal);
}

function installProcessCleanup() {
  const cleanup = () => {
    stopAllPlaygroundChildrenSync();
  };

  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });
  process.on('exit', cleanup);
}

installProcessCleanup();

async function exportSnapshot(name, baseUrl) {
  const response = await fetch(`${baseUrl}/wp-json/reprint-push-lab/v1/snapshot`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${fixtureCredentials.username}:${fixtureCredentials.password}`).toString('base64')}`,
    },
  });
  assert.equal(response.status, 200, `${name} snapshot HTTP ${response.status}`);
  const body = await response.json();
  assert.equal(body.ok, true, `${name} snapshot body not ok`);
  return body.snapshot;
}

async function exportProductionSnapshot(name, baseUrl) {
  const response = await fetch(`${baseUrl}/wp-json/reprint/v1/push/snapshot`, {
    headers: {
      ...authHeaders(),
      connection: 'close',
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

function runBoundedSync(command, args, options, label) {
  const boundedOptions = {
    shell: false,
    killSignal: 'SIGKILL',
    timeout: 10_000,
    ...options,
  };
  const proof = spawnSync(command, args, boundedOptions);
  if (proof.error || proof.signal || proof.status === null || proof.status !== 0) {
    stopAllPlaygroundChildrenSync();
    const commandLabel = `${command} ${args.join(' ')}`;
    process.stderr.write(`${describeSpawnProof(proof)}\n`);
    process.stdout.write(`${describeSpawnProof(proof)}\n`);
    writeSpawnOutputTail(proof, commandLabel);
  }
  if (proof.error) {
    const timeoutNote = proof.error.code === 'ETIMEDOUT' && boundedOptions.timeout ? ` after ${boundedOptions.timeout}ms` : '';
    const detailParts = [
      proof.error.name ?? 'Error',
      proof.error.code ? `code=${proof.error.code}` : null,
      proof.error.errno ? `errno=${proof.error.errno}` : null,
      proof.status !== null ? `status=${proof.status}` : null,
      proof.signal ? `signal=${proof.signal}` : null,
    ].filter(Boolean);
    throw new Error(
      `${label} failed${timeoutNote} with ${detailParts.join(' ')}: ${proof.error.message}\nstdout:\n${proof.stdout ?? ''}\nstderr:\n${proof.stderr ?? ''}`,
    );
  }
  if (proof.signal) {
    throw new Error(
      `${label} terminated by ${proof.signal}\nstdout:\n${proof.stdout ?? ''}\nstderr:\n${proof.stderr ?? ''}`,
    );
  }
  if (proof.status === null) {
    throw new Error(
      `${label} exited without a status\nstdout:\n${proof.stdout ?? ''}\nstderr:\n${proof.stderr ?? ''}`,
    );
  }
  if (proof.status !== 0) {
    throw new Error(
      `${label} exited with ${proof.status}\nstdout:\n${proof.stdout ?? ''}\nstderr:\n${proof.stderr ?? ''}`,
    );
  }
  return proof;
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

function summarizePackagedPluginDriverProof() {
  try {
    const proof = runBoundedSync(
      process.execPath,
      ['scripts/playground/production-plugin-package-smoke.mjs'],
      {
        cwd: repoRoot,
        timeout: 90_000,
        killSignal: 'SIGKILL',
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 20,
        env: {
          ...process.env,
          NODE_NO_WARNINGS: '1',
          REPRINT_PUSH_PACKAGE_SMOKE_MODE: 'driver-guard-only',
          // The checked release verifier only consumes the revoked-credential
          // receipt guard summary from package smoke. Keep the broader driver
          // verifier bundle in `verify:release`, but keep this inline helper
          // scoped to the one scenario its output actually reads.
          REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO: 'driver-receipt-guards',
        },
      },
      'packaged plugin driver revoked-credential guard smoke',
    );
    const summary = JSON.parse(proof.stdout);
    return {
      status: proof.status,
      mode: summary.mode || 'driver-guard-only',
      packagedRevokedCredentialGuard: summary.driverReceiptRevokedCredentialGuard || null,
      arbitraryPluginFixturePackage: summary.arbitraryPluginFixturePackage
        || summarizeArbitraryPluginFixturePackageEvidence(summary),
    };
  } catch (error) {
    return {
      status: 1,
      mode: 'driver-guard-only',
      packagedRevokedCredentialGuard: null,
      arbitraryPluginFixturePackage: summarizeArbitraryPluginFixturePackageEvidence(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function runProductionRecoveryJournalProof({ plan, current, artifactRefs = {} }) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-release-journal-'));
  const journalPath = path.join(workDir, 'production-recovery.journal.jsonl');
  try {
    const activeClaimId = digest({
      planId: plan.id,
      observedHash: digest(current),
      artifactRefs,
    });
    const journal = openProductionRecoveryJournal({
      filePath: journalPath,
      plan,
      current,
      artifactRefs,
      claimId: activeClaimId,
    });
    journal.close();

    const inspection = consumeProductionRecoveryJournal({
      filePath: journalPath,
      plan,
      current,
      artifactRefs,
      claimId: activeClaimId,
    });
    assert.equal(inspection.consumed, true, 'production recovery journal consumer must report consumption');
    assert.equal(inspection.journal.productionAdapter, 'openProductionRecoveryJournal');
    assert.equal(inspection.journal.ownsJournal, true);
    assert.equal(inspection.journal.consumed, true);
    assert.equal(inspection.journal.restartReadable, true);

    const staleClaimId = `${activeClaimId}-stale`;
    let staleClaimRejected = false;
    let staleJournal = null;
    try {
      staleJournal = openProductionRecoveryJournal({
        filePath: journalPath,
        plan,
        current,
        artifactRefs,
        truncate: false,
        claimId: staleClaimId,
      });
      staleJournal.appendEvent('journal-opened', {
        planId: plan.id,
        state: 'opened',
        observedHash: digest(current),
        artifactRefs,
      });
    } catch (error) {
      staleClaimRejected = error?.code === 'RECOVERY_CLAIM_STALE';
    } finally {
      staleJournal?.close();
    }

    return {
      journal: {
        ...inspection.journal,
        staleClaimRejected,
      },
      leaseFence: {
        ...inspection.leaseFence,
        staleClaimRejected,
      },
      consumed: inspection.consumed,
    };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

function writeSpawnOutputTail(proof, commandLabel = '') {
  const stdout = (proof.stdout ?? '').trimEnd();
  if (!stdout) {
    return;
  }
  const stdoutTail = stdout.slice(-4000);
  let structuredTail = null;
  try {
    const parsed = JSON.parse(stdoutTail.slice(stdoutTail.indexOf('{')));
    const lastProbe = parsed.lastProbe ?? parsed.lastProbeSummary ?? parsed.lastProbeResult ?? null;
    const topLevel = parsed.lastProbe
      ? parsed
      : parsed?.summary
        ? parsed.summary
        : parsed;
    structuredTail = {
      route: lastProbe?.route ?? topLevel?.route ?? parsed?.route ?? null,
      status: lastProbe?.status ?? topLevel?.status ?? parsed?.status ?? null,
      body: lastProbe?.body ?? topLevel?.body ?? parsed?.body ?? null,
    };
  } catch {
    structuredTail = null;
  }
  if (commandLabel) {
    process.stderr.write(`${commandLabel} stdout tail:\n${stdoutTail}\n`);
  } else {
    process.stderr.write(`stdout tail:\n${stdoutTail}\n`);
  }
  if (structuredTail && (structuredTail.route !== null || structuredTail.status !== null || structuredTail.body !== null)) {
    process.stderr.write(`Last route/status/body: ${JSON.stringify(structuredTail, null, 2)}\n`);
  }
}

function snapshotHash(snapshot) {
  return createHash('sha256').update(JSON.stringify(snapshot), 'utf8').digest('hex');
}

function createProductionPluginDriverBlueprints(sourceBlueprintPath) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-release-plugin-driver-'));
  const remoteBase = path.join(tmpDir, 'remote-base-release-driver.blueprint.json');
  const localEdited = path.join(tmpDir, 'local-edited-release-driver.blueprint.json');
  const remoteChanged = path.join(tmpDir, 'remote-changed-release-driver.blueprint.json');

  writeProductionPluginDriverBlueprint(sourceBlueprintPath, remoteBase, {
    fixture: 'remote-base',
    mode: 'base',
    version: 1,
    marker: 'base',
  });
  writeProductionPluginDriverBlueprint(sourceBlueprintPath, localEdited, {
    fixture: 'local-edited',
    mode: 'local-update',
    version: 2,
    marker: 'local-update',
  });
  writeProductionPluginDriverBlueprint(sourceBlueprintPath, remoteChanged, {
    fixture: 'remote-changed',
    mode: 'remote-changed',
    version: 3,
    marker: 'remote-changed',
  });

  return {
    tmpDir,
    remoteBase,
    localEdited,
    remoteChanged,
    cleanup() {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

function writeProductionPluginDriverBlueprint(sourceBlueprintPath, targetBlueprintPath, {
  fixture,
  mode,
  version,
  marker,
}) {
  const blueprint = JSON.parse(fs.readFileSync(sourceBlueprintPath, 'utf8'));
  blueprint.meta = {
    ...blueprint.meta,
    title: `Reprint Push ${fixture} Release Driver Boundary`,
    description: 'Production-owned Reprint Push release-state driver boundary fixture.',
  };
  blueprint.steps.push({
    step: 'setSiteOptions',
    options: {
      blogname: `Reprint Push ${fixture} Release Driver Boundary`,
      reprint_push_fixture: fixture,
    },
  });
  blueprint.steps.push({
    step: 'runPHP',
    code: [
      '<?php',
      "require_once '/wordpress/wp-load.php';",
      'global $wpdb;',
      "$table = $wpdb->prefix . 'reprint_push_release_state';",
      "$wpdb->query('CREATE TABLE IF NOT EXISTS ' . $table . ' (state_id bigint(20) unsigned NOT NULL, payload_json longtext NOT NULL, updated_marker varchar(32) NOT NULL, PRIMARY KEY (state_id)) ' . $wpdb->get_charset_collate());",
      `$payload = wp_json_encode(array('owner' => 'reprint-push', 'mode' => ${phpSingleQuoted(mode)}, 'version' => ${Number(version)}, 'releaseBoundaryProof' => 'plugin-driver-boundary'));`,
      `if (!is_string($payload)) { throw new RuntimeException('Could not encode release driver payload for ${fixture}.'); }`,
      `$wpdb->replace($table, array('state_id' => 1, 'payload_json' => $payload, 'updated_marker' => ${phpSingleQuoted(marker)}), array('%d', '%s', '%s'));`,
    ].join(' '),
  });
  fs.writeFileSync(targetBlueprintPath, `${JSON.stringify(blueprint, null, 2)}\n`);
}

function phpSingleQuoted(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function createPackagedProductionPluginFixture() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-release-packaged-plugin-'));
  const packageRoot = path.join(tmpDir, 'package');
  const pluginDir = path.join(packageRoot, 'reprint-push');
  const blueprintPath = path.join(tmpDir, 'remote-base-with-reprint-push-plugin.blueprint.json');
  buildPluginPackage(pluginDir);
  writePackagedProductionPluginBlueprint(remoteBaseFixturePath, blueprintPath);
  return {
    tmpDir,
    pluginDir,
    blueprintPath,
    cleanup() {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

function buildPluginPackage(targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  fs.cpSync(path.join(repoRoot, 'plugins/reprint-push'), targetDir, { recursive: true });
  const includesDir = path.join(targetDir, 'includes');
  fs.mkdirSync(includesDir, { recursive: true });
  for (const file of [
    'push-remote-rest-plugin.php',
    'push-remote-lib.php',
    'push-db-journal-lib.php',
    'snapshot-lib.php',
  ]) {
    fs.copyFileSync(
      path.join(repoRoot, 'scripts/playground', file),
      path.join(includesDir, file),
    );
  }
}

function writePackagedProductionPluginBlueprint(sourceBlueprintPath, targetBlueprintPath) {
  const blueprint = JSON.parse(fs.readFileSync(sourceBlueprintPath, 'utf8'));
  blueprint.meta = {
    ...blueprint.meta,
    title: 'Reprint Push Production Plugin Package',
    description: 'Remote base fixture with the packaged Reprint Push plugin activated.',
  };
  blueprint.steps.push({
    step: 'runPHP',
    code: [
      '<?php',
      "require_once '/wordpress/wp-load.php';",
      '$stable_uuid = static function (string $seed): string { $hex = md5($seed); return substr($hex, 0, 8) . \'-\' . substr($hex, 8, 4) . \'-\' . substr($hex, 12, 4) . \'-\' . substr($hex, 16, 4) . \'-\' . substr($hex, 20, 12); };',
      "$login = 'reprint_push_unscoped_admin';",
      "$app_password = 'reprint-push-unscoped-app-password';",
      "$slug = 'unscoped-admin';",
      '$user_id = wp_insert_user(array(\'user_login\' => $login, \'user_pass\' => wp_generate_password(32, true, true), \'user_email\' => sanitize_user($login, true) . \'@example.test\', \'display_name\' => $login, \'role\' => \'administrator\'));',
      'if (is_wp_error($user_id)) { throw new RuntimeException($user_id->get_error_message()); }',
      '$uuid = $stable_uuid(\'reprint-push-unscoped-\' . $slug);',
      '$app_id = $stable_uuid(\'reprint-push-unscoped-app-\' . $slug);',
      '$items = get_user_meta($user_id, \'_application_passwords\', true);',
      '$items = is_array($items) ? array_values($items) : array();',
      '$items[] = array(\'uuid\' => $uuid, \'app_id\' => $app_id, \'name\' => \'Unscoped Application Password\', \'password\' => wp_hash_password(preg_replace(\'/[^a-zA-Z0-9]/\', \'\', $app_password)), \'created\' => time(), \'last_used\' => null, \'last_ip\' => null);',
      'update_user_meta($user_id, \'_application_passwords\', $items);',
    ].join(' '),
  });
  blueprint.steps.push({
    step: 'runPHP',
    code: [
      '<?php',
      "require_once '/wordpress/wp-load.php';",
      "require_once ABSPATH . 'wp-admin/includes/plugin.php';",
      "$result = activate_plugin('reprint-push/reprint-push.php');",
      'if (is_wp_error($result)) { throw new RuntimeException($result->get_error_message()); }',
    ].join(' '),
  });
  blueprint.steps.push({
    step: 'runPHP',
    code: [
      '<?php',
      "require_once '/wordpress/wp-load.php';",
      '$result = reprint_push_lab_rest_provision_push_application_password(array(\'login\' => \'reprint_push_admin\', \'appPassword\' => \'reprint-push-admin-app-password\', \'role\' => \'administrator\', \'slug\' => \'primary-admin\', \'name\' => \'Reprint Push Package Smoke\', \'createUser\' => true, \'updateRole\' => true));',
      'if (empty($result[\'ok\'])) { throw new RuntimeException((string) ($result[\'message\'] ?? \'push credential provisioning failed\')); }',
    ].join(' '),
  });
  fs.writeFileSync(targetBlueprintPath, `${JSON.stringify(blueprint, null, 2)}\n`);
}

function exportSnapshotFromBlueprint(name, blueprintPath) {
  const trackedSnapshot = loadBlueprintSnapshotFixture(name, blueprintPath);
  if (trackedSnapshot) {
    return trackedSnapshot;
  }
  const result = spawnSync('npx', [
    '--yes',
    '@wp-playground/cli@latest',
    'php',
    '--blueprint',
    blueprintPath,
    '--mount',
    `${repoRoot}:/workspace`,
    '--verbosity',
    'quiet',
    '--',
    '/workspace/scripts/playground/export-site-snapshot.php',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  });
  if (result.status !== 0) {
    throw new Error(`Playground snapshot export failed for ${name}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return parseMarkedJson(
    result.stdout,
    'REPRINT_PUSH_SNAPSHOT_JSON_BEGIN',
    'REPRINT_PUSH_SNAPSHOT_JSON_END',
    `Snapshot markers missing for ${name}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
  );
}

function parseMarkedJson(stdout, startMarker, endMarker, errorMessage) {
  const startIndex = stdout.indexOf(startMarker);
  const endIndex = stdout.indexOf(endMarker);
  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    throw new Error(errorMessage);
  }
  return JSON.parse(stdout.slice(startIndex + startMarker.length, endIndex).trim());
}

function resolveReleaseBoundary(proof) {
  return proof?.boundary || {
    firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
    status: 'unimplemented',
    verdict: proof?.code === 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED'
      ? 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED'
      : 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
    durableJournal: {
      storageLeaseFence: 'production durable journal storage, lease, and fencing are not yet proven beyond the retained Playground journal path',
      verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
    },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function waitForServer(child, baseUrl, getLogs) {
  const deadline = Date.now() + serverStartupTimeoutMs;
  let lastError = null;
  const lastProbes = [];
  let notReadyProbeCount = 0;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      const exitLabel =
        child.exitCode !== null ? `exited early with ${child.exitCode}` : `terminated by ${child.signalCode}`;
      const message = formatPlaygroundStartupFailure(
        `Playground server ${exitLabel}`,
        lastError,
        lastProbes,
        getLogs(),
        { childPid: child.pid ?? null },
      );
      writePlaygroundFailure(message, lastProbes, getLogs(), lastError);
      await stopSpawnedServer(child);
      throw new Error(message);
    }
    try {
      const response = await fetchWithTimeout(`${baseUrl}/wp-json/`, {
        headers: { connection: 'close' },
      });
      const responseBody = await response.clone().text().catch(() => '');
      const responsePreview = responseBody.slice(0, readinessFailureBodyLimit);
      const lastRouteStatusBody = {
        route: '/wp-json/',
        status: response.status,
        body: responsePreview,
      };
      lastProbes.push({
        ...lastRouteStatusBody,
        ok: response.ok,
      });
      process.stderr.write(
        `Playground probe ${baseUrl}/wp-json/ -> ${response.status} ${responsePreview.slice(0, 160).replace(/\s+/g, ' ').trim()}\n`,
      );
      if (response.status === 200) {
        notReadyProbeCount = 0;
        await response.arrayBuffer();
        const snapshot = await fetchWithTimeout(`${baseUrl}/wp-json/reprint-push-lab/v1/snapshot`, {
          headers: {
          Authorization: `Basic ${Buffer.from(`${fixtureCredentials.username}:${fixtureCredentials.password}`).toString('base64')}`,
          connection: 'close',
        },
        });
        const snapshotBody = await snapshot.clone().text().catch(() => '');
        const snapshotPreview = snapshotBody.slice(0, 500);
        lastProbes.push({
          route: '/wp-json/reprint-push-lab/v1/snapshot',
          status: snapshot.status,
          ok: snapshot.ok,
          body: snapshotPreview,
        });
        process.stderr.write(
          `Playground probe ${baseUrl}/wp-json/reprint-push-lab/v1/snapshot -> ${snapshot.status} ${snapshotPreview.slice(0, 160).replace(/\s+/g, ' ').trim()}\n`,
        );
        if (snapshot.status === 200) {
          await snapshot.arrayBuffer();
          return;
        }
        lastError = new Error(
          `Playground lab snapshot readiness HTTP ${snapshot.status}; ${describeLastProbe(lastProbes.at(-1))}`,
        );
      } else {
        const readinessHint = isWordPressNotReadyResponse(response.status, responseBody)
          ? 'WordPress is not ready yet'
          : null;
        const routeSummary = describeLastRouteStatusBody(lastRouteStatusBody);
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
      if (error && typeof error === 'object' && error.isPlaygroundReadinessFailure) {
        throw error;
      }
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, readinessProbeIntervalMs));
  }
  if (lastProbes.length > 0 || lastError) {
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

function describeLastProbe(probe) {
  if (!probe) {
    return 'route/status/body: unavailable';
  }
  return describeLastRouteStatusBody({
    route: probe.route ?? null,
    status: probe.status ?? null,
    body: probe.body ?? null,
  });
}

function describeLastRouteStatusBody(lastRouteStatusBody) {
  return `route/status/body: ${JSON.stringify(
    {
      route: lastRouteStatusBody?.route ?? null,
      status: lastRouteStatusBody?.status ?? null,
      body: lastRouteStatusBody?.body ?? null,
    },
    null,
    2,
  )}`;
}

function signedHeadersForProductionPreflight(auth = fixtureCredentials) {
  const contentHash = createHash('sha256').update('', 'utf8').digest('hex');
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = `release-verify-packaged-${auth.username}-${Date.now()}`;
  const signingKey = hmacHex(auth.password, `reprint-push-lab-v1\n${auth.username}`);
  const authString = `${nonce}${timestamp}${contentHash}`;
  const canonical = [
    'REPRINT-PUSH-LAB-V1',
    'GET',
    '/wp-json/reprint/v1/push/preflight',
    '',
    contentHash,
    '',
    '',
  ].join('\n');
  return {
    authorization: `Basic ${Buffer.from(`${auth.username}:${auth.password}`, 'utf8').toString('base64')}`,
    connection: 'close',
    'X-Auth-Content-Hash': contentHash,
    'X-Auth-Timestamp': timestamp,
    'X-Auth-Nonce': nonce,
    'X-Auth-Signature': hmacHex(signingKey, authString),
    'X-Reprint-Push-Signature': hmacHex(signingKey, canonical),
  };
}

function authHeaders(auth = fixtureCredentials) {
  return {
    authorization: `Basic ${Buffer.from(`${auth.username}:${auth.password}`, 'utf8').toString('base64')}`,
  };
}

function hmacHex(key, data) {
  return createHmac('sha256', key).update(data, 'utf8').digest('hex');
}

function isWordPressNotReadyResponse(status, body) {
  return status === 502 && /WordPress is not ready yet/i.test(body);
}

function writePlaygroundFailure(message, lastProbes, logs, lastError) {
  const lastProbe = lastProbes.at(-1) ?? null;
  const lastRouteStatusBody = lastProbe
    ? {
        route: lastProbe.route ?? null,
        status: lastProbe.status ?? null,
        body: lastProbe.body ?? null,
      }
    : null;
  const summary = {
    message,
    lastProbe,
    lastProbeSummary: lastRouteStatusBody,
    lastRouteStatusBody,
    lastError: lastError?.message ?? null,
  };
  const flatLastProbe = lastProbe
    ? `\nLast route/status/body: ${JSON.stringify(
        {
          route: lastProbe.route,
          status: lastProbe.status,
          body: lastProbe.body,
        },
        null,
        2,
      )}`
    : '';
  writeSync(2, `${message}\n`);
  writeSync(2, `${flatLastProbe}\n`);
  writeSync(2, `${JSON.stringify(summary)}\n`);
  writeSync(1, `${JSON.stringify(summary)}\n`);
  if (logs) {
    writeSync(2, `${logs}\n`);
  }
}

async function throwPlaygroundReadinessFailure(child, prefix, lastError, lastProbes, logs, context = {}) {
  const diagnostic = formatPlaygroundStartupFailure(prefix, lastError, lastProbes, logs, context);
  writePlaygroundFailure(diagnostic, lastProbes, logs, lastError);
  await stopSpawnedServer(child);
  const finalError = new Error(diagnostic);
  finalError.isPlaygroundReadinessFailure = true;
  finalError.cause = lastError ?? null;
  finalError.lastProbe = lastProbes.at(-1) ?? null;
  finalError.lastRouteStatusBody = finalError.lastProbe
    ? {
        route: finalError.lastProbe.route ?? null,
        status: finalError.lastProbe.status ?? null,
        body: finalError.lastProbe.body ?? null,
    }
    : null;
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
  const routeStatusBodyText = lastProbe
    ? `\nLast route/status/body: ${JSON.stringify(
        {
          route: lastProbe.route ?? null,
          status: lastProbe.status ?? null,
          body: lastProbe.body ?? null,
        },
        null,
        2,
      )}`
    : '';
  const contextText = Object.keys(context).length
    ? `\nContext: ${JSON.stringify(context, null, 2)}`
    : '';
  return `${prefix}: ${errorText}${probeText}${lastProbeText}${routeStatusBodyText}${contextText}\n${logs}`;
}

async function fetchWithTimeout(url, init = {}, timeoutMs = serverFetchTimeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Timed out fetching ${url}`)), timeoutMs);
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

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Playground server did not exit within ${timeoutMs}ms`));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      child.off('exit', onExit);
      child.off('close', onExit);
    };

    const onExit = () => {
      cleanup();
      resolve();
    };

    child.once('exit', onExit);
    child.once('close', onExit);
  });
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

}
} catch (error) {
  topLevelError = error;
} finally {
  await stopAllPlaygroundChildren();
  if (topLevelError && !(topLevelError instanceof ProofFailure)) {
    throw topLevelError;
  }
  if (topLevelError instanceof ProofFailure) {
    process.exitCode = 1;
  }
}
