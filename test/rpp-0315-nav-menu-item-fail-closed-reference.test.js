import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
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
      wp_postmeta: {},
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

function assertHashOnlyEvidence(entry, privateValues) {
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

test('RPP-0315 fails closed when nav menu item graph references lack proven identity mapping', () => {
  const menuItemResourceKey = rowResourceKey('wp_posts', 'ID:315');
  const menuObjectMetaResourceKey = rowResourceKey(
    'wp_postmeta',
    'post_id:315:meta_key:_menu_item_object_id',
  );
  const menuParentMetaResourceKey = rowResourceKey(
    'wp_postmeta',
    'post_id:315:meta_key:_menu_item_menu_item_parent',
  );
  const termResourceKey = rowResourceKey('wp_terms', 'term_id:9315');
  const taxonomyResourceKey = rowResourceKey('wp_term_taxonomy', 'term_taxonomy_id:9415');
  const relationshipResourceKey = rowResourceKey(
    'wp_term_relationships',
    'object_id:315|term_taxonomy_id:9415',
  );
  const privateValues = [
    'Local Private RPP-0315 Menu Item',
    'local-private-rpp0315-menu-item',
    'local-private-rpp0315-menu-guid',
    'local-private-rpp0315-nav-menu-name',
    'local-private-rpp0315-nav-menu-slug',
    'local-private-rpp0315-nav-menu-description',
    'local-private-rpp0315-menu-object',
  ];
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.db.wp_posts['ID:315'] = {
    ID: 315,
    post_title: 'Local Private RPP-0315 Menu Item',
    post_name: 'local-private-rpp0315-menu-item',
    post_status: 'publish',
    post_type: 'nav_menu_item',
    post_parent: 0,
    post_author: 0,
    guid: 'local-private-rpp0315-menu-guid',
  };
  local.db.wp_postmeta['post_id:315:meta_key:_menu_item_object_id'] = {
    post_id: 315,
    meta_key: '_menu_item_object_id',
    meta_value: '1',
  };
  local.db.wp_postmeta['post_id:315:meta_key:_menu_item_object'] = {
    post_id: 315,
    meta_key: '_menu_item_object',
    meta_value: 'local-private-rpp0315-menu-object',
  };
  local.db.wp_postmeta['post_id:315:meta_key:_menu_item_menu_item_parent'] = {
    post_id: 315,
    meta_key: '_menu_item_menu_item_parent',
    meta_value: '777',
  };
  local.db.wp_terms['term_id:9315'] = {
    term_id: 9315,
    name: 'local-private-rpp0315-nav-menu-name',
    slug: 'local-private-rpp0315-nav-menu-slug',
    term_group: 0,
  };
  local.db.wp_term_taxonomy['term_taxonomy_id:9415'] = {
    term_taxonomy_id: 9415,
    term_id: 9315,
    taxonomy: 'nav_menu',
    description: 'local-private-rpp0315-nav-menu-description',
    parent: 0,
    count: 1,
  };
  local.db.wp_term_relationships['object_id:315|term_taxonomy_id:9415'] = {
    object_id: 315,
    term_taxonomy_id: 9415,
    term_order: 0,
  };

  const plan = planFor(base, local, remote);
  const menuItemBlocker = blockerFor(plan, menuItemResourceKey);
  const menuObjectMetaBlocker = blockerFor(plan, menuObjectMetaResourceKey);
  const menuParentMetaBlocker = blockerFor(plan, menuParentMetaResourceKey);
  const taxonomyBlocker = blockerFor(plan, taxonomyResourceKey);
  const relationshipBlocker = blockerFor(plan, relationshipResourceKey);
  const objectReference = relationshipBlocker?.references.find((reference) =>
    reference.relationshipType === 'term-relationship-object');
  const taxonomyReference = relationshipBlocker?.references.find((reference) =>
    reference.relationshipType === 'term-relationship-taxonomy');
  const remoteBefore = cloneJson(remote);
  const beforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));

  assert.equal(plan.status, 'blocked');
  assert.equal(mutationFor(plan, menuItemResourceKey), undefined);
  assert.equal(mutationFor(plan, menuObjectMetaResourceKey), undefined);
  assert.equal(mutationFor(plan, menuParentMetaResourceKey), undefined);
  assert.equal(mutationFor(plan, taxonomyResourceKey), undefined);
  assert.equal(mutationFor(plan, relationshipResourceKey), undefined);
  assert.ok(mutationFor(plan, termResourceKey), 'the standalone nav menu term may be planned, but the blocked plan cannot apply');

  assert.ok(menuItemBlocker, 'missing nav menu item post blocker');
  assert.equal(menuItemBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(menuItemBlocker.reason, /unsupported post graph surface nav_menu_item/);
  assert.equal(menuItemBlocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
  assert.deepEqual(menuItemBlocker.references, []);

  assert.ok(menuObjectMetaBlocker, 'missing nav menu item object metadata blocker');
  assert.equal(menuObjectMetaBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(menuObjectMetaBlocker.reason, /unsupported menu item metadata graph surface _menu_item_object_id/);
  assert.deepEqual(menuObjectMetaBlocker.references, []);

  assert.ok(menuParentMetaBlocker, 'missing nav menu item parent metadata blocker');
  assert.equal(menuParentMetaBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(menuParentMetaBlocker.reason, /unsupported menu item metadata graph surface _menu_item_menu_item_parent/);
  assert.deepEqual(menuParentMetaBlocker.references, []);

  assert.ok(taxonomyBlocker, 'missing nav_menu taxonomy blocker');
  assert.equal(taxonomyBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(taxonomyBlocker.reason, /unsupported taxonomy graph surface nav_menu/);

  assert.ok(relationshipBlocker, 'missing nav menu relationship blocker');
  assert.equal(relationshipBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(relationshipBlocker.reason, /without proven identity mapping or reference rewriting/);
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
  assert.equal(taxonomyReference.targetResourceKey, taxonomyResourceKey);
  assert.deepEqual(taxonomyReference.targetSupport, {
    supported: false,
    className: 'stale-wordpress-graph-identity',
    reason: `WordPress graph mutation ${taxonomyResourceKey} references unsupported taxonomy graph surface nav_menu.`,
  });
  for (const reference of [objectReference, taxonomyReference]) {
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
    assert.equal(Object.hasOwn(reference.targetChange.local, 'value'), false);
    assert.equal(Object.hasOwn(reference.targetChange.remote, 'value'), false);
  }

  for (const blocker of [
    menuItemBlocker,
    menuObjectMetaBlocker,
    menuParentMetaBlocker,
    taxonomyBlocker,
    relationshipBlocker,
  ]) {
    assertHashOnlyEvidence(blocker, privateValues);
  }
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(digest(remoteBefore), beforeHash, 'blocked nav menu item plan must refuse before mutation');
});
