import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
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
      wp_posts: {
        'ID:1': {
          ID: 1,
          post_title: 'Base post',
          post_name: 'base-post',
          post_content: 'Base post content',
          post_status: 'publish',
          post_type: 'post',
          post_parent: 0,
          post_author: 0,
        },
      },
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
  assert.equal(Object.hasOwn(reference.targetChange.local, 'value'), false);
  assert.equal(Object.hasOwn(reference.targetChange.remote, 'value'), false);

  const serialized = JSON.stringify(reference);
  for (const privateValue of privateValues) {
    assert.equal(serialized.includes(privateValue), false, `reference leaked ${privateValue}`);
  }
}

test('RPP-0361 rewrites a page hierarchy post_parent through explicit identity-map evidence', () => {
  const localParentResourceKey = rowResourceKey('wp_posts', 'ID:36101');
  const remoteParentResourceKey = rowResourceKey('wp_posts', 'ID:46101');
  const childPageResourceKey = rowResourceKey('wp_posts', 'ID:36102');
  const privateValues = [
    'Mapped RPP-0361 Parent Page',
    'mapped-rpp0361-parent-page',
    'Mapped parent body',
    'Mapped RPP-0361 Child Page',
    'mapped-rpp0361-child-page',
    'mapped-rpp0361-child-body',
  ];
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.meta = {
    wordpressGraphIdentityMap: {
      rows: [
        { table: 'wp_posts', localId: 'ID:36101', remoteId: 'ID:46101' },
      ],
    },
  };
  local.db.wp_posts['ID:36101'] = {
    ID: 36101,
    post_title: 'Mapped RPP-0361 Parent Page',
    post_name: 'mapped-rpp0361-parent-page',
    post_content: 'Mapped parent body',
    post_status: 'publish',
    post_type: 'page',
    post_parent: 0,
    post_author: 0,
  };
  remote.db.wp_posts['ID:46101'] = {
    ID: 46101,
    post_title: 'Mapped RPP-0361 Parent Page',
    post_name: 'mapped-rpp0361-parent-page',
    post_content: 'Mapped parent body',
    post_status: 'publish',
    post_type: 'page',
    post_parent: 0,
    post_author: 0,
  };
  local.db.wp_posts['ID:36102'] = {
    ID: 36102,
    post_title: 'Mapped RPP-0361 Child Page',
    post_name: 'mapped-rpp0361-child-page',
    post_content: 'mapped-rpp0361-child-body',
    post_status: 'publish',
    post_type: 'page',
    post_parent: 36101,
    post_author: 0,
  };

  const plan = planFor(base, local, remote);
  const childMutation = mutationFor(plan, childPageResourceKey);
  assert.ok(childMutation, 'missing rewritten child page mutation');
  const result = applyPlan(cloneJson(remote), plan);
  const plannedChild = deserializeResourceValue(childMutation.value);
  const postParentRewrite = childMutation.wordpressGraphIdentity?.rewrites.find((rewrite) =>
    rewrite.relationshipType === 'post-parent');
  const rewriteEvidenceJson = JSON.stringify(childMutation.wordpressGraphIdentity);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutationFor(plan, localParentResourceKey), undefined);
  assert.equal(mutationFor(plan, remoteParentResourceKey), undefined);
  assert.equal(decisionFor(plan, localParentResourceKey).decision, 'map-local-identity-to-remote');
  assert.equal(decisionFor(plan, remoteParentResourceKey).decision, 'keep-remote');
  assert.equal(childMutation.changeKind, 'create');
  assert.equal(plannedChild.post_parent, 46101);
  assert.ok(postParentRewrite, 'missing post_parent identity rewrite evidence');
  assert.equal(postParentRewrite.relationshipKey, 'wp_posts.post_parent');
  assert.equal(postParentRewrite.field, 'post_parent');
  assert.equal(postParentRewrite.sourceResourceKey, childPageResourceKey);
  assert.equal(postParentRewrite.rewrittenResourceKey, childPageResourceKey);
  assert.equal(postParentRewrite.sourceTargetResourceKey, localParentResourceKey);
  assert.equal(postParentRewrite.targetResourceKey, remoteParentResourceKey);
  assert.match(postParentRewrite.sourceTargetLocalHash, hashPattern);
  assert.match(postParentRewrite.targetRemoteHash, hashPattern);
  for (const privateValue of privateValues) {
    assert.equal(rewriteEvidenceJson.includes(privateValue), false, `rewrite evidence leaked ${privateValue}`);
  }
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(result.site.db.wp_posts['ID:36101'], undefined);
  assert.equal(result.site.db.wp_posts['ID:46101'].post_title, 'Mapped RPP-0361 Parent Page');
  assert.equal(result.site.db.wp_posts['ID:36102'].post_parent, 46101);
});

test('RPP-0361 blocks stale page hierarchy post_parent targets with hash-only evidence', () => {
  const parentPageResourceKey = rowResourceKey('wp_posts', 'ID:36111');
  const childPageResourceKey = rowResourceKey('wp_posts', 'ID:36112');
  const privateValues = [
    'Local Private RPP-0361 Child Page',
    'local-private-rpp0361-child-page',
    'local-private-rpp0361-child-body',
    'remote-private-rpp0361-parent-title',
    'remote-private-rpp0361-parent-body',
  ];
  const base = baseSite();
  base.db.wp_posts['ID:36111'] = {
    ID: 36111,
    post_title: 'Base RPP-0361 Parent Page',
    post_name: 'base-rpp0361-parent-page',
    post_content: 'Base RPP-0361 parent body',
    post_status: 'publish',
    post_type: 'page',
    post_parent: 0,
    post_author: 0,
  };
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.db.wp_posts['ID:36112'] = {
    ID: 36112,
    post_title: 'Local Private RPP-0361 Child Page',
    post_name: 'local-private-rpp0361-child-page',
    post_content: 'local-private-rpp0361-child-body',
    post_status: 'publish',
    post_type: 'page',
    post_parent: 36111,
    post_author: 0,
  };
  remote.db.wp_posts['ID:36111'].post_title = 'remote-private-rpp0361-parent-title';
  remote.db.wp_posts['ID:36111'].post_content = 'remote-private-rpp0361-parent-body';

  const plan = planFor(base, local, remote);
  const blocker = blockerFor(plan, childPageResourceKey);
  const postParentReference = blocker?.references.find((reference) =>
    reference.relationshipType === 'post-parent');
  const remoteBefore = cloneJson(remote);
  const beforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, childPageResourceKey), undefined);
  assert.equal(decisionFor(plan, parentPageResourceKey).decision, 'keep-remote');
  assert.ok(blocker, 'missing stale post_parent graph blocker');
  assert.equal(blocker.class, 'stale-wordpress-graph-identity');
  assert.match(blocker.reason, /without proven identity mapping or reference rewriting/);
  assert.equal(blocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
  assertHashOnlyChangeEvidence(blocker, privateValues);

  assert.ok(postParentReference, 'missing post_parent target evidence');
  assert.equal(postParentReference.relationshipKey, 'wp_posts.post_parent');
  assert.equal(postParentReference.sourceResourceKey, childPageResourceKey);
  assert.equal(postParentReference.targetResourceKey, parentPageResourceKey);
  assert.equal(postParentReference.targetChange.localChange, 'unchanged');
  assert.equal(postParentReference.targetChange.remoteChange, 'update');
  assertHashOnlyTargetEvidence(postParentReference, privateValues);
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(digest(remoteBefore), beforeHash, 'blocked post_parent plan must refuse before mutation');
});
