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
  const applyRevalidationRecovery = applyRevalidation?.recoveryInspect?.recovery || {};
  const applyRevalidationCounts = applyRevalidationRecovery?.counts || {};
  const replay = releaseProof?.replay?.idempotency || {};
  const conflict = releaseProof?.idempotencyConflict || {};
  const mutationApplied = releaseProof?.dbJournal?.mutationApplied ?? null;
  const expectedMutationEvents = Number.isInteger(planMutationCount) ? planMutationCount : mutationApplied;
  const leaseOwnerIdentity = {
    activeClaimId: claim?.activeClaimId || null,
    activeClaimKeyHash: claim?.activeClaimKeyHash || null,
    writerLeaseClaimId: writerLease?.claimId || null,
    writerLeaseClaimKeyHash: writerLease?.claimKeyHash || null,
    leaseFenceClaimId: leaseWriterLease?.claimId || null,
    leaseFenceClaimKeyHash: leaseWriterLease?.claimKeyHash || null,
    matches: Boolean(
      claim?.activeClaimId
      && claim?.activeClaimKeyHash
      && writerLease?.claimId === claim.activeClaimId
      && writerLease?.claimKeyHash === claim.activeClaimKeyHash
      && leaseWriterLease?.claimId === claim.activeClaimId
      && leaseWriterLease?.claimKeyHash === claim.activeClaimKeyHash,
    ),
  };
  const staleOwnerFencing = {
    proved: Boolean(
      claim?.staleClaimRejected === true
      && leaseFence?.staleClaimRejected === true
      && writerLease?.staleClaimRejected === true
      && leaseWriterLease?.staleClaimRejected === true
      && claim?.previousClaimId
      && claim?.previousClaimKeyHash,
    ),
    activeClaimId: claim?.activeClaimId || null,
    previousClaimId: claim?.previousClaimId || null,
    previousClaimKeyHash: claim?.previousClaimKeyHash || null,
    activeClaimEvent: claim?.activeClaimEvent || null,
    leaseFenceStaleClaimRejected: leaseFence?.staleClaimRejected === true,
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
  const partialStates = {
    old: {
      proved: releaseProof?.staleClaimRetry?.abandoned?.code === 'LAB_SIMULATED_STALE_CLAIM_ALL_OLD',
      source: 'stale-owner retry abandoned before mutation',
      status: releaseProof?.staleClaimRetry?.abandoned?.status ?? null,
      code: releaseProof?.staleClaimRetry?.abandoned?.code || null,
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
    recoveryInspectAfterRestart: recoveryInspectAfterRestart.proved === true,
    sameKeyBodyReplay: sameKeyBodyReplay.proved === true,
    sameKeyDifferentBodyConflict: sameKeyDifferentBodyConflict.proved === true,
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
    recoveryInspectAfterRestart,
    sameKeyBodyReplay,
    sameKeyDifferentBodyConflict,
    partialStates,
    preservedRejectedRemoteEvidence,
  };
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
  const hasActiveClaimIdentity = nonEmptyString(claim.activeClaimId)
    && nonEmptyString(claim.activeClaimKeyHash);
  const hasPreviousClaimIdentity = nonEmptyString(claim.previousClaimId)
    && nonEmptyString(claim.previousClaimKeyHash);
  const writerLeaseMatchesClaim = hasActiveClaimIdentity
    && writerLease.claimId === claim.activeClaimId
    && writerLease.claimKeyHash === claim.activeClaimKeyHash
    && leaseWriterLease.claimId === claim.activeClaimId
    && leaseWriterLease.claimKeyHash === claim.activeClaimKeyHash;

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
  if (writerLeaseMatchesClaim) score += 25;
  if (journal.applyCommitted === true) score += 5;
  if (Number.isInteger(journal.mutationApplied) && journal.mutationApplied > 0) score += 5;
  if (journal.paginationComplete === true && journal.paginationTruncated !== true) score += 5;
  return score;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
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
