import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import {
  EVIDENCE_REDACTION_MARKER,
  assertEvidenceHasNoRawValues,
  redactEvidence,
} from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { getResource, resourceHash, setResource } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import {
  generatePushHarnessCases,
  runGeneratedPushHarness,
  validateGeneratedCase,
} from '../scripts/harness/generated-push-cases.js';

const fixedGeneratedHarnessNow = new Date('2026-05-28T00:00:00.000Z');
const atomicDependencyPlugin = 'reprint-push-atomic-dependency-fixture';
const atomicDependentPlugin = 'reprint-push-atomic-dependent-fixture';
const atomicDependencyPluginFile = `wp-content/plugins/${atomicDependencyPlugin}/${atomicDependencyPlugin}.php`;
const atomicDependentPluginFile = `wp-content/plugins/${atomicDependentPlugin}/${atomicDependentPlugin}.php`;
const atomicFixtureOptionRowId = 'option_name:reprint_push_atomic_fixture_data';
const target = Object.freeze({
  coverageKey: 'atomicPluginInstallStackReleaseVerifierVariant5',
  family: 'atomic-plugin-install-stack-release-verifier-v5',
  tag: 'atomic-plugin-install-stack-release-verifier-v5',
  readyTag: 'atomic-plugin-stack-ready-release-verifier-v5',
  missingDependencyTag: 'atomic-plugin-stack-missing-dependency-release-verifier-v5',
});
const expectedPerTier = Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2]));
const expectedStatuses = { blocked: 2, conflict: 8, ready: 10 };
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function incrementCount(object, key) {
  object[String(key)] = (object[String(key)] || 0) + 1;
}

function sortNumericObject(object) {
  return Object.fromEntries(
    Object.entries(object).sort(([left], [right]) => Number(left) - Number(right)),
  );
}

function sortStringObject(object) {
  return Object.fromEntries(
    Object.entries(object).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function fileResource(path) {
  return {
    type: 'file',
    path,
    key: fileResourceKey(path),
  };
}

function pluginResource(name) {
  return {
    type: 'plugin',
    name,
    key: pluginResourceKey(name),
  };
}

function rowResource(table, id) {
  return {
    type: 'row',
    table,
    id,
    key: rowResourceKey(table, id),
  };
}

function fileResourceKey(path) {
  return `file:${path}`;
}

function pluginResourceKey(name) {
  return `plugin:${name}`;
}

function rowResourceKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
}

function targetCases() {
  return generatePushHarnessCases()
    .filter((testCase) => testCase.tags.has(target.tag));
}

function assertAtomicPluginStackShape(testCase, { missingDependency }) {
  assert.ok(testCase.tags.has(target.tag), `${testCase.id} should carry the RPP-0196 target tag`);
  assert.equal(testCase.tags.has(target.readyTag), !missingDependency);
  assert.equal(testCase.tags.has(target.missingDependencyTag), missingDependency);
  assert.equal(testCase.tags.has('atomic-plugin-install-stack-v4'), true);

  const intent = testCase.local.pushIntents?.[0];

  assert.ok(intent, `${testCase.id} should declare an atomic plugin install intent`);
  assert.equal(intent.kind, 'plugin-install');
  assert.equal(intent.requireAtomic, true);

  if (missingDependency) {
    assert.equal(testCase.family, 'atomic-plugin-missing-dependency');
    assert.ok(testCase.tags.has('atomic-blocked'));
    assert.equal(testCase.local.files[atomicDependencyPluginFile], undefined);
    assert.equal(testCase.local.plugins[atomicDependencyPlugin], undefined);
    assert.ok(testCase.local.files[atomicDependentPluginFile], `${testCase.id} should stage dependent plugin file`);
    assert.ok(testCase.local.plugins[atomicDependentPlugin], `${testCase.id} should stage dependent plugin metadata`);
    assert.deepEqual(intent.resources, [
      fileResourceKey(atomicDependentPluginFile),
      pluginResourceKey(atomicDependentPlugin),
    ]);
    assert.deepEqual(intent.dependencies.plugins, [atomicDependencyPlugin]);

    return {
      intent,
      expectedResourceKeys: [
        fileResourceKey(atomicDependentPluginFile),
        pluginResourceKey(atomicDependentPlugin),
      ],
      optionRow: null,
    };
  }

  assert.equal(testCase.family, 'atomic-plugin-stack-ready');
  assert.ok(testCase.tags.has('atomic-ready'));
  assert.ok(testCase.local.files[atomicDependencyPluginFile], `${testCase.id} should stage dependency plugin file`);
  assert.ok(testCase.local.files[atomicDependentPluginFile], `${testCase.id} should stage dependent plugin file`);
  assert.deepEqual(testCase.local.plugins[atomicDependencyPlugin], { version: '2.1.0', active: true });
  assert.equal(testCase.local.plugins[atomicDependentPlugin].requires[0], atomicDependencyPlugin);

  const optionRow = testCase.local.db.wp_options[atomicFixtureOptionRowId];
  const optionResourceKey = rowResourceKey('wp_options', atomicFixtureOptionRowId);
  assert.ok(optionRow, `${testCase.id} should create plugin-owned fixture option`);
  assert.equal(optionRow.__pluginOwner, atomicDependentPlugin);
  assert.equal(optionRow.option_value.mode, 'generated-installed');
  assert.equal(optionRow.option_value.privateInstallToken, 'private-atomic-plugin-install-stack-v3');
  assert.ok(
    intent.resourcePolicy.pluginOwnedResources.allowedResources.some((entry) =>
      entry.resourceKey === optionResourceKey
        && entry.pluginOwner === atomicDependentPlugin
        && entry.driver === 'wp-option'),
    `${testCase.id} should include plugin-owned option driver policy in the atomic intent`,
  );
  assert.equal(intent.dependencies.plugins[0].name, atomicDependencyPlugin);
  assert.equal(intent.dependencies.plugins[0].version, '2.1.0');
  assert.match(intent.dependencies.plugins[0].hash, sha256Pattern);

  return {
    intent,
    expectedResourceKeys: [
      fileResourceKey(atomicDependencyPluginFile),
      fileResourceKey(atomicDependentPluginFile),
      pluginResourceKey(atomicDependencyPlugin),
      pluginResourceKey(atomicDependentPlugin),
      optionResourceKey,
    ],
    optionRow,
  };
}

function assertAtomicPluginStackEvidenceRedacted(testCase, plan, shape) {
  const redacted = redactEvidence({
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    tags: [...testCase.tags].sort(),
    status: plan.status,
    summary: plan.summary,
    atomicGroups: plan.atomicGroups,
    mutations: plan.mutations,
    blockers: plan.blockers,
    rawAtomicInstallProbe: {
      value: {
        intent: shape.intent,
        optionRow: shape.optionRow,
        dependencyFile: testCase.local.files[atomicDependencyPluginFile],
        dependentFile: testCase.local.files[atomicDependentPluginFile],
      },
    },
  });
  const serialized = JSON.stringify(redacted);

  assert.ok(serialized.includes(EVIDENCE_REDACTION_MARKER));
  assert.equal(serialized.includes('private-atomic-plugin-install-stack-v3'), false);
  assert.equal(serialized.includes('privateInstallToken'), false);
  assert.equal(serialized.includes('<?php'), false);
  assert.equal(serialized.includes('generated dependency'), false);
  assert.equal(serialized.includes('generated dependent'), false);

  return {
    rawProbeRedacted: serialized.includes(EVIDENCE_REDACTION_MARKER),
    redactedEvidenceHash: `sha256:${digest(redacted)}`,
  };
}

function readyMutationEvidence({ testCase, plan, applied, shape }) {
  const group = plan.atomicGroups.find((candidate) => candidate.id === shape.intent.id);
  const groupMutations = plan.mutations.filter((mutation) => mutation.atomicGroupId === group.id);
  const dependencyPluginMutation = groupMutations.find((mutation) =>
    mutation.resourceKey === pluginResourceKey(atomicDependencyPlugin));
  const optionMutation = groupMutations.find((mutation) =>
    mutation.resourceKey === rowResourceKey('wp_options', atomicFixtureOptionRowId));
  const optionPrecondition = plan.preconditions.find((entry) =>
    entry.resourceKey === rowResourceKey('wp_options', atomicFixtureOptionRowId));
  const dependencyRequirement = group.dependencyRequirements.find((entry) =>
    entry.plugin === atomicDependencyPlugin);
  const appliedResourceHashes = Object.fromEntries(
    shape.expectedResourceKeys.map((resourceKey) => {
      const mutation = groupMutations.find((entry) => entry.resourceKey === resourceKey);
      assert.ok(mutation, `${testCase.id} should mutate ${resourceKey}`);
      assert.equal(resourceHash(applied.site, mutation.resource), resourceHash(testCase.local, mutation.resource));
      return [resourceKey, resourceHash(applied.site, mutation.resource)];
    }),
  );

  assert.ok(group, `${testCase.id} should emit an atomic group`);
  assert.equal(group.status, 'ready');
  assert.equal(group.requireAtomic, true);
  assert.equal(group.blockers.length, 0);
  assert.equal(group.conflicts.length, 0);
  assert.ok(dependencyPluginMutation, `${testCase.id} should install dependency plugin metadata`);
  assert.ok(optionMutation, `${testCase.id} should plan plugin-owned option data`);
  assert.ok(optionPrecondition, `${testCase.id} should precondition plugin-owned option data`);
  assert.equal(dependencyRequirement.source, 'same-atomic-group');
  assert.equal(dependencyRequirement.resourceKey, pluginResourceKey(atomicDependencyPlugin));
  assert.equal(dependencyRequirement.mutationId, dependencyPluginMutation.id);
  assert.equal(optionMutation.pluginOwnedResource?.pluginOwner, atomicDependentPlugin);
  assert.equal(optionMutation.pluginOwnedResource?.driver, 'wp-option');
  assert.equal(optionMutation.pluginOwnedResource?.ownerContextRequired, true);
  assert.equal(optionMutation.pluginOwnedResource?.supportsDelete, false);
  assert.equal(optionMutation.pluginOwnedResource?.auditEvidence?.rawValuesIncluded, false);
  assert.equal(optionMutation.pluginOwnedResource?.driverAuditEvidence?.rawValuesIncluded, false);
  assert.equal(optionPrecondition.expectedHash, optionMutation.remoteBeforeHash);
  assert.equal(optionPrecondition.checkedAgainst, 'live-remote');
  assert.deepEqual(applied.site.db.wp_options[atomicFixtureOptionRowId], shape.optionRow);

  return {
    groupId: group.id,
    status: group.status,
    requireAtomic: group.requireAtomic,
    mutationCount: groupMutations.length,
    resources: [...group.resources].sort(),
    mutationResourceKeys: groupMutations.map((mutation) => mutation.resourceKey).sort(),
    dependencyRequirement: {
      plugin: dependencyRequirement.plugin,
      source: dependencyRequirement.source,
      resourceKey: dependencyRequirement.resourceKey,
      expectedHash: dependencyRequirement.expectedHash,
      plannedHash: dependencyRequirement.plannedHash || null,
      mutationIdMatchesDependencyPlugin: dependencyRequirement.mutationId === dependencyPluginMutation.id,
    },
    pluginOwnedOption: {
      resourceKey: optionMutation.resourceKey,
      action: optionMutation.action,
      changeKind: optionMutation.changeKind,
      pluginOwner: optionMutation.pluginOwnedResource.pluginOwner,
      driver: optionMutation.pluginOwnedResource.driver,
      ownerContextRequired: optionMutation.pluginOwnedResource.ownerContextRequired,
      supportsDelete: optionMutation.pluginOwnedResource.supportsDelete,
      auditEvidenceHash: `sha256:${digest(optionMutation.pluginOwnedResource.auditEvidence)}`,
      driverAuditEvidenceHash: `sha256:${digest(optionMutation.pluginOwnedResource.driverAuditEvidence)}`,
      localHash: resourceHash(testCase.local, optionMutation.resource),
      appliedHash: resourceHash(applied.site, optionMutation.resource),
      remoteBeforeHash: optionMutation.remoteBeforeHash,
      preconditionExpectedHash: optionPrecondition.expectedHash,
      preconditionCheckedAgainst: optionPrecondition.checkedAgainst,
    },
    appliedResourceHashes,
    groupHash: `sha256:${digest({
      id: group.id,
      status: group.status,
      resources: [...group.resources].sort(),
      mutations: groupMutations.map((mutation) => mutation.resourceKey).sort(),
      dependency: dependencyRequirement,
    })}`,
  };
}

function staleDependencyReplayEvidence({ testCase, plan }) {
  const dependencyResource = pluginResource(atomicDependencyPlugin);
  const driftedRemote = cloneJson(testCase.remote);
  const staleDependency = { version: '9.9.9', active: false };
  let beforeMutationCalls = 0;

  setResource(driftedRemote, dependencyResource, staleDependency);
  const remoteBeforeHash = digest(driftedRemote);
  const actualHash = resourceHash(driftedRemote, dependencyResource);
  const error = captureError(() => applyPlan(driftedRemote, plan, {
    beforeMutation() {
      beforeMutationCalls += 1;
    },
  }));
  const remoteAfterHash = digest(driftedRemote);

  assert.ok(error instanceof PushPlanError, `${testCase.id} stale dependency replay should throw`);
  assert.equal(error.code, 'PRECONDITION_FAILED');
  assert.equal(error.details?.resourceKey, pluginResourceKey(atomicDependencyPlugin));
  assert.equal(error.details?.actualHash, actualHash);
  assert.equal(beforeMutationCalls, 0, `${testCase.id} stale dependency replay reached beforeMutation`);
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} stale dependency replay mutated the remote`);
  assert.deepEqual(
    getResource(driftedRemote, dependencyResource),
    staleDependency,
    `${testCase.id} stale dependency replay rewrote the drifted dependency plugin`,
  );

  return {
    resourceKey: dependencyResource.key,
    code: error.code,
    beforeMutationCalls,
    preMutationRefusal: beforeMutationCalls === 0,
    expectedHash: error.details.expectedHash,
    actualHash,
    remoteBeforeHash,
    remoteAfterHash,
    remoteUnchanged: remoteAfterHash === remoteBeforeHash,
    dependencyHashAfter: resourceHash(driftedRemote, dependencyResource),
    detailsHash: `sha256:${digest(error.details)}`,
  };
}

function blockedGroupEvidence({ testCase, plan, shape }) {
  const group = plan.atomicGroups.find((candidate) => candidate.id === shape.intent.id);
  const groupMutations = plan.mutations.filter((mutation) => mutation.atomicGroupId === group.id);
  const dependencyMutation = plan.mutations.find((mutation) =>
    mutation.resourceKey === pluginResourceKey(atomicDependencyPlugin));

  assert.ok(group, `${testCase.id} should emit a blocked atomic group`);
  assert.equal(group.status, 'blocked');
  assert.equal(group.requireAtomic, true);
  assert.equal(dependencyMutation, undefined, `${testCase.id} must not synthesize dependency plugin metadata`);
  assert.ok(
    group.blockers.some((blocker) =>
      blocker.class === 'missing-plugin-dependency'
        && blocker.plugin === atomicDependencyPlugin),
    `${testCase.id} should block on the missing dependency plugin`,
  );

  for (const resourceKey of shape.expectedResourceKeys) {
    assert.ok(
      group.blockers.some((blocker) =>
        blocker.class === 'atomic-group-blocker-propagation'
          && blocker.resourceKey === resourceKey),
      `${testCase.id} should propagate atomic blocker to ${resourceKey}`,
    );
  }

  return {
    groupId: group.id,
    status: group.status,
    requireAtomic: group.requireAtomic,
    mutationResourceKeys: groupMutations.map((mutation) => mutation.resourceKey).sort(),
    dependencyPluginMutationPlanned: Boolean(dependencyMutation),
    blockers: group.blockers
      .map((blocker) => ({
        class: blocker.class,
        resourceKey: blocker.resourceKey || null,
        plugin: blocker.plugin || null,
        reason: blocker.reason || null,
      }))
      .sort((left, right) =>
        `${left.class}:${left.resourceKey || ''}:${left.plugin || ''}`
          .localeCompare(`${right.class}:${right.resourceKey || ''}:${right.plugin || ''}`)),
    groupHash: `sha256:${digest({
      id: group.id,
      status: group.status,
      resources: [...group.resources].sort(),
      mutations: groupMutations.map((mutation) => mutation.resourceKey).sort(),
      blockers: group.blockers,
    })}`,
  };
}

function refusalEvidence(testCase, plan) {
  const remoteBefore = cloneJson(testCase.remote);
  const remoteBeforeHash = digest(remoteBefore);
  let beforeMutationCalls = 0;
  const error = captureError(() => applyPlan(remoteBefore, plan, {
    beforeMutation() {
      beforeMutationCalls += 1;
    },
  }));
  const remoteAfterHash = digest(remoteBefore);

  assert.ok(error instanceof PushPlanError, `${testCase.id} non-ready atomic stack should refuse apply`);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(beforeMutationCalls, 0, `${testCase.id} non-ready refusal reached beforeMutation`);
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} non-ready refusal mutated remote`);

  return {
    code: error.code,
    detailsHash: `sha256:${digest(error.details)}`,
    beforeMutationCalls,
    preMutationRefusal: beforeMutationCalls === 0,
    remoteBeforeHash,
    remoteAfterHash,
    remoteUnchanged: remoteAfterHash === remoteBeforeHash,
  };
}

function caseEvidence(testCase, result) {
  const missingDependency = testCase.family === 'atomic-plugin-missing-dependency';
  const shape = assertAtomicPluginStackShape(testCase, { missingDependency });
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const redaction = assertAtomicPluginStackEvidenceRedacted(testCase, plan, shape);
  const commonEvidence = {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    variant: missingDependency ? 'missing-dependency-non-ready' : 'ready',
    status: result.status,
    tags: [...testCase.tags].sort(),
    planSummary: plan.summary,
    redaction,
  };

  if (!missingDependency) {
    let readyBeforeMutationCalls = 0;
    const applied = applyPlan(cloneJson(testCase.remote), plan, {
      beforeMutation() {
        readyBeforeMutationCalls += 1;
      },
    });
    const readyAtomicGroup = readyMutationEvidence({
      testCase,
      plan,
      applied,
      shape,
    });
    const staleDependencyReplay = staleDependencyReplayEvidence({
      testCase,
      plan,
    });

    assert.equal(plan.status, 'ready', `${testCase.id} should plan as ready`);
    assert.equal(result.status, 'ready', `${testCase.id} should validate as ready`);
    assert.equal(result.applied, true, `${testCase.id} should apply`);
    assert.equal(result.unplannedRemotePreserved, true, `${testCase.id} should preserve unplanned remote data`);
    assert.equal(result.staleReplayRejected, true, `${testCase.id} should reject stale replay`);
    assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(result.staleReplayRemoteUnchanged, true, `${testCase.id} stale replay should not mutate remote`);
    assert.equal(readyBeforeMutationCalls, plan.mutations.length);

    return {
      ...commonEvidence,
      applied: result.applied,
      readyBeforeMutationCalls,
      unplannedRemotePreserved: result.unplannedRemotePreserved,
      staleReplayRejected: result.staleReplayRejected,
      staleReplayRejectionCode: result.staleReplayRejectionCode,
      staleReplayRemoteUnchanged: result.staleReplayRemoteUnchanged,
      readyAtomicGroup,
      staleDependencyReplay,
      modelProofHash: `sha256:${digest({
        id: testCase.id,
        status: result.status,
        planSummary: plan.summary,
        readyAtomicGroup,
        staleDependencyReplay,
        redaction,
      })}`,
    };
  }

  assert.notEqual(plan.status, 'ready', `${testCase.id} should plan as non-ready`);
  assert.notEqual(result.status, 'ready', `${testCase.id} should validate as non-ready`);
  assert.equal(result.applied, false, `${testCase.id} non-ready stack must not apply`);
  assert.equal(result.nonReadyRemoteUnchanged, true, `${testCase.id} non-ready stack should leave remote unchanged`);

  const blockedAtomicGroup = blockedGroupEvidence({ testCase, plan, shape });
  const refusal = refusalEvidence(testCase, plan);

  return {
    ...commonEvidence,
    applied: result.applied,
    blockedAtomicGroup,
    refusal,
    modelProofHash: `sha256:${digest({
      id: testCase.id,
      status: result.status,
      planSummary: plan.summary,
      blockedAtomicGroup,
      refusal,
      redaction,
    })}`,
  };
}

function generatedAtomicPluginInstallStackReleaseVerifierEvidence(coverage) {
  const perTier = {};
  const statuses = {};
  const selectedCases = new Map();
  let totalCases = 0;
  let readyApplied = 0;
  let readySameGroupDependency = 0;
  let readyPluginOwnedOptionGrouped = 0;
  let readyStaleDependencyRejected = 0;
  let readyStaleDependencyBeforeMutation = 0;
  let readyRemoteUnchanged = 0;
  let readyRedacted = 0;
  let nonReadyApplyRefused = 0;
  let nonReadyBeforeMutation = 0;
  let nonReadyDependencySuppressed = 0;
  let nonReadyBlockerPropagated = 0;

  for (const testCase of targetCases()) {
    const result = validateGeneratedCase(testCase);
    const evidence = caseEvidence(testCase, result);
    const selectedKey = result.status === 'ready' ? 'ready' : 'missing-dependency-non-ready';
    totalCases += 1;
    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);

    if (result.status === 'ready') {
      readyApplied += evidence.applied ? 1 : 0;
      readySameGroupDependency += evidence.readyAtomicGroup.dependencyRequirement.source === 'same-atomic-group'
        && evidence.readyAtomicGroup.dependencyRequirement.mutationIdMatchesDependencyPlugin ? 1 : 0;
      readyPluginOwnedOptionGrouped += evidence.readyAtomicGroup.resources
        .includes(rowResourceKey('wp_options', atomicFixtureOptionRowId)) ? 1 : 0;
      readyStaleDependencyRejected += evidence.staleDependencyReplay.code === 'PRECONDITION_FAILED' ? 1 : 0;
      readyStaleDependencyBeforeMutation += evidence.staleDependencyReplay.beforeMutationCalls === 0 ? 1 : 0;
      readyRemoteUnchanged += evidence.staleDependencyReplay.remoteUnchanged ? 1 : 0;
      readyRedacted += evidence.redaction.rawProbeRedacted ? 1 : 0;
    } else {
      nonReadyApplyRefused += evidence.refusal.code === 'PLAN_NOT_READY' ? 1 : 0;
      nonReadyBeforeMutation += evidence.refusal.beforeMutationCalls === 0 ? 1 : 0;
      nonReadyDependencySuppressed += !evidence.blockedAtomicGroup.dependencyPluginMutationPlanned ? 1 : 0;
      nonReadyBlockerPropagated += evidence.blockedAtomicGroup.blockers.some((blocker) =>
        blocker.class === 'atomic-group-blocker-propagation'
          && blocker.resourceKey === pluginResourceKey(atomicDependentPlugin)) ? 1 : 0;
    }

    if (!selectedCases.has(selectedKey)) {
      selectedCases.set(selectedKey, evidence);
    }
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);

  assert.deepEqual(sortedPerTier, coverage.perTier, 'RPP-0196 target recount should match summary tiers');
  assert.deepEqual(sortedStatuses, coverage.statuses, 'RPP-0196 target recount should match summary statuses');
  assert.equal(totalCases, coverage.total, 'RPP-0196 target recount should match summary total');
  assert.ok(selectedCases.has('ready'), 'RPP-0196 target should select one ready atomic stack case');
  assert.ok(
    selectedCases.has('missing-dependency-non-ready'),
    'RPP-0196 target should select one missing-dependency atomic stack case',
  );

  return {
    target: target.coverageKey,
    family: coverage.family,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    rawValuesIncluded: false,
    totalCases,
    readyCases: sortedStatuses.ready || 0,
    nonReadyCases: totalCases - (sortedStatuses.ready || 0),
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    aggregate: {
      readyApplied,
      readySameGroupDependency,
      readyPluginOwnedOptionGrouped,
      readyStaleDependencyRejected,
      readyStaleDependencyBeforeMutation,
      readyRemoteUnchanged,
      readyRedacted,
      nonReadyApplyRefused,
      nonReadyBeforeMutation,
      nonReadyDependencySuppressed,
      nonReadyBlockerPropagated,
    },
    selectedCases: [
      selectedCases.get('ready'),
      selectedCases.get('missing-dependency-non-ready'),
    ],
  };
}

test('RPP-0196 generated harness summary exposes atomic plugin install stack release-verifier v5 counts', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage[target.coverageKey];
  const readyCase = targetCases().find((testCase) => testCase.tags.has(target.readyTag));
  const nonReadyCase = targetCases().find((testCase) => testCase.tags.has(target.missingDependencyTag));
  const summaryText = JSON.stringify(report);

  assert.ok(coverage, 'missing atomic plugin install stack release-verifier v5 target coverage');
  assert.equal(coverage.family, target.family);
  assert.equal(coverage.total, report.summary.featureFamilies[target.tag]);
  assert.equal(coverage.total, 20);
  assert.deepEqual(coverage.perTier, expectedPerTier);
  assert.deepEqual(coverage.statuses, expectedStatuses);
  assert.equal(report.summary.featureFamilies[target.readyTag], 10);
  assert.equal(report.summary.featureFamilies[target.missingDependencyTag], 10);
  assert.ok(readyCase, 'missing ready RPP-0196 atomic plugin stack case');
  assert.ok(nonReadyCase, 'missing non-ready RPP-0196 atomic plugin stack case');
  assert.equal(validateGeneratedCase(readyCase).status, 'ready');
  assert.notEqual(validateGeneratedCase(nonReadyCase).status, 'ready');
  assert.equal(summaryText.includes('private-atomic-plugin-install-stack-v3'), false);
  assert.equal(summaryText.includes('<?php'), false);
  assert.equal(summaryText.includes('generated dependency'), false);
  assert.equal(summaryText.includes('generated dependent'), false);
});

test('RPP-0196 atomic plugin install stack release-verifier evidence is hash-only and pre-mutation safe', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage[target.coverageKey];
  const firstEvidence = generatedAtomicPluginInstallStackReleaseVerifierEvidence(coverage);
  const replayEvidence = generatedAtomicPluginInstallStackReleaseVerifierEvidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test test/rpp-0196-atomic-plugin-install-stack-release-verifier-v5.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'RPP-0196 atomic stack evidence changed between runs');
  assert.equal(firstEvidence.target, target.coverageKey);
  assert.equal(firstEvidence.family, target.family);
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.equal(firstEvidence.readyCases, coverage.statuses.ready);
  assert.equal(firstEvidence.nonReadyCases, coverage.statuses.blocked + coverage.statuses.conflict);
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(firstEvidence.aggregate, {
    readyApplied: 10,
    readySameGroupDependency: 10,
    readyPluginOwnedOptionGrouped: 10,
    readyStaleDependencyRejected: 10,
    readyStaleDependencyBeforeMutation: 10,
    readyRemoteUnchanged: 10,
    readyRedacted: 10,
    nonReadyApplyRefused: 10,
    nonReadyBeforeMutation: 10,
    nonReadyDependencySuppressed: 10,
    nonReadyBlockerPropagated: 10,
  });
  assert.deepEqual(
    firstEvidence.selectedCases.map((entry) => entry.variant),
    ['ready', 'missing-dependency-non-ready'],
  );

  const [readyCase, nonReadyCase] = firstEvidence.selectedCases;
  assert.ok(readyCase.tags.includes(target.readyTag));
  assert.equal(readyCase.status, 'ready');
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.readyBeforeMutationCalls, readyCase.planSummary.mutations);
  assert.equal(readyCase.unplannedRemotePreserved, true);
  assert.equal(readyCase.staleReplayRejected, true);
  assert.equal(readyCase.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplayRemoteUnchanged, true);
  assert.equal(readyCase.readyAtomicGroup.status, 'ready');
  assert.equal(readyCase.readyAtomicGroup.dependencyRequirement.source, 'same-atomic-group');
  assert.equal(readyCase.readyAtomicGroup.dependencyRequirement.resourceKey, pluginResourceKey(atomicDependencyPlugin));
  assert.equal(readyCase.readyAtomicGroup.dependencyRequirement.mutationIdMatchesDependencyPlugin, true);
  assert.ok(readyCase.readyAtomicGroup.resources.includes(fileResourceKey(atomicDependencyPluginFile)));
  assert.ok(readyCase.readyAtomicGroup.resources.includes(pluginResourceKey(atomicDependencyPlugin)));
  assert.ok(readyCase.readyAtomicGroup.resources.includes(rowResourceKey('wp_options', atomicFixtureOptionRowId)));
  assert.equal(readyCase.readyAtomicGroup.pluginOwnedOption.resourceKey, rowResourceKey('wp_options', atomicFixtureOptionRowId));
  assert.equal(readyCase.readyAtomicGroup.pluginOwnedOption.pluginOwner, atomicDependentPlugin);
  assert.equal(readyCase.readyAtomicGroup.pluginOwnedOption.driver, 'wp-option');
  assert.equal(readyCase.readyAtomicGroup.pluginOwnedOption.ownerContextRequired, true);
  assert.equal(readyCase.readyAtomicGroup.pluginOwnedOption.supportsDelete, false);
  assert.equal(
    readyCase.readyAtomicGroup.pluginOwnedOption.appliedHash,
    readyCase.readyAtomicGroup.pluginOwnedOption.localHash,
  );
  assert.equal(
    readyCase.readyAtomicGroup.pluginOwnedOption.preconditionExpectedHash,
    readyCase.readyAtomicGroup.pluginOwnedOption.remoteBeforeHash,
  );
  assert.equal(readyCase.readyAtomicGroup.pluginOwnedOption.preconditionCheckedAgainst, 'live-remote');
  assert.equal(readyCase.staleDependencyReplay.code, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleDependencyReplay.resourceKey, pluginResourceKey(atomicDependencyPlugin));
  assert.equal(readyCase.staleDependencyReplay.beforeMutationCalls, 0);
  assert.equal(readyCase.staleDependencyReplay.preMutationRefusal, true);
  assert.equal(readyCase.staleDependencyReplay.remoteUnchanged, true);
  assert.notEqual(readyCase.staleDependencyReplay.actualHash, readyCase.staleDependencyReplay.expectedHash);
  assert.equal(readyCase.redaction.rawProbeRedacted, true);
  assert.match(readyCase.readyAtomicGroup.groupHash, sha256EvidencePattern);
  assert.match(readyCase.readyAtomicGroup.pluginOwnedOption.auditEvidenceHash, sha256EvidencePattern);
  assert.match(readyCase.readyAtomicGroup.pluginOwnedOption.driverAuditEvidenceHash, sha256EvidencePattern);
  assert.match(readyCase.staleDependencyReplay.detailsHash, sha256EvidencePattern);
  assert.match(readyCase.redaction.redactedEvidenceHash, sha256EvidencePattern);
  assert.match(readyCase.modelProofHash, sha256EvidencePattern);

  assert.ok(nonReadyCase.tags.includes(target.missingDependencyTag));
  assert.notEqual(nonReadyCase.status, 'ready');
  assert.equal(nonReadyCase.applied, false);
  assert.equal(nonReadyCase.blockedAtomicGroup.status, 'blocked');
  assert.equal(nonReadyCase.blockedAtomicGroup.dependencyPluginMutationPlanned, false);
  assert.ok(
    nonReadyCase.blockedAtomicGroup.blockers.some((blocker) =>
      blocker.class === 'missing-plugin-dependency'
        && blocker.plugin === atomicDependencyPlugin),
  );
  assert.ok(
    nonReadyCase.blockedAtomicGroup.blockers.some((blocker) =>
      blocker.class === 'atomic-group-blocker-propagation'
        && blocker.resourceKey === pluginResourceKey(atomicDependentPlugin)),
  );
  assert.equal(nonReadyCase.refusal.code, 'PLAN_NOT_READY');
  assert.equal(nonReadyCase.refusal.beforeMutationCalls, 0);
  assert.equal(nonReadyCase.refusal.preMutationRefusal, true);
  assert.equal(nonReadyCase.refusal.remoteUnchanged, true);
  assert.match(nonReadyCase.blockedAtomicGroup.groupHash, sha256EvidencePattern);
  assert.match(nonReadyCase.refusal.detailsHash, sha256EvidencePattern);
  assert.match(nonReadyCase.modelProofHash, sha256EvidencePattern);

  assert.match(evidenceEnvelope.evidenceHash, sha256EvidencePattern);
  assert.equal(evidenceText.includes('private-atomic-plugin-install-stack-v3'), false);
  assert.equal(evidenceText.includes('privateInstallToken'), false);
  assert.equal(evidenceText.includes('option_value'), false);
  assert.equal(evidenceText.includes('<?php'), false);
  assert.equal(evidenceText.includes('generated dependency'), false);
  assert.equal(evidenceText.includes('generated dependent'), false);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(
      evidenceEnvelope,
      { label: 'RPP-0196 atomic plugin install stack release-verifier evidence' },
    ));
});
