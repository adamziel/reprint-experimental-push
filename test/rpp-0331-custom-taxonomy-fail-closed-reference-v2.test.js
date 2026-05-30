import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;

const postId = 331001;
const sourceTermId = 33144;
const sourceTermTaxonomyId = 33154;
const targetTermId = 33244;
const targetTermTaxonomyId = 33254;
const taxonomy = 'product_cat';

const sourceTermResourceKey = rowResourceKey('wp_terms', `term_id:${sourceTermId}`);
const sourceTaxonomyResourceKey = rowResourceKey('wp_term_taxonomy', `term_taxonomy_id:${sourceTermTaxonomyId}`);
const sourceRelationshipResourceKey = rowResourceKey(
  'wp_term_relationships',
  `object_id:${postId}|term_taxonomy_id:${sourceTermTaxonomyId}`,
);
const targetTermResourceKey = rowResourceKey('wp_terms', `term_id:${targetTermId}`);
const targetTaxonomyResourceKey = rowResourceKey('wp_term_taxonomy', `term_taxonomy_id:${targetTermTaxonomyId}`);
const rewrittenRelationshipResourceKey = rowResourceKey(
  'wp_term_relationships',
  `object_id:${postId}|term_taxonomy_id:${targetTermTaxonomyId}`,
);

const privateCustomTaxonomyValues = Object.freeze([
  'Local Private RPP-0331 Product Category',
  'local-private-rpp0331-product-category',
  'local-private-rpp0331-taxonomy-description',
  'Mapped RPP-0331 Product Category',
  'mapped-rpp0331-product-category',
  'Mapped RPP-0331 custom taxonomy target',
]);

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "rpp-0331-base";',
    },
    plugins: {},
    db: {
      wp_posts: {
        [`ID:${postId}`]: {
          ID: postId,
          post_title: 'RPP-0331 stable post object',
          post_name: 'rpp-0331-stable-post-object',
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

function addLocalCustomTaxonomySource(snapshot, { withIdentityMap = false } = {}) {
  if (withIdentityMap) {
    snapshot.meta = {
      wordpressGraphIdentityMap: {
        rows: [
          { table: 'wp_terms', localId: `term_id:${sourceTermId}`, remoteId: `term_id:${targetTermId}` },
          {
            table: 'wp_term_taxonomy',
            localId: `term_taxonomy_id:${sourceTermTaxonomyId}`,
            remoteId: `term_taxonomy_id:${targetTermTaxonomyId}`,
          },
        ],
      },
    };
  }

  snapshot.db.wp_terms[`term_id:${sourceTermId}`] = {
    term_id: sourceTermId,
    name: withIdentityMap ? 'Mapped RPP-0331 Product Category' : 'Local Private RPP-0331 Product Category',
    slug: withIdentityMap ? 'mapped-rpp0331-product-category' : 'local-private-rpp0331-product-category',
    term_group: 0,
  };
  snapshot.db.wp_term_taxonomy[`term_taxonomy_id:${sourceTermTaxonomyId}`] = {
    term_taxonomy_id: sourceTermTaxonomyId,
    term_id: sourceTermId,
    taxonomy,
    description: withIdentityMap
      ? 'Mapped RPP-0331 custom taxonomy target'
      : 'local-private-rpp0331-taxonomy-description',
    parent: 0,
    count: 1,
  };
  snapshot.db.wp_term_relationships[
    `object_id:${postId}|term_taxonomy_id:${sourceTermTaxonomyId}`
  ] = {
    object_id: postId,
    term_taxonomy_id: sourceTermTaxonomyId,
    term_order: 0,
  };
}

function addRemoteCustomTaxonomyTarget(snapshot) {
  snapshot.db.wp_terms[`term_id:${targetTermId}`] = {
    term_id: targetTermId,
    name: 'Mapped RPP-0331 Product Category',
    slug: 'mapped-rpp0331-product-category',
    term_group: 0,
  };
  snapshot.db.wp_term_taxonomy[`term_taxonomy_id:${targetTermTaxonomyId}`] = {
    term_taxonomy_id: targetTermTaxonomyId,
    term_id: targetTermId,
    taxonomy,
    description: 'Mapped RPP-0331 custom taxonomy target',
    parent: 0,
    count: 1,
  };
}

function assertHashOnlyChangeEvidence(entry) {
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
}

function assertHashOnlyTargetReference(reference) {
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
}

function assertNoPrivateCustomTaxonomyValues(value, label) {
  const serialized = JSON.stringify(value);
  for (const privateValue of privateCustomTaxonomyValues) {
    assert.equal(serialized.includes(privateValue), false, `${label} leaked ${privateValue}`);
  }
}

function assertEveryMutationHasLiveRemotePrecondition(plan) {
  for (const mutation of plan.mutations) {
    const precondition = preconditionFor(plan, mutation);
    assert.ok(precondition, `missing live precondition for ${mutation.resourceKey}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey);
    assert.equal(precondition.checkedAgainst, 'live-remote');
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.match(precondition.expectedHash, hashPattern);
  }
}

test('RPP-0331 fails closed for custom taxonomy targets without stable identity proof', () => {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);
  addLocalCustomTaxonomySource(local);

  const plan = planFor(base, local, remote);
  const taxonomyBlocker = blockerFor(plan, sourceTaxonomyResourceKey);
  const relationshipBlocker = blockerFor(plan, sourceRelationshipResourceKey);
  const relationshipReference = relationshipBlocker?.references.find((reference) =>
    reference.relationshipType === 'term-relationship-taxonomy');
  const remoteBefore = cloneJson(remote);
  const beforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));

  assert.equal(plan.status, 'blocked');
  assert.deepEqual(plan.summary, {
    mutations: 1,
    decisions: 0,
    conflicts: 0,
    blockers: 2,
    atomicGroups: 0,
  });
  assert.ok(mutationFor(plan, sourceTermResourceKey), 'standalone term row may be planned but cannot apply');
  assert.equal(mutationFor(plan, sourceTaxonomyResourceKey), null);
  assert.equal(mutationFor(plan, sourceRelationshipResourceKey), null);

  assert.ok(taxonomyBlocker, 'missing custom taxonomy blocker');
  assert.equal(taxonomyBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(taxonomyBlocker.reason, /unsupported taxonomy graph surface product_cat/);
  assert.equal(taxonomyBlocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
  assert.deepEqual(taxonomyBlocker.references, []);
  assertHashOnlyChangeEvidence(taxonomyBlocker);

  assert.ok(relationshipBlocker, 'missing relationship blocker');
  assert.equal(relationshipBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(relationshipBlocker.reason, /without proven identity mapping or reference rewriting/);
  assertHashOnlyChangeEvidence(relationshipBlocker);

  assert.ok(relationshipReference, 'missing relationship target reference evidence');
  assert.equal(relationshipReference.relationshipKey, 'wp_term_relationships.term_taxonomy_id');
  assert.equal(relationshipReference.relationshipType, 'term-relationship-taxonomy');
  assert.equal(relationshipReference.targetResourceKey, sourceTaxonomyResourceKey);
  assert.deepEqual(relationshipReference.targetSupport, {
    supported: false,
    className: 'stale-wordpress-graph-identity',
    reason: `WordPress graph mutation ${sourceTaxonomyResourceKey} references unsupported taxonomy graph surface product_cat.`,
  });
  assertHashOnlyTargetReference(relationshipReference);
  assertNoPrivateCustomTaxonomyValues(
    { taxonomyBlocker, relationshipBlocker, relationshipReference },
    'RPP-0331 fail-closed evidence',
  );

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(digest(remoteBefore), beforeHash, 'blocked custom taxonomy plan must refuse before mutation');
});

test('RPP-0331 rewrites custom taxonomy relationship when identity map proves the target', () => {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);
  addLocalCustomTaxonomySource(local, { withIdentityMap: true });
  addRemoteCustomTaxonomyTarget(remote);

  const plan = planFor(base, local, remote);
  const relationshipMutation = mutationFor(plan, rewrittenRelationshipResourceKey);

  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.summary, {
    mutations: 1,
    decisions: 4,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.equal(plan.blockers.length, 0);
  assert.equal(mutationFor(plan, sourceTermResourceKey), null);
  assert.equal(mutationFor(plan, sourceTaxonomyResourceKey), null);
  assert.equal(mutationFor(plan, sourceRelationshipResourceKey), null);
  assert.equal(decisionFor(plan, sourceTermResourceKey)?.decision, 'map-local-identity-to-remote');
  assert.equal(decisionFor(plan, sourceTermResourceKey)?.targetResourceKey, targetTermResourceKey);
  assert.equal(decisionFor(plan, sourceTaxonomyResourceKey)?.decision, 'map-local-identity-to-remote');
  assert.equal(decisionFor(plan, sourceTaxonomyResourceKey)?.targetResourceKey, targetTaxonomyResourceKey);
  assert.equal(decisionFor(plan, targetTermResourceKey)?.decision, 'keep-remote');
  assert.equal(decisionFor(plan, targetTaxonomyResourceKey)?.decision, 'keep-remote');

  assert.ok(relationshipMutation, 'missing rewritten relationship mutation');
  const plannedRelationship = deserializeResourceValue(relationshipMutation.value);
  const taxonomyRewrite = relationshipMutation.wordpressGraphIdentity?.rewrites.find((rewrite) =>
    rewrite.relationshipType === 'term-relationship-taxonomy');
  const precondition = preconditionFor(plan, relationshipMutation);

  assert.equal(relationshipMutation.resourceKey, rewrittenRelationshipResourceKey);
  assert.equal(relationshipMutation.changeKind, 'create');
  assert.equal(plannedRelationship.object_id, postId);
  assert.equal(plannedRelationship.term_taxonomy_id, targetTermTaxonomyId);
  assert.ok(taxonomyRewrite, 'missing custom taxonomy identity rewrite evidence');
  assert.equal(taxonomyRewrite.relationshipKey, 'wp_term_relationships.term_taxonomy_id');
  assert.equal(taxonomyRewrite.sourceResourceKey, sourceRelationshipResourceKey);
  assert.equal(taxonomyRewrite.sourceTargetResourceKey, sourceTaxonomyResourceKey);
  assert.equal(taxonomyRewrite.targetResourceKey, targetTaxonomyResourceKey);
  assert.equal(taxonomyRewrite.rewrittenResourceKey, rewrittenRelationshipResourceKey);
  assert.match(taxonomyRewrite.sourceTargetLocalHash, hashPattern);
  assert.match(taxonomyRewrite.targetRemoteHash, hashPattern);
  assert.equal(precondition.checkedAgainst, 'live-remote');
  assert.equal(precondition.expectedHash, relationshipMutation.remoteBeforeHash);
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(cloneJson(remote), plan);
  assert.equal(result.appliedMutations, 1);
  assert.equal(result.site.db.wp_terms[`term_id:${sourceTermId}`], undefined);
  assert.equal(result.site.db.wp_term_taxonomy[`term_taxonomy_id:${sourceTermTaxonomyId}`], undefined);
  assert.equal(result.site.db.wp_term_taxonomy[`term_taxonomy_id:${targetTermTaxonomyId}`].taxonomy, taxonomy);
  assert.deepEqual(result.site.db.wp_term_relationships[
    `object_id:${postId}|term_taxonomy_id:${targetTermTaxonomyId}`
  ], {
    object_id: postId,
    term_taxonomy_id: targetTermTaxonomyId,
    term_order: 0,
  });
});
