import { ABSENT, deepClone, digest } from './stable-json.js';
import {
  deserializeResourceValue,
  enumerateResources,
  getResource,
  hasPlugin,
  pluginOwnerFor,
  resourceHash,
  serializeResourceValue,
} from './resources.js';
import { serializedOptionValidationEvidenceForRows } from './serialized-option-validator.js';

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
  const wordpressGraphIdentityMap = buildWordPressGraphIdentityMap({ base, local, remote });

  for (const sourceResource of resources) {
    const sourceBaseValue = getResource(base, sourceResource);
    const sourceLocalValue = getResource(local, sourceResource);
    const sourceRemoteValue = getResource(remote, sourceResource);
    const sourceBaseHash = resourceHash(base, sourceResource);
    const sourceLocalHash = resourceHash(local, sourceResource);
    const sourceRemoteHash = resourceHash(remote, sourceResource);
    const mappedIdentity = wordpressGraphIdentityMap.bySourceKey.get(sourceResource.key);
    if (sourceLocalHash !== sourceBaseHash && mappedIdentity) {
      if (!mappedIdentity.usable) {
        addWordPressGraphIdentityBlocker(plan, {
          resource: sourceResource,
          support: mappedIdentity.support,
          baseValue: sourceBaseValue,
          localValue: sourceLocalValue,
          remoteValue: sourceRemoteValue,
          baseHash: sourceBaseHash,
          localHash: sourceLocalHash,
          remoteHash: sourceRemoteHash,
        });
        continue;
      }
      plan.decisions.push({
        id: `decision-${plan.decisions.length + 1}`,
        resource: sourceResource,
        resourceKey: sourceResource.key,
        decision: 'map-local-identity-to-remote',
        reason: 'Local WordPress graph identity is mapped to a proven remote row; preserving the remote row and rewriting dependent references.',
        baseHash: sourceBaseHash,
        localHash: sourceLocalHash,
        remoteHash: sourceRemoteHash,
        targetResource: mappedIdentity.targetResource,
        targetResourceKey: mappedIdentity.targetResource.key,
        targetRemoteHash: mappedIdentity.targetRemoteHash,
        identityMapSource: mappedIdentity.source,
        change: changeEvidence(
          sourceResource,
          sourceBaseValue,
          sourceLocalValue,
          sourceRemoteValue,
          sourceBaseHash,
          sourceLocalHash,
          sourceRemoteHash,
        ),
      });
      continue;
    }

    const graphIdentityCollision = wordpressGraphIdentityMap.collisionsByResourceKey.get(sourceResource.key);
    if (sourceLocalHash !== sourceBaseHash && graphIdentityCollision) {
      addWordPressGraphIdentityBlocker(plan, {
        resource: sourceResource,
        support: graphIdentityCollision,
        baseValue: sourceBaseValue,
        localValue: sourceLocalValue,
        remoteValue: sourceRemoteValue,
        baseHash: sourceBaseHash,
        localHash: sourceLocalHash,
        remoteHash: sourceRemoteHash,
      });
      continue;
    }

    const graphIdentityRewrite = rewriteWordPressGraphMutation({
      resource: sourceResource,
      localValue: sourceLocalValue,
      identityMap: wordpressGraphIdentityMap,
    });
    const resource = graphIdentityRewrite.resource;
    const localValue = graphIdentityRewrite.localValue;
    const baseValue = graphIdentityRewrite.resource.key === sourceResource.key
      ? sourceBaseValue
      : getResource(base, resource);
    const remoteValue = graphIdentityRewrite.resource.key === sourceResource.key
      ? sourceRemoteValue
      : getResource(remote, resource);
    const baseHash = graphIdentityRewrite.resource.key === sourceResource.key
      ? sourceBaseHash
      : resourceHash(base, resource);
    const localHash = graphIdentityRewrite.rewrites.length === 0
      ? sourceLocalHash
      : digest(localValue);
    const remoteHash = graphIdentityRewrite.resource.key === sourceResource.key
      ? sourceRemoteHash
      : resourceHash(remote, resource);
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
      if (isActivePluginsOptionResource(resource)) {
        addDirectActivePluginsMutationBlocker(plan, {
          resource,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      if (isPluginContextMutationResource(resource, owner)) {
        const pluginContextSupport = pluginContextMutationSupport({
          resource,
          owner,
          localValue,
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
            support: {
              ...ownerContextSupport,
              driver: support.driver,
              policySource: support.policySource,
              supportsDelete: support.supportsDelete,
              driverAuditEvidence: pluginOwnedDriverDecisionAuditEvidence({
                resource,
                owner,
                support,
                action: localValue === ABSENT ? 'delete' : 'put',
                decision: 'blocked',
                reasonCode: 'PLUGIN_DRIVER_REMOTE_DRIFT_PRESERVED',
                baseHash,
                localHash,
                remoteHash,
              }),
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
        if (localValue === ABSENT && !support.supportsDelete) {
          addPluginOwnedResourceBlocker(plan, {
            resource,
            owner,
            support: {
              ...support,
              supported: false,
              className: 'unsupported-plugin-owned-resource',
              reason: 'Plugin-owned resource driver does not support delete mutations.',
              deleteSupportRefusalEvidence: pluginOwnedDriverDeleteSupportRefusalEvidence({
                resource,
                owner,
                support,
              }),
              deleteRefusalEvidence: pluginOwnedResourceDeleteRefusalEvidence({
                resource,
                owner,
                support,
              }),
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

      const graphIdentitySupport = wordpressGraphIdentitySupport({
        resource,
        localValue,
        resources,
        base,
        local,
        remote,
        identityMap: wordpressGraphIdentityMap,
        identityRewrites: graphIdentityRewrite.rewrites,
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
        atomicGroupId: intentByResource.get(resource.key) || intentByResource.get(sourceResource.key) || null,
      };
      if (graphIdentityRewrite.rewrites.length > 0) {
        mutation.wordpressGraphIdentity = {
          sourceResource: sourceResource.key === resource.key ? null : sourceResource,
          sourceResourceKey: sourceResource.key === resource.key ? null : sourceResource.key,
          rewrites: graphIdentityRewrite.rewrites,
        };
      }
      if (isPluginOwnedDataResource(resource, owner)) {
        const support = pluginOwnedResourcePolicy.supportFor(resource, owner);
        const ownerContext = pluginOwnerContextEvidence({
          owner,
          resources,
          base,
          local,
          remote,
        });
        mutation.pluginOwnedResource = {
          pluginOwner: owner,
          driver: support.driver,
          policySource: support.policySource,
          supportsDelete: support.supportsDelete,
          ownerContext,
          ownerContextRequired: ownerContext.length > 0,
          auditEvidence: pluginOwnedDriverAuditEvidence({
            resource,
            owner,
            support,
            baseHash,
            localHash,
            remoteHash,
            ownerContext,
          }),
          driverAuditEvidence: pluginOwnedDriverDecisionAuditEvidence({
            resource,
            owner,
            support,
            action: localValue === ABSENT ? 'delete' : 'put',
            decision: 'supported',
            reasonCode: 'PLUGIN_DRIVER_DECISION_SUPPORTED',
            baseHash,
            localHash,
            remoteHash,
          }),
          driverEvidence: support.driverEvidence,
          ...(support.driverPayloadValidationEvidence
            ? { driverPayloadValidationEvidence: support.driverPayloadValidationEvidence }
            : {}),
          ...(support.dryRunValidationEvidence
            ? { dryRunValidationEvidence: support.dryRunValidationEvidence }
            : {}),
          ...(support.applyValidationEvidence
            ? { applyValidationEvidence: support.applyValidationEvidence }
            : {}),
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

      const supported = candidates.find((entry) =>
        (SUPPORTED_PLUGIN_DATA_DRIVERS.has(entry.driver) || (entry.driver && entry.table))
        && pluginOwnedPolicyEntryMatchesResource(entry, resource, owner));
      if (!supported) {
        if (withDriver.driver === 'fixture-forms-lab-table') {
          const driverEvidence = fixtureFormsLabTableDriverEvidence({
            resource,
            owner,
            base,
            local,
            remote,
          });
          return {
            supported: false,
            className: 'unsupported-plugin-owned-resource',
            driver: withDriver.driver,
            policySource: withDriver.source,
            reason: driverEvidence.reason,
            driverEvidence,
            ...(driverEvidence.dryRunValidationEvidence
              ? { driverDryRunValidationEvidence: driverEvidence.dryRunValidationEvidence }
              : {}),
          };
        }
        return {
          supported: false,
          className: 'unsupported-plugin-owned-resource',
          driver: withDriver.driver,
          policySource: withDriver.source,
          reason: 'Plugin-owned resource driver does not match the resource type or table.',
        };
      }

      const serializedOptionValidationEvidence = supported.driver === 'wp-option'
        ? serializedOptionValidationEvidenceForRows({
          resourceKey: resource.key,
          table: resource.table,
          rows: [
            { snapshot: 'base', row: getResource(base, resource) },
            { snapshot: 'local', row: getResource(local, resource) },
            { snapshot: 'remote', row: getResource(remote, resource) },
          ],
        })
        : null;
      const driverPayloadValidationEvidence = serializedOptionValidationEvidence?.serialized
        ? pluginDriverPayloadValidationEvidence(serializedOptionValidationEvidence)
        : null;
      if (serializedOptionValidationEvidence && !serializedOptionValidationEvidence.valid) {
        return {
          supported: false,
          className: 'invalid-plugin-driver-payload',
          reasonCode: 'INVALID_SERIALIZED_OPTION_PAYLOAD',
          driver: supported.driver,
          policySource: supported.source,
          reason: `Serialized option validator refused ${resource.key}: ${serializedOptionValidationEvidence.reasonCode}.`,
          serializedOptionValidationEvidence,
          driverPayloadValidationEvidence,
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
            driverEvidence,
            ...(driverEvidence.dryRunValidationEvidence
              ? { driverDryRunValidationEvidence: driverEvidence.dryRunValidationEvidence }
              : {}),
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

      const driverEvidence = pluginOwnedMetaDriverEvidence({
        resource,
        owner,
        driver: supported.driver,
        policySource: supported.source,
        evidenceScope: supported.evidenceScope,
        row: getResource(local, resource),
      });
      if (driverEvidence && !driverEvidence.supported) {
        return {
          supported: false,
          className: 'unsupported-plugin-owned-resource',
          driver: supported.driver,
          policySource: supported.source,
          reason: driverEvidence.reason,
          driverEvidence,
        };
      }

      const dryRunValidationEvidence = pluginDriverHookValidationEvidence({
        kind: 'dry-run',
        validation: supported.dryRunValidation,
        resource,
        owner,
        driver: supported.driver,
        policySource: supported.source,
      });
      if (dryRunValidationEvidence?.reasonCode === 'PLUGIN_DRIVER_DRY_RUN_VALIDATION_UNSUPPORTED') {
        return {
          supported: false,
          className: 'unsupported-plugin-owned-resource',
          driver: supported.driver,
          policySource: supported.source,
          reason: 'Plugin-owned resource driver dry-run validation hook is not supported.',
          dryRunValidationEvidence,
        };
      }
      if (dryRunValidationEvidence?.reasonCode === 'PLUGIN_DRIVER_DRY_RUN_VALIDATION_FAILED') {
        return {
          supported: false,
          className: 'unsupported-plugin-owned-resource',
          driver: supported.driver,
          policySource: supported.source,
          reason: 'Plugin-owned resource driver dry-run validation hook did not pass.',
          dryRunValidationEvidence,
        };
      }

      const applyValidationEvidence = pluginDriverHookValidationEvidence({
        kind: 'apply',
        validation: supported.applyValidation,
        resource,
        owner,
        driver: supported.driver,
        policySource: supported.source,
      });

      return {
        supported: true,
        driver: supported.driver,
        policySource: supported.source,
        supportsDelete: supported.supportsDelete === true,
        ...(driverEvidence ? { driverEvidence } : {}),
        ...(serializedOptionValidationEvidence?.serialized ? { serializedOptionValidationEvidence } : {}),
        ...(driverPayloadValidationEvidence ? { driverPayloadValidationEvidence } : {}),
        ...(dryRunValidationEvidence ? { dryRunValidationEvidence } : {}),
        ...(applyValidationEvidence ? { applyValidationEvidence } : {}),
      };
    },
  };
}

function pluginOwnedPolicyEntriesFromSnapshot(snapshot, source) {
  const evidenceScope = snapshot?.meta?.evidenceScope || null;
  return normalizePluginOwnedPolicy(snapshot?.meta?.pushPolicy, source, evidenceScope)
    .concat(normalizePluginOwnedPolicy(snapshot?.meta?.resourcePolicy, source, evidenceScope))
    .concat(normalizePluginOwnedPolicy(snapshot?.meta?.pluginOwnedResources, source, evidenceScope));
}

function pluginOwnedPolicyEntriesFromIntent(intent) {
  const source = `push-intent:${intent.id || 'unlabeled'}`;
  const evidenceScope = intent.evidenceScope || intent.releaseGateEvidenceScope || null;
  return normalizePluginOwnedPolicy(intent.resourcePolicy, source, evidenceScope)
    .concat(normalizePluginOwnedPolicy(intent.pushPolicy, source, evidenceScope))
    .concat(normalizePluginOwnedPolicy(intent.pluginOwnedResources, source, evidenceScope));
}

function normalizePluginOwnedPolicy(policy, source, evidenceScope = null) {
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
    .map((entry) => normalizePluginOwnedPolicyEntry(entry, source, pluginOwnedResources.evidenceScope || evidenceScope))
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

function normalizePluginOwnedPolicyEntry(entry, source, evidenceScope = null) {
  if (typeof entry === 'string') {
    return { resourceKey: entry, source, evidenceScope: evidenceScope || 'local-candidate' };
  }
  if (!entry || typeof entry !== 'object') {
    return { source, evidenceScope: evidenceScope || 'local-candidate' };
  }
  return {
    resourceKey: entry.resourceKey || entry.key || entry.resource?.key || null,
    pluginOwner: entry.pluginOwner || entry.owner || entry.plugin || null,
    driver: entry.driver || entry.supportedDriver || entry.resourceDriver || null,
    table: entry.table || entry.resource?.table || null,
    supportsDelete: entry.supportsDelete === true || entry.delete === true || entry.allowDelete === true,
    dryRunValidation: entry.dryRunValidation || null,
    applyValidation: entry.applyValidation || null,
    evidenceScope: entry.evidenceScope || entry.releaseGateEvidenceScope || evidenceScope || 'local-candidate',
    source,
  };
}

function pluginOwnedPolicyEntryMatchesResource(entry, resource, owner) {
  if (entry.pluginOwner !== owner) {
    return false;
  }

  if (entry.driver === 'fixture-forms-lab-table') {
    return resource.type === 'row'
      && resource.table === 'wp_reprint_push_forms_lab'
      && (!entry.table || entry.table === 'wp_reprint_push_forms_lab')
      && /^id:\d+$/.test(resource.id)
      && owner === 'forms'
      && entry.pluginOwner === 'forms';
  }

  const expectedTable = PLUGIN_DATA_DRIVER_TABLES.get(entry.driver);
  if (expectedTable) {
    return resource.type === 'row'
      && resource.table === expectedTable
      && (!entry.table || entry.table === expectedTable);
  }

  if (entry.table) {
    return resource.type === 'row' && resource.table === entry.table;
  }

  return false;
}

function fixtureFormsLabTableDriverEvidence({ resource, owner, base, local, remote }) {
  if (
    resource.type !== 'row'
    || resource.table !== 'wp_reprint_push_forms_lab'
    || !/^id:[1-9]\d*$/.test(resource.id)
    || owner !== 'forms'
  ) {
    return { supported: false, reason: 'Fixture forms lab table driver only supports positive id rows owned by forms.' };
  }

  const dryRunValidationEvidence = fixtureFormsLabTableDryRunValidationEvidence({
    resource,
    owner,
    base,
    local,
    remote,
  });
  if (dryRunValidationEvidence.outcome !== 'accepted') {
    return {
      supported: false,
      reason: 'Fixture forms lab table driver dry-run validation refused the planned row payload.',
      dryRunValidationEvidence,
    };
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
      dryRunValidationEvidence,
    };
  }

  return {
    supported: false,
    reason: 'Fixture forms lab table driver requires unchanged active reprint-push-forms-fixture evidence.',
    dryRunValidationEvidence,
  };
}

function fixtureFormsLabTableDryRunValidationEvidence({ resource, owner, base, local, remote }) {
  const plannedValue = getResource(local, resource);
  const issueCodes = fixtureFormsLabTableDryRunValidationIssueCodes(resource, owner, plannedValue);
  const accepted = issueCodes.length === 0;
  return {
    schemaVersion: 1,
    reasonCode: accepted
      ? 'PLUGIN_DRIVER_DRY_RUN_VALIDATION_ACCEPTED'
      : 'PLUGIN_DRIVER_DRY_RUN_VALIDATION_REFUSED',
    operation: 'driver-dry-run-validation',
    outcome: accepted ? 'accepted' : 'refused-before-mutation',
    resourceKey: resource.key,
    pluginOwner: owner,
    driver: 'fixture-forms-lab-table',
    resource: pluginDriverResourceEvidence(resource),
    rawValuesIncluded: false,
    issueCodes,
    planned: {
      state: plannedValue === ABSENT ? 'absent' : 'present',
      hash: resourceHash(local, resource),
    },
    base: {
      state: getResource(base, resource) === ABSENT ? 'absent' : 'present',
      hash: resourceHash(base, resource),
    },
    remote: {
      state: getResource(remote, resource) === ABSENT ? 'absent' : 'present',
      hash: resourceHash(remote, resource),
    },
  };
}

function fixtureFormsLabTableDryRunValidationIssueCodes(resource, owner, plannedValue) {
  const issues = [];
  const idMatch = /^id:([1-9]\d*)$/.exec(resource.id || '');
  if (plannedValue === ABSENT || !plannedValue || typeof plannedValue !== 'object' || Array.isArray(plannedValue)) {
    issues.push('PLANNED_ROW_INVALID');
    return issues;
  }
  if (plannedValue.__pluginOwner !== owner) {
    issues.push('PLUGIN_OWNER_MISMATCH');
  }
  if (idMatch && plannedValue.id !== Number.parseInt(idMatch[1], 10)) {
    issues.push('ROW_ID_MISMATCH');
  }
  if (typeof plannedValue.form_slug !== 'string' || plannedValue.form_slug.length === 0) {
    issues.push('FORM_SLUG_INVALID');
  }
  if (!plannedValue.payload || typeof plannedValue.payload !== 'object' || Array.isArray(plannedValue.payload)) {
    issues.push('PAYLOAD_INVALID');
  } else if (plannedValue.payload.owner !== owner) {
    issues.push('PAYLOAD_OWNER_MISMATCH');
  }
  return issues;
}

function pluginDriverResourceEvidence(resource) {
  if (!resource || typeof resource !== 'object') {
    return null;
  }
  return {
    type: resource.type || null,
    key: resource.key || null,
    table: resource.table || null,
    id: resource.id || null,
    name: resource.name || null,
  };
}

function pluginOwnedDriverAuditEvidence({
  resource,
  owner,
  support,
  baseHash,
  localHash,
  remoteHash,
  ownerContext,
}) {
  return {
    schemaVersion: 1,
    evidenceSource: 'planner-plugin-driver-audit',
    format: 'hash-only',
    rawValuesIncluded: false,
    resourceKey: resource.key,
    pluginOwner: owner,
    driver: support.driver,
    policySource: support.policySource,
    supportsDelete: support.supportsDelete === true,
    baseHash,
    localHash,
    remoteHash,
    ownerContextHash: digest(ownerContext || []),
    ...(support.driverEvidence ? { driverEvidenceHash: digest(support.driverEvidence) } : {}),
    ...(support.serializedOptionValidationEvidence
      ? { serializedOptionValidationHash: digest(support.serializedOptionValidationEvidence) }
      : {}),
    ...(support.driverPayloadValidationEvidence
      ? { driverPayloadValidationHash: digest(support.driverPayloadValidationEvidence) }
      : {}),
  };
}

function pluginOwnedDriverDecisionAuditEvidence({
  resource,
  owner,
  support,
  action,
  decision,
  reasonCode,
  baseHash,
  localHash,
  remoteHash,
}) {
  return {
    reasonCode,
    operation: 'plugin-driver-audit',
    decision,
    resourceKey: resource.key,
    pluginOwner: owner,
    driver: support.driver || null,
    policySource: support.policySource || null,
    action,
    redaction: 'hash-only',
    rawValuesIncluded: false,
    hashes: {
      baseHash,
      localHash,
      remoteHash,
    },
  };
}

function pluginDriverPayloadValidationEvidence(serializedOptionValidationEvidence) {
  return {
    ...serializedOptionValidationEvidence,
    validator: 'php-serialized-option',
    outcome: serializedOptionValidationEvidence.valid ? 'accepted' : 'refused',
  };
}

function pluginDriverHookValidationEvidence({
  kind,
  validation,
  resource,
  owner,
  driver,
  policySource,
}) {
  if (!validation) {
    return null;
  }
  const hook = validation.hook || null;
  const status = validation.status || null;
  const supportedHook = kind === 'dry-run'
    ? hook === 'wp-option:validate-row'
    : hook === 'wp-option:validate-apply';
  const passed = supportedHook && status === 'passed';
  const failed = supportedHook && status !== 'passed';
  const reasonCode = kind === 'dry-run'
    ? passed
      ? 'PLUGIN_DRIVER_DRY_RUN_VALIDATION_PASSED'
      : failed
        ? 'PLUGIN_DRIVER_DRY_RUN_VALIDATION_FAILED'
        : 'PLUGIN_DRIVER_DRY_RUN_VALIDATION_UNSUPPORTED'
    : passed
      ? 'PLUGIN_DRIVER_APPLY_VALIDATION_PASSED'
      : failed
        ? 'PLUGIN_DRIVER_APPLY_VALIDATION_FAILED'
        : 'PLUGIN_DRIVER_APPLY_VALIDATION_UNSUPPORTED';
  return {
    reasonCode,
    operation: kind === 'dry-run' && !passed ? 'refuse-before-mutation' : `${kind}-validation`,
    resourceKey: resource.key,
    pluginOwner: owner,
    driver,
    policySource,
    hook,
    supportedHook,
    status,
  };
}

function pluginOwnedMetaDriverEvidence({
  resource,
  owner,
  driver,
  policySource,
  evidenceScope,
  row,
}) {
  if (driver === 'wp-postmeta' || driver === 'wp-post-meta') {
    return pluginOwnedPostmetaDriverEvidence({
      resource,
      owner,
      driver,
      policySource,
      evidenceScope,
      row,
    });
  }
  if (driver === 'wp-termmeta' || driver === 'wp-term-meta') {
    return pluginOwnedTermmetaDriverEvidence({
      resource,
      owner,
      driver,
      policySource,
      evidenceScope,
      row,
    });
  }
  return null;
}

function pluginOwnedPostmetaDriverEvidence({ resource, owner, driver, policySource, evidenceScope, row }) {
  const scope = evidenceScope || 'local-candidate';
  const evidence = {
    supported: true,
    driver,
    table: resource.table,
    resourceKey: resource.key,
    rowId: resource.id,
    pluginOwner: owner,
    policySource,
    evidenceScope: scope,
    releaseGateEvidenceScope: scope,
  };
  const postMetaKeyMatch = /^post_id:([1-9]\d*):meta_key:(.+)$/.exec(resource.id || '');
  if (postMetaKeyMatch) {
    evidence.rowIdKind = 'post_id_meta_key';
    evidence.postId = Number.parseInt(postMetaKeyMatch[1], 10);
    evidence.metaKey = postMetaKeyMatch[2];
    if (!row || row === ABSENT || typeof row !== 'object') {
      return evidence;
    }
    if (Number(row.post_id) !== evidence.postId || row.meta_key !== evidence.metaKey) {
      return {
        ...evidence,
        supported: false,
        reason: 'wp_postmeta driver requires row post_id and meta_key to match the resource id.',
      };
    }
    return evidence;
  }

  const metaIdMatch = /^meta_id:([1-9]\d*)$/.exec(resource.id || '');
  if (!metaIdMatch) {
    return {
      ...evidence,
      rowIdKind: null,
      supported: false,
      reason: 'wp_postmeta driver requires row id post_id:<positive-int>:meta_key:<key> or meta_id:<positive-int>.',
    };
  }
  evidence.rowIdKind = 'meta_id';
  const metaId = Number.parseInt(metaIdMatch[1], 10);
  if (!row || row === ABSENT || typeof row !== 'object') {
    return evidence;
  }
  evidence.postId = row.post_id ?? null;
  evidence.metaKey = row.meta_key ?? null;
  if (Number(row.meta_id) !== metaId) {
    return {
      ...evidence,
      supported: false,
      reason: 'wp_postmeta driver requires row meta_id to match the resource id.',
    };
  }
  return evidence;
}

function pluginOwnedTermmetaDriverEvidence({ resource, owner, driver, policySource, evidenceScope, row }) {
  const scope = evidenceScope || 'local-candidate';
  const evidence = {
    supported: true,
    driver,
    table: resource.table,
    resourceKey: resource.key,
    rowId: resource.id,
    rowIdKind: 'meta_id',
    pluginOwner: owner,
    policySource,
    evidenceScope: scope,
    releaseGateEvidenceScope: scope,
  };
  const match = /^meta_id:([1-9]\d*)$/.exec(resource.id || '');
  if (!match) {
    return {
      ...evidence,
      supported: false,
      reason: 'wp_termmeta driver requires row id meta_id:<positive-int>.',
    };
  }
  const metaId = Number.parseInt(match[1], 10);
  if (row && row !== ABSENT && typeof row === 'object') {
    evidence.termId = row.term_id ?? null;
    evidence.metaKey = row.meta_key ?? null;
    if (Number(row.meta_id) !== metaId) {
      return {
        ...evidence,
        supported: false,
        reason: 'wp_termmeta driver requires row meta_id to match the resource id.',
      };
    }
  }
  return evidence;
}

function buildAtomicGroup(intent, plan, base, remote) {
  const groupResourceKeys = new Set(intent.resources || []);
  const groupMutations = plan.mutations
    .filter((mutation) => mutation.atomicGroupId === intent.id);
  const mutationIds = groupMutations.map((mutation) => mutation.id);
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

  blockers.push(...propagateAtomicGroupBlockers(intent, groupMutations, blockers));

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

function propagateAtomicGroupBlockers(intent, groupMutations, sourceBlockers) {
  if (intent.requireAtomic === false || sourceBlockers.length === 0) {
    return [];
  }

  const directlyBlockedResourceKeys = new Set(
    sourceBlockers
      .map((blocker) => blocker.resourceKey)
      .filter(Boolean),
  );
  const sourceBlockerIds = sourceBlockers.map((blocker) => blocker.id).filter(Boolean);

  return groupMutations
    .filter((mutation) => !directlyBlockedResourceKeys.has(mutation.resourceKey))
    .map((mutation) => ({
      id: `blocker-${intent.id}-${mutation.id}-atomic-group-propagation`,
      class: 'atomic-group-blocker-propagation',
      groupId: intent.id,
      mutationId: mutation.id,
      resourceKey: mutation.resourceKey,
      sourceBlockerIds,
      reason: `Atomic push intent ${intent.id} is blocked; mutation ${mutation.id} cannot be applied independently of the group.`,
    }));
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
    const baseHash = resourceHash(base, pluginResource);
    const remoteHash = resourceHash(remote, pluginResource);
    blockers.push(pluginDependencyBlocker({
      intent,
      dependency,
      dependencyIndex,
      className: 'missing-plugin-dependency',
      reason: `Atomic push intent ${intent.id} requires plugin ${plugin}, but it is absent from the live remote.`,
      extra: {
        remotePluginRemovalRefusalEvidence: remotePluginRemovalDependencyRefusalEvidence({
          intent,
          plugin,
          pluginResource,
          baseHash,
          remoteHash,
        }),
      },
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

function remotePluginRemovalDependencyRefusalEvidence({
  intent,
  plugin,
  pluginResource,
  baseHash,
  remoteHash,
}) {
  return {
    reasonCode: 'REMOTE_PLUGIN_REMOVAL_REFUSAL',
    operation: 'refuse-before-mutation',
    groupId: intent.id,
    plugin,
    resourceKey: pluginResource.key,
    dependencySource: 'atomic-push-intent',
    local: {
      label: 'local-snapshot-or-plan',
      source: 'planner-decision',
      state: 'present',
      change: 'unchanged',
      hash: baseHash,
    },
    production: {
      label: 'live-production-remote',
      source: 'live-remote',
      state: 'absent',
      change: 'delete',
      hash: remoteHash,
    },
    baseHash,
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
  'registration_log',
  'blog_versions',
  'commentmeta',
  'sitemeta',
  'blogmeta',
  'comments',
  'term_relationships',
  'term_taxonomy',
  'postmeta',
  'usermeta',
  'users',
  'termmeta',
  'links',
  'blogs',
  'site',
  'posts',
  'terms',
];

const SUPPORTED_CORE_POST_OBJECT_TAXONOMIES = new Set([
  'category',
  'post_tag',
  'post_format',
]);

const UNSUPPORTED_WORDPRESS_POST_GRAPH_SURFACES = new Set([
  'nav_menu_item',
  'revision',
  'wp_navigation',
]);

const UNSUPPORTED_WORDPRESS_MENU_ITEM_META_KEYS = new Set([
  '_menu_item_object',
  '_menu_item_object_id',
  '_menu_item_menu_item_parent',
  '_menu_item_type',
  'menu_item_parent',
]);

const SERIALIZED_BLOCK_REFERENCE_KEYS = new Set([
  'attachmentId',
  'attachment_id',
  'id',
  'ids',
  'mediaId',
  'media_id',
  'pageId',
  'page_id',
  'postId',
  'post_id',
  'ref',
]);

export const SUPPORTED_WORDPRESS_GRAPH_IDENTITY_MAP_TABLE_SUFFIXES = Object.freeze([
  'posts',
  'users',
  'comments',
  'terms',
  'term_taxonomy',
  'site',
  'blogs',
]);

export const WORDPRESS_GRAPH_IDENTITY_FAIL_CLOSED_COLLISION_SURFACES = Object.freeze([
  'wp_posts.guid',
  'wp_posts.post_type+post_name',
]);

const WORDPRESS_GRAPH_IDENTITY_MAP_TABLE_SUFFIXES = new Set(
  SUPPORTED_WORDPRESS_GRAPH_IDENTITY_MAP_TABLE_SUFFIXES,
);

function buildWordPressGraphIdentityMap({ base, local, remote }) {
  const identityMap = {
    entries: [],
    bySourceKey: new Map(),
    byTargetKey: new Map(),
    collisionsByResourceKey: new Map(),
  };

  const entries = [
    ...wordpressGraphIdentityMapEntriesFromSnapshot(base, 'base-snapshot.meta'),
    ...wordpressGraphIdentityMapEntriesFromSnapshot(local, 'local-snapshot.meta'),
    ...wordpressGraphIdentityMapEntriesFromSnapshot(remote, 'remote-snapshot.meta'),
  ];
  const sourceCounts = countBy(entries, (entry) => entry.sourceResource.key);
  const targetCounts = countBy(entries, (entry) => entry.targetResource.key);
  for (const entry of entries) {
    identityMap.bySourceKey.set(entry.sourceResource.key, entry);
  }
  identityMap.byTargetKey = new Map();

  for (const entry of entries) {
    const duplicateSupport = duplicateWordPressGraphIdentityMapSupport(entry, sourceCounts, targetCounts);
    const support = duplicateSupport || validateWordPressGraphIdentityMapEntry(entry, {
      base,
      local,
      remote,
      identityMap,
    });
    const mapping = {
      ...entry,
      usable: support.supported,
      support,
      sourceBaseHash: resourceHash(base, entry.sourceResource),
      sourceLocalHash: resourceHash(local, entry.sourceResource),
      sourceRemoteHash: resourceHash(remote, entry.sourceResource),
      targetBaseHash: resourceHash(base, entry.targetResource),
      targetLocalHash: resourceHash(local, entry.targetResource),
      targetRemoteHash: resourceHash(remote, entry.targetResource),
    };
    identityMap.entries.push(mapping);
    identityMap.bySourceKey.set(mapping.sourceResource.key, mapping);
    if (!identityMap.byTargetKey.has(mapping.targetResource.key)) {
      identityMap.byTargetKey.set(mapping.targetResource.key, []);
    }
    identityMap.byTargetKey.get(mapping.targetResource.key).push(mapping);
  }

  addWordPressGraphNaturalIdentityCollisions(identityMap, { base, local, remote });
  return identityMap;
}

function wordpressGraphIdentityMapEntriesFromSnapshot(snapshot, source) {
  const maps = [
    snapshot?.meta?.wordpressGraphIdentityMap,
    snapshot?.meta?.graphIdentityMap,
    snapshot?.meta?.pushIdentityMap,
  ];
  return maps.flatMap((map, index) =>
    normalizeWordPressGraphIdentityMap(map, `${source}.identityMap[${index}]`));
}

function normalizeWordPressGraphIdentityMap(map, source) {
  if (!map) {
    return [];
  }
  if (Array.isArray(map)) {
    return map
      .map((entry, index) => normalizeWordPressGraphIdentityMapEntry(entry, `${source}.rows[${index}]`))
      .filter(Boolean);
  }
  if (Array.isArray(map.rows)) {
    return map.rows
      .map((entry, index) => normalizeWordPressGraphIdentityMapEntry(entry, `${source}.rows[${index}]`))
      .filter(Boolean);
  }
  if (Array.isArray(map.resources)) {
    return map.resources
      .map((entry, index) => normalizeWordPressGraphIdentityMapEntry(entry, `${source}.resources[${index}]`))
      .filter(Boolean);
  }
  if (typeof map === 'object') {
    return Object.entries(map)
      .map(([sourceResourceKey, target], index) =>
        normalizeWordPressGraphIdentityMapEntry({
          sourceResourceKey,
          targetResourceKey: typeof target === 'string' ? target : target?.targetResourceKey,
          targetResource: typeof target === 'object' ? target?.targetResource : null,
          remoteResource: typeof target === 'object' ? target?.remoteResource : null,
          remote: typeof target === 'object' ? target?.remote : null,
          to: typeof target === 'object' ? target?.to : null,
          target: typeof target === 'object' ? target?.target : null,
          table: typeof target === 'object' ? target?.table : null,
          remoteId: typeof target === 'object' ? target?.remoteId : null,
          targetId: typeof target === 'object' ? target?.targetId : null,
          toId: typeof target === 'object' ? target?.toId : null,
        }, `${source}.entry[${index}]`))
      .filter(Boolean);
  }
  return [];
}

function normalizeWordPressGraphIdentityMapEntry(entry, source) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const sourceResource = normalizeWordPressGraphIdentityMapResource(
    entry.sourceResource
      || entry.localResource
      || entry.fromResource
      || entry.sourceResourceKey
      || entry.localResourceKey
      || entry.fromResourceKey
      || entry.local
      || entry.from,
    entry.table || entry.sourceTable || entry.localTable || entry.fromTable,
    entry.localId || entry.sourceId || entry.fromId,
  );
  const targetResource = normalizeWordPressGraphIdentityMapResource(
    entry.targetResource
      || entry.remoteResource
      || entry.toResource
      || entry.targetResourceKey
      || entry.remoteResourceKey
      || entry.toResourceKey
      || entry.remote
      || entry.to
      || entry.target,
    entry.table || entry.targetTable || entry.remoteTable || entry.toTable,
    entry.remoteId || entry.targetId || entry.toId,
  );
  if (
    !sourceResource
    || !targetResource
    || sourceResource.type !== 'row'
    || targetResource.type !== 'row'
    || sourceResource.key === targetResource.key
  ) {
    return null;
  }
  const sourcePrimaryValue = wordpressGraphResourcePrimaryInteger(sourceResource);
  const targetPrimaryValue = wordpressGraphResourcePrimaryInteger(targetResource);
  if (sourcePrimaryValue == null || targetPrimaryValue == null) {
    return null;
  }
  return {
    source,
    sourceResource,
    targetResource,
    sourcePrimaryValue,
    targetPrimaryValue,
  };
}

function normalizeWordPressGraphIdentityMapResource(resource, fallbackTable, fallbackId) {
  if (typeof resource === 'string' && resource.startsWith('row:')) {
    return parseWordPressGraphRowResourceKey(resource);
  }
  if (resource && typeof resource === 'object') {
    if (resource.type === 'row' && resource.table && resource.id) {
      return rowResource(resource.table, resource.id);
    }
    if (typeof resource.resourceKey === 'string') {
      return parseWordPressGraphRowResourceKey(resource.resourceKey);
    }
    if (typeof resource.key === 'string') {
      return parseWordPressGraphRowResourceKey(resource.key);
    }
    if (resource.table && (resource.id || resource.rowId)) {
      return rowResource(resource.table, resource.id || resource.rowId);
    }
  }
  if (fallbackTable && fallbackId) {
    return rowResource(fallbackTable, fallbackId);
  }
  return null;
}

function parseWordPressGraphRowResourceKey(resourceKey) {
  if (typeof resourceKey !== 'string' || !resourceKey.startsWith('row:')) {
    return null;
  }
  try {
    const [table, id] = JSON.parse(resourceKey.slice('row:'.length));
    if (typeof table === 'string' && typeof id === 'string') {
      return rowResource(table, id);
    }
  } catch {
    return null;
  }
  return null;
}

function rowResource(table, id) {
  return {
    type: 'row',
    table,
    id,
    key: `row:${JSON.stringify([table, id])}`,
  };
}

function countBy(values, keyFn) {
  const counts = new Map();
  for (const value of values) {
    const key = keyFn(value);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function duplicateWordPressGraphIdentityMapSupport(entry, sourceCounts, targetCounts) {
  const duplicateSource = sourceCounts.get(entry.sourceResource.key) > 1;
  const duplicateTarget = targetCounts.get(entry.targetResource.key) > 1;
  if (!duplicateSource && !duplicateTarget) {
    return null;
  }
  return {
    supported: false,
    className: 'stale-wordpress-graph-identity',
    reason: `WordPress graph identity map for ${entry.sourceResource.key} is ambiguous because ${duplicateSource ? 'the source row' : 'the target row'} appears in multiple mappings.`,
    references: [
      wordpressGraphIdentityMapReferenceEvidence(entry, {
        className: 'ambiguous-wordpress-graph-identity-map',
      }),
    ],
  };
}

function validateWordPressGraphIdentityMapEntry(entry, { base, local, remote, identityMap }) {
  const sourceSuffix = wordpressGraphTableSuffix(entry.sourceResource.table);
  const targetSuffix = wordpressGraphTableSuffix(entry.targetResource.table);
  if (
    !sourceSuffix
    || !targetSuffix
    || sourceSuffix !== targetSuffix
    || !WORDPRESS_GRAPH_IDENTITY_MAP_TABLE_SUFFIXES.has(sourceSuffix)
  ) {
    return wordpressGraphIdentityMapUnsupported(entry, 'uses an unsupported graph identity map table surface');
  }

  const sourceLocalValue = getResource(local, entry.sourceResource);
  const sourceRemoteValue = getResource(remote, entry.sourceResource);
  const targetRemoteValue = getResource(remote, entry.targetResource);
  if (sourceLocalValue === ABSENT) {
    return wordpressGraphIdentityMapUnsupported(entry, 'does not have a local source row to map');
  }
  if (sourceRemoteValue !== ABSENT) {
    return wordpressGraphIdentityMapUnsupported(entry, 'would leave a same-id remote source row ambiguous');
  }
  if (targetRemoteValue === ABSENT) {
    return wordpressGraphIdentityMapUnsupported(entry, 'does not have a remote target row to preserve');
  }
  if (!wordpressGraphRowsEquivalentUnderIdentityMap({
    sourceResource: entry.sourceResource,
    targetResource: entry.targetResource,
    sourceValue: sourceLocalValue,
    targetValue: targetRemoteValue,
    identityMap,
  })) {
    return wordpressGraphIdentityMapUnsupported(entry, 'points at a remote target row that is not equivalent after identity rewriting');
  }
  return {
    supported: true,
    references: [
      wordpressGraphIdentityMapReferenceEvidence(entry, {
        targetBaseHash: resourceHash(base, entry.targetResource),
        targetLocalHash: resourceHash(local, entry.targetResource),
        targetRemoteHash: resourceHash(remote, entry.targetResource),
      }),
    ],
  };
}

function wordpressGraphIdentityMapUnsupported(entry, reason) {
  return {
    supported: false,
    className: 'stale-wordpress-graph-identity',
    reason: `WordPress graph identity map for ${entry.sourceResource.key} ${reason}.`,
    references: [
      wordpressGraphIdentityMapReferenceEvidence(entry, {
        className: 'unsupported-wordpress-graph-identity-map',
      }),
    ],
  };
}

function wordpressGraphIdentityMapReferenceEvidence(entry, extra = {}) {
  return {
    relationshipKey: 'wordpress-identity-map.target',
    relationshipType: 'identity-map-target',
    sourceResourceKey: entry.sourceResource.key,
    targetResourceKey: entry.targetResource.key,
    targetTable: entry.targetResource.table,
    targetId: entry.targetResource.id,
    identityMapSource: entry.source,
    ...extra,
  };
}

function wordpressGraphRowsEquivalentUnderIdentityMap({
  sourceResource,
  targetResource,
  sourceValue,
  targetValue,
  identityMap,
}) {
  return digest(normalizeWordPressGraphRowForIdentityComparison(sourceResource, sourceValue, identityMap))
    === digest(normalizeWordPressGraphRowForIdentityComparison(targetResource, targetValue, identityMap));
}

function normalizeWordPressGraphRowForIdentityComparison(resource, value, identityMap) {
  if (!value || value === ABSENT || typeof value !== 'object') {
    return value;
  }
  const normalized = deepClone(value);
  const mapping = identityMap.bySourceKey.get(resource.key);
  const suffix = wordpressGraphTableSuffix(resource.table);
  const primaryField = suffix ? wordpressGraphPrimaryIdField(suffix) : null;
  if (
    mapping
    && primaryField
    && normalizePositiveInteger(normalized[primaryField]) === mapping.sourcePrimaryValue
  ) {
    normalized[primaryField] = preserveWordPressGraphIdScalarType(
      normalized[primaryField],
      mapping.targetPrimaryValue,
    );
  }

  for (const reference of wordpressGraphReferences(resource, normalized)) {
    const referenceMapping = identityMap.bySourceKey.get(reference.targetResourceKey);
    if (!referenceMapping) {
      continue;
    }
    normalized[reference.field] = preserveWordPressGraphIdScalarType(
      normalized[reference.field],
      referenceMapping.targetPrimaryValue,
    );
  }
  return normalized;
}

function addWordPressGraphNaturalIdentityCollisions(identityMap, { base, local, remote }) {
  for (const [table, rows] of Object.entries(local?.db || {})) {
    if (wordpressGraphTableSuffix(table) !== 'posts') {
      continue;
    }
    for (const [id, localValue] of Object.entries(rows || {})) {
      const resource = rowResource(table, id);
      if (
        resourceHash(local, resource) === resourceHash(base, resource)
        || identityMap.bySourceKey.has(resource.key)
      ) {
        continue;
      }
      const collision = wordpressGraphPostIdentityCollision(resource, localValue, remote);
      if (collision) {
        identityMap.collisionsByResourceKey.set(resource.key, collision);
      }
    }
  }
}

function wordpressGraphPostIdentityCollision(resource, localValue, remote) {
  if (!localValue || localValue === ABSENT || typeof localValue !== 'object') {
    return null;
  }
  const identityKeys = wordpressGraphPostNaturalIdentityKeys(localValue);
  if (identityKeys.length === 0) {
    return null;
  }
  const matches = [];
  for (const [remoteId, remoteValue] of Object.entries(remote?.db?.[resource.table] || {})) {
    const remoteResource = rowResource(resource.table, remoteId);
    if (remoteResource.key === resource.key) {
      continue;
    }
    const remoteKeys = wordpressGraphPostNaturalIdentityKeys(remoteValue);
    const matchingKinds = identityKeys
      .filter((identityKey) => remoteKeys.some((remoteKey) => remoteKey.key === identityKey.key))
      .map((identityKey) => identityKey.kind);
    if (matchingKinds.length > 0) {
      matches.push({ resource: remoteResource, kinds: matchingKinds });
    }
  }
  if (matches.length === 0) {
    return null;
  }
  const identityKinds = [...new Set(matches.flatMap((match) => match.kinds))].sort();
  return {
    supported: false,
    className: 'stale-wordpress-graph-identity',
    reason: `WordPress graph mutation ${resource.key} collides with existing remote post identity (${identityKinds.join(', ')}) without a proven identity map.`,
    references: matches.map((match) => ({
      relationshipKey: 'wp_posts.identity',
      relationshipType: 'post-natural-identity-collision',
      sourceResourceKey: resource.key,
      targetResourceKey: match.resource.key,
      targetTable: match.resource.table,
      targetId: match.resource.id,
      identityKinds: match.kinds,
      targetRemoteHash: resourceHash(remote, match.resource),
    })),
  };
}

function wordpressGraphPostNaturalIdentityKeys(value) {
  if (!value || typeof value !== 'object') {
    return [];
  }
  const keys = [];
  const guid = nonEmptyString(value.guid);
  if (guid) {
    keys.push({ kind: 'guid', key: `guid:${guid}` });
  }
  const postType = nonEmptyString(value.post_type);
  const postName = nonEmptyString(value.post_name);
  if (postType && postName) {
    keys.push({ kind: 'post_type+post_name', key: `post_type:${postType}:post_name:${postName}` });
  }
  return keys;
}

function nonEmptyString(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function rewriteWordPressGraphMutation({ resource, localValue, identityMap }) {
  if (resource.type !== 'row' || localValue === ABSENT || !localValue || typeof localValue !== 'object') {
    return { resource, localValue, rewrites: [] };
  }
  const rewrittenValue = deepClone(localValue);
  const rewrites = [];
  const rewriteByField = new Map();
  for (const reference of wordpressGraphReferences(resource, rewrittenValue)) {
    const mapping = identityMap.bySourceKey.get(reference.targetResourceKey);
    if (!mapping?.usable) {
      continue;
    }
    rewrittenValue[reference.field] = preserveWordPressGraphIdScalarType(
      rewrittenValue[reference.field],
      mapping.targetPrimaryValue,
    );
    rewriteByField.set(reference.field, mapping.targetPrimaryValue);
    rewrites.push({
      relationshipKey: reference.relationshipKey,
      relationshipType: reference.relationshipType,
      field: reference.field,
      sourceTargetResourceKey: mapping.sourceResource.key,
      targetResourceKey: mapping.targetResource.key,
      identityMapSource: mapping.source,
      sourceTargetLocalHash: mapping.sourceLocalHash,
      targetRemoteHash: mapping.targetRemoteHash,
    });
  }
  if (rewrites.length === 0) {
    return { resource, localValue, rewrites: [] };
  }
  const rewrittenResource = rewriteWordPressGraphResourceId(resource, rewriteByField);
  return {
    resource: rewrittenResource,
    localValue: rewrittenValue,
    rewrites: rewrites.map((rewrite) => ({
      ...rewrite,
      sourceResourceKey: resource.key,
      rewrittenResourceKey: rewrittenResource.key,
    })),
  };
}

function rewriteWordPressGraphResourceId(resource, rewriteByField) {
  const suffix = wordpressGraphTableSuffix(resource.table);
  if (suffix === 'postmeta' && rewriteByField.has('post_id')) {
    const match = /^post_id:(\d+):meta_key:(.+)$/.exec(resource.id);
    if (match) {
      return rowResource(resource.table, `post_id:${rewriteByField.get('post_id')}:meta_key:${match[2]}`);
    }
  }
  if (suffix === 'term_relationships') {
    const match = /^object_id:(\d+)\|term_taxonomy_id:(\d+)$/.exec(resource.id);
    if (match) {
      const objectId = rewriteByField.get('object_id') || Number.parseInt(match[1], 10);
      const termTaxonomyId = rewriteByField.get('term_taxonomy_id') || Number.parseInt(match[2], 10);
      return rowResource(resource.table, `object_id:${objectId}|term_taxonomy_id:${termTaxonomyId}`);
    }
  }
  return resource;
}

function preserveWordPressGraphIdScalarType(previousValue, nextValue) {
  return typeof previousValue === 'string' ? String(nextValue) : nextValue;
}

function wordpressGraphIdentitySupport({
  resource,
  localValue,
  resources,
  base,
  local,
  remote,
  identityMap,
  identityRewrites = [],
}) {
  return wordpressGraphResourceSupport({
    resource,
    localValue,
    resources,
    base,
    local,
    remote,
    identityMap,
    identityRewrites,
    seen: new Set([resource.key]),
  });
}

function wordpressGraphResourceSupport({
  resource,
  localValue,
  resources,
  base,
  local,
  remote,
  identityMap,
  identityRewrites = [],
  seen,
}) {
  if (resource.type !== 'row' || localValue === ABSENT) {
    return { supported: true };
  }

  const mappedIdentity = identityMap?.bySourceKey?.get(resource.key);
  if (mappedIdentity && !mappedIdentity.usable) {
    return mappedIdentity.support;
  }

  const surfaceSupport = wordpressGraphSurfaceSupport(resource, localValue);
  if (!surfaceSupport.supported) {
    return surfaceSupport;
  }

  const references = wordpressGraphReferences(resource, localValue);
  if (references.length === 0) {
    return { supported: true };
  }

  const unsafeReferences = references
    .map((reference) =>
      wordpressGraphReferenceEvidence(
        reference,
        resources,
        base,
        local,
        remote,
        seen,
        identityMap,
        identityRewrites,
      ))
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

function wordpressGraphSurfaceSupport(resource, value) {
  if (resource.type !== 'row' || !value || typeof value !== 'object') {
    return { supported: true };
  }

  const suffix = wordpressGraphTableSuffix(resource.table);

  if (suffix === 'posts' && UNSUPPORTED_WORDPRESS_POST_GRAPH_SURFACES.has(value.post_type)) {
    return {
      supported: false,
      className: 'stale-wordpress-graph-identity',
      reason: `WordPress graph mutation ${resource.key} references unsupported post graph surface ${String(value.post_type)}.`,
      references: [],
    };
  }

  if (suffix === 'posts') {
    const serializedBlockReferences = unsupportedSerializedBlockReferences(resource, value);
    if (serializedBlockReferences.length > 0) {
      return {
        supported: false,
        className: 'stale-wordpress-graph-identity',
        reason: `WordPress graph mutation ${resource.key} contains unsupported serialized block references that require parser-aware identity mapping.`,
        references: serializedBlockReferences,
      };
    }
  }

  if (suffix === 'postmeta' && UNSUPPORTED_WORDPRESS_MENU_ITEM_META_KEYS.has(value.meta_key)) {
    return {
      supported: false,
      className: 'stale-wordpress-graph-identity',
      reason: `WordPress graph mutation ${resource.key} references unsupported menu item metadata graph surface ${String(value.meta_key)}.`,
      references: [],
    };
  }

  if (suffix === 'term_taxonomy' && value.taxonomy === 'nav_menu') {
    return {
      supported: false,
      className: 'stale-wordpress-graph-identity',
      reason: `WordPress graph mutation ${resource.key} references unsupported taxonomy graph surface nav_menu.`,
      references: [],
    };
  }

  if (
    suffix === 'term_taxonomy'
    && !SUPPORTED_CORE_POST_OBJECT_TAXONOMIES.has(value.taxonomy)
  ) {
    return {
      supported: false,
      className: 'stale-wordpress-graph-identity',
      reason: `WordPress graph mutation ${resource.key} references unsupported taxonomy graph surface ${String(value.taxonomy || 'unknown')}.`,
      references: [],
    };
  }

  return { supported: true };
}

function unsupportedSerializedBlockReferences(resource, value) {
  const references = [];
  for (const field of ['post_content', 'post_excerpt']) {
    const content = value[field];
    if (typeof content !== 'string' || !content.includes('<!-- wp:')) {
      continue;
    }
    const blockReferences = serializedBlockReferenceHints(content);
    if (blockReferences.length === 0) {
      continue;
    }
    references.push({
      relationshipKey: `${resource.table}.${field}`,
      relationshipType: 'serialized-block-reference',
      sourceResourceKey: resource.key,
      sourceTable: resource.table,
      sourceRowId: resource.id,
      field,
      referenceCount: blockReferences.length,
      referenceAttributePaths: [...new Set(blockReferences.map((reference) => reference.path))].sort(),
    });
  }
  return references;
}

function serializedBlockReferenceHints(content) {
  const references = [];
  const blockPattern = /<!--\s+wp:[^\s]+(?:\s+({.*?}))?\s*\/?-->/gs;
  let match;
  while ((match = blockPattern.exec(content)) !== null) {
    if (!match[1]) {
      continue;
    }
    let attrs;
    try {
      attrs = JSON.parse(match[1]);
    } catch {
      references.push({ path: 'unparseable' });
      continue;
    }
    collectSerializedBlockReferenceHints(attrs, [], references);
  }
  return references;
}

function collectSerializedBlockReferenceHints(value, path, references) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      collectSerializedBlockReferenceHints(entry, [...path, String(index)], references));
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    const nextPath = [...path, key];
    if (SERIALIZED_BLOCK_REFERENCE_KEYS.has(key) && serializedBlockReferenceValueLooksLikeId(entry)) {
      references.push({ path: nextPath.join('.') });
      continue;
    }
    collectSerializedBlockReferenceHints(entry, nextPath, references);
  }
}

function serializedBlockReferenceValueLooksLikeId(value) {
  if (normalizePositiveInteger(value) != null) {
    return true;
  }
  return Array.isArray(value) && value.some((entry) => normalizePositiveInteger(entry) != null);
}

function isUnsafeWordPressGraphReference(reference) {
  if (reference.targetSupport && !reference.targetSupport.supported) {
    return true;
  }

  if (isSafeSamePlanWordPressGraphReference(reference)) {
    return false;
  }

  if (reference.identityRewrite) {
    return false;
  }

  if (reference.targetChange.remote.state !== 'present') {
    return true;
  }

  if (
    reference.targetChange.local.state !== 'present'
    && reference.targetLocalHash !== reference.targetRemoteHash
  ) {
    return true;
  }

  if (reference.targetRemoteHash === reference.targetBaseHash) {
    return false;
  }

  return reference.targetLocalHash !== reference.targetRemoteHash;
}

function isSafeSamePlanWordPressGraphReference(reference) {
  if (!SAME_PLAN_WORDPRESS_GRAPH_RELATIONSHIPS.has(reference.relationshipType)) {
    return false;
  }

  if (reference.targetRemoteHash !== reference.targetBaseHash) {
    return false;
  }

  if (reference.targetLocalHash === reference.targetRemoteHash) {
    return false;
  }

  if (reference.targetChange.local.state !== 'present') {
    return false;
  }

  return reference.targetChange.localChange === 'create'
    || reference.targetChange.localChange === 'update';
}

export const SUPPORTED_SAME_PLAN_WORDPRESS_GRAPH_RELATIONSHIPS = Object.freeze([
  'comment-post',
  'comment-parent',
  'comment-user',
  'commentmeta-comment',
  'link-owner',
  'blog-site',
  'blogmeta-blog',
  'blog-version-blog',
  'sitemeta-site',
  'registration-log-blog',
  'post-parent',
  'post-author',
  'postmeta-post',
  'featured-image-attachment',
  'term-relationship-object',
  'term-relationship-taxonomy',
  'term-taxonomy-term',
  'term-taxonomy-parent',
  'termmeta-term',
  'usermeta-user',
]);

const SAME_PLAN_WORDPRESS_GRAPH_RELATIONSHIPS = new Set(
  SUPPORTED_SAME_PLAN_WORDPRESS_GRAPH_RELATIONSHIPS,
);

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
      field,
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
  }

  if (suffix === 'comments') {
    addReference({
      field: 'comment_post_ID',
      relationshipType: 'comment-post',
      targetTable: 'posts',
      targetId: value.comment_post_ID,
    });
    addReference({
      field: 'comment_parent',
      relationshipType: 'comment-parent',
      targetTable: 'comments',
      targetId: value.comment_parent,
    });
    addReference({
      field: 'user_id',
      relationshipType: 'comment-user',
      targetTable: 'users',
      targetId: value.user_id,
    });
  }

  if (suffix === 'commentmeta') {
    addReference({
      field: 'comment_id',
      relationshipType: 'commentmeta-comment',
      targetTable: 'comments',
      targetId: value.comment_id,
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

  if (suffix === 'links') {
    addReference({
      field: 'link_owner',
      relationshipType: 'link-owner',
      targetTable: 'users',
      targetId: value.link_owner,
    });
  }

  if (suffix === 'blogs') {
    addReference({
      field: 'site_id',
      relationshipType: 'blog-site',
      targetTable: 'site',
      targetId: value.site_id,
    });
  }

  if (suffix === 'blogmeta') {
    addReference({
      field: 'blog_id',
      relationshipType: 'blogmeta-blog',
      targetTable: 'blogs',
      targetId: value.blog_id,
    });
  }

  if (suffix === 'blog_versions') {
    addReference({
      field: 'blog_id',
      relationshipType: 'blog-version-blog',
      targetTable: 'blogs',
      targetId: value.blog_id,
    });
  }

  if (suffix === 'sitemeta') {
    addReference({
      field: 'site_id',
      relationshipType: 'sitemeta-site',
      targetTable: 'site',
      targetId: value.site_id,
    });
  }

  if (suffix === 'registration_log') {
    addReference({
      field: 'blog_id',
      relationshipType: 'registration-log-blog',
      targetTable: 'blogs',
      targetId: value.blog_id,
    });
  }

  return references;
}

function wordpressGraphReferenceEvidence(
  reference,
  resources,
  base,
  local,
  remote,
  seen = new Set(),
  identityMap = null,
  identityRewrites = [],
) {
  const target = resources.find((candidate) => candidate.key === reference.targetResourceKey)
    || reference.targetResource;
  const identityRewrite = identityRewrites.find((rewrite) =>
    rewrite.relationshipKey === reference.relationshipKey
    && rewrite.targetResourceKey === target.key);
  const baseValue = getResource(base, target);
  const localValue = getResource(local, target);
  const remoteValue = getResource(remote, target);
  const targetBaseHash = resourceHash(base, target);
  const targetLocalHash = resourceHash(local, target);
  const targetRemoteHash = resourceHash(remote, target);
  const graphTargetSupport = seen.has(target.key)
    ? { supported: true }
    : wordpressGraphResourceSupport({
      resource: target,
      localValue,
      resources,
      base,
      local,
    remote,
      identityMap,
      seen: new Set([...seen, target.key]),
    });
  const targetSupport = graphTargetSupport.supported
    ? wordpressGraphRelationshipTargetSupport(reference, {
      baseValue,
      localValue,
      remoteValue,
    })
    : graphTargetSupport;

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
    ...(identityRewrite ? {
      identityRewrite: {
        relationshipKey: identityRewrite.relationshipKey,
        relationshipType: identityRewrite.relationshipType,
        sourceTargetResourceKey: identityRewrite.sourceTargetResourceKey,
        targetResourceKey: identityRewrite.targetResourceKey,
        identityMapSource: identityRewrite.identityMapSource,
        sourceTargetLocalHash: identityRewrite.sourceTargetLocalHash,
        targetRemoteHash: identityRewrite.targetRemoteHash,
      },
    } : {}),
    targetBaseHash,
    targetLocalHash,
    targetRemoteHash,
    ...(targetSupport.supported ? {} : {
      targetSupport: {
        supported: false,
        className: targetSupport.className || null,
        reason: targetSupport.reason || null,
      },
    }),
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

function wordpressGraphRelationshipTargetSupport(reference, { baseValue, localValue, remoteValue }) {
  if (reference.relationshipType !== 'featured-image-attachment') {
    return { supported: true };
  }

  const targetValue = localValue !== ABSENT
    ? localValue
    : (remoteValue !== ABSENT ? remoteValue : baseValue);
  if (targetValue === ABSENT) {
    return { supported: true };
  }

  if (
    !targetValue
    || typeof targetValue !== 'object'
    || String(targetValue.post_type || '') !== 'attachment'
  ) {
    return {
      supported: false,
      className: 'stale-wordpress-graph-identity',
      reason: `WordPress graph mutation ${reference.sourceResourceKey} references a _thumbnail_id target that is not a supported attachment row.`,
    };
  }

  return { supported: true };
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
  if (suffix === 'comments') {
    return 'comment_ID';
  }
  if (suffix === 'posts') {
    return 'ID';
  }
  if (suffix === 'users') {
    return 'ID';
  }
  if (suffix === 'links') {
    return 'link_id';
  }
  if (suffix === 'blogs') {
    return 'blog_id';
  }
  if (suffix === 'site') {
    return 'id';
  }
  if (suffix === 'terms') {
    return 'term_id';
  }
  if (suffix === 'term_taxonomy') {
    return 'term_taxonomy_id';
  }
  return 'id';
}

function wordpressGraphResourcePrimaryInteger(resource) {
  if (resource?.type !== 'row') {
    return null;
  }
  const suffix = wordpressGraphTableSuffix(resource.table);
  if (!suffix) {
    return null;
  }
  const idField = wordpressGraphPrimaryIdField(suffix);
  const match = new RegExp(`^${escapeRegExp(idField)}:([1-9]\\d*)$`).exec(resource.id);
  return match ? Number.parseInt(match[1], 10) : null;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function isActivePluginsOptionResource(resource) {
  return resource?.type === 'row'
    && resource.table === 'wp_options'
    && resource.id === 'option_name:active_plugins';
}

function pluginContextMutationSupport({
  resource,
  owner,
  localValue,
  resources,
  base,
  local,
  remote,
}) {
  if (resource.type === 'plugin' && localValue === ABSENT) {
    return {
      supported: false,
      className: 'plugin-uninstall-delete-refusal',
      reason: `Plugin context resource ${resource.key} cannot be deleted by push; plugin uninstall/delete/remove is not supported for plugin-owned resources.`,
      resolutionPolicy: 'preserve-remote-plugin-context-and-stop',
      deleteRefusalEvidence: pluginContextDeleteRefusalEvidence({ resource, owner }),
    };
  }

  if (resource.type === 'file' && localValue === ABSENT) {
    return {
      supported: false,
      className: 'plugin-uninstall-delete-refusal',
      reason: `Plugin context resource ${resource.key} cannot be deleted by push; plugin uninstall/delete/remove is not supported for plugin-owned resources.`,
      resolutionPolicy: 'preserve-remote-plugin-context-and-stop',
      deleteRefusalEvidence: pluginContextDeleteRefusalEvidence({ resource, owner }),
    };
  }

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
    remotePluginRemovalRefusalEvidence: remotePluginRemovalOwnerContextRefusalEvidence({
      resource,
      owner,
      staleContext,
    }),
    ownerMetadataRefusalEvidence: stalePluginMetadataOwnerContextRefusalEvidence({
      resource,
      owner,
      staleContext,
    }),
    ownerFileRefusalEvidence: stalePluginFileOwnerContextRefusalEvidence({
      resource,
      owner,
      staleContext,
    }),
    ownerContextRefusalEvidence: stalePluginOwnerContextRefusalEvidence({
      resource,
      owner,
      staleContext,
    }),
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
  if (ownerDependencyDeclared && !hasPlugin(remote, owner)) {
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
    remotePluginRemovalRefusalEvidence: remotePluginRemovalOwnerContextRefusalEvidence({
      resource,
      owner,
      staleContext,
    }),
    ownerMetadataRefusalEvidence: stalePluginMetadataOwnerContextRefusalEvidence({
      resource,
      owner,
      staleContext,
    }),
    ownerFileRefusalEvidence: stalePluginFileOwnerContextRefusalEvidence({
      resource,
      owner,
      staleContext,
    }),
    ownerContextRefusalEvidence: stalePluginOwnerContextRefusalEvidence({
      resource,
      owner,
      staleContext,
    }),
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

function stalePluginMetadataOwnerContextRefusalEvidence({ resource, owner, staleContext }) {
  const pluginMetadataContexts = staleContext.filter((context) => context.type === 'plugin');
  if (pluginMetadataContexts.length === 0) {
    return null;
  }
  return {
    reasonCode: 'STALE_PLUGIN_METADATA_OWNER_CONTEXT',
    operation: 'refuse-before-mutation',
    resourceKey: resource.key,
    pluginOwner: owner,
    stalePluginMetadataResourceKeys: pluginMetadataContexts.map((context) => context.resourceKey).sort(),
    context: pluginMetadataContexts
      .map((context) => ({
        resourceKey: context.resourceKey,
        baseHash: context.baseHash,
        localHash: context.localHash,
        remoteHash: context.remoteHash,
        localChange: context.change.localChange,
        remoteChange: context.change.remoteChange,
      }))
      .sort((left, right) => left.resourceKey.localeCompare(right.resourceKey)),
  };
}

function stalePluginFileOwnerContextRefusalEvidence({ resource, owner, staleContext }) {
  const pluginFileContexts = staleContext.filter((context) => context.type === 'file');
  if (pluginFileContexts.length === 0) {
    return null;
  }
  return {
    reasonCode: 'STALE_PLUGIN_FILE_OWNER_CONTEXT',
    operation: 'refuse-before-mutation',
    resourceKey: resource.key,
    pluginOwner: owner,
    stalePluginFileResourceKeys: pluginFileContexts.map((context) => context.resourceKey).sort(),
    context: pluginFileContexts
      .map((context) => ({
        resourceKey: context.resourceKey,
        baseHash: context.baseHash,
        localHash: context.localHash,
        remoteHash: context.remoteHash,
        localChange: context.change.localChange,
        remoteChange: context.change.remoteChange,
      }))
      .sort((left, right) => left.resourceKey.localeCompare(right.resourceKey)),
  };
}

function stalePluginOwnerContextRefusalEvidence({ resource, owner, staleContext }) {
  return remotePluginRemovalOwnerContextRefusalEvidence({ resource, owner, staleContext })
    || stalePluginFileOwnerContextRefusalEvidence({ resource, owner, staleContext })
    || stalePluginMetadataOwnerContextRefusalEvidence({ resource, owner, staleContext });
}

function remotePluginRemovalOwnerContextRefusalEvidence({ resource, owner, staleContext }) {
  const removedPluginContexts = staleContext.filter((context) =>
    context.type === 'plugin' && context.change.remoteChange === 'delete');
  if (removedPluginContexts.length === 0) {
    return null;
  }
  return {
    reasonCode: 'REMOTE_PLUGIN_REMOVAL_OWNER_CONTEXT',
    operation: 'refuse-before-mutation',
    proofScope: 'local-focused',
    productionBacked: false,
    releaseGateNote: 'Local proof only; production-backed release gate evidence is still required.',
    resourceKey: resource.key,
    pluginOwner: owner,
    removedPluginResourceKeys: removedPluginContexts.map((context) => context.resourceKey).sort(),
    context: removedPluginContexts
      .map((context) => ({
        resourceKey: context.resourceKey,
        baseHash: context.baseHash,
        localHash: context.localHash,
        remoteHash: context.remoteHash,
        localChange: context.change.localChange,
        remoteChange: context.change.remoteChange,
      }))
      .sort((left, right) => left.resourceKey.localeCompare(right.resourceKey)),
  };
}

function pluginOwnedDriverDeleteSupportRefusalEvidence({ resource, owner, support }) {
  return {
    reasonCode: 'PLUGIN_DRIVER_DELETE_UNSUPPORTED',
    operation: 'refuse-before-mutation',
    attemptedAction: 'delete',
    resourceKey: resource.key,
    pluginOwner: owner,
    driver: support.driver || null,
    supportsDelete: false,
  };
}

function pluginOwnedResourceDeleteRefusalEvidence({ resource, owner, support }) {
  return {
    reasonCode: 'PLUGIN_OWNED_RESOURCE_DELETE_UNSUPPORTED',
    operation: 'delete',
    resourceType: resource.type,
    resourceKey: resource.key,
    pluginOwner: owner,
    driver: support.driver || null,
    policySource: support.policySource || null,
    supportsDelete: false,
  };
}

function pluginContextDeleteRefusalEvidence({ resource, owner }) {
  return {
    reasonCode: 'PLUGIN_UNINSTALL_DELETE_REFUSED',
    operation: 'delete',
    resourceType: resource.type,
    resourceKey: resource.key,
    pluginOwner: owner,
    supportsDelete: false,
  };
}

function intentDeclaresPluginDependency(intent, plugin) {
  if (!intent) {
    return false;
  }
  return normalizePluginDependencies(intent.dependencies?.plugins || [])
    .some((dependency) => dependency.name === plugin);
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

  plan.blockers.push({
    id: `blocker-plugin-owned-resource-${plan.blockers.length + 1}`,
    class: className,
    resource,
    resourceKey: resource.key,
    pluginOwner: owner,
    driver: support.driver || null,
    policySource: support.policySource || null,
    ...(support.supportsDelete !== undefined ? { supportsDelete: support.supportsDelete === true } : {}),
    ...(support.ownerMetadataRefusalEvidence ? { ownerMetadataRefusalEvidence: support.ownerMetadataRefusalEvidence } : {}),
    ...(support.ownerFileRefusalEvidence ? { ownerFileRefusalEvidence: support.ownerFileRefusalEvidence } : {}),
    ...(support.ownerContextRefusalEvidence ? { ownerContextRefusalEvidence: support.ownerContextRefusalEvidence } : {}),
    ...(support.remotePluginRemovalRefusalEvidence
      ? { remotePluginRemovalRefusalEvidence: support.remotePluginRemovalRefusalEvidence }
      : {}),
    ...(support.ownerContext ? { ownerContext: support.ownerContext } : {}),
    ...(support.serializedOptionValidationEvidence
      ? { serializedOptionValidationEvidence: support.serializedOptionValidationEvidence }
      : {}),
    ...(support.driverPayloadValidationEvidence
      ? { driverPayloadValidationEvidence: support.driverPayloadValidationEvidence }
      : {}),
    ...(support.driverAuditEvidence ? { driverAuditEvidence: support.driverAuditEvidence } : {}),
    ...(support.driverEvidence ? { driverEvidence: support.driverEvidence } : {}),
    ...(support.dryRunValidationEvidence ? { dryRunValidationEvidence: support.dryRunValidationEvidence } : {}),
    ...(support.driverDryRunValidationEvidence
      ? { driverDryRunValidationEvidence: support.driverDryRunValidationEvidence }
      : {}),
    ...(support.deleteSupportRefusalEvidence
      ? { deleteSupportRefusalEvidence: support.deleteSupportRefusalEvidence }
      : {}),
    ...(support.deleteRefusalEvidence ? { deleteRefusalEvidence: support.deleteRefusalEvidence } : {}),
    ...(support.reasonCode ? { reasonCode: support.reasonCode } : {}),
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

function addDirectActivePluginsMutationBlocker(plan, {
  resource,
  baseValue,
  localValue,
  remoteValue,
  baseHash,
  localHash,
  remoteHash,
}) {
  plan.blockers.push({
    id: `blocker-active-plugins-direct-mutation-${plan.blockers.length + 1}`,
    class: 'unsupported-active-plugins-direct-mutation',
    reasonCode: 'DIRECT_ACTIVE_PLUGINS_MUTATION_UNSUPPORTED',
    resource,
    resourceKey: resource.key,
    requiredDriver: 'plugin-activation-driver',
    reason: 'Direct wp_options active_plugins mutations require explicit plugin activation driver support and are refused by default.',
    resolutionPolicy: 'preserve-remote-active-plugins-and-stop',
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
  plan.blockers.push({
    id: `blocker-plugin-context-${plan.blockers.length + 1}`,
    class: support.className || 'stale-plugin-owner-context',
    resource,
    resourceKey: resource.key,
    pluginOwner: owner,
    ownerContext: support.ownerContext || [],
    ...(support.requiredDriver ? { requiredDriver: support.requiredDriver } : {}),
    ...(support.ownerMetadataRefusalEvidence ? { ownerMetadataRefusalEvidence: support.ownerMetadataRefusalEvidence } : {}),
    ...(support.ownerFileRefusalEvidence ? { ownerFileRefusalEvidence: support.ownerFileRefusalEvidence } : {}),
    ...(support.ownerContextRefusalEvidence ? { ownerContextRefusalEvidence: support.ownerContextRefusalEvidence } : {}),
    ...(support.remotePluginRemovalRefusalEvidence
      ? { remotePluginRemovalRefusalEvidence: support.remotePluginRemovalRefusalEvidence }
      : {}),
    ...(support.deleteRefusalEvidence ? { deleteRefusalEvidence: support.deleteRefusalEvidence } : {}),
    ...(support.resolutionPolicy ? { resolutionPolicy: support.resolutionPolicy } : {}),
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
    references: support.references || [],
  });
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
  const mutationsById = new Map();
  for (const mutation of plan.mutations) {
    if (mutationsById.has(mutation.id)) {
      plan.blockers.push({
        id: `blocker-${mutation.id}-duplicate-mutation-id`,
        class: 'planner-invariant-violation',
        mutationId: mutation.id,
        resourceKey: mutation.resourceKey,
        reason: 'Plan emitted duplicate mutation ids.',
      });
      continue;
    }
    mutationsById.set(mutation.id, mutation);
  }

  const preconditionsByMutation = new Map();
  for (const precondition of plan.preconditions) {
    if (preconditionsByMutation.has(precondition.mutationId)) {
      plan.blockers.push({
        id: `blocker-${precondition.mutationId}-duplicate-live-remote-precondition`,
        class: 'planner-invariant-violation',
        mutationId: precondition.mutationId,
        resourceKey: precondition.resourceKey,
        reason: 'Plan emitted duplicate live remote preconditions for a mutation.',
      });
      continue;
    }
    preconditionsByMutation.set(precondition.mutationId, precondition);
    if (!mutationsById.has(precondition.mutationId)) {
      plan.blockers.push({
        id: `blocker-${precondition.mutationId}-orphan-live-remote-precondition`,
        class: 'planner-invariant-violation',
        mutationId: precondition.mutationId,
        resourceKey: precondition.resourceKey,
        reason: 'Plan emitted a live remote precondition that does not map to a mutation.',
      });
    }
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
