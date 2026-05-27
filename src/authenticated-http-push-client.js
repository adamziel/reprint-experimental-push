import { createHash, createHmac, randomBytes } from 'node:crypto';
import { createPushPlan } from './planner.js';
import { digest } from './stable-json.js';

const routeProfiles = {
  'lab-authenticated': {
    name: 'lab-authenticated',
    namespace: 'reprint-push-lab/v1',
    routePrefix: '/authenticated',
    namespacePath: '/wp-json/reprint-push-lab/v1/authenticated',
  },
  'production-shaped': {
    name: 'production-shaped',
    namespace: 'reprint/v1',
    routePrefix: '/push',
    namespacePath: '/wp-json/reprint/v1/push',
  },
};
const idempotencyHeader = 'X-Reprint-Push-Idempotency-Key';
const sessionHeader = 'X-Reprint-Push-Session';
const authContentHashHeader = 'X-Auth-Content-Hash';
const authTimestampHeader = 'X-Auth-Timestamp';
const authNonceHeader = 'X-Auth-Nonce';
const authSignatureHeader = 'X-Auth-Signature';
const pushSignatureHeader = 'X-Reprint-Push-Signature';
const transientFetchRetryDelayMs = 250;
const transientFetchAttempts = 4;
const checkedDbJournalSupportedSurface = 'claim-fenced-restart-readable';
const retryableReadOnlyGetPaths = new Set(Object.values(routeProfiles).flatMap((profile) => [
  `${profile.namespacePath}/preflight`,
  `${profile.namespacePath}/snapshot`,
  `${profile.namespacePath}/db-journal`,
]));
const sideEffectQueryParams = new Set([
  'reprint_push_lab_drift_after_snapshot',
  'reprint_push_lab_auth_session_drift',
]);

export async function runAuthenticatedHttpPush({
  sourceUrl,
  base,
  local,
  username,
  applicationPassword,
  idempotencyKey,
  routeProfile = 'lab-authenticated',
  dryRunOnly = false,
  labDriftAfterSnapshot = '',
  requireProductionAuthSession = false,
  simulateStaleClaimRetry = false,
  simulatePreservedRemoteRetryPath = '',
  labAuthSessionDrift = '',
  authSessionSource = null,
  now = new Date(),
}) {
  const resolvedSource = resolveAuthenticatedHttpPushSource({
    sourceUrl,
    username,
    applicationPassword,
    authSessionSource,
  });
  if (!resolvedSource.sourceUrl) {
    throw new Error('Missing sourceUrl');
  }
  if (!resolvedSource.username) {
    throw new Error('Missing username');
  }
  if (!resolvedSource.applicationPassword) {
    throw new Error('Missing applicationPassword');
  }
  if (!idempotencyKey) {
    throw new Error('Missing idempotencyKey');
  }

  const credential = {
    username: resolvedSource.username,
    password: resolvedSource.applicationPassword,
  };
  const profile = resolveRouteProfile(routeProfile);
  const client = authenticatedHttpClient({
    sourceUrl: resolvedSource.sourceUrl,
    credential,
    routeProfile: profile.name,
    simulatePreservedRemoteRetryPath,
  });
  const summary = {
    ok: false,
    mode: dryRunOnly ? 'dry-run' : 'apply',
    source: {
      url: redactUrl(resolvedSource.sourceUrl),
      namespace: profile.namespace,
      routePrefix: profile.routePrefix,
      routeProfile: profile.name,
      labBacked: !authSessionSource?.ok,
    },
    idempotencyKeyHash: digest(idempotencyKey),
    preflight: null,
    plan: null,
    dryRun: null,
    apply: null,
    recoveryInspect: null,
    replay: null,
    after: null,
    dbJournal: null,
    authSessionLifecycleTrace: [],
    retryAttempts: 1,
    readRetryEvidence: {},
  };
  const requiredPreservedRemoteRetryPath = simulatePreservedRemoteRetryPath
    ? (() => {
      const url = new URL(`${profile.namespacePath}${simulatePreservedRemoteRetryPath}`, resolvedSource.sourceUrl);
      return `${url.pathname}${url.search}`;
    })()
    : '';
  let requireCleanupEvidenceContinuity = false;

  let preflight;
  try {
    preflight = await client.signedGet('/preflight', { retryable: true });
  } catch (error) {
    captureTransportFailure(summary, 'preflight', error, 'PREFLIGHT_FAILED', 'preflight');
    return summary;
  }
  summary.preflight = summarizeResponse(preflight);
  updateRetryAttempts(summary, summary.preflight);
  if (preflight.status !== 200 || preflight.body?.ok !== true) {
    summary.code = preflight.body?.code || 'PREFLIGHT_FAILED';
    setDurableJournalBoundary(summary, 'preflight');
    return summary;
  }
  const session = preflight.body.session?.id;
  if (!session) {
    summary.code = 'PREFLIGHT_SESSION_MISSING';
    return summary;
  }
  recordAuthSessionLifecycle(summary, 'preflight', preflight.body?.auth);
  const preflightObservedLifecycleDrift = requireProductionAuthSession
    ? resolveObservedProductionAuthSessionLifecycleDrift(preflight)
    : null;
  if (preflightObservedLifecycleDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      ...(preflightObservedLifecycleDrift.field ? { field: preflightObservedLifecycleDrift.field } : {}),
      required: preflightObservedLifecycleDrift.required,
      observed: preflightObservedLifecycleDrift.observed,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }
  if (isExpiredSession(preflight.body.auth?.session)) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'unexpired',
      observed: preflight.body.auth?.session?.expiresAt || 'missing',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    summary.boundary = {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: summary.authSession,
    };
    return summary;
  }
  const preflightAuthEnvelope = {
    userLogin: preflight.body.auth?.identity?.userLogin,
    sessionId: preflight.body.auth?.session?.id,
    sessionType: preflight.body.auth?.session?.type,
    sessionStatus: preflight.body.auth?.session?.status,
    sessionExpiresAt: preflight.body.auth?.session?.expiresAt,
  };
  if (preflight.body.auth?.session?.id && preflight.body.auth.session.id !== session) {
    summary.code = 'PREFLIGHT_SESSION_MISMATCH';
    summary.authSession = {
      required: session,
      observed: preflight.body.auth.session.id,
      verdict: 'PREFLIGHT_SESSION_MISMATCH',
    };
    summary.boundary = {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PREFLIGHT_SESSION_MISMATCH',
      authSession: summary.authSession,
    };
    return summary;
  }
  const preflightInvalidIdentityField = requireProductionAuthSession
    ? resolveInvalidObservedProductionAuthIdentityField(preflight)
    : null;
  if (preflightInvalidIdentityField) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      field: `auth.identity.${preflightInvalidIdentityField.field}`,
      required: 'string auth identity fields',
      observed: `invalid-${preflightInvalidIdentityField.label}`,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }
  if (requireProductionAuthSession && hasMissingProductionAuthSessionEnvelopeId(preflight)) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'preserved read',
      observed: 'missing-session-id',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    summary.boundary = {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: summary.authSession,
    };
    return summary;
  }
  if (requireProductionAuthSession && preflight.body.auth?.session?.type !== 'production-auth-session') {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'production-auth-session',
      observed: preflight.body.auth?.session?.type || 'missing',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    summary.boundary = {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: summary.authSession,
    };
    return summary;
  }
  if (requireProductionAuthSession && preflight.body.auth?.session?.status !== 'active') {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'active',
      observed: preflight.body.auth?.session?.status || 'missing',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    summary.boundary = {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: summary.authSession,
    };
    return summary;
  }
  if (requireProductionAuthSession && hasMissingProductionAuthSessionIdentity(preflight)) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'authenticated identity',
      observed: 'missing-user-login',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    summary.boundary = {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: summary.authSession,
    };
    return summary;
  }
  const preflightIdentityMismatch = requireProductionAuthSession
    ? resolveProductionAuthSessionIdentityMismatch(resolvedSource.username, preflight)
    : null;
  if (preflightIdentityMismatch) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'authenticated identity match',
      observed: preflightIdentityMismatch,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    summary.boundary = {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: summary.authSession,
    };
    return summary;
  }
  if (requireProductionAuthSession && hasProductionAuthSessionRevocationDrift(preflight)) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = describeRequiredUnrevokedProductionAuthSession(preflight);
    summary.boundary = {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: summary.authSession,
    };
    return summary;
  }
  if (requireProductionAuthSession && hasMissingProductionAuthSessionExpiry(preflight)) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'unexpired',
      observed: preflight.body.auth?.session?.expiresAt || 'missing',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    summary.boundary = {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: summary.authSession,
    };
    return summary;
  }
  if (requireProductionAuthSession && isExpiredSession(preflight.body.auth?.session)) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'unexpired',
      observed: preflight.body.auth?.session?.expiresAt || 'missing',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    summary.boundary = {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: summary.authSession,
    };
    return summary;
  }
  const preflightCleanupEvidenceDrift = requireProductionAuthSession
    ? resolveProductionAuthSessionCleanupEvidenceDrift(preflight)
    : null;
  if (preflightCleanupEvidenceDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'cleanup evidence',
      observed: preflightCleanupEvidenceDrift,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    summary.boundary = {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: summary.authSession,
    };
    return summary;
  }
  requireCleanupEvidenceContinuity = hasValidProductionAuthSessionCleanupEvidence(preflight);

  const snapshotPath = labDriftAfterSnapshot
    ? `/snapshot?reprint_push_lab_drift_after_snapshot=${encodeURIComponent(labDriftAfterSnapshot)}`
    : '/snapshot';
  const authSessionDriftQuery = labAuthSessionDrift
    ? `reprint_push_lab_auth_session_drift=${encodeURIComponent(labAuthSessionDrift)}`
    : '';
  const withAuthSessionDrift = (pathname) => appendQueryParam(pathname, authSessionDriftQuery);
  let remoteSnapshot;
  try {
    remoteSnapshot = await client.get(snapshotPath);
  } catch (error) {
    captureTransportFailure(summary, 'remoteSnapshot', error, 'SNAPSHOT_FAILED', 'snapshot');
    return summary;
  }
  if (remoteSnapshot.status !== 200 || remoteSnapshot.body?.ok !== true) {
    summary.code = remoteSnapshot.body?.code || 'SNAPSHOT_FAILED';
    summary.snapshot = summarizeResponse(remoteSnapshot);
    setDurableJournalBoundary(summary, 'snapshot');
    return summary;
  }
  summary.remoteSnapshot = summarizeSnapshot(remoteSnapshot, local);
  updateRetryAttempts(summary, summary.remoteSnapshot);
  summary.remoteSnapshotObject = remoteSnapshot.body.snapshot;

  const plan = createPushPlan({
    base,
    local,
    remote: remoteSnapshot.body.snapshot,
    now,
  });
  summary.planObject = plan;
  summary.plan = summarizePlan(plan);

  if (plan.status !== 'ready') {
    summary.code = 'PLAN_NOT_READY_LOCALLY';
    summary.ok = false;
    setDurableJournalBoundary(summary, 'plan');
    return summary;
  }

  let dryRun;
  try {
    dryRun = await client.signedPost(withAuthSessionDrift('/dry-run'), { plan }, {
      session,
      idempotencyKey,
    });
  } catch (error) {
    captureTransportFailure(summary, 'dryRun', error, 'DRY_RUN_FAILED', 'dry-run');
    return summary;
  }
  summary.dryRun = summarizeResponse(dryRun);
  updateRetryAttempts(summary, summary.dryRun);
  recordAuthSessionLifecycle(summary, 'dry-run', dryRun.body?.auth);
  const dryRunObservedLifecycleDrift = requireProductionAuthSession
    ? resolveObservedProductionAuthSessionLifecycleDrift(dryRun)
    : null;
  const dryRunAuthEnvelopeDrift = requireProductionAuthSession
    ? describeAuthEnvelopeDrift(preflightAuthEnvelope, dryRun)
    : null;
  if (dryRun.status !== 200 || dryRun.body?.ok !== true || !dryRun.body?.receipt) {
    summary.code = dryRun.body?.code || 'DRY_RUN_FAILED';
    setDurableJournalBoundary(summary, 'dry-run');
    return summary;
  }
  if (dryRunObservedLifecycleDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      ...(dryRunObservedLifecycleDrift.field ? { field: dryRunObservedLifecycleDrift.field } : {}),
      required: dryRunObservedLifecycleDrift.required,
      observed: dryRunObservedLifecycleDrift.observed,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }
  if (requireProductionAuthSession && hasProductionAuthSessionRevocationDrift(dryRun)) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = describeRequiredUnrevokedProductionAuthSession(dryRun);
    summary.boundary = {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: summary.authSession,
    };
    return summary;
  }
  const dryRunCleanupEvidenceDrift = requireProductionAuthSession
    ? resolveProductionAuthSessionCleanupEvidenceDrift(dryRun)
    : null;
  if (dryRunCleanupEvidenceDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'cleanup evidence',
      observed: dryRunCleanupEvidenceDrift,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }
  if (requireProductionAuthSession && requireCleanupEvidenceContinuity && isMissingProductionAuthSessionCleanupEvidence(dryRun)) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'cleanup evidence continuity',
      observed: 'missing-session-store-cleanup',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }
  requireCleanupEvidenceContinuity = requireCleanupEvidenceContinuity || hasValidProductionAuthSessionCleanupEvidence(dryRun);
  const dryRunInvalidIdentityField = requireProductionAuthSession
    ? resolveInvalidObservedProductionAuthIdentityField(dryRun)
    : null;
  if (dryRunInvalidIdentityField) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      field: `auth.identity.${dryRunInvalidIdentityField.field}`,
      required: 'string auth identity fields',
      observed: `invalid-${dryRunInvalidIdentityField.label}`,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }
  if (requireProductionAuthSession && hasMissingProductionAuthSessionIdentity(dryRun)) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'authenticated identity',
      observed: 'missing-user-login',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    summary.boundary = {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: summary.authSession,
    };
    return summary;
  }
  const dryRunIdentityMismatch = requireProductionAuthSession
    ? resolveProductionAuthSessionIdentityMismatch(resolvedSource.username, dryRun)
    : null;
  if (dryRunIdentityMismatch) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'authenticated identity match',
      observed: dryRunIdentityMismatch,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    summary.boundary = {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: summary.authSession,
    };
    return summary;
  }
  const dryRunIdentityContinuityDrift = requireProductionAuthSession
    ? resolveProductionAuthSessionIdentityContinuityDrift(preflightAuthEnvelope, dryRun)
    : null;
  if (dryRunIdentityContinuityDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'authenticated identity continuity',
      observed: dryRunIdentityContinuityDrift,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    summary.boundary = {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: summary.authSession,
    };
    return summary;
  }
  const dryRunSessionPreservationDrift = requireProductionAuthSession
    ? resolveProductionAuthSessionPreservationDrift(preflightAuthEnvelope, dryRun)
    : null;
  if (dryRunSessionPreservationDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'preserved read',
      observed: dryRunSessionPreservationDrift,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    summary.boundary = {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: summary.authSession,
    };
    return summary;
  }
  if (dryRunAuthEnvelopeDrift) {
    summary.code = 'AUTH_SESSION_LIFECYCLE_DRIFT';
    summary.authSession = dryRunAuthEnvelopeDrift;
    setDurableJournalBoundary(summary, 'dry-run');
    return summary;
  }

  if (dryRunOnly) {
    let afterDryRun;
    try {
      afterDryRun = await client.get('/snapshot');
    } catch (error) {
      captureTransportFailure(summary, 'after', error, 'SNAPSHOT_FAILED', 'dry-run');
      return summary;
    }
    summary.after = summarizeSnapshot(afterDryRun, local);
    updateRetryAttempts(summary, summary.after);
    summary.ok = afterDryRun.status === 200 && afterDryRun.body?.ok === true;
    if (!summary.ok) {
      setDurableJournalBoundary(summary, 'dry-run');
    }
    return summary;
  }

  const applyPayload = {
    plan,
    receipt: dryRun.body.receipt,
  };
  if (simulateStaleClaimRetry) {
    applyPayload.labSimulateStaleClaimAllOld = true;
  }

  let apply = null;
  if (simulateStaleClaimRetry) {
    let staleClaimAttempt;
    try {
      staleClaimAttempt = await client.signedPost(withAuthSessionDrift('/apply'), applyPayload, {
        session,
        idempotencyKey,
      });
    } catch (error) {
      captureTransportFailure(summary, 'apply', error, 'APPLY_FAILED', 'apply');
      return summary;
    }
    summary.staleClaimRetry = {
      abandoned: summarizeResponse(staleClaimAttempt),
    };
    updateRetryAttempts(summary, summary.staleClaimRetry.abandoned);
    if (staleClaimAttempt.status !== 500 || staleClaimAttempt.body?.code !== 'LAB_SIMULATED_STALE_CLAIM_ALL_OLD') {
      summary.apply = summarizeResponse(staleClaimAttempt);
      summary.code = staleClaimAttempt.body?.code || 'APPLY_FAILED';
      setDurableJournalBoundary(summary, 'apply');
      return summary;
    }
  }

  try {
    apply = await client.signedPost(withAuthSessionDrift('/apply'), applyPayload, {
      session,
      idempotencyKey,
    });
  } catch (error) {
    captureTransportFailure(summary, 'apply', error, 'APPLY_FAILED', 'apply');
    return summary;
  }
  summary.apply = summarizeResponse(apply);
  updateRetryAttempts(summary, summary.apply);
  recordAuthSessionLifecycle(summary, 'apply', apply.body?.auth);
  const applyObservedLifecycleDrift = requireProductionAuthSession
    ? resolveObservedProductionAuthSessionLifecycleDrift(apply)
    : null;
  if (apply.status !== 200 || apply.body?.ok !== true) {
    summary.code = apply.body?.code || 'APPLY_FAILED';
    setDurableJournalBoundary(summary, 'apply');
    return summary;
  }
  if (applyObservedLifecycleDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      ...(applyObservedLifecycleDrift.field ? { field: applyObservedLifecycleDrift.field } : {}),
      required: applyObservedLifecycleDrift.required,
      observed: applyObservedLifecycleDrift.observed,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }
  if (requireProductionAuthSession && hasProductionAuthSessionRevocationDrift(apply)) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = describeRequiredUnrevokedProductionAuthSession(apply);
    summary.boundary = {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: summary.authSession,
    };
    return summary;
  }
  const applyCleanupEvidenceDrift = requireProductionAuthSession
    ? resolveProductionAuthSessionCleanupEvidenceDrift(apply)
    : null;
  if (applyCleanupEvidenceDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'cleanup evidence',
      observed: applyCleanupEvidenceDrift,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }
  if (requireProductionAuthSession && requireCleanupEvidenceContinuity && isMissingProductionAuthSessionCleanupEvidence(apply)) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'cleanup evidence continuity',
      observed: 'missing-session-store-cleanup',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }
  requireCleanupEvidenceContinuity = requireCleanupEvidenceContinuity || hasValidProductionAuthSessionCleanupEvidence(apply);
  const applyInvalidIdentityField = requireProductionAuthSession
    ? resolveInvalidObservedProductionAuthIdentityField(apply)
    : null;
  if (applyInvalidIdentityField) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      field: `auth.identity.${applyInvalidIdentityField.field}`,
      required: 'string auth identity fields',
      observed: `invalid-${applyInvalidIdentityField.label}`,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }
  if (requireProductionAuthSession && hasMissingProductionAuthSessionIdentity(apply)) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'authenticated identity',
      observed: 'missing-user-login',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    summary.boundary = {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: summary.authSession,
    };
    return summary;
  }
  const applyIdentityMismatch = requireProductionAuthSession
    ? resolveProductionAuthSessionIdentityMismatch(resolvedSource.username, apply)
    : null;
  if (applyIdentityMismatch) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'authenticated identity match',
      observed: applyIdentityMismatch,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    summary.boundary = {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: summary.authSession,
    };
    return summary;
  }
  const applyIdentityContinuityDrift = requireProductionAuthSession
    ? resolveProductionAuthSessionIdentityContinuityDrift(preflightAuthEnvelope, apply)
    : null;
  if (applyIdentityContinuityDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'authenticated identity continuity',
      observed: applyIdentityContinuityDrift,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    summary.boundary = {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: summary.authSession,
    };
    return summary;
  }
  const applySessionPreservationDrift = requireProductionAuthSession
    ? resolveProductionAuthSessionPreservationDrift(preflightAuthEnvelope, apply)
    : null;
  if (applySessionPreservationDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'preserved read',
      observed: applySessionPreservationDrift,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }
  if (hasExpiredAuthSession(apply)) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'unexpired',
      observed: apply.body?.auth?.session?.expiresAt || 'missing',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }
  const applyAuthSessionDrift = requireProductionAuthSession && (
    hasProductionAuthSessionTypeDrift(apply)
    || hasProductionAuthSessionStatusDrift(apply)
    || hasMissingProductionAuthSessionExpiry(apply)
    || hasProductionAuthSessionExpiryDrift(apply)
  );
  if (applyAuthSessionDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'production-auth-session',
      observed: apply.body?.auth?.session?.type || 'missing',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }

  let recoveryInspect;
  try {
    recoveryInspect = await client.signedPost(withAuthSessionDrift('/recovery/inspect'), {
      plan,
      receipt: dryRun.body.receipt,
    }, {
      session,
      idempotencyKey,
    });
  } catch (error) {
    captureTransportFailure(summary, 'recoveryInspect', error, 'RECOVERY_INSPECT_FAILED', 'recovery-inspect');
    return summary;
  }
  summary.recoveryInspect = summarizeResponse(recoveryInspect);
  updateRetryAttempts(summary, summary.recoveryInspect);
  recordAuthSessionLifecycle(summary, 'recovery-inspect', recoveryInspect.body?.auth);
  const recoveryInspectObservedLifecycleDrift = requireProductionAuthSession
    ? resolveObservedProductionAuthSessionLifecycleDrift(recoveryInspect)
    : null;
  summary.recoveryInspect.recovery = summarizeRecoveryInspect(recoveryInspect);
  const recoveryInspectAuthSessionDrift = requireProductionAuthSession && (
    hasProductionAuthSessionTypeDrift(recoveryInspect)
    || hasProductionAuthSessionStatusDrift(recoveryInspect)
    || hasMissingProductionAuthSessionExpiry(recoveryInspect)
    || hasProductionAuthSessionExpiryDrift(recoveryInspect)
  );
  if (recoveryInspect.status !== 200 || recoveryInspect.body?.ok !== true) {
    summary.code = recoveryInspect.body?.code || 'RECOVERY_INSPECT_FAILED';
    setDurableJournalBoundary(summary, 'recovery-inspect');
    return summary;
  }
  if (recoveryInspectObservedLifecycleDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      ...(recoveryInspectObservedLifecycleDrift.field ? { field: recoveryInspectObservedLifecycleDrift.field } : {}),
      required: recoveryInspectObservedLifecycleDrift.required,
      observed: recoveryInspectObservedLifecycleDrift.observed,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }
  if (requireProductionAuthSession && hasProductionAuthSessionRevocationDrift(recoveryInspect)) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = describeRequiredUnrevokedProductionAuthSession(recoveryInspect);
    summary.boundary = {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: summary.authSession,
    };
    return summary;
  }
  const recoveryInspectCleanupEvidenceDrift = requireProductionAuthSession
    ? resolveProductionAuthSessionCleanupEvidenceDrift(recoveryInspect)
    : null;
  if (recoveryInspectCleanupEvidenceDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'cleanup evidence',
      observed: recoveryInspectCleanupEvidenceDrift,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }
  if (
    requireProductionAuthSession
    && requireCleanupEvidenceContinuity
    && isMissingProductionAuthSessionCleanupEvidence(recoveryInspect)
  ) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'cleanup evidence continuity',
      observed: 'missing-session-store-cleanup',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }
  requireCleanupEvidenceContinuity = requireCleanupEvidenceContinuity
    || hasValidProductionAuthSessionCleanupEvidence(recoveryInspect);
  const recoveryInspectInvalidIdentityField = requireProductionAuthSession
    ? resolveInvalidObservedProductionAuthIdentityField(recoveryInspect)
    : null;
  if (recoveryInspectInvalidIdentityField) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      field: `auth.identity.${recoveryInspectInvalidIdentityField.field}`,
      required: 'string auth identity fields',
      observed: `invalid-${recoveryInspectInvalidIdentityField.label}`,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }
  if (requireProductionAuthSession && hasMissingProductionAuthSessionIdentity(recoveryInspect)) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'authenticated identity',
      observed: 'missing-user-login',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    summary.boundary = {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: summary.authSession,
    };
    return summary;
  }
  const recoveryInspectIdentityMismatch = requireProductionAuthSession
    ? resolveProductionAuthSessionIdentityMismatch(resolvedSource.username, recoveryInspect)
    : null;
  if (recoveryInspectIdentityMismatch) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'authenticated identity match',
      observed: recoveryInspectIdentityMismatch,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    summary.boundary = {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: summary.authSession,
    };
    return summary;
  }
  const recoveryInspectIdentityContinuityDrift = requireProductionAuthSession
    ? resolveProductionAuthSessionIdentityContinuityDrift(preflightAuthEnvelope, recoveryInspect)
    : null;
  if (recoveryInspectIdentityContinuityDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'authenticated identity continuity',
      observed: recoveryInspectIdentityContinuityDrift,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    summary.boundary = {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: summary.authSession,
    };
    return summary;
  }
  const recoveryInspectSessionPreservationDrift = requireProductionAuthSession
    ? resolveProductionAuthSessionPreservationDrift(preflightAuthEnvelope, recoveryInspect)
    : null;
  if (recoveryInspectSessionPreservationDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'preserved read',
      observed: recoveryInspectSessionPreservationDrift,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }
  if (hasExpiredAuthSession(recoveryInspect)) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'unexpired',
      observed: recoveryInspect.body?.auth?.session?.expiresAt || 'missing',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }
  if (recoveryInspectAuthSessionDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'production-auth-session',
      observed: recoveryInspect.body?.auth?.session?.type || 'missing',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }
  const recoveryInspectAuthEnvelopeDrift = describeAuthEnvelopeDrift(preflightAuthEnvelope, recoveryInspect);
  if (recoveryInspectAuthEnvelopeDrift) {
    summary.code = 'AUTH_SESSION_LIFECYCLE_DRIFT';
    summary.authSession = recoveryInspectAuthEnvelopeDrift;
    setDurableJournalBoundary(summary, 'recovery-inspect');
    return summary;
  }
  if (!summary.recoveryInspect.recovery || summary.recoveryInspect.recovery.journalState !== 'ok') {
    summary.code = 'RECOVERY_INSPECT_JOURNAL_UNTRUSTED';
    setDurableJournalBoundary(summary, 'recovery-inspect');
    return summary;
  }
  if ((summary.recoveryInspect.recovery.counts?.blockedUnknown || 0) > 0) {
    summary.code = 'RECOVERY_INSPECT_JOURNAL_UNTRUSTED';
    setDurableJournalBoundary(summary, 'recovery-inspect');
    return summary;
  }
  if (summary.recoveryInspect.recovery?.state === 'blocked-recovery') {
    summary.code = recoveryInspect.body?.code || 'RECOVERY_INSPECT_BLOCKED';
    setDurableJournalBoundary(summary, 'recovery-inspect');
    return summary;
  }

  let replay;
  try {
    replay = await client.signedPost(withAuthSessionDrift('/apply'), applyPayload, {
      session,
      idempotencyKey,
    });
  } catch (error) {
    captureTransportFailure(summary, 'replay', error, 'REPLAY_FAILED', 'replay');
    return summary;
  }
  summary.replay = summarizeResponse(replay);
  updateRetryAttempts(summary, summary.replay);
  recordAuthSessionLifecycle(summary, 'replay', replay.body?.auth);
  const replayObservedLifecycleDrift = requireProductionAuthSession
    ? resolveObservedProductionAuthSessionLifecycleDrift(replay)
    : null;
  summary.replay.responseSchemaVersion = replay.body?.responseSchemaVersion;
  const replayEquivalence = summarizeReplayEquivalence(apply, replay);
  summary.replayEquivalence = replayEquivalence;
  const replayEquivalent = replayEquivalence.equivalent;
  const applyAuthEnvelopeDrift = describeAuthEnvelopeDrift(preflightAuthEnvelope, apply);
  const replayAuthEnvelopeDrift = describeAuthEnvelopeDrift(preflightAuthEnvelope, replay);
  const replayAuthSessionDrift = requireProductionAuthSession && (
    hasProductionAuthSessionTypeDrift(replay)
    || hasProductionAuthSessionStatusDrift(replay)
    || hasMissingProductionAuthSessionExpiry(replay)
    || hasProductionAuthSessionExpiryDrift(replay)
  );
  if (applyAuthEnvelopeDrift || recoveryInspectAuthEnvelopeDrift || replayAuthEnvelopeDrift) {
    summary.code = 'AUTH_SESSION_LIFECYCLE_DRIFT';
    summary.authSession = applyAuthEnvelopeDrift
      || recoveryInspectAuthEnvelopeDrift
      || replayAuthEnvelopeDrift;
    setDurableJournalBoundary(summary, 'replay');
    return summary;
  }
  if (replayObservedLifecycleDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      ...(replayObservedLifecycleDrift.field ? { field: replayObservedLifecycleDrift.field } : {}),
      required: replayObservedLifecycleDrift.required,
      observed: replayObservedLifecycleDrift.observed,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }
  if (replayAuthSessionDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'production-auth-session',
      observed: replay.body?.auth?.session?.type || 'missing',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }
  if (requireProductionAuthSession && hasProductionAuthSessionRevocationDrift(replay)) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = describeRequiredUnrevokedProductionAuthSession(replay);
    summary.boundary = {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: summary.authSession,
    };
    return summary;
  }
  const replayCleanupEvidenceDrift = requireProductionAuthSession
    ? resolveProductionAuthSessionCleanupEvidenceDrift(replay)
    : null;
  if (replayCleanupEvidenceDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'cleanup evidence',
      observed: replayCleanupEvidenceDrift,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }
  if (requireProductionAuthSession && requireCleanupEvidenceContinuity && isMissingProductionAuthSessionCleanupEvidence(replay)) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'cleanup evidence continuity',
      observed: 'missing-session-store-cleanup',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }
  requireCleanupEvidenceContinuity = requireCleanupEvidenceContinuity || hasValidProductionAuthSessionCleanupEvidence(replay);
  const replayInvalidIdentityField = requireProductionAuthSession
    ? resolveInvalidObservedProductionAuthIdentityField(replay)
    : null;
  if (replayInvalidIdentityField) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      field: `auth.identity.${replayInvalidIdentityField.field}`,
      required: 'string auth identity fields',
      observed: `invalid-${replayInvalidIdentityField.label}`,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }
  if (requireProductionAuthSession && hasMissingProductionAuthSessionIdentity(replay)) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'authenticated identity',
      observed: 'missing-user-login',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    summary.boundary = {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: summary.authSession,
    };
    return summary;
  }
  const replayIdentityMismatch = requireProductionAuthSession
    ? resolveProductionAuthSessionIdentityMismatch(resolvedSource.username, replay)
    : null;
  if (replayIdentityMismatch) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'authenticated identity match',
      observed: replayIdentityMismatch,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    summary.boundary = {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: summary.authSession,
    };
    return summary;
  }
  const replayIdentityContinuityDrift = requireProductionAuthSession
    ? resolveProductionAuthSessionIdentityContinuityDrift(preflightAuthEnvelope, replay)
    : null;
  if (replayIdentityContinuityDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'authenticated identity continuity',
      observed: replayIdentityContinuityDrift,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    summary.boundary = {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: summary.authSession,
    };
    return summary;
  }
  const replaySessionPreservationDrift = requireProductionAuthSession
    ? resolveProductionAuthSessionPreservationDrift(preflightAuthEnvelope, replay)
    : null;
  if (replaySessionPreservationDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'preserved read',
      observed: replaySessionPreservationDrift,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }
  if (hasExpiredAuthSession(replay)) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'unexpired',
      observed: replay.body?.auth?.session?.expiresAt || 'missing',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }

  let afterApply;
  try {
    afterApply = await client.get('/snapshot');
  } catch (error) {
    captureTransportFailure(summary, 'after', error, 'SNAPSHOT_FAILED', 'replay');
    return summary;
  }
  summary.after = summarizeSnapshot(afterApply, local);
  updateRetryAttempts(summary, summary.after);
  summary.afterObject = afterApply.body.snapshot;
  let dbJournal;
  try {
    dbJournal = await client.signedGet(withAuthSessionDrift('/db-journal?limit=80'), {
      session,
      idempotencyKey,
      retryable: true,
    });
  } catch (error) {
    captureTransportFailure(summary, 'dbJournal', error, 'DURABLE_JOURNAL_NOT_PROVEN', 'journal-inspect');
    return summary;
  }
  summary.dbJournal = summarizeDbJournal(dbJournal);
  updateRetryAttempts(summary, summary.dbJournal);
  recordAuthSessionLifecycle(summary, 'journal', dbJournal.body?.auth);
  const dbJournalObservedLifecycleDrift = requireProductionAuthSession
    ? resolveObservedProductionAuthSessionLifecycleDrift(dbJournal)
    : null;
  const requiredPreservedRemoteRetryAttempts = requiredPreservedRemoteRetryPath
    ? summary.readRetryEvidence?.[requiredPreservedRemoteRetryPath] || 1
    : 1;
  if (simulatePreservedRemoteRetryPath && requiredPreservedRemoteRetryAttempts < 2) {
    summary.code = 'PRESERVED_REMOTE_RETRY_REQUIRED';
    summary.replayAndRetry = {
      required: simulatePreservedRemoteRetryPath,
      observed: 'missing-transient-retry',
      retryAttempts: requiredPreservedRemoteRetryAttempts,
      verdict: 'PRESERVED_REMOTE_RETRY_REQUIRED',
    };
    setReplayAndRetryBoundary(summary);
    return summary;
  }
  if (simulatePreservedRemoteRetryPath) {
    summary.replayAndRetry = {
      required: simulatePreservedRemoteRetryPath,
      observed: simulatePreservedRemoteRetryPath,
      retryAttempts: requiredPreservedRemoteRetryAttempts,
      verdict: 'PRESERVED_REMOTE_RETRY_PROVEN',
    };
  }
  const dbJournalAuthSessionDrift = requireProductionAuthSession && (
    hasProductionAuthSessionTypeDrift(dbJournal)
    || hasProductionAuthSessionStatusDrift(dbJournal)
    || hasMissingProductionAuthSessionExpiry(dbJournal)
    || hasProductionAuthSessionExpiryDrift(dbJournal)
  );
  if (dbJournal.status !== 200 || dbJournal.body?.ok !== true) {
    summary.code = dbJournal.body?.code || 'DURABLE_JOURNAL_NOT_PROVEN';
    setDurableJournalBoundary(summary, 'journal-inspect');
    return summary;
  }
  if (dbJournalObservedLifecycleDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      ...(dbJournalObservedLifecycleDrift.field ? { field: dbJournalObservedLifecycleDrift.field } : {}),
      required: dbJournalObservedLifecycleDrift.required,
      observed: dbJournalObservedLifecycleDrift.observed,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }
  if (requireProductionAuthSession && hasProductionAuthSessionRevocationDrift(dbJournal)) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = describeRequiredUnrevokedProductionAuthSession(dbJournal);
    summary.boundary = {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: summary.authSession,
    };
    return summary;
  }
  const dbJournalCleanupEvidenceDrift = requireProductionAuthSession
    ? resolveProductionAuthSessionCleanupEvidenceDrift(dbJournal)
    : null;
  if (dbJournalCleanupEvidenceDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'cleanup evidence',
      observed: dbJournalCleanupEvidenceDrift,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }
  if (requireProductionAuthSession && requireCleanupEvidenceContinuity && isMissingProductionAuthSessionCleanupEvidence(dbJournal)) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'cleanup evidence continuity',
      observed: 'missing-session-store-cleanup',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }
  requireCleanupEvidenceContinuity = requireCleanupEvidenceContinuity || hasValidProductionAuthSessionCleanupEvidence(dbJournal);
  const dbJournalInvalidIdentityField = requireProductionAuthSession
    ? resolveInvalidObservedProductionAuthIdentityField(dbJournal)
    : null;
  if (dbJournalInvalidIdentityField) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      field: `auth.identity.${dbJournalInvalidIdentityField.field}`,
      required: 'string auth identity fields',
      observed: `invalid-${dbJournalInvalidIdentityField.label}`,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }
  if (requireProductionAuthSession && hasMissingProductionAuthSessionIdentity(dbJournal)) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'authenticated identity',
      observed: 'missing-user-login',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    summary.boundary = {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: summary.authSession,
    };
    return summary;
  }
  const dbJournalIdentityMismatch = requireProductionAuthSession
    ? resolveProductionAuthSessionIdentityMismatch(resolvedSource.username, dbJournal)
    : null;
  if (dbJournalIdentityMismatch) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'authenticated identity match',
      observed: dbJournalIdentityMismatch,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    summary.boundary = {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: summary.authSession,
    };
    return summary;
  }
  const dbJournalIdentityContinuityDrift = requireProductionAuthSession
    ? resolveProductionAuthSessionIdentityContinuityDrift(preflightAuthEnvelope, dbJournal)
    : null;
  if (dbJournalIdentityContinuityDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'authenticated identity continuity',
      observed: dbJournalIdentityContinuityDrift,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    summary.boundary = {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: summary.authSession,
    };
    return summary;
  }
  const dbJournalSessionPreservationDrift = requireProductionAuthSession
    ? resolveProductionAuthSessionPreservationDrift(preflightAuthEnvelope, dbJournal)
    : null;
  if (dbJournalSessionPreservationDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'preserved read',
      observed: dbJournalSessionPreservationDrift,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }
  if (hasExpiredAuthSession(dbJournal)) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'unexpired',
      observed: dbJournal.body?.auth?.session?.expiresAt || 'missing',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }
  if (dbJournalAuthSessionDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'production-auth-session',
      observed: dbJournal.body?.auth?.session?.type || 'missing',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }
  const dbJournalAuthEnvelopeDrift = describeAuthEnvelopeDrift(preflightAuthEnvelope, dbJournal);
  if (dbJournalAuthEnvelopeDrift) {
    summary.code = 'AUTH_SESSION_LIFECYCLE_DRIFT';
    summary.authSession = dbJournalAuthEnvelopeDrift;
    setDurableJournalBoundary(summary, 'journal-inspect');
    return summary;
  }

  summary.ok = apply.status === 200
    && apply.body?.ok === true
    && recoveryInspect.status === 200
    && recoveryInspect.body?.ok === true
    && replay.status === 200
    && replay.body?.ok === true
    && replay.body?.idempotency?.replayed === true
    && replay.body?.idempotency?.freshMutationWork === false
    && replayEquivalent
    && !applyAuthEnvelopeDrift
    && !recoveryInspectAuthEnvelopeDrift
    && !replayAuthEnvelopeDrift
    && dbJournal.status === 200
    && dbJournal.body?.ok === true
    && dbJournalProofIsAcceptable(summary.dbJournal, {
      requireStaleClaimRejected: simulateStaleClaimRetry,
    })
    && summary.after?.finalMatchesLocal === true;
  if (!summary.ok) {
    const replayIdempotency = replay.body?.idempotency;
    const authEnvelopeDrift = applyAuthEnvelopeDrift || replayAuthEnvelopeDrift;
    const journalProofFailed = dbJournal.status === 200
      && dbJournal.body?.ok === true
      && !dbJournalProofIsAcceptable(summary.dbJournal, {
        requireStaleClaimRejected: simulateStaleClaimRetry,
      });
    const replayEquivalenceFailed = replay.status === 200
      && replay.body?.ok === true
      && replayIdempotency
      && (
        replayIdempotency?.replayed !== true
        || replayIdempotency?.freshMutationWork !== false
        || !replayEquivalent
      );
    summary.code = authEnvelopeDrift
      ? 'AUTH_SESSION_LIFECYCLE_DRIFT'
      : replayEquivalenceFailed
      ? 'REPLAY_NOT_EQUIVALENT'
      : journalProofFailed
        ? 'DURABLE_JOURNAL_NOT_PROVEN'
      : (replayIdempotency?.replayed !== true || replayIdempotency?.freshMutationWork !== false)
        ? 'REPLAY_NOT_IDEMPOTENT'
        : apply.body?.code
          || recoveryInspect.body?.code
          || replay.body?.code
          || dbJournal.body?.code
          || 'APPLY_FAILED';
    setDurableJournalBoundary(summary, dbJournal.status === 200
      ? (journalProofFailed ? 'journal-inspect' : (replay.status === 200 ? 'replay' : 'apply'))
      : 'journal-inspect');
  }
  return summary;
}

export function resolveAuthenticatedHttpPushSource({
  sourceUrl = '',
  username = '',
  applicationPassword = '',
  authSessionSource = null,
}) {
  const normalizedAuthSessionSource = normalizeAuthenticatedHttpPushSource(authSessionSource);
  if (!normalizedAuthSessionSource) {
    return {
      sourceUrl,
      username,
      applicationPassword,
    };
  }

  return {
    sourceUrl: normalizedAuthSessionSource.sourceUrl,
    username: normalizedAuthSessionSource.username,
    applicationPassword: normalizedAuthSessionSource.applicationPassword,
  };
}

function normalizeAuthenticatedHttpPushSource(authSessionSource) {
  if (!authSessionSource?.ok) {
    return null;
  }

  const sourceUrl = normalizeSupportedAuthenticatedHttpPushSourceUrl(authSessionSource.sourceUrl);
  const username = normalizeAuthenticatedHttpPushSourceField(authSessionSource.username);
  const applicationPassword = normalizeAuthenticatedHttpPushSourceField(authSessionSource.applicationPassword);
  if (!sourceUrl || !username || !applicationPassword) {
    return null;
  }

  return {
    sourceUrl,
    username,
    applicationPassword,
  };
}

function normalizeAuthenticatedHttpPushSourceField(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value.trim();
  if (!normalized || normalized !== value || /[\u0000-\u001f\u007f]/.test(normalized)) {
    return '';
  }

  return normalized;
}

function normalizeSupportedAuthenticatedHttpPushSourceUrl(value) {
  const sourceUrl = normalizeAuthenticatedHttpPushSourceField(value);
  if (!sourceUrl) {
    return '';
  }

  return isSupportedAuthenticatedHttpPushSourceUrl(sourceUrl)
    ? sourceUrl
    : '';
}

function isSupportedAuthenticatedHttpPushSourceUrl(sourceUrl) {
  let parsed;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return false;
  }

  if (parsed.protocol === 'https:') {
    return true;
  }

  return parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname);
}

export function authenticatedHttpClient({
  sourceUrl,
  credential,
  routeProfile = 'lab-authenticated',
  requestTimeoutMs = 10_000,
  simulatePreservedRemoteRetryPath = '',
}) {
  const baseUrl = normalizeBaseUrl(sourceUrl);
  const profile = resolveRouteProfile(routeProfile);
  assertSupportedSourceUrlForRouteProfile(baseUrl, profile);
  assertSupportedCredentialForRouteProfile(credential, profile);
  const maybeSimulateTransientReadFailure = createTransientReadFailureProbe(
    baseUrl,
    profile.namespacePath,
    simulatePreservedRemoteRetryPath,
  );

  return {
    get(pathSuffix) {
      return requestJson(
        baseUrl,
        'GET',
        `${profile.namespacePath}${pathSuffix}`,
        undefined,
        authHeaders(credential),
        requestTimeoutMs,
        {
          beforeAttempt: maybeSimulateTransientReadFailure,
        },
      );
    },
    post(pathSuffix, body, headers = {}) {
      return requestJson(baseUrl, 'POST', `${profile.namespacePath}${pathSuffix}`, body, {
        ...authHeaders(credential),
        ...headers,
      }, requestTimeoutMs);
    },
    signedGet(pathSuffix, options = {}) {
      const pathname = `${profile.namespacePath}${pathSuffix}`;
      return requestJsonRaw(
        baseUrl,
        'GET',
        pathname,
        undefined,
        signedRequestHeaders(credential, 'GET', pathname, '', options),
        requestTimeoutMs,
        {
          retryable: options.retryable === true && !hasSideEffectQueryParam(pathname),
          beforeAttempt: maybeSimulateTransientReadFailure,
        },
      );
    },
    signedPost(pathSuffix, body, options = {}) {
      const pathname = `${profile.namespacePath}${pathSuffix}`;
      const rawBody = JSON.stringify(body);
      assertMutatingRequestOptions(pathname, options);
      return requestJsonRaw(
        baseUrl,
        'POST',
        pathname,
        rawBody,
        signedRequestHeaders(credential, 'POST', pathname, rawBody, options),
        requestTimeoutMs,
        {
          retryable: options.retryable === true || options.idempotencyKey !== undefined,
        },
      );
    },
  };
}

function assertSupportedCredentialForRouteProfile(credential, profile) {
  if (profile.name !== 'production-shaped') {
    return;
  }

  if (!credential?.username || !credential?.password) {
    throw new Error('Missing credentials for production-shaped authenticated client');
  }
}

function resolveRouteProfile(routeProfile) {
  const key = String(routeProfile || 'lab-authenticated');
  if (key === 'lab') {
    return routeProfiles['lab-authenticated'];
  }
  if (key === 'production' || key === 'prod') {
    return routeProfiles['production-shaped'];
  }
  if (routeProfiles[key]) {
    return routeProfiles[key];
  }
  throw new Error(`Unknown routeProfile: ${routeProfile}`);
}

function summarizePlan(plan) {
  return {
    id: plan.id,
    status: plan.status,
    summary: plan.summary,
    mutations: plan.mutations.length,
    mutationKeys: plan.mutations.map((mutation) => mutation.resourceKey),
    conflicts: plan.conflicts.map((conflict) => ({
      resourceKey: conflict.resourceKey,
      reason: conflict.reason,
      resolutionPolicy: conflict.resolutionPolicy,
      className: conflict.className,
    })),
    blockers: plan.blockers.map((blocker) => ({
      resourceKey: blocker.resourceKey,
      reason: blocker.reason,
      className: blocker.className,
    })),
  };
}

function summarizeResponse(response) {
  const body = response.body || {};
  return {
    status: response.status,
    ok: body.ok === true,
    retryAttempts: response.retryAttempts || 1,
    mode: body.mode,
    code: body.code,
    applied: body.applied,
    receiptHash: body.receipt?.receiptHash,
    responseSchemaVersion: body.responseSchemaVersion,
    authUser: body.auth?.identity?.userLogin,
    authSessionId: body.auth?.session?.id,
    sessionType: body.auth?.session?.type,
    sessionStatus: body.auth?.session?.status,
    sessionExpiresAt: body.auth?.session?.expiresAt,
    signed: body.signedRequest?.signed === true,
    signedRequest: body.signedRequest ? {
      schemaVersion: body.signedRequest.schemaVersion,
      contentHash: body.signedRequest.contentHash,
      timestamp: body.signedRequest.timestamp,
      nonceHash: body.signedRequest.nonceHash,
      sessionHash: body.signedRequest.sessionHash,
      signingKeyHash: body.signedRequest.signingKeyHash,
      request: body.signedRequest.request,
    } : undefined,
    idempotency: body.idempotency ? {
      replayed: body.idempotency.replayed === true,
      freshMutationWork: body.idempotency.freshMutationWork === true,
      staleClaimRetry: body.idempotency.staleClaimRetry === true,
      status: body.idempotency.status,
      conflict: body.idempotency.conflict === true,
    } : undefined,
    storageGuard: body.storageGuard ? {
      boundary: body.storageGuard.boundary,
      operation: body.storageGuard.operation,
      outcome: body.storageGuard.outcome,
    } : undefined,
    request: response.request ? {
      method: response.request.method || null,
      pathname: response.request.pathname || null,
      retryable: response.request.retryable === true,
    } : undefined,
  };
}

function summarizeTransportFailure(error) {
  return {
    status: 0,
    ok: false,
    retryAttempts: typeof error?.retryAttempts === 'number' ? error.retryAttempts : 1,
    code: error?.cause?.code || error?.code || 'FETCH_FAILED',
    error: error instanceof Error ? error.message : String(error),
    transportFailure: true,
    request: error?.request ? {
      method: error.request.method || null,
      pathname: error.request.pathname || null,
      retryable: error.request.retryable === true,
    } : undefined,
  };
}

function updateRetryAttempts(summary, responseSummary) {
  if (!responseSummary || typeof responseSummary.retryAttempts !== 'number') {
    return;
  }

  summary.retryAttempts = Math.max(summary.retryAttempts || 1, responseSummary.retryAttempts);
  if (responseSummary.request?.retryable === true && responseSummary.request?.pathname) {
    const pathname = responseSummary.request.pathname;
    summary.readRetryEvidence = summary.readRetryEvidence || {};
    summary.readRetryEvidence[pathname] = Math.max(
      summary.readRetryEvidence[pathname] || 1,
      responseSummary.retryAttempts,
    );
  }
}

function captureTransportFailure(summary, field, error, code, phase) {
  const failure = summarizeTransportFailure(error);
  summary[field] = failure;
  updateRetryAttempts(summary, failure);
  summary.code = code;
  setDurableJournalBoundary(summary, phase);
}

function summarizeAuthSessionLifecycle(auth) {
  const session = auth?.session;
  if (!session || typeof session !== 'object') {
    return null;
  }

  const authUser = typeof auth?.identity?.userLogin === 'string'
    ? auth.identity.userLogin.trim()
    : '';

  return {
    id: session.id || null,
    type: session.type || null,
    status: session.status || null,
    expiresAt: session.expiresAt || null,
    expired: session.status === 'expired' || isExpiredSession(session),
    revoked: session.revoked === true || session.status === 'revoked',
    cleanedUp: session.cleanedUp === true || session.cleanup === true || session.status === 'cleaned-up',
    rotated: session.rotated === true ? true : session.rotated === false ? false : null,
    preserved: session.preserved === true ? true : session.preserved === false ? false : null,
    ...(authUser ? { authUser } : {}),
  };
}

function recordAuthSessionLifecycle(summary, step, auth) {
  const observation = summarizeAuthSessionLifecycle(auth);
  const trace = summary.authSessionLifecycleTrace || [];
  const previous = trace.length > 0 ? trace[trace.length - 1] : null;
  const lifecycle = {
    step,
    ...observation,
    rotated: Boolean(previous && previous.id && observation?.id && previous.id !== observation.id),
    preserved: Boolean(previous && previous.id && observation?.id && previous.id === observation.id),
    revoked: Boolean(observation?.revoked),
    cleanedUp: Boolean(observation?.cleanedUp),
  };

  trace.push(lifecycle);
  summary.authSessionLifecycleTrace = trace;
  summary.authSessionLifecycle = summary.authSessionLifecycle || {};
  summary.authSessionLifecycle.history = summary.authSessionLifecycle.history || [];
  summary.authSessionLifecycle.history.push({
    step,
    id: observation?.id || null,
    type: observation?.type || null,
    status: normalizeAuthSessionLifecycleHistoryStatus(observation),
    expiresAt: observation?.expiresAt || null,
    ...(observation?.authUser ? { authUser: observation.authUser } : {}),
    expired: Boolean(observation?.expired),
    revoked: Boolean(observation?.revoked),
    cleanedUp: Boolean(observation?.cleanedUp),
    rotated: lifecycle.rotated,
    preserved: lifecycle.preserved,
  });
  summary.authSessionLifecycleSummary = summarizeAuthSessionLifecycleHistory(
    summary.authSessionLifecycle.history,
  );
  const lifecycleSummary = summary.authSessionLifecycleSummary || {};
  if (step === 'preflight') {
    summary.authSessionLifecycle.minted = observation;
    summary.authSessionLifecycle.read = null;
    summary.authSessionLifecycle.expired = lifecycleSummary.expired || null;
    summary.authSessionLifecycle.revoked = lifecycleSummary.revoked || null;
    summary.authSessionLifecycle.cleanedUp = lifecycleSummary.cleanedUp || null;
    summary.authSessionLifecycle.rotated = lifecycleSummary.rotated || null;
    summary.authSessionLifecycle.preserved = lifecycleSummary.preserved || null;
    return;
  }

  summary.authSessionLifecycle[step === 'dry-run'
    ? 'dryRun'
    : step === 'recovery-inspect'
      ? 'recoveryInspect'
      : step === 'journal'
        ? 'journal'
        : step] = observation;
  summary.authSessionLifecycle.read = observation;
  summary.authSessionLifecycle.expired = lifecycleSummary.expired || null;
  summary.authSessionLifecycle.revoked = lifecycleSummary.revoked || null;
  summary.authSessionLifecycle.cleanedUp = lifecycleSummary.cleanedUp || null;
  summary.authSessionLifecycle.rotated = lifecycleSummary.rotated || null;
  summary.authSessionLifecycle.preserved = lifecycleSummary.preserved || null;
}

function normalizeAuthSessionLifecycleHistoryStatus(observation) {
  if (observation?.revoked) {
    return 'revoked';
  }
  if (observation?.cleanedUp) {
    return 'cleaned-up';
  }

  return observation?.status || null;
}

function summarizeAuthSessionLifecycleHistory(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return null;
  }

  const observations = history.filter((entry) => entry && typeof entry === 'object');
  return {
    issued: observations.find((entry) => entry.step === 'preflight') || null,
    read: [...observations].reverse().find((entry) => isAuthSessionReadStep(entry.step)) || null,
    expired: observations.find((entry) => entry.expired) || null,
    revoked: observations.find((entry) => entry.revoked) || null,
    cleanedUp: observations.find((entry) => entry.cleanedUp) || null,
    rotated: observations.find((entry) => entry.rotated) || null,
    preserved: observations.find((entry) => entry.preserved) || null,
    observations,
  };
}

function isAuthSessionReadStep(step) {
  return step === 'dry-run'
    || step === 'apply'
    || step === 'recovery-inspect'
    || step === 'replay'
    || step === 'journal';
}

function summarizeSnapshot(response, local) {
  if (response.status !== 200 || response.body?.ok !== true) {
    return summarizeResponse(response);
  }
  const snapshot = response.body.snapshot;
  return {
    status: response.status,
    ok: true,
    retryAttempts: response.retryAttempts || 1,
    snapshotHash: digest(snapshotContent(snapshot)),
    visibleSurfaceHash: digest(visibleSurface(snapshot)),
    finalMatchesLocal: digest(visibleSurface(snapshot)) === digest(visibleSurface(local)),
    request: response.request ? {
      method: response.request.method || null,
      pathname: response.request.pathname || null,
      retryable: response.request.retryable === true,
    } : undefined,
  };
}

function summarizeDbJournal(response) {
  if (response.status !== 200 || response.body?.ok !== true) {
    return summarizeResponse(response);
  }
  const rows = response.body.dbJournal?.latestRows || [];
  const storageGuard = summarizeDbJournalStorageGuard(response.body);
  return {
    status: response.status,
    ok: true,
    retryAttempts: response.retryAttempts || 1,
    scope: response.body?.dbJournal?.scope,
    rows: rows.length,
    applyCommitted: rows.some((entry) => entry.event === 'apply-committed'),
    mutationApplied: rows.filter((entry) => entry.event === 'mutation-applied').length,
    idempotencyOpened: rows.filter((entry) => entry.event === 'idempotency-opened').length,
    storageGuard,
    ownership: summarizeDbJournalOwnership(response.body?.dbJournal),
    writerLease: summarizeDbJournalWriterLease(response.body?.dbJournal?.writerLease),
    leaseFence: summarizeDbJournalLeaseFence(response.body?.dbJournal),
    authUser: response.body?.auth?.identity?.userLogin,
    authSessionId: response.body?.auth?.session?.id,
    sessionType: response.body?.auth?.session?.type,
    sessionStatus: response.body?.auth?.session?.status,
    sessionExpiresAt: response.body?.auth?.session?.expiresAt,
  };
}

export function dbJournalProofIsAcceptable(dbJournal, options = {}) {
  return dbJournalScopeIsTrusted(dbJournal?.scope)
    && dbJournal?.applyCommitted === true
    && dbJournal?.idempotencyOpened > 0
    && dbJournal?.mutationApplied > 0
    && dbJournalStorageGuardIsTrusted(dbJournal?.storageGuard)
    && dbJournalOwnershipIsTrusted(dbJournal?.ownership)
    && dbJournalLeaseFenceIsTrusted(dbJournal?.leaseFence, options);
}

function dbJournalScopeIsTrusted(scope) {
  if (typeof scope !== 'string' || scope.trim().length === 0) {
    return false;
  }

  if (/(^|; )local Playground fixture only|^fixture-scoped|not production durability/i.test(scope)) {
    return false;
  }

  return /production|checked|packaged|not local Playground fixture only/i.test(scope);
}

function dbJournalStorageGuardIsTrusted(storageGuard) {
  return (
    storageGuard?.boundary === 'filesystem-compare-rename'
    || storageGuard?.boundary === 'wpdb-single-statement-cas'
  )
    && storageGuard?.operation === 'update'
    && storageGuard?.outcome === 'applied';
}

function dbJournalOwnershipIsTrusted(ownership) {
  return ownership?.ownsJournal === true
    && ownership?.restartReadable === true
    && typeof ownership?.productionAdapter === 'string'
    && ownership.productionAdapter.trim().length > 0
    && ownership?.supportedSurface === checkedDbJournalSupportedSurface;
}

function dbJournalLeaseFenceIsTrusted(leaseFence, options = {}) {
  const requireStaleClaimRejected = options.requireStaleClaimRejected === true;
  const trustedBoundary = leaseFence?.boundary === 'filesystem-compare-rename'
    || leaseFence?.boundary === 'wpdb-single-statement-cas';

  return trustedBoundary
    && leaseFence?.claimKeyUnique === true
    && leaseFence?.monotonicSequence === true
    && leaseFence?.restartReadable === true
    && (!requireStaleClaimRejected || leaseFence?.staleClaimRejected === true);
}

function summarizeDbJournalStorageGuard(body) {
  const directStorageGuard = sanitizeStorageGuard(body?.storageGuard);
  if (directStorageGuard) {
    return directStorageGuard;
  }

  const rows = Array.isArray(body?.dbJournal?.latestRows)
    ? [...body.dbJournal.latestRows].reverse()
    : [];
  for (const row of rows) {
    const nestedStorageGuard = sanitizeStorageGuard(
      row?.result?.storageGuard
      || row?.resourceHashEvidence?.storageGuard
      || row?.resourceHashEvidence?.mutation?.storageGuard,
    );
    if (nestedStorageGuard) {
      return nestedStorageGuard;
    }
  }

  return undefined;
}

function summarizeDbJournalOwnership(dbJournal) {
  const ownership = dbJournal?.ownership;
  if (!ownership || typeof ownership !== 'object') {
    return undefined;
  }

  return {
    ownsJournal: ownership.ownsJournal === true,
    restartReadable: ownership.restartReadable === true,
    productionAdapter: ownership.productionAdapter || null,
    supportedSurface: ownership.supportedSurface || null,
  };
}

function summarizeDbJournalLeaseFence(dbJournal) {
  const leaseFence = dbJournal?.leaseFence;
  if (!leaseFence || typeof leaseFence !== 'object') {
    return undefined;
  }

  const summarizedWriterLease = summarizeDbJournalWriterLease(leaseFence.writerLease);

  return {
    boundary: leaseFence.boundary || null,
    claimKeyUnique: leaseFence.claimKeyUnique === true,
    fsyncEvidence: leaseFence.fsyncEvidence === true || summarizedWriterLease?.fsyncEvidence === true,
    monotonicSequence: leaseFence.monotonicSequence === true,
    restartReadable: leaseFence.restartReadable === true,
    staleClaimRejected: leaseFence.staleClaimRejected === true,
    writerLease: summarizedWriterLease,
  };
}

function summarizeDbJournalWriterLease(writerLease) {
  if (!writerLease || typeof writerLease !== 'object') {
    return undefined;
  }

  return {
    strategy: writerLease.strategy || null,
    claimKeyUnique: writerLease.claimKeyUnique === true,
    fsyncEvidence: writerLease.fsyncEvidence === true,
    storageGuard: writerLease.storageGuard || null,
    monotonicSequence: writerLease.monotonicSequence === true,
    restartReadable: writerLease.restartReadable === true,
    staleClaimRejected: writerLease.staleClaimRejected === true,
  };
}

function sanitizeStorageGuard(storageGuard) {
  if (!storageGuard || typeof storageGuard !== 'object') {
    return undefined;
  }

  return {
    boundary: storageGuard.boundary,
    operation: storageGuard.operation,
    outcome: storageGuard.outcome,
  };
}

function summarizeRecoveryInspect(response) {
  const recovery = response.body?.recovery;
  if (!recovery || typeof recovery !== 'object') {
    return undefined;
  }

  const journal = summarizeRecoveryInspectJournal(recovery.journal);
  const journalState = recovery.journal?.integrity?.status
    || (recovery.journalEvidence && typeof recovery.journalEvidence === 'object' ? 'ok' : undefined);

  return {
    authUser: response.body?.auth?.identity?.userLogin,
    authSessionId: response.body?.auth?.session?.id,
    sessionType: response.body?.auth?.session?.type,
    sessionStatus: response.body?.auth?.session?.status,
    sessionExpiresAt: response.body?.auth?.session?.expiresAt,
    state: recovery.state,
    counts: recovery.counts ? {
      old: recovery.counts.old,
      new: recovery.counts.new,
      blockedUnknown: recovery.counts.blockedUnknown,
      total: recovery.counts.total,
    } : undefined,
    journalState,
    journal,
  };
}

function summarizeRecoveryInspectJournal(journal) {
  if (!journal || typeof journal !== 'object') {
    return undefined;
  }

  const integrity = journal.integrity && typeof journal.integrity === 'object'
    ? {
        schemaVersion: journal.integrity.schemaVersion ?? null,
        status: journal.integrity.status ?? null,
        scope: journal.integrity.scope ?? null,
      }
    : undefined;

  return {
    scope: journal.scope || integrity?.scope || null,
    integrity,
    ownership: summarizeDbJournalOwnership(journal),
    writerLease: summarizeDbJournalWriterLease(journal.writerLease),
    leaseFence: summarizeDbJournalLeaseFence(journal),
  };
}

function summarizeReplayEquivalence(applyResponse, replayResponse) {
  const applyBody = applyResponse?.body || {};
  const replayBody = replayResponse?.body || {};
  const hasResponseSchemaVersion = applyBody.responseSchemaVersion !== undefined
    && replayBody.responseSchemaVersion !== undefined;
  const applySignedRequestDigest = digest(applyBody.signedRequest?.request || null);
  const replaySignedRequestDigest = digest(replayBody.signedRequest?.request || null);
  const replayCodeEquivalent = applyBody.code === replayBody.code
    || (
      replayBody.idempotency?.replayed === true
      && replayBody.code === 'BATCH_ALREADY_COMMITTED'
      && applyBody.ok === true
      && replayBody.ok === true
    );
  const replayReceiptEquivalent = applyBody.receipt?.receiptHash === replayBody.receipt?.receiptHash
    || (
      replayBody.idempotency?.replayed === true
      && !replayBody.receipt?.receiptHash
    );
  const equivalent = applyResponse?.status === replayResponse?.status
    && applyBody.mode === replayBody.mode
    && applyBody.ok === replayBody.ok
    && replayCodeEquivalent
    && applyBody.applied === replayBody.applied
    && replayReceiptEquivalent
    && hasResponseSchemaVersion
    && applyBody.responseSchemaVersion === replayBody.responseSchemaVersion
    && isStorageGuardEquivalent(applyBody.storageGuard, replayBody.storageGuard)
    && applyBody.auth?.identity?.userLogin === replayBody.auth?.identity?.userLogin
    && applyBody.auth?.session?.id === replayBody.auth?.session?.id
    && applyBody.auth?.session?.type === replayBody.auth?.session?.type
    && applyBody.auth?.session?.status === replayBody.auth?.session?.status
    && applyBody.auth?.session?.expiresAt === replayBody.auth?.session?.expiresAt
    && applyBody.signedRequest?.signed === replayBody.signedRequest?.signed
    && applyBody.signedRequest?.schemaVersion === replayBody.signedRequest?.schemaVersion
    && applyBody.signedRequest?.contentHash === replayBody.signedRequest?.contentHash
    && applyBody.signedRequest?.sessionHash === replayBody.signedRequest?.sessionHash
    && applyBody.signedRequest?.signingKeyHash === replayBody.signedRequest?.signingKeyHash
    && applySignedRequestDigest === replaySignedRequestDigest
    && applyBody.idempotency?.conflict === replayBody.idempotency?.conflict;
  const mismatches = equivalent ? [] : [
    ['status', applyResponse?.status, replayResponse?.status],
    ['mode', applyBody.mode, replayBody.mode],
    ['ok', applyBody.ok, replayBody.ok],
    replayCodeEquivalent ? ['code', undefined, undefined] : ['code', applyBody.code, replayBody.code],
    ['applied', applyBody.applied, replayBody.applied],
    replayReceiptEquivalent ? ['receiptHash', undefined, undefined] : ['receiptHash', applyBody.receipt?.receiptHash, replayBody.receipt?.receiptHash],
    ['responseSchemaVersion', hasResponseSchemaVersion ? applyBody.responseSchemaVersion : undefined, hasResponseSchemaVersion ? replayBody.responseSchemaVersion : undefined],
    ['authUser', applyBody.auth?.identity?.userLogin, replayBody.auth?.identity?.userLogin],
    ['authSessionId', applyBody.auth?.session?.id, replayBody.auth?.session?.id],
    ['authSessionType', applyBody.auth?.session?.type, replayBody.auth?.session?.type],
    ['authSessionStatus', applyBody.auth?.session?.status, replayBody.auth?.session?.status],
    ['authSessionExpiresAt', applyBody.auth?.session?.expiresAt, replayBody.auth?.session?.expiresAt],
    ['signedRequest.signed', applyBody.signedRequest?.signed, replayBody.signedRequest?.signed],
    ['signedRequest.schemaVersion', applyBody.signedRequest?.schemaVersion, replayBody.signedRequest?.schemaVersion],
    ['signedRequest.contentHash', applyBody.signedRequest?.contentHash, replayBody.signedRequest?.contentHash],
    ['signedRequest.sessionHash', applyBody.signedRequest?.sessionHash, replayBody.signedRequest?.sessionHash],
    ['signedRequest.signingKeyHash', applyBody.signedRequest?.signingKeyHash, replayBody.signedRequest?.signingKeyHash],
    ['signedRequest.requestDigest', applySignedRequestDigest, replaySignedRequestDigest],
    ['idempotency.conflict', applyBody.idempotency?.conflict, replayBody.idempotency?.conflict],
  ].filter(([, applyValue, replayValue]) => applyValue !== replayValue)
    .map(([field, applyValue, replayValue]) => ({ field, apply: applyValue, replay: replayValue }));
  return {
    equivalent,
    mismatches,
  };
}

function summarizeStorageGuard(storageGuard) {
  if (!storageGuard) {
    return null;
  }

  return {
    boundary: storageGuard.boundary || null,
    operation: storageGuard.operation || null,
    outcome: storageGuard.outcome || null,
  };
}

function isStorageGuardEquivalent(applyStorageGuard, replayStorageGuard) {
  return applyStorageGuard?.boundary === replayStorageGuard?.boundary
    && applyStorageGuard?.operation === replayStorageGuard?.operation
    && applyStorageGuard?.outcome === replayStorageGuard?.outcome;
}

function describeAuthEnvelopeDrift(expected, response) {
  const body = response?.body || {};
  if (!body.auth) {
    return {
      field: 'auth',
      required: expected.sessionType || 'auth-session',
      observed: 'missing',
      verdict: 'AUTH_SESSION_LIFECYCLE_DRIFT',
    };
  }

  const invalidObservedSessionField = resolveInvalidObservedAuthEnvelopeSessionField(body.auth?.session);
  if (invalidObservedSessionField) {
    return {
      field: `auth.session.${invalidObservedSessionField.field}`,
      required: 'string lifecycle fields',
      observed: `invalid-${invalidObservedSessionField.label}`,
      verdict: 'AUTH_SESSION_LIFECYCLE_DRIFT',
    };
  }

  const invalidObservedIdentityField = resolveInvalidObservedAuthEnvelopeIdentityField(body.auth?.identity);
  if (invalidObservedIdentityField) {
    return {
      field: `auth.identity.${invalidObservedIdentityField.field}`,
      required: 'string auth identity fields',
      observed: `invalid-${invalidObservedIdentityField.label}`,
      verdict: 'AUTH_SESSION_LIFECYCLE_DRIFT',
    };
  }

  const expectedUserLogin = expected.userLogin || 'missing';
  const observedUserLogin = body.auth?.identity?.userLogin || 'missing';
  if (observedUserLogin !== expectedUserLogin) {
    return {
      field: 'auth.identity.userLogin',
      required: expectedUserLogin,
      observed: observedUserLogin,
      verdict: 'AUTH_SESSION_LIFECYCLE_DRIFT',
    };
  }

  const expectedSessionId = expected.sessionId || 'missing';
  const observedSessionId = body.auth?.session?.id || 'missing';
  if (observedSessionId !== expectedSessionId) {
    return {
      field: 'auth.session.id',
      required: expectedSessionId,
      observed: observedSessionId,
      verdict: 'AUTH_SESSION_LIFECYCLE_DRIFT',
    };
  }

  const expectedSessionType = expected.sessionType || 'missing';
  const observedSessionType = body.auth?.session?.type || 'missing';
  if (observedSessionType !== expectedSessionType) {
    return {
      field: 'auth.session.type',
      required: expectedSessionType,
      observed: observedSessionType,
      verdict: 'AUTH_SESSION_LIFECYCLE_DRIFT',
    };
  }

  const expectedSessionStatus = expected.sessionStatus || 'missing';
  const observedSessionStatus = body.auth?.session?.status || 'missing';
  if (observedSessionStatus !== expectedSessionStatus) {
    return {
      field: 'auth.session.status',
      required: expectedSessionStatus,
      observed: observedSessionStatus,
      verdict: 'AUTH_SESSION_LIFECYCLE_DRIFT',
    };
  }

  const expectedSessionExpiresAt = expected.sessionExpiresAt || 'missing';
  const observedSessionExpiresAt = body.auth?.session?.expiresAt || 'missing';
  if (observedSessionExpiresAt !== expectedSessionExpiresAt) {
    return {
      field: 'auth.session.expiresAt',
      required: expectedSessionExpiresAt,
      observed: observedSessionExpiresAt,
      verdict: 'AUTH_SESSION_LIFECYCLE_DRIFT',
    };
  }

  return null;
}

function resolveProductionAuthSessionPreservationDrift(expected, response) {
  const expectedSessionId = typeof expected?.sessionId === 'string' ? expected.sessionId : '';
  if (!expectedSessionId) {
    return null;
  }

  const session = response?.body?.auth?.session;
  if (!session || typeof session !== 'object') {
    return null;
  }
  if (session.type !== 'production-auth-session') {
    return null;
  }

  const observedSessionId = typeof session.id === 'string' ? session.id.trim() : '';
  if (!observedSessionId) {
    return 'missing-session-id';
  }
  if (observedSessionId !== expectedSessionId) {
    return 'rotated';
  }

  return null;
}

function hasProductionAuthSessionTypeDrift(response) {
  return response?.body?.auth?.session?.type !== 'production-auth-session';
}

function hasProductionAuthSessionStatusDrift(response) {
  return response?.body?.auth?.session?.status !== 'active';
}

function hasMissingProductionAuthSessionIdentity(response) {
  const session = response?.body?.auth?.session;
  if (session?.type !== 'production-auth-session') {
    return false;
  }

  return !response?.body?.auth?.identity?.userLogin;
}

function hasMissingProductionAuthSessionEnvelopeId(response) {
  const session = response?.body?.auth?.session;
  if (session?.type !== 'production-auth-session') {
    return false;
  }

  return !(typeof session.id === 'string' && session.id.trim());
}

function resolveInvalidObservedProductionAuthIdentityField(response) {
  const session = response?.body?.auth?.session;
  if (session?.type !== 'production-auth-session') {
    return null;
  }

  return resolveInvalidObservedAuthEnvelopeIdentityField(response?.body?.auth?.identity);
}

function resolveInvalidObservedAuthEnvelopeIdentityField(identity) {
  if (!identity || typeof identity !== 'object') {
    return null;
  }

  const observedUserLogin = identity.userLogin;
  if (
    observedUserLogin !== undefined
    && observedUserLogin !== null
    && !normalizeProductionAuthSessionLifecycleField(observedUserLogin)
  ) {
    return {
      field: 'userLogin',
      label: 'user-login',
    };
  }

  return null;
}

function resolveInvalidObservedAuthEnvelopeSessionField(session) {
  if (!session || typeof session !== 'object') {
    return null;
  }

  const fieldChecks = [
    ['id', 'id', normalizeProductionAuthSessionLifecycleId(session.id)],
    ['type', 'type', normalizeProductionAuthSessionLifecycleField(session.type)],
    ['status', 'status', normalizeProductionAuthSessionLifecycleField(session.status)],
    ['expiresAt', 'expires-at', normalizeProductionAuthSessionLifecycleField(session.expiresAt)],
  ];

  for (const [field, label, normalized] of fieldChecks) {
    const value = session[field];
    if (value !== undefined && value !== null && !normalized) {
      return {
        field,
        label,
      };
    }
  }

  return null;
}

function resolveProductionAuthSessionIdentityMismatch(expectedUserLogin, response) {
  const requiredUserLogin = typeof expectedUserLogin === 'string'
    ? expectedUserLogin.trim()
    : '';
  if (!requiredUserLogin) {
    return null;
  }

  const session = response?.body?.auth?.session;
  if (session?.type !== 'production-auth-session') {
    return null;
  }

  const observedUserLogin = typeof response?.body?.auth?.identity?.userLogin === 'string'
    ? response.body.auth.identity.userLogin.trim()
    : '';
  if (!observedUserLogin || observedUserLogin === requiredUserLogin) {
    return null;
  }

  return observedUserLogin;
}

function resolveProductionAuthSessionIdentityContinuityDrift(expected, response) {
  const expectedUserLogin = typeof expected?.userLogin === 'string'
    ? expected.userLogin.trim()
    : '';
  if (!expectedUserLogin) {
    return null;
  }

  const session = response?.body?.auth?.session;
  if (session?.type !== 'production-auth-session') {
    return null;
  }

  const observedUserLogin = typeof response?.body?.auth?.identity?.userLogin === 'string'
    ? response.body.auth.identity.userLogin.trim()
    : '';
  if (!observedUserLogin || observedUserLogin === expectedUserLogin) {
    return null;
  }

  return observedUserLogin;
}

function resolveProductionAuthSessionCleanupEvidenceDrift(response) {
  const session = response?.body?.auth?.session;
  if (session?.type !== 'production-auth-session') {
    return null;
  }

  const cleanup = response?.body?.sessionStore?.cleanup;
  if (!cleanup || typeof cleanup !== 'object') {
    return null;
  }

  const sessionOptions = cleanup.sessionOptions;
  const nonceOptions = cleanup.nonceOptions;
  if (
    cleanup.schemaVersion !== 1
    || cleanup.store !== 'wp-options'
    || !Number.isInteger(cleanup.deletedExpiredTotal)
    || !sessionOptions
    || typeof sessionOptions !== 'object'
    || !nonceOptions
    || typeof nonceOptions !== 'object'
    || !Number.isInteger(sessionOptions.deletedExpired)
    || !Number.isInteger(nonceOptions.deletedExpired)
    || !Number.isInteger(sessionOptions.retainedUnexpired)
    || !Number.isInteger(nonceOptions.retainedUnexpired)
    || sessionOptions.retainedUnexpired < 1
    || nonceOptions.retainedUnexpired < 1
    || sessionOptions.limitReached !== false
    || nonceOptions.limitReached !== false
  ) {
    return 'invalid-session-store-cleanup';
  }

  return null;
}

function hasValidProductionAuthSessionCleanupEvidence(response) {
  const session = response?.body?.auth?.session;
  if (session?.type !== 'production-auth-session') {
    return false;
  }

  return Boolean(response?.body?.sessionStore?.cleanup)
    && resolveProductionAuthSessionCleanupEvidenceDrift(response) === null;
}

function isMissingProductionAuthSessionCleanupEvidence(response) {
  const session = response?.body?.auth?.session;
  if (session?.type !== 'production-auth-session') {
    return false;
  }

  return !response?.body?.sessionStore?.cleanup;
}

function hasMissingProductionAuthSessionExpiry(response) {
  const session = response?.body?.auth?.session;
  return session?.type === 'production-auth-session' && !session?.expiresAt;
}

function hasProductionAuthSessionExpiryDrift(response) {
  return isExpiredSession(response?.body?.auth?.session);
}

function hasExpiredAuthSession(response) {
  return isExpiredSession(response?.body?.auth?.session);
}

function resolveObservedProductionAuthSessionLifecycleDrift(response) {
  const session = response?.body?.auth?.session;
  const invalidLifecycleFlag = resolveInvalidProductionAuthSessionLifecycleFlag(session);
  if (invalidLifecycleFlag) {
    return {
      required: 'boolean lifecycle flags',
      observed: `invalid-${invalidLifecycleFlag}`,
    };
  }

  const invalidIdentityField = resolveInvalidProductionAuthSessionIdentityField(session);
  if (invalidIdentityField) {
    return {
      field: `auth.session.${invalidIdentityField.field}`,
      required: 'string lifecycle fields',
      observed: `invalid-${invalidIdentityField.label}`,
    };
  }

  const observedType = normalizeProductionAuthSessionLifecycleField(session?.type) ?? 'missing';
  const observedStatus = normalizeProductionAuthSessionLifecycleField(session?.status) ?? 'missing';
  const observedExpiresAt = normalizeProductionAuthSessionLifecycleField(session?.expiresAt) ?? 'missing';

  if (observedType !== 'production-auth-session') {
    return {
      required: 'production-auth-session',
      observed: observedType,
    };
  }

  if (
    session?.revoked === true
    || session?.status === 'revoked'
    || session?.cleanedUp === true
    || session?.cleanup === true
    || session?.status === 'cleaned-up'
  ) {
    return {
      field: resolveProductionAuthSessionUnrevokedField(session),
      required: 'unrevoked',
      observed: session?.revoked === true || session?.status === 'revoked' ? 'revoked' : 'cleaned-up',
    };
  }

  if (session?.rotated === true || session?.status === 'rotated') {
    return {
      field: session?.rotated === true ? 'auth.session.rotated' : 'auth.session.status',
      required: 'preserved read',
      observed: 'rotated',
    };
  }

  if (session?.status === 'expired' || isExpiredSession(session)) {
    return {
      field: session?.status === 'expired' ? 'auth.session.status' : 'auth.session.expiresAt',
      required: 'unexpired',
      observed: observedStatus === 'expired' ? 'expired' : observedExpiresAt,
    };
  }
  if (observedStatus !== 'active') {
    return {
      required: 'active',
      observed: observedStatus,
    };
  }

  if (!observedExpiresAt || observedExpiresAt === 'missing') {
    return {
      required: 'unexpired',
      observed: observedExpiresAt,
    };
  }

  return null;
}

function resolveInvalidProductionAuthSessionLifecycleFlag(session) {
  if (!session || typeof session !== 'object') {
    return null;
  }

  const lifecycleFlags = [
    ['revoked', session.revoked],
    ['cleanedUp', session.cleanedUp],
    ['cleanup', session.cleanup],
    ['expired', session.expired],
    ['rotated', session.rotated],
    ['preserved', session.preserved],
  ];

  for (const [name, value] of lifecycleFlags) {
    if (value !== undefined && value !== null && typeof value !== 'boolean') {
      return name;
    }
  }

  return null;
}

function resolveInvalidProductionAuthSessionIdentityField(session) {
  if (!session || typeof session !== 'object') {
    return null;
  }

  if (session.id !== undefined && session.id !== null && !normalizeProductionAuthSessionLifecycleId(session.id)) {
    return {
      field: 'id',
      label: 'id',
    };
  }

  const identityFields = [
    ['type', 'type'],
    ['status', 'status'],
    ['expiresAt', 'expires-at'],
  ];

  for (const [field, label] of identityFields) {
    const value = session[field];
    if (value !== undefined && value !== null && !normalizeProductionAuthSessionLifecycleField(value)) {
      return {
        field,
        label,
      };
    }
  }

  return null;
}

function normalizeProductionAuthSessionLifecycleId(id) {
  if (typeof id !== 'string') {
    return null;
  }

  const normalized = id.trim();
  if (!normalized || normalized !== id || /[\u0000-\u001f\u007f]/.test(normalized)) {
    return null;
  }

  return normalized;
}

function normalizeProductionAuthSessionLifecycleField(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (!normalized || normalized !== value || /[\u0000-\u001f\u007f]/.test(normalized)) {
    return null;
  }

  return normalized;
}

function setProductionAuthSessionBoundary(summary) {
  if (summary.boundary) {
    return;
  }

  summary.boundary = {
    firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
    status: 'unimplemented',
    verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    authSession: summary.authSession || {
      required: 'production-auth-session',
      observed: 'missing',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    },
  };
}

function describeRequiredUnrevokedProductionAuthSession(response) {
  const session = response?.body?.auth?.session;
  return {
    field: resolveProductionAuthSessionUnrevokedField(session),
    required: 'unrevoked',
    observed: session?.revoked === true || session?.status === 'revoked'
      ? 'revoked'
      : 'cleaned-up',
    verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
  };
}

function resolveProductionAuthSessionUnrevokedField(session) {
  if (session?.revoked === true || session?.status === 'revoked') {
    return 'auth.session.status';
  }

  if (session?.status === 'cleaned-up') {
    return 'auth.session.status';
  }

  if (session?.cleanedUp === true) {
    return 'auth.session.cleanedUp';
  }

  return 'auth.session.cleanup';
}
function hasProductionAuthSessionRevocationDrift(response) {
  const session = response?.body?.auth?.session;
  if (!session || typeof session !== 'object') {
    return false;
  }
  return session.revoked === true
    || session.status === 'revoked'
    || session.cleanedUp === true
    || session.cleanup === true
    || session.status === 'cleaned-up';
}

function isExpiredSession(session) {
  if (!session || typeof session !== 'object') {
    return false;
  }
  if (session.status === 'expired') {
    return true;
  }
  const expiresAt = session.expiresAt;
  if (!expiresAt) {
    return false;
  }
  const expiresAtMs = Date.parse(expiresAt);
  return !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now();
}

function setDurableJournalBoundary(summary, phase) {
  if (summary.boundary) {
    return;
  }

  summary.boundary = {
    firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
    status: 'unimplemented',
    verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
    durableJournal: {
      storageLeaseFence: 'retained Playground journal storage is lab-scoped; production ownership, lease fencing, and replay wiring are not yet proven on the checked release boundary',
      verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
      phase,
    },
  };
}

function setReplayAndRetryBoundary(summary) {
  if (summary.boundary) {
    return;
  }

  summary.boundary = {
    firstRemainingProductionBoundary: 'replay and preserved-remote retry on the checked release path',
    status: 'unimplemented',
    verdict: 'PRESERVED_REMOTE_RETRY_REQUIRED',
    replayAndRetry: summary.replayAndRetry || {
      required: 'preserved-remote retry',
      observed: 'missing-transient-retry',
      verdict: 'PRESERVED_REMOTE_RETRY_REQUIRED',
    },
    durableJournal: {
      storageLeaseFence: 'production durable journal storage, lease fencing, and replay wiring are not yet proven on the checked release boundary',
      verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
    },
  };
}

async function requestJson(baseUrl, method, pathname, body = undefined, headers = {}, requestTimeoutMs = 10_000, options = {}) {
  return requestJsonRaw(
    baseUrl,
    method,
    pathname,
    body === undefined ? undefined : JSON.stringify(body),
    headers,
    requestTimeoutMs,
    options,
  );
}

async function requestJsonRaw(baseUrl, method, pathname, rawBody = undefined, headers = {}, requestTimeoutMs = 10_000, options = {}) {
  const retryable = options.retryable === true || isRetryableReadOnlyGet(baseUrl, method, pathname, headers);
  const attempts = retryable ? transientFetchAttempts : 1;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      if (typeof options.beforeAttempt === 'function') {
        options.beforeAttempt({
          baseUrl,
          method,
          pathname,
          attempt,
        });
      }
      const response = await requestJsonRawOnce(baseUrl, method, pathname, rawBody, headers, requestTimeoutMs);
      return {
        ...response,
        attempts,
        retryAttempts: attempt,
        request: {
          method,
          pathname,
          retryable,
        },
      };
    } catch (error) {
      lastError = error;
      if (!retryable || !isTransientFetchError(error) || attempt === attempts) {
        throw decorateRequestError(error, {
          method,
          pathname,
          retryable,
          retryAttempts: attempt,
        });
      }
      await sleep(transientFetchRetryDelayMs * attempt);
    }
  }
  throw lastError;
}

async function requestJsonRawOnce(baseUrl, method, pathname, rawBody = undefined, headers = {}, requestTimeoutMs = 10_000) {
  const requestHeaders = rawBody === undefined
    ? withConnectionClose(headers)
    : withConnectionClose({
      'content-type': 'application/json',
      ...headers,
    });
  const timeoutSignal = AbortSignal.timeout(requestTimeoutMs);
  const response = await fetch(new URL(pathname, baseUrl), {
    method,
    headers: requestHeaders,
    body: rawBody,
    signal: timeoutSignal,
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`Expected JSON from ${method} ${pathname}, got HTTP ${response.status}\n${text}\n${error.message}`);
  }
  return {
    status: response.status,
    body: json,
  };
}

function isRetryableReadOnlyGet(baseUrl, method, pathname, headers) {
  if (method !== 'GET' || hasHeader(headers, authNonceHeader)) {
    return false;
  }

  const url = new URL(pathname, baseUrl);
  if (!retryableReadOnlyGetPaths.has(url.pathname)) {
    return false;
  }

  for (const key of sideEffectQueryParams) {
    if (url.searchParams.has(key)) {
      return false;
    }
  }

  return true;
}

function hasHeader(headers, headerName) {
  const target = headerName.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === target);
}

function withConnectionClose(headers) {
  return {
    connection: 'close',
    ...headers,
  };
}

function createTransientReadFailureProbe(baseUrl, namespacePath, pathSuffix) {
  if (!pathSuffix) {
    return null;
  }

  const targetPath = new URL(`${namespacePath}${pathSuffix}`, baseUrl).pathname;
  let pending = true;
  return ({ method, pathname, attempt }) => {
    if (!pending || method !== 'GET' || attempt !== 1) {
      return;
    }
    const requestPath = new URL(pathname, baseUrl).pathname;
    if (requestPath !== targetPath) {
      return;
    }
    pending = false;
    throw Object.assign(new TypeError(`simulated transient read failure for ${requestPath}`), {
      cause: { code: 'ECONNRESET' },
    });
  };
}

function isTransientFetchError(error) {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = error.cause?.code || error.code;
  return error.name === 'TimeoutError'
    || error.name === 'AbortError'
    || (
      error.name === 'TypeError' && (
    code === 'UND_ERR_SOCKET'
    || code === 'ECONNRESET'
    || code === 'EPIPE'
    || code === 'ETIMEDOUT'
      )
    );
}

function decorateRequestError(error, request) {
  if (!error || typeof error !== 'object') {
    return Object.assign(new Error(String(error)), request ? {
      request,
      retryAttempts: request.retryAttempts,
    } : {});
  }

  error.request = request;
  error.retryAttempts = request?.retryAttempts || error.retryAttempts || 1;
  return error;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function signedRequestHeaders(credential, method, pathname, rawBody, options = {}) {
  const contentHash = sha256Hex(rawBody);
  const timestamp = options.timestamp || currentSignedTimestamp();
  const nonce = options.nonce || nextSignedNonce('cli-push');
  const signingKey = labSigningKey(credential);
  const authString = `${nonce}${timestamp}${contentHash}`;
  const canonical = pushCanonicalString({
    method,
    pathname,
    contentHash,
    session: options.session || '',
    idempotencyKey: options.idempotencyKey || '',
  });
  const headers = {
    ...authHeaders(credential),
    [authContentHashHeader]: contentHash,
    [authTimestampHeader]: timestamp,
    [authNonceHeader]: nonce,
    [authSignatureHeader]: hmacHex(signingKey, authString),
    [pushSignatureHeader]: hmacHex(signingKey, canonical),
  };

  if (options.session !== undefined) {
    headers[sessionHeader] = options.session;
  }
  if (options.idempotencyKey !== undefined) {
    headers[idempotencyHeader] = options.idempotencyKey;
  }

  return headers;
}

function pushCanonicalString({ method, pathname, contentHash, session, idempotencyKey }) {
  const [rawPath, rawQuery = ''] = pathname.split('?', 2);
  return [
    'REPRINT-PUSH-LAB-V1',
    method.toUpperCase(),
    rawPath || '/',
    canonicalQuery(rawQuery),
    contentHash,
    session,
    idempotencyKey,
  ].join('\n');
}

function canonicalQuery(query) {
  if (!query) {
    return '';
  }

  return query
    .split('&')
    .map((part, index) => {
      if (!part) {
        return null;
      }
      const [key, value = ''] = part.split('=', 2);
      return {
        key: rawUrlDecodeQueryPart(key),
        value: rawUrlDecodeQueryPart(value),
        index,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.key !== b.key) {
        return a.key < b.key ? -1 : 1;
      }
      if (a.value !== b.value) {
        return a.value < b.value ? -1 : 1;
      }
      return a.index - b.index;
    })
    .map((pair) => `${rawUrlEncode(pair.key)}=${rawUrlEncode(pair.value)}`)
    .join('&');
}

function rawUrlDecodeQueryPart(value) {
  return decodeURIComponent(value.replace(/\+/g, '%20'));
}

function rawUrlEncode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function appendQueryParam(pathname, rawQueryPart) {
  if (!rawQueryPart) {
    return pathname;
  }
  return `${pathname}${pathname.includes('?') ? '&' : '?'}${rawQueryPart}`;
}

function hasSideEffectQueryParam(pathname) {
  const [, rawQuery = ''] = pathname.split('?', 2);
  if (!rawQuery) {
    return false;
  }

  const searchParams = new URLSearchParams(rawQuery);
  for (const key of sideEffectQueryParams) {
    if (searchParams.has(key)) {
      return true;
    }
  }

  return false;
}

function labSigningKey(credential) {
  return hmacHex(credential.password, `reprint-push-lab-v1\n${credential.username}`);
}

function authHeaders(credential) {
  return {
    authorization: `Basic ${Buffer.from(`${credential.username}:${credential.password}`, 'utf8').toString('base64')}`,
  };
}

function assertMutatingRequestOptions(pathname, options) {
  if (options.session === undefined || options.session === '') {
    throw new Error(`Missing push session for mutating request: ${pathname}`);
  }
  if (!isValidPushSession(options.session)) {
    throw new Error(`Invalid push session for mutating request: ${pathname}`);
  }
  if (options.idempotencyKey === undefined || options.idempotencyKey === '') {
    throw new Error(`Missing push idempotencyKey for mutating request: ${pathname}`);
  }
  if (typeof options.idempotencyKey !== 'string' || options.idempotencyKey.trim() !== options.idempotencyKey || !/^\S+$/.test(options.idempotencyKey)) {
    throw new Error(`Invalid push idempotencyKey for mutating request: ${pathname}`);
  }
}

function isValidPushSession(session) {
  return /^psh_[A-Za-z0-9_-]{8,}$/.test(session)
    || /^[A-Za-z0-9_-]{32,160}$/.test(session);
}

function hmacHex(key, data) {
  return createHmac('sha256', key).update(data, 'utf8').digest('hex');
}

function sha256Hex(data) {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function currentSignedTimestamp() {
  return String(Math.floor(Date.now() / 1000));
}

function nextSignedNonce(prefix) {
  return `${prefix}-${Date.now()}-${randomBytes(6).toString('hex')}`;
}

function normalizeBaseUrl(sourceUrl) {
  const parsed = new URL(sourceUrl);
  parsed.hash = '';
  parsed.search = '';
  if (!parsed.pathname.endsWith('/')) {
    parsed.pathname += '/';
  }
  return parsed;
}

function assertSupportedSourceUrlForRouteProfile(baseUrl, profile) {
  if (profile.name !== 'production-shaped') {
    return;
  }

  if (baseUrl.protocol === 'https:') {
    return;
  }

  if (baseUrl.protocol === 'http:' && isLoopbackHost(baseUrl.hostname)) {
    return;
  }

  throw new Error(
    `Unsupported production-shaped sourceUrl origin: ${baseUrl.origin}. Use https for remote production-shaped origins, or a local-only loopback origin / the sandbox-provided 8080 ingress for http.`,
  );
}

function isLoopbackHost(hostname) {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname === '[::1]'
    || hostname.startsWith('127.');
}

function redactUrl(sourceUrl) {
  const parsed = new URL(sourceUrl);
  parsed.username = '';
  parsed.password = '';
  return parsed.toString();
}

function snapshotContent(snapshot) {
  return {
    meta: {
      source: snapshot?.meta?.source,
      fixture: snapshot?.meta?.fixture,
      table_prefix: snapshot?.meta?.table_prefix,
    },
    ...visibleSurface(snapshot),
  };
}

function visibleSurface(snapshot) {
  return {
    files: snapshot?.files,
    db: snapshot?.db,
    plugins: snapshot?.plugins,
  };
}
