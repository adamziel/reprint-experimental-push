import { ABSENT, deepClone, digest } from './stable-json.js';
import path from 'node:path';
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
export const ACCEPTABLE_RECOVERY_STATES = Object.freeze([
  'old-remote',
  'fully-updated-remote',
  'blocked-recovery',
]);

export function isAcceptableRecoveryState(recoveryState) {
  if (!recoveryState || typeof recoveryState !== 'object') {
    return false;
  }

  if (!ACCEPTABLE_RECOVERY_STATES.includes(recoveryState.status)) {
    return false;
  }

  if (recoveryState.status !== 'blocked-recovery') {
    return Boolean(
      recoveryState.artifacts
      && isPlainObject(recoveryState.artifacts.journal)
      && recoveryState.artifacts.remote === undefined,
    );
  }

  return Boolean(
    recoveryState.artifacts
    && isPlainObject(recoveryState.artifacts.journal)
    && isPlainObject(recoveryState.artifacts.remote)
    && recoveryState.artifacts.journal !== recoveryState.artifacts.remote,
  );
}

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

  const durableJournalInput = options.durableJournal || options.recoveryJournal || null;
  let durableJournal = null;
  const preserveWriterForReplay = Boolean(options.journal);
  try {
    durableJournal = getDurableJournalWriter(options);
    assertProductionDurableJournalSupport(options, durableJournal);
    const hasPreviousJournal = Boolean(options.journal);
    let previousJournalState = null;
    let journal = prepareJournal(remote, plan, options.journal);
    if (journal.status === 'completed') {
      let replayResult;
      try {
        replayResult = replayCompletedPlan(remote, plan, journal);
        assertRecoveryStateEnvelope(replayResult.recoveryState);
        recordDurableReplay(durableJournal, remote, plan, replayResult.recoveryState, journal);
        return replayResult;
      } catch (error) {
        if (error?.details?.recovery?.status === 'blocked-recovery') {
          recordDurableRecoveryStateBestEffort(durableJournal, remote, plan, error.details.recovery);
          throw error;
        }
        throw journalWriteFailureFullyUpdated(
          error,
          remote,
          plan,
          replayResult?.journal || journal,
          'journal-replayed',
          recoveryStateDurableWriteDetails(error?.details),
        );
      }
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
          assertRecoveryStateEnvelope(recoveryState);
          recordDurableReplay(durableJournal, remote, plan, recoveryState, completedJournal);
          recordDurableRecoveryState(durableJournal, remote, plan, recoveryState);
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
  } finally {
    void durableJournalInput;
    void preserveWriterForReplay;
  }
}

function assertRecoveryStateEnvelope(recoveryState) {
  if (!isAcceptableRecoveryState(recoveryState)) {
    throw new PushPlanError(
      'RECOVERY_STATE_INVALID',
      'Recovery state must be old-remote, fully-updated-remote, or blocked-recovery.',
      { recoveryState },
    );
  }
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
        beforeValue: journalValueEvidence(mutation, serializeResourceValue(beforeValue)),
        afterHash: digest(afterValue),
        afterValue: journalValueEvidence(mutation, deepClone(mutation.value)),
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
    recoveryState: completedReplayRecoveryState(remote, plan, journal),
  };
}

function completedReplayRecoveryState(remote, plan, journal) {
  return fullyUpdatedRecoveryState(
    remote,
    plan,
    journal,
    'Completed plan replayed without reapplying mutations.',
  );
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
  return writer;
}

function assertProductionDurableJournalSupport(options, writer) {
  if (!options?.requireProductionDurableJournal) {
    return;
  }

  const supportReport = productionRecoverySupportReport(writer);
  if (supportReport.supported) {
    return;
  }

  closeUnsupportedProductionRecoveryWriter(writer);

  throw new PushPlanError(
    'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED',
    'Production durable journal recovery is not available in this worktree.',
    {
      supportedSurface: 'production-recovery-journal-adapter',
      missingDependency: supportReport.missingDependency,
      inspectedJournalPath: supportReport.inspectedJournalPath,
      writerJournalPath: supportReport.writerJournalPath,
      inspectionErrorMessage: supportReport.inspectionErrorMessage,
      requiresDurableJournal: true,
    },
  );
}

function productionRecoverySupportReport(writer) {
  const missingDependency = [];
  const inspected = inspectProductionRecoveryJournal(writer);
  const inspectedJournalPath = durableJournalInspectPath(inspected);
  const inspectionErrorMessage = inspected && typeof inspected === 'object' && typeof inspected.error?.message === 'string'
    ? inspected.error.message
    : null;
  const addMissingDependency = (item) => {
    if (!missingDependency.includes(item)) {
      missingDependency.push(item);
    }
  };

  if (writer?.kind !== 'production-recovery-journal') {
    addMissingDependency('production recovery journal adapter marker');
  }
  if (writer?.supportedSurface === 'production-recovery-journal-adapter' && writer.restartReadable !== true) {
    addMissingDependency('restart-readable recovery journal adapter');
  }
  if (writer?.productionAdapter !== true) {
    addMissingDependency('explicit production recovery adapter marker');
  }
  if (writer?.ownsJournal !== true) {
    addMissingDependency('explicit journal ownership fencing');
  }
  if (typeof writer?.flush !== 'function') {
    addMissingDependency('stable-storage flush or fsync semantics');
  }
  if (typeof writer?.close !== 'function') {
    addMissingDependency('durable writer cleanup');
  }
  if (typeof writer?.inspect !== 'function' || inspectionErrorMessage) {
    addMissingDependency('restart-readable recovery inspection');
  } else {
    if (typeof inspected?.schemaVersion !== 'number' || inspected.schemaVersion !== writer.schemaVersion) {
      addMissingDependency('restart-readable recovery journal schema');
    }
    if (!durableJournalInspectSurface(inspected)) {
      addMissingDependency('restart-readable recovery artifact location');
    } else if (!isCanonicalAbsolutePath(inspected.filePath)) {
      addMissingDependency('restart-readable recovery artifact location');
    }
    if (inspectedJournalPath !== writer.journalPath) {
      addMissingDependency('restart-readable recovery artifact location');
    }
  }
  const writerJournalArtifactRef = typeof writer?.artifactRefs?.journal === 'string'
    ? writer.artifactRefs.journal
    : null;
  const writerRemoteArtifactRef = typeof writer?.artifactRefs?.remote === 'string'
    && writer.artifactRefs.remote.length > 0
    ? writer.artifactRefs.remote
    : null;
  if (!isPlainObject(writer?.artifactRefs) || !writer.artifactRefs.journal) {
    addMissingDependency('restart-readable recovery artifact references');
  } else if (
    typeof writer.artifactRefs.journal !== 'string'
    || !isCanonicalAbsolutePath(writer.artifactRefs.journal)
    || (
      typeof writer.journalPath === 'string'
      && writer.artifactRefs.journal !== writer.journalPath
    )
  ) {
    addMissingDependency('restart-readable recovery artifact references');
  }
  if (!durableJournalInspectArtifactRefs(inspected)) {
    addMissingDependency('restart-readable recovery artifact references');
  } else if (
    typeof inspected.artifactRefs.journal !== 'string'
    || !isCanonicalAbsolutePath(inspected.artifactRefs.journal)
    || (
      writerJournalArtifactRef
      && inspected.artifactRefs.journal !== writerJournalArtifactRef
    )
    || (
      inspectedJournalPath
      && inspected.artifactRefs.journal !== inspectedJournalPath
    )
  ) {
    addMissingDependency('restart-readable recovery artifact references');
  }
  if (
    writerJournalArtifactRef
    && inspectedJournalPath
    && writerJournalArtifactRef !== inspectedJournalPath
  ) {
    addMissingDependency('restart-readable recovery artifact references');
  }
  if (
    isPlainObject(writer?.artifactRefs)
    && Object.hasOwn(writer.artifactRefs, 'remote')
    && (typeof writer.artifactRefs.remote !== 'string' || writer.artifactRefs.remote.length === 0)
  ) {
    addMissingDependency('restart-readable recovery remote artifact references');
  }
  if (
    durableJournalInspectArtifactRefs(inspected)
    && Object.hasOwn(inspected.artifactRefs, 'remote')
    && (typeof inspected.artifactRefs.remote !== 'string' || inspected.artifactRefs.remote.length === 0)
  ) {
    addMissingDependency('restart-readable recovery remote artifact references');
  }
  const inspectedRemoteArtifactRef = durableJournalInspectArtifactRefs(inspected)
    && typeof inspected.artifactRefs.remote === 'string'
    && inspected.artifactRefs.remote.length > 0
    ? inspected.artifactRefs.remote
    : null;
  if (
    writerRemoteArtifactRef
    || inspectedRemoteArtifactRef
  ) {
    if (writer?.ownsRemoteArtifact !== true) {
      addMissingDependency('restart-readable remote recovery artifact ownership');
    }
  }
  if (inspectedRemoteArtifactRef && !writerRemoteArtifactRef) {
    addMissingDependency('restart-readable recovery remote artifact references');
  }
  if (writerRemoteArtifactRef) {
    if (!isCanonicalAbsolutePath(writerRemoteArtifactRef)) {
      addMissingDependency('restart-readable recovery remote artifact references');
    }
    if (writer?.journalPath && writerRemoteArtifactRef === writer.journalPath) {
      addMissingDependency('restart-readable recovery remote artifact references');
    }
    if (writerJournalArtifactRef && writerRemoteArtifactRef === writerJournalArtifactRef) {
      addMissingDependency('restart-readable recovery remote artifact references');
    }
    if (!inspectedRemoteArtifactRef) {
      addMissingDependency('restart-readable recovery remote artifact references');
    } else if (inspectedRemoteArtifactRef !== writerRemoteArtifactRef) {
      addMissingDependency('restart-readable recovery remote artifact references');
    }
  }
  if (inspectedRemoteArtifactRef && !isCanonicalAbsolutePath(inspectedRemoteArtifactRef)) {
    addMissingDependency('restart-readable recovery remote artifact references');
  }
  if (inspectedRemoteArtifactRef && inspectedRemoteArtifactRef === inspectedJournalPath) {
    addMissingDependency('restart-readable recovery remote artifact references');
  }
  if (inspectedRemoteArtifactRef && writerRemoteArtifactRef && inspectedRemoteArtifactRef !== writerRemoteArtifactRef) {
    addMissingDependency('restart-readable recovery remote artifact references');
  }
  if (typeof writer?.journalPath !== 'string' || writer.journalPath.length === 0) {
    addMissingDependency('owned restart-readable recovery journal path');
  } else if (!isCanonicalAbsolutePath(writer.journalPath)) {
    addMissingDependency('absolute restart-readable recovery journal path');
  }
  if (typeof writer?.schemaVersion !== 'number' || writer.schemaVersion !== JOURNAL_SCHEMA_VERSION) {
    addMissingDependency('restart-readable recovery journal schema');
  }
  if (typeof writer?.assertCurrentClaim !== 'function') {
    addMissingDependency('fencing or lease ownership for the journal writer');
  } else {
    try {
      writer.assertCurrentClaim('production-recovery-journal');
    } catch {
      addMissingDependency('fencing or lease ownership for the journal writer');
    }
  }
  if (writer && typeof writer.inspect === 'function' && !inspectionErrorMessage && !durableJournalInspectRecords(inspected)) {
    addMissingDependency('journal-readable inspection records with sequence and type');
  }

  return {
    supported: missingDependency.length === 0,
    missingDependency,
    inspectedJournalPath,
    writerJournalPath: typeof writer?.journalPath === 'string' ? writer.journalPath : null,
    inspectionErrorMessage,
  };
}

function closeUnsupportedProductionRecoveryWriter(writer) {
  if (!writer || typeof writer.close !== 'function') {
    return;
  }

  try {
    writer.close();
  } catch {
    // Unsupported writers are still fail-closed if cleanup fails.
  }
}

function inspectProductionRecoveryJournal(writer) {
  if (!writer || typeof writer.inspect !== 'function') {
    return null;
  }
  try {
    return writer.inspect();
  } catch (error) {
    return { error };
  }
}

function durableJournalInspectSurface(inspected) {
  return Boolean(
    inspected
    && typeof inspected === 'object'
    && typeof inspected.filePath === 'string'
    && typeof inspected.schemaVersion === 'number'
    && Array.isArray(inspected.records),
  ) && inspected.records.every((record) =>
    record
    && typeof record === 'object'
    && Number.isInteger(record.sequence)
    && typeof record.type === 'string',
  );
}

function durableJournalInspectArtifactRefs(inspected) {
  return Boolean(
    inspected
    && typeof inspected === 'object'
    && isPlainObject(inspected.artifactRefs)
    && typeof inspected.artifactRefs.journal === 'string'
  );
}

function isCanonicalAbsolutePath(filePath) {
  return typeof filePath === 'string'
    && path.isAbsolute(filePath)
    && path.resolve(filePath) === filePath
    && !/[?#]/.test(filePath);
}

function durableJournalInspectPath(inspected) {
  return inspected && typeof inspected === 'object' && typeof inspected.filePath === 'string'
    ? inspected.filePath
    : null;
}

function durableJournalInspectRecords(inspected) {
  return Boolean(
    inspected
    && typeof inspected === 'object'
    && typeof inspected.schemaVersion === 'number'
    && Array.isArray(inspected.records),
  ) && inspected.records.length > 0
  && inspected.records[0].type === 'journal-opened'
  && inspected.records.every((record) =>
    record
    && typeof record === 'object'
    && Number.isInteger(record.sequence)
    && typeof record.type === 'string',
  ) && inspected.records.every((record, index, records) => (
    index === 0
      ? record.sequence === 1
      : record.sequence === records[index - 1].sequence + 1
  ));
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
  return Number.isInteger(writer.nextSequence) && writer.nextSequence > 1;
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
  recordDurableRecoveryState(writer, remote, plan, recoveryState);
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

  const artifactRefs = recoveryState.status === 'blocked-recovery'
    ? {
        journal: typeof writer?.journalPath === 'string' ? writer.journalPath : null,
        remote: recoveryState.artifacts?.remote ? digest(recoveryState.artifacts.remote) : null,
      }
    : {
        journal: typeof writer?.journalPath === 'string' ? writer.journalPath : null,
      };

  appendDurableEvent(writer, 'recovery-state', {
    planId: plan.id,
    state: recoveryState.status,
    reason: recoveryState.reason,
    observedHash: digest(current),
    artifactRefs,
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
    if (writer?.kind === 'production-recovery-journal') {
      assertDurableClaimCurrent(writer, type);
    }
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
    options.beforeMutation(context);
  }
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
    recordDurableRecoveryState(durableJournal, committed, plan, {
      status: 'fully-updated-remote',
      reason: 'All planned mutations were committed.',
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
      recovery: recoveryState('old-remote', remote, plan, journal, message, {
        artifacts: { journal },
      }),
    },
  );
}

function oldRemoteRecoveryState(remote, plan, journal, reason) {
  return recoveryState('old-remote', remote, plan, journal, reason, {
    artifacts: { journal },
  });
}

function fullyUpdatedRecoveryState(remote, plan, journal, reason) {
  return recoveryState('fully-updated-remote', remote, plan, journal, reason, {
    artifacts: { journal },
  });
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

function journalWriteFailureFullyUpdated(error, remote, plan, journal, boundary, recoveryDetails = {}) {
  const details = durableJournalFailureDetails(error);
  const reason = `Durable recovery journal write failed while recording completed replay at ${boundary}.`;
  return new PushPlanError(
    'JOURNAL_WRITE_FAILED',
    reason,
    {
      boundary,
      ...details,
      ...recoveryDetails,
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
      recovery: recoveryState('blocked-recovery', remote, plan, journal, reason, {
        artifacts: {
          journal,
          remote: sanitizeRecoveryRemote(remote, plan),
        },
      }),
    },
  );
}

function recoveryState(status, remote, plan, journal, reason, details = {}) {
  if (!ACCEPTABLE_RECOVERY_STATES.includes(status)) {
    throw new PushPlanError(
      'RECOVERY_STATE_UNSUPPORTED',
      `Unsupported recovery state ${status}.`,
      { status, planId: plan.id },
    );
  }

  const recovery = {
    status,
    reason,
    remoteHash: digest(remote),
    planId: plan.id,
    ...details,
  };

  if (status !== 'blocked-recovery') {
    recovery.artifacts = {
      ...(recovery.artifacts || {}),
      journal,
    };
    delete recovery.artifacts.remote;
    validateRecoveryArtifacts(recovery);
    return recovery;
  }

  validateRecoveryArtifacts(recovery);
  return recovery;
}

export function validateRecoveryArtifacts(recovery) {
  if (!isPlainObject(recovery.artifacts)) {
    throw new PushPlanError(
      'RECOVERY_ARTIFACTS_INVALID',
      'Recovery states must preserve a plain-object artifact envelope.',
      {
        status: recovery.status,
        planId: recovery.planId,
      },
    );
  }

  if (recovery.status === 'blocked-recovery') {
    if (!isPlainObject(recovery.artifacts.journal) || !isPlainObject(recovery.artifacts.remote)) {
      throw new PushPlanError(
        'RECOVERY_ARTIFACTS_INVALID',
        'Blocked recovery states must preserve both plain-object journal and remote artifacts.',
        {
          status: recovery.status,
          planId: recovery.planId,
        },
      );
    }
    if (recovery.artifacts.journal === recovery.artifacts.remote) {
      throw new PushPlanError(
        'RECOVERY_ARTIFACTS_INVALID',
        'Blocked recovery states must preserve distinct journal and remote artifacts.',
        {
          status: recovery.status,
          planId: recovery.planId,
        },
      );
    }
    return;
  }

  if (!isPlainObject(recovery.artifacts.journal)) {
    throw new PushPlanError(
      'RECOVERY_ARTIFACTS_INVALID',
      'Non-blocked recovery states must preserve a plain-object journal artifact.',
      {
        status: recovery.status,
        planId: recovery.planId,
      },
    );
  }

  if (recovery.artifacts.remote !== undefined) {
    throw new PushPlanError(
      'RECOVERY_ARTIFACTS_INVALID',
      'Non-blocked recovery states must not expose remote artifacts.',
      {
        status: recovery.status,
        planId: recovery.planId,
      },
    );
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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
