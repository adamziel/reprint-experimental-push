import { createHash, createHmac, randomBytes } from 'node:crypto';
import { createPushPlan } from './planner.js';
import { digest } from './stable-json.js';
import { evaluateProductionAuthSessionLifecycleSummary } from '../scripts/playground/production-auth-session-lifecycle.js';

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
  const normalizedAuthSessionSource = normalizeAuthenticatedHttpPushSource(authSessionSource, sourceUrl);
  const resolvedSource = normalizedAuthSessionSource
    ? {
      sourceUrl: normalizedAuthSessionSource.sourceUrl,
      username: normalizedAuthSessionSource.username,
      applicationPassword: normalizedAuthSessionSource.applicationPassword,
    }
    : {
      sourceUrl,
      username,
      applicationPassword,
    };
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
    allowedSourceUrl: sourceUrl,
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
      labBacked: !normalizedAuthSessionSource,
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
  };

  const preflight = await client.signedGet('/preflight', { retryable: true });
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
  recordAuthSessionLifecycle(summary, 'preflight', preflight.body.auth?.session);
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
    summary.boundary = {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: summary.authSession,
    };
    return summary;
  }
  const uncheckedPreflightAuthSessionTermination = requireProductionAuthSession
    ? null
    : resolveUncheckedPreflightAuthSessionTermination(preflight);
  if (uncheckedPreflightAuthSessionTermination) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      field: uncheckedPreflightAuthSessionTermination.field,
      required: uncheckedPreflightAuthSessionTermination.required,
      observed: uncheckedPreflightAuthSessionTermination.observed,
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
    userId: preflight.body.auth?.identity?.userId,
    userLogin: preflight.body.auth?.identity?.userLogin,
    sessionId: preflight.body.auth?.session?.id,
    sessionType: preflight.body.auth?.session?.type,
    sessionStatus: preflight.body.auth?.session?.status,
    sessionExpiresAt: preflight.body.auth?.session?.expiresAt,
  };
  const preflightAuthEnvelopeDrift = describeAuthEnvelopeDrift(preflightAuthEnvelope, preflight);
  if (preflightAuthEnvelopeDrift) {
    summary.code = 'AUTH_SESSION_LIFECYCLE_DRIFT';
    summary.authSession = preflightAuthEnvelopeDrift;
    setAuthSessionBoundary(summary, summary.authSession);
    return summary;
  }
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
  if (requireProductionAuthSession && preflight.body.auth?.session?.type !== 'production-auth-session') {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = describeRequiredProductionAuthSession(preflight);
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
    summary.authSession = describeRequiredProductionAuthSession(preflight);
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
    summary.authSession = describeRequiredProductionAuthSession(preflight);
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
    summary.authSession = describeRequiredProductionAuthSession(preflight);
    summary.boundary = {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: summary.authSession,
    };
    return summary;
  }

  const snapshotPath = labDriftAfterSnapshot
    ? `/snapshot?reprint_push_lab_drift_after_snapshot=${encodeURIComponent(labDriftAfterSnapshot)}`
    : '/snapshot';
  const authSessionDriftQuery = labAuthSessionDrift
    ? `reprint_push_lab_auth_session_drift=${encodeURIComponent(labAuthSessionDrift)}`
    : '';
  const withAuthSessionDrift = (pathname) => appendQueryParam(pathname, authSessionDriftQuery);
  const remoteSnapshot = await client.get(snapshotPath);
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

  const dryRun = await client.signedPost(withAuthSessionDrift('/dry-run'), { plan }, {
    session,
    idempotencyKey,
  });
  summary.dryRun = summarizeResponse(dryRun);
  updateRetryAttempts(summary, summary.dryRun);
  recordAuthSessionLifecycle(summary, 'dry-run', dryRun.body?.auth?.session);
  const dryRunObservedLifecycleDrift = requireProductionAuthSession
    ? resolveObservedProductionAuthSessionLifecycleDrift(dryRun)
    : null;
  const dryRunObservedProductionAuthIdentityDrift = requireProductionAuthSession
    ? resolveObservedProductionAuthIdentityDrift(preflightAuthEnvelope, dryRun)
    : null;
  const dryRunLifecycleTerminationDrift = resolveObservedAuthSessionLifecycleTerminationSummary(summary);
  const dryRunObservedAuthLifecycleFlagDrift = requireProductionAuthSession
    ? null
    : resolveObservedAuthSessionLifecycleFlagDrift(dryRun);
  const dryRunObservedAuthSourceMetadataDrift = requireProductionAuthSession
    ? null
    : resolveObservedAuthSessionSourceMetadataDrift(dryRun);
  const dryRunAuthEnvelopeDrift = describeAuthEnvelopeDrift(preflightAuthEnvelope, dryRun);
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
    summary.boundary = {
      firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
      status: 'unimplemented',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      authSession: summary.authSession,
    };
    return summary;
  }
  if (dryRunLifecycleTerminationDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = dryRunLifecycleTerminationDrift;
    setAuthSessionBoundary(summary, summary.authSession);
    return summary;
  }
  if (dryRunObservedProductionAuthIdentityDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      ...dryRunObservedProductionAuthIdentityDrift,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setAuthSessionBoundary(summary, summary.authSession);
    return summary;
  }
  if (dryRunObservedAuthLifecycleFlagDrift) {
    summary.code = 'AUTH_SESSION_LIFECYCLE_DRIFT';
    summary.authSession = dryRunObservedAuthLifecycleFlagDrift;
    setDurableJournalBoundary(summary, 'dry-run');
    return summary;
  }
  if (dryRunObservedAuthSourceMetadataDrift) {
    summary.code = 'AUTH_SESSION_LIFECYCLE_DRIFT';
    summary.authSession = dryRunObservedAuthSourceMetadataDrift;
    setDurableJournalBoundary(summary, 'dry-run');
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
  if (dryRunAuthEnvelopeDrift) {
    summary.code = 'AUTH_SESSION_LIFECYCLE_DRIFT';
    summary.authSession = dryRunAuthEnvelopeDrift;
    setDurableJournalBoundary(summary, 'dry-run');
    return summary;
  }
  const dryRunLifecycleSummaryDrift = requireProductionAuthSession
    ? resolveRequiredProductionAuthSessionSummary(summary)
    : null;
  if (dryRunLifecycleSummaryDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = dryRunLifecycleSummaryDrift;
    setAuthSessionBoundary(summary, summary.authSession);
    return summary;
  }

  if (dryRunOnly) {
    const afterDryRun = await client.get('/snapshot');
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
    const staleClaimAttempt = await client.signedPost(withAuthSessionDrift('/apply'), applyPayload, {
      session,
      idempotencyKey,
    });
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

  apply = await client.signedPost(withAuthSessionDrift('/apply'), applyPayload, {
    session,
    idempotencyKey,
  });
  summary.apply = summarizeResponse(apply);
  updateRetryAttempts(summary, summary.apply);
  recordAuthSessionLifecycle(summary, 'apply', apply.body?.auth?.session);
  const applyObservedLifecycleDrift = requireProductionAuthSession
    ? resolveObservedProductionAuthSessionLifecycleDrift(apply)
    : null;
  const applyObservedProductionAuthIdentityDrift = requireProductionAuthSession
    ? resolveObservedProductionAuthIdentityDrift(preflightAuthEnvelope, apply)
    : null;
  const applyLifecycleTerminationDrift = resolveObservedAuthSessionLifecycleTerminationSummary(summary);
  const applyObservedAuthLifecycleFlagDrift = requireProductionAuthSession
    ? null
    : resolveObservedAuthSessionLifecycleFlagDrift(apply);
  const applyObservedAuthSourceMetadataDrift = requireProductionAuthSession
    ? null
    : resolveObservedAuthSessionSourceMetadataDrift(apply);
  const applyAuthEnvelopeDrift = describeAuthEnvelopeDrift(preflightAuthEnvelope, apply);
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
    setAuthSessionBoundary(summary, summary.authSession);
    return summary;
  }
  if (applyLifecycleTerminationDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = applyLifecycleTerminationDrift;
    setAuthSessionBoundary(summary, summary.authSession);
    return summary;
  }
  if (applyObservedProductionAuthIdentityDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      ...applyObservedProductionAuthIdentityDrift,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setAuthSessionBoundary(summary, summary.authSession);
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
  if (applyAuthEnvelopeDrift) {
    summary.code = 'AUTH_SESSION_LIFECYCLE_DRIFT';
    summary.authSession = applyAuthEnvelopeDrift;
    setDurableJournalBoundary(summary, 'apply');
    return summary;
  }
  if (applyObservedAuthLifecycleFlagDrift) {
    summary.code = 'AUTH_SESSION_LIFECYCLE_DRIFT';
    summary.authSession = applyObservedAuthLifecycleFlagDrift;
    setDurableJournalBoundary(summary, 'apply');
    return summary;
  }
  if (applyObservedAuthSourceMetadataDrift) {
    summary.code = 'AUTH_SESSION_LIFECYCLE_DRIFT';
    summary.authSession = applyObservedAuthSourceMetadataDrift;
    setDurableJournalBoundary(summary, 'apply');
    return summary;
  }
  if (hasExpiredAuthSession(apply)) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = describeRequiredProductionAuthSession(apply);
    setAuthSessionBoundary(summary, summary.authSession);
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
    summary.authSession = describeRequiredProductionAuthSession(apply);
    setAuthSessionBoundary(summary, summary.authSession);
    return summary;
  }
  const applyLifecycleSummaryDrift = requireProductionAuthSession
    ? resolveRequiredProductionAuthSessionSummary(summary)
    : null;
  if (applyLifecycleSummaryDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = applyLifecycleSummaryDrift;
    setAuthSessionBoundary(summary, summary.authSession);
    return summary;
  }

  const recoveryInspect = await client.signedPost(withAuthSessionDrift('/recovery/inspect'), {
    plan,
    receipt: dryRun.body.receipt,
  }, {
    session,
    idempotencyKey,
  });
  summary.recoveryInspect = summarizeResponse(recoveryInspect);
  updateRetryAttempts(summary, summary.recoveryInspect);
  recordAuthSessionLifecycle(summary, 'recovery-inspect', recoveryInspect.body?.auth?.session);
  summary.recoveryInspect.recovery = summarizeRecoveryInspect(recoveryInspect);
  const recoveryInspectObservedLifecycleDrift = requireProductionAuthSession
    ? resolveObservedProductionAuthSessionLifecycleDrift(recoveryInspect)
    : null;
  const recoveryInspectObservedProductionAuthIdentityDrift = requireProductionAuthSession
    ? resolveObservedProductionAuthIdentityDrift(preflightAuthEnvelope, recoveryInspect)
    : null;
  const recoveryInspectLifecycleTerminationDrift = resolveObservedAuthSessionLifecycleTerminationSummary(summary);
  const recoveryInspectObservedAuthLifecycleFlagDrift = requireProductionAuthSession
    ? null
    : resolveObservedAuthSessionLifecycleFlagDrift(recoveryInspect);
  const recoveryInspectObservedAuthSourceMetadataDrift = requireProductionAuthSession
    ? null
    : resolveObservedAuthSessionSourceMetadataDrift(recoveryInspect);
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
    setAuthSessionBoundary(summary, summary.authSession);
    return summary;
  }
  if (recoveryInspectLifecycleTerminationDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = recoveryInspectLifecycleTerminationDrift;
    setAuthSessionBoundary(summary, summary.authSession);
    return summary;
  }
  if (recoveryInspectObservedProductionAuthIdentityDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      ...recoveryInspectObservedProductionAuthIdentityDrift,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setAuthSessionBoundary(summary, summary.authSession);
    return summary;
  }
  if (recoveryInspectObservedAuthLifecycleFlagDrift) {
    summary.code = 'AUTH_SESSION_LIFECYCLE_DRIFT';
    summary.authSession = recoveryInspectObservedAuthLifecycleFlagDrift;
    setDurableJournalBoundary(summary, 'recovery-inspect');
    return summary;
  }
  if (recoveryInspectObservedAuthSourceMetadataDrift) {
    summary.code = 'AUTH_SESSION_LIFECYCLE_DRIFT';
    summary.authSession = recoveryInspectObservedAuthSourceMetadataDrift;
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
  if (hasExpiredAuthSession(recoveryInspect)) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = describeRequiredProductionAuthSession(recoveryInspect);
    setAuthSessionBoundary(summary, summary.authSession);
    return summary;
  }
  if (recoveryInspectAuthSessionDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = describeRequiredProductionAuthSession(recoveryInspect);
    setAuthSessionBoundary(summary, summary.authSession);
    return summary;
  }
  const recoveryInspectAuthEnvelopeDrift = describeAuthEnvelopeDrift(preflightAuthEnvelope, recoveryInspect);
  if (recoveryInspectAuthEnvelopeDrift) {
    summary.code = 'AUTH_SESSION_LIFECYCLE_DRIFT';
    summary.authSession = recoveryInspectAuthEnvelopeDrift;
    setDurableJournalBoundary(summary, 'recovery-inspect');
    return summary;
  }
  const recoveryInspectLifecycleSummaryDrift = requireProductionAuthSession
    ? resolveRequiredProductionAuthSessionSummary(summary)
    : null;
  if (recoveryInspectLifecycleSummaryDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = recoveryInspectLifecycleSummaryDrift;
    setAuthSessionBoundary(summary, summary.authSession);
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

  const replay = await client.signedPost(withAuthSessionDrift('/apply'), applyPayload, {
    session,
    idempotencyKey,
  });
  summary.replay = summarizeResponse(replay);
  updateRetryAttempts(summary, summary.replay);
  recordAuthSessionLifecycle(summary, 'replay', replay.body?.auth?.session);
  summary.replay.responseSchemaVersion = replay.body?.responseSchemaVersion;
  const replayEquivalence = summarizeReplayEquivalence(apply, replay);
  summary.replayEquivalence = replayEquivalence;
  const replayEquivalent = replayEquivalence.equivalent;
  const replayLifecycleTerminationDrift = resolveObservedAuthSessionLifecycleTerminationSummary(summary);
  const replayAuthEnvelopeDrift = describeAuthEnvelopeDrift(preflightAuthEnvelope, replay);
  const replayObservedLifecycleDrift = requireProductionAuthSession
    ? resolveObservedProductionAuthSessionLifecycleDrift(replay)
    : null;
  const replayObservedProductionAuthIdentityDrift = requireProductionAuthSession
    ? resolveObservedProductionAuthIdentityDrift(preflightAuthEnvelope, replay)
    : null;
  const replayObservedAuthLifecycleFlagDrift = requireProductionAuthSession
    ? null
    : resolveObservedAuthSessionLifecycleFlagDrift(replay);
  const replayObservedAuthSourceMetadataDrift = requireProductionAuthSession
    ? null
    : resolveObservedAuthSessionSourceMetadataDrift(replay);
  const replayAuthSessionDrift = requireProductionAuthSession && (
    hasProductionAuthSessionTypeDrift(replay)
    || hasProductionAuthSessionStatusDrift(replay)
    || hasMissingProductionAuthSessionExpiry(replay)
    || hasProductionAuthSessionExpiryDrift(replay)
  );
  if (replayObservedLifecycleDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      ...(replayObservedLifecycleDrift.field ? { field: replayObservedLifecycleDrift.field } : {}),
      required: replayObservedLifecycleDrift.required,
      observed: replayObservedLifecycleDrift.observed,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setAuthSessionBoundary(summary, summary.authSession);
    return summary;
  }
  if (replayLifecycleTerminationDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = replayLifecycleTerminationDrift;
    setAuthSessionBoundary(summary, summary.authSession);
    return summary;
  }
  if (replayObservedProductionAuthIdentityDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      ...replayObservedProductionAuthIdentityDrift,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setAuthSessionBoundary(summary, summary.authSession);
    return summary;
  }
  if (replayObservedAuthLifecycleFlagDrift) {
    summary.code = 'AUTH_SESSION_LIFECYCLE_DRIFT';
    summary.authSession = replayObservedAuthLifecycleFlagDrift;
    setDurableJournalBoundary(summary, 'replay');
    return summary;
  }
  if (replayObservedAuthSourceMetadataDrift) {
    summary.code = 'AUTH_SESSION_LIFECYCLE_DRIFT';
    summary.authSession = replayObservedAuthSourceMetadataDrift;
    setDurableJournalBoundary(summary, 'replay');
    return summary;
  }
  if (replayAuthSessionDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = describeRequiredProductionAuthSession(replay);
    setAuthSessionBoundary(summary, summary.authSession);
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
  if (hasExpiredAuthSession(replay)) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = describeRequiredProductionAuthSession(replay);
    setAuthSessionBoundary(summary, summary.authSession);
    return summary;
  }
  if (recoveryInspectAuthEnvelopeDrift || replayAuthEnvelopeDrift) {
    summary.code = 'AUTH_SESSION_LIFECYCLE_DRIFT';
    summary.authSession = recoveryInspectAuthEnvelopeDrift
      || replayAuthEnvelopeDrift;
    setDurableJournalBoundary(summary, 'replay');
    return summary;
  }
  const replayLifecycleSummaryDrift = requireProductionAuthSession
    ? resolveRequiredProductionAuthSessionSummary(summary)
    : null;
  if (replayLifecycleSummaryDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = replayLifecycleSummaryDrift;
    setAuthSessionBoundary(summary, summary.authSession);
    return summary;
  }

  const afterApply = await client.get('/snapshot');
  summary.after = summarizeSnapshot(afterApply, local);
  updateRetryAttempts(summary, summary.after);
  summary.afterObject = afterApply.body.snapshot;
  const dbJournal = await client.signedGet(withAuthSessionDrift('/db-journal?limit=80'), {
    session,
    idempotencyKey,
    retryable: true,
  });
  summary.dbJournal = summarizeDbJournal(dbJournal);
  updateRetryAttempts(summary, summary.dbJournal);
  recordAuthSessionLifecycle(summary, 'journal', dbJournal.body?.auth?.session);
  const dbJournalObservedLifecycleDrift = requireProductionAuthSession
    ? resolveObservedProductionAuthSessionLifecycleDrift(dbJournal)
    : null;
  const dbJournalObservedProductionAuthIdentityDrift = requireProductionAuthSession
    ? resolveObservedProductionAuthIdentityDrift(preflightAuthEnvelope, dbJournal)
    : null;
  const dbJournalLifecycleTerminationDrift = resolveObservedAuthSessionLifecycleTerminationSummary(summary);
  const dbJournalObservedAuthLifecycleFlagDrift = requireProductionAuthSession
    ? null
    : resolveObservedAuthSessionLifecycleFlagDrift(dbJournal);
  const dbJournalObservedAuthSourceMetadataDrift = requireProductionAuthSession
    ? null
    : resolveObservedAuthSessionSourceMetadataDrift(dbJournal);
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
    setAuthSessionBoundary(summary, summary.authSession);
    return summary;
  }
  if (dbJournalLifecycleTerminationDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = dbJournalLifecycleTerminationDrift;
    setAuthSessionBoundary(summary, summary.authSession);
    return summary;
  }
  if (dbJournalObservedProductionAuthIdentityDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      ...dbJournalObservedProductionAuthIdentityDrift,
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setAuthSessionBoundary(summary, summary.authSession);
    return summary;
  }
  if (dbJournalObservedAuthLifecycleFlagDrift) {
    summary.code = 'AUTH_SESSION_LIFECYCLE_DRIFT';
    summary.authSession = dbJournalObservedAuthLifecycleFlagDrift;
    setDurableJournalBoundary(summary, 'journal-inspect');
    return summary;
  }
  if (dbJournalObservedAuthSourceMetadataDrift) {
    summary.code = 'AUTH_SESSION_LIFECYCLE_DRIFT';
    summary.authSession = dbJournalObservedAuthSourceMetadataDrift;
    setDurableJournalBoundary(summary, 'journal-inspect');
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
  if (hasExpiredAuthSession(dbJournal)) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = describeRequiredProductionAuthSession(dbJournal);
    setAuthSessionBoundary(summary, summary.authSession);
    return summary;
  }
  if (dbJournalAuthSessionDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = describeRequiredProductionAuthSession(dbJournal);
    setAuthSessionBoundary(summary, summary.authSession);
    return summary;
  }
  const dbJournalLifecycleSummaryDrift = requireProductionAuthSession
    ? resolveRequiredProductionAuthSessionSummary(summary)
    : null;
  if (dbJournalLifecycleSummaryDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = dbJournalLifecycleSummaryDrift;
    setAuthSessionBoundary(summary, summary.authSession);
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
    && dbJournalProofIsAcceptable(summary.dbJournal)
    && summary.after?.finalMatchesLocal === true;
  if (!summary.ok) {
    const replayIdempotency = replay.body?.idempotency;
    const authEnvelopeDrift = applyAuthEnvelopeDrift || replayAuthEnvelopeDrift;
    const journalProofFailed = dbJournal.status === 200
      && dbJournal.body?.ok === true
      && !dbJournalProofIsAcceptable(summary.dbJournal);
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
  const normalizedAuthSessionSource = normalizeAuthenticatedHttpPushSource(authSessionSource, sourceUrl);
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

function normalizeAuthenticatedHttpPushSource(authSessionSource, allowedSourceUrl = '') {
  if (!authSessionSource?.ok) {
    return null;
  }

  const sourceUrl = normalizeSupportedAuthenticatedHttpPushSourceUrl(
    authSessionSource.sourceUrl,
    allowedSourceUrl,
  );
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

function normalizeSupportedAuthenticatedHttpPushSourceUrl(value, allowedSourceUrl = '') {
  const sourceUrl = normalizeAuthenticatedHttpPushSourceField(value);
  if (!sourceUrl) {
    return '';
  }

  return isSupportedAuthenticatedHttpPushSourceUrl(sourceUrl, allowedSourceUrl)
    ? sourceUrl
    : '';
}

function isSupportedAuthenticatedHttpPushSourceUrl(sourceUrl, allowedSourceUrl = '') {
  let parsed;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return false;
  }

  if (
    (parsed.protocol === 'http:' || parsed.protocol === 'https:')
    && isLoopbackHost(parsed.hostname)
  ) {
    return true;
  }

  if (matchesAllowedAuthenticatedHttpPushSourceUrl(sourceUrl, allowedSourceUrl)) {
    return true;
  }

  return false;
}

function matchesAllowedAuthenticatedHttpPushSourceUrl(sourceUrl, allowedSourceUrl = '') {
  const normalizedAllowedSourceUrl = normalizeAuthenticatedHttpPushSourceField(allowedSourceUrl);
  if (!normalizedAllowedSourceUrl) {
    return false;
  }

  try {
    const sourceBaseUrl = normalizeBaseUrl(sourceUrl);
    const allowedBaseUrl = normalizeBaseUrl(normalizedAllowedSourceUrl);
    return sourceBaseUrl.protocol === allowedBaseUrl.protocol
      && sourceBaseUrl.host === allowedBaseUrl.host
      && sourceBaseUrl.pathname === allowedBaseUrl.pathname;
  } catch {
    return false;
  }
}

export function authenticatedHttpClient({
  sourceUrl,
  credential,
  routeProfile = 'lab-authenticated',
  allowedSourceUrl = '',
  requestTimeoutMs = 10_000,
  simulatePreservedRemoteRetryPath = '',
}) {
  const baseUrl = normalizeBaseUrl(sourceUrl);
  const profile = resolveRouteProfile(routeProfile);
  assertSupportedSourceUrlForRouteProfile(baseUrl, profile, allowedSourceUrl);
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
  };
}

function updateRetryAttempts(summary, responseSummary) {
  if (!responseSummary || typeof responseSummary.retryAttempts !== 'number') {
    return;
  }

  summary.retryAttempts = Math.max(summary.retryAttempts || 1, responseSummary.retryAttempts);
}

function summarizeAuthSessionLifecycle(session) {
  if (!session || typeof session !== 'object') {
    return null;
  }

  const invalidLifecycleFlag = resolveInvalidProductionAuthSessionLifecycleFlag(session);
  const invalidIdentityField = resolveInvalidProductionAuthSessionIdentityField(session);
  const unrevokedObservation = resolveProductionAuthSessionUnrevokedObservation(session);
  const expiredObservation = resolveProductionAuthSessionExpiredObservation(session);

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
    expired: session.expired === true || session.status === 'expired' || isExpiredSession(session),
    revoked: session.revoked === true || session.status === 'revoked',
    cleanedUp: session.cleanedUp === true || session.cleanup === true || session.status === 'cleaned-up',
    cleanup: session.cleanup === true ? true : session.cleanup === false ? false : null,
    rotated: session.rotated === true || session.status === 'rotated'
      ? true
      : session.rotated === false
        ? false
        : null,
    preserved: session.preserved === true ? true : session.preserved === false ? false : null,
    ...(session.playgroundFallback === true ? { playgroundFallback: true } : {}),
    ...(typeof session.warning === 'string' ? { warning: session.warning } : {}),
  };
}

function recordAuthSessionLifecycle(summary, step, session) {
  const observation = summarizeAuthSessionLifecycle(session);
  const trace = summary.authSessionLifecycleTrace || [];
  const previous = trace.length > 0 ? trace[trace.length - 1] : null;
  const previousSessionId = normalizeProductionAuthSessionIdentityField(previous?.id);
  const observationSessionId = normalizeProductionAuthSessionIdentityField(observation?.id);
  const readStep = isAuthSessionReadStep(step);
  const rotated = Boolean(
    observation?.rotated === true
    || (
      previousSessionId
      && observationSessionId
      && previousSessionId !== observationSessionId
    )
  );
  const preserved = Boolean(
    readStep
    && !rotated
    && observation?.preserved !== false
    && (
      observation?.preserved === true
      || (
        previousSessionId
        && observationSessionId
        && previousSessionId === observationSessionId
      )
    )
  );
  const lifecycle = {
    step,
    ...observation,
    rotated,
    preserved,
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
    status: observation?.status || null,
    expiresAt: observation?.expiresAt || null,
    ...(typeof observation?.invalidLifecycleFlag === 'string' && observation.invalidLifecycleFlag
      ? { invalidLifecycleFlag: observation.invalidLifecycleFlag }
      : {}),
    ...(typeof observation?.invalidIdentityField === 'string' && observation.invalidIdentityField
      ? { invalidIdentityField: observation.invalidIdentityField }
      : {}),
    ...(typeof observation?.unrevokedField === 'string' && observation.unrevokedField
      ? { unrevokedField: observation.unrevokedField }
      : {}),
    ...(typeof observation?.expiredField === 'string' && observation.expiredField
      ? { expiredField: observation.expiredField }
      : {}),
    ...(typeof observation?.rotatedField === 'string' && observation.rotatedField
      ? { rotatedField: observation.rotatedField }
      : {}),
    expired: Boolean(observation?.expired),
    revoked: Boolean(observation?.revoked),
    cleanedUp: Boolean(observation?.cleanedUp),
    cleanup: observation?.cleanup === true,
    rotated: lifecycle.rotated,
    preserved: lifecycle.preserved,
    ...(observation?.playgroundFallback === true ? { playgroundFallback: true } : {}),
    ...(typeof observation?.warning === 'string' ? { warning: observation.warning } : {}),
  });
  summary.authSessionLifecycleSummary = summarizeAuthSessionLifecycleHistory(
    summary.authSessionLifecycle.history,
  );
  const lifecycleSummary = summary.authSessionLifecycleSummary || {};
  if (step === 'preflight') {
    summary.authSessionLifecycle.minted = {
      id: observation?.id || null,
      type: observation?.type || null,
      status: observation?.status || null,
      expiresAt: observation?.expiresAt || null,
      ...(typeof observation?.invalidLifecycleFlag === 'string' && observation.invalidLifecycleFlag
        ? { invalidLifecycleFlag: observation.invalidLifecycleFlag }
        : {}),
      ...(typeof observation?.invalidIdentityField === 'string' && observation.invalidIdentityField
        ? { invalidIdentityField: observation.invalidIdentityField }
        : {}),
      ...(typeof observation?.unrevokedField === 'string' && observation.unrevokedField
        ? { unrevokedField: observation.unrevokedField }
        : {}),
      ...(typeof observation?.expiredField === 'string' && observation.expiredField
        ? { expiredField: observation.expiredField }
        : {}),
      ...(typeof observation?.rotatedField === 'string' && observation.rotatedField
        ? { rotatedField: observation.rotatedField }
        : {}),
      expired: Boolean(observation?.expired),
      revoked: Boolean(observation?.revoked),
      cleanedUp: Boolean(observation?.cleanedUp),
      cleanup: observation?.cleanup === true,
      rotated: lifecycle.rotated,
      preserved: lifecycle.preserved,
      ...(observation?.playgroundFallback === true ? { playgroundFallback: true } : {}),
      ...(typeof observation?.warning === 'string' ? { warning: observation.warning } : {}),
    };
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
        : step] = lifecycle;
  summary.authSessionLifecycle.read = lifecycle;
  summary.authSessionLifecycle.expired = lifecycleSummary.expired || null;
  summary.authSessionLifecycle.revoked = lifecycleSummary.revoked || null;
  summary.authSessionLifecycle.cleanedUp = lifecycleSummary.cleanedUp || null;
  summary.authSessionLifecycle.rotated = lifecycleSummary.rotated || null;
  summary.authSessionLifecycle.preserved = lifecycleSummary.preserved || null;
}

function summarizeAuthSessionLifecycleHistory(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return null;
  }

  const observations = history.filter((entry) => entry && typeof entry === 'object');
  const issued = observations.find((entry) => entry.step === 'preflight') || null;
  const read = [...observations]
    .reverse()
    .find((entry) => isAuthSessionReadStep(entry.step)) || null;
  return {
    issued,
    read,
    expired: observations.find((entry) => entry.expired) || null,
    revoked: observations.find((entry) => entry.revoked) || null,
    cleanedUp: observations.find((entry) => entry.cleanedUp) || null,
    rotated: observations.find((entry) => entry.rotated) || null,
    preserved: observations.find(
      (entry) => isAuthSessionReadStep(entry.step) && entry.preserved === true,
    ) || null,
    observations,
  };
}

function resolveRequiredProductionAuthSessionSummary(summary) {
  const lifecycleSummary = summary?.authSessionLifecycleSummary;
  if (!lifecycleSummary) {
    return null;
  }

  const observedLifecycle = evaluateProductionAuthSessionLifecycleSummary(lifecycleSummary);
  if (observedLifecycle.ok) {
    return null;
  }

  return {
    ...(observedLifecycle.field ? { field: observedLifecycle.field } : {}),
    required: observedLifecycle.required,
    observed: observedLifecycle.observed,
    verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
  };
}

function resolveObservedAuthSessionLifecycleTerminationSummary(summary) {
  const lifecycleSummary = summary?.authSessionLifecycleSummary;
  if (
    !lifecycleSummary
    || (
      !lifecycleSummary.revoked
      && !lifecycleSummary.cleanedUp
      && !lifecycleSummary.rotated
      && !lifecycleSummary.expired
    )
  ) {
    return null;
  }

  const observedLifecycle = evaluateProductionAuthSessionLifecycleSummary(lifecycleSummary);
  if (observedLifecycle.ok) {
    return null;
  }

  return {
    ...(observedLifecycle.field ? { field: observedLifecycle.field } : {}),
    required: observedLifecycle.required,
    observed: observedLifecycle.observed,
    verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
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
    leaseFence: summarizeDbJournalLeaseFence(response.body?.dbJournal),
    authUser: response.body?.auth?.identity?.userLogin,
    authSessionId: response.body?.auth?.session?.id,
    sessionType: response.body?.auth?.session?.type,
    sessionStatus: response.body?.auth?.session?.status,
    sessionExpiresAt: response.body?.auth?.session?.expiresAt,
  };
}

function dbJournalProofIsAcceptable(dbJournal) {
  return dbJournal?.applyCommitted === true
    && dbJournal?.idempotencyOpened > 0
    && dbJournal?.mutationApplied > 0
    && dbJournalStorageGuardIsTrusted(dbJournal?.storageGuard);
}

function dbJournalStorageGuardIsTrusted(storageGuard) {
  return (
    storageGuard?.boundary === 'filesystem-compare-rename'
    || storageGuard?.boundary === 'wpdb-single-statement-cas'
  )
    && storageGuard?.operation === 'update'
    && storageGuard?.outcome === 'applied';
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
  };
}

function summarizeDbJournalLeaseFence(dbJournal) {
  const leaseFence = dbJournal?.leaseFence;
  if (!leaseFence || typeof leaseFence !== 'object') {
    return undefined;
  }

  return {
    boundary: leaseFence.boundary || null,
    claimKeyUnique: leaseFence.claimKeyUnique === true,
    monotonicSequence: leaseFence.monotonicSequence === true,
    restartReadable: leaseFence.restartReadable === true,
    staleClaimRejected: leaseFence.staleClaimRejected === true,
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
      required: invalidObservedIdentityField.required,
      observed: `invalid-${invalidObservedIdentityField.label}`,
      verdict: 'AUTH_SESSION_LIFECYCLE_DRIFT',
    };
  }

  const observedUserLogin = body.auth?.identity?.userLogin || 'missing';
  if (observedUserLogin !== expected.userLogin) {
    return {
      field: 'auth.identity.userLogin',
      required: expected.userLogin || 'auth-user',
      observed: observedUserLogin,
      verdict: 'AUTH_SESSION_LIFECYCLE_DRIFT',
    };
  }

  const observedSessionId = body.auth?.session?.id || 'missing';
  if (observedSessionId !== expected.sessionId) {
    return {
      field: 'auth.session.id',
      required: expected.sessionId || 'auth-session',
      observed: observedSessionId,
      verdict: 'AUTH_SESSION_LIFECYCLE_DRIFT',
    };
  }

  const observedSessionType = body.auth?.session?.type || 'missing';
  if (observedSessionType !== expected.sessionType) {
    return {
      field: 'auth.session.type',
      required: expected.sessionType || 'auth-session',
      observed: observedSessionType,
      verdict: 'AUTH_SESSION_LIFECYCLE_DRIFT',
    };
  }

  const observedSessionStatus = body.auth?.session?.status || 'missing';
  if (observedSessionStatus !== expected.sessionStatus) {
    return {
      field: 'auth.session.status',
      required: expected.sessionStatus || 'auth-session-status',
      observed: observedSessionStatus,
      verdict: 'AUTH_SESSION_LIFECYCLE_DRIFT',
    };
  }

  const observedSessionExpiresAt = body.auth?.session?.expiresAt || 'missing';
  if (observedSessionExpiresAt !== expected.sessionExpiresAt) {
    return {
      field: 'auth.session.expiresAt',
      required: expected.sessionExpiresAt || 'auth-session-expiry',
      observed: observedSessionExpiresAt,
      verdict: 'AUTH_SESSION_LIFECYCLE_DRIFT',
    };
  }

  return null;
}

function resolveInvalidObservedAuthEnvelopeIdentityField(identity) {
  if (!identity || typeof identity !== 'object') {
    return null;
  }

  const observedUserId = normalizeProductionAuthSessionIdentityUserId(identity.userId);
  if (
    identity.userId !== undefined
    && identity.userId !== null
    && observedUserId === null
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
    && !normalizeProductionAuthSessionIdentityField(observedUserLogin)
  ) {
    return {
      field: 'userLogin',
      label: 'user-login',
      required: 'string auth identity fields',
    };
  }

  return null;
}

function resolveInvalidObservedAuthEnvelopeSessionField(session) {
  if (!session || typeof session !== 'object') {
    return null;
  }

  const fieldChecks = [
    ['id', 'id', normalizeProductionAuthSessionIdentityField(session.id)],
    ['type', 'type', normalizeProductionAuthSessionIdentityField(session.type)],
    ['status', 'status', normalizeProductionAuthSessionIdentityField(session.status)],
    ['expiresAt', 'expires-at', normalizeProductionAuthSessionIdentityField(session.expiresAt)],
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

function resolveObservedProductionAuthSessionLifecycleDrift(response) {
  const session = response?.body?.auth?.session;
  const invalidLifecycleFlag = resolveInvalidProductionAuthSessionLifecycleFlag(session);
  if (invalidLifecycleFlag) {
    return {
      field: `auth.session.${invalidLifecycleFlag}`,
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

  if (session?.type !== 'production-auth-session') {
    return {
      field: 'auth.session.type',
      required: 'production-auth-session',
      observed: session?.type || 'missing',
    };
  }

  const productionSourceObservation = resolveProductionAuthSessionSourceObservation(session);
  if (productionSourceObservation) {
    return productionSourceObservation;
  }

  const unrevokedObservation = resolveProductionAuthSessionUnrevokedObservation(session);
  if (unrevokedObservation) {
    return {
      field: unrevokedObservation.field,
      required: 'unrevoked',
      observed: unrevokedObservation.observed,
    };
  }

  if (session?.rotated === true || session?.status === 'rotated') {
    return {
      field: session?.rotated === true ? 'auth.session.rotated' : 'auth.session.status',
      required: 'preserved read',
      observed: 'rotated',
    };
  }

  const expiredObservation = resolveProductionAuthSessionExpiredObservation(session);
  if (expiredObservation) {
    return {
      field: expiredObservation.field,
      required: 'unexpired',
      observed: expiredObservation.observed,
    };
  }

  if (session?.status !== 'active') {
    return {
      field: 'auth.session.status',
      required: 'active',
      observed: session?.status || 'missing',
    };
  }

  if (!session?.expiresAt) {
    return {
      field: 'auth.session.expiresAt',
      required: 'unexpired',
      observed: session?.expiresAt || 'missing',
    };
  }

  return null;
}

function resolveObservedProductionAuthIdentityDrift(expected, response) {
  const body = response?.body || {};
  const invalidObservedIdentityField = resolveInvalidObservedAuthEnvelopeIdentityField(body.auth?.identity);
  if (invalidObservedIdentityField) {
    return {
      field: `auth.identity.${invalidObservedIdentityField.field}`,
      required: invalidObservedIdentityField.required,
      observed: `invalid-${invalidObservedIdentityField.label}`,
    };
  }

  const expectedUserId = normalizeProductionAuthSessionIdentityUserId(expected?.userId);
  if (expected?.userId !== undefined && expected?.userId !== null && expectedUserId === null) {
    return null;
  }

  if (expectedUserId !== null) {
    const observedUserId = normalizeProductionAuthSessionIdentityUserId(body.auth?.identity?.userId);
    if (observedUserId !== expectedUserId) {
      return {
        field: 'auth.identity.userId',
        required: String(expectedUserId),
        observed: observedUserId === null ? 'missing' : String(observedUserId),
      };
    }
  }

  const expectedUserLogin = expected?.userLogin;
  if (!expectedUserLogin) {
    return null;
  }

  const observedUserLogin = body.auth?.identity?.userLogin || 'missing';
  if (observedUserLogin !== expectedUserLogin) {
    return {
      field: 'auth.identity.userLogin',
      required: expectedUserLogin,
      observed: observedUserLogin,
    };
  }

  return null;
}

function resolveObservedAuthSessionLifecycleFlagDrift(response) {
  const session = response?.body?.auth?.session;
  const invalidLifecycleFlag = resolveInvalidProductionAuthSessionLifecycleFlag(session);
  if (!invalidLifecycleFlag) {
    return null;
  }

  return {
    field: `auth.session.${invalidLifecycleFlag}`,
    required: 'boolean lifecycle flags',
    observed: `invalid-${invalidLifecycleFlag}`,
    verdict: 'AUTH_SESSION_LIFECYCLE_DRIFT',
  };
}

function resolveObservedAuthSessionSourceMetadataDrift(response) {
  const invalidIdentityField = resolveInvalidProductionAuthSessionIdentityField(
    response?.body?.auth?.session,
  );
  if (!invalidIdentityField || invalidIdentityField.field !== 'warning') {
    return null;
  }

  return {
    field: 'auth.session.warning',
    required: 'string lifecycle fields',
    observed: `invalid-${invalidIdentityField.label}`,
    verdict: 'AUTH_SESSION_LIFECYCLE_DRIFT',
  };
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
    ['playgroundFallback', session.playgroundFallback],
  ];

  for (const [name, value] of lifecycleFlags) {
    if (value !== undefined && value !== null && typeof value !== 'boolean') {
      return name;
    }
  }

  return null;
}

function describeRequiredProductionAuthSession(response) {
  const session = response?.body?.auth?.session;
  const verdict = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
  const invalidLifecycleFlag = resolveInvalidProductionAuthSessionLifecycleFlag(session);
  if (invalidLifecycleFlag) {
    return {
      field: `auth.session.${invalidLifecycleFlag}`,
      required: 'boolean lifecycle flags',
      observed: `invalid-${invalidLifecycleFlag}`,
      verdict,
    };
  }

  const invalidIdentityField = resolveInvalidProductionAuthSessionIdentityField(session);
  if (invalidIdentityField) {
    return {
      field: `auth.session.${invalidIdentityField.field}`,
      required: 'string lifecycle fields',
      observed: `invalid-${invalidIdentityField.label}`,
      verdict,
    };
  }

  if (session?.type !== 'production-auth-session') {
    return {
      field: 'auth.session.type',
      required: 'production-auth-session',
      observed: session?.type || 'missing',
      verdict,
    };
  }

  const productionSourceObservation = resolveProductionAuthSessionSourceObservation(session);
  if (productionSourceObservation) {
    return {
      field: productionSourceObservation.field,
      required: productionSourceObservation.required,
      observed: productionSourceObservation.observed,
      verdict,
    };
  }

  const unrevokedObservation = resolveProductionAuthSessionUnrevokedObservation(session);
  if (unrevokedObservation) {
    return {
      field: unrevokedObservation.field,
      required: 'unrevoked',
      observed: unrevokedObservation.observed,
      verdict,
    };
  }

  if (session?.rotated === true || session?.status === 'rotated') {
    return {
      field: session?.rotated === true ? 'auth.session.rotated' : 'auth.session.status',
      required: 'preserved read',
      observed: 'rotated',
      verdict,
    };
  }

  const expiredObservation = resolveProductionAuthSessionExpiredObservation(session);
  if (expiredObservation) {
    return {
      field: expiredObservation.field,
      required: 'unexpired',
      observed: expiredObservation.observed,
      verdict,
    };
  }

  if (session?.status !== 'active') {
    return {
      field: 'auth.session.status',
      required: 'active',
      observed: session?.status || 'missing',
      verdict,
    };
  }

  if (!session?.expiresAt) {
    return {
      field: 'auth.session.expiresAt',
      required: 'unexpired',
      observed: session?.expiresAt || 'missing',
      verdict,
    };
  }
  return {
    field: 'auth.session',
    required: 'production-auth-session lifecycle',
    observed: 'missing',
    verdict,
  };
}

function describeRequiredUnrevokedProductionAuthSession(response) {
  const session = response?.body?.auth?.session;
  const unrevokedObservation = resolveProductionAuthSessionUnrevokedObservation(session);
  return {
    field: unrevokedObservation?.field || resolveProductionAuthSessionUnrevokedField(session),
    required: 'unrevoked',
    observed: unrevokedObservation?.observed || 'cleaned-up',
    verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
  };
}

function resolveProductionAuthSessionSourceObservation(session) {
  if (session?.playgroundFallback === true) {
    return {
      field: 'auth.session.playgroundFallback',
      required: 'production-backed auth',
      observed: 'playground-fallback',
    };
  }

  const warning = normalizeProductionAuthSessionIdentityField(session?.warning);
  if (warning) {
    return {
      field: 'auth.session.warning',
      required: 'production-backed auth',
      observed: warning,
    };
  }

  return null;
}

function resolveProductionAuthSessionUnrevokedObservation(session) {
  if (
    session?.revoked !== true
    && session?.status !== 'revoked'
    && session?.cleanedUp !== true
    && session?.cleanup !== true
    && session?.status !== 'cleaned-up'
  ) {
    return null;
  }

  return {
    field: resolveProductionAuthSessionUnrevokedField(session),
    observed: session?.revoked === true || session?.status === 'revoked'
      ? 'revoked'
      : 'cleaned-up',
  };
}

function resolveProductionAuthSessionUnrevokedField(session) {
  if (session?.status === 'revoked') {
    return 'auth.session.status';
  }

  if (session?.revoked === true) {
    return 'auth.session.revoked';
  }

  if (session?.status === 'cleaned-up') {
    return 'auth.session.status';
  }

  if (session?.cleanup === true) {
    return 'auth.session.cleanup';
  }

  if (session?.cleanedUp === true) {
    return 'auth.session.cleanedUp';
  }

  return 'auth.session.cleanedUp';
}

function resolveProductionAuthSessionExpiredObservation(session) {
  if (session?.status === 'expired') {
    return {
      field: 'auth.session.status',
      observed: 'expired',
    };
  }

  if (session?.expired === true) {
    return {
      field: 'auth.session.expired',
      observed: 'expired',
    };
  }

  if (isExpiredSession(session)) {
    return {
      field: 'auth.session.expiresAt',
      observed: session?.expiresAt || 'missing',
    };
  }

  return null;
}

function resolveUncheckedPreflightAuthSessionTermination(response) {
  const session = response?.body?.auth?.session;
  const unrevokedObservation = resolveProductionAuthSessionUnrevokedObservation(session);
  if (unrevokedObservation) {
    return {
      field: unrevokedObservation.field,
      required: 'unrevoked',
      observed: unrevokedObservation.observed,
    };
  }

  if (session?.rotated === true || session?.status === 'rotated') {
    return {
      field: session?.rotated === true ? 'auth.session.rotated' : 'auth.session.status',
      required: 'preserved read',
      observed: 'rotated',
    };
  }

  const expiredObservation = resolveProductionAuthSessionExpiredObservation(session);
  if (expiredObservation) {
    return {
      field: expiredObservation.field,
      required: 'unexpired',
      observed: expiredObservation.observed,
    };
  }

  return null;
}

function hasProductionAuthSessionTypeDrift(response) {
  return response?.body?.auth?.session?.type !== 'production-auth-session';
}

function hasProductionAuthSessionStatusDrift(response) {
  return response?.body?.auth?.session?.status !== 'active';
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

function resolveInvalidProductionAuthSessionIdentityField(session) {
  if (!session || typeof session !== 'object') {
    return null;
  }

  const fieldChecks = [
    ['id', 'id', normalizeProductionAuthSessionIdentityField(session.id)],
    ['type', 'type', normalizeProductionAuthSessionIdentityField(session.type)],
    ['status', 'status', normalizeProductionAuthSessionIdentityField(session.status)],
    ['expiresAt', 'expires-at', normalizeProductionAuthSessionIdentityField(session.expiresAt)],
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

  if (
    session.warning !== undefined
    && session.warning !== null
    && !normalizeProductionAuthSessionIdentityField(session.warning)
  ) {
    return {
      field: 'warning',
      label: 'warning',
    };
  }

  return null;
}

function normalizeProductionAuthSessionIdentityField(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (
    !normalized
    || normalized !== value
    || /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

function normalizeProductionAuthSessionIdentityUserId(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!/^[1-9]\d*$/.test(normalized)) {
      return null;
    }

    const parsed = Number.parseInt(normalized, 10);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }

  return null;
}

function isExpiredSession(session) {
  if (!session || typeof session !== 'object') {
    return false;
  }
  if (session.expired === true) {
    return true;
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

function setAuthSessionBoundary(summary, authSession) {
  if (summary.boundary) {
    return;
  }

  summary.boundary = {
    firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
    status: 'unimplemented',
    verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    authSession,
  };
}

async function requestJson(baseUrl, method, pathname, body = undefined, headers = {}, requestTimeoutMs = 10_000) {
  return requestJsonRaw(
    baseUrl,
    method,
    pathname,
    body === undefined ? undefined : JSON.stringify(body),
    headers,
    requestTimeoutMs,
    {},
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
      };
    } catch (error) {
      lastError = error;
      if (!retryable || !isTransientFetchError(error) || attempt === attempts) {
        throw error;
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
  return error.name === 'TypeError' && (
    code === 'UND_ERR_SOCKET'
    || code === 'ECONNRESET'
    || code === 'EPIPE'
    || code === 'ETIMEDOUT'
  );
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

function assertSupportedSourceUrlForRouteProfile(baseUrl, profile, allowedSourceUrl = '') {
  if (profile.name !== 'production-shaped') {
    return;
  }

  if (
    (baseUrl.protocol === 'http:' || baseUrl.protocol === 'https:')
    && isLoopbackHost(baseUrl.hostname)
  ) {
    return;
  }

  if (matchesAllowedAuthenticatedHttpPushSourceUrl(baseUrl.toString(), allowedSourceUrl)) {
    return;
  }

  throw new Error(
    `Unsupported production-shaped sourceUrl origin: ${baseUrl.origin}. Use a local-only loopback origin or the sandbox-provided 8080 ingress.`,
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
