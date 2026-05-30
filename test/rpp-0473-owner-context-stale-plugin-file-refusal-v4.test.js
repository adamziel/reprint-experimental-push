import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const ownerPlugin = 'rpp-0473-owner-context';
const postmetaRowId = 'meta_id:9473';
const postmetaResourceKey = `row:["wp_postmeta","${postmetaRowId}"]`;
const ownerPluginFilePath = `wp-content/plugins/${ownerPlugin}/${ownerPlugin}.php`;
const ownerPluginFileResourceKey = `file:${ownerPluginFilePath}`;
const ownerPluginResourceKey = `plugin:${ownerPlugin}`;
const sha256Pattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const rawSentinels = [
  'RPP_0473_BASE_ROW_SENTINEL',
  'RPP_0473_LOCAL_ROW_SENTINEL',
  'RPP_0473_BASE_OWNER_FILE_SENTINEL',
  'RPP_0473_SHARED_OWNER_FILE_SENTINEL',
  'RPP_0473_STALE_REMOTE_OWNER_FILE_SENTINEL',
];

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

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}

function assertSha256(value, label = 'expected SHA-256 hash') {
  assert.match(value, sha256Pattern, label);
}

function assertSha256Evidence(value, label = 'expected sha256 evidence hash') {
  assert.match(value, sha256EvidencePattern, label);
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
      evidenceScope: 'local-production-shaped',
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
    evidenceScope: 'local-production-shaped',
  };
}

function addLocalProductionPolicy(site) {
  site.meta = {
    evidenceScope: 'local-production-shaped',
    pushPolicy: pluginOwnedResourcePolicy(allowedPostmetaResource()),
  };
  return site;
}

function productionShapedSite({
  rowMode = 'RPP_0473_BASE_ROW_SENTINEL',
  pluginFileMode = 'RPP_0473_BASE_OWNER_FILE_SENTINEL',
  withPolicy = false,
} = {}) {
  const site = {
    files: {
      [ownerPluginFilePath]: `<?php /* ${ownerPlugin} ${pluginFileMode} */`,
    },
    plugins: {
      [ownerPlugin]: { version: '1.0.0', active: true },
    },
    db: {
      wp_posts: {
        'ID:9473': {
          ID: 9473,
          post_title: 'RPP-0473 owner context fixture',
          post_name: 'rpp-0473-owner-context-fixture',
          post_status: 'publish',
          post_type: 'post',
          post_parent: 0,
          post_author: 0,
        },
      },
      wp_postmeta: {
        [postmetaRowId]: {
          meta_id: 9473,
          post_id: 9473,
          meta_key: '_rpp_0473_owner_context',
          meta_value: {
            mode: rowMode,
            proof: 'local-production-shaped-v4',
          },
          __pluginOwner: ownerPlugin,
        },
      },
    },
  };
  return withPolicy ? addLocalProductionPolicy(site) : site;
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function mutationFor(plan, resourceKey = postmetaResourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function blockerFor(plan, resourceKey = postmetaResourceKey) {
  return plan.blockers.find((blocker) => blocker.resourceKey === resourceKey);
}

function decisionFor(plan, resourceKey) {
  return plan.decisions.find((decision) => decision.resourceKey === resourceKey);
}

test('RPP-0473 local production-shaped owner context carries one real mutation through apply', () => {
  const base = productionShapedSite();
  const local = productionShapedSite({
    rowMode: 'RPP_0473_LOCAL_ROW_SENTINEL',
    pluginFileMode: 'RPP_0473_SHARED_OWNER_FILE_SENTINEL',
    withPolicy: true,
  });
  const remote = productionShapedSite({
    pluginFileMode: 'RPP_0473_SHARED_OWNER_FILE_SENTINEL',
  });

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan);
  const precondition = plan.preconditions.find((entry) => entry.resourceKey === postmetaResourceKey);
  const sharedPluginFileDecision = decisionFor(plan, ownerPluginFileResourceKey);
  const ownerFileContext = mutation.pluginOwnedResource.ownerContext.find(
    (context) => context.resourceKey === ownerPluginFileResourceKey,
  );
  const ownerMetadataContext = mutation.pluginOwnedResource.ownerContext.find(
    (context) => context.resourceKey === ownerPluginResourceKey,
  );
  const rowHashBefore = resourceHash(remote, mutation.resource);
  const beforeMutation = [];

  const result = applyPlan(remote, plan, {
    mutateRemote: true,
    beforeMutation(context) {
      beforeMutation.push({
        mutationIndex: context.mutationIndex,
        resourceKey: context.mutation.resourceKey,
        driverApplyValidation: context.driverApplyValidation,
      });
    },
  });
  const rowHashAfter = resourceHash(remote, mutation.resource);
  const driverApplyValidation = beforeMutation[0].driverApplyValidation;
  const proof = {
    rpp: 'RPP-0473',
    evidenceSource: 'local-production-shaped-owner-context-file-v4',
    productionBacked: false,
    releaseGate: 'NO-GO',
    validPath: 'shared-owner-plugin-file-context-remains-distinct-from-stale-remote-drift',
    ready: {
      status: plan.status,
      mutationCount: plan.summary.mutations,
      decisionCount: plan.summary.decisions,
      blockerCount: plan.summary.blockers,
      preconditionCount: plan.preconditions.length,
      mutationHash: sha256Evidence({
        resourceKey: mutation.resourceKey,
        action: mutation.action,
        baseHash: mutation.baseHash,
        localHash: mutation.localHash,
        remoteBeforeHash: mutation.remoteBeforeHash,
      }),
      ownerContextHash: sha256Evidence(mutation.pluginOwnedResource.ownerContext),
      auditEvidenceHash: sha256Evidence(mutation.pluginOwnedResource.auditEvidence),
      driverEvidenceHash: sha256Evidence(mutation.pluginOwnedResource.driverEvidence),
      sharedPluginFileDecisionHash: sha256Evidence(sharedPluginFileDecision),
    },
    apply: {
      appliedMutations: result.appliedMutations,
      journalEntries: result.journal.entries.length,
      beforeMutationHooks: beforeMutation.length,
      rowHashBefore: `sha256:${rowHashBefore}`,
      rowHashAfter: `sha256:${rowHashAfter}`,
      driverApplyValidationHash: sha256Evidence(driverApplyValidation),
      journalHash: sha256Evidence(result.journal),
    },
  };
  proof.proofHash = sha256Evidence({ ready: proof.ready, apply: proof.apply });

  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.summary, {
    mutations: 1,
    decisions: 1,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.equal(plan.preconditions.length, 1);
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.resourceKey, postmetaResourceKey);
  assert.equal(mutation.resource.table, 'wp_postmeta');
  assert.equal(mutation.resource.id, postmetaRowId);
  assert.equal(mutation.pluginOwnedResource.pluginOwner, ownerPlugin);
  assert.equal(mutation.pluginOwnedResource.driver, 'wp-postmeta');
  assert.equal(mutation.pluginOwnedResource.policySource, 'local-snapshot');
  assert.equal(mutation.pluginOwnedResource.supportsDelete, false);
  assert.equal(mutation.pluginOwnedResource.ownerContextRequired, true);
  assert.equal(
    mutation.pluginOwnedResource.driverEvidence.releaseGateEvidenceScope,
    'local-production-shaped',
  );
  assert.equal(mutation.pluginOwnedResource.auditEvidence.format, 'hash-only');
  assert.equal(mutation.pluginOwnedResource.auditEvidence.rawValuesIncluded, false);
  assert.equal(mutation.pluginOwnedResource.driverAuditEvidence.rawValuesIncluded, false);
  assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
  assert.equal(precondition.checkedAgainst, 'live-remote');

  assert.equal(sharedPluginFileDecision.decision, 'already-in-sync');
  assert.equal(sharedPluginFileDecision.resourceKey, ownerPluginFileResourceKey);
  assert.ok(ownerFileContext);
  assert.equal(ownerFileContext.resourceKey, ownerPluginFileResourceKey);
  assert.equal(ownerFileContext.localHash, ownerFileContext.remoteHash);
  assert.notEqual(ownerFileContext.remoteHash, ownerFileContext.baseHash);
  assert.equal(ownerFileContext.change.localChange, 'update');
  assert.equal(ownerFileContext.change.remoteChange, 'update');
  assert.ok(ownerMetadataContext);
  assert.equal(ownerMetadataContext.localHash, ownerMetadataContext.baseHash);
  assert.equal(ownerMetadataContext.remoteHash, ownerMetadataContext.baseHash);
  assertSha256(ownerFileContext.baseHash, 'owner file base hash');
  assertSha256(ownerFileContext.localHash, 'owner file local hash');
  assertSha256(ownerFileContext.remoteHash, 'owner file remote hash');

  assert.equal(result.site, remote, 'mutateRemote proof should mutate the checked remote object');
  assert.equal(result.appliedMutations, 1);
  assert.equal(beforeMutation.length, 1);
  assert.equal(beforeMutation[0].mutationIndex, 1);
  assert.equal(beforeMutation[0].resourceKey, postmetaResourceKey);
  assert.equal(driverApplyValidation.reasonCode, 'PLUGIN_DRIVER_APPLY_VALIDATION_ACCEPTED');
  assert.equal(driverApplyValidation.outcome, 'accepted');
  assert.equal(driverApplyValidation.pluginOwner, ownerPlugin);
  assert.equal(driverApplyValidation.driver, 'wp-postmeta');
  assert.equal(rowHashBefore, mutation.remoteBeforeHash);
  assert.equal(rowHashAfter, mutation.localHash);
  assert.notEqual(rowHashAfter, rowHashBefore);
  assert.equal(remote.db.wp_postmeta[postmetaRowId].meta_value.mode, 'RPP_0473_LOCAL_ROW_SENTINEL');
  assert.equal(
    remote.files[ownerPluginFilePath],
    '<?php /* rpp-0473-owner-context RPP_0473_SHARED_OWNER_FILE_SENTINEL */',
  );
  assert.equal(result.journal.entries.length, 1);
  assert.equal(result.journal.entries[0].resourceKey, postmetaResourceKey);
  assert.equal(result.journal.entries[0].status, 'applied');
  assertSha256Evidence(proof.ready.mutationHash, 'mutation evidence hash');
  assertSha256Evidence(proof.ready.ownerContextHash, 'owner context evidence hash');
  assertSha256Evidence(proof.apply.rowHashBefore, 'row hash before evidence');
  assertSha256Evidence(proof.apply.rowHashAfter, 'row hash after evidence');
  assertSha256Evidence(proof.proofHash, 'combined proof hash');
  assertHashOnly(mutation.pluginOwnedResource.auditEvidence, 'RPP-0473 planner audit evidence');
  assertHashOnly(mutation.pluginOwnedResource.driverAuditEvidence, 'RPP-0473 driver audit evidence');
  assertHashOnly(mutation.pluginOwnedResource.driverEvidence, 'RPP-0473 driver evidence');
  assertHashOnly(driverApplyValidation, 'RPP-0473 apply validation evidence');
  assertHashOnly(result.journal, 'RPP-0473 apply journal');
  assertHashOnly(proof, 'RPP-0473 valid apply proof');
});

test('RPP-0473 stale owner plugin file refuses before planner and replay mutation with hash-only evidence', () => {
  const base = productionShapedSite();
  const local = productionShapedSite({
    rowMode: 'RPP_0473_LOCAL_ROW_SENTINEL',
    withPolicy: true,
  });
  const staleRemote = productionShapedSite({
    pluginFileMode: 'RPP_0473_STALE_REMOTE_OWNER_FILE_SENTINEL',
  });
  const staleRemoteBefore = JSON.stringify(staleRemote);

  const stalePlan = planFor(base, local, staleRemote);
  const staleBlocker = blockerFor(stalePlan);
  const staleEvidence = staleBlocker.ownerFileRefusalEvidence;
  const stalePlanApplyError = captureError(() => applyPlan(staleRemote, stalePlan, { mutateRemote: true }));

  const readyRemote = productionShapedSite();
  const readyPlan = planFor(base, cloneJson(local), readyRemote);
  const readyMutation = mutationFor(readyPlan);
  const readyOwnerFileContext = readyMutation.pluginOwnedResource.ownerContext.find(
    (context) => context.resourceKey === ownerPluginFileResourceKey,
  );
  const replayRemote = productionShapedSite({
    pluginFileMode: 'RPP_0473_STALE_REMOTE_OWNER_FILE_SENTINEL',
  });
  const replayRemoteBefore = JSON.stringify(replayRemote);
  const replayRemoteHashBefore = sha256Evidence(replayRemote);
  const replayRowHashBefore = resourceHash(replayRemote, readyMutation.resource);
  let beforeMutationCalls = 0;
  const staleReplayError = captureError(() => applyPlan(replayRemote, readyPlan, {
    mutateRemote: true,
    beforeMutation() {
      beforeMutationCalls += 1;
    },
  }));
  const replayRowHashAfter = resourceHash(replayRemote, readyMutation.resource);
  const replayRemoteHashAfter = sha256Evidence(replayRemote);
  const proof = {
    rpp: 'RPP-0473',
    evidenceSource: 'local-focused-owner-context-stale-plugin-file-v4',
    productionBacked: false,
    releaseGate: 'NO-GO',
    stalePlanner: {
      status: stalePlan.status,
      mutationCount: stalePlan.summary.mutations,
      decisionCount: stalePlan.summary.decisions,
      blockerCount: stalePlan.summary.blockers,
      blockerHash: sha256Evidence(staleBlocker),
      ownerFileRefusalEvidenceHash: sha256Evidence(staleEvidence),
      ownerContextRefusalEvidenceHash: sha256Evidence(staleBlocker.ownerContextRefusalEvidence),
      driverAuditEvidenceHash: sha256Evidence(staleBlocker.driverAuditEvidence),
      stalePluginFileResourceKeys: staleEvidence.stalePluginFileResourceKeys,
      blockedPlanApplyErrorHash: sha256Evidence(stalePlanApplyError.details),
    },
    staleReplay: {
      readyMutationHash: sha256Evidence({
        resourceKey: readyMutation.resourceKey,
        action: readyMutation.action,
        baseHash: readyMutation.baseHash,
        localHash: readyMutation.localHash,
        remoteBeforeHash: readyMutation.remoteBeforeHash,
      }),
      errorCode: staleReplayError.code,
      errorDetailsHash: sha256Evidence(staleReplayError.details),
      beforeMutationCalls,
      rowHashBefore: `sha256:${replayRowHashBefore}`,
      rowHashAfter: `sha256:${replayRowHashAfter}`,
      remoteHashBefore: replayRemoteHashBefore,
      remoteHashAfter: replayRemoteHashAfter,
    },
  };
  proof.proofHash = sha256Evidence({ stalePlanner: proof.stalePlanner, staleReplay: proof.staleReplay });

  assert.equal(stalePlan.status, 'blocked');
  assert.deepEqual(stalePlan.summary, {
    mutations: 0,
    decisions: 1,
    conflicts: 0,
    blockers: 1,
    atomicGroups: 0,
  });
  assert.equal(stalePlan.preconditions.length, 0);
  assert.equal(mutationFor(stalePlan), undefined);
  assert.equal(staleBlocker.class, 'stale-plugin-owner-context');
  assert.equal(staleBlocker.resourceKey, postmetaResourceKey);
  assert.equal(staleBlocker.pluginOwner, ownerPlugin);
  assert.equal(staleBlocker.driver, 'wp-postmeta');
  assert.equal(staleBlocker.policySource, 'local-snapshot');
  assert.equal(staleBlocker.driverAuditEvidence.reasonCode, 'PLUGIN_DRIVER_REMOTE_DRIFT_PRESERVED');
  assert.equal(staleBlocker.driverAuditEvidence.decision, 'blocked');
  assert.deepEqual(staleBlocker.ownerContextRefusalEvidence, staleEvidence);
  assert.equal(
    staleBlocker.reason,
    `Plugin-owned resource ${postmetaResourceKey} cannot be applied because live remote plugin context for ${ownerPlugin} changed since the pull base.`,
  );
  assert.equal(staleEvidence.reasonCode, 'STALE_PLUGIN_FILE_OWNER_CONTEXT');
  assert.equal(staleEvidence.operation, 'refuse-before-mutation');
  assert.equal(staleEvidence.resourceKey, postmetaResourceKey);
  assert.equal(staleEvidence.pluginOwner, ownerPlugin);
  assert.deepEqual(staleEvidence.stalePluginFileResourceKeys, [ownerPluginFileResourceKey]);
  assert.equal(staleEvidence.context.length, 1);
  assert.equal(staleEvidence.context[0].resourceKey, ownerPluginFileResourceKey);
  assert.equal(staleEvidence.context[0].localChange, 'unchanged');
  assert.equal(staleEvidence.context[0].remoteChange, 'update');
  assertSha256(staleEvidence.context[0].baseHash, 'stale owner file base hash');
  assertSha256(staleEvidence.context[0].localHash, 'stale owner file local hash');
  assertSha256(staleEvidence.context[0].remoteHash, 'stale owner file remote hash');
  assert.equal(staleEvidence.context[0].baseHash, staleEvidence.context[0].localHash);
  assert.notEqual(staleEvidence.context[0].remoteHash, staleEvidence.context[0].baseHash);
  assert.ok(stalePlanApplyError instanceof PushPlanError);
  assert.equal(stalePlanApplyError.code, 'PLAN_NOT_READY');
  assert.equal(JSON.stringify(staleRemote), staleRemoteBefore);
  assert.equal(
    staleRemote.db.wp_postmeta[postmetaRowId].meta_value.mode,
    'RPP_0473_BASE_ROW_SENTINEL',
  );

  assert.equal(readyPlan.status, 'ready');
  assert.equal(readyPlan.summary.mutations, 1);
  assert.equal(readyMutation.pluginOwnedResource.ownerContextRequired, true);
  assert.equal(readyOwnerFileContext.resourceKey, ownerPluginFileResourceKey);
  assertSha256(readyOwnerFileContext.remoteHash, 'ready owner file remote hash');
  assert.ok(staleReplayError instanceof PushPlanError);
  assert.equal(staleReplayError.code, 'STALE_PLUGIN_OWNER_CONTEXT');
  assert.equal(staleReplayError.details.resourceKey, postmetaResourceKey);
  assert.equal(staleReplayError.details.pluginOwner, ownerPlugin);
  assert.equal(staleReplayError.details.contextResourceKey, ownerPluginFileResourceKey);
  assert.equal(staleReplayError.details.expectedHash, readyOwnerFileContext.remoteHash);
  assertSha256(staleReplayError.details.actualHash, 'stale replay actual owner file hash');
  assert.notEqual(staleReplayError.details.actualHash, staleReplayError.details.expectedHash);
  assert.equal(beforeMutationCalls, 0);
  assert.equal(replayRowHashAfter, replayRowHashBefore);
  assert.equal(replayRemoteHashAfter, replayRemoteHashBefore);
  assert.equal(JSON.stringify(replayRemote), replayRemoteBefore);
  assertSha256Evidence(proof.stalePlanner.blockerHash, 'planner blocker hash');
  assertSha256Evidence(proof.stalePlanner.ownerFileRefusalEvidenceHash, 'owner file refusal hash');
  assertSha256Evidence(proof.staleReplay.errorDetailsHash, 'stale replay error hash');
  assertSha256Evidence(proof.proofHash, 'combined stale proof hash');
  assertHashOnly(staleBlocker, 'RPP-0473 stale planner blocker');
  assertHashOnly(staleEvidence, 'RPP-0473 stale owner file refusal evidence');
  assertHashOnly(staleReplayError.details, 'RPP-0473 stale replay error details');
  assertHashOnly(proof, 'RPP-0473 stale refusal proof');
});
