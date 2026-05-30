import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const hashPattern = /^[0-9a-f]{64}$/;

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "rpp-0367-base";',
    },
    plugins: {},
    db: {
      wp_posts: {
        'ID:1': {
          ID: 1,
          post_title: 'RPP-0367 base post',
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

function commentUserReferenceFor(blocker) {
  return blocker?.references.find((reference) => reference.relationshipType === 'comment-user');
}

function assertHashOnlyReferenceEvidence(blocker, reference) {
  for (const hash of [
    blocker.baseHash,
    blocker.localHash,
    blocker.remoteHash,
    blocker.change.base.hash,
    blocker.change.local.hash,
    blocker.change.remote.hash,
    reference.targetBaseHash,
    reference.targetLocalHash,
    reference.targetRemoteHash,
    reference.targetChange.base.hash,
    reference.targetChange.local.hash,
    reference.targetChange.remote.hash,
  ]) {
    assert.match(hash, hashPattern);
  }
}

function assertNoRawPayload(planJson, values) {
  for (const value of values) {
    assert.equal(planJson.includes(value), false, `plan leaked raw payload: ${value}`);
  }
}

test('RPP-0367 fails closed when a comment user target went stale remotely', () => {
  const commentResourceKey = 'row:["wp_comments","comment_ID:3671"]';
  const userResourceKey = 'row:["wp_users","ID:367"]';
  const base = baseSite();
  base.db.wp_users['ID:367'] = {
    ID: 367,
    user_login: 'base-private-rpp0367-stale-user',
    user_email: 'base-private-rpp0367-stale-user@example.test',
    display_name: 'Base Private RPP-0367 Stale User',
  };
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.db.wp_comments['comment_ID:3671'] = {
    comment_ID: 3671,
    comment_post_ID: 1,
    comment_parent: 0,
    user_id: 367,
    comment_content: 'local-private-rpp0367-stale-comment-body',
  };
  remote.db.wp_users['ID:367'] = {
    ...remote.db.wp_users['ID:367'],
    user_email: 'remote-private-rpp0367-stale-user@example.test',
    display_name: 'Remote Private RPP-0367 Stale User',
  };
  const remoteBeforeApply = cloneJson(remote);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === commentResourceKey);
  const reference = commentUserReferenceFor(blocker);
  const planJson = JSON.stringify(plan);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, commentResourceKey), undefined);
  assert.equal(decisionFor(plan, userResourceKey).decision, 'keep-remote');
  assert.ok(blocker, 'missing comment user graph blocker');
  assert.equal(blocker.class, 'stale-wordpress-graph-identity');
  assert.match(blocker.reason, /without proven identity mapping/);
  assert.ok(reference, 'missing comment user reference evidence');
  assert.equal(reference.relationshipKey, 'wp_comments.user_id');
  assert.equal(reference.targetResourceKey, userResourceKey);
  assert.equal(reference.targetChange.localChange, 'unchanged');
  assert.equal(reference.targetChange.remoteChange, 'update');
  assert.equal(reference.targetSupport, undefined);
  assertHashOnlyReferenceEvidence(blocker, reference);
  assertNoRawPayload(planJson, [
    'local-private-rpp0367-stale-comment-body',
    'base-private-rpp0367-stale-user',
    'base-private-rpp0367-stale-user@example.test',
    'Base Private RPP-0367 Stale User',
    'remote-private-rpp0367-stale-user@example.test',
    'Remote Private RPP-0367 Stale User',
  ]);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.deepEqual(remote, remoteBeforeApply);
});

test('RPP-0367 fails closed when a comment user target row is unsupported', () => {
  const commentResourceKey = 'row:["wp_comments","comment_ID:3672"]';
  const userResourceKey = 'row:["wp_users","ID:9367"]';
  const base = baseSite();
  base.db.wp_users['ID:9367'] = {
    ID: 9368,
    user_login: 'base-private-rpp0367-unsupported-user',
    user_email: 'base-private-rpp0367-unsupported-user@example.test',
    display_name: 'Base Private RPP-0367 Unsupported User',
  };
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.db.wp_comments['comment_ID:3672'] = {
    comment_ID: 3672,
    comment_post_ID: 1,
    comment_parent: 0,
    user_id: 9367,
    comment_content: 'local-private-rpp0367-unsupported-comment-body',
  };
  const remoteBeforeApply = cloneJson(remote);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === commentResourceKey);
  const reference = commentUserReferenceFor(blocker);
  const planJson = JSON.stringify(plan);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, commentResourceKey), undefined);
  assert.equal(decisionFor(plan, userResourceKey), undefined);
  assert.ok(blocker, 'missing comment user graph blocker');
  assert.equal(blocker.class, 'stale-wordpress-graph-identity');
  assert.match(blocker.reason, /without proven identity mapping/);
  assert.ok(reference, 'missing comment user reference evidence');
  assert.equal(reference.relationshipKey, 'wp_comments.user_id');
  assert.equal(reference.targetResourceKey, userResourceKey);
  assert.equal(reference.targetChange.localChange, 'unchanged');
  assert.equal(reference.targetChange.remoteChange, 'unchanged');
  assert.deepEqual(reference.targetSupport, {
    supported: false,
    className: 'stale-wordpress-graph-identity',
    reason: `WordPress graph mutation ${commentResourceKey} references an unsupported wp_comments.user_id target that is not a valid wp_users row.`,
  });
  assertHashOnlyReferenceEvidence(blocker, reference);
  assertNoRawPayload(planJson, [
    'local-private-rpp0367-unsupported-comment-body',
    'base-private-rpp0367-unsupported-user',
    'base-private-rpp0367-unsupported-user@example.test',
    'Base Private RPP-0367 Unsupported User',
  ]);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.deepEqual(remote, remoteBeforeApply);
});
