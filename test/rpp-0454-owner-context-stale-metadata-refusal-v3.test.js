import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const ownerPlugin = 'forms';
const optionName = 'rpp_0454_owner_context_settings';
const optionRowId = `option_name:${optionName}`;
const optionResourceKey = `row:["wp_options","${optionRowId}"]`;
const pluginResourceKey = `plugin:${ownerPlugin}`;
const pluginFilePath = `wp-content/plugins/${ownerPlugin}/${ownerPlugin}.php`;
const pluginFileResourceKey = `file:${pluginFilePath}`;
const optionResource = {
  type: 'row',
  table: 'wp_options',
  id: optionRowId,
  key: optionResourceKey,
};
const sha256HexPattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const rawSentinels = Object.freeze([
  'rpp-0454-base-owned-option-private',
  'rpp-0454-planner-local-owned-option-private',
  'rpp-0454-replay-local-owned-option-private',
  'rpp-0454-remote-owned-option-preserved',
  '54.4.0-rpp-0454-remote-plugin-metadata-private',
  'rpp-0454-remote-plugin-channel-private',
  'rpp-0454-remote-plugin-note-private',
  '54.4.1-rpp-0454-stale-live-plugin-metadata-private',
  'rpp-0454-stale-live-plugin-channel-private',
  'rpp-0454-stale-live-plugin-note-private',
  'rpp-0454 forms owner file private',
]);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}

function baseSite({ rowMode = rawSentinels[3] } = {}) {
  return {
    files: {
      [pluginFilePath]: `<?php /* ${rawSentinels[10]} */`,
    },
    plugins: {
      [ownerPlugin]: {
        version: '1.0.0',
        active: true,
        channel: 'rpp-0454-base-channel',
      },
    },
    db: {
      wp_options: {
        [optionRowId]: {
          option_name: optionName,
          option_value: {
            mode: rowMode,
            nested: { variant: 'v3' },
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
      evidenceScope: 'local-generated-owner-context-stale-metadata-v3',
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

function attachOptionPolicy(site) {
  site.meta = {
    evidenceScope: 'local-generated-owner-context-stale-metadata-v3',
    pushPolicy: pluginOwnedResourcePolicy(allowedOptionResource()),
  };
  return site;
}

function generatedPlannerFixture() {
  const base = baseSite();
  const local = attachOptionPolicy(cloneJson(base));
  local.db.wp_options[optionRowId].option_value.mode = rawSentinels[1];
  const remote = cloneJson(base);
  remote.plugins[ownerPlugin] = {
    version: rawSentinels[4],
    active: true,
    channel: rawSentinels[5],
    note: rawSentinels[6],
  };
  return {
    variant: 'generated-planner-remote-plugin-metadata-drift',
    base,
    local,
    remote,
  };
}

function generatedReplayFixture() {
  const base = baseSite();
  const local = attachOptionPolicy(cloneJson(base));
  local.db.wp_options[optionRowId].option_value.mode = rawSentinels[2];
  const staleRemote = cloneJson(base);
  staleRemote.plugins[ownerPlugin] = {
    version: rawSentinels[7],
    active: true,
    channel: rawSentinels[8],
    note: rawSentinels[9],
  };
  return {
    variant: 'generated-ready-replay-live-plugin-metadata-drift',
    base,
    local,
    readyRemote: cloneJson(base),
    staleRemote,
  };
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function mutationFor(plan, resourceKey = optionResourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function decisionFor(plan, resourceKey) {
  return plan.decisions.find((decision) => decision.resourceKey === resourceKey);
}

function blockerFor(plan, resourceKey = optionResourceKey) {
  return plan.blockers.find((blocker) => blocker.resourceKey === resourceKey);
}

function preconditionFor(plan, resourceKey = optionResourceKey) {
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

function assertHashOnlyEvidence(value, label) {
  const json = JSON.stringify(value);
  for (const sentinel of rawSentinels) {
    assert.equal(json.includes(sentinel), false, `${label} leaked raw sentinel ${sentinel}`);
  }
  assert.equal(json.includes('option_value'), false, `${label} leaked raw option_value fields`);
  assert.equal(json.includes('meta_value'), false, `${label} leaked raw meta_value fields`);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(value, { label }));
}

function assertSha256Hex(value, label) {
  assert.match(value, sha256HexPattern, `${label} should be a SHA-256 hex digest`);
}

function assertSha256Evidence(value, label) {
  assert.match(value, sha256EvidencePattern, `${label} should be a sha256-prefixed digest`);
}

function hashOnlyPlannerProof({ variant, plan, blockedError, remoteBeforeHash, remoteAfterHash, rowHashBefore, rowHashAfter }) {
  const blocker = blockerFor(plan);
  const metadataRefusal = blocker.ownerMetadataRefusalEvidence;
  const pluginDecision = decisionFor(plan, pluginResourceKey);
  const proof = {
    rpp: 'RPP-0454',
    evidenceSource: 'local-generated-owner-context-stale-metadata-v3-planner',
    productionBacked: false,
    releaseGate: 'NO-GO',
    rawValuesIncluded: false,
    generatedVariant: variant,
    status: plan.status,
    summary: plan.summary,
    pluginDecision: {
      resourceKey: pluginResourceKey,
      decision: pluginDecision?.decision || null,
      decisionHash: sha256Evidence(pluginDecision),
    },
    blocker: {
      class: blocker.class,
      resourceKey: blocker.resourceKey,
      pluginOwner: blocker.pluginOwner,
      driver: blocker.driver,
      policySource: blocker.policySource,
      baseHash: blocker.baseHash,
      localHash: blocker.localHash,
      remoteHash: blocker.remoteHash,
      driverAuditHash: sha256Evidence(blocker.driverAuditEvidence),
      ownerContextRefusalHash: sha256Evidence(blocker.ownerContextRefusalEvidence),
      blockerHash: sha256Evidence(blocker),
    },
    metadataRefusal: {
      reasonCode: metadataRefusal.reasonCode,
      operation: metadataRefusal.operation,
      resourceKey: metadataRefusal.resourceKey,
      pluginOwner: metadataRefusal.pluginOwner,
      stalePluginMetadataResourceKeys: metadataRefusal.stalePluginMetadataResourceKeys,
      context: metadataRefusal.context,
      evidenceHash: sha256Evidence(metadataRefusal),
    },
    blockedApply: {
      code: blockedError.code,
      detailsHash: sha256Evidence(blockedError.details),
    },
    remotePreservation: {
      rowHashBefore: `sha256:${rowHashBefore}`,
      rowHashAfter: `sha256:${rowHashAfter}`,
      remoteHashBefore: remoteBeforeHash,
      remoteHashAfter: remoteAfterHash,
      remoteDataPreserved: rowHashBefore === rowHashAfter && remoteBeforeHash === remoteAfterHash,
    },
  };
  proof.proofHash = sha256Evidence({
    generatedVariant: proof.generatedVariant,
    status: proof.status,
    summary: proof.summary,
    pluginDecision: proof.pluginDecision,
    blocker: proof.blocker,
    metadataRefusal: proof.metadataRefusal,
    blockedApply: proof.blockedApply,
    remotePreservation: proof.remotePreservation,
  });
  return proof;
}

function hashOnlyReplayProof({
  variant,
  readyPlan,
  mutation,
  ownerMetadataContext,
  staleError,
  beforeMutationCalls,
  remoteHashBefore,
  remoteHashAfter,
  rowHashBefore,
  rowHashAfter,
}) {
  const proof = {
    rpp: 'RPP-0454',
    evidenceSource: 'local-generated-owner-context-stale-metadata-v3-replay',
    productionBacked: false,
    releaseGate: 'NO-GO',
    rawValuesIncluded: false,
    generatedVariant: variant,
    readyPlan: {
      status: readyPlan.status,
      summary: readyPlan.summary,
      mutationHash: sha256Evidence({
        resourceKey: mutation.resourceKey,
        action: mutation.action,
        baseHash: mutation.baseHash,
        localHash: mutation.localHash,
        remoteBeforeHash: mutation.remoteBeforeHash,
        pluginOwner: mutation.pluginOwnedResource.pluginOwner,
        driver: mutation.pluginOwnedResource.driver,
        ownerContextHash: digest(mutation.pluginOwnedResource.ownerContext),
      }),
      preconditionHash: sha256Evidence(preconditionFor(readyPlan)),
    },
    ownerMetadataContext: {
      resourceKey: ownerMetadataContext.resourceKey,
      remoteHash: ownerMetadataContext.remoteHash,
      contextHash: sha256Evidence(ownerMetadataContext),
    },
    refusal: {
      code: staleError.code,
      beforeMutationCalls,
      detailsHash: sha256Evidence(staleError.details),
      contextResourceKey: staleError.details.contextResourceKey,
      expectedHash: staleError.details.expectedHash,
      actualHash: staleError.details.actualHash,
    },
    remotePreservation: {
      rowHashBefore: `sha256:${rowHashBefore}`,
      rowHashAfter: `sha256:${rowHashAfter}`,
      remoteHashBefore,
      remoteHashAfter,
      remoteDataPreserved: rowHashBefore === rowHashAfter && remoteHashBefore === remoteHashAfter,
    },
  };
  proof.proofHash = sha256Evidence({
    generatedVariant: proof.generatedVariant,
    readyPlan: proof.readyPlan,
    ownerMetadataContext: proof.ownerMetadataContext,
    refusal: proof.refusal,
    remotePreservation: proof.remotePreservation,
  });
  return proof;
}

test('RPP-0454 generated stale owner metadata planner refusal preserves plugin-owned remote data', () => {
  const { variant, base, local, remote } = generatedPlannerFixture();
  const remoteBefore = cloneJson(remote);
  const rowHashBefore = resourceHash(remote, optionResource);
  const remoteBeforeHash = sha256Evidence(remote);

  const plan = planFor(base, local, remote);
  const replayPlan = planFor(cloneJson(base), cloneJson(local), cloneJson(remote));
  const blocker = blockerFor(plan);
  const evidence = blocker.ownerMetadataRefusalEvidence;
  let beforeMutationCalls = 0;
  const blockedError = captureError(() => applyPlan(remote, plan, {
    beforeMutation() {
      beforeMutationCalls += 1;
    },
  }));
  const rowHashAfter = resourceHash(remote, optionResource);
  const remoteAfterHash = sha256Evidence(remote);
  const proof = hashOnlyPlannerProof({
    variant,
    plan,
    blockedError,
    remoteBeforeHash,
    remoteAfterHash,
    rowHashBefore,
    rowHashAfter,
  });
  const replayProof = hashOnlyPlannerProof({
    variant,
    plan: replayPlan,
    blockedError,
    remoteBeforeHash,
    remoteAfterHash,
    rowHashBefore,
    rowHashAfter,
  });

  assert.equal(plan.status, 'blocked');
  assert.deepEqual(plan.summary, {
    mutations: 0,
    decisions: 1,
    conflicts: 0,
    blockers: 1,
    atomicGroups: 0,
  });
  assert.equal(mutationFor(plan), undefined);
  assert.equal(preconditionFor(plan), undefined);
  assert.equal(decisionFor(plan, pluginResourceKey).decision, 'keep-remote');

  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.pluginOwner, ownerPlugin);
  assert.equal(blocker.driver, 'wp-option');
  assert.equal(blocker.policySource, 'local-snapshot');
  assert.equal(
    blocker.reason,
    `Plugin-owned resource ${optionResourceKey} cannot be applied because live remote plugin context for ${ownerPlugin} changed since the pull base.`,
  );
  assert.equal(blocker.driverAuditEvidence.reasonCode, 'PLUGIN_DRIVER_REMOTE_DRIFT_PRESERVED');
  assert.equal(blocker.driverAuditEvidence.decision, 'blocked');
  assert.equal(blocker.driverAuditEvidence.redaction, 'hash-only');
  assert.equal(blocker.driverAuditEvidence.rawValuesIncluded, false);
  assert.equal(blocker.ownerContextRefusalEvidence.reasonCode, 'STALE_PLUGIN_METADATA_OWNER_CONTEXT');

  assert.equal(evidence.reasonCode, 'STALE_PLUGIN_METADATA_OWNER_CONTEXT');
  assert.equal(evidence.operation, 'refuse-before-mutation');
  assert.equal(evidence.resourceKey, optionResourceKey);
  assert.equal(evidence.pluginOwner, ownerPlugin);
  assert.deepEqual(evidence.stalePluginMetadataResourceKeys, [pluginResourceKey]);
  assert.equal(evidence.context.length, 1);
  assert.deepEqual(Object.keys(evidence.context[0]).sort(), [
    'baseHash',
    'localChange',
    'localHash',
    'remoteChange',
    'remoteHash',
    'resourceKey',
  ]);
  assert.equal(evidence.context[0].resourceKey, pluginResourceKey);
  assert.equal(evidence.context[0].localChange, 'unchanged');
  assert.equal(evidence.context[0].remoteChange, 'update');
  assertSha256Hex(evidence.context[0].baseHash, 'metadata base hash');
  assertSha256Hex(evidence.context[0].localHash, 'metadata local hash');
  assertSha256Hex(evidence.context[0].remoteHash, 'metadata remote hash');
  assert.equal(evidence.context[0].baseHash, evidence.context[0].localHash);
  assert.notEqual(evidence.context[0].remoteHash, evidence.context[0].baseHash);

  assert.ok(blockedError instanceof PushPlanError);
  assert.equal(blockedError.code, 'PLAN_NOT_READY');
  assert.deepEqual(blockedError.details, { status: 'blocked' });
  assert.equal(beforeMutationCalls, 0);
  assert.deepEqual(remote, remoteBefore);
  assert.equal(remote.db.wp_options[optionRowId].option_value.mode, rawSentinels[3]);
  assert.deepEqual(remote.plugins[ownerPlugin], {
    version: rawSentinels[4],
    active: true,
    channel: rawSentinels[5],
    note: rawSentinels[6],
  });
  assert.equal(rowHashAfter, rowHashBefore);
  assert.equal(remoteAfterHash, remoteBeforeHash);
  assert.deepEqual(proof, replayProof, 'hash-only planner proof should be deterministic');
  assert.equal(proof.remotePreservation.remoteDataPreserved, true);

  assertSha256Evidence(proof.pluginDecision.decisionHash, 'plugin decision hash');
  assertSha256Evidence(proof.blocker.blockerHash, 'blocker hash');
  assertSha256Evidence(proof.blocker.driverAuditHash, 'driver audit hash');
  assertSha256Evidence(proof.blocker.ownerContextRefusalHash, 'owner context refusal hash');
  assertSha256Evidence(proof.metadataRefusal.evidenceHash, 'metadata refusal hash');
  assertSha256Evidence(proof.blockedApply.detailsHash, 'blocked apply details hash');
  assertSha256Evidence(proof.remotePreservation.rowHashBefore, 'row before hash');
  assertSha256Evidence(proof.remotePreservation.rowHashAfter, 'row after hash');
  assertSha256Evidence(proof.proofHash, 'planner proof hash');
  assertHashOnlyEvidence(blocker, 'RPP-0454 planner blocker');
  assertHashOnlyEvidence(evidence, 'RPP-0454 metadata refusal evidence');
  assertHashOnlyEvidence(blockedError.details, 'RPP-0454 blocked apply details');
  assertHashOnlyEvidence(proof, 'RPP-0454 planner proof');
});

test('RPP-0454 generated ready-plan replay refuses stale owner metadata before mutation', () => {
  const { variant, base, local, readyRemote, staleRemote } = generatedReplayFixture();
  const readyPlan = planFor(base, local, readyRemote);
  const replayReadyPlan = planFor(cloneJson(base), cloneJson(local), cloneJson(readyRemote));
  const mutation = mutationFor(readyPlan);
  const ownerContextKeys = mutation.pluginOwnedResource.ownerContext.map((context) => context.resourceKey).sort();
  const ownerMetadataContext = mutation.pluginOwnedResource.ownerContext.find(
    (context) => context.resourceKey === pluginResourceKey,
  );

  assert.equal(readyPlan.status, 'ready');
  assert.deepEqual(readyPlan.summary, {
    mutations: 1,
    decisions: 0,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.equal(readyPlan.preconditions.length, 1);
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.resourceKey, optionResourceKey);
  assert.equal(mutation.pluginOwnedResource.pluginOwner, ownerPlugin);
  assert.equal(mutation.pluginOwnedResource.driver, 'wp-option');
  assert.equal(mutation.pluginOwnedResource.policySource, 'local-snapshot');
  assert.equal(mutation.pluginOwnedResource.ownerContextRequired, true);
  assert.equal(mutation.pluginOwnedResource.auditEvidence.format, 'hash-only');
  assert.equal(mutation.pluginOwnedResource.auditEvidence.rawValuesIncluded, false);
  assert.equal(
    mutation.pluginOwnedResource.auditEvidence.ownerContextHash,
    digest(mutation.pluginOwnedResource.ownerContext),
  );
  assert.equal(mutation.pluginOwnedResource.driverAuditEvidence.reasonCode, 'PLUGIN_DRIVER_DECISION_SUPPORTED');
  assert.equal(mutation.pluginOwnedResource.driverAuditEvidence.rawValuesIncluded, false);
  assert.deepEqual(ownerContextKeys, [pluginFileResourceKey, pluginResourceKey].sort());
  assert.ok(ownerMetadataContext, 'ready mutation should carry owner plugin metadata context');
  assert.equal(ownerMetadataContext.remoteHash, ownerMetadataContext.baseHash);
  assertSha256Hex(ownerMetadataContext.remoteHash, 'ready owner metadata remote hash');
  assert.equal(preconditionFor(readyPlan).expectedHash, mutation.remoteBeforeHash);
  assert.deepEqual(
    readyPlan.mutations.map((entry) => sha256Evidence({
      resourceKey: entry.resourceKey,
      action: entry.action,
      baseHash: entry.baseHash,
      localHash: entry.localHash,
      remoteBeforeHash: entry.remoteBeforeHash,
      pluginOwnedResource: entry.pluginOwnedResource,
    })),
    replayReadyPlan.mutations.map((entry) => sha256Evidence({
      resourceKey: entry.resourceKey,
      action: entry.action,
      baseHash: entry.baseHash,
      localHash: entry.localHash,
      remoteBeforeHash: entry.remoteBeforeHash,
      pluginOwnedResource: entry.pluginOwnedResource,
    })),
    'ready mutation evidence should be deterministic',
  );

  const staleRemoteBefore = cloneJson(staleRemote);
  const rowHashBefore = resourceHash(staleRemote, optionResource);
  const remoteHashBefore = sha256Evidence(staleRemote);
  let beforeMutationCalls = 0;
  const staleError = captureError(() => applyPlan(staleRemote, readyPlan, {
    beforeMutation() {
      beforeMutationCalls += 1;
    },
  }));
  const rowHashAfter = resourceHash(staleRemote, optionResource);
  const remoteHashAfter = sha256Evidence(staleRemote);
  const proof = hashOnlyReplayProof({
    variant,
    readyPlan,
    mutation,
    ownerMetadataContext,
    staleError,
    beforeMutationCalls,
    remoteHashBefore,
    remoteHashAfter,
    rowHashBefore,
    rowHashAfter,
  });

  assert.ok(staleError instanceof PushPlanError);
  assert.equal(staleError.code, 'STALE_PLUGIN_OWNER_CONTEXT');
  assert.equal(staleError.details.mutationId, mutation.id);
  assert.equal(staleError.details.resourceKey, optionResourceKey);
  assert.equal(staleError.details.pluginOwner, ownerPlugin);
  assert.equal(staleError.details.contextResourceKey, pluginResourceKey);
  assert.equal(staleError.details.expectedHash, ownerMetadataContext.remoteHash);
  assertSha256Hex(staleError.details.actualHash, 'stale metadata actual hash');
  assert.notEqual(staleError.details.actualHash, staleError.details.expectedHash);
  assert.equal(beforeMutationCalls, 0);
  assert.deepEqual(staleRemote, staleRemoteBefore);
  assert.equal(staleRemote.db.wp_options[optionRowId].option_value.mode, rawSentinels[3]);
  assert.equal(rowHashAfter, rowHashBefore);
  assert.equal(remoteHashAfter, remoteHashBefore);
  assert.equal(proof.remotePreservation.remoteDataPreserved, true);

  assertSha256Evidence(proof.readyPlan.mutationHash, 'ready mutation hash');
  assertSha256Evidence(proof.readyPlan.preconditionHash, 'ready precondition hash');
  assertSha256Evidence(proof.ownerMetadataContext.contextHash, 'owner metadata context hash');
  assertSha256Evidence(proof.refusal.detailsHash, 'stale refusal details hash');
  assertSha256Evidence(proof.remotePreservation.rowHashBefore, 'replay row before hash');
  assertSha256Evidence(proof.remotePreservation.rowHashAfter, 'replay row after hash');
  assertSha256Evidence(proof.proofHash, 'replay proof hash');
  assertHashOnlyEvidence(mutation.pluginOwnedResource.auditEvidence, 'RPP-0454 mutation audit evidence');
  assertHashOnlyEvidence(mutation.pluginOwnedResource.driverAuditEvidence, 'RPP-0454 mutation driver audit evidence');
  assertHashOnlyEvidence(staleError.details, 'RPP-0454 stale owner metadata details');
  assertHashOnlyEvidence(proof, 'RPP-0454 replay proof');
});
