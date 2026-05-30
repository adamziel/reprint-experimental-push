import { buildAuthSessionSourceCommand } from './auth-session-source-command.js';
import { isPackagedProductionPluginSourceCommand } from './packaged-production-plugin-source-command.js';
import { shouldRequestPackagedProductionPluginAuthSession } from './packaged-production-plugin-source-command.js';
import { resolvePackagedProductionPluginSourceCommand } from './packaged-production-plugin-source-command.js';

export function resolveCheckedReleaseRequirementEnv() {
  return {
    REPRINT_PUSH_REQUIRE_PRODUCTION_AUTH_SESSION: '1',
    REPRINT_PUSH_REQUIRE_PRODUCTION_DURABLE_JOURNAL: '1',
  };
}

export function buildDurableRecoveryJournalReleaseProof({
  releaseSummary,
  applyRevalidation,
} = {}) {
  const releaseProof = releaseSummary?.releaseProof || releaseSummary || {};
  const durableJournal = releaseSummary?.durableJournal || {};
  const durableJournalCandidate = durableJournal?.proof?.journal || null;
  const dbJournalCandidate = releaseProof?.dbJournal || null;
  const recoveryInspectJournalCandidate = releaseProof?.recoveryInspect?.recovery?.journal || null;
  const journal = selectDurableRecoveryJournalCandidate([
    dbJournalCandidate,
    durableJournalCandidate,
    recoveryInspectJournalCandidate,
  ]);
  const leaseFence = journal?.leaseFence
    || (journal === durableJournalCandidate ? durableJournal?.proof?.leaseFence : null)
    || releaseProof?.dbJournal?.leaseFence
    || durableJournal?.proof?.leaseFence
    || null;
  const claim = journal?.claim || releaseProof?.dbJournal?.claim || null;
  const writerLease = journal?.writerLease || releaseProof?.dbJournal?.writerLease || null;
  const leaseWriterLease = journal?.leaseFence?.writerLease
    || leaseFence?.writerLease
    || releaseProof?.dbJournal?.leaseFence?.writerLease
    || null;
  const claimExpiry = journal?.claimExpiry
    || claim?.claimExpiry
    || releaseProof?.dbJournal?.claimExpiry
    || durableJournal?.proof?.claimExpiry
    || null;
  const activeClaimKeyHash = claim?.activeClaimKeyHash || claim?.activeClaimHash || null;
  const previousClaimKeyHash = claim?.previousClaimKeyHash || claim?.previousClaimHash || null;
  const writerLeaseClaimKeyHash = writerLease?.claimKeyHash || writerLease?.claimHash || null;
  const leaseFenceClaimKeyHash = leaseWriterLease?.claimKeyHash || leaseWriterLease?.claimHash || null;
  const planMutationCount = Number.isInteger(releaseProof?.plan?.mutations)
    ? releaseProof.plan.mutations
    : Array.isArray(releaseProof?.planObject?.mutations)
      ? releaseProof.planObject.mutations.length
      : null;
  const latestEvents = Array.isArray(releaseProof?.dbJournal?.latestEvents)
    ? releaseProof.dbJournal.latestEvents
    : [];
  const eventCounts = releaseProof?.dbJournal?.eventCounts || {};
  const conflictEvent = [...latestEvents]
    .reverse()
    .find((entry) => entry?.event === 'idempotency-key-conflict' || entry?.event === 'idempotency-conflict')
    || null;
  const mutationEventsAfterConflict = conflictEvent
    ? latestEvents.filter((entry) =>
      Number.isInteger(entry?.sequence)
      && entry.sequence > conflictEvent.sequence
      && (entry.event === 'apply-started' || entry.event === 'mutation-applied'))
    : [];
  const recovery = releaseProof?.recoveryInspect?.recovery || {};
  const recoveryCounts = recovery?.counts || {};
  const oldRemoteRecoveryClassification = selectOldRemoteRecoveryClassification({
    releaseProof,
    planMutationCount,
  });
  const applyRevalidationRecovery = applyRevalidation?.recoveryInspect?.recovery || {};
  const applyRevalidationCounts = applyRevalidationRecovery?.counts || {};
  const replay = releaseProof?.replay?.idempotency || {};
  const rejectedApply = applyRevalidation?.apply || {};
  const rejectedReplay = applyRevalidation?.replay || {};
  const rejectedReplayOrdering = applyRevalidation?.dbJournal?.ordering || {};
  const rejectedReplayOnCheckedRecoveryPath = Boolean(
    releaseSummary?.boundary?.verdict === 'LIVE_RELEASE_BOUNDARY_OK'
    && (
      applyRevalidation?.boundary?.verdict === 'LIVE_RELEASE_BOUNDARY_OK'
      || applyRevalidation?.boundary?.durableJournal?.verdict === 'LIVE_RELEASE_BOUNDARY_OK'
      || applyRevalidation?.durableJournal?.checkedAccepted === true
    ),
  );
  const conflict = releaseProof?.idempotencyConflict || {};
  const mutationApplied = releaseProof?.dbJournal?.mutationApplied ?? null;
  const expectedMutationEvents = Number.isInteger(planMutationCount) ? planMutationCount : mutationApplied;
  const leaseOwnerIdentity = {
    activeClaimId: claim?.activeClaimId || null,
    activeClaimKeyHash,
    writerLeaseClaimId: writerLease?.claimId || null,
    writerLeaseClaimKeyHash,
    leaseFenceClaimId: leaseWriterLease?.claimId || null,
    leaseFenceClaimKeyHash,
    matches: Boolean(
      claim?.activeClaimId
      && activeClaimKeyHash
      && writerLease?.claimId === claim.activeClaimId
      && writerLeaseClaimKeyHash === activeClaimKeyHash
      && leaseWriterLease?.claimId === claim.activeClaimId
      && leaseFenceClaimKeyHash === activeClaimKeyHash,
    ),
  };
  const staleOwnerFencing = {
    proved: Boolean(
      claim?.staleClaimRejected === true
      && leaseFence?.staleClaimRejected === true
      && writerLease?.staleClaimRejected === true
      && leaseWriterLease?.staleClaimRejected === true
      && claim?.previousClaimId
      && previousClaimKeyHash,
    ),
    activeClaimId: claim?.activeClaimId || null,
    previousClaimId: claim?.previousClaimId || null,
    previousClaimKeyHash,
    activeClaimEvent: claim?.activeClaimEvent || null,
    leaseFenceStaleClaimRejected: leaseFence?.staleClaimRejected === true,
  };
  const claimExpiryPolicy = {
    proved: Boolean(
      claimExpiry?.policy
      && claimExpiry?.expired === true
      && (claimExpiry?.previousClaimExpired === true || claim?.staleClaimRejected === true)
      && Number.isInteger(claimExpiry?.staleThresholdMs)
      && claimExpiry.staleThresholdMs >= 0
      && nonEmptyString(claimExpiry?.openedAt || claimExpiry?.previousClaimOpenedAt)
      && nonEmptyString(claimExpiry?.expiresAt || claimExpiry?.previousClaimExpiresAt)
      && (
        positiveInteger(claimExpiry?.activeClaimSequence)
        || positiveInteger(claim?.activeClaimSequence)
        || positiveInteger(claim?.sequence)
      )
      && (
        positiveInteger(claimExpiry?.previousClaimSequence)
        || nonEmptyString(claim?.previousClaimId)
        || nonEmptyString(previousClaimKeyHash)
      ),
    ),
    policy: claimExpiry?.policy || null,
    expired: claimExpiry?.expired === true,
    previousClaimExpired: claimExpiry?.previousClaimExpired === true,
    staleThresholdMs: Number.isInteger(claimExpiry?.staleThresholdMs)
      ? claimExpiry.staleThresholdMs
      : null,
    openedAt: claimExpiry?.openedAt || null,
    expiresAt: claimExpiry?.expiresAt || null,
    previousClaimOpenedAt: claimExpiry?.previousClaimOpenedAt || null,
    previousClaimExpiresAt: claimExpiry?.previousClaimExpiresAt || null,
    previousClaimAgeMs: Number.isInteger(claimExpiry?.previousClaimAgeMs)
      ? claimExpiry.previousClaimAgeMs
      : null,
    activeClaimSequence: claimExpiry?.activeClaimSequence ?? claim?.activeClaimSequence ?? claim?.sequence ?? null,
    previousClaimSequence: claimExpiry?.previousClaimSequence ?? claim?.previousClaimSequence ?? null,
  };
  const sameKeyBodyReplay = {
    proved: Boolean(
      replay?.replayed === true
      && replay?.freshMutationWork === false
      && mutationApplied === expectedMutationEvents,
    ),
    replayed: replay?.replayed === true,
    freshMutationWork: replay?.freshMutationWork === true,
    mutationEvents: mutationApplied,
    expectedMutationEvents,
    duplicateMutationEvents: Number.isInteger(mutationApplied)
      && Number.isInteger(expectedMutationEvents)
      ? mutationApplied !== expectedMutationEvents
      : null,
  };
  const sameKeyDifferentBodyConflict = {
    proved: Boolean(
      conflict?.status === 409
      && conflict?.code === 'IDEMPOTENCY_KEY_CONFLICT'
      && conflict?.idempotency?.conflict === true
      && conflict?.idempotency?.freshMutationWork === false
      && conflict?.targetSnapshotUnchanged === true
      && conflictEvent
      && mutationEventsAfterConflict.length === 0,
    ),
    status: conflict?.status ?? null,
    code: conflict?.code || null,
    conflict: conflict?.idempotency?.conflict === true,
    freshMutationWork: conflict?.idempotency?.freshMutationWork === true,
    targetSnapshotUnchanged: conflict?.targetSnapshotUnchanged === true,
    conflictEventSequence: conflictEvent?.sequence ?? null,
    mutationEventsAfterConflict: mutationEventsAfterConflict.length,
  };
  const sameKeyReplayAfterRejection = {
    proved: Boolean(
      applyRevalidation?.ok === true
      && rejectedReplayOnCheckedRecoveryPath
      && rejectedApply?.status === 412
      && rejectedApply?.code === 'PRECONDITION_FAILED'
      && rejectedApply?.applied === 0
      && rejectedApply?.applyRevalidation?.phase === 'before-first-mutation'
      && rejectedReplay?.status === rejectedApply.status
      && rejectedReplay?.code === rejectedApply.code
      && rejectedReplay?.replayed === true
      && rejectedReplay?.freshMutationWork === false
      && rejectedReplay?.preservedRemoteUnchanged === true
      && rejectedReplayOrdering?.ordered === true
      && positiveInteger(rejectedReplayOrdering?.applyRejected)
      && positiveInteger(rejectedReplayOrdering?.applyReplayed)
      && rejectedReplayOrdering.applyRejected < rejectedReplayOrdering.applyReplayed
      && rejectedReplayOrdering?.mutationAppliedBeforeFailure === 0
      && rejectedReplayOrdering?.applyCommitted === false
    ),
    status: rejectedReplay?.status ?? null,
    code: rejectedReplay?.code || null,
    replayed: rejectedReplay?.replayed === true,
    freshMutationWork: rejectedReplay?.freshMutationWork === true,
    preservedRemoteUnchanged: rejectedReplay?.preservedRemoteUnchanged === true,
    applyStatus: rejectedApply?.status ?? null,
    applyCode: rejectedApply?.code || null,
    applyApplied: Number.isInteger(rejectedApply?.applied) ? rejectedApply.applied : null,
    applyRevalidationPhase: rejectedApply?.applyRevalidation?.phase || null,
    sameCheckedRecoveryPath: rejectedReplayOnCheckedRecoveryPath,
    releaseBoundaryVerdict: releaseSummary?.boundary?.verdict || null,
    applyRevalidationBoundaryVerdict: applyRevalidation?.boundary?.verdict || null,
    applyRevalidationDurableJournalVerdict: applyRevalidation?.boundary?.durableJournal?.verdict || null,
    applyRevalidationDurableJournalAccepted: applyRevalidation?.durableJournal?.checkedAccepted === true,
    applyRejectedSequence: rejectedReplayOrdering?.applyRejected ?? null,
    applyReplayedSequence: rejectedReplayOrdering?.applyReplayed ?? null,
    mutationAppliedBeforeFailure: rejectedReplayOrdering?.mutationAppliedBeforeFailure ?? null,
    applyCommitted: rejectedReplayOrdering?.applyCommitted === true,
  };
  const partialStates = {
    old: {
      proved: oldRemoteRecoveryClassification.proved === true,
      source: oldRemoteRecoveryClassification.source,
      status: oldRemoteRecoveryClassification.status,
      code: oldRemoteRecoveryClassification.code,
      state: oldRemoteRecoveryClassification.state,
      observedState: oldRemoteRecoveryClassification.observedState,
      counts: oldRemoteRecoveryClassification.counts,
    },
    new: {
      proved: Boolean(
        Number.isInteger(planMutationCount)
        && recoveryCounts?.new === planMutationCount
        && recoveryCounts?.blockedUnknown === 0,
      ),
      source: 'release-path recovery inspect',
      state: recovery?.state || null,
      counts: recoveryCounts || null,
    },
    blocked: {
      proved: Boolean(
        (applyRevalidationRecovery?.state === 'blocked-recovery'
          || applyRevalidationRecovery?.status === 'blocked-recovery')
        && (applyRevalidationCounts?.blockedUnknown || 0) > 0,
      ),
      source: 'apply-time revalidation recovery inspect',
      state: applyRevalidationRecovery?.state || applyRevalidationRecovery?.status || null,
      counts: applyRevalidationCounts || null,
    },
  };
  const recoveryInspectAfterRestart = {
    proved: Boolean(
      releaseProof?.recoveryInspect?.status === 200
      && releaseProof?.recoveryInspect?.recovery?.journalState === 'ok'
      && journal?.ownership?.restartReadable === true
      && leaseFence?.restartReadable === true,
    ),
    status: releaseProof?.recoveryInspect?.status ?? null,
    state: recovery?.state || null,
    journalState: releaseProof?.recoveryInspect?.recovery?.journalState || null,
    counts: recoveryCounts || null,
  };
  const preservedRejectedRemoteEvidence = {
    proved: Boolean(
      releaseProof?.replayAndRetry?.verdict === 'PRESERVED_REMOTE_RETRY_PROVEN'
      && applyRevalidation?.apply?.status === 412
      && applyRevalidation?.apply?.code === 'PRECONDITION_FAILED'
      && (applyRevalidationRecovery?.state === 'blocked-recovery'
        || applyRevalidationRecovery?.status === 'blocked-recovery')
    ),
    replayAndRetry: releaseProof?.replayAndRetry || null,
    applyStatus: applyRevalidation?.apply?.status ?? null,
    applyCode: applyRevalidation?.apply?.code || null,
    recoveryState: applyRevalidationRecovery?.state || applyRevalidationRecovery?.status || null,
  };
  const ownership = {
    ownsJournal: journal?.ownership?.ownsJournal === true || journal?.ownsJournal === true,
    restartReadable: journal?.ownership?.restartReadable === true || journal?.restartReadable === true,
    productionAdapter: journal?.ownership?.productionAdapter || journal?.productionAdapter || null,
    supportedSurface: journal?.ownership?.supportedSurface || journal?.supportedSurface || null,
  };

  const checks = {
    ownsJournal: ownership.ownsJournal === true,
    restartReadable: ownership.restartReadable === true && leaseFence?.restartReadable === true,
    leaseOwnerIdentity: leaseOwnerIdentity.matches === true,
    staleOwnerFencing: staleOwnerFencing.proved === true,
    claimExpiryPolicy: claimExpiryPolicy.proved === true,
    recoveryInspectAfterRestart: recoveryInspectAfterRestart.proved === true,
    sameKeyBodyReplay: sameKeyBodyReplay.proved === true,
    sameKeyDifferentBodyConflict: sameKeyDifferentBodyConflict.proved === true,
    sameKeyReplayAfterRejection: sameKeyReplayAfterRejection.proved === true,
    oldState: partialStates.old.proved === true,
    newState: partialStates.new.proved === true,
    blockedState: partialStates.blocked.proved === true,
    preservedRejectedRemoteEvidence: preservedRejectedRemoteEvidence.proved === true,
  };

  return {
    gate: 'GATE-2',
    durableRecoveryJournalBoundary: 'release-verifier',
    ok: Object.values(checks).every(Boolean),
    gateStatus: releaseSummary?.boundary?.verdict === 'LIVE_RELEASE_BOUNDARY_OK'
      ? 'proven'
      : 'support_only',
    sameReleaseBoundary: true,
    sourceUrl: releaseSummary?.topology?.sourceUrl || null,
    checks,
    ownership,
    leaseOwnerIdentity,
    staleOwnerFencing,
    claimExpiryPolicy,
    recoveryInspectAfterRestart,
    sameKeyBodyReplay,
    sameKeyDifferentBodyConflict,
    sameKeyReplayAfterRejection,
    partialStates,
    preservedRejectedRemoteEvidence,
  };
}

function selectOldRemoteRecoveryClassification({ releaseProof, planMutationCount }) {
  const staleClaimRetry = releaseProof?.staleClaimRetry || {};
  const candidates = [
    releaseProof?.oldRemoteRecovery,
    releaseProof?.recoveryClassifications?.oldRemote,
    staleClaimRetry?.oldRemoteRecovery,
    staleClaimRetry?.abandoned?.recovery,
    staleClaimRetry?.abandoned?.oldRemoteRecovery,
    staleClaimRetry?.retry?.oldRemoteRecovery,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeOldRemoteRecoveryClassification(candidate, { planMutationCount });
    if (normalized.proved) {
      return normalized;
    }
  }

  const legacyAbandoned = staleClaimRetry?.abandoned || null;
  return {
    proved: false,
    source: 'old remote recovery classification',
    status: legacyAbandoned?.status ?? null,
    code: legacyAbandoned?.code || null,
    state: null,
    observedState: null,
    counts: null,
  };
}

function normalizeOldRemoteRecoveryClassification(candidate, { planMutationCount } = {}) {
  if (!candidate || typeof candidate !== 'object') {
    return { proved: false };
  }

  const counts = normalizeRecoveryCounts(candidate.counts || candidate.recoveryCounts, { planMutationCount });
  const state = candidate.state || candidate.recoveryState || (
    typeof candidate.status === 'string' ? candidate.status : null
  );
  const observedState = candidate.observedState || candidate.observedRecoveryState || null;
  const effectiveState = state === 'old-remote'
    ? state
    : observedState === 'old-remote'
      ? observedState
      : null;
  const allOld = recoveryCountsAreAllOld(counts, { planMutationCount });

  return {
    proved: effectiveState === 'old-remote' && allOld,
    source: candidate.source || 'old remote recovery classification',
    status: candidate.statusCode ?? candidate.httpStatus ?? (
      Number.isInteger(candidate.status) ? candidate.status : null
    ),
    code: candidate.code || null,
    state: effectiveState || state,
    observedState,
    counts,
  };
}

function normalizeRecoveryCounts(counts, { planMutationCount } = {}) {
  if (!counts || typeof counts !== 'object') {
    return null;
  }
  const normalized = {
    old: integerOrNull(counts.old),
    new: integerOrNull(counts.new),
    blockedUnknown: integerOrNull(counts.blockedUnknown ?? counts.blocked_unknown),
    total: integerOrNull(counts.total),
  };
  if (normalized.total === null && positiveInteger(planMutationCount)) {
    normalized.total = planMutationCount;
  }
  return normalized;
}

function recoveryCountsAreAllOld(counts, { planMutationCount } = {}) {
  if (!counts) {
    return false;
  }
  const expectedTotal = positiveInteger(planMutationCount) ? planMutationCount : counts.total;
  return positiveInteger(expectedTotal)
    && counts.total === expectedTotal
    && counts.old === expectedTotal
    && counts.new === 0
    && counts.blockedUnknown === 0;
}

function selectDurableRecoveryJournalCandidate(candidates) {
  let selected = null;
  let selectedScore = -1;
  for (const candidate of candidates) {
    const score = durableRecoveryJournalCandidateScore(candidate);
    if (score > selectedScore) {
      selected = candidate || null;
      selectedScore = score;
    }
  }
  return selected;
}

function durableRecoveryJournalCandidateScore(journal) {
  if (!journal || typeof journal !== 'object') {
    return -1;
  }

  const claim = journal.claim || {};
  const leaseFence = journal.leaseFence || {};
  const writerLease = journal.writerLease || {};
  const leaseWriterLease = leaseFence.writerLease || {};
  const activeClaimKeyHash = claim.activeClaimKeyHash || claim.activeClaimHash;
  const previousClaimKeyHash = claim.previousClaimKeyHash || claim.previousClaimHash;
  const writerLeaseClaimKeyHash = writerLease.claimKeyHash || writerLease.claimHash;
  const leaseWriterLeaseClaimKeyHash = leaseWriterLease.claimKeyHash || leaseWriterLease.claimHash;
  const claimExpiry = journal.claimExpiry || claim.claimExpiry || null;
  const hasActiveClaimIdentity = nonEmptyString(claim.activeClaimId)
    && nonEmptyString(activeClaimKeyHash);
  const hasPreviousClaimIdentity = nonEmptyString(claim.previousClaimId)
    && nonEmptyString(previousClaimKeyHash);
  const writerLeaseMatchesClaim = hasActiveClaimIdentity
    && writerLease.claimId === claim.activeClaimId
    && writerLeaseClaimKeyHash === activeClaimKeyHash
    && leaseWriterLease.claimId === claim.activeClaimId
    && leaseWriterLeaseClaimKeyHash === activeClaimKeyHash;
  const provesClaimExpiry = Boolean(
    claimExpiry?.policy
    && claimExpiry?.expired === true
    && (claimExpiry?.previousClaimExpired === true || claim.staleClaimRejected === true),
  );

  let score = 0;
  if (journal.ownership?.ownsJournal === true || journal.ownsJournal === true) score += 10;
  if (journal.ownership?.restartReadable === true || journal.restartReadable === true) score += 10;
  if (nonEmptyString(journal.ownership?.productionAdapter || journal.productionAdapter)) score += 5;
  if (nonEmptyString(journal.ownership?.supportedSurface || journal.supportedSurface)) score += 5;
  if (leaseFence.restartReadable === true) score += 5;
  if (leaseFence.staleClaimRejected === true) score += 10;
  if (writerLease.staleClaimRejected === true) score += 5;
  if (leaseWriterLease.staleClaimRejected === true) score += 5;
  if (hasActiveClaimIdentity) score += 10;
  if (hasPreviousClaimIdentity) score += 50;
  if (claim.staleClaimRejected === true && hasPreviousClaimIdentity) score += 50;
  if (provesClaimExpiry) score += 50;
  if (writerLeaseMatchesClaim) score += 25;
  if (journal.applyCommitted === true) score += 5;
  if (Number.isInteger(journal.mutationApplied) && journal.mutationApplied > 0) score += 5;
  if (journal.paginationComplete === true && journal.paginationTruncated !== true) score += 5;
  return score;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function integerOrNull(value) {
  return Number.isInteger(value) ? value : null;
}

export function shouldRequestCheckedLivePackagedBoundary({
  liveSourceUrl = '',
  username = '',
  applicationPassword = '',
  authSessionSourceCommand = '',
  fixtureUsername = '',
  fixtureApplicationPassword = '',
} = {}) {
  if (isPackagedProductionPluginSourceCommand(authSessionSourceCommand)) {
    return true;
  }

  return shouldRequestPackagedProductionPluginAuthSession({
    requireProductionAuthSession: true,
    authSessionSourceCommand,
    liveSourceUrl,
    username,
    applicationPassword,
    fixtureUsername,
    fixtureApplicationPassword,
  });
}

export function applyRevalidationRetryable(proof) {
  const combinedOutput = `${proof.stdout ?? ''}\n${proof.stderr ?? ''}`;
  return proof.status !== 0
    && /apply-revalidation:/.test(combinedOutput)
    && (
      /Timed out waiting for Playground server/.test(combinedOutput)
      || /readiness probe error fetch failed/.test(combinedOutput)
      || /WordPress is not ready yet/.test(combinedOutput)
      || (
        /apply-revalidation:\s+apply\s+\/apply/.test(combinedOutput)
        && /TimeoutError: The operation was aborted due to timeout/.test(combinedOutput)
      )
    );
}

export function hasExplicitCheckedBoundaryRequest({
  liveSourceUrl = '',
  username = '',
  applicationPassword = '',
  authSessionSourceCommand = '',
} = {}) {
  return Boolean(
    liveSourceUrl
    || username
    || applicationPassword
    || authSessionSourceCommand,
  );
}

export function resolveCheckedLiveBoundaryEnv({
  sourceUrl = '',
  remoteChangedUrl = '',
  localUrl = '',
  username = '',
  applicationPassword = '',
  authSessionSourceCommand = '',
  fallbackUsername = '',
  fallbackApplicationPassword = '',
  allowCredentialFallback = false,
} = {}) {
  const resolvedUsername = username || (allowCredentialFallback ? fallbackUsername : '');
  const resolvedApplicationPassword = applicationPassword || (allowCredentialFallback ? fallbackApplicationPassword : '');
  const resolvedAuthSessionSourceCommand = authSessionSourceCommand
    || (sourceUrl
      && resolvedUsername
      && resolvedApplicationPassword
      ? buildAuthSessionSourceCommand({
          sourceUrl,
          username: resolvedUsername,
          applicationPassword: resolvedApplicationPassword,
        })
      : '');

  return {
    ...resolveCheckedReleaseRequirementEnv(),
    ...(sourceUrl
      ? {
          REPRINT_PUSH_SOURCE_URL: sourceUrl,
          REPRINT_PUSH_REMOTE_URL: sourceUrl,
        }
      : {}),
    ...(remoteChangedUrl ? { REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl } : {}),
    ...(localUrl ? { REPRINT_PUSH_LOCAL_URL: localUrl } : {}),
    REPRINT_PUSH_USERNAME: resolvedUsername,
    REPRINT_PUSH_APPLICATION_PASSWORD: resolvedApplicationPassword,
    REPRINT_PUSH_LAB_AUTH_ADMIN_USER: resolvedUsername,
    REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: resolvedApplicationPassword,
    ...(resolvedAuthSessionSourceCommand
      ? { REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND: resolvedAuthSessionSourceCommand }
      : {}),
  };
}

export function resolveLiveApplyRevalidationEnv({
  sourceUrl = '',
  remoteChangedUrl = '',
  localUrl = '',
  packagedBoundaryRequested = false,
  username = '',
  applicationPassword = '',
  authSessionSourceCommand = '',
  fallbackUsername = '',
  fallbackApplicationPassword = '',
  allowCredentialFallback = false,
} = {}) {
  const resolvedUsername = username || (allowCredentialFallback ? fallbackUsername : '');
  const resolvedApplicationPassword = applicationPassword || (allowCredentialFallback ? fallbackApplicationPassword : '');
  const resolvedAuthSessionSourceCommand = authSessionSourceCommand
    || (sourceUrl
      && resolvedUsername
      && resolvedApplicationPassword
      ? packagedBoundaryRequested
        ? resolvePackagedProductionPluginSourceCommand({
            sourceUrl,
            username: resolvedUsername,
            applicationPassword: resolvedApplicationPassword,
          })
        : buildAuthSessionSourceCommand({
            sourceUrl,
            username: resolvedUsername,
            applicationPassword: resolvedApplicationPassword,
          })
      : '');

  return {
    ...resolveCheckedReleaseRequirementEnv(),
    ...(sourceUrl
      ? {
          REPRINT_PUSH_SOURCE_URL: sourceUrl,
          REPRINT_PUSH_REMOTE_URL: sourceUrl,
        }
      : {}),
    ...(remoteChangedUrl ? { REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl } : {}),
    ...(localUrl ? { REPRINT_PUSH_LOCAL_URL: localUrl } : {}),
    REPRINT_PUSH_USERNAME: resolvedUsername,
    REPRINT_PUSH_APPLICATION_PASSWORD: resolvedApplicationPassword,
    REPRINT_PUSH_LAB_AUTH_ADMIN_USER: resolvedUsername,
    REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: resolvedApplicationPassword,
    ...(resolvedAuthSessionSourceCommand
      ? { REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND: resolvedAuthSessionSourceCommand }
      : {}),
  };
}

export function shouldUseProductionSnapshotExport({
  packagedBoundaryRequested = false,
  explicitSourceUrl = '',
} = {}) {
  return Boolean(packagedBoundaryRequested || explicitSourceUrl);
}

export function resolveCheckedReleaseTopology({
  remoteBaseUrl = '',
  explicitSourceUrl = '',
  explicitRemoteChangedUrl = '',
  explicitLocalUrl = '',
  packagedBoundaryRequested = false,
} = {}) {
  const explicitLiveTopologyRequested = Boolean(explicitSourceUrl) && !packagedBoundaryRequested;

  return {
    remoteBase: remoteBaseUrl,
    remoteChanged: explicitLiveTopologyRequested
      ? (explicitRemoteChangedUrl || explicitSourceUrl)
      : 'remote-changed',
    localEdited: explicitLocalUrl || 'local-edited',
  };
}
