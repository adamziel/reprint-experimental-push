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
const retryableReadOnlyGetPaths = new Set(Object.values(routeProfiles).flatMap((profile) => [
  `${profile.namespacePath}/snapshot`,
  `${profile.namespacePath}/db-journal`,
]));
const sideEffectQueryParams = new Set([
  'reprint_push_lab_drift_after_snapshot',
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
  now = new Date(),
}) {
  if (!sourceUrl) {
    throw new Error('Missing sourceUrl');
  }
  if (!username) {
    throw new Error('Missing username');
  }
  if (!applicationPassword) {
    throw new Error('Missing applicationPassword');
  }
  if (!idempotencyKey) {
    throw new Error('Missing idempotencyKey');
  }

  const credential = { username, password: applicationPassword };
  const profile = resolveRouteProfile(routeProfile);
  const client = authenticatedHttpClient({ sourceUrl, credential, routeProfile: profile.name });
  const summary = {
    ok: false,
    mode: dryRunOnly ? 'dry-run' : 'apply',
    source: {
      url: redactUrl(sourceUrl),
      namespace: profile.namespace,
      routePrefix: profile.routePrefix,
      routeProfile: profile.name,
      labBacked: true,
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
  };

  const preflight = await client.signedGet('/preflight');
  summary.preflight = summarizeResponse(preflight);
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
  const preflightAuthEnvelope = {
    userLogin: preflight.body.auth?.identity?.userLogin,
    sessionId: preflight.body.auth?.session?.id,
    sessionType: preflight.body.auth?.session?.type,
    sessionStatus: preflight.body.auth?.session?.status,
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
  if (requireProductionAuthSession && preflight.body.auth?.session?.status && preflight.body.auth.session.status !== 'active') {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'active',
      observed: preflight.body.auth.session.status,
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
  const remoteSnapshot = await client.get(snapshotPath);
  if (remoteSnapshot.status !== 200 || remoteSnapshot.body?.ok !== true) {
    summary.code = remoteSnapshot.body?.code || 'SNAPSHOT_FAILED';
    summary.snapshot = summarizeResponse(remoteSnapshot);
    setDurableJournalBoundary(summary, 'snapshot');
    return summary;
  }
  summary.remoteSnapshot = summarizeSnapshot(remoteSnapshot, local);

  const plan = createPushPlan({
    base,
    local,
    remote: remoteSnapshot.body.snapshot,
    now,
  });
  summary.plan = summarizePlan(plan);

  if (plan.status !== 'ready') {
    summary.code = 'PLAN_NOT_READY_LOCALLY';
    summary.ok = false;
    setDurableJournalBoundary(summary, 'plan');
    return summary;
  }

  const dryRun = await client.signedPost('/dry-run', { plan }, {
    session,
    idempotencyKey,
  });
  summary.dryRun = summarizeResponse(dryRun);
  const dryRunAuthEnvelopeDrift = requireProductionAuthSession && hasAuthEnvelopeDrift(preflightAuthEnvelope, dryRun);
  if (dryRun.status !== 200 || dryRun.body?.ok !== true || !dryRun.body?.receipt) {
    summary.code = dryRun.body?.code || 'DRY_RUN_FAILED';
    setDurableJournalBoundary(summary, 'dry-run');
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
    summary.ok = afterDryRun.status === 200 && afterDryRun.body?.ok === true;
    if (!summary.ok) {
      setDurableJournalBoundary(summary, 'dry-run');
    }
    return summary;
  }

  const apply = await client.signedPost('/apply', {
    plan,
    receipt: dryRun.body.receipt,
  }, {
    session,
    idempotencyKey,
  });
  summary.apply = summarizeResponse(apply);
  const applyAuthSessionTypeDrift = requireProductionAuthSession && hasProductionAuthSessionTypeDrift(apply);

  const recoveryInspect = await client.signedPost('/recovery/inspect', {
    plan,
    receipt: dryRun.body.receipt,
  }, {
    session,
    idempotencyKey,
  });
  summary.recoveryInspect = summarizeResponse(recoveryInspect);
  summary.recoveryInspect.recovery = summarizeRecoveryInspect(recoveryInspect);
  const recoveryInspectAuthSessionTypeDrift = requireProductionAuthSession && hasProductionAuthSessionTypeDrift(recoveryInspect);
  if (recoveryInspect.status !== 200 || recoveryInspect.body?.ok !== true) {
    summary.code = recoveryInspect.body?.code || 'RECOVERY_INSPECT_FAILED';
    setDurableJournalBoundary(summary, 'recovery-inspect');
    return summary;
  }
  const recoveryInspectAuthEnvelopeDrift = hasAuthEnvelopeDrift(preflightAuthEnvelope, recoveryInspect);
  if (recoveryInspectAuthEnvelopeDrift) {
    summary.code = 'AUTH_SESSION_LIFECYCLE_DRIFT';
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
  if (applyAuthSessionTypeDrift || recoveryInspectAuthSessionTypeDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'production-auth-session',
      observed: applyAuthSessionTypeDrift
        ? apply.body?.auth?.session?.type || 'missing'
        : recoveryInspect.body?.auth?.session?.type || 'missing',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setDurableJournalBoundary(summary, 'recovery-inspect');
    return summary;
  }

  const replay = await client.signedPost('/apply', {
    plan,
    receipt: dryRun.body.receipt,
  }, {
    session,
    idempotencyKey,
  });
  summary.replay = summarizeResponse(replay);
  summary.replay.responseSchemaVersion = replay.body?.responseSchemaVersion;
  const replayEquivalent = isReplayEquivalent(apply, replay);
  const applyAuthEnvelopeDrift = hasAuthEnvelopeDrift(preflightAuthEnvelope, apply);
  const replayAuthEnvelopeDrift = hasAuthEnvelopeDrift(preflightAuthEnvelope, replay);
  const replayAuthSessionTypeDrift = requireProductionAuthSession && hasProductionAuthSessionTypeDrift(replay);
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
  if (replayAuthSessionTypeDrift) {
    summary.code = 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED';
    summary.authSession = {
      required: 'production-auth-session',
      observed: replay.body?.auth?.session?.type || 'missing',
      verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
    };
    setDurableJournalBoundary(summary, 'replay');
    return summary;
  }

  const afterApply = await client.get('/snapshot');
  summary.after = summarizeSnapshot(afterApply, local);
  const dbJournal = await client.get('/db-journal?limit=80');
  summary.dbJournal = summarizeDbJournal(dbJournal);
  const dbJournalAuthEnvelopeDrift = hasAuthEnvelopeDrift(preflightAuthEnvelope, dbJournal);
  if (dbJournalAuthEnvelopeDrift) {
    summary.code = 'AUTH_SESSION_LIFECYCLE_DRIFT';
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

export function authenticatedHttpClient({
  sourceUrl,
  credential,
  routeProfile = 'lab-authenticated',
  requestTimeoutMs = 10_000,
}) {
  const baseUrl = normalizeBaseUrl(sourceUrl);
  const profile = resolveRouteProfile(routeProfile);
  assertSupportedSourceUrlForRouteProfile(baseUrl, profile);
  assertSupportedCredentialForRouteProfile(credential, profile);

  return {
    get(pathSuffix) {
      return requestJson(baseUrl, 'GET', `${profile.namespacePath}${pathSuffix}`, undefined, authHeaders(credential), requestTimeoutMs);
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
    mode: body.mode,
    code: body.code,
    applied: body.applied,
    receiptHash: body.receipt?.receiptHash,
    responseSchemaVersion: body.responseSchemaVersion,
    authUser: body.auth?.identity?.userLogin,
    authSessionId: body.auth?.session?.id,
    sessionType: body.auth?.session?.type,
    sessionStatus: body.auth?.session?.status,
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

function summarizeSnapshot(response, local) {
  if (response.status !== 200 || response.body?.ok !== true) {
    return summarizeResponse(response);
  }
  const snapshot = response.body.snapshot;
  return {
    status: response.status,
    ok: true,
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
  return {
    status: response.status,
    ok: true,
    rows: rows.length,
    applyCommitted: rows.some((entry) => entry.event === 'apply-committed'),
    mutationApplied: rows.filter((entry) => entry.event === 'mutation-applied').length,
    idempotencyOpened: rows.filter((entry) => entry.event === 'idempotency-opened').length,
    authUser: response.body?.auth?.identity?.userLogin,
    authSessionId: response.body?.auth?.session?.id,
    sessionType: response.body?.auth?.session?.type,
    sessionStatus: response.body?.auth?.session?.status,
  };
}

function dbJournalProofIsAcceptable(dbJournal) {
  return dbJournal?.applyCommitted === true
    && dbJournal?.idempotencyOpened > 0
    && dbJournal?.mutationApplied > 0;
}

function summarizeRecoveryInspect(response) {
  const recovery = response.body?.recovery;
  if (!recovery || typeof recovery !== 'object') {
    return undefined;
  }

  return {
    authUser: response.body?.auth?.identity?.userLogin,
    authSessionId: response.body?.auth?.session?.id,
    sessionType: response.body?.auth?.session?.type,
    sessionStatus: response.body?.auth?.session?.status,
    state: recovery.state,
    counts: recovery.counts ? {
      old: recovery.counts.old,
      new: recovery.counts.new,
      blockedUnknown: recovery.counts.blockedUnknown,
      total: recovery.counts.total,
    } : undefined,
    journalState: recovery.journal?.integrity?.status,
  };
}

function isReplayEquivalent(applyResponse, replayResponse) {
  const applyBody = applyResponse?.body || {};
  const replayBody = replayResponse?.body || {};
  return applyResponse?.status === replayResponse?.status
    && applyBody.mode === replayBody.mode
    && applyBody.ok === replayBody.ok
    && applyBody.code === replayBody.code
    && applyBody.applied === replayBody.applied
    && applyBody.receipt?.receiptHash === replayBody.receipt?.receiptHash
    && applyBody.responseSchemaVersion === replayBody.responseSchemaVersion
    && isStorageGuardEquivalent(applyBody.storageGuard, replayBody.storageGuard)
    && applyBody.auth?.identity?.userLogin === replayBody.auth?.identity?.userLogin
    && applyBody.auth?.session?.id === replayBody.auth?.session?.id
    && applyBody.auth?.session?.type === replayBody.auth?.session?.type
    && applyBody.auth?.session?.status === replayBody.auth?.session?.status
    && applyBody.signedRequest?.signed === replayBody.signedRequest?.signed
    && applyBody.signedRequest?.schemaVersion === replayBody.signedRequest?.schemaVersion
    && applyBody.signedRequest?.contentHash === replayBody.signedRequest?.contentHash
    && applyBody.signedRequest?.timestamp === replayBody.signedRequest?.timestamp
    && applyBody.signedRequest?.nonceHash === replayBody.signedRequest?.nonceHash
    && applyBody.signedRequest?.sessionHash === replayBody.signedRequest?.sessionHash
    && applyBody.signedRequest?.signingKeyHash === replayBody.signedRequest?.signingKeyHash
    && JSON.stringify(applyBody.signedRequest?.request || null) === JSON.stringify(replayBody.signedRequest?.request || null)
    && applyBody.idempotency?.replayed === replayBody.idempotency?.replayed
    && applyBody.idempotency?.freshMutationWork === replayBody.idempotency?.freshMutationWork
    && applyBody.idempotency?.status === replayBody.idempotency?.status
    && applyBody.idempotency?.conflict === replayBody.idempotency?.conflict;
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
    || body.auth?.session?.status !== expected.sessionStatus;
}

function hasProductionAuthSessionTypeDrift(response) {
  return response?.body?.auth?.session?.type !== 'production-auth-session';
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
  );
}

async function requestJsonRaw(baseUrl, method, pathname, rawBody = undefined, headers = {}, requestTimeoutMs = 10_000) {
  const retryable = isRetryableReadOnlyGet(baseUrl, method, pathname, headers);
  const attempts = retryable ? transientFetchAttempts : 1;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await requestJsonRawOnce(baseUrl, method, pathname, rawBody, headers, requestTimeoutMs);
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
  if (!/^psh_[A-Za-z0-9_-]{8,}$/.test(options.session)) {
    throw new Error(`Invalid push session for mutating request: ${pathname}`);
  }
  if (options.idempotencyKey === undefined || options.idempotencyKey === '') {
    throw new Error(`Missing push idempotencyKey for mutating request: ${pathname}`);
  }
  if (typeof options.idempotencyKey !== 'string' || options.idempotencyKey.trim() !== options.idempotencyKey || !/^\S+$/.test(options.idempotencyKey)) {
    throw new Error(`Invalid push idempotencyKey for mutating request: ${pathname}`);
  }
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

  if (baseUrl.protocol === 'http:' && isLoopbackHost(baseUrl.hostname) && isSandboxIngressPort(baseUrl.port)) {
    return;
  }
  if (baseUrl.protocol === 'https:' && baseUrl.hostname === 'localhost' && isSandboxIngressPort(baseUrl.port)) {
    return;
  }

  throw new Error(
    `Unsupported production-shaped sourceUrl origin: ${baseUrl.origin}. Use the sandbox-provided 8080 ingress or fail closed.`,
  );
}

function isLoopbackHost(hostname) {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname.startsWith('127.');
}

function isSandboxIngressPort(port) {
  return port === '' || port === '8080';
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
