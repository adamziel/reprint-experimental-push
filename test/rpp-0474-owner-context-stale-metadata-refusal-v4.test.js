import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const ownerPlugin = 'forms';
const postmetaRowId = 'meta_id:9474';
const postmetaResourceKey = `row:["wp_postmeta","${postmetaRowId}"]`;
const formsPluginResourceKey = 'plugin:forms';
const formsPluginFileResourceKey = 'file:wp-content/plugins/forms/forms.php';
const formsPluginFilePath = 'wp-content/plugins/forms/forms.php';
const postmetaResource = {
  type: 'row',
  table: 'wp_postmeta',
  id: postmetaRowId,
  key: postmetaResourceKey,
};
const sha256HexPattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}

function baseSite({ rowMode = 'rpp0474-remote-owned-postmeta-preserved' } = {}) {
  return {
    files: {
      [formsPluginFilePath]: '<?php /* rpp0474 forms owner file */',
    },
    plugins: {
      [ownerPlugin]: {
        version: '1.0.0',
        active: true,
        channel: 'rpp0474-base-channel',
      },
    },
    db: {
      wp_posts: {
        'ID:474': {
          ID: 474,
          post_title: 'RPP-0474 owner metadata fixture',
          post_name: 'rpp-0474-owner-metadata-fixture',
          post_status: 'publish',
          post_type: 'post',
          post_parent: 0,
          post_author: 0,
        },
      },
      wp_postmeta: {
        [postmetaRowId]: {
          meta_id: 9474,
          post_id: 474,
          meta_key: '_rpp_0474_owner_metadata',
          meta_value: {
            mode: rowMode,
            nested: { variant: 'v4' },
          },
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

function allowedPostmetaResource() {
  return {
    resourceKey: postmetaResourceKey,
    pluginOwner: ownerPlugin,
    driver: 'wp-postmeta',
    table: 'wp_postmeta',
  };
}

function withPostmetaPolicy(site) {
  site.meta = {
    pushPolicy: pluginOwnedResourcePolicy(allowedPostmetaResource()),
  };
  return site;
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function mutationFor(plan, resourceKey = postmetaResourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function decisionFor(plan, resourceKey) {
  return plan.decisions.find((decision) => decision.resourceKey === resourceKey);
}

function blockerFor(plan, resourceKey = postmetaResourceKey) {
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

function assertNoRawPostmetaOrMetadataValues(value, forbiddenValues, label) {
  const json = JSON.stringify(value);
  for (const forbiddenValue of forbiddenValues) {
    assert.equal(json.includes(forbiddenValue), false, `${label} leaked raw value ${forbiddenValue}`);
  }
  assert.equal(json.includes('meta_value'), false, `${label} must not include raw meta_value fields`);
  assert.equal(json.includes('option_value'), false, `${label} must not include raw option_value fields`);
}

function assertHashOnlyEvidence(value, forbiddenValues, label) {
  assertNoRawPostmetaOrMetadataValues(value, forbiddenValues, label);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(value, { label }));
}

function hashOnlyPlannerProof({ plan, remoteBeforeHash, remoteAfterHash, rowHashBefore, rowHashAfter }) {
  const blocker = blockerFor(plan);
  const metadataRefusal = blocker.ownerMetadataRefusalEvidence;
  return {
    rpp: 'RPP-0474',
    evidenceSource: 'local-focused-owner-context-stale-metadata-v4-test',
    productionBacked: false,
    releaseGate: 'NO-GO',
    rawValuesIncluded: false,
    status: plan.status,
    summary: plan.summary,
    pluginDecision: {
      resourceKey: formsPluginResourceKey,
      decision: decisionFor(plan, formsPluginResourceKey)?.decision || null,
      decisionHash: sha256Evidence(decisionFor(plan, formsPluginResourceKey)),
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
      stalePluginMetadataResourceKeys: metadataRefusal.stalePluginMetadataResourceKeys,
      context: metadataRefusal.context,
      evidenceHash: sha256Evidence(metadataRefusal),
    },
    remotePreservation: {
      rowHashBefore: `sha256:${rowHashBefore}`,
      rowHashAfter: `sha256:${rowHashAfter}`,
      remoteHashBefore: remoteBeforeHash,
      remoteHashAfter: remoteAfterHash,
    },
  };
}

test('RPP-0474 planner refuses stale plugin metadata context before postmeta mutation and preserves remote data', () => {
  const rawValues = [
    'rpp0474-local-owned-postmeta-attempt',
    'rpp0474-remote-owned-postmeta-preserved',
    '47.4.0-rpp0474-remote-plugin-metadata',
    'rpp0474-remote-plugin-channel',
    'rpp0474-remote-plugin-note',
    'rpp0474 forms owner file',
  ];
  const base = baseSite();
  const local = withPostmetaPolicy(cloneJson(base));
  local.db.wp_postmeta[postmetaRowId].meta_value.mode = rawValues[0];
  const remote = cloneJson(base);
  remote.plugins[ownerPlugin] = {
    version: rawValues[2],
    active: true,
    channel: rawValues[3],
    note: rawValues[4],
  };
  const remoteBeforeJson = JSON.stringify(remote);
  const rowHashBefore = resourceHash(remote, postmetaResource);
  const remoteBeforeHash = sha256Evidence(remote);

  const plan = planFor(base, local, remote);
  const blocker = blockerFor(plan);
  const evidence = blocker.ownerMetadataRefusalEvidence;
  const blockedError = captureError(() => applyPlan(remote, plan));
  const rowHashAfter = resourceHash(remote, postmetaResource);
  const remoteAfterHash = sha256Evidence(remote);
  const proof = hashOnlyPlannerProof({
    plan,
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
  assert.equal(plan.preconditions.some((precondition) => precondition.resourceKey === postmetaResourceKey), false);
  assert.equal(decisionFor(plan, formsPluginResourceKey).decision, 'keep-remote');
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.pluginOwner, ownerPlugin);
  assert.equal(blocker.driver, 'wp-postmeta');
  assert.equal(blocker.policySource, 'local-snapshot');
  assert.equal(
    blocker.reason,
    `Plugin-owned resource ${postmetaResourceKey} cannot be applied because live remote plugin context for ${ownerPlugin} changed since the pull base.`,
  );
  assert.equal(blocker.driverAuditEvidence.reasonCode, 'PLUGIN_DRIVER_REMOTE_DRIFT_PRESERVED');
  assert.equal(blocker.driverAuditEvidence.decision, 'blocked');
  assert.equal(blocker.driverAuditEvidence.rawValuesIncluded, false);
  assert.equal(blocker.ownerContextRefusalEvidence.reasonCode, 'STALE_PLUGIN_METADATA_OWNER_CONTEXT');

  assert.equal(evidence.reasonCode, 'STALE_PLUGIN_METADATA_OWNER_CONTEXT');
  assert.equal(evidence.operation, 'refuse-before-mutation');
  assert.equal(evidence.resourceKey, postmetaResourceKey);
  assert.equal(evidence.pluginOwner, ownerPlugin);
  assert.deepEqual(evidence.stalePluginMetadataResourceKeys, [formsPluginResourceKey]);
  assert.equal(evidence.context.length, 1);
  assert.deepEqual(Object.keys(evidence.context[0]).sort(), [
    'baseHash',
    'localChange',
    'localHash',
    'remoteChange',
    'remoteHash',
    'resourceKey',
  ]);
  assert.equal(evidence.context[0].resourceKey, formsPluginResourceKey);
  assert.equal(evidence.context[0].localChange, 'unchanged');
  assert.equal(evidence.context[0].remoteChange, 'update');
  assert.match(evidence.context[0].baseHash, sha256HexPattern);
  assert.match(evidence.context[0].localHash, sha256HexPattern);
  assert.match(evidence.context[0].remoteHash, sha256HexPattern);
  assert.notEqual(evidence.context[0].remoteHash, evidence.context[0].baseHash);

  assert.ok(blockedError instanceof PushPlanError);
  assert.equal(blockedError.code, 'PLAN_NOT_READY');
  assert.deepEqual(blockedError.details, { status: 'blocked' });
  assert.equal(JSON.stringify(remote), remoteBeforeJson);
  assert.equal(remote.db.wp_postmeta[postmetaRowId].meta_value.mode, rawValues[1]);
  assert.deepEqual(remote.plugins[ownerPlugin], {
    version: rawValues[2],
    active: true,
    channel: rawValues[3],
    note: rawValues[4],
  });
  assert.equal(rowHashAfter, rowHashBefore);
  assert.equal(remoteAfterHash, remoteBeforeHash);
  assert.equal(proof.remotePreservation.rowHashAfter, proof.remotePreservation.rowHashBefore);
  assert.equal(proof.remotePreservation.remoteHashAfter, proof.remotePreservation.remoteHashBefore);
  assert.match(proof.blocker.blockerHash, sha256EvidencePattern);
  assert.match(proof.blocker.driverAuditHash, sha256EvidencePattern);
  assert.match(proof.metadataRefusal.evidenceHash, sha256EvidencePattern);
  assert.match(proof.blocker.ownerContextRefusalHash, sha256EvidencePattern);
  assertHashOnlyEvidence(blocker, rawValues, 'RPP-0474 planner blocker');
  assertHashOnlyEvidence(evidence, rawValues, 'RPP-0474 metadata refusal evidence');
  assertHashOnlyEvidence(blockedError.details, rawValues, 'RPP-0474 blocked-plan error details');
  assertHashOnlyEvidence(proof, rawValues, 'RPP-0474 hash-only planner proof');
});

test('RPP-0474 executor rejects stale ready-plan owner metadata before mutation with hash-only details', () => {
  const rawValues = [
    'rpp0474-local-replay-postmeta-attempt',
    'rpp0474-remote-owned-postmeta-preserved',
    '47.4.1-rpp0474-stale-plugin-metadata',
    'rpp0474-stale-plugin-channel',
    'rpp0474 forms owner file',
  ];
  const base = baseSite();
  const local = withPostmetaPolicy(cloneJson(base));
  local.db.wp_postmeta[postmetaRowId].meta_value.mode = rawValues[0];
  const readyRemote = cloneJson(base);
  const readyPlan = planFor(base, local, readyRemote);
  const replayReadyPlan = planFor(cloneJson(base), cloneJson(local), cloneJson(readyRemote));
  const mutation = mutationFor(readyPlan);
  const ownerMetadataContext = mutation.pluginOwnedResource.ownerContext.find(
    (context) => context.resourceKey === formsPluginResourceKey,
  );
  const ownerContextKeys = mutation.pluginOwnedResource.ownerContext.map((context) => context.resourceKey).sort();
  let beforeMutationCalls = 0;

  assert.equal(readyPlan.status, 'ready');
  assert.deepEqual(readyPlan.summary, {
    mutations: 1,
    decisions: 0,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.pluginOwnedResource.pluginOwner, ownerPlugin);
  assert.equal(mutation.pluginOwnedResource.driver, 'wp-postmeta');
  assert.equal(mutation.pluginOwnedResource.policySource, 'local-snapshot');
  assert.equal(mutation.pluginOwnedResource.ownerContextRequired, true);
  assert.deepEqual(ownerContextKeys, [formsPluginFileResourceKey, formsPluginResourceKey].sort());
  assert.ok(ownerMetadataContext, 'ready mutation should carry plugin metadata owner context');
  assert.equal(ownerMetadataContext.remoteHash, ownerMetadataContext.baseHash);
  assert.match(ownerMetadataContext.remoteHash, sha256HexPattern);
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
    'ready mutation hash evidence should be deterministic',
  );

  const staleRemote = cloneJson(base);
  staleRemote.plugins[ownerPlugin] = {
    version: rawValues[2],
    active: true,
    channel: rawValues[3],
  };
  const staleRemoteBeforeJson = JSON.stringify(staleRemote);
  const rowHashBefore = resourceHash(staleRemote, postmetaResource);
  const remoteHashBefore = sha256Evidence(staleRemote);
  const staleError = captureError(() => applyPlan(staleRemote, readyPlan, {
    beforeMutation() {
      beforeMutationCalls += 1;
    },
  }));
  const rowHashAfter = resourceHash(staleRemote, postmetaResource);
  const remoteHashAfter = sha256Evidence(staleRemote);
  const replayProof = {
    rpp: 'RPP-0474',
    evidenceSource: 'local-focused-owner-context-stale-metadata-v4-replay-test',
    productionBacked: false,
    releaseGate: 'NO-GO',
    rawValuesIncluded: false,
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
      preconditionHash: sha256Evidence(
        readyPlan.preconditions.find((entry) => entry.resourceKey === postmetaResourceKey),
      ),
    },
    ownerMetadataContext: {
      resourceKey: ownerMetadataContext.resourceKey,
      remoteHash: ownerMetadataContext.remoteHash,
      contextHash: sha256Evidence(ownerMetadataContext),
    },
    refusal: {
      code: staleError.code,
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
    },
  };
  replayProof.proofHash = sha256Evidence({
    readyPlan: replayProof.readyPlan,
    ownerMetadataContext: replayProof.ownerMetadataContext,
    refusal: replayProof.refusal,
    remotePreservation: replayProof.remotePreservation,
  });

  assert.ok(staleError instanceof PushPlanError);
  assert.equal(staleError.code, 'STALE_PLUGIN_OWNER_CONTEXT');
  assert.equal(staleError.details.mutationId, mutation.id);
  assert.equal(staleError.details.resourceKey, postmetaResourceKey);
  assert.equal(staleError.details.pluginOwner, ownerPlugin);
  assert.equal(staleError.details.contextResourceKey, formsPluginResourceKey);
  assert.equal(staleError.details.expectedHash, ownerMetadataContext.remoteHash);
  assert.match(staleError.details.actualHash, sha256HexPattern);
  assert.notEqual(staleError.details.actualHash, staleError.details.expectedHash);
  assert.equal(beforeMutationCalls, 0);
  assert.equal(JSON.stringify(staleRemote), staleRemoteBeforeJson);
  assert.equal(staleRemote.db.wp_postmeta[postmetaRowId].meta_value.mode, rawValues[1]);
  assert.equal(rowHashAfter, rowHashBefore);
  assert.equal(remoteHashAfter, remoteHashBefore);
  assert.equal(replayProof.remotePreservation.rowHashAfter, replayProof.remotePreservation.rowHashBefore);
  assert.equal(replayProof.remotePreservation.remoteHashAfter, replayProof.remotePreservation.remoteHashBefore);
  assert.match(replayProof.readyPlan.mutationHash, sha256EvidencePattern);
  assert.match(replayProof.ownerMetadataContext.contextHash, sha256EvidencePattern);
  assert.match(replayProof.refusal.detailsHash, sha256EvidencePattern);
  assert.match(replayProof.proofHash, sha256EvidencePattern);
  assertHashOnlyEvidence(mutation.pluginOwnedResource.auditEvidence, rawValues, 'RPP-0474 mutation audit evidence');
  assertHashOnlyEvidence(mutation.pluginOwnedResource.driverAuditEvidence, rawValues, 'RPP-0474 mutation driver audit evidence');
  assertHashOnlyEvidence(staleError.details, rawValues, 'RPP-0474 stale owner context error details');
  assertHashOnlyEvidence(replayProof, rawValues, 'RPP-0474 hash-only replay proof');
});
