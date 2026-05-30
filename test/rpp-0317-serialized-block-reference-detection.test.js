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

function blockerFor(plan, resourceKey) {
  return plan.blockers.find((blocker) => blocker.resourceKey === resourceKey);
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

test('RPP-0317 plans serialized image block references when the attachment identity is stable', () => {
  const postResourceKey = rowResourceKey('wp_posts', 'ID:317');
  const attachmentResourceKey = rowResourceKey('wp_posts', 'ID:7317');
  const base = baseSite();
  base.db.wp_posts['ID:7317'] = {
    ID: 7317,
    post_title: 'Stable RPP-0317 attachment',
    post_name: 'stable-rpp0317-attachment',
    post_content: 'Stable RPP-0317 attachment body',
    post_status: 'inherit',
    post_type: 'attachment',
    post_parent: 0,
    post_author: 0,
  };
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.db.wp_posts['ID:317'] = {
    ID: 317,
    post_title: 'RPP-0317 stable serialized block post',
    post_name: 'rpp0317-stable-serialized-block-post',
    post_content: '<!-- wp:image {"id":7317,"caption":"stable serialized block caption"} /-->',
    post_status: 'publish',
    post_type: 'post',
    post_parent: 0,
    post_author: 0,
  };

  const plan = planFor(base, local, remote);
  const result = applyPlan(cloneJson(remote), plan);
  const postMutation = mutationFor(plan, postResourceKey);
  const plannedPost = deserializeResourceValue(postMutation.value);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(decisionFor(plan, attachmentResourceKey), undefined);
  assert.ok(postMutation, 'missing serialized block post mutation');
  assert.equal(postMutation.changeKind, 'create');
  assert.equal(plannedPost.post_content, local.db.wp_posts['ID:317'].post_content);
  assert.equal(postMutation.wordpressGraphIdentity?.rewrites?.length || 0, 0);
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(result.site.db.wp_posts['ID:317'].post_content, local.db.wp_posts['ID:317'].post_content);
});

test('RPP-0317 fails closed with hash-only evidence when a serialized block attachment target drifted on remote', () => {
  const postResourceKey = rowResourceKey('wp_posts', 'ID:317');
  const attachmentResourceKey = rowResourceKey('wp_posts', 'ID:7317');
  const privateValues = [
    'Local Private RPP-0317 Serialized Block Post',
    'local-private-rpp0317-serialized-block-caption',
    'remote-private-rpp0317-attachment-title',
    'remote-private-rpp0317-attachment-body',
  ];
  const base = baseSite();
  base.db.wp_posts['ID:7317'] = {
    ID: 7317,
    post_title: 'Base RPP-0317 attachment',
    post_name: 'base-rpp0317-attachment',
    post_content: 'Base RPP-0317 attachment body',
    post_status: 'inherit',
    post_type: 'attachment',
    post_parent: 0,
    post_author: 0,
  };
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.db.wp_posts['ID:317'] = {
    ID: 317,
    post_title: 'Local Private RPP-0317 Serialized Block Post',
    post_name: 'local-private-rpp0317-serialized-block-post',
    post_content: '<!-- wp:image {"id":7317,"caption":"local-private-rpp0317-serialized-block-caption"} /-->',
    post_status: 'publish',
    post_type: 'post',
    post_parent: 0,
    post_author: 0,
  };
  remote.db.wp_posts['ID:7317'].post_title = 'remote-private-rpp0317-attachment-title';
  remote.db.wp_posts['ID:7317'].post_content = 'remote-private-rpp0317-attachment-body';

  const plan = planFor(base, local, remote);
  const blocker = blockerFor(plan, postResourceKey);
  const reference = blocker?.references.find((entry) => entry.relationshipType === 'serialized-block-attachment');
  const remoteBefore = cloneJson(remote);
  const beforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));

  assert.equal(plan.status, 'blocked');
  assert.equal(mutationFor(plan, postResourceKey), undefined);
  assert.equal(decisionFor(plan, attachmentResourceKey).decision, 'keep-remote');
  assert.ok(blocker, 'missing serialized block graph blocker');
  assert.equal(blocker.class, 'stale-wordpress-graph-identity');
  assert.match(blocker.reason, /without proven identity mapping or reference rewriting/);
  assert.equal(blocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
  assertHashOnlyChangeEvidence(blocker, privateValues);

  assert.ok(reference, 'missing serialized block attachment target evidence');
  assert.equal(reference.relationshipKey, 'wp_posts.post_content');
  assert.equal(reference.targetResourceKey, attachmentResourceKey);
  assert.equal(reference.serializedBlockName, 'core/image');
  assert.equal(reference.serializedBlockAttributePath, 'id');
  assert.equal(reference.targetChange.localChange, 'unchanged');
  assert.equal(reference.targetChange.remoteChange, 'update');
  assertHashOnlyTargetEvidence(reference, privateValues);
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(digest(remoteBefore), beforeHash, 'blocked serialized block plan must refuse before mutation');
});

test('RPP-0317 fails closed when a serialized image block target is not an attachment row', () => {
  const postResourceKey = rowResourceKey('wp_posts', 'ID:318');
  const pageTargetResourceKey = rowResourceKey('wp_posts', 'ID:8318');
  const privateValues = [
    'Local Private RPP-0317 Page Image Block',
    'local-private-rpp0317-page-image-caption',
    'base-private-rpp0317-page-target-title',
    'base-private-rpp0317-page-target-body',
  ];
  const base = baseSite();
  base.db.wp_posts['ID:8318'] = {
    ID: 8318,
    post_title: 'base-private-rpp0317-page-target-title',
    post_name: 'base-private-rpp0317-page-target',
    post_content: 'base-private-rpp0317-page-target-body',
    post_status: 'publish',
    post_type: 'page',
    post_parent: 0,
    post_author: 0,
  };
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.db.wp_posts['ID:318'] = {
    ID: 318,
    post_title: 'Local Private RPP-0317 Page Image Block',
    post_name: 'local-private-rpp0317-page-image-block',
    post_content: '<!-- wp:image {"id":"8318","caption":"local-private-rpp0317-page-image-caption"} /-->',
    post_status: 'publish',
    post_type: 'post',
    post_parent: 0,
    post_author: 0,
  };

  const plan = planFor(base, local, remote);
  const blocker = blockerFor(plan, postResourceKey);
  const reference = blocker?.references.find((entry) => entry.relationshipType === 'serialized-block-attachment');
  const remoteBefore = cloneJson(remote);
  const beforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));

  assert.equal(plan.status, 'blocked');
  assert.equal(mutationFor(plan, postResourceKey), undefined);
  assert.ok(blocker, 'missing serialized image target blocker');
  assert.equal(blocker.class, 'stale-wordpress-graph-identity');
  assertHashOnlyChangeEvidence(blocker, privateValues);
  assert.ok(reference, 'missing serialized image target evidence');
  assert.equal(reference.relationshipKey, 'wp_posts.post_content');
  assert.equal(reference.targetResourceKey, pageTargetResourceKey);
  assert.deepEqual(reference.targetSupport, {
    supported: false,
    className: 'stale-wordpress-graph-identity',
    reason: `WordPress graph mutation ${postResourceKey} references a serialized block attachment target that is not a supported attachment row.`,
  });
  assert.equal(reference.targetChange.localChange, 'unchanged');
  assert.equal(reference.targetChange.remoteChange, 'unchanged');
  assertHashOnlyTargetEvidence(reference, privateValues);
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(digest(remoteBefore), beforeHash, 'unsupported serialized block target must refuse before mutation');
});
