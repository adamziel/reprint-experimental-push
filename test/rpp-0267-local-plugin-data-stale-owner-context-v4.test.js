import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const ownerPlugin = 'rpp-0267-owner-context';
const optionRowId = 'option_name:rpp_0267_plugin_data';
const optionResourceKey = `row:["wp_options","${optionRowId}"]`;
const ownerPluginFilePath = `wp-content/plugins/${ownerPlugin}/${ownerPlugin}.php`;
const ownerPluginFileResourceKey = `file:${ownerPluginFilePath}`;
const ownerPluginResourceKey = `plugin:${ownerPlugin}`;
const sha256Hex = /^[a-f0-9]{64}$/;
const sha256Evidence = /^sha256:[a-f0-9]{64}$/;
const rawSentinels = Object.freeze([
  'RPP_0267_BASE_ROW_SENTINEL',
  'RPP_0267_LOCAL_ROW_SENTINEL',
  'RPP_0267_BASE_OWNER_FILE_SENTINEL',
  'RPP_0267_STALE_OWNER_FILE_SENTINEL',
  'RPP_0267_BASE_PLUGIN_META_SENTINEL',
  'RPP_0267_STALE_PLUGIN_META_SENTINEL',
]);

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

function sha256EvidenceFor(value) {
  return `sha256:${digest(value)}`;
}

function assertHashOnly(value, label) {
  const json = JSON.stringify(value);
  for (const sentinel of rawSentinels) {
    assert.equal(json.includes(sentinel), false, `${label} leaked raw sentinel ${sentinel}`);
  }
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(value, { label }));
}

function pluginOwnedResourcePolicy(...allowedResources) {
  return {
    pluginOwnedResources: {
      evidenceScope: 'local-focused-v4',
      allowedResources,
    },
  };
}

function allowedOptionResource() {
  return {
    resourceKey: optionResourceKey,
    pluginOwner: ownerPlugin,
    driver: 'wp-option',
    table: 'wp_options',
    evidenceScope: 'local-focused-v4',
  };
}

function addLocalPolicy(site) {
  site.meta = {
    evidenceScope: 'local-focused-v4',
    pushPolicy: pluginOwnedResourcePolicy(allowedOptionResource()),
  };
  return site;
}

function focusedSite({
  rowMode = 'RPP_0267_BASE_ROW_SENTINEL',
  ownerFileMode = 'RPP_0267_BASE_OWNER_FILE_SENTINEL',
  pluginMetaMode = 'RPP_0267_BASE_PLUGIN_META_SENTINEL',
  pluginVersion = '1.0.0',
  withPolicy = false,
} = {}) {
  const site = {
    files: {
      [ownerPluginFilePath]: `<?php /* ${ownerPlugin} ${ownerFileMode} */`,
    },
    plugins: {
      [ownerPlugin]: {
        version: pluginVersion,
        active: true,
        releaseLabel: pluginMetaMode,
      },
    },
    db: {
      wp_options: {
        [optionRowId]: {
          option_name: 'rpp_0267_plugin_data',
          option_value: {
            mode: rowMode,
            proof: 'local-plugin-data-stale-owner-context-v4',
          },
          autoload: 'no',
          __pluginOwner: ownerPlugin,
        },
      },
    },
  };
  return withPolicy ? addLocalPolicy(site) : site;
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function readyFixture() {
  const base = focusedSite();
  const local = focusedSite({
    rowMode: 'RPP_0267_LOCAL_ROW_SENTINEL',
    withPolicy: true,
  });
  const remote = focusedSite();
  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan);

  assertReadyPlanShape(plan, mutation);
  return { base, local, remote, plan, mutation };
}

function mutationFor(plan) {
  return plan.mutations.find((mutation) => mutation.resourceKey === optionResourceKey);
}

function contextFor(mutation, resourceKey) {
  const context = mutation.pluginOwnedResource.ownerContext.find((entry) => entry.resourceKey === resourceKey);
  assert.ok(context, `missing owner context ${resourceKey}`);
  return context;
}

function assertReadyPlanShape(plan, mutation) {
  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.summary, {
    mutations: 1,
    decisions: 0,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.equal(plan.preconditions.length, 1);
  assert.ok(mutation, 'focused local plugin data mutation should be planned');
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.resourceKey, optionResourceKey);
  assert.equal(mutation.pluginOwnedResource.pluginOwner, ownerPlugin);
  assert.equal(mutation.pluginOwnedResource.driver, 'wp-option');
  assert.equal(mutation.pluginOwnedResource.policySource, 'local-snapshot');
  assert.equal(mutation.pluginOwnedResource.ownerContextRequired, true);
  assert.deepEqual(
    mutation.pluginOwnedResource.ownerContext.map((context) => context.resourceKey).sort(),
    [ownerPluginFileResourceKey, ownerPluginResourceKey].sort(),
  );
  assert.equal(mutation.pluginOwnedResource.auditEvidence.format, 'hash-only');
  assert.equal(mutation.pluginOwnedResource.auditEvidence.rawValuesIncluded, false);
  assert.equal(mutation.pluginOwnedResource.driverAuditEvidence.rawValuesIncluded, false);

  const precondition = plan.preconditions[0];
  assert.equal(precondition.mutationId, mutation.id);
  assert.equal(precondition.resourceKey, mutation.resourceKey);
  assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
  assert.equal(precondition.checkedAgainst, 'live-remote');

  for (const context of mutation.pluginOwnedResource.ownerContext) {
    assert.equal(context.resource.key, context.resourceKey);
    assert.match(context.baseHash, sha256Hex);
    assert.match(context.localHash, sha256Hex);
    assert.match(context.remoteHash, sha256Hex);
    assert.equal(context.localHash, context.remoteHash);
    assert.equal(context.remoteHash, context.baseHash);
  }
}

function remoteState(remote, mutation) {
  return {
    json: JSON.stringify(remote),
    siteHash: digest(remote),
    rowHash: resourceHash(remote, mutation.resource),
    ownerFileHash: resourceHash(remote, contextFor(mutation, ownerPluginFileResourceKey).resource),
    ownerMetadataHash: resourceHash(remote, contextFor(mutation, ownerPluginResourceKey).resource),
  };
}

function assertRemoteUnchanged(remote, before, mutation, label) {
  assert.equal(JSON.stringify(remote), before.json, `${label} changed the remote JSON snapshot`);
  assert.equal(digest(remote), before.siteHash, `${label} changed the remote site hash`);
  assert.equal(resourceHash(remote, mutation.resource), before.rowHash, `${label} changed the plugin-owned row`);
  assert.equal(
    resourceHash(remote, contextFor(mutation, ownerPluginFileResourceKey).resource),
    before.ownerFileHash,
    `${label} changed the owner plugin file`,
  );
  assert.equal(
    resourceHash(remote, contextFor(mutation, ownerPluginResourceKey).resource),
    before.ownerMetadataHash,
    `${label} changed the owner plugin metadata`,
  );
}

function refusalProof(name, error, beforeMutationCalls = 0) {
  return {
    name,
    code: error.code,
    beforeMutationCalls,
    details: {
      mutationId: error.details.mutationId || null,
      resourceKey: error.details.resourceKey || null,
      pluginOwner: error.details.pluginOwner || null,
      contextResourceKey: error.details.contextResourceKey || null,
      expectedHash: error.details.expectedHash || null,
      actualHash: error.details.actualHash || null,
    },
  };
}

function applyRefusal(remote, plan) {
  let beforeMutationCalls = 0;
  const error = captureError(() => applyPlan(remote, plan, {
    beforeMutation() {
      beforeMutationCalls += 1;
    },
  }));
  return { error, beforeMutationCalls };
}

test('RPP-0267 focused local plugin data rejects stale owner file and metadata before mutation', () => {
  const { remote, plan, mutation } = readyFixture();
  const validApply = applyPlan(cloneJson(remote), plan);
  const staleCases = [
    {
      name: 'stale-owner-plugin-file',
      expectedContextResourceKey: ownerPluginFileResourceKey,
      mutate(staleRemote) {
        staleRemote.files[ownerPluginFilePath] = `<?php /* ${ownerPlugin} RPP_0267_STALE_OWNER_FILE_SENTINEL */`;
      },
    },
    {
      name: 'stale-owner-plugin-metadata',
      expectedContextResourceKey: ownerPluginResourceKey,
      mutate(staleRemote) {
        staleRemote.plugins[ownerPlugin] = {
          version: '1.0.1',
          active: true,
          releaseLabel: 'RPP_0267_STALE_PLUGIN_META_SENTINEL',
        };
      },
    },
  ];
  const proofs = [];

  assert.equal(validApply.appliedMutations, 1);
  assert.equal(resourceHash(validApply.site, mutation.resource), mutation.localHash);

  for (const staleCase of staleCases) {
    const staleRemote = cloneJson(remote);
    staleCase.mutate(staleRemote);
    const before = remoteState(staleRemote, mutation);
    const { error, beforeMutationCalls } = applyRefusal(staleRemote, plan);
    const expectedContext = contextFor(mutation, staleCase.expectedContextResourceKey);

    assert.ok(error instanceof PushPlanError);
    assert.equal(error.code, 'STALE_PLUGIN_OWNER_CONTEXT');
    assert.equal(error.details.resourceKey, optionResourceKey);
    assert.equal(error.details.pluginOwner, ownerPlugin);
    assert.equal(error.details.contextResourceKey, staleCase.expectedContextResourceKey);
    assert.equal(error.details.expectedHash, expectedContext.remoteHash);
    assert.match(error.details.actualHash, sha256Hex);
    assert.notEqual(error.details.actualHash, error.details.expectedHash);
    assert.equal(beforeMutationCalls, 0);
    assertRemoteUnchanged(staleRemote, before, mutation, staleCase.name);
    proofs.push({
      ...refusalProof(staleCase.name, error, beforeMutationCalls),
      remotePreservedHash: sha256EvidenceFor(staleRemote),
      rowHashBefore: `sha256:${before.rowHash}`,
      rowHashAfter: `sha256:${resourceHash(staleRemote, mutation.resource)}`,
    });
  }

  const proof = {
    rpp: 'RPP-0267',
    evidenceSource: 'local-focused-plugin-data-stale-owner-context-v4',
    productionBacked: false,
    releaseGate: 'NO-GO',
    readyPlanHash: sha256EvidenceFor({
      status: plan.status,
      summary: plan.summary,
      preconditions: plan.preconditions.length,
      mutation: {
        resourceKey: mutation.resourceKey,
        action: mutation.action,
        baseHash: mutation.baseHash,
        localHash: mutation.localHash,
        remoteBeforeHash: mutation.remoteBeforeHash,
        ownerContextHash: mutation.pluginOwnedResource.auditEvidence.ownerContextHash,
      },
    }),
    refusals: proofs,
  };
  proof.proofHash = sha256EvidenceFor(proof.refusals);

  assert.equal(proof.refusals.every((entry) => entry.code === 'STALE_PLUGIN_OWNER_CONTEXT'), true);
  assert.equal(proof.refusals.every((entry) => entry.beforeMutationCalls === 0), true);
  assert.match(proof.readyPlanHash, sha256Evidence);
  assert.match(proof.proofHash, sha256Evidence);
  assertHashOnly(proof, 'RPP-0267 stale owner context proof');
});

test('RPP-0267 executor rejects forged owner-context evidence omissions before mutation', () => {
  const { remote, plan, mutation } = readyFixture();
  const attacks = [
    {
      name: 'missing-all-owner-context-with-forged-empty-audit-hash',
      mutate(forgedMutation) {
        delete forgedMutation.pluginOwnedResource.ownerContext;
        delete forgedMutation.pluginOwnedResource.ownerContextRequired;
        forgedMutation.pluginOwnedResource.auditEvidence.ownerContextHash = digest([]);
      },
    },
    {
      name: 'omitted-stale-file-owner-context-entry',
      mutate(forgedMutation) {
        forgedMutation.pluginOwnedResource.ownerContext = forgedMutation.pluginOwnedResource.ownerContext
          .filter((context) => context.resourceKey !== ownerPluginFileResourceKey);
        forgedMutation.pluginOwnedResource.auditEvidence.ownerContextHash = digest(
          forgedMutation.pluginOwnedResource.ownerContext,
        );
      },
    },
    {
      name: 'context-resource-key-object-mismatch',
      mutate(forgedMutation) {
        const fileContext = forgedMutation.pluginOwnedResource.ownerContext
          .find((context) => context.resourceKey === ownerPluginFileResourceKey);
        fileContext.resource = { ...contextFor(mutation, ownerPluginResourceKey).resource };
        fileContext.remoteHash = contextFor(mutation, ownerPluginResourceKey).remoteHash;
      },
      expectInvalidContext: true,
    },
  ];
  const proofs = [];

  for (const attack of attacks) {
    const forgedPlan = cloneJson(plan);
    const forgedMutation = mutationFor(forgedPlan);
    attack.mutate(forgedMutation);

    const staleRemote = cloneJson(remote);
    staleRemote.files[ownerPluginFilePath] = `<?php /* ${ownerPlugin} RPP_0267_STALE_OWNER_FILE_SENTINEL */`;
    const before = remoteState(staleRemote, mutation);
    const { error, beforeMutationCalls } = applyRefusal(staleRemote, forgedPlan);

    assert.ok(error instanceof PushPlanError, `${attack.name} should throw PushPlanError`);
    assert.equal(error.code, 'STALE_PLUGIN_OWNER_CONTEXT');
    assert.equal(error.details.resourceKey, optionResourceKey);
    assert.equal(error.details.pluginOwner, ownerPlugin);
    assert.equal(error.details.contextResourceKey, ownerPluginFileResourceKey);
    if (attack.expectInvalidContext) {
      assert.equal(error.details.actualHash, undefined);
    } else {
      assert.match(error.details.actualHash, sha256Hex);
    }
    assert.equal(beforeMutationCalls, 0);
    assertRemoteUnchanged(staleRemote, before, mutation, attack.name);
    proofs.push({
      ...refusalProof(attack.name, error, beforeMutationCalls),
      remotePreservedHash: sha256EvidenceFor(staleRemote),
      rowHashBefore: `sha256:${before.rowHash}`,
      rowHashAfter: `sha256:${resourceHash(staleRemote, mutation.resource)}`,
    });
  }

  const proof = {
    rpp: 'RPP-0267',
    evidenceSource: 'local-focused-forged-owner-context-v4',
    productionBacked: false,
    releaseGate: 'NO-GO',
    attackCount: attacks.length,
    refusals: proofs,
  };
  proof.proofHash = sha256EvidenceFor(proof.refusals);

  assert.deepEqual(proof.refusals.map((entry) => entry.code), [
    'STALE_PLUGIN_OWNER_CONTEXT',
    'STALE_PLUGIN_OWNER_CONTEXT',
    'STALE_PLUGIN_OWNER_CONTEXT',
  ]);
  assert.equal(proof.refusals.every((entry) => entry.beforeMutationCalls === 0), true);
  assert.match(proof.proofHash, sha256Evidence);
  assertHashOnly(proof, 'RPP-0267 forged owner context proof');
});
