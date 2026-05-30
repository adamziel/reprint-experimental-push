import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue, resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T13:26:00.000Z');
const sha256Pattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

const rawFixtures = Object.freeze([
  'rpp-0326-private-stable-parent-comment',
  'rpp-0326-private-stable-child-comment',
  'rpp-0326-private-mapped-parent-comment',
  'rpp-0326-private-mapped-child-comment',
  'rpp-0326-private-stale-parent-comment',
  'rpp-0326-private-stale-child-comment',
  'rpp-0326-private-remote-edited-parent-comment',
]);

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
          post_title: 'RPP-0326 base post',
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
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey) || null;
}

function decisionFor(plan, resourceKey) {
  return plan.decisions.find((decision) => decision.resourceKey === resourceKey) || null;
}

function preconditionFor(plan, mutation) {
  return plan.preconditions.find((precondition) => precondition.mutationId === mutation?.id) || null;
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}

function captureError(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  assert.fail('Expected callback to throw');
}

function assertSha256(value, label) {
  assert.match(value, sha256Pattern, label);
}

function assertSha256Evidence(value, label) {
  assert.match(value, sha256EvidencePattern, label);
}

function assertEveryMutationHasLiveRemotePrecondition(plan, remote, label) {
  assert.equal(plan.preconditions.length, plan.mutations.length, `${label} precondition count`);
  for (const mutation of plan.mutations) {
    const precondition = preconditionFor(plan, mutation);
    assert.ok(precondition, `${label} missing live precondition for ${mutation.resourceKey}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey);
    assert.deepEqual(precondition.resource, mutation.resource);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.equal(precondition.checkedAgainst, 'live-remote');
    assert.equal(
      resourceHash(remote, mutation.resource),
      mutation.remoteBeforeHash,
      `${label} remote hash must bind to dry-run remote for ${mutation.resourceKey}`,
    );
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

function mutationEvidence(mutation) {
  return {
    id: mutation.id,
    resourceKey: mutation.resourceKey,
    action: mutation.action,
    changeKind: mutation.changeKind,
    baseHash: mutation.baseHash,
    localHash: mutation.localHash,
    remoteBeforeHash: mutation.remoteBeforeHash,
    change: hashOnlyChangeEvidence(mutation.change),
    mutationHash: sha256Evidence({
      id: mutation.id,
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      changeKind: mutation.changeKind,
      baseHash: mutation.baseHash,
      localHash: mutation.localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      rewrites: mutation.wordpressGraphIdentity?.rewrites || [],
    }),
  };
}

function decisionEvidence(decision) {
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
    decisionHash: sha256Evidence({
      id: decision.id,
      resourceKey: decision.resourceKey,
      decision: decision.decision,
      targetResourceKey: decision.targetResourceKey || null,
      targetRemoteHash: decision.targetRemoteHash || null,
    }),
  };
}

function preconditionEvidence(precondition) {
  return {
    mutationId: precondition.mutationId,
    resourceKey: precondition.resourceKey,
    expectedHash: precondition.expectedHash,
    checkedAgainst: precondition.checkedAgainst,
  };
}

function rewriteEvidence(rewrite) {
  return {
    relationshipKey: rewrite.relationshipKey,
    relationshipType: rewrite.relationshipType,
    field: rewrite.field,
    sourceResourceKey: rewrite.sourceResourceKey,
    sourceTargetResourceKey: rewrite.sourceTargetResourceKey,
    targetResourceKey: rewrite.targetResourceKey,
    rewrittenResourceKey: rewrite.rewrittenResourceKey,
    identityMapSource: rewrite.identityMapSource,
    sourceTargetLocalHash: rewrite.sourceTargetLocalHash,
    targetRemoteHash: rewrite.targetRemoteHash,
    rewriteHash: sha256Evidence({
      relationshipKey: rewrite.relationshipKey,
      relationshipType: rewrite.relationshipType,
      sourceTargetResourceKey: rewrite.sourceTargetResourceKey,
      targetResourceKey: rewrite.targetResourceKey,
      sourceTargetLocalHash: rewrite.sourceTargetLocalHash,
      targetRemoteHash: rewrite.targetRemoteHash,
    }),
  };
}

function assertNoRawFixtures(evidence, label) {
  const serialized = JSON.stringify(evidence);
  for (const rawFixture of rawFixtures) {
    assert.equal(serialized.includes(rawFixture), false, `${label} leaked raw fixture ${rawFixture}`);
  }
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(evidence, { label }));
}

function assertHashEvidenceShape(value, label) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertHashEvidenceShape(entry, `${label}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'string' && /hash$/i.test(key)) {
      if (child.startsWith('sha256:')) {
        assertSha256Evidence(child, `${label}.${key}`);
      } else {
        assertSha256(child, `${label}.${key}`);
      }
    } else {
      assertHashEvidenceShape(child, `${label}.${key}`);
    }
  }
}

function buildStableParentEvidence() {
  const parentId = 'comment_ID:32601';
  const childId = 'comment_ID:32602';
  const parentResource = rowResource('wp_comments', parentId);
  const parentResourceKey = parentResource.key;
  const childResourceKey = rowResourceKey('wp_comments', childId);
  const base = baseSite();
  base.db.wp_comments[parentId] = {
    comment_ID: 32601,
    comment_post_ID: 1,
    comment_parent: 0,
    user_id: 0,
    comment_content: 'rpp-0326-private-stable-parent-comment',
  };
  const local = cloneJson(base);
  const remote = cloneJson(base);
  local.db.wp_comments[childId] = {
    comment_ID: 32602,
    comment_post_ID: 1,
    comment_parent: 32601,
    user_id: 0,
    comment_content: 'rpp-0326-private-stable-child-comment',
  };

  const plan = planFor(base, local, remote);
  const result = applyPlan(cloneJson(remote), plan);
  const childMutation = mutationFor(plan, childResourceKey);
  const childPrecondition = preconditionFor(plan, childMutation);
  const plannedChild = deserializeResourceValue(childMutation.value);
  const parentHashes = {
    baseHash: resourceHash(base, parentResource),
    localHash: resourceHash(local, parentResource),
    remoteHash: resourceHash(remote, parentResource),
  };

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(plan.summary.blockers, 0);
  assert.equal(plan.summary.conflicts, 0);
  assert.equal(decisionFor(plan, parentResourceKey), null);
  assert.equal(childMutation.changeKind, 'create');
  assert.equal(plannedChild.comment_parent, 32601);
  assert.equal(childMutation.wordpressGraphIdentity?.rewrites?.length || 0, 0);
  assert.equal(parentHashes.baseHash, parentHashes.remoteHash);
  assert.equal(parentHashes.localHash, parentHashes.remoteHash);
  assertEveryMutationHasLiveRemotePrecondition(plan, remote, 'RPP-0326 stable parent');
  assert.equal(result.site.db.wp_comments[parentId].comment_content, 'rpp-0326-private-stable-parent-comment');
  assert.equal(result.site.db.wp_comments[childId].comment_parent, 32601);

  return {
    mode: 'stable-parent',
    status: plan.status,
    relationshipKey: 'wp_comments.comment_parent',
    relationshipType: 'comment-parent',
    childResourceKey,
    parentResourceKey,
    expectedCommentParent: 32601,
    plannedCommentParent: plannedChild.comment_parent,
    stableIdentityProven: parentHashes.baseHash === parentHashes.remoteHash
      && parentHashes.localHash === parentHashes.remoteHash,
    rewriteCount: childMutation.wordpressGraphIdentity?.rewrites?.length || 0,
    parentTarget: parentHashes,
    childMutation: mutationEvidence(childMutation),
    childPrecondition: preconditionEvidence(childPrecondition),
    applyJournalHash: sha256Evidence(result.journal),
  };
}

function buildMappedParentEvidence() {
  const sourceParentId = 'comment_ID:32611';
  const targetParentId = 'comment_ID:42611';
  const childId = 'comment_ID:32612';
  const sourceParentResourceKey = rowResourceKey('wp_comments', sourceParentId);
  const targetParentResourceKey = rowResourceKey('wp_comments', targetParentId);
  const childResourceKey = rowResourceKey('wp_comments', childId);
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
    comment_ID: 32611,
    comment_post_ID: 1,
    comment_parent: 0,
    user_id: 0,
    comment_content: 'rpp-0326-private-mapped-parent-comment',
  };
  remote.db.wp_comments[targetParentId] = {
    comment_ID: 42611,
    comment_post_ID: 1,
    comment_parent: 0,
    user_id: 0,
    comment_content: 'rpp-0326-private-mapped-parent-comment',
  };
  local.db.wp_comments[childId] = {
    comment_ID: 32612,
    comment_post_ID: 1,
    comment_parent: 32611,
    user_id: 0,
    comment_content: 'rpp-0326-private-mapped-child-comment',
  };

  const plan = planFor(base, local, remote);
  const result = applyPlan(cloneJson(remote), plan);
  const childMutation = mutationFor(plan, childResourceKey);
  const childPrecondition = preconditionFor(plan, childMutation);
  const plannedChild = deserializeResourceValue(childMutation.value);
  const parentRewrite = childMutation.wordpressGraphIdentity?.rewrites.find((rewrite) =>
    rewrite.relationshipType === 'comment-parent') || null;
  const sourceParentDecision = decisionFor(plan, sourceParentResourceKey);
  const targetParentDecision = decisionFor(plan, targetParentResourceKey);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(plan.summary.conflicts, 0);
  assert.equal(mutationFor(plan, sourceParentResourceKey), null);
  assert.equal(sourceParentDecision.decision, 'map-local-identity-to-remote');
  assert.equal(sourceParentDecision.targetResourceKey, targetParentResourceKey);
  assert.equal(targetParentDecision.decision, 'keep-remote');
  assert.equal(childMutation.changeKind, 'create');
  assert.equal(plannedChild.comment_parent, 42611);
  assert.ok(parentRewrite, 'missing comment_parent identity rewrite evidence');
  assert.equal(parentRewrite.relationshipKey, 'wp_comments.comment_parent');
  assert.equal(parentRewrite.field, 'comment_parent');
  assert.equal(parentRewrite.sourceTargetResourceKey, sourceParentResourceKey);
  assert.equal(parentRewrite.targetResourceKey, targetParentResourceKey);
  assertSha256(parentRewrite.sourceTargetLocalHash, 'RPP-0326 mapped parent source local hash');
  assertSha256(parentRewrite.targetRemoteHash, 'RPP-0326 mapped parent target remote hash');
  assertEveryMutationHasLiveRemotePrecondition(plan, remote, 'RPP-0326 mapped parent');
  assert.equal(result.site.db.wp_comments[sourceParentId], undefined);
  assert.equal(result.site.db.wp_comments[targetParentId].comment_content, 'rpp-0326-private-mapped-parent-comment');
  assert.equal(result.site.db.wp_comments[childId].comment_parent, 42611);

  return {
    mode: 'identity-map-rewrite',
    status: plan.status,
    relationshipKey: 'wp_comments.comment_parent',
    relationshipType: 'comment-parent',
    childResourceKey,
    sourceParentResourceKey,
    targetParentResourceKey,
    expectedCommentParent: 42611,
    plannedCommentParent: plannedChild.comment_parent,
    stableIdentityProven: false,
    identityRewritten: true,
    sourceParentDecision: decisionEvidence(sourceParentDecision),
    targetParentDecision: decisionEvidence(targetParentDecision),
    childMutation: mutationEvidence(childMutation),
    childPrecondition: preconditionEvidence(childPrecondition),
    parentRewrite: rewriteEvidence(parentRewrite),
    applyJournalHash: sha256Evidence(result.journal),
  };
}

function buildStaleParentEvidence() {
  const parentId = 'comment_ID:32621';
  const childId = 'comment_ID:32622';
  const parentResourceKey = rowResourceKey('wp_comments', parentId);
  const childResourceKey = rowResourceKey('wp_comments', childId);
  const base = baseSite();
  base.db.wp_comments[parentId] = {
    comment_ID: 32621,
    comment_post_ID: 1,
    comment_parent: 0,
    user_id: 0,
    comment_content: 'rpp-0326-private-stale-parent-comment',
  };
  const local = cloneJson(base);
  const remote = cloneJson(base);
  local.db.wp_comments[childId] = {
    comment_ID: 32622,
    comment_post_ID: 1,
    comment_parent: 32621,
    user_id: 0,
    comment_content: 'rpp-0326-private-stale-child-comment',
  };
  remote.db.wp_comments[parentId] = {
    ...remote.db.wp_comments[parentId],
    comment_content: 'rpp-0326-private-remote-edited-parent-comment',
  };

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === childResourceKey);
  const reference = blocker?.references.find((entry) =>
    entry.relationshipType === 'comment-parent') || null;
  const replayRemote = cloneJson(remote);
  const remoteBeforeHash = digest(replayRemote);
  let beforeMutationCalls = 0;
  const error = captureError(() => applyPlan(replayRemote, plan, {
    beforeMutation() {
      beforeMutationCalls += 1;
    },
  }));
  const remoteAfterHash = digest(replayRemote);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, childResourceKey), null);
  assert.equal(decisionFor(plan, parentResourceKey).decision, 'keep-remote');
  assert.ok(blocker, 'missing stale parent blocker');
  assert.equal(blocker.class, 'stale-wordpress-graph-identity');
  assert.equal(blocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
  assert.ok(reference, 'missing comment_parent target reference');
  assert.equal(reference.relationshipKey, 'wp_comments.comment_parent');
  assert.equal(reference.sourceResourceKey, childResourceKey);
  assert.equal(reference.targetResourceKey, parentResourceKey);
  assert.equal(reference.targetChange.remoteChange, 'update');
  assert.equal(reference.targetChange.localChange, 'unchanged');
  assert.match(reference.targetBaseHash, sha256Pattern);
  assert.match(reference.targetLocalHash, sha256Pattern);
  assert.match(reference.targetRemoteHash, sha256Pattern);
  assert.notEqual(reference.targetRemoteHash, reference.targetBaseHash);
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(beforeMutationCalls, 0);
  assert.equal(remoteAfterHash, remoteBeforeHash);

  return {
    mode: 'stale-parent-fail-closed',
    status: plan.status,
    relationshipKey: reference.relationshipKey,
    relationshipType: reference.relationshipType,
    childResourceKey,
    parentResourceKey,
    mutationPlanned: false,
    blocker: {
      class: blocker.class,
      resolutionPolicy: blocker.resolutionPolicy,
      baseHash: blocker.baseHash,
      localHash: blocker.localHash,
      remoteHash: blocker.remoteHash,
      change: hashOnlyChangeEvidence(blocker.change),
      blockerHash: sha256Evidence(blocker),
    },
    targetReference: {
      targetResourceKey: reference.targetResourceKey,
      targetBaseHash: reference.targetBaseHash,
      targetLocalHash: reference.targetLocalHash,
      targetRemoteHash: reference.targetRemoteHash,
      targetChangeHash: sha256Evidence(reference.targetChange),
      remoteDiverged: reference.targetRemoteHash !== reference.targetBaseHash,
    },
    refusal: {
      code: error.code,
      beforeMutationCalls,
      preMutationRefusal: beforeMutationCalls === 0,
      remoteBeforeHash,
      remoteAfterHash,
      remoteUnchanged: remoteAfterHash === remoteBeforeHash,
      detailsHash: sha256Evidence(error.details || {}),
    },
  };
}

function buildRpp0326Evidence() {
  const stable = buildStableParentEvidence();
  const mapped = buildMappedParentEvidence();
  const stale = buildStaleParentEvidence();
  const evidence = {
    rpp: 'RPP-0326',
    evidenceSource: 'focused-comment-parent-thread-reference-v2',
    evidenceScope: 'local-focused-planner',
    productionBacked: false,
    releaseGate: 'NO-GO',
    supportOnly: true,
    relationship: {
      key: 'wp_comments.comment_parent',
      type: 'comment-parent',
    },
    coverage: {
      stableParentCases: 1,
      identityMapRewriteCases: 1,
      staleFailClosedCases: 1,
      adjacentPlanner: 'RPP-0306',
      adjacentReleaseVerifier: 'RPP-0386',
    },
    cases: {
      stable,
      mapped,
      stale,
    },
    assertions: {
      stableIdentityProven: stable.stableIdentityProven === true,
      identityMapRewritten: mapped.identityRewritten === true
        && mapped.plannedCommentParent === mapped.expectedCommentParent,
      staleParentBlocked: stale.status === 'blocked'
        && stale.mutationPlanned === false
        && stale.refusal.preMutationRefusal === true,
      liveRemotePreconditions: stable.childPrecondition.checkedAgainst === 'live-remote'
        && mapped.childPrecondition.checkedAgainst === 'live-remote',
      rawValuesIncluded: false,
    },
  };

  return {
    ...evidence,
    ok: Object.values(evidence.assertions).every((entry) => entry === true || entry === false)
      && evidence.assertions.stableIdentityProven
      && evidence.assertions.identityMapRewritten
      && evidence.assertions.staleParentBlocked
      && evidence.assertions.liveRemotePreconditions
      && evidence.assertions.rawValuesIncluded === false,
    proofHash: sha256Evidence(evidence),
  };
}

test('RPP-0326 proves comment parent thread targets are stable, rewritten, or blocked with hash-only evidence', () => {
  const evidence = buildRpp0326Evidence();
  const replay = buildRpp0326Evidence();

  assert.deepEqual(evidence, replay, 'RPP-0326 focused comment parent evidence must be deterministic');
  assert.equal(evidence.rpp, 'RPP-0326');
  assert.equal(evidence.evidenceSource, 'focused-comment-parent-thread-reference-v2');
  assert.equal(evidence.productionBacked, false);
  assert.equal(evidence.releaseGate, 'NO-GO');
  assert.equal(evidence.supportOnly, true);
  assert.equal(evidence.ok, true);
  assert.equal(evidence.relationship.key, 'wp_comments.comment_parent');
  assert.equal(evidence.relationship.type, 'comment-parent');
  assert.deepEqual(evidence.coverage, {
    stableParentCases: 1,
    identityMapRewriteCases: 1,
    staleFailClosedCases: 1,
    adjacentPlanner: 'RPP-0306',
    adjacentReleaseVerifier: 'RPP-0386',
  });
  assert.deepEqual(evidence.assertions, {
    stableIdentityProven: true,
    identityMapRewritten: true,
    staleParentBlocked: true,
    liveRemotePreconditions: true,
    rawValuesIncluded: false,
  });

  assert.equal(evidence.cases.stable.status, 'ready');
  assert.equal(evidence.cases.stable.plannedCommentParent, 32601);
  assert.equal(evidence.cases.stable.rewriteCount, 0);
  assert.equal(evidence.cases.stable.parentTarget.baseHash, evidence.cases.stable.parentTarget.remoteHash);
  assert.equal(evidence.cases.stable.childPrecondition.checkedAgainst, 'live-remote');

  assert.equal(evidence.cases.mapped.status, 'ready');
  assert.equal(evidence.cases.mapped.plannedCommentParent, 42611);
  assert.equal(evidence.cases.mapped.sourceParentDecision.decision, 'map-local-identity-to-remote');
  assert.equal(evidence.cases.mapped.targetParentDecision.decision, 'keep-remote');
  assert.equal(evidence.cases.mapped.parentRewrite.relationshipType, 'comment-parent');
  assert.equal(evidence.cases.mapped.parentRewrite.relationshipKey, 'wp_comments.comment_parent');
  assert.equal(evidence.cases.mapped.childPrecondition.checkedAgainst, 'live-remote');

  assert.equal(evidence.cases.stale.status, 'blocked');
  assert.equal(evidence.cases.stale.blocker.class, 'stale-wordpress-graph-identity');
  assert.equal(evidence.cases.stale.targetReference.remoteDiverged, true);
  assert.equal(evidence.cases.stale.refusal.code, 'PLAN_NOT_READY');
  assert.equal(evidence.cases.stale.refusal.preMutationRefusal, true);
  assert.equal(evidence.cases.stale.refusal.remoteUnchanged, true);

  assertHashEvidenceShape(evidence, 'RPP-0326 evidence');
  assertSha256Evidence(evidence.proofHash, 'RPP-0326 proof hash');
  assertNoRawFixtures(evidence, 'RPP-0326 focused comment parent evidence');
});
