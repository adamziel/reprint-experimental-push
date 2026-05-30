import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue, resourceHash } from '../src/resources.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;

const termResourceKey = rowResourceKey('wp_terms', 'term_id:72901');
const taxonomyResourceKey = rowResourceKey('wp_term_taxonomy', 'term_taxonomy_id:72911');
const relationshipResourceKey = rowResourceKey(
  'wp_term_relationships',
  'object_id:71001|term_taxonomy_id:72911',
);
const termmetaResourceKey = rowResourceKey('wp_termmeta', 'meta_id:72921');
const categoryGraphResourceKeys = [
  relationshipResourceKey,
  taxonomyResourceKey,
  termmetaResourceKey,
  termResourceKey,
];
const rawFixtureSentinels = [
  'RPP-0369 Focused Category',
  'rpp-0369-focused-category',
  'rpp-0369-focused-category-description',
  'rpp-0369-focused-termmeta-value',
];

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "base";',
    },
    plugins: {},
    db: {
      wp_posts: {
        'ID:71001': {
          ID: 71001,
          post_title: 'RPP-0369 Base Post',
          post_name: 'rpp-0369-base-post',
          post_content: 'Base post for category graph apply proof.',
          post_status: 'publish',
          post_type: 'post',
          post_parent: 0,
          post_author: 0,
        },
      },
      wp_terms: {},
      wp_term_taxonomy: {},
      wp_term_relationships: {},
      wp_termmeta: {},
    },
  };
}

function localWithCategoryGraph(base) {
  const local = cloneJson(base);
  local.db.wp_terms['term_id:72901'] = {
    term_id: 72901,
    name: 'RPP-0369 Focused Category',
    slug: 'rpp-0369-focused-category',
    term_group: 0,
  };
  local.db.wp_term_taxonomy['term_taxonomy_id:72911'] = {
    term_taxonomy_id: 72911,
    term_id: 72901,
    taxonomy: 'category',
    description: 'rpp-0369-focused-category-description',
    parent: 0,
    count: 1,
  };
  local.db.wp_term_relationships['object_id:71001|term_taxonomy_id:72911'] = {
    object_id: 71001,
    term_taxonomy_id: 72911,
    term_order: 0,
  };
  local.db.wp_termmeta['meta_id:72921'] = {
    meta_id: 72921,
    term_id: 72901,
    meta_key: 'rpp_0369_focused_termmeta',
    meta_value: 'rpp-0369-focused-termmeta-value',
  };
  return local;
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

function preconditionFor(plan, mutation) {
  return plan.preconditions.find((precondition) =>
    precondition.mutationId === mutation.id
    && precondition.resourceKey === mutation.resourceKey) || null;
}

function buildHashOnlyTargetEvidence({ plan, applyResult, taxonomyMutation }) {
  const taxonomyValue = taxonomyMutation ? deserializeResourceValue(taxonomyMutation.value) : null;
  const taxonomyPrecondition = taxonomyMutation ? preconditionFor(plan, taxonomyMutation) : null;
  const appliedHash = taxonomyMutation && applyResult
    ? resourceHash(applyResult.site, taxonomyMutation.resource)
    : null;
  const hashes = {
    base: taxonomyMutation?.baseHash || null,
    remoteBefore: taxonomyMutation?.remoteBeforeHash || null,
    precondition: taxonomyPrecondition?.expectedHash || null,
    local: taxonomyMutation?.localHash || null,
    applied: appliedHash,
  };
  const invariants = {
    mutationPresent: Boolean(taxonomyMutation),
    mutationTargetsCategoryTaxonomy: taxonomyMutation?.resource?.table === 'wp_term_taxonomy'
      && taxonomyMutation?.resource?.id === 'term_taxonomy_id:72911',
    mutationCarriesTermReference: Number(taxonomyValue?.term_taxonomy_id) === 72911
      && Number(taxonomyValue?.term_id) === 72901
      && taxonomyValue?.taxonomy === 'category',
    preconditionLive: taxonomyPrecondition?.checkedAgainst === 'live-remote'
      && hashPattern.test(taxonomyPrecondition?.expectedHash || '')
      && taxonomyPrecondition?.expectedHash === taxonomyMutation?.baseHash
      && taxonomyPrecondition?.expectedHash === taxonomyMutation?.remoteBeforeHash,
    applyCarriedTarget: hashPattern.test(appliedHash || '')
      && appliedHash === taxonomyMutation?.localHash,
  };

  return {
    ok: Object.values(invariants).every(Boolean),
    resourceKey: taxonomyResourceKey,
    termResourceKey,
    relationshipResourceKey,
    termmetaResourceKey,
    termTaxonomyId: Number(taxonomyValue?.term_taxonomy_id),
    termId: Number(taxonomyValue?.term_id),
    taxonomy: taxonomyValue?.taxonomy || null,
    hashes,
    invariants,
  };
}

function assertHashOnlyEvidence(evidence) {
  for (const [label, hash] of Object.entries(evidence.hashes)) {
    assert.match(hash, hashPattern, `${label} must be hash-only evidence`);
  }
  assert.equal(evidence.hashes.precondition, evidence.hashes.base);
  assert.equal(evidence.hashes.remoteBefore, evidence.hashes.base);
  assert.equal(evidence.hashes.applied, evidence.hashes.local);
  assert.equal(Object.hasOwn(evidence, 'value'), false);

  const serialized = JSON.stringify(evidence);
  for (const rawFixtureSentinel of rawFixtureSentinels) {
    assert.equal(
      serialized.includes(rawFixtureSentinel),
      false,
      `hash-only evidence leaked ${rawFixtureSentinel}`,
    );
  }
}

function assertEveryCategoryGraphMutationHasLivePrecondition(plan) {
  for (const resourceKey of categoryGraphResourceKeys) {
    const mutation = mutationFor(plan, resourceKey);
    assert.ok(mutation, `missing mutation for ${resourceKey}`);
    const precondition = preconditionFor(plan, mutation);
    assert.ok(precondition, `missing precondition for ${resourceKey}`);
    assert.equal(precondition.checkedAgainst, 'live-remote');
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.equal(precondition.expectedHash, mutation.baseHash);
    assert.match(precondition.expectedHash, hashPattern);
  }
}

test('RPP-0369 focused planner/apply carries the category term_taxonomy target with hash-only evidence', () => {
  const base = baseSite();
  const local = localWithCategoryGraph(base);
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const taxonomyMutation = mutationFor(plan, taxonomyResourceKey);
  assert.ok(taxonomyMutation, 'missing category term_taxonomy mutation');
  const taxonomyValue = deserializeResourceValue(taxonomyMutation.value);
  const result = applyPlan(cloneJson(remote), plan);
  const evidence = buildHashOnlyTargetEvidence({ plan, applyResult: result, taxonomyMutation });

  assert.equal(plan.status, 'ready');
  assert.equal(plan.blockers.length, 0);
  assert.equal(plan.conflicts.length, 0);
  assertEveryCategoryGraphMutationHasLivePrecondition(plan);

  assert.equal(taxonomyMutation.action, 'put');
  assert.equal(taxonomyMutation.resource.table, 'wp_term_taxonomy');
  assert.equal(taxonomyMutation.resource.id, 'term_taxonomy_id:72911');
  assert.equal(taxonomyValue.term_taxonomy_id, 72911);
  assert.equal(taxonomyValue.term_id, 72901);
  assert.equal(taxonomyValue.taxonomy, 'category');

  assert.equal(result.appliedMutations, plan.mutations.length);
  assert.equal(
    resourceHash(result.site, taxonomyMutation.resource),
    taxonomyMutation.localHash,
    'applied category term_taxonomy row must match the planned local hash',
  );
  assert.deepEqual(
    result.site.db.wp_term_taxonomy['term_taxonomy_id:72911'],
    local.db.wp_term_taxonomy['term_taxonomy_id:72911'],
  );
  assert.equal(
    result.site.db.wp_term_relationships['object_id:71001|term_taxonomy_id:72911'].term_taxonomy_id,
    72911,
  );

  assert.equal(evidence.ok, true);
  assert.deepEqual(evidence.invariants, {
    mutationPresent: true,
    mutationTargetsCategoryTaxonomy: true,
    mutationCarriesTermReference: true,
    preconditionLive: true,
    applyCarriedTarget: true,
  });
  assertHashOnlyEvidence(evidence);
});

test('RPP-0369 hash-only evidence fails closed when apply does not carry the category target hash', () => {
  const base = baseSite();
  const local = localWithCategoryGraph(base);
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const taxonomyMutation = mutationFor(plan, taxonomyResourceKey);
  assert.ok(taxonomyMutation, 'missing category term_taxonomy mutation');
  const result = applyPlan(cloneJson(remote), plan);
  result.site.db.wp_term_taxonomy['term_taxonomy_id:72911'].term_id = 72902;

  const evidence = buildHashOnlyTargetEvidence({ plan, applyResult: result, taxonomyMutation });

  assert.equal(evidence.ok, false);
  assert.equal(evidence.invariants.applyCarriedTarget, false);
  assert.match(evidence.hashes.applied, hashPattern);
  assert.notEqual(evidence.hashes.applied, evidence.hashes.local);
  const serialized = JSON.stringify(evidence);
  for (const rawFixtureSentinel of rawFixtureSentinels) {
    assert.equal(
      serialized.includes(rawFixtureSentinel),
      false,
      `hash-only evidence leaked ${rawFixtureSentinel}`,
    );
  }
});
