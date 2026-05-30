import { createHash, createHmac, randomBytes } from 'node:crypto';
import { createPushPlan } from './planner.js';
import {
  checkedDurableJournalBoundarySatisfied,
  productionRecoveryJournalInspectionSurfaceIsPresent,
} from './recovery-journal.js';
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
const minimumDbJournalReadbackLimit = 80;
const maximumDbJournalReadbackLimit = 500;
const maximumDbJournalReadbackPages = 20;
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
  proveDurableJournalBoundary = false,
  labAuthSessionDrift = '',
  authSessionSource = null,
  requestTimeoutMs = 10_000,
  now = new Date(),
  readOnlyInspectRequests = false,
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
    requestTimeoutMs,
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
    idempotencyConflict: null,
    after: null,
    dbJournal: null,
    inspectAuthMode: readOnlyInspectRequests ? 'read-only-session-bound' : 'legacy-idempotency-bound',
    authSessionLifecycleTrace: [],
    retryAttempts: 1,
    readRetryEvidence: {},
    latestReadRetryEvidence: {},
  };
  const observationNow = normalizeObservationNow(now);
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
  recordAuthSessionLifecycle(summary, 'preflight', preflight.body?.auth, observationNow);
  const preflightObservedLifecycleDrift = requireProductionAuthSession
    ? resolveObservedProductionAuthSessionLifecycleDrift(preflight, observationNow)
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
  if (isExpiredSession(preflight.body.auth?.session, observationNow)) {
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
    userId: normalizeObservedAuthIdentityUserId(preflight.body?.auth?.identity?.userId),
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
      required: preflightInvalidIdentityField.required,
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
  if (requireProductionAuthSession && isExpiredSession(preflight.body.auth?.session, observationNow)) {
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
  recordAuthSessionLifecycle(summary, 'dry-run', dryRun.body?.auth, observationNow);
  const dryRunObservedLifecycleDrift = requireProductionAuthSession
    ? resolveObservedProductionAuthSessionLifecycleDrift(dryRun, observationNow)
    : null;
  const dryRunAuthEnvelopeDrift = requireProductionAuthSession
    ? describeAuthEnvelopeDrift(preflightAuthEnvelope, dryRun)
    : null;
  const dryRunUncheckedAuthMetadataDrift = resolveUncheckedObservedAuthSessionMetadataDrift(
    preflightAuthEnvelope,
    dryRun,
  );
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
      required: dryRunInvalidIdentityField.required,
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
  const dryRunIdentityUserIdDrift = requireProductionAuthSession
    ? resolveProductionAuthSessionIdentityUserIdDrift(preflightAuthEnvelope, dryRun)
    : null;
  if (dryRunIdentityUserIdDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      ...dryRunIdentityUserIdDrift,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }
  const dryRunSessionIdentityDrift = requireProductionAuthSession
    ? resolveProductionAuthSessionIdentityDrift(preflightAuthEnvelope, dryRun)
    : null;
  if (dryRunSessionIdentityDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      ...dryRunSessionIdentityDrift,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
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
  if (dryRunUncheckedAuthMetadataDrift) {
    summary.code = 'AUTH_SESSION_LIFECYCLE_DRIFT';
    summary.authSession = dryRunUncheckedAuthMetadataDrift;
    setDurableJournalBoundary(summary, 'dry-run');
    return summary;
  }
  const dryRunReceiptExpiry = resolveExpiredReceipt(dryRun.body.receipt, observationNow);
  if (dryRunReceiptExpiry) {
    summary.code = 'AUTH_RECEIPT_EXPIRED';
    summary.receiptExpiry = {
      phase: 'dry-run',
      ...dryRunReceiptExpiry,
    };
    setReceiptExpiryBoundary(summary);
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
    const oldRemoteRecovery = summarizeOldRemoteRecoveryClassification(staleClaimAttempt, plan);
    if (oldRemoteRecovery) {
      summary.staleClaimRetry.oldRemoteRecovery = oldRemoteRecovery;
      summary.staleClaimRetry.abandoned.recovery = oldRemoteRecovery;
    }
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
  recordAuthSessionLifecycle(summary, 'apply', apply.body?.auth, observationNow);
  const applyObservedLifecycleDrift = requireProductionAuthSession
    ? resolveObservedProductionAuthSessionLifecycleDrift(apply, observationNow)
    : null;
  const applyUncheckedAuthMetadataDrift = resolveUncheckedObservedAuthSessionMetadataDrift(
    preflightAuthEnvelope,
    apply,
  );
  if (apply.status !== 200 || apply.body?.ok !== true) {
    summary.code = apply.body?.code || 'APPLY_FAILED';
    if (summary.code === 'AUTH_RECEIPT_EXPIRED') {
      summary.receiptExpiry = {
        phase: 'apply',
        ...describeApplyReceiptExpiryFailure(applyPayload.receipt, apply, observationNow),
      };
      setReceiptExpiryBoundary(summary);
      return summary;
    }
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
  if (applyUncheckedAuthMetadataDrift) {
    summary.code = 'AUTH_SESSION_LIFECYCLE_DRIFT';
    summary.authSession = applyUncheckedAuthMetadataDrift;
    setDurableJournalBoundary(summary, 'apply');
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
      required: applyInvalidIdentityField.required,
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
  const applyIdentityUserIdDrift = requireProductionAuthSession
    ? resolveProductionAuthSessionIdentityUserIdDrift(preflightAuthEnvelope, apply)
    : null;
  if (applyIdentityUserIdDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      ...applyIdentityUserIdDrift,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }
  const applySessionIdentityDrift = requireProductionAuthSession
    ? resolveProductionAuthSessionIdentityDrift(preflightAuthEnvelope, apply)
    : null;
  if (applySessionIdentityDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      ...applySessionIdentityDrift,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
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
  if (hasExpiredAuthSession(apply, observationNow)) {
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
  const applyRevalidationDrift = requireProductionAuthSession && !simulateStaleClaimRetry
    ? resolveApplyRevalidationDrift(summary.apply?.applyRevalidation, plan, dryRun.body.receipt)
    : null;
  if (applyRevalidationDrift) {
    summary.applyRevalidation = applyRevalidationDrift;
  } else {
    summary.applyRevalidation = summary.apply?.applyRevalidation;
  }

  let recoveryInspect;
  try {
    recoveryInspect = await client.signedPost(withAuthSessionDrift('/recovery/inspect'), {
      plan,
      receipt: dryRun.body.receipt,
    }, readOnlyInspectOptions({
      session,
      idempotencyKey,
      readOnlyInspectRequests,
      retryable: true,
    }));
  } catch (error) {
    captureTransportFailure(summary, 'recoveryInspect', error, 'RECOVERY_INSPECT_FAILED', 'recovery-inspect');
    return summary;
  }
  summary.recoveryInspect = summarizeResponse(recoveryInspect);
  updateRetryAttempts(summary, summary.recoveryInspect);
  recordAuthSessionLifecycle(summary, 'recovery-inspect', recoveryInspect.body?.auth, observationNow);
  const recoveryInspectObservedLifecycleDrift = requireProductionAuthSession
    ? resolveObservedProductionAuthSessionLifecycleDrift(recoveryInspect, observationNow)
    : null;
  const recoveryInspectUncheckedAuthMetadataDrift = resolveUncheckedObservedAuthSessionMetadataDrift(
    preflightAuthEnvelope,
    recoveryInspect,
  );
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
  if (recoveryInspectUncheckedAuthMetadataDrift) {
    summary.code = 'AUTH_SESSION_LIFECYCLE_DRIFT';
    summary.authSession = recoveryInspectUncheckedAuthMetadataDrift;
    setDurableJournalBoundary(summary, 'recovery-inspect');
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
      required: recoveryInspectInvalidIdentityField.required,
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
  const recoveryInspectIdentityUserIdDrift = requireProductionAuthSession
    ? resolveProductionAuthSessionIdentityUserIdDrift(preflightAuthEnvelope, recoveryInspect)
    : null;
  if (recoveryInspectIdentityUserIdDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      ...recoveryInspectIdentityUserIdDrift,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }
  const recoveryInspectSessionIdentityDrift = requireProductionAuthSession
    ? resolveProductionAuthSessionIdentityDrift(preflightAuthEnvelope, recoveryInspect)
    : null;
  if (recoveryInspectSessionIdentityDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      ...recoveryInspectSessionIdentityDrift,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
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
  if (hasExpiredAuthSession(recoveryInspect, observationNow)) {
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
  const recoveryInspectProductionJournal = recoveryInspectClaimsProductionRecoveryJournalSurface(
    recoveryInspect.body?.recovery,
  )
    ? recoveryInspectProductionJournalInspection(recoveryInspect.body?.recovery)
    : null;
  if (recoveryInspectProductionJournal
    && !productionRecoveryJournalInspectionSurfaceIsPresent(recoveryInspectProductionJournal)) {
    summary.code = 'RECOVERY_INSPECT_JOURNAL_UNTRUSTED';
    setDurableJournalBoundary(summary, 'recovery-inspect');
    return summary;
  }
  if (recoveryInspectProductionJournal) {
    summary.recoveryInspect.recovery.journal = recoveryInspectProductionJournal.journal;
    summary.recoveryInspect.recovery.claim = recoveryInspectProductionJournal.claim;
    summary.recoveryInspect.recovery.leaseFence = recoveryInspectProductionJournal.leaseFence;
    summary.recoveryInspect.recovery.productionJournal = recoveryInspectProductionJournal;
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
  recordAuthSessionLifecycle(summary, 'replay', replay.body?.auth, observationNow);
  const replayObservedLifecycleDrift = requireProductionAuthSession
    ? resolveObservedProductionAuthSessionLifecycleDrift(replay, observationNow)
    : null;
  const replayUncheckedAuthMetadataDrift = resolveUncheckedObservedAuthSessionMetadataDrift(
    preflightAuthEnvelope,
    replay,
  );
  summary.replay.responseSchemaVersion = replay.body?.responseSchemaVersion;
  const replayEquivalence = summarizeReplayEquivalence(apply, replay, observationNow);
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
  if (replayUncheckedAuthMetadataDrift) {
    summary.code = 'AUTH_SESSION_LIFECYCLE_DRIFT';
    summary.authSession = replayUncheckedAuthMetadataDrift;
    setDurableJournalBoundary(summary, 'replay');
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
      required: replayInvalidIdentityField.required,
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
  const replayIdentityUserIdDrift = requireProductionAuthSession
    ? resolveProductionAuthSessionIdentityUserIdDrift(preflightAuthEnvelope, replay)
    : null;
  if (replayIdentityUserIdDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      ...replayIdentityUserIdDrift,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }
  const replaySessionIdentityDrift = requireProductionAuthSession
    ? resolveProductionAuthSessionIdentityDrift(preflightAuthEnvelope, replay)
    : null;
  if (replaySessionIdentityDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      ...replaySessionIdentityDrift,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
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
  if (hasExpiredAuthSession(replay, observationNow)) {
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

  if (proveDurableJournalBoundary) {
    let conflict;
    try {
      conflict = await client.signedPost(withAuthSessionDrift('/apply'), idempotencyConflictPayload(applyPayload), {
        session,
        idempotencyKey,
      });
    } catch (error) {
      captureTransportFailure(summary, 'idempotencyConflict', error, 'IDEMPOTENCY_CONFLICT_PROOF_FAILED', 'replay');
      return summary;
    }

    summary.idempotencyConflict = summarizeResponse(conflict);
    updateRetryAttempts(summary, summary.idempotencyConflict);
    const conflictAuthEnvelopeDrift = describeAuthEnvelopeDrift(preflightAuthEnvelope, conflict);
    if (conflictAuthEnvelopeDrift) {
      summary.code = 'AUTH_SESSION_LIFECYCLE_DRIFT';
      summary.authSession = conflictAuthEnvelopeDrift;
      setDurableJournalBoundary(summary, 'replay');
      return summary;
    }

    let afterConflict;
    try {
      afterConflict = await client.get('/snapshot');
    } catch (error) {
      captureTransportFailure(summary, 'after', error, 'SNAPSHOT_FAILED', 'replay');
      return summary;
    }

    const beforeConflictSurfaceHash = digest(visibleSurface(afterApply.body.snapshot));
    const afterConflictSurfaceHash = digest(visibleSurface(afterConflict.body.snapshot));
    summary.idempotencyConflict.targetSnapshotUnchanged = beforeConflictSurfaceHash === afterConflictSurfaceHash;
    summary.idempotencyConflict.finalMatchesLocal = digest(visibleSurface(afterConflict.body.snapshot)) === digest(visibleSurface(local));
    summary.idempotencyConflict.hashOnly = hasHashOnlyIdempotencyConflictEvidence(conflict.body?.idempotency);
    summary.after = summarizeSnapshot(afterConflict, local);
    updateRetryAttempts(summary, summary.after);
    summary.afterObject = afterConflict.body.snapshot;

    if (
      conflict.status !== 409
      || conflict.body?.ok !== false
      || conflict.body?.code !== 'IDEMPOTENCY_KEY_CONFLICT'
      || conflict.body?.idempotency?.conflict !== true
      || conflict.body?.idempotency?.freshMutationWork !== false
      || summary.idempotencyConflict.hashOnly !== true
      || summary.idempotencyConflict.targetSnapshotUnchanged !== true
    ) {
      summary.code = conflict.body?.code || 'IDEMPOTENCY_CONFLICT_PROOF_FAILED';
      setDurableJournalBoundary(summary, 'replay');
      return summary;
    }
  }

  let dbJournal;
  try {
    dbJournal = await fetchDbJournalReadback(client, {
      plan,
      session,
      idempotencyKey,
      readOnlyInspectRequests,
      withAuthSessionDrift,
    });
  } catch (error) {
    captureTransportFailure(summary, 'dbJournal', error, 'DURABLE_JOURNAL_NOT_PROVEN', 'journal-inspect');
    return summary;
  }
  summary.dbJournal = summarizeDbJournal(dbJournal);
  updateRetryAttempts(summary, summary.dbJournal);
  const dbJournalHasAuthEnvelope = dbJournal.body?.auth && typeof dbJournal.body.auth === 'object';
  if (dbJournalHasAuthEnvelope) {
    recordAuthSessionLifecycle(summary, 'journal', dbJournal.body.auth, observationNow);
  }
  const dbJournalObservedLifecycleDrift = requireProductionAuthSession && dbJournalHasAuthEnvelope
    ? resolveObservedProductionAuthSessionLifecycleDrift(dbJournal, observationNow)
    : null;
  const dbJournalUncheckedAuthMetadataDrift = dbJournalHasAuthEnvelope
    ? resolveUncheckedObservedAuthSessionMetadataDrift(
      preflightAuthEnvelope,
      dbJournal,
    )
    : null;
  const requiredPreservedRemoteRetryAttempts = requiredPreservedRemoteRetryPath
    ? summary.latestReadRetryEvidence?.[requiredPreservedRemoteRetryPath]
      || summary.readRetryEvidence?.[requiredPreservedRemoteRetryPath]
      || 1
    : 1;
  const dbJournalAuthSessionDrift = requireProductionAuthSession && dbJournalHasAuthEnvelope && (
    hasProductionAuthSessionTypeDrift(dbJournal)
    || hasProductionAuthSessionStatusDrift(dbJournal)
    || hasMissingProductionAuthSessionExpiry(dbJournal)
    || hasProductionAuthSessionExpiryDrift(dbJournal)
  );
  const recoveryInspectProductionJournalAccepted = productionRecoveryJournalProofIsAcceptable(
    summary.recoveryInspect?.recovery?.productionJournal,
    { requireStaleClaimRejected: simulateStaleClaimRetry },
  );
  if (dbJournal.status !== 200 || dbJournal.body?.ok !== true) {
    summary.code = dbJournal.body?.code || 'DURABLE_JOURNAL_NOT_PROVEN';
    setDurableJournalBoundary(summary, 'journal-inspect');
    return summary;
  }
  if (!dbJournalHasAuthEnvelope && !recoveryInspectProductionJournalAccepted) {
    if (simulateStaleClaimRetry) {
      summary.code = 'DURABLE_JOURNAL_NOT_PROVEN';
      setDurableJournalBoundary(summary, 'journal-inspect');
      return summary;
    }
    if (requireProductionAuthSession) {
      summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
      summary.authSession = {
        required: 'preserved read',
        observed: 'missing-auth-envelope',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      };
      setProductionAuthSessionBoundary(summary);
      return summary;
    }
    if (preflightAuthEnvelope.sessionType === 'production-auth-session') {
      summary.code = 'AUTH_SESSION_LIFECYCLE_DRIFT';
      summary.authSession = {
        field: 'auth',
        required: 'production-auth-session',
        observed: 'missing',
        verdict: 'AUTH_SESSION_LIFECYCLE_DRIFT',
      };
      setDurableJournalBoundary(summary, 'journal-inspect');
      return summary;
    }
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
  if (dbJournalUncheckedAuthMetadataDrift) {
    summary.code = 'AUTH_SESSION_LIFECYCLE_DRIFT';
    summary.authSession = dbJournalUncheckedAuthMetadataDrift;
    setDurableJournalBoundary(summary, 'journal');
    return summary;
  }
  if (requireProductionAuthSession && dbJournalHasAuthEnvelope && hasProductionAuthSessionRevocationDrift(dbJournal)) {
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
  const dbJournalCleanupEvidenceDrift = requireProductionAuthSession && dbJournalHasAuthEnvelope
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
  if (
    requireProductionAuthSession
    && dbJournalHasAuthEnvelope
    && requireCleanupEvidenceContinuity
    && isMissingProductionAuthSessionCleanupEvidence(dbJournal)
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
  requireCleanupEvidenceContinuity = requireCleanupEvidenceContinuity || (
    dbJournalHasAuthEnvelope && hasValidProductionAuthSessionCleanupEvidence(dbJournal)
  );
  const dbJournalInvalidIdentityField = requireProductionAuthSession && dbJournalHasAuthEnvelope
    ? resolveInvalidObservedProductionAuthIdentityField(dbJournal)
    : null;
  if (dbJournalInvalidIdentityField) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      field: `auth.identity.${dbJournalInvalidIdentityField.field}`,
      required: dbJournalInvalidIdentityField.required,
      observed: `invalid-${dbJournalInvalidIdentityField.label}`,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }
  if (requireProductionAuthSession && dbJournalHasAuthEnvelope && hasMissingProductionAuthSessionIdentity(dbJournal)) {
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
  const dbJournalIdentityMismatch = requireProductionAuthSession && dbJournalHasAuthEnvelope
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
  const dbJournalIdentityContinuityDrift = requireProductionAuthSession && dbJournalHasAuthEnvelope
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
  const dbJournalIdentityUserIdDrift = requireProductionAuthSession && dbJournalHasAuthEnvelope
    ? resolveProductionAuthSessionIdentityUserIdDrift(preflightAuthEnvelope, dbJournal)
    : null;
  if (dbJournalIdentityUserIdDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      ...dbJournalIdentityUserIdDrift,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }
  const dbJournalSessionIdentityDrift = requireProductionAuthSession && dbJournalHasAuthEnvelope
    ? resolveProductionAuthSessionIdentityDrift(preflightAuthEnvelope, dbJournal)
    : null;
  if (dbJournalSessionIdentityDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      ...dbJournalSessionIdentityDrift,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setProductionAuthSessionBoundary(summary);
    return summary;
  }
  const dbJournalSessionPreservationDrift = requireProductionAuthSession && dbJournalHasAuthEnvelope
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
  if (dbJournalHasAuthEnvelope && hasExpiredAuthSession(dbJournal, observationNow)) {
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
  const dbJournalAuthEnvelopeDrift = dbJournalHasAuthEnvelope
    ? describeAuthEnvelopeDrift(preflightAuthEnvelope, dbJournal)
    : null;
  if (dbJournalAuthEnvelopeDrift) {
    summary.code = 'AUTH_SESSION_LIFECYCLE_DRIFT';
    summary.authSession = dbJournalAuthEnvelopeDrift;
    setDurableJournalBoundary(summary, 'journal-inspect');
    return summary;
  }
  const dbJournalAccepted = requireProductionAuthSession
    ? dbJournalCheckedBoundaryIsAcceptable(summary.dbJournal, {
      requireStaleClaimRejected: simulateStaleClaimRetry,
    })
    : dbJournalProofIsAcceptable(summary.dbJournal, {
      requireCheckedBoundary: false,
      requireStaleClaimRejected: simulateStaleClaimRetry,
    });
  const dbJournalStrictBoundaryAccepted = dbJournalCheckedBoundaryIsAcceptable(summary.dbJournal, {
    requireStaleClaimRejected: simulateStaleClaimRetry,
  });
  const requireCheckedDurableJournalBoundary = requireProductionAuthSession
    || simulateStaleClaimRetry
    || Boolean(simulatePreservedRemoteRetryPath);
  const dbJournalCheckedBoundaryAccepted = requireCheckedDurableJournalBoundary
    ? dbJournalStrictBoundaryAccepted
    : dbJournalAccepted;
  const durableJournalBoundaryAccepted = dbJournalCheckedBoundaryAccepted
    || recoveryInspectProductionJournalAccepted;
  if (simulatePreservedRemoteRetryPath && requiredPreservedRemoteRetryAttempts < 2) {
    summary.replayAndRetry = {
      required: simulatePreservedRemoteRetryPath,
      observed: 'missing-transient-retry',
      retryAttempts: requiredPreservedRemoteRetryAttempts,
      verdict: 'PRESERVED_REMOTE_RETRY_REQUIRED',
    };
    if ((summary.retryAttempts || 1) > requiredPreservedRemoteRetryAttempts) {
      summary.code = 'PRESERVED_REMOTE_RETRY_REQUIRED';
      setReplayAndRetryBoundary(summary, { durableJournalProven: durableJournalBoundaryAccepted });
      return summary;
    }
    if (!durableJournalBoundaryAccepted) {
      summary.code = 'DURABLE_JOURNAL_NOT_PROVEN';
      setDurableJournalBoundary(summary, 'journal-inspect');
      return summary;
    }
    summary.code = 'PRESERVED_REMOTE_RETRY_REQUIRED';
    setReplayAndRetryBoundary(summary, { durableJournalProven: true });
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

  summary.ok = apply.status === 200
    && apply.body?.ok === true
    && recoveryInspect.status === 200
    && recoveryInspect.body?.ok === true
    && replay.status === 200
    && replay.body?.ok === true
    && replay.body?.idempotency?.replayed === true
    && replay.body?.idempotency?.freshMutationWork === false
    && (!proveDurableJournalBoundary
      || (
        summary.idempotencyConflict?.status === 409
        && summary.idempotencyConflict?.code === 'IDEMPOTENCY_KEY_CONFLICT'
        && summary.idempotencyConflict?.idempotency?.conflict === true
        && summary.idempotencyConflict?.idempotency?.freshMutationWork === false
        && summary.idempotencyConflict?.hashOnly === true
        && summary.idempotencyConflict?.targetSnapshotUnchanged === true
      ))
    && replayEquivalent
    && !applyAuthEnvelopeDrift
    && !recoveryInspectAuthEnvelopeDrift
    && !replayAuthEnvelopeDrift
    && dbJournal.status === 200
    && dbJournal.body?.ok === true
    && durableJournalBoundaryAccepted
    && summary.after?.finalMatchesLocal === true;
  if (!summary.ok) {
    const replayIdempotency = replay.body?.idempotency;
    const authEnvelopeDrift = applyAuthEnvelopeDrift || replayAuthEnvelopeDrift;
    const journalProofFailed = dbJournal.status === 200
      && dbJournal.body?.ok === true
      && !durableJournalBoundaryAccepted;
    const journalCheckedBoundaryFailed = dbJournal.status === 200
      && dbJournal.body?.ok === true
      && !durableJournalBoundaryAccepted;
    const journalStrictBoundaryFailed = dbJournal.status === 200
      && dbJournal.body?.ok === true
      && !dbJournalStrictBoundaryAccepted;
    const replayPreservedStateDrift = replayEquivalence.mismatches?.some(
      (mismatch) => mismatch.field === 'authSessionPreserved',
    ) === true;
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
      ? (
        journalProofFailed
        || (journalCheckedBoundaryFailed && !replayEquivalenceFailed)
        || (journalStrictBoundaryFailed && replayPreservedStateDrift)
          ? 'journal-inspect'
          : (replay.status === 200 ? 'replay' : 'apply')
      )
      : 'journal-inspect');
    return summary;
  }
  if (applyRevalidationDrift) {
    summary.ok = false;
    summary.code = 'APPLY_REVALIDATION_REQUIRED';
    summary.applyRevalidation = applyRevalidationDrift;
    setApplyRevalidationBoundary(summary);
  }
  return summary;
}

function idempotencyConflictPayload(applyPayload) {
  return {
    ...applyPayload,
    durableJournalBoundaryProbe: {
      type: 'same-key-different-body-conflict-before-mutation',
      schemaVersion: 1,
    },
  };
}

function hasHashOnlyIdempotencyConflictEvidence(idempotency) {
  return idempotency?.conflict === true
    && isBareSha256(idempotency?.idempotencyKeyHash)
    && isBareSha256(idempotency?.requestHash);
}

function isBareSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
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
  if (
    sourceUrl
    && !authenticatedHttpPushSourceUrlsMatch(sourceUrl, normalizedAuthSessionSource.sourceUrl)
  ) {
    throw new Error('Auth session source URL does not match checked sourceUrl');
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

function authenticatedHttpPushSourceUrlsMatch(expectedSourceUrl, observedSourceUrl) {
  const expected = normalizeComparableAuthenticatedHttpPushSourceUrl(expectedSourceUrl);
  const observed = normalizeComparableAuthenticatedHttpPushSourceUrl(observedSourceUrl);
  return Boolean(expected && observed && expected === observed);
}

function normalizeComparableAuthenticatedHttpPushSourceUrl(sourceUrl) {
  const normalized = normalizeAuthenticatedHttpPushSourceField(sourceUrl);
  if (!normalized) {
    return '';
  }

  try {
    const parsed = new URL(normalized);
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
      if (options.readOnly === true) {
        assertReadOnlySignedRequestOptions(pathname, options);
      }
      return requestJsonRaw(
        baseUrl,
        'GET',
        pathname,
        undefined,
        ({ attempt } = {}) => signedRequestHeaders(credential, 'GET', pathname, '', {
          ...options,
          attempt,
        }),
        requestTimeoutMs,
        {
          retryable: options.retryable === true && !hasSideEffectQueryParam(pathname),
        },
      );
    },
    signedPost(pathSuffix, body, options = {}) {
      const pathname = `${profile.namespacePath}${pathSuffix}`;
      const rawBody = JSON.stringify(body);
      const readOnlyInspect = options.readOnly === true;
      if (readOnlyInspect) {
        assertReadOnlySignedPostOptions(pathname, options);
      } else {
        assertMutatingRequestOptions(pathname, options);
      }
      return requestJsonRaw(
        baseUrl,
        'POST',
        pathname,
        rawBody,
        ({ attempt } = {}) => signedRequestHeaders(credential, 'POST', pathname, rawBody, {
          ...options,
          attempt,
        }),
        requestTimeoutMs,
        {
          retryable: options.retryable === true || (!readOnlyInspect && options.idempotencyKey !== undefined),
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
    ...summarizeAuthIdentityCapabilityFields(body.auth?.identity),
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
    idempotency: summarizeIdempotency(body.idempotency),
    applyRevalidation: summarizeApplyRevalidation(body),
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

function summarizeIdempotency(idempotency) {
  if (!idempotency || typeof idempotency !== 'object') {
    return undefined;
  }

  const summary = {
    replayed: idempotency.replayed === true,
    freshMutationWork: idempotency.freshMutationWork === true,
    staleClaimRetry: idempotency.staleClaimRetry === true,
    status: idempotency.status,
    conflict: idempotency.conflict === true,
  };
  for (const field of ['idempotencyKeyHash', 'requestHash']) {
    if (typeof idempotency[field] === 'string' && idempotency[field].trim().length > 0) {
      summary[field] = idempotency[field].trim();
    }
  }
  return summary;
}

function summarizeOldRemoteRecoveryClassification(response, plan) {
  const body = response?.body || {};
  const expectedTotal = Array.isArray(plan?.mutations) ? plan.mutations.length : null;
  const recovery = body.recovery && typeof body.recovery === 'object' ? body.recovery : {};
  const counts = normalizeOldRemoteRecoveryCounts(recovery.counts, expectedTotal);
  const observedState = recovery.state || null;
  const hookProvedNoMutation =
    response?.status === 500
    && body.code === 'LAB_SIMULATED_STALE_CLAIM_ALL_OLD'
    && body.idempotency?.freshMutationWork !== true;
  const classifiedOldRemote = (
    observedState === 'old-remote'
    || (observedState === 'stale-claim-all-old-simulated' && hookProvedNoMutation)
  ) && countsAreAllOld(counts, expectedTotal);

  if (!classifiedOldRemote) {
    return null;
  }

  return {
    source: 'stale-owner retry abandoned before mutation',
    status: response.status,
    code: body.code || null,
    state: 'old-remote',
    observedState,
    counts,
  };
}

function normalizeOldRemoteRecoveryCounts(counts, expectedTotal) {
  if (!counts || typeof counts !== 'object') {
    return null;
  }

  return {
    old: integerOrNull(counts.old),
    new: integerOrNull(counts.new),
    blockedUnknown: integerOrNull(counts.blockedUnknown ?? counts.blocked_unknown),
    total: integerOrNull(counts.total) ?? (Number.isInteger(expectedTotal) ? expectedTotal : null),
  };
}

function countsAreAllOld(counts, expectedTotal) {
  if (!counts || !Number.isInteger(expectedTotal) || expectedTotal <= 0) {
    return false;
  }
  return counts.old === expectedTotal
    && counts.new === 0
    && counts.blockedUnknown === 0
    && counts.total === expectedTotal;
}

function integerOrNull(value) {
  return Number.isInteger(value) ? value : null;
}

function summarizeApplyRevalidation(body) {
  if (!body || typeof body !== 'object') {
    return undefined;
  }

  const hasExplicitApplyRevalidation = body.applyRevalidation && typeof body.applyRevalidation === 'object';
  const applyRevalidation = hasExplicitApplyRevalidation ? body.applyRevalidation : {};
  const verifiedPreconditions = Array.isArray(body.verifiedPreconditions)
    ? body.verifiedPreconditions
    : Array.isArray(body.receipt?.preconditionHashes)
      ? body.receipt.preconditionHashes
      : [];
  if (!hasExplicitApplyRevalidation && !body.receipt && verifiedPreconditions.length === 0) {
    return undefined;
  }
  const verifiedResourceKeys = Array.isArray(applyRevalidation.verifiedResourceKeys)
    ? applyRevalidation.verifiedResourceKeys.map((resourceKey) => String(resourceKey))
    : Array.isArray(body.receipt?.verifiedResourceKeys)
      ? body.receipt.verifiedResourceKeys.map((resourceKey) => String(resourceKey))
      : verifiedPreconditions.map((entry) => String(entry?.resourceKey || ''));
  const claim = applyRevalidation.claim && typeof applyRevalidation.claim === 'object'
    ? {
        activeClaimId: applyRevalidation.claim.activeClaimId || null,
        activeClaimKeyHash: applyRevalidation.claim.activeClaimKeyHash || null,
        activeClaimSequence: Number.isInteger(applyRevalidation.claim.activeClaimSequence)
          ? applyRevalidation.claim.activeClaimSequence
          : null,
        staleClaimRetry: applyRevalidation.claim.staleClaimRetry === true,
      }
    : undefined;

  return {
    schemaVersion: applyRevalidation.schemaVersion ?? 1,
    required: applyRevalidation.required || 'fresh-live-hashes-before-first-mutation',
    phase: applyRevalidation.phase || 'before-first-mutation',
    checkedAgainst: applyRevalidation.checkedAgainst || 'live-remote',
    planHash: applyRevalidation.planHash || body.receipt?.planHash || null,
    receiptHash: applyRevalidation.receiptHash || body.receipt?.receiptHash || null,
    preconditionSetHash: applyRevalidation.preconditionSetHash || body.receipt?.preconditionSetHash || null,
    mutationSetHash: applyRevalidation.mutationSetHash || body.receipt?.mutationSetHash || null,
    mutationCount: Number.isInteger(applyRevalidation.mutationCount)
      ? applyRevalidation.mutationCount
      : Number.isInteger(body.receipt?.mutationCount)
        ? body.receipt.mutationCount
        : verifiedResourceKeys.length,
    verifiedCount: Number.isInteger(applyRevalidation.verifiedCount)
      ? applyRevalidation.verifiedCount
      : verifiedResourceKeys.length,
    verifiedResourceKeys,
    claim,
  };
}

function resolveApplyRevalidationDrift(applyRevalidation, plan, receipt) {
  const planEvidence = summarizePlanEvidenceForApplyRevalidation(plan);
  const expectedResourceKeys = Array.isArray(plan?.mutations)
    ? plan.mutations.map((mutation) => mutation.resourceKey)
    : [];
  const expectedChecks = [
    ['schemaVersion', 1],
    ['required', 'fresh-live-hashes-before-first-mutation'],
    ['phase', 'before-first-mutation'],
    ['checkedAgainst', 'live-remote'],
    ['planHash', receipt?.planHash || digest(plan)],
    ['receiptHash', receipt?.receiptHash || null],
    ['preconditionSetHash', receipt?.preconditionSetHash || planEvidence.preconditionSetHash],
    ['mutationSetHash', receipt?.mutationSetHash || planEvidence.mutationSetHash],
    ['mutationCount', expectedResourceKeys.length],
    ['verifiedCount', expectedResourceKeys.length],
  ];

  if (!applyRevalidation || typeof applyRevalidation !== 'object') {
    return {
      required: 'fresh-live-hashes-before-first-mutation',
      observed: 'missing-apply-revalidation-evidence',
      verdict: 'APPLY_REVALIDATION_REQUIRED',
    };
  }

  for (const [field, expected] of expectedChecks) {
    const observed = applyRevalidation[field];
    if (observed !== expected) {
      return {
        field,
        required: expected,
        observed,
        verdict: 'APPLY_REVALIDATION_REQUIRED',
      };
    }
  }

  const observedResourceKeys = Array.isArray(applyRevalidation.verifiedResourceKeys)
    ? applyRevalidation.verifiedResourceKeys.map((resourceKey) => String(resourceKey))
    : [];
  if (digest(observedResourceKeys) !== digest(expectedResourceKeys)) {
    return {
      field: 'verifiedResourceKeys',
      required: expectedResourceKeys,
      observed: observedResourceKeys,
      verdict: 'APPLY_REVALIDATION_REQUIRED',
    };
  }

  if (
    applyRevalidation?.claim
    && (!Number.isInteger(applyRevalidation.claim.activeClaimSequence) || applyRevalidation.claim.activeClaimSequence < 1)
  ) {
    return {
      field: 'claim.activeClaimSequence',
      required: 'positive-integer',
      observed: applyRevalidation?.claim?.activeClaimSequence ?? 'missing',
      verdict: 'APPLY_REVALIDATION_REQUIRED',
    };
  }

  return null;
}

function summarizePlanEvidenceForApplyRevalidation(plan) {
  const mutations = Array.isArray(plan?.mutations) ? plan.mutations : [];
  const preconditions = Array.isArray(plan?.preconditions) ? plan.preconditions : [];

  return {
    mutationSetHash: digest(mutations.map((mutation) => ({
      id: String(mutation?.id || ''),
      resourceKey: String(mutation?.resourceKey || ''),
      resource: mutation?.resource,
      action: mutation?.action ?? null,
      changeKind: mutation?.changeKind ?? null,
      baseHash: mutation?.baseHash ?? null,
      remoteBeforeHash: mutation?.remoteBeforeHash ?? null,
      localHash: mutation?.localHash ?? null,
    }))),
    preconditionSetHash: digest(preconditions.map((precondition) => ({
      mutationId: String(precondition?.mutationId || ''),
      resourceKey: String(precondition?.resourceKey || ''),
      resource: precondition?.resource,
      expectedHash: String(precondition?.expectedHash || ''),
    }))),
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
    summary.latestReadRetryEvidence = summary.latestReadRetryEvidence || {};
    summary.latestReadRetryEvidence[pathname] = responseSummary.retryAttempts;
  }
}

function captureTransportFailure(summary, field, error, code, phase) {
  const failure = summarizeTransportFailure(error);
  summary[field] = failure;
  updateRetryAttempts(summary, failure);
  summary.code = code;
  setDurableJournalBoundary(summary, phase);
}

function summarizeAuthSessionLifecycle(auth, now = new Date()) {
  const session = auth?.session;
  if (!session || typeof session !== 'object') {
    return null;
  }

  const authUser = typeof auth?.identity?.userLogin === 'string'
    ? auth.identity.userLogin.trim()
    : '';
  const authUserId = normalizeObservedAuthIdentityUserId(auth?.identity?.userId);
  const authCapabilities = summarizeAuthIdentityCapabilities(auth?.identity);
  const invalidLifecycleFlag = resolveInvalidProductionAuthSessionLifecycleFlag(session);
  const invalidIdentityField = resolveInvalidProductionAuthSessionIdentityField(session);
  const unrevokedObservation = (
    session.revoked === true
    || session.status === 'revoked'
    || productionAuthSessionIsCleanedUp(session)
  )
    ? { field: resolveProductionAuthSessionUnrevokedField(session) }
    : null;
  const expiredObservation = (
    session.status === 'expired'
    || session.expired === true
    || isExpiredSession(session, now)
  )
    ? {
        field: session.status === 'expired'
          ? 'auth.session.status'
          : normalizeProductionAuthSessionLifecycleField(session?.expiredField),
      }
    : null;

  return {
    id: session.id || null,
    type: session.type || null,
    status: session.status || null,
    expiresAt: session.expiresAt || null,
    ...(invalidLifecycleFlag ? { invalidLifecycleFlag } : {}),
    ...(invalidIdentityField?.label ? { invalidIdentityField: invalidIdentityField.label } : {}),
    ...(unrevokedObservation?.field ? { unrevokedField: unrevokedObservation.field } : {}),
    ...(expiredObservation?.field ? { expiredField: expiredObservation.field } : {}),
    ...(session.rotated === true || session.status === 'rotated'
      ? {
        rotatedField: session.rotated === true ? 'auth.session.rotated' : 'auth.session.status',
      }
      : {}),
    expired: session.expired === true || session.status === 'expired' || isExpiredSession(session, now),
    revoked: session.revoked === true || session.status === 'revoked',
    cleanedUp: productionAuthSessionIsCleanedUp(session),
    rotated: session.rotated === true ? true : session.rotated === false ? false : null,
    preserved: session.preserved === true ? true : session.preserved === false ? false : null,
    ...(authUser ? { authUser } : {}),
    ...(authUserId ? { authUserId } : {}),
    ...(Object.keys(authCapabilities).length > 0 ? { authCapabilities } : {}),
  };
}

function recordAuthSessionLifecycle(summary, step, auth, now = new Date()) {
  const observation = summarizeAuthSessionLifecycle(auth, now);
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
    ...(observation?.authUserId ? { authUserId: observation.authUserId } : {}),
    ...(observation?.authCapabilities ? { authCapabilities: observation.authCapabilities } : {}),
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
    read: resolvePreferredAuthSessionReadObservation(observations),
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

function resolvePreferredAuthSessionReadObservation(observations) {
  const reversed = [...observations].reverse();
  return reversed.find((entry) => entry.step === 'journal' || entry.step === 'replay')
    || reversed.find((entry) => isAuthSessionReadStep(entry.step))
    || null;
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

async function fetchDbJournalReadback(client, {
  plan,
  session,
  idempotencyKey,
  readOnlyInspectRequests = false,
  withAuthSessionDrift = (pathname) => pathname,
}) {
  const requestedLimit = dbJournalReadbackLimitForPlan(plan);
  const firstPage = await client.signedGet(withAuthSessionDrift(`/db-journal?limit=${requestedLimit}`), readOnlyInspectOptions({
    session,
    idempotencyKey,
    retryable: true,
    readOnlyInspectRequests,
  }));
  if (firstPage.status !== 200 || firstPage.body?.ok !== true) {
    return firstPage;
  }

  const pages = [firstPage];
  let combinedRows = dbJournalRowsFromResponse(firstPage);
  let rowCount = dbJournalRowCountFromResponse(firstPage, combinedRows.length);
  let nextBeforeSequence = dbJournalNextBeforeSequence(firstPage.body?.dbJournal);

  while (
    nextBeforeSequence
    && combinedRows.length < rowCount
    && pages.length < maximumDbJournalReadbackPages
  ) {
    const page = await client.signedGet(
      withAuthSessionDrift(`/db-journal?limit=${maximumDbJournalReadbackLimit}&beforeSequence=${nextBeforeSequence}`),
      readOnlyInspectOptions({
        session,
        idempotencyKey,
        retryable: true,
        readOnlyInspectRequests,
      }),
    );
    pages.push(page);
    if (page.status !== 200 || page.body?.ok !== true) {
      return combineDbJournalReadbackPages(pages, {
        requestedLimit,
        incompleteCode: page.body?.code || 'DURABLE_JOURNAL_PAGE_NOT_PROVEN',
      });
    }

    const previousRowCount = combinedRows.length;
    combinedRows = mergeDbJournalRows(combinedRows, dbJournalRowsFromResponse(page));
    rowCount = Math.max(rowCount, dbJournalRowCountFromResponse(page, combinedRows.length));
    nextBeforeSequence = dbJournalNextBeforeSequence(page.body?.dbJournal);
    if (combinedRows.length === previousRowCount) {
      break;
    }
  }

  return combineDbJournalReadbackPages(pages, { requestedLimit });
}

function readOnlyInspectOptions({
  session,
  idempotencyKey,
  retryable = false,
  readOnlyInspectRequests = false,
}) {
  if (readOnlyInspectRequests) {
    return {
      session,
      readOnly: true,
      ...(retryable ? { retryable: true } : {}),
    };
  }

  return {
    session,
    idempotencyKey,
    ...(retryable ? { retryable: true } : {}),
  };
}

function combineDbJournalReadbackPages(pages, {
  requestedLimit,
  incompleteCode = '',
} = {}) {
  const firstPage = pages[0];
  const body = cloneJson(firstPage.body || {});
  const pageRows = pages.flatMap((page) => dbJournalRowsFromResponse(page));
  const combinedRows = mergeDbJournalRows([], pageRows);
  const rowCount = Math.max(
    combinedRows.length,
    ...pages.map((page) => dbJournalRowCountFromResponse(page, combinedRows.length)),
  );
  const lastPage = pages[pages.length - 1];
  const hasOlder = dbJournalHasOlderRows(lastPage?.body?.dbJournal);
  const complete = !incompleteCode && (!hasOlder || combinedRows.length >= rowCount);
  body.dbJournal = {
    ...(body.dbJournal || {}),
    rowCount,
    latestRows: combinedRows,
    readback: {
      requestedLimit,
      pageLimit: maximumDbJournalReadbackLimit,
      pages: pages.length,
      rows: combinedRows.length,
      rowCount,
      oldestSequence: combinedRows[0]?.sequence ?? null,
      newestSequence: combinedRows.at(-1)?.sequence ?? null,
      complete,
      truncated: !complete,
      nextBeforeSequence: complete ? null : dbJournalNextBeforeSequence(lastPage?.body?.dbJournal),
      ...(incompleteCode ? { code: incompleteCode } : {}),
    },
  };
  return {
    ...firstPage,
    status: incompleteCode ? (lastPage?.status || firstPage.status) : firstPage.status,
    body: incompleteCode
      ? {
        ...body,
        ok: false,
        code: incompleteCode,
      }
      : body,
    retryAttempts: Math.max(...pages.map((page) => page.retryAttempts || 1)),
  };
}

function dbJournalRowsFromResponse(response) {
  return Array.isArray(response?.body?.dbJournal?.latestRows)
    ? response.body.dbJournal.latestRows.filter((row) => row && typeof row === 'object')
    : [];
}

function mergeDbJournalRows(existingRows, newRows) {
  const rowsByKey = new Map();
  let syntheticIndex = 0;
  for (const row of [...existingRows, ...newRows]) {
    const sequence = Number.isInteger(row?.sequence) ? row.sequence : null;
    if (!sequence || sequence <= 0) {
      rowsByKey.set(`synthetic:${syntheticIndex}`, {
        row,
        order: syntheticIndex,
      });
      syntheticIndex += 1;
      continue;
    }
    const key = `sequence:${sequence}`;
    if (rowsByKey.has(key)) {
      continue;
    }
    rowsByKey.set(key, {
      row,
      order: sequence,
    });
  }
  return [...rowsByKey.values()]
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.row);
}

function dbJournalRowCountFromResponse(response, fallback = 0) {
  const rowCount = response?.body?.dbJournal?.rowCount;
  return Number.isInteger(rowCount) && rowCount >= 0 ? rowCount : fallback;
}

function dbJournalNextBeforeSequence(dbJournal) {
  const nextBeforeSequence = dbJournal?.page?.nextBeforeSequence;
  return Number.isInteger(nextBeforeSequence) && nextBeforeSequence > 0 ? nextBeforeSequence : null;
}

function dbJournalHasOlderRows(dbJournal) {
  if (dbJournal?.page?.hasOlder === true) {
    return true;
  }
  return dbJournalNextBeforeSequence(dbJournal) !== null;
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function summarizeDbJournal(response) {
  if (response.status !== 200 || response.body?.ok !== true) {
    return summarizeResponse(response);
  }
  const rows = response.body.dbJournal?.latestRows || [];
  const storageGuard = summarizeDbJournalStorageGuard(response.body);
  const eventSummaries = Array.isArray(response.body.dbJournal?.eventSummaries)
    ? response.body.dbJournal.eventSummaries
    : [];
  const eventCounts = Object.fromEntries(eventSummaries.map((entry) => [
    entry.event,
    Number.isInteger(entry.count) ? entry.count : 0,
  ]));
  return {
    status: response.status,
    ok: true,
    retryAttempts: response.retryAttempts || 1,
    requestedLimit: dbJournalLimitFromRequestPath(response.request?.pathname),
    readbackPages: Number.isInteger(response.body?.dbJournal?.readback?.pages)
      ? response.body.dbJournal.readback.pages
      : (response.body?.dbJournal?.page ? 1 : null),
    paginationComplete: response.body?.dbJournal?.readback?.complete !== undefined
      ? response.body.dbJournal.readback.complete === true
      : response.body?.dbJournal?.rowCount === undefined || response.body.dbJournal.rowCount <= rows.length,
    paginationTruncated: response.body?.dbJournal?.readback?.truncated === true,
    oldestSequence: rows[0]?.sequence ?? null,
    newestSequence: rows.at(-1)?.sequence ?? null,
    scope: response.body?.dbJournal?.scope,
    rows: rows.length,
    rowCount: Number.isInteger(response.body?.dbJournal?.rowCount)
      ? response.body.dbJournal.rowCount
      : rows.length,
    applyCommitted: rows.some((entry) => entry.event === 'apply-committed'),
    mutationApplied: rows.filter((entry) => entry.event === 'mutation-applied').length,
    idempotencyOpened: rows.filter((entry) => entry.event === 'idempotency-opened').length,
    eventCounts,
    latestEvents: rows.map((entry) => ({
      sequence: entry.sequence,
      event: entry.event,
      claimId: entry.claimId || null,
      idempotencyKeyHash: entry.idempotencyKeyHash || null,
      requestHash: entry.requestHash || null,
      appliedCount: Number.isInteger(entry.appliedCount) ? entry.appliedCount : null,
      errorCode: entry.errorCode || null,
    })),
    idempotencyEvidence: Array.isArray(response.body.dbJournal?.idempotencyEvidence)
      ? response.body.dbJournal.idempotencyEvidence.map((entry) => ({
        idempotencyKeyHash: entry.idempotencyKeyHash || null,
        events: Number.isInteger(entry.events) ? entry.events : null,
        requestHashes: Number.isInteger(entry.requestHashes) ? entry.requestHashes : null,
        latestId: Number.isInteger(entry.latestId) ? entry.latestId : null,
      }))
      : [],
    claim: summarizeDbJournalClaim(response.body?.dbJournal?.claim),
    ...summarizeDbJournalClaimExpiryField(response.body?.dbJournal?.claimExpiry),
    storageGuard,
    ownership: summarizeDbJournalOwnership(response.body?.dbJournal),
    writerLease: summarizeDbJournalWriterLease(response.body?.dbJournal?.writerLease),
    leaseFence: summarizeDbJournalLeaseFence(response.body?.dbJournal),
    authUser: response.body?.auth?.identity?.userLogin,
    ...summarizeAuthIdentityCapabilityFields(response.body?.auth?.identity),
    authSessionId: response.body?.auth?.session?.id,
    sessionType: response.body?.auth?.session?.type,
    sessionStatus: response.body?.auth?.session?.status,
    sessionExpiresAt: response.body?.auth?.session?.expiresAt,
  };
}

export function dbJournalReadbackLimitForPlan(plan) {
  const mutationCount = Array.isArray(plan?.mutations) ? plan.mutations.length : 0;
  if (mutationCount <= 10) {
    return minimumDbJournalReadbackLimit;
  }
  const scaledLimit = mutationCount * 10 + 120;
  return Math.min(
    maximumDbJournalReadbackLimit,
    Math.max(minimumDbJournalReadbackLimit, scaledLimit),
  );
}

function dbJournalLimitFromRequestPath(pathname) {
  if (typeof pathname !== 'string' || pathname.length === 0) {
    return null;
  }
  try {
    const url = new URL(pathname, 'http://reprint.local');
    const value = Number.parseInt(url.searchParams.get('limit') || '', 10);
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function dbJournalProofIsAcceptable(dbJournal, options = {}) {
  const requireCheckedBoundary = options.requireCheckedBoundary === true;

  return dbJournalScopeIsTrusted(dbJournal?.scope)
    && dbJournal?.applyCommitted === true
    && dbJournal?.idempotencyOpened > 0
    && dbJournal?.mutationApplied > 0
    && dbJournalReadbackIsComplete(dbJournal)
    && dbJournalStorageGuardIsTrusted(dbJournal?.storageGuard)
    && dbJournalOwnershipIsTrusted(dbJournal?.ownership, { requireCheckedBoundary })
    && (!requireCheckedBoundary || checkedDurableJournalBoundarySatisfied(dbJournal))
    && dbJournalLeaseFenceIsTrusted(dbJournal?.leaseFence, options);
}

function dbJournalReadbackIsComplete(dbJournal) {
  return dbJournal?.paginationTruncated !== true
    && dbJournal?.paginationComplete !== false;
}

function summarizeAuthIdentityCapabilities(identity) {
  const capabilities = identity?.capabilities;
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) {
    return {};
  }

  return {
    ...(Object.prototype.hasOwnProperty.call(capabilities, 'manage_options')
      ? { manage_options: capabilities.manage_options === true }
      : {}),
  };
}

function summarizeAuthIdentityCapabilityFields(identity) {
  const authCapabilities = summarizeAuthIdentityCapabilities(identity);
  return Object.keys(authCapabilities).length > 0 ? { authCapabilities } : {};
}

function dbJournalCheckedBoundaryIsAcceptable(dbJournal, options = {}) {
  return dbJournalProofIsAcceptable(normalizeCheckedBoundaryDbJournal(dbJournal), {
    ...options,
    requireCheckedBoundary: true,
  });
}

export function productionRecoveryJournalProofIsAcceptable(productionJournal, options = {}) {
  const requireStaleClaimRejected = options.requireStaleClaimRejected === true;
  return productionRecoveryJournalInspectionSurfaceIsPresent(productionJournal)
    && productionJournal?.journal?.consumed === true
    && productionJournal?.journal?.ownership?.ownsJournal === true
    && productionJournal?.journal?.ownership?.restartReadable === true
    && productionJournal?.leaseFence?.restartReadable === true
    && (!requireStaleClaimRejected || productionJournal?.leaseFence?.staleClaimRejected === true);
}

function normalizeCheckedBoundaryDbJournal(dbJournal) {
  if (!dbJournal || typeof dbJournal !== 'object') {
    return dbJournal;
  }

  const activeClaimId = typeof dbJournal?.claim?.activeClaimId === 'string' && dbJournal.claim.activeClaimId.trim().length > 0
    ? dbJournal.claim.activeClaimId.trim()
    : null;
  const activeClaimKeyHash = typeof dbJournal?.claim?.activeClaimKeyHash === 'string' && dbJournal.claim.activeClaimKeyHash.trim().length > 0
    ? dbJournal.claim.activeClaimKeyHash.trim()
    : null;
  const normalizeWriterLease = (writerLease) => {
    if (!writerLease || typeof writerLease !== 'object') {
      return writerLease;
    }
    const claimId = typeof writerLease.claimId === 'string' && writerLease.claimId.trim().length > 0
      ? writerLease.claimId.trim()
      : null;
    const claimKeyHash = typeof writerLease.claimKeyHash === 'string' && writerLease.claimKeyHash.trim().length > 0
      ? writerLease.claimKeyHash.trim()
      : null;
    if (claimKeyHash || !claimId || !activeClaimId || claimId !== activeClaimId || !activeClaimKeyHash) {
      return writerLease;
    }
    return {
      ...writerLease,
      claimKeyHash: activeClaimKeyHash,
    };
  };

  return {
    ...dbJournal,
    writerLease: normalizeWriterLease(dbJournal.writerLease),
    leaseFence: dbJournal.leaseFence && typeof dbJournal.leaseFence === 'object'
      ? {
        ...dbJournal.leaseFence,
        writerLease: normalizeWriterLease(dbJournal.leaseFence.writerLease),
      }
      : dbJournal.leaseFence,
  };
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

function dbJournalOwnershipIsTrusted(ownership, options = {}) {
  const requireCheckedBoundary = options.requireCheckedBoundary === true;
  return ownership?.ownsJournal === true
    && ownership?.restartReadable === true
    && typeof ownership?.productionAdapter === 'string'
    && ownership.productionAdapter.trim().length > 0
    && (
      ownership?.supportedSurface === checkedDbJournalSupportedSurface
      || (!requireCheckedBoundary && (ownership?.supportedSurface === null || ownership?.supportedSurface === undefined))
    );
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

  const inferredStorageGuard = inferTrustedDbJournalStorageGuard(body?.dbJournal);
  if (inferredStorageGuard) {
    return inferredStorageGuard;
  }

  return undefined;
}

export function inferTrustedDbJournalStorageGuard(dbJournal) {
  if (!dbJournal || typeof dbJournal !== 'object') {
    return undefined;
  }

  if (dbJournal?.ownership?.ownsJournal !== true || dbJournal?.ownership?.restartReadable !== true) {
    return undefined;
  }

  const boundaries = [
    typeof dbJournal?.ownership?.productionAdapter === 'string'
      ? dbJournal.ownership.productionAdapter.trim()
      : '',
    typeof dbJournal?.leaseFence?.boundary === 'string'
      ? dbJournal.leaseFence.boundary.trim()
      : '',
    typeof dbJournal?.writerLease?.storageGuard === 'string'
      ? dbJournal.writerLease.storageGuard.trim()
      : '',
    typeof dbJournal?.leaseFence?.writerLease?.storageGuard === 'string'
      ? dbJournal.leaseFence.writerLease.storageGuard.trim()
      : '',
  ].filter(Boolean);

  if (boundaries.length === 0) {
    return undefined;
  }

  const uniqueBoundaries = [...new Set(boundaries)];
  if (uniqueBoundaries.length !== 1) {
    return undefined;
  }

  return {
    boundary: uniqueBoundaries[0],
    operation: 'update',
    outcome: 'applied',
  };
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
    ...(ownership.supportedSurface ? { supportedSurface: ownership.supportedSurface } : {}),
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
    storageGuard: leaseFence.storageGuard || leaseFence.boundary || null,
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

  const claimId = typeof writerLease.claimId === 'string' && writerLease.claimId.trim().length > 0
    ? writerLease.claimId.trim()
    : null;
  const claimKeyHash = typeof writerLease.claimKeyHash === 'string' && writerLease.claimKeyHash.trim().length > 0
    ? writerLease.claimKeyHash.trim()
    : null;

  return {
    strategy: writerLease.strategy || null,
    claimId,
    ...(claimKeyHash ? { claimKeyHash } : {}),
    claimKeyUnique: writerLease.claimKeyUnique === true,
    fsyncEvidence: writerLease.fsyncEvidence === true,
    storageGuard: writerLease.storageGuard || null,
    monotonicSequence: writerLease.monotonicSequence === true,
    restartReadable: writerLease.restartReadable === true,
    staleClaimRejected: writerLease.staleClaimRejected === true,
  };
}

function summarizeDbJournalClaim(claim) {
  if (!claim || typeof claim !== 'object') {
    return undefined;
  }

  const previousStartedSequence = Number.isInteger(claim.previousStartedSequence)
    ? claim.previousStartedSequence
    : null;
  const abandonedSequence = Number.isInteger(claim.abandonedSequence)
    ? claim.abandonedSequence
    : null;
  const abandonedEvent = typeof claim.abandonedEvent === 'string' && claim.abandonedEvent.trim().length > 0
    ? claim.abandonedEvent.trim()
    : null;

  return {
    status: typeof claim.status === 'string' && claim.status.trim().length > 0
      ? claim.status.trim()
      : null,
    activeClaimId: typeof claim.activeClaimId === 'string' && claim.activeClaimId.trim().length > 0
      ? claim.activeClaimId.trim()
      : null,
    activeClaimKeyHash: typeof claim.activeClaimKeyHash === 'string' && claim.activeClaimKeyHash.trim().length > 0
      ? claim.activeClaimKeyHash.trim()
      : null,
    activeClaimSequence: Number.isInteger(claim.activeClaimSequence) ? claim.activeClaimSequence : null,
    activeClaimEvent: typeof claim.activeClaimEvent === 'string' && claim.activeClaimEvent.trim().length > 0
      ? claim.activeClaimEvent.trim()
      : null,
    previousClaimId: typeof claim.previousClaimId === 'string' && claim.previousClaimId.trim().length > 0
      ? claim.previousClaimId.trim()
      : null,
    previousClaimKeyHash: typeof claim.previousClaimKeyHash === 'string' && claim.previousClaimKeyHash.trim().length > 0
      ? claim.previousClaimKeyHash.trim()
      : null,
    previousClaimSequence: Number.isInteger(claim.previousClaimSequence) ? claim.previousClaimSequence : null,
    previousClaimEvent: typeof claim.previousClaimEvent === 'string' && claim.previousClaimEvent.trim().length > 0
      ? claim.previousClaimEvent.trim()
      : null,
    ...(previousStartedSequence !== null ? { previousStartedSequence } : {}),
    ...(abandonedSequence !== null ? { abandonedSequence } : {}),
    ...(abandonedEvent !== null ? { abandonedEvent } : {}),
    idempotencyKeyHash: typeof claim.idempotencyKeyHash === 'string' && claim.idempotencyKeyHash.trim().length > 0
      ? claim.idempotencyKeyHash.trim()
      : null,
    requestHash: typeof claim.requestHash === 'string' && claim.requestHash.trim().length > 0
      ? claim.requestHash.trim()
      : null,
    planHash: typeof claim.planHash === 'string' && claim.planHash.trim().length > 0
      ? claim.planHash.trim()
      : null,
    receiptHash: typeof claim.receiptHash === 'string' && claim.receiptHash.trim().length > 0
      ? claim.receiptHash.trim()
      : null,
    planFingerprint: typeof claim.planFingerprint === 'string' && claim.planFingerprint.trim().length > 0
      ? claim.planFingerprint.trim()
      : null,
    mutationCount: Number.isInteger(claim.mutationCount) ? claim.mutationCount : null,
    appliedCount: Number.isInteger(claim.appliedCount) ? claim.appliedCount : null,
    staleClaimRejected: claim.staleClaimRejected === true,
  };
}

function summarizeDbJournalClaimExpiryField(claimExpiry) {
  const summarized = summarizeDbJournalClaimExpiry(claimExpiry);
  return summarized ? { claimExpiry: summarized } : {};
}

function summarizeDbJournalClaimExpiry(claimExpiry) {
  if (!claimExpiry || typeof claimExpiry !== 'object') {
    return undefined;
  }

  return {
    policy: typeof claimExpiry.policy === 'string' && claimExpiry.policy.trim().length > 0
      ? claimExpiry.policy.trim()
      : null,
    scope: typeof claimExpiry.scope === 'string' && claimExpiry.scope.trim().length > 0
      ? claimExpiry.scope.trim()
      : null,
    proven: claimExpiry.proven === true,
    expired: claimExpiry.expired === true,
    previousClaimExpired: claimExpiry.previousClaimExpired === true,
    staleClaimRejected: claimExpiry.staleClaimRejected === true,
    staleThresholdMs: Number.isInteger(claimExpiry.staleThresholdMs)
      ? claimExpiry.staleThresholdMs
      : null,
    openedAt: typeof claimExpiry.openedAt === 'string' && claimExpiry.openedAt.trim().length > 0
      ? claimExpiry.openedAt.trim()
      : null,
    expiresAt: typeof claimExpiry.expiresAt === 'string' && claimExpiry.expiresAt.trim().length > 0
      ? claimExpiry.expiresAt.trim()
      : null,
    evaluatedAt: typeof claimExpiry.evaluatedAt === 'string' && claimExpiry.evaluatedAt.trim().length > 0
      ? claimExpiry.evaluatedAt.trim()
      : null,
    previousClaimOpenedAt: typeof claimExpiry.previousClaimOpenedAt === 'string'
      && claimExpiry.previousClaimOpenedAt.trim().length > 0
      ? claimExpiry.previousClaimOpenedAt.trim()
      : null,
    previousClaimExpiresAt: typeof claimExpiry.previousClaimExpiresAt === 'string'
      && claimExpiry.previousClaimExpiresAt.trim().length > 0
      ? claimExpiry.previousClaimExpiresAt.trim()
      : null,
    previousClaimAgeMs: Number.isInteger(claimExpiry.previousClaimAgeMs)
      ? claimExpiry.previousClaimAgeMs
      : null,
    activeClaimSequence: Number.isInteger(claimExpiry.activeClaimSequence)
      ? claimExpiry.activeClaimSequence
      : null,
    activeClaimEvent: typeof claimExpiry.activeClaimEvent === 'string'
      && claimExpiry.activeClaimEvent.trim().length > 0
      ? claimExpiry.activeClaimEvent.trim()
      : null,
    previousClaimSequence: Number.isInteger(claimExpiry.previousClaimSequence)
      ? claimExpiry.previousClaimSequence
      : null,
    previousClaimEvent: typeof claimExpiry.previousClaimEvent === 'string'
      && claimExpiry.previousClaimEvent.trim().length > 0
      ? claimExpiry.previousClaimEvent.trim()
      : null,
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

function recoveryInspectClaimsProductionRecoveryJournalSurface(recovery) {
  if (!recovery || typeof recovery !== 'object') {
    return false;
  }

  return recovery?.journal?.kind === 'production-recovery-journal'
    || recovery?.journal?.productionAdapter === 'openProductionRecoveryJournal'
    || hasNonEmptyString(recovery?.journal?.claimHash)
    || hasNonEmptyString(recovery?.claim?.activeClaimHash)
    || hasNonEmptyString(recovery?.leaseFence?.writerLease?.claimHash);
}

function recoveryInspectProductionJournalInspection(recovery) {
  return {
    journal: recovery?.journal,
    claim: recovery?.claim ?? recovery?.journal?.claim,
    leaseFence: recovery?.leaseFence,
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
    claim: summarizeDbJournalClaim(journal.claim),
    ...summarizeDbJournalClaimExpiryField(journal.claimExpiry || journal.claim?.claimExpiry),
    storageGuard: sanitizeStorageGuard(journal.storageGuard) || inferTrustedDbJournalStorageGuard(journal),
    ownership: summarizeDbJournalOwnership(journal),
    writerLease: summarizeDbJournalWriterLease(journal.writerLease),
    leaseFence: summarizeDbJournalLeaseFence(journal),
  };
}

function summarizeReplayEquivalence(applyResponse, replayResponse, now = new Date()) {
  const applyBody = applyResponse?.body || {};
  const replayBody = replayResponse?.body || {};
  const applyAuthSessionLifecycle = summarizeReplayAuthSessionLifecycle(applyBody.auth?.session, now);
  const replayAuthSessionLifecycle = summarizeReplayAuthSessionLifecycle(replayBody.auth?.session, now);
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
  const applyAuthIdentityUserId = normalizeObservedAuthIdentityUserId(applyBody.auth?.identity?.userId);
  const replayAuthIdentityUserId = normalizeObservedAuthIdentityUserId(replayBody.auth?.identity?.userId);
  const equivalent = applyResponse?.status === replayResponse?.status
    && applyBody.mode === replayBody.mode
    && applyBody.ok === replayBody.ok
    && replayCodeEquivalent
    && applyBody.applied === replayBody.applied
    && replayReceiptEquivalent
    && hasResponseSchemaVersion
    && applyBody.responseSchemaVersion === replayBody.responseSchemaVersion
    && isStorageGuardEquivalent(applyBody.storageGuard, replayBody.storageGuard)
    && applyAuthIdentityUserId === replayAuthIdentityUserId
    && applyBody.auth?.identity?.userLogin === replayBody.auth?.identity?.userLogin
    && applyBody.auth?.session?.id === replayBody.auth?.session?.id
    && applyBody.auth?.session?.type === replayBody.auth?.session?.type
    && applyBody.auth?.session?.status === replayBody.auth?.session?.status
    && applyBody.auth?.session?.expiresAt === replayBody.auth?.session?.expiresAt
    && applyAuthSessionLifecycle.revoked === replayAuthSessionLifecycle.revoked
    && applyAuthSessionLifecycle.cleanedUp === replayAuthSessionLifecycle.cleanedUp
    && applyAuthSessionLifecycle.rotated === replayAuthSessionLifecycle.rotated
    && applyAuthSessionLifecycle.preserved === replayAuthSessionLifecycle.preserved
    && applyAuthSessionLifecycle.expired === replayAuthSessionLifecycle.expired
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
    ['authUserId', applyAuthIdentityUserId, replayAuthIdentityUserId],
    ['authUser', applyBody.auth?.identity?.userLogin, replayBody.auth?.identity?.userLogin],
    ['authSessionId', applyBody.auth?.session?.id, replayBody.auth?.session?.id],
    ['authSessionType', applyBody.auth?.session?.type, replayBody.auth?.session?.type],
    ['authSessionStatus', applyBody.auth?.session?.status, replayBody.auth?.session?.status],
    ['authSessionExpiresAt', applyBody.auth?.session?.expiresAt, replayBody.auth?.session?.expiresAt],
    ['authSessionRevoked', applyAuthSessionLifecycle.revoked, replayAuthSessionLifecycle.revoked],
    ['authSessionCleanedUp', applyAuthSessionLifecycle.cleanedUp, replayAuthSessionLifecycle.cleanedUp],
    ['authSessionRotated', applyAuthSessionLifecycle.rotated, replayAuthSessionLifecycle.rotated],
    ['authSessionPreserved', applyAuthSessionLifecycle.preserved, replayAuthSessionLifecycle.preserved],
    ['authSessionExpired', applyAuthSessionLifecycle.expired, replayAuthSessionLifecycle.expired],
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

function summarizeReplayAuthSessionLifecycle(session, now = new Date()) {
  if (!session || typeof session !== 'object') {
    return {
      revoked: false,
      cleanedUp: false,
      rotated: false,
      preserved: false,
      expired: false,
    };
  }

  return {
    revoked: session.revoked === true || session.status === 'revoked',
    cleanedUp: productionAuthSessionIsCleanedUp(session),
    rotated: session.rotated === true || session.status === 'rotated',
    preserved: session.preserved === true,
    expired: session.expired === true || session.status === 'expired' || isExpiredSession(session, now),
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
      required: invalidObservedIdentityField.required,
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

  const observedUserId = identity.userId;
  if (
    observedUserId !== undefined
    && observedUserId !== null
    && !normalizeObservedAuthIdentityUserId(observedUserId)
  ) {
    return {
      field: 'userId',
      label: 'user-id',
      required: 'integer auth identity fields',
    };
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
      required: 'string auth identity fields',
    };
  }

  return null;
}

function normalizeObservedAuthIdentityUserId(userId) {
  return Number.isInteger(userId) && userId > 0 ? userId : null;
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
    ['warning', 'warning', normalizeProductionAuthSessionLifecycleField(session.warning)],
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

function resolveProductionAuthSessionIdentityUserIdDrift(expected, response) {
  const expectedUserId = normalizeObservedAuthIdentityUserId(expected?.userId);
  if (!expectedUserId) {
    return null;
  }

  const session = response?.body?.auth?.session;
  if (session?.type !== 'production-auth-session') {
    return null;
  }

  const observedUserId = normalizeObservedAuthIdentityUserId(response?.body?.auth?.identity?.userId);
  if (observedUserId === expectedUserId) {
    return null;
  }

  return {
    field: 'auth.identity.userId',
    required: expectedUserId,
    observed: observedUserId || 'missing-user-id',
  };
}

function resolveProductionAuthSessionIdentityDrift(expected, response) {
  const expectedSessionId = typeof expected?.sessionId === 'string'
    ? expected.sessionId.trim()
    : '';
  if (!expectedSessionId) {
    return null;
  }

  const session = response?.body?.auth?.session;
  if (session?.type !== 'production-auth-session') {
    return null;
  }

  const observedSessionId = typeof session.id === 'string'
    ? session.id.trim()
    : '';
  if (!observedSessionId || observedSessionId === expectedSessionId) {
    return null;
  }

  return {
    field: 'auth.session.id',
    required: expectedSessionId,
    observed: observedSessionId,
  };
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

function hasProductionAuthSessionExpiryDrift(response, now = new Date()) {
  return isExpiredSession(response?.body?.auth?.session, now);
}

function hasExpiredAuthSession(response, now = new Date()) {
  return isExpiredSession(response?.body?.auth?.session, now);
}

function resolveObservedProductionAuthSessionLifecycleDrift(response, now = new Date()) {
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
    || productionAuthSessionIsCleanedUp(session)
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

  if (session?.status === 'expired' || isExpiredSession(session, now)) {
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

export function resolveUncheckedObservedAuthSessionMetadataDrift(expected, response) {
  const expectedSessionType = typeof expected?.sessionType === 'string'
    ? expected.sessionType.trim()
    : '';
  if (expectedSessionType !== 'production-auth-session') {
    return null;
  }

  const invalidLifecycleFlag = resolveInvalidProductionAuthSessionLifecycleFlag(
    response?.body?.auth?.session,
  );
  if (invalidLifecycleFlag) {
    return {
      field: `auth.session.${invalidLifecycleFlag}`,
      required: 'boolean lifecycle flags',
      observed: `invalid-${invalidLifecycleFlag}`,
      verdict: 'AUTH_SESSION_LIFECYCLE_DRIFT',
    };
  }

  const invalidSessionField = resolveInvalidProductionAuthSessionIdentityField(
    response?.body?.auth?.session,
  );
  if (invalidSessionField) {
    return {
      field: `auth.session.${invalidSessionField.field}`,
      required: 'string lifecycle fields',
      observed: `invalid-${invalidSessionField.label}`,
      verdict: 'AUTH_SESSION_LIFECYCLE_DRIFT',
    };
  }

  const invalidIdentityField = resolveInvalidObservedAuthEnvelopeIdentityField(
    response?.body?.auth?.identity,
  );
  if (invalidIdentityField) {
    return {
      field: `auth.identity.${invalidIdentityField.field}`,
      required: invalidIdentityField.required,
      observed: `invalid-${invalidIdentityField.label}`,
      verdict: 'AUTH_SESSION_LIFECYCLE_DRIFT',
    };
  }

  if (hasProductionAuthSessionRevocationDrift(response)) {
    return {
      field: resolveProductionAuthSessionUnrevokedField(response?.body?.auth?.session),
      required: 'unrevoked',
      observed: response?.body?.auth?.session?.revoked === true || response?.body?.auth?.session?.status === 'revoked'
        ? 'revoked'
        : 'cleaned-up',
      verdict: 'AUTH_SESSION_LIFECYCLE_DRIFT',
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
    ['cleaned_up', session.cleaned_up],
    ['expired', session.expired],
    ['rotated', session.rotated],
    ['preserved', session.preserved],
    ['playgroundFallback', session.playgroundFallback],
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

function setApplyRevalidationBoundary(summary) {
  if (summary.boundary) {
    return;
  }

  summary.boundary = {
    firstRemainingProductionBoundary: 'apply-time revalidation before first mutation on the checked release path',
    status: 'unimplemented',
    verdict: 'APPLY_REVALIDATION_REQUIRED',
    applyRevalidation: summary.applyRevalidation || {
      required: 'fresh-live-hashes-before-first-mutation',
      observed: 'missing-apply-revalidation-evidence',
      verdict: 'APPLY_REVALIDATION_REQUIRED',
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

  if (session?.cleaned_up === true) {
    return 'auth.session.cleaned_up';
  }

  return 'auth.session.cleanup';
}

function productionAuthSessionIsCleanedUp(session) {
  return session?.cleanedUp === true
    || session?.cleanup === true
    || session?.cleaned_up === true
    || session?.status === 'cleaned-up';
}

function hasProductionAuthSessionRevocationDrift(response) {
  const session = response?.body?.auth?.session;
  if (!session || typeof session !== 'object') {
    return false;
  }
  return session.revoked === true
    || session.status === 'revoked'
    || productionAuthSessionIsCleanedUp(session);
}

function normalizeObservationNow(now) {
  if (now instanceof Date && Number.isFinite(now.getTime())) {
    return now;
  }
  if (typeof now === 'string' || typeof now === 'number') {
    const parsed = new Date(now);
    if (Number.isFinite(parsed.getTime())) {
      return parsed;
    }
  }
  return new Date();
}

function describeApplyReceiptExpiryFailure(receipt, response, now = new Date()) {
  return resolveExpiredReceipt(receipt, now) || {
    required: 'unexpired',
    observed: response?.body?.code === 'AUTH_RECEIPT_EXPIRED'
      ? 'remote-apply-rejected-expired-receipt'
      : (response?.body?.code || 'expired-receipt'),
    verdict: 'AUTH_RECEIPT_EXPIRED',
  };
}

function resolveExpiredReceipt(receipt, now = new Date()) {
  const expiry = resolveReceiptExpiryField(receipt);
  if (!expiry) {
    return null;
  }

  const expiresAt = typeof expiry.value === 'string' ? expiry.value.trim() : '';
  const expiresAtMs = Date.parse(expiresAt);
  if (expiresAt && Number.isFinite(expiresAtMs) && expiresAtMs > normalizeObservationNow(now).getTime()) {
    return null;
  }

  return {
    field: expiry.field,
    required: 'unexpired',
    observed: expiresAt || 'invalid-receipt-expiry',
    verdict: 'AUTH_RECEIPT_EXPIRED',
  };
}

function resolveReceiptExpiryField(receipt) {
  if (!receipt || typeof receipt !== 'object') {
    return null;
  }

  const authBinding = receipt.authBinding && typeof receipt.authBinding === 'object'
    ? receipt.authBinding
    : null;
  const candidates = [
    ['receipt.authBinding.expiresAt', authBinding?.expiresAt],
    ['receipt.expiresAt', receipt.expiresAt],
    ['receipt.receiptExpiresAt', receipt.receiptExpiresAt],
  ];

  for (const [field, value] of candidates) {
    if (value !== undefined && value !== null) {
      return { field, value };
    }
  }

  return null;
}

function isExpiredSession(session, now = new Date()) {
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
  return !Number.isFinite(expiresAtMs) || expiresAtMs <= normalizeObservationNow(now).getTime();
}

function setReceiptExpiryBoundary(summary) {
  if (summary.boundary) {
    return;
  }

  summary.boundary = {
    firstRemainingProductionBoundary: 'authenticated receipt expiry validation before apply mutation',
    status: 'refused',
    verdict: 'AUTH_RECEIPT_EXPIRED',
    receiptExpiry: summary.receiptExpiry || {
      required: 'unexpired',
      observed: 'expired-receipt',
      verdict: 'AUTH_RECEIPT_EXPIRED',
    },
  };
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

function setReplayAndRetryBoundary(summary, options = {}) {
  const durableJournalProven = options.durableJournalProven === true;
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
    durableJournal: durableJournalProven
      ? {
          verdict: 'LIVE_RELEASE_BOUNDARY_OK',
        }
      : {
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
  const retryable = options.retryable === true
    || (typeof headers !== 'function' && isRetryableReadOnlyGet(baseUrl, method, pathname, headers));
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
      const attemptHeaders = typeof headers === 'function' ? headers({ attempt }) : headers;
      const response = await requestJsonRawOnce(baseUrl, method, pathname, rawBody, attemptHeaders, requestTimeoutMs);
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
  const nonce = signedNonceForAttempt(options);
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

function signedNonceForAttempt(options = {}) {
  const attempt = Number.isInteger(options.attempt) && options.attempt > 0
    ? options.attempt
    : 1;
  if (options.nonce && attempt === 1) {
    return options.nonce;
  }
  if (options.nonce && attempt > 1) {
    return nextSignedNonce(`${options.nonce}-retry-${attempt}`);
  }
  return nextSignedNonce('cli-push');
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

function assertReadOnlySignedRequestOptions(pathname, options) {
  if (options.idempotencyKey !== undefined) {
    throw new Error(`Read-only signed request must not carry push idempotencyKey: ${pathname}`);
  }
  if (isReadOnlySessionBoundPath(pathname) && (options.session === undefined || options.session === '')) {
    throw new Error(`Missing push session for read-only signed request: ${pathname}`);
  }
  if (options.session !== undefined && options.session !== '' && !isValidPushSession(options.session)) {
    throw new Error(`Invalid push session for read-only signed request: ${pathname}`);
  }
}

function assertReadOnlySignedPostOptions(pathname, options) {
  if (!isReadOnlyRecoveryInspectPath(pathname)) {
    throw new Error(`Read-only signed POST is only supported for recovery inspect: ${pathname}`);
  }
  if (options.session === undefined || options.session === '') {
    throw new Error(`Missing push session for read-only signed request: ${pathname}`);
  }
  assertReadOnlySignedRequestOptions(pathname, options);
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

function isReadOnlyRecoveryInspectPath(pathname) {
  const [pathOnly] = String(pathname || '').split('?', 1);
  return pathOnly.endsWith('/recovery/inspect');
}

function isReadOnlyJournalInspectPath(pathname) {
  const [pathOnly] = String(pathname || '').split('?', 1);
  return pathOnly.endsWith('/db-journal');
}

function isReadOnlySessionBoundPath(pathname) {
  return isReadOnlyRecoveryInspectPath(pathname) || isReadOnlyJournalInspectPath(pathname);
}

function hmacHex(key, data) {
  return createHmac('sha256', key).update(data, 'utf8').digest('hex');
}

function sha256Hex(data) {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function hasNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
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
