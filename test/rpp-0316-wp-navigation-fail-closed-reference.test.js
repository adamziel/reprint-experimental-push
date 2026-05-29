import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-29T00:00:00.000Z');
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
      wp_postmeta: {},
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
    assert.equal(serialized.includes(privateValue), false, `blocker leaked ${privateValue}`);
  }
}

test('RPP-0316 fails closed when wp_navigation references lack proven identity mapping', () => {
  const navigationResourceKey = rowResourceKey('wp_posts', 'ID:316');
  const navigationMetaResourceKey = rowResourceKey(
    'wp_postmeta',
    'post_id:316:meta_key:rpp0316_navigation_owner',
  );
  const privateValues = [
    'Local Private RPP-0316 Navigation',
    'local-private-rpp0316-navigation',
    'local-private-rpp0316-navigation-body',
    'local-private-rpp0316-navigation-guid',
    'local-private-rpp0316-navigation-meta',
  ];
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.db.wp_posts['ID:316'] = {
    ID: 316,
    post_title: 'Local Private RPP-0316 Navigation',
    post_name: 'local-private-rpp0316-navigation',
    post_content: '<!-- wp:navigation-link {"label":"local-private-rpp0316-navigation-body"} /-->',
    post_status: 'publish',
    post_type: 'wp_navigation',
    post_parent: 0,
    post_author: 0,
    guid: 'local-private-rpp0316-navigation-guid',
  };
  local.db.wp_postmeta['post_id:316:meta_key:rpp0316_navigation_owner'] = {
    post_id: 316,
    meta_key: 'rpp0316_navigation_owner',
    meta_value: 'local-private-rpp0316-navigation-meta',
  };

  const plan = planFor(base, local, remote);
  const navigationBlocker = blockerFor(plan, navigationResourceKey);
  const metaBlocker = blockerFor(plan, navigationMetaResourceKey);
  const postReference = metaBlocker?.references.find((reference) =>
    reference.relationshipType === 'postmeta-post');
  const remoteBefore = cloneJson(remote);
  const beforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));

  assert.equal(plan.status, 'blocked');
  assert.equal(mutationFor(plan, navigationResourceKey), undefined);
  assert.equal(mutationFor(plan, navigationMetaResourceKey), undefined);

  assert.ok(navigationBlocker, 'missing wp_navigation blocker');
  assert.equal(navigationBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(navigationBlocker.reason, /unsupported post graph surface wp_navigation/);
  assert.equal(navigationBlocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
  assert.deepEqual(navigationBlocker.references, []);

  assert.ok(metaBlocker, 'missing wp_navigation postmeta reference blocker');
  assert.equal(metaBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(metaBlocker.reason, /without proven identity mapping or reference rewriting/);
  assert.ok(postReference, 'missing postmeta-post target evidence');
  assert.equal(postReference.relationshipKey, 'wp_postmeta.post_id');
  assert.equal(postReference.targetResourceKey, navigationResourceKey);
  assert.deepEqual(postReference.targetSupport, {
    supported: false,
    className: 'stale-wordpress-graph-identity',
    reason: `WordPress graph mutation ${navigationResourceKey} references unsupported post graph surface wp_navigation.`,
  });

  for (const hash of [
    postReference.targetBaseHash,
    postReference.targetLocalHash,
    postReference.targetRemoteHash,
    postReference.targetChange.base.hash,
    postReference.targetChange.local.hash,
    postReference.targetChange.remote.hash,
  ]) {
    assert.match(hash, hashPattern);
  }
  assert.equal(Object.hasOwn(postReference.targetChange.local, 'value'), false);
  assert.equal(Object.hasOwn(postReference.targetChange.remote, 'value'), false);
  for (const blocker of [navigationBlocker, metaBlocker]) {
    assertHashOnlyChangeEvidence(blocker, privateValues);
  }
  for (const privateValue of privateValues) {
    assert.equal(JSON.stringify(postReference).includes(privateValue), false, `reference leaked ${privateValue}`);
  }
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(digest(remoteBefore), beforeHash, 'blocked wp_navigation plan must refuse before mutation');
});

test('RPP-0316 rewrites wp_navigation post references only when explicit identity-map evidence proves the target', () => {
  const sourceNavigationResourceKey = rowResourceKey('wp_posts', 'ID:316');
  const targetNavigationResourceKey = rowResourceKey('wp_posts', 'ID:1316');
  const sourceNavigationMetaResourceKey = rowResourceKey(
    'wp_postmeta',
    'post_id:316:meta_key:rpp0316_navigation_owner',
  );
  const rewrittenNavigationMetaResourceKey = rowResourceKey(
    'wp_postmeta',
    'post_id:1316:meta_key:rpp0316_navigation_owner',
  );
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.meta = {
    wordpressGraphIdentityMap: {
      rows: [
        { table: 'wp_posts', localId: 'ID:316', remoteId: 'ID:1316' },
      ],
    },
  };
  local.db.wp_posts['ID:316'] = {
    ID: 316,
    post_title: 'Mapped RPP-0316 Navigation',
    post_name: 'mapped-rpp0316-navigation',
    post_content: '<!-- wp:navigation-link {"label":"Mapped RPP-0316 Link","url":"/shop"} /-->',
    post_status: 'publish',
    post_type: 'wp_navigation',
    post_parent: 0,
    post_author: 0,
  };
  remote.db.wp_posts['ID:1316'] = {
    ID: 1316,
    post_title: 'Mapped RPP-0316 Navigation',
    post_name: 'mapped-rpp0316-navigation',
    post_content: '<!-- wp:navigation-link {"label":"Mapped RPP-0316 Link","url":"/shop"} /-->',
    post_status: 'publish',
    post_type: 'wp_navigation',
    post_parent: 0,
    post_author: 0,
  };
  local.db.wp_postmeta['post_id:316:meta_key:rpp0316_navigation_owner'] = {
    post_id: 316,
    meta_key: 'rpp0316_navigation_owner',
    meta_value: 'mapped-rpp0316-navigation-meta',
  };

  const plan = planFor(base, local, remote);
  const result = applyPlan(cloneJson(remote), plan);
  const rewrittenMetaMutation = mutationFor(plan, rewrittenNavigationMetaResourceKey);
  const plannedMeta = deserializeResourceValue(rewrittenMetaMutation.value);
  const postRewrite = rewrittenMetaMutation.wordpressGraphIdentity?.rewrites.find((rewrite) =>
    rewrite.relationshipType === 'postmeta-post');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(mutationFor(plan, sourceNavigationResourceKey), undefined);
  assert.equal(mutationFor(plan, targetNavigationResourceKey), undefined);
  assert.equal(mutationFor(plan, sourceNavigationMetaResourceKey), undefined);
  assert.equal(decisionFor(plan, sourceNavigationResourceKey).decision, 'map-local-identity-to-remote');
  assert.equal(decisionFor(plan, targetNavigationResourceKey).decision, 'keep-remote');
  assert.ok(rewrittenMetaMutation, 'missing rewritten wp_navigation metadata mutation');
  assert.equal(rewrittenMetaMutation.changeKind, 'create');
  assert.equal(plannedMeta.post_id, 1316);
  assert.equal(plannedMeta.meta_key, 'rpp0316_navigation_owner');
  assert.equal(plannedMeta.meta_value, 'mapped-rpp0316-navigation-meta');
  assert.ok(postRewrite, 'missing wp_navigation identity rewrite evidence');
  assert.equal(postRewrite.relationshipKey, 'wp_postmeta.post_id');
  assert.equal(postRewrite.sourceTargetResourceKey, sourceNavigationResourceKey);
  assert.equal(postRewrite.targetResourceKey, targetNavigationResourceKey);
  assert.equal(postRewrite.rewrittenResourceKey, rewrittenNavigationMetaResourceKey);
  assert.match(postRewrite.sourceTargetLocalHash, hashPattern);
  assert.match(postRewrite.targetRemoteHash, hashPattern);
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(result.site.db.wp_posts['ID:316'], undefined);
  assert.equal(result.site.db.wp_posts['ID:1316'].post_type, 'wp_navigation');
  assert.deepEqual(result.site.db.wp_postmeta['post_id:1316:meta_key:rpp0316_navigation_owner'], {
    post_id: 1316,
    meta_key: 'rpp0316_navigation_owner',
    meta_value: 'mapped-rpp0316-navigation-meta',
  });
});
