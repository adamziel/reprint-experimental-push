import { resourceHash } from './resources.js';
import { readRecoveryJournal } from './recovery-journal.js';

export function inspectRecoveryJournal({ journal, journalPath, plan, current }) {
  const persisted = journal || readRecoveryJournal(journalPath);
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

  return {
    status,
    reason: reasonForStatus(status, counts, targets.length),
    planId: plan.id,
    counts,
    targets,
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
  return {
    status: 'blocked-recovery',
    reason,
    planId: plan.id,
    counts: countTargets(targets),
    targets,
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
