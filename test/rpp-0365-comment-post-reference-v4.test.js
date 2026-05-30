import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { findEvidenceRedactionIssues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "base";',
    },
    plugins: {},
    db: {
      wp_posts: {},
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

function rowResourceKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function decisionFor(plan, resourceKey) {
  return plan.decisions.find((decision) => decision.resourceKey === resourceKey);
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function assertEveryMutationHasLiveRemotePrecondition(plan) {
  for (const mutation of plan.mutations) {
    const precondition = plan.preconditions.find((entry) => entry.mutationId === mutation.id);
    assert.ok(precondition, `missing precondition for ${mutation.resourceKey}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey);
    assert.equal(precondition.checkedAgainst, 'live-remote');
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
  }
}

function assertHashOnlyChangeEvidence(entry, privateValues) {
  for (const hash of [
    entry.baseHash,
    entry.localHash,
    entry.remoteHash,
    entry.change.base.hash,
    entry.change.local.hash,
    entry.change.remote.hash,
  ]) {
    assert.match(hash, hashPattern);
  }
  assert.equal(Object.hasOwn(entry.change.base, 'value'), false);
  assert.equal(Object.hasOwn(entry.change.local, 'value'), false);
  assert.equal(Object.hasOwn(entry.change.remote, 'value'), false);

  const serialized = JSON.stringify(entry);
  for (const privateValue of privateValues) {
    assert.equal(serialized.includes(privateValue), false, `evidence leaked ${privateValue}`);
  }
}

function assertHashOnlyTargetEvidence(reference, privateValues) {
  for (const hash of [
    reference.targetBaseHash,
    reference.targetLocalHash,
    reference.targetRemoteHash,
    reference.targetChange.base.hash,
    reference.targetChange.local.hash,
    reference.targetChange.remote.hash,
  ]) {
    assert.match(hash, hashPattern);
  }
  assert.equal(Object.hasOwn(reference.targetChange.base, 'value'), false);
  assert.equal(Object.hasOwn(reference.targetChange.local, 'value'), false);
  assert.equal(Object.hasOwn(reference.targetChange.remote, 'value'), false);

  const serialized = JSON.stringify(reference);
  for (const privateValue of privateValues) {
    assert.equal(serialized.includes(privateValue), false, `reference leaked ${privateValue}`);
  }
}

test('RPP-0365 rewrites a comment post target through explicit graph identity and applies locally', () => {
  const sourcePostResourceKey = rowResourceKey('wp_posts', 'ID:3651');
  const targetPostResourceKey = rowResourceKey('wp_posts', 'ID:4651');
  const commentResourceKey = rowResourceKey('wp_comments', 'comment_ID:9365');
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.meta = {
    wordpressGraphIdentityMap: {
      rows: [{ table: 'wp_posts', localId: 'ID:3651', remoteId: 'ID:4651' }],
    },
  };
  local.db.wp_posts['ID:3651'] = {
    ID: 3651,
    post_title: 'RPP-0365 mapped comment target',
    post_name: 'rpp0365-mapped-comment-target',
    post_status: 'publish',
    post_type: 'post',
    post_parent: 0,
    post_author: 0,
  };
  remote.db.wp_posts['ID:4651'] = {
    ID: 4651,
    post_title: 'RPP-0365 mapped comment target',
    post_name: 'rpp0365-mapped-comment-target',
    post_status: 'publish',
    post_type: 'post',
    post_parent: 0,
    post_author: 0,
  };
  local.db.wp_comments['comment_ID:9365'] = {
    comment_ID: 9365,
    comment_post_ID: 3651,
    comment_parent: 0,
    user_id: 0,
    comment_content: 'local-private-rpp0365-mapped-comment-body',
  };

  const plan = planFor(base, local, remote);
  const result = applyPlan(cloneJson(remote), plan);
  const commentMutation = mutationFor(plan, commentResourceKey);
  const plannedComment = deserializeResourceValue(commentMutation.value);
  const rewrite = commentMutation.wordpressGraphIdentity?.rewrites.find((entry) =>
    entry.relationshipType === 'comment-post');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(plan.summary.blockers, 0);
  assert.equal(mutationFor(plan, sourcePostResourceKey), undefined);
  assert.equal(decisionFor(plan, sourcePostResourceKey).decision, 'map-local-identity-to-remote');
  assert.equal(decisionFor(plan, targetPostResourceKey).decision, 'keep-remote');
  assert.ok(commentMutation, 'missing rewritten comment mutation');
  assert.equal(commentMutation.changeKind, 'create');
  assert.equal(plannedComment.comment_post_ID, 4651);
  assert.ok(rewrite, 'missing comment-post identity rewrite evidence');
  assert.equal(rewrite.relationshipKey, 'wp_comments.comment_post_ID');
  assert.equal(rewrite.field, 'comment_post_ID');
  assert.equal(rewrite.sourceResourceKey, commentResourceKey);
  assert.equal(rewrite.sourceTargetResourceKey, sourcePostResourceKey);
  assert.equal(rewrite.targetResourceKey, targetPostResourceKey);
  assert.equal(rewrite.rewrittenResourceKey, commentResourceKey);
  assert.match(rewrite.sourceTargetLocalHash, hashPattern);
  assert.match(rewrite.targetRemoteHash, hashPattern);
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(result.site.db.wp_posts['ID:3651'], undefined);
  assert.equal(result.site.db.wp_posts['ID:4651'].post_title, 'RPP-0365 mapped comment target');
  assert.equal(result.site.db.wp_comments['comment_ID:9365'].comment_post_ID, 4651);
});

test('RPP-0365 blocks a drifted comment post target with hash-only reference evidence', () => {
  const commentResourceKey = rowResourceKey('wp_comments', 'comment_ID:9366');
  const targetPostResourceKey = rowResourceKey('wp_posts', 'ID:3652');
  const privateValues = [
    'base-private-rpp0365-comment-post-title',
    'base-private-rpp0365-comment-post-body',
    'remote-private-rpp0365-comment-post-title',
    'remote-private-rpp0365-comment-post-body',
    'local-private-rpp0365-comment-body',
  ];
  const base = baseSite();
  base.db.wp_posts['ID:3652'] = {
    ID: 3652,
    post_title: 'base-private-rpp0365-comment-post-title',
    post_content: 'base-private-rpp0365-comment-post-body',
    post_name: 'base-rpp0365-comment-post',
    post_status: 'publish',
    post_type: 'post',
    post_parent: 0,
    post_author: 0,
  };
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.db.wp_comments['comment_ID:9366'] = {
    comment_ID: 9366,
    comment_post_ID: 3652,
    comment_parent: 0,
    user_id: 0,
    comment_content: 'local-private-rpp0365-comment-body',
  };
  remote.db.wp_posts['ID:3652'] = {
    ...remote.db.wp_posts['ID:3652'],
    post_title: 'remote-private-rpp0365-comment-post-title',
    post_content: 'remote-private-rpp0365-comment-post-body',
  };

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === commentResourceKey);
  const commentPostReference = blocker?.references.find((reference) =>
    reference.relationshipType === 'comment-post');
  const remoteBefore = cloneJson(remote);
  const beforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, commentResourceKey), undefined);
  assert.equal(decisionFor(plan, targetPostResourceKey).decision, 'keep-remote');
  assert.ok(blocker, 'missing comment-post graph blocker');
  assert.equal(blocker.class, 'stale-wordpress-graph-identity');
  assert.match(blocker.reason, /without proven identity mapping or reference rewriting/);
  assert.equal(blocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
  assertHashOnlyChangeEvidence(blocker, privateValues);

  assert.ok(commentPostReference, 'missing comment post target reference evidence');
  assert.equal(commentPostReference.relationshipKey, 'wp_comments.comment_post_ID');
  assert.equal(commentPostReference.targetResourceKey, targetPostResourceKey);
  assert.equal(commentPostReference.targetChange.localChange, 'unchanged');
  assert.equal(commentPostReference.targetChange.remoteChange, 'update');
  assertHashOnlyTargetEvidence(commentPostReference, privateValues);
  assert.deepEqual(findEvidenceRedactionIssues(blocker), []);
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(digest(remoteBefore), beforeHash, 'blocked comment-post plan must refuse before mutation');
});
