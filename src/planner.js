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
        atomicGroupId: intentByResource.get(resource.key) || null,
      };
      plan.mutations.push(mutation);
      plan.preconditions.push({
        mutationId: mutation.id,
        resource,
        resourceKey: resource.key,
        expectedHash: remoteHash,
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
      });
      continue;
    }

    plan.conflicts.push({
      id: `conflict-${plan.conflicts.length + 1}`,
      resource,
      resourceKey: resource.key,
      class: conflictClass(resource, owner),
      pluginOwner: owner,
      reason: 'Local and remote both changed this resource after the pull base.',
      resolutionPolicy: 'preserve-remote-and-stop',
      baseHash,
      localHash,
      remoteHash,
    });
  }

  plan.atomicGroups = intents.map((intent) => buildAtomicGroup(intent, plan, local, remote));
  plan.blockers.push(...plan.atomicGroups.flatMap((group) => group.blockers));

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

function buildAtomicGroup(intent, plan, local, remote) {
  const mutationIds = plan.mutations
    .filter((mutation) => mutation.atomicGroupId === intent.id)
    .map((mutation) => mutation.id);
  const conflicts = plan.conflicts
    .filter((conflict) => (intent.resources || []).includes(conflict.resourceKey))
    .map((conflict) => conflict.id);
  const blockers = [];
  const requiredPlugins = intent.dependencies?.plugins || [];

  for (const plugin of requiredPlugins) {
    if (!willHavePlugin(plugin, plan, local, remote)) {
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

function willHavePlugin(plugin, plan, local, remote) {
  const pluginResourceKey = `plugin:${plugin}`;
  const mutation = plan.mutations.find((entry) => entry.resourceKey === pluginResourceKey);
  if (mutation) {
    return deserializeResourceValue(mutation.value) !== ABSENT;
  }
  return hasPlugin(remote, plugin) || hasPlugin(local, plugin);
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

