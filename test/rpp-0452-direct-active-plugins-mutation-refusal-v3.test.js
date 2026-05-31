import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { getResource, resourceHash, serializeResourceValue } from '../src/resources.js';
import { ABSENT, digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const sha256HexPattern = /^[a-f0-9]{64}$/;

const ownerPlugin = 'rpp-0452-forms-owner';
const pluginBasename = `${ownerPlugin}/${ownerPlugin}.php`;
const pluginResourceKey = `plugin:${ownerPlugin}`;
const pluginFilePath = `wp-content/plugins/${pluginBasename}`;
const pluginFileResourceKey = `file:${pluginFilePath}`;
const activePluginsRowId = 'option_name:active_plugins';
const activePluginsResourceKey = 'row:["wp_options","option_name:active_plugins"]';
const optionRowId = 'option_name:rpp_0452_forms_settings';
const optionResourceKey = `row:["wp_options","${optionRowId}"]`;

const rawFixtures = {
  basePluginVersion: 'rpp-0452-base-plugin-version-private',
  stalePluginVersion: 'rpp-0452-stale-plugin-version-private',
  basePackageFile: 'rpp-0452-base-package-file-private',
  stalePackageFile: 'rpp-0452-stale-package-file-private',
  baseOptionMode: 'rpp-0452-base-option-mode-private',
  localOptionMode: 'rpp-0452-local-option-mode-private',
  forgedOptionMode: 'rpp-0452-forged-option-mode-private',
  directActivePlugin: 'rpp-0452-direct-active-plugin-private',
};

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}

function activePluginsResource() {
  return {
    type: 'row',
    table: 'wp_options',
    id: activePluginsRowId,
    key: activePluginsResourceKey,
  };
}

function pluginResource() {
  return {
    type: 'plugin',
    name: ownerPlugin,
    key: pluginResourceKey,
  };
}

function pluginFileResource() {
  return {
    type: 'file',
    path: pluginFilePath,
    key: pluginFileResourceKey,
  };
}

function optionResource() {
  return {
    type: 'row',
    table: 'wp_options',
    id: optionRowId,
    key: optionResourceKey,
  };
}

function activePluginsOptionRow(optionValue = [pluginBasename]) {
  return {
    option_name: 'active_plugins',
    option_value: [...optionValue],
    autoload: 'yes',
  };
}

function baseSite({ optionMode = rawFixtures.baseOptionMode } = {}) {
  return {
    files: {
      [pluginFilePath]: `<?php /* ${rawFixtures.basePackageFile} */`,
    },
    plugins: {
      [ownerPlugin]: {
        version: rawFixtures.basePluginVersion,
        active: true,
      },
    },
    db: {
      wp_options: {
        [activePluginsRowId]: activePluginsOptionRow(),
        [optionRowId]: {
          option_name: 'rpp_0452_forms_settings',
          option_value: {
            mode: optionMode,
            nested: {
              marker: rawFixtures.forgedOptionMode,
            },
          },
          autoload: 'no',
          __pluginOwner: ownerPlugin,
        },
      },
    },
  };
}

function pluginOwnedResourcePolicy(...allowedResources) {
  return {
    pluginOwnedResources: {
      allowedResources,
    },
  };
}

function allowedOptionResource(extra = {}) {
  return {
    resourceKey: optionResourceKey,
    pluginOwner: ownerPlugin,
    driver: 'wp-option',
    ...extra,
  };
}

function attachLocalSupportPolicy(local, ...allowedResources) {
  local.meta = {
    evidenceScope: 'local/support-only',
    pushPolicy: pluginOwnedResourcePolicy(...allowedResources),
  };
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function blockerFor(plan, resourceKey) {
  return plan.blockers.find((blocker) => blocker.resourceKey === resourceKey);
}

function preconditionFor(plan, resourceKey) {
  return plan.preconditions.find((precondition) => precondition.resourceKey === resourceKey);
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function applyRefusal(remote, plan) {
  const before = cloneJson(remote);
  let beforeMutationCalls = 0;
  const error = captureError(() => applyPlan(remote, plan, {
    mutateRemote: true,
    beforeMutation() {
      beforeMutationCalls += 1;
    },
  }));

  return {
    error,
    before,
    beforeMutationCalls,
    remoteHashBefore: sha256Evidence(before),
    remoteHashAfter: sha256Evidence(remote),
    activePluginsHashBefore: `sha256:${resourceHash(before, activePluginsResource())}`,
    activePluginsHashAfter: `sha256:${resourceHash(remote, activePluginsResource())}`,
    pluginOwnedRowHashBefore: `sha256:${resourceHash(before, optionResource())}`,
    pluginOwnedRowHashAfter: `sha256:${resourceHash(remote, optionResource())}`,
  };
}

function tamperReadyPlan(plan, mutate) {
  const copy = cloneJson(plan);
  mutate(copy);
  copy.status = 'ready';
  copy.blockers = [];
  copy.conflicts = [];
  copy.summary = {
    ...copy.summary,
    mutations: copy.mutations.length,
    blockers: 0,
    conflicts: 0,
    decisions: copy.decisions.length,
  };
  return copy;
}

function directActivePluginsFixture(action) {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  if (action === 'delete') {
    delete local.db.wp_options[activePluginsRowId];
  } else {
    local.db.wp_options[activePluginsRowId].option_value = [
      pluginBasename,
      `${rawFixtures.directActivePlugin}/${rawFixtures.directActivePlugin}.php`,
    ];
  }
  local.db.wp_options[optionRowId].option_value.mode = rawFixtures.localOptionMode;
  attachLocalSupportPolicy(local, allowedOptionResource());

  return { base, local, remote, action };
}

function supportedPluginDriverFixture() {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);
  local.db.wp_options[optionRowId].option_value.mode = rawFixtures.localOptionMode;
  attachLocalSupportPolicy(local, allowedOptionResource());
  return { base, local, remote };
}

function forgedDirectActivePluginsPlan({ base, remote, action }) {
  const resource = activePluginsResource();
  const baseValue = getResource(base, resource);
  const remoteValue = getResource(remote, resource);
  const localValue = action === 'delete'
    ? ABSENT
    : {
        ...baseValue,
        option_value: [
          ...baseValue.option_value,
          `${rawFixtures.directActivePlugin}/${rawFixtures.directActivePlugin}.php`,
        ],
      };
  const baseHash = resourceHash(base, resource);
  const localHash = digest(localValue);
  const remoteHash = resourceHash(remote, resource);
  const mutationId = `mutation-rpp-0452-forged-active-plugins-${action}`;

  return {
    schemaVersion: 1,
    id: `plan-${fixedNow.toISOString()}-rpp-0452-forged-active-plugins-${action}`,
    generatedAt: fixedNow.toISOString(),
    status: 'ready',
    summary: {
      mutations: 1,
      decisions: 0,
      conflicts: 0,
      blockers: 0,
      atomicGroups: 0,
    },
    mutations: [
      {
        id: mutationId,
        resource,
        resourceKey: resource.key,
        action,
        value: serializeResourceValue(localValue),
        remoteBeforeHash: remoteHash,
        baseHash,
        localHash,
        changeKind: action === 'delete' ? 'delete' : 'update',
        change: directActivePluginsChangeEvidence({
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        }),
        atomicGroupId: null,
        pluginOwnedResource: {
          pluginOwner: ownerPlugin,
          driver: 'wp-option',
          supportsDelete: true,
          ownerContext: [],
          ownerContextRequired: false,
          auditEvidence: {
            schemaVersion: 1,
            evidenceSource: 'forged-local-plugin-driver-audit',
            format: 'hash-only',
            rawValuesIncluded: false,
            resourceKey: resource.key,
            pluginOwner: ownerPlugin,
            driver: 'wp-option',
            policySource: 'local/support-only',
            supportsDelete: true,
            baseHash,
            localHash,
            remoteHash,
            ownerContextHash: digest([]),
          },
        },
      },
    ],
    preconditions: [
      {
        mutationId,
        resource,
        resourceKey: resource.key,
        expectedHash: remoteHash,
        checkedAgainst: 'live-remote',
      },
    ],
    decisions: [],
    conflicts: [],
    blockers: [],
    atomicGroups: [],
  };
}

function directActivePluginsChangeEvidence({
  baseValue,
  localValue,
  remoteValue,
  baseHash,
  localHash,
  remoteHash,
}) {
  return {
    localChange: changeKindFromHashes(baseValue, localValue, baseHash, localHash),
    remoteChange: changeKindFromHashes(baseValue, remoteValue, baseHash, remoteHash),
    base: hashOnlyChangeSide(baseValue, baseHash),
    local: hashOnlyChangeSide(localValue, localHash),
    remote: hashOnlyChangeSide(remoteValue, remoteHash),
  };
}

function changeKindFromHashes(baseValue, candidateValue, baseHash, candidateHash) {
  if (candidateHash === baseHash) {
    return 'unchanged';
  }
  if (baseValue === ABSENT) {
    return 'create';
  }
  if (candidateValue === ABSENT) {
    return 'delete';
  }
  return 'update';
}

function hashOnlyChangeSide(value, hash) {
  return {
    state: value === ABSENT ? 'absent' : 'present',
    hash,
  };
}

function assertHashOnlyChange(change, label) {
  assert.ok(change, `${label} missing change evidence`);
  for (const side of ['base', 'local', 'remote']) {
    assert.ok(['present', 'absent'].includes(change[side].state), `${label} ${side} state`);
    assert.match(change[side].hash, sha256HexPattern, `${label} ${side} hash`);
    assert.equal(Object.hasOwn(change[side], 'value'), false, `${label} leaked ${side} value`);
  }
}

function assertDirectActivePluginsBlocker(blocker, action) {
  assert.ok(blocker, `${action} active_plugins blocker missing`);
  assert.equal(blocker.class, 'unsupported-active-plugins-direct-mutation');
  assert.equal(blocker.reasonCode, 'DIRECT_ACTIVE_PLUGINS_MUTATION_UNSUPPORTED');
  assert.equal(blocker.requiredDriver, 'plugin-activation-driver');
  assert.equal(blocker.resolutionPolicy, 'preserve-remote-active-plugins-and-stop');
  assert.equal(blocker.resourceKey, activePluginsResourceKey);
  assert.equal(blocker.change.localChange, action === 'delete' ? 'delete' : 'update');
  assert.equal(blocker.change.remoteChange, 'unchanged');
  assertHashOnlyChange(blocker.change, `${action} active_plugins blocker`);
}

function assertSupportedPluginMutation(mutation) {
  assert.ok(mutation, 'supported plugin-owned option mutation missing');
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.resourceKey, optionResourceKey);
  assert.equal(mutation.pluginOwnedResource.pluginOwner, ownerPlugin);
  assert.equal(mutation.pluginOwnedResource.driver, 'wp-option');
  assert.equal(mutation.pluginOwnedResource.policySource, 'local-snapshot');
  assert.equal(mutation.pluginOwnedResource.supportsDelete, false);
  assert.equal(mutation.pluginOwnedResource.ownerContextRequired, true);
  assert.deepEqual(
    mutation.pluginOwnedResource.ownerContext.map((context) => context.resourceKey).sort(),
    [pluginFileResourceKey, pluginResourceKey],
  );
  assert.equal(mutation.pluginOwnedResource.auditEvidence.evidenceSource, 'planner-plugin-driver-audit');
  assert.equal(mutation.pluginOwnedResource.auditEvidence.format, 'hash-only');
  assert.equal(mutation.pluginOwnedResource.auditEvidence.rawValuesIncluded, false);
  assert.equal(mutation.pluginOwnedResource.driverAuditEvidence.reasonCode, 'PLUGIN_DRIVER_DECISION_SUPPORTED');
  assert.equal(mutation.pluginOwnedResource.driverAuditEvidence.rawValuesIncluded, false);
  assertHashOnlyChange(mutation.change, 'supported plugin-owned option mutation');
}

function assertSha256Evidence(value, label) {
  assert.match(value, sha256EvidencePattern, `${label} should be sha256-prefixed evidence`);
}

function assertNoRawFixtureValues(value, label) {
  const serialized = JSON.stringify(value);
  for (const raw of Object.values(rawFixtures)) {
    assert.equal(serialized.includes(raw), false, `${label} leaked raw fixture value ${raw}`);
  }
  assert.equal(serialized.includes('"option_value"'), false, `${label} leaked option_value field`);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(value, { label }));
}

function assertRefusalPreservedRemote(refusal, remote, label) {
  assert.equal(refusal.beforeMutationCalls, 0, `${label} reached mutation hook`);
  assert.deepEqual(remote, refusal.before, `${label} mutated the remote`);
  assert.equal(refusal.remoteHashAfter, refusal.remoteHashBefore, `${label} remote hash changed`);
  assert.equal(
    refusal.activePluginsHashAfter,
    refusal.activePluginsHashBefore,
    `${label} active_plugins hash changed`,
  );
  assert.equal(
    refusal.pluginOwnedRowHashAfter,
    refusal.pluginOwnedRowHashBefore,
    `${label} plugin-owned row hash changed`,
  );
}

test('RPP-0452 direct active_plugins writes and deletes are refused before supported plugin-driver mutations', () => {
  const refusalProofs = [];

  for (const action of ['put', 'delete']) {
    const { base, local, remote } = directActivePluginsFixture(action);
    const plan = planFor(base, local, remote);
    const activePluginsBlocker = blockerFor(plan, activePluginsResourceKey);
    const supportedMutation = mutationFor(plan, optionResourceKey);
    const remoteWithPluginData = cloneJson(remote);
    const refusal = applyRefusal(remoteWithPluginData, plan);

    assert.equal(plan.status, 'blocked');
    assert.deepEqual(plan.summary, {
      mutations: 1,
      decisions: 0,
      conflicts: 0,
      blockers: 1,
      atomicGroups: 0,
    });
    assert.equal(mutationFor(plan, activePluginsResourceKey), undefined);
    assert.equal(preconditionFor(plan, activePluginsResourceKey), undefined);
    assertSupportedPluginMutation(supportedMutation);
    assertDirectActivePluginsBlocker(activePluginsBlocker, action);

    assert.ok(refusal.error instanceof PushPlanError);
    assert.equal(refusal.error.code, 'PLAN_NOT_READY');
    assertRefusalPreservedRemote(refusal, remoteWithPluginData, `${action} direct active_plugins refusal`);
    assert.equal(
      remoteWithPluginData.db.wp_options[optionRowId].option_value.mode,
      rawFixtures.baseOptionMode,
    );

    const proof = {
      action,
      planStatus: plan.status,
      activePluginsMutationPlanned: false,
      supportedPluginMutationPlanned: true,
      activePluginsBlockerHash: sha256Evidence(activePluginsBlocker),
      supportedMutationEvidenceHash: sha256Evidence({
        resourceKey: supportedMutation.resourceKey,
        action: supportedMutation.action,
        driver: supportedMutation.pluginOwnedResource.driver,
        auditEvidence: supportedMutation.pluginOwnedResource.auditEvidence,
        driverAuditEvidence: supportedMutation.pluginOwnedResource.driverAuditEvidence,
      }),
      blockedApply: {
        code: refusal.error.code,
        detailsHash: sha256Evidence(refusal.error.details),
        refusedBeforeMutation: refusal.beforeMutationCalls === 0,
        remoteHashBefore: refusal.remoteHashBefore,
        remoteHashAfter: refusal.remoteHashAfter,
        activePluginsHashBefore: refusal.activePluginsHashBefore,
        activePluginsHashAfter: refusal.activePluginsHashAfter,
        pluginOwnedRowHashBefore: refusal.pluginOwnedRowHashBefore,
        pluginOwnedRowHashAfter: refusal.pluginOwnedRowHashAfter,
      },
    };
    refusalProofs.push(proof);

    assertNoRawFixtureValues(activePluginsBlocker, `${action} active_plugins blocker`);
    assertNoRawFixtureValues(supportedMutation.pluginOwnedResource, `${action} supported plugin driver evidence`);
    assertNoRawFixtureValues(refusal.error.details, `${action} blocked apply details`);
    assertNoRawFixtureValues(proof, `${action} direct active_plugins refusal proof`);
  }

  const evidence = {
    rpp: 'RPP-0452',
    evidenceSource: 'focused-direct-active-plugins-mutation-refusal-v3',
    status: 'support_only',
    evidenceScope: 'local/support-only',
    productionBacked: false,
    releaseGate: {
      status: 'NO-GO',
      evidenceScope: 'local/support-only',
      productionBacked: false,
      note: 'RPP-0452 direct active_plugins refusal evidence is local/support-only; checked production-backed release gate evidence is still required.',
    },
    rawValuesIncluded: false,
    directRefusals: refusalProofs,
  };
  evidence.proofHash = sha256Evidence({
    directRefusals: evidence.directRefusals,
    releaseGate: evidence.releaseGate,
  });

  for (const proof of evidence.directRefusals) {
    assertSha256Evidence(proof.activePluginsBlockerHash, 'RPP-0452 active_plugins blocker hash');
    assertSha256Evidence(proof.supportedMutationEvidenceHash, 'RPP-0452 supported mutation hash');
    assertSha256Evidence(proof.blockedApply.detailsHash, 'RPP-0452 blocked apply details hash');
    assertSha256Evidence(proof.blockedApply.remoteHashBefore, 'RPP-0452 remote before hash');
    assertSha256Evidence(proof.blockedApply.remoteHashAfter, 'RPP-0452 remote after hash');
    assertSha256Evidence(proof.blockedApply.activePluginsHashBefore, 'RPP-0452 active_plugins before hash');
    assertSha256Evidence(proof.blockedApply.activePluginsHashAfter, 'RPP-0452 active_plugins after hash');
    assertSha256Evidence(proof.blockedApply.pluginOwnedRowHashBefore, 'RPP-0452 plugin-owned row before hash');
    assertSha256Evidence(proof.blockedApply.pluginOwnedRowHashAfter, 'RPP-0452 plugin-owned row after hash');
  }
  assertSha256Evidence(evidence.proofHash, 'RPP-0452 direct refusal proof hash');
  assert.equal(evidence.releaseGate.evidenceScope, 'local/support-only');
  assert.equal(evidence.releaseGate.productionBacked, false);
  assertNoRawFixtureValues(evidence, 'RPP-0452 direct active_plugins refusal evidence');
});

test('RPP-0452 explicit checked plugin-driver operation remains allowed when active_plugins is unchanged', () => {
  const { base, local, remote } = supportedPluginDriverFixture();
  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, optionResourceKey);
  const liveRemote = cloneJson(remote);
  const activePluginsHashBefore = `sha256:${resourceHash(liveRemote, activePluginsResource())}`;
  const pluginHashBefore = `sha256:${resourceHash(liveRemote, pluginResource())}`;
  const pluginFileHashBefore = `sha256:${resourceHash(liveRemote, pluginFileResource())}`;
  const mutationOrder = [];
  const result = applyPlan(liveRemote, plan, {
    mutateRemote: true,
    beforeMutation({ mutation: appliedMutation }) {
      mutationOrder.push(appliedMutation.resourceKey);
    },
  });

  const evidence = {
    rpp: 'RPP-0452',
    evidenceSource: 'focused-direct-active-plugins-mutation-refusal-v3-supported-path',
    status: 'support_only',
    evidenceScope: 'local/support-only',
    productionBacked: false,
    releaseGate: {
      status: 'NO-GO',
      evidenceScope: 'local/support-only',
      productionBacked: false,
      note: 'RPP-0452 supported plugin-driver operation is local/support-only evidence with explicit checked wp-option support.',
    },
    rawValuesIncluded: false,
    supportedOperation: {
      operation: 'wp-option-put',
      planStatus: plan.status,
      mutationHash: sha256Evidence({
        resourceKey: mutation.resourceKey,
        action: mutation.action,
        driver: mutation.pluginOwnedResource.driver,
        supportsDelete: mutation.pluginOwnedResource.supportsDelete,
        baseHash: mutation.baseHash,
        localHash: mutation.localHash,
        remoteBeforeHash: mutation.remoteBeforeHash,
      }),
      ownerContextHash: sha256Evidence(mutation.pluginOwnedResource.ownerContext),
      auditEvidenceHash: sha256Evidence(mutation.pluginOwnedResource.auditEvidence),
      driverAuditEvidenceHash: sha256Evidence(mutation.pluginOwnedResource.driverAuditEvidence),
      journalHash: sha256Evidence(result.journal),
      mutationOrderHash: sha256Evidence(mutationOrder),
      activePluginsHashBefore,
      activePluginsHashAfter: `sha256:${resourceHash(result.site, activePluginsResource())}`,
      pluginHashBefore,
      pluginHashAfter: `sha256:${resourceHash(result.site, pluginResource())}`,
      pluginFileHashBefore,
      pluginFileHashAfter: `sha256:${resourceHash(result.site, pluginFileResource())}`,
      pluginOwnedRowHashBefore: `sha256:${resourceHash(remote, optionResource())}`,
      pluginOwnedRowHashAfter: `sha256:${resourceHash(result.site, optionResource())}`,
    },
  };
  evidence.proofHash = sha256Evidence({
    supportedOperation: evidence.supportedOperation,
    releaseGate: evidence.releaseGate,
  });

  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.summary, {
    mutations: 1,
    decisions: 0,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.equal(mutationFor(plan, activePluginsResourceKey), undefined);
  assert.equal(preconditionFor(plan, activePluginsResourceKey), undefined);
  assertSupportedPluginMutation(mutation);
  assert.deepEqual(mutationOrder, [optionResourceKey]);
  assert.equal(result.appliedMutations, 1);
  assert.equal(
    result.site.db.wp_options[optionRowId].option_value.mode,
    rawFixtures.localOptionMode,
  );
  assert.equal(liveRemote.db.wp_options[optionRowId].option_value.mode, rawFixtures.localOptionMode);
  assert.equal(evidence.supportedOperation.activePluginsHashAfter, activePluginsHashBefore);
  assert.equal(evidence.supportedOperation.pluginHashAfter, pluginHashBefore);
  assert.equal(evidence.supportedOperation.pluginFileHashAfter, pluginFileHashBefore);
  assert.notEqual(
    evidence.supportedOperation.pluginOwnedRowHashAfter,
    evidence.supportedOperation.pluginOwnedRowHashBefore,
  );
  assert.equal(evidence.releaseGate.evidenceScope, 'local/support-only');

  for (const hash of Object.values(evidence.supportedOperation)) {
    if (typeof hash === 'string' && hash.startsWith('sha256:')) {
      assertSha256Evidence(hash, 'RPP-0452 supported plugin-driver evidence hash');
    }
  }
  assertSha256Evidence(evidence.proofHash, 'RPP-0452 supported operation proof hash');
  assertNoRawFixtureValues(mutation.pluginOwnedResource, 'RPP-0452 supported plugin-owned metadata');
  assertNoRawFixtureValues(result.journal, 'RPP-0452 supported apply journal');
  assertNoRawFixtureValues(evidence, 'RPP-0452 supported plugin-driver proof');
});

test('RPP-0452 stale and forged plugin-driver evidence fails closed before mutation', () => {
  const { base, local, remote } = supportedPluginDriverFixture();
  const readyPlan = planFor(base, local, remote);
  const readyMutation = mutationFor(readyPlan, optionResourceKey);
  assert.equal(readyPlan.status, 'ready');
  assertSupportedPluginMutation(readyMutation);

  const staleContextRemote = cloneJson(remote);
  staleContextRemote.plugins[ownerPlugin].version = rawFixtures.stalePluginVersion;
  staleContextRemote.files[pluginFilePath] = `<?php /* ${rawFixtures.stalePackageFile} */`;
  const staleContextRefusal = applyRefusal(staleContextRemote, readyPlan);

  const forgedOwnerContextPlan = tamperReadyPlan(readyPlan, (copy) => {
    const mutation = mutationFor(copy, optionResourceKey);
    mutation.pluginOwnedResource.ownerContext = mutation.pluginOwnedResource.ownerContext.map((context) => ({
      ...context,
      remoteHash: '0'.repeat(64),
    }));
    mutation.pluginOwnedResource.auditEvidence.ownerContextHash = digest(
      mutation.pluginOwnedResource.ownerContext,
    );
  });
  const forgedOwnerContextRemote = cloneJson(remote);
  const forgedOwnerContextRefusal = applyRefusal(forgedOwnerContextRemote, forgedOwnerContextPlan);

  const forgedDirectRefusals = [];
  for (const action of ['put', 'delete']) {
    const forgedPlan = forgedDirectActivePluginsPlan({ base, remote, action });
    const forgedRemote = cloneJson(remote);
    const refusal = applyRefusal(forgedRemote, forgedPlan);

    assert.ok(refusal.error instanceof PushPlanError);
    assert.equal(refusal.error.code, 'UNSUPPORTED_ACTIVE_PLUGINS_MUTATION');
    assert.equal(refusal.error.details.resourceKey, activePluginsResourceKey);
    assert.equal(refusal.error.details.reasonCode, 'DIRECT_ACTIVE_PLUGINS_MUTATION_UNSUPPORTED');
    assert.equal(refusal.error.details.requiredDriver, 'plugin-activation-driver');
    assertRefusalPreservedRemote(refusal, forgedRemote, `${action} forged active_plugins plan`);
    assert.equal(
      forgedRemote.db.wp_options[optionRowId].option_value.mode,
      rawFixtures.baseOptionMode,
    );

    const proof = {
      action,
      code: refusal.error.code,
      reasonCode: refusal.error.details.reasonCode,
      requiredDriver: refusal.error.details.requiredDriver,
      detailsHash: sha256Evidence(refusal.error.details),
      refusedBeforeMutation: refusal.beforeMutationCalls === 0,
      remoteHashBefore: refusal.remoteHashBefore,
      remoteHashAfter: refusal.remoteHashAfter,
      activePluginsHashBefore: refusal.activePluginsHashBefore,
      activePluginsHashAfter: refusal.activePluginsHashAfter,
      pluginOwnedRowHashBefore: refusal.pluginOwnedRowHashBefore,
      pluginOwnedRowHashAfter: refusal.pluginOwnedRowHashAfter,
    };
    forgedDirectRefusals.push(proof);

    assertNoRawFixtureValues(refusal.error.details, `${action} forged active_plugins details`);
    assertNoRawFixtureValues(proof, `${action} forged active_plugins proof`);
  }

  const evidence = {
    rpp: 'RPP-0452',
    evidenceSource: 'focused-direct-active-plugins-mutation-refusal-v3-stale-forged-negative',
    status: 'support_only',
    evidenceScope: 'local/support-only',
    productionBacked: false,
    releaseGate: {
      status: 'NO-GO',
      evidenceScope: 'local/support-only',
      productionBacked: false,
      note: 'RPP-0452 stale/forged refusal evidence is local/support-only and preserves remote plugin-owned data.',
    },
    rawValuesIncluded: false,
    staleOwnerContext: {
      code: staleContextRefusal.error.code,
      detailsHash: sha256Evidence(staleContextRefusal.error.details),
      refusedBeforeMutation: staleContextRefusal.beforeMutationCalls === 0,
      remoteHashBefore: staleContextRefusal.remoteHashBefore,
      remoteHashAfter: staleContextRefusal.remoteHashAfter,
      activePluginsHashBefore: staleContextRefusal.activePluginsHashBefore,
      activePluginsHashAfter: staleContextRefusal.activePluginsHashAfter,
      pluginOwnedRowHashBefore: staleContextRefusal.pluginOwnedRowHashBefore,
      pluginOwnedRowHashAfter: staleContextRefusal.pluginOwnedRowHashAfter,
    },
    forgedOwnerContext: {
      code: forgedOwnerContextRefusal.error.code,
      detailsHash: sha256Evidence(forgedOwnerContextRefusal.error.details),
      refusedBeforeMutation: forgedOwnerContextRefusal.beforeMutationCalls === 0,
      remoteHashBefore: forgedOwnerContextRefusal.remoteHashBefore,
      remoteHashAfter: forgedOwnerContextRefusal.remoteHashAfter,
      activePluginsHashBefore: forgedOwnerContextRefusal.activePluginsHashBefore,
      activePluginsHashAfter: forgedOwnerContextRefusal.activePluginsHashAfter,
      pluginOwnedRowHashBefore: forgedOwnerContextRefusal.pluginOwnedRowHashBefore,
      pluginOwnedRowHashAfter: forgedOwnerContextRefusal.pluginOwnedRowHashAfter,
    },
    forgedDirectActivePlugins: forgedDirectRefusals,
  };
  evidence.proofHash = sha256Evidence({
    staleOwnerContext: evidence.staleOwnerContext,
    forgedOwnerContext: evidence.forgedOwnerContext,
    forgedDirectActivePlugins: evidence.forgedDirectActivePlugins,
    releaseGate: evidence.releaseGate,
  });

  assert.ok(staleContextRefusal.error instanceof PushPlanError);
  assert.equal(staleContextRefusal.error.code, 'STALE_PLUGIN_OWNER_CONTEXT');
  assert.equal(staleContextRefusal.error.details.resourceKey, optionResourceKey);
  assertRefusalPreservedRemote(staleContextRefusal, staleContextRemote, 'stale owner context refusal');
  assert.equal(
    staleContextRemote.db.wp_options[optionRowId].option_value.mode,
    rawFixtures.baseOptionMode,
  );

  assert.ok(forgedOwnerContextRefusal.error instanceof PushPlanError);
  assert.equal(forgedOwnerContextRefusal.error.code, 'STALE_PLUGIN_OWNER_CONTEXT');
  assert.equal(forgedOwnerContextRefusal.error.details.resourceKey, optionResourceKey);
  assertRefusalPreservedRemote(
    forgedOwnerContextRefusal,
    forgedOwnerContextRemote,
    'forged owner context refusal',
  );
  assert.equal(
    forgedOwnerContextRemote.db.wp_options[optionRowId].option_value.mode,
    rawFixtures.baseOptionMode,
  );
  assert.equal(evidence.releaseGate.evidenceScope, 'local/support-only');

  for (const section of [
    evidence.staleOwnerContext,
    evidence.forgedOwnerContext,
    ...evidence.forgedDirectActivePlugins,
  ]) {
    assertSha256Evidence(section.detailsHash, 'RPP-0452 refusal details hash');
    assertSha256Evidence(section.remoteHashBefore, 'RPP-0452 refusal remote before hash');
    assertSha256Evidence(section.remoteHashAfter, 'RPP-0452 refusal remote after hash');
    assertSha256Evidence(section.activePluginsHashBefore, 'RPP-0452 refusal active_plugins before hash');
    assertSha256Evidence(section.activePluginsHashAfter, 'RPP-0452 refusal active_plugins after hash');
    assertSha256Evidence(section.pluginOwnedRowHashBefore, 'RPP-0452 refusal plugin-owned row before hash');
    assertSha256Evidence(section.pluginOwnedRowHashAfter, 'RPP-0452 refusal plugin-owned row after hash');
  }
  assertSha256Evidence(evidence.proofHash, 'RPP-0452 stale/forged proof hash');
  assertNoRawFixtureValues(staleContextRefusal.error.details, 'RPP-0452 stale owner context details');
  assertNoRawFixtureValues(forgedOwnerContextRefusal.error.details, 'RPP-0452 forged owner context details');
  assertNoRawFixtureValues(evidence, 'RPP-0452 stale and forged negative evidence');
});
