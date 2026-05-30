import { ABSENT, deepClone, digest } from './stable-json.js';
import { redactEvidence } from './evidence-redaction.js';
import {
  deserializeResourceValue,
  enumerateResources,
  getResource,
  hasPlugin,
  pluginOwnerFor,
  resourceHash,
  serializeResourceValue,
  setResource,
} from './resources.js';
import { readRecoveryJournal } from './recovery-journal.js';
import { serializedOptionValidationEvidenceForRows } from './serialized-option-validator.js';

const JOURNAL_SCHEMA_VERSION = 1;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
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

  validateSupportedPluginContextMutations(plan);
  validateReadyPlanEnvelope(plan);
  validateAtomicGroupDependencyPlan(remote, plan);
  validateNoDirectActivePluginsMutations(plan);

  const durableJournal = getDurableJournalWriter(options);
  const hasPreviousJournal = Boolean(options.journal);
  let previousJournalState = null;
  let journal = prepareJournal(remote, plan, options.journal);
  ensureDurableJournalClaimOpened(durableJournal, remote, plan);
  if (journal.status === 'completed') {
    const result = replayCompletedPlan(remote, plan, journal);
    try {
      recordDurableReplay(durableJournal, remote, plan, result.recoveryState, journal);
    } catch (error) {
      throw journalWriteFailureFullyUpdated(error, remote, plan, result.journal, 'journal-replayed');
    }
    return result;
  }
  if (hasPreviousJournal) {
    const observedState = classifyJournalRemote(remote, journal);
    previousJournalState = observedState.status;
    if (observedState.status === 'fully-updated-remote') {
      const completedJournal = completeObservedJournal(journal, plan);
      const recoveryState = {
        status: 'fully-updated-remote',
        reason: 'Journal replay observed every planned mutation already present.',
        artifacts: {
          journal: completedJournal,
        },
      };
      try {
        recordDurableReplay(durableJournal, remote, plan, recoveryState, completedJournal);
      } catch (error) {
        throw journalWriteFailureFullyUpdated(error, remote, plan, completedJournal, 'journal-replayed');
      }
      return {
        site: deepClone(remote),
        appliedMutations: 0,
        journal: completedJournal,
        recoveryState,
      };
    }
    if (observedState.status === 'blocked-recovery') {
      throw recoveryBlocked(remote, plan, journal, observedState.reason, {
        driftedResources: observedState.driftedResources,
      });
    }
  }

  validatePreconditions(remote, plan);
  validateSupportedPluginOwnedMutations(remote, plan);
  try {
    recordDurablePlanOpened(durableJournal, remote, plan, {
      ...options,
      previousJournalState,
    });
  } catch (error) {
    throw journalWriteFailureBeforeMutation(error, remote, plan, journal, 'journal-opened');
  }

  if (options.failBeforeMutation) {
    const durableJournalError = recordDurableRecoveryStateBestEffort(durableJournal, remote, plan, {
      status: 'old-remote',
      reason: 'Injected failure before staging any mutation.',
    });
    throw injectedFailure(
      'INJECTED_FAILURE_BEFORE_MUTATION',
      'Injected failure before staging any mutation.',
      remote,
      plan,
      journal,
      recoveryStateDurableWriteDetails(durableJournalError),
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
  try {
    recordDurableBoundary(durableJournal, 'apply-staged', remote, plan, {
      state: 'staged',
      stagedHash: digest(staged),
    });
  } catch (error) {
    throw journalWriteFailureBeforeMutation(error, remote, plan, journal, 'apply-staged');
  }
  if (options.failAfterStaging) {
    const durableJournalError = recordDurableRecoveryStateBestEffort(durableJournal, remote, plan, {
      status: 'old-remote',
      reason: 'Injected failure after staging all mutations.',
    });
    throw injectedFailure(
      'INJECTED_FAILURE_AFTER_STAGING',
      'Injected failure after staging all mutations.',
      remote,
      plan,
      journal,
      recoveryStateDurableWriteDetails(durableJournalError),
    );
  }

  validateAtomicGroups(staged, plan);

  journal = markJournalStatus(journal, 'dependencies-validated');
  try {
    recordDurableBoundary(durableJournal, 'dependencies-validated', remote, plan, {
      state: 'dependencies-validated',
      stagedHash: digest(staged),
    });
  } catch (error) {
    throw journalWriteFailureBeforeMutation(error, remote, plan, journal, 'dependencies-validated');
  }
  if (options.failAfterDependencyValidation) {
    const durableJournalError = recordDurableRecoveryStateBestEffort(durableJournal, remote, plan, {
      status: 'old-remote',
      reason: 'Injected failure after dependency validation.',
    });
    throw injectedFailure(
      'INJECTED_FAILURE_AFTER_DEPENDENCY_VALIDATION',
      'Injected failure after dependency validation.',
      remote,
      plan,
      journal,
      recoveryStateDurableWriteDetails(durableJournalError),
    );
  }

  const commitResult = commitStagedSite(remote, staged, plan, journal, options, durableJournal);
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

function validateSupportedPluginContextMutations(plan) {
  for (const mutation of plan.mutations || []) {
    const plannedValue = deserializeResourceValue(mutation.value);
    const pluginDelete = mutation.resource?.type === 'plugin' && plannedValue === ABSENT;
    const pluginFileDelete = mutation.resource?.type === 'file'
      && /^file:wp-content\/plugins\//.test(mutation.resourceKey || '')
      && plannedValue === ABSENT;
    if (!pluginDelete && !pluginFileDelete) {
      continue;
    }

    const pluginOwner = mutation.resource?.type === 'plugin'
      ? mutation.resource.name
      : pluginOwnedOwnerForFileResourceKey(mutation.resourceKey);
    throw new PushPlanError(
      'PLUGIN_UNINSTALL_DELETE_REFUSED',
      `Refusing to apply unsupported plugin uninstall/delete mutation ${mutation.resourceKey}.`,
      {
        mutationId: mutation.id,
        resourceKey: mutation.resourceKey,
        pluginOwner,
        reasonCode: 'PLUGIN_UNINSTALL_DELETE_REFUSED',
        operation: 'delete',
        resourceType: mutation.resource?.type || null,
        supportsDelete: false,
      },
    );
  }
}

function pluginOwnedOwnerForFileResourceKey(resourceKey) {
  const match = String(resourceKey || '').match(/^file:wp-content\/plugins\/([^/]+)/);
  return match?.[1] || null;
}

function validateNoDirectActivePluginsMutations(plan) {
  for (const mutation of plan.mutations || []) {
    if (!isActivePluginsOptionResource(mutation.resource)) {
      continue;
    }
    throw new PushPlanError(
      'UNSUPPORTED_ACTIVE_PLUGINS_MUTATION',
      `Refusing to apply unsupported direct active_plugins mutation ${mutation.resourceKey}.`,
      {
        mutationId: mutation.id,
        resourceKey: mutation.resourceKey,
        reasonCode: 'DIRECT_ACTIVE_PLUGINS_MUTATION_UNSUPPORTED',
        requiredDriver: 'plugin-activation-driver',
      },
    );
  }
}

function isActivePluginsOptionResource(resource) {
  return resource?.type === 'row'
    && resource.table === 'wp_options'
    && resource.id === 'option_name:active_plugins';
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
      && isActivePluginOwnerPresent(remote, owner, plan)
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
          applyValidationEvidence: pluginOwnedApplyValidationEvidence({
            remote,
            mutation,
            owner,
            driver,
            plannedValue,
            remoteValue,
            outcome: 'refused-before-mutation',
          }),
        },
      );
    }
    const driverPayloadSupport = pluginOwnedDriverPayloadSupport({ mutation, plannedValue });
    if (!driverPayloadSupport.valid) {
      throw new PushPlanError(
        'INVALID_PLUGIN_DRIVER_PAYLOAD',
        `Refusing to apply invalid plugin-owned resource payload ${mutation.resourceKey}.`,
        {
          mutationId: mutation.id,
          resourceKey: mutation.resourceKey,
          pluginOwner: owner,
          driver,
          reasonCode: driverPayloadSupport.reasonCode,
          applyValidationEvidence: pluginOwnedApplyValidationEvidence({
            remote,
            mutation,
            owner,
            driver,
            plannedValue,
            remoteValue,
            outcome: 'refused-before-mutation',
            driverPayloadValidationEvidence: driverPayloadSupport.evidence,
          }),
        },
      );
    }
    validatePluginOwnedOwnerContext(remote, mutation, owner);
    validatePluginOwnedApplyValidation(mutation, owner, driver);
  }
}

function isActivePluginOwnerPresent(remote, owner, plan) {
  const pluginResource = {
    type: 'plugin',
    name: owner,
    key: `plugin:${owner}`,
  };
  const plugin = getResource(remote, pluginResource);
  if (plugin !== ABSENT && plugin?.active === true) {
    return true;
  }

  const planHasPluginEvidence = (plan.decisions || []).some((decision) =>
    decision.resource?.type === 'plugin'
    && decision.resource?.name === owner,
  ) || (plan.mutations || []).some((mutation) =>
    mutation.resource?.type === 'plugin'
    && mutation.resource?.name === owner,
  );
  if (!planHasPluginEvidence) {
    return true;
  }

  return (plan.mutations || []).some((mutation) =>
    mutation.resource?.type === 'plugin'
    && mutation.resource?.name === owner
    && mutation.action !== 'delete'
    && deserializeResourceValue(mutation.value)?.active === true,
  );
}

function pluginOwnedOwner(value) {
  if (!value || value === ABSENT || typeof value !== 'object') {
    return null;
  }
  return value.__pluginOwner || null;
}

function pluginOwnedDriverPayloadSupport({ mutation, plannedValue }) {
  if (mutation.pluginOwnedResource?.driver !== 'wp-option') {
    return { valid: true, evidence: null };
  }
  if (!(mutation.resource?.type === 'row' && mutation.resource.table === 'wp_options')) {
    return { valid: true, evidence: null };
  }
  const serializedOptionValidationEvidence = serializedOptionValidationEvidenceForRows({
    resourceKey: mutation.resourceKey,
    table: mutation.resource.table,
    rows: [{ snapshot: 'planned', row: plannedValue }],
  });
  if (!serializedOptionValidationEvidence.serialized) {
    return { valid: true, evidence: null };
  }
  const evidence = {
    ...serializedOptionValidationEvidence,
    validator: 'php-serialized-option',
    outcome: serializedOptionValidationEvidence.valid ? 'accepted' : 'refused',
  };
  return {
    valid: serializedOptionValidationEvidence.valid,
    reasonCode: serializedOptionValidationEvidence.valid ? null : 'INVALID_SERIALIZED_OPTION_PAYLOAD',
    evidence,
  };
}

function isSupportedPluginOwnedMutation(remote, mutation, owner, driver, plannedValue) {
  if (plannedValue === ABSENT && mutation.pluginOwnedResource?.supportsDelete !== true) {
    return false;
  }
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

function validatePluginOwnedApplyValidation(mutation, owner, driver) {
  const evidence = mutation.pluginOwnedResource?.applyValidationEvidence;
  if (!evidence) {
    return;
  }

  const passed = evidence.reasonCode === 'PLUGIN_DRIVER_APPLY_VALIDATION_PASSED'
    && evidence.operation === 'apply-validation'
    && evidence.resourceKey === mutation.resourceKey
    && evidence.pluginOwner === owner
    && evidence.driver === driver
    && evidence.supportedHook === true
    && evidence.status === 'passed';
  if (passed) {
    return;
  }

  const reasonCode = typeof evidence.reasonCode === 'string' && evidence.reasonCode
    ? evidence.reasonCode
    : 'PLUGIN_DRIVER_APPLY_VALIDATION_INVALID';
  throw new PushPlanError(
    reasonCode,
    `Refusing to apply plugin-owned resource ${mutation.resourceKey} because driver apply validation did not pass.`,
    {
      mutationId: mutation.id,
      resourceKey: mutation.resourceKey,
      pluginOwner: owner,
      driver,
      applyValidationEvidence: redactedPluginDriverApplyValidationEvidence(evidence),
    },
  );
}

function redactedPluginDriverApplyValidationEvidence(evidence) {
  return {
    reasonCode: evidence?.reasonCode || null,
    operation: evidence?.operation || null,
    resourceKey: evidence?.resourceKey || null,
    pluginOwner: evidence?.pluginOwner || null,
    driver: evidence?.driver || null,
    policySource: evidence?.policySource || null,
    hook: evidence?.hook || null,
    supportedHook: evidence?.supportedHook === true,
    status: evidence?.status || null,
  };
}

function validatePluginOwnedOwnerContext(remote, mutation, owner) {
  const ownerContext = mutation.pluginOwnedResource?.ownerContext;
  const liveOwnerContextResources = livePluginOwnerContextResources(remote, owner);
  if (!Array.isArray(ownerContext) || ownerContext.length === 0) {
    const ownerContextHash = mutation.pluginOwnedResource?.auditEvidence?.ownerContextHash;
    const missingLiveContext = liveOwnerContextResources[0] || null;
    if (
      !missingLiveContext
      && mutation.pluginOwnedResource?.ownerContextRequired !== true
      && (typeof ownerContextHash !== 'string' || ownerContextHash === digest([]))
    ) {
      return;
    }
    throw new PushPlanError(
      'STALE_PLUGIN_OWNER_CONTEXT',
      `Refusing to apply plugin-owned resource ${mutation.resourceKey} without live owner context evidence.`,
      {
        mutationId: mutation.id,
        resourceKey: mutation.resourceKey,
        pluginOwner: owner,
        ...(missingLiveContext
          ? {
            contextResourceKey: missingLiveContext.key,
            actualHash: resourceHash(remote, missingLiveContext),
          }
          : {}),
      },
    );
  }

  const ownerContextKeys = new Set();
  for (const context of ownerContext) {
    if (
      !context?.resource
      || typeof context.resourceKey !== 'string'
      || context.resource.key !== context.resourceKey
      || !/^[a-f0-9]{64}$/.test(context.remoteHash || '')
    ) {
      throw new PushPlanError(
        'STALE_PLUGIN_OWNER_CONTEXT',
        `Refusing to apply plugin-owned resource ${mutation.resourceKey} with invalid owner context evidence.`,
        {
          mutationId: mutation.id,
          resourceKey: mutation.resourceKey,
          pluginOwner: owner,
          contextResourceKey: context?.resourceKey || null,
        },
      );
    }

    ownerContextKeys.add(context.resourceKey);
    const actualHash = resourceHash(remote, context.resource);
    if (actualHash !== context.remoteHash) {
      throw new PushPlanError(
        'STALE_PLUGIN_OWNER_CONTEXT',
        `Refusing to apply plugin-owned resource ${mutation.resourceKey} because owner context ${context.resourceKey} changed since dry run.`,
        {
          mutationId: mutation.id,
          resourceKey: mutation.resourceKey,
          pluginOwner: owner,
          contextResourceKey: context.resourceKey,
          expectedHash: context.remoteHash,
          actualHash,
        },
      );
    }
  }

  for (const contextResource of liveOwnerContextResources) {
    if (ownerContextKeys.has(contextResource.key)) {
      continue;
    }
    throw new PushPlanError(
      'STALE_PLUGIN_OWNER_CONTEXT',
      `Refusing to apply plugin-owned resource ${mutation.resourceKey} without complete live owner context evidence.`,
      {
        mutationId: mutation.id,
        resourceKey: mutation.resourceKey,
        pluginOwner: owner,
        contextResourceKey: contextResource.key,
        actualHash: resourceHash(remote, contextResource),
      },
    );
  }
}

function livePluginOwnerContextResources(remote, owner) {
  return enumerateResources(remote)
    .filter((resource) => {
      if (resource.type === 'plugin') {
        return resource.name === owner;
      }
      return resource.type === 'file' && pluginOwnerFor(resource) === owner;
    });
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

function pluginOwnedApplyValidationEvidence({
  remote,
  mutation,
  owner,
  driver,
  plannedValue,
  remoteValue,
  outcome,
  driverPayloadValidationEvidence = mutation.pluginOwnedResource?.driverPayloadValidationEvidence || null,
}) {
  const serializedOptionValidationEvidence = mutation.resource?.type === 'row'
    && mutation.resource.table === 'wp_options'
    ? serializedOptionValidationEvidenceForRows({
      resourceKey: mutation.resourceKey,
      table: mutation.resource.table,
      rows: [
        { snapshot: 'planned', row: plannedValue },
        { snapshot: 'remote', row: remoteValue },
      ],
    })
    : null;

  return {
    reasonCode: outcome === 'accepted'
      ? 'PLUGIN_DRIVER_APPLY_VALIDATION_ACCEPTED'
      : 'PLUGIN_DRIVER_APPLY_VALIDATION_REFUSED',
    operation: 'driver-apply-validation',
    outcome,
    mutationId: mutation.id,
    resourceKey: mutation.resourceKey,
    pluginOwner: owner,
    driver,
    supportsDelete: mutation.pluginOwnedResource?.supportsDelete === true,
    action: mutation.action,
    resource: pluginOwnedApplyValidationResourceEvidence(mutation.resource),
    planned: {
      state: plannedValue === ABSENT ? 'absent' : 'present',
      hash: digest(plannedValue),
    },
    remote: {
      state: remoteValue === ABSENT ? 'absent' : 'present',
      hash: resourceHash(remote, mutation.resource),
    },
    driverEvidence: pluginOwnedDriverEvidenceSummary(mutation.pluginOwnedResource?.driverEvidence),
    ...(driverPayloadValidationEvidence ? { driverPayloadValidationEvidence } : {}),
    ...(serializedOptionValidationEvidence?.serialized ? { serializedOptionValidationEvidence } : {}),
  };
}

function pluginOwnedApplyValidationResourceEvidence(resource) {
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

function pluginOwnedDriverEvidenceSummary(evidence) {
  if (!evidence || typeof evidence !== 'object') {
    return { state: 'absent' };
  }
  return {
    state: 'present',
    source: evidence.source || null,
    plugin: evidence.plugin || null,
    resourceKey: evidence.resourceKey || null,
    baseHash: evidence.baseHash || null,
    remoteHash: evidence.remoteHash || null,
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
    validateJournalMatchesPlan(journal, plan);
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
        beforeValue: journalValueEvidence(serializeResourceValue(beforeValue), 'beforeValue'),
        afterHash: digest(afterValue),
        afterValue: journalValueEvidence(deepClone(mutation.value), 'afterValue'),
      };
    }),
  };
}

function validateJournalMatchesPlan(journal, plan) {
  const entries = Array.isArray(journal.entries) ? journal.entries : [];
  const mutations = Array.isArray(plan.mutations) ? plan.mutations : [];
  const entryByMutationId = new Map();
  const issues = [];

  if (!Array.isArray(journal.entries)) {
    issues.push({
      code: 'JOURNAL_ENTRIES_MISSING',
      message: 'Recovery journal has no mutation target entries.',
    });
  }

  if (entries.length !== mutations.length) {
    issues.push({
      code: 'JOURNAL_ENTRY_COUNT_MISMATCH',
      expected: mutations.length,
      actual: entries.length,
    });
  }

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || !entry.mutationId) {
      issues.push({
        code: 'JOURNAL_ENTRY_INVALID',
        mutationId: entry?.mutationId || null,
      });
      continue;
    }
    if (entryByMutationId.has(entry.mutationId)) {
      issues.push({
        code: 'JOURNAL_ENTRY_DUPLICATE',
        mutationId: entry.mutationId,
      });
      continue;
    }
    entryByMutationId.set(entry.mutationId, entry);
  }

  for (const mutation of mutations) {
    const entry = entryByMutationId.get(mutation.id);
    if (!entry) {
      issues.push({
        code: 'JOURNAL_ENTRY_MISSING',
        mutationId: mutation.id,
        resourceKey: mutation.resourceKey,
      });
      continue;
    }

    const expectedAfterHash = digest(deserializeResourceValue(mutation.value));
    if (entry.resourceKey !== mutation.resourceKey) {
      issues.push({
        code: 'JOURNAL_RESOURCE_MISMATCH',
        mutationId: mutation.id,
        expected: mutation.resourceKey,
        actual: entry.resourceKey,
      });
    }
    if (entry.action !== mutation.action) {
      issues.push({
        code: 'JOURNAL_ACTION_MISMATCH',
        mutationId: mutation.id,
        expected: mutation.action,
        actual: entry.action,
      });
    }
    if (entry.beforeHash !== mutation.remoteBeforeHash) {
      issues.push({
        code: 'JOURNAL_BEFORE_HASH_MISMATCH',
        mutationId: mutation.id,
        resourceKey: mutation.resourceKey,
      });
    }
    if (entry.afterHash !== expectedAfterHash) {
      issues.push({
        code: 'JOURNAL_AFTER_HASH_MISMATCH',
        mutationId: mutation.id,
        resourceKey: mutation.resourceKey,
      });
    }
  }

  if (issues.length > 0) {
    throw new PushPlanError(
      'JOURNAL_TARGET_MISMATCH',
      `Recovery journal ${journal.id || '(unknown)'} does not match plan ${plan.id}.`,
      {
        journalId: journal.id || null,
        planId: plan.id,
        issues,
      },
    );
  }
}

function journalValueEvidence(value, key) {
  return redactEvidence(value, { key });
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

function getDurableJournalWriter(options) {
  const writer = options.durableJournal || options.recoveryJournal || null;
  if (!writer) {
    return null;
  }
  if (typeof writer.appendEvent !== 'function') {
    throw new PushPlanError(
      'JOURNAL_WRITER_INVALID',
      'Durable recovery journal writer must expose appendEvent(type, payload).',
      {},
    );
  }
  if (writer.claimFenced !== true) {
    throw new PushPlanError(
      'JOURNAL_OWNERSHIP_REQUIRED',
      'Durable recovery journal writer must be claim-fenced before applyPlan can write to it.',
      {},
    );
  }
  if (typeof writer.claimHash !== 'string' || !/^[a-f0-9]{64}$/.test(writer.claimHash)) {
    throw new PushPlanError(
      'JOURNAL_OWNERSHIP_REQUIRED',
      'Durable recovery journal writer must carry a valid claim hash before applyPlan can write to it.',
      {},
    );
  }
  return writer;
}

function ensureDurableJournalClaimOpened(writer, remote, plan) {
  if (!writer || writer.claimFenced !== true) {
    return;
  }
  if (writer.claimOpened === true) {
    return;
  }

  const existingRecords = typeof writer.filePath === 'string'
    ? readPersistedDurableJournalRecords(writer.filePath)
    : [];
  const hasClaimRecords = existingRecords.some((record) => record.type === 'recovery-claim-opened' || record.type === 'stale-claim-advanced');
  if (hasClaimRecords) {
    assertPersistedDurableJournalClaimCurrent(writer, existingRecords, 'journal-opened');
    writer.claimOpened = true;
    return;
  }

  appendDurableEvent(writer, 'recovery-claim-opened', {
    planId: plan.id,
    state: 'active',
    claimHash: writer.claimHash,
    observedHash: digest(remote),
    staleThresholdMs: null,
    reason: 'Durable recovery journal claim opened for this apply run.',
    artifactRefs: {},
  });
  writer.claimOpened = true;
}

function readPersistedDurableJournalRecords(filePath) {
  try {
    const { records, integrity } = readRecoveryJournal(filePath);
    return integrity.status === 'ok' ? records : [];
  } catch {
    return [];
  }
}

function assertPersistedDurableJournalClaimCurrent(writer, records, type) {
  const latestClaim = [...records].reverse().find((record) =>
    record.type === 'recovery-claim-opened' || record.type === 'stale-claim-advanced',
  );

  if (!latestClaim) {
    assertDurableClaimCurrent(writer, type);
    return;
  }

  if (latestClaim.claimHash !== writer.claimHash) {
    throw durableJournalOperationError(
      new PushPlanError(
        'RECOVERY_CLAIM_STALE',
        'Persisted recovery journal claim ownership no longer matches the active writer claim.',
        {
          eventType: type,
          staleClaimHash: writer.claimHash,
          activeClaimHash: latestClaim.claimHash,
          activeClaimSequence: latestClaim.sequence || null,
          activeClaimType: latestClaim.type,
        },
      ),
      type,
    );
  }

  assertDurableClaimCurrent(writer, type);
}

function recordDurablePlanOpened(writer, remote, plan, options = {}) {
  if (!writer) {
    return;
  }

  const artifactRefs = options.artifactRefs || options.journalArtifactRefs || {};
  const retryingOldRemoteJournal = options.previousJournalState === 'old-remote';
  const appendOnlyRetry = retryingOldRemoteJournal && durableJournalHasPriorRecords(writer);
  appendDurableEvent(writer, appendOnlyRetry ? 'journal-retry-opened' : 'journal-opened', {
    planId: plan.id,
    state: retryingOldRemoteJournal ? 'retrying-old-remote' : 'opened',
    observedHash: digest(remote),
    artifactRefs,
  });

  if (appendOnlyRetry) {
    return;
  }

  recordDurableTargets(writer, remote, plan);
}

function recordDurableTargets(writer, remote, plan, journal = null) {
  const entryByMutationId = new Map(
    (journal?.entries || []).map((entry) => [entry.mutationId, entry]),
  );

  for (const mutation of plan.mutations || []) {
    const entry = entryByMutationId.get(mutation.id);
    appendDurableEvent(writer, 'target-planned', {
      planId: plan.id,
      mutationId: mutation.id,
      resourceKey: mutation.resourceKey,
      resourceType: mutation.resource?.type || null,
      action: mutation.action,
      changeKind: mutation.changeKind,
      beforeHash: entry?.beforeHash || mutation.remoteBeforeHash || resourceHash(remote, mutation.resource),
      afterHash: entry?.afterHash || digest(deserializeResourceValue(mutation.value)),
      state: 'planned',
      artifactRefs: {},
    });
  }
}

function durableJournalHasPriorRecords(writer) {
  const persisted = typeof writer.filePath === 'string'
    ? readPersistedDurableJournalRecords(writer.filePath)
    : [];
  return persisted.some((record) => !['recovery-claim-opened', 'stale-claim-advanced'].includes(record.type));
}

function recordDurableReplay(writer, remote, plan, recoveryState, journal = null) {
  if (!writer) {
    return;
  }
  if (!durableJournalHasPriorRecords(writer)) {
    appendDurableEvent(writer, 'journal-opened', {
      planId: plan.id,
      state: 'replay-observed',
      observedHash: digest(remote),
      artifactRefs: {},
    });
    recordDurableTargets(writer, remote, plan, journal);
  }
  recordDurableBoundary(writer, 'journal-replayed', remote, plan, {
    state: recoveryState.status,
    reason: recoveryState.reason,
  });
}

function recordDurableBoundary(writer, type, current, plan, payload = {}) {
  if (!writer) {
    return;
  }
  appendDurableEvent(writer, type, {
    planId: plan.id,
    observedHash: digest(current),
    ...payload,
  });
}

function recordDurableMutationObserved(writer, plan, mutation, current, state) {
  if (!writer) {
    return;
  }
  appendDurableEvent(writer, 'mutation-observed', {
    planId: plan.id,
    mutationId: mutation.id,
    resourceKey: mutation.resourceKey,
    beforeHash: mutation.remoteBeforeHash || resourceHash(current, mutation.resource),
    afterHash: digest(deserializeResourceValue(mutation.value)),
    state,
    observedHash: resourceHash(current, mutation.resource),
    artifactRefs: {},
  });
}

function recordDurableRecoveryState(writer, current, plan, recoveryState) {
  if (!writer) {
    return;
  }
  appendDurableEvent(writer, 'recovery-state', {
    planId: plan.id,
    state: recoveryState.status,
    reason: recoveryState.reason,
    observedHash: digest(current),
    artifactRefs: {},
  });
}

function recordDurableRecoveryStateBestEffort(writer, current, plan, recoveryState) {
  try {
    recordDurableRecoveryState(writer, current, plan, recoveryState);
    return null;
  } catch (error) {
    return durableJournalFailureDetails(error);
  }
}

function appendDurableEvent(writer, type, payload) {
  try {
    return writer.appendEvent(type, payload);
  } catch (error) {
    throw durableJournalOperationError(error, type);
  }
}

function assertDurableClaimCurrent(writer, type) {
  if (!writer || typeof writer.assertCurrentClaim !== 'function') {
    return;
  }
  try {
    writer.assertCurrentClaim(type);
  } catch (error) {
    throw durableJournalOperationError(error, type);
  }
}

function durableJournalOperationError(error, type) {
  if (error?.code === 'RECOVERY_CLAIM_STALE') {
    return new PushPlanError(
      'RECOVERY_CLAIM_STALE',
      `Durable recovery journal claim was superseded before ${type}.`,
      {
        eventType: type,
        ...(error.details || {}),
      },
    );
  }

  return new PushPlanError(
    'JOURNAL_WRITE_FAILED',
    `Durable recovery journal write failed for ${type}.`,
    {
      eventType: type,
      causeMessage: error?.message || String(error),
    },
  );
}

function journalWriteFailureBeforeMutation(error, remote, plan, journal, boundary) {
  if (error?.code === 'RECOVERY_CLAIM_STALE') {
    return recoveryClaimStaleBlocked(error, remote, plan, journal, boundary);
  }
  return journalWriteFailureOldRemote(error, remote, plan, journal, boundary);
}

function recoveryClaimStaleBlocked(error, remote, plan, journal, boundary) {
  return recoveryBlocked(
    remote,
    plan,
    markJournalStatus(journal, 'blocked'),
    `Recovery journal claim was superseded before remote mutation at ${boundary}.`,
    {
      code: 'RECOVERY_CLAIM_STALE',
      boundary,
      eventType: error?.details?.eventType || boundary,
      staleClaimHash: error?.details?.staleClaimHash || null,
      activeClaimHash: error?.details?.activeClaimHash || null,
      activeClaimSequence: error?.details?.activeClaimSequence || null,
      activeClaimType: error?.details?.activeClaimType || null,
      causeMessage: error?.message || String(error),
    },
  );
}

function runBeforeMutationHook(options, context) {
  if (typeof options.beforeMutation === 'function') {
    options.beforeMutation({
      ...context,
      driverApplyValidation: driverApplyValidationHookEvidence(context.remote, context.mutation),
    });
  }
}

function driverApplyValidationHookEvidence(remote, mutation) {
  const plannedValue = deserializeResourceValue(mutation.value);
  const remoteValue = getResource(remote, mutation.resource);
  const owner = pluginOwnedOwner(plannedValue) || pluginOwnedOwner(remoteValue);
  if (!owner) {
    return null;
  }
  return pluginOwnedApplyValidationEvidence({
    remote,
    mutation,
    owner,
    driver: mutation.pluginOwnedResource?.driver || null,
    plannedValue,
    remoteValue,
    outcome: 'accepted',
  });
}

function claimFenceFailure(error, remote, plan, journal, mutation) {
  if (error?.code === 'RECOVERY_CLAIM_STALE') {
    return recoveryClaimStaleBlocked(
      error,
      remote,
      plan,
      journal,
      `mutation ${mutation.id}`,
    );
  }
  return recoveryBlocked(
    remote,
    plan,
    markJournalStatus(journal, 'blocked'),
    `Durable recovery journal claim check failed before committing mutation ${mutation.id}.`,
    {
      code: error?.code || 'JOURNAL_WRITE_FAILED',
      mutationId: mutation.id,
      resourceKey: mutation.resourceKey,
      causeMessage: error?.details?.causeMessage || error?.message || String(error),
    },
  );
}

function commitStagedSite(remote, staged, plan, journal, options, durableJournal) {
  let committed = options.mutateRemote ? remote : deepClone(remote);
  let committedJournal = markJournalStatus(journal, 'committing');
  let appliedMutations = 0;
  try {
    recordDurableBoundary(durableJournal, 'apply-committing', committed, plan, {
      state: 'committing',
    });
  } catch (error) {
    return {
      failure: journalWriteFailureBeforeMutation(error, committed, plan, committedJournal, 'apply-committing'),
    };
  }

  for (const mutation of plan.mutations) {
    try {
      runBeforeMutationHook(options, {
        mutation,
        mutationIndex: appliedMutations + 1,
        remote: committed,
        plan,
        journal: committedJournal,
        durableJournal,
      });
      assertDurableClaimCurrent(durableJournal, 'mutation-write');
    } catch (error) {
      return {
        failure: claimFenceFailure(error, committed, plan, committedJournal, mutation),
      };
    }

    appliedMutations++;
    setResource(committed, mutation.resource, deserializeResourceValue(mutation.value));
    committedJournal = markJournalEntry(committedJournal, mutation.id, 'applied');
    try {
      recordDurableMutationObserved(durableJournal, plan, mutation, committed, 'applied');
    } catch (error) {
      const blockedJournal = markJournalStatus(committedJournal, 'blocked');
      return {
        failure: recoveryBlocked(
          committed,
          plan,
          blockedJournal,
          `Durable recovery journal write failed after committing mutation ${mutation.id}.`,
          {
            code: error?.code || 'JOURNAL_WRITE_FAILED',
            mutationId: mutation.id,
            causeMessage: error?.details?.causeMessage || error?.message || String(error),
          },
        ),
      };
    }

    if (options.failDuringCommitAtMutation === appliedMutations) {
      const blockedJournal = markJournalStatus(committedJournal, 'blocked');
      try {
        recordDurableRecoveryState(durableJournal, committed, plan, {
          status: 'blocked-recovery',
          reason: `Injected failure while committing mutation ${mutation.id}.`,
        });
      } catch {
        // The in-memory blocked artifact below still classifies the partial remote.
      }
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
  try {
    recordDurableBoundary(durableJournal, 'journal-completed', committed, plan, {
      state: 'completed',
    });
  } catch (error) {
    return {
      failure: recoveryBlocked(
        committed,
        plan,
        completedJournal,
        'Durable recovery journal write failed after committing all mutations.',
        {
          code: error?.code || 'JOURNAL_WRITE_FAILED',
          causeMessage: error?.details?.causeMessage || error?.message || String(error),
        },
      ),
    };
  }

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

function fullyUpdatedRecoveryState(remote, plan, journal, reason) {
  return {
    status: 'fully-updated-remote',
    reason,
    remoteHash: digest(remote),
    planId: plan.id,
    artifacts: {
      journal,
    },
  };
}

function journalWriteFailureOldRemote(error, remote, plan, journal, boundary) {
  const details = durableJournalFailureDetails(error);
  const reason = `Durable recovery journal write failed before committing remote mutations at ${boundary}.`;
  return new PushPlanError(
    'JOURNAL_WRITE_FAILED',
    reason,
    {
      boundary,
      ...details,
      recovery: oldRemoteRecoveryState(remote, plan, journal, reason),
    },
  );
}

function journalWriteFailureFullyUpdated(error, remote, plan, journal, boundary) {
  const details = durableJournalFailureDetails(error);
  const reason = `Durable recovery journal write failed while recording completed replay at ${boundary}.`;
  return new PushPlanError(
    'JOURNAL_WRITE_FAILED',
    reason,
    {
      boundary,
      ...details,
      recovery: fullyUpdatedRecoveryState(remote, plan, journal, reason),
    },
  );
}

function recoveryStateDurableWriteDetails(errorDetails) {
  if (!errorDetails) {
    return {};
  }
  return {
    durableRecoveryStateWriteFailed: true,
    durableJournalError: errorDetails,
  };
}

function durableJournalFailureDetails(error) {
  return {
    eventType: error?.details?.eventType || null,
    causeMessage: error?.details?.causeMessage || error?.message || String(error),
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
  const mutations = Array.isArray(plan.mutations) ? plan.mutations : [];
  const preconditions = Array.isArray(plan.preconditions) ? plan.preconditions : [];
  const mutationIds = new Set();
  const preconditionByMutationId = new Map();

  for (const mutation of mutations) {
    if (!mutation?.id) {
      throw new PushPlanError(
        'PRECONDITION_MUTATION_INVALID',
        'Ready plan contains a mutation without a stable id.',
        { resourceKey: mutation?.resourceKey || null },
      );
    }
    mutationIds.add(mutation.id);
  }

  for (const precondition of preconditions) {
    if (!precondition?.mutationId) {
      throw new PushPlanError(
        'PRECONDITION_INVALID',
        'Ready plan contains a precondition without a mutation id.',
        { resourceKey: precondition?.resourceKey || null },
      );
    }
    if (!mutationIds.has(precondition.mutationId)) {
      throw new PushPlanError(
        'PRECONDITION_UNMATCHED',
        `Ready plan contains a precondition for unknown mutation ${precondition.mutationId}.`,
        {
          mutationId: precondition.mutationId,
          resourceKey: precondition.resourceKey || null,
        },
      );
    }
    if (preconditionByMutationId.has(precondition.mutationId)) {
      throw new PushPlanError(
        'PRECONDITION_DUPLICATE',
        `Ready plan contains duplicate preconditions for mutation ${precondition.mutationId}.`,
        {
          mutationId: precondition.mutationId,
          resourceKey: precondition.resourceKey || null,
        },
      );
    }
    preconditionByMutationId.set(precondition.mutationId, precondition);
  }

  for (const mutation of mutations) {
    const precondition = preconditionByMutationId.get(mutation.id);
    if (!precondition) {
      throw new PushPlanError(
        'PRECONDITION_MISSING',
        `Ready plan mutation ${mutation.id} has no live-remote precondition.`,
        {
          mutationId: mutation.id,
          resourceKey: mutation.resourceKey,
        },
      );
    }
    if (precondition.resourceKey !== mutation.resourceKey) {
      throw new PushPlanError(
        'PRECONDITION_RESOURCE_MISMATCH',
        `Ready plan precondition for ${mutation.id} targets ${precondition.resourceKey}, not ${mutation.resourceKey}.`,
        {
          mutationId: mutation.id,
          expectedResourceKey: mutation.resourceKey,
          preconditionResourceKey: precondition.resourceKey,
        },
      );
    }
    if (precondition.expectedHash !== mutation.remoteBeforeHash) {
      throw new PushPlanError(
        'PRECONDITION_HASH_MISMATCH',
        `Ready plan precondition hash does not match mutation remoteBeforeHash for ${mutation.resourceKey}.`,
        {
          mutationId: mutation.id,
          resourceKey: mutation.resourceKey,
          expectedHash: mutation.remoteBeforeHash,
          preconditionHash: precondition.expectedHash,
        },
      );
    }
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

function validateReadyPlanEnvelope(plan) {
  const issues = [];
  const mutations = Array.isArray(plan.mutations) ? plan.mutations : [];
  const preconditions = Array.isArray(plan.preconditions) ? plan.preconditions : [];
  const decisions = Array.isArray(plan.decisions) ? plan.decisions : [];
  const conflicts = Array.isArray(plan.conflicts) ? plan.conflicts : [];
  const blockers = Array.isArray(plan.blockers) ? plan.blockers : [];
  const mutationsById = new Map();
  const mutationsByResourceKey = new Map();
  const preconditionsByMutationId = new Map();

  if (conflicts.length > 0) {
    issues.push({
      code: 'READY_PLAN_HAS_CONFLICTS',
      count: conflicts.length,
    });
  }
  if (blockers.length > 0) {
    issues.push({
      code: 'READY_PLAN_HAS_BLOCKERS',
      count: blockers.length,
    });
  }

  for (const mutation of mutations) {
    if (!mutation?.id) {
      issues.push({
        code: 'MUTATION_ID_MISSING',
        resourceKey: mutation?.resourceKey || null,
      });
      continue;
    }
    if (mutationsById.has(mutation.id)) {
      issues.push({
        code: 'DUPLICATE_MUTATION_ID',
        mutationId: mutation.id,
        resourceKey: mutation.resourceKey || null,
      });
      continue;
    }
    mutationsById.set(mutation.id, mutation);
    if (typeof mutation.resourceKey === 'string' && mutation.resourceKey.length > 0) {
      const existingMutation = mutationsByResourceKey.get(mutation.resourceKey);
      if (existingMutation) {
        issues.push({
          code: 'DUPLICATE_MUTATION_RESOURCE',
          resourceKey: mutation.resourceKey,
          firstMutationId: existingMutation.id,
          duplicateMutationId: mutation.id,
        });
      } else {
        mutationsByResourceKey.set(mutation.resourceKey, mutation);
      }
    }
    if (mutation.resource?.key && mutation.resource.key !== mutation.resourceKey) {
      issues.push({
        code: 'MUTATION_RESOURCE_KEY_MISMATCH',
        mutationId: mutation.id,
        resourceKey: mutation.resourceKey || null,
        actualResourceKey: mutation.resource.key,
      });
    }

    const remoteBeforeHashState = hashEvidenceState(mutation.remoteBeforeHash);
    if (remoteBeforeHashState === 'missing') {
      issues.push({
        code: 'REMOTE_BEFORE_HASH_MISSING',
        mutationId: mutation.id,
        resourceKey: mutation.resourceKey || null,
        remoteBeforeHash: hashEvidenceForDetails(mutation.remoteBeforeHash),
      });
    } else if (remoteBeforeHashState === 'invalid') {
      issues.push({
        code: 'REMOTE_BEFORE_HASH_INVALID',
        mutationId: mutation.id,
        resourceKey: mutation.resourceKey || null,
        remoteBeforeHash: hashEvidenceForDetails(mutation.remoteBeforeHash),
      });
    }

    const localHashState = hashEvidenceState(mutation.localHash);
    if (localHashState === 'missing') {
      issues.push({
        code: 'LOCAL_HASH_MISSING',
        mutationId: mutation.id,
        resourceKey: mutation.resourceKey || null,
        localHash: hashEvidenceForDetails(mutation.localHash),
      });
    } else if (localHashState === 'invalid') {
      issues.push({
        code: 'LOCAL_HASH_INVALID',
        mutationId: mutation.id,
        resourceKey: mutation.resourceKey || null,
        localHash: hashEvidenceForDetails(mutation.localHash),
      });
    } else {
      const plannedValueHash = plannedMutationValueHash(mutation);
      if (plannedValueHash === null) {
        issues.push({
          code: 'LOCAL_HASH_VALUE_INVALID',
          mutationId: mutation.id,
          resourceKey: mutation.resourceKey || null,
          localHash: hashEvidenceForDetails(mutation.localHash),
        });
      } else if (plannedValueHash !== mutation.localHash) {
        issues.push({
          code: 'LOCAL_HASH_MISMATCH',
          mutationId: mutation.id,
          resourceKey: mutation.resourceKey || null,
          localHash: mutation.localHash,
          plannedValueHash,
        });
      }
    }
  }

  for (const precondition of preconditions) {
    const mutationId = precondition?.mutationId || null;
    if (!mutationId) {
      issues.push({
        code: 'PRECONDITION_MUTATION_ID_MISSING',
        resourceKey: precondition?.resourceKey || null,
      });
      continue;
    }
    if (preconditionsByMutationId.has(mutationId)) {
      issues.push({
        code: 'DUPLICATE_LIVE_REMOTE_PRECONDITION',
        mutationId,
        resourceKey: precondition.resourceKey || null,
      });
      continue;
    }
    preconditionsByMutationId.set(mutationId, precondition);

    const mutation = mutationsById.get(mutationId);
    if (!mutation) {
      issues.push({
        code: 'PRECONDITION_WITHOUT_MUTATION',
        mutationId,
        resourceKey: precondition.resourceKey || null,
      });
      continue;
    }
    if (precondition.resourceKey !== mutation.resourceKey) {
      issues.push({
        code: 'PRECONDITION_RESOURCE_KEY_MISMATCH',
        mutationId,
        expectedResourceKey: mutation.resourceKey || null,
        actualResourceKey: precondition.resourceKey || null,
      });
    }
    if (precondition.resource?.key && precondition.resource.key !== mutation.resourceKey) {
      issues.push({
        code: 'PRECONDITION_RESOURCE_OBJECT_MISMATCH',
        mutationId,
        expectedResourceKey: mutation.resourceKey || null,
        actualResourceKey: precondition.resource.key,
      });
    }
    if (precondition.expectedHash !== mutation.remoteBeforeHash) {
      issues.push({
        code: 'PRECONDITION_HASH_MISMATCH',
        mutationId,
        resourceKey: mutation.resourceKey || precondition.resourceKey || null,
        expectedHash: hashEvidenceForDetails(mutation.remoteBeforeHash),
        actualHash: hashEvidenceForDetails(precondition.expectedHash),
      });
    }
    if (precondition.checkedAgainst !== 'live-remote') {
      issues.push({
        code: 'PRECONDITION_NOT_LIVE_REMOTE',
        mutationId,
        resourceKey: mutation.resourceKey || precondition.resourceKey || null,
        checkedAgainst: precondition.checkedAgainst || null,
      });
    }
  }

  for (const decision of decisions) {
    const resourceKey = decision?.resourceKey || null;
    if (!resourceKey) {
      continue;
    }
    const overlappingMutation = mutationsByResourceKey.get(resourceKey);
    if (!overlappingMutation) {
      continue;
    }
    issues.push({
      code: 'MUTATION_DECISION_RESOURCE_OVERLAP',
      mutationId: overlappingMutation.id,
      decisionId: decision.id || null,
      resourceKey,
    });
  }

  for (const mutation of mutations) {
    if (!mutation?.id || preconditionsByMutationId.has(mutation.id)) {
      continue;
    }
    issues.push({
      code: 'MISSING_LIVE_REMOTE_PRECONDITION',
      mutationId: mutation.id,
      resourceKey: mutation.resourceKey || null,
      expectedHash: hashEvidenceForDetails(mutation.remoteBeforeHash),
    });
  }

  if (issues.length > 0) {
    throw new PushPlanError(
      'PLAN_INVARIANT_VIOLATION',
      `Ready plan ${plan.id || '(unknown)'} failed invariant validation.`,
      {
        planId: plan.id || null,
        issues,
      },
    );
  }
}

function hashEvidenceState(value) {
  if (value === undefined || value === null || value === '') {
    return 'missing';
  }
  if (typeof value !== 'string') {
    return 'invalid';
  }
  return SHA256_HEX_PATTERN.test(value) ? 'hash' : 'invalid';
}

function hashEvidenceForDetails(value) {
  const state = hashEvidenceState(value);
  if (state === 'hash') {
    return value;
  }
  if (state === 'missing') {
    return { state };
  }
  return stripUndefined({
    state,
    sha256: digest(value),
    valueType: valueType(value),
    characterCount: typeof value === 'string' ? value.length : undefined,
  });
}

function plannedMutationValueHash(mutation) {
  try {
    return digest(deserializeResourceValue(mutation.value));
  } catch {
    return null;
  }
}

function valueType(value) {
  if (Array.isArray(value)) {
    return 'array';
  }
  if (value === null) {
    return 'null';
  }
  return typeof value;
}

function stripUndefined(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined),
  );
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
