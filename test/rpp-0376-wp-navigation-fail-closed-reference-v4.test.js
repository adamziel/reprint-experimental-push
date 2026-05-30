import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const sha256HexPattern = /^[a-f0-9]{64}$/;

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "rpp0376 base";',
    },
    plugins: {},
    db: {
      wp_posts: {
        'ID:1': {
          ID: 1,
          post_title: 'RPP 0376 base post',
          post_name: 'rpp-0376-base-post',
          post_content: 'RPP 0376 base content',
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

function assertSha256Hash(value, label) {
  assert.match(value, sha256HexPattern, label);
}

function assertHashOnlyChangeEvidence(entry, privateValues, label) {
  for (const [field, hash] of [
    ['baseHash', entry.baseHash],
    ['localHash', entry.localHash],
    ['remoteHash', entry.remoteHash],
    ['change.base.hash', entry.change.base.hash],
    ['change.local.hash', entry.change.local.hash],
    ['change.remote.hash', entry.change.remote.hash],
  ]) {
    assertSha256Hash(hash, `${label} ${field}`);
  }

  assert.equal(Object.hasOwn(entry.change.local, 'value'), false, `${label} leaked local value`);
  assert.equal(Object.hasOwn(entry.change.remote, 'value'), false, `${label} leaked remote value`);

  const serialized = JSON.stringify(entry);
  for (const privateValue of privateValues) {
    assert.equal(serialized.includes(privateValue), false, `${label} leaked ${privateValue}`);
  }
}

function assertTargetReferenceHashOnly(reference, privateValues) {
  for (const [field, hash] of [
    ['targetBaseHash', reference.targetBaseHash],
    ['targetLocalHash', reference.targetLocalHash],
    ['targetRemoteHash', reference.targetRemoteHash],
    ['targetChange.base.hash', reference.targetChange.base.hash],
    ['targetChange.local.hash', reference.targetChange.local.hash],
    ['targetChange.remote.hash', reference.targetChange.remote.hash],
  ]) {
    assertSha256Hash(hash, `target reference ${field}`);
  }

  assert.equal(Object.hasOwn(reference.targetChange.local, 'value'), false, 'target reference leaked local value');
  assert.equal(Object.hasOwn(reference.targetChange.remote, 'value'), false, 'target reference leaked remote value');

  const serialized = JSON.stringify(reference);
  for (const privateValue of privateValues) {
    assert.equal(serialized.includes(privateValue), false, `target reference leaked ${privateValue}`);
  }
}

function assertEveryMutationHasLiveRemotePrecondition(plan) {
  assert.equal(plan.preconditions.length, plan.mutations.length, 'expected one precondition per mutation');

  for (const mutation of plan.mutations) {
    const precondition = plan.preconditions.find((entry) => entry.mutationId === mutation.id);
    assert.ok(precondition, `missing precondition for ${mutation.resourceKey}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey);
    assert.equal(precondition.checkedAgainst, 'live-remote');
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
  }
}

test('RPP-0376 wp_navigation reference fails closed before mutation without proven target identity', () => {
  const navigationResourceKey = rowResourceKey('wp_posts', 'ID:376');
  const navigationMetaResourceKey = rowResourceKey(
    'wp_postmeta',
    'post_id:376:meta_key:rpp0376_navigation_owner',
  );
  const privateValues = [
    'RPP-0376 Private Navigation',
    'rpp-0376-private-navigation',
    'rpp-0376-private-navigation-body',
    'rpp-0376-private-navigation-guid',
    'rpp-0376-private-navigation-meta',
  ];
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.db.wp_posts['ID:376'] = {
    ID: 376,
    post_title: 'RPP-0376 Private Navigation',
    post_name: 'rpp-0376-private-navigation',
    post_content: '<!-- wp:navigation-link {"label":"rpp-0376-private-navigation-body"} /-->',
    post_status: 'publish',
    post_type: 'wp_navigation',
    post_parent: 0,
    post_author: 0,
    guid: 'rpp-0376-private-navigation-guid',
  };
  local.db.wp_postmeta['post_id:376:meta_key:rpp0376_navigation_owner'] = {
    post_id: 376,
    meta_key: 'rpp0376_navigation_owner',
    meta_value: 'rpp-0376-private-navigation-meta',
  };

  const plan = planFor(base, local, remote);
  const navigationBlocker = blockerFor(plan, navigationResourceKey);
  const metaBlocker = blockerFor(plan, navigationMetaResourceKey);
  const postReference = metaBlocker?.references.find(
    (reference) => reference.relationshipType === 'postmeta-post',
  );
  const liveRemote = cloneJson(remote);
  const liveRemoteBeforeHash = digest(liveRemote);
  const error = captureError(() => applyPlan(liveRemote, plan));

  assert.equal(plan.status, 'blocked');
  assert.equal(mutationFor(plan, navigationResourceKey), undefined);
  assert.equal(mutationFor(plan, navigationMetaResourceKey), undefined);

  assert.ok(navigationBlocker, 'missing wp_navigation blocker');
  assert.equal(navigationBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(navigationBlocker.reason, /unsupported post graph surface wp_navigation/);
  assert.equal(navigationBlocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
  assert.deepEqual(navigationBlocker.references, []);
  assertHashOnlyChangeEvidence(navigationBlocker, privateValues, 'wp_navigation blocker');

  assert.ok(metaBlocker, 'missing dependent wp_postmeta blocker');
  assert.equal(metaBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(metaBlocker.reason, /without proven identity mapping or reference rewriting/);
  assertHashOnlyChangeEvidence(metaBlocker, privateValues, 'wp_postmeta blocker');

  assert.ok(postReference, 'missing postmeta-post target evidence');
  assert.equal(postReference.relationshipKey, 'wp_postmeta.post_id');
  assert.equal(postReference.targetResourceKey, navigationResourceKey);
  assert.deepEqual(postReference.targetSupport, {
    supported: false,
    className: 'stale-wordpress-graph-identity',
    reason: `WordPress graph mutation ${navigationResourceKey} references unsupported post graph surface wp_navigation.`,
  });
  assertTargetReferenceHashOnly(postReference, privateValues);

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(digest(liveRemote), liveRemoteBeforeHash, 'blocked wp_navigation plan mutated remote state');
});

test('RPP-0376 wp_navigation mapper rewrites dependent references only with explicit identity proof', () => {
  const sourceNavigationResourceKey = rowResourceKey('wp_posts', 'ID:376');
  const targetNavigationResourceKey = rowResourceKey('wp_posts', 'ID:1376');
  const sourceNavigationMetaResourceKey = rowResourceKey(
    'wp_postmeta',
    'post_id:376:meta_key:rpp0376_navigation_owner',
  );
  const rewrittenNavigationMetaResourceKey = rowResourceKey(
    'wp_postmeta',
    'post_id:1376:meta_key:rpp0376_navigation_owner',
  );
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.meta = {
    wordpressGraphIdentityMap: {
      rows: [
        { table: 'wp_posts', localId: 'ID:376', remoteId: 'ID:1376' },
      ],
    },
  };
  local.db.wp_posts['ID:376'] = {
    ID: 376,
    post_title: 'Mapped RPP-0376 Navigation',
    post_name: 'mapped-rpp-0376-navigation',
    post_content: '<!-- wp:navigation-link {"label":"Mapped RPP-0376 Link","url":"/rpp-0376"} /-->',
    post_status: 'publish',
    post_type: 'wp_navigation',
    post_parent: 0,
    post_author: 0,
  };
  remote.db.wp_posts['ID:1376'] = {
    ID: 1376,
    post_title: 'Mapped RPP-0376 Navigation',
    post_name: 'mapped-rpp-0376-navigation',
    post_content: '<!-- wp:navigation-link {"label":"Mapped RPP-0376 Link","url":"/rpp-0376"} /-->',
    post_status: 'publish',
    post_type: 'wp_navigation',
    post_parent: 0,
    post_author: 0,
  };
  local.db.wp_postmeta['post_id:376:meta_key:rpp0376_navigation_owner'] = {
    post_id: 376,
    meta_key: 'rpp0376_navigation_owner',
    meta_value: 'mapped-rpp-0376-navigation-meta',
  };

  const plan = planFor(base, local, remote);
  const result = applyPlan(cloneJson(remote), plan);
  const rewrittenMetaMutation = mutationFor(plan, rewrittenNavigationMetaResourceKey);

  assert.ok(rewrittenMetaMutation, 'missing rewritten wp_navigation metadata mutation');

  const plannedMeta = deserializeResourceValue(rewrittenMetaMutation.value);
  const postRewrite = rewrittenMetaMutation.wordpressGraphIdentity?.rewrites.find(
    (rewrite) => rewrite.relationshipType === 'postmeta-post',
  );

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(mutationFor(plan, sourceNavigationResourceKey), undefined);
  assert.equal(mutationFor(plan, targetNavigationResourceKey), undefined);
  assert.equal(mutationFor(plan, sourceNavigationMetaResourceKey), undefined);
  assert.equal(decisionFor(plan, sourceNavigationResourceKey).decision, 'map-local-identity-to-remote');
  assert.equal(decisionFor(plan, targetNavigationResourceKey).decision, 'keep-remote');

  assert.equal(rewrittenMetaMutation.changeKind, 'create');
  assert.deepEqual(plannedMeta, {
    post_id: 1376,
    meta_key: 'rpp0376_navigation_owner',
    meta_value: 'mapped-rpp-0376-navigation-meta',
  });

  assert.ok(postRewrite, 'missing wp_navigation identity rewrite evidence');
  assert.equal(postRewrite.relationshipKey, 'wp_postmeta.post_id');
  assert.equal(postRewrite.sourceTargetResourceKey, sourceNavigationResourceKey);
  assert.equal(postRewrite.targetResourceKey, targetNavigationResourceKey);
  assert.equal(postRewrite.rewrittenResourceKey, rewrittenNavigationMetaResourceKey);
  assertSha256Hash(postRewrite.sourceTargetLocalHash, 'rewrite source local hash');
  assertSha256Hash(postRewrite.targetRemoteHash, 'rewrite target remote hash');

  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(result.site.db.wp_posts['ID:376'], undefined);
  assert.equal(result.site.db.wp_posts['ID:1376'].post_type, 'wp_navigation');
  assert.deepEqual(result.site.db.wp_postmeta['post_id:1376:meta_key:rpp0376_navigation_owner'], {
    post_id: 1376,
    meta_key: 'rpp0376_navigation_owner',
    meta_value: 'mapped-rpp-0376-navigation-meta',
  });
});
