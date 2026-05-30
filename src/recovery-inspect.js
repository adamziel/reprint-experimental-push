import { resourceHash } from './resources.js';
import {
  classifyRecoveryJournalClaims,
  readRecoveryJournal,
  readRecoveryJournalPaged,
} from './recovery-journal.js';

export const RECOVERY_INSPECT_REASON_CODES = Object.freeze({
  fullyUpdatedRemote: 'FULLY_UPDATED_REMOTE',
  oldRemote: 'OLD_REMOTE',
  blockedJournalIntegrity: 'BLOCKED_JOURNAL_INTEGRITY',
  blockedTargetUnknown: 'BLOCKED_TARGET_UNKNOWN',
  blockedPartialRemote: 'BLOCKED_PARTIAL_REMOTE',
});

export function inspectRecoveryJournal({ journal, journalPath, plan, current, journalPageSize = null }) {
  const persisted = journal || (journalPageSize
    ? readRecoveryJournalPaged(journalPath, { pageSize: journalPageSize })
    : readRecoveryJournal(journalPath));
  const mutations = plan.mutations || [];

  if (persisted.integrity.status !== 'ok') {
    return blockedInspection({
      plan,
      persisted,
      reason: persisted.integrity.reason || 'Recovery journal cannot be trusted.',
    });
  }

  const targetByMutation = new Map();
  const integrityErrors = [];

  for (const record of persisted.records) {
    if (record.type !== 'target-planned') {
      continue;
    }
    if (record.planId !== plan.id) {
      integrityErrors.push({
        code: 'JOURNAL_PLAN_MISMATCH',
        message: `Journal record belongs to ${record.planId}, not ${plan.id}.`,
      });
      continue;
    }
    if (targetByMutation.has(record.mutationId)) {
      integrityErrors.push({
        code: 'JOURNAL_DUPLICATE_TARGET',
        message: `Journal has duplicate target metadata for ${record.mutationId}.`,
      });
      continue;
    }
    targetByMutation.set(record.mutationId, record);
  }

  if (integrityErrors.length > 0) {
    return blockedInspection({
      plan,
      persisted: withIntegrityErrors(persisted, integrityErrors),
      reason: 'Recovery journal target metadata is inconsistent.',
    });
  }

  const targets = mutations.map((mutation) =>
    classifyMutationTarget({
      mutation,
      target: targetByMutation.get(mutation.id),
      current,
    }));
  const counts = countTargets(targets);
  const status = overallStatus(counts, targets.length);
  const classification = classifyInspection({ status, counts, targets, persisted });
  const claim = classifyRecoveryJournalClaims(persisted.records);
  const remoteRecoveryClassification = classifyRemoteRecoveryState({
    status,
    counts,
    total: targets.length,
    persisted,
  });

  return {
    status,
    remoteClassification: recoveryRemoteClassification({ status, counts, total: targets.length }),
    reasonCode: classification.reasonCode,
    reason: reasonForStatus(status, counts, targets.length),
    classification,
    planId: plan.id,
    counts,
    targets,
    remoteRecoveryClassification,
    claim,
    journal: persisted,
  };
}

function classifyMutationTarget({ mutation, target, current }) {
  if (!target) {
    return unknownTarget(mutation, 'missing-journal-record', 'No persisted target record exists for this mutation.');
  }
  if (
    target.resourceKey !== mutation.resourceKey
    || typeof target.beforeHash !== 'string'
    || typeof target.afterHash !== 'string'
  ) {
    return unknownTarget(mutation, 'invalid-journal-record', 'Persisted target metadata does not match the plan.');
  }

  const observedHash = resourceHash(current, mutation.resource);
  if (observedHash === target.beforeHash) {
    return {
      mutationId: mutation.id,
      resourceKey: mutation.resourceKey,
      state: 'old',
      beforeHash: target.beforeHash,
      afterHash: target.afterHash,
      observedHash,
    };
  }
  if (observedHash === target.afterHash) {
    return {
      mutationId: mutation.id,
      resourceKey: mutation.resourceKey,
      state: 'new',
      beforeHash: target.beforeHash,
      afterHash: target.afterHash,
      observedHash,
    };
  }
  return {
    mutationId: mutation.id,
    resourceKey: mutation.resourceKey,
    state: 'blocked-unknown',
    reason: 'Current resource hash is outside the before/after recovery envelope.',
    beforeHash: target.beforeHash,
    afterHash: target.afterHash,
    observedHash,
  };
}

function blockedInspection({ plan, persisted, reason }) {
  const targets = (plan.mutations || []).map((mutation) =>
    unknownTarget(mutation, 'journal-integrity-blocked', reason));
  const counts = countTargets(targets);
  const status = 'blocked-recovery';
  const classification = classifyInspection({
    status,
    counts,
    targets,
    persisted,
  });
  return {
    status,
    remoteClassification: recoveryRemoteClassification({
      status,
      counts,
      total: targets.length,
    }),
    reasonCode: classification.reasonCode,
    reason,
    classification,
    planId: plan.id,
    counts,
    targets,
    remoteRecoveryClassification: classifyRemoteRecoveryState({
      status,
      counts,
      total: targets.length,
      persisted,
    }),
    claim: classifyRecoveryJournalClaims(persisted.records),
    journal: persisted,
  };
}

function unknownTarget(mutation, code, reason) {
  return {
    mutationId: mutation.id,
    resourceKey: mutation.resourceKey,
    state: 'blocked-unknown',
    reason,
    code,
  };
}

function countTargets(targets) {
  const counts = { old: 0, new: 0, blockedUnknown: 0 };
  for (const target of targets) {
    if (target.state === 'old') {
      counts.old++;
    } else if (target.state === 'new') {
      counts.new++;
    } else {
      counts.blockedUnknown++;
    }
  }
  return counts;
}

function overallStatus(counts, total) {
  if (counts.blockedUnknown > 0) {
    return 'blocked-recovery';
  }
  if (counts.new === total) {
    return 'fully-updated-remote';
  }
  if (counts.old === total) {
    return 'old-remote';
  }
  return 'blocked-recovery';
}

function classifyInspection({ status, counts, targets, persisted }) {
  const reasonCode = recoveryInspectionReasonCode({ status, counts, targets, persisted });
  return {
    state: status,
    reasonCode,
    journalIntegrity: persisted.integrity?.status || 'unknown',
    durableRows: persisted.integrity?.status === 'ok' ? persisted.records.length : 0,
    retry: retryDispositionForStatus(status),
    targetEnvelope: {
      total: targets.length,
      old: counts.old,
      new: counts.new,
      blockedUnknown: counts.blockedUnknown,
    },
  };
}

function recoveryInspectionReasonCode({ status, counts, targets, persisted }) {
  if (status === 'fully-updated-remote') {
    return RECOVERY_INSPECT_REASON_CODES.fullyUpdatedRemote;
  }
  if (status === 'old-remote') {
    return RECOVERY_INSPECT_REASON_CODES.oldRemote;
  }
  if (persisted.integrity?.status !== 'ok') {
    return RECOVERY_INSPECT_REASON_CODES.blockedJournalIntegrity;
  }
  if (counts.blockedUnknown > 0 || targets.some((target) => target.state === 'blocked-unknown')) {
    return RECOVERY_INSPECT_REASON_CODES.blockedTargetUnknown;
  }
  return RECOVERY_INSPECT_REASON_CODES.blockedPartialRemote;
}

function retryDispositionForStatus(status) {
  if (status === 'fully-updated-remote') {
    return 'no-op';
  }
  if (status === 'old-remote') {
    return 'retry-after-revalidation';
  }
  return 'blocked';
}

function reasonForStatus(status, counts, total) {
  if (status === 'fully-updated-remote') {
    return 'Every planned target currently matches its journaled after hash.';
  }
  if (status === 'old-remote') {
    return 'Every planned target currently matches its journaled before hash.';
  }
  if (counts.blockedUnknown > 0) {
    return 'At least one planned target cannot be classified from the persisted journal.';
  }
  return `Remote is partially updated: ${counts.new} new and ${counts.old} old of ${total} planned targets.`;
}

function recoveryRemoteClassification({ status, counts, total }) {
  const allTargetsAccountedFor = counts.old + counts.new + counts.blockedUnknown === total;
  if (status === 'fully-updated-remote') {
    return {
      state: 'new-remote',
      status,
      evidence: 'hash-only-before-after-target-envelope',
      allTargetsAccountedFor,
    };
  }
  if (status === 'old-remote') {
    return {
      state: 'old-remote',
      status,
      evidence: 'hash-only-before-after-target-envelope',
      allTargetsAccountedFor,
    };
  }
  return {
    state: 'blocked-recovery',
    status,
    evidence: 'hash-only-before-after-target-envelope',
    allTargetsAccountedFor,
  };
}

export function classifyRemoteRecoveryState({ status, counts, total, persisted } = {}) {
  const normalizedCounts = {
    old: integerOrZero(counts?.old),
    new: integerOrZero(counts?.new),
    blockedUnknown: integerOrZero(counts?.blockedUnknown),
    total: Number.isInteger(total) ? total : integerOrZero(counts?.total),
  };
  const journalState = persisted?.integrity?.status || 'unknown';
  const storage = persisted?.storage || 'filesystem';
  const allTargetsClassified = normalizedCounts.blockedUnknown === 0
    && normalizedCounts.old + normalizedCounts.new === normalizedCounts.total;

  if (
    status === 'fully-updated-remote'
    && normalizedCounts.total > 0
    && normalizedCounts.new === normalizedCounts.total
    && allTargetsClassified
  ) {
    return {
      kind: 'new-remote',
      state: 'fully-updated-remote',
      proved: journalState === 'ok',
      replaySafe: journalState === 'ok',
      counts: normalizedCounts,
      journalState,
      storage,
    };
  }

  if (
    status === 'old-remote'
    && normalizedCounts.total > 0
    && normalizedCounts.old === normalizedCounts.total
    && allTargetsClassified
  ) {
    return {
      kind: 'old-remote',
      state: 'old-remote',
      proved: journalState === 'ok',
      replaySafe: journalState === 'ok',
      counts: normalizedCounts,
      journalState,
      storage,
    };
  }

  return {
    kind: 'blocked-recovery',
    state: 'blocked-recovery',
    proved: false,
    replaySafe: false,
    counts: normalizedCounts,
    journalState,
    storage,
  };
}

function withIntegrityErrors(persisted, errors) {
  return {
    ...persisted,
    integrity: {
      status: 'blocked',
      reason: 'Recovery journal target metadata is inconsistent.',
      errors,
    },
  };
}

function integerOrZero(value) {
  return Number.isInteger(value) ? value : 0;
}
