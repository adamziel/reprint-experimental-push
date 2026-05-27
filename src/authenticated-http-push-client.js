import { createHash, createHmac, randomBytes } from 'node:crypto';
import { createPushPlan } from './planner.js';
import { productionRecoveryJournalInspectionSurfaceIsPresent } from './recovery-journal.js';
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
const checkedDbJournalStorageBoundary = 'wpdb-single-statement-cas';
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
  if (requireProductionAuthSession && hasProductionAuthSessionRevocationDrift(preflight)) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'unrevoked',
      observed: preflight.body.auth?.session?.revoked ? 'revoked' : 'cleaned-up',
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
  const dryRunAuthEnvelopeDrift = requireProductionAuthSession && hasAuthEnvelopeDrift(preflightAuthEnvelope, dryRun);
  if (dryRun.status !== 200 || dryRun.body?.ok !== true || !dryRun.body?.receipt) {
    summary.code = dryRun.body?.code || 'DRY_RUN_FAILED';
    setDurableJournalBoundary(summary, 'dry-run');
    return summary;
  }
  if (requireProductionAuthSession && hasProductionAuthSessionRevocationDrift(dryRun)) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'unrevoked',
      observed: dryRun.body?.auth?.session?.revoked ? 'revoked' : 'cleaned-up',
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
    setDurableJournalBoundary(summary, 'dry-run');
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
  if (apply.status !== 200 || apply.body?.ok !== true) {
    summary.code = apply.body?.code || 'APPLY_FAILED';
    setDurableJournalBoundary(summary, 'apply');
    return summary;
  }
  if (requireProductionAuthSession && hasProductionAuthSessionRevocationDrift(apply)) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'unrevoked',
      observed: apply.body?.auth?.session?.revoked ? 'revoked' : 'cleaned-up',
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
  if (hasExpiredAuthSession(apply)) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'unexpired',
      observed: apply.body?.auth?.session?.expiresAt || 'missing',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setDurableJournalBoundary(summary, 'apply');
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
    setDurableJournalBoundary(summary, 'apply');
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
  if (requireProductionAuthSession && hasProductionAuthSessionRevocationDrift(recoveryInspect)) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'unrevoked',
      observed: recoveryInspect.body?.auth?.session?.revoked ? 'revoked' : 'cleaned-up',
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
  if (hasExpiredAuthSession(recoveryInspect)) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'unexpired',
      observed: recoveryInspect.body?.auth?.session?.expiresAt || 'missing',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setDurableJournalBoundary(summary, 'recovery-inspect');
    return summary;
  }
  if (recoveryInspectAuthSessionDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'production-auth-session',
      observed: recoveryInspect.body?.auth?.session?.type || 'missing',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setDurableJournalBoundary(summary, 'recovery-inspect');
    return summary;
  }
  const recoveryInspectAuthEnvelopeDrift = hasAuthEnvelopeDrift(preflightAuthEnvelope, recoveryInspect);
  if (recoveryInspectAuthEnvelopeDrift) {
    summary.code = 'AUTH_SESSION_LIFECYCLE_DRIFT';
    summary.authSession = {
      required: preflightAuthEnvelope.sessionType || 'auth-session',
      observed: recoveryInspect.body?.auth?.session?.type || 'missing',
      verdict: 'AUTH_SESSION_LIFECYCLE_DRIFT',
    };
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
  const recoveryInspectDbJournal = summarizeDbJournalBody(recoveryInspect.body, {
    status: recoveryInspect.status,
    retryAttempts: recoveryInspect.retryAttempts || 1,
  });
  if (recoveryInspectDbJournal) {
    summary.recoveryInspect.dbJournal = recoveryInspectDbJournal;
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
  const applyAuthEnvelopeDrift = hasAuthEnvelopeDrift(preflightAuthEnvelope, apply);
  const replayAuthEnvelopeDrift = hasAuthEnvelopeDrift(preflightAuthEnvelope, replay);
  const replayAuthSessionDrift = requireProductionAuthSession && (
    hasProductionAuthSessionTypeDrift(replay)
    || hasProductionAuthSessionStatusDrift(replay)
    || hasMissingProductionAuthSessionExpiry(replay)
    || hasProductionAuthSessionExpiryDrift(replay)
  );
  if (applyAuthEnvelopeDrift || recoveryInspectAuthEnvelopeDrift || replayAuthEnvelopeDrift) {
    summary.code = 'AUTH_SESSION_LIFECYCLE_DRIFT';
    summary.authSession = {
      required: preflightAuthEnvelope.sessionType || 'auth-session',
      observed: applyAuthEnvelopeDrift
        ? apply.body?.auth?.session?.type || 'missing'
        : recoveryInspectAuthEnvelopeDrift
        ? recoveryInspect.body?.auth?.session?.type || 'missing'
        : replay.body?.auth?.session?.type || 'missing',
      verdict: 'AUTH_SESSION_LIFECYCLE_DRIFT',
    };
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
    setDurableJournalBoundary(summary, 'replay');
    return summary;
  }
  if (requireProductionAuthSession && hasProductionAuthSessionRevocationDrift(replay)) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'unrevoked',
      observed: replay.body?.auth?.session?.revoked ? 'revoked' : 'cleaned-up',
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
  if (hasExpiredAuthSession(replay)) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'unexpired',
      observed: replay.body?.auth?.session?.expiresAt || 'missing',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setDurableJournalBoundary(summary, 'replay');
    return summary;
  }

  const afterApply = await client.get('/snapshot');
  summary.after = summarizeSnapshot(afterApply, local);
  updateRetryAttempts(summary, summary.after);
  summary.afterObject = afterApply.body.snapshot;
  let dbJournal = recoveryInspect;
  if (recoveryInspectDbJournal
    && dbJournalProofIsAcceptable(recoveryInspectDbJournal)
    && dbJournalCheckedBoundaryContractIsPresent(recoveryInspectDbJournal)
  ) {
    summary.dbJournal = recoveryInspectDbJournal;
    updateRetryAttempts(summary, summary.dbJournal);
  } else {
    dbJournal = await client.signedGet(withAuthSessionDrift('/db-journal?limit=80'), {
      session,
      idempotencyKey,
      retryable: true,
    });
    summary.dbJournal = summarizeDbJournal(dbJournal);
    updateRetryAttempts(summary, summary.dbJournal);
    recordAuthSessionLifecycle(summary, 'journal', dbJournal.body?.auth?.session);
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
    if (requireProductionAuthSession && hasProductionAuthSessionRevocationDrift(dbJournal)) {
      summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
      summary.authSession = {
        required: 'unrevoked',
        observed: dbJournal.body?.auth?.session?.revoked ? 'revoked' : 'cleaned-up',
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
    if (hasExpiredAuthSession(dbJournal)) {
      summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
      summary.authSession = {
        required: 'unexpired',
        observed: dbJournal.body?.auth?.session?.expiresAt || 'missing',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      };
      setDurableJournalBoundary(summary, 'journal-inspect');
      return summary;
    }
    if (dbJournalAuthSessionDrift) {
      summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
      summary.authSession = {
        required: 'production-auth-session',
        observed: dbJournal.body?.auth?.session?.type || 'missing',
        verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
      };
      setDurableJournalBoundary(summary, 'journal-inspect');
      return summary;
    }
    const dbJournalAuthEnvelopeDrift = hasAuthEnvelopeDrift(preflightAuthEnvelope, dbJournal);
    if (dbJournalAuthEnvelopeDrift) {
      summary.code = 'AUTH_SESSION_LIFECYCLE_DRIFT';
      summary.authSession = {
        required: preflightAuthEnvelope.sessionType || 'auth-session',
        observed: dbJournal.body?.auth?.session?.type || 'missing',
        verdict: 'AUTH_SESSION_LIFECYCLE_DRIFT',
      };
      setDurableJournalBoundary(summary, 'journal-inspect');
      return summary;
    }
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
    && dbJournalCheckedBoundaryContractIsPresent(summary.dbJournal)
    && summary.after?.finalMatchesLocal === true;
  if (!summary.ok) {
    const replayIdempotency = replay.body?.idempotency;
    const authEnvelopeDrift = applyAuthEnvelopeDrift || replayAuthEnvelopeDrift;
    const journalProofFailed = dbJournal.status === 200
      && dbJournal.body?.ok === true
      && (
        !dbJournalProofIsAcceptable(summary.dbJournal)
        || !dbJournalCheckedBoundaryContractIsPresent(summary.dbJournal)
      );
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
  if (!authSessionSource?.ok) {
    return {
      sourceUrl,
      username,
      applicationPassword,
    };
  }

  return {
    sourceUrl: authSessionSource.sourceUrl || sourceUrl,
    username: authSessionSource.username || username,
    applicationPassword: authSessionSource.applicationPassword || applicationPassword,
  };
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

  return {
    id: session.id || null,
    type: session.type || null,
    status: session.status || null,
    expiresAt: session.expiresAt || null,
    expired: isExpiredSession(session),
    revoked: session.revoked === true || session.status === 'revoked',
    cleanedUp: session.cleanedUp === true || session.cleanup === true,
  };
}

function recordAuthSessionLifecycle(summary, step, session) {
  const observation = summarizeAuthSessionLifecycle(session);
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
    status: observation?.status || null,
    expiresAt: observation?.expiresAt || null,
    expired: Boolean(observation?.expired),
    revoked: Boolean(observation?.revoked),
    cleanedUp: Boolean(observation?.cleanedUp),
    rotated: lifecycle.rotated,
    preserved: lifecycle.preserved,
  });
  summary.authSessionLifecycleSummary = summarizeAuthSessionLifecycleHistory(
    summary.authSessionLifecycle.history,
  );
  if (step === 'preflight') {
    summary.authSessionLifecycle.minted = observation;
    summary.authSessionLifecycle.read = observation;
    summary.authSessionLifecycle.expired = observation?.expired ? observation : null;
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
}

function summarizeAuthSessionLifecycleHistory(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return null;
  }

  const observations = history.filter((entry) => entry && typeof entry === 'object');
  const issued = history.find((entry) => entry.step === 'preflight') || history[0];
  const read = history[history.length - 1];
  return {
    issued,
    read,
    expired: observations.find((entry) => entry.expired) || null,
    revoked: observations.find((entry) => entry.revoked) || null,
    cleanedUp: observations.find((entry) => entry.cleanedUp) || null,
    rotated: observations.find((entry) => entry.rotated) || null,
    preserved: [...observations].reverse().find((entry) => entry.preserved) || null,
    observations,
  };
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
  return summarizeDbJournalBody(response.body, {
    status: response.status,
    retryAttempts: response.retryAttempts || 1,
  });
}

function summarizeDbJournalBody(body, {
  status = 200,
  retryAttempts = 1,
} = {}) {
  if (!body?.dbJournal || typeof body.dbJournal !== 'object') {
    return undefined;
  }
  const dbJournal = body.dbJournal;
  const rows = dbJournal?.latestRows || [];
  const storageGuard = summarizeDbJournalStorageGuard(body);
  return {
    status,
    ok: true,
    retryAttempts,
    scope: dbJournal?.scope,
    acceptedOnCheckedBoundary: dbJournal?.acceptedOnCheckedBoundary === true,
    rows: rows.length,
    applyCommitted: dbJournal?.applyCommitted === true
      || rows.some((entry) => entry.event === 'apply-committed'),
    mutationApplied: Number.isInteger(dbJournal?.mutationApplied)
      ? Math.max(0, dbJournal.mutationApplied)
      : rows.filter((entry) => entry.event === 'mutation-applied').length,
    idempotencyOpened: Number.isInteger(dbJournal?.idempotencyOpened)
      ? Math.max(0, dbJournal.idempotencyOpened)
      : rows.filter((entry) => entry.event === 'idempotency-opened').length,
    storageGuard,
    ownership: summarizeDbJournalOwnership(dbJournal),
    claim: summarizeDbJournalClaim(dbJournal),
    writerLease: summarizeDbJournalWriterLease(dbJournal),
    leaseFence: summarizeDbJournalLeaseFence(dbJournal),
    authUser: body?.auth?.identity?.userLogin,
    authSessionId: body?.auth?.session?.id,
    sessionType: body?.auth?.session?.type,
    sessionStatus: body?.auth?.session?.status,
    sessionExpiresAt: body?.auth?.session?.expiresAt,
  };
}

function dbJournalProofIsAcceptable(dbJournal) {
  return dbJournal?.applyCommitted === true
    && dbJournal?.idempotencyOpened > 0
    && dbJournal?.mutationApplied > 0
    && dbJournalStorageGuardIsTrusted(dbJournal?.storageGuard);
}

function dbJournalCheckedBoundaryContractIsPresent(dbJournal) {
  return dbJournal?.acceptedOnCheckedBoundary === true
    && dbJournal?.ownership?.ownsJournal === true
    && dbJournal?.ownership?.restartReadable === true
    && dbJournal?.ownership?.productionAdapter === checkedDbJournalStorageBoundary
    && dbJournal?.ownership?.supportedSurface === checkedDbJournalSupportedSurface
    && dbJournalClaimContractIsPresent(dbJournal?.claim)
    && dbJournalWriterLeaseContractsArePresent(dbJournal)
    && dbJournalClaimIdentityCoherenceIsPresent(dbJournal)
    && dbJournal?.leaseFence?.boundary === checkedDbJournalStorageBoundary
    && dbJournal?.leaseFence?.claimKeyUnique === true
    && dbJournal?.leaseFence?.fsyncEvidence === true
    && dbJournal?.leaseFence?.monotonicSequence === true
    && dbJournal?.leaseFence?.restartReadable === true
    && dbJournal?.leaseFence?.staleClaimRejected === true
    && dbJournal?.writerLease?.storageGuard === checkedDbJournalStorageBoundary
    && dbJournal?.leaseFence?.writerLease?.storageGuard === checkedDbJournalStorageBoundary;
}

function dbJournalClaimContractIsPresent(claim) {
  if (!claim || typeof claim !== 'object') {
    return false;
  }

  const statusMatchesStaleClaim = (
    (claim.status === 'active' && claim.staleClaimRejected === false)
    || (claim.status === 'stale-claim-rejected' && claim.staleClaimRejected === true)
  );
  const eventMatchesStaleClaim = hasNonEmptyString(claim.activeClaimEvent)
    && dbJournalCheckedClaimEventMatches(claim.activeClaimEvent)
    && !(claim.staleClaimRejected === false && claim.activeClaimEvent === 'stale-claim-rejected')
    && !(claim.staleClaimRejected === true && claim.activeClaimEvent === 'idempotency-opened');
  const requiresConsumedRetryLineage = claim.staleClaimRejected === true
    && (
      claim.activeClaimEvent === 'stale-claim-retry-started'
      || claim.activeClaimEvent === 'stale-claim-retry-in-progress'
      || claim.activeClaimEvent === 'stale-claim-rejected'
    );
  const hasPreviousClaimIdentity = hasNonEmptyString(claim.previousClaimKeyHash)
    || Number.isInteger(claim.previousClaimSequence)
    || hasNonEmptyString(claim.previousClaimEvent);
  const hasAbandonedClaimIdentity = Number.isInteger(claim.abandonedSequence)
    || hasNonEmptyString(claim.abandonedEvent);

  return hasNonEmptyString(claim.status)
    && hasNonEmptyString(claim.activeClaimId)
    && hasNonEmptyString(claim.activeClaimKeyHash)
    && Number.isInteger(claim.activeClaimSequence)
    && hasNonEmptyString(claim.activeClaimEvent)
    && hasNonEmptyString(claim.idempotencyKeyHash)
    && hasNonEmptyString(claim.requestHash)
    && typeof claim.staleClaimRejected === 'boolean'
    && statusMatchesStaleClaim
    && eventMatchesStaleClaim
    && (!hasPreviousClaimIdentity || (
      hasNonEmptyString(claim.previousClaimId)
      && hasNonEmptyString(claim.previousClaimKeyHash)
      && Number.isInteger(claim.previousClaimSequence)
      && hasNonEmptyString(claim.previousClaimEvent)
    ))
    && (!hasAbandonedClaimIdentity || (
      Number.isInteger(claim.abandonedSequence)
      && hasNonEmptyString(claim.abandonedEvent)
    ))
    && (!Number.isInteger(claim.previousStartedSequence) || hasPreviousClaimIdentity)
    && (claim.staleClaimRejected !== true || hasPreviousClaimIdentity)
    && (!requiresConsumedRetryLineage || (
      Number.isInteger(claim.previousStartedSequence)
      && Number.isInteger(claim.abandonedSequence)
      && hasNonEmptyString(claim.abandonedEvent)
      && hasNonEmptyString(claim.previousClaimKeyHash)
      && Number.isInteger(claim.previousClaimSequence)
      && hasNonEmptyString(claim.previousClaimEvent)
    ));
}

function dbJournalCheckedClaimEventMatches(event) {
  return event === 'idempotency-opened'
    || event === 'stale-claim-retry-started'
    || event === 'stale-claim-retry-in-progress'
    || event === 'stale-claim-rejected';
}

function dbJournalWriterLeaseContractsArePresent(dbJournal) {
  const writerLease = dbJournal?.writerLease;
  const nestedWriterLease = dbJournal?.leaseFence?.writerLease;
  return dbJournalWriterLeaseContractMatches(writerLease)
    && dbJournalWriterLeaseContractMatches(nestedWriterLease)
    && dbJournalWriterLeaseContractsAgree(writerLease, nestedWriterLease);
}

function dbJournalWriterLeaseContractMatches(candidate) {
  return hasNonEmptyString(candidate?.claimId)
    && hasNonEmptyString(candidate?.claimKeyHash)
    && typeof candidate?.strategy === 'string'
    && candidate.strategy.length > 0
    && candidate?.claimKeyUnique === true
    && candidate?.fsyncEvidence === true
    && candidate?.storageGuard === checkedDbJournalStorageBoundary
    && candidate?.monotonicSequence === true
    && candidate?.restartReadable === true
    && candidate?.staleClaimRejected === true;
}

function dbJournalWriterLeaseContractsAgree(writerLease, nestedWriterLease) {
  if (writerLease?.claimId !== nestedWriterLease?.claimId) {
    return false;
  }
  if (writerLease?.claimKeyHash !== nestedWriterLease?.claimKeyHash) {
    return false;
  }
  for (const key of [
    'strategy',
    'claimKeyUnique',
    'fsyncEvidence',
    'storageGuard',
    'monotonicSequence',
    'restartReadable',
    'staleClaimRejected',
  ]) {
    if (writerLease?.[key] !== nestedWriterLease?.[key]) {
      return false;
    }
  }

  return true;
}

function dbJournalClaimIdentityCoherenceIsPresent(dbJournal) {
  const surfacedClaimIds = [
    dbJournal?.claim?.activeClaimId,
    dbJournal?.writerLease?.claimId,
    dbJournal?.leaseFence?.writerLease?.claimId,
  ].filter(hasNonEmptyString);
  const surfacedClaimKeyHashes = [
    dbJournal?.claim?.activeClaimKeyHash,
    dbJournal?.writerLease?.claimKeyHash,
    dbJournal?.leaseFence?.writerLease?.claimKeyHash,
  ].filter(hasNonEmptyString);

  if (surfacedClaimIds.length === 0 || surfacedClaimKeyHashes.length === 0) {
    return false;
  }

  return surfacedClaimIds.every((claimId) => claimId === surfacedClaimIds[0])
    && surfacedClaimKeyHashes.every((claimKeyHash) => claimKeyHash === surfacedClaimKeyHashes[0]);
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
  const rows = Array.isArray(body?.dbJournal?.latestRows)
    ? [...body.dbJournal.latestRows].reverse()
    : [];
  let nestedCandidate;
  for (const row of rows) {
    const nestedStorageGuard = sanitizeStorageGuard(
      row?.result?.storageGuard
      || row?.resourceHashEvidence?.storageGuard
      || row?.resourceHashEvidence?.mutation?.storageGuard,
    );
    if (nestedStorageGuard) {
      if (
        body?.dbJournal?.acceptedOnCheckedBoundary === true
        && dbJournalStorageGuardIsTrusted(nestedStorageGuard)
      ) {
        nestedCandidate = nestedStorageGuard;
        break;
      }
      if (!nestedCandidate) {
        nestedCandidate = nestedStorageGuard;
      }
    }
  }

  if (directStorageGuard) {
    if (
      body?.dbJournal?.acceptedOnCheckedBoundary === true
      && nestedCandidate
      && storageGuardLooksFixtureScoped(directStorageGuard)
      && dbJournalStorageGuardIsTrusted(nestedCandidate)
    ) {
      return nestedCandidate;
    }
    return directStorageGuard;
  }

  if (nestedCandidate) {
    return nestedCandidate;
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

function summarizeDbJournalClaim(dbJournal) {
  const claim = dbJournal?.claim;
  if (!claim || typeof claim !== 'object') {
    return undefined;
  }

  const summary = {
    status: claim.status || null,
    activeClaimId: claim.activeClaimId || null,
    activeClaimKeyHash: claim.activeClaimKeyHash || null,
    activeClaimSequence: Number.isInteger(claim.activeClaimSequence)
      ? claim.activeClaimSequence
      : null,
    activeClaimEvent: claim.activeClaimEvent || null,
    idempotencyKeyHash: claim.idempotencyKeyHash || null,
    requestHash: claim.requestHash || null,
    staleClaimRejected: claim.staleClaimRejected === true,
  };

  if (Number.isInteger(claim.abandonedSequence)) {
    summary.abandonedSequence = claim.abandonedSequence;
  }
  if (typeof claim.abandonedEvent === 'string' && claim.abandonedEvent.length > 0) {
    summary.abandonedEvent = claim.abandonedEvent;
  }
  if (Number.isInteger(claim.previousStartedSequence)) {
    summary.previousStartedSequence = claim.previousStartedSequence;
  }
  if (Number.isInteger(claim.previousClaimSequence)) {
    summary.previousClaimSequence = claim.previousClaimSequence;
  }
  if (typeof claim.previousClaimKeyHash === 'string' && claim.previousClaimKeyHash.length > 0) {
    summary.previousClaimKeyHash = claim.previousClaimKeyHash;
  }
  if (typeof claim.previousClaimId === 'string' && claim.previousClaimId.length > 0) {
    summary.previousClaimId = claim.previousClaimId;
  }
  if (typeof claim.previousClaimEvent === 'string' && claim.previousClaimEvent.length > 0) {
    summary.previousClaimEvent = claim.previousClaimEvent;
  }

  return summary;
}

function hasNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function summarizeDbJournalLeaseFence(dbJournal) {
  const leaseFence = dbJournal?.leaseFence;
  if (!leaseFence || typeof leaseFence !== 'object') {
    return undefined;
  }

  const summary = {
    boundary: leaseFence.boundary || null,
    claimKeyUnique: leaseFence.claimKeyUnique === true,
    fsyncEvidence: leaseFence.fsyncEvidence === true,
    monotonicSequence: leaseFence.monotonicSequence === true,
    restartReadable: leaseFence.restartReadable === true,
    staleClaimRejected: leaseFence.staleClaimRejected === true,
  };

  const nestedWriterLease = summarizeDbJournalWriterLease({ leaseFence });
  if (nestedWriterLease) {
    summary.writerLease = nestedWriterLease;
  }

  return summary;
}

function summarizeDbJournalWriterLease(dbJournal) {
  const writerLease = dbJournal?.writerLease;
  const nestedWriterLease = dbJournal?.leaseFence?.writerLease;
  const candidate = writerLease && typeof writerLease === 'object'
    ? writerLease
    : nestedWriterLease && typeof nestedWriterLease === 'object'
      ? nestedWriterLease
      : null;
  if (!candidate) {
    return undefined;
  }

  const summary = {
    claimId: candidate.claimId || null,
    strategy: candidate.strategy || null,
    claimKeyUnique: candidate.claimKeyUnique === true,
    fsyncEvidence: candidate.fsyncEvidence === true,
    storageGuard: candidate.storageGuard || null,
    monotonicSequence: candidate.monotonicSequence === true,
    restartReadable: candidate.restartReadable === true,
    staleClaimRejected: candidate.staleClaimRejected === true,
  };

  if (hasNonEmptyString(candidate.claimKeyHash)) {
    summary.claimKeyHash = candidate.claimKeyHash;
  }

  return summary;
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

function storageGuardLooksFixtureScoped(storageGuard) {
  return ['boundary', 'operation', 'outcome'].some((key) => {
    const value = storageGuard?.[key];
    return typeof value === 'string'
      && /fixture|local-playground|playground/i.test(value);
  });
}

function summarizeRecoveryInspect(response) {
  const recovery = response.body?.recovery;
  if (!recovery || typeof recovery !== 'object') {
    return undefined;
  }

  const journalState = recovery.journal?.integrity?.status
    || recovery.productionJournal?.journal?.integrity?.status
    || (recovery.journalEvidence && typeof recovery.journalEvidence === 'object' ? 'ok' : undefined);
  const dbJournal = summarizeDbJournalBody(response.body, {
    status: response.status,
    retryAttempts: response.retryAttempts || 1,
  });

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
    dbJournal,
  };
}

function recoveryInspectClaimsProductionRecoveryJournalSurface(recovery) {
  if (!recovery || typeof recovery !== 'object') {
    return false;
  }

  const productionJournal = recovery?.productionJournal;

  return recovery?.journal?.kind === 'production-recovery-journal'
    || recovery?.journal?.productionAdapter === 'openProductionRecoveryJournal'
    || hasNonEmptyString(recovery?.journal?.claimHash)
    || hasNonEmptyString(recovery?.claim?.activeClaimHash)
    || hasNonEmptyString(recovery?.leaseFence?.writerLease?.claimHash)
    || productionJournal?.journal?.kind === 'production-recovery-journal'
    || productionJournal?.journal?.productionAdapter === 'openProductionRecoveryJournal'
    || hasNonEmptyString(productionJournal?.journal?.claimHash)
    || hasNonEmptyString(productionJournal?.claim?.activeClaimHash)
    || hasNonEmptyString(productionJournal?.leaseFence?.writerLease?.claimHash);
}

function recoveryInspectProductionJournalInspection(recovery) {
  const productionJournal = recovery?.productionJournal;

  return {
    journal: recovery?.journal ?? productionJournal?.journal,
    claim: recovery?.claim
      ?? recovery?.journal?.claim
      ?? productionJournal?.claim
      ?? productionJournal?.journal?.claim,
    leaseFence: recovery?.leaseFence
      ?? recovery?.journal?.leaseFence
      ?? productionJournal?.leaseFence
      ?? productionJournal?.journal?.leaseFence,
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

function hasAuthEnvelopeDrift(expected, response) {
  const body = response?.body || {};
  if (!body.auth) {
    return true;
  }
  return body.auth?.identity?.userLogin !== expected.userLogin
    || body.auth?.session?.id !== expected.sessionId
    || body.auth?.session?.type !== expected.sessionType
    || body.auth?.session?.status !== expected.sessionStatus
    || body.auth?.session?.expiresAt !== expected.sessionExpiresAt;
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
  return session.revoked === true || session.status === 'revoked' || session.cleanedUp === true || session.cleanup === true;
}

function isExpiredSession(session) {
  if (!session || typeof session !== 'object') {
    return false;
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

function assertSupportedSourceUrlForRouteProfile(baseUrl, profile) {
  if (profile.name !== 'production-shaped') {
    return;
  }

  if (baseUrl.protocol === 'http:' && isLoopbackHost(baseUrl.hostname)) {
    return;
  }
  if (baseUrl.protocol === 'https:' && baseUrl.hostname === 'localhost') {
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
