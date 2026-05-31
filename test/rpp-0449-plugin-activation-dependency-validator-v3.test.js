import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const sha256Pattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

const dependencyPlugin = 'reprint-push-atomic-dependency-fixture';
const dependentPlugin = 'reprint-push-atomic-dependent-fixture';
const dependencyResourceKey = `plugin:${dependencyPlugin}`;
const dependentResourceKey = `plugin:${dependentPlugin}`;
const dataTable = 'wp_options';
const dataRowId = 'option_name:reprint_push_atomic_fixture_data';
const dataResourceKey = `row:${JSON.stringify([dataTable, dataRowId])}`;
const groupId = 'rpp-0449-activate-dependent-with-live-dependency';

const rawFixtures = {
  baseDependencyBuild: 'rpp-0449-base-dependency-build-private',
  driftDependencyBuild: 'rpp-0449-drift-dependency-build-private',
  dependencyEnvelope: 'rpp-0449-dependency-envelope-private',
  dependencyToken: 'rpp-0449-dependency-token-private',
  baseRowMode: 'rpp-0449-base-plugin-owned-row-private',
  localRowMode: 'rpp-0449-local-plugin-owned-row-private',
  staleRowMode: 'rpp-0449-stale-plugin-owned-row-private',
  missingRowMode: 'rpp-0449-missing-plugin-owned-row-private',
};

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}

function prefixedResourceHash(value) {
  return `sha256:${value}`;
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function pluginResource(name) {
  return {
    type: 'plugin',
    name,
    key: `plugin:${name}`,
  };
}

function dataResource() {
  return {
    type: 'row',
    table: dataTable,
    id: dataRowId,
    key: dataResourceKey,
  };
}

function pluginMainFile(name) {
  return `wp-content/plugins/${name}/${name}.php`;
}

function activationSnapshot({
  dependencyActive = true,
  dependentActive = false,
  dependencyVersion = '2.1.0',
  dependencyBuild = rawFixtures.baseDependencyBuild,
  rowMode = rawFixtures.baseRowMode,
} = {}) {
  return {
    files: {
      [pluginMainFile(dependencyPlugin)]: '<?php /* RPP-0449 dependency fixture */',
      [pluginMainFile(dependentPlugin)]: '<?php /* RPP-0449 dependent fixture */',
    },
    plugins: {
      [dependencyPlugin]: {
        version: dependencyVersion,
        active: dependencyActive,
        build: dependencyBuild,
      },
      [dependentPlugin]: {
        version: '1.0.0',
        active: dependentActive,
        requires: [dependencyPlugin],
      },
    },
    db: {
      [dataTable]: {
        [dataRowId]: {
          option_name: 'reprint_push_atomic_fixture_data',
          option_value: {
            mode: rowMode,
          },
          autoload: 'no',
          __pluginOwner: dependentPlugin,
        },
      },
    },
  };
}

function activationIntent({ dependencyHash, active = true } = {}) {
  return {
    id: groupId,
    kind: 'plugin-activation',
    requireAtomic: true,
    resources: [dependentResourceKey, dataResourceKey],
    dependencies: {
      plugins: [
        {
          name: dependencyPlugin,
          expectedVersion: '2.1.0',
          expectedHash: dependencyHash,
          active,
          privateEnvelope: rawFixtures.dependencyEnvelope,
          credentials: { token: rawFixtures.dependencyToken },
        },
      ],
    },
    resourcePolicy: {
      pluginOwnedResources: {
        allowedResources: [
          {
            resourceKey: dataResourceKey,
            pluginOwner: dependentPlugin,
            driver: 'wp-option',
            supportsDelete: false,
          },
        ],
      },
    },
  };
}

function withActivationIntent(site, options) {
  site.pushIntents = [activationIntent(options)];
  return site;
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function tamperReadyPlan(plan, mutate) {
  const copy = cloneJson(plan);
  mutate(copy);
  copy.status = 'ready';
  copy.blockers = [];
  copy.conflicts = [];
  copy.summary = {
    ...copy.summary,
    blockers: 0,
    conflicts: 0,
  };
  return copy;
}

function readyActivationFixture() {
  const base = activationSnapshot();
  const remote = cloneJson(base);
  const local = activationSnapshot({
    dependentActive: true,
    rowMode: rawFixtures.localRowMode,
  });
  const dependencyRemoteHash = resourceHash(remote, pluginResource(dependencyPlugin));
  withActivationIntent(local, {
    dependencyHash: dependencyRemoteHash,
    active: true,
  });

  return {
    base,
    local,
    remote,
    dependencyRemoteHash,
  };
}

function assertSha256(value, label) {
  assert.match(value, sha256Pattern, `${label} should be a sha256 hex digest`);
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

function assertDependencyRequirementIsExplicitHashOnly(requirement, dependencyRemoteHash) {
  assert.equal(requirement.plugin, dependencyPlugin);
  assert.equal(requirement.resourceKey, dependencyResourceKey);
  assert.equal(requirement.source, 'live-remote');
  assert.equal(requirement.expectedVersion, '2.1.0');
  assert.equal(requirement.active, true);
  assert.equal(requirement.expectedHash, dependencyRemoteHash);
  assert.equal(requirement.remoteHash, dependencyRemoteHash);
  assert.equal(requirement.baseHash, dependencyRemoteHash);
  assertSha256(requirement.expectedHash, 'dependency expectedHash');
  assertSha256(requirement.remoteHash, 'dependency remoteHash');
  assertSha256(requirement.baseHash, 'dependency baseHash');
  assert.equal(Object.hasOwn(requirement, 'raw'), false);
  assertNoRawFixtureValues(requirement, 'dependency requirement evidence');
}

test('RPP-0449 generated activation dependency validator carries explicit hash-only metadata through local apply', () => {
  const {
    base,
    local,
    remote,
    dependencyRemoteHash,
  } = readyActivationFixture();
  const plan = planFor(base, local, remote);
  const group = plan.atomicGroups.find((entry) => entry.id === groupId);
  const requirement = group.dependencyRequirements[0];
  const activationMutation = mutationFor(plan, dependentResourceKey);
  const dataMutation = mutationFor(plan, dataResourceKey);

  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.summary, {
    mutations: 2,
    decisions: 0,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 1,
  });
  assert.equal(group.status, 'ready');
  assert.deepEqual(group.dependencies, { plugins: [dependencyPlugin] });
  assert.deepEqual(group.mutationIds.sort(), plan.mutations.map((mutation) => mutation.id).sort());
  assertDependencyRequirementIsExplicitHashOnly(requirement, dependencyRemoteHash);

  assert.equal(activationMutation.action, 'put');
  assert.equal(activationMutation.changeKind, 'update');
  assert.equal(activationMutation.resourceKey, dependentResourceKey);
  assert.equal(activationMutation.atomicGroupId, groupId);
  assert.equal(dataMutation.action, 'put');
  assert.equal(dataMutation.changeKind, 'update');
  assert.equal(dataMutation.resourceKey, dataResourceKey);
  assert.equal(dataMutation.atomicGroupId, groupId);
  assert.equal(dataMutation.pluginOwnedResource.pluginOwner, dependentPlugin);
  assert.equal(dataMutation.pluginOwnedResource.driver, 'wp-option');
  assert.equal(dataMutation.pluginOwnedResource.supportsDelete, false);
  assert.equal(dataMutation.pluginOwnedResource.auditEvidence.format, 'hash-only');
  assert.equal(dataMutation.pluginOwnedResource.auditEvidence.rawValuesIncluded, false);
  assertNoRawFixtureValues(dataMutation.pluginOwnedResource.auditEvidence, 'plugin-owned audit evidence');
  assertNoRawFixtureValues(dataMutation.pluginOwnedResource.driverAuditEvidence, 'driver decision evidence');

  const liveRemote = cloneJson(remote);
  const mutationOrder = [];
  const result = applyPlan(liveRemote, plan, {
    mutateRemote: true,
    beforeMutation({ mutation }) {
      mutationOrder.push(mutation.resourceKey);
    },
  });
  const evidence = {
    rpp: 'RPP-0449',
    evidenceSource: 'generated-plugin-activation-dependency-validator-v3',
    status: 'support_only',
    verdict: 'PLUGIN_ACTIVATION_DEPENDENCY_LOCAL_APPLY_ACCEPTED',
    productionBacked: false,
    releaseGate: 'NO-GO',
    rawValuesIncluded: false,
    dependencyRequirement: {
      plugin: requirement.plugin,
      resourceKey: requirement.resourceKey,
      source: requirement.source,
      active: requirement.active,
      expectedVersion: requirement.expectedVersion,
      expectedHash: prefixedResourceHash(requirement.expectedHash),
      baseHash: prefixedResourceHash(requirement.baseHash),
      remoteHash: prefixedResourceHash(requirement.remoteHash),
      requirementHash: sha256Evidence(requirement),
    },
    acceptedApply: {
      groupHash: sha256Evidence(group),
      activationMutationHash: sha256Evidence({
        resourceKey: activationMutation.resourceKey,
        action: activationMutation.action,
        baseHash: activationMutation.baseHash,
        remoteBeforeHash: activationMutation.remoteBeforeHash,
        localHash: activationMutation.localHash,
      }),
      dataMutationHash: sha256Evidence({
        resourceKey: dataMutation.resourceKey,
        action: dataMutation.action,
        baseHash: dataMutation.baseHash,
        remoteBeforeHash: dataMutation.remoteBeforeHash,
        localHash: dataMutation.localHash,
      }),
      journalHash: sha256Evidence(result.journal),
      remoteAfterHash: sha256Evidence(result.site),
      dependencyHashAfter: prefixedResourceHash(resourceHash(result.site, pluginResource(dependencyPlugin))),
      dependentHashAfter: prefixedResourceHash(resourceHash(result.site, pluginResource(dependentPlugin))),
      dataRowHashAfter: prefixedResourceHash(resourceHash(result.site, dataResource())),
    },
  };
  evidence.proofHash = sha256Evidence({
    dependencyRequirement: evidence.dependencyRequirement,
    acceptedApply: evidence.acceptedApply,
  });

  assert.deepEqual(mutationOrder, plan.mutations.map((mutation) => mutation.resourceKey));
  assert.equal(result.appliedMutations, 2);
  assert.equal(result.recoveryState.status, 'fully-updated-remote');
  assert.equal(liveRemote.plugins[dependentPlugin].active, true);
  assert.equal(liveRemote.plugins[dependencyPlugin].active, true);
  assert.deepEqual(liveRemote.plugins[dependencyPlugin], remote.plugins[dependencyPlugin]);
  assert.equal(liveRemote.db[dataTable][dataRowId].option_value.mode, rawFixtures.localRowMode);
  assert.deepEqual(result.site, liveRemote);
  assert.equal(result.journal.entries.length, 2);

  for (const hash of [
    evidence.dependencyRequirement.expectedHash,
    evidence.dependencyRequirement.baseHash,
    evidence.dependencyRequirement.remoteHash,
    evidence.dependencyRequirement.requirementHash,
    evidence.acceptedApply.groupHash,
    evidence.acceptedApply.activationMutationHash,
    evidence.acceptedApply.dataMutationHash,
    evidence.acceptedApply.journalHash,
    evidence.acceptedApply.remoteAfterHash,
    evidence.acceptedApply.dependencyHashAfter,
    evidence.acceptedApply.dependentHashAfter,
    evidence.acceptedApply.dataRowHashAfter,
    evidence.proofHash,
  ]) {
    assertSha256Evidence(hash, 'RPP-0449 accepted evidence hash');
  }
  assertNoRawFixtureValues(group.dependencyRequirements, 'atomic group dependency metadata');
  assertNoRawFixtureValues(result.journal, 'apply journal');
  assertNoRawFixtureValues(evidence, 'accepted activation dependency proof');
});

test('RPP-0449 missing or stale dependency evidence preserves plugin-owned remote data before mutation', () => {
  const {
    base,
    local,
    remote,
    dependencyRemoteHash,
  } = readyActivationFixture();
  const plan = planFor(base, local, remote);
  const dataMutation = mutationFor(plan, dataResourceKey);
  const requirement = plan.atomicGroups[0].dependencyRequirements[0];
  assertDependencyRequirementIsExplicitHashOnly(requirement, dependencyRemoteHash);

  const missingRemote = cloneJson(remote);
  missingRemote.db[dataTable][dataRowId].option_value.mode = rawFixtures.missingRowMode;
  delete missingRemote.plugins[dependencyPlugin];
  const missingRemoteBefore = cloneJson(missingRemote);
  let missingHookCalls = 0;
  const missingError = captureError(() => applyPlan(missingRemote, plan, {
    mutateRemote: true,
    beforeMutation() {
      missingHookCalls += 1;
    },
  }));

  assert.ok(missingError instanceof PushPlanError);
  assert.equal(missingError.code, 'ATOMIC_GROUP_DEPENDENCY_MISSING');
  assert.equal(missingError.details.plugin, dependencyPlugin);
  assert.equal(missingError.details.source, 'live-remote');
  assert.equal(missingHookCalls, 0);
  assert.deepEqual(missingRemote, missingRemoteBefore);

  const staleRemote = cloneJson(remote);
  staleRemote.plugins[dependencyPlugin] = {
    version: '2.2.0',
    active: false,
    build: rawFixtures.driftDependencyBuild,
  };
  staleRemote.db[dataTable][dataRowId].option_value.mode = rawFixtures.staleRowMode;
  const staleRemoteBefore = cloneJson(staleRemote);
  const staleDependencyHashBefore = resourceHash(staleRemote, pluginResource(dependencyPlugin));
  const staleDependentHashBefore = resourceHash(staleRemote, pluginResource(dependentPlugin));
  const staleDataHashBefore = resourceHash(staleRemote, dataMutation.resource);
  const staleRemoteHashBefore = sha256Evidence(staleRemote);
  let staleHookCalls = 0;
  const staleError = captureError(() => applyPlan(staleRemote, plan, {
    mutateRemote: true,
    beforeMutation() {
      staleHookCalls += 1;
    },
  }));

  const refusalEvidence = {
    rpp: 'RPP-0449',
    evidenceSource: 'generated-plugin-activation-dependency-validator-v3-refusal',
    status: 'support_only',
    verdict: 'PLUGIN_ACTIVATION_DEPENDENCY_REMOTE_DRIFT_PRESERVED',
    productionBacked: false,
    releaseGate: 'NO-GO',
    rawValuesIncluded: false,
    missingDependency: {
      code: missingError.code,
      detailsHash: sha256Evidence(missingError.details),
      remoteHashBefore: sha256Evidence(missingRemoteBefore),
      remoteHashAfter: sha256Evidence(missingRemote),
      dataRowHashBefore: prefixedResourceHash(resourceHash(missingRemoteBefore, dataMutation.resource)),
      dataRowHashAfter: prefixedResourceHash(resourceHash(missingRemote, dataMutation.resource)),
      hookCalls: missingHookCalls,
    },
    staleDependency: {
      code: staleError.code,
      detailsHash: sha256Evidence(staleError.details),
      expectedHash: prefixedResourceHash(staleError.details.expectedHash),
      actualHash: prefixedResourceHash(staleError.details.actualHash),
      dependencyHashBefore: prefixedResourceHash(staleDependencyHashBefore),
      dependencyHashAfter: prefixedResourceHash(resourceHash(staleRemote, pluginResource(dependencyPlugin))),
      dependentHashBefore: prefixedResourceHash(staleDependentHashBefore),
      dependentHashAfter: prefixedResourceHash(resourceHash(staleRemote, pluginResource(dependentPlugin))),
      dataRowHashBefore: prefixedResourceHash(staleDataHashBefore),
      dataRowHashAfter: prefixedResourceHash(resourceHash(staleRemote, dataMutation.resource)),
      remoteHashBefore: staleRemoteHashBefore,
      remoteHashAfter: sha256Evidence(staleRemote),
      hookCalls: staleHookCalls,
    },
  };
  refusalEvidence.proofHash = sha256Evidence({
    missingDependency: refusalEvidence.missingDependency,
    staleDependency: refusalEvidence.staleDependency,
  });

  assert.ok(staleError instanceof PushPlanError);
  assert.equal(staleError.code, 'ATOMIC_GROUP_DEPENDENCY_STALE');
  assert.equal(staleError.details.plugin, dependencyPlugin);
  assert.equal(staleError.details.expectedHash, dependencyRemoteHash);
  assert.equal(staleError.details.actualHash, staleDependencyHashBefore);
  assert.equal(staleHookCalls, 0);
  assert.deepEqual(staleRemote, staleRemoteBefore);
  assert.equal(refusalEvidence.missingDependency.dataRowHashAfter, refusalEvidence.missingDependency.dataRowHashBefore);
  assert.equal(refusalEvidence.missingDependency.remoteHashAfter, refusalEvidence.missingDependency.remoteHashBefore);
  assert.equal(refusalEvidence.staleDependency.dependencyHashAfter, refusalEvidence.staleDependency.dependencyHashBefore);
  assert.equal(refusalEvidence.staleDependency.dependentHashAfter, refusalEvidence.staleDependency.dependentHashBefore);
  assert.equal(refusalEvidence.staleDependency.dataRowHashAfter, refusalEvidence.staleDependency.dataRowHashBefore);
  assert.equal(refusalEvidence.staleDependency.remoteHashAfter, refusalEvidence.staleDependency.remoteHashBefore);

  for (const hash of [
    refusalEvidence.missingDependency.detailsHash,
    refusalEvidence.missingDependency.remoteHashBefore,
    refusalEvidence.missingDependency.remoteHashAfter,
    refusalEvidence.missingDependency.dataRowHashBefore,
    refusalEvidence.missingDependency.dataRowHashAfter,
    refusalEvidence.staleDependency.detailsHash,
    refusalEvidence.staleDependency.expectedHash,
    refusalEvidence.staleDependency.actualHash,
    refusalEvidence.staleDependency.dependencyHashBefore,
    refusalEvidence.staleDependency.dependencyHashAfter,
    refusalEvidence.staleDependency.dependentHashBefore,
    refusalEvidence.staleDependency.dependentHashAfter,
    refusalEvidence.staleDependency.dataRowHashBefore,
    refusalEvidence.staleDependency.dataRowHashAfter,
    refusalEvidence.staleDependency.remoteHashBefore,
    refusalEvidence.staleDependency.remoteHashAfter,
    refusalEvidence.proofHash,
  ]) {
    assertSha256Evidence(hash, 'RPP-0449 refusal evidence hash');
  }
  assertNoRawFixtureValues(missingError.details, 'missing dependency refusal details');
  assertNoRawFixtureValues(staleError.details, 'stale dependency refusal details');
  assertNoRawFixtureValues(refusalEvidence, 'dependency refusal proof');
});

test('RPP-0449 invalid or forged activation dependency evidence fails closed', () => {
  const {
    base,
    local,
    remote,
    dependencyRemoteHash,
  } = readyActivationFixture();
  const readyPlan = planFor(base, local, remote);

  const invalidLocal = withActivationIntent(cloneJson(local), {
    dependencyHash: dependencyRemoteHash,
    active: false,
  });
  const invalidPlan = planFor(base, invalidLocal, cloneJson(remote));
  const activationBlocker = invalidPlan.blockers.find((blocker) =>
    blocker.class === 'incompatible-plugin-dependency-activation');
  const invalidRemote = cloneJson(remote);
  const invalidRemoteBefore = cloneJson(invalidRemote);
  const invalidError = captureError(() => applyPlan(invalidRemote, invalidPlan, {
    mutateRemote: true,
    beforeMutation() {
      assert.fail('blocked invalid dependency activation plan reached beforeMutation');
    },
  }));

  assert.equal(invalidPlan.status, 'blocked');
  assert.ok(activationBlocker, 'invalid activation metadata should emit a blocker');
  assert.equal(activationBlocker.plugin, dependencyPlugin);
  assert.equal(activationBlocker.expectedActive, false);
  assert.equal(activationBlocker.actualActive, true);
  assert.equal(activationBlocker.dependency.expectedHash, dependencyRemoteHash);
  assert.ok(invalidError instanceof PushPlanError);
  assert.equal(invalidError.code, 'PLAN_NOT_READY');
  assert.deepEqual(invalidRemote, invalidRemoteBefore);
  assertNoRawFixtureValues(activationBlocker, 'invalid activation blocker');

  const forgedPlan = tamperReadyPlan(readyPlan, (copy) => {
    delete copy.atomicGroups[0].dependencies;
    delete copy.atomicGroups[0].dependencyRequirements;
  });
  const forgedRemote = cloneJson(remote);
  forgedRemote.db[dataTable][dataRowId].option_value.mode = rawFixtures.staleRowMode;
  const forgedRemoteBefore = cloneJson(forgedRemote);
  let forgedHookCalls = 0;
  const forgedError = captureError(() => applyPlan(forgedRemote, forgedPlan, {
    mutateRemote: true,
    beforeMutation() {
      forgedHookCalls += 1;
    },
  }));

  const forgedActivePlan = tamperReadyPlan(readyPlan, (copy) => {
    copy.atomicGroups[0].dependencyRequirements[0].active = false;
  });
  const forgedActiveRemote = cloneJson(remote);
  const forgedActiveRemoteBefore = cloneJson(forgedActiveRemote);
  let forgedActiveHookCalls = 0;
  const forgedActiveError = captureError(() => applyPlan(forgedActiveRemote, forgedActivePlan, {
    mutateRemote: true,
    beforeMutation() {
      forgedActiveHookCalls += 1;
    },
  }));

  const forgedEvidence = {
    rpp: 'RPP-0449',
    evidenceSource: 'generated-plugin-activation-dependency-validator-v3-forged-refusal',
    status: 'support_only',
    verdict: 'PLUGIN_ACTIVATION_DEPENDENCY_FORGED_EVIDENCE_REFUSED',
    productionBacked: false,
    releaseGate: 'NO-GO',
    rawValuesIncluded: false,
    invalidPlannerEvidence: {
      code: invalidError.code,
      blockerHash: sha256Evidence(activationBlocker),
      remoteHashBefore: sha256Evidence(invalidRemoteBefore),
      remoteHashAfter: sha256Evidence(invalidRemote),
    },
    undeclaredDependencyEvidence: {
      code: forgedError.code,
      detailsHash: sha256Evidence(forgedError.details),
      remoteHashBefore: sha256Evidence(forgedRemoteBefore),
      remoteHashAfter: sha256Evidence(forgedRemote),
      dataRowHashBefore: prefixedResourceHash(resourceHash(forgedRemoteBefore, dataResource())),
      dataRowHashAfter: prefixedResourceHash(resourceHash(forgedRemote, dataResource())),
      hookCalls: forgedHookCalls,
    },
    forgedActiveEvidence: {
      code: forgedActiveError.code,
      detailsHash: sha256Evidence(forgedActiveError.details),
      remoteHashBefore: sha256Evidence(forgedActiveRemoteBefore),
      remoteHashAfter: sha256Evidence(forgedActiveRemote),
      hookCalls: forgedActiveHookCalls,
    },
  };
  forgedEvidence.proofHash = sha256Evidence({
    invalidPlannerEvidence: forgedEvidence.invalidPlannerEvidence,
    undeclaredDependencyEvidence: forgedEvidence.undeclaredDependencyEvidence,
    forgedActiveEvidence: forgedEvidence.forgedActiveEvidence,
  });

  assert.ok(forgedError instanceof PushPlanError);
  assert.equal(forgedError.code, 'ATOMIC_GROUP_DEPENDENCY_UNDECLARED');
  assert.equal(forgedError.details.plugin, dependentPlugin);
  assert.equal(forgedError.details.dependency, dependencyPlugin);
  assert.equal(forgedHookCalls, 0);
  assert.deepEqual(forgedRemote, forgedRemoteBefore);

  assert.ok(forgedActiveError instanceof PushPlanError);
  assert.equal(forgedActiveError.code, 'ATOMIC_GROUP_DEPENDENCY_ACTIVE_MISMATCH');
  assert.equal(forgedActiveError.details.plugin, dependencyPlugin);
  assert.equal(forgedActiveError.details.expectedActive, false);
  assert.equal(forgedActiveError.details.actualActive, true);
  assert.equal(forgedActiveHookCalls, 0);
  assert.deepEqual(forgedActiveRemote, forgedActiveRemoteBefore);

  assert.equal(
    forgedEvidence.invalidPlannerEvidence.remoteHashAfter,
    forgedEvidence.invalidPlannerEvidence.remoteHashBefore,
  );
  assert.equal(
    forgedEvidence.undeclaredDependencyEvidence.remoteHashAfter,
    forgedEvidence.undeclaredDependencyEvidence.remoteHashBefore,
  );
  assert.equal(
    forgedEvidence.undeclaredDependencyEvidence.dataRowHashAfter,
    forgedEvidence.undeclaredDependencyEvidence.dataRowHashBefore,
  );
  assert.equal(
    forgedEvidence.forgedActiveEvidence.remoteHashAfter,
    forgedEvidence.forgedActiveEvidence.remoteHashBefore,
  );

  for (const hash of [
    forgedEvidence.invalidPlannerEvidence.blockerHash,
    forgedEvidence.invalidPlannerEvidence.remoteHashBefore,
    forgedEvidence.invalidPlannerEvidence.remoteHashAfter,
    forgedEvidence.undeclaredDependencyEvidence.detailsHash,
    forgedEvidence.undeclaredDependencyEvidence.remoteHashBefore,
    forgedEvidence.undeclaredDependencyEvidence.remoteHashAfter,
    forgedEvidence.undeclaredDependencyEvidence.dataRowHashBefore,
    forgedEvidence.undeclaredDependencyEvidence.dataRowHashAfter,
    forgedEvidence.forgedActiveEvidence.detailsHash,
    forgedEvidence.forgedActiveEvidence.remoteHashBefore,
    forgedEvidence.forgedActiveEvidence.remoteHashAfter,
    forgedEvidence.proofHash,
  ]) {
    assertSha256Evidence(hash, 'RPP-0449 forged evidence hash');
  }
  assertNoRawFixtureValues(forgedError.details, 'undeclared dependency refusal details');
  assertNoRawFixtureValues(forgedActiveError.details, 'forged active dependency refusal details');
  assertNoRawFixtureValues(forgedEvidence, 'forged activation dependency proof');
});
