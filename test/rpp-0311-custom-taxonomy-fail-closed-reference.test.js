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

test('RPP-0311 fails closed for custom taxonomy references without a proven identity map', () => {
  const termResourceKey = rowResourceKey('wp_terms', 'term_id:44');
  const taxonomyResourceKey = rowResourceKey('wp_term_taxonomy', 'term_taxonomy_id:54');
  const relationshipResourceKey = rowResourceKey(
    'wp_term_relationships',
    'object_id:1|term_taxonomy_id:54',
  );
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.db.wp_terms['term_id:44'] = {
    term_id: 44,
    name: 'Local Private RPP-0311 Product Category',
    slug: 'local-private-rpp0311-product-category',
    term_group: 0,
  };
  local.db.wp_term_taxonomy['term_taxonomy_id:54'] = {
    term_taxonomy_id: 54,
    term_id: 44,
    taxonomy: 'product_cat',
    description: 'local-private-rpp0311-product-taxonomy-description',
    parent: 0,
    count: 1,
  };
  local.db.wp_term_relationships['object_id:1|term_taxonomy_id:54'] = {
    object_id: 1,
    term_taxonomy_id: 54,
    term_order: 0,
  };

  const plan = planFor(base, local, remote);
  const taxonomyBlocker = plan.blockers.find((blocker) => blocker.resourceKey === taxonomyResourceKey);
  const relationshipBlocker = plan.blockers.find((blocker) => blocker.resourceKey === relationshipResourceKey);
  const relationshipReference = relationshipBlocker?.references.find((reference) =>
    reference.relationshipType === 'term-relationship-taxonomy');
  const blockerJson = JSON.stringify({ taxonomyBlocker, relationshipBlocker });
  const remoteBefore = cloneJson(remote);
  const beforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));

  assert.equal(plan.status, 'blocked');
  assert.equal(mutationFor(plan, taxonomyResourceKey), undefined);
  assert.equal(mutationFor(plan, relationshipResourceKey), undefined);
  assert.ok(mutationFor(plan, termResourceKey), 'the standalone term row may be planned, but the blocked plan cannot apply');
  assert.ok(taxonomyBlocker, 'missing custom taxonomy blocker');
  assert.equal(taxonomyBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(taxonomyBlocker.reason, /unsupported taxonomy graph surface product_cat/);
  assert.equal(taxonomyBlocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
  assert.ok(relationshipBlocker, 'missing relationship blocker');
  assert.equal(relationshipBlocker.class, 'stale-wordpress-graph-identity');
  assert.ok(relationshipReference, 'missing relationship target evidence');
  assert.equal(relationshipReference.relationshipKey, 'wp_term_relationships.term_taxonomy_id');
  assert.equal(relationshipReference.targetResourceKey, taxonomyResourceKey);
  assert.deepEqual(relationshipReference.targetSupport, {
    supported: false,
    className: 'stale-wordpress-graph-identity',
    reason: `WordPress graph mutation ${taxonomyResourceKey} references unsupported taxonomy graph surface product_cat.`,
  });
  for (const hash of [
    taxonomyBlocker.baseHash,
    taxonomyBlocker.localHash,
    taxonomyBlocker.remoteHash,
    taxonomyBlocker.change.base.hash,
    taxonomyBlocker.change.local.hash,
    taxonomyBlocker.change.remote.hash,
    relationshipReference.targetBaseHash,
    relationshipReference.targetLocalHash,
    relationshipReference.targetRemoteHash,
    relationshipReference.targetChange.base.hash,
    relationshipReference.targetChange.local.hash,
    relationshipReference.targetChange.remote.hash,
  ]) {
    assert.match(hash, hashPattern);
  }
  assert.equal(Object.hasOwn(taxonomyBlocker.change.local, 'value'), false);
  assert.equal(Object.hasOwn(relationshipReference.targetChange.local, 'value'), false);
  for (const privateValue of [
    'Local Private RPP-0311 Product Category',
    'local-private-rpp0311-product-category',
    'local-private-rpp0311-product-taxonomy-description',
  ]) {
    assert.equal(blockerJson.includes(privateValue), false, `blocker leaked ${privateValue}`);
  }
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(digest(remoteBefore), beforeHash, 'blocked custom taxonomy plan must refuse before mutation');
});

test('RPP-0311 rewrites a custom taxonomy relationship only when explicit identity-map evidence proves the target', () => {
  const sourceTermResourceKey = rowResourceKey('wp_terms', 'term_id:44');
  const targetTermResourceKey = rowResourceKey('wp_terms', 'term_id:144');
  const sourceTaxonomyResourceKey = rowResourceKey('wp_term_taxonomy', 'term_taxonomy_id:54');
  const targetTaxonomyResourceKey = rowResourceKey('wp_term_taxonomy', 'term_taxonomy_id:154');
  const sourceRelationshipResourceKey = rowResourceKey(
    'wp_term_relationships',
    'object_id:1|term_taxonomy_id:54',
  );
  const rewrittenRelationshipResourceKey = rowResourceKey(
    'wp_term_relationships',
    'object_id:1|term_taxonomy_id:154',
  );
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.meta = {
    wordpressGraphIdentityMap: {
      rows: [
        { table: 'wp_terms', localId: 'term_id:44', remoteId: 'term_id:144' },
        { table: 'wp_term_taxonomy', localId: 'term_taxonomy_id:54', remoteId: 'term_taxonomy_id:154' },
      ],
    },
  };
  local.db.wp_terms['term_id:44'] = {
    term_id: 44,
    name: 'Mapped RPP-0311 Product Category',
    slug: 'mapped-rpp0311-product-category',
    term_group: 0,
  };
  remote.db.wp_terms['term_id:144'] = {
    term_id: 144,
    name: 'Mapped RPP-0311 Product Category',
    slug: 'mapped-rpp0311-product-category',
    term_group: 0,
  };
  local.db.wp_term_taxonomy['term_taxonomy_id:54'] = {
    term_taxonomy_id: 54,
    term_id: 44,
    taxonomy: 'product_cat',
    description: 'Mapped RPP-0311 custom taxonomy target',
    parent: 0,
    count: 1,
  };
  remote.db.wp_term_taxonomy['term_taxonomy_id:154'] = {
    term_taxonomy_id: 154,
    term_id: 144,
    taxonomy: 'product_cat',
    description: 'Mapped RPP-0311 custom taxonomy target',
    parent: 0,
    count: 1,
  };
  local.db.wp_term_relationships['object_id:1|term_taxonomy_id:54'] = {
    object_id: 1,
    term_taxonomy_id: 54,
    term_order: 0,
  };

  const plan = planFor(base, local, remote);
  const result = applyPlan(cloneJson(remote), plan);
  const relationshipMutation = mutationFor(plan, rewrittenRelationshipResourceKey);
  const plannedRelationship = deserializeResourceValue(relationshipMutation.value);
  const taxonomyRewrite = relationshipMutation.wordpressGraphIdentity?.rewrites.find((rewrite) =>
    rewrite.relationshipType === 'term-relationship-taxonomy');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(mutationFor(plan, sourceTermResourceKey), undefined);
  assert.equal(mutationFor(plan, sourceTaxonomyResourceKey), undefined);
  assert.equal(mutationFor(plan, sourceRelationshipResourceKey), undefined);
  assert.equal(decisionFor(plan, sourceTermResourceKey).decision, 'map-local-identity-to-remote');
  assert.equal(decisionFor(plan, sourceTaxonomyResourceKey).decision, 'map-local-identity-to-remote');
  assert.equal(decisionFor(plan, targetTermResourceKey).decision, 'keep-remote');
  assert.equal(decisionFor(plan, targetTaxonomyResourceKey).decision, 'keep-remote');
  assert.ok(relationshipMutation, 'missing rewritten relationship mutation');
  assert.equal(relationshipMutation.changeKind, 'create');
  assert.equal(plannedRelationship.object_id, 1);
  assert.equal(plannedRelationship.term_taxonomy_id, 154);
  assert.ok(taxonomyRewrite, 'missing custom taxonomy identity rewrite evidence');
  assert.equal(taxonomyRewrite.relationshipKey, 'wp_term_relationships.term_taxonomy_id');
  assert.equal(taxonomyRewrite.sourceTargetResourceKey, sourceTaxonomyResourceKey);
  assert.equal(taxonomyRewrite.targetResourceKey, targetTaxonomyResourceKey);
  assert.equal(taxonomyRewrite.rewrittenResourceKey, rewrittenRelationshipResourceKey);
  assert.match(taxonomyRewrite.sourceTargetLocalHash, hashPattern);
  assert.match(taxonomyRewrite.targetRemoteHash, hashPattern);
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(result.site.db.wp_terms['term_id:44'], undefined);
  assert.equal(result.site.db.wp_term_taxonomy['term_taxonomy_id:54'], undefined);
  assert.equal(result.site.db.wp_term_taxonomy['term_taxonomy_id:154'].taxonomy, 'product_cat');
  assert.deepEqual(result.site.db.wp_term_relationships['object_id:1|term_taxonomy_id:154'], {
    object_id: 1,
    term_taxonomy_id: 154,
    term_order: 0,
  });
});
