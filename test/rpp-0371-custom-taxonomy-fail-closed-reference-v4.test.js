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

function assertHashOnlyChangeEvidence(entry, privateValues) {
  assert.ok(entry, 'missing hash-only graph evidence entry');
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

  const serialized = JSON.stringify(entry);
  for (const privateValue of privateValues) {
    assert.equal(serialized.includes(privateValue), false, `graph evidence leaked ${privateValue}`);
  }
}

function assertHashOnlyTargetReference(reference, privateValues) {
  assert.ok(reference, 'missing hash-only target reference evidence');
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

  assert.equal(Object.hasOwn(reference.targetChange.base, 'value'), false);
  assert.equal(Object.hasOwn(reference.targetChange.local, 'value'), false);
  assert.equal(Object.hasOwn(reference.targetChange.remote, 'value'), false);

  const serialized = JSON.stringify(reference);
  for (const privateValue of privateValues) {
    assert.equal(serialized.includes(privateValue), false, `reference evidence leaked ${privateValue}`);
  }
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

test('RPP-0371 fails closed for unsupported custom taxonomy targets with hash-only evidence', () => {
  const termResourceKey = rowResourceKey('wp_terms', 'term_id:37144');
  const taxonomyResourceKey = rowResourceKey('wp_term_taxonomy', 'term_taxonomy_id:37154');
  const relationshipResourceKey = rowResourceKey(
    'wp_term_relationships',
    'object_id:1|term_taxonomy_id:37154',
  );
  const privateValues = [
    'Local Private RPP-0371 Product Category',
    'local-private-rpp0371-product-category',
    'local-private-rpp0371-taxonomy-description',
  ];
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.db.wp_terms['term_id:37144'] = {
    term_id: 37144,
    name: 'Local Private RPP-0371 Product Category',
    slug: 'local-private-rpp0371-product-category',
    term_group: 0,
  };
  local.db.wp_term_taxonomy['term_taxonomy_id:37154'] = {
    term_taxonomy_id: 37154,
    term_id: 37144,
    taxonomy: 'product_cat',
    description: 'local-private-rpp0371-taxonomy-description',
    parent: 0,
    count: 1,
  };
  local.db.wp_term_relationships['object_id:1|term_taxonomy_id:37154'] = {
    object_id: 1,
    term_taxonomy_id: 37154,
    term_order: 0,
  };

  const plan = planFor(base, local, remote);
  const taxonomyBlocker = blockerFor(plan, taxonomyResourceKey);
  const relationshipBlocker = blockerFor(plan, relationshipResourceKey);
  const relationshipReference = relationshipBlocker?.references.find((reference) =>
    reference.relationshipType === 'term-relationship-taxonomy');
  const remoteBefore = cloneJson(remote);
  const beforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));

  assert.equal(plan.status, 'blocked');
  assert.equal(mutationFor(plan, taxonomyResourceKey), undefined);
  assert.equal(mutationFor(plan, relationshipResourceKey), undefined);
  assert.ok(mutationFor(plan, termResourceKey), 'standalone term row may be planned but blocked plan cannot apply');

  assert.ok(taxonomyBlocker, 'missing custom taxonomy blocker');
  assert.equal(taxonomyBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(taxonomyBlocker.reason, /unsupported taxonomy graph surface product_cat/);
  assert.equal(taxonomyBlocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
  assert.deepEqual(taxonomyBlocker.references, []);
  assertHashOnlyChangeEvidence(taxonomyBlocker, privateValues);

  assert.ok(relationshipBlocker, 'missing relationship blocker');
  assert.equal(relationshipBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(relationshipBlocker.reason, /without proven identity mapping or reference rewriting/);
  assertHashOnlyChangeEvidence(relationshipBlocker, privateValues);

  assert.ok(relationshipReference, 'missing relationship target evidence');
  assert.equal(relationshipReference.relationshipKey, 'wp_term_relationships.term_taxonomy_id');
  assert.equal(relationshipReference.relationshipType, 'term-relationship-taxonomy');
  assert.equal(relationshipReference.targetResourceKey, taxonomyResourceKey);
  assert.deepEqual(relationshipReference.targetSupport, {
    supported: false,
    className: 'stale-wordpress-graph-identity',
    reason: `WordPress graph mutation ${taxonomyResourceKey} references unsupported taxonomy graph surface product_cat.`,
  });
  assertHashOnlyTargetReference(relationshipReference, privateValues);

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(digest(remoteBefore), beforeHash, 'blocked custom taxonomy plan must refuse before mutation');
});

test('RPP-0371 rewrites a custom taxonomy relationship only after explicit stable target mapping', () => {
  const sourceTermResourceKey = rowResourceKey('wp_terms', 'term_id:37144');
  const targetTermResourceKey = rowResourceKey('wp_terms', 'term_id:37244');
  const sourceTaxonomyResourceKey = rowResourceKey('wp_term_taxonomy', 'term_taxonomy_id:37154');
  const targetTaxonomyResourceKey = rowResourceKey('wp_term_taxonomy', 'term_taxonomy_id:37254');
  const sourceRelationshipResourceKey = rowResourceKey(
    'wp_term_relationships',
    'object_id:1|term_taxonomy_id:37154',
  );
  const rewrittenRelationshipResourceKey = rowResourceKey(
    'wp_term_relationships',
    'object_id:1|term_taxonomy_id:37254',
  );
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.meta = {
    wordpressGraphIdentityMap: {
      rows: [
        { table: 'wp_terms', localId: 'term_id:37144', remoteId: 'term_id:37244' },
        { table: 'wp_term_taxonomy', localId: 'term_taxonomy_id:37154', remoteId: 'term_taxonomy_id:37254' },
      ],
    },
  };
  local.db.wp_terms['term_id:37144'] = {
    term_id: 37144,
    name: 'Mapped RPP-0371 Product Category',
    slug: 'mapped-rpp0371-product-category',
    term_group: 0,
  };
  remote.db.wp_terms['term_id:37244'] = {
    term_id: 37244,
    name: 'Mapped RPP-0371 Product Category',
    slug: 'mapped-rpp0371-product-category',
    term_group: 0,
  };
  local.db.wp_term_taxonomy['term_taxonomy_id:37154'] = {
    term_taxonomy_id: 37154,
    term_id: 37144,
    taxonomy: 'product_cat',
    description: 'Mapped RPP-0371 custom taxonomy target',
    parent: 0,
    count: 1,
  };
  remote.db.wp_term_taxonomy['term_taxonomy_id:37254'] = {
    term_taxonomy_id: 37254,
    term_id: 37244,
    taxonomy: 'product_cat',
    description: 'Mapped RPP-0371 custom taxonomy target',
    parent: 0,
    count: 1,
  };
  local.db.wp_term_relationships['object_id:1|term_taxonomy_id:37154'] = {
    object_id: 1,
    term_taxonomy_id: 37154,
    term_order: 0,
  };

  const plan = planFor(base, local, remote);
  const relationshipMutation = mutationFor(plan, rewrittenRelationshipResourceKey);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(plan.blockers.length, 0);
  assert.equal(mutationFor(plan, sourceTermResourceKey), undefined);
  assert.equal(mutationFor(plan, sourceTaxonomyResourceKey), undefined);
  assert.equal(mutationFor(plan, sourceRelationshipResourceKey), undefined);
  assert.equal(decisionFor(plan, sourceTermResourceKey)?.decision, 'map-local-identity-to-remote');
  assert.equal(decisionFor(plan, sourceTaxonomyResourceKey)?.decision, 'map-local-identity-to-remote');
  assert.equal(decisionFor(plan, targetTermResourceKey)?.decision, 'keep-remote');
  assert.equal(decisionFor(plan, targetTaxonomyResourceKey)?.decision, 'keep-remote');
  assert.ok(relationshipMutation, 'missing rewritten relationship mutation');

  const plannedRelationship = deserializeResourceValue(relationshipMutation.value);
  const taxonomyRewrite = relationshipMutation.wordpressGraphIdentity?.rewrites.find((rewrite) =>
    rewrite.relationshipType === 'term-relationship-taxonomy');
  assert.equal(relationshipMutation.changeKind, 'create');
  assert.equal(plannedRelationship.object_id, 1);
  assert.equal(plannedRelationship.term_taxonomy_id, 37254);
  assert.ok(taxonomyRewrite, 'missing custom taxonomy identity rewrite evidence');
  assert.equal(taxonomyRewrite.relationshipKey, 'wp_term_relationships.term_taxonomy_id');
  assert.equal(taxonomyRewrite.sourceTargetResourceKey, sourceTaxonomyResourceKey);
  assert.equal(taxonomyRewrite.targetResourceKey, targetTaxonomyResourceKey);
  assert.equal(taxonomyRewrite.sourceResourceKey, sourceRelationshipResourceKey);
  assert.equal(taxonomyRewrite.rewrittenResourceKey, rewrittenRelationshipResourceKey);
  assert.match(taxonomyRewrite.sourceTargetLocalHash, hashPattern);
  assert.match(taxonomyRewrite.targetRemoteHash, hashPattern);
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(cloneJson(remote), plan);
  assert.equal(result.appliedMutations, 1);
  assert.equal(result.site.db.wp_terms['term_id:37144'], undefined);
  assert.equal(result.site.db.wp_terms['term_id:37244'].name, 'Mapped RPP-0371 Product Category');
  assert.equal(result.site.db.wp_term_taxonomy['term_taxonomy_id:37154'], undefined);
  assert.equal(result.site.db.wp_term_taxonomy['term_taxonomy_id:37254'].taxonomy, 'product_cat');
  assert.deepEqual(result.site.db.wp_term_relationships['object_id:1|term_taxonomy_id:37254'], {
    object_id: 1,
    term_taxonomy_id: 37254,
    term_order: 0,
  });
});
