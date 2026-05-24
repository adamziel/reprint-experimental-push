import { ABSENT, deepClone, digest } from './stable-json.js';
import {
  deserializeResourceValue,
  getResource,
  hasPlugin,
  resourceHash,
  serializeResourceValue,
  setResource,
} from './resources.js';

const JOURNAL_SCHEMA_VERSION = 1;
const FIXTURE_PLUGIN_DEPENDENCIES = new Map([
  ['reprint-push-atomic-dependent-fixture', ['reprint-push-atomic-dependency-fixture']],
  ['reprint-push-atomic-failing-fixture', ['reprint-push-atomic-dependency-fixture']],
]);
const FIXTURE_PLUGIN_OWNED_ROW_DEPENDENCIES = new Map([
  [
    'row:["wp_options","option_name:reprint_push_atomic_fixture_data"]',
    'reprint-push-atomic-dependent-fixture',
  ],
]);

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

  validateSupportedPluginOwnedMutations(remote, plan);
  validateAtomicGroupDependencyPlan(remote, plan);

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

function validateSupportedPluginOwnedMutations(remote, plan) {
  for (const mutation of plan.mutations || []) {
    const plannedValue = deserializeResourceValue(mutation.value);
    const remoteValue = getResource(remote, mutation.resource);
    const owner = pluginOwnedOwner(plannedValue) || pluginOwnedOwner(remoteValue);
    if (!owner) {
      continue;
    }

    const driver = mutation.pluginOwnedResource?.driver || null;
    const supported = mutation.pluginOwnedResource?.pluginOwner === owner
      && isSupportedPluginOwnedMutation(remote, mutation, owner, driver, plannedValue);
    if (!supported) {
      throw new PushPlanError(
        'UNSUPPORTED_PLUGIN_OWNED_RESOURCE',
        `Refusing to apply unsupported plugin-owned resource ${mutation.resourceKey}.`,
        {
          mutationId: mutation.id,
          resourceKey: mutation.resourceKey,
          pluginOwner: owner,
          driver,
        },
      );
    }
  }
}

function pluginOwnedOwner(value) {
  if (!value || value === ABSENT || typeof value !== 'object') {
    return null;
  }
  return value.__pluginOwner || null;
}

function isSupportedPluginOwnedMutation(remote, mutation, owner, driver, plannedValue) {
  if (driver === 'wp-option') {
    return mutation.resource?.type === 'row' && mutation.resource.table === 'wp_options';
  }
  if (driver === 'wp-postmeta' || driver === 'wp-post-meta') {
    return mutation.resource?.type === 'row' && mutation.resource.table === 'wp_postmeta';
  }
  if (driver === 'wp-termmeta' || driver === 'wp-term-meta') {
    return mutation.resource?.type === 'row' && mutation.resource.table === 'wp_termmeta';
  }
  if (driver === 'wp-usermeta' || driver === 'wp-user-meta') {
    return mutation.resource?.type === 'row' && mutation.resource.table === 'wp_usermeta';
  }
  if (driver === 'fixture-forms-lab-table') {
    return owner === 'forms'
      && mutation.resource?.type === 'row'
      && mutation.resource.table === 'wp_reprint_push_forms_lab'
      && /^id:[1-9]\d*$/.test(mutation.resource.id || '')
      && plannedValue !== ABSENT
      && mutation.action !== 'delete'
      && validFixtureFormsLabTableEvidence(mutation.pluginOwnedResource?.driverEvidence, remote);
  }
  return false;
}

function validFixtureFormsLabTableEvidence(evidence, remote) {
  if (!evidence || evidence.plugin !== 'reprint-push-forms-fixture' || evidence.resourceKey !== 'plugin:reprint-push-forms-fixture') {
    return false;
  }
  if (evidence.source === 'live-remote') {
    const pluginResource = {
      type: 'plugin',
      name: 'reprint-push-forms-fixture',
      key: 'plugin:reprint-push-forms-fixture',
    };
    const plugin = getResource(remote, pluginResource);
    return typeof evidence.baseHash === 'string'
      && /^[a-f0-9]{64}$/.test(evidence.baseHash)
      && typeof evidence.remoteHash === 'string'
      && /^[a-f0-9]{64}$/.test(evidence.remoteHash)
      && evidence.baseHash === evidence.remoteHash
      && plugin !== ABSENT
      && plugin?.active === true
      && resourceHash(remote, pluginResource) === evidence.remoteHash;
  }
  return false;
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
        beforeValue: journalValueEvidence(mutation, serializeResourceValue(beforeValue)),
        afterHash: digest(afterValue),
        afterValue: journalValueEvidence(mutation, deepClone(mutation.value)),
      };
    }),
  };
}

function journalValueEvidence(mutation, value) {
  if (mutation.pluginOwnedResource?.driver === 'fixture-forms-lab-table') {
    return {
      redacted: true,
      reason: 'fixture-plugin-owned-resource',
      resourceKey: mutation.resourceKey,
    };
  }
  return value;
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
          remote: sanitizeRecoveryRemote(remote, plan),
        },
      },
    },
  );
}

function sanitizeRecoveryRemote(remote, plan) {
  const sanitized = deepClone(remote);
  for (const mutation of plan.mutations || []) {
    if (mutation.pluginOwnedResource?.driver !== 'fixture-forms-lab-table') {
      continue;
    }
    if (mutation.resource?.type !== 'row' || mutation.resource.table !== 'wp_reprint_push_forms_lab') {
      continue;
    }
    const row = sanitized.db?.wp_reprint_push_forms_lab?.[mutation.resource.id];
    if (!row || typeof row !== 'object') {
      continue;
    }
    sanitized.db.wp_reprint_push_forms_lab[mutation.resource.id] = {
      __redacted: true,
      resourceKey: mutation.resourceKey,
      hash: resourceHash(remote, mutation.resource),
    };
  }
  return sanitized;
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

function validateAtomicGroupDependencyPlan(remote, plan) {
  const mutations = Array.isArray(plan.mutations) ? plan.mutations : [];
  const mutationByResource = new Map(mutations.map((mutation) => [mutation.resourceKey, mutation]));
  const groups = Array.isArray(plan.atomicGroups) ? plan.atomicGroups : [];

  validateFixturePluginDependencyCoverage(remote, mutations, groups);

  for (const group of groups) {
    const groupId = group.id;
    const groupMutationIds = new Set(group.mutationIds || []);
    for (const mutation of mutations) {
      if (mutation.atomicGroupId === groupId) {
        groupMutationIds.add(mutation.id);
      }
    }

    for (const requirement of normalizeAtomicGroupDependencyRequirements(group)) {
      const plugin = requirement.plugin;
      if (!plugin) {
        throw new PushPlanError(
          'ATOMIC_GROUP_DEPENDENCY_INVALID',
          `Atomic group ${groupId} declares a plugin dependency without a plugin name.`,
          { groupId },
        );
      }

      const resource = { type: 'plugin', name: plugin, key: `plugin:${plugin}` };
      const mutation = mutationByResource.get(resource.key);
      if (mutation && !groupMutationIds.has(mutation.id)) {
        throw new PushPlanError(
          'ATOMIC_GROUP_DEPENDENCY_OUTSIDE_GROUP',
          `Atomic group ${groupId} depends on plugin ${plugin}, but its mutation is outside the group.`,
          { groupId, plugin, mutationId: mutation.id },
        );
      }

      if (mutation) {
        const plannedValue = deserializeResourceValue(mutation.value);
        if (plannedValue === ABSENT) {
          throw new PushPlanError(
            'ATOMIC_GROUP_DEPENDENCY_MISSING',
            `Atomic group ${groupId} would remove plugin dependency ${plugin}.`,
            { groupId, plugin, source: 'same-atomic-group' },
          );
        }
        validateAtomicPluginDependencyValue({
          groupId,
          plugin,
          requirement,
          value: plannedValue,
          hash: resourceHash({ plugins: { [plugin]: plannedValue } }, resource),
          source: 'same-atomic-group',
        });
        continue;
      }

      if (!hasPlugin(remote, plugin)) {
        throw new PushPlanError(
          'ATOMIC_GROUP_DEPENDENCY_MISSING',
          `Atomic group ${groupId} is missing plugin dependency ${plugin}.`,
          { groupId, plugin, source: 'live-remote' },
        );
      }

      const actualHash = resourceHash(remote, resource);
      const evidenceHash = requirement.remoteHash || requirement.hash || requirement.expectedHash || null;
      if (!evidenceHash) {
        throw new PushPlanError(
          'ATOMIC_GROUP_DEPENDENCY_EVIDENCE_MISSING',
          `Atomic group ${groupId} has no live-remote hash evidence for plugin dependency ${plugin}.`,
          { groupId, plugin, actualHash },
        );
      }
      if (actualHash !== evidenceHash) {
        throw new PushPlanError(
          'ATOMIC_GROUP_DEPENDENCY_STALE',
          `Atomic group ${groupId} has stale live-remote evidence for plugin dependency ${plugin}.`,
          { groupId, plugin, expectedHash: evidenceHash, actualHash },
        );
      }

      validateAtomicPluginDependencyValue({
        groupId,
        plugin,
        requirement,
        value: getResource(remote, resource),
        hash: actualHash,
        source: 'live-remote',
      });
    }
  }
}

function validateFixturePluginDependencyCoverage(remote, mutations, groups) {
  for (const mutation of mutations) {
    const requiredPlugins = fixturePluginDependenciesRequiredForMutation(remote, mutation);
    if (requiredPlugins.length === 0) {
      continue;
    }

    const groupsCoveringMutation = groups.filter((group) => groupCoversMutation(group, mutation));
    for (const dependency of requiredPlugins) {
      const hasDeclaredDependency = groupsCoveringMutation.some((group) =>
        normalizeAtomicGroupDependencyRequirements(group).some((requirement) => requirement.plugin === dependency));
      if (hasDeclaredDependency) {
        continue;
      }

      throw new PushPlanError(
        'ATOMIC_GROUP_DEPENDENCY_UNDECLARED',
        `Mutation ${mutation.id} for ${mutation.resourceKey} requires an atomic group dependency requirement for ${dependency}.`,
        {
          mutationId: mutation.id,
          resourceKey: mutation.resourceKey,
          plugin: fixturePluginOwnerForMutation(remote, mutation),
          dependency,
          groupIds: groupsCoveringMutation.map((group) => group.id),
        },
      );
    }
  }
}

function fixturePluginDependenciesRequiredForMutation(remote, mutation) {
  const plugin = fixturePluginOwnerForMutation(remote, mutation);
  const dependencies = FIXTURE_PLUGIN_DEPENDENCIES.get(plugin) || [];
  if (dependencies.length === 0) {
    return [];
  }

  if (mutation?.resource?.type === 'row') {
    return dependencies;
  }

  const plannedValue = deserializeResourceValue(mutation.value);
  if (plannedValue === ABSENT) {
    return [];
  }

  const isInstall = !hasPlugin(remote, plugin);
  const isActivation = Boolean(plannedValue?.active);
  return isInstall || isActivation ? dependencies : [];
}

function fixturePluginOwnerForMutation(remote, mutation) {
  if (mutation?.resource?.type === 'plugin') {
    return mutation.resource.name;
  }

  if (mutation?.resource?.type !== 'row') {
    return null;
  }

  const plannedValue = deserializeResourceValue(mutation.value);
  const plannedOwner = fixturePluginOwnerFromValue(plannedValue);
  if (plannedOwner) {
    return plannedOwner;
  }

  const remoteOwner = fixturePluginOwnerFromValue(getResource(remote, mutation.resource));
  if (remoteOwner) {
    return remoteOwner;
  }

  return FIXTURE_PLUGIN_OWNED_ROW_DEPENDENCIES.get(mutation.resourceKey) || null;
}

function fixturePluginOwnerFromValue(value) {
  if (!value || value === ABSENT || typeof value !== 'object') {
    return null;
  }
  const owner = value.__pluginOwner;
  return FIXTURE_PLUGIN_DEPENDENCIES.has(owner) ? owner : null;
}

function groupCoversMutation(group, mutation) {
  if (!group || typeof group !== 'object') {
    return false;
  }
  if (mutation.atomicGroupId && group.id === mutation.atomicGroupId) {
    return true;
  }
  return Array.isArray(group.mutationIds) && group.mutationIds.includes(mutation.id);
}

function normalizeAtomicGroupDependencyRequirements(group) {
  const requirements = [];
  const seen = new Set();

  for (const requirement of group.dependencyRequirements || []) {
    const normalized = typeof requirement === 'string'
      ? { plugin: requirement }
      : { ...requirement, plugin: requirement?.plugin || requirement?.name || requirement?.slug };
    requirements.push(normalized);
    if (normalized.plugin) {
      seen.add(normalized.plugin);
    }
  }

  for (const plugin of group.dependencies?.plugins || []) {
    const name = typeof plugin === 'string' ? plugin : plugin?.name || plugin?.plugin || plugin?.slug;
    if (name && !seen.has(name)) {
      requirements.push(typeof plugin === 'string' ? { plugin: name } : { ...plugin, plugin: name });
      seen.add(name);
    }
  }

  return requirements;
}

function validateAtomicPluginDependencyValue({ groupId, plugin, requirement, value, hash, source }) {
  if (requirement.expectedHash && requirement.expectedHash !== hash) {
    throw new PushPlanError(
      'ATOMIC_GROUP_DEPENDENCY_HASH_MISMATCH',
      `Atomic group ${groupId} requires plugin ${plugin} at hash ${requirement.expectedHash}, but ${source} has ${hash}.`,
      { groupId, plugin, expectedHash: requirement.expectedHash, actualHash: hash, source },
    );
  }

  const actualVersion = value?.version;
  if ((requirement.expectedVersion || requirement.versionRange) && typeof actualVersion !== 'string') {
    throw new PushPlanError(
      'ATOMIC_GROUP_DEPENDENCY_VERSION_MISSING',
      `Atomic group ${groupId} requires a versioned plugin dependency ${plugin}, but ${source} has no version metadata.`,
      { groupId, plugin, source },
    );
  }

  if (requirement.expectedVersion && actualVersion !== requirement.expectedVersion) {
    throw new PushPlanError(
      'ATOMIC_GROUP_DEPENDENCY_VERSION_MISMATCH',
      `Atomic group ${groupId} requires plugin ${plugin} version ${requirement.expectedVersion}, but ${source} has ${actualVersion}.`,
      { groupId, plugin, expectedVersion: requirement.expectedVersion, actualVersion, source },
    );
  }

  if (requirement.versionRange) {
    const rangeResult = satisfiesVersionRange(actualVersion, requirement.versionRange);
    if (rangeResult.unsupported || !rangeResult.satisfied) {
      throw new PushPlanError(
        rangeResult.unsupported
          ? 'ATOMIC_GROUP_DEPENDENCY_VERSION_RANGE_UNSUPPORTED'
          : 'ATOMIC_GROUP_DEPENDENCY_VERSION_RANGE_MISMATCH',
        `Atomic group ${groupId} requires plugin ${plugin} version ${requirement.versionRange}, but ${source} has ${actualVersion}.`,
        { groupId, plugin, versionRange: requirement.versionRange, actualVersion, source },
      );
    }
  }

  if (typeof requirement.active === 'boolean' && Boolean(value?.active) !== requirement.active) {
    throw new PushPlanError(
      'ATOMIC_GROUP_DEPENDENCY_ACTIVE_MISMATCH',
      `Atomic group ${groupId} requires plugin ${plugin} active=${requirement.active}, but ${source} has active=${Boolean(value?.active)}.`,
      { groupId, plugin, expectedActive: requirement.active, actualActive: Boolean(value?.active), source },
    );
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
