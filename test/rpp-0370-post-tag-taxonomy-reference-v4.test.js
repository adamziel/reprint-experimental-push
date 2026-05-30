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
          post_title: 'Base RPP-0370 post',
          post_name: 'base-rpp0370-post',
          post_status: 'publish',
          post_type: 'post',
          post_parent: 0,
          post_author: 0,
        },
      },
      wp_terms: {},
      wp_term_taxonomy: {},
      wp_term_relationships: {},
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
    assert.match(precondition.expectedHash, hashPattern);
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

test('RPP-0370 rewrites a post_tag taxonomy relationship with explicit identity-map evidence', () => {
  const sourceTermResourceKey = rowResourceKey('wp_terms', 'term_id:37025');
  const targetTermResourceKey = rowResourceKey('wp_terms', 'term_id:47025');
  const sourceTaxonomyResourceKey = rowResourceKey('wp_term_taxonomy', 'term_taxonomy_id:37035');
  const targetTaxonomyResourceKey = rowResourceKey('wp_term_taxonomy', 'term_taxonomy_id:47035');
  const sourceRelationshipResourceKey = rowResourceKey(
    'wp_term_relationships',
    'object_id:1|term_taxonomy_id:37035',
  );
  const rewrittenRelationshipResourceKey = rowResourceKey(
    'wp_term_relationships',
    'object_id:1|term_taxonomy_id:47035',
  );
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.meta = {
    wordpressGraphIdentityMap: {
      rows: [
        { table: 'wp_terms', localId: 'term_id:37025', remoteId: 'term_id:47025' },
        { table: 'wp_term_taxonomy', localId: 'term_taxonomy_id:37035', remoteId: 'term_taxonomy_id:47035' },
      ],
    },
  };
  local.db.wp_terms['term_id:37025'] = {
    term_id: 37025,
    name: 'Mapped RPP-0370 Post Tag',
    slug: 'mapped-rpp0370-post-tag',
    term_group: 0,
  };
  remote.db.wp_terms['term_id:47025'] = {
    term_id: 47025,
    name: 'Mapped RPP-0370 Post Tag',
    slug: 'mapped-rpp0370-post-tag',
    term_group: 0,
  };
  local.db.wp_term_taxonomy['term_taxonomy_id:37035'] = {
    term_taxonomy_id: 37035,
    term_id: 37025,
    taxonomy: 'post_tag',
    description: 'Mapped RPP-0370 post_tag target',
    parent: 0,
    count: 1,
  };
  remote.db.wp_term_taxonomy['term_taxonomy_id:47035'] = {
    term_taxonomy_id: 47035,
    term_id: 47025,
    taxonomy: 'post_tag',
    description: 'Mapped RPP-0370 post_tag target',
    parent: 0,
    count: 1,
  };
  local.db.wp_term_relationships['object_id:1|term_taxonomy_id:37035'] = {
    object_id: 1,
    term_taxonomy_id: 37035,
    term_order: 0,
  };

  const plan = planFor(base, local, remote);
  const relationshipMutation = mutationFor(plan, rewrittenRelationshipResourceKey);
  const relationshipValue = deserializeResourceValue(relationshipMutation?.value);
  const rewrite = relationshipMutation?.wordpressGraphIdentity?.rewrites?.find((entry) =>
    entry.relationshipType === 'term-relationship-taxonomy');
  const result = applyPlan(cloneJson(remote), plan);

  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.blockers, []);
  assert.equal(mutationFor(plan, sourceTermResourceKey), undefined);
  assert.equal(mutationFor(plan, sourceTaxonomyResourceKey), undefined);
  assert.equal(mutationFor(plan, sourceRelationshipResourceKey), undefined);
  assert.equal(decisionFor(plan, sourceTermResourceKey).decision, 'map-local-identity-to-remote');
  assert.equal(decisionFor(plan, sourceTermResourceKey).targetResourceKey, targetTermResourceKey);
  assert.equal(decisionFor(plan, sourceTaxonomyResourceKey).decision, 'map-local-identity-to-remote');
  assert.equal(decisionFor(plan, sourceTaxonomyResourceKey).targetResourceKey, targetTaxonomyResourceKey);
  assert.equal(decisionFor(plan, targetTermResourceKey).decision, 'keep-remote');
  assert.equal(decisionFor(plan, targetTaxonomyResourceKey).decision, 'keep-remote');
  assert.ok(relationshipMutation, 'missing rewritten post_tag relationship mutation');
  assert.equal(relationshipMutation.action, 'put');
  assert.equal(relationshipMutation.changeKind, 'create');
  assert.equal(relationshipMutation.resource.id, 'object_id:1|term_taxonomy_id:47035');
  assert.deepEqual(relationshipValue, {
    object_id: 1,
    term_taxonomy_id: 47035,
    term_order: 0,
  });
  assert.equal(relationshipMutation.wordpressGraphIdentity.sourceResourceKey, sourceRelationshipResourceKey);
  assert.ok(rewrite, 'missing post_tag taxonomy relationship rewrite evidence');
  assert.equal(rewrite.relationshipKey, 'wp_term_relationships.term_taxonomy_id');
  assert.equal(rewrite.sourceTargetResourceKey, sourceTaxonomyResourceKey);
  assert.equal(rewrite.targetResourceKey, targetTaxonomyResourceKey);
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(
    result.site.db.wp_term_relationships['object_id:1|term_taxonomy_id:37035'],
    undefined,
  );
  assert.deepEqual(
    result.site.db.wp_term_relationships['object_id:1|term_taxonomy_id:47035'],
    relationshipValue,
  );
  assert.equal(
    result.site.db.wp_term_taxonomy['term_taxonomy_id:47035'].taxonomy,
    'post_tag',
  );
  assert.equal(
    result.site.db.wp_term_taxonomy['term_taxonomy_id:47035'].term_id,
    47025,
  );
});

test('RPP-0370 fails closed when a post_tag taxonomy map omits equivalent term evidence', () => {
  const sourceTermResourceKey = rowResourceKey('wp_terms', 'term_id:37025');
  const sourceTaxonomyResourceKey = rowResourceKey('wp_term_taxonomy', 'term_taxonomy_id:37035');
  const targetTaxonomyResourceKey = rowResourceKey('wp_term_taxonomy', 'term_taxonomy_id:47035');
  const sourceRelationshipResourceKey = rowResourceKey(
    'wp_term_relationships',
    'object_id:1|term_taxonomy_id:37035',
  );
  const privateValues = [
    'Private Mismapped RPP-0370 Post Tag',
    'private-mismapped-rpp0370-post-tag',
    'private mismapped rpp0370 post_tag target',
  ];
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.meta = {
    wordpressGraphIdentityMap: {
      rows: [
        { table: 'wp_term_taxonomy', localId: 'term_taxonomy_id:37035', remoteId: 'term_taxonomy_id:47035' },
      ],
    },
  };
  local.db.wp_terms['term_id:37025'] = {
    term_id: 37025,
    name: 'Private Mismapped RPP-0370 Post Tag',
    slug: 'private-mismapped-rpp0370-post-tag',
    term_group: 0,
  };
  remote.db.wp_terms['term_id:47025'] = {
    term_id: 47025,
    name: 'Private Mismapped RPP-0370 Post Tag',
    slug: 'private-mismapped-rpp0370-post-tag',
    term_group: 0,
  };
  local.db.wp_term_taxonomy['term_taxonomy_id:37035'] = {
    term_taxonomy_id: 37035,
    term_id: 37025,
    taxonomy: 'post_tag',
    description: 'private mismapped rpp0370 post_tag target',
    parent: 0,
    count: 1,
  };
  remote.db.wp_term_taxonomy['term_taxonomy_id:47035'] = {
    term_taxonomy_id: 47035,
    term_id: 47025,
    taxonomy: 'post_tag',
    description: 'private mismapped rpp0370 post_tag target',
    parent: 0,
    count: 1,
  };
  local.db.wp_term_relationships['object_id:1|term_taxonomy_id:37035'] = {
    object_id: 1,
    term_taxonomy_id: 37035,
    term_order: 0,
  };

  const plan = planFor(base, local, remote);
  const taxonomyBlocker = blockerFor(plan, sourceTaxonomyResourceKey);
  const relationshipBlocker = blockerFor(plan, sourceRelationshipResourceKey);
  const relationshipReference = relationshipBlocker?.references.find((reference) =>
    reference.relationshipType === 'term-relationship-taxonomy');
  const remoteBefore = cloneJson(remote);
  const beforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));

  assert.equal(plan.status, 'blocked');
  assert.ok(mutationFor(plan, sourceTermResourceKey), 'standalone term may be planned, but the blocked plan cannot apply');
  assert.equal(mutationFor(plan, sourceTaxonomyResourceKey), undefined);
  assert.equal(mutationFor(plan, sourceRelationshipResourceKey), undefined);
  assert.ok(taxonomyBlocker, 'missing post_tag taxonomy identity-map blocker');
  assert.equal(taxonomyBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(taxonomyBlocker.reason, /not equivalent after identity rewriting/);
  assert.equal(taxonomyBlocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
  assert.equal(taxonomyBlocker.references[0].relationshipType, 'identity-map-target');
  assert.equal(taxonomyBlocker.references[0].targetResourceKey, targetTaxonomyResourceKey);
  assert.ok(relationshipBlocker, 'missing dependent post_tag relationship blocker');
  assert.equal(relationshipBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(relationshipBlocker.reason, /without proven identity mapping or reference rewriting/);
  assert.ok(relationshipReference, 'missing relationship target support evidence');
  assert.equal(relationshipReference.relationshipKey, 'wp_term_relationships.term_taxonomy_id');
  assert.equal(relationshipReference.targetResourceKey, sourceTaxonomyResourceKey);
  assert.deepEqual(relationshipReference.targetSupport, {
    supported: false,
    className: 'stale-wordpress-graph-identity',
    reason: `WordPress graph identity map for ${sourceTaxonomyResourceKey} points at a remote target row that is not equivalent after identity rewriting.`,
  });
  assertHashOnlyChangeEvidence(taxonomyBlocker, privateValues);
  assertHashOnlyChangeEvidence(relationshipBlocker, privateValues);
  for (const hash of [
    relationshipReference.targetBaseHash,
    relationshipReference.targetLocalHash,
    relationshipReference.targetRemoteHash,
    relationshipReference.targetChange.base.hash,
    relationshipReference.targetChange.local.hash,
    relationshipReference.targetChange.remote.hash,
  ]) {
    assert.match(hash, hashPattern);
  }
  assert.equal(Object.hasOwn(relationshipReference.targetChange.local, 'value'), false);
  assert.equal(Object.hasOwn(relationshipReference.targetChange.remote, 'value'), false);
  const blockerJson = JSON.stringify({ taxonomyBlocker, relationshipBlocker });
  for (const privateValue of privateValues) {
    assert.equal(blockerJson.includes(privateValue), false, `blocker leaked ${privateValue}`);
  }
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(digest(remoteBefore), beforeHash, 'blocked post_tag taxonomy plan must refuse before mutation');
});
