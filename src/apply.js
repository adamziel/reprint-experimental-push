import { deepClone, digest } from './stable-json.js';
import {
  deserializeResourceValue,
  getResource,
  hasPlugin,
  resourceHash,
  serializeResourceValue,
  setResource,
} from './resources.js';

const JOURNAL_SCHEMA_VERSION = 1;

export class PushPlanError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PushPlanError';
    this.code = code;
    this.details = details;
  }
}

export function applyPlan(remote, plan, options = {}) {
  if (plan.status !== 'ready') {
    throw new PushPlanError(
      'PLAN_NOT_READY',
      `Refusing to apply a ${plan.status} plan.`,
      { status: plan.status },
    );
  }

  const hasPreviousJournal = Boolean(options.journal);
  let journal = prepareJournal(remote, plan, options.journal);
  if (journal.status === 'completed') {
    return replayCompletedPlan(remote, plan, journal);
  }
  if (hasPreviousJournal) {
    const observedState = classifyJournalRemote(remote, journal);
    if (observedState.status === 'fully-updated-remote') {
      const completedJournal = completeObservedJournal(journal, plan);
      return {
        site: deepClone(remote),
        appliedMutations: 0,
        journal: completedJournal,
        recoveryState: {
          status: 'fully-updated-remote',
          reason: 'Journal replay observed every planned mutation already present.',
          artifacts: {
            journal: completedJournal,
          },
        },
      };
    }
    if (observedState.status === 'blocked-recovery') {
      throw recoveryBlocked(remote, plan, journal, observedState.reason, {
        driftedResources: observedState.driftedResources,
      });
    }
  }

  validatePreconditions(remote, plan);

  if (options.failBeforeMutation) {
    throw injectedFailure(
      'INJECTED_FAILURE_BEFORE_MUTATION',
      'Injected failure before staging any mutation.',
      remote,
      plan,
      journal,
    );
  }

  const staged = deepClone(remote);
  let stagedMutations = 0;
  for (const mutation of plan.mutations) {
    stagedMutations++;
    setResource(staged, mutation.resource, deserializeResourceValue(mutation.value));
    journal = markJournalEntry(journal, mutation.id, 'staged');
    if (options.failBeforeCommitAtMutation === stagedMutations) {
      throw injectedFailure(
        'INJECTED_FAILURE_BEFORE_COMMIT',
        `Injected failure after staging mutation ${mutation.id}.`,
        remote,
        plan,
        markJournalStatus(journal, 'staging'),
        { mutationId: mutation.id },
      );
    }
  }

  journal = markJournalStatus(journal, 'staged');
  if (options.failAfterStaging) {
    throw injectedFailure(
      'INJECTED_FAILURE_AFTER_STAGING',
      'Injected failure after staging all mutations.',
      remote,
      plan,
      journal,
    );
  }

  validateAtomicGroups(staged, plan);

  journal = markJournalStatus(journal, 'dependencies-validated');
  if (options.failAfterDependencyValidation) {
    throw injectedFailure(
      'INJECTED_FAILURE_AFTER_DEPENDENCY_VALIDATION',
      'Injected failure after dependency validation.',
      remote,
      plan,
      journal,
    );
  }

  const commitResult = commitStagedSite(remote, staged, plan, journal, options);
  if (commitResult.failure) {
    throw commitResult.failure;
  }

  return {
    site: commitResult.site,
    appliedMutations: commitResult.appliedMutations,
    journal: commitResult.journal,
    recoveryState: {
      status: 'fully-updated-remote',
      reason: 'All planned mutations were committed.',
      artifacts: {
        journal: commitResult.journal,
      },
    },
  };
}

function prepareJournal(remote, plan, previousJournal) {
  if (previousJournal) {
    const journal = deepClone(previousJournal);
    if (journal.schemaVersion !== JOURNAL_SCHEMA_VERSION) {
      throw new PushPlanError(
        'JOURNAL_SCHEMA_UNSUPPORTED',
        `Unsupported recovery journal schema ${journal.schemaVersion}.`,
        { journal },
      );
    }
    if (journal.planId !== plan.id) {
      throw new PushPlanError(
        'JOURNAL_PLAN_MISMATCH',
        `Recovery journal ${journal.id} belongs to ${journal.planId}, not ${plan.id}.`,
        { journalId: journal.id, journalPlanId: journal.planId, planId: plan.id },
      );
    }
    return journal;
  }

  return {
    schemaVersion: JOURNAL_SCHEMA_VERSION,
    id: `journal-${plan.id}`,
    planId: plan.id,
    status: 'opened',
    createdAt: plan.generatedAt,
    remoteBeforeHash: digest(remote),
    entries: plan.mutations.map((mutation) => {
      const beforeValue = getResource(remote, mutation.resource);
      const afterValue = deserializeResourceValue(mutation.value);
      return {
        mutationId: mutation.id,
        resource: deepClone(mutation.resource),
        resourceKey: mutation.resourceKey,
        action: mutation.action,
        status: 'pending',
        beforeHash: resourceHash(remote, mutation.resource),
        beforeValue: serializeResourceValue(beforeValue),
        afterHash: digest(afterValue),
        afterValue: deepClone(mutation.value),
      };
    }),
  };
}

function replayCompletedPlan(remote, plan, journal) {
  const drifted = journal.entries.filter(
    (entry) => resourceHash(remote, entry.resource) !== entry.afterHash,
  );

  if (drifted.length > 0) {
    throw recoveryBlocked(
      remote,
      plan,
      journal,
      'Completed journal does not match the current remote state.',
      { driftedResources: drifted.map((entry) => entry.resourceKey) },
    );
  }

  return {
    site: deepClone(remote),
    appliedMutations: 0,
    journal,
    recoveryState: {
      status: 'fully-updated-remote',
      reason: 'Completed plan replayed without reapplying mutations.',
      artifacts: {
        journal,
      },
    },
  };
}

function classifyJournalRemote(remote, journal) {
  const driftedResources = [];
  let oldResources = 0;
  let updatedResources = 0;

  for (const entry of journal.entries) {
    const actualHash = resourceHash(remote, entry.resource);
    if (actualHash === entry.beforeHash) {
      oldResources++;
      continue;
    }
    if (actualHash === entry.afterHash) {
      updatedResources++;
      continue;
    }
    driftedResources.push(entry.resourceKey);
  }

  if (driftedResources.length > 0) {
    return {
      status: 'blocked-recovery',
      reason: 'Journaled resources drifted outside the before/after recovery envelope.',
      driftedResources,
    };
  }

  if (updatedResources === journal.entries.length) {
    return { status: 'fully-updated-remote' };
  }

  if (oldResources === journal.entries.length) {
    return { status: 'old-remote' };
  }

  return {
    status: 'blocked-recovery',
    reason: 'Journaled resources show a partial commit and require recovery inspection.',
    driftedResources: journal.entries.map((entry) => entry.resourceKey),
  };
}

function completeObservedJournal(journal, plan) {
  return {
    ...markJournalStatus(journal, 'completed'),
    completedAt: plan.generatedAt,
    entries: journal.entries.map((entry) => ({ ...entry, status: 'applied' })),
  };
}

function commitStagedSite(remote, staged, plan, journal, options) {
  let committed = options.mutateRemote ? remote : deepClone(remote);
  let committedJournal = markJournalStatus(journal, 'committing');
  let appliedMutations = 0;

  for (const mutation of plan.mutations) {
    appliedMutations++;
    setResource(committed, mutation.resource, deserializeResourceValue(mutation.value));
    committedJournal = markJournalEntry(committedJournal, mutation.id, 'applied');

    if (options.failDuringCommitAtMutation === appliedMutations) {
      const blockedJournal = markJournalStatus(committedJournal, 'blocked');
      return {
        failure: recoveryBlocked(
          committed,
          plan,
          blockedJournal,
          `Injected failure while committing mutation ${mutation.id}.`,
          {
            code: 'INJECTED_FAILURE_DURING_COMMIT',
            mutationId: mutation.id,
          },
        ),
      };
    }
  }

  committed = options.mutateRemote ? committed : staged;
  const completedJournal = {
    ...markJournalStatus(committedJournal, 'completed'),
    completedAt: plan.generatedAt,
  };

  return {
    site: committed,
    appliedMutations,
    journal: completedJournal,
  };
}

function markJournalStatus(journal, status) {
  return {
    ...journal,
    status,
  };
}

function markJournalEntry(journal, mutationId, status) {
  return {
    ...journal,
    entries: journal.entries.map((entry) =>
      entry.mutationId === mutationId
        ? { ...entry, status }
        : entry,
    ),
  };
}

function injectedFailure(code, message, remote, plan, journal, details = {}) {
  return new PushPlanError(
    code,
    message,
    {
      ...details,
      recovery: oldRemoteRecoveryState(remote, plan, journal, message),
    },
  );
}

function oldRemoteRecoveryState(remote, plan, journal, reason) {
  return {
    status: 'old-remote',
    reason,
    remoteHash: digest(remote),
    planId: plan.id,
    artifacts: {
      journal,
    },
  };
}

function recoveryBlocked(remote, plan, journal, reason, details = {}) {
  const code = details.code || 'RECOVERY_BLOCKED';
  return new PushPlanError(
    code,
    reason,
    {
      ...details,
      recovery: {
        status: 'blocked-recovery',
        reason,
        remoteHash: digest(remote),
        planId: plan.id,
        artifacts: {
          journal,
          remote: deepClone(remote),
        },
      },
    },
  );
}

function validatePreconditions(remote, plan) {
  for (const precondition of plan.preconditions || []) {
    const actualHash = resourceHash(remote, precondition.resource);
    if (actualHash !== precondition.expectedHash) {
      throw new PushPlanError(
        'PRECONDITION_FAILED',
        `Remote changed since dry run for ${precondition.resourceKey}.`,
        {
          resourceKey: precondition.resourceKey,
          expectedHash: precondition.expectedHash,
          actualHash,
        },
      );
    }
  }
}

function validateAtomicGroups(staged, plan) {
  for (const group of plan.atomicGroups || []) {
    for (const plugin of group.dependencies?.plugins || []) {
      if (!hasPlugin(staged, plugin)) {
        throw new PushPlanError(
          'ATOMIC_GROUP_DEPENDENCY_MISSING',
          `Atomic group ${group.id} is missing plugin dependency ${plugin}.`,
          { groupId: group.id, plugin },
        );
      }
    }
  }
}
