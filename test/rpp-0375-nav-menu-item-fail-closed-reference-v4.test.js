import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
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
          post_title: 'Base page',
          post_name: 'base-page',
          post_status: 'publish',
          post_type: 'page',
          post_parent: 0,
          post_author: 0,
        },
        'ID:375': {
          ID: 375,
          post_title: 'Existing Private RPP-0375 Menu Item',
          post_name: 'existing-private-rpp0375-menu-item',
          post_status: 'publish',
          post_type: 'nav_menu_item',
          post_parent: 0,
          post_author: 0,
          guid: 'existing-private-rpp0375-menu-guid',
        },
      },
      wp_postmeta: {},
      wp_terms: {
        'term_id:9375': {
          term_id: 9375,
          name: 'Existing Private RPP-0375 Nav Menu',
          slug: 'existing-private-rpp0375-nav-menu',
          term_group: 0,
        },
      },
      wp_term_taxonomy: {
        'term_taxonomy_id:9475': {
          term_taxonomy_id: 9475,
          term_id: 9375,
          taxonomy: 'nav_menu',
          description: 'existing-private-rpp0375-nav-menu-description',
          parent: 0,
          count: 0,
        },
      },
      wp_term_relationships: {},
    },
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function rowResourceKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
}

function blockerFor(plan, resourceKey) {
  return plan.blockers.find((blocker) => blocker.resourceKey === resourceKey);
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function assertHashOnlyChange(change) {
  for (const slot of ['base', 'local', 'remote']) {
    assert.match(change[slot].hash, hashPattern);
    assert.equal(Object.hasOwn(change[slot], 'value'), false);
  }
}

function assertHashOnlyReference(reference, privateValues) {
  for (const hash of [
    reference.targetBaseHash,
    reference.targetLocalHash,
    reference.targetRemoteHash,
  ]) {
    assert.match(hash, hashPattern);
  }
  assertHashOnlyChange(reference.targetChange);

  const serialized = JSON.stringify(reference);
  for (const privateValue of privateValues) {
    assert.equal(serialized.includes(privateValue), false, `reference leaked ${privateValue}`);
  }
}

test('RPP-0375 fails closed when a new relationship references an existing nav menu item target', () => {
  const menuItemResourceKey = rowResourceKey('wp_posts', 'ID:375');
  const navMenuTaxonomyResourceKey = rowResourceKey('wp_term_taxonomy', 'term_taxonomy_id:9475');
  const relationshipResourceKey = rowResourceKey(
    'wp_term_relationships',
    'object_id:375|term_taxonomy_id:9475',
  );
  const privateValues = [
    'Existing Private RPP-0375 Menu Item',
    'existing-private-rpp0375-menu-item',
    'existing-private-rpp0375-menu-guid',
    'Existing Private RPP-0375 Nav Menu',
    'existing-private-rpp0375-nav-menu',
    'existing-private-rpp0375-nav-menu-description',
  ];
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.db.wp_term_relationships['object_id:375|term_taxonomy_id:9475'] = {
    object_id: 375,
    term_taxonomy_id: 9475,
    term_order: 0,
  };

  const plan = createPushPlan({ base, local, remote, now: fixedNow });
  const relationshipBlocker = blockerFor(plan, relationshipResourceKey);
  const objectReference = relationshipBlocker?.references.find((reference) =>
    reference.relationshipType === 'term-relationship-object');
  const taxonomyReference = relationshipBlocker?.references.find((reference) =>
    reference.relationshipType === 'term-relationship-taxonomy');
  const remoteBefore = cloneJson(remote);
  const beforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));

  assert.equal(plan.status, 'blocked');
  assert.equal(mutationFor(plan, relationshipResourceKey), undefined);
  assert.equal(
    blockerFor(plan, menuItemResourceKey),
    undefined,
    'unchanged nav menu item target is only reference evidence',
  );
  assert.equal(
    blockerFor(plan, navMenuTaxonomyResourceKey),
    undefined,
    'unchanged nav_menu taxonomy target is only reference evidence',
  );

  assert.ok(relationshipBlocker, 'missing term relationship blocker');
  assert.equal(relationshipBlocker.class, 'stale-wordpress-graph-identity');
  assert.equal(relationshipBlocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
  assert.match(relationshipBlocker.reason, /without proven identity mapping or reference rewriting/);
  assertHashOnlyChange(relationshipBlocker.change);

  assert.ok(objectReference, 'missing nav menu item object reference evidence');
  assert.equal(objectReference.relationshipKey, 'wp_term_relationships.object_id');
  assert.equal(objectReference.targetResourceKey, menuItemResourceKey);
  assert.deepEqual(objectReference.targetSupport, {
    supported: false,
    className: 'stale-wordpress-graph-identity',
    reason: `WordPress graph mutation ${menuItemResourceKey} references unsupported post graph surface nav_menu_item.`,
  });

  assert.ok(taxonomyReference, 'missing nav_menu taxonomy reference evidence');
  assert.equal(taxonomyReference.relationshipKey, 'wp_term_relationships.term_taxonomy_id');
  assert.equal(taxonomyReference.targetResourceKey, navMenuTaxonomyResourceKey);
  assert.deepEqual(taxonomyReference.targetSupport, {
    supported: false,
    className: 'stale-wordpress-graph-identity',
    reason: `WordPress graph mutation ${navMenuTaxonomyResourceKey} references unsupported taxonomy graph surface nav_menu.`,
  });

  assertHashOnlyReference(objectReference, privateValues);
  assertHashOnlyReference(taxonomyReference, privateValues);
  for (const privateValue of privateValues) {
    assert.equal(
      JSON.stringify(relationshipBlocker).includes(privateValue),
      false,
      `blocker leaked ${privateValue}`,
    );
  }

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(digest(remoteBefore), beforeHash, 'blocked nav menu item reference plan must refuse before mutation');
});
