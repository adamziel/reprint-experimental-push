import { deepClone } from './stable-json.js';
import {
  deserializeResourceValue,
  hasPlugin,
  resourceHash,
  setResource,
} from './resources.js';

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

  validatePreconditions(remote, plan);

  const staged = deepClone(remote);
  let appliedMutations = 0;
  for (const mutation of plan.mutations) {
    appliedMutations++;
    setResource(staged, mutation.resource, deserializeResourceValue(mutation.value));
    if (options.failBeforeCommitAtMutation === appliedMutations) {
      throw new PushPlanError(
        'INJECTED_FAILURE_BEFORE_COMMIT',
        `Injected failure after staging mutation ${mutation.id}.`,
        { mutationId: mutation.id },
      );
    }
  }

  validateAtomicGroups(staged, plan);

  return {
    site: staged,
    appliedMutations,
  };
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

