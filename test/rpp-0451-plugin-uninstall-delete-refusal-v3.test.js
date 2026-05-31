import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

const ownerPlugin = 'rpp-0451-forms-owner';
const pluginResourceKey = `plugin:${ownerPlugin}`;
const pluginFilePath = `wp-content/plugins/${ownerPlugin}/${ownerPlugin}.php`;
const pluginFileResourceKey = `file:${pluginFilePath}`;
const optionRowId = 'option_name:rpp_0451_forms_settings';
const optionResourceKey = `row:["wp_options","${optionRowId}"]`;

const rawFixtures = {
  basePluginVersion: 'rpp-0451-base-plugin-version-private',
  stalePluginVersion: 'rpp-0451-stale-plugin-version-private',
  basePackageFile: 'rpp-0451-base-package-file-private',
  stalePackageFile: 'rpp-0451-stale-package-file-private',
  baseOptionMode: 'rpp-0451-base-option-mode-private',
  remoteOptionMode: 'rpp-0451-remote-option-mode-private',
  localOptionMode: 'rpp-0451-local-option-mode-private',
  forgedOptionMode: 'rpp-0451-forged-option-mode-private',
};

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
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
        [optionRowId]: {
          option_name: 'rpp_0451_forms_settings',
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

function decoyPostmetaDeleteSupport() {
  return {
    resourceKey: optionResourceKey,
    pluginOwner: ownerPlugin,
    driver: 'wp-postmeta',
    table: 'wp_postmeta',
    supportsDelete: true,
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
    blockers: 0,
    conflicts: 0,
    mutations: copy.mutations.length,
    decisions: copy.decisions.length,
  };
  return copy;
}

function rowDeleteFixture(policyEntry = allowedOptionResource({ supportsDelete: true })) {
  const base = baseSite();
  const local = cloneJson(base);
  delete local.db.wp_options[optionRowId];
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      decoyPostmetaDeleteSupport(),
      policyEntry,
    ),
  };
  return {
    base,
    local,
    remote: cloneJson(base),
  };
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

test('RPP-0451 generated plugin uninstall/delete refusal is hash-only and blocks before mutation', () => {
  const base = baseSite();
  const local = cloneJson(base);
  delete local.plugins[ownerPlugin];
  delete local.files[pluginFilePath];
  delete local.db.wp_options[optionRowId];
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      decoyPostmetaDeleteSupport(),
      allowedOptionResource(),
    ),
  };
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const pluginBlocker = blockerFor(plan, pluginResourceKey);
  const fileBlocker = blockerFor(plan, pluginFileResourceKey);
  const rowBlocker = blockerFor(plan, optionResourceKey);
  const remoteWithPrivateData = cloneJson(remote);
  remoteWithPrivateData.db.wp_options[optionRowId].option_value.mode = rawFixtures.remoteOptionMode;
  const refusal = applyRefusal(remoteWithPrivateData, plan);

  const evidence = {
    rpp: 'RPP-0451',
    evidenceSource: 'generated-plugin-uninstall-delete-refusal-v3',
    status: 'support_only',
    evidenceScope: 'local/support-only',
    productionBacked: false,
    releaseGate: {
      status: 'NO-GO',
      evidenceScope: 'local/support-only',
      productionBacked: false,
      note: 'RPP-0451 uninstall/delete refusal evidence is local/support-only (productionBacked=false); checked production-backed release gate evidence is still required.',
    },
    rawValuesIncluded: false,
    explicitPluginDeleteDriverPresent: false,
    planRefusal: {
      status: plan.status,
      summary: plan.summary,
      noMutationsEmitted: plan.mutations.length === 0,
      pluginDeleteBlockerHash: sha256Evidence(pluginBlocker),
      packageFileDeleteBlockerHash: sha256Evidence(fileBlocker),
      rowDeleteBlockerHash: sha256Evidence(rowBlocker),
      blockerResourceKeys: plan.blockers.map((blocker) => blocker.resourceKey).sort(),
      reasonCodes: [...new Set(plan.blockers
        .map((blocker) => blocker.deleteRefusalEvidence?.reasonCode)
        .filter(Boolean))].sort(),
    },
    blockedApply: {
      code: refusal.error.code,
      detailsHash: sha256Evidence(refusal.error.details),
      refusedBeforeMutation: refusal.beforeMutationCalls === 0,
      remotePreserved: refusal.remoteHashAfter === refusal.remoteHashBefore,
      remoteHashBefore: refusal.remoteHashBefore,
      remoteHashAfter: refusal.remoteHashAfter,
      rowHashBefore: sha256Evidence(refusal.before.db.wp_options[optionRowId]),
      rowHashAfter: sha256Evidence(remoteWithPrivateData.db.wp_options[optionRowId]),
    },
    hashes: {
      basePluginHash: `sha256:${resourceHash(base, pluginResource())}`,
      localPluginAbsentHash: `sha256:${resourceHash(local, pluginResource())}`,
      basePackageFileHash: `sha256:${resourceHash(base, pluginFileResource())}`,
      localPackageFileAbsentHash: `sha256:${resourceHash(local, pluginFileResource())}`,
      baseOptionHash: `sha256:${resourceHash(base, optionResource())}`,
      localOptionAbsentHash: `sha256:${resourceHash(local, optionResource())}`,
    },
  };
  evidence.proofHash = sha256Evidence({
    planRefusal: evidence.planRefusal,
    blockedApply: evidence.blockedApply,
    hashes: evidence.hashes,
    releaseGate: evidence.releaseGate,
  });

  assert.equal(plan.status, 'blocked');
  assert.deepEqual(plan.summary, {
    mutations: 0,
    decisions: 0,
    conflicts: 0,
    blockers: 3,
    atomicGroups: 0,
  });
  assert.equal(mutationFor(plan, pluginResourceKey), undefined);
  assert.equal(mutationFor(plan, pluginFileResourceKey), undefined);
  assert.equal(mutationFor(plan, optionResourceKey), undefined);

  assert.equal(pluginBlocker.class, 'plugin-uninstall-delete-refusal');
  assert.equal(pluginBlocker.deleteRefusalEvidence.reasonCode, 'PLUGIN_UNINSTALL_DELETE_REFUSED');
  assert.equal(pluginBlocker.deleteRefusalEvidence.resourceType, 'plugin');
  assert.equal(pluginBlocker.deleteRefusalEvidence.pluginOwner, ownerPlugin);
  assert.equal(pluginBlocker.deleteRefusalEvidence.supportsDelete, false);
  assert.equal(pluginBlocker.change.localChange, 'delete');

  assert.equal(fileBlocker.class, 'plugin-uninstall-delete-refusal');
  assert.equal(fileBlocker.deleteRefusalEvidence.reasonCode, 'PLUGIN_UNINSTALL_DELETE_REFUSED');
  assert.equal(fileBlocker.deleteRefusalEvidence.resourceType, 'file');
  assert.equal(fileBlocker.deleteRefusalEvidence.pluginOwner, ownerPlugin);
  assert.equal(fileBlocker.deleteRefusalEvidence.supportsDelete, false);
  assert.equal(fileBlocker.change.localChange, 'delete');

  assert.equal(rowBlocker.class, 'unsupported-plugin-owned-resource');
  assert.equal(rowBlocker.reason, 'Plugin-owned resource driver does not support delete mutations.');
  assert.equal(rowBlocker.driver, 'wp-option');
  assert.equal(rowBlocker.policySource, 'local-snapshot');
  assert.equal(rowBlocker.supportsDelete, false);
  assert.equal(rowBlocker.deleteSupportRefusalEvidence.reasonCode, 'PLUGIN_DRIVER_DELETE_UNSUPPORTED');
  assert.equal(rowBlocker.deleteSupportRefusalEvidence.supportsDelete, false);
  assert.equal(rowBlocker.deleteRefusalEvidence.reasonCode, 'PLUGIN_OWNED_RESOURCE_DELETE_UNSUPPORTED');
  assert.equal(rowBlocker.deleteRefusalEvidence.supportsDelete, false);
  assert.equal(JSON.stringify(rowBlocker).includes('wp-postmeta'), false);

  assert.ok(refusal.error instanceof PushPlanError);
  assert.equal(refusal.error.code, 'PLAN_NOT_READY');
  assert.equal(refusal.beforeMutationCalls, 0);
  assert.deepEqual(remoteWithPrivateData, refusal.before);
  assert.equal(
    remoteWithPrivateData.db.wp_options[optionRowId].option_value.mode,
    rawFixtures.remoteOptionMode,
  );
  assert.equal(evidence.releaseGate.status, 'NO-GO');
  assert.equal(evidence.releaseGate.evidenceScope, 'local/support-only');
  assert.equal(evidence.releaseGate.productionBacked, false);
  assert.match(evidence.releaseGate.note, /local\/support-only/);

  for (const hash of [
    evidence.planRefusal.pluginDeleteBlockerHash,
    evidence.planRefusal.packageFileDeleteBlockerHash,
    evidence.planRefusal.rowDeleteBlockerHash,
    evidence.blockedApply.detailsHash,
    evidence.blockedApply.remoteHashBefore,
    evidence.blockedApply.remoteHashAfter,
    evidence.blockedApply.rowHashBefore,
    evidence.blockedApply.rowHashAfter,
    evidence.hashes.basePluginHash,
    evidence.hashes.localPluginAbsentHash,
    evidence.hashes.basePackageFileHash,
    evidence.hashes.localPackageFileAbsentHash,
    evidence.hashes.baseOptionHash,
    evidence.hashes.localOptionAbsentHash,
    evidence.proofHash,
  ]) {
    assertSha256Evidence(hash, 'RPP-0451 refusal evidence hash');
  }
  assertNoRawFixtureValues(pluginBlocker, 'plugin delete blocker');
  assertNoRawFixtureValues(fileBlocker, 'package file delete blocker');
  assertNoRawFixtureValues(rowBlocker, 'plugin-owned row delete blocker');
  assertNoRawFixtureValues(refusal.error.details, 'blocked apply details');
  assertNoRawFixtureValues(evidence, 'generated plugin uninstall/delete refusal proof');
});

test('RPP-0451 explicit checked row delete support applies only the exact wp-option driver', () => {
  const { base, local, remote } = rowDeleteFixture();
  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, optionResourceKey);
  const liveRemote = cloneJson(remote);
  const beforePluginHash = resourceHash(liveRemote, pluginResource());
  const beforePackageHash = resourceHash(liveRemote, pluginFileResource());
  const mutationOrder = [];
  const result = applyPlan(liveRemote, plan, {
    mutateRemote: true,
    beforeMutation({ mutation: appliedMutation }) {
      mutationOrder.push(appliedMutation.resourceKey);
    },
  });

  const evidence = {
    rpp: 'RPP-0451',
    evidenceSource: 'generated-plugin-uninstall-delete-refusal-v3-explicit-delete-support',
    status: 'support_only',
    evidenceScope: 'local/support-only',
    productionBacked: false,
    rawValuesIncluded: false,
    releaseGate: {
      status: 'NO-GO',
      evidenceScope: 'local/support-only',
      productionBacked: false,
      note: 'RPP-0451 explicit row delete support evidence is local/support-only; plugin uninstall/delete still has no explicit supported driver.',
    },
    acceptedDelete: {
      mutationHash: sha256Evidence({
        resourceKey: mutation.resourceKey,
        action: mutation.action,
        driver: mutation.pluginOwnedResource.driver,
        supportsDelete: mutation.pluginOwnedResource.supportsDelete,
        baseHash: mutation.baseHash,
        remoteBeforeHash: mutation.remoteBeforeHash,
        localHash: mutation.localHash,
      }),
      ownerContextHash: sha256Evidence(mutation.pluginOwnedResource.ownerContext),
      driverAuditHash: sha256Evidence(mutation.pluginOwnedResource.driverAuditEvidence),
      journalHash: sha256Evidence(result.journal),
      remoteAfterHash: sha256Evidence(result.site),
      pluginHashBefore: `sha256:${beforePluginHash}`,
      pluginHashAfter: `sha256:${resourceHash(result.site, pluginResource())}`,
      packageFileHashBefore: `sha256:${beforePackageHash}`,
      packageFileHashAfter: `sha256:${resourceHash(result.site, pluginFileResource())}`,
      optionHashAfter: `sha256:${resourceHash(result.site, optionResource())}`,
      mutationOrderHash: sha256Evidence(mutationOrder),
    },
  };
  evidence.proofHash = sha256Evidence({
    acceptedDelete: evidence.acceptedDelete,
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
  assert.equal(mutation.action, 'delete');
  assert.equal(mutation.resource.table, 'wp_options');
  assert.equal(mutation.pluginOwnedResource.pluginOwner, ownerPlugin);
  assert.equal(mutation.pluginOwnedResource.driver, 'wp-option');
  assert.equal(mutation.pluginOwnedResource.policySource, 'local-snapshot');
  assert.equal(mutation.pluginOwnedResource.supportsDelete, true);
  assert.equal(mutation.pluginOwnedResource.ownerContextRequired, true);
  assert.equal(mutation.pluginOwnedResource.ownerContext.length, 2);
  assert.deepEqual(
    mutation.pluginOwnedResource.ownerContext.map((context) => context.resourceKey).sort(),
    [pluginFileResourceKey, pluginResourceKey],
  );
  assert.equal(mutation.pluginOwnedResource.auditEvidence.supportsDelete, true);
  assert.equal(mutation.pluginOwnedResource.auditEvidence.format, 'hash-only');
  assert.equal(mutation.pluginOwnedResource.driverAuditEvidence.reasonCode, 'PLUGIN_DRIVER_DECISION_SUPPORTED');
  assert.equal(mutation.pluginOwnedResource.driverAuditEvidence.action, 'delete');
  assert.equal(mutation.pluginOwnedResource.driverAuditEvidence.driver, 'wp-option');
  assert.equal(mutation.pluginOwnedResource.driverAuditEvidence.rawValuesIncluded, false);

  assert.deepEqual(mutationOrder, [optionResourceKey]);
  assert.equal(result.appliedMutations, 1);
  assert.equal(Object.hasOwn(result.site.db.wp_options, optionRowId), false);
  assert.equal(resourceHash(result.site, pluginResource()), beforePluginHash);
  assert.equal(resourceHash(result.site, pluginFileResource()), beforePackageHash);
  assert.equal(liveRemote.plugins[ownerPlugin].active, true);
  assert.equal(Object.hasOwn(liveRemote.db.wp_options, optionRowId), false);
  assert.equal(evidence.releaseGate.status, 'NO-GO');
  assert.equal(evidence.releaseGate.evidenceScope, 'local/support-only');

  for (const hash of [
    evidence.acceptedDelete.mutationHash,
    evidence.acceptedDelete.ownerContextHash,
    evidence.acceptedDelete.driverAuditHash,
    evidence.acceptedDelete.journalHash,
    evidence.acceptedDelete.remoteAfterHash,
    evidence.acceptedDelete.pluginHashBefore,
    evidence.acceptedDelete.pluginHashAfter,
    evidence.acceptedDelete.packageFileHashBefore,
    evidence.acceptedDelete.packageFileHashAfter,
    evidence.acceptedDelete.optionHashAfter,
    evidence.acceptedDelete.mutationOrderHash,
    evidence.proofHash,
  ]) {
    assertSha256Evidence(hash, 'RPP-0451 explicit support evidence hash');
  }
  assertNoRawFixtureValues(mutation.pluginOwnedResource, 'supported delete plugin-owned metadata');
  assertNoRawFixtureValues(result.journal, 'supported delete apply journal');
  assertNoRawFixtureValues(evidence, 'explicit checked row delete support proof');
});

test('RPP-0451 stale and forged delete evidence fails closed before mutation', () => {
  const { base, local, remote } = rowDeleteFixture();
  const readyPlan = planFor(base, local, remote);
  const readyMutation = mutationFor(readyPlan, optionResourceKey);
  assert.equal(readyPlan.status, 'ready');
  assert.equal(readyMutation.pluginOwnedResource.supportsDelete, true);

  const staleContextRemote = cloneJson(remote);
  staleContextRemote.plugins[ownerPlugin].version = rawFixtures.stalePluginVersion;
  staleContextRemote.files[pluginFilePath] = `<?php /* ${rawFixtures.stalePackageFile} */`;
  const staleContextRefusal = applyRefusal(staleContextRemote, readyPlan);

  const staleRowRemote = cloneJson(remote);
  staleRowRemote.db.wp_options[optionRowId].option_value.mode = rawFixtures.remoteOptionMode;
  const staleRowRefusal = applyRefusal(staleRowRemote, readyPlan);

  const forgedMissingOwnerContextPlan = tamperReadyPlan(readyPlan, (copy) => {
    const mutation = mutationFor(copy, optionResourceKey);
    mutation.pluginOwnedResource.ownerContext = [];
    mutation.pluginOwnedResource.ownerContextRequired = false;
    mutation.pluginOwnedResource.auditEvidence.ownerContextHash = digest([]);
  });
  const forgedMissingOwnerContextRemote = cloneJson(remote);
  const forgedMissingOwnerContextRefusal = applyRefusal(forgedMissingOwnerContextRemote, forgedMissingOwnerContextPlan);

  const forgedPluginDeleteRemote = cloneJson(remote);
  forgedPluginDeleteRemote.db.wp_options[optionRowId].option_value.mode = rawFixtures.forgedOptionMode;
  const forgedPluginDeletePlan = {
    schemaVersion: 1,
    id: 'rpp-0451-forged-plugin-delete-plan',
    generatedAt: fixedNow.toISOString(),
    status: 'ready',
    summary: { mutations: 1, decisions: 0, conflicts: 0, blockers: 0, atomicGroups: 0 },
    mutations: [
      {
        id: 'mutation-rpp-0451-forged-plugin-delete',
        resource: pluginResource(),
        resourceKey: pluginResourceKey,
        action: 'delete',
        value: { absent: true },
        remoteBeforeHash: resourceHash(remote, pluginResource()),
        baseHash: resourceHash(base, pluginResource()),
        localHash: resourceHash(local, pluginResource()),
        pluginOwnedResource: {
          pluginOwner: ownerPlugin,
          driver: 'wp-option',
          supportsDelete: true,
          auditEvidence: {
            format: 'hash-only',
            rawValuesIncluded: false,
            ownerContextHash: digest([]),
          },
        },
      },
    ],
    preconditions: [
      {
        mutationId: 'mutation-rpp-0451-forged-plugin-delete',
        resource: pluginResource(),
        resourceKey: pluginResourceKey,
        expectedHash: resourceHash(remote, pluginResource()),
        checkedAgainst: 'live-remote',
      },
    ],
    decisions: [],
    conflicts: [],
    blockers: [],
    atomicGroups: [],
  };
  const forgedPluginDeleteRefusal = applyRefusal(forgedPluginDeleteRemote, forgedPluginDeletePlan);

  const refusalEvidence = {
    rpp: 'RPP-0451',
    evidenceSource: 'generated-plugin-uninstall-delete-refusal-v3-stale-forged-refusal',
    status: 'support_only',
    evidenceScope: 'local/support-only',
    productionBacked: false,
    releaseGate: {
      status: 'NO-GO',
      evidenceScope: 'local/support-only',
      productionBacked: false,
      note: 'RPP-0451 stale/forged refusal evidence is local/support-only (productionBacked=false); checked production-backed release gate evidence is still required.',
    },
    rawValuesIncluded: false,
    staleOwnerContext: {
      code: staleContextRefusal.error.code,
      detailsHash: sha256Evidence(staleContextRefusal.error.details),
      beforeMutationCalls: staleContextRefusal.beforeMutationCalls,
      remoteHashBefore: staleContextRefusal.remoteHashBefore,
      remoteHashAfter: staleContextRefusal.remoteHashAfter,
      rowHashBefore: `sha256:${resourceHash(staleContextRefusal.before, optionResource())}`,
      rowHashAfter: `sha256:${resourceHash(staleContextRemote, optionResource())}`,
    },
    staleRemoteRow: {
      code: staleRowRefusal.error.code,
      detailsHash: sha256Evidence(staleRowRefusal.error.details),
      beforeMutationCalls: staleRowRefusal.beforeMutationCalls,
      remoteHashBefore: staleRowRefusal.remoteHashBefore,
      remoteHashAfter: staleRowRefusal.remoteHashAfter,
      rowHashBefore: `sha256:${resourceHash(staleRowRefusal.before, optionResource())}`,
      rowHashAfter: `sha256:${resourceHash(staleRowRemote, optionResource())}`,
    },
    forgedMissingOwnerContext: {
      code: forgedMissingOwnerContextRefusal.error.code,
      detailsHash: sha256Evidence(forgedMissingOwnerContextRefusal.error.details),
      beforeMutationCalls: forgedMissingOwnerContextRefusal.beforeMutationCalls,
      remoteHashBefore: forgedMissingOwnerContextRefusal.remoteHashBefore,
      remoteHashAfter: forgedMissingOwnerContextRefusal.remoteHashAfter,
      rowHashBefore: `sha256:${resourceHash(forgedMissingOwnerContextRefusal.before, optionResource())}`,
      rowHashAfter: `sha256:${resourceHash(forgedMissingOwnerContextRemote, optionResource())}`,
    },
    forgedPluginDelete: {
      code: forgedPluginDeleteRefusal.error.code,
      reasonCode: forgedPluginDeleteRefusal.error.details.reasonCode,
      detailsHash: sha256Evidence(forgedPluginDeleteRefusal.error.details),
      beforeMutationCalls: forgedPluginDeleteRefusal.beforeMutationCalls,
      remoteHashBefore: forgedPluginDeleteRefusal.remoteHashBefore,
      remoteHashAfter: forgedPluginDeleteRefusal.remoteHashAfter,
      rowHashBefore: `sha256:${resourceHash(forgedPluginDeleteRefusal.before, optionResource())}`,
      rowHashAfter: `sha256:${resourceHash(forgedPluginDeleteRemote, optionResource())}`,
    },
  };
  refusalEvidence.proofHash = sha256Evidence({
    staleOwnerContext: refusalEvidence.staleOwnerContext,
    staleRemoteRow: refusalEvidence.staleRemoteRow,
    forgedMissingOwnerContext: refusalEvidence.forgedMissingOwnerContext,
    forgedPluginDelete: refusalEvidence.forgedPluginDelete,
    releaseGate: refusalEvidence.releaseGate,
  });

  assert.ok(staleContextRefusal.error instanceof PushPlanError);
  assert.equal(staleContextRefusal.error.code, 'STALE_PLUGIN_OWNER_CONTEXT');
  assert.equal(staleContextRefusal.beforeMutationCalls, 0);
  assert.deepEqual(staleContextRemote, staleContextRefusal.before);
  assert.equal(
    refusalEvidence.staleOwnerContext.rowHashAfter,
    refusalEvidence.staleOwnerContext.rowHashBefore,
  );
  assert.equal(
    refusalEvidence.staleOwnerContext.remoteHashAfter,
    refusalEvidence.staleOwnerContext.remoteHashBefore,
  );

  assert.ok(staleRowRefusal.error instanceof PushPlanError);
  assert.equal(staleRowRefusal.error.code, 'PRECONDITION_FAILED');
  assert.equal(staleRowRefusal.beforeMutationCalls, 0);
  assert.deepEqual(staleRowRemote, staleRowRefusal.before);
  assert.equal(refusalEvidence.staleRemoteRow.rowHashAfter, refusalEvidence.staleRemoteRow.rowHashBefore);
  assert.equal(refusalEvidence.staleRemoteRow.remoteHashAfter, refusalEvidence.staleRemoteRow.remoteHashBefore);

  assert.ok(forgedMissingOwnerContextRefusal.error instanceof PushPlanError);
  assert.equal(forgedMissingOwnerContextRefusal.error.code, 'STALE_PLUGIN_OWNER_CONTEXT');
  assert.equal(forgedMissingOwnerContextRefusal.error.details.resourceKey, optionResourceKey);
  assert.equal(forgedMissingOwnerContextRefusal.beforeMutationCalls, 0);
  assert.deepEqual(forgedMissingOwnerContextRemote, forgedMissingOwnerContextRefusal.before);
  assert.equal(
    refusalEvidence.forgedMissingOwnerContext.rowHashAfter,
    refusalEvidence.forgedMissingOwnerContext.rowHashBefore,
  );

  assert.ok(forgedPluginDeleteRefusal.error instanceof PushPlanError);
  assert.equal(forgedPluginDeleteRefusal.error.code, 'PLUGIN_UNINSTALL_DELETE_REFUSED');
  assert.equal(forgedPluginDeleteRefusal.error.details.reasonCode, 'PLUGIN_UNINSTALL_DELETE_REFUSED');
  assert.equal(forgedPluginDeleteRefusal.error.details.supportsDelete, false);
  assert.equal(forgedPluginDeleteRefusal.beforeMutationCalls, 0);
  assert.deepEqual(forgedPluginDeleteRemote, forgedPluginDeleteRefusal.before);
  assert.equal(
    forgedPluginDeleteRemote.db.wp_options[optionRowId].option_value.mode,
    rawFixtures.forgedOptionMode,
  );
  assert.equal(refusalEvidence.forgedPluginDelete.rowHashAfter, refusalEvidence.forgedPluginDelete.rowHashBefore);
  assert.equal(refusalEvidence.forgedPluginDelete.remoteHashAfter, refusalEvidence.forgedPluginDelete.remoteHashBefore);
  assert.equal(refusalEvidence.releaseGate.status, 'NO-GO');
  assert.match(refusalEvidence.releaseGate.note, /local\/support-only/);

  for (const hash of [
    refusalEvidence.staleOwnerContext.detailsHash,
    refusalEvidence.staleOwnerContext.remoteHashBefore,
    refusalEvidence.staleOwnerContext.remoteHashAfter,
    refusalEvidence.staleOwnerContext.rowHashBefore,
    refusalEvidence.staleOwnerContext.rowHashAfter,
    refusalEvidence.staleRemoteRow.detailsHash,
    refusalEvidence.staleRemoteRow.remoteHashBefore,
    refusalEvidence.staleRemoteRow.remoteHashAfter,
    refusalEvidence.staleRemoteRow.rowHashBefore,
    refusalEvidence.staleRemoteRow.rowHashAfter,
    refusalEvidence.forgedMissingOwnerContext.detailsHash,
    refusalEvidence.forgedMissingOwnerContext.remoteHashBefore,
    refusalEvidence.forgedMissingOwnerContext.remoteHashAfter,
    refusalEvidence.forgedMissingOwnerContext.rowHashBefore,
    refusalEvidence.forgedMissingOwnerContext.rowHashAfter,
    refusalEvidence.forgedPluginDelete.detailsHash,
    refusalEvidence.forgedPluginDelete.remoteHashBefore,
    refusalEvidence.forgedPluginDelete.remoteHashAfter,
    refusalEvidence.forgedPluginDelete.rowHashBefore,
    refusalEvidence.forgedPluginDelete.rowHashAfter,
    refusalEvidence.proofHash,
  ]) {
    assertSha256Evidence(hash, 'RPP-0451 stale/forged refusal evidence hash');
  }
  assertNoRawFixtureValues(staleContextRefusal.error.details, 'stale owner context details');
  assertNoRawFixtureValues(staleRowRefusal.error.details, 'stale row precondition details');
  assertNoRawFixtureValues(forgedMissingOwnerContextRefusal.error.details, 'forged missing owner context details');
  assertNoRawFixtureValues(forgedPluginDeleteRefusal.error.details, 'forged plugin delete details');
  assertNoRawFixtureValues(refusalEvidence, 'stale and forged delete refusal proof');
});
