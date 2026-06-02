import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue, serializeResourceValue } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-06-02T00:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;

const sourcePostId = 84601;
const targetPostId = 94601;
const sourceUserId = 84602;
const targetUserId = 94602;
const sourcePostRowId = `ID:${sourcePostId}`;
const targetPostRowId = `ID:${targetPostId}`;
const sourceUserRowId = `ID:${sourceUserId}`;
const targetUserRowId = `ID:${targetUserId}`;
const metaKey = '_edit_last';
const sourcePostResourceKey = rowResourceKey('wp_posts', sourcePostRowId);
const targetPostResourceKey = rowResourceKey('wp_posts', targetPostRowId);
const sourceUserResourceKey = rowResourceKey('wp_users', sourceUserRowId);
const targetUserResourceKey = rowResourceKey('wp_users', targetUserRowId);
const sourcePostmetaRowId = `post_id:${sourcePostId}:meta_key:${metaKey}`;
const rewrittenPostmetaRowId = `post_id:${targetPostId}:meta_key:${metaKey}`;
const sourcePostmetaResourceKey = rowResourceKey('wp_postmeta', sourcePostmetaRowId);
const rewrittenPostmetaResourceKey = rowResourceKey('wp_postmeta', rewrittenPostmetaRowId);
const stablePostResourceKey = rowResourceKey('wp_posts', 'ID:1');

const userLogin = 'rpp-edit-last-user';
const userEmail = 'rpp-edit-last-user@example.test';
const postTitle = 'RPP edit-last mapped post';
const remoteDriftEmail = 'remote-rpp-edit-last-user@example.test';

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function rowResourceKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
}

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
          post_title: 'Stable existing post',
          post_name: 'stable-existing-post',
          post_content: 'Stable existing post content',
          post_status: 'publish',
          post_type: 'post',
          post_parent: 0,
          post_author: 0,
        },
      },
      wp_postmeta: {},
      wp_users: {},
    },
  };
}

function mappedPost(id) {
  return {
    ID: id,
    post_title: postTitle,
    post_name: 'rpp-edit-last-mapped-post',
    post_content: 'RPP edit-last mapped post content',
    post_status: 'publish',
    post_type: 'post',
    post_parent: 0,
    post_author: 0,
  };
}

function mappedUser(id, overrides = {}) {
  return {
    ID: id,
    user_login: userLogin,
    user_email: userEmail,
    display_name: 'RPP Edit Last User',
    ...overrides,
  };
}

function editLastPostmetaRow({ postId, userId }) {
  return {
    post_id: postId,
    meta_key: metaKey,
    meta_value: String(userId),
  };
}

function explicitIdentityMapRow(sourceResourceKey, targetResourceKey) {
  return {
    contractVersion: 1,
    contractKind: 'wordpress-graph-identity-map',
    sourceResourceKey,
    targetResourceKey,
  };
}

function mappedEditLastSite({ staleUser = false } = {}) {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.meta = {
    wordpressGraphIdentityMap: {
      rows: [
        explicitIdentityMapRow(sourcePostResourceKey, targetPostResourceKey),
        explicitIdentityMapRow(sourceUserResourceKey, targetUserResourceKey),
      ],
    },
  };
  local.db.wp_posts[sourcePostRowId] = mappedPost(sourcePostId);
  local.db.wp_users[sourceUserRowId] = mappedUser(sourceUserId);
  local.db.wp_postmeta[sourcePostmetaRowId] = editLastPostmetaRow({
    postId: sourcePostId,
    userId: sourceUserId,
  });
  remote.db.wp_posts[targetPostRowId] = mappedPost(targetPostId);
  remote.db.wp_users[targetUserRowId] = mappedUser(targetUserId, staleUser
    ? { user_email: remoteDriftEmail }
    : {});

  return { base, local, remote };
}

function malformedSamePlanUserTargetSite() {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.db.wp_posts[`ID:${sourcePostId}`] = mappedPost(sourcePostId);
  local.db.wp_users[`ID:${sourceUserId}`] = mappedUser(targetUserId);
  local.db.wp_postmeta[sourcePostmetaRowId] = editLastPostmetaRow({
    postId: sourcePostId,
    userId: sourceUserId,
  });

  return { base, local, remote };
}

function postmetaSite({ rowId, metaKeyValue, metaValue, users = {} }) {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  base.db.wp_users = cloneJson(users);
  local.db.wp_users = cloneJson(users);
  remote.db.wp_users = cloneJson(users);
  local.db.wp_postmeta[rowId] = {
    ...(rowId.startsWith('meta_id:') ? { meta_id: Number(rowId.slice('meta_id:'.length)) } : {}),
    post_id: 1,
    meta_key: metaKeyValue,
    meta_value: metaValue,
  };

  return { base, local, remote };
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

function assertEveryMutationHasLiveRemotePrecondition(plan) {
  for (const mutation of plan.mutations) {
    const precondition = plan.preconditions.find((entry) => entry.mutationId === mutation.id);
    assert.ok(precondition, `missing precondition for ${mutation.resourceKey}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey);
    assert.equal(precondition.checkedAgainst, 'live-remote');
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
  }
}

function assertHashOnlyChangeEvidence(entry) {
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
}

function assertNoRawRows(value) {
  const serialized = JSON.stringify(value);
  for (const forbidden of [userLogin, userEmail, postTitle, remoteDriftEmail]) {
    assert.equal(serialized.includes(forbidden), false, `leaked raw value ${forbidden}`);
  }
}

test('rewrites mapped _edit_last postmeta through proven post and user identity maps', () => {
  const { base, local, remote } = mappedEditLastSite();
  const plan = planFor(base, local, remote);
  const result = applyPlan(cloneJson(remote), plan);
  const mutation = mutationFor(plan, rewrittenPostmetaResourceKey);
  const plannedPostmeta = deserializeResourceValue(mutation.value);
  const rewriteTypes = mutation.wordpressGraphIdentity?.rewrites
    .map((rewrite) => rewrite.relationshipType)
    .sort();
  const postRewrite = mutation.wordpressGraphIdentity?.rewrites.find((rewrite) =>
    rewrite.relationshipType === 'postmeta-post');
  const userRewrite = mutation.wordpressGraphIdentity?.rewrites.find((rewrite) =>
    rewrite.relationshipType === 'postmeta-edit-last-user');

  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.summary, {
    mutations: 1,
    decisions: 4,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.equal(mutationFor(plan, sourcePostResourceKey), undefined);
  assert.equal(mutationFor(plan, sourceUserResourceKey), undefined);
  assert.equal(mutationFor(plan, sourcePostmetaResourceKey), undefined);
  assert.equal(decisionFor(plan, sourcePostResourceKey).decision, 'map-local-identity-to-remote');
  assert.equal(decisionFor(plan, sourceUserResourceKey).decision, 'map-local-identity-to-remote');
  assert.equal(decisionFor(plan, targetPostResourceKey).decision, 'keep-remote');
  assert.equal(decisionFor(plan, targetUserResourceKey).decision, 'keep-remote');
  assert.equal(mutation.resourceKey, rewrittenPostmetaResourceKey);
  assert.equal(mutation.changeKind, 'create');
  assert.deepEqual(plannedPostmeta, editLastPostmetaRow({
    postId: targetPostId,
    userId: targetUserId,
  }));
  assert.deepEqual(rewriteTypes, ['postmeta-edit-last-user', 'postmeta-post']);

  assert.ok(postRewrite, 'missing postmeta-post rewrite proof');
  assert.equal(postRewrite.relationshipKey, 'wp_postmeta.post_id');
  assert.equal(postRewrite.field, 'post_id');
  assert.equal(postRewrite.sourceTargetResourceKey, sourcePostResourceKey);
  assert.equal(postRewrite.targetResourceKey, targetPostResourceKey);
  assert.match(postRewrite.relationshipContractHash, hashPattern);

  assert.ok(userRewrite, 'missing postmeta-edit-last-user rewrite proof');
  assert.equal(userRewrite.relationshipKey, 'wp_postmeta.meta_value');
  assert.equal(userRewrite.field, 'meta_value');
  assert.equal(userRewrite.sourceTargetResourceKey, sourceUserResourceKey);
  assert.equal(userRewrite.targetResourceKey, targetUserResourceKey);
  assert.match(userRewrite.relationshipContractHash, hashPattern);
  assertEveryMutationHasLiveRemotePrecondition(plan);

  assert.equal(result.appliedMutations, 1);
  assert.equal(result.site.db.wp_posts[sourcePostRowId], undefined);
  assert.equal(result.site.db.wp_users[sourceUserRowId], undefined);
  assert.equal(result.site.db.wp_posts[targetPostRowId].ID, targetPostId);
  assert.equal(result.site.db.wp_users[targetUserRowId].ID, targetUserId);
  assert.deepEqual(result.site.db.wp_postmeta[rewrittenPostmetaRowId], editLastPostmetaRow({
    postId: targetPostId,
    userId: targetUserId,
  }));
  assertNoRawRows({ plan, postRewrite, userRewrite });
});

test('plans _edit_last postmeta against an unchanged existing user target without rewrite', () => {
  const rowId = 'meta_id:84603';
  const postmetaResourceKey = rowResourceKey('wp_postmeta', rowId);
  const { base, local, remote } = postmetaSite({
    rowId,
    metaKeyValue: metaKey,
    metaValue: String(sourceUserId),
    users: {
      [sourceUserRowId]: mappedUser(sourceUserId),
    },
  });
  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, postmetaResourceKey);
  const plannedPostmeta = deserializeResourceValue(mutation.value);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(mutation.changeKind, 'create');
  assert.equal(plannedPostmeta.meta_value, String(sourceUserId));
  assert.equal(mutation.wordpressGraphIdentity, undefined);
  assert.equal(decisionFor(plan, stablePostResourceKey), undefined);
  assert.equal(decisionFor(plan, sourceUserResourceKey), undefined);
});

test('blocks _edit_last postmeta when the user target is missing', () => {
  const rowId = 'meta_id:84604';
  const postmetaResourceKey = rowResourceKey('wp_postmeta', rowId);
  const missingUserResourceKey = rowResourceKey('wp_users', 'ID:999999');
  const { base, local, remote } = postmetaSite({
    rowId,
    metaKeyValue: metaKey,
    metaValue: '999999',
  });
  const plan = planFor(base, local, remote);
  const blocker = blockerFor(plan, postmetaResourceKey);
  const editLastReference = blocker?.references.find((reference) =>
    reference.relationshipType === 'postmeta-edit-last-user');

  assert.equal(plan.status, 'blocked');
  assert.equal(mutationFor(plan, postmetaResourceKey), undefined);
  assert.ok(editLastReference, 'missing _edit_last missing-target evidence');
  assert.equal(editLastReference.relationshipKey, 'wp_postmeta.meta_value');
  assert.equal(editLastReference.targetResourceKey, missingUserResourceKey);
  assert.equal(Object.hasOwn(editLastReference, 'targetSupport'), false);
  assert.equal(editLastReference.targetChange.remote.state, 'absent');
  assert.match(editLastReference.targetRemoteHash, hashPattern);
  assertNoRawRows({ blocker, editLastReference });
});

test('does not emit _edit_last user references for other postmeta keys or non-positive values', () => {
  for (const [rowId, metaKeyValue, metaValue] of [
    ['meta_id:84605', '_not_edit_last', String(sourceUserId)],
    ['meta_id:84606', metaKey, ''],
    ['meta_id:84607', metaKey, '0'],
    ['meta_id:84608', metaKey, 'not-an-integer'],
  ]) {
    const postmetaResourceKey = rowResourceKey('wp_postmeta', rowId);
    const { base, local, remote } = postmetaSite({
      rowId,
      metaKeyValue,
      metaValue,
    });
    const plan = planFor(base, local, remote);
    const mutation = mutationFor(plan, postmetaResourceKey);
    const serializedPostmetaEvidence = JSON.stringify([
      blockerFor(plan, postmetaResourceKey),
      mutation?.wordpressGraphIdentity,
    ]);

    assert.equal(plan.status, 'ready', `${rowId} should not emit a user graph blocker`);
    assert.ok(mutation, `missing mutation for ${rowId}`);
    assert.equal(
      serializedPostmetaEvidence.includes('postmeta-edit-last-user'),
      false,
      `${rowId} should not carry _edit_last user evidence`,
    );
  }
});

test('apply refuses forged _edit_last rewrite payload before mutation', () => {
  const { base, local, remote } = mappedEditLastSite();
  const plan = planFor(base, local, remote);
  const forgedPlan = cloneJson(plan);
  const forgedRemote = cloneJson(remote);
  const remoteBeforeHash = digest(forgedRemote);
  const mutation = mutationFor(forgedPlan, rewrittenPostmetaResourceKey);
  const forgedValue = deserializeResourceValue(mutation.value);
  forgedValue.meta_value = String(sourceUserId);
  mutation.value = serializeResourceValue(forgedValue);
  mutation.localHash = digest(forgedValue);

  const error = captureError(() => applyPlan(forgedRemote, forgedPlan));
  const issue = error.details.issues.find((entry) =>
    entry.code === 'WORDPRESS_GRAPH_REWRITE_TARGET_VALUE_MISMATCH'
    && entry.relationshipType === 'postmeta-edit-last-user');

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_INVARIANT_VIOLATION');
  assert.ok(issue, 'missing forged _edit_last rewrite payload issue');
  assert.equal(issue.resourceKey, rewrittenPostmetaResourceKey);
  assert.equal(issue.relationshipKey, 'wp_postmeta.meta_value');
  assert.equal(issue.field, 'meta_value');
  assert.equal(issue.targetResourceKey, targetUserResourceKey);
  assert.match(issue.expectedTargetIdHash, hashPattern);
  assert.match(issue.actualTargetValueHash, hashPattern);
  assert.equal(digest(forgedRemote), remoteBeforeHash);
  assert.equal(forgedRemote.db.wp_postmeta[rewrittenPostmetaRowId], undefined);
});

test('blocks stale _edit_last user identity maps with hash-only evidence', () => {
  const { base, local, remote } = mappedEditLastSite({ staleUser: true });
  const plan = planFor(base, local, remote);
  const sourceUserBlocker = blockerFor(plan, sourceUserResourceKey);
  const postmetaBlocker = blockerFor(plan, rewrittenPostmetaResourceKey)
    || blockerFor(plan, sourcePostmetaResourceKey);
  const editLastReference = postmetaBlocker?.references.find((reference) =>
    reference.relationshipType === 'postmeta-edit-last-user');
  const remoteBefore = cloneJson(remote);
  const beforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, rewrittenPostmetaResourceKey), undefined);
  assert.equal(mutationFor(plan, sourcePostmetaResourceKey), undefined);

  assert.ok(sourceUserBlocker, 'missing source user identity-map blocker');
  assert.equal(sourceUserBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(sourceUserBlocker.reason, /not equivalent after identity rewriting/);
  assertHashOnlyChangeEvidence(sourceUserBlocker);

  assert.ok(postmetaBlocker, 'missing _edit_last reference blocker');
  assert.equal(postmetaBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(postmetaBlocker.reason, /without proven identity mapping or reference rewriting/);
  assertHashOnlyChangeEvidence(postmetaBlocker);
  assert.ok(editLastReference, 'missing _edit_last target evidence');
  assert.equal(editLastReference.relationshipKey, 'wp_postmeta.meta_value');
  assert.equal(editLastReference.targetResourceKey, sourceUserResourceKey);
  assert.equal(editLastReference.targetSupport.supported, false);
  assert.match(editLastReference.targetSupport.reason, /not equivalent after identity rewriting/);
  assert.match(editLastReference.targetBaseHash, hashPattern);
  assert.match(editLastReference.targetLocalHash, hashPattern);
  assert.match(editLastReference.targetRemoteHash, hashPattern);
  assert.equal(Object.hasOwn(editLastReference.targetChange.local, 'value'), false);
  assert.equal(Object.hasOwn(editLastReference.targetChange.remote, 'value'), false);

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(digest(remoteBefore), beforeHash, 'blocked _edit_last plan must refuse before mutation');
  assert.equal(remoteBefore.db.wp_postmeta[rewrittenPostmetaRowId], undefined);
  assert.equal(remoteBefore.db.wp_users[targetUserRowId].user_email, remoteDriftEmail);
  assertNoRawRows(plan);
});

test('blocks malformed same-plan _edit_last user targets with hash-only evidence', () => {
  const { base, local, remote } = malformedSamePlanUserTargetSite();
  const plan = planFor(base, local, remote);
  const postmetaBlocker = blockerFor(plan, sourcePostmetaResourceKey);
  const editLastReference = postmetaBlocker?.references.find((reference) =>
    reference.relationshipType === 'postmeta-edit-last-user');
  const remoteBefore = cloneJson(remote);
  const beforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));

  assert.equal(plan.status, 'blocked');
  assert.equal(mutationFor(plan, sourcePostmetaResourceKey), undefined);
  assert.ok(postmetaBlocker, 'missing malformed _edit_last target blocker');
  assert.equal(postmetaBlocker.class, 'stale-wordpress-graph-identity');
  assertHashOnlyChangeEvidence(postmetaBlocker);
  assert.ok(editLastReference, 'missing malformed _edit_last target evidence');
  assert.equal(editLastReference.relationshipKey, 'wp_postmeta.meta_value');
  assert.equal(editLastReference.targetResourceKey, sourceUserResourceKey);
  assert.deepEqual(editLastReference.targetSupport, {
    supported: false,
    className: 'stale-wordpress-graph-identity',
    reason: `WordPress graph mutation ${sourcePostmetaResourceKey} references an unsupported wp_postmeta.meta_value target that is not a valid wp_users row.`,
  });
  for (const hash of [
    editLastReference.targetBaseHash,
    editLastReference.targetLocalHash,
    editLastReference.targetRemoteHash,
  ]) {
    assert.match(hash, hashPattern);
  }
  assert.equal(Object.hasOwn(editLastReference.targetChange.local, 'value'), false);
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(digest(remoteBefore), beforeHash, 'blocked malformed _edit_last plan must refuse before mutation');
  assertNoRawRows({ postmetaBlocker, editLastReference });
});
