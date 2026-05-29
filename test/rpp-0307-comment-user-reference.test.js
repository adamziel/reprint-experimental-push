import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue } from '../src/resources.js';

const fixedNow = new Date('2026-05-29T00:00:00.000Z');
const hashPattern = /^[0-9a-f]{64}$/;

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
          post_title: 'Base post',
          post_status: 'publish',
        },
      },
      wp_users: {},
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

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function decisionFor(plan, resourceKey) {
  return plan.decisions.find((decision) => decision.resourceKey === resourceKey);
}

function assertEveryMutationHasLiveRemotePrecondition(plan) {
  for (const mutation of plan.mutations) {
    const precondition = plan.preconditions.find((entry) => entry.mutationId === mutation.id);
    assert.ok(precondition, `missing precondition for ${mutation.id}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.equal(precondition.checkedAgainst, 'live-remote');
  }
}

test('RPP-0307 plans a comment user reference when the user target is stable', () => {
  const commentResourceKey = 'row:["wp_comments","comment_ID:307"]';
  const userResourceKey = 'row:["wp_users","ID:7"]';
  const base = baseSite();
  base.db.wp_users['ID:7'] = {
    ID: 7,
    user_login: 'stable-comment-user',
    user_email: 'stable-comment-user@example.test',
    display_name: 'Stable Comment User',
  };
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.db.wp_comments['comment_ID:307'] = {
    comment_ID: 307,
    comment_post_ID: 1,
    comment_parent: 0,
    user_id: 7,
    comment_content: 'RPP-0307 stable user comment',
  };

  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);
  const commentMutation = mutationFor(plan, commentResourceKey);
  const plannedComment = deserializeResourceValue(commentMutation.value);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(plan.summary.mutations, 1);
  assert.equal(decisionFor(plan, userResourceKey), undefined);
  assert.equal(commentMutation.changeKind, 'create');
  assert.equal(plannedComment.user_id, 7);
  assert.equal(commentMutation.wordpressGraphIdentity?.rewrites?.length || 0, 0);
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(result.site.db.wp_comments['comment_ID:307'].user_id, 7);
});

test('RPP-0307 fails closed with hash-only evidence when the comment user target is unsupported', () => {
  const commentResourceKey = 'row:["wp_comments","comment_ID:308"]';
  const userResourceKey = 'row:["wp_users","ID:7"]';
  const base = baseSite();
  base.db.wp_users['ID:7'] = {
    ID: 8,
    user_login: 'base-private-rpp0307-unsupported-user',
    user_email: 'base-private-rpp0307-unsupported-user@example.test',
    display_name: 'Base Private RPP-0307 Unsupported User',
  };
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.db.wp_comments['comment_ID:308'] = {
    comment_ID: 308,
    comment_post_ID: 1,
    comment_parent: 0,
    user_id: 7,
    comment_content: 'local-private-rpp0307-comment-user-body',
  };

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === commentResourceKey);
  const commentUserReference = blocker?.references.find((reference) =>
    reference.relationshipType === 'comment-user');
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, commentResourceKey), undefined);
  assert.equal(decisionFor(plan, userResourceKey), undefined);
  assert.ok(blocker, 'missing comment user graph blocker');
  assert.equal(blocker.class, 'stale-wordpress-graph-identity');
  assert.match(blocker.reason, /without proven identity mapping/);
  assert.ok(commentUserReference, 'missing comment user reference evidence');
  assert.equal(commentUserReference.relationshipKey, 'wp_comments.user_id');
  assert.equal(commentUserReference.targetResourceKey, userResourceKey);
  assert.equal(commentUserReference.targetChange.localChange, 'unchanged');
  assert.equal(commentUserReference.targetChange.remoteChange, 'unchanged');
  assert.deepEqual(commentUserReference.targetSupport, {
    supported: false,
    className: 'stale-wordpress-graph-identity',
    reason: `WordPress graph mutation ${commentResourceKey} references an unsupported wp_comments.user_id target that is not a valid wp_users row.`,
  });
  for (const hash of [
    blocker.baseHash,
    blocker.localHash,
    blocker.remoteHash,
    blocker.change.base.hash,
    blocker.change.local.hash,
    blocker.change.remote.hash,
    commentUserReference.targetBaseHash,
    commentUserReference.targetLocalHash,
    commentUserReference.targetRemoteHash,
    commentUserReference.targetChange.base.hash,
    commentUserReference.targetChange.local.hash,
    commentUserReference.targetChange.remote.hash,
  ]) {
    assert.match(hash, hashPattern);
  }
  for (const privateValue of [
    'local-private-rpp0307-comment-user-body',
    'base-private-rpp0307-unsupported-user',
    'base-private-rpp0307-unsupported-user@example.test',
    'Base Private RPP-0307 Unsupported User',
  ]) {
    assert.equal(blockerJson.includes(privateValue), false, `blocker leaked ${privateValue}`);
  }
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
});
