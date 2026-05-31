import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const ownerPlugin = 'rpp-0453-owner-context';
const pluginResourceKey = `plugin:${ownerPlugin}`;
const targetPluginFilePath = `wp-content/plugins/${ownerPlugin}/${ownerPlugin}.php`;
const targetPluginFileResourceKey = `file:${targetPluginFilePath}`;
const siblingPluginFilePath = `wp-content/plugins/${ownerPlugin}/includes/context.php`;
const siblingPluginFileResourceKey = `file:${siblingPluginFilePath}`;
const optionName = 'rpp_0453_owner_context_settings';
const optionRowId = `option_name:${optionName}`;
const optionResourceKey = `row:["wp_options","${optionRowId}"]`;
const sha256HexPattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const rawSentinels = Object.freeze([
  'rpp-0453-base-target-plugin-file-private',
  'rpp-0453-local-target-plugin-file-private',
  'rpp-0453-base-sibling-plugin-file-private',
  'rpp-0453-shared-sibling-plugin-file-private',
  'rpp-0453-stale-sibling-plugin-file-private',
  'rpp-0453-base-option-private',
  'rpp-0453-local-option-private',
]);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}

function targetPluginFileResource() {
  return {
    type: 'file',
    path: targetPluginFilePath,
    key: targetPluginFileResourceKey,
  };
}

function siblingPluginFileResource() {
  return {
    type: 'file',
    path: siblingPluginFilePath,
    key: siblingPluginFileResourceKey,
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

function baseSite({
  targetFileMode = rawSentinels[0],
  siblingFileMode = rawSentinels[2],
  optionMode = rawSentinels[5],
} = {}) {
  return {
    files: {
      [targetPluginFilePath]: `<?php /* ${targetFileMode} */`,
      [siblingPluginFilePath]: `<?php /* ${siblingFileMode} */`,
    },
    plugins: {
      [ownerPlugin]: {
        version: '1.0.0',
        active: true,
      },
    },
    db: {
      wp_options: {
        [optionRowId]: {
          option_name: optionName,
          option_value: {
            mode: optionMode,
            nested: {
              proof: 'rpp-0453-local-plugin-driver-support',
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
      evidenceScope: 'local-plugin-driver-support-v3',
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

function attachOptionPolicy(site, extra = {}) {
  site.meta = {
    evidenceScope: 'local-plugin-driver-support-v3',
    pushPolicy: pluginOwnedResourcePolicy(allowedOptionResource(extra)),
  };
  return site;
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

function decisionFor(plan, resourceKey) {
  return plan.decisions.find((decision) => decision.resourceKey === resourceKey);
}

function preconditionFor(plan, resourceKey) {
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

function applyRefusal(remote, plan, label) {
  const before = cloneJson(remote);
  let beforeMutationCalls = 0;
  const error = captureError(() => applyPlan(remote, plan, {
    mutateRemote: true,
    beforeMutation() {
      beforeMutationCalls += 1;
    },
  }));

  const refusal = {
    error,
    before,
    beforeMutationCalls,
    remoteHashBefore: sha256Evidence(before),
    remoteHashAfter: sha256Evidence(remote),
    optionHashBefore: `sha256:${resourceHash(before, optionResource())}`,
    optionHashAfter: `sha256:${resourceHash(remote, optionResource())}`,
    targetFileHashBefore: `sha256:${resourceHash(before, targetPluginFileResource())}`,
    targetFileHashAfter: `sha256:${resourceHash(remote, targetPluginFileResource())}`,
    siblingFileHashBefore: `sha256:${resourceHash(before, siblingPluginFileResource())}`,
    siblingFileHashAfter: `sha256:${resourceHash(remote, siblingPluginFileResource())}`,
  };

  assert.equal(beforeMutationCalls, 0, `${label} reached mutation hook`);
  assert.deepEqual(remote, before, `${label} mutated remote`);
  assert.equal(refusal.remoteHashAfter, refusal.remoteHashBefore, `${label} changed remote hash`);
  assert.equal(refusal.optionHashAfter, refusal.optionHashBefore, `${label} changed plugin-owned option hash`);

  return refusal;
}

function tamperReadyPlan(plan, mutate) {
  const copy = cloneJson(plan);
  mutate(copy);
  copy.status = 'ready';
  copy.blockers = [];
  copy.conflicts = [];
  copy.summary = {
    ...copy.summary,
    mutations: copy.mutations.length,
    blockers: 0,
    conflicts: 0,
    decisions: copy.decisions.length,
  };
  return copy;
}

function assertSha256(value, label) {
  assert.match(value, sha256HexPattern, `${label} should be a SHA-256 hash`);
}

function assertSha256Evidence(value, label) {
  assert.match(value, sha256EvidencePattern, `${label} should be a sha256-prefixed hash`);
}

function assertHashOnlyEvidence(value, label) {
  const json = JSON.stringify(value);
  for (const sentinel of rawSentinels) {
    assert.equal(json.includes(sentinel), false, `${label} leaked raw sentinel ${sentinel}`);
  }
  assert.equal(json.includes('option_value'), false, `${label} leaked option_value`);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(value, { label }));
}

function assertOwnerFileRefusalEvidence(evidence, resourceKey) {
  assert.equal(evidence.reasonCode, 'STALE_PLUGIN_FILE_OWNER_CONTEXT');
  assert.equal(evidence.operation, 'refuse-before-mutation');
  assert.equal(evidence.resourceKey, resourceKey);
  assert.equal(evidence.pluginOwner, ownerPlugin);
  assert.deepEqual(evidence.stalePluginFileResourceKeys, [siblingPluginFileResourceKey]);
  assert.equal(evidence.context.length, 1);
  assert.equal(evidence.context[0].resourceKey, siblingPluginFileResourceKey);
  assert.equal(evidence.context[0].localChange, 'unchanged');
  assert.equal(evidence.context[0].remoteChange, 'update');
  assertSha256(evidence.context[0].baseHash, 'stale owner file base hash');
  assertSha256(evidence.context[0].localHash, 'stale owner file local hash');
  assertSha256(evidence.context[0].remoteHash, 'stale owner file remote hash');
  assert.equal(evidence.context[0].baseHash, evidence.context[0].localHash);
  assert.notEqual(evidence.context[0].remoteHash, evidence.context[0].baseHash);
}

test('RPP-0453 applies one allowed plugin file mutation when owner file context is current', () => {
  const base = baseSite();
  const local = baseSite({
    targetFileMode: rawSentinels[1],
    siblingFileMode: rawSentinels[3],
  });
  const remote = baseSite({
    siblingFileMode: rawSentinels[3],
  });
  const optionHashBefore = `sha256:${resourceHash(remote, optionResource())}`;
  const targetFileHashBefore = `sha256:${resourceHash(remote, targetPluginFileResource())}`;
  const mutationOrder = [];

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, targetPluginFileResourceKey);
  const siblingDecision = decisionFor(plan, siblingPluginFileResourceKey);
  const result = applyPlan(remote, plan, {
    mutateRemote: true,
    beforeMutation({ mutation: appliedMutation }) {
      mutationOrder.push(appliedMutation.resourceKey);
    },
  });
  const proof = {
    rpp: 'RPP-0453',
    evidenceSource: 'local-plugin-driver-support-owner-context-stale-plugin-file-v3',
    productionBacked: false,
    releaseGate: 'NO-GO',
    rawValuesIncluded: false,
    allowedPluginFileApply: {
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
      siblingDecisionHash: sha256Evidence(siblingDecision),
      targetFileHashBefore,
      targetFileHashAfter: `sha256:${resourceHash(remote, targetPluginFileResource())}`,
      siblingFileHashAfter: `sha256:${resourceHash(remote, siblingPluginFileResource())}`,
      pluginOwnedOptionHashBefore: optionHashBefore,
      pluginOwnedOptionHashAfter: `sha256:${resourceHash(remote, optionResource())}`,
      appliedMutations: result.appliedMutations,
      mutationOrderHash: sha256Evidence(mutationOrder),
      journalHash: sha256Evidence(result.journal),
    },
  };
  proof.proofHash = sha256Evidence(proof.allowedPluginFileApply);

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
  assert.equal(mutation.resourceKey, targetPluginFileResourceKey);
  assert.equal(preconditionFor(plan, targetPluginFileResourceKey).expectedHash, mutation.remoteBeforeHash);
  assert.equal(siblingDecision.decision, 'already-in-sync');
  assert.equal(siblingDecision.resourceKey, siblingPluginFileResourceKey);
  assert.equal(siblingDecision.change.localChange, 'update');
  assert.equal(siblingDecision.change.remoteChange, 'update');
  assert.deepEqual(mutationOrder, [targetPluginFileResourceKey]);
  assert.equal(result.site, remote);
  assert.equal(result.appliedMutations, 1);
  assert.equal(remote.files[targetPluginFilePath], `<?php /* ${rawSentinels[1]} */`);
  assert.equal(remote.files[siblingPluginFilePath], `<?php /* ${rawSentinels[3]} */`);
  assert.equal(`sha256:${resourceHash(remote, optionResource())}`, optionHashBefore);
  assert.notEqual(`sha256:${resourceHash(remote, targetPluginFileResource())}`, targetFileHashBefore);
  assertSha256Evidence(proof.allowedPluginFileApply.mutationHash, 'RPP-0453 plugin file mutation hash');
  assertSha256Evidence(proof.allowedPluginFileApply.siblingDecisionHash, 'RPP-0453 sibling decision hash');
  assertSha256Evidence(proof.allowedPluginFileApply.pluginOwnedOptionHashBefore, 'RPP-0453 option before hash');
  assertSha256Evidence(proof.allowedPluginFileApply.pluginOwnedOptionHashAfter, 'RPP-0453 option after hash');
  assertSha256Evidence(proof.proofHash, 'RPP-0453 allowed plugin file proof hash');
  assertHashOnlyEvidence(result.journal, 'RPP-0453 allowed plugin file journal');
  assertHashOnlyEvidence(proof, 'RPP-0453 allowed plugin file proof');
});

test('RPP-0453 stale owner plugin file blocks plugin file and checked plugin-driver mutations before apply', () => {
  const base = baseSite();
  const local = attachOptionPolicy(baseSite({
    targetFileMode: rawSentinels[1],
    optionMode: rawSentinels[6],
  }));
  const remote = baseSite({
    siblingFileMode: rawSentinels[4],
  });
  const remoteBeforeJson = JSON.stringify(remote);
  const remoteHashBefore = sha256Evidence(remote);
  const optionHashBefore = `sha256:${resourceHash(remote, optionResource())}`;

  const plan = planFor(base, local, remote);
  const pluginFileBlocker = blockerFor(plan, targetPluginFileResourceKey);
  const optionBlocker = blockerFor(plan, optionResourceKey);
  const siblingDecision = decisionFor(plan, siblingPluginFileResourceKey);
  const refusal = applyRefusal(remote, plan, 'RPP-0453 stale planner refusal');
  const proof = {
    rpp: 'RPP-0453',
    evidenceSource: 'local-plugin-driver-support-stale-owner-file-planner-v3',
    productionBacked: false,
    releaseGate: 'NO-GO',
    rawValuesIncluded: false,
    stalePlanner: {
      status: plan.status,
      mutationCount: plan.summary.mutations,
      decisionCount: plan.summary.decisions,
      blockerCount: plan.summary.blockers,
      pluginFileBlockerHash: sha256Evidence(pluginFileBlocker),
      optionBlockerHash: sha256Evidence(optionBlocker),
      pluginFileRefusalHash: sha256Evidence(pluginFileBlocker.ownerFileRefusalEvidence),
      optionOwnerFileRefusalHash: sha256Evidence(optionBlocker.ownerFileRefusalEvidence),
      optionDriverAuditHash: sha256Evidence(optionBlocker.driverAuditEvidence),
      siblingDecisionHash: sha256Evidence(siblingDecision),
      blockedApplyCode: refusal.error.code,
      blockedApplyDetailsHash: sha256Evidence(refusal.error.details),
      remoteHashBefore,
      remoteHashAfter: refusal.remoteHashAfter,
      pluginOwnedOptionHashBefore: optionHashBefore,
      pluginOwnedOptionHashAfter: refusal.optionHashAfter,
    },
  };
  proof.proofHash = sha256Evidence(proof.stalePlanner);

  assert.equal(plan.status, 'blocked');
  assert.deepEqual(plan.summary, {
    mutations: 0,
    decisions: 1,
    conflicts: 0,
    blockers: 2,
    atomicGroups: 0,
  });
  assert.equal(mutationFor(plan, targetPluginFileResourceKey), undefined);
  assert.equal(mutationFor(plan, optionResourceKey), undefined);
  assert.equal(preconditionFor(plan, targetPluginFileResourceKey), undefined);
  assert.equal(preconditionFor(plan, optionResourceKey), undefined);
  assert.equal(siblingDecision.decision, 'keep-remote');
  assert.equal(pluginFileBlocker.class, 'stale-plugin-owner-context');
  assert.equal(pluginFileBlocker.pluginOwner, ownerPlugin);
  assert.equal(
    pluginFileBlocker.reason,
    `Plugin context resource ${targetPluginFileResourceKey} cannot be applied because live remote plugin context for ${ownerPlugin} changed since the pull base.`,
  );
  assertOwnerFileRefusalEvidence(pluginFileBlocker.ownerFileRefusalEvidence, targetPluginFileResourceKey);

  assert.equal(optionBlocker.class, 'stale-plugin-owner-context');
  assert.equal(optionBlocker.pluginOwner, ownerPlugin);
  assert.equal(optionBlocker.driver, 'wp-option');
  assert.equal(optionBlocker.policySource, 'local-snapshot');
  assert.equal(optionBlocker.driverAuditEvidence.reasonCode, 'PLUGIN_DRIVER_REMOTE_DRIFT_PRESERVED');
  assert.equal(optionBlocker.driverAuditEvidence.decision, 'blocked');
  assert.equal(optionBlocker.driverAuditEvidence.rawValuesIncluded, false);
  assertOwnerFileRefusalEvidence(optionBlocker.ownerFileRefusalEvidence, optionResourceKey);

  assert.ok(refusal.error instanceof PushPlanError);
  assert.equal(refusal.error.code, 'PLAN_NOT_READY');
  assert.equal(JSON.stringify(remote), remoteBeforeJson);
  assert.equal(refusal.remoteHashAfter, remoteHashBefore);
  assert.equal(refusal.optionHashAfter, optionHashBefore);
  assert.equal(remote.db.wp_options[optionRowId].option_value.mode, rawSentinels[5]);
  assertSha256Evidence(proof.stalePlanner.pluginFileBlockerHash, 'RPP-0453 plugin file blocker hash');
  assertSha256Evidence(proof.stalePlanner.optionBlockerHash, 'RPP-0453 option blocker hash');
  assertSha256Evidence(proof.stalePlanner.pluginOwnedOptionHashBefore, 'RPP-0453 option before hash');
  assertSha256Evidence(proof.stalePlanner.pluginOwnedOptionHashAfter, 'RPP-0453 option after hash');
  assertSha256Evidence(proof.proofHash, 'RPP-0453 stale planner proof hash');
  assertHashOnlyEvidence(pluginFileBlocker, 'RPP-0453 plugin file blocker');
  assertHashOnlyEvidence(optionBlocker, 'RPP-0453 plugin-driver blocker');
  assertHashOnlyEvidence(refusal.error.details, 'RPP-0453 blocked apply details');
  assertHashOnlyEvidence(proof, 'RPP-0453 stale planner proof');
});

test('RPP-0453 checked plugin-driver replay refuses stale and forged plugin-file owner context', () => {
  const base = baseSite();
  const local = attachOptionPolicy(baseSite({
    optionMode: rawSentinels[6],
  }), {
    applyValidation: {
      hook: 'wp-option:validate-apply',
      status: 'passed',
    },
  });
  const readyPlan = planFor(base, local, baseSite());
  const readyMutation = mutationFor(readyPlan, optionResourceKey);
  const ownerFileContext = readyMutation.pluginOwnedResource.ownerContext.find(
    (context) => context.resourceKey === siblingPluginFileResourceKey,
  );
  const checkedRemote = baseSite();
  const checkedMutationOrder = [];
  const checkedApply = applyPlan(checkedRemote, readyPlan, {
    mutateRemote: true,
    beforeMutation({ mutation: appliedMutation, driverApplyValidation }) {
      checkedMutationOrder.push({
        resourceKey: appliedMutation.resourceKey,
        driverApplyValidation,
      });
    },
  });
  const checkedDriverApplyValidation = checkedMutationOrder[0].driverApplyValidation;

  const staleRemote = baseSite({
    siblingFileMode: rawSentinels[4],
  });
  const staleRefusal = applyRefusal(staleRemote, readyPlan, 'RPP-0453 stale owner context replay');

  const forgedPlan = tamperReadyPlan(readyPlan, (copy) => {
    const mutation = mutationFor(copy, optionResourceKey);
    mutation.pluginOwnedResource.ownerContext = mutation.pluginOwnedResource.ownerContext.map((context) => (
      context.resourceKey === siblingPluginFileResourceKey
        ? { ...context, remoteHash: '0'.repeat(64) }
        : context
    ));
    mutation.pluginOwnedResource.auditEvidence.ownerContextHash = digest(
      mutation.pluginOwnedResource.ownerContext,
    );
  });
  const forgedRemote = baseSite();
  const forgedRefusal = applyRefusal(forgedRemote, forgedPlan, 'RPP-0453 forged owner context replay');

  const proof = {
    rpp: 'RPP-0453',
    evidenceSource: 'local-plugin-driver-support-stale-forged-owner-file-replay-v3',
    productionBacked: false,
    releaseGate: 'NO-GO',
    rawValuesIncluded: false,
    checkedPluginDriver: {
      status: readyPlan.status,
      mutationCount: readyPlan.summary.mutations,
      blockerCount: readyPlan.summary.blockers,
      preconditionCount: readyPlan.preconditions.length,
      mutationHash: sha256Evidence({
        resourceKey: readyMutation.resourceKey,
        action: readyMutation.action,
        baseHash: readyMutation.baseHash,
        localHash: readyMutation.localHash,
        remoteBeforeHash: readyMutation.remoteBeforeHash,
      }),
      ownerContextHash: sha256Evidence(readyMutation.pluginOwnedResource.ownerContext),
      applyValidationEvidenceHash: sha256Evidence(readyMutation.pluginOwnedResource.applyValidationEvidence),
      driverApplyValidationHash: sha256Evidence(checkedDriverApplyValidation),
      appliedMutations: checkedApply.appliedMutations,
      optionHashAfter: `sha256:${resourceHash(checkedRemote, optionResource())}`,
      journalHash: sha256Evidence(checkedApply.journal),
    },
    staleOwnerFileReplay: {
      code: staleRefusal.error.code,
      detailsHash: sha256Evidence(staleRefusal.error.details),
      refusedBeforeMutation: staleRefusal.beforeMutationCalls === 0,
      expectedHashMatchesReadyContext: staleRefusal.error.details.expectedHash === ownerFileContext.remoteHash,
      actualHashDiffersFromReadyContext: staleRefusal.error.details.actualHash !== ownerFileContext.remoteHash,
      remoteHashBefore: staleRefusal.remoteHashBefore,
      remoteHashAfter: staleRefusal.remoteHashAfter,
      pluginOwnedOptionHashBefore: staleRefusal.optionHashBefore,
      pluginOwnedOptionHashAfter: staleRefusal.optionHashAfter,
    },
    forgedOwnerFileReplay: {
      code: forgedRefusal.error.code,
      detailsHash: sha256Evidence(forgedRefusal.error.details),
      refusedBeforeMutation: forgedRefusal.beforeMutationCalls === 0,
      contextResourceKey: forgedRefusal.error.details.contextResourceKey,
      remoteHashBefore: forgedRefusal.remoteHashBefore,
      remoteHashAfter: forgedRefusal.remoteHashAfter,
      pluginOwnedOptionHashBefore: forgedRefusal.optionHashBefore,
      pluginOwnedOptionHashAfter: forgedRefusal.optionHashAfter,
    },
  };
  proof.proofHash = sha256Evidence({
    checkedPluginDriver: proof.checkedPluginDriver,
    staleOwnerFileReplay: proof.staleOwnerFileReplay,
    forgedOwnerFileReplay: proof.forgedOwnerFileReplay,
  });

  assert.equal(readyPlan.status, 'ready');
  assert.deepEqual(readyPlan.summary, {
    mutations: 1,
    decisions: 0,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.equal(readyPlan.preconditions.length, 1);
  assert.equal(readyMutation.action, 'put');
  assert.equal(readyMutation.pluginOwnedResource.pluginOwner, ownerPlugin);
  assert.equal(readyMutation.pluginOwnedResource.driver, 'wp-option');
  assert.equal(readyMutation.pluginOwnedResource.policySource, 'local-snapshot');
  assert.equal(readyMutation.pluginOwnedResource.ownerContextRequired, true);
  assert.equal(readyMutation.pluginOwnedResource.auditEvidence.format, 'hash-only');
  assert.equal(readyMutation.pluginOwnedResource.auditEvidence.rawValuesIncluded, false);
  assert.equal(readyMutation.pluginOwnedResource.auditEvidence.driver, 'wp-option');
  assert.equal(
    readyMutation.pluginOwnedResource.auditEvidence.ownerContextHash,
    digest(readyMutation.pluginOwnedResource.ownerContext),
  );
  assert.equal(readyMutation.pluginOwnedResource.driverAuditEvidence.reasonCode, 'PLUGIN_DRIVER_DECISION_SUPPORTED');
  assert.equal(readyMutation.pluginOwnedResource.driverAuditEvidence.rawValuesIncluded, false);
  assert.equal(readyMutation.pluginOwnedResource.applyValidationEvidence.reasonCode, 'PLUGIN_DRIVER_APPLY_VALIDATION_PASSED');
  assert.ok(ownerFileContext);
  assert.equal(ownerFileContext.resourceKey, siblingPluginFileResourceKey);
  assertSha256(ownerFileContext.remoteHash, 'ready owner file remote hash');

  assert.equal(checkedApply.site, checkedRemote);
  assert.equal(checkedApply.appliedMutations, 1);
  assert.deepEqual(checkedMutationOrder.map((entry) => entry.resourceKey), [optionResourceKey]);
  assert.equal(checkedDriverApplyValidation.reasonCode, 'PLUGIN_DRIVER_APPLY_VALIDATION_ACCEPTED');
  assert.equal(checkedDriverApplyValidation.outcome, 'accepted');
  assert.equal(checkedDriverApplyValidation.resourceKey, optionResourceKey);
  assert.equal(checkedRemote.db.wp_options[optionRowId].option_value.mode, rawSentinels[6]);
  assert.equal(checkedRemote.files[targetPluginFilePath], `<?php /* ${rawSentinels[0]} */`);
  assert.equal(checkedRemote.files[siblingPluginFilePath], `<?php /* ${rawSentinels[2]} */`);

  assert.ok(staleRefusal.error instanceof PushPlanError);
  assert.equal(staleRefusal.error.code, 'STALE_PLUGIN_OWNER_CONTEXT');
  assert.equal(staleRefusal.error.details.resourceKey, optionResourceKey);
  assert.equal(staleRefusal.error.details.pluginOwner, ownerPlugin);
  assert.equal(staleRefusal.error.details.contextResourceKey, siblingPluginFileResourceKey);
  assert.equal(staleRefusal.error.details.expectedHash, ownerFileContext.remoteHash);
  assertSha256(staleRefusal.error.details.actualHash, 'stale replay actual owner file hash');
  assert.notEqual(staleRefusal.error.details.actualHash, ownerFileContext.remoteHash);
  assert.equal(staleRefusal.optionHashAfter, staleRefusal.optionHashBefore);
  assert.equal(staleRemote.db.wp_options[optionRowId].option_value.mode, rawSentinels[5]);

  assert.ok(forgedRefusal.error instanceof PushPlanError);
  assert.equal(forgedRefusal.error.code, 'STALE_PLUGIN_OWNER_CONTEXT');
  assert.equal(forgedRefusal.error.details.resourceKey, optionResourceKey);
  assert.equal(forgedRefusal.error.details.pluginOwner, ownerPlugin);
  assert.equal(forgedRefusal.error.details.contextResourceKey, siblingPluginFileResourceKey);
  assert.equal(forgedRefusal.error.details.expectedHash, '0'.repeat(64));
  assertSha256(forgedRefusal.error.details.actualHash, 'forged replay actual owner file hash');
  assert.notEqual(forgedRefusal.error.details.actualHash, '0'.repeat(64));
  assert.equal(forgedRefusal.optionHashAfter, forgedRefusal.optionHashBefore);
  assert.equal(forgedRemote.db.wp_options[optionRowId].option_value.mode, rawSentinels[5]);

  for (const hash of [
    proof.checkedPluginDriver.mutationHash,
    proof.checkedPluginDriver.ownerContextHash,
    proof.checkedPluginDriver.applyValidationEvidenceHash,
    proof.checkedPluginDriver.driverApplyValidationHash,
    proof.checkedPluginDriver.optionHashAfter,
    proof.staleOwnerFileReplay.detailsHash,
    proof.staleOwnerFileReplay.remoteHashBefore,
    proof.staleOwnerFileReplay.remoteHashAfter,
    proof.staleOwnerFileReplay.pluginOwnedOptionHashBefore,
    proof.staleOwnerFileReplay.pluginOwnedOptionHashAfter,
    proof.forgedOwnerFileReplay.detailsHash,
    proof.forgedOwnerFileReplay.remoteHashBefore,
    proof.forgedOwnerFileReplay.remoteHashAfter,
    proof.forgedOwnerFileReplay.pluginOwnedOptionHashBefore,
    proof.forgedOwnerFileReplay.pluginOwnedOptionHashAfter,
    proof.proofHash,
  ]) {
    assertSha256Evidence(hash, 'RPP-0453 replay proof hash');
  }
  assertHashOnlyEvidence(readyMutation.pluginOwnedResource.auditEvidence, 'RPP-0453 checked audit evidence');
  assertHashOnlyEvidence(readyMutation.pluginOwnedResource.driverAuditEvidence, 'RPP-0453 checked driver audit evidence');
  assertHashOnlyEvidence(checkedDriverApplyValidation, 'RPP-0453 checked apply validation evidence');
  assertHashOnlyEvidence(checkedApply.journal, 'RPP-0453 checked apply journal');
  assertHashOnlyEvidence(staleRefusal.error.details, 'RPP-0453 stale replay details');
  assertHashOnlyEvidence(forgedRefusal.error.details, 'RPP-0453 forged replay details');
  assertHashOnlyEvidence(proof, 'RPP-0453 stale and forged replay proof');
});
