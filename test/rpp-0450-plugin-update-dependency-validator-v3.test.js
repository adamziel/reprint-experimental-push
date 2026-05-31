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
const groupId = 'rpp-0450-update-dependent-plugin';
const versionRange = '>=2.0.0 <3.0.0';

const rawFixtures = {
  baseDependencyBuild: 'rpp-0450-base-dependency-build-private',
  driftDependencyBuild: 'rpp-0450-drift-dependency-build-private',
  dependencyEnvelope: 'rpp-0450-dependency-envelope-private',
  dependencyCredential: 'rpp-0450-dependency-credential-private',
  baseDependentRelease: 'rpp-0450-base-dependent-release-private',
  localDependentRelease: 'rpp-0450-local-dependent-release-private',
  baseRowMode: 'rpp-0450-base-plugin-owned-row-private',
  localRowMode: 'rpp-0450-local-plugin-owned-row-private',
  invalidRowMode: 'rpp-0450-invalid-plugin-owned-row-private',
  missingRowMode: 'rpp-0450-missing-plugin-owned-row-private',
  staleRowMode: 'rpp-0450-stale-plugin-owned-row-private',
  forgedRowMode: 'rpp-0450-forged-plugin-owned-row-private',
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

function updateSnapshot({
  includeDependency = true,
  dependencyVersion = '2.1.0',
  dependencyActive = true,
  dependencyBuild = rawFixtures.baseDependencyBuild,
  dependentVersion = '1.0.0',
  dependentRelease = rawFixtures.baseDependentRelease,
  rowMode = rawFixtures.baseRowMode,
} = {}) {
  const plugins = {
    [dependentPlugin]: {
      version: dependentVersion,
      active: true,
      requires: [dependencyPlugin],
      releaseNote: dependentRelease,
    },
  };

  if (includeDependency) {
    plugins[dependencyPlugin] = {
      version: dependencyVersion,
      active: dependencyActive,
      build: dependencyBuild,
    };
  }

  return {
    files: {
      [pluginMainFile(dependencyPlugin)]: '<?php /* RPP-0450 dependency fixture */',
      [pluginMainFile(dependentPlugin)]: '<?php /* RPP-0450 dependent fixture */',
    },
    plugins,
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

function updateIntent({
  dependencyHash,
  expectedVersion = '2.1.0',
  range = versionRange,
  active = true,
} = {}) {
  return {
    id: groupId,
    kind: 'plugin-update',
    requireAtomic: true,
    resources: [dependentResourceKey, dataResourceKey],
    dependencies: {
      plugins: [
        {
          name: dependencyPlugin,
          expectedVersion,
          versionRange: range,
          expectedHash: dependencyHash,
          active,
          privateEnvelope: rawFixtures.dependencyEnvelope,
          credentials: {
            proof: rawFixtures.dependencyCredential,
          },
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

function withUpdateIntent(site, options) {
  site.pushIntents = [updateIntent(options)];
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

function readyUpdateFixture() {
  const base = updateSnapshot();
  const remote = cloneJson(base);
  const local = updateSnapshot({
    dependentVersion: '1.1.0',
    dependentRelease: rawFixtures.localDependentRelease,
    rowMode: rawFixtures.localRowMode,
  });
  const dependencyRemoteHash = resourceHash(remote, pluginResource(dependencyPlugin));
  withUpdateIntent(local, {
    dependencyHash: dependencyRemoteHash,
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

function assertDependencyRequirementIsExactHashOnly(requirement, dependencyRemoteHash) {
  assert.equal(requirement.plugin, dependencyPlugin);
  assert.equal(requirement.resourceKey, dependencyResourceKey);
  assert.equal(requirement.source, 'live-remote');
  assert.equal(requirement.expectedVersion, '2.1.0');
  assert.equal(requirement.versionRange, versionRange);
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
  };
}

test('RPP-0450 generated plugin update dependency validator carries exact hash-only metadata', () => {
  const {
    base,
    local,
    remote,
    dependencyRemoteHash,
  } = readyUpdateFixture();
  const plan = planFor(base, local, remote);
  const group = plan.atomicGroups.find((entry) => entry.id === groupId);
  const requirement = group.dependencyRequirements[0];
  const pluginMutation = mutationFor(plan, dependentResourceKey);
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
  assert.equal(group.kind, 'plugin-update');
  assert.deepEqual(group.dependencies, { plugins: [dependencyPlugin] });
  assert.deepEqual(group.mutationIds.sort(), plan.mutations.map((mutation) => mutation.id).sort());
  assertDependencyRequirementIsExactHashOnly(requirement, dependencyRemoteHash);

  assert.equal(pluginMutation.action, 'put');
  assert.equal(pluginMutation.changeKind, 'update');
  assert.equal(pluginMutation.resourceKey, dependentResourceKey);
  assert.equal(pluginMutation.atomicGroupId, groupId);
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
  const releaseGate = {
    status: 'NO-GO',
    evidenceScope: 'local/support-only',
    productionBacked: false,
    note: 'RPP-0450 plugin update dependency validator evidence is local/support-only (productionBacked=false); checked production-backed release gate evidence is still required.',
  };
  const evidence = {
    rpp: 'RPP-0450',
    evidenceSource: 'generated-plugin-update-dependency-validator-v3',
    status: 'support_only',
    verdict: 'PLUGIN_UPDATE_DEPENDENCY_LOCAL_SUPPORT_ONLY',
    productionBacked: false,
    releaseEligible: false,
    releaseGate,
    rawValuesIncluded: false,
    dependencyRequirement: {
      groupId,
      plugin: requirement.plugin,
      resourceKey: requirement.resourceKey,
      source: requirement.source,
      expectedVersion: requirement.expectedVersion,
      versionRange: requirement.versionRange,
      active: requirement.active,
      expectedHash: prefixedResourceHash(requirement.expectedHash),
      baseHash: prefixedResourceHash(requirement.baseHash),
      remoteHash: prefixedResourceHash(requirement.remoteHash),
      requirementHash: sha256Evidence(requirement),
      exact: true,
    },
    acceptedApply: {
      groupHash: sha256Evidence(group),
      updateMutationHash: sha256Evidence({
        resourceKey: pluginMutation.resourceKey,
        action: pluginMutation.action,
        baseHash: pluginMutation.baseHash,
        remoteBeforeHash: pluginMutation.remoteBeforeHash,
        localHash: pluginMutation.localHash,
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
      mutationOrderHash: sha256Evidence(mutationOrder),
    },
    redaction: {
      format: 'hash-only',
      rawValuesIncluded: false,
      checkedFixtureCount: Object.values(rawFixtures).length,
    },
  };
  evidence.proofHash = sha256Evidence({
    dependencyRequirement: evidence.dependencyRequirement,
    acceptedApply: evidence.acceptedApply,
    releaseGate: evidence.releaseGate,
    redaction: evidence.redaction,
  });

  assert.deepEqual(mutationOrder, plan.mutations.map((mutation) => mutation.resourceKey));
  assert.equal(result.appliedMutations, 2);
  assert.equal(result.recoveryState.status, 'fully-updated-remote');
  assert.equal(liveRemote.plugins[dependentPlugin].version, '1.1.0');
  assert.equal(liveRemote.plugins[dependentPlugin].releaseNote, rawFixtures.localDependentRelease);
  assert.deepEqual(liveRemote.plugins[dependencyPlugin], remote.plugins[dependencyPlugin]);
  assert.equal(liveRemote.db[dataTable][dataRowId].option_value.mode, rawFixtures.localRowMode);
  assert.deepEqual(result.site, liveRemote);
  assert.equal(result.journal.entries.length, 2);
  assert.equal(evidence.releaseGate.status, 'NO-GO');
  assert.equal(evidence.releaseGate.evidenceScope, 'local/support-only');
  assert.equal(evidence.releaseGate.productionBacked, false);
  assert.match(evidence.releaseGate.note, /local\/support-only/);
  assert.match(evidence.releaseGate.note, /productionBacked=false/);
  assert.match(evidence.releaseGate.note, /production-backed release gate evidence is still required/);

  for (const hash of [
    evidence.dependencyRequirement.expectedHash,
    evidence.dependencyRequirement.baseHash,
    evidence.dependencyRequirement.remoteHash,
    evidence.dependencyRequirement.requirementHash,
    evidence.acceptedApply.groupHash,
    evidence.acceptedApply.updateMutationHash,
    evidence.acceptedApply.dataMutationHash,
    evidence.acceptedApply.journalHash,
    evidence.acceptedApply.remoteAfterHash,
    evidence.acceptedApply.dependencyHashAfter,
    evidence.acceptedApply.dependentHashAfter,
    evidence.acceptedApply.dataRowHashAfter,
    evidence.acceptedApply.mutationOrderHash,
    evidence.proofHash,
  ]) {
    assertSha256Evidence(hash, 'RPP-0450 accepted evidence hash');
  }
  assertNoRawFixtureValues(group.dependencyRequirements, 'atomic group dependency metadata');
  assertNoRawFixtureValues(result.journal, 'apply journal');
  assertNoRawFixtureValues(evidence, 'accepted plugin update dependency proof');
});

test('RPP-0450 missing or stale live dependency evidence refuses before mutation', () => {
  const {
    base,
    local,
    remote,
    dependencyRemoteHash,
  } = readyUpdateFixture();
  const plan = planFor(base, local, remote);
  const dataMutation = mutationFor(plan, dataResourceKey);
  const requirement = plan.atomicGroups[0].dependencyRequirements[0];
  assertDependencyRequirementIsExactHashOnly(requirement, dependencyRemoteHash);

  const missingRemote = cloneJson(remote);
  missingRemote.db[dataTable][dataRowId].option_value.mode = rawFixtures.missingRowMode;
  delete missingRemote.plugins[dependencyPlugin];
  const missingRefusal = applyRefusal(missingRemote, plan);

  assert.ok(missingRefusal.error instanceof PushPlanError);
  assert.equal(missingRefusal.error.code, 'ATOMIC_GROUP_DEPENDENCY_MISSING');
  assert.equal(missingRefusal.error.details.plugin, dependencyPlugin);
  assert.equal(missingRefusal.error.details.source, 'live-remote');
  assert.equal(missingRefusal.beforeMutationCalls, 0);
  assert.deepEqual(missingRemote, missingRefusal.before);

  const staleRemote = cloneJson(remote);
  staleRemote.plugins[dependencyPlugin] = {
    version: '2.2.0',
    active: true,
    build: rawFixtures.driftDependencyBuild,
  };
  staleRemote.db[dataTable][dataRowId].option_value.mode = rawFixtures.staleRowMode;
  const staleDependencyHashBefore = resourceHash(staleRemote, pluginResource(dependencyPlugin));
  const staleDependentHashBefore = resourceHash(staleRemote, pluginResource(dependentPlugin));
  const staleDataHashBefore = resourceHash(staleRemote, dataMutation.resource);
  const staleRefusal = applyRefusal(staleRemote, plan);

  const refusalEvidence = {
    rpp: 'RPP-0450',
    evidenceSource: 'generated-plugin-update-dependency-validator-v3-refusal',
    status: 'support_only',
    verdict: 'PLUGIN_UPDATE_DEPENDENCY_REMOTE_DRIFT_PRESERVED',
    productionBacked: false,
    releaseGate: {
      status: 'NO-GO',
      evidenceScope: 'local/support-only',
      productionBacked: false,
      note: 'RPP-0450 refusal evidence is local/support-only (productionBacked=false); checked production-backed release gate evidence is still required.',
    },
    rawValuesIncluded: false,
    missingDependency: {
      code: missingRefusal.error.code,
      detailsHash: sha256Evidence(missingRefusal.error.details),
      remoteHashBefore: missingRefusal.remoteHashBefore,
      remoteHashAfter: missingRefusal.remoteHashAfter,
      dataRowHashBefore: prefixedResourceHash(resourceHash(missingRefusal.before, dataMutation.resource)),
      dataRowHashAfter: prefixedResourceHash(resourceHash(missingRemote, dataMutation.resource)),
      hookCalls: missingRefusal.beforeMutationCalls,
    },
    staleDependency: {
      code: staleRefusal.error.code,
      detailsHash: sha256Evidence(staleRefusal.error.details),
      expectedHash: prefixedResourceHash(staleRefusal.error.details.expectedHash),
      actualHash: prefixedResourceHash(staleRefusal.error.details.actualHash),
      dependencyHashBefore: prefixedResourceHash(staleDependencyHashBefore),
      dependencyHashAfter: prefixedResourceHash(resourceHash(staleRemote, pluginResource(dependencyPlugin))),
      dependentHashBefore: prefixedResourceHash(staleDependentHashBefore),
      dependentHashAfter: prefixedResourceHash(resourceHash(staleRemote, pluginResource(dependentPlugin))),
      dataRowHashBefore: prefixedResourceHash(staleDataHashBefore),
      dataRowHashAfter: prefixedResourceHash(resourceHash(staleRemote, dataMutation.resource)),
      remoteHashBefore: staleRefusal.remoteHashBefore,
      remoteHashAfter: staleRefusal.remoteHashAfter,
      hookCalls: staleRefusal.beforeMutationCalls,
    },
  };
  refusalEvidence.proofHash = sha256Evidence({
    missingDependency: refusalEvidence.missingDependency,
    staleDependency: refusalEvidence.staleDependency,
    releaseGate: refusalEvidence.releaseGate,
  });

  assert.ok(staleRefusal.error instanceof PushPlanError);
  assert.equal(staleRefusal.error.code, 'ATOMIC_GROUP_DEPENDENCY_STALE');
  assert.equal(staleRefusal.error.details.plugin, dependencyPlugin);
  assert.equal(staleRefusal.error.details.expectedHash, dependencyRemoteHash);
  assert.equal(staleRefusal.error.details.actualHash, staleDependencyHashBefore);
  assert.equal(staleRefusal.beforeMutationCalls, 0);
  assert.deepEqual(staleRemote, staleRefusal.before);
  assert.equal(refusalEvidence.missingDependency.dataRowHashAfter, refusalEvidence.missingDependency.dataRowHashBefore);
  assert.equal(refusalEvidence.missingDependency.remoteHashAfter, refusalEvidence.missingDependency.remoteHashBefore);
  assert.equal(refusalEvidence.staleDependency.dependencyHashAfter, refusalEvidence.staleDependency.dependencyHashBefore);
  assert.equal(refusalEvidence.staleDependency.dependentHashAfter, refusalEvidence.staleDependency.dependentHashBefore);
  assert.equal(refusalEvidence.staleDependency.dataRowHashAfter, refusalEvidence.staleDependency.dataRowHashBefore);
  assert.equal(refusalEvidence.staleDependency.remoteHashAfter, refusalEvidence.staleDependency.remoteHashBefore);
  assert.equal(refusalEvidence.releaseGate.status, 'NO-GO');
  assert.match(refusalEvidence.releaseGate.note, /local\/support-only/);
  assert.match(refusalEvidence.releaseGate.note, /productionBacked=false/);

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
    assertSha256Evidence(hash, 'RPP-0450 refusal evidence hash');
  }
  assertNoRawFixtureValues(missingRefusal.error.details, 'missing dependency refusal details');
  assertNoRawFixtureValues(staleRefusal.error.details, 'stale dependency refusal details');
  assertNoRawFixtureValues(refusalEvidence, 'dependency refusal proof');
});

test('RPP-0450 invalid or forged plugin update dependency evidence fails closed', () => {
  const {
    base,
    local,
    remote,
    dependencyRemoteHash,
  } = readyUpdateFixture();
  const readyPlan = planFor(base, local, remote);

  const invalidLocal = withUpdateIntent(cloneJson(local), {
    dependencyHash: dependencyRemoteHash,
    expectedVersion: '9.9.9',
  });
  invalidLocal.db[dataTable][dataRowId].option_value.mode = rawFixtures.invalidRowMode;
  const invalidPlan = planFor(base, invalidLocal, cloneJson(remote));
  const versionBlocker = invalidPlan.blockers.find((blocker) =>
    blocker.class === 'incompatible-plugin-dependency-version');
  const invalidRemote = cloneJson(remote);
  invalidRemote.db[dataTable][dataRowId].option_value.mode = rawFixtures.forgedRowMode;
  const invalidRefusal = applyRefusal(invalidRemote, invalidPlan);

  assert.equal(invalidPlan.status, 'blocked');
  assert.ok(versionBlocker, 'invalid version metadata should emit a blocker');
  assert.equal(versionBlocker.plugin, dependencyPlugin);
  assert.equal(versionBlocker.expectedVersion, '9.9.9');
  assert.equal(versionBlocker.actualVersion, '2.1.0');
  assert.equal(versionBlocker.source, 'live-remote');
  assert.equal(versionBlocker.dependency.expectedHash, dependencyRemoteHash);
  assert.ok(invalidRefusal.error instanceof PushPlanError);
  assert.equal(invalidRefusal.error.code, 'PLAN_NOT_READY');
  assert.equal(invalidRefusal.beforeMutationCalls, 0);
  assert.deepEqual(invalidRemote, invalidRefusal.before);
  assertNoRawFixtureValues(versionBlocker, 'invalid version dependency blocker');

  const missingEvidencePlan = tamperReadyPlan(readyPlan, (copy) => {
    delete copy.atomicGroups[0].dependencyRequirements[0].expectedHash;
    delete copy.atomicGroups[0].dependencyRequirements[0].remoteHash;
    delete copy.atomicGroups[0].dependencyRequirements[0].hash;
  });
  const missingEvidenceRemote = cloneJson(remote);
  missingEvidenceRemote.db[dataTable][dataRowId].option_value.mode = rawFixtures.forgedRowMode;
  const missingEvidenceRefusal = applyRefusal(missingEvidenceRemote, missingEvidencePlan);

  const forgedVersionPlan = tamperReadyPlan(readyPlan, (copy) => {
    copy.atomicGroups[0].dependencyRequirements[0].expectedVersion = '9.9.9';
  });
  const forgedVersionRemote = cloneJson(remote);
  const forgedVersionRefusal = applyRefusal(forgedVersionRemote, forgedVersionPlan);

  const forgedRangePlan = tamperReadyPlan(readyPlan, (copy) => {
    copy.atomicGroups[0].dependencyRequirements[0].versionRange = '^2.1.0';
  });
  const forgedRangeRemote = cloneJson(remote);
  const forgedRangeRefusal = applyRefusal(forgedRangeRemote, forgedRangePlan);

  const forgedEvidence = {
    rpp: 'RPP-0450',
    evidenceSource: 'generated-plugin-update-dependency-validator-v3-forged-refusal',
    status: 'support_only',
    verdict: 'PLUGIN_UPDATE_DEPENDENCY_FORGED_EVIDENCE_REFUSED',
    productionBacked: false,
    releaseGate: {
      status: 'NO-GO',
      evidenceScope: 'local/support-only',
      productionBacked: false,
      note: 'RPP-0450 forged dependency evidence proof is local/support-only (productionBacked=false); checked production-backed release gate evidence is still required.',
    },
    rawValuesIncluded: false,
    invalidPlannerEvidence: {
      code: invalidRefusal.error.code,
      blockerHash: sha256Evidence(versionBlocker),
      remoteHashBefore: invalidRefusal.remoteHashBefore,
      remoteHashAfter: invalidRefusal.remoteHashAfter,
      hookCalls: invalidRefusal.beforeMutationCalls,
    },
    missingHashEvidence: {
      code: missingEvidenceRefusal.error.code,
      detailsHash: sha256Evidence(missingEvidenceRefusal.error.details),
      remoteHashBefore: missingEvidenceRefusal.remoteHashBefore,
      remoteHashAfter: missingEvidenceRefusal.remoteHashAfter,
      dataRowHashBefore: prefixedResourceHash(resourceHash(missingEvidenceRefusal.before, dataResource())),
      dataRowHashAfter: prefixedResourceHash(resourceHash(missingEvidenceRemote, dataResource())),
      hookCalls: missingEvidenceRefusal.beforeMutationCalls,
    },
    forgedVersionEvidence: {
      code: forgedVersionRefusal.error.code,
      detailsHash: sha256Evidence(forgedVersionRefusal.error.details),
      remoteHashBefore: forgedVersionRefusal.remoteHashBefore,
      remoteHashAfter: forgedVersionRefusal.remoteHashAfter,
      hookCalls: forgedVersionRefusal.beforeMutationCalls,
    },
    forgedRangeEvidence: {
      code: forgedRangeRefusal.error.code,
      detailsHash: sha256Evidence(forgedRangeRefusal.error.details),
      remoteHashBefore: forgedRangeRefusal.remoteHashBefore,
      remoteHashAfter: forgedRangeRefusal.remoteHashAfter,
      hookCalls: forgedRangeRefusal.beforeMutationCalls,
    },
  };
  forgedEvidence.proofHash = sha256Evidence({
    invalidPlannerEvidence: forgedEvidence.invalidPlannerEvidence,
    missingHashEvidence: forgedEvidence.missingHashEvidence,
    forgedVersionEvidence: forgedEvidence.forgedVersionEvidence,
    forgedRangeEvidence: forgedEvidence.forgedRangeEvidence,
    releaseGate: forgedEvidence.releaseGate,
  });

  assert.ok(missingEvidenceRefusal.error instanceof PushPlanError);
  assert.equal(missingEvidenceRefusal.error.code, 'ATOMIC_GROUP_DEPENDENCY_EVIDENCE_MISSING');
  assert.equal(missingEvidenceRefusal.error.details.plugin, dependencyPlugin);
  assert.equal(missingEvidenceRefusal.beforeMutationCalls, 0);
  assert.deepEqual(missingEvidenceRemote, missingEvidenceRefusal.before);

  assert.ok(forgedVersionRefusal.error instanceof PushPlanError);
  assert.equal(forgedVersionRefusal.error.code, 'ATOMIC_GROUP_DEPENDENCY_VERSION_MISMATCH');
  assert.equal(forgedVersionRefusal.error.details.plugin, dependencyPlugin);
  assert.equal(forgedVersionRefusal.error.details.expectedVersion, '9.9.9');
  assert.equal(forgedVersionRefusal.error.details.actualVersion, '2.1.0');
  assert.equal(forgedVersionRefusal.beforeMutationCalls, 0);
  assert.deepEqual(forgedVersionRemote, forgedVersionRefusal.before);

  assert.ok(forgedRangeRefusal.error instanceof PushPlanError);
  assert.equal(forgedRangeRefusal.error.code, 'ATOMIC_GROUP_DEPENDENCY_VERSION_RANGE_UNSUPPORTED');
  assert.equal(forgedRangeRefusal.error.details.plugin, dependencyPlugin);
  assert.equal(forgedRangeRefusal.error.details.versionRange, '^2.1.0');
  assert.equal(forgedRangeRefusal.beforeMutationCalls, 0);
  assert.deepEqual(forgedRangeRemote, forgedRangeRefusal.before);

  assert.equal(forgedEvidence.invalidPlannerEvidence.remoteHashAfter, forgedEvidence.invalidPlannerEvidence.remoteHashBefore);
  assert.equal(forgedEvidence.missingHashEvidence.remoteHashAfter, forgedEvidence.missingHashEvidence.remoteHashBefore);
  assert.equal(forgedEvidence.missingHashEvidence.dataRowHashAfter, forgedEvidence.missingHashEvidence.dataRowHashBefore);
  assert.equal(forgedEvidence.forgedVersionEvidence.remoteHashAfter, forgedEvidence.forgedVersionEvidence.remoteHashBefore);
  assert.equal(forgedEvidence.forgedRangeEvidence.remoteHashAfter, forgedEvidence.forgedRangeEvidence.remoteHashBefore);
  assert.equal(forgedEvidence.releaseGate.status, 'NO-GO');
  assert.match(forgedEvidence.releaseGate.note, /local\/support-only/);
  assert.match(forgedEvidence.releaseGate.note, /productionBacked=false/);

  for (const hash of [
    forgedEvidence.invalidPlannerEvidence.blockerHash,
    forgedEvidence.invalidPlannerEvidence.remoteHashBefore,
    forgedEvidence.invalidPlannerEvidence.remoteHashAfter,
    forgedEvidence.missingHashEvidence.detailsHash,
    forgedEvidence.missingHashEvidence.remoteHashBefore,
    forgedEvidence.missingHashEvidence.remoteHashAfter,
    forgedEvidence.missingHashEvidence.dataRowHashBefore,
    forgedEvidence.missingHashEvidence.dataRowHashAfter,
    forgedEvidence.forgedVersionEvidence.detailsHash,
    forgedEvidence.forgedVersionEvidence.remoteHashBefore,
    forgedEvidence.forgedVersionEvidence.remoteHashAfter,
    forgedEvidence.forgedRangeEvidence.detailsHash,
    forgedEvidence.forgedRangeEvidence.remoteHashBefore,
    forgedEvidence.forgedRangeEvidence.remoteHashAfter,
    forgedEvidence.proofHash,
  ]) {
    assertSha256Evidence(hash, 'RPP-0450 forged evidence hash');
  }
  assertNoRawFixtureValues(missingEvidenceRefusal.error.details, 'missing hash evidence refusal details');
  assertNoRawFixtureValues(forgedVersionRefusal.error.details, 'forged version refusal details');
  assertNoRawFixtureValues(forgedRangeRefusal.error.details, 'forged range refusal details');
  assertNoRawFixtureValues(forgedEvidence, 'forged plugin update dependency proof');
});
