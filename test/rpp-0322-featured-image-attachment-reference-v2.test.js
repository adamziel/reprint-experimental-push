import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue } from '../src/resources.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');

function baseSite() {
  return {
    files: {},
    plugins: {},
    db: {
      wp_posts: {
        'ID:1': {
          ID: 1,
          post_title: 'Existing parent post',
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

function rowResourceKey(table, rowId) {
  return `row:${JSON.stringify([table, rowId])}`;
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

function deserializeMutationValue(mutation) {
  return deserializeResourceValue(mutation.value);
}

function assertEveryMutationHasLiveRemotePrecondition(plan) {
  for (const mutation of plan.mutations) {
    const precondition = plan.preconditions.find((entry) => entry.mutationId === mutation.id);
    assert.ok(precondition, `missing live precondition for ${mutation.resourceKey}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.equal(precondition.checkedAgainst, 'live-remote');
  }
}

function assertHashOnlyEvidence(entry, label) {
  for (const hashField of ['baseHash', 'localHash', 'remoteHash']) {
    assert.match(entry[hashField], /^[a-f0-9]{64}$/, `${label}.${hashField}`);
  }
  for (const stateField of ['base', 'local', 'remote']) {
    assert.match(entry.change[stateField].hash, /^[a-f0-9]{64}$/, `${label}.change.${stateField}.hash`);
    assert.equal(
      Object.hasOwn(entry.change[stateField], 'value'),
      false,
      `${label}.change.${stateField} must be hash-only`,
    );
  }
}

test('RPP-0322 proves featured image attachment identity maps rewrite to proven remote attachments', () => {
  const localPostResourceKey = rowResourceKey('wp_posts', 'ID:432201');
  const localAttachmentResourceKey = rowResourceKey('wp_posts', 'ID:432202');
  const remotePostResourceKey = rowResourceKey('wp_posts', 'ID:532201');
  const remoteAttachmentResourceKey = rowResourceKey('wp_posts', 'ID:532202');
  const localMetaResourceKey = rowResourceKey('wp_postmeta', 'post_id:432201:meta_key:_thumbnail_id');
  const remoteMetaResourceKey = rowResourceKey('wp_postmeta', 'post_id:532201:meta_key:_thumbnail_id');
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.meta = {
    wordpressGraphIdentityMap: {
      rows: [
        { table: 'wp_posts', localId: 'ID:432201', remoteId: 'ID:532201' },
        { table: 'wp_posts', localId: 'ID:432202', remoteId: 'ID:532202' },
      ],
    },
  };
  local.db.wp_posts['ID:432201'] = {
    ID: 432201,
    post_title: 'RPP-0322 mapped featured parent',
    post_name: 'rpp-0322-mapped-featured-parent',
    post_status: 'publish',
    post_type: 'page',
    post_parent: 0,
    post_author: 0,
  };
  remote.db.wp_posts['ID:532201'] = {
    ID: 532201,
    post_title: 'RPP-0322 mapped featured parent',
    post_name: 'rpp-0322-mapped-featured-parent',
    post_status: 'publish',
    post_type: 'page',
    post_parent: 0,
    post_author: 0,
  };
  local.db.wp_posts['ID:432202'] = {
    ID: 432202,
    post_title: 'RPP-0322 mapped featured attachment',
    post_name: 'rpp-0322-mapped-featured-attachment',
    post_status: 'inherit',
    post_type: 'attachment',
    post_parent: 432201,
    post_author: 0,
  };
  remote.db.wp_posts['ID:532202'] = {
    ID: 532202,
    post_title: 'RPP-0322 mapped featured attachment',
    post_name: 'rpp-0322-mapped-featured-attachment',
    post_status: 'inherit',
    post_type: 'attachment',
    post_parent: 532201,
    post_author: 0,
  };
  local.db.wp_postmeta['post_id:432201:meta_key:_thumbnail_id'] = {
    post_id: 432201,
    meta_key: '_thumbnail_id',
    meta_value: '432202',
  };

  const plan = planFor(base, local, remote);
  const rewrittenMetaMutation = mutationFor(plan, remoteMetaResourceKey);
  const rewrittenMetaValue = deserializeMutationValue(rewrittenMetaMutation);
  const rewriteTypes = rewrittenMetaMutation.wordpressGraphIdentity.rewrites
    .map((rewrite) => rewrite.relationshipType)
    .sort();
  const applied = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(mutationFor(plan, localPostResourceKey), undefined);
  assert.equal(mutationFor(plan, localAttachmentResourceKey), undefined);
  assert.equal(mutationFor(plan, localMetaResourceKey), undefined);
  assert.equal(decisionFor(plan, localPostResourceKey).decision, 'map-local-identity-to-remote');
  assert.equal(decisionFor(plan, localAttachmentResourceKey).decision, 'map-local-identity-to-remote');
  assert.equal(decisionFor(plan, remotePostResourceKey).decision, 'keep-remote');
  assert.equal(decisionFor(plan, remoteAttachmentResourceKey).decision, 'keep-remote');
  assert.equal(rewrittenMetaMutation.changeKind, 'create');
  assert.equal(rewrittenMetaValue.post_id, 532201);
  assert.equal(rewrittenMetaValue.meta_key, '_thumbnail_id');
  assert.equal(rewrittenMetaValue.meta_value, '532202');
  assert.deepEqual(rewriteTypes, ['featured-image-attachment', 'postmeta-post']);
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(applied.site.db.wp_posts['ID:432201'], undefined);
  assert.equal(applied.site.db.wp_posts['ID:432202'], undefined);
  assert.equal(applied.site.db.wp_posts['ID:532202'].post_parent, 532201);
  assert.deepEqual(applied.site.db.wp_postmeta['post_id:532201:meta_key:_thumbnail_id'], {
    post_id: 532201,
    meta_key: '_thumbnail_id',
    meta_value: '532202',
  });
});

test('RPP-0322 fails closed with hash-only evidence when _thumbnail_id points at an unsupported target', () => {
  const sourceResourceKey = rowResourceKey('wp_postmeta', 'meta_id:3222');
  const targetResourceKey = rowResourceKey('wp_posts', 'ID:432299');
  const rawValues = [
    'rpp-0322-unsupported-target-title',
    'rpp-0322-unsupported-target-body',
    'rpp-0322-unsupported-postmeta-payload',
  ];
  const base = baseSite();
  base.db.wp_posts['ID:432299'] = {
    ID: 432299,
    post_title: rawValues[0],
    post_content: rawValues[1],
    post_status: 'publish',
    post_type: 'page',
    post_parent: 0,
    post_author: 0,
  };
  const local = cloneJson(base);
  const remote = cloneJson(base);
  local.db.wp_postmeta['meta_id:3222'] = {
    meta_id: 3222,
    post_id: 1,
    meta_key: '_thumbnail_id',
    meta_value: '432299',
    private_payload: rawValues[2],
  };

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === sourceResourceKey);
  const reference = blocker?.references.find((entry) =>
    entry.relationshipType === 'featured-image-attachment');
  const serializedPlan = JSON.stringify(plan);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, sourceResourceKey), undefined);
  assert.ok(blocker, 'missing fail-closed blocker for unsupported featured image target');
  assert.equal(blocker.class, 'stale-wordpress-graph-identity');
  assert.equal(blocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
  assertHashOnlyEvidence(blocker, 'blocker');
  assert.ok(reference, 'missing featured-image-attachment reference evidence');
  assert.equal(reference.relationshipKey, 'wp_postmeta.meta_value');
  assert.equal(reference.targetResourceKey, targetResourceKey);
  assert.deepEqual(reference.targetSupport, {
    supported: false,
    className: 'stale-wordpress-graph-identity',
    reason: `WordPress graph mutation ${sourceResourceKey} references a _thumbnail_id target that is not a supported attachment row.`,
  });
  for (const hashField of ['targetBaseHash', 'targetLocalHash', 'targetRemoteHash']) {
    assert.match(reference[hashField], /^[a-f0-9]{64}$/, `reference.${hashField}`);
  }
  for (const stateField of ['base', 'local', 'remote']) {
    assert.match(reference.targetChange[stateField].hash, /^[a-f0-9]{64}$/);
    assert.equal(
      Object.hasOwn(reference.targetChange[stateField], 'value'),
      false,
      `reference.targetChange.${stateField} must be hash-only`,
    );
  }
  for (const rawValue of rawValues) {
    assert.equal(serializedPlan.includes(rawValue), false, `${rawValue} leaked into plan evidence`);
  }
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
});
