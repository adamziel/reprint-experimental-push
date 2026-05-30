import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;
const sourceParentId = 76401;
const sourceChildId = 76402;
const importedTargetId = 77401;
const metaKey = '_rpp_0380_importer_exporter_map';
const sourceParentResourceKey = rowResourceKey('wp_posts', `ID:${sourceParentId}`);
const sourceChildResourceKey = rowResourceKey('wp_posts', `ID:${sourceChildId}`);
const importedTargetResourceKey = rowResourceKey('wp_posts', `ID:${importedTargetId}`);
const sourcePostmetaResourceKey = rowResourceKey(
  'wp_postmeta',
  `post_id:${sourceParentId}:meta_key:${metaKey}`,
);
const importedPostmetaResourceKey = rowResourceKey(
  'wp_postmeta',
  `post_id:${importedTargetId}:meta_key:${metaKey}`,
);
const pushIdentityMapSource = 'base-snapshot.meta.identityMap[2].resources[0]';
const privateTokens = Object.freeze([
  'Production Private RPP-0380 Parent',
  'Production Private RPP-0380 Child',
  'Stale Production Private RPP-0380 Parent',
  'production-private-rpp-0380-parent-body',
  'production-private-rpp-0380-child-body',
  'stale-production-private-rpp-0380-parent-body',
  'production-private-rpp-0380-meta',
]);

function baseSite(meta = {}) {
  return {
    meta,
    files: {
      'index.php': '<?php echo "base";',
    },
    plugins: {},
    db: {
      wp_posts: {},
      wp_postmeta: {},
    },
  };
}

function productionPushIdentityMap() {
  return {
    provenance: {
      exporter: {
        artifactHash: '1'.repeat(64),
        rowCount: 1,
        observedAt: '2026-05-30T00:00:00.000Z',
      },
      importer: {
        packageHash: '2'.repeat(64),
        persistedAt: '2026-05-30T00:01:00.000Z',
        immutableBase: true,
      },
    },
    resources: [
      {
        sourceResourceKey: sourceParentResourceKey,
        targetResourceKey: importedTargetResourceKey,
      },
    ],
  };
}

function sourceSnapshot() {
  return baseSite({
    pushIdentityMap: productionPushIdentityMap(),
  });
}

function localEditedSnapshot() {
  const snapshot = baseSite();
  snapshot.db.wp_posts[`ID:${sourceParentId}`] = {
    ID: sourceParentId,
    post_title: 'Production Private RPP-0380 Parent',
    post_name: 'rpp-0380-importer-exporter-parent',
    post_content: 'production-private-rpp-0380-parent-body',
    post_status: 'publish',
    post_type: 'page',
    post_parent: 0,
    post_author: 0,
  };
  snapshot.db.wp_posts[`ID:${sourceChildId}`] = {
    ID: sourceChildId,
    post_title: 'Production Private RPP-0380 Child',
    post_name: 'rpp-0380-importer-exporter-child',
    post_content: 'production-private-rpp-0380-child-body',
    post_status: 'publish',
    post_type: 'page',
    post_parent: sourceParentId,
    post_author: 0,
  };
  snapshot.db.wp_postmeta[`post_id:${sourceParentId}:meta_key:${metaKey}`] = {
    post_id: sourceParentId,
    meta_key: metaKey,
    meta_value: 'production-private-rpp-0380-meta',
  };
  return snapshot;
}

function importedRemoteSnapshot({ staleTarget = false } = {}) {
  const snapshot = baseSite();
  snapshot.db.wp_posts[`ID:${importedTargetId}`] = {
    ID: importedTargetId,
    post_title: staleTarget
      ? 'Stale Production Private RPP-0380 Parent'
      : 'Production Private RPP-0380 Parent',
    post_name: 'rpp-0380-importer-exporter-parent',
    post_content: staleTarget
      ? 'stale-production-private-rpp-0380-parent-body'
      : 'production-private-rpp-0380-parent-body',
    post_status: 'publish',
    post_type: 'page',
    post_parent: 0,
    post_author: 0,
  };
  return snapshot;
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

function rewriteFor(mutation, relationshipType) {
  return mutation?.wordpressGraphIdentity?.rewrites?.find((rewrite) =>
    rewrite.relationshipType === relationshipType);
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function assertLiveRemotePreconditions(plan) {
  for (const mutation of plan.mutations) {
    const precondition = plan.preconditions.find((entry) => entry.mutationId === mutation.id);
    assert.ok(precondition, `missing live-remote precondition for ${mutation.resourceKey}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey);
    assert.equal(precondition.checkedAgainst, 'live-remote');
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.match(precondition.expectedHash, hashPattern);
  }
}

function assertHashOnlyBlockerEvidence(blocker) {
  for (const hash of [
    blocker.baseHash,
    blocker.localHash,
    blocker.remoteHash,
    blocker.change.base.hash,
    blocker.change.local.hash,
    blocker.change.remote.hash,
  ]) {
    assert.match(hash, hashPattern);
  }
  assert.equal(Object.hasOwn(blocker.change.local, 'value'), false);
  assert.equal(Object.hasOwn(blocker.change.remote, 'value'), false);

  for (const reference of blocker.references || []) {
    for (const hash of [
      reference.targetBaseHash,
      reference.targetLocalHash,
      reference.targetRemoteHash,
      reference.targetChange?.base?.hash,
      reference.targetChange?.local?.hash,
      reference.targetChange?.remote?.hash,
      reference.targetRemoteHash,
    ].filter(Boolean)) {
      assert.match(hash, hashPattern);
    }
    if (reference.targetChange) {
      assert.equal(Object.hasOwn(reference.targetChange.local, 'value'), false);
      assert.equal(Object.hasOwn(reference.targetChange.remote, 'value'), false);
    }
  }
}

test('RPP-0380 rewrites production pushIdentityMap dependents to the imported remote target', () => {
  const base = sourceSnapshot();
  const local = localEditedSnapshot();
  const remote = importedRemoteSnapshot();
  const plan = planFor(base, local, remote);
  const sourceDecision = decisionFor(plan, sourceParentResourceKey);
  const targetDecision = decisionFor(plan, importedTargetResourceKey);
  const childMutation = mutationFor(plan, sourceChildResourceKey);
  const postmetaMutation = mutationFor(plan, importedPostmetaResourceKey);
  assert.ok(childMutation, 'expected child page mutation to be planned');
  assert.ok(postmetaMutation, 'expected rewritten imported-target postmeta mutation');
  const plannedChild = deserializeResourceValue(childMutation.value);
  const plannedPostmeta = deserializeResourceValue(postmetaMutation.value);
  const childRewrite = rewriteFor(childMutation, 'post-parent');
  const postmetaRewrite = rewriteFor(postmetaMutation, 'postmeta-post');
  const applied = applyPlan(remote, plan).site;

  assert.equal(base.meta.pushIdentityMap.provenance.importer.immutableBase, true);
  assert.equal(plan.status, 'ready');
  assert.equal(sourceDecision.decision, 'map-local-identity-to-remote');
  assert.equal(sourceDecision.identityMapSource, pushIdentityMapSource);
  assert.equal(sourceDecision.targetResourceKey, importedTargetResourceKey);
  assert.equal(targetDecision.decision, 'keep-remote');
  assert.equal(mutationFor(plan, sourceParentResourceKey), undefined);
  assert.equal(mutationFor(plan, sourcePostmetaResourceKey), undefined);

  assert.equal(plannedChild.post_parent, importedTargetId);
  assert.equal(childRewrite.relationshipKey, 'wp_posts.post_parent');
  assert.equal(childRewrite.sourceTargetResourceKey, sourceParentResourceKey);
  assert.equal(childRewrite.targetResourceKey, importedTargetResourceKey);
  assert.equal(childRewrite.identityMapSource, pushIdentityMapSource);
  assert.match(childRewrite.sourceTargetLocalHash, hashPattern);
  assert.match(childRewrite.targetRemoteHash, hashPattern);

  assert.equal(plannedPostmeta.post_id, importedTargetId);
  assert.equal(plannedPostmeta.meta_key, metaKey);
  assert.equal(plannedPostmeta.meta_value, 'production-private-rpp-0380-meta');
  assert.equal(postmetaRewrite.relationshipKey, 'wp_postmeta.post_id');
  assert.equal(postmetaRewrite.sourceResourceKey, sourcePostmetaResourceKey);
  assert.equal(postmetaRewrite.rewrittenResourceKey, importedPostmetaResourceKey);
  assert.equal(postmetaRewrite.sourceTargetResourceKey, sourceParentResourceKey);
  assert.equal(postmetaRewrite.targetResourceKey, importedTargetResourceKey);
  assert.equal(postmetaRewrite.identityMapSource, pushIdentityMapSource);
  assert.match(postmetaRewrite.sourceTargetLocalHash, hashPattern);
  assert.match(postmetaRewrite.targetRemoteHash, hashPattern);
  assertLiveRemotePreconditions(plan);

  assert.deepEqual(applied.db.wp_posts[`ID:${importedTargetId}`], remote.db.wp_posts[`ID:${importedTargetId}`]);
  assert.equal(applied.db.wp_posts[`ID:${sourceChildId}`].post_parent, importedTargetId);
  assert.equal(
    applied.db.wp_postmeta[`post_id:${importedTargetId}:meta_key:${metaKey}`].post_id,
    importedTargetId,
  );
});

test('RPP-0380 blocks stale imported targets with hash-only graph evidence', () => {
  const base = sourceSnapshot();
  const local = localEditedSnapshot();
  const remote = importedRemoteSnapshot({ staleTarget: true });
  const plan = planFor(base, local, remote);
  const sourceBlocker = blockerFor(plan, sourceParentResourceKey);
  const childBlocker = blockerFor(plan, sourceChildResourceKey);
  const postmetaBlocker = blockerFor(plan, sourcePostmetaResourceKey);
  const remoteBefore = JSON.parse(JSON.stringify(remote));
  const beforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));
  const serializedBlockers = JSON.stringify(plan.blockers);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.mutations.length, 0);
  assert.ok(sourceBlocker, 'missing stale imported target source blocker');
  assert.equal(sourceBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(sourceBlocker.reason, /not equivalent after identity rewriting/);
  assert.ok(childBlocker, 'missing child blocker for unusable imported target');
  assert.equal(childBlocker.class, 'stale-wordpress-graph-identity');
  assert.ok(postmetaBlocker, 'missing postmeta blocker for unusable imported target');
  assert.equal(postmetaBlocker.class, 'stale-wordpress-graph-identity');
  assert.ok(postmetaBlocker.references.some((reference) =>
    reference.relationshipType === 'postmeta-post'
    && reference.targetResourceKey === sourceParentResourceKey
    && reference.targetSupport?.className === 'stale-wordpress-graph-identity'));
  assert.ok(childBlocker.references.some((reference) =>
    reference.relationshipType === 'post-parent'
    && reference.targetResourceKey === sourceParentResourceKey
    && reference.targetSupport?.className === 'stale-wordpress-graph-identity'));

  for (const blocker of [sourceBlocker, childBlocker, postmetaBlocker]) {
    assertHashOnlyBlockerEvidence(blocker);
  }
  for (const privateToken of privateTokens) {
    assert.equal(serializedBlockers.includes(privateToken), false, `blocker leaked ${privateToken}`);
  }
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(digest(remoteBefore), beforeHash, 'blocked stale identity-map plan must not mutate remote');
});
