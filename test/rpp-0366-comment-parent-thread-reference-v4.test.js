import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue, resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const sha256Pattern = /^[a-f0-9]{64}$/;

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "base";',
    },
    plugins: {},
    db: {
      wp_posts: {
        'ID:1': {
          ID: 1,
          post_title: 'Base RPP-0366 post',
          post_status: 'publish',
          post_type: 'post',
        },
      },
      wp_comments: {},
    },
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function rowResource(table, id) {
  return {
    type: 'row',
    table,
    id,
    key: rowResourceKey(table, id),
  };
}

function rowResourceKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function decisionFor(plan, resourceKey) {
  return plan.decisions.find((decision) => decision.resourceKey === resourceKey);
}

function preconditionFor(plan, resourceKey) {
  return plan.preconditions.find((precondition) => precondition.resourceKey === resourceKey);
}

function assertSha256(value, label) {
  assert.match(value, sha256Pattern, label);
}

function assertSummaryMatchesPlan(plan, label) {
  assert.deepEqual(
    plan.summary,
    {
      mutations: plan.mutations.length,
      decisions: plan.decisions.length,
      conflicts: plan.conflicts.length,
      blockers: plan.blockers.length,
      atomicGroups: plan.atomicGroups.length,
    },
    `${label} summary must match emitted entries`,
  );
}

function assertEveryMutationHasLiveRemotePrecondition(plan, remote, label) {
  assert.equal(plan.preconditions.length, plan.mutations.length, `${label} precondition count`);
  for (const mutation of plan.mutations) {
    const precondition = plan.preconditions.find((entry) => entry.mutationId === mutation.id);
    assert.ok(precondition, `${label} missing precondition for ${mutation.id}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey, `${label} precondition resource key`);
    assert.deepEqual(precondition.resource, mutation.resource, `${label} precondition resource`);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash, `${label} precondition hash`);
    assert.equal(precondition.checkedAgainst, 'live-remote', `${label} precondition scope`);
    assert.equal(
      resourceHash(remote, mutation.resource),
      mutation.remoteBeforeHash,
      `${label} mutation ${mutation.resourceKey} remote hash must bind to dry-run remote`,
    );
    assertSha256(mutation.baseHash, `${label} mutation ${mutation.resourceKey} base hash`);
    assertSha256(mutation.localHash, `${label} mutation ${mutation.resourceKey} local hash`);
    assertSha256(mutation.remoteBeforeHash, `${label} mutation ${mutation.resourceKey} remote hash`);
  }
}

function hashOnlyChangeEvidence(change) {
  return {
    localChange: change.localChange,
    remoteChange: change.remoteChange,
    base: { state: change.base.state, hash: change.base.hash },
    local: { state: change.local.state, hash: change.local.hash },
    remote: { state: change.remote.state, hash: change.remote.hash },
  };
}

function hashOnlyMutationEvidence(mutation) {
  return {
    id: mutation.id,
    resourceKey: mutation.resourceKey,
    action: mutation.action,
    changeKind: mutation.changeKind,
    baseHash: mutation.baseHash,
    localHash: mutation.localHash,
    remoteBeforeHash: mutation.remoteBeforeHash,
    change: hashOnlyChangeEvidence(mutation.change),
  };
}

function hashOnlyDecisionEvidence(decision) {
  return {
    id: decision.id,
    resourceKey: decision.resourceKey,
    decision: decision.decision,
    baseHash: decision.baseHash,
    localHash: decision.localHash || decision.change.local.hash,
    remoteHash: decision.remoteHash,
    targetResourceKey: decision.targetResourceKey || null,
    targetRemoteHash: decision.targetRemoteHash || null,
    change: hashOnlyChangeEvidence(decision.change),
  };
}

function hashOnlyPreconditionEvidence(precondition) {
  return {
    mutationId: precondition.mutationId,
    resourceKey: precondition.resourceKey,
    expectedHash: precondition.expectedHash,
    checkedAgainst: precondition.checkedAgainst,
  };
}

function assertHashOnlyEvidenceRedacted(evidence, forbiddenValues, label) {
  const serialized = JSON.stringify(evidence);
  for (const forbiddenValue of forbiddenValues) {
    assert.equal(serialized.includes(forbiddenValue), false, `${label} leaked raw value ${forbiddenValue}`);
  }
}

function assertHashOnlyEvidenceHashes(evidence, label) {
  for (const [key, value] of Object.entries(evidence)) {
    if (typeof value === 'string' && /hash/i.test(key)) {
      assertSha256(value, `${label} ${key}`);
    } else if (value && typeof value === 'object') {
      assertHashOnlyEvidenceHashes(value, `${label} ${key}`);
    }
  }
}

test('RPP-0366 proves stable comment parent targets with hash-only evidence', () => {
  const parentId = 'comment_ID:36601';
  const childId = 'comment_ID:36602';
  const parentResource = rowResource('wp_comments', parentId);
  const parentResourceKey = parentResource.key;
  const childResourceKey = rowResourceKey('wp_comments', childId);
  const parentContent = 'stable-parent-rpp0366-fixture-content';
  const childContent = 'local-child-rpp0366-stable-fixture-content';
  const base = baseSite();
  base.db.wp_comments[parentId] = {
    comment_ID: 36601,
    comment_post_ID: 1,
    comment_parent: 0,
    user_id: 0,
    comment_content: parentContent,
  };
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.db.wp_comments[childId] = {
    comment_ID: 36602,
    comment_post_ID: 1,
    comment_parent: 36601,
    user_id: 0,
    comment_content: childContent,
  };

  const plan = planFor(base, local, remote);
  const childMutation = mutationFor(plan, childResourceKey);
  const childPrecondition = preconditionFor(plan, childResourceKey);

  assert.equal(plan.status, 'ready');
  assertSummaryMatchesPlan(plan, 'RPP-0366 stable parent');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(plan.summary.conflicts, 0);
  assert.equal(plan.summary.mutations, 1);
  assert.equal(decisionFor(plan, parentResourceKey), undefined);
  assert.ok(childMutation, 'missing child comment mutation');
  assert.ok(childPrecondition, 'missing child comment live-remote precondition');

  const result = applyPlan(remote, plan);
  const plannedChild = deserializeResourceValue(childMutation.value);
  const parentTargetHashes = {
    baseHash: resourceHash(base, parentResource),
    localHash: resourceHash(local, parentResource),
    remoteHash: resourceHash(remote, parentResource),
  };
  const hashOnlyEvidence = {
    rpp: 'RPP-0366',
    behavior: 'stable comment parent target',
    status: plan.status,
    summary: plan.summary,
    parentTarget: {
      resourceKey: parentResourceKey,
      relationshipKey: 'wp_comments.comment_parent',
      relationshipType: 'comment-parent',
      ...parentTargetHashes,
      stableRemoteIdentity: parentTargetHashes.baseHash === parentTargetHashes.remoteHash,
      stableLocalIdentity: parentTargetHashes.localHash === parentTargetHashes.remoteHash,
    },
    childMutation: hashOnlyMutationEvidence(childMutation),
    childPrecondition: hashOnlyPreconditionEvidence(childPrecondition),
    rewriteCount: childMutation.wordpressGraphIdentity?.rewrites?.length || 0,
  };
  hashOnlyEvidence.proofHash = digest(hashOnlyEvidence);

  assert.equal(childMutation.changeKind, 'create');
  assert.equal(plannedChild.comment_parent, 36601);
  assert.equal(childMutation.wordpressGraphIdentity?.rewrites?.length || 0, 0);
  assert.equal(parentTargetHashes.baseHash, parentTargetHashes.remoteHash);
  assert.equal(parentTargetHashes.localHash, parentTargetHashes.remoteHash);
  assertEveryMutationHasLiveRemotePrecondition(plan, remote, 'RPP-0366 stable parent');
  assertHashOnlyEvidenceHashes(hashOnlyEvidence, 'RPP-0366 stable parent evidence');
  assertHashOnlyEvidenceRedacted(hashOnlyEvidence, [parentContent, childContent], 'RPP-0366 stable parent evidence');
  assert.equal(result.site.db.wp_comments[parentId].comment_content, parentContent);
  assert.equal(result.site.db.wp_comments[childId].comment_parent, 36601);
});

test('RPP-0366 rewrites mapped comment parent targets with hash-only rewrite evidence', () => {
  const sourceParentId = 'comment_ID:36611';
  const targetParentId = 'comment_ID:46611';
  const childId = 'comment_ID:36612';
  const sourceParentResourceKey = rowResourceKey('wp_comments', sourceParentId);
  const targetParentResourceKey = rowResourceKey('wp_comments', targetParentId);
  const childResourceKey = rowResourceKey('wp_comments', childId);
  const parentContent = 'mapped-parent-rpp0366-fixture-content';
  const childContent = 'mapped-child-rpp0366-fixture-content';
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.meta = {
    wordpressGraphIdentityMap: {
      rows: [
        {
          table: 'wp_comments',
          localId: sourceParentId,
          remoteId: targetParentId,
        },
      ],
    },
  };
  local.db.wp_comments[sourceParentId] = {
    comment_ID: 36611,
    comment_post_ID: 1,
    comment_parent: 0,
    user_id: 0,
    comment_content: parentContent,
  };
  remote.db.wp_comments[targetParentId] = {
    comment_ID: 46611,
    comment_post_ID: 1,
    comment_parent: 0,
    user_id: 0,
    comment_content: parentContent,
  };
  local.db.wp_comments[childId] = {
    comment_ID: 36612,
    comment_post_ID: 1,
    comment_parent: 36611,
    user_id: 0,
    comment_content: childContent,
  };

  const plan = planFor(base, local, remote);
  const childMutation = mutationFor(plan, childResourceKey);
  const childPrecondition = preconditionFor(plan, childResourceKey);
  const sourceParentDecision = decisionFor(plan, sourceParentResourceKey);
  const targetParentDecision = decisionFor(plan, targetParentResourceKey);

  assert.equal(plan.status, 'ready');
  assertSummaryMatchesPlan(plan, 'RPP-0366 mapped parent');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(plan.summary.conflicts, 0);
  assert.ok(childMutation, 'missing mapped child comment mutation');
  assert.ok(childPrecondition, 'missing mapped child live-remote precondition');
  assert.ok(sourceParentDecision, 'missing source parent graph identity decision');
  assert.ok(targetParentDecision, 'missing target parent keep-remote decision');

  const result = applyPlan(remote, plan);
  const plannedChild = deserializeResourceValue(childMutation.value);
  const parentRewrite = childMutation.wordpressGraphIdentity?.rewrites.find((rewrite) =>
    rewrite.relationshipType === 'comment-parent');
  assert.ok(parentRewrite, 'missing comment_parent identity rewrite evidence');

  const hashOnlyEvidence = {
    rpp: 'RPP-0366',
    behavior: 'mapped comment parent target rewrite',
    status: plan.status,
    summary: plan.summary,
    sourceParentDecision: hashOnlyDecisionEvidence(sourceParentDecision),
    targetParentDecision: hashOnlyDecisionEvidence(targetParentDecision),
    childMutation: hashOnlyMutationEvidence(childMutation),
    childPrecondition: hashOnlyPreconditionEvidence(childPrecondition),
    parentRewrite: {
      relationshipKey: parentRewrite.relationshipKey,
      relationshipType: parentRewrite.relationshipType,
      field: parentRewrite.field,
      sourceResourceKey: parentRewrite.sourceResourceKey,
      sourceTargetResourceKey: parentRewrite.sourceTargetResourceKey,
      targetResourceKey: parentRewrite.targetResourceKey,
      rewrittenResourceKey: parentRewrite.rewrittenResourceKey,
      identityMapSource: parentRewrite.identityMapSource,
      sourceTargetLocalHash: parentRewrite.sourceTargetLocalHash,
      targetRemoteHash: parentRewrite.targetRemoteHash,
    },
  };
  hashOnlyEvidence.proofHash = digest(hashOnlyEvidence);

  assert.equal(sourceParentDecision.decision, 'map-local-identity-to-remote');
  assert.equal(sourceParentDecision.targetResourceKey, targetParentResourceKey);
  assert.equal(targetParentDecision.decision, 'keep-remote');
  assert.equal(childMutation.changeKind, 'create');
  assert.equal(plannedChild.comment_parent, 46611);
  assert.equal(parentRewrite.relationshipKey, 'wp_comments.comment_parent');
  assert.equal(parentRewrite.field, 'comment_parent');
  assert.equal(parentRewrite.sourceTargetResourceKey, sourceParentResourceKey);
  assert.equal(parentRewrite.targetResourceKey, targetParentResourceKey);
  assertSha256(parentRewrite.sourceTargetLocalHash, 'RPP-0366 mapped parent source target local hash');
  assertSha256(parentRewrite.targetRemoteHash, 'RPP-0366 mapped parent target remote hash');
  assertEveryMutationHasLiveRemotePrecondition(plan, remote, 'RPP-0366 mapped parent');
  assertHashOnlyEvidenceHashes(hashOnlyEvidence, 'RPP-0366 mapped parent evidence');
  assertHashOnlyEvidenceRedacted(hashOnlyEvidence, [parentContent, childContent], 'RPP-0366 mapped parent evidence');
  assertHashOnlyEvidenceRedacted(
    childMutation.wordpressGraphIdentity,
    [parentContent, childContent],
    'RPP-0366 emitted rewrite evidence',
  );
  assert.equal(result.site.db.wp_comments[sourceParentId], undefined);
  assert.equal(result.site.db.wp_comments[targetParentId].comment_content, parentContent);
  assert.equal(result.site.db.wp_comments[childId].comment_parent, 46611);
});
