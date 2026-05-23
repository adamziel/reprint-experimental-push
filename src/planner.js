import { ABSENT, deepClone } from './stable-json.js';
import {
  deserializeResourceValue,
  enumerateResources,
  getResource,
  hasPlugin,
  pluginOwnerFor,
  resourceHash,
  serializeResourceValue,
} from './resources.js';

export function createPushPlan({ base, local, remote, now = new Date() }) {
  const plan = {
    schemaVersion: 1,
    id: `plan-${now.toISOString()}`,
    generatedAt: now.toISOString(),
    status: 'ready',
    summary: {
      mutations: 0,
      decisions: 0,
      conflicts: 0,
      blockers: 0,
      atomicGroups: 0,
    },
    mutations: [],
    preconditions: [],
    decisions: [],
    conflicts: [],
    blockers: [],
    atomicGroups: [],
  };

  const resources = enumerateResources(base, local, remote);
  const intents = Array.isArray(local?.pushIntents) ? local.pushIntents : [];
  const intentByResource = mapIntentsByResource(intents);

  for (const resource of resources) {
    const baseValue = getResource(base, resource);
    const localValue = getResource(local, resource);
    const remoteValue = getResource(remote, resource);
    const baseHash = resourceHash(base, resource);
    const localHash = resourceHash(local, resource);
    const remoteHash = resourceHash(remote, resource);
    const owner = pluginOwnerFor(resource, baseValue, localValue, remoteValue);
    const change = changeEvidence(
      resource,
      baseValue,
      localValue,
      remoteValue,
      baseHash,
      localHash,
      remoteHash,
    );

    if (localHash === baseHash && remoteHash === baseHash) {
      continue;
    }

    if (localHash === baseHash && remoteHash !== baseHash) {
      plan.decisions.push({
        id: `decision-${plan.decisions.length + 1}`,
        resource,
        resourceKey: resource.key,
        decision: 'keep-remote',
        reason: 'Remote changed after the pull base; local did not change this resource.',
        baseHash,
        remoteHash,
        change,
      });
      continue;
    }

    if (localHash !== baseHash && remoteHash === baseHash) {
      const mutation = {
        id: `mutation-${plan.mutations.length + 1}`,
        resource,
        resourceKey: resource.key,
        action: localValue === ABSENT ? 'delete' : 'put',
        value: serializeResourceValue(localValue),
        remoteBeforeHash: remoteHash,
        baseHash,
        localHash,
        changeKind: change.localChange,
        change,
        atomicGroupId: intentByResource.get(resource.key) || null,
      };
      plan.mutations.push(mutation);
      plan.preconditions.push({
        mutationId: mutation.id,
        resource,
        resourceKey: resource.key,
        expectedHash: remoteHash,
        checkedAgainst: 'live-remote',
      });
      continue;
    }

    if (localHash === remoteHash) {
      plan.decisions.push({
        id: `decision-${plan.decisions.length + 1}`,
        resource,
        resourceKey: resource.key,
        decision: 'already-in-sync',
        reason: 'Local and remote independently reached the same content.',
        baseHash,
        localHash,
        change,
      });
      continue;
    }

    addConflict(plan, {
      resource,
      reason: 'Local and remote both changed this resource after the pull base.',
      resolutionPolicy: 'preserve-remote-and-stop',
      baseValue,
      localValue,
      remoteValue,
      baseHash,
      localHash,
      remoteHash,
      owner,
    });
  }

  addFileTopologyConflicts(plan, resources, base, local, remote);
  plan.atomicGroups = intents.map((intent) => buildAtomicGroup(intent, plan, remote));
  plan.blockers.push(...plan.atomicGroups.flatMap((group) => group.blockers));
  enforceMutationPreconditionInvariant(plan);

  plan.summary.mutations = plan.mutations.length;
  plan.summary.decisions = plan.decisions.length;
  plan.summary.conflicts = plan.conflicts.length;
  plan.summary.blockers = plan.blockers.length;
  plan.summary.atomicGroups = plan.atomicGroups.length;
  plan.status = plan.conflicts.length > 0
    ? 'conflict'
    : plan.blockers.length > 0
      ? 'blocked'
      : 'ready';

  return plan;
}

function mapIntentsByResource(intents) {
  const map = new Map();
  for (const intent of intents) {
    for (const resourceKey of intent.resources || []) {
      map.set(resourceKey, intent.id);
    }
  }
  return map;
}

function buildAtomicGroup(intent, plan, remote) {
  const mutationIds = plan.mutations
    .filter((mutation) => mutation.atomicGroupId === intent.id)
    .map((mutation) => mutation.id);
  const conflicts = plan.conflicts
    .filter((conflict) => (intent.resources || []).includes(conflict.resourceKey))
    .map((conflict) => conflict.id);
  const blockers = [];
  const requiredPlugins = intent.dependencies?.plugins || [];

  for (const plugin of requiredPlugins) {
    if (!willHavePlugin(plugin, plan, remote)) {
      blockers.push({
        id: `blocker-${intent.id}-${plugin}`,
        class: 'missing-plugin-dependency',
        groupId: intent.id,
        plugin,
        reason: `Atomic push intent ${intent.id} requires plugin ${plugin}.`,
      });
    }
  }

  return {
    id: intent.id,
    kind: intent.kind || 'change-set',
    label: intent.label || intent.id,
    requireAtomic: intent.requireAtomic !== false,
    resources: [...(intent.resources || [])],
    mutationIds,
    conflicts,
    dependencies: deepClone(intent.dependencies || {}),
    status: conflicts.length > 0 ? 'conflict' : blockers.length > 0 ? 'blocked' : 'ready',
    blockers,
  };
}

function willHavePlugin(plugin, plan, remote) {
  const pluginResourceKey = `plugin:${plugin}`;
  const mutation = plan.mutations.find((entry) => entry.resourceKey === pluginResourceKey);
  if (mutation) {
    return deserializeResourceValue(mutation.value) !== ABSENT;
  }
  return hasPlugin(remote, plugin);
}

function conflictClass(resource, owner) {
  if (owner && resource.type !== 'plugin') {
    return 'plugin-data-conflict';
  }
  if (resource.type === 'file') {
    return 'file-conflict';
  }
  if (resource.type === 'plugin') {
    return 'plugin-conflict';
  }
  return 'row-conflict';
}

function addConflict(plan, {
  resource,
  reason,
  resolutionPolicy,
  baseValue,
  localValue,
  remoteValue,
  baseHash,
  localHash,
  remoteHash,
  owner,
  className = conflictClass(resource, owner),
  relatedResource = null,
  relatedChange = null,
}) {
  plan.conflicts.push({
    id: `conflict-${plan.conflicts.length + 1}`,
    resource,
    resourceKey: resource.key,
    class: className,
    pluginOwner: owner,
    reason,
    resolutionPolicy,
    baseHash,
    localHash,
    remoteHash,
    change: changeEvidence(
      resource,
      baseValue,
      localValue,
      remoteValue,
      baseHash,
      localHash,
      remoteHash,
    ),
    relatedResource,
    relatedResourceKey: relatedResource?.key,
    relatedChange,
  });
}

function addFileTopologyConflicts(plan, resources, base, local, remote) {
  const fileResources = resources.filter((resource) => resource.type === 'file');
  const mutationByKey = new Map(plan.mutations.map((mutation) => [mutation.resourceKey, mutation]));
  const added = new Set();

  for (const mutation of plan.mutations) {
    if (mutation.resource.type !== 'file') {
      continue;
    }

    const mutationAfter = deserializeResourceValue(mutation.value);
    const mutationAfterType = fileValueType(mutationAfter);

    for (const other of fileResources) {
      if (other.key === mutation.resourceKey) {
        continue;
      }

      const remoteValue = getResource(remote, other);
      if (remoteValue === ABSENT) {
        continue;
      }

      if (isAncestorPath(mutation.resource.path, other.path)) {
        if (
          mutationAfter !== ABSENT
          && mutationAfterType !== 'directory'
          && shouldStopForDescendant(mutationByKey, other, base, remote)
        ) {
          addTopologyConflict(
            plan,
            added,
            'descendant-hidden',
            mutation.resource,
            other,
            base,
            local,
            remote,
            'Local file type change would hide or remove a live remote descendant.',
          );
        }
        continue;
      }

      if (isAncestorPath(other.path, mutation.resource.path)) {
        const ancestorMutation = mutationByKey.get(other.key);
        const ancestorAfter = ancestorMutation
          ? deserializeResourceValue(ancestorMutation.value)
          : remoteValue;
        if (
          ancestorAfter !== ABSENT
          && fileValueType(ancestorAfter) !== 'directory'
          && shouldStopForAncestor(ancestorMutation, other, base, remote)
        ) {
          addTopologyConflict(
            plan,
            added,
            'ancestor-blocks-descendant',
            mutation.resource,
            other,
            base,
            local,
            remote,
            'Local descendant change would require overwriting a live remote ancestor.',
          );
        }
      }
    }
  }
}

function shouldStopForDescendant(mutationByKey, descendant, base, remote) {
  const descendantMutation = mutationByKey.get(descendant.key);
  if (
    descendantMutation?.action === 'delete'
    && resourceHash(remote, descendant) === resourceHash(base, descendant)
  ) {
    return false;
  }
  return true;
}

function shouldStopForAncestor(ancestorMutation, ancestor, base, remote) {
  if (ancestorMutation && resourceHash(remote, ancestor) === resourceHash(base, ancestor)) {
    return false;
  }
  return true;
}

function addTopologyConflict(plan, added, mode, resource, relatedResource, base, local, remote, reason) {
  const key = `${mode}:${resource.key}:${relatedResource.key}`;
  if (added.has(key)) {
    return;
  }
  added.add(key);

  const baseValue = getResource(base, resource);
  const localValue = getResource(local, resource);
  const remoteValue = getResource(remote, resource);
  const relatedBaseValue = getResource(base, relatedResource);
  const relatedLocalValue = getResource(local, relatedResource);
  const relatedRemoteValue = getResource(remote, relatedResource);
  const owner = pluginOwnerFor(resource, baseValue, localValue, remoteValue);

  addConflict(plan, {
    resource,
    reason,
    resolutionPolicy: 'preserve-remote-file-topology-and-stop',
    baseValue,
    localValue,
    remoteValue,
    baseHash: resourceHash(base, resource),
    localHash: resourceHash(local, resource),
    remoteHash: resourceHash(remote, resource),
    owner,
    className: 'file-topology-conflict',
    relatedResource,
    relatedChange: changeEvidence(
      relatedResource,
      relatedBaseValue,
      relatedLocalValue,
      relatedRemoteValue,
      resourceHash(base, relatedResource),
      resourceHash(local, relatedResource),
      resourceHash(remote, relatedResource),
    ),
  });
}

function enforceMutationPreconditionInvariant(plan) {
  const preconditionsByMutation = new Map();
  for (const precondition of plan.preconditions) {
    preconditionsByMutation.set(precondition.mutationId, precondition);
  }

  for (const mutation of plan.mutations) {
    const precondition = preconditionsByMutation.get(mutation.id);
    if (
      !precondition
      || precondition.resourceKey !== mutation.resourceKey
      || precondition.expectedHash !== mutation.remoteBeforeHash
      || precondition.checkedAgainst !== 'live-remote'
    ) {
      plan.blockers.push({
        id: `blocker-${mutation.id}-missing-live-remote-precondition`,
        class: 'planner-invariant-violation',
        mutationId: mutation.id,
        resourceKey: mutation.resourceKey,
        reason: 'Mutation is missing a matching live remote precondition.',
      });
    }
  }
}

function changeEvidence(resource, baseValue, localValue, remoteValue, baseHash, localHash, remoteHash) {
  return {
    localChange: changeKind(resource, baseValue, localValue, baseHash, localHash),
    remoteChange: changeKind(resource, baseValue, remoteValue, baseHash, remoteHash),
    base: valueEvidence(resource, baseValue, baseHash),
    local: valueEvidence(resource, localValue, localHash),
    remote: valueEvidence(resource, remoteValue, remoteHash),
  };
}

function changeKind(resource, beforeValue, afterValue, beforeHash, afterHash) {
  if (beforeHash === afterHash) {
    return 'unchanged';
  }
  if (beforeValue === ABSENT && afterValue !== ABSENT) {
    return 'create';
  }
  if (beforeValue !== ABSENT && afterValue === ABSENT) {
    return 'delete';
  }
  if (resource.type === 'file' && fileValueType(beforeValue) !== fileValueType(afterValue)) {
    return 'type-change';
  }
  return 'update';
}

function valueEvidence(resource, value, hash) {
  if (value === ABSENT) {
    return {
      state: 'absent',
      hash,
    };
  }

  const evidence = {
    state: 'present',
    hash,
  };

  if (resource.type === 'file') {
    evidence.fileType = fileValueType(value);
  }

  return evidence;
}

function fileValueType(value) {
  if (value === ABSENT) {
    return 'absent';
  }
  if (value && typeof value === 'object' && typeof value.type === 'string') {
    return value.type;
  }
  return 'file';
}

function isAncestorPath(ancestor, descendant) {
  const ancestorParts = pathParts(ancestor);
  const descendantParts = pathParts(descendant);
  if (ancestorParts.length >= descendantParts.length) {
    return false;
  }
  return ancestorParts.every((part, index) => part === descendantParts[index]);
}

function pathParts(path) {
  return path.split('/').filter(Boolean);
}
