import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;

const sourcePostId = 36401;
const targetPostId = 46401;
const sourcePostRowId = `ID:${sourcePostId}`;
const targetPostRowId = `ID:${targetPostId}`;
const metaKey = '_rpp0364_post_id_reference_v4';
const sourcePostResourceKey = rowResourceKey('wp_posts', sourcePostRowId);
const targetPostResourceKey = rowResourceKey('wp_posts', targetPostRowId);
const sourcePostmetaRowId = `post_id:${sourcePostId}:meta_key:${metaKey}`;
const rewrittenPostmetaRowId = `post_id:${targetPostId}:meta_key:${metaKey}`;
const sourcePostmetaResourceKey = rowResourceKey('wp_postmeta', sourcePostmetaRowId);
const rewrittenPostmetaResourceKey = rowResourceKey('wp_postmeta', rewrittenPostmetaRowId);

const localTargetTitle = 'Local Only RPP-0364 mapped target title';
const localTargetBody = 'Local Only RPP-0364 mapped target body';
const localPostmetaPayload = 'local-only-rpp-0364-postmeta-row-payload';
const remoteDriftTitle = 'Remote Drift RPP-0364 mapped target title';
const remoteDriftBody = 'Remote Drift RPP-0364 mapped target body';

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
          post_title: 'Base post',
          post_name: 'base-post',
          post_content: 'Base post content',
          post_status: 'publish',
          post_type: 'post',
          post_parent: 0,
          post_author: 0,
        },
      },
      wp_postmeta: {},
    },
  };
}

function mappedTargetPost(id, overrides = {}) {
  return {
    ID: id,
    post_title: localTargetTitle,
    post_name: 'rpp-0364-mapped-target',
    post_content: localTargetBody,
    post_status: 'publish',
    post_type: 'page',
    post_parent: 0,
    post_author: 0,
    guid: 'urn:rpp-0364-mapped-target',
    ...overrides,
  };
}

function mappedPostmetaRow(postId) {
  return {
    post_id: postId,
    meta_key: metaKey,
    meta_value: localPostmetaPayload,
  };
}

function mappedPostmetaSite({ staleTarget = false } = {}) {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.meta = {
    wordpressGraphIdentityMap: {
      rows: [
        { table: 'wp_posts', localId: sourcePostRowId, remoteId: targetPostRowId },
      ],
    },
  };
  local.db.wp_posts[sourcePostRowId] = mappedTargetPost(sourcePostId);
  local.db.wp_postmeta[sourcePostmetaRowId] = mappedPostmetaRow(sourcePostId);
  remote.db.wp_posts[targetPostRowId] = mappedTargetPost(targetPostId, staleTarget
    ? { post_title: remoteDriftTitle, post_content: remoteDriftBody }
    : {});

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

function assertNoRawRows(value, forbiddenValues) {
  const serialized = JSON.stringify(value);
  for (const forbiddenValue of forbiddenValues) {
    assert.equal(serialized.includes(forbiddenValue), false, `leaked raw row payload ${forbiddenValue}`);
  }
}

function redactedPostmetaPostIdProof({ plan, result, sourceDecision, targetDecision, mutation, rewrite }) {
  const appliedRow = result.site.db.wp_postmeta[rewrittenPostmetaRowId];
  return {
    evidenceScope: 'local-planner-apply',
    productionBacked: false,
    plan: {
      status: plan.status,
      summary: plan.summary,
    },
    sourcePostDecision: {
      resourceKey: sourceDecision.resourceKey,
      decision: sourceDecision.decision,
      targetResourceKey: sourceDecision.targetResourceKey,
      localHash: sourceDecision.localHash,
      targetRemoteHash: sourceDecision.targetRemoteHash,
      identityMapSource: sourceDecision.identityMapSource,
    },
    targetPostDecision: {
      resourceKey: targetDecision.resourceKey,
      decision: targetDecision.decision,
      remoteHash: targetDecision.remoteHash,
    },
    postmetaMutation: {
      resourceKey: mutation.resourceKey,
      changeKind: mutation.changeKind,
      baseHash: mutation.baseHash,
      localHash: mutation.localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
    },
    postIdRewrite: rewrite,
    applied: {
      appliedMutations: result.appliedMutations,
      sourcePostPresent: Object.hasOwn(result.site.db.wp_posts, sourcePostRowId),
      targetPostPresent: Object.hasOwn(result.site.db.wp_posts, targetPostRowId),
      postmetaResourceKey: rewrittenPostmetaResourceKey,
      postId: appliedRow.post_id,
    },
  };
}

test('RPP-0364 carries a mapped wp_postmeta.post_id target through planner rewrite and local apply', () => {
  const { base, local, remote } = mappedPostmetaSite();
  const plan = planFor(base, local, remote);
  const result = applyPlan(cloneJson(remote), plan);
  const sourceDecision = decisionFor(plan, sourcePostResourceKey);
  const targetDecision = decisionFor(plan, targetPostResourceKey);
  const mutation = mutationFor(plan, rewrittenPostmetaResourceKey);
  const plannedPostmeta = deserializeResourceValue(mutation.value);
  const postRewrite = mutation.wordpressGraphIdentity?.rewrites.find((rewrite) =>
    rewrite.relationshipType === 'postmeta-post');
  const proof = redactedPostmetaPostIdProof({
    plan,
    result,
    sourceDecision,
    targetDecision,
    mutation,
    rewrite: postRewrite,
  });

  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.summary, {
    mutations: 1,
    decisions: 2,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.equal(mutationFor(plan, sourcePostResourceKey), undefined);
  assert.equal(mutationFor(plan, targetPostResourceKey), undefined);
  assert.equal(mutationFor(plan, sourcePostmetaResourceKey), undefined);
  assert.equal(sourceDecision.decision, 'map-local-identity-to-remote');
  assert.equal(sourceDecision.targetResourceKey, targetPostResourceKey);
  assert.equal(targetDecision.decision, 'keep-remote');
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.changeKind, 'create');
  assert.equal(mutation.resourceKey, rewrittenPostmetaResourceKey);
  assert.equal(plannedPostmeta.post_id, targetPostId);
  assert.equal(plannedPostmeta.meta_key, metaKey);
  assert.equal(plannedPostmeta.meta_value, localPostmetaPayload);
  assert.ok(postRewrite, 'missing postmeta-post rewrite proof');
  assert.equal(postRewrite.relationshipKey, 'wp_postmeta.post_id');
  assert.equal(postRewrite.field, 'post_id');
  assert.equal(postRewrite.sourceResourceKey, sourcePostmetaResourceKey);
  assert.equal(postRewrite.rewrittenResourceKey, rewrittenPostmetaResourceKey);
  assert.equal(postRewrite.sourceTargetResourceKey, sourcePostResourceKey);
  assert.equal(postRewrite.targetResourceKey, targetPostResourceKey);
  assert.match(postRewrite.sourceTargetLocalHash, hashPattern);
  assert.match(postRewrite.targetRemoteHash, hashPattern);
  assertEveryMutationHasLiveRemotePrecondition(plan);

  assert.equal(result.appliedMutations, 1);
  assert.equal(result.site.db.wp_posts[sourcePostRowId], undefined);
  assert.equal(result.site.db.wp_posts[targetPostRowId].ID, targetPostId);
  assert.equal(result.site.db.wp_posts[targetPostRowId].post_title, localTargetTitle);
  assert.equal(result.site.db.wp_postmeta[sourcePostmetaRowId], undefined);
  assert.deepEqual(result.site.db.wp_postmeta[rewrittenPostmetaRowId], mappedPostmetaRow(targetPostId));
  assertNoRawRows({ sourceDecision, targetDecision, postRewrite, proof }, [
    localTargetTitle,
    localTargetBody,
    localPostmetaPayload,
  ]);
});

test('RPP-0364 blocks stale wp_postmeta.post_id target identity with hash-only evidence before apply', () => {
  const { base, local, remote } = mappedPostmetaSite({ staleTarget: true });
  const plan = planFor(base, local, remote);
  const sourceBlocker = blockerFor(plan, sourcePostResourceKey);
  const postmetaBlocker = blockerFor(plan, sourcePostmetaResourceKey);
  const postReference = postmetaBlocker?.references.find((reference) =>
    reference.relationshipType === 'postmeta-post');
  const remoteBefore = cloneJson(remote);
  const beforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(plan.summary.conflicts, 0);
  assert.equal(plan.summary.blockers, 2);
  assert.equal(mutationFor(plan, sourcePostResourceKey), undefined);
  assert.equal(mutationFor(plan, sourcePostmetaResourceKey), undefined);
  assert.equal(mutationFor(plan, rewrittenPostmetaResourceKey), undefined);

  assert.ok(sourceBlocker, 'missing source post identity-map blocker');
  assert.equal(sourceBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(sourceBlocker.reason, /not equivalent after identity rewriting/);
  assertHashOnlyChangeEvidence(sourceBlocker);

  assert.ok(postmetaBlocker, 'missing postmeta reference blocker');
  assert.equal(postmetaBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(postmetaBlocker.reason, /without proven identity mapping or reference rewriting/);
  assertHashOnlyChangeEvidence(postmetaBlocker);
  assert.ok(postReference, 'missing postmeta-post target evidence');
  assert.equal(postReference.relationshipKey, 'wp_postmeta.post_id');
  assert.equal(postReference.sourceResourceKey, sourcePostmetaResourceKey);
  assert.equal(postReference.targetResourceKey, sourcePostResourceKey);
  assert.equal(postReference.targetSupport.supported, false);
  assert.match(postReference.targetSupport.reason, /not equivalent after identity rewriting/);
  assert.match(postReference.targetBaseHash, hashPattern);
  assert.match(postReference.targetLocalHash, hashPattern);
  assert.match(postReference.targetRemoteHash, hashPattern);
  assert.equal(Object.hasOwn(postReference.targetChange.local, 'value'), false);
  assert.equal(Object.hasOwn(postReference.targetChange.remote, 'value'), false);

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(digest(remoteBefore), beforeHash, 'blocked postmeta post_id plan must refuse before mutation');
  assert.equal(remoteBefore.db.wp_postmeta[rewrittenPostmetaRowId], undefined);
  assert.equal(remoteBefore.db.wp_posts[targetPostRowId].post_title, remoteDriftTitle);
  assertNoRawRows(plan, [
    localTargetTitle,
    localTargetBody,
    localPostmetaPayload,
    remoteDriftTitle,
    remoteDriftBody,
  ]);
});
