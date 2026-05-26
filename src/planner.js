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

const SUPPORTED_PLUGIN_DATA_DRIVERS = new Set([
  'wp-option',
  'wp-postmeta',
  'wp-post-meta',
  'wp-termmeta',
  'wp-term-meta',
  'wp-usermeta',
  'wp-user-meta',
  'fixture-forms-lab-table',
]);

const PLUGIN_DATA_DRIVER_TABLES = new Map([
  ['wp-option', 'wp_options'],
  ['wp-postmeta', 'wp_postmeta'],
  ['wp-post-meta', 'wp_postmeta'],
  ['wp-termmeta', 'wp_termmeta'],
  ['wp-term-meta', 'wp_termmeta'],
  ['wp-usermeta', 'wp_usermeta'],
  ['wp-user-meta', 'wp_usermeta'],
]);

const PLUGIN_DATA_DRIVER_TABLE_NAMES = new Set(PLUGIN_DATA_DRIVER_TABLES.values());

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
  const pluginOwnedResourcePolicy = buildPluginOwnedResourcePolicy({
    base,
    local,
    remote,
    intents,
  });

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

    const specialFileSupport = unsupportedSpecialFileResourceSupport({
      resource,
      baseValue,
      localValue,
      remoteValue,
    });
    if (!specialFileSupport.supported) {
      addUnsupportedSpecialFileBlocker(plan, {
        resource,
        support: specialFileSupport,
        baseValue,
        localValue,
        remoteValue,
        baseHash,
        localHash,
        remoteHash,
      });
      continue;
    }

    if (localHash === baseHash && remoteHash === baseHash) {
      continue;
    }

    if (localHash === baseHash && remoteHash !== baseHash) {
      const remoteSerializedBlocksSupport = unsupportedSerializedBlocksSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
      });
      if (!remoteSerializedBlocksSupport.supported) {
        addUnsupportedSerializedBlocksBlocker(plan, {
          resource,
          support: remoteSerializedBlocksSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

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
      if (isPluginContextMutationResource(resource, owner)) {
        const pluginContextSupport = pluginContextMutationSupport({
          resource,
          owner,
          resources,
          base,
          local,
          remote,
        });
        if (!pluginContextSupport.supported) {
          addPluginContextBlocker(plan, {
            resource,
            owner,
            support: pluginContextSupport,
            baseValue,
            localValue,
            remoteValue,
            baseHash,
            localHash,
            remoteHash,
          });
          continue;
        }
      }

      if (isPluginOwnedDataResource(resource, owner)) {
        const support = pluginOwnedResourcePolicy.supportFor(resource, owner);
        if (!support.supported) {
          addPluginOwnedResourceBlocker(plan, {
            resource,
            owner,
            support,
            baseValue,
            localValue,
            remoteValue,
            baseHash,
            localHash,
            remoteHash,
          });
          continue;
        }
        const ownerContextSupport = pluginOwnedOwnerContextSupport({
          resource,
          owner,
          resources,
          base,
          local,
          remote,
          intents,
          intentByResource,
        });
        if (!ownerContextSupport.supported) {
          addPluginOwnedResourceBlocker(plan, {
            resource,
            owner,
            support: ownerContextSupport,
            baseValue,
            localValue,
            remoteValue,
            baseHash,
            localHash,
            remoteHash,
          });
          continue;
        }
        if (localValue === ABSENT && !support.supportsDelete) {
          addPluginOwnedResourceBlocker(plan, {
            resource,
            owner,
            support: {
              ...support,
              supported: false,
              className: 'unsupported-plugin-owned-resource',
              reason: 'Plugin-owned resource driver does not support delete mutations.',
            },
            baseValue,
            localValue,
            remoteValue,
            baseHash,
            localHash,
            remoteHash,
          });
          continue;
        }
      }

      const navigationSupport = unsupportedNavigationResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
      });
      if (!navigationSupport.supported) {
        addUnsupportedNavigationResourceBlocker(plan, {
          resource,
          support: navigationSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const attachmentSupport = unsupportedAttachmentResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
      });
      if (!attachmentSupport.supported) {
        addUnsupportedAttachmentResourceBlocker(plan, {
          resource,
          support: attachmentSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const revisionSupport = unsupportedRevisionResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
      });
      if (!revisionSupport.supported) {
        addUnsupportedRevisionResourceBlocker(plan, {
          resource,
          support: revisionSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const termmetaSupport = unsupportedTermmetaResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
        resources,
        base,
        local,
        remote,
      });
      if (!termmetaSupport.supported) {
        addUnsupportedTermmetaResourceBlocker(plan, {
          resource,
          support: termmetaSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const termTaxonomySupport = unsupportedTermTaxonomyResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
        local,
        remote,
      });
      if (!termTaxonomySupport.supported) {
        addUnsupportedTermTaxonomyResourceBlocker(plan, {
          resource,
          support: termTaxonomySupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const guidSupport = unsupportedGuidResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
      });
      if (!guidSupport.supported) {
        addUnsupportedGuidResourceBlocker(plan, {
          resource,
          support: guidSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const commentsUsersSupport = unsupportedCommentsUsersResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
        resources,
        base,
        local,
        remote,
      });
      if (!commentsUsersSupport.supported) {
        addUnsupportedCommentsUsersResourceBlocker(plan, {
          resource,
          support: commentsUsersSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const usermetaSupport = unsupportedUsermetaResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
        resources,
        base,
        local,
        remote,
      });
      if (!usermetaSupport.supported) {
        addUnsupportedUsermetaResourceBlocker(plan, {
          resource,
          support: usermetaSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const legacyLinksSupport = unsupportedLegacyLinksResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
      });
      if (!legacyLinksSupport.supported) {
        addUnsupportedLegacyLinksResourceBlocker(plan, {
          resource,
          support: legacyLinksSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const serializedBlocksSupport = unsupportedSerializedBlocksSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
      });
      if (!serializedBlocksSupport.supported) {
        addUnsupportedSerializedBlocksBlocker(plan, {
          resource,
          support: serializedBlocksSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const specialFileSupport = unsupportedSpecialFileResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
      });
      if (!specialFileSupport.supported) {
        addUnsupportedSpecialFileBlocker(plan, {
          resource,
          support: specialFileSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const graphIdentitySupport = wordpressGraphIdentitySupport({
        resource,
        localValue,
        resources,
        base,
        local,
        remote,
      });
      if (!graphIdentitySupport.supported) {
        addWordPressGraphIdentityBlocker(plan, {
          resource,
          support: graphIdentitySupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const samePlanCreateSupport = samePlanCreatedGraphIdentitySupport({
        resource,
        resources,
        base,
        local,
        remote,
      });
      if (!samePlanCreateSupport.supported) {
        addWordPressGraphIdentityBlocker(plan, {
          resource,
          support: samePlanCreateSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

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
      if (isPluginOwnedDataResource(resource, owner)) {
        const support = pluginOwnedResourcePolicy.supportFor(resource, owner);
        mutation.pluginOwnedResource = {
          pluginOwner: owner,
          driver: support.driver,
          policySource: support.policySource,
          supportsDelete: support.supportsDelete,
          driverEvidence: support.driverEvidence,
        };
      }
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
      if (isPluginOwnedDataResource(resource, owner)) {
        const support = pluginOwnedResourcePolicy.supportFor(resource, owner);
        if (!support.supported) {
          addPluginOwnedResourceBlocker(plan, {
            resource,
            owner,
            support,
            baseValue,
            localValue,
            remoteValue,
            baseHash,
            localHash,
            remoteHash,
          });
          continue;
        }
      }
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
  plan.atomicGroups = intents.map((intent) => buildAtomicGroup(intent, plan, base, remote));
  const existingBlockerIds = new Set(plan.blockers.map((blocker) => blocker.id));
  for (const blocker of plan.atomicGroups.flatMap((group) => group.blockers)) {
    if (!existingBlockerIds.has(blocker.id)) {
      existingBlockerIds.add(blocker.id);
      plan.blockers.push(blocker);
    }
  }
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

function buildPluginOwnedResourcePolicy({ base, local, remote, intents }) {
  const entries = [
    ...pluginOwnedPolicyEntriesFromSnapshot(base, 'base-snapshot'),
    ...pluginOwnedPolicyEntriesFromSnapshot(local, 'local-snapshot'),
    ...pluginOwnedPolicyEntriesFromSnapshot(remote, 'remote-snapshot'),
    ...intents.flatMap((intent) => pluginOwnedPolicyEntriesFromIntent(intent)),
  ];

  return {
    supportFor(resource, owner) {
      const candidates = entries.filter((entry) =>
        entry.resourceKey === resource.key && entry.pluginOwner === owner);

      if (candidates.length === 0) {
        return {
          supported: false,
          className: 'unsupported-plugin-owned-resource',
        };
      }

      const withDriver = candidates.find((entry) => entry.driver);
      if (!withDriver) {
        return {
          supported: false,
          className: 'missing-plugin-driver',
          policySource: candidates[0].source,
        };
      }

      const distinctDrivers = new Set(candidates.filter((entry) => entry.driver).map((entry) => entry.driver));
      if (distinctDrivers.size > 1) {
        return {
          supported: false,
          className: 'unsupported-plugin-owned-resource',
          resourceKind: 'custom-table',
          driver: withDriver.driver,
          policySource: withDriver.source,
          reason: 'Plugin-owned resource has conflicting driver metadata and cannot be applied safely.',
        };
      }

      const supported = candidates.find((entry) =>
        SUPPORTED_PLUGIN_DATA_DRIVERS.has(entry.driver)
        && pluginOwnedPolicyEntryMatchesResource(entry, resource, owner));
      if (!supported) {
        const supportedDriverTable = PLUGIN_DATA_DRIVER_TABLES.get(withDriver.driver);
        const unsupportedCustomTable = resource.type === 'row'
          && typeof resource.table === 'string'
          && resource.table !== supportedDriverTable
          && !PLUGIN_DATA_DRIVER_TABLE_NAMES.has(resource.table);
        return {
          supported: false,
          className: 'unsupported-plugin-owned-resource',
          resourceKind: unsupportedCustomTable ? 'custom-table' : 'row',
          driver: withDriver.driver,
          policySource: withDriver.source,
          reason: unsupportedCustomTable
            ? 'Plugin-owned custom tables are not yet supported by the planner.'
            : 'Plugin-owned resource driver does not match the resource type or table.',
        };
      }

      if (supported.driver === 'fixture-forms-lab-table') {
        const driverEvidence = fixtureFormsLabTableDriverEvidence({
          resource,
          owner,
          base,
          local,
          remote,
        });
        if (!driverEvidence.supported) {
          return {
            supported: false,
            className: 'unsupported-plugin-owned-resource',
            driver: supported.driver,
            policySource: supported.source,
            reason: driverEvidence.reason,
          };
        }
        return {
          supported: true,
          driver: supported.driver,
          policySource: supported.source,
          supportsDelete: false,
          driverEvidence,
        };
      }

      return {
        supported: true,
        driver: supported.driver,
        policySource: supported.source,
        supportsDelete: supported.supportsDelete === true,
      };
    },
  };
}

function pluginOwnedPolicyEntriesFromSnapshot(snapshot, source) {
  return normalizePluginOwnedPolicy(snapshot?.meta?.pushPolicy, source)
    .concat(normalizePluginOwnedPolicy(snapshot?.meta?.resourcePolicy, source))
    .concat(normalizePluginOwnedPolicy(snapshot?.meta?.pluginOwnedResources, source));
}

function pluginOwnedPolicyEntriesFromIntent(intent) {
  const source = `push-intent:${intent.id || 'unlabeled'}`;
  return normalizePluginOwnedPolicy(intent.resourcePolicy, source)
    .concat(normalizePluginOwnedPolicy(intent.pushPolicy, source))
    .concat(normalizePluginOwnedPolicy(intent.pluginOwnedResources, source));
}

function normalizePluginOwnedPolicy(policy, source) {
  if (!policy || typeof policy !== 'object') {
    return [];
  }

  const pluginOwnedResources = policy.pluginOwnedResources || policy;
  const allowedResources = normalizeAllowedResources(
    pluginOwnedResources.allowedResources
      || pluginOwnedResources.allowed
      || pluginOwnedResources.resources,
  );

  return allowedResources
    .map((entry) => normalizePluginOwnedPolicyEntry(entry, source))
    .filter((entry) => entry.resourceKey && entry.pluginOwner);
}

function normalizeAllowedResources(allowedResources) {
  if (Array.isArray(allowedResources)) {
    return allowedResources;
  }
  if (!allowedResources || typeof allowedResources !== 'object') {
    return [];
  }
  return Object.entries(allowedResources).map(([resourceKey, entry]) => ({
    ...(entry && typeof entry === 'object' ? entry : {}),
    resourceKey,
  }));
}

function normalizePluginOwnedPolicyEntry(entry, source) {
  if (typeof entry === 'string') {
    return { resourceKey: entry, source };
  }
  if (!entry || typeof entry !== 'object') {
    return { source };
  }
  return {
    resourceKey: entry.resourceKey || entry.key || entry.resource?.key || null,
    pluginOwner: entry.pluginOwner || entry.owner || entry.plugin || null,
    driver: entry.driver || entry.supportedDriver || entry.resourceDriver || null,
    supportsDelete: entry.supportsDelete === true || entry.delete === true || entry.allowDelete === true,
    source,
  };
}

function pluginOwnedPolicyEntryMatchesResource(entry, resource, owner) {
  if (entry.pluginOwner !== owner) {
    return false;
  }

  if (entry.driver !== 'fixture-forms-lab-table') {
    const expectedTable = PLUGIN_DATA_DRIVER_TABLES.get(entry.driver);
    return resource.type === 'row' && resource.table === expectedTable;
  }

  return resource.type === 'row'
    && resource.table === 'wp_reprint_push_forms_lab'
    && /^id:\d+$/.test(resource.id)
    && owner === 'forms'
    && entry.pluginOwner === 'forms';
}

function fixtureFormsLabTableDriverEvidence({ resource, owner, base, remote }) {
  if (
    resource.type !== 'row'
    || resource.table !== 'wp_reprint_push_forms_lab'
    || !/^id:[1-9]\d*$/.test(resource.id)
    || owner !== 'forms'
  ) {
    return { supported: false, reason: 'Fixture forms lab table driver only supports positive id rows owned by forms.' };
  }

  const plugin = 'reprint-push-forms-fixture';
  const pluginResource = { type: 'plugin', name: plugin, key: `plugin:${plugin}` };
  const basePlugin = getResource(base, pluginResource);
  const remotePlugin = getResource(remote, pluginResource);
  const baseHash = resourceHash(base, pluginResource);
  const remoteHash = resourceHash(remote, pluginResource);
  if (
    basePlugin !== ABSENT
    && remotePlugin !== ABSENT
    && basePlugin?.active === true
    && remotePlugin?.active === true
    && baseHash === remoteHash
  ) {
    return {
      supported: true,
      source: 'live-remote',
      plugin,
      resourceKey: pluginResource.key,
      baseHash,
      remoteHash,
    };
  }

  return {
    supported: false,
    reason: 'Fixture forms lab table driver requires unchanged active reprint-push-forms-fixture evidence.',
  };
}

function buildAtomicGroup(intent, plan, base, remote) {
  const groupResourceKeys = new Set(intent.resources || []);
  const mutationIds = plan.mutations
    .filter((mutation) => mutation.atomicGroupId === intent.id)
    .map((mutation) => mutation.id);
  const conflicts = plan.conflicts
    .filter((conflict) => (intent.resources || []).includes(conflict.resourceKey))
    .map((conflict) => conflict.id);
  const blockers = plan.blockers.filter((blocker) => groupResourceKeys.has(blocker.resourceKey));
  const requiredPlugins = normalizePluginDependencies(intent.dependencies?.plugins || []);

  requiredPlugins.forEach((dependency, index) => {
    blockers.push(...evaluatePluginDependency({
      dependency,
      dependencyIndex: index,
      intent,
      groupResourceKeys,
      plan,
      base,
      remote,
    }));
  });

  if (requiredPlugins.some((dependency) => !dependency.name)) {
    blockers.push({
      id: `blocker-${intent.id}-invalid-plugin-dependency`,
      class: 'invalid-plugin-dependency-metadata',
      groupId: intent.id,
      reason: `Atomic push intent ${intent.id} declares a plugin dependency without a plugin name.`,
    });
  }

  return {
    id: intent.id,
    kind: intent.kind || 'change-set',
    label: intent.label || intent.id,
    requireAtomic: intent.requireAtomic !== false,
    resources: [...(intent.resources || [])],
    mutationIds,
    conflicts,
    dependencies: normalizeGroupDependencies(intent.dependencies || {}, requiredPlugins),
    dependencyRequirements: requiredPlugins.map((dependency) => ({
      plugin: dependency.name,
      expectedVersion: dependency.expectedVersion,
      versionRange: dependency.versionRange,
      expectedHash: dependency.expectedHash,
      active: dependency.active,
      ...pluginDependencyEvidence(dependency, intent, plan, base, remote),
    })),
    status: conflicts.length > 0 ? 'conflict' : blockers.length > 0 ? 'blocked' : 'ready',
    blockers,
  };
}

function pluginDependencyEvidence(dependency, intent, plan, base, remote) {
  if (!dependency.name) {
    return { source: 'invalid' };
  }

  const plugin = dependency.name;
  const pluginResource = { type: 'plugin', name: plugin, key: `plugin:${plugin}` };
  const sameGroupMutation = plan.mutations.find((mutation) =>
    mutation.resourceKey === pluginResource.key && mutation.atomicGroupId === intent.id);
  if (sameGroupMutation) {
    const plannedValue = deserializeResourceValue(sameGroupMutation.value);
    return {
      source: 'same-atomic-group',
      mutationId: sameGroupMutation.id,
      resourceKey: pluginResource.key,
      plannedHash: plannedValue === ABSENT ? resourceHash({ plugins: {} }, pluginResource) : digestPluginValue(plannedValue),
    };
  }

  if (!hasPlugin(remote, plugin)) {
    return {
      source: 'missing-live-remote',
      resourceKey: pluginResource.key,
    };
  }

  return {
    source: 'live-remote',
    resourceKey: pluginResource.key,
    baseHash: resourceHash(base, pluginResource),
    remoteHash: resourceHash(remote, pluginResource),
  };
}

function normalizeGroupDependencies(dependencies, requiredPlugins) {
  return {
    plugins: requiredPlugins
      .map((dependency) => dependency.name)
      .filter(Boolean),
  };
}

function normalizePluginDependencies(dependencies) {
  return dependencies.map((dependency) => {
    if (typeof dependency === 'string') {
      return { name: dependency };
    }
    if (!dependency || typeof dependency !== 'object') {
      return { name: null, raw: dependency };
    }
    const version = dependency.version ?? null;
    const requiredVersion = dependency.requiredVersion ?? null;
    return {
      name: dependency.name || dependency.slug || dependency.plugin || null,
      expectedVersion: dependency.expectedVersion
        ?? dependency.exactVersion
        ?? (typeof version === 'string' && !looksLikeVersionRange(version) ? version : null)
        ?? (typeof requiredVersion === 'string' && !looksLikeVersionRange(requiredVersion)
          ? requiredVersion
          : null),
      versionRange: dependency.versionRange
        ?? dependency.range
        ?? (typeof version === 'string' && looksLikeVersionRange(version) ? version : null)
        ?? (typeof requiredVersion === 'string' && looksLikeVersionRange(requiredVersion)
          ? requiredVersion
          : null),
      expectedHash: dependency.expectedHash ?? dependency.hash ?? dependency.resourceHash ?? null,
      active: typeof dependency.active === 'boolean' ? dependency.active : null,
      raw: deepClone(dependency),
    };
  });
}

function evaluatePluginDependency({
  dependency,
  dependencyIndex,
  intent,
  groupResourceKeys,
  plan,
  base,
  remote,
}) {
  if (!dependency.name) {
    return [];
  }

  const blockers = [];
  const plugin = dependency.name;
  const pluginResource = { type: 'plugin', name: plugin, key: `plugin:${plugin}` };
  const sameGroupMutation = plan.mutations.find((mutation) =>
    mutation.resourceKey === pluginResource.key && mutation.atomicGroupId === intent.id);
  const outsideGroupMutation = plan.mutations.find((mutation) =>
    mutation.resourceKey === pluginResource.key && mutation.atomicGroupId !== intent.id);
  const dependencyConflict = plan.conflicts.find((conflict) =>
    conflict.resourceKey === pluginResource.key);

  if (dependencyConflict && !groupResourceKeys.has(pluginResource.key)) {
    blockers.push(pluginDependencyBlocker({
      intent,
      dependency,
      dependencyIndex,
      className: 'conflicting-plugin-dependency',
      reason: `Atomic push intent ${intent.id} depends on plugin ${plugin}, but that dependency already has a conflict.`,
      extra: { conflictId: dependencyConflict.id },
    }));
    return blockers;
  }

  if (sameGroupMutation) {
    const plannedValue = deserializeResourceValue(sameGroupMutation.value);
    if (plannedValue === ABSENT) {
      blockers.push(pluginDependencyBlocker({
        intent,
        dependency,
        dependencyIndex,
        className: 'missing-plugin-dependency',
        reason: `Atomic push intent ${intent.id} would remove required plugin ${plugin}.`,
      }));
      return blockers;
    }
    blockers.push(...validatePluginDependencyValue({
      dependency,
      dependencyIndex,
      intent,
      value: plannedValue,
      hash: digestPluginValue(plannedValue),
      source: 'same-atomic-group',
    }));
    return blockers;
  }

  if (outsideGroupMutation) {
    blockers.push(pluginDependencyBlocker({
      intent,
      dependency,
      dependencyIndex,
      className: 'plugin-dependency-outside-atomic-group',
      reason: `Atomic push intent ${intent.id} depends on plugin ${plugin}, but its planned mutation is outside this atomic group.`,
      extra: { mutationId: outsideGroupMutation.id },
    }));
    return blockers;
  }

  if (!hasPlugin(remote, plugin)) {
    blockers.push(pluginDependencyBlocker({
      intent,
      dependency,
      dependencyIndex,
      className: 'missing-plugin-dependency',
      reason: `Atomic push intent ${intent.id} requires plugin ${plugin}, but it is absent from the live remote.`,
    }));
    return blockers;
  }

  const baseHash = resourceHash(base, pluginResource);
  const remoteHash = resourceHash(remote, pluginResource);
  if (baseHash !== remoteHash) {
    blockers.push(pluginDependencyBlocker({
      intent,
      dependency,
      dependencyIndex,
      className: 'remote-plugin-dependency-drift',
      reason: `Atomic push intent ${intent.id} depends on plugin ${plugin}, but the live remote dependency changed since the pull base.`,
      extra: {
        baseHash,
        remoteHash,
      },
    }));
    return blockers;
  }

  blockers.push(...validatePluginDependencyValue({
    dependency,
    dependencyIndex,
    intent,
    value: getResource(remote, pluginResource),
    hash: remoteHash,
    source: 'live-remote',
  }));

  return blockers;
}

function validatePluginDependencyValue({ dependency, dependencyIndex, intent, value, hash, source }) {
  const blockers = [];
  const plugin = dependency.name;

  if (dependency.expectedHash && dependency.expectedHash !== hash) {
    blockers.push(pluginDependencyBlocker({
      intent,
      dependency,
      dependencyIndex,
      className: 'plugin-dependency-hash-mismatch',
      reason: `Atomic push intent ${intent.id} requires plugin ${plugin} at hash ${dependency.expectedHash}, but ${source} has ${hash}.`,
      extra: { expectedHash: dependency.expectedHash, actualHash: hash, source },
    }));
  }

  const actualVersion = value?.version;
  if ((dependency.expectedVersion || dependency.versionRange) && typeof actualVersion !== 'string') {
    blockers.push(pluginDependencyBlocker({
      intent,
      dependency,
      dependencyIndex,
      className: 'plugin-dependency-version-missing',
      reason: `Atomic push intent ${intent.id} requires a versioned plugin dependency ${plugin}, but ${source} has no version metadata.`,
      extra: { source },
    }));
    return blockers;
  }

  if (dependency.expectedVersion && actualVersion !== dependency.expectedVersion) {
    blockers.push(pluginDependencyBlocker({
      intent,
      dependency,
      dependencyIndex,
      className: 'incompatible-plugin-dependency-version',
      reason: `Atomic push intent ${intent.id} requires plugin ${plugin} version ${dependency.expectedVersion}, but ${source} has ${actualVersion}.`,
      extra: { expectedVersion: dependency.expectedVersion, actualVersion, source },
    }));
  }

  if (dependency.versionRange) {
    const rangeResult = satisfiesVersionRange(actualVersion, dependency.versionRange);
    if (rangeResult.unsupported) {
      blockers.push(pluginDependencyBlocker({
        intent,
        dependency,
        dependencyIndex,
        className: 'unsupported-plugin-dependency-version-range',
        reason: `Atomic push intent ${intent.id} declares unsupported version range ${dependency.versionRange} for plugin ${plugin}.`,
        extra: { versionRange: dependency.versionRange, actualVersion, source },
      }));
    } else if (!rangeResult.satisfied) {
      blockers.push(pluginDependencyBlocker({
        intent,
        dependency,
        dependencyIndex,
        className: 'incompatible-plugin-dependency-version-range',
        reason: `Atomic push intent ${intent.id} requires plugin ${plugin} version ${dependency.versionRange}, but ${source} has ${actualVersion}.`,
        extra: { versionRange: dependency.versionRange, actualVersion, source },
      }));
    }
  }

  if (dependency.active != null && Boolean(value?.active) !== dependency.active) {
    blockers.push(pluginDependencyBlocker({
      intent,
      dependency,
      dependencyIndex,
      className: 'incompatible-plugin-dependency-activation',
      reason: `Atomic push intent ${intent.id} requires plugin ${plugin} active=${dependency.active}, but ${source} has active=${Boolean(value?.active)}.`,
      extra: { expectedActive: dependency.active, actualActive: Boolean(value?.active), source },
    }));
  }

  return blockers;
}

function pluginDependencyBlocker({
  intent,
  dependency,
  dependencyIndex,
  className,
  reason,
  extra = {},
}) {
  return {
    id: `blocker-${intent.id}-${dependency.name || 'plugin'}-${dependencyIndex}`,
    class: className,
    groupId: intent.id,
    plugin: dependency.name,
    dependencyIndex,
    dependency: pluginDependencyAuditEvidence(dependency),
    reason,
    ...extra,
  };
}

function pluginDependencyAuditEvidence(dependency) {
  const evidence = {
    plugin: dependency.name || null,
  };

  if (dependency.expectedVersion) {
    evidence.expectedVersion = dependency.expectedVersion;
  }
  if (dependency.versionRange) {
    evidence.versionRange = dependency.versionRange;
  }
  if (dependency.expectedHash) {
    evidence.expectedHash = dependency.expectedHash;
  }
  if (typeof dependency.active === 'boolean') {
    evidence.active = dependency.active;
  }

  return evidence;
}

function digestPluginValue(value) {
  return resourceHash({ plugins: { __dependency__: value } }, {
    type: 'plugin',
    name: '__dependency__',
    key: 'plugin:__dependency__',
  });
}

function looksLikeVersionRange(version) {
  return /[<>=~^* ]/.test(version);
}

function satisfiesVersionRange(version, range) {
  const comparators = String(range).trim().split(/\s+/).filter(Boolean);
  if (comparators.length === 0) {
    return { supported: false, unsupported: true, satisfied: false };
  }

  for (const comparator of comparators) {
    const match = comparator.match(/^(>=|>|<=|<|=)?(.+)$/);
    if (!match) {
      return { supported: false, unsupported: true, satisfied: false };
    }
    const operator = match[1] || '=';
    const expected = match[2];
    const comparison = compareVersions(version, expected);
    if (comparison === null || !comparatorSatisfied(comparison, operator)) {
      return comparison === null
        ? { supported: false, unsupported: true, satisfied: false }
        : { supported: true, unsupported: false, satisfied: false };
    }
  }

  return { supported: true, unsupported: false, satisfied: true };
}

function comparatorSatisfied(comparison, operator) {
  if (operator === '>') {
    return comparison > 0;
  }
  if (operator === '>=') {
    return comparison >= 0;
  }
  if (operator === '<') {
    return comparison < 0;
  }
  if (operator === '<=') {
    return comparison <= 0;
  }
  return comparison === 0;
}

function compareVersions(left, right) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  if (!leftParts || !rightParts) {
    return null;
  }
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index++) {
    const leftPart = leftParts[index] || 0;
    const rightPart = rightParts[index] || 0;
    if (leftPart !== rightPart) {
      return leftPart > rightPart ? 1 : -1;
    }
  }
  return 0;
}

function parseVersion(version) {
  const normalized = String(version).replace(/^v/i, '');
  if (!/^\d+(\.\d+)*$/.test(normalized)) {
    return null;
  }
  return normalized.split('.').map((part) => Number.parseInt(part, 10));
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

function isPluginOwnedDataResource(resource, owner) {
  return resource.type === 'row' && Boolean(owner);
}

const WORDPRESS_GRAPH_TABLE_SUFFIXES = [
  'comments',
  'term_relationships',
  'term_taxonomy',
  'postmeta',
  'termmeta',
  'usermeta',
  'posts',
  'terms',
  'users',
];

function wordpressGraphIdentitySupport({
  resource,
  localValue,
  resources,
  base,
  local,
  remote,
}) {
  if (resource.type !== 'row' || localValue === ABSENT) {
    return { supported: true };
  }

  const references = wordpressGraphReferences(resource, localValue);
  if (references.length === 0) {
    return { supported: true };
  }

  const referenceEvidence = references.map((reference) =>
    wordpressGraphReferenceEvidence(reference, resources, base, local, remote));
  if (resource.table === 'wp_termmeta') {
    const samePlanCreatedTermReferences = referenceEvidence
      .filter((reference) =>
        reference.relationshipType === 'termmeta-term'
        && reference.targetChange.remote.state === 'absent'
        && reference.targetChange.local.state === 'present');

    if (samePlanCreatedTermReferences.length > 0) {
      return {
        supported: false,
        className: 'unsupported-termmeta-resource',
        reason: 'Term meta graph resources are not yet supported by the planner.',
      };
    }
  }
  if (resource.table === 'wp_postmeta') {
    const samePlanCreatedRevisionReferences = referenceEvidence.find((reference) =>
      reference.relationshipType === 'postmeta-post'
      && reference.targetChange.targetResource?.table === 'wp_posts'
      && reference.targetChange.local.value?.post_type === 'revision'
      && reference.targetChange.remote.state === 'absent');

    if (samePlanCreatedRevisionReferences) {
      return {
        supported: false,
        className: 'unsupported-revision-resource',
        reason: 'Revision graph resources are not yet supported by the planner.',
      };
    }
  }
  if (resource.table === 'wp_posts' && localValue.post_type === 'nav_menu_item') {
    const menuItemParentReference = referenceEvidence.find((reference) =>
      reference.relationshipType === 'menu-item-parent'
      && reference.targetChange.targetResource?.table === 'wp_posts'
      && ['wp_navigation', 'nav_menu_item'].includes(reference.targetChange.local.value?.post_type)
      && reference.targetChange.remote.state === 'absent');

    if (menuItemParentReference) {
      return {
        supported: false,
        className: 'unsupported-navigation-resource',
        reason: 'Navigation and menu graph resources are not yet supported by the planner.',
      };
    }
  }
  if (resource.table === 'wp_posts' && localValue.post_type === 'wp_navigation') {
    const inboundNavigationReference = referenceEvidence.find((reference) =>
      reference.relationshipType === 'post-parent'
      && reference.targetChange.targetResource?.table === 'wp_posts'
      && ['wp_navigation', 'nav_menu_item'].includes(reference.targetChange.local.value?.post_type)
      && reference.targetChange.remote.state === 'absent');

    if (inboundNavigationReference) {
      return {
        supported: false,
        className: 'unsupported-navigation-resource',
        reason: 'Navigation and menu graph resources are not yet supported by the planner.',
      };
    }
  }
  if (resource.table === 'wp_posts' && normalizePositiveInteger(localValue.post_parent) != null) {
    const postParentTarget = wordpressGraphTargetResource({
      sourceTable: resource.table,
      targetSuffix: 'posts',
      id: normalizePositiveInteger(localValue.post_parent),
    });
    const localPostParentTarget = getResource(local, postParentTarget);
    if (localPostParentTarget?.post_type === 'attachment' && getResource(remote, postParentTarget) === ABSENT) {
      return {
        supported: false,
        className: 'unsupported-attachment-resource',
        reason: 'Attachment graph resources are not yet supported by the planner.',
      };
    }
    if (['wp_navigation', 'nav_menu_item'].includes(localPostParentTarget?.post_type) && getResource(remote, postParentTarget) === ABSENT) {
      return {
        supported: false,
        className: 'unsupported-navigation-resource',
        reason: 'Navigation and menu graph resources are not yet supported by the planner.',
      };
    }
    if (localPostParentTarget?.post_type === 'revision' && getResource(remote, postParentTarget) === ABSENT) {
      return {
        supported: false,
        className: 'unsupported-revision-resource',
        reason: 'Revision graph resources are not yet supported by the planner.',
      };
    }
  }
  const unsupportedAttachmentReferences = referenceEvidence
    .filter((reference) =>
      reference.relationshipType === 'featured-image-attachment'
      || (
        reference.relationshipType === 'post-parent'
        && reference.targetChange.targetResource?.table === 'wp_posts'
        && getResource(remote, reference.targetChange.targetResource)?.post_type === 'attachment'
      )
      || (
        reference.targetChange.remote.state === 'absent'
        && reference.targetChange.local.state === 'present'
        && reference.targetChange.local.value?.post_type === 'attachment'
      ));

  if (unsupportedAttachmentReferences.length > 0) {
    return {
      supported: false,
      className: 'unsupported-attachment-resource',
      reason: 'Attachment graph resources are not yet supported by the planner.',
    };
  }

  const unsupportedRevisionReferences = referenceEvidence
    .filter((reference) =>
      reference.relationshipType === 'post-parent'
      && reference.targetChange.targetResource?.table === 'wp_posts'
      && (
        getResource(remote, reference.targetChange.targetResource)?.post_type === 'revision'
        || (
          reference.targetChange.remote.state === 'absent'
          && getResource(local, reference.targetChange.targetResource)?.post_type === 'revision'
        )
      ));

  if (unsupportedRevisionReferences.length > 0) {
    return {
      supported: false,
      className: 'unsupported-revision-resource',
      reason: 'Revision graph resources are not yet supported by the planner.',
    };
  }

  const unsafeReferences = references
    .map((reference) => wordpressGraphReferenceEvidence(reference, resources, base, local, remote))
    .filter(Boolean)
    .filter((reference) => isUnsafeWordPressGraphReference(reference));

  if (unsafeReferences.length === 0) {
    return { supported: true };
  }

  return {
    supported: false,
    className: 'stale-wordpress-graph-identity',
    reason: `WordPress graph mutation ${resource.key} references graph identities without proven identity mapping or reference rewriting.`,
    references: unsafeReferences,
  };
}

function isUnsafeWordPressGraphReference(reference) {
  if (reference.targetChange.remote.state !== 'present') {
    return true;
  }

  if (reference.targetRemoteHash === reference.targetBaseHash) {
    return false;
  }

  return reference.targetLocalHash !== reference.targetRemoteHash;
}

function wordpressGraphReferences(resource, value) {
  const suffix = wordpressGraphTableSuffix(resource.table);
  if (!suffix || !value || typeof value !== 'object') {
    return [];
  }

  const references = [];
  const addReference = ({ field, relationshipType, targetTable, targetId }) => {
    const normalizedId = normalizePositiveInteger(targetId);
    if (normalizedId == null) {
      return;
    }
    const targetResource = wordpressGraphTargetResource({
      sourceTable: resource.table,
      targetSuffix: targetTable,
      id: normalizedId,
    });
    references.push({
      relationshipKey: `${resource.table}.${field}`,
      relationshipType,
      sourceResourceKey: resource.key,
      sourceTable: resource.table,
      sourceRowId: resource.id,
      targetTable: targetResource.table,
      targetId: targetResource.id,
      targetResource,
      targetResourceKey: targetResource.key,
    });
  };

  if (suffix === 'posts') {
    addReference({
      field: 'post_parent',
      relationshipType: 'post-parent',
      targetTable: 'posts',
      targetId: value.post_parent,
    });
    addReference({
      field: 'post_author',
      relationshipType: 'post-author',
      targetTable: 'users',
      targetId: value.post_author,
    });
    if (value.post_type === 'nav_menu_item') {
      addReference({
        field: 'menu_item_parent',
        relationshipType: 'menu-item-parent',
        targetTable: 'posts',
        targetId: value.menu_item_parent,
      });
    }
  }

  if (suffix === 'comments') {
    addReference({
      field: 'comment_parent',
      relationshipType: 'comment-parent',
      targetTable: 'comments',
      targetId: value.comment_parent,
    });
    addReference({
      field: 'comment_post_ID',
      relationshipType: 'comment-post',
      targetTable: 'posts',
      targetId: value.comment_post_ID,
    });
    addReference({
      field: 'user_id',
      relationshipType: 'comment-user',
      targetTable: 'users',
      targetId: value.user_id,
    });
  }

  if (suffix === 'postmeta') {
    addReference({
      field: 'post_id',
      relationshipType: 'postmeta-post',
      targetTable: 'posts',
      targetId: value.post_id,
    });
    if (value.meta_key === '_thumbnail_id') {
      addReference({
        field: 'meta_value',
        relationshipType: 'featured-image-attachment',
        targetTable: 'posts',
        targetId: value.meta_value,
      });
    }
  }

  if (suffix === 'term_relationships') {
    addReference({
      field: 'object_id',
      relationshipType: 'term-relationship-object',
      targetTable: 'posts',
      targetId: value.object_id,
    });
    addReference({
      field: 'term_taxonomy_id',
      relationshipType: 'term-relationship-taxonomy',
      targetTable: 'term_taxonomy',
      targetId: value.term_taxonomy_id,
    });
  }

  if (suffix === 'term_taxonomy') {
    addReference({
      field: 'term_id',
      relationshipType: 'term-taxonomy-term',
      targetTable: 'terms',
      targetId: value.term_id,
    });
    addReference({
      field: 'parent',
      relationshipType: 'term-taxonomy-parent',
      targetTable: 'terms',
      targetId: value.parent,
    });
  }

  if (suffix === 'termmeta') {
    addReference({
      field: 'term_id',
      relationshipType: 'termmeta-term',
      targetTable: 'terms',
      targetId: value.term_id,
    });
  }

  if (suffix === 'usermeta') {
    addReference({
      field: 'user_id',
      relationshipType: 'usermeta-user',
      targetTable: 'users',
      targetId: value.user_id,
    });
  }

  return references;
}

function wordpressGraphReferenceEvidence(reference, resources, base, local, remote) {
  const target = resources.find((candidate) => candidate.key === reference.targetResourceKey)
    || reference.targetResource;
  const baseValue = getResource(base, target);
  const localValue = getResource(local, target);
  const remoteValue = getResource(remote, target);
  const targetBaseHash = resourceHash(base, target);
  const targetLocalHash = resourceHash(local, target);
  const targetRemoteHash = resourceHash(remote, target);

  return {
    relationshipKey: reference.relationshipKey,
    relationshipType: reference.relationshipType,
    sourceResourceKey: reference.sourceResourceKey,
    sourceTable: reference.sourceTable,
    sourceRowId: reference.sourceRowId,
    targetResource: target,
    targetResourceKey: target.key,
    targetTable: target.table,
    targetId: target.id,
    targetBaseHash,
    targetLocalHash,
    targetRemoteHash,
    targetChange: changeEvidence(
      target,
      baseValue,
      localValue,
      remoteValue,
      targetBaseHash,
      targetLocalHash,
      targetRemoteHash,
    ),
  };
}

function samePlanCreatedGraphIdentitySupport({ resource, resources, base, local, remote }) {
  const localValue = getResource(local, resource);
  const baseValue = getResource(base, resource);
  const remoteValue = getResource(remote, resource);

  if (localValue === ABSENT || resource.type !== 'row') {
    return { supported: true };
  }

  if (resourceHash(base, resource) !== resourceHash(remote, resource)) {
    return { supported: true };
  }

  const inboundReferences = [];
  for (const sourceResource of resources) {
    if (!isWordPressGraphReferenceResource(sourceResource)) {
      continue;
    }
    const sourceLocalValue = getResource(local, sourceResource);
    if (sourceLocalValue === ABSENT) {
      continue;
    }
    if (resourceHash(base, sourceResource) === resourceHash(local, sourceResource)) {
      continue;
    }

    for (const reference of wordpressGraphReferences(sourceResource, sourceLocalValue)) {
      if (reference.targetResourceKey !== resource.key) {
        continue;
      }
      const evidence = wordpressGraphReferenceEvidence(reference, resources, base, local, remote);
      if (evidence.targetChange.remote.state === 'absent') {
        inboundReferences.push(evidence);
      }
    }
  }

  if (inboundReferences.length === 0) {
    return { supported: true };
  }

  const termTaxonomyInboundReference = inboundReferences.find((reference) =>
    reference.relationshipType === 'term-relationship-taxonomy'
    && reference.targetResource?.table === 'wp_term_taxonomy');
  const revisionInboundReference = inboundReferences.find((reference) =>
    reference.relationshipType === 'term-relationship-object'
    && reference.targetResource?.table === 'wp_posts'
    && getResource(local, reference.targetResource)?.post_type === 'revision');
  const postInboundReference = inboundReferences.find((reference) =>
    reference.relationshipType === 'term-relationship-object'
    && reference.targetResource?.table === 'wp_posts');
  const postAuthorInboundReference = inboundReferences.find((reference) =>
    reference.relationshipType === 'post-author'
    && reference.targetResource?.table === 'wp_users');
  const commentUserInboundReference = inboundReferences.find((reference) =>
    reference.relationshipType === 'comment-user'
    && reference.targetResource?.table === 'wp_users');
  const usermetaUserInboundReference = inboundReferences.find((reference) =>
    reference.relationshipType === 'usermeta-user'
    && reference.targetResource?.table === 'wp_users');
  return {
    supported: false,
    className: 'stale-wordpress-graph-identity',
    reason: termTaxonomyInboundReference
      ? `WordPress graph mutation ${resource.key} is created in the same plan as a term relationship taxonomy target that depends on it, and identity rewriting is not yet supported.`
      : revisionInboundReference
        ? `WordPress graph mutation ${resource.key} is created in the same plan as a term relationship revision target that depends on it, and identity rewriting is not yet supported.`
      : postInboundReference
        ? `WordPress graph mutation ${resource.key} is created in the same plan as a term relationship post target that depends on it, and identity rewriting is not yet supported.`
        : postAuthorInboundReference
          ? `WordPress graph mutation ${resource.key} is created in the same plan as a post author target that depends on it, and identity rewriting is not yet supported.`
          : commentUserInboundReference
            ? `WordPress graph mutation ${resource.key} is created in the same plan as a comment user target that depends on it, and identity rewriting is not yet supported.`
            : usermetaUserInboundReference
              ? `WordPress graph mutation ${resource.key} is created in the same plan as a user meta target that depends on it, and identity rewriting is not yet supported.`
      : `WordPress graph mutation ${resource.key} is created in the same plan as a relationship that depends on it, and identity rewriting is not yet supported.`,
    references: inboundReferences,
  };
}

function isWordPressGraphReferenceResource(resource) {
  if (resource.type !== 'row') {
    return false;
  }
  return [
    'wp_comments',
    'wp_posts',
    'wp_postmeta',
    'wp_term_relationships',
    'wp_term_taxonomy',
    'wp_termmeta',
  ].includes(resource.table);
}

function wordpressGraphTargetResource({ sourceTable, targetSuffix, id }) {
  const table = wordpressGraphSiblingTable(sourceTable, targetSuffix);
  const idField = wordpressGraphPrimaryIdField(targetSuffix);
  const rowId = `${idField}:${id}`;
  return {
    type: 'row',
    table,
    id: rowId,
    key: `row:${JSON.stringify([table, rowId])}`,
  };
}

function wordpressGraphSiblingTable(table, targetSuffix) {
  const sourceSuffix = wordpressGraphTableSuffix(table);
  if (!sourceSuffix) {
    return `wp_${targetSuffix}`;
  }
  return `${table.slice(0, table.length - sourceSuffix.length)}${targetSuffix}`;
}

function wordpressGraphTableSuffix(table) {
  return WORDPRESS_GRAPH_TABLE_SUFFIXES.find((suffix) =>
    table === `wp_${suffix}` || table.endsWith(`_${suffix}`)) || null;
}

function wordpressGraphPrimaryIdField(suffix) {
  if (suffix === 'posts') {
    return 'ID';
  }
  if (suffix === 'comments') {
    return 'comment_ID';
  }
  if (suffix === 'users') {
    return 'ID';
  }
  if (suffix === 'usermeta') {
    return 'umeta_id';
  }
  if (suffix === 'terms') {
    return 'term_id';
  }
  if (suffix === 'term_taxonomy') {
    return 'term_taxonomy_id';
  }
  return 'id';
}

function normalizePositiveInteger(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  return null;
}

function isPluginContextMutationResource(resource, owner) {
  return Boolean(owner)
    && (resource.type === 'plugin' || (resource.type === 'file' && isPluginOwnerContextResource(resource, owner)));
}

function pluginContextMutationSupport({
  resource,
  owner,
  resources,
  base,
  local,
  remote,
}) {
  const staleContext = pluginOwnerContextEvidence({
    owner,
    resources,
    base,
    local,
    remote,
  })
    .filter((context) => context.resourceKey !== resource.key)
    .filter((context) =>
      context.remoteHash !== context.baseHash
      && context.localHash !== context.remoteHash);

  if (staleContext.length === 0) {
    return { supported: true };
  }

  return {
    supported: false,
    className: 'stale-plugin-owner-context',
    reason: `Plugin context resource ${resource.key} cannot be applied because live remote plugin context for ${owner} changed since the pull base.`,
    ownerContext: staleContext,
  };
}

function pluginOwnedOwnerContextSupport({
  resource,
  owner,
  resources,
  base,
  local,
  remote,
  intents,
  intentByResource,
}) {
  const intentId = intentByResource.get(resource.key) || null;
  const intent = intentId
    ? intents.find((candidate) => candidate.id === intentId)
    : null;
  const ownerDependencyDeclared = intentDeclaresPluginDependency(intent, owner);
  const ownerPluginIncludedInIntent = intentIncludesPluginResource(intent, owner);
  if (ownerDependencyDeclared && !hasPlugin(remote, owner) && ownerPluginIncludedInIntent) {
    return { supported: true };
  }

  const staleContext = pluginOwnerContextEvidence({
    owner,
    resources,
    base,
    local,
    remote,
  })
    .filter((candidate) => !(ownerDependencyDeclared && candidate.type === 'plugin'))
    .filter((context) =>
      context.remoteHash !== context.baseHash
      && context.localHash !== context.remoteHash);

  if (staleContext.length === 0) {
    return { supported: true };
  }

  return {
    supported: false,
    className: 'stale-plugin-owner-context',
    reason: `Plugin-owned resource ${resource.key} cannot be applied because live remote plugin context for ${owner} changed since the pull base.`,
    ownerContext: staleContext,
  };
}

function pluginOwnerContextEvidence({
  owner,
  resources,
  base,
  local,
  remote,
}) {
  return resources
    .filter((candidate) => isPluginOwnerContextResource(candidate, owner))
    .map((contextResource) => {
      const baseValue = getResource(base, contextResource);
      const localValue = getResource(local, contextResource);
      const remoteValue = getResource(remote, contextResource);
      const baseHash = resourceHash(base, contextResource);
      const localHash = resourceHash(local, contextResource);
      const remoteHash = resourceHash(remote, contextResource);
      return {
        resource: contextResource,
        type: contextResource.type,
        resourceKey: contextResource.key,
        baseHash,
        localHash,
        remoteHash,
        change: changeEvidence(
          contextResource,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        ),
      };
    });
}

function isPluginOwnerContextResource(resource, owner) {
  if (resource.type === 'plugin') {
    return resource.name === owner;
  }
  return resource.type === 'file' && pluginOwnerFor(resource) === owner;
}

function intentDeclaresPluginDependency(intent, plugin) {
  if (!intent) {
    return false;
  }
  return normalizePluginDependencies(intent.dependencies?.plugins || [])
    .some((dependency) => dependency.name === plugin);
}

function intentIncludesPluginResource(intent, plugin) {
  if (!intent) {
    return false;
  }
  return Array.isArray(intent.resources)
    && intent.resources.some((resourceKey) => resourceKey === `plugin:${plugin}`);
}

function addPluginOwnedResourceBlocker(plan, {
  resource,
  owner,
  support,
  baseValue,
  localValue,
  remoteValue,
  baseHash,
  localHash,
  remoteHash,
}) {
  const className = support.className || 'unsupported-plugin-owned-resource';
  const reason = support.reason || (className === 'missing-plugin-driver'
    ? `Plugin-owned resource ${resource.key} is missing explicit driver metadata for plugin ${owner}.`
    : `Plugin-owned resource ${resource.key} is not covered by a supported resource driver policy for plugin ${owner}.`);
  const ownerContext = boundEvidenceList(support.ownerContext || [], 3);

  plan.blockers.push({
    id: `blocker-plugin-owned-resource-${plan.blockers.length + 1}`,
    class: className,
    resource,
    resourceKey: resource.key,
    pluginOwner: owner,
    resourceKind: support.resourceKind || null,
    driver: support.driver || null,
    policySource: support.policySource || null,
    ...(ownerContext.length > 0 ? { ownerContext, ownerContextTruncated: Boolean((support.ownerContext || []).length > ownerContext.length) } : {}),
    reason,
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
  });
}

function addPluginContextBlocker(plan, {
  resource,
  owner,
  support,
  baseValue,
  localValue,
  remoteValue,
  baseHash,
  localHash,
  remoteHash,
}) {
  const ownerContext = boundEvidenceList(support.ownerContext || [], 3);
  plan.blockers.push({
    id: `blocker-plugin-context-${plan.blockers.length + 1}`,
    class: support.className || 'stale-plugin-owner-context',
    resource,
    resourceKey: resource.key,
    pluginOwner: owner,
    ownerContext,
    ownerContextTruncated: Boolean((support.ownerContext || []).length > ownerContext.length),
    reason: support.reason || `Plugin context resource ${resource.key} cannot be applied with stale live remote plugin context.`,
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
  });
}

function addWordPressGraphIdentityBlocker(plan, {
  resource,
  support,
  baseValue,
  localValue,
  remoteValue,
  baseHash,
  localHash,
  remoteHash,
}) {
  const references = boundEvidenceList(support.references || [], 3);
  plan.blockers.push({
    id: `blocker-wordpress-graph-identity-${plan.blockers.length + 1}`,
    class: support.className || 'stale-wordpress-graph-identity',
    resource,
    resourceKey: resource.key,
    reason: support.reason || `WordPress graph mutation ${resource.key} requires proven identity mapping and reference rewriting.`,
    resolutionPolicy: 'preserve-remote-wordpress-graph-and-stop',
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
    references,
    referencesTruncated: Boolean((support.references || []).length > references.length),
  });
}

function addUnsupportedNavigationResourceBlocker(plan, {
  resource,
  support,
  baseValue,
  localValue,
  remoteValue,
  baseHash,
  localHash,
  remoteHash,
}) {
  plan.blockers.push({
    id: `blocker-unsupported-navigation-resource-${plan.blockers.length + 1}`,
    class: support.className || 'unsupported-navigation-resource',
    resource,
    resourceKey: resource.key,
    reason: support.reason || `Navigation and menu graph resource ${resource.key} is not yet supported by the planner.`,
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
  });
}

function addUnsupportedAttachmentResourceBlocker(plan, {
  resource,
  support,
  baseValue,
  localValue,
  remoteValue,
  baseHash,
  localHash,
  remoteHash,
}) {
  plan.blockers.push({
    id: `blocker-unsupported-attachment-resource-${plan.blockers.length + 1}`,
    class: support.className || 'unsupported-attachment-resource',
    resource,
    resourceKey: resource.key,
    reason: support.reason || `Attachment graph resource ${resource.key} is not yet supported by the planner.`,
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
  });
}

function addUnsupportedRevisionResourceBlocker(plan, {
  resource,
  support,
  baseValue,
  localValue,
  remoteValue,
  baseHash,
  localHash,
  remoteHash,
}) {
  plan.blockers.push({
    id: `blocker-unsupported-revision-resource-${plan.blockers.length + 1}`,
    class: support.className || 'unsupported-revision-resource',
    resource,
    resourceKey: resource.key,
    reason: support.reason || `Revision graph resource ${resource.key} is not yet supported by the planner.`,
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
  });
}

function addUnsupportedTermmetaResourceBlocker(plan, {
  resource,
  support,
  baseValue,
  localValue,
  remoteValue,
  baseHash,
  localHash,
  remoteHash,
}) {
  plan.blockers.push({
    id: `blocker-unsupported-termmeta-resource-${plan.blockers.length + 1}`,
    class: support.className || 'unsupported-termmeta-resource',
    resource,
    resourceKey: resource.key,
    reason: support.reason || `Term meta graph resource ${resource.key} is not yet supported by the planner.`,
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
  });
}

function addUnsupportedTermTaxonomyResourceBlocker(plan, {
  resource,
  support,
  baseValue,
  localValue,
  remoteValue,
  baseHash,
  localHash,
  remoteHash,
}) {
  plan.blockers.push({
    id: `blocker-unsupported-term-taxonomy-resource-${plan.blockers.length + 1}`,
    class: support.className || 'unsupported-term-taxonomy-resource',
    resource,
    resourceKey: resource.key,
    reason: support.reason || `Term taxonomy graph resource ${resource.key} is not yet supported by the planner.`,
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
  });
}

function addUnsupportedCommentsUsersResourceBlocker(plan, {
  resource,
  support,
  baseValue,
  localValue,
  remoteValue,
  baseHash,
  localHash,
  remoteHash,
}) {
  plan.blockers.push({
    id: `blocker-unsupported-comments-users-resource-${plan.blockers.length + 1}`,
    class: support.className || 'unsupported-comments-users-resource',
    resourceKind: 'comments-users',
    resource,
    resourceKey: resource.key,
    reason: support.reason || `Comments and users graph resource ${resource.key} is not yet supported by the planner.`,
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
  });
}

function addUnsupportedUsermetaResourceBlocker(plan, {
  resource,
  support,
  baseValue,
  localValue,
  remoteValue,
  baseHash,
  localHash,
  remoteHash,
}) {
  plan.blockers.push({
    id: `blocker-unsupported-usermeta-resource-${plan.blockers.length + 1}`,
    class: support.className || 'unsupported-usermeta-resource',
    resource,
    resourceKey: resource.key,
    reason: support.reason || `User meta resource ${resource.key} is not yet supported by the planner.`,
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
  });
}

function addUnsupportedLegacyLinksResourceBlocker(plan, {
  resource,
  support,
  baseValue,
  localValue,
  remoteValue,
  baseHash,
  localHash,
  remoteHash,
}) {
  plan.blockers.push({
    id: `blocker-unsupported-legacy-links-resource-${plan.blockers.length + 1}`,
    class: support.className || 'unsupported-legacy-links-resource',
    resourceKind: 'legacy-link',
    resource,
    resourceKey: resource.key,
    reason: support.reason || `Legacy link resource ${resource.key} is not yet supported by the planner.`,
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
  });
}

function addUnsupportedGuidResourceBlocker(plan, {
  resource,
  support,
  baseValue,
  localValue,
  remoteValue,
  baseHash,
  localHash,
  remoteHash,
}) {
  plan.blockers.push({
    id: `blocker-unsupported-guid-resource-${plan.blockers.length + 1}`,
    class: support.className || 'unsupported-guid-resource',
    resourceKind: 'post-guid',
    resource,
    resourceKey: resource.key,
    reason: support.reason || `Post GUID resource ${resource.key} is not yet supported by the planner.`,
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
  });
}

function addUnsupportedSerializedBlocksBlocker(plan, {
  resource,
  support,
  baseValue,
  localValue,
  remoteValue,
  baseHash,
  localHash,
  remoteHash,
}) {
  plan.blockers.push({
    id: `blocker-unsupported-serialized-blocks-resource-${plan.blockers.length + 1}`,
    class: support.className || 'unsupported-serialized-blocks-resource',
    resourceKind: 'serialized-blocks',
    resource,
    resourceKey: resource.key,
    reason: support.reason || `Serialized block references in ${resource.key} are not yet supported by the planner.`,
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
  });
}

function addUnsupportedSpecialFileBlocker(plan, {
  resource,
  support,
  baseValue,
  localValue,
  remoteValue,
  baseHash,
  localHash,
  remoteHash,
}) {
  plan.blockers.push({
    id: `blocker-unsupported-special-file-resource-${plan.blockers.length + 1}`,
    class: support.className || 'unsupported-special-file-resource',
    resource,
    resourceKey: resource.key,
    reason: support.reason || `Special file entry ${resource.key} is not yet supported by the planner.`,
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
  });
}

function boundEvidenceList(items, limit) {
  return items.slice(0, limit);
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

function unsupportedNavigationResourceSupport({ resource, baseValue, localValue, remoteValue }) {
  if (resource.type !== 'row' || resource.table !== 'wp_posts') {
    return { supported: true };
  }

  const candidate = localValue !== ABSENT ? localValue : (baseValue !== ABSENT ? baseValue : remoteValue);
  if (
    !candidate
    || candidate === ABSENT
    || !['wp_navigation', 'nav_menu_item'].includes(candidate.post_type)
  ) {
    return { supported: true };
  }

  return {
    supported: false,
    className: 'unsupported-navigation-resource',
    reason: 'Navigation and menu graph resources are not yet supported by the planner.',
  };
}

function unsupportedAttachmentResourceSupport({ resource, baseValue, localValue, remoteValue }) {
  if (resource.type !== 'row' || resource.table !== 'wp_posts') {
    return { supported: true };
  }

  const candidate = localValue !== ABSENT ? localValue : (baseValue !== ABSENT ? baseValue : remoteValue);
  if (!candidate || candidate === ABSENT || candidate.post_type !== 'attachment') {
    return { supported: true };
  }

  const samePlanCreatedAttachment = localValue !== ABSENT && baseValue === ABSENT && remoteValue === ABSENT;
  if (samePlanCreatedAttachment) {
    return {
      supported: false,
      className: 'unsupported-attachment-resource',
      reason: 'Attachment graph resources are not yet supported by the planner.',
    };
  }

  return {
    supported: false,
    className: 'unsupported-attachment-resource',
    reason: 'Attachment graph resources are not yet supported by the planner.',
  };
}

function unsupportedRevisionResourceSupport({ resource, baseValue, localValue, remoteValue }) {
  if (resource.type !== 'row' || resource.table !== 'wp_posts') {
    return { supported: true };
  }

  const candidate = localValue !== ABSENT ? localValue : (baseValue !== ABSENT ? baseValue : remoteValue);
  if (!candidate || candidate === ABSENT || candidate.post_type !== 'revision') {
    return { supported: true };
  }

  return {
    supported: false,
    className: 'unsupported-revision-resource',
    reason: `WordPress graph mutation ${resource.key} is created in the same plan as a revision identity that depends on it, and identity rewriting is not yet supported.`,
  };
}

function unsupportedTermmetaResourceSupport({ resource, baseValue, localValue, remoteValue, resources, base, local, remote }) {
  if (resource.type !== 'row' || resource.table !== 'wp_termmeta') {
    return { supported: true };
  }

  const candidate = localValue !== ABSENT ? localValue : (baseValue !== ABSENT ? baseValue : remoteValue);
  if (!candidate || candidate === ABSENT) {
    return { supported: true };
  }

  const references = wordpressGraphReferences(resource, candidate);
  const referenceEvidence = references.map((reference) =>
    wordpressGraphReferenceEvidence(reference, resources, base, local, remote));
  const termReference = referenceEvidence.find((reference) =>
    reference.relationshipType === 'termmeta-term'
    && reference.targetChange.remote.state === 'absent'
    && reference.targetChange.local.state === 'present');

  return {
    supported: false,
    className: 'unsupported-termmeta-resource',
    reason: `WordPress graph mutation ${resource.key} is created in the same plan as a term identity that depends on it, and identity rewriting is not yet supported.`,
  };
}

function unsupportedTermTaxonomyResourceSupport({ resource, baseValue, localValue, remoteValue, local, remote }) {
  if (resource.type !== 'row' || resource.table !== 'wp_term_taxonomy') {
    return { supported: true };
  }

  const candidate = localValue !== ABSENT ? localValue : (baseValue !== ABSENT ? baseValue : remoteValue);
  if (!candidate || candidate === ABSENT) {
    return { supported: true };
  }

  const references = wordpressGraphReferences(resource, candidate);
  const samePlanCreatedTermReferences = references.filter((reference) => (
    (reference.relationshipType === 'term-taxonomy-term' || reference.relationshipType === 'term-taxonomy-parent')
    && getResource(remote, reference.targetResource) === ABSENT
    && getResource(local, reference.targetResource) !== ABSENT
  ));

  if (samePlanCreatedTermReferences.length === 0) {
    return { supported: true };
  }

  return {
    supported: false,
    className: 'unsupported-term-taxonomy-resource',
    reason: samePlanCreatedTermReferences.some((reference) => reference.relationshipType === 'term-taxonomy-parent')
      ? 'WordPress graph mutation row:["wp_term_taxonomy","term_taxonomy_id:5"] is created in the same plan as a parent term identity that depends on it, and identity rewriting is not yet supported.'
      : 'Term taxonomy graph resources are not yet supported by the planner.',
  };
}

function unsupportedGuidResourceSupport({ resource, baseValue, localValue, remoteValue }) {
  if (resource.type !== 'row' || resource.table !== 'wp_posts') {
    return { supported: true };
  }

  const candidate = localValue !== ABSENT ? localValue : (baseValue !== ABSENT ? baseValue : remoteValue);
  const baseGuid = baseValue !== ABSENT && baseValue && typeof baseValue === 'object' ? baseValue.guid : undefined;
  const localGuid = localValue !== ABSENT && localValue && typeof localValue === 'object' ? localValue.guid : undefined;
  if (
    !candidate
    || candidate === ABSENT
    || baseGuid == null
    || baseGuid === ''
    || localGuid == null
    || localGuid === ''
    || localGuid === baseGuid
  ) {
    return { supported: true };
  }

  return {
    supported: false,
    className: 'unsupported-guid-resource',
    reason: 'Post GUID graph resources are not yet supported by the planner.',
  };
}

function unsupportedCommentsUsersResourceSupport({ resource, baseValue, localValue, remoteValue, resources, base, local, remote }) {
  if (resource.type !== 'row' || !['wp_comments', 'wp_users'].includes(resource.table)) {
    return { supported: true };
  }

  const candidate = localValue !== ABSENT ? localValue : (baseValue !== ABSENT ? baseValue : remoteValue);
  if (!candidate || candidate === ABSENT) {
    return { supported: true };
  }

  if (resource.table === 'wp_comments') {
    const references = wordpressGraphReferences(resource, candidate);
    const commentGraphReference = references.find((reference) =>
      (
        reference.relationshipType === 'comment-parent'
        && reference.targetResource?.table === 'wp_comments'
        && getResource(remote, reference.targetResource) === ABSENT
        && getResource(local, reference.targetResource) !== ABSENT
      )
      || (
        reference.relationshipType === 'comment-post'
        && reference.targetResource?.table === 'wp_posts'
        && getResource(remote, reference.targetResource) === ABSENT
        && getResource(local, reference.targetResource) !== ABSENT
      )
      || (
        reference.relationshipType === 'comment-user'
        && reference.targetResource?.table === 'wp_users'
        && getResource(remote, reference.targetResource) === ABSENT
        && getResource(local, reference.targetResource) !== ABSENT
      ));

    if (commentGraphReference) {
      return {
        supported: false,
        className: 'unsupported-comments-users-resource',
        reason: commentGraphReference.relationshipType === 'comment-parent'
          ? `WordPress graph mutation ${resource.key} is created in the same plan as a parent comment identity that depends on it, and identity rewriting is not yet supported.`
          : commentGraphReference.relationshipType === 'comment-post'
            ? `WordPress graph mutation ${resource.key} is created in the same plan as a comment post identity that depends on it, and identity rewriting is not yet supported.`
            : `WordPress graph mutation ${resource.key} is created in the same plan as a comment user identity that depends on it, and identity rewriting is not yet supported.`,
      };
    }
  }

  if (resource.table === 'wp_users') {
    const inboundUserReferences = resources
      .filter((sourceResource) => sourceResource.type === 'row')
      .flatMap((sourceResource) => {
        const sourceLocalValue = getResource(local, sourceResource);
        if (sourceLocalValue === ABSENT) {
          return [];
        }
        return wordpressGraphReferences(sourceResource, sourceLocalValue)
          .filter((reference) => reference.targetResourceKey === resource.key)
          .map((reference) =>
            wordpressGraphReferenceEvidence(reference, resources, base, local, remote));
      })
      .filter((reference) =>
        (
          reference.relationshipType === 'comment-user'
          || reference.relationshipType === 'usermeta-user'
        )
        && reference.targetChange.remote.state === 'absent'
        && reference.targetChange.local.state === 'present');

    if (inboundUserReferences.length > 0) {
      const userReference = inboundUserReferences[0];
      return {
        supported: false,
        className: 'unsupported-comments-users-resource',
        reason: userReference.relationshipType === 'comment-user'
          ? `WordPress graph mutation ${resource.key} is created in the same plan as a comment user identity that depends on it, and identity rewriting is not yet supported.`
          : `WordPress graph mutation ${resource.key} is created in the same plan as a user meta identity that depends on it, and identity rewriting is not yet supported.`,
      };
    }
  }

  return {
    supported: false,
    className: 'unsupported-comments-users-resource',
    reason: resource.table === 'wp_users'
      ? 'User graph resources are not yet supported by the planner.'
      : 'Comments graph resources are not yet supported by the planner.',
  };
}

function unsupportedUsermetaResourceSupport({ resource, baseValue, localValue, remoteValue, resources, base, local, remote }) {
  if (resource.type !== 'row' || resource.table !== 'wp_usermeta') {
    return { supported: true };
  }

  const candidate = localValue !== ABSENT ? localValue : (baseValue !== ABSENT ? baseValue : remoteValue);
  if (!candidate || candidate === ABSENT) {
    return { supported: true };
  }

  const references = wordpressGraphReferences(resource, candidate);
  const userGraphReference = references.find((reference) =>
    reference.relationshipType === 'usermeta-user'
    && reference.targetResource?.table === 'wp_users'
    && getResource(remote, reference.targetResource) === ABSENT
    && getResource(local, reference.targetResource) !== ABSENT);

  if (userGraphReference) {
    return {
      supported: false,
      className: 'unsupported-usermeta-resource',
      reason: `WordPress graph mutation ${resource.key} is created in the same plan as a user identity that depends on it, and identity rewriting is not yet supported.`,
    };
  }

  return {
    supported: false,
    className: 'unsupported-usermeta-resource',
    reason: 'User meta graph resources are not yet supported by the planner.',
  };
}

function unsupportedLegacyLinksResourceSupport({ resource, baseValue, localValue, remoteValue }) {
  if (resource.type !== 'row' || resource.table !== 'wp_links') {
    return { supported: true };
  }

  const candidate = localValue !== ABSENT ? localValue : (baseValue !== ABSENT ? baseValue : remoteValue);
  if (candidate && candidate !== ABSENT) {
    return {
      supported: false,
      className: 'unsupported-legacy-links-resource',
      reason: 'Legacy link graph resources are not yet supported by the planner.',
    };
  }

  return { supported: true };
}

function unsupportedSerializedBlocksSupport({ resource, baseValue, localValue, remoteValue }) {
  if (resource.type !== 'row' || resource.table !== 'wp_posts') {
    return { supported: true };
  }

  const candidate = localValue !== ABSENT ? localValue : (baseValue !== ABSENT ? baseValue : remoteValue);
  if (!candidate || candidate === ABSENT || typeof candidate.post_content !== 'string') {
    return { supported: true };
  }

  if (!candidate.post_content.includes('<!-- wp:')) {
    return { supported: true };
  }

  return {
    supported: false,
    className: 'unsupported-serialized-blocks-resource',
    reason: 'Serialized block references are not yet supported by the planner.',
  };
}

function unsupportedSpecialFileResourceSupport({ resource, baseValue, localValue, remoteValue }) {
  if (resource.type !== 'file') {
    return { supported: true };
  }

  const candidate = localValue !== ABSENT ? localValue : (baseValue !== ABSENT ? baseValue : remoteValue);
  if (!candidate || candidate === ABSENT || typeof candidate !== 'object') {
    return { supported: true };
  }

  if (!isUnsupportedSpecialFileValue(candidate)) {
    return { supported: true };
  }

  return {
    supported: false,
    className: 'unsupported-special-file-resource',
    reason: 'Special file entries are not yet supported by the planner.',
  };
}

function isUnsupportedSpecialFileValue(value) {
  const specialTypes = new Set([
    'symlink',
    'junction',
    'reparse',
    'reparse-point',
    'submodule',
    'gitlink',
    'fifo',
    'socket',
    'device',
    'block',
    'block-device',
    'character',
    'char',
    'char-device',
    'named-pipe',
    'pipe',
    'hardlink',
    'hard-link',
  ]);
  const specialModeMasks = new Set([
    0o120000, // symlink
    0o060000, // block device
    0o020000, // character device
    0o010000, // named pipe / fifo
    0o140000, // socket
    0o100000, // regular file, kept only for explicit negative checks
  ]);

  if (typeof value?.type === 'string' && specialTypes.has(value.type)) {
    return true;
  }

  if (typeof value?.mode === 'number') {
    const fileType = value.mode & 0o170000;
    if (specialModeMasks.has(fileType) && fileType !== 0o100000) {
      return true;
    }
  }

  return Boolean(value?.target) || Boolean(value?.linkTarget) || Boolean(value?.inode);
}

function addFileTopologyConflicts(plan, resources, base, local, remote) {
  const fileResources = resources.filter((resource) => resource.type === 'file');
  const mutationByKey = new Map(plan.mutations.map((mutation) => [mutation.resourceKey, mutation]));
  const unsafeMutationKeys = new Set();
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
          (mutationAfter === ABSENT || mutationAfterType !== 'directory')
          && shouldStopForDescendant(mutationByKey, other, base, remote)
        ) {
          unsafeMutationKeys.add(mutation.resourceKey);
          addTopologyConflict(
            plan,
            added,
            'descendant-hidden',
            mutation.resource,
            other,
            base,
            local,
            remote,
            'Local file deletion or type change would hide or remove a live remote descendant.',
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
          unsafeMutationKeys.add(mutation.resourceKey);
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

  removeUnsafeMutations(plan, unsafeMutationKeys);
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

function removeUnsafeMutations(plan, unsafeMutationKeys) {
  if (unsafeMutationKeys.size === 0) {
    return;
  }

  const removedMutationIds = new Set();
  plan.mutations = plan.mutations.filter((mutation) => {
    if (!unsafeMutationKeys.has(mutation.resourceKey)) {
      return true;
    }
    removedMutationIds.add(mutation.id);
    return false;
  });
  plan.preconditions = plan.preconditions.filter((precondition) =>
    !removedMutationIds.has(precondition.mutationId));
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
        baseHash: mutation.baseHash,
        localHash: mutation.localHash,
        remoteHash: mutation.remoteBeforeHash,
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
