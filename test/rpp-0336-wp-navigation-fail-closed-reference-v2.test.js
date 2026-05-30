import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T03:36:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;

const sourceNavigationId = 336;
const targetNavigationId = 1336;
const sourceNavigationRowId = `ID:${sourceNavigationId}`;
const targetNavigationRowId = `ID:${targetNavigationId}`;
const navigationMetaKey = 'rpp0336_navigation_owner';
const sourceNavigationMetaRowId = `post_id:${sourceNavigationId}:meta_key:${navigationMetaKey}`;
const rewrittenNavigationMetaRowId = `post_id:${targetNavigationId}:meta_key:${navigationMetaKey}`;

const sourceNavigationResourceKey = rowResourceKey('wp_posts', sourceNavigationRowId);
const targetNavigationResourceKey = rowResourceKey('wp_posts', targetNavigationRowId);
const sourceNavigationMetaResourceKey = rowResourceKey('wp_postmeta', sourceNavigationMetaRowId);
const rewrittenNavigationMetaResourceKey = rowResourceKey('wp_postmeta', rewrittenNavigationMetaRowId);

const privateNavigationValues = Object.freeze([
  'RPP-0336 Local Private Navigation',
  'rpp-0336-local-private-navigation',
  'RPP-0336 private navigation block label',
  'rpp-0336-local-private-navigation-guid',
  'rpp-0336-private-navigation-meta',
  'RPP-0336 Mapped Private Navigation',
  'rpp-0336-mapped-private-navigation',
  'RPP-0336 mapped private navigation block label',
  'rpp-0336-mapped-private-navigation-meta',
]);

function rowResourceKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "rpp-0336 base";',
    },
    plugins: {},
    db: {
      wp_posts: {
        'ID:1': {
          ID: 1,
          post_title: 'RPP-0336 stable anchor post',
          post_name: 'rpp-0336-stable-anchor',
          post_content: 'RPP-0336 stable anchor body',
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

function navigationRow({ id, title, slug, label, guid = undefined }) {
  return {
    ID: id,
    post_title: title,
    post_name: slug,
    post_content: `<!-- wp:navigation-link {"label":${JSON.stringify(label)},"url":"/rpp-0336"} /-->`,
    post_status: 'publish',
    post_type: 'wp_navigation',
    post_parent: 0,
    post_author: 0,
    ...(guid ? { guid } : {}),
  };
}

function addLocalNavigationSource(snapshot, { withIdentityMap = false } = {}) {
  if (withIdentityMap) {
    snapshot.meta = {
      wordpressGraphIdentityMap: {
        rows: [
          {
            table: 'wp_posts',
            localId: sourceNavigationRowId,
            remoteId: targetNavigationRowId,
          },
        ],
      },
    };
  }

  snapshot.db.wp_posts[sourceNavigationRowId] = navigationRow({
    id: sourceNavigationId,
    title: withIdentityMap ? 'RPP-0336 Mapped Private Navigation' : 'RPP-0336 Local Private Navigation',
    slug: withIdentityMap ? 'rpp-0336-mapped-private-navigation' : 'rpp-0336-local-private-navigation',
    label: withIdentityMap
      ? 'RPP-0336 mapped private navigation block label'
      : 'RPP-0336 private navigation block label',
    guid: withIdentityMap ? undefined : 'rpp-0336-local-private-navigation-guid',
  });
  snapshot.db.wp_postmeta[sourceNavigationMetaRowId] = {
    post_id: sourceNavigationId,
    meta_key: navigationMetaKey,
    meta_value: withIdentityMap
      ? 'rpp-0336-mapped-private-navigation-meta'
      : 'rpp-0336-private-navigation-meta',
  };
}

function addRemoteNavigationTarget(snapshot) {
  snapshot.db.wp_posts[targetNavigationRowId] = navigationRow({
    id: targetNavigationId,
    title: 'RPP-0336 Mapped Private Navigation',
    slug: 'rpp-0336-mapped-private-navigation',
    label: 'RPP-0336 mapped private navigation block label',
  });
}

function navigationSnapshots({ withIdentityMap = false, withRemoteTarget = false } = {}) {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  addLocalNavigationSource(local, { withIdentityMap });
  if (withRemoteTarget) {
    addRemoteNavigationTarget(remote);
  }

  return { base, local, remote };
}

function planFor({ base, local, remote }) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey) || null;
}

function decisionFor(plan, resourceKey) {
  return plan.decisions.find((decision) => decision.resourceKey === resourceKey) || null;
}

function blockerFor(plan, resourceKey) {
  return plan.blockers.find((blocker) => blocker.resourceKey === resourceKey) || null;
}

function preconditionFor(plan, mutation) {
  return plan.preconditions.find((precondition) =>
    precondition.mutationId === mutation?.id
    && precondition.resourceKey === mutation?.resourceKey) || null;
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function assertHashOnlyChangeEvidence(entry, label) {
  assert.ok(entry, `missing ${label}`);

  for (const [field, hash] of [
    ['baseHash', entry.baseHash],
    ['localHash', entry.localHash],
    ['remoteHash', entry.remoteHash],
    ['change.base.hash', entry.change.base.hash],
    ['change.local.hash', entry.change.local.hash],
    ['change.remote.hash', entry.change.remote.hash],
  ]) {
    assert.match(hash, hashPattern, `${label} ${field}`);
  }

  for (const state of ['base', 'local', 'remote']) {
    assert.equal(Object.hasOwn(entry.change[state], 'value'), false, `${label} leaked ${state} value`);
  }
}

function assertHashOnlyTargetReference(reference) {
  assert.ok(reference, 'missing target reference evidence');

  for (const [field, hash] of [
    ['targetBaseHash', reference.targetBaseHash],
    ['targetLocalHash', reference.targetLocalHash],
    ['targetRemoteHash', reference.targetRemoteHash],
    ['targetChange.base.hash', reference.targetChange.base.hash],
    ['targetChange.local.hash', reference.targetChange.local.hash],
    ['targetChange.remote.hash', reference.targetChange.remote.hash],
  ]) {
    assert.match(hash, hashPattern, `target reference ${field}`);
  }

  for (const state of ['base', 'local', 'remote']) {
    assert.equal(
      Object.hasOwn(reference.targetChange[state], 'value'),
      false,
      `target reference leaked ${state} value`,
    );
  }
}

function assertNoPrivateNavigationValues(value, label) {
  const serialized = JSON.stringify(value);

  for (const privateValue of privateNavigationValues) {
    assert.equal(serialized.includes(privateValue), false, `${label} leaked ${privateValue}`);
  }
  for (const rawField of ['post_title', 'post_name', 'post_content', 'guid', 'meta_value']) {
    assert.equal(serialized.includes(rawField), false, `${label} exposed raw field ${rawField}`);
  }

  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(value, { label }));
}

function assertEveryMutationHasLiveRemotePrecondition(plan) {
  assert.equal(plan.preconditions.length, plan.mutations.length, 'expected one precondition per mutation');

  for (const mutation of plan.mutations) {
    const precondition = preconditionFor(plan, mutation);
    assert.ok(precondition, `missing precondition for ${mutation.resourceKey}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey);
    assert.equal(precondition.checkedAgainst, 'live-remote');
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.match(precondition.expectedHash, hashPattern);
  }
}

test('RPP-0336 fails closed when wp_navigation postmeta targets lack stable identity proof', () => {
  const fixture = navigationSnapshots();
  const plan = planFor(fixture);
  const navigationBlocker = blockerFor(plan, sourceNavigationResourceKey);
  const metaBlocker = blockerFor(plan, sourceNavigationMetaResourceKey);
  const postReference = metaBlocker?.references.find((reference) =>
    reference.relationshipType === 'postmeta-post') || null;
  const remoteAttempt = cloneJson(fixture.remote);
  const remoteHashBefore = digest(remoteAttempt);
  let beforeMutationCalls = 0;
  const error = captureError(() => applyPlan(remoteAttempt, plan, {
    beforeMutation() {
      beforeMutationCalls += 1;
    },
  }));

  assert.equal(plan.status, 'blocked');
  assert.deepEqual(plan.summary, {
    mutations: 0,
    decisions: 0,
    conflicts: 0,
    blockers: 2,
    atomicGroups: 0,
  });
  assert.equal(mutationFor(plan, sourceNavigationResourceKey), null);
  assert.equal(mutationFor(plan, sourceNavigationMetaResourceKey), null);

  assert.equal(navigationBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(navigationBlocker.reason, /unsupported post graph surface wp_navigation/);
  assert.equal(navigationBlocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
  assert.deepEqual(navigationBlocker.references, []);
  assertHashOnlyChangeEvidence(navigationBlocker, 'wp_navigation blocker');

  assert.equal(metaBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(metaBlocker.reason, /without proven identity mapping or reference rewriting/);
  assertHashOnlyChangeEvidence(metaBlocker, 'wp_navigation postmeta blocker');

  assert.equal(postReference.relationshipKey, 'wp_postmeta.post_id');
  assert.equal(postReference.relationshipType, 'postmeta-post');
  assert.equal(postReference.targetResourceKey, sourceNavigationResourceKey);
  assert.deepEqual(postReference.targetSupport, {
    supported: false,
    className: 'stale-wordpress-graph-identity',
    reason: `WordPress graph mutation ${sourceNavigationResourceKey} references unsupported post graph surface wp_navigation.`,
  });
  assertHashOnlyTargetReference(postReference);
  assertNoPrivateNavigationValues(
    { navigationBlocker, metaBlocker, postReference },
    'RPP-0336 fail-closed evidence',
  );

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(beforeMutationCalls, 0);
  assert.equal(digest(remoteAttempt), remoteHashBefore, 'blocked wp_navigation plan must refuse before mutation');
});

test('RPP-0336 rewrites wp_navigation postmeta when the mapper proves the remote target', () => {
  const fixture = navigationSnapshots({
    withIdentityMap: true,
    withRemoteTarget: true,
  });
  const plan = planFor(fixture);
  const sourceDecision = decisionFor(plan, sourceNavigationResourceKey);
  const targetDecision = decisionFor(plan, targetNavigationResourceKey);
  const rewrittenMetaMutation = mutationFor(plan, rewrittenNavigationMetaResourceKey);

  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.summary, {
    mutations: 1,
    decisions: 2,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.equal(plan.blockers.length, 0);
  assert.equal(mutationFor(plan, sourceNavigationResourceKey), null);
  assert.equal(mutationFor(plan, targetNavigationResourceKey), null);
  assert.equal(mutationFor(plan, sourceNavigationMetaResourceKey), null);

  assert.equal(sourceDecision.decision, 'map-local-identity-to-remote');
  assert.equal(sourceDecision.targetResourceKey, targetNavigationResourceKey);
  assert.equal(targetDecision.decision, 'keep-remote');

  assert.ok(rewrittenMetaMutation, 'missing rewritten wp_navigation metadata mutation');
  const plannedMeta = deserializeResourceValue(rewrittenMetaMutation.value);
  const postRewrite = rewrittenMetaMutation.wordpressGraphIdentity?.rewrites.find((rewrite) =>
    rewrite.relationshipType === 'postmeta-post') || null;

  assert.equal(rewrittenMetaMutation.resourceKey, rewrittenNavigationMetaResourceKey);
  assert.equal(rewrittenMetaMutation.action, 'put');
  assert.equal(rewrittenMetaMutation.changeKind, 'create');
  assert.deepEqual(plannedMeta, {
    post_id: targetNavigationId,
    meta_key: navigationMetaKey,
    meta_value: 'rpp-0336-mapped-private-navigation-meta',
  });

  assert.ok(postRewrite, 'missing wp_navigation identity rewrite evidence');
  assert.equal(postRewrite.relationshipKey, 'wp_postmeta.post_id');
  assert.equal(postRewrite.sourceResourceKey, sourceNavigationMetaResourceKey);
  assert.equal(postRewrite.sourceTargetResourceKey, sourceNavigationResourceKey);
  assert.equal(postRewrite.targetResourceKey, targetNavigationResourceKey);
  assert.equal(postRewrite.rewrittenResourceKey, rewrittenNavigationMetaResourceKey);
  assert.equal(postRewrite.identityMapSource, 'local-snapshot.meta.identityMap[0].rows[0]');
  assert.equal(postRewrite.sourceTargetLocalHash, sourceDecision.localHash);
  assert.equal(postRewrite.targetRemoteHash, targetDecision.remoteHash);
  assert.match(postRewrite.sourceTargetLocalHash, hashPattern);
  assert.match(postRewrite.targetRemoteHash, hashPattern);
  assertNoPrivateNavigationValues(
    { sourceDecision, targetDecision, postRewrite },
    'RPP-0336 mapper identity evidence',
  );

  assertEveryMutationHasLiveRemotePrecondition(plan);
  const result = applyPlan(cloneJson(fixture.remote), plan);

  assert.equal(result.appliedMutations, 1);
  assert.equal(result.site.db.wp_posts[sourceNavigationRowId], undefined);
  assert.equal(result.site.db.wp_posts[targetNavigationRowId].post_type, 'wp_navigation');
  assert.equal(result.site.db.wp_postmeta[sourceNavigationMetaRowId], undefined);
  assert.deepEqual(result.site.db.wp_postmeta[rewrittenNavigationMetaRowId], {
    post_id: targetNavigationId,
    meta_key: navigationMetaKey,
    meta_value: 'rpp-0336-mapped-private-navigation-meta',
  });
});
