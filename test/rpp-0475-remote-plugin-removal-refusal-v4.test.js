import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const ownerPlugin = 'rpp-0475-forms-owner';
const postId = 475;
const postResourceId = `ID:${postId}`;
const postmetaRowId = 'meta_id:9475';
const postmetaResourceKey = `row:["wp_postmeta","${postmetaRowId}"]`;
const ownerPluginResourceKey = `plugin:${ownerPlugin}`;
const ownerPluginFilePath = `wp-content/plugins/${ownerPlugin}/${ownerPlugin}.php`;
const ownerPluginFileResourceKey = `file:${ownerPluginFilePath}`;
const postmetaResource = {
  type: 'row',
  table: 'wp_postmeta',
  id: postmetaRowId,
  key: postmetaResourceKey,
};
const rawMarkers = Object.freeze([
  'RPP_0475_BASE_ROW_SENTINEL',
  'RPP_0475_LOCAL_ROW_SENTINEL',
  'RPP_0475_REMOTE_ROW_PRESERVED',
  'RPP_0475_OWNER_PLUGIN_BASE_SENTINEL',
]);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function decisionFor(plan, resourceKey) {
  return plan.decisions.find((decision) => decision.resourceKey === resourceKey);
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

function assertSha256(value, label = 'sha256') {
  assert.match(value, /^[a-f0-9]{64}$/, label);
}

function assertSha256Evidence(value, label = 'sha256 evidence') {
  assert.match(value, /^sha256:[a-f0-9]{64}$/, label);
}

function assertNoRawMarkers(value, label) {
  const json = JSON.stringify(value);
  for (const marker of rawMarkers) {
    assert.equal(json.includes(marker), false, `${label} leaked raw marker ${marker}`);
  }
  assert.equal(json.includes('meta_value'), false, `${label} leaked raw postmeta value field name`);
}

function allowedPostmetaResource(evidenceScope = null) {
  return {
    resourceKey: postmetaResourceKey,
    pluginOwner: ownerPlugin,
    driver: 'wp-postmeta',
    table: 'wp_postmeta',
    ...(evidenceScope ? { evidenceScope } : {}),
  };
}

function attachPluginOwnedPolicy(site, evidenceScope = null) {
  site.meta = {
    ...(evidenceScope ? { evidenceScope } : {}),
    pluginOwnedResources: {
      ...(evidenceScope ? { evidenceScope } : {}),
      allowedResources: [allowedPostmetaResource(evidenceScope)],
    },
  };
  return site;
}

function baseSite({ rowMode = rawMarkers[0] } = {}) {
  return {
    files: {
      [ownerPluginFilePath]: `<?php /* ${rawMarkers[3]} */`,
    },
    plugins: {
      [ownerPlugin]: { version: '1.0.0', active: true },
    },
    db: {
      wp_posts: {
        [postResourceId]: {
          ID: postId,
          post_title: 'RPP-0475 owner context fixture',
          post_name: 'rpp-0475-owner-context-fixture',
          post_content: 'Stable post row for remote plugin removal refusal proof.',
          post_status: 'publish',
          post_type: 'post',
          post_parent: 0,
          post_author: 0,
        },
      },
      wp_postmeta: {
        [postmetaRowId]: {
          meta_id: 9475,
          post_id: postId,
          meta_key: '_rpp_0475_remote_plugin_removal',
          meta_value: {
            mode: rowMode,
            proof: 'hash-only remote plugin removal refusal fixture',
          },
          __pluginOwner: ownerPlugin,
        },
      },
    },
  };
}

function releaseGateCase({ policyLocation, evidenceScope }) {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_postmeta[postmetaRowId].meta_value.mode = rawMarkers[1];
  const remote = cloneJson(base);
  delete remote.plugins[ownerPlugin];

  if (policyLocation === 'local') {
    attachPluginOwnedPolicy(local, evidenceScope);
  } else if (policyLocation === 'remote') {
    attachPluginOwnedPolicy(remote, evidenceScope);
  } else {
    assert.fail(`Unsupported policy location ${policyLocation}`);
  }

  return { base, local, remote };
}

function hashOnlyRefusalProof({ plan, blocker, evidence, blockedError, remoteBeforeHash, remoteAfterHash }) {
  return {
    rpp: 'RPP-0475',
    evidenceSource: 'local-focused-node-test',
    format: 'hash-only',
    rawValuesIncluded: false,
    plan: {
      status: plan.status,
      summary: plan.summary,
      mutationCount: plan.mutations.length,
      preconditionCount: plan.preconditions.length,
      pluginDecisionHash: `sha256:${digest(decisionFor(plan, ownerPluginResourceKey))}`,
    },
    blocker: {
      class: blocker.class,
      resourceKey: blocker.resourceKey,
      pluginOwner: blocker.pluginOwner,
      driver: blocker.driver,
      policySource: blocker.policySource,
      blockerHash: `sha256:${digest(blocker)}`,
      driverAuditHash: `sha256:${digest(blocker.driverAuditEvidence)}`,
    },
    refusal: {
      reasonCode: evidence.reasonCode,
      operation: evidence.operation,
      proofScope: evidence.proofScope,
      releaseGateEvidenceScope: evidence.releaseGateEvidenceScope,
      productionBacked: evidence.productionBacked,
      evidenceHash: `sha256:${digest(evidence)}`,
      contextHashes: evidence.context.map((context) => ({
        resourceKey: context.resourceKey,
        baseHash: context.baseHash,
        localHash: context.localHash,
        remoteHash: context.remoteHash,
      })),
    },
    blockedApply: {
      code: blockedError.code,
      detailsHash: `sha256:${digest(blockedError.details)}`,
    },
    remotePreservation: {
      beforeHash: remoteBeforeHash,
      afterHash: remoteAfterHash,
    },
  };
}

test('RPP-0475 planner refuses remote owner-plugin removal before mutation with explicit release-gate scope', async (t) => {
  const cases = [
    {
      name: 'local candidate policy remains NO-GO without production-backed evidence',
      policyLocation: 'local',
      evidenceScope: null,
      expectedPolicySource: 'local-snapshot',
      expectedProofScope: 'local-focused',
      expectedReleaseGateEvidenceScope: 'local-candidate',
      expectedProductionBacked: false,
      expectedReleaseGateNote: 'Local proof only; production-backed release gate evidence is still required.',
    },
    {
      name: 'production-backed remote snapshot records production-backed refusal scope',
      policyLocation: 'remote',
      evidenceScope: 'production-backed',
      expectedPolicySource: 'remote-snapshot',
      expectedProofScope: 'production-backed',
      expectedReleaseGateEvidenceScope: 'production-backed',
      expectedProductionBacked: true,
      expectedReleaseGateNote:
        'Production-backed release gate evidence observed live remote owner plugin removal before mutation.',
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, () => {
      const { base, local, remote } = releaseGateCase(testCase);
      const remoteBeforeJson = JSON.stringify(remote);
      const remoteBeforeHash = `sha256:${digest(remote)}`;
      const remoteRowHashBefore = resourceHash(remote, postmetaResource);

      const plan = planFor(base, local, remote);
      const blocker = blockerFor(plan, postmetaResourceKey);
      const evidence = blocker.remotePluginRemovalRefusalEvidence;
      const blockedError = captureError(() => applyPlan(remote, plan));
      const remoteAfterHash = `sha256:${digest(remote)}`;
      const remoteRowHashAfter = resourceHash(remote, postmetaResource);
      const proof = hashOnlyRefusalProof({
        plan,
        blocker,
        evidence,
        blockedError,
        remoteBeforeHash,
        remoteAfterHash,
      });

      assert.equal(plan.status, 'blocked');
      assert.deepEqual(plan.summary, {
        mutations: 0,
        decisions: 1,
        conflicts: 0,
        blockers: 1,
        atomicGroups: 0,
      });
      assert.equal(plan.preconditions.length, 0);
      assert.equal(mutationFor(plan, postmetaResourceKey), undefined);
      assert.equal(decisionFor(plan, ownerPluginResourceKey).decision, 'keep-remote');
      assert.equal(decisionFor(plan, ownerPluginFileResourceKey), undefined);

      assert.equal(blocker.class, 'stale-plugin-owner-context');
      assert.equal(blocker.resourceKey, postmetaResourceKey);
      assert.equal(blocker.pluginOwner, ownerPlugin);
      assert.equal(blocker.driver, 'wp-postmeta');
      assert.equal(blocker.policySource, testCase.expectedPolicySource);
      assert.equal(blocker.driverAuditEvidence.reasonCode, 'PLUGIN_DRIVER_REMOTE_DRIFT_PRESERVED');
      assert.equal(blocker.driverAuditEvidence.decision, 'blocked');
      assert.equal(blocker.driverAuditEvidence.rawValuesIncluded, false);
      assert.deepEqual(blocker.ownerContextRefusalEvidence, evidence);

      assert.equal(evidence.reasonCode, 'REMOTE_PLUGIN_REMOVAL_OWNER_CONTEXT');
      assert.equal(evidence.operation, 'refuse-before-mutation');
      assert.equal(evidence.format, 'hash-only');
      assert.equal(evidence.rawValuesIncluded, false);
      assert.equal(evidence.proofScope, testCase.expectedProofScope);
      assert.equal(evidence.releaseGateEvidenceScope, testCase.expectedReleaseGateEvidenceScope);
      assert.equal(evidence.productionBacked, testCase.expectedProductionBacked);
      assert.equal(evidence.releaseGateNote, testCase.expectedReleaseGateNote);
      assert.equal(evidence.resourceKey, postmetaResourceKey);
      assert.equal(evidence.pluginOwner, ownerPlugin);
      assert.deepEqual(evidence.removedPluginResourceKeys, [ownerPluginResourceKey]);
      assert.equal(evidence.context.length, 1);
      assert.deepEqual(Object.keys(evidence.context[0]).sort(), [
        'baseHash',
        'localChange',
        'localHash',
        'remoteChange',
        'remoteHash',
        'resourceKey',
      ]);
      assert.equal(evidence.context[0].resourceKey, ownerPluginResourceKey);
      assert.equal(evidence.context[0].localChange, 'unchanged');
      assert.equal(evidence.context[0].remoteChange, 'delete');
      assertSha256(evidence.context[0].baseHash, 'owner plugin base hash');
      assertSha256(evidence.context[0].localHash, 'owner plugin local hash');
      assertSha256(evidence.context[0].remoteHash, 'owner plugin remote hash');
      assert.equal(evidence.context[0].localHash, evidence.context[0].baseHash);
      assert.notEqual(evidence.context[0].remoteHash, evidence.context[0].baseHash);

      assert.ok(blockedError instanceof PushPlanError);
      assert.equal(blockedError.code, 'PLAN_NOT_READY');
      assert.equal(blockedError.details.status, 'blocked');
      assert.equal(JSON.stringify(remote), remoteBeforeJson);
      assert.equal(remoteRowHashAfter, remoteRowHashBefore);
      assert.equal(remote.db.wp_postmeta[postmetaRowId].meta_value.mode, rawMarkers[0]);
      assert.equal(remoteBeforeHash, remoteAfterHash);
      assertSha256Evidence(proof.blocker.blockerHash, 'blocker evidence hash');
      assertSha256Evidence(proof.refusal.evidenceHash, 'refusal evidence hash');
      assertSha256Evidence(proof.blockedApply.detailsHash, 'blocked apply details hash');
      assertNoRawMarkers({ blocker, evidence, proof, errorDetails: blockedError.details }, testCase.name);
    });
  }
});

test('RPP-0475 stale ready plan refuses after remote plugin removal before executor mutation', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_postmeta[postmetaRowId].meta_value.mode = rawMarkers[1];
  const readyRemote = attachPluginOwnedPolicy(cloneJson(base), 'production-backed');
  const staleRemote = attachPluginOwnedPolicy(cloneJson(base), 'production-backed');
  delete staleRemote.plugins[ownerPlugin];
  const staleRemoteBeforeJson = JSON.stringify(staleRemote);
  const staleRemoteHashBefore = `sha256:${digest(staleRemote)}`;
  const staleRowHashBefore = resourceHash(staleRemote, postmetaResource);
  let beforeMutationCalls = 0;

  const readyPlan = planFor(base, local, readyRemote);
  const readyMutation = mutationFor(readyPlan, postmetaResourceKey);
  const ownerPluginContext = readyMutation.pluginOwnedResource.ownerContext.find(
    (context) => context.resourceKey === ownerPluginResourceKey,
  );
  const staleError = captureError(() => applyPlan(staleRemote, readyPlan, {
    beforeMutation() {
      beforeMutationCalls += 1;
    },
  }));
  const staleRemoteHashAfter = `sha256:${digest(staleRemote)}`;
  const staleRowHashAfter = resourceHash(staleRemote, postmetaResource);
  const replayProof = {
    rpp: 'RPP-0475',
    evidenceSource: 'local-focused-node-test',
    format: 'hash-only',
    rawValuesIncluded: false,
    readyPlan: {
      status: readyPlan.status,
      mutationCount: readyPlan.mutations.length,
      preconditionCount: readyPlan.preconditions.length,
      mutationHash: `sha256:${digest(readyMutation)}`,
      releaseGateEvidenceScope: readyMutation.pluginOwnedResource.driverEvidence.releaseGateEvidenceScope,
      ownerPluginContextHash: `sha256:${digest(ownerPluginContext)}`,
    },
    refusal: {
      code: staleError.code,
      detailsHash: `sha256:${digest(staleError.details)}`,
      contextResourceKey: staleError.details.contextResourceKey,
      expectedHash: staleError.details.expectedHash,
      actualHash: staleError.details.actualHash,
      beforeMutationCalls,
    },
    remotePreservation: {
      staleRemoteHashBefore,
      staleRemoteHashAfter,
      staleRowHashBefore,
      staleRowHashAfter,
    },
  };

  assert.equal(readyPlan.status, 'ready');
  assert.equal(readyPlan.summary.mutations, 1);
  assert.equal(readyPlan.summary.blockers, 0);
  assert.equal(readyPlan.preconditions.length, 1);
  assert.equal(readyMutation.action, 'put');
  assert.equal(readyMutation.pluginOwnedResource.pluginOwner, ownerPlugin);
  assert.equal(readyMutation.pluginOwnedResource.driver, 'wp-postmeta');
  assert.equal(readyMutation.pluginOwnedResource.policySource, 'remote-snapshot');
  assert.equal(readyMutation.pluginOwnedResource.driverEvidence.releaseGateEvidenceScope, 'production-backed');
  assert.equal(readyMutation.pluginOwnedResource.ownerContextRequired, true);
  assert.ok(ownerPluginContext);
  assert.equal(ownerPluginContext.resourceKey, ownerPluginResourceKey);
  assertSha256(ownerPluginContext.remoteHash, 'ready owner plugin context hash');

  assert.ok(staleError instanceof PushPlanError);
  assert.equal(staleError.code, 'STALE_PLUGIN_OWNER_CONTEXT');
  assert.equal(staleError.details.mutationId, readyMutation.id);
  assert.equal(staleError.details.resourceKey, postmetaResourceKey);
  assert.equal(staleError.details.pluginOwner, ownerPlugin);
  assert.equal(staleError.details.contextResourceKey, ownerPluginResourceKey);
  assert.equal(staleError.details.expectedHash, ownerPluginContext.remoteHash);
  assertSha256(staleError.details.actualHash, 'stale removed owner plugin hash');
  assert.equal(beforeMutationCalls, 0);
  assert.equal(JSON.stringify(staleRemote), staleRemoteBeforeJson);
  assert.equal(staleRemoteHashAfter, staleRemoteHashBefore);
  assert.equal(staleRowHashAfter, staleRowHashBefore);
  assert.equal(staleRemote.db.wp_postmeta[postmetaRowId].meta_value.mode, rawMarkers[0]);
  assertNoRawMarkers({ replayProof, errorDetails: staleError.details }, 'stale ready-plan refusal');
});
