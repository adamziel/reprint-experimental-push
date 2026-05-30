import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const ownerPlugin = 'rpp-0433-owner-context';
const postmetaRowId = 'meta_id:9433';
const postmetaResourceKey = `row:["wp_postmeta","${postmetaRowId}"]`;
const ownerPluginFilePath = `wp-content/plugins/${ownerPlugin}/${ownerPlugin}.php`;
const ownerPluginFileResourceKey = `file:${ownerPluginFilePath}`;
const siblingPluginFilePath = `wp-content/plugins/${ownerPlugin}/includes/context.php`;
const siblingPluginFileResourceKey = `file:${siblingPluginFilePath}`;

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

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
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

function pluginOwnedResourcePolicy(...allowedResources) {
  return {
    evidenceScope: 'local-production-shaped',
    allowedResources,
  };
}

function productionShapedSite({ rowMode = 'base', pluginFileMode = 'base' } = {}) {
  return {
    meta: {
      evidenceScope: 'local-production-shaped',
      pluginOwnedResources: pluginOwnedResourcePolicy(allowedPostmetaResource()),
    },
    files: {
      [ownerPluginFilePath]: `<?php /* RPP-0433 owner file ${pluginFileMode} */`,
    },
    plugins: {
      [ownerPlugin]: { version: '1.0.0', active: true },
    },
    db: {
      wp_posts: {
        'ID:9433': {
          ID: 9433,
          post_title: 'RPP-0433 owner context fixture',
          post_name: 'rpp-0433-owner-context-fixture',
          post_content: 'Stable post row for local production-shaped proof.',
          post_status: 'publish',
          post_type: 'post',
          post_parent: 0,
          post_author: 0,
        },
      },
      wp_postmeta: {
        [postmetaRowId]: {
          meta_id: 9433,
          post_id: 9433,
          meta_key: '_rpp_0433_owner_context',
          meta_value: {
            mode: rowMode,
            proof: 'rpp-0433-local-production-shaped',
          },
          __pluginOwner: ownerPlugin,
        },
      },
    },
  };
}

function pluginFileSite() {
  return {
    files: {
      [ownerPluginFilePath]: '<?php /* RPP-0433 base target plugin file */',
      [siblingPluginFilePath]: '<?php /* RPP-0433 base owner context file */',
    },
    plugins: {
      [ownerPlugin]: { version: '1.0.0', active: true },
    },
  };
}

function assertHashOnly(value, forbiddenValues) {
  const json = JSON.stringify(value);
  for (const forbiddenValue of forbiddenValues) {
    assert.equal(json.includes(forbiddenValue), false, `leaked raw value ${forbiddenValue}`);
  }
}

function assertSha256(value) {
  assert.match(value, /^[a-f0-9]{64}$/);
}

test('RPP-0433 applies one row and refuses stale owner plugin file before mutation', () => {
  const base = productionShapedSite();
  const local = productionShapedSite({ rowMode: 'RPP_0433_LOCAL_ROW_SENTINEL' });
  const readyRemote = productionShapedSite();
  const staleRemote = productionShapedSite({ pluginFileMode: 'RPP_0433_REMOTE_FILE_SENTINEL' });
  const staleRemoteBefore = JSON.stringify(staleRemote);

  const readyPlan = planFor(base, local, readyRemote);
  const readyMutation = mutationFor(readyPlan, postmetaResourceKey);
  const readyOwnerContext = readyMutation.pluginOwnedResource.ownerContext.find(
    (context) => context.resourceKey === ownerPluginFileResourceKey,
  );
  const applied = applyPlan(readyRemote, readyPlan);

  const stalePlan = planFor(base, local, staleRemote);
  const staleBlocker = stalePlan.blockers.find((entry) => entry.resourceKey === postmetaResourceKey);
  const staleEvidence = staleBlocker.ownerFileRefusalEvidence;
  const staleReplayError = captureError(() => applyPlan(staleRemote, readyPlan));
  const proofEnvelope = {
    scope: 'local-production-shaped',
    productionBacked: false,
    ready: {
      status: readyPlan.status,
      mutationCount: readyPlan.mutations.length,
      preconditionCount: readyPlan.preconditions.length,
      mutation: {
        resourceKey: readyMutation.resourceKey,
        action: readyMutation.action,
        baseHash: readyMutation.baseHash,
        localHash: readyMutation.localHash,
        remoteBeforeHash: readyMutation.remoteBeforeHash,
        pluginOwnedResource: {
          pluginOwner: readyMutation.pluginOwnedResource.pluginOwner,
          driver: readyMutation.pluginOwnedResource.driver,
          releaseGateEvidenceScope:
            readyMutation.pluginOwnedResource.driverEvidence.releaseGateEvidenceScope,
          ownerContextRequired: readyMutation.pluginOwnedResource.ownerContextRequired,
          ownerContextResourceKeys: readyMutation.pluginOwnedResource.ownerContext.map(
            (context) => context.resourceKey,
          ),
        },
      },
    },
    apply: {
      appliedMutations: applied.appliedMutations,
      appliedResourceKey: postmetaResourceKey,
    },
    stale: {
      status: stalePlan.status,
      summary: stalePlan.summary,
      blockerClass: staleBlocker.class,
      evidence: staleEvidence,
      replayErrorDetails: staleReplayError.details,
    },
  };

  assert.equal(readyPlan.status, 'ready');
  assert.equal(readyPlan.summary.mutations, 1);
  assert.equal(readyPlan.summary.blockers, 0);
  assert.equal(readyPlan.preconditions.length, 1);
  assert.equal(readyMutation.action, 'put');
  assert.equal(readyMutation.pluginOwnedResource.pluginOwner, ownerPlugin);
  assert.equal(readyMutation.pluginOwnedResource.driver, 'wp-postmeta');
  assert.equal(
    readyMutation.pluginOwnedResource.driverEvidence.releaseGateEvidenceScope,
    'local-production-shaped',
  );
  assert.equal(readyMutation.pluginOwnedResource.ownerContextRequired, true);
  assert.ok(readyOwnerContext);
  assertSha256(readyOwnerContext.remoteHash);
  assert.equal(readyOwnerContext.remoteHash, readyOwnerContext.baseHash);
  assert.equal(applied.appliedMutations, 1);
  assert.equal(
    applied.site.db.wp_postmeta[postmetaRowId].meta_value.mode,
    'RPP_0433_LOCAL_ROW_SENTINEL',
  );
  assert.equal(applied.site.files[ownerPluginFilePath], base.files[ownerPluginFilePath]);

  assert.equal(stalePlan.status, 'blocked');
  assert.equal(stalePlan.summary.mutations, 0);
  assert.equal(mutationFor(stalePlan, postmetaResourceKey), undefined);
  assert.equal(staleBlocker.class, 'stale-plugin-owner-context');
  const expectedStaleRowReason = [
    `Plugin-owned resource ${postmetaResourceKey} cannot be applied because`,
    `live remote plugin context for ${ownerPlugin} changed since the pull base.`,
  ].join(' ');
  assert.equal(staleBlocker.reason, expectedStaleRowReason);
  assert.equal(staleEvidence.reasonCode, 'STALE_PLUGIN_FILE_OWNER_CONTEXT');
  assert.equal(staleEvidence.operation, 'refuse-before-mutation');
  assert.equal(staleEvidence.resourceKey, postmetaResourceKey);
  assert.equal(staleEvidence.pluginOwner, ownerPlugin);
  assert.deepEqual(staleEvidence.stalePluginFileResourceKeys, [ownerPluginFileResourceKey]);
  assert.equal(staleEvidence.context[0].resourceKey, ownerPluginFileResourceKey);
  assert.equal(staleEvidence.context[0].localChange, 'unchanged');
  assert.equal(staleEvidence.context[0].remoteChange, 'update');
  assertSha256(staleEvidence.context[0].baseHash);
  assertSha256(staleEvidence.context[0].localHash);
  assertSha256(staleEvidence.context[0].remoteHash);
  assert.ok(staleReplayError instanceof PushPlanError);
  assert.equal(staleReplayError.code, 'STALE_PLUGIN_OWNER_CONTEXT');
  assert.equal(staleReplayError.details.resourceKey, postmetaResourceKey);
  assert.equal(staleReplayError.details.pluginOwner, ownerPlugin);
  assert.equal(staleReplayError.details.contextResourceKey, ownerPluginFileResourceKey);
  assert.equal(staleReplayError.details.expectedHash, readyOwnerContext.remoteHash);
  assertSha256(staleReplayError.details.actualHash);
  assert.equal(JSON.stringify(staleRemote), staleRemoteBefore);
  assertHashOnly(proofEnvelope, [
    'RPP_0433_LOCAL_ROW_SENTINEL',
    'RPP_0433_REMOTE_FILE_SENTINEL',
    'RPP-0433 owner file base',
  ]);
});

test('RPP-0433 stale sibling owner file refuses plugin file mutation with hash-only evidence', () => {
  const base = pluginFileSite();
  const local = cloneJson(base);
  local.files[ownerPluginFilePath] = '<?php /* RPP_0433_LOCAL_TARGET_FILE_SENTINEL */';
  const remote = cloneJson(base);
  remote.files[siblingPluginFilePath] = '<?php /* RPP_0433_REMOTE_CONTEXT_FILE_SENTINEL */';
  const remoteBefore = JSON.stringify(remote);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === ownerPluginFileResourceKey);
  const evidence = blocker.ownerFileRefusalEvidence;
  const blockedApplyError = captureError(() => applyPlan(remote, plan));

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, ownerPluginFileResourceKey), undefined);
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.pluginOwner, ownerPlugin);
  const expectedStaleFileReason = [
    `Plugin context resource ${ownerPluginFileResourceKey} cannot be applied because`,
    `live remote plugin context for ${ownerPlugin} changed since the pull base.`,
  ].join(' ');
  assert.equal(blocker.reason, expectedStaleFileReason);
  assert.equal(evidence.reasonCode, 'STALE_PLUGIN_FILE_OWNER_CONTEXT');
  assert.equal(evidence.operation, 'refuse-before-mutation');
  assert.equal(evidence.resourceKey, ownerPluginFileResourceKey);
  assert.equal(evidence.pluginOwner, ownerPlugin);
  assert.deepEqual(evidence.stalePluginFileResourceKeys, [siblingPluginFileResourceKey]);
  assert.equal(evidence.context[0].resourceKey, siblingPluginFileResourceKey);
  assert.equal(evidence.context[0].localChange, 'unchanged');
  assert.equal(evidence.context[0].remoteChange, 'update');
  assertSha256(evidence.context[0].baseHash);
  assertSha256(evidence.context[0].localHash);
  assertSha256(evidence.context[0].remoteHash);
  assert.match(blockedApplyError.message, /Refusing to apply a blocked plan/);
  assert.equal(JSON.stringify(remote), remoteBefore);
  assertHashOnly({ blocker, evidence }, [
    'RPP_0433_LOCAL_TARGET_FILE_SENTINEL',
    'RPP_0433_REMOTE_CONTEXT_FILE_SENTINEL',
    'RPP-0433 base target plugin file',
    'RPP-0433 base owner context file',
  ]);
});
