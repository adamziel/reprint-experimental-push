import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import {
  appendRecoveryClaimOpened,
  appendStaleClaimAdvanced,
  assertJournalRecordHasNoRawValues,
  openRecoveryJournal,
  readRecoveryJournal,
} from '../src/recovery-journal.js';
import { inspectRecoveryJournal } from '../src/recovery-inspect.js';
import { resourceHash } from '../src/resources.js';

const fixedNow = new Date('2026-05-24T00:00:00.000Z');

function tempRecoveryJournalPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-push-apply-journal-'));
  return path.join(dir, 'recovery.jsonl');
}

function failingDurableJournal(failType) {
  return {
    events: [],
    nextSequence: 1,
    appendEvent(type, payload) {
      if (type === failType) {
        throw new Error(`injected journal failure for ${type}`);
      }
      const record = { sequence: this.nextSequence, type, ...payload };
      this.events.push(record);
      this.nextSequence++;
      return record;
    },
  };
}

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "base";',
      'wp-content/plugins/forms/forms.php': '<?php /* forms 1.0 */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_options: {
        'option_name:blogname': { option_name: 'blogname', option_value: 'Base Site' },
        'option_name:forms_settings': {
          option_name: 'forms_settings',
          option_value: { mode: 'basic' },
          __pluginOwner: 'forms',
        },
      },
      wp_posts: {
        'ID:1': { ID: 1, post_title: 'Base post', post_status: 'publish' },
      },
    },
  };
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function decisionFor(plan, resourceKey) {
  return plan.decisions.find((decision) => decision.resourceKey === resourceKey);
}

function pluginResource(name) {
  return { type: 'plugin', name, key: `plugin:${name}` };
}

function allowedPluginOwnedResource(resourceKey, pluginOwner, driver = 'wp-option') {
  return { pluginOwner, resourceKey, driver };
}

function pluginOwnedResourcePolicy(...allowedResources) {
  return {
    pluginOwnedResources: {
      allowedResources,
    },
  };
}

const atomicDependencyPlugin = 'reprint-push-atomic-dependency-fixture';
const atomicDependentPlugin = 'reprint-push-atomic-dependent-fixture';

function pluginMainFile(name) {
  return `wp-content/plugins/${name}/${name}.php`;
}

function tamperReadyPlan(plan, mutate) {
  const copy = JSON.parse(JSON.stringify(plan));
  mutate(copy);
  copy.status = 'ready';
  copy.blockers = [];
  copy.conflicts = [];
  copy.summary.blockers = 0;
  copy.summary.conflicts = 0;
  return copy;
}

function assertEveryMutationHasLiveRemotePrecondition(plan) {
  for (const mutation of plan.mutations) {
    const precondition = plan.preconditions.find((entry) => entry.mutationId === mutation.id);
    assert.ok(precondition, `missing precondition for ${mutation.id}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.equal(precondition.checkedAgainst, 'live-remote');
  }
}

test('plans and applies local changes when remote still matches the pull base', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:1'].post_title = 'Local title';

  const plan = planFor(base, local, baseSite());

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  const result = applyPlan(baseSite(), plan);
  assert.equal(result.site.files['index.php'], '<?php echo "local";');
  assert.equal(result.site.db.wp_posts['ID:1'].post_title, 'Local title');
});

test('keeps remote-only changes and does not overwrite them', () => {
  const base = baseSite();
  const remote = baseSite();
  remote.db.wp_posts['ID:1'].post_title = 'Remote editorial update';

  const plan = planFor(base, baseSite(), remote);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(plan.decisions[0].decision, 'keep-remote');
  const result = applyPlan(remote, plan);
  assert.equal(result.site.db.wp_posts['ID:1'].post_title, 'Remote editorial update');
});

test('combines non-overlapping local and remote changes', () => {
  const base = baseSite();
  const local = baseSite();
  const remote = baseSite();
  local.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  remote.db.wp_posts['ID:1'].post_title = 'Remote title';

  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(result.site.files['wp-content/themes/theme/style.css'], 'body { color: black; }');
  assert.equal(result.site.db.wp_posts['ID:1'].post_title, 'Remote title');
});

test('plans local deletions only behind live remote preconditions', () => {
  const base = baseSite();
  const local = baseSite();
  delete local.files['index.php'];
  delete local.db.wp_posts['ID:1'];

  const plan = planFor(base, local, baseSite());
  const fileDelete = mutationFor(plan, 'file:index.php');
  const rowDelete = mutationFor(plan, 'row:["wp_posts","ID:1"]');

  assert.equal(plan.status, 'ready');
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(rowDelete.action, 'delete');
  assert.equal(rowDelete.changeKind, 'delete');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(baseSite(), plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
});

test('stops a local deletion when the remote edited the same resource', () => {
  const base = baseSite();
  const local = baseSite();
  const remote = baseSite();
  delete local.db.wp_posts['ID:1'];
  remote.db.wp_posts['ID:1'].post_title = 'Remote secret editorial update';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];

  assert.equal(plan.status, 'conflict');
  assert.equal(conflict.class, 'row-conflict');
  assert.equal(conflict.change.localChange, 'delete');
  assert.equal(conflict.change.remoteChange, 'update');
  assert.equal(JSON.stringify(conflict).includes('Remote secret editorial update'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.db.wp_posts['ID:1'].post_title, 'Remote secret editorial update');
});

test('blocks restoring a remote-deleted post after the local copy diverged', () => {
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:1'].post_title = 'Local restored editorial update';
  const remote = baseSite();
  delete remote.db.wp_posts['ID:1'];

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(conflict.class, 'row-conflict');
  assert.equal(conflict.resourceKey, 'row:["wp_posts","ID:1"]');
  assert.equal(conflict.change.localChange, 'update');
  assert.equal(conflict.change.remoteChange, 'delete');
  assert.equal(JSON.stringify(conflict).includes('Local restored editorial update'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(Object.hasOwn(remote.db.wp_posts, 'ID:1'), false);
});

test('blocks unsupported comment and user graph surfaces in the release-candidate slice', () => {
  const base = baseSite();
  const local = baseSite();
  const remote = baseSite();

  local.db.wp_comments = {
    'comment_ID:1': {
      comment_ID: 1,
      comment_post_ID: 1,
      comment_author: 'Local comment',
    },
  };
  local.db.wp_users = {
    'ID:2': {
      ID: 2,
      user_login: 'local-user',
    },
  };

  const plan = planFor(base, local, remote);
  const commentBlocker = plan.blockers.find((blocker) => blocker.resourceKey === 'row:["wp_comments","comment_ID:1"]');
  const userBlocker = plan.blockers.find((blocker) => blocker.resourceKey === 'row:["wp_users","ID:2"]');

  assert.equal(plan.status, 'blocked');
  assert.equal(commentBlocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(commentBlocker.surface, 'comments');
  assert.match(commentBlocker.reason, /outside the supported release-candidate slice/);
  assert.equal(userBlocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(userBlocker.surface, 'users');
  assert.match(userBlocker.reason, /outside the supported release-candidate slice/);
});

test('blocks unsupported menu and navigation post graph surfaces in the release-candidate slice', () => {
  const base = baseSite();
  const local = baseSite();
  const remote = baseSite();

  local.db.wp_posts['ID:10'] = {
    ID: 10,
    post_type: 'nav_menu_item',
    post_title: 'Primary menu item',
  };
  local.db.wp_posts['ID:11'] = {
    ID: 11,
    post_type: 'wp_navigation',
    post_title: 'Navigation block',
  };

  const plan = planFor(base, local, remote);
  const menuBlocker = plan.blockers.find((blocker) => blocker.resourceKey === 'row:["wp_posts","ID:10"]');
  const navigationBlocker = plan.blockers.find((blocker) => blocker.resourceKey === 'row:["wp_posts","ID:11"]');

  assert.equal(plan.status, 'blocked');
  assert.equal(menuBlocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(menuBlocker.surface, 'nav_menu_item');
  assert.match(menuBlocker.reason, /outside the supported release-candidate slice/);
  assert.equal(navigationBlocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(navigationBlocker.surface, 'wp_navigation');
  assert.match(navigationBlocker.reason, /outside the supported release-candidate slice/);
});

test('blocks serialized block post content in the release-candidate slice', () => {
  const base = baseSite();
  const local = baseSite();
  const remote = baseSite();

  local.db.wp_posts['ID:12'] = {
    ID: 12,
    post_type: 'post',
    post_title: 'Block content post',
    post_content: '<!-- wp:paragraph -->\n<p>Serialized block content</p>\n<!-- /wp:paragraph -->',
  };

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === 'row:["wp_posts","ID:12"]');

  assert.equal(plan.status, 'blocked');
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.surface, 'serialized-blocks');
  assert.match(blocker.reason, /outside the supported release-candidate slice/);
});

test('blocks post GUID graph surfaces in the release-candidate slice', () => {
  const base = baseSite();
  const local = baseSite();
  const remote = baseSite();

  local.db.wp_posts['ID:14'] = {
    ID: 14,
    post_title: 'Guided post',
    post_status: 'publish',
    guid: 'https://example.test/?p=14',
  };

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === 'row:["wp_posts","ID:14"]');

  assert.equal(plan.status, 'blocked');
  assert.ok(blocker);
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.surface, 'guid');
  assert.match(blocker.reason, /outside the supported release-candidate slice/);
});

test('blocks revision post graph surfaces in the release-candidate slice', () => {
  const base = baseSite();
  const local = baseSite();
  const remote = baseSite();

  local.db.wp_posts['ID:13'] = {
    ID: 13,
    post_type: 'revision',
    post_title: 'Post revision',
  };

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === 'row:["wp_posts","ID:13"]');

  assert.equal(plan.status, 'blocked');
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.surface, 'revision');
  assert.match(blocker.reason, /outside the supported release-candidate slice/);
});

test('blocks nav menu term taxonomy graph surfaces in the release-candidate slice', () => {
  const base = baseSite();
  const local = baseSite();
  const remote = baseSite();

  local.db.wp_terms = {
    'term_id:20': {
      term_id: 20,
      name: 'Navigation menu term',
      slug: 'navigation-menu-term',
    },
  };
  local.db.wp_term_taxonomy = {
    'term_taxonomy_id:21': {
      term_taxonomy_id: 21,
      term_id: 20,
      taxonomy: 'nav_menu',
      description: '',
      parent: 0,
      count: 0,
    },
  };

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === 'row:["wp_term_taxonomy","term_taxonomy_id:21"]');

  assert.equal(plan.status, 'blocked');
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.surface, 'nav_menu');
  assert.match(blocker.reason, /outside the supported release-candidate slice/);
});

test('blocks postmeta owned by a revision even when it targets a same-plan post', () => {
  const revisionResourceKey = 'row:["wp_posts","ID:13"]';
  const postmetaResourceKey = 'row:["wp_postmeta","meta_id:48"]';
  const targetResourceKey = 'row:["wp_posts","ID:14"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:13'] = {
    ID: 13,
    post_type: 'revision',
    post_title: 'Local revision owner',
    post_content: 'local-private-revision-owner-body',
  };
  local.db.wp_posts['ID:14'] = {
    ID: 14,
    post_title: 'Local revision target post',
    post_content: 'local-private-revision-target-body',
    post_status: 'publish',
  };
  local.db.wp_postmeta = {
    'meta_id:48': {
      meta_id: 48,
      post_id: 13,
      meta_key: 'revision-note',
      meta_value: 'local-private-revision-note',
    },
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const revisionMutation = mutationFor(plan, revisionResourceKey);
  const targetMutation = mutationFor(plan, targetResourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === postmetaResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(revisionMutation, undefined);
  assert.equal(targetMutation.changeKind, 'create');
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.surface, 'revision');
  assert.equal(JSON.stringify(blocker).includes('local-private-revision-owner-body'), false);
  assert.equal(JSON.stringify(blocker).includes('local-private-revision-note'), false);
});

test('blocks a local revision parent reference to a same-plan post', () => {
  const revisionResourceKey = 'row:["wp_posts","ID:15"]';
  const targetResourceKey = 'row:["wp_posts","ID:16"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:15'] = {
    ID: 15,
    post_type: 'revision',
    post_title: 'Local revision parent',
    post_content: 'local-private-revision-parent-body',
    post_parent: 16,
  };
  local.db.wp_posts['ID:16'] = {
    ID: 16,
    post_title: 'Local revision parent target',
    post_content: 'local-private-revision-parent-target-body',
    post_status: 'publish',
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const revisionMutation = mutationFor(plan, revisionResourceKey);
  const targetMutation = mutationFor(plan, targetResourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === revisionResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(revisionMutation, undefined);
  assert.equal(targetMutation.changeKind, 'create');
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.surface, 'revision');
  assert.equal(JSON.stringify(blocker).includes('local-private-revision-parent-body'), false);
  assert.equal(JSON.stringify(blocker).includes('local-private-revision-parent-target-body'), false);
});

test('blocks a local nav menu item parent reference to a same-plan post', () => {
  const navigationResourceKey = 'row:["wp_posts","ID:15"]';
  const targetResourceKey = 'row:["wp_posts","ID:16"]';
  const base = baseSite();
  const local = baseSite();
  const remote = baseSite();

  local.db.wp_posts['ID:15'] = {
    ID: 15,
    post_title: 'Local nav menu item parent',
    post_content: 'local-private-nav-menu-item-parent-body',
    post_type: 'nav_menu_item',
    post_parent: 16,
  };
  local.db.wp_posts['ID:16'] = {
    ID: 16,
    post_title: 'Local nav menu item target',
    post_content: 'local-private-nav-menu-item-target-body',
    post_type: 'post',
  };

  const plan = planFor(base, local, remote);
  const navigationMutation = mutationFor(plan, navigationResourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === navigationResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(navigationMutation, undefined);
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.surface, 'nav_menu_item');
  assert.equal(JSON.stringify(blocker).includes('local-private-nav-menu-item-parent-body'), false);
  assert.equal(JSON.stringify(blocker).includes('local-private-nav-menu-item-target-body'), false);
  assert.equal(blocker.reason.includes(targetResourceKey) || blocker.reason.includes(navigationResourceKey), true);
});

test('stops a local directory deletion that would remove a remote-only descendant', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = JSON.parse(JSON.stringify(base));
  delete local.files['wp-content/uploads/gallery'];
  const remote = JSON.parse(JSON.stringify(base));
  remote.files['wp-content/uploads/gallery/remote-only.jpg'] = 'remote private image bytes';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery'), undefined);
  assert.equal(
    plan.preconditions.some((precondition) => precondition.resourceKey === 'file:wp-content/uploads/gallery'),
    false,
  );
  assert.equal(conflict.class, 'file-topology-conflict');
  assert.equal(conflict.resourceKey, 'file:wp-content/uploads/gallery');
  assert.equal(conflict.relatedResourceKey, 'file:wp-content/uploads/gallery/remote-only.jpg');
  assert.equal(conflict.change.localChange, 'delete');
  assert.equal(conflict.relatedChange.remoteChange, 'create');
  assert.equal(JSON.stringify(conflict).includes('remote private image bytes'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.files['wp-content/uploads/gallery/remote-only.jpg'], 'remote private image bytes');
});

test('stops file type swaps that would hide remote-only descendants', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = baseSite();
  local.files['wp-content/uploads/gallery'] = 'local replacement file';
  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  remote.files['wp-content/uploads/gallery/remote-only.jpg'] = 'remote image bytes';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery'), undefined);
  assert.equal(
    plan.preconditions.some((precondition) => precondition.resourceKey === 'file:wp-content/uploads/gallery'),
    false,
  );
  assert.equal(conflict.class, 'file-topology-conflict');
  assert.equal(conflict.resourceKey, 'file:wp-content/uploads/gallery');
  assert.equal(conflict.relatedResourceKey, 'file:wp-content/uploads/gallery/remote-only.jpg');
  assert.equal(conflict.change.localChange, 'type-change');
  assert.equal(conflict.relatedChange.remoteChange, 'create');
  assert.equal(JSON.stringify(conflict).includes('remote image bytes'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.files['wp-content/uploads/gallery/remote-only.jpg'], 'remote image bytes');
});

test('keeps independent mutation evidence while suppressing unsafe topology mutations', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = JSON.parse(JSON.stringify(base));
  delete local.files['wp-content/uploads/gallery'];
  local.files['index.php'] = '<?php echo "local ordinary edit";';
  const remote = JSON.parse(JSON.stringify(base));
  remote.files['wp-content/uploads/gallery/remote-only.jpg'] = 'remote private image bytes';
  const remoteBefore = JSON.stringify(remote);

  const plan = planFor(base, local, remote);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery'), undefined);
  assert.equal(mutationFor(plan, 'file:index.php').action, 'put');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('recognizes matching independent edits as already in sync', () => {
  const base = baseSite();
  const local = baseSite();
  const remote = baseSite();
  local.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent title';

  const plan = planFor(base, local, remote);
  const decision = decisionFor(plan, 'row:["wp_posts","ID:1"]');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(decision.decision, 'already-in-sync');
  assert.equal(decision.change.localChange, 'update');
  assert.equal(decision.change.remoteChange, 'update');
});

test('preserves remote-only plugin changes', () => {
  const base = baseSite();
  const remote = baseSite();
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* forms 1.1 */';

  const plan = planFor(base, baseSite(), remote);
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const fileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginDecision.change.remoteChange, 'update');
  assert.equal(fileDecision.decision, 'keep-remote');

  const result = applyPlan(remote, plan);
  assert.equal(result.site.plugins.forms.version, '1.1.0');
  assert.equal(result.site.plugins.forms.active, false);
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* forms 1.1 */');
});

test('combines local ordinary changes while preserving remote-only plugin changes', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local ordinary edit";';
  const remote = baseSite();
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(mutationFor(plan, 'file:index.php').action, 'put');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(result.site.files['index.php'], '<?php echo "local ordinary edit";');
  assert.equal(result.site.plugins.forms.version, '1.1.0');
  assert.equal(result.site.plugins.forms.active, false);
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-private-forms-code */');
});

test('blocks local plugin metadata changes when remote plugin files changed', () => {
  const base = baseSite();
  const local = baseSite();
  local.plugins.forms = { version: '1.0.0', active: false };
  const remote = baseSite();
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
  assert.equal(mutationFor(plan, 'plugin:forms'), undefined);
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.resourceKey, 'plugin:forms');
  assert.equal(blocker.pluginOwner, 'forms');
  assert.equal(blocker.ownerContext[0].resourceKey, 'file:wp-content/plugins/forms/forms.php');
  assert.equal(blocker.ownerContext[0].change.remoteChange, 'update');
  assert.equal(blockerJson.includes('remote-private-forms-code'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.plugins.forms.active, true);
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-private-forms-code */');
});

test('blocks local plugin file changes when remote plugin metadata changed', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['wp-content/plugins/forms/forms.php'] = '<?php /* local-private-forms-code */';
  const remote = baseSite();
  remote.plugins.forms = { version: '1.1.0', active: false };

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(mutationFor(plan, 'file:wp-content/plugins/forms/forms.php'), undefined);
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.resourceKey, 'file:wp-content/plugins/forms/forms.php');
  assert.equal(blocker.pluginOwner, 'forms');
  assert.equal(blocker.ownerContext[0].resourceKey, 'plugin:forms');
  assert.equal(blocker.ownerContext[0].change.remoteChange, 'update');
  assert.equal(blockerJson.includes('local-private-forms-code'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.plugins.forms.version, '1.1.0');
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* forms 1.0 */');
});

test('allows plugin file changes when plugin metadata independently matches remote', () => {
  const base = baseSite();
  const local = baseSite();
  const remote = baseSite();
  local.plugins.forms = { version: '1.1.0', active: true };
  remote.plugins.forms = { version: '1.1.0', active: true };
  local.files['wp-content/plugins/forms/forms.php'] = '<?php /* local forms 1.1 file */';

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'already-in-sync');
  assert.equal(mutation.action, 'put');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(result.site.plugins.forms.version, '1.1.0');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* local forms 1.1 file */');
});

test('blocks plugin-owned data when owner plugin files changed only on remote', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-advanced';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'forms', 'wp-option'),
    ),
  };
  const remote = baseSite();
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.equal(blocker.pluginOwner, 'forms');
  assert.equal(blocker.ownerContext[0].resourceKey, 'file:wp-content/plugins/forms/forms.php');
  assert.equal(blocker.ownerContext[0].change.remoteChange, 'update');
  assert.equal(blockerJson.includes('remote-private-forms-code'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-private-forms-code */');
});

test('allows plugin-owned data when owner plugin context independently matches remote', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  const local = baseSite();
  local.files['wp-content/plugins/forms/forms.php'] = '<?php /* forms 1.1 shared */';
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-advanced';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'forms', 'wp-option'),
    ),
  };
  const remote = baseSite();
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* forms 1.1 shared */';

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, resourceKey);

  assert.equal(plan.status, 'ready');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'already-in-sync');
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.pluginOwnedResource.pluginOwner, 'forms');
  assertEveryMutationHasLiveRemotePrecondition(plan);
});

test('remote-only plugin removal blocks stale local dependency assumptions', () => {
  const base = baseSite();
  const local = baseSite();
  const remote = baseSite();
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-advanced';
  local.pushIntents = [
    {
      id: 'update-forms-settings',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: ['row:["wp_options","option_name:forms_settings"]'],
      dependencies: { plugins: ['forms'] },
      resourcePolicy: pluginOwnedResourcePolicy(
        allowedPluginOwnedResource('row:["wp_options","option_name:forms_settings"]', 'forms'),
      ),
    },
  ];

  const plan = planFor(base, local, remote);

  assert.equal(plan.status, 'blocked');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(plan.blockers[0].class, 'missing-plugin-dependency');
  assert.equal(plan.blockers[0].plugin, 'forms');
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(Object.hasOwn(remote.plugins, 'forms'), false);
});

test('refuses direct conflicts and preserves the remote snapshot', () => {
  const base = baseSite();
  const local = baseSite();
  const remote = baseSite();
  local.db.wp_posts['ID:1'].post_title = 'Local title';
  remote.db.wp_posts['ID:1'].post_title = 'Remote title';

  const plan = planFor(base, local, remote);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.conflicts[0].class, 'row-conflict');
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.db.wp_posts['ID:1'].post_title, 'Remote title');
});

test('classifies plugin-owned data conflicts separately from generic rows', () => {
  const base = baseSite();
  const local = baseSite();
  const remote = baseSite();
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-advanced';
  remote.db.wp_options['option_name:forms_settings'].option_value.mode = 'remote-advanced';

  const plan = planFor(base, local, remote);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.conflicts[0].class, 'plugin-data-conflict');
  assert.equal(plan.conflicts[0].pluginOwner, 'forms');
});

test('allows plugin-owned option rows only with explicit snapshot driver policy', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-advanced';

  const blockedPlan = planFor(base, local, baseSite());
  assert.equal(blockedPlan.status, 'blocked');
  assert.equal(blockedPlan.summary.mutations, 0);
  assert.equal(blockedPlan.blockers[0].class, 'unsupported-plugin-owned-resource');
  assert.equal(blockedPlan.blockers[0].pluginOwner, 'forms');
  assert.equal(blockedPlan.blockers[0].resourceKey, resourceKey);

  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'forms', 'wp-option'),
    ),
  };
  const readyPlan = planFor(base, local, baseSite());

  assert.equal(readyPlan.status, 'ready');
  assert.equal(mutationFor(readyPlan, resourceKey).changeKind, 'update');
});

test('blocks plugin-owned resources when the declared driver does not match the table', () => {
  const resourceKey = 'row:["wp_postmeta","meta_id:7"]';
  const base = baseSite();
  base.db.wp_postmeta = {
    'meta_id:7': {
      meta_id: 7,
      post_id: 1,
      meta_key: '_forms_payload',
      meta_value: 'base-private-meta',
      __pluginOwner: 'forms',
    },
  };
  const local = JSON.parse(JSON.stringify(base));
  local.db.wp_postmeta['meta_id:7'].meta_value = 'local-private-meta';
  local.pushIntents = [
    {
      id: 'update-forms-postmeta',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: [resourceKey],
      resourcePolicy: pluginOwnedResourcePolicy(
        allowedPluginOwnedResource(resourceKey, 'forms', 'wp-option'),
      ),
    },
  ];
  const remote = JSON.parse(JSON.stringify(base));

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(blocker.class, 'unsupported-plugin-owned-resource');
  assert.equal(blocker.driver, 'wp-option');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.match(blocker.reason, /driver does not match/);
  assert.equal(blockerJson.includes('base-private-meta'), false);
  assert.equal(blockerJson.includes('local-private-meta'), false);
});

test('allows plugin-owned postmeta-like rows with explicit push intent policy', () => {
  const resourceKey = 'row:["wp_postmeta","meta_id:7"]';
  const base = baseSite();
  base.db.wp_postmeta = {
    'meta_id:7': {
      meta_id: 7,
      post_id: 1,
      meta_key: '_forms_payload',
      meta_value: { state: 'base' },
      __pluginOwner: 'forms',
    },
  };
  const local = baseSite();
  local.db.wp_postmeta = {
    'meta_id:7': {
      meta_id: 7,
      post_id: 1,
      meta_key: '_forms_payload',
      meta_value: { state: 'local' },
      __pluginOwner: 'forms',
    },
  };
  local.pushIntents = [
    {
      id: 'update-forms-postmeta',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: [resourceKey],
      resourcePolicy: pluginOwnedResourcePolicy(
        allowedPluginOwnedResource(resourceKey, 'forms', 'wp-postmeta'),
      ),
    },
  ];
  const remote = baseSite();
  remote.db.wp_postmeta = {
    'meta_id:7': {
      meta_id: 7,
      post_id: 1,
      meta_key: '_forms_payload',
      meta_value: { state: 'base' },
      __pluginOwner: 'forms',
    },
  };

  const plan = planFor(base, local, remote);

  assert.equal(plan.status, 'ready');
  assert.equal(mutationFor(plan, resourceKey).atomicGroupId, 'update-forms-postmeta');
  assert.equal(plan.atomicGroups[0].status, 'ready');
});

test('blocks unknown plugin-owned custom table rows without leaking values', () => {
  const resourceKey = 'row:["wp_forms_entries","entry_id:9"]';
  const base = baseSite();
  base.db.wp_forms_entries = {
    'entry_id:9': { entry_id: 9, payload: 'base-private-entry', __pluginOwner: 'forms' },
  };
  const local = baseSite();
  local.db.wp_forms_entries = {
    'entry_id:9': { entry_id: 9, payload: 'local-private-entry', __pluginOwner: 'forms' },
  };
  const remote = baseSite();
  remote.db.wp_forms_entries = {
    'entry_id:9': { entry_id: 9, payload: 'base-private-entry', __pluginOwner: 'forms' },
  };

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(blocker.class, 'unsupported-plugin-owned-custom-table');
  assert.equal(blocker.pluginOwner, 'forms');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.match(blocker.reason, /outside the supported release-candidate slice/);
  assert.equal(blockerJson.includes('base-private-entry'), false);
  assert.equal(blockerJson.includes('local-private-entry'), false);
});

test('blocks plugin-owned custom tables even when the plugin stays otherwise unchanged', () => {
  const resourceKey = 'row:["wp_forms_entries","entry_id:10"]';
  const base = baseSite();
  base.db.wp_forms_entries = {
    'entry_id:10': { entry_id: 10, payload: 'base-private-entry', __pluginOwner: 'forms' },
  };
  const local = baseSite();
  local.db.wp_forms_entries = {
    'entry_id:10': { entry_id: 10, payload: 'local-private-entry', __pluginOwner: 'forms' },
  };
  const remote = baseSite();
  remote.plugins.forms = { version: '1.0.0', active: true };
  remote.db.wp_forms_entries = {
    'entry_id:10': { entry_id: 10, payload: 'base-private-entry', __pluginOwner: 'forms' },
  };

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];

  assert.equal(plan.status, 'blocked');
  assert.equal(blocker.class, 'unsupported-plugin-owned-custom-table');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.equal(blocker.pluginOwner, 'forms');
});

test('fixture forms lab table requires exact driver and active fixture plugin evidence', () => {
  const resourceKey = 'row:["wp_reprint_push_forms_lab","id:1"]';
  const base = baseSite();
  base.plugins['reprint-push-forms-fixture'] = { version: '1.0.0', active: true };
  base.db.wp_reprint_push_forms_lab = {
    'id:1': {
      id: 1,
      form_slug: 'contact',
      payload: { owner: 'forms', mode: 'base' },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = JSON.parse(JSON.stringify(base));
  local.db.wp_reprint_push_forms_lab['id:1'].payload.mode = 'local-semantic';
  const remote = JSON.parse(JSON.stringify(base));

  const withoutPolicy = planFor(base, local, remote);
  assert.equal(withoutPolicy.status, 'blocked');
  assert.equal(withoutPolicy.blockers[0].class, 'unsupported-plugin-owned-resource');
  assert.equal(withoutPolicy.blockers[0].resourceKey, resourceKey);

  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'forms', 'fixture-forms-lab-table'),
    ),
  };
  const ready = planFor(base, local, remote);
  assert.equal(ready.status, 'ready');
  const mutation = mutationFor(ready, resourceKey);
  assert.equal(mutation.pluginOwnedResource.driver, 'fixture-forms-lab-table');
  assert.equal(mutation.pluginOwnedResource.driverEvidence.source, 'live-remote');
  assert.equal(mutation.pluginOwnedResource.driverEvidence.resourceKey, 'plugin:reprint-push-forms-fixture');
  assert.equal(mutation.pluginOwnedResource.driverEvidence.baseHash, mutation.pluginOwnedResource.driverEvidence.remoteHash);

  const inactiveRemote = JSON.parse(JSON.stringify(remote));
  inactiveRemote.plugins['reprint-push-forms-fixture'].active = false;
  const inactivePlan = planFor(base, local, inactiveRemote);
  assert.equal(inactivePlan.status, 'blocked');
  assert.equal(inactivePlan.blockers[0].class, 'unsupported-plugin-owned-resource');

  const changedPluginRemote = JSON.parse(JSON.stringify(remote));
  changedPluginRemote.plugins['reprint-push-forms-fixture'].version = '1.0.1';
  const changedPluginPlan = planFor(base, local, changedPluginRemote);
  assert.equal(changedPluginPlan.status, 'blocked');
  assert.equal(changedPluginPlan.blockers[0].class, 'unsupported-plugin-owned-resource');
});

test('fixture forms lab table delete remains blocked without driver delete opt-in', () => {
  const resourceKey = 'row:["wp_reprint_push_forms_lab","id:1"]';
  const base = baseSite();
  base.plugins['reprint-push-forms-fixture'] = { version: '1.0.0', active: true };
  base.db.wp_reprint_push_forms_lab = {
    'id:1': {
      id: 1,
      form_slug: 'contact',
      payload: { owner: 'forms', mode: 'base' },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = JSON.parse(JSON.stringify(base));
  delete local.db.wp_reprint_push_forms_lab['id:1'];
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'forms', 'fixture-forms-lab-table'),
    ),
  };
  const plan = planFor(base, local, JSON.parse(JSON.stringify(base)));

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.blockers[0].class, 'unsupported-plugin-owned-resource');
});

test('executor rejects forged ready custom table plans without valid fixture driver evidence', () => {
  const resourceKey = 'row:["wp_reprint_push_forms_lab","id:1"]';
  const base = baseSite();
  base.plugins['reprint-push-forms-fixture'] = { version: '1.0.0', active: true };
  base.db.wp_reprint_push_forms_lab = {
    'id:1': {
      id: 1,
      form_slug: 'contact',
      payload: { owner: 'forms', mode: 'base-secret' },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = JSON.parse(JSON.stringify(base));
  local.db.wp_reprint_push_forms_lab['id:1'].payload.mode = 'local-secret';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'forms', 'fixture-forms-lab-table'),
    ),
  };
  const ready = planFor(base, local, JSON.parse(JSON.stringify(base)));
  const forged = tamperReadyPlan(ready, (plan) => {
    delete mutationFor(plan, resourceKey).pluginOwnedResource.driverEvidence;
  });
  const remote = JSON.parse(JSON.stringify(base));
  const before = JSON.stringify(remote);
  const error = captureError(() => applyPlan(remote, forged));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'UNSUPPORTED_PLUGIN_OWNED_RESOURCE');
  assert.equal(JSON.stringify(remote), before);
  assert.equal(JSON.stringify(error.details).includes('local-secret'), false);
  assert.equal(JSON.stringify(error.details).includes('base-secret'), false);

  const forgedHash = tamperReadyPlan(ready, (plan) => {
    const mutation = mutationFor(plan, resourceKey);
    mutation.pluginOwnedResource.driverEvidence.baseHash = 'x'.repeat(64);
    mutation.pluginOwnedResource.driverEvidence.remoteHash = 'x'.repeat(64);
  });
  const forgedHashRemote = JSON.parse(JSON.stringify(base));
  const forgedHashBefore = JSON.stringify(forgedHashRemote);
  const forgedHashError = captureError(() => applyPlan(forgedHashRemote, forgedHash));
  assert.ok(forgedHashError instanceof PushPlanError);
  assert.equal(forgedHashError.code, 'UNSUPPORTED_PLUGIN_OWNED_RESOURCE');
  assert.equal(JSON.stringify(forgedHashRemote), forgedHashBefore);

  const stalePluginRemote = JSON.parse(JSON.stringify(base));
  stalePluginRemote.plugins['reprint-push-forms-fixture'].version = '1.0.1';
  const stalePluginBefore = JSON.stringify(stalePluginRemote);
  const stalePluginError = captureError(() => applyPlan(stalePluginRemote, ready));
  assert.ok(stalePluginError instanceof PushPlanError);
  assert.equal(stalePluginError.code, 'UNSUPPORTED_PLUGIN_OWNED_RESOURCE');
  assert.equal(JSON.stringify(stalePluginRemote), stalePluginBefore);
});

test('fixture forms lab table journal redacts raw payload values', () => {
  const resourceKey = 'row:["wp_reprint_push_forms_lab","id:1"]';
  const base = baseSite();
  base.plugins['reprint-push-forms-fixture'] = { version: '1.0.0', active: true };
  base.db.wp_reprint_push_forms_lab = {
    'id:1': {
      id: 1,
      form_slug: 'contact',
      payload: { owner: 'forms', mode: 'base-secret' },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = JSON.parse(JSON.stringify(base));
  local.db.wp_reprint_push_forms_lab['id:1'].payload.mode = 'local-secret';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'forms', 'fixture-forms-lab-table'),
    ),
  };

  const result = applyPlan(JSON.parse(JSON.stringify(base)), planFor(base, local, JSON.parse(JSON.stringify(base))));
  const journalJson = JSON.stringify(result.journal);

  assert.equal(journalJson.includes('local-secret'), false);
  assert.equal(journalJson.includes('base-secret'), false);
  assert.equal(result.journal.entries[0].beforeHash.length, 64);
  assert.equal(result.journal.entries[0].afterHash.length, 64);
});

test('fixture forms lab table blocked recovery redacts raw remote payload values', () => {
  const resourceKey = 'row:["wp_reprint_push_forms_lab","id:1"]';
  const base = baseSite();
  base.plugins['reprint-push-forms-fixture'] = { version: '1.0.0', active: true };
  base.db.wp_reprint_push_forms_lab = {
    'id:1': {
      id: 1,
      form_slug: 'contact',
      payload: { owner: 'forms', mode: 'base-secret' },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = JSON.parse(JSON.stringify(base));
  local.db.wp_reprint_push_forms_lab['id:1'].payload.mode = 'local-secret';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'forms', 'fixture-forms-lab-table'),
    ),
  };
  const remote = JSON.parse(JSON.stringify(base));
  const plan = planFor(base, local, remote);
  const error = captureError(() => applyPlan(remote, plan, {
    mutateRemote: true,
    failDuringCommitAtMutation: 1,
  }));
  const detailsJson = JSON.stringify(error.details);

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'INJECTED_FAILURE_DURING_COMMIT');
  assert.equal(detailsJson.includes('base-secret'), false);
  assert.equal(detailsJson.includes('local-secret'), false);
  assert.equal(detailsJson.includes('forms'), true);
  assert.equal(
    error.details.recovery.artifacts.remote.db.wp_reprint_push_forms_lab['id:1'].__redacted,
    true,
  );
});

test('fixture forms lab table conflicts and stale preconditions preserve remote', () => {
  const resourceKey = 'row:["wp_reprint_push_forms_lab","id:1"]';
  const base = baseSite();
  base.plugins['reprint-push-forms-fixture'] = { version: '1.0.0', active: true };
  base.db.wp_reprint_push_forms_lab = {
    'id:1': {
      id: 1,
      form_slug: 'contact',
      payload: { owner: 'forms', mode: 'base' },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = JSON.parse(JSON.stringify(base));
  local.db.wp_reprint_push_forms_lab['id:1'].payload.mode = 'local';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'forms', 'fixture-forms-lab-table'),
    ),
  };
  const remote = JSON.parse(JSON.stringify(base));
  remote.db.wp_reprint_push_forms_lab['id:1'].payload.mode = 'remote';

  const conflictPlan = planFor(base, local, remote);
  assert.equal(conflictPlan.status, 'conflict');
  assert.equal(conflictPlan.conflicts[0].class, 'plugin-data-conflict');
  assert.equal(conflictPlan.conflicts[0].resourceKey, resourceKey);

  const ready = planFor(base, local, JSON.parse(JSON.stringify(base)));
  const staleRemote = JSON.parse(JSON.stringify(base));
  staleRemote.db.wp_reprint_push_forms_lab['id:1'].payload.mode = 'stale-remote';
  const before = JSON.stringify(staleRemote);
  const error = captureError(() => applyPlan(staleRemote, ready));
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PRECONDITION_FAILED');
  assert.equal(JSON.stringify(staleRemote), before);
});

test('classifies divergent plugin-owned data rows as redacted plugin data conflicts', () => {
  const base = baseSite();
  base.db.wp_postmeta = {
    'meta_id:7': {
      meta_id: 7,
      post_id: 1,
      meta_key: '_forms_payload',
      meta_value: 'base-private-meta',
      __pluginOwner: 'forms',
    },
  };
  base.db.wp_forms_entries = {
    'entry_id:9': { entry_id: 9, payload: 'base-private-entry', __pluginOwner: 'forms' },
  };
  const local = JSON.parse(JSON.stringify(base));
  const remote = JSON.parse(JSON.stringify(base));
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-private-option';
  remote.db.wp_options['option_name:forms_settings'].option_value.mode = 'remote-private-option';
  local.db.wp_postmeta['meta_id:7'].meta_value = 'local-private-meta';
  remote.db.wp_postmeta['meta_id:7'].meta_value = 'remote-private-meta';
  local.db.wp_forms_entries['entry_id:9'].payload = 'local-private-entry';
  remote.db.wp_forms_entries['entry_id:9'].payload = 'remote-private-entry';

  const plan = planFor(base, local, remote);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.conflicts, 3);
  assert.deepEqual(
    plan.conflicts.map((conflict) => [conflict.resourceKey, conflict.class, conflict.pluginOwner]),
    [
      ['row:["wp_forms_entries","entry_id:9"]', 'plugin-data-conflict', 'forms'],
      ['row:["wp_options","option_name:forms_settings"]', 'plugin-data-conflict', 'forms'],
      ['row:["wp_postmeta","meta_id:7"]', 'plugin-data-conflict', 'forms'],
    ],
  );
  const conflictsJson = JSON.stringify(plan.conflicts);
  assert.equal(conflictsJson.includes('local-private-option'), false);
  assert.equal(conflictsJson.includes('remote-private-meta'), false);
  assert.equal(conflictsJson.includes('local-private-entry'), false);
});

test('blocks local postmeta references to stale remote-created post identity', () => {
  const resourceKey = 'row:["wp_postmeta","meta_id:45"]';
  const targetResourceKey = 'row:["wp_posts","ID:2"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_postmeta = {
    'meta_id:45': {
      meta_id: 45,
      post_id: 2,
      meta_key: '_local_graph_note',
      meta_value: 'local-private-meta-payload',
    },
  };
  const remote = baseSite();
  remote.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'remote-private-post-title',
    post_content: 'remote-private-post-body',
    post_status: 'publish',
  };

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];
  const reference = blocker.references[0];
  const planJson = JSON.stringify(plan);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, resourceKey), undefined);
  assert.equal(decisionFor(plan, targetResourceKey).decision, 'keep-remote');
  assert.equal(blocker.class, 'stale-wordpress-graph-identity');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.equal(blocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
  assert.equal(reference.relationshipKey, 'wp_postmeta.post_id');
  assert.equal(reference.relationshipType, 'postmeta-post');
  assert.equal(reference.sourceResourceKey, resourceKey);
  assert.equal(reference.targetResourceKey, targetResourceKey);
  assert.equal(reference.targetChange.remoteChange, 'create');
  assert.equal(reference.targetRemoteHash.length, 64);
  assert.equal(planJson.includes('local-private-meta-payload'), false);
  assert.equal(planJson.includes('remote-private-post-title'), false);
  assert.equal(planJson.includes('remote-private-post-body'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.db.wp_posts['ID:2'].post_title, 'remote-private-post-title');
});

test('allows a local postmeta reference to a same-plan post through the generic postmeta-post edge', () => {
  const resourceKey = 'row:["wp_postmeta","meta_id:46"]';
  const targetResourceKey = 'row:["wp_posts","ID:2"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local generic target post',
    post_content: 'local-private-generic-target-body',
    post_status: 'publish',
  };
  local.db.wp_postmeta = {
    'meta_id:46': {
      meta_id: 46,
      post_id: 2,
      meta_key: '_local_graph_note',
      meta_value: 'local-private-generic-meta-payload',
    },
  };

  const plan = planFor(base, local, baseSite());
  const targetMutation = mutationFor(plan, targetResourceKey);
  const postmetaMutation = mutationFor(plan, resourceKey);
  const reference = postmetaMutation.wordpressGraphReferences.find((entry) => entry.relationshipType === 'postmeta-post');
  const referenceJson = JSON.stringify(reference);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(targetMutation.changeKind, 'create');
  assert.equal(postmetaMutation.changeKind, 'create');
  assert.ok(
    plan.mutations.indexOf(targetMutation) < plan.mutations.indexOf(postmetaMutation),
    'target post create must be ordered before dependent generic postmeta',
  );
  assert.deepEqual(postmetaMutation.dependsOnMutationIds, [targetMutation.id]);
  assert.equal(reference.resolutionPolicy, 'same-plan-local-create');
  assert.equal(reference.relationshipKey, 'wp_postmeta.post_id');
  assert.equal(reference.relationshipType, 'postmeta-post');
  assert.equal(reference.targetResourceKey, targetResourceKey);
  assert.equal(reference.dependency.targetMutationId, targetMutation.id);
  assert.equal(reference.dependency.targetLocalHash, targetMutation.localHash);
  assert.equal(referenceJson.includes('local-private-generic-target-body'), false);
  assert.equal(referenceJson.includes('local-private-generic-meta-payload'), false);

  const result = applyPlan(baseSite(), plan);
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Local generic target post');
  assert.equal(result.site.db.wp_postmeta['meta_id:46'].post_id, 2);
});

test('blocks a term taxonomy parent reference to stale remote-created term identity', () => {
  const resourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:9"]';
  const targetResourceKey = 'row:["wp_terms","term_id:7"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_terms = {
    'term_id:7': {
      term_id: 7,
      name: 'local-private-term-name',
      slug: 'local-private-term-slug',
    },
  };
  local.db.wp_term_taxonomy = {
    'term_taxonomy_id:9': {
      term_taxonomy_id: 9,
      term_id: 7,
      taxonomy: 'category',
      description: '',
      parent: 7,
      count: 0,
    },
  };
  const remote = baseSite();
  remote.db.wp_terms = {
    'term_id:7': {
      term_id: 7,
      name: 'remote-private-term-name',
      slug: 'remote-private-term-slug',
    },
  };

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];
  const reference = blocker.references[0];
  const planJson = JSON.stringify(plan);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, resourceKey), undefined);
  assert.equal(decisionFor(plan, targetResourceKey), undefined);
  assert.equal(blocker.class, 'stale-wordpress-graph-identity');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.equal(blocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
  assert.equal(reference.relationshipKey, 'wp_term_taxonomy.term_id');
  assert.equal(reference.relationshipType, 'term-taxonomy-term');
  assert.equal(reference.sourceResourceKey, resourceKey);
  assert.equal(reference.targetResourceKey, targetResourceKey);
  assert.equal(reference.targetChange.remoteChange, 'create');
  assert.equal(reference.targetRemoteHash.length, 64);
  assert.equal(planJson.includes('local-private-term-name'), false);
  assert.equal(planJson.includes('remote-private-term-name'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.db.wp_terms['term_id:7'].name, 'remote-private-term-name');
});

test('blocks a term taxonomy parent reference to a same-plan term when the term is already used by a remote nav menu taxonomy', () => {
  const resourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:9"]';
  const targetResourceKey = 'row:["wp_terms","term_id:7"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_terms = {
    'term_id:7': {
      term_id: 7,
      name: 'local-private-term-name',
      slug: 'local-private-term-slug',
    },
  };
  local.db.wp_term_taxonomy = {
    'term_taxonomy_id:9': {
      term_taxonomy_id: 9,
      term_id: 7,
      taxonomy: 'category',
      description: '',
      parent: 7,
      count: 0,
    },
  };
  const remote = baseSite();
  remote.db.wp_term_taxonomy = {
    'term_taxonomy_id:20': {
      term_taxonomy_id: 20,
      term_id: 7,
      taxonomy: 'nav_menu',
      description: '',
      parent: 0,
      count: 0,
    },
  };

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];
  const blockerTypes = plan.blockers.flatMap((entry) => entry.references.map((reference) => reference.relationshipType));

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(mutationFor(plan, resourceKey).changeKind, 'create');
  assert.equal(decisionFor(plan, targetResourceKey), undefined);
  assert.equal(blocker.class, 'missing-wordpress-graph-dependency');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.equal(blocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
  assert.deepEqual(blockerTypes.sort(), ['term-taxonomy-parent', 'term-taxonomy-term']);
  assert.equal(plan.blockers.length, 2);
  assert.equal(JSON.stringify(plan.blockers).includes('local-private-term-name'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.db.wp_term_taxonomy['term_taxonomy_id:20'].taxonomy, 'nav_menu');
});

test('blocks local termmeta references to stale remote-created term identity', () => {
  const resourceKey = 'row:["wp_termmeta","meta_id:12"]';
  const targetResourceKey = 'row:["wp_terms","term_id:7"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_terms = {
    'term_id:7': {
      term_id: 7,
      name: 'local-private-term-name',
      slug: 'local-private-term-slug',
    },
  };
  local.db.wp_termmeta = {
    'meta_id:12': {
      meta_id: 12,
      term_id: 7,
      meta_key: 'term-note',
      meta_value: 'local-private-termmeta-value',
    },
  };
  const remote = baseSite();
  remote.db.wp_terms = {
    'term_id:7': {
      term_id: 7,
      name: 'remote-private-term-name',
      slug: 'remote-private-term-slug',
    },
  };

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];
  const blocker = plan.blockers[0];
  const reference = blocker.references[0];
  const planJson = JSON.stringify(plan);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, resourceKey), undefined);
  assert.equal(decisionFor(plan, targetResourceKey), undefined);
  assert.equal(conflict.class, 'row-conflict');
  assert.equal(conflict.resourceKey, targetResourceKey);
  assert.equal(blocker.class, 'stale-wordpress-graph-identity');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.equal(blocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
  assert.equal(reference.relationshipKey, 'wp_termmeta.term_id');
  assert.equal(reference.relationshipType, 'termmeta-term');
  assert.equal(reference.sourceResourceKey, resourceKey);
  assert.equal(reference.targetResourceKey, targetResourceKey);
  assert.equal(reference.targetChange.remoteChange, 'create');
  assert.equal(reference.targetRemoteHash.length, 64);
  assert.equal(planJson.includes('local-private-termmeta-value'), false);
  assert.equal(planJson.includes('remote-private-term-name'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.db.wp_terms['term_id:7'].name, 'remote-private-term-name');
});

test('blocks attachment-owned postmeta references to a same-plan attachment', () => {
  const resourceKey = 'row:["wp_postmeta","meta_id:45"]';
  const attachmentResourceKey = 'row:["wp_posts","ID:2"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local attachment',
    post_content: 'local-private-attachment-body',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  local.db.wp_postmeta = {
    'meta_id:45': {
      meta_id: 45,
      post_id: 2,
      meta_key: 'attachment-note',
      meta_value: 'local-private-attachment-note',
    },
  };

  const plan = planFor(base, local, baseSite());
  const blocker = plan.blockers[0];

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.equal(blocker.surface, 'attachment');
  assert.equal(
    JSON.stringify(blocker).includes('local-private-attachment-note'),
    false,
  );
  assert.throws(() => applyPlan(baseSite(), plan), /Refusing to apply/);
});

test('blocks attachment-owned postmeta references to a same-plan post', () => {
  const resourceKey = 'row:["wp_postmeta","meta_id:46"]';
  const postResourceKey = 'row:["wp_posts","ID:3"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local attachment owner',
    post_content: 'local-private-attachment-owner-body',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local post target',
    post_content: 'local-private-post-target-body',
    post_status: 'publish',
  };
  local.db.wp_postmeta = {
    'meta_id:46': {
      meta_id: 46,
      post_id: 2,
      meta_key: 'attachment-note',
      meta_value: 'local-private-attachment-note',
    },
  };

  const plan = planFor(base, local, baseSite());
  const blocker = plan.blockers[0];

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.equal(blocker.surface, 'attachment');
  assert.equal(
    JSON.stringify(blocker).includes('local-private-attachment-note'),
    false,
  );
  assert.throws(() => applyPlan(baseSite(), plan), /Refusing to apply/);
});

test('blocks revision-owned postmeta references to a same-plan attachment', () => {
  const resourceKey = 'row:["wp_postmeta","meta_id:47"]';
  const attachmentResourceKey = 'row:["wp_posts","ID:2"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:5'] = {
    ID: 5,
    post_title: 'Local revision owner',
    post_content: 'local-private-revision-owner-body',
    post_status: 'inherit',
    post_type: 'revision',
  };
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local attachment target',
    post_content: 'local-private-attachment-target-body',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  local.db.wp_postmeta = {
    'meta_id:47': {
      meta_id: 47,
      post_id: 5,
      meta_key: 'revision-note',
      meta_value: 'local-private-revision-note',
    },
  };

  const plan = planFor(base, local, baseSite());
  const attachmentMutation = mutationFor(plan, attachmentResourceKey);
  const blocker = plan.blockers[0];

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(attachmentMutation.changeKind, 'create');
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.equal(blocker.surface, 'revision');
  assert.equal(
    JSON.stringify(blocker).includes('local-private-revision-note'),
    false,
  );
  assert.throws(() => applyPlan(baseSite(), plan), /Refusing to apply/);
});

test('blocks a local postmeta reference to a same-plan navigation post', () => {
  const resourceKey = 'row:["wp_postmeta","meta_id:49"]';
  const targetResourceKey = 'row:["wp_posts","ID:4"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:4'] = {
    ID: 4,
    post_title: 'Local navigation post',
    post_content: 'local-private-navigation-body',
    post_status: 'publish',
    post_type: 'wp_navigation',
  };
  local.db.wp_postmeta = {
    'meta_id:49': {
      meta_id: 49,
      post_id: 4,
      meta_key: 'nav-note',
      meta_value: 'local-private-nav-note',
    },
  };

  const plan = planFor(base, local, baseSite());
  const targetMutation = mutationFor(plan, targetResourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === resourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(targetMutation.changeKind, 'create');
  assert.equal(mutationFor(plan, resourceKey), undefined);
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.surface, 'wp_navigation');
  assert.equal(JSON.stringify(blocker).includes('local-private-nav-note'), false);
  assert.throws(() => applyPlan(baseSite(), plan), /Refusing to apply/);
});

test('blocks a local postmeta reference owned by a wp_navigation post even when it targets a same-plan attachment', () => {
  const resourceKey = 'row:["wp_postmeta","meta_id:50"]';
  const targetResourceKey = 'row:["wp_posts","ID:6"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:4'] = {
    ID: 4,
    post_title: 'Local navigation owner',
    post_content: 'local-private-navigation-owner-body',
    post_status: 'publish',
    post_type: 'wp_navigation',
  };
  local.db.wp_posts['ID:6'] = {
    ID: 6,
    post_title: 'Local attachment target',
    post_content: 'local-private-attachment-target-body',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  local.db.wp_postmeta = {
    'meta_id:50': {
      meta_id: 50,
      post_id: 4,
      meta_key: 'navigation-note',
      meta_value: 6,
    },
  };

  const plan = planFor(base, local, baseSite());
  const targetMutation = mutationFor(plan, targetResourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === resourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(targetMutation.changeKind, 'create');
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.surface, 'wp_navigation');
  assert.equal(JSON.stringify(blocker).includes('local-private-navigation-owner-body'), false);
  assert.equal(JSON.stringify(blocker).includes('local-private-attachment-target-body'), false);
  assert.throws(() => applyPlan(baseSite(), plan), /Refusing to apply/);
});

test('blocks a local postmeta reference owned by a wp_navigation post even when it targets a same-plan revision', () => {
  const resourceKey = 'row:["wp_postmeta","meta_id:51"]';
  const targetResourceKey = 'row:["wp_posts","ID:14"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:13'] = {
    ID: 13,
    post_title: 'Local navigation owner',
    post_content: 'local-private-navigation-owner-body',
    post_status: 'publish',
    post_type: 'wp_navigation',
  };
  local.db.wp_posts['ID:14'] = {
    ID: 14,
    post_title: 'Local revision target',
    post_content: 'local-private-revision-target-body',
    post_status: 'inherit',
    post_type: 'revision',
  };
  local.db.wp_postmeta = {
    'meta_id:51': {
      meta_id: 51,
      post_id: 13,
      meta_key: 'navigation-note',
      meta_value: 14,
    },
  };

  const plan = planFor(base, local, baseSite());
  const targetMutation = mutationFor(plan, targetResourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === resourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(targetMutation, undefined);
  assert.equal(mutationFor(plan, resourceKey), undefined);
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.surface, 'wp_navigation');
  assert.equal(JSON.stringify(blocker).includes('local-private-navigation-owner-body'), false);
  assert.equal(JSON.stringify(blocker).includes('local-private-revision-target-body'), false);
  assert.throws(() => applyPlan(baseSite(), plan), /Refusing to apply/);
});

test('allows a local postmeta reference to a same-plan revision', () => {
  const resourceKey = 'row:["wp_postmeta","meta_id:52"]';
  const targetResourceKey = 'row:["wp_posts","ID:5"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:5'] = {
    ID: 5,
    post_title: 'Local revision target',
    post_content: 'local-private-revision-target-body',
    post_status: 'inherit',
    post_type: 'revision',
  };
  local.db.wp_postmeta = {
    'meta_id:52': {
      meta_id: 52,
      post_id: 1,
      meta_key: 'revision-note',
      meta_value: 5,
    },
  };

  const plan = planFor(base, local, baseSite());
  const postmetaMutation = mutationFor(plan, resourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === targetResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(postmetaMutation.changeKind, 'create');
  assert.equal(mutationFor(plan, targetResourceKey), undefined);
  assert.ok(blocker);
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.surface, 'revision');
  assert.equal(JSON.stringify(blocker).includes('local-private-revision-target-body'), false);
  assert.equal(JSON.stringify(blocker).includes('revision-note'), false);
  assert.throws(() => applyPlan(baseSite(), plan), /Refusing to apply/);
});

test('blocks revision-owned thumbnail metadata from referencing a same-plan post', () => {
  const resourceKey = 'row:["wp_postmeta","meta_id:50"]';
  const targetResourceKey = 'row:["wp_posts","ID:14"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:13'] = {
    ID: 13,
    post_title: 'Local revision owner',
    post_content: 'local-private-revision-owner-body',
    post_status: 'inherit',
    post_type: 'revision',
  };
  local.db.wp_posts['ID:14'] = {
    ID: 14,
    post_title: 'Local target post',
    post_content: 'local-private-target-post-body',
    post_status: 'draft',
  };
  local.db.wp_postmeta = {
    'meta_id:50': {
      meta_id: 50,
      post_id: 13,
      meta_key: '_thumbnail_id',
      meta_value: 14,
    },
  };

  const plan = planFor(base, local, baseSite());
  const targetMutation = mutationFor(plan, targetResourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === resourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(targetMutation.changeKind, 'create');
  assert.equal(mutationFor(plan, resourceKey), undefined);
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.surface, 'revision');
  assert.equal(JSON.stringify(blocker).includes('local-private-revision-owner-body'), false);
  assert.equal(JSON.stringify(blocker).includes('local-private-target-post-body'), false);
  assert.throws(() => applyPlan(baseSite(), plan), /Refusing to apply/);
});

test('blocks revision-owned thumbnail metadata from referencing a same-plan attachment', () => {
  const resourceKey = 'row:["wp_postmeta","meta_id:51"]';
  const targetResourceKey = 'row:["wp_posts","ID:14"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:13'] = {
    ID: 13,
    post_title: 'Local revision owner',
    post_content: 'local-private-revision-owner-body',
    post_status: 'inherit',
    post_type: 'revision',
  };
  local.db.wp_posts['ID:14'] = {
    ID: 14,
    post_title: 'Local target attachment',
    post_content: 'local-private-target-attachment-body',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  local.db.wp_postmeta = {
    'meta_id:51': {
      meta_id: 51,
      post_id: 13,
      meta_key: '_thumbnail_id',
      meta_value: 14,
    },
  };

  const plan = planFor(base, local, baseSite());
  const targetMutation = mutationFor(plan, targetResourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === resourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(targetMutation.changeKind, 'create');
  assert.equal(mutationFor(plan, resourceKey), undefined);
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.surface, 'revision');
  assert.equal(JSON.stringify(blocker).includes('local-private-revision-owner-body'), false);
  assert.equal(JSON.stringify(blocker).includes('local-private-target-attachment-body'), false);
  assert.throws(() => applyPlan(baseSite(), plan), /Refusing to apply/);
});

test('blocks revision-owned menu item parent metadata from referencing a same-plan post', () => {
  const resourceKey = 'row:["wp_postmeta","meta_id:50"]';
  const targetResourceKey = 'row:["wp_posts","ID:14"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:13'] = {
    ID: 13,
    post_title: 'Local revision owner',
    post_content: 'local-private-revision-owner-body',
    post_status: 'inherit',
    post_type: 'revision',
  };
  local.db.wp_posts['ID:14'] = {
    ID: 14,
    post_title: 'Local target post',
    post_content: 'local-private-target-post-body',
    post_status: 'draft',
  };
  local.db.wp_postmeta = {
    'meta_id:50': {
      meta_id: 50,
      post_id: 13,
      meta_key: 'menu_item_parent',
      meta_value: 14,
    },
  };

  const plan = planFor(base, local, baseSite());
  const targetMutation = mutationFor(plan, targetResourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === resourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(targetMutation.changeKind, 'create');
  assert.equal(mutationFor(plan, resourceKey), undefined);
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.surface, 'revision');
  assert.equal(JSON.stringify(blocker).includes('local-private-revision-owner-body'), false);
  assert.equal(JSON.stringify(blocker).includes('local-private-target-post-body'), false);
  assert.throws(() => applyPlan(baseSite(), plan), /Refusing to apply/);
});

test('blocks revision-owned menu item parent metadata from referencing a same-plan attachment', () => {
  const resourceKey = 'row:["wp_postmeta","meta_id:51"]';
  const targetResourceKey = 'row:["wp_posts","ID:14"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:13'] = {
    ID: 13,
    post_title: 'Local revision owner',
    post_content: 'local-private-revision-owner-body',
    post_status: 'inherit',
    post_type: 'revision',
  };
  local.db.wp_posts['ID:14'] = {
    ID: 14,
    post_title: 'Local target attachment',
    post_content: 'local-private-target-attachment-body',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  local.db.wp_postmeta = {
    'meta_id:51': {
      meta_id: 51,
      post_id: 13,
      meta_key: 'menu_item_parent',
      meta_value: 14,
    },
  };

  const plan = planFor(base, local, baseSite());
  const targetMutation = mutationFor(plan, targetResourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === resourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(targetMutation.changeKind, 'create');
  assert.equal(mutationFor(plan, resourceKey), undefined);
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.surface, 'revision');
  assert.equal(JSON.stringify(blocker).includes('local-private-revision-owner-body'), false);
  assert.equal(JSON.stringify(blocker).includes('local-private-target-attachment-body'), false);
  assert.throws(() => applyPlan(baseSite(), plan), /Refusing to apply/);
});

test('blocks revision-owned menu item parent metadata from referencing a same-plan wp_navigation post', () => {
  const resourceKey = 'row:["wp_postmeta","meta_id:54"]';
  const targetResourceKey = 'row:["wp_posts","ID:14"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:13'] = {
    ID: 13,
    post_title: 'Local revision owner',
    post_content: 'local-private-revision-owner-body',
    post_status: 'inherit',
    post_type: 'revision',
  };
  local.db.wp_posts['ID:14'] = {
    ID: 14,
    post_title: 'Local navigation target',
    post_content: 'local-private-navigation-target-body',
    post_status: 'publish',
    post_type: 'wp_navigation',
  };
  local.db.wp_postmeta = {
    'meta_id:54': {
      meta_id: 54,
      post_id: 13,
      meta_key: 'menu_item_parent',
      meta_value: 14,
    },
  };

  const plan = planFor(base, local, baseSite());
  const blocker = plan.blockers.find((entry) => entry.resourceKey === resourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(mutationFor(plan, targetResourceKey), undefined);
  assert.equal(mutationFor(plan, resourceKey), undefined);
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.surface, 'revision');
  assert.equal(JSON.stringify(blocker).includes('local-private-revision-owner-body'), false);
  assert.equal(JSON.stringify(blocker).includes('local-private-navigation-target-body'), false);
  assert.throws(() => applyPlan(baseSite(), plan), /Refusing to apply/);
});

test('allows local postmeta references to a post created by the same plan', () => {
  const resourceKey = 'row:["wp_postmeta","meta_id:45"]';
  const targetResourceKey = 'row:["wp_posts","ID:2"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local child post',
    post_content: 'local-private-post-body',
    post_status: 'draft',
  };
  local.db.wp_postmeta = {
    'meta_id:45': {
      meta_id: 45,
      post_id: 2,
      meta_key: '_local_graph_note',
      meta_value: 'local-private-meta-payload',
    },
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const targetMutation = mutationFor(plan, targetResourceKey);
  const postmetaMutation = mutationFor(plan, resourceKey);
  const reference = postmetaMutation.wordpressGraphReferences.find((entry) => entry.relationshipType === 'menu-item-parent-post');
  const referenceJson = JSON.stringify(reference);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(targetMutation.changeKind, 'create');
  assert.equal(postmetaMutation.changeKind, 'create');
  assert.ok(
    plan.mutations.indexOf(targetMutation) < plan.mutations.indexOf(postmetaMutation),
    'target post create must be ordered before dependent postmeta',
  );
  assert.deepEqual(postmetaMutation.dependsOnMutationIds, [targetMutation.id]);
  assert.equal(reference.resolutionPolicy, 'same-plan-local-create');
  assert.equal(reference.relationshipKey, 'wp_postmeta.post_id');
  assert.equal(reference.targetResourceKey, targetResourceKey);
  assert.equal(reference.dependency.targetMutationId, targetMutation.id);
  assert.equal(reference.dependency.targetLocalHash, targetMutation.localHash);
  assert.equal(referenceJson.includes('local-private-meta-payload'), false);
  assert.equal(referenceJson.includes('local-private-post-body'), false);

  const result = applyPlan(remote, plan);
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Local child post');
  assert.equal(result.site.db.wp_postmeta['meta_id:45'].post_id, 2);

  const assertInvalidMutationDependency = (candidate) => {
    assert.throws(
      () => applyPlan(remote, candidate),
      (error) => error instanceof PushPlanError && error.code === 'MUTATION_DEPENDENCY_INVALID',
    );
  };

  const missingDependencyPlan = tamperReadyPlan(plan, (copy) => {
    const mutation = mutationFor(copy, resourceKey);
    delete mutation.dependsOnMutationIds;
  });
  assertInvalidMutationDependency(missingDependencyPlan);

  const forgedEvidencePlan = tamperReadyPlan(plan, (copy) => {
    const mutation = mutationFor(copy, resourceKey);
    mutation.wordpressGraphReferences[0].dependency.targetLocalHash = '0'.repeat(64);
  });
  assertInvalidMutationDependency(forgedEvidencePlan);

  const misorderedPlan = tamperReadyPlan(plan, (copy) => {
    copy.mutations.reverse();
  });
  assertInvalidMutationDependency(misorderedPlan);
});

test('allows local menu item parent metadata to reference a post created by the same plan', () => {
  const resourceKey = 'row:["wp_postmeta","meta_id:46"]';
  const targetResourceKey = 'row:["wp_posts","ID:2"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local parent post',
    post_content: 'local-private-parent-body',
    post_status: 'publish',
  };
  local.db.wp_postmeta = {
    'meta_id:46': {
      meta_id: 46,
      post_id: 1,
      meta_key: 'menu_item_parent',
      meta_value: 2,
    },
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const targetMutation = mutationFor(plan, targetResourceKey);
  const postmetaMutation = mutationFor(plan, resourceKey);
  const reference = postmetaMutation.wordpressGraphReferences.find((entry) => entry.relationshipType === 'menu-item-parent-post');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(targetMutation.changeKind, 'create');
  assert.equal(postmetaMutation.changeKind, 'create');
  assert.ok(
    plan.mutations.indexOf(targetMutation) < plan.mutations.indexOf(postmetaMutation),
    'target post create must be ordered before dependent menu item metadata',
  );
  assert.deepEqual(postmetaMutation.dependsOnMutationIds, [targetMutation.id]);
  assert.equal(reference.resolutionPolicy, 'same-plan-local-create');
  assert.equal(reference.relationshipKey, 'wp_postmeta.meta_value');
  assert.equal(reference.relationshipType, 'menu-item-parent-post');
  assert.equal(reference.targetResourceKey, targetResourceKey);

  const result = applyPlan(remote, plan);
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Local parent post');
  assert.equal(result.site.db.wp_postmeta['meta_id:46'].meta_value, 2);
});

test('blocks menu item parent metadata from referencing a same-plan attachment', () => {
  const resourceKey = 'row:["wp_postmeta","meta_id:47"]';
  const attachmentResourceKey = 'row:["wp_posts","ID:2"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local attachment target',
    post_content: 'local-private-attachment-target-body',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  local.db.wp_postmeta = {
    'meta_id:47': {
      meta_id: 47,
      post_id: 1,
      meta_key: 'menu_item_parent',
      meta_value: 2,
    },
  };

  const plan = planFor(base, local, baseSite());
  const blocker = plan.blockers[0];

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(mutationFor(plan, resourceKey).changeKind, 'create');
  assert.equal(mutationFor(plan, attachmentResourceKey).changeKind, 'create');
  assert.equal(blocker.class, 'missing-wordpress-graph-dependency');
  assert.equal(blocker.resourceKey, resourceKey);
  const reference = blocker.references[0];
  assert.equal(reference.relationshipType, 'menu-item-parent-post');
  assert.equal(reference.targetResourceKey, attachmentResourceKey);
  assert.equal(
    JSON.stringify(blocker).includes('local-private-attachment-target-body'),
    false,
  );
  assert.throws(() => applyPlan(baseSite(), plan), /Refusing to apply/);
});

test('blocks menu item parent metadata owned by an attachment even when it targets a same-plan post', () => {
  const resourceKey = 'row:["wp_postmeta","meta_id:48"]';
  const attachmentResourceKey = 'row:["wp_posts","ID:2"]';
  const targetResourceKey = 'row:["wp_posts","ID:3"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local attachment owner',
    post_content: 'local-private-attachment-owner-body',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local menu parent target',
    post_content: 'local-private-menu-parent-target-body',
    post_status: 'publish',
  };
  local.db.wp_postmeta = {
    'meta_id:48': {
      meta_id: 48,
      post_id: 2,
      meta_key: 'menu_item_parent',
      meta_value: 3,
    },
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const attachmentMutation = mutationFor(plan, attachmentResourceKey);
  const targetMutation = mutationFor(plan, targetResourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === resourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(attachmentMutation.changeKind, 'create');
  assert.equal(targetMutation.changeKind, 'create');
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.surface, 'attachment');
  assert.equal(
    JSON.stringify(blocker).includes('local-private-attachment-owner-body'),
    false,
  );
  assert.equal(
    JSON.stringify(blocker).includes('local-private-menu-parent-target-body'),
    false,
  );
});

test('allows menu item parent metadata to reference a same-plan post', () => {
  const resourceKey = 'row:["wp_postmeta","meta_id:49"]';
  const parentResourceKey = 'row:["wp_posts","ID:2"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local menu parent target',
    post_content: 'local-private-menu-parent-target-body',
    post_status: 'publish',
  };
  local.db.wp_postmeta = {
    'meta_id:49': {
      meta_id: 49,
      post_id: 1,
      meta_key: 'menu_item_parent',
      meta_value: 2,
    },
  };

  const plan = planFor(base, local, baseSite());
  const targetMutation = mutationFor(plan, parentResourceKey);
  const postmetaMutation = mutationFor(plan, resourceKey);
  const reference = postmetaMutation.wordpressGraphReferences[0];

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(targetMutation.changeKind, 'create');
  assert.equal(postmetaMutation.changeKind, 'create');
  assert.ok(
    plan.mutations.indexOf(targetMutation) < plan.mutations.indexOf(postmetaMutation),
    'target post create must be ordered before dependent menu item metadata',
  );
  assert.deepEqual(postmetaMutation.dependsOnMutationIds, [targetMutation.id]);
  assert.equal(reference.resolutionPolicy, 'same-plan-local-create');
  assert.equal(reference.relationshipKey, 'wp_postmeta.meta_value');
  assert.equal(reference.relationshipType, 'menu-item-parent-post');
  assert.equal(reference.targetResourceKey, parentResourceKey);
  assert.equal(reference.targetChange.localChange, 'create');
  assert.equal(reference.targetChange.remoteChange, 'unchanged');

  const result = applyPlan(baseSite(), plan);
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Local menu parent target');
  assert.equal(result.site.db.wp_postmeta['meta_id:49'].meta_value, 2);
});

test('allows menu item parent metadata to reference a same-plan post even when a remote navigation post exists', () => {
  const resourceKey = 'row:["wp_postmeta","meta_id:50"]';
  const parentResourceKey = 'row:["wp_posts","ID:2"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local menu parent target',
    post_content: 'local-private-menu-parent-target-body',
    post_status: 'publish',
  };
  local.db.wp_postmeta = {
    'meta_id:50': {
      meta_id: 50,
      post_id: 1,
      meta_key: 'menu_item_parent',
      meta_value: 2,
    },
  };
  const remote = baseSite();
  remote.db.wp_posts['ID:9'] = {
    ID: 9,
    post_title: 'Remote navigation post',
    post_content: 'remote-navigation-body',
    post_status: 'publish',
    post_type: 'wp_navigation',
  };

  const plan = planFor(base, local, remote);
  const targetMutation = mutationFor(plan, parentResourceKey);
  const postmetaMutation = mutationFor(plan, resourceKey);
  const reference = postmetaMutation.wordpressGraphReferences[0];

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(targetMutation.changeKind, 'create');
  assert.equal(postmetaMutation.changeKind, 'create');
  assert.ok(
    plan.mutations.indexOf(targetMutation) < plan.mutations.indexOf(postmetaMutation),
    'target post create must be ordered before dependent menu item metadata',
  );
  assert.deepEqual(postmetaMutation.dependsOnMutationIds, [targetMutation.id]);
  assert.equal(reference.resolutionPolicy, 'same-plan-local-create');
  assert.equal(reference.relationshipKey, 'wp_postmeta.meta_value');
  assert.equal(reference.relationshipType, 'menu-item-parent-post');
  assert.equal(reference.targetResourceKey, parentResourceKey);
  assert.equal(reference.targetChange.localChange, 'create');
  assert.equal(reference.targetChange.remoteChange, 'unchanged');
  assert.equal(JSON.stringify(reference).includes('remote-navigation-body'), false);

  const result = applyPlan(baseSite(), plan);
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Local menu parent target');
  assert.equal(result.site.db.wp_postmeta['meta_id:50'].meta_value, 2);
});

test('blocks menu item parent metadata owned by an attachment even when it targets a same-plan attachment', () => {
  const resourceKey = 'row:["wp_postmeta","meta_id:50"]';
  const attachmentResourceKey = 'row:["wp_posts","ID:2"]';
  const targetResourceKey = 'row:["wp_posts","ID:3"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local attachment owner',
    post_content: 'local-private-attachment-owner-body',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local attachment target',
    post_content: 'local-private-attachment-target-body',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  local.db.wp_postmeta = {
    'meta_id:50': {
      meta_id: 50,
      post_id: 2,
      meta_key: 'menu_item_parent',
      meta_value: 3,
    },
  };

  const plan = planFor(base, local, baseSite());
  const attachmentMutation = mutationFor(plan, attachmentResourceKey);
  const targetMutation = mutationFor(plan, targetResourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === resourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(attachmentMutation.changeKind, 'create');
  assert.equal(targetMutation.changeKind, 'create');
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.surface, 'attachment');
  assert.equal(JSON.stringify(blocker).includes('local-private-attachment-owner-body'), false);
  assert.equal(JSON.stringify(blocker).includes('local-private-attachment-target-body'), false);
});

test('blocks menu item parent metadata from referencing a same-plan revision', () => {
  const resourceKey = 'row:["wp_postmeta","meta_id:52"]';
  const revisionResourceKey = 'row:["wp_posts","ID:5"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:5'] = {
    ID: 5,
    post_title: 'Local revision target',
    post_content: 'local-private-revision-target-body',
    post_type: 'revision',
  };
  local.db.wp_postmeta = {
    'meta_id:52': {
      meta_id: 52,
      post_id: 1,
      meta_key: 'menu_item_parent',
      meta_value: 5,
    },
  };

  const plan = planFor(base, local, baseSite());
  const revisionMutation = mutationFor(plan, revisionResourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === resourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(revisionMutation, undefined);
  assert.ok(blocker);
  assert.equal(blocker.class, 'missing-wordpress-graph-dependency');
  assert.equal(blocker.references[0].relationshipType, 'menu-item-parent-post');
  assert.equal(blocker.references[0].targetResourceKey, revisionResourceKey);
  assert.equal(
    JSON.stringify(blocker).includes('local-private-revision-target-body'),
    false,
  );
});

test('allows a local post to reference a parent post created by the same plan', () => {
  const parentResourceKey = 'row:["wp_posts","ID:2"]';
  const childResourceKey = 'row:["wp_posts","ID:3"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local parent post',
    post_content: 'local-private-parent-body',
    post_status: 'publish',
  };
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local child post',
    post_content: 'local-private-child-body',
    post_status: 'draft',
    post_parent: 2,
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const parentMutation = mutationFor(plan, parentResourceKey);
  const childMutation = mutationFor(plan, childResourceKey);
  const reference = childMutation.wordpressGraphReferences[0];
  const referenceJson = JSON.stringify(reference);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(parentMutation.changeKind, 'create');
  assert.equal(childMutation.changeKind, 'create');
  assert.ok(
    plan.mutations.indexOf(parentMutation) < plan.mutations.indexOf(childMutation),
    'parent post create must be ordered before dependent child post',
  );
  assert.deepEqual(childMutation.dependsOnMutationIds, [parentMutation.id]);
  assert.equal(reference.resolutionPolicy, 'same-plan-local-create');
  assert.equal(reference.relationshipKey, 'wp_posts.post_parent');
  assert.equal(reference.relationshipType, 'post-parent');
  assert.equal(reference.targetResourceKey, parentResourceKey);
  assert.equal(reference.dependency.targetMutationId, parentMutation.id);
  assert.equal(reference.dependency.targetLocalHash, parentMutation.localHash);
  assert.equal(referenceJson.includes('local-private-child-body'), false);
  assert.equal(referenceJson.includes('local-private-parent-body'), false);

  const result = applyPlan(remote, plan);
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Local parent post');
  assert.equal(result.site.db.wp_posts['ID:3'].post_parent, 2);
});

test('allows a local attachment to reference a parent post created by the same plan even when a remote navigation post exists', () => {
  const parentResourceKey = 'row:["wp_posts","ID:2"]';
  const attachmentResourceKey = 'row:["wp_posts","ID:3"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local parent post',
    post_content: 'local-private-parent-body',
    post_status: 'publish',
  };
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local attachment',
    post_content: 'local-private-attachment-body',
    post_status: 'inherit',
    post_type: 'attachment',
    post_parent: 2,
  };
  const remote = baseSite();
  remote.db.wp_posts['ID:9'] = {
    ID: 9,
    post_title: 'Remote navigation post',
    post_content: 'remote-navigation-body',
    post_status: 'publish',
    post_type: 'wp_navigation',
  };

  const plan = planFor(base, local, remote);
  const parentMutation = mutationFor(plan, parentResourceKey);
  const attachmentMutation = mutationFor(plan, attachmentResourceKey);
  const reference = attachmentMutation.wordpressGraphReferences.find((entry) => entry.relationshipType === 'post-parent');
  const referenceJson = JSON.stringify(reference);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(parentMutation.changeKind, 'create');
  assert.equal(attachmentMutation.changeKind, 'create');
  assert.ok(
    plan.mutations.indexOf(parentMutation) < plan.mutations.indexOf(attachmentMutation),
    'parent post create must be ordered before dependent attachment',
  );
  assert.deepEqual(attachmentMutation.dependsOnMutationIds, [parentMutation.id]);
  assert.equal(reference.resolutionPolicy, 'same-plan-local-create');
  assert.equal(reference.relationshipKey, 'wp_posts.post_parent');
  assert.equal(reference.relationshipType, 'post-parent');
  assert.equal(reference.targetResourceKey, parentResourceKey);
  assert.equal(referenceJson.includes('local-private-parent-body'), false);
  assert.equal(referenceJson.includes('remote-navigation-body'), false);
});

test('allows a local page parent reference to a same-plan post even when a remote navigation post exists', () => {
  const parentResourceKey = 'row:["wp_posts","ID:2"]';
  const pageResourceKey = 'row:["wp_posts","ID:3"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local parent post',
    post_content: 'local-private-parent-body',
    post_status: 'publish',
  };
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local page child',
    post_content: 'local-private-page-body',
    post_status: 'publish',
    post_parent: 2,
  };
  const remote = baseSite();
  remote.db.wp_posts['ID:9'] = {
    ID: 9,
    post_title: 'Remote navigation post',
    post_content: 'remote-navigation-body',
    post_status: 'publish',
    post_type: 'wp_navigation',
  };

  const plan = planFor(base, local, remote);
  const parentMutation = mutationFor(plan, parentResourceKey);
  const pageMutation = mutationFor(plan, pageResourceKey);
  const reference = pageMutation.wordpressGraphReferences.find((entry) => entry.relationshipType === 'post-parent');
  const referenceJson = JSON.stringify(reference);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(parentMutation.changeKind, 'create');
  assert.equal(pageMutation.changeKind, 'create');
  assert.ok(
    plan.mutations.indexOf(parentMutation) < plan.mutations.indexOf(pageMutation),
    'parent post create must be ordered before dependent page',
  );
  assert.deepEqual(pageMutation.dependsOnMutationIds, [parentMutation.id]);
  assert.equal(reference.resolutionPolicy, 'same-plan-local-create');
  assert.equal(reference.relationshipKey, 'wp_posts.post_parent');
  assert.equal(reference.relationshipType, 'post-parent');
  assert.equal(reference.targetResourceKey, parentResourceKey);
  assert.equal(referenceJson.includes('local-private-parent-body'), false);
  assert.equal(referenceJson.includes('local-private-page-body'), false);
  assert.equal(referenceJson.includes('remote-navigation-body'), false);
});

test('allows a local thumbnail reference to an attachment created by the same plan', () => {
  const attachmentResourceKey = 'row:["wp_posts","ID:2"]';
  const postmetaResourceKey = 'row:["wp_postmeta","meta_id:45"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local attachment',
    post_content: 'local-private-attachment-body',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  local.db.wp_postmeta = {
    'meta_id:45': {
      meta_id: 45,
      post_id: 1,
      meta_key: '_thumbnail_id',
      meta_value: 2,
    },
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const attachmentMutation = mutationFor(plan, attachmentResourceKey);
  const postmetaMutation = mutationFor(plan, postmetaResourceKey);
  const reference = postmetaMutation.wordpressGraphReferences.find((entry) => entry.relationshipType === 'featured-image-attachment');
  const referenceJson = JSON.stringify(reference);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(attachmentMutation.changeKind, 'create');
  assert.equal(postmetaMutation.changeKind, 'create');
  assert.ok(
    plan.mutations.indexOf(attachmentMutation) < plan.mutations.indexOf(postmetaMutation),
    'attachment create must be ordered before dependent thumbnail metadata',
  );
  assert.deepEqual(postmetaMutation.dependsOnMutationIds, [attachmentMutation.id]);
  assert.equal(reference.resolutionPolicy, 'same-plan-local-create');
  assert.equal(reference.relationshipKey, 'wp_postmeta.meta_value');
  assert.equal(reference.relationshipType, 'featured-image-attachment');
  assert.equal(reference.targetResourceKey, attachmentResourceKey);
  assert.equal(reference.dependency.targetMutationId, attachmentMutation.id);
  assert.equal(reference.dependency.targetLocalHash, attachmentMutation.localHash);
  assert.equal(referenceJson.includes('local-private-attachment-body'), false);

  const result = applyPlan(remote, plan);
  assert.equal(result.site.db.wp_posts['ID:2'].post_type, 'attachment');
  assert.equal(result.site.db.wp_postmeta['meta_id:45'].meta_value, 2);
});

test('allows a local thumbnail reference owned by a same-plan post to an attachment created by the same plan', () => {
  const postResourceKey = 'row:["wp_posts","ID:3"]';
  const attachmentResourceKey = 'row:["wp_posts","ID:2"]';
  const postmetaResourceKey = 'row:["wp_postmeta","meta_id:45"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local thumbnail owner post',
    post_content: 'local-private-thumbnail-owner-body',
    post_status: 'publish',
  };
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local attachment',
    post_content: 'local-private-thumbnail-attachment-body',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  local.db.wp_postmeta = {
    'meta_id:45': {
      meta_id: 45,
      post_id: 3,
      meta_key: '_thumbnail_id',
      meta_value: 2,
    },
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const postMutation = mutationFor(plan, postResourceKey);
  const attachmentMutation = mutationFor(plan, attachmentResourceKey);
  const postmetaMutation = mutationFor(plan, postmetaResourceKey);
  const reference = postmetaMutation.wordpressGraphReferences.find((entry) => entry.relationshipType === 'featured-image-attachment');
  const referenceJson = JSON.stringify(reference);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(postMutation.changeKind, 'create');
  assert.equal(attachmentMutation.changeKind, 'create');
  assert.equal(postmetaMutation.changeKind, 'create');
  assert.ok(
    plan.mutations.indexOf(postMutation) < plan.mutations.indexOf(postmetaMutation),
    'thumbnail owner post create must be ordered before dependent thumbnail metadata',
  );
  assert.ok(
    plan.mutations.indexOf(attachmentMutation) < plan.mutations.indexOf(postmetaMutation),
    'attachment create must be ordered before dependent thumbnail metadata',
  );
  assert.deepEqual(postmetaMutation.dependsOnMutationIds.sort(), [attachmentMutation.id, postMutation.id].sort());
  assert.equal(reference.resolutionPolicy, 'same-plan-local-create');
  assert.equal(reference.relationshipKey, 'wp_postmeta.meta_value');
  assert.equal(reference.relationshipType, 'featured-image-attachment');
  assert.equal(reference.targetResourceKey, attachmentResourceKey);
  assert.equal(referenceJson.includes('local-private-thumbnail-owner-body'), false);
  assert.equal(referenceJson.includes('local-private-thumbnail-attachment-body'), false);

  const result = applyPlan(remote, plan);
  assert.equal(result.site.db.wp_posts['ID:3'].post_title, 'Local thumbnail owner post');
  assert.equal(result.site.db.wp_posts['ID:2'].post_type, 'attachment');
  assert.equal(result.site.db.wp_postmeta['meta_id:45'].meta_value, 2);
});

test('allows a local post, attachment, and thumbnail graph to resolve in the same plan', () => {
  const parentResourceKey = 'row:["wp_posts","ID:3"]';
  const attachmentResourceKey = 'row:["wp_posts","ID:2"]';
  const postmetaResourceKey = 'row:["wp_postmeta","meta_id:45"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local attachment parent post',
    post_content: 'local-private-attachment-parent-post-body',
    post_status: 'publish',
  };
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local attachment',
    post_content: 'local-private-attachment-body',
    post_status: 'inherit',
    post_type: 'attachment',
    post_parent: 3,
  };
  local.db.wp_postmeta = {
    'meta_id:45': {
      meta_id: 45,
      post_id: 3,
      meta_key: '_thumbnail_id',
      meta_value: 2,
    },
  };

  const plan = planFor(base, local, baseSite());
  const parentMutation = mutationFor(plan, parentResourceKey);
  const attachmentMutation = mutationFor(plan, attachmentResourceKey);
  const postmetaMutation = mutationFor(plan, postmetaResourceKey);
  const parentReference = attachmentMutation.wordpressGraphReferences.find((entry) => entry.relationshipType === 'post-parent');
  const thumbnailReference = postmetaMutation.wordpressGraphReferences.find((entry) => entry.relationshipType === 'featured-image-attachment');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(parentMutation.changeKind, 'create');
  assert.equal(attachmentMutation.changeKind, 'create');
  assert.equal(postmetaMutation.changeKind, 'create');
  assert.ok(
    plan.mutations.indexOf(parentMutation) < plan.mutations.indexOf(attachmentMutation),
    'parent post create must be ordered before dependent attachment',
  );
  assert.ok(
    plan.mutations.indexOf(attachmentMutation) < plan.mutations.indexOf(postmetaMutation),
    'attachment create must be ordered before dependent thumbnail metadata',
  );
  assert.deepEqual(attachmentMutation.dependsOnMutationIds, [parentMutation.id]);
  assert.deepEqual(postmetaMutation.dependsOnMutationIds.sort(), [attachmentMutation.id, parentMutation.id].sort());
  assert.equal(parentReference.resolutionPolicy, 'same-plan-local-create');
  assert.equal(parentReference.relationshipKey, 'wp_posts.post_parent');
  assert.equal(parentReference.relationshipType, 'post-parent');
  assert.equal(parentReference.targetResourceKey, parentResourceKey);
  assert.equal(thumbnailReference.resolutionPolicy, 'same-plan-local-create');
  assert.equal(thumbnailReference.relationshipKey, 'wp_postmeta.meta_value');
  assert.equal(thumbnailReference.relationshipType, 'featured-image-attachment');
  assert.equal(thumbnailReference.targetResourceKey, attachmentResourceKey);
  assert.equal(thumbnailReference.dependency.targetMutationId, attachmentMutation.id);
  assert.equal(thumbnailReference.dependency.targetLocalHash, attachmentMutation.localHash);
  assert.equal(
    JSON.stringify(parentReference).includes('local-private-attachment-parent-post-body'),
    false,
  );
  assert.equal(JSON.stringify(thumbnailReference).includes('local-private-attachment-body'), false);

  const result = applyPlan(baseSite(), plan);
  assert.equal(result.site.db.wp_posts['ID:3'].post_title, 'Local attachment parent post');
  assert.equal(result.site.db.wp_posts['ID:2'].post_parent, 3);
  assert.equal(result.site.db.wp_postmeta['meta_id:45'].meta_value, 2);
});

test('allows a local thumbnail reference owned by a same-plan post to an attachment created by the same plan even when a remote navigation post exists', () => {
  const postResourceKey = 'row:["wp_posts","ID:3"]';
  const attachmentResourceKey = 'row:["wp_posts","ID:2"]';
  const postmetaResourceKey = 'row:["wp_postmeta","meta_id:45"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local thumbnail owner post',
    post_content: 'local-private-thumbnail-owner-body',
    post_status: 'publish',
  };
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local attachment',
    post_content: 'local-private-thumbnail-attachment-body',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  local.db.wp_postmeta = {
    'meta_id:45': {
      meta_id: 45,
      post_id: 3,
      meta_key: '_thumbnail_id',
      meta_value: 2,
    },
  };
  const remote = baseSite();
  remote.db.wp_posts['ID:9'] = {
    ID: 9,
    post_title: 'Remote navigation post',
    post_content: 'remote-navigation-body',
    post_status: 'publish',
    post_type: 'wp_navigation',
  };

  const plan = planFor(base, local, remote);
  const postMutation = mutationFor(plan, postResourceKey);
  const attachmentMutation = mutationFor(plan, attachmentResourceKey);
  const postmetaMutation = mutationFor(plan, postmetaResourceKey);
  const reference = postmetaMutation.wordpressGraphReferences.find((entry) => entry.relationshipType === 'featured-image-attachment');
  const referenceJson = JSON.stringify(reference);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(postMutation.changeKind, 'create');
  assert.equal(attachmentMutation.changeKind, 'create');
  assert.equal(postmetaMutation.changeKind, 'create');
  assert.ok(
    plan.mutations.indexOf(postMutation) < plan.mutations.indexOf(postmetaMutation),
    'thumbnail owner post create must be ordered before dependent thumbnail metadata',
  );
  assert.ok(
    plan.mutations.indexOf(attachmentMutation) < plan.mutations.indexOf(postmetaMutation),
    'attachment create must be ordered before dependent thumbnail metadata',
  );
  assert.deepEqual(postmetaMutation.dependsOnMutationIds.sort(), [attachmentMutation.id, postMutation.id].sort());
  assert.equal(reference.resolutionPolicy, 'same-plan-local-create');
  assert.equal(reference.relationshipKey, 'wp_postmeta.meta_value');
  assert.equal(reference.relationshipType, 'featured-image-attachment');
  assert.equal(reference.targetResourceKey, attachmentResourceKey);
  assert.equal(referenceJson.includes('local-private-thumbnail-owner-body'), false);
  assert.equal(referenceJson.includes('local-private-thumbnail-attachment-body'), false);
  assert.equal(referenceJson.includes('remote-navigation-body'), false);
});

test('blocks a local thumbnail reference from an attachment to a same-plan attachment', () => {
  const sourceAttachmentResourceKey = 'row:["wp_posts","ID:1"]';
  const targetAttachmentResourceKey = 'row:["wp_posts","ID:2"]';
  const postmetaResourceKey = 'row:["wp_postmeta","meta_id:45"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:1'] = {
    ID: 1,
    post_title: 'Local source attachment',
    post_content: 'local-private-source-attachment-body',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local target attachment',
    post_content: 'local-private-target-attachment-body',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  local.db.wp_postmeta = {
    'meta_id:45': {
      meta_id: 45,
      post_id: 1,
      meta_key: '_thumbnail_id',
      meta_value: 2,
    },
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const sourceAttachmentMutation = mutationFor(plan, sourceAttachmentResourceKey);
  const targetAttachmentMutation = mutationFor(plan, targetAttachmentResourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === postmetaResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(sourceAttachmentMutation.changeKind, 'update');
  assert.equal(targetAttachmentMutation.changeKind, 'create');
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.resourceKey, postmetaResourceKey);
  assert.equal(blocker.surface, 'attachment');
  assert.equal(
    JSON.stringify(blocker).includes('local-private-source-attachment-body'),
    false,
  );
  assert.equal(
    JSON.stringify(blocker).includes('local-private-target-attachment-body'),
    false,
  );
});

test('blocks a local thumbnail reference from an attachment to a same-plan post', () => {
  const sourceAttachmentResourceKey = 'row:["wp_posts","ID:1"]';
  const targetPostResourceKey = 'row:["wp_posts","ID:3"]';
  const postmetaResourceKey = 'row:["wp_postmeta","meta_id:45"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:1'] = {
    ID: 1,
    post_title: 'Local source attachment',
    post_content: 'local-private-source-attachment-body',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local target post',
    post_content: 'local-private-target-post-body',
    post_status: 'publish',
  };
  local.db.wp_postmeta = {
    'meta_id:45': {
      meta_id: 45,
      post_id: 1,
      meta_key: '_thumbnail_id',
      meta_value: 3,
    },
  };

  const plan = planFor(base, local, baseSite());
  const sourceAttachmentMutation = mutationFor(plan, sourceAttachmentResourceKey);
  const targetPostMutation = mutationFor(plan, targetPostResourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === postmetaResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(sourceAttachmentMutation.changeKind, 'update');
  assert.equal(targetPostMutation.changeKind, 'create');
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.resourceKey, postmetaResourceKey);
  assert.equal(blocker.surface, 'attachment');
  assert.equal(
    JSON.stringify(blocker).includes('local-private-source-attachment-body'),
    false,
  );
  assert.equal(
    JSON.stringify(blocker).includes('local-private-target-post-body'),
    false,
  );
});

test('blocks menu item parent metadata from referencing a same-plan wp_navigation post', () => {
  const navigationResourceKey = 'row:["wp_posts","ID:2"]';
  const postmetaResourceKey = 'row:["wp_postmeta","meta_id:46"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local navigation target',
    post_content: 'local-private-navigation-target-body',
    post_status: 'inherit',
    post_type: 'wp_navigation',
  };
  local.db.wp_postmeta = {
    'meta_id:46': {
      meta_id: 46,
      post_id: 1,
      meta_key: 'menu_item_parent',
      meta_value: 2,
    },
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === postmetaResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(mutationFor(plan, navigationResourceKey), undefined);
  assert.equal(mutationFor(plan, postmetaResourceKey).changeKind, 'create');
  assert.equal(blocker.class, 'missing-wordpress-graph-dependency');
  assert.equal(blocker.references[0].relationshipType, 'menu-item-parent-post');
  assert.equal(blocker.references[0].targetResourceKey, navigationResourceKey);
  assert.equal(
    JSON.stringify(blocker).includes('local-private-navigation-target-body'),
    false,
  );
});

test('blocks menu item parent metadata from referencing a same-plan nav_menu_item post', () => {
  const navigationResourceKey = 'row:["wp_posts","ID:2"]';
  const postmetaResourceKey = 'row:["wp_postmeta","meta_id:50"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local navigation item target',
    post_content: 'local-private-navigation-item-target-body',
    post_status: 'publish',
    post_type: 'nav_menu_item',
  };
  local.db.wp_postmeta = {
    'meta_id:50': {
      meta_id: 50,
      post_id: 1,
      meta_key: 'menu_item_parent',
      meta_value: 2,
    },
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === postmetaResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 3);
  assert.equal(mutationFor(plan, navigationResourceKey), undefined);
  assert.equal(mutationFor(plan, postmetaResourceKey).changeKind, 'create');
  assert.equal(blocker.class, 'missing-wordpress-graph-dependency');
  assert.equal(blocker.references[0].relationshipType, 'menu-item-parent-post');
  assert.equal(blocker.references[0].targetResourceKey, navigationResourceKey);
  assert.equal(
    JSON.stringify(blocker).includes('local-private-navigation-item-target-body'),
    false,
  );
});

test('blocks menu item parent metadata from a regular post when it targets a same-plan attachment', () => {
  const sourcePostResourceKey = 'row:["wp_posts","ID:2"]';
  const targetAttachmentResourceKey = 'row:["wp_posts","ID:3"]';
  const postmetaResourceKey = 'row:["wp_postmeta","meta_id:51"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local source post',
    post_content: 'local-private-source-post-body',
    post_status: 'publish',
    post_type: 'post',
  };
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local attachment target',
    post_content: 'local-private-attachment-target-body',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  local.db.wp_postmeta = {
    'meta_id:51': {
      meta_id: 51,
      post_id: 2,
      meta_key: 'menu_item_parent',
      meta_value: 3,
    },
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const sourceMutation = mutationFor(plan, sourcePostResourceKey);
  const targetMutation = mutationFor(plan, targetAttachmentResourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === postmetaResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 3);
  assert.equal(sourceMutation.changeKind, 'create');
  assert.equal(targetMutation.changeKind, 'create');
  assert.equal(mutationFor(plan, postmetaResourceKey).changeKind, 'create');
  assert.equal(blocker.class, 'missing-wordpress-graph-dependency');
  assert.equal(blocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
  assert.equal(blocker.references[0].relationshipType, 'menu-item-parent-post');
  assert.equal(blocker.references[0].targetResourceKey, targetAttachmentResourceKey);
  assert.equal(
    JSON.stringify(blocker).includes('local-private-source-post-body'),
    false,
  );
  assert.equal(
    JSON.stringify(blocker).includes('local-private-attachment-target-body'),
    false,
  );
});

test('blocks menu item parent metadata from a regular post when it targets a same-plan wp_navigation post', () => {
  const sourcePostResourceKey = 'row:["wp_posts","ID:2"]';
  const targetNavigationResourceKey = 'row:["wp_posts","ID:4"]';
  const postmetaResourceKey = 'row:["wp_postmeta","meta_id:55"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local source post',
    post_content: 'local-private-source-post-body',
    post_status: 'publish',
    post_type: 'post',
  };
  local.db.wp_posts['ID:4'] = {
    ID: 4,
    post_title: 'Local navigation target',
    post_content: 'local-private-navigation-target-body',
    post_status: 'publish',
    post_type: 'wp_navigation',
  };
  local.db.wp_postmeta = {
    'meta_id:55': {
      meta_id: 55,
      post_id: 2,
      meta_key: 'menu_item_parent',
      meta_value: 4,
    },
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const sourceMutation = mutationFor(plan, sourcePostResourceKey);
  const targetMutation = mutationFor(plan, targetNavigationResourceKey);
  const targetBlocker = plan.blockers.find((entry) => entry.resourceKey === targetNavigationResourceKey);
  const postmetaBlocker = plan.blockers.find((entry) => entry.resourceKey === postmetaResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(sourceMutation.changeKind, 'create');
  assert.equal(targetMutation, undefined);
  assert.equal(postmetaBlocker.class, 'missing-wordpress-graph-dependency');
  assert.equal(postmetaBlocker.references[0].relationshipType, 'menu-item-parent-post');
  assert.equal(postmetaBlocker.references[0].targetResourceKey, targetNavigationResourceKey);
  assert.equal(targetBlocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(targetBlocker.surface, 'wp_navigation');
  assert.equal(
    JSON.stringify(postmetaBlocker).includes('local-private-source-post-body'),
    false,
  );
  assert.equal(
    JSON.stringify(postmetaBlocker).includes('local-private-navigation-target-body'),
    false,
  );
  assert.equal(
    JSON.stringify(targetBlocker).includes('local-private-navigation-target-body'),
    false,
  );
  assert.throws(() => applyPlan(baseSite(), plan), /Refusing to apply/);
});

test('blocks menu item parent metadata from referencing a same-plan attachment even after same-plan graph hardening', () => {
  const resourceKey = 'row:["wp_postmeta","meta_id:53"]';
  const attachmentResourceKey = 'row:["wp_posts","ID:2"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local attachment target',
    post_content: 'local-private-attachment-target-body',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  local.db.wp_postmeta = {
    'meta_id:53': {
      meta_id: 53,
      post_id: 1,
      meta_key: 'menu_item_parent',
      meta_value: 2,
    },
  };

  const plan = planFor(base, local, baseSite());
  const blocker = plan.blockers.find((entry) => entry.resourceKey === resourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(mutationFor(plan, resourceKey).changeKind, 'create');
  assert.equal(mutationFor(plan, attachmentResourceKey).changeKind, 'create');
  assert.equal(blocker.class, 'missing-wordpress-graph-dependency');
  assert.equal(blocker.references[0].relationshipType, 'menu-item-parent-post');
  assert.equal(blocker.references[0].targetResourceKey, attachmentResourceKey);
  assert.equal(
    JSON.stringify(blocker).includes('local-private-attachment-target-body'),
    false,
  );
});

test('allows menu item parent metadata from a regular post to a same-plan post', () => {
  const sourcePostResourceKey = 'row:["wp_posts","ID:2"]';
  const targetPostResourceKey = 'row:["wp_posts","ID:3"]';
  const postmetaResourceKey = 'row:["wp_postmeta","meta_id:56"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local menu item owner',
    post_content: 'local-private-menu-item-owner-body',
    post_status: 'publish',
  };
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local menu parent target',
    post_content: 'local-private-menu-parent-target-body',
    post_status: 'publish',
  };
  local.db.wp_postmeta = {
    'meta_id:56': {
      meta_id: 56,
      post_id: 2,
      meta_key: 'menu_item_parent',
      meta_value: 3,
    },
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const sourceMutation = mutationFor(plan, sourcePostResourceKey);
  const targetMutation = mutationFor(plan, targetPostResourceKey);
  const postmetaMutation = mutationFor(plan, postmetaResourceKey);
  const reference = postmetaMutation.wordpressGraphReferences.find((entry) => entry.relationshipType === 'menu-item-parent-post');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(sourceMutation.changeKind, 'create');
  assert.equal(targetMutation.changeKind, 'create');
  assert.equal(postmetaMutation.changeKind, 'create');
  assert.deepEqual(postmetaMutation.dependsOnMutationIds, [sourceMutation.id, targetMutation.id]);
  assert.equal(reference.resolutionPolicy, 'same-plan-local-create');
  assert.equal(reference.relationshipKey, 'wp_postmeta.meta_value');
  assert.equal(reference.relationshipType, 'menu-item-parent-post');
  assert.equal(reference.targetResourceKey, targetPostResourceKey);
  assert.equal(JSON.stringify(reference).includes('local-private-menu-item-owner-body'), false);
  assert.equal(JSON.stringify(reference).includes('local-private-menu-parent-target-body'), false);

  const result = applyPlan(remote, plan);
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Local menu item owner');
  assert.equal(result.site.db.wp_posts['ID:3'].post_title, 'Local menu parent target');
  assert.equal(result.site.db.wp_postmeta['meta_id:56'].meta_value, 3);
});

test('blocks menu item parent metadata owned by an attachment even when it targets a same-plan post', () => {
  const resourceKey = 'row:["wp_postmeta","meta_id:54"]';
  const attachmentResourceKey = 'row:["wp_posts","ID:2"]';
  const targetResourceKey = 'row:["wp_posts","ID:3"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local attachment owner',
    post_content: 'local-private-attachment-owner-body',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local menu parent target',
    post_content: 'local-private-menu-parent-target-body',
    post_status: 'publish',
  };
  local.db.wp_postmeta = {
    'meta_id:54': {
      meta_id: 54,
      post_id: 2,
      meta_key: 'menu_item_parent',
      meta_value: 3,
    },
  };

  const plan = planFor(base, local, baseSite());
  const attachmentMutation = mutationFor(plan, attachmentResourceKey);
  const targetMutation = mutationFor(plan, targetResourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === resourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(attachmentMutation.changeKind, 'create');
  assert.equal(targetMutation.changeKind, 'create');
  assert.equal(mutationFor(plan, resourceKey), undefined);
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.surface, 'attachment');
  assert.equal(
    JSON.stringify(blocker).includes('local-private-attachment-owner-body'),
    false,
  );
  assert.equal(
    JSON.stringify(blocker).includes('local-private-menu-parent-target-body'),
    false,
  );
});

test('blocks a local thumbnail reference to a same-plan non-attachment post', () => {
  const targetResourceKey = 'row:["wp_posts","ID:2"]';
  const postmetaResourceKey = 'row:["wp_postmeta","meta_id:45"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local non-attachment target',
    post_content: 'local-private-post-body',
    post_status: 'publish',
    post_type: 'post',
  };
  local.db.wp_postmeta = {
    'meta_id:45': {
      meta_id: 45,
      post_id: 1,
      meta_key: '_thumbnail_id',
      meta_value: 2,
    },
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === postmetaResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(blocker.class, 'missing-wordpress-graph-dependency');
  assert.equal(blocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
  assert.equal(blocker.references[0].relationshipType, 'featured-image-attachment');
  assert.equal(blocker.references[0].targetResourceKey, targetResourceKey);
  assert.equal(blocker.references[0].targetChange.local.state, 'present');
  assert.equal(
    JSON.stringify(blocker).includes('local-private-post-body'),
    false,
  );
});

test('blocks a local thumbnail reference to a same-plan revision', () => {
  const targetResourceKey = 'row:["wp_posts","ID:2"]';
  const postmetaResourceKey = 'row:["wp_postmeta","meta_id:45"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local revision target',
    post_content: 'local-private-revision-target-body',
    post_status: 'inherit',
    post_type: 'revision',
  };
  local.db.wp_postmeta = {
    'meta_id:45': {
      meta_id: 45,
      post_id: 1,
      meta_key: '_thumbnail_id',
      meta_value: 2,
    },
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === postmetaResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutationFor(plan, targetResourceKey), undefined);
  assert.equal(mutationFor(plan, postmetaResourceKey).changeKind, 'create');
  assert.equal(blocker.class, 'missing-wordpress-graph-dependency');
  assert.equal(blocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
  assert.equal(blocker.references[0].relationshipType, 'featured-image-attachment');
  assert.equal(blocker.references[0].targetResourceKey, targetResourceKey);
  assert.equal(blocker.references[0].targetChange.local.state, 'present');
  assert.equal(
    JSON.stringify(blocker).includes('local-private-revision-target-body'),
    false,
  );
});

test('blocks a local thumbnail reference from an attachment to a same-plan attachment', () => {
  const targetResourceKey = 'row:["wp_posts","ID:3"]';
  const postmetaResourceKey = 'row:["wp_postmeta","meta_id:45"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local attachment source',
    post_content: 'local-private-attachment-source-body',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local attachment target',
    post_content: 'local-private-attachment-target-body',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  local.db.wp_postmeta = {
    'meta_id:45': {
      meta_id: 45,
      post_id: 2,
      meta_key: '_thumbnail_id',
      meta_value: 3,
    },
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === postmetaResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 2);
  assert.notEqual(mutationFor(plan, targetResourceKey), undefined);
  assert.equal(mutationFor(plan, postmetaResourceKey), undefined);
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.surface, 'attachment');
  assert.equal(
    JSON.stringify(blocker).includes('local-private-attachment-source-body'),
    false,
  );
  assert.equal(
    JSON.stringify(blocker).includes('local-private-attachment-target-body'),
    false,
  );
});

test('blocks a local thumbnail reference from an attachment to a same-plan non-attachment post', () => {
  const targetResourceKey = 'row:["wp_posts","ID:4"]';
  const postmetaResourceKey = 'row:["wp_postmeta","meta_id:46"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local attachment source',
    post_content: 'local-private-attachment-source-body',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  local.db.wp_posts['ID:4'] = {
    ID: 4,
    post_title: 'Local post target',
    post_content: 'local-private-post-target-body',
    post_status: 'publish',
    post_type: 'post',
  };
  local.db.wp_postmeta = {
    'meta_id:46': {
      meta_id: 46,
      post_id: 2,
      meta_key: '_thumbnail_id',
      meta_value: 4,
    },
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === postmetaResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.surface, 'attachment');
  assert.equal(
    JSON.stringify(blocker).includes('local-private-attachment-source-body'),
    false,
  );
  assert.equal(
    JSON.stringify(blocker).includes('local-private-post-target-body'),
    false,
  );
});

test('blocks a local thumbnail reference from an attachment to a same-plan revision', () => {
  const targetResourceKey = 'row:["wp_posts","ID:5"]';
  const postmetaResourceKey = 'row:["wp_postmeta","meta_id:48"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local attachment source',
    post_content: 'local-private-attachment-source-body',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  local.db.wp_posts['ID:5'] = {
    ID: 5,
    post_title: 'Local revision target',
    post_content: 'local-private-revision-target-body',
    post_status: 'inherit',
    post_type: 'revision',
  };
  local.db.wp_postmeta = {
    'meta_id:48': {
      meta_id: 48,
      post_id: 2,
      meta_key: '_thumbnail_id',
      meta_value: 5,
    },
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === postmetaResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.surface, 'attachment');
  assert.equal(
    JSON.stringify(blocker).includes('local-private-attachment-source-body'),
    false,
  );
  assert.equal(
    JSON.stringify(blocker).includes('local-private-revision-target-body'),
    false,
  );
});

test('blocks a local thumbnail reference to a same-plan wp_navigation post', () => {
  const navigationResourceKey = 'row:["wp_posts","ID:5"]';
  const postmetaResourceKey = 'row:["wp_postmeta","meta_id:49"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local thumbnail post',
    post_content: 'local-private-thumbnail-post-body',
    post_status: 'publish',
  };
  local.db.wp_posts['ID:5'] = {
    ID: 5,
    post_title: 'Local navigation target',
    post_content: 'local-private-navigation-target-body',
    post_status: 'publish',
    post_type: 'wp_navigation',
  };
  local.db.wp_postmeta = {
    'meta_id:49': {
      meta_id: 49,
      post_id: 2,
      meta_key: '_thumbnail_id',
      meta_value: 5,
    },
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === postmetaResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(mutationFor(plan, navigationResourceKey), undefined);
  assert.equal(blocker.class, 'missing-wordpress-graph-dependency');
  assert.equal(
    JSON.stringify(blocker).includes('local-private-thumbnail-post-body'),
    false,
  );
  assert.equal(
    JSON.stringify(blocker).includes('local-private-navigation-target-body'),
    false,
  );
});

test('blocks a local thumbnail reference owned by a navigation post even when it targets a same-plan attachment', () => {
  const sourceResourceKey = 'row:["wp_posts","ID:2"]';
  const targetResourceKey = 'row:["wp_posts","ID:4"]';
  const postmetaResourceKey = 'row:["wp_postmeta","meta_id:47"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local navigation post',
    post_content: 'local-private-navigation-post-body',
    post_status: 'publish',
    post_type: 'wp_navigation',
  };
  local.db.wp_posts['ID:4'] = {
    ID: 4,
    post_title: 'Local attachment target',
    post_content: 'local-private-attachment-target-body',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  local.db.wp_postmeta = {
    'meta_id:47': {
      meta_id: 47,
      post_id: 2,
      meta_key: '_thumbnail_id',
      meta_value: 4,
    },
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const targetMutation = mutationFor(plan, targetResourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === sourceResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(mutationFor(plan, sourceResourceKey), undefined);
  assert.equal(targetMutation.changeKind, 'create');
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.surface, 'wp_navigation');
  assert.equal(
    JSON.stringify(blocker).includes('local-private-navigation-post-body'),
    false,
  );
  assert.equal(
    JSON.stringify(blocker).includes('local-private-attachment-target-body'),
    false,
  );
});

test('allows a local attachment to reference a parent post created by the same plan', () => {
  const parentResourceKey = 'row:["wp_posts","ID:2"]';
  const attachmentResourceKey = 'row:["wp_posts","ID:3"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local parent post',
    post_content: 'local-private-parent-body',
    post_status: 'publish',
  };
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local attachment',
    post_content: 'local-private-attachment-body',
    post_status: 'inherit',
    post_type: 'attachment',
    post_parent: 2,
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const parentMutation = mutationFor(plan, parentResourceKey);
  const attachmentMutation = mutationFor(plan, attachmentResourceKey);
  const reference = attachmentMutation.wordpressGraphReferences[0];
  const referenceJson = JSON.stringify(reference);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(parentMutation.changeKind, 'create');
  assert.equal(attachmentMutation.changeKind, 'create');
  assert.ok(
    plan.mutations.indexOf(parentMutation) < plan.mutations.indexOf(attachmentMutation),
    'parent post create must be ordered before dependent attachment',
  );
  assert.deepEqual(attachmentMutation.dependsOnMutationIds, [parentMutation.id]);
  assert.equal(reference.resolutionPolicy, 'same-plan-local-create');
  assert.equal(reference.relationshipKey, 'wp_posts.post_parent');
  assert.equal(reference.relationshipType, 'post-parent');
  assert.equal(reference.targetResourceKey, parentResourceKey);
  assert.equal(reference.dependency.targetMutationId, parentMutation.id);
  assert.equal(reference.dependency.targetLocalHash, parentMutation.localHash);
  assert.equal(referenceJson.includes('local-private-parent-body'), false);
  assert.equal(referenceJson.includes('local-private-attachment-body'), false);

  const result = applyPlan(remote, plan);
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Local parent post');
  assert.equal(result.site.db.wp_posts['ID:3'].post_parent, 2);
  assert.equal(result.site.db.wp_posts['ID:3'].post_type, 'attachment');
});

test('blocks a local page parent reference to a same-plan attachment', () => {
  const attachmentResourceKey = 'row:["wp_posts","ID:2"]';
  const postResourceKey = 'row:["wp_posts","ID:3"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local attachment parent',
    post_content: 'local-private-attachment-parent-body',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local page child',
    post_content: 'local-private-page-child-body',
    post_status: 'publish',
    post_parent: 2,
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === postResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(mutationFor(plan, attachmentResourceKey).changeKind, 'create');
  assert.equal(mutationFor(plan, postResourceKey).changeKind, 'create');
  assert.equal(blocker.class, 'missing-wordpress-graph-dependency');
  assert.equal(blocker.references[0].relationshipType, 'post-parent');
  assert.equal(blocker.references[0].targetResourceKey, attachmentResourceKey);
  assert.equal(
    JSON.stringify(blocker).includes('local-private-attachment-parent-body'),
    false,
  );
  assert.equal(
    JSON.stringify(blocker).includes('local-private-page-child-body'),
    false,
  );
});

test('blocks a local non-attachment post parent reference to a same-plan revision', () => {
  const revisionResourceKey = 'row:["wp_posts","ID:2"]';
  const postResourceKey = 'row:["wp_posts","ID:3"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local revision parent',
    post_content: 'local-private-revision-parent-body',
    post_type: 'revision',
  };
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local page child',
    post_content: 'local-private-page-child-body',
    post_status: 'publish',
    post_parent: 2,
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === postResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutationFor(plan, revisionResourceKey), undefined);
  assert.equal(mutationFor(plan, postResourceKey).changeKind, 'create');
  assert.equal(blocker.class, 'missing-wordpress-graph-dependency');
  assert.equal(blocker.references[0].relationshipType, 'post-parent');
  assert.equal(blocker.references[0].targetResourceKey, revisionResourceKey);
  assert.equal(
    JSON.stringify(blocker).includes('local-private-revision-parent-body'),
    false,
  );
  assert.equal(
    JSON.stringify(blocker).includes('local-private-page-child-body'),
    false,
  );
});

test('blocks a local non-attachment post parent reference to a same-plan wp_navigation post', () => {
  const navigationResourceKey = 'row:["wp_posts","ID:2"]';
  const postResourceKey = 'row:["wp_posts","ID:3"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local navigation parent',
    post_content: 'local-private-navigation-parent-body',
    post_type: 'wp_navigation',
    post_status: 'publish',
  };
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local page child',
    post_content: 'local-private-page-child-body',
    post_status: 'publish',
    post_parent: 2,
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === postResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutationFor(plan, navigationResourceKey), undefined);
  assert.equal(mutationFor(plan, postResourceKey).changeKind, 'create');
  assert.equal(blocker.class, 'missing-wordpress-graph-dependency');
  assert.equal(blocker.references[0].relationshipType, 'post-parent');
  assert.equal(blocker.references[0].targetResourceKey, navigationResourceKey);
  assert.equal(
    JSON.stringify(blocker).includes('local-private-navigation-parent-body'),
    false,
  );
  assert.equal(
    JSON.stringify(blocker).includes('local-private-page-child-body'),
    false,
  );
});

test('blocks a local non-attachment post parent reference to a same-plan attachment', () => {
  const attachmentResourceKey = 'row:["wp_posts","ID:2"]';
  const postResourceKey = 'row:["wp_posts","ID:3"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local attachment parent',
    post_content: 'local-private-attachment-parent-body',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local child post',
    post_content: 'local-private-child-post-body',
    post_status: 'publish',
    post_parent: 2,
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const attachmentMutation = mutationFor(plan, attachmentResourceKey);
  const postMutation = mutationFor(plan, postResourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === postResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(attachmentMutation.changeKind, 'create');
  assert.equal(postMutation.changeKind, 'create');
  assert.equal(blocker.class, 'missing-wordpress-graph-dependency');
  assert.equal(blocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
  assert.equal(blocker.references[0].relationshipType, 'post-parent');
  assert.equal(blocker.references[0].targetResourceKey, attachmentResourceKey);
  assert.equal(
    JSON.stringify(blocker).includes('local-private-attachment-parent-body'),
    false,
  );
  assert.equal(
    JSON.stringify(blocker).includes('local-private-child-post-body'),
    false,
  );
});

test('blocks a local attachment parent reference to a same-plan wp_navigation post', () => {
  const navigationResourceKey = 'row:["wp_posts","ID:2"]';
  const attachmentResourceKey = 'row:["wp_posts","ID:3"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local navigation parent',
    post_content: 'local-private-navigation-parent-body',
    post_type: 'wp_navigation',
    post_status: 'publish',
  };
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local attachment child',
    post_content: 'local-private-attachment-child-body',
    post_status: 'inherit',
    post_type: 'attachment',
    post_parent: 2,
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === attachmentResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutationFor(plan, navigationResourceKey), undefined);
  assert.equal(mutationFor(plan, attachmentResourceKey).changeKind, 'create');
  assert.equal(blocker.class, 'missing-wordpress-graph-dependency');
  assert.equal(blocker.references[0].relationshipType, 'post-parent');
  assert.equal(blocker.references[0].targetResourceKey, navigationResourceKey);
  assert.equal(
    JSON.stringify(blocker).includes('local-private-navigation-parent-body'),
    false,
  );
  assert.equal(
    JSON.stringify(blocker).includes('local-private-attachment-child-body'),
    false,
  );
});

test('blocks a local postmeta reference to a same-plan attachment when it is not thumbnail metadata', () => {
  const resourceKey = 'row:["wp_postmeta","meta_id:46"]';
  const attachmentResourceKey = 'row:["wp_posts","ID:2"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local attachment target',
    post_content: 'local-private-attachment-body',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  local.db.wp_postmeta = {
    'meta_id:46': {
      meta_id: 46,
      post_id: 2,
      meta_key: 'attachment-note',
      meta_value: 'local-private-attachment-note',
    },
  };

  const plan = planFor(base, local, baseSite());
  const blocker = plan.blockers[0];

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.equal(blocker.surface, 'attachment');
  assert.equal(
    JSON.stringify(blocker).includes('local-private-attachment-note'),
    false,
  );
  assert.throws(() => applyPlan(baseSite(), plan), /Refusing to apply/);
});

test('blocks attachment-owned postmeta references to a same-plan attachment', () => {
  const resourceKey = 'row:["wp_postmeta","meta_id:47"]';
  const attachmentResourceKey = 'row:["wp_posts","ID:3"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local attachment owner',
    post_content: 'local-private-attachment-owner-body',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local target attachment',
    post_content: 'local-private-target-attachment-body',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  local.db.wp_postmeta = {
    'meta_id:47': {
      meta_id: 47,
      post_id: 2,
      meta_key: 'attachment-note',
      meta_value: 'local-private-attachment-note',
    },
  };

  const plan = planFor(base, local, baseSite());
  const blocker = plan.blockers.find((entry) => entry.resourceKey === resourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(mutationFor(plan, attachmentResourceKey).changeKind, 'create');
  assert.equal(mutationFor(plan, resourceKey), undefined);
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.surface, 'attachment');
  assert.equal(
    JSON.stringify(blocker).includes('local-private-attachment-owner-body'),
    false,
  );
  assert.equal(
    JSON.stringify(blocker).includes('local-private-target-attachment-body'),
    false,
  );
  assert.throws(() => applyPlan(baseSite(), plan), /Refusing to apply/);
});

test('blocks a local postmeta reference to a same-plan wp_navigation post', () => {
  const resourceKey = 'row:["wp_postmeta","meta_id:48"]';
  const navigationResourceKey = 'row:["wp_posts","ID:2"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local navigation target',
    post_content: 'local-private-navigation-target-body',
    post_status: 'publish',
    post_type: 'wp_navigation',
  };
  local.db.wp_postmeta = {
    'meta_id:48': {
      meta_id: 48,
      post_id: 1,
      meta_key: 'navigation-note',
      meta_value: 'local-private-navigation-note',
    },
  };

  const plan = planFor(base, local, baseSite());
  const blocker = plan.blockers.find((entry) => entry.resourceKey === navigationResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutationFor(plan, navigationResourceKey), undefined);
  assert.equal(mutationFor(plan, resourceKey).changeKind, 'create');
  assert.equal(blocker.resourceKey, navigationResourceKey);
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.surface, 'wp_navigation');
  assert.equal(
    JSON.stringify(blocker).includes('local-private-navigation-note'),
    false,
  );
  assert.throws(() => applyPlan(baseSite(), plan), /Refusing to apply/);
});

test('blocks menu item parent metadata owned by a navigation post even when it targets a same-plan post', () => {
  const resourceKey = 'row:["wp_postmeta","meta_id:49"]';
  const navigationResourceKey = 'row:["wp_posts","ID:2"]';
  const targetResourceKey = 'row:["wp_posts","ID:3"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local navigation item owner',
    post_content: 'local-private-navigation-item-owner-body',
    post_status: 'publish',
    post_type: 'nav_menu_item',
  };
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local menu parent target',
    post_content: 'local-private-menu-parent-target-body',
    post_status: 'publish',
  };
  local.db.wp_postmeta = {
    'meta_id:49': {
      meta_id: 49,
      post_id: 2,
      meta_key: 'menu_item_parent',
      meta_value: 3,
    },
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const navigationMutation = mutationFor(plan, navigationResourceKey);
  const targetMutation = mutationFor(plan, targetResourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === resourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(navigationMutation, undefined);
  assert.equal(targetMutation.changeKind, 'create');
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.surface, 'nav_menu_item');
  assert.equal(
    JSON.stringify(blocker).includes('local-private-navigation-item-owner-body'),
    false,
  );
  assert.equal(JSON.stringify(blocker).includes('local-private-menu-parent-target-body'), false);
});

test('blocks menu item parent metadata owned by a wp_navigation post even when it targets a same-plan post', () => {
  const resourceKey = 'row:["wp_postmeta","meta_id:50"]';
  const navigationResourceKey = 'row:["wp_posts","ID:4"]';
  const targetResourceKey = 'row:["wp_posts","ID:5"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:4'] = {
    ID: 4,
    post_title: 'Local wp_navigation owner',
    post_content: 'local-private-wp-navigation-owner-body',
    post_status: 'publish',
    post_type: 'wp_navigation',
  };
  local.db.wp_posts['ID:5'] = {
    ID: 5,
    post_title: 'Local menu parent target',
    post_content: 'local-private-menu-parent-target-body',
    post_status: 'publish',
  };
  local.db.wp_postmeta = {
    'meta_id:50': {
      meta_id: 50,
      post_id: 4,
      meta_key: 'menu_item_parent',
      meta_value: 5,
    },
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const navigationMutation = mutationFor(plan, navigationResourceKey);
  const targetMutation = mutationFor(plan, targetResourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === resourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(navigationMutation, undefined);
  assert.equal(targetMutation.changeKind, 'create');
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.surface, 'wp_navigation');
  assert.equal(
    JSON.stringify(blocker).includes('local-private-wp-navigation-owner-body'),
    false,
  );
  assert.equal(JSON.stringify(blocker).includes('local-private-menu-parent-target-body'), false);
});

test('blocks menu item parent metadata owned by a nav_menu_item post even when it targets a same-plan post', () => {
  const resourceKey = 'row:["wp_postmeta","meta_id:51"]';
  const navigationResourceKey = 'row:["wp_posts","ID:4"]';
  const targetResourceKey = 'row:["wp_posts","ID:5"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:4'] = {
    ID: 4,
    post_title: 'Local nav_menu_item owner',
    post_content: 'local-private-nav-menu-item-owner-body',
    post_status: 'publish',
    post_type: 'nav_menu_item',
  };
  local.db.wp_posts['ID:5'] = {
    ID: 5,
    post_title: 'Local menu parent target',
    post_content: 'local-private-menu-parent-target-body',
    post_status: 'publish',
  };
  local.db.wp_postmeta = {
    'meta_id:51': {
      meta_id: 51,
      post_id: 4,
      meta_key: 'menu_item_parent',
      meta_value: 5,
    },
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const navigationMutation = mutationFor(plan, navigationResourceKey);
  const targetMutation = mutationFor(plan, targetResourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === resourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(navigationMutation, undefined);
  assert.equal(targetMutation.changeKind, 'create');
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.surface, 'nav_menu_item');
  assert.equal(
    JSON.stringify(blocker).includes('local-private-nav-menu-item-owner-body'),
    false,
  );
  assert.equal(JSON.stringify(blocker).includes('local-private-menu-parent-target-body'), false);
});

test('blocks menu item parent metadata owned by a wp_navigation post even when it targets a same-plan attachment', () => {
  const resourceKey = 'row:["wp_postmeta","meta_id:52"]';
  const navigationResourceKey = 'row:["wp_posts","ID:4"]';
  const targetResourceKey = 'row:["wp_posts","ID:5"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:4'] = {
    ID: 4,
    post_title: 'Local wp_navigation owner',
    post_content: 'local-private-wp-navigation-owner-body',
    post_status: 'publish',
    post_type: 'wp_navigation',
  };
  local.db.wp_posts['ID:5'] = {
    ID: 5,
    post_title: 'Local attachment target',
    post_content: 'local-private-attachment-target-body',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  local.db.wp_postmeta = {
    'meta_id:52': {
      meta_id: 52,
      post_id: 4,
      meta_key: 'menu_item_parent',
      meta_value: 5,
    },
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const navigationMutation = mutationFor(plan, navigationResourceKey);
  const targetMutation = mutationFor(plan, targetResourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === resourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(navigationMutation, undefined);
  assert.equal(targetMutation.changeKind, 'create');
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.surface, 'wp_navigation');
  assert.equal(
    JSON.stringify(blocker).includes('local-private-wp-navigation-owner-body'),
    false,
  );
  assert.equal(JSON.stringify(blocker).includes('local-private-attachment-target-body'), false);
});

test('allows a local thumbnail reference to a same-plan attachment after postmeta hardening', () => {
  const attachmentResourceKey = 'row:["wp_posts","ID:2"]';
  const postmetaResourceKey = 'row:["wp_postmeta","meta_id:47"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local attachment',
    post_content: 'local-private-attachment-body',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  local.db.wp_postmeta = {
    'meta_id:47': {
      meta_id: 47,
      post_id: 1,
      meta_key: '_thumbnail_id',
      meta_value: 2,
    },
  };

  const plan = planFor(base, local, baseSite());
  const attachmentMutation = mutationFor(plan, attachmentResourceKey);
  const postmetaMutation = mutationFor(plan, postmetaResourceKey);
  const reference = postmetaMutation.wordpressGraphReferences[0];

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(attachmentMutation.changeKind, 'create');
  assert.equal(postmetaMutation.changeKind, 'create');
  assert.deepEqual(postmetaMutation.dependsOnMutationIds, [attachmentMutation.id]);
  assert.equal(reference.resolutionPolicy, 'same-plan-local-create');
  assert.equal(reference.relationshipType, 'featured-image-attachment');
  assert.equal(reference.targetResourceKey, attachmentResourceKey);
});

test('allows a local thumbnail reference to a same-plan attachment even when a remote navigation post exists', () => {
  const attachmentResourceKey = 'row:["wp_posts","ID:2"]';
  const postmetaResourceKey = 'row:["wp_postmeta","meta_id:47"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local attachment',
    post_content: 'local-private-attachment-body',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  local.db.wp_postmeta = {
    'meta_id:47': {
      meta_id: 47,
      post_id: 1,
      meta_key: '_thumbnail_id',
      meta_value: 2,
    },
  };
  const remote = baseSite();
  remote.db.wp_posts['ID:5'] = {
    ID: 5,
    post_title: 'Remote navigation post',
    post_content: 'remote-navigation-body',
    post_status: 'publish',
    post_type: 'wp_navigation',
  };

  const plan = planFor(base, local, remote);
  const attachmentMutation = mutationFor(plan, attachmentResourceKey);
  const postmetaMutation = mutationFor(plan, postmetaResourceKey);
  const reference = postmetaMutation.wordpressGraphReferences[0];

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(attachmentMutation.changeKind, 'create');
  assert.equal(postmetaMutation.changeKind, 'create');
  assert.deepEqual(postmetaMutation.dependsOnMutationIds, [attachmentMutation.id]);
  assert.equal(reference.resolutionPolicy, 'same-plan-local-create');
  assert.equal(reference.relationshipType, 'featured-image-attachment');
  assert.equal(reference.targetResourceKey, attachmentResourceKey);
  assert.equal(JSON.stringify(reference).includes('remote-navigation-body'), false);
});

test('allows a local attachment parent and thumbnail graph to resolve in the same plan', () => {
  const postResourceKey = 'row:["wp_posts","ID:1"]';
  const attachmentResourceKey = 'row:["wp_posts","ID:2"]';
  const postmetaResourceKey = 'row:["wp_postmeta","meta_id:47"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:1'] = {
    ID: 1,
    post_title: 'Local parent post',
    post_content: 'local-private-parent-post-body',
    post_status: 'publish',
  };
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local attachment child',
    post_content: 'local-private-attachment-child-body',
    post_status: 'inherit',
    post_type: 'attachment',
    post_parent: 1,
  };
  local.db.wp_postmeta = {
    'meta_id:47': {
      meta_id: 47,
      post_id: 1,
      meta_key: '_thumbnail_id',
      meta_value: 2,
    },
  };

  const plan = planFor(base, local, baseSite());
  const postMutation = mutationFor(plan, postResourceKey);
  const attachmentMutation = mutationFor(plan, attachmentResourceKey);
  const postmetaMutation = mutationFor(plan, postmetaResourceKey);
  const thumbnailReference = postmetaMutation.wordpressGraphReferences.find((entry) => entry.relationshipType === 'featured-image-attachment');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(postMutation.changeKind, 'create');
  assert.equal(attachmentMutation.changeKind, 'create');
  assert.equal(postmetaMutation.changeKind, 'create');
  assert.ok(
    plan.mutations.indexOf(postMutation) < plan.mutations.indexOf(attachmentMutation),
    'parent post create must be ordered before dependent attachment',
  );
  assert.ok(
    plan.mutations.indexOf(postMutation) < plan.mutations.indexOf(postmetaMutation),
    'parent post create must be ordered before dependent thumbnail metadata',
  );
  assert.ok(
    plan.mutations.indexOf(attachmentMutation) < plan.mutations.indexOf(postmetaMutation),
    'attachment create must be ordered before dependent thumbnail metadata',
  );
  assert.deepEqual(attachmentMutation.dependsOnMutationIds, [postMutation.id]);
  assert.deepEqual(postmetaMutation.dependsOnMutationIds.sort(), [postMutation.id, attachmentMutation.id].sort());
  assert.equal(thumbnailReference.resolutionPolicy, 'same-plan-local-create');
  assert.equal(thumbnailReference.relationshipType, 'featured-image-attachment');
  assert.equal(thumbnailReference.targetResourceKey, attachmentResourceKey);
  assert.equal(JSON.stringify(thumbnailReference).includes('local-private-parent-post-body'), false);
  assert.equal(JSON.stringify(thumbnailReference).includes('local-private-attachment-child-body'), false);

  const result = applyPlan(baseSite(), plan);
  assert.equal(result.site.db.wp_posts['ID:1'].post_title, 'Local parent post');
  assert.equal(result.site.db.wp_posts['ID:2'].post_parent, 1);
  assert.equal(result.site.db.wp_postmeta['meta_id:47'].meta_value, 2);
});

test('blocks a local thumbnail reference owned by an attachment even when it targets a same-plan attachment', () => {
  const sourceAttachmentResourceKey = 'row:["wp_posts","ID:1"]';
  const targetAttachmentResourceKey = 'row:["wp_posts","ID:2"]';
  const postmetaResourceKey = 'row:["wp_postmeta","meta_id:48"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:1'] = {
    ID: 1,
    post_title: 'Local source attachment',
    post_content: 'local-private-source-attachment-body',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local target attachment',
    post_content: 'local-private-target-attachment-body',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  local.db.wp_postmeta = {
    'meta_id:48': {
      meta_id: 48,
      post_id: 1,
      meta_key: '_thumbnail_id',
      meta_value: 2,
    },
  };

  const plan = planFor(base, local, baseSite());
  const sourceAttachmentMutation = mutationFor(plan, sourceAttachmentResourceKey);
  const targetAttachmentMutation = mutationFor(plan, targetAttachmentResourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === postmetaResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(sourceAttachmentMutation.changeKind, 'update');
  assert.equal(targetAttachmentMutation.changeKind, 'create');
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.surface, 'attachment');
  assert.equal(
    JSON.stringify(blocker).includes('local-private-source-attachment-body'),
    false,
  );
  assert.equal(
    JSON.stringify(blocker).includes('local-private-target-attachment-body'),
    false,
  );
  assert.throws(() => applyPlan(baseSite(), plan), /Refusing to apply/);
});

test('blocks a local attachment parent reference to a same-plan attachment', () => {
  const targetResourceKey = 'row:["wp_posts","ID:2"]';
  const attachmentResourceKey = 'row:["wp_posts","ID:3"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local attachment target',
    post_content: 'local-private-attachment-target-body',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local attachment child',
    post_content: 'local-private-attachment-child-body',
    post_status: 'inherit',
    post_type: 'attachment',
    post_parent: 2,
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === attachmentResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(blocker.class, 'missing-wordpress-graph-dependency');
  assert.equal(blocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
  assert.equal(blocker.references[0].relationshipType, 'post-parent');
  assert.equal(blocker.references[0].targetResourceKey, targetResourceKey);
  assert.equal(
    JSON.stringify(blocker).includes('local-private-attachment-target-body'),
    false,
  );
  assert.equal(
    JSON.stringify(blocker).includes('local-private-attachment-child-body'),
    false,
  );
});

test('allows a local attachment parent reference to a same-plan post', () => {
  const targetResourceKey = 'row:["wp_posts","ID:2"]';
  const attachmentResourceKey = 'row:["wp_posts","ID:3"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local parent post',
    post_content: 'local-private-parent-post-body',
    post_status: 'publish',
  };
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local attachment child',
    post_content: 'local-private-attachment-child-body',
    post_status: 'inherit',
    post_type: 'attachment',
    post_parent: 2,
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const targetMutation = mutationFor(plan, targetResourceKey);
  const attachmentMutation = mutationFor(plan, attachmentResourceKey);
  const reference = attachmentMutation.wordpressGraphReferences[0];

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(targetMutation.changeKind, 'create');
  assert.equal(attachmentMutation.changeKind, 'create');
  assert.deepEqual(attachmentMutation.dependsOnMutationIds, [targetMutation.id]);
  assert.equal(reference.resolutionPolicy, 'same-plan-local-create');
  assert.equal(reference.relationshipKey, 'wp_posts.post_parent');
  assert.equal(reference.relationshipType, 'post-parent');
  assert.equal(reference.targetResourceKey, targetResourceKey);
  assert.equal(
    JSON.stringify(reference).includes('local-private-parent-post-body'),
    false,
  );
  assert.equal(
    JSON.stringify(reference).includes('local-private-attachment-child-body'),
    false,
  );

  const result = applyPlan(remote, plan);
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Local parent post');
  assert.equal(result.site.db.wp_posts['ID:3'].post_parent, 2);
});

test('allows a local attachment parent reference to a same-plan post even when a remote navigation post exists', () => {
  const targetResourceKey = 'row:["wp_posts","ID:2"]';
  const attachmentResourceKey = 'row:["wp_posts","ID:3"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local parent post',
    post_content: 'local-private-parent-post-body',
    post_status: 'publish',
  };
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local attachment child',
    post_content: 'local-private-attachment-child-body',
    post_status: 'inherit',
    post_type: 'attachment',
    post_parent: 2,
  };
  const remote = baseSite();
  remote.db.wp_posts['ID:5'] = {
    ID: 5,
    post_title: 'Remote navigation post',
    post_content: 'remote-navigation-body',
    post_status: 'publish',
    post_type: 'wp_navigation',
  };

  const plan = planFor(base, local, remote);
  const targetMutation = mutationFor(plan, targetResourceKey);
  const attachmentMutation = mutationFor(plan, attachmentResourceKey);
  const reference = attachmentMutation.wordpressGraphReferences[0];

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(targetMutation.changeKind, 'create');
  assert.equal(attachmentMutation.changeKind, 'create');
  assert.deepEqual(attachmentMutation.dependsOnMutationIds, [targetMutation.id]);
  assert.equal(reference.resolutionPolicy, 'same-plan-local-create');
  assert.equal(reference.relationshipKey, 'wp_posts.post_parent');
  assert.equal(reference.relationshipType, 'post-parent');
  assert.equal(reference.targetResourceKey, targetResourceKey);
  assert.equal(
    JSON.stringify(reference).includes('remote-navigation-body'),
    false,
  );

  const result = applyPlan(remote, plan);
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Local parent post');
  assert.equal(result.site.db.wp_posts['ID:3'].post_parent, 2);
  assert.equal(result.site.db.wp_posts['ID:5'].post_type, 'wp_navigation');
});

test('blocks a local post parent reference to a same-plan attachment', () => {
  const parentResourceKey = 'row:["wp_posts","ID:2"]';
  const childResourceKey = 'row:["wp_posts","ID:3"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local attachment parent',
    post_content: 'local-private-attachment-parent-body',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local child post',
    post_content: 'local-private-child-body',
    post_status: 'publish',
    post_parent: 2,
  };

  const plan = planFor(base, local, baseSite());
  const parentMutation = mutationFor(plan, parentResourceKey);
  const childMutation = mutationFor(plan, childResourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === childResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(parentMutation.changeKind, 'create');
  assert.equal(childMutation.changeKind, 'create');
  assert.equal(blocker.class, 'missing-wordpress-graph-dependency');
  assert.equal(blocker.references[0].relationshipType, 'post-parent');
  assert.equal(blocker.references[0].targetResourceKey, parentResourceKey);
  assert.equal(
    JSON.stringify(blocker).includes('local-private-attachment-parent-body'),
    false,
  );
  assert.equal(
    JSON.stringify(blocker).includes('local-private-child-body'),
    false,
  );
});

test('blocks a local attachment parent reference to a same-plan revision', () => {
  const revisionResourceKey = 'row:["wp_posts","ID:2"]';
  const attachmentResourceKey = 'row:["wp_posts","ID:3"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local revision parent',
    post_content: 'local-private-revision-parent-body',
    post_type: 'revision',
  };
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local attachment child',
    post_content: 'local-private-attachment-child-body',
    post_status: 'inherit',
    post_type: 'attachment',
    post_parent: 2,
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === attachmentResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutationFor(plan, revisionResourceKey), undefined);
  assert.equal(mutationFor(plan, attachmentResourceKey).changeKind, 'create');
  assert.equal(blocker.class, 'missing-wordpress-graph-dependency');
  assert.equal(blocker.references[0].relationshipType, 'post-parent');
  assert.equal(blocker.references[0].targetResourceKey, revisionResourceKey);
  assert.equal(
    JSON.stringify(blocker).includes('local-private-revision-parent-body'),
    false,
  );
  assert.equal(
    JSON.stringify(blocker).includes('local-private-attachment-child-body'),
    false,
  );
});

test('blocks a local attachment parent reference to a same-plan wp_navigation post', () => {
  const navigationResourceKey = 'row:["wp_posts","ID:2"]';
  const attachmentResourceKey = 'row:["wp_posts","ID:3"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local navigation parent',
    post_content: 'local-private-navigation-parent-body',
    post_status: 'publish',
    post_type: 'wp_navigation',
  };
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local attachment child',
    post_content: 'local-private-attachment-child-body',
    post_status: 'inherit',
    post_type: 'attachment',
    post_parent: 2,
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === attachmentResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutationFor(plan, navigationResourceKey), undefined);
  assert.equal(mutationFor(plan, attachmentResourceKey).changeKind, 'create');
  assert.equal(blocker.class, 'missing-wordpress-graph-dependency');
  assert.equal(blocker.references[0].relationshipType, 'post-parent');
  assert.equal(blocker.references[0].targetResourceKey, navigationResourceKey);
  assert.equal(
    JSON.stringify(blocker).includes('local-private-navigation-parent-body'),
    false,
  );
  assert.equal(
    JSON.stringify(blocker).includes('local-private-attachment-child-body'),
    false,
  );
  assert.throws(() => applyPlan(baseSite(), plan), /Refusing to apply/);
});

test('blocks a local post parent reference to a same-plan wp_navigation post', () => {
  const navigationResourceKey = 'row:["wp_posts","ID:4"]';
  const postResourceKey = 'row:["wp_posts","ID:5"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:4'] = {
    ID: 4,
    post_title: 'Local navigation target',
    post_content: 'local-private-navigation-target-body',
    post_status: 'publish',
    post_type: 'wp_navigation',
  };
  local.db.wp_posts['ID:5'] = {
    ID: 5,
    post_title: 'Local post child',
    post_content: 'local-private-post-child-body',
    post_status: 'publish',
    post_parent: 4,
  };

  const plan = planFor(base, local, baseSite());
  const navigationBlocker = plan.blockers.find((entry) => entry.resourceKey === navigationResourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === postResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutationFor(plan, navigationResourceKey), undefined);
  assert.equal(mutationFor(plan, postResourceKey).changeKind, 'create');
  assert.equal(navigationBlocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(navigationBlocker.surface, 'wp_navigation');
  assert.equal(blocker.class, 'missing-wordpress-graph-dependency');
  assert.equal(blocker.references[0].relationshipType, 'post-parent');
  assert.equal(blocker.references[0].targetResourceKey, navigationResourceKey);
  assert.equal(JSON.stringify(blocker).includes('local-private-navigation-target-body'), false);
  assert.equal(JSON.stringify(blocker).includes('local-private-post-child-body'), false);
  assert.throws(() => applyPlan(baseSite(), plan), /Refusing to apply/);
});

test('blocks a local post parent reference to a same-plan attachment', () => {
  const attachmentResourceKey = 'row:["wp_posts","ID:6"]';
  const postResourceKey = 'row:["wp_posts","ID:7"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:6'] = {
    ID: 6,
    post_title: 'Local attachment parent',
    post_content: 'local-private-attachment-parent-body',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  local.db.wp_posts['ID:7'] = {
    ID: 7,
    post_title: 'Local post child',
    post_content: 'local-private-post-child-body',
    post_status: 'publish',
    post_parent: 6,
  };

  const plan = planFor(base, local, baseSite());
  const attachmentBlocker = plan.blockers.find((entry) => entry.resourceKey === attachmentResourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === postResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(mutationFor(plan, attachmentResourceKey).changeKind, 'create');
  assert.equal(mutationFor(plan, postResourceKey).changeKind, 'create');
  assert.equal(attachmentBlocker, undefined);
  assert.equal(blocker.class, 'missing-wordpress-graph-dependency');
  assert.equal(blocker.references[0].relationshipType, 'post-parent');
  assert.equal(blocker.references[0].targetResourceKey, attachmentResourceKey);
  assert.equal(JSON.stringify(blocker).includes('local-private-attachment-parent-body'), false);
  assert.equal(JSON.stringify(blocker).includes('local-private-post-child-body'), false);
});

test('allows term taxonomy and relationships to reference same-plan terms and posts', () => {
  const termResourceKey = 'row:["wp_terms","term_id:7"]';
  const taxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:9"]';
  const postResourceKey = 'row:["wp_posts","ID:3"]';
  const relationshipResourceKey = 'row:["wp_term_relationships","object_id:3|term_taxonomy_id:9"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_terms = {
    'term_id:7': {
      term_id: 7,
      name: 'Local taxonomy term',
      slug: 'local-taxonomy-term',
    },
  };
  local.db.wp_term_taxonomy = {
    'term_taxonomy_id:9': {
      term_taxonomy_id: 9,
      term_id: 7,
      taxonomy: 'category',
      description: '',
      parent: 0,
      count: 1,
    },
  };
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local tagged post',
    post_content: 'local-private-tagged-body',
    post_status: 'publish',
  };
  local.db.wp_term_relationships = {
    'object_id:3|term_taxonomy_id:9': {
      object_id: 3,
      term_taxonomy_id: 9,
      term_order: 0,
    },
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const termMutation = mutationFor(plan, termResourceKey);
  const taxonomyMutation = mutationFor(plan, taxonomyResourceKey);
  const postMutation = mutationFor(plan, postResourceKey);
  const relationshipMutation = mutationFor(plan, relationshipResourceKey);
  const references = relationshipMutation.wordpressGraphReferences;
  const relationshipReferenceTypes = references.map((reference) => reference.relationshipType).sort();

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(termMutation.changeKind, 'create');
  assert.equal(taxonomyMutation.changeKind, 'create');
  assert.equal(postMutation.changeKind, 'create');
  assert.equal(relationshipMutation.changeKind, 'create');
  assert.ok(
    plan.mutations.indexOf(termMutation) < plan.mutations.indexOf(taxonomyMutation),
    'term create must be ordered before dependent taxonomy',
  );
  assert.ok(
    plan.mutations.indexOf(taxonomyMutation) < plan.mutations.indexOf(relationshipMutation),
    'taxonomy create must be ordered before dependent relationship',
  );
  assert.ok(
    plan.mutations.indexOf(postMutation) < plan.mutations.indexOf(relationshipMutation),
    'post create must be ordered before dependent relationship',
  );
  assert.deepEqual(taxonomyMutation.dependsOnMutationIds, [termMutation.id]);
  assert.deepEqual(
    relationshipMutation.dependsOnMutationIds.slice().sort(),
    [postMutation.id, taxonomyMutation.id].sort(),
  );
  assert.deepEqual(relationshipReferenceTypes, [
    'term-relationship-object',
    'term-relationship-taxonomy',
  ]);
  assert.equal(
    references.find((reference) => reference.relationshipType === 'term-relationship-object').targetResourceKey,
    postResourceKey,
  );
  assert.equal(
    references.find((reference) => reference.relationshipType === 'term-relationship-taxonomy').targetResourceKey,
    taxonomyResourceKey,
  );
  assert.equal(references[0].resolutionPolicy, 'same-plan-local-create');
  assert.equal(
    references.some((reference) => reference.relationshipType === 'term-relationship-object'),
    true,
  );
  assert.equal(
    references.some((reference) => reference.relationshipType === 'term-relationship-taxonomy'),
    true,
  );

  const result = applyPlan(remote, plan);
  assert.equal(result.site.db.wp_terms['term_id:7'].name, 'Local taxonomy term');
  assert.equal(result.site.db.wp_term_taxonomy['term_taxonomy_id:9'].term_id, 7);
  assert.equal(result.site.db.wp_term_relationships['object_id:3|term_taxonomy_id:9'].object_id, 3);
  assert.equal(result.site.db.wp_term_relationships['object_id:3|term_taxonomy_id:9'].term_taxonomy_id, 9);
});

test('allows a term taxonomy parent to reference a term created by the same plan', () => {
  const parentTermResourceKey = 'row:["wp_terms","term_id:7"]';
  const childTaxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:9"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_terms = {
    'term_id:7': {
      term_id: 7,
      name: 'Local parent term',
      slug: 'local-parent-term',
    },
  };
  local.db.wp_term_taxonomy = {
    'term_taxonomy_id:9': {
      term_taxonomy_id: 9,
      term_id: 7,
      taxonomy: 'category',
      description: '',
      parent: 7,
      count: 0,
    },
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const termMutation = mutationFor(plan, parentTermResourceKey);
  const taxonomyMutation = mutationFor(plan, childTaxonomyResourceKey);
  const reference = taxonomyMutation.wordpressGraphReferences.find((entry) => entry.relationshipType === 'term-taxonomy-parent');
  const referenceJson = JSON.stringify(reference);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(termMutation.changeKind, 'create');
  assert.equal(taxonomyMutation.changeKind, 'create');
  assert.deepEqual(taxonomyMutation.dependsOnMutationIds, [termMutation.id]);
  assert.ok(
    plan.mutations.indexOf(termMutation) < plan.mutations.indexOf(taxonomyMutation),
    'parent term create must be ordered before dependent term taxonomy',
  );
  assert.equal(reference.resolutionPolicy, 'same-plan-local-create');
  assert.equal(reference.relationshipKey, 'wp_term_taxonomy.parent');
  assert.equal(reference.relationshipType, 'term-taxonomy-parent');
  assert.equal(reference.targetResourceKey, parentTermResourceKey);
  assert.equal(referenceJson.includes('local-parent-term'), false);
  assert.equal(
    taxonomyMutation.wordpressGraphReferences.some((entry) => entry.relationshipType === 'term-taxonomy-parent'),
    true,
  );

  const result = applyPlan(remote, plan);
  assert.equal(result.site.db.wp_terms['term_id:7'].name, 'Local parent term');
  assert.equal(result.site.db.wp_term_taxonomy['term_taxonomy_id:9'].parent, 7);
});

test('allows a term taxonomy parent to reference a term created by the same plan even when a remote nav menu taxonomy exists', () => {
  const parentTermResourceKey = 'row:["wp_terms","term_id:7"]';
  const childTaxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:9"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_terms = {
    'term_id:7': {
      term_id: 7,
      name: 'Local parent term',
      slug: 'local-parent-term',
    },
  };
  local.db.wp_term_taxonomy = {
    'term_taxonomy_id:9': {
      term_taxonomy_id: 9,
      term_id: 7,
      taxonomy: 'category',
      description: '',
      parent: 7,
      count: 0,
    },
  };
  const remote = baseSite();
  remote.db.wp_terms = {
    'term_id:21': {
      term_id: 21,
      name: 'Remote navigation term',
      slug: 'remote-navigation-term',
    },
  };
  remote.db.wp_term_taxonomy = {
    'term_taxonomy_id:10': {
      term_taxonomy_id: 10,
      term_id: 21,
      taxonomy: 'nav_menu',
      description: '',
      parent: 0,
      count: 0,
    },
  };

  const plan = planFor(base, local, remote);
  const termMutation = mutationFor(plan, parentTermResourceKey);
  const taxonomyMutation = mutationFor(plan, childTaxonomyResourceKey);
  const reference = taxonomyMutation.wordpressGraphReferences.find((entry) => entry.relationshipType === 'term-taxonomy-parent');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(termMutation.changeKind, 'create');
  assert.equal(taxonomyMutation.changeKind, 'create');
  assert.equal(reference.resolutionPolicy, 'same-plan-local-create');
  assert.equal(reference.relationshipKey, 'wp_term_taxonomy.parent');
  assert.equal(reference.relationshipType, 'term-taxonomy-parent');
  assert.equal(reference.targetResourceKey, parentTermResourceKey);
  assert.equal(
    JSON.stringify(reference).includes('remote-navigation-term'),
    false,
  );
});

test('allows a term taxonomy to reference its same-plan term through the term relationship edge', () => {
  const termResourceKey = 'row:["wp_terms","term_id:7"]';
  const taxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:9"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_terms = {
    'term_id:7': {
      term_id: 7,
      name: 'Local taxonomy term',
      slug: 'local-taxonomy-term',
    },
  };
  local.db.wp_term_taxonomy = {
    'term_taxonomy_id:9': {
      term_taxonomy_id: 9,
      term_id: 7,
      taxonomy: 'category',
      description: '',
      parent: 0,
      count: 0,
    },
  };

  const plan = planFor(base, local, baseSite());
  const termMutation = mutationFor(plan, termResourceKey);
  const taxonomyMutation = mutationFor(plan, taxonomyResourceKey);
  const reference = taxonomyMutation.wordpressGraphReferences.find((entry) => entry.relationshipType === 'term-taxonomy-term');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(termMutation.changeKind, 'create');
  assert.equal(taxonomyMutation.changeKind, 'create');
  assert.deepEqual(taxonomyMutation.dependsOnMutationIds, [termMutation.id]);
  assert.equal(reference.resolutionPolicy, 'same-plan-local-create');
  assert.equal(reference.relationshipKey, 'wp_term_taxonomy.term_id');
  assert.equal(reference.relationshipType, 'term-taxonomy-term');
  assert.equal(reference.targetResourceKey, termResourceKey);
});

test('blocks a term taxonomy parent reference when the same-plan target term also has a nav menu taxonomy row', () => {
  const parentTermResourceKey = 'row:["wp_terms","term_id:7"]';
  const childTaxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:9"]';
  const navMenuTaxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:10"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_terms = {
    'term_id:7': {
      term_id: 7,
      name: 'Local navigation term',
      slug: 'local-navigation-term',
    },
  };
  local.db.wp_term_taxonomy = {
    'term_taxonomy_id:9': {
      term_taxonomy_id: 9,
      term_id: 7,
      taxonomy: 'category',
      description: '',
      parent: 7,
      count: 0,
    },
    'term_taxonomy_id:10': {
      term_taxonomy_id: 10,
      term_id: 7,
      taxonomy: 'nav_menu',
      description: '',
      parent: 0,
      count: 0,
    },
  };

  const plan = planFor(base, local, baseSite());
  const termMutation = mutationFor(plan, parentTermResourceKey);
  const taxonomyMutation = mutationFor(plan, childTaxonomyResourceKey);
  const navMenuTaxonomyMutation = mutationFor(plan, navMenuTaxonomyResourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === navMenuTaxonomyResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(termMutation.changeKind, 'create');
  assert.equal(taxonomyMutation.changeKind, 'create');
  assert.equal(navMenuTaxonomyMutation, undefined);
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.surface, 'nav_menu');
  assert.equal(JSON.stringify(blocker).includes('local-navigation-term'), false);
});

test('allows a term taxonomy term reference to a term created by the same plan', () => {
  const termResourceKey = 'row:["wp_terms","term_id:7"]';
  const taxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:9"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_terms = {
    'term_id:7': {
      term_id: 7,
      name: 'Local taxonomy term',
      slug: 'local-taxonomy-term',
    },
  };
  local.db.wp_term_taxonomy = {
    'term_taxonomy_id:9': {
      term_taxonomy_id: 9,
      term_id: 7,
      taxonomy: 'category',
      description: '',
      parent: 0,
      count: 0,
    },
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const termMutation = mutationFor(plan, termResourceKey);
  const taxonomyMutation = mutationFor(plan, taxonomyResourceKey);
  const reference = taxonomyMutation.wordpressGraphReferences.find((entry) => entry.relationshipType === 'term-taxonomy-term');
  const referenceJson = JSON.stringify(reference);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(termMutation.changeKind, 'create');
  assert.equal(taxonomyMutation.changeKind, 'create');
  assert.deepEqual(taxonomyMutation.dependsOnMutationIds, [termMutation.id]);
  assert.ok(
    plan.mutations.indexOf(termMutation) < plan.mutations.indexOf(taxonomyMutation),
    'term create must be ordered before dependent term taxonomy',
  );
  assert.equal(reference.resolutionPolicy, 'same-plan-local-create');
  assert.equal(reference.relationshipKey, 'wp_term_taxonomy.term_id');
  assert.equal(reference.relationshipType, 'term-taxonomy-term');
  assert.equal(reference.targetResourceKey, termResourceKey);
  assert.equal(referenceJson.includes('local-taxonomy-term'), false);
  assert.equal(
    taxonomyMutation.wordpressGraphReferences.some((entry) => entry.relationshipType === 'term-taxonomy-term'),
    true,
  );

  const result = applyPlan(remote, plan);
  assert.equal(result.site.db.wp_terms['term_id:7'].name, 'Local taxonomy term');
  assert.equal(result.site.db.wp_term_taxonomy['term_taxonomy_id:9'].term_id, 7);
});

test('allows a term taxonomy term reference to a term created by the same plan even when a remote nav menu taxonomy exists', () => {
  const termResourceKey = 'row:["wp_terms","term_id:7"]';
  const taxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:9"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_terms = {
    'term_id:7': {
      term_id: 7,
      name: 'Local taxonomy term',
      slug: 'local-taxonomy-term',
    },
  };
  local.db.wp_term_taxonomy = {
    'term_taxonomy_id:9': {
      term_taxonomy_id: 9,
      term_id: 7,
      taxonomy: 'category',
      description: '',
      parent: 0,
      count: 0,
    },
  };
  const remote = baseSite();
  remote.db.wp_terms = {
    'term_id:21': {
      term_id: 21,
      name: 'Remote navigation term',
      slug: 'remote-navigation-term',
    },
  };
  remote.db.wp_term_taxonomy = {
    'term_taxonomy_id:10': {
      term_taxonomy_id: 10,
      term_id: 21,
      taxonomy: 'nav_menu',
      description: '',
      parent: 0,
      count: 0,
    },
  };

  const plan = planFor(base, local, remote);
  const termMutation = mutationFor(plan, termResourceKey);
  const taxonomyMutation = mutationFor(plan, taxonomyResourceKey);
  const reference = taxonomyMutation.wordpressGraphReferences.find((entry) => entry.relationshipType === 'term-taxonomy-term');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(termMutation.changeKind, 'create');
  assert.equal(taxonomyMutation.changeKind, 'create');
  assert.deepEqual(taxonomyMutation.dependsOnMutationIds, [termMutation.id]);
  assert.equal(reference.resolutionPolicy, 'same-plan-local-create');
  assert.equal(reference.relationshipKey, 'wp_term_taxonomy.term_id');
  assert.equal(reference.relationshipType, 'term-taxonomy-term');
  assert.equal(reference.targetResourceKey, termResourceKey);
  assert.equal(JSON.stringify(reference).includes('remote-navigation-term'), false);
});

test('blocks a local term taxonomy term reference when the same-plan term belongs to a nav menu taxonomy', () => {
  const termResourceKey = 'row:["wp_terms","term_id:7"]';
  const taxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:9"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_terms = {
    'term_id:7': {
      term_id: 7,
      name: 'Local navigation term',
      slug: 'local-navigation-term',
    },
  };
  local.db.wp_term_taxonomy = {
    'term_taxonomy_id:9': {
      term_taxonomy_id: 9,
      term_id: 7,
      taxonomy: 'nav_menu',
      description: '',
      parent: 0,
      count: 0,
    },
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const termMutation = mutationFor(plan, termResourceKey);
  const taxonomyMutation = mutationFor(plan, taxonomyResourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === taxonomyResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(termMutation.changeKind, 'create');
  assert.equal(taxonomyMutation, undefined);
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.surface, 'nav_menu');
  assert.equal(
    JSON.stringify(blocker).includes('local-navigation-term'),
    false,
  );
});

test('blocks a local term taxonomy parent reference when the same-plan term belongs to a nav menu taxonomy', () => {
  const termResourceKey = 'row:["wp_terms","term_id:7"]';
  const taxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:9"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_terms = {
    'term_id:7': {
      term_id: 7,
      name: 'Local navigation parent term',
      slug: 'local-navigation-parent-term',
    },
  };
  local.db.wp_term_taxonomy = {
    'term_taxonomy_id:9': {
      term_taxonomy_id: 9,
      term_id: 7,
      taxonomy: 'nav_menu',
      description: '',
      parent: 7,
      count: 0,
    },
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const termMutation = mutationFor(plan, termResourceKey);
  const taxonomyMutation = mutationFor(plan, taxonomyResourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === taxonomyResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(termMutation.changeKind, 'create');
  assert.equal(taxonomyMutation, undefined);
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.surface, 'nav_menu');
  assert.equal(
    JSON.stringify(blocker).includes('local-navigation-parent-term'),
    false,
  );
});

test('allows a term relationship taxonomy reference to a term taxonomy created by the same plan', () => {
  const postResourceKey = 'row:["wp_posts","ID:3"]';
  const termResourceKey = 'row:["wp_terms","term_id:7"]';
  const taxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:9"]';
  const relationshipResourceKey = 'row:["wp_term_relationships","object_id:3|term_taxonomy_id:9"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local taxonomy object post',
    post_content: 'local-private-taxonomy-object-body',
    post_status: 'publish',
  };
  local.db.wp_terms = {
    'term_id:7': {
      term_id: 7,
      name: 'Local relationship term',
      slug: 'local-relationship-term',
    },
  };
  local.db.wp_term_taxonomy = {
    'term_taxonomy_id:9': {
      term_taxonomy_id: 9,
      term_id: 7,
      taxonomy: 'category',
      description: '',
      parent: 0,
      count: 0,
    },
  };
  local.db.wp_term_relationships = {
    'object_id:3|term_taxonomy_id:9': {
      object_id: 3,
      term_taxonomy_id: 9,
      term_order: 0,
    },
  };

  const plan = planFor(base, local, baseSite());
  const postMutation = mutationFor(plan, postResourceKey);
  const termMutation = mutationFor(plan, termResourceKey);
  const taxonomyMutation = mutationFor(plan, taxonomyResourceKey);
  const relationshipMutation = mutationFor(plan, relationshipResourceKey);
  const reference = relationshipMutation.wordpressGraphReferences.find((entry) => entry.relationshipType === 'term-relationship-taxonomy');

  assert.equal(plan.status, 'ready');
  assert.equal(postMutation.changeKind, 'create');
  assert.equal(termMutation.changeKind, 'create');
  assert.equal(taxonomyMutation.changeKind, 'create');
  assert.equal(relationshipMutation.changeKind, 'create');
  assert.deepEqual(relationshipMutation.dependsOnMutationIds, [postMutation.id, taxonomyMutation.id]);
  assert.equal(reference.resolutionPolicy, 'same-plan-local-create');
  assert.equal(reference.relationshipKey, 'wp_term_relationships.term_taxonomy_id');
  assert.equal(reference.relationshipType, 'term-relationship-taxonomy');
  assert.equal(reference.targetResourceKey, taxonomyResourceKey);
  assert.equal(reference.dependency.targetMutationId, taxonomyMutation.id);
  assert.equal(JSON.stringify(reference).includes('local-private-taxonomy-object-body'), false);
  assert.equal(JSON.stringify(reference).includes('local-relationship-term'), false);
  assert.equal(JSON.stringify(reference).includes('Local taxonomy object post'), false);
});

test('allows a local term relationship object reference to a same-plan post even when a remote navigation post exists', () => {
  const postResourceKey = 'row:["wp_posts","ID:3"]';
  const termResourceKey = 'row:["wp_terms","term_id:7"]';
  const taxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:9"]';
  const relationshipResourceKey = 'row:["wp_term_relationships","object_id:3|term_taxonomy_id:9"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local taxonomy object post',
    post_content: 'local-private-taxonomy-object-body',
    post_status: 'publish',
  };
  local.db.wp_terms = {
    'term_id:7': {
      term_id: 7,
      name: 'Local relationship term',
      slug: 'local-relationship-term',
    },
  };
  local.db.wp_term_taxonomy = {
    'term_taxonomy_id:9': {
      term_taxonomy_id: 9,
      term_id: 7,
      taxonomy: 'category',
      description: '',
      parent: 0,
      count: 0,
    },
  };
  local.db.wp_term_relationships = {
    'object_id:3|term_taxonomy_id:9': {
      object_id: 3,
      term_taxonomy_id: 9,
      term_order: 0,
    },
  };
  const remote = baseSite();
  remote.db.wp_posts['ID:9'] = {
    ID: 9,
    post_title: 'Remote navigation post',
    post_content: 'remote-navigation-body',
    post_status: 'publish',
    post_type: 'wp_navigation',
  };

  const plan = planFor(base, local, remote);
  const postMutation = mutationFor(plan, postResourceKey);
  const termMutation = mutationFor(plan, termResourceKey);
  const taxonomyMutation = mutationFor(plan, taxonomyResourceKey);
  const relationshipMutation = mutationFor(plan, relationshipResourceKey);
  const reference = relationshipMutation.wordpressGraphReferences.find((entry) => entry.relationshipType === 'term-relationship-object');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(postMutation.changeKind, 'create');
  assert.equal(termMutation.changeKind, 'create');
  assert.equal(taxonomyMutation.changeKind, 'create');
  assert.equal(relationshipMutation.changeKind, 'create');
  assert.ok(
    plan.mutations.indexOf(postMutation) < plan.mutations.indexOf(relationshipMutation),
    'owning post create must be ordered before dependent term relationship',
  );
  assert.ok(
    plan.mutations.indexOf(taxonomyMutation) < plan.mutations.indexOf(relationshipMutation),
    'term taxonomy create must be ordered before dependent term relationship',
  );
  assert.deepEqual(relationshipMutation.dependsOnMutationIds.sort(), [postMutation.id, taxonomyMutation.id].sort());
  assert.equal(reference.resolutionPolicy, 'same-plan-local-create');
  assert.equal(reference.relationshipKey, 'wp_term_relationships.object_id');
  assert.equal(reference.relationshipType, 'term-relationship-object');
  assert.equal(reference.targetResourceKey, postResourceKey);
  assert.equal(JSON.stringify(reference).includes('local-private-taxonomy-object-body'), false);
  assert.equal(JSON.stringify(reference).includes('remote-navigation-body'), false);
});

test('allows a local term relationship taxonomy reference to a same-plan term taxonomy even when a remote nav menu taxonomy exists', () => {
  const postResourceKey = 'row:["wp_posts","ID:3"]';
  const termResourceKey = 'row:["wp_terms","term_id:7"]';
  const taxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:9"]';
  const relationshipResourceKey = 'row:["wp_term_relationships","object_id:3|term_taxonomy_id:9"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local taxonomy object post',
    post_content: 'local-private-taxonomy-object-body',
    post_status: 'publish',
  };
  local.db.wp_terms = {
    'term_id:7': {
      term_id: 7,
      name: 'Local relationship term',
      slug: 'local-relationship-term',
    },
  };
  local.db.wp_term_taxonomy = {
    'term_taxonomy_id:9': {
      term_taxonomy_id: 9,
      term_id: 7,
      taxonomy: 'category',
      description: '',
      parent: 0,
      count: 0,
    },
  };
  local.db.wp_term_relationships = {
    'object_id:3|term_taxonomy_id:9': {
      object_id: 3,
      term_taxonomy_id: 9,
      term_order: 0,
    },
  };
  const remote = baseSite();
  remote.db.wp_terms = {
    'term_id:21': {
      term_id: 21,
      name: 'Remote navigation term',
      slug: 'remote-navigation-term',
    },
  };
  remote.db.wp_term_taxonomy = {
    'term_taxonomy_id:10': {
      term_taxonomy_id: 10,
      term_id: 21,
      taxonomy: 'nav_menu',
      description: '',
      parent: 0,
      count: 0,
    },
  };

  const plan = planFor(base, local, remote);
  const postMutation = mutationFor(plan, postResourceKey);
  const termMutation = mutationFor(plan, termResourceKey);
  const taxonomyMutation = mutationFor(plan, taxonomyResourceKey);
  const relationshipMutation = mutationFor(plan, relationshipResourceKey);
  const reference = relationshipMutation.wordpressGraphReferences.find((entry) => entry.relationshipType === 'term-relationship-taxonomy');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(postMutation.changeKind, 'create');
  assert.equal(termMutation.changeKind, 'create');
  assert.equal(taxonomyMutation.changeKind, 'create');
  assert.equal(relationshipMutation.changeKind, 'create');
  assert.ok(
    plan.mutations.indexOf(taxonomyMutation) < plan.mutations.indexOf(relationshipMutation),
    'term taxonomy create must be ordered before dependent term relationship',
  );
  assert.deepEqual(relationshipMutation.dependsOnMutationIds.sort(), [postMutation.id, taxonomyMutation.id].sort());
  assert.equal(reference.resolutionPolicy, 'same-plan-local-create');
  assert.equal(reference.relationshipKey, 'wp_term_relationships.term_taxonomy_id');
  assert.equal(reference.relationshipType, 'term-relationship-taxonomy');
  assert.equal(reference.targetResourceKey, taxonomyResourceKey);
  assert.equal(JSON.stringify(reference).includes('remote-navigation-term'), false);
});

test('blocks a local term relationship when the same-plan term taxonomy is a nav menu', () => {
  const postResourceKey = 'row:["wp_posts","ID:3"]';
  const termResourceKey = 'row:["wp_terms","term_id:7"]';
  const taxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:9"]';
  const relationshipResourceKey = 'row:["wp_term_relationships","object_id:3|term_taxonomy_id:9"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local taxonomy object post',
    post_content: 'local-private-taxonomy-object-body',
    post_status: 'publish',
  };
  local.db.wp_terms = {
    'term_id:7': {
      term_id: 7,
      name: 'Local navigation term',
      slug: 'local-navigation-term',
    },
  };
  local.db.wp_term_taxonomy = {
    'term_taxonomy_id:9': {
      term_taxonomy_id: 9,
      term_id: 7,
      taxonomy: 'nav_menu',
      description: '',
      parent: 0,
      count: 0,
    },
  };
  local.db.wp_term_relationships = {
    'object_id:3|term_taxonomy_id:9': {
      object_id: 3,
      term_taxonomy_id: 9,
      term_order: 0,
    },
  };

  const plan = planFor(base, local, baseSite());
  const postMutation = mutationFor(plan, postResourceKey);
  const termMutation = mutationFor(plan, termResourceKey);
  const taxonomyMutation = mutationFor(plan, taxonomyResourceKey);
  const relationshipBlocker = plan.blockers.find((entry) => entry.resourceKey === relationshipResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(postMutation.changeKind, 'create');
  assert.equal(termMutation.changeKind, 'create');
  assert.equal(taxonomyMutation, undefined);
  assert.equal(relationshipBlocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(relationshipBlocker.surface, 'nav_menu');
  assert.equal(
    JSON.stringify(relationshipBlocker).includes('local-private-taxonomy-object-body'),
    false,
  );
  assert.equal(
    JSON.stringify(relationshipBlocker).includes('local-navigation-term'),
    false,
  );
});

test('allows local termmeta references to a term created by the same plan', () => {
  const termResourceKey = 'row:["wp_terms","term_id:7"]';
  const termmetaResourceKey = 'row:["wp_termmeta","meta_id:12"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_terms = {
    'term_id:7': {
      term_id: 7,
      name: 'Local tagged term',
      slug: 'local-tagged-term',
    },
  };
  local.db.wp_termmeta = {
    'meta_id:12': {
      meta_id: 12,
      term_id: 7,
      meta_key: 'term-note',
      meta_value: 'Local term note',
    },
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const termMutation = mutationFor(plan, termResourceKey);
  const termmetaMutation = mutationFor(plan, termmetaResourceKey);
  const reference = termmetaMutation.wordpressGraphReferences[0];

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(termMutation.changeKind, 'create');
  assert.equal(termmetaMutation.changeKind, 'create');
  assert.ok(
    plan.mutations.indexOf(termMutation) < plan.mutations.indexOf(termmetaMutation),
    'term create must be ordered before dependent termmeta',
  );
  assert.deepEqual(termmetaMutation.dependsOnMutationIds, [termMutation.id]);
  assert.equal(reference.resolutionPolicy, 'same-plan-local-create');
  assert.equal(reference.relationshipKey, 'wp_termmeta.term_id');
  assert.equal(reference.relationshipType, 'termmeta-term');
  assert.equal(reference.targetResourceKey, termResourceKey);

  const result = applyPlan(remote, plan);
  assert.equal(result.site.db.wp_terms['term_id:7'].name, 'Local tagged term');
  assert.equal(result.site.db.wp_termmeta['meta_id:12'].term_id, 7);
});

test('allows local termmeta references to a term created by the same plan even when a navigation menu taxonomy is blocked elsewhere', () => {
  const termResourceKey = 'row:["wp_terms","term_id:7"]';
  const blockedTaxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:9"]';
  const termmetaResourceKey = 'row:["wp_termmeta","meta_id:12"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_terms = {
    'term_id:7': {
      term_id: 7,
      name: 'Local tagged term',
      slug: 'local-tagged-term',
    },
    'term_id:9': {
      term_id: 9,
      name: 'Local navigation term',
      slug: 'local-navigation-term',
    },
  };
  local.db.wp_term_taxonomy = {
    'term_taxonomy_id:9': {
      term_taxonomy_id: 9,
      term_id: 9,
      taxonomy: 'nav_menu',
      description: '',
      parent: 0,
      count: 0,
    },
  };
  local.db.wp_termmeta = {
    'meta_id:12': {
      meta_id: 12,
      term_id: 7,
      meta_key: 'term-note',
      meta_value: 'Local term note',
    },
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const termMutation = mutationFor(plan, termResourceKey);
  const blockedTaxonomyMutation = mutationFor(plan, blockedTaxonomyResourceKey);
  const blockedTaxonomy = plan.blockers.find((entry) => entry.resourceKey === blockedTaxonomyResourceKey);
  const termmetaMutation = mutationFor(plan, termmetaResourceKey);
  const reference = termmetaMutation.wordpressGraphReferences[0];

  assert.equal(plan.status, 'blocked');
  assert.equal(termMutation.changeKind, 'create');
  assert.equal(blockedTaxonomyMutation, undefined);
  assert.equal(blockedTaxonomy.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blockedTaxonomy.surface, 'nav_menu');
  assert.equal(termmetaMutation.changeKind, 'create');
  assert.equal(reference.resolutionPolicy, 'same-plan-local-create');
  assert.equal(reference.relationshipKey, 'wp_termmeta.term_id');
  assert.equal(reference.relationshipType, 'termmeta-term');
  assert.equal(reference.targetResourceKey, termResourceKey);
});

test('blocks local termmeta for a term that belongs to a same-plan nav menu taxonomy', () => {
  const termResourceKey = 'row:["wp_terms","term_id:7"]';
  const taxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:9"]';
  const termmetaResourceKey = 'row:["wp_termmeta","meta_id:12"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_terms = {
    'term_id:7': {
      term_id: 7,
      name: 'Local navigation term',
      slug: 'local-navigation-term',
    },
  };
  local.db.wp_term_taxonomy = {
    'term_taxonomy_id:9': {
      term_taxonomy_id: 9,
      term_id: 7,
      taxonomy: 'nav_menu',
      description: '',
      parent: 0,
      count: 0,
    },
  };
  local.db.wp_termmeta = {
    'meta_id:12': {
      meta_id: 12,
      term_id: 7,
      meta_key: 'term-note',
      meta_value: 'local-private-navigation-term-note',
    },
  };

  const plan = planFor(base, local, baseSite());
  const termMutation = mutationFor(plan, termResourceKey);
  const taxonomyMutation = mutationFor(plan, taxonomyResourceKey);
  const taxonomyBlocker = plan.blockers.find((entry) => entry.resourceKey === taxonomyResourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === termmetaResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(termMutation.changeKind, 'create');
  assert.equal(taxonomyMutation, undefined);
  assert.equal(taxonomyBlocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(taxonomyBlocker.surface, 'nav_menu');
  assert.equal(mutationFor(plan, termmetaResourceKey), undefined);
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.surface, 'nav_menu');
  assert.equal(
    JSON.stringify(blocker).includes('local-private-navigation-term-note'),
    false,
  );
  assert.equal(
    JSON.stringify(blocker).includes('local-navigation-term'),
    false,
  );
});

test('blocks a local term relationship from an attachment to a same-plan term taxonomy', () => {
  const postResourceKey = 'row:["wp_posts","ID:3"]';
  const taxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:9"]';
  const relationshipResourceKey = 'row:["wp_term_relationships","object_id:3|term_taxonomy_id:9"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local attachment post',
    post_content: 'local-private-attachment-post-body',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  local.db.wp_terms = {
    'term_id:7': {
      term_id: 7,
      name: 'Local taxonomy term',
      slug: 'local-taxonomy-term',
    },
  };
  local.db.wp_term_taxonomy = {
    'term_taxonomy_id:9': {
      term_taxonomy_id: 9,
      term_id: 7,
      taxonomy: 'category',
      description: '',
      parent: 0,
      count: 0,
    },
  };
  local.db.wp_term_relationships = {
    'object_id:3|term_taxonomy_id:9': {
      object_id: 3,
      term_taxonomy_id: 9,
      term_order: 0,
    },
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const postMutation = mutationFor(plan, postResourceKey);
  const taxonomyMutation = mutationFor(plan, taxonomyResourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === relationshipResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(postMutation.changeKind, 'create');
  assert.equal(taxonomyMutation.changeKind, 'create');
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.surface, 'attachment');
  assert.equal(
    JSON.stringify(blocker).includes('local-private-attachment-post-body'),
    false,
  );
});

test('blocks a local term relationship owned by an attachment even when it targets a same-plan post', () => {
  const attachmentPostResourceKey = 'row:["wp_posts","ID:3"]';
  const taggedPostResourceKey = 'row:["wp_posts","ID:4"]';
  const taxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:9"]';
  const relationshipResourceKey = 'row:["wp_term_relationships","object_id:3|term_taxonomy_id:9"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local attachment post',
    post_content: 'local-private-attachment-post-body',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  local.db.wp_posts['ID:4'] = {
    ID: 4,
    post_title: 'Local tagged post',
    post_content: 'local-private-tagged-post-body',
    post_status: 'publish',
  };
  local.db.wp_terms = {
    'term_id:7': {
      term_id: 7,
      name: 'Local taxonomy term',
      slug: 'local-taxonomy-term',
    },
  };
  local.db.wp_term_taxonomy = {
    'term_taxonomy_id:9': {
      term_taxonomy_id: 9,
      term_id: 7,
      taxonomy: 'category',
      description: '',
      parent: 0,
      count: 0,
    },
  };
  local.db.wp_term_relationships = {
    'object_id:3|term_taxonomy_id:9': {
      object_id: 3,
      term_taxonomy_id: 9,
      term_order: 0,
    },
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const attachmentMutation = mutationFor(plan, attachmentPostResourceKey);
  const taggedPostMutation = mutationFor(plan, taggedPostResourceKey);
  const taxonomyMutation = mutationFor(plan, taxonomyResourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === relationshipResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(attachmentMutation.changeKind, 'create');
  assert.equal(taggedPostMutation.changeKind, 'create');
  assert.equal(taxonomyMutation.changeKind, 'create');
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.surface, 'attachment');
  assert.equal(
    JSON.stringify(blocker).includes('local-private-attachment-post-body'),
    false,
  );
  assert.equal(
    JSON.stringify(blocker).includes('local-private-tagged-post-body'),
    false,
  );
});

test('blocks a local term relationship owned by an attachment even when it targets a same-plan term taxonomy', () => {
  const attachmentPostResourceKey = 'row:["wp_posts","ID:3"]';
  const termResourceKey = 'row:["wp_terms","term_id:7"]';
  const taxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:9"]';
  const relationshipResourceKey = 'row:["wp_term_relationships","object_id:3|term_taxonomy_id:9"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local attachment post',
    post_content: 'local-private-attachment-post-body',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  local.db.wp_terms = {
    'term_id:7': {
      term_id: 7,
      name: 'Local taxonomy term',
      slug: 'local-taxonomy-term',
    },
  };
  local.db.wp_term_taxonomy = {
    'term_taxonomy_id:9': {
      term_taxonomy_id: 9,
      term_id: 7,
      taxonomy: 'category',
      description: '',
      parent: 0,
      count: 0,
    },
  };
  local.db.wp_term_relationships = {
    'object_id:3|term_taxonomy_id:9': {
      object_id: 3,
      term_taxonomy_id: 9,
      term_order: 0,
    },
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const attachmentMutation = mutationFor(plan, attachmentPostResourceKey);
  const termMutation = mutationFor(plan, termResourceKey);
  const taxonomyMutation = mutationFor(plan, taxonomyResourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === relationshipResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 3);
  assert.equal(attachmentMutation.changeKind, 'create');
  assert.equal(termMutation.changeKind, 'create');
  assert.equal(taxonomyMutation.changeKind, 'create');
  assert.equal(mutationFor(plan, relationshipResourceKey), undefined);
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.surface, 'attachment');
  assert.equal(
    JSON.stringify(blocker).includes('local-private-attachment-post-body'),
    false,
  );
});

test('blocks a local term relationship owned by a navigation post even when it targets a same-plan post', () => {
  const navigationPostResourceKey = 'row:["wp_posts","ID:3"]';
  const taggedPostResourceKey = 'row:["wp_posts","ID:4"]';
  const taxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:9"]';
  const relationshipResourceKey = 'row:["wp_term_relationships","object_id:3|term_taxonomy_id:9"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local navigation post',
    post_content: 'local-private-navigation-post-body',
    post_status: 'publish',
    post_type: 'nav_menu_item',
  };
  local.db.wp_posts['ID:4'] = {
    ID: 4,
    post_title: 'Local tagged post',
    post_content: 'local-private-tagged-post-body',
    post_status: 'publish',
  };
  local.db.wp_terms = {
    'term_id:7': {
      term_id: 7,
      name: 'Local taxonomy term',
      slug: 'local-taxonomy-term',
    },
  };
  local.db.wp_term_taxonomy = {
    'term_taxonomy_id:9': {
      term_taxonomy_id: 9,
      term_id: 7,
      taxonomy: 'category',
      description: '',
      parent: 0,
      count: 0,
    },
  };
  local.db.wp_term_relationships = {
    'object_id:3|term_taxonomy_id:9': {
      object_id: 3,
      term_taxonomy_id: 9,
      term_order: 0,
    },
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const navigationMutation = mutationFor(plan, navigationPostResourceKey);
  const taggedPostMutation = mutationFor(plan, taggedPostResourceKey);
  const taxonomyMutation = mutationFor(plan, taxonomyResourceKey);
  const navigationBlocker = plan.blockers.find((entry) => entry.resourceKey === navigationPostResourceKey);
  const relationshipBlocker = plan.blockers.find((entry) => entry.resourceKey === relationshipResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(navigationBlocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(navigationBlocker.surface, 'nav_menu_item');
  assert.equal(navigationMutation, undefined);
  assert.equal(taggedPostMutation.changeKind, 'create');
  assert.equal(taxonomyMutation.changeKind, 'create');
  assert.equal(relationshipBlocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(relationshipBlocker.surface, 'nav_menu_item');
  assert.equal(
    JSON.stringify(relationshipBlocker).includes('local-private-navigation-post-body'),
    false,
  );
  assert.equal(
    JSON.stringify(relationshipBlocker).includes('local-private-tagged-post-body'),
    false,
  );
});

test('blocks a local term relationship owned by a revision even when it targets a same-plan post', () => {
  const revisionPostResourceKey = 'row:["wp_posts","ID:5"]';
  const taggedPostResourceKey = 'row:["wp_posts","ID:4"]';
  const taxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:9"]';
  const relationshipResourceKey = 'row:["wp_term_relationships","object_id:5|term_taxonomy_id:9"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:5'] = {
    ID: 5,
    post_title: 'Local revision post',
    post_content: 'local-private-revision-post-body',
    post_status: 'inherit',
    post_type: 'revision',
  };
  local.db.wp_posts['ID:4'] = {
    ID: 4,
    post_title: 'Local tagged post',
    post_content: 'local-private-tagged-post-body',
    post_status: 'publish',
  };
  local.db.wp_terms = {
    'term_id:7': {
      term_id: 7,
      name: 'Local taxonomy term',
      slug: 'local-taxonomy-term',
    },
  };
  local.db.wp_term_taxonomy = {
    'term_taxonomy_id:9': {
      term_taxonomy_id: 9,
      term_id: 7,
      taxonomy: 'category',
      description: '',
      parent: 0,
      count: 0,
    },
  };
  local.db.wp_term_relationships = {
    'object_id:5|term_taxonomy_id:9': {
      object_id: 5,
      term_taxonomy_id: 9,
      term_order: 0,
    },
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const revisionMutation = mutationFor(plan, revisionPostResourceKey);
  const taggedPostMutation = mutationFor(plan, taggedPostResourceKey);
  const taxonomyMutation = mutationFor(plan, taxonomyResourceKey);
  const relationshipBlocker = plan.blockers.find((entry) => entry.resourceKey === relationshipResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(revisionMutation, undefined);
  assert.equal(taggedPostMutation.changeKind, 'create');
  assert.equal(taxonomyMutation.changeKind, 'create');
  assert.equal(relationshipBlocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(relationshipBlocker.surface, 'revision');
  assert.equal(
    JSON.stringify(relationshipBlocker).includes('local-private-revision-post-body'),
    false,
  );
  assert.equal(
    JSON.stringify(relationshipBlocker).includes('local-private-tagged-post-body'),
    false,
  );
});

test('blocks a local term relationship owned by a wp_navigation post even when it targets a same-plan term taxonomy', () => {
  const navigationPostResourceKey = 'row:["wp_posts","ID:6"]';
  const taxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:9"]';
  const relationshipResourceKey = 'row:["wp_term_relationships","object_id:6|term_taxonomy_id:9"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:6'] = {
    ID: 6,
    post_title: 'Local navigation term post',
    post_content: 'local-private-navigation-term-post-body',
    post_status: 'publish',
    post_type: 'wp_navigation',
  };
  local.db.wp_terms = {
    'term_id:7': {
      term_id: 7,
      name: 'Local term for navigation',
      slug: 'local-term-for-navigation',
    },
  };
  local.db.wp_term_taxonomy = {
    'term_taxonomy_id:9': {
      term_taxonomy_id: 9,
      term_id: 7,
      taxonomy: 'category',
      description: '',
      parent: 0,
      count: 0,
    },
  };
  local.db.wp_term_relationships = {
    'object_id:6|term_taxonomy_id:9': {
      object_id: 6,
      term_taxonomy_id: 9,
      term_order: 0,
    },
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const navigationMutation = mutationFor(plan, navigationPostResourceKey);
  const taxonomyMutation = mutationFor(plan, taxonomyResourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === relationshipResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(navigationMutation, undefined);
  assert.equal(taxonomyMutation.changeKind, 'create');
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.surface, 'wp_navigation');
  assert.equal(
    JSON.stringify(blocker).includes('local-private-navigation-term-post-body'),
    false,
  );
});

test('allows a local term relationship to a same-plan term taxonomy when the owning post is also created by the same plan', () => {
  const postResourceKey = 'row:["wp_posts","ID:6"]';
  const termResourceKey = 'row:["wp_terms","term_id:7"]';
  const taxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:9"]';
  const relationshipResourceKey = 'row:["wp_term_relationships","object_id:6|term_taxonomy_id:9"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:6'] = {
    ID: 6,
    post_title: 'Local tagged post',
    post_content: 'local-private-tagged-post-body',
    post_status: 'publish',
  };
  local.db.wp_terms = {
    'term_id:7': {
      term_id: 7,
      name: 'Local taxonomy term',
      slug: 'local-taxonomy-term',
    },
  };
  local.db.wp_term_taxonomy = {
    'term_taxonomy_id:9': {
      term_taxonomy_id: 9,
      term_id: 7,
      taxonomy: 'category',
      description: '',
      parent: 0,
      count: 0,
    },
  };
  local.db.wp_term_relationships = {
    'object_id:6|term_taxonomy_id:9': {
      object_id: 6,
      term_taxonomy_id: 9,
      term_order: 0,
    },
  };
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const postMutation = mutationFor(plan, postResourceKey);
  const termMutation = mutationFor(plan, termResourceKey);
  const taxonomyMutation = mutationFor(plan, taxonomyResourceKey);
  const relationshipMutation = mutationFor(plan, relationshipResourceKey);
  const reference = relationshipMutation.wordpressGraphReferences.find((entry) => entry.relationshipType === 'term-relationship-taxonomy');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(postMutation.changeKind, 'create');
  assert.equal(termMutation.changeKind, 'create');
  assert.equal(taxonomyMutation.changeKind, 'create');
  assert.equal(relationshipMutation.changeKind, 'create');
  assert.ok(
    plan.mutations.indexOf(postMutation) < plan.mutations.indexOf(relationshipMutation),
    'owning post create must be ordered before dependent term relationship',
  );
  assert.ok(
    plan.mutations.indexOf(taxonomyMutation) < plan.mutations.indexOf(relationshipMutation),
    'term taxonomy create must be ordered before dependent term relationship',
  );
  assert.deepEqual(relationshipMutation.dependsOnMutationIds.sort(), [postMutation.id, taxonomyMutation.id].sort());
  assert.equal(reference.resolutionPolicy, 'same-plan-local-create');
  assert.equal(reference.relationshipKey, 'wp_term_relationships.term_taxonomy_id');
  assert.equal(reference.relationshipType, 'term-relationship-taxonomy');
  assert.equal(reference.targetResourceKey, taxonomyResourceKey);
  assert.equal(JSON.stringify(reference).includes('local-private-tagged-post-body'), false);
});

test('allows a local termmeta reference to a term created by the same plan even when a navigation post exists remotely', () => {
  const termmetaResourceKey = 'row:["wp_termmeta","meta_id:12"]';
  const base = baseSite();
  base.db.wp_posts['ID:5'] = {
    ID: 5,
    post_title: 'Remote navigation post',
    post_type: 'wp_navigation',
    post_status: 'publish',
  };
  const local = baseSite();
  local.db.wp_posts['ID:5'] = {
    ID: 5,
    post_title: 'Remote navigation post',
    post_type: 'wp_navigation',
    post_status: 'publish',
  };
  local.db.wp_terms = {
    'term_id:5': {
      term_id: 5,
      name: 'Local navigation-owned term',
      slug: 'local-navigation-owned-term',
    },
  };
  local.db.wp_termmeta = {
    'meta_id:12': {
      meta_id: 12,
      term_id: 5,
      meta_key: 'term-note',
      meta_value: 'local-private-navigation-term-note',
    },
  };
  const remote = baseSite();
  remote.db.wp_posts['ID:5'] = {
    ID: 5,
    post_title: 'Remote navigation post',
    post_type: 'wp_navigation',
    post_status: 'publish',
  };

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === termmetaResourceKey);
  const termMutation = mutationFor(plan, 'row:["wp_terms","term_id:5"]');
  const termmetaMutation = mutationFor(plan, termmetaResourceKey);
  const reference = termmetaMutation.wordpressGraphReferences[0];

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(termMutation.changeKind, 'create');
  assert.equal(termmetaMutation.changeKind, 'create');
  assert.equal(blocker, undefined);
  assert.equal(reference.resolutionPolicy, 'same-plan-local-create');
  assert.equal(reference.relationshipKey, 'wp_termmeta.term_id');
  assert.equal(reference.relationshipType, 'termmeta-term');
  assert.equal(reference.targetResourceKey, 'row:["wp_terms","term_id:5"]');
});

test('blocks a local termmeta reference to a same-plan term when the term is also used by a nav menu taxonomy', () => {
  const termmetaResourceKey = 'row:["wp_termmeta","meta_id:13"]';
  const taxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:9"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_terms = {
    'term_id:5': {
      term_id: 5,
      name: 'Local navigation menu term',
      slug: 'local-navigation-menu-term',
    },
  };
  local.db.wp_term_taxonomy = {
    'term_taxonomy_id:9': {
      term_taxonomy_id: 9,
      term_id: 5,
      taxonomy: 'nav_menu',
      description: '',
      parent: 0,
      count: 0,
    },
  };
  local.db.wp_termmeta = {
    'meta_id:13': {
      meta_id: 13,
      term_id: 5,
      meta_key: 'term-note',
      meta_value: 'local-private-navigation-term-note',
    },
  };

  const plan = planFor(base, local, baseSite());
  const blocker = plan.blockers.find((entry) => entry.resourceKey === termmetaResourceKey);
  const termMutation = mutationFor(plan, 'row:["wp_terms","term_id:5"]');
  const taxonomyMutation = mutationFor(plan, taxonomyResourceKey);
  const termmetaMutation = mutationFor(plan, termmetaResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(termMutation.changeKind, 'create');
  assert.equal(taxonomyMutation, undefined);
  assert.equal(termmetaMutation, undefined);
  assert.equal(blocker.class, 'unsupported-wordpress-graph-surface');
  assert.equal(blocker.surface, 'nav_menu');
  assert.equal(JSON.stringify(blocker).includes('local-private-navigation-term-note'), false);
  assert.throws(() => applyPlan(baseSite(), plan), /Refusing to apply/);
});

test('blocks a local termmeta reference to a same-plan term when a remote nav menu taxonomy already uses the term', () => {
  const termmetaResourceKey = 'row:["wp_termmeta","meta_id:14"]';
  const termResourceKey = 'row:["wp_terms","term_id:5"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_terms = {
    'term_id:5': {
      term_id: 5,
      name: 'Local shared term',
      slug: 'local-shared-term',
    },
  };
  local.db.wp_termmeta = {
    'meta_id:14': {
      meta_id: 14,
      term_id: 5,
      meta_key: 'term-note',
      meta_value: 'local-private-shared-term-note',
    },
  };
  const remote = baseSite();
  remote.db.wp_term_taxonomy = {
    'term_taxonomy_id:20': {
      term_taxonomy_id: 20,
      term_id: 5,
      taxonomy: 'nav_menu',
      description: '',
      parent: 0,
      count: 0,
    },
  };

  const plan = planFor(base, local, remote);
  const termMutation = mutationFor(plan, termResourceKey);
  const termmetaMutation = mutationFor(plan, termmetaResourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === termmetaResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(termMutation.changeKind, 'create');
  assert.equal(termmetaMutation.changeKind, 'create');
  assert.equal(blocker.class, 'missing-wordpress-graph-dependency');
  assert.equal(blocker.references[0].relationshipType, 'termmeta-term');
  assert.equal(blocker.references[0].targetResourceKey, termResourceKey);
  assert.equal(JSON.stringify(blocker).includes('local-private-shared-term-note'), false);
  assert.throws(() => applyPlan(baseSite(), plan), /Refusing to apply/);
});

test('blocks a local term taxonomy reference to a same-plan term when a remote nav menu taxonomy already uses the term', () => {
  const termResourceKey = 'row:["wp_terms","term_id:5"]';
  const taxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:9"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_terms = {
    'term_id:5': {
      term_id: 5,
      name: 'Local shared term',
      slug: 'local-shared-term',
    },
  };
  local.db.wp_term_taxonomy = {
    'term_taxonomy_id:9': {
      term_taxonomy_id: 9,
      term_id: 5,
      taxonomy: 'category',
      description: '',
      parent: 0,
      count: 0,
    },
  };
  const remote = baseSite();
  remote.db.wp_term_taxonomy = {
    'term_taxonomy_id:20': {
      term_taxonomy_id: 20,
      term_id: 5,
      taxonomy: 'nav_menu',
      description: '',
      parent: 0,
      count: 0,
    },
  };

  const plan = planFor(base, local, remote);
  const termMutation = mutationFor(plan, termResourceKey);
  const taxonomyMutation = mutationFor(plan, taxonomyResourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === taxonomyResourceKey);

  assert.equal(plan.status, 'blocked');
  assert.equal(termMutation.changeKind, 'create');
  assert.equal(taxonomyMutation.changeKind, 'create');
  assert.equal(blocker.class, 'missing-wordpress-graph-dependency');
  assert.equal(blocker.references[0].relationshipType, 'term-taxonomy-term');
  assert.equal(blocker.references[0].targetResourceKey, termResourceKey);
  assert.equal(JSON.stringify(blocker).includes('local-shared-term'), false);
  assert.throws(() => applyPlan(baseSite(), plan), /Refusing to apply/);
});

test('allows a local termmeta reference to a same-plan term while a separate same-plan term relationship is also created', () => {
  const termResourceKey = 'row:["wp_terms","term_id:7"]';
  const taxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:9"]';
  const relationshipResourceKey = 'row:["wp_term_relationships","object_id:3|term_taxonomy_id:9"]';
  const termmetaResourceKey = 'row:["wp_termmeta","meta_id:12"]';
  const postResourceKey = 'row:["wp_posts","ID:3"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_terms = {
    'term_id:7': {
      term_id: 7,
      name: 'Local shared term',
      slug: 'local-shared-term',
    },
  };
  local.db.wp_term_taxonomy = {
    'term_taxonomy_id:9': {
      term_taxonomy_id: 9,
      term_id: 7,
      taxonomy: 'category',
      description: '',
      parent: 0,
      count: 0,
    },
  };
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local tagged post',
    post_content: 'local-private-tagged-post-body',
    post_status: 'publish',
  };
  local.db.wp_term_relationships = {
    'object_id:3|term_taxonomy_id:9': {
      object_id: 3,
      term_taxonomy_id: 9,
      term_order: 0,
    },
  };
  local.db.wp_termmeta = {
    'meta_id:12': {
      meta_id: 12,
      term_id: 7,
      meta_key: 'term-note',
      meta_value: 'local-private-term-note',
    },
  };

  const plan = planFor(base, local, baseSite());
  const termMutation = mutationFor(plan, termResourceKey);
  const taxonomyMutation = mutationFor(plan, taxonomyResourceKey);
  const relationshipMutation = mutationFor(plan, relationshipResourceKey);
  const termmetaMutation = mutationFor(plan, termmetaResourceKey);
  const reference = termmetaMutation.wordpressGraphReferences[0];

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(termMutation.changeKind, 'create');
  assert.equal(taxonomyMutation.changeKind, 'create');
  assert.equal(relationshipMutation.changeKind, 'create');
  assert.equal(termmetaMutation.changeKind, 'create');
  assert.ok(
    plan.mutations.indexOf(termMutation) < plan.mutations.indexOf(taxonomyMutation),
    'term create must be ordered before dependent taxonomy',
  );
  assert.ok(
    plan.mutations.indexOf(taxonomyMutation) < plan.mutations.indexOf(relationshipMutation),
    'taxonomy create must be ordered before dependent relationship',
  );
  assert.deepEqual(termmetaMutation.dependsOnMutationIds, [termMutation.id]);
  assert.equal(reference.resolutionPolicy, 'same-plan-local-create');
  assert.equal(reference.relationshipKey, 'wp_termmeta.term_id');
  assert.equal(reference.relationshipType, 'termmeta-term');
  assert.equal(reference.targetResourceKey, termResourceKey);
  assert.equal(JSON.stringify(reference).includes('local-private-term-note'), false);
});

test('allows a local termmeta reference to a same-plan term while a separate same-plan term relationship is also created and an unrelated remote nav menu taxonomy exists', () => {
  const termResourceKey = 'row:["wp_terms","term_id:7"]';
  const taxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:9"]';
  const relationshipResourceKey = 'row:["wp_term_relationships","object_id:3|term_taxonomy_id:9"]';
  const termmetaResourceKey = 'row:["wp_termmeta","meta_id:12"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_terms = {
    'term_id:7': {
      term_id: 7,
      name: 'Local shared term',
      slug: 'local-shared-term',
    },
  };
  local.db.wp_term_taxonomy = {
    'term_taxonomy_id:9': {
      term_taxonomy_id: 9,
      term_id: 7,
      taxonomy: 'category',
      description: '',
      parent: 0,
      count: 0,
    },
  };
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local tagged post',
    post_content: 'local-private-tagged-post-body',
    post_status: 'publish',
  };
  local.db.wp_term_relationships = {
    'object_id:3|term_taxonomy_id:9': {
      object_id: 3,
      term_taxonomy_id: 9,
      term_order: 0,
    },
  };
  local.db.wp_termmeta = {
    'meta_id:12': {
      meta_id: 12,
      term_id: 7,
      meta_key: 'term-note',
      meta_value: 'local-private-term-note',
    },
  };
  const remote = baseSite();
  remote.db.wp_term_taxonomy = {
    'term_taxonomy_id:20': {
      term_taxonomy_id: 20,
      term_id: 21,
      taxonomy: 'nav_menu',
      description: '',
      parent: 0,
      count: 0,
    },
  };

  const plan = planFor(base, local, remote);
  const termMutation = mutationFor(plan, termResourceKey);
  const taxonomyMutation = mutationFor(plan, taxonomyResourceKey);
  const relationshipMutation = mutationFor(plan, relationshipResourceKey);
  const termmetaMutation = mutationFor(plan, termmetaResourceKey);
  const reference = termmetaMutation.wordpressGraphReferences[0];

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(termMutation.changeKind, 'create');
  assert.equal(taxonomyMutation.changeKind, 'create');
  assert.equal(relationshipMutation.changeKind, 'create');
  assert.equal(termmetaMutation.changeKind, 'create');
  assert.ok(
    plan.mutations.indexOf(termMutation) < plan.mutations.indexOf(taxonomyMutation),
    'term create must be ordered before dependent taxonomy',
  );
  assert.ok(
    plan.mutations.indexOf(taxonomyMutation) < plan.mutations.indexOf(relationshipMutation),
    'taxonomy create must be ordered before dependent relationship',
  );
  assert.deepEqual(termmetaMutation.dependsOnMutationIds, [termMutation.id]);
  assert.equal(reference.resolutionPolicy, 'same-plan-local-create');
  assert.equal(reference.relationshipKey, 'wp_termmeta.term_id');
  assert.equal(reference.relationshipType, 'termmeta-term');
  assert.equal(reference.targetResourceKey, termResourceKey);
  assert.equal(JSON.stringify(reference).includes('local-private-term-note'), false);
  assert.equal(JSON.stringify(reference).includes('local-private-tagged-post-body'), false);
});

test('blocks an atomic plugin install when dependencies are absent', () => {
  const base = baseSite();
  const local = baseSite();
  local.files[pluginMainFile(atomicDependentPlugin)] = '<?php /* dependent */';
  local.plugins[atomicDependentPlugin] = { version: '1.0.0', active: true, requires: [atomicDependencyPlugin] };
  local.pushIntents = [
    {
      id: 'install-atomic-dependent-fixture',
      kind: 'plugin-install',
      label: 'Install atomic dependent fixture',
      requireAtomic: true,
      resources: [
        `file:${pluginMainFile(atomicDependentPlugin)}`,
        `plugin:${atomicDependentPlugin}`,
      ],
      dependencies: { plugins: [atomicDependencyPlugin] },
    },
  ];

  const plan = planFor(base, local, baseSite());

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.blockers[0].class, 'missing-plugin-dependency');
  assert.throws(() => applyPlan(baseSite(), plan), /Refusing to apply/);
});

test('redacts raw plugin dependency metadata from blocker evidence', () => {
  const base = baseSite();
  const local = baseSite();
  local.plugins[atomicDependentPlugin] = { version: '1.0.0', active: true, requires: [atomicDependencyPlugin] };
  local.pushIntents = [
    {
      id: 'install-atomic-dependent-fixture',
      kind: 'plugin-install',
      requireAtomic: true,
      resources: [`plugin:${atomicDependentPlugin}`],
      dependencies: {
        privateEnvelope: 'dependency-envelope-secret',
        plugins: [
          {
            name: atomicDependencyPlugin,
            expectedVersion: '2.1.0',
            active: true,
            accessToken: 'dependency-token-secret',
          },
        ],
      },
    },
  ];

  const plan = planFor(base, local, baseSite());
  const blocker = plan.blockers[0];
  const planJson = JSON.stringify(plan);

  assert.equal(plan.status, 'blocked');
  assert.deepEqual(plan.atomicGroups[0].dependencies, { plugins: [atomicDependencyPlugin] });
  assert.deepEqual(blocker.dependency, {
    plugin: atomicDependencyPlugin,
    expectedVersion: '2.1.0',
    active: true,
  });
  assert.equal(planJson.includes('dependency-token-secret'), false);
  assert.equal(planJson.includes('dependency-envelope-secret'), false);
});

test('applies an atomic plugin install when dependencies are included in the same plan', () => {
  const base = baseSite();
  const local = baseSite();
  local.files[pluginMainFile(atomicDependencyPlugin)] = '<?php /* dependency */';
  local.files[pluginMainFile(atomicDependentPlugin)] = '<?php /* dependent */';
  local.plugins[atomicDependencyPlugin] = { version: '2.1.0', active: true };
  local.plugins[atomicDependentPlugin] = { version: '1.0.0', active: true, requires: [atomicDependencyPlugin] };
  local.db.wp_options['option_name:reprint_push_atomic_fixture_data'] = {
    option_name: 'reprint_push_atomic_fixture_data',
    option_value: { mode: 'installed' },
    __pluginOwner: atomicDependentPlugin,
  };
  local.pushIntents = [
    {
      id: 'install-atomic-fixture-stack',
      kind: 'plugin-install',
      requireAtomic: true,
      resources: [
        `file:${pluginMainFile(atomicDependencyPlugin)}`,
        `file:${pluginMainFile(atomicDependentPlugin)}`,
        `plugin:${atomicDependencyPlugin}`,
        `plugin:${atomicDependentPlugin}`,
        'row:["wp_options","option_name:reprint_push_atomic_fixture_data"]',
      ],
      dependencies: {
        plugins: [
          {
            name: atomicDependencyPlugin,
            version: '2.1.0',
            hash: resourceHash(local, pluginResource(atomicDependencyPlugin)),
          },
        ],
      },
      resourcePolicy: pluginOwnedResourcePolicy(
        allowedPluginOwnedResource(
          'row:["wp_options","option_name:reprint_push_atomic_fixture_data"]',
          atomicDependentPlugin,
        ),
      ),
    },
  ];

  const plan = planFor(base, local, baseSite());
  const result = applyPlan(baseSite(), plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.atomicGroups[0].status, 'ready');
  assert.equal(result.site.plugins[atomicDependentPlugin].version, '1.0.0');
  assert.equal(result.site.plugins[atomicDependencyPlugin].version, '2.1.0');
  assert.equal(
    result.site.db.wp_options['option_name:reprint_push_atomic_fixture_data'].option_value.mode,
    'installed',
  );
});

test('executor rejects forged ready atomic plugin plans before mutation', () => {
  const base = baseSite();
  const local = baseSite();
  local.files[pluginMainFile(atomicDependencyPlugin)] = '<?php /* dependency */';
  local.files[pluginMainFile(atomicDependentPlugin)] = '<?php /* dependent */';
  local.plugins[atomicDependencyPlugin] = { version: '2.1.0', active: true };
  local.plugins[atomicDependentPlugin] = { version: '1.0.0', active: true, requires: [atomicDependencyPlugin] };
  local.pushIntents = [
    {
      id: 'install-atomic-fixture-stack',
      kind: 'plugin-install',
      requireAtomic: true,
      resources: [
        `file:${pluginMainFile(atomicDependencyPlugin)}`,
        `file:${pluginMainFile(atomicDependentPlugin)}`,
        `plugin:${atomicDependencyPlugin}`,
        `plugin:${atomicDependentPlugin}`,
      ],
      dependencies: {
        plugins: [{ name: atomicDependencyPlugin, expectedVersion: '2.1.0', active: true }],
      },
    },
  ];

  const ready = planFor(base, local, baseSite());
  assert.equal(ready.status, 'ready');
  const dependencyMutationId = mutationFor(ready, `plugin:${atomicDependencyPlugin}`).id;

  const cases = [
    {
      name: 'missing dependency closure',
      code: 'ATOMIC_GROUP_DEPENDENCY_MISSING',
      plan: tamperReadyPlan(ready, (plan) => {
        plan.mutations = plan.mutations.filter((mutation) => mutation.resourceKey !== `plugin:${atomicDependencyPlugin}`);
        plan.preconditions = plan.preconditions.filter((entry) => entry.mutationId !== dependencyMutationId);
        plan.atomicGroups[0].mutationIds = plan.atomicGroups[0].mutationIds.filter((id) => id !== dependencyMutationId);
      }),
    },
    {
      name: 'dependency outside group',
      code: 'ATOMIC_GROUP_DEPENDENCY_OUTSIDE_GROUP',
      plan: tamperReadyPlan(ready, (plan) => {
        mutationFor(plan, `plugin:${atomicDependencyPlugin}`).atomicGroupId = null;
        plan.atomicGroups[0].mutationIds = plan.atomicGroups[0].mutationIds.filter((id) => id !== dependencyMutationId);
      }),
    },
    {
      name: 'dependent fixture without atomic group evidence',
      code: 'ATOMIC_GROUP_DEPENDENCY_UNDECLARED',
      plan: tamperReadyPlan(ready, (plan) => {
        delete plan.atomicGroups;
        plan.summary.atomicGroups = 0;
      }),
    },
    {
      name: 'dependent fixture without dependency requirement evidence',
      code: 'ATOMIC_GROUP_DEPENDENCY_UNDECLARED',
      plan: tamperReadyPlan(ready, (plan) => {
        delete plan.atomicGroups[0].dependencies;
        delete plan.atomicGroups[0].dependencyRequirements;
      }),
    },
    {
      name: 'incompatible dependency version',
      code: 'ATOMIC_GROUP_DEPENDENCY_VERSION_MISMATCH',
      plan: tamperReadyPlan(ready, (plan) => {
        plan.atomicGroups[0].dependencyRequirements[0].expectedVersion = '9.9.9';
      }),
    },
    {
      name: 'dependency hash mismatch',
      code: 'ATOMIC_GROUP_DEPENDENCY_HASH_MISMATCH',
      plan: tamperReadyPlan(ready, (plan) => {
        plan.atomicGroups[0].dependencyRequirements[0].expectedHash = '0'.repeat(64);
      }),
    },
    {
      name: 'bad active requirement',
      code: 'ATOMIC_GROUP_DEPENDENCY_ACTIVE_MISMATCH',
      plan: tamperReadyPlan(ready, (plan) => {
        plan.atomicGroups[0].dependencyRequirements[0].active = false;
      }),
    },
  ];

  for (const testCase of cases) {
    const remote = baseSite();
    const before = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, testCase.plan));
    assert.ok(error instanceof PushPlanError, testCase.name);
    assert.equal(error.code, testCase.code, testCase.name);
    assert.equal(JSON.stringify(remote), before, testCase.name);
  }
});

test('executor rejects forged ready atomic plan when live dependency evidence is stale', () => {
  const base = baseSite();
  base.plugins[atomicDependencyPlugin] = { version: '2.1.0', active: true };
  const local = baseSite();
  local.plugins[atomicDependencyPlugin] = { version: '2.1.0', active: true };
  local.db.wp_options['option_name:reprint_push_atomic_fixture_data'] = {
    option_name: 'reprint_push_atomic_fixture_data',
    option_value: { mode: 'local' },
    __pluginOwner: atomicDependentPlugin,
  };
  local.pushIntents = [
    {
      id: 'update-atomic-dependent-fixture',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: ['row:["wp_options","option_name:reprint_push_atomic_fixture_data"]'],
      dependencies: {
        plugins: [{ name: atomicDependencyPlugin, expectedVersion: '2.1.0', active: true }],
      },
      resourcePolicy: pluginOwnedResourcePolicy(
        allowedPluginOwnedResource(
          'row:["wp_options","option_name:reprint_push_atomic_fixture_data"]',
          atomicDependentPlugin,
        ),
      ),
    },
  ];
  const remote = baseSite();
  remote.plugins[atomicDependencyPlugin] = { version: '2.1.0', active: true };
  const plan = planFor(base, local, remote);
  assert.equal(plan.status, 'ready');
  assert.equal(plan.atomicGroups[0].dependencyRequirements[0].source, 'live-remote');

  remote.plugins[atomicDependencyPlugin] = { version: '2.2.0', active: true };
  const before = JSON.stringify(remote);
  const error = captureError(() => applyPlan(remote, plan));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'ATOMIC_GROUP_DEPENDENCY_STALE');
  assert.equal(JSON.stringify(remote), before);
});

test('executor rejects row-only forged ready dependent fixture data plans before mutation', () => {
  const resourceKey = 'row:["wp_options","option_name:reprint_push_atomic_fixture_data"]';
  const base = baseSite();
  base.plugins[atomicDependencyPlugin] = { version: '2.1.0', active: true };
  base.db.wp_options['option_name:reprint_push_atomic_fixture_data'] = {
    option_name: 'reprint_push_atomic_fixture_data',
    option_value: { mode: 'remote' },
    __pluginOwner: atomicDependentPlugin,
  };
  const local = JSON.parse(JSON.stringify(base));
  local.db.wp_options['option_name:reprint_push_atomic_fixture_data'].option_value = { mode: 'local' };
  local.pushIntents = [
    {
      id: 'update-atomic-dependent-fixture',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: [resourceKey],
      dependencies: {
        plugins: [{ name: atomicDependencyPlugin, expectedVersion: '2.1.0', active: true }],
      },
      resourcePolicy: pluginOwnedResourcePolicy(
        allowedPluginOwnedResource(resourceKey, atomicDependentPlugin),
      ),
    },
  ];
  const remote = JSON.parse(JSON.stringify(base));
  const ready = planFor(base, local, remote);
  assert.equal(ready.status, 'ready');
  assert.deepEqual(ready.mutations.map((mutation) => mutation.resourceKey), [resourceKey]);
  assert.equal(ready.atomicGroups[0].dependencyRequirements[0].source, 'live-remote');

  const forged = tamperReadyPlan(ready, (plan) => {
    delete plan.atomicGroups;
    plan.summary.atomicGroups = 0;
  });
  const before = JSON.stringify(remote);
  const error = captureError(() => applyPlan(remote, forged));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'ATOMIC_GROUP_DEPENDENCY_UNDECLARED');
  assert.equal(JSON.stringify(remote), before);
  assert.equal(
    remote.db.wp_options['option_name:reprint_push_atomic_fixture_data'].option_value.mode,
    'remote',
  );
});

test('blocks an atomic plugin bundle when its dependency mutation is outside the group', () => {
  const base = baseSite();
  const local = baseSite();
  local.plugins[atomicDependencyPlugin] = { version: '2.1.0', active: true };
  local.plugins[atomicDependentPlugin] = { version: '1.0.0', active: true, requires: [atomicDependencyPlugin] };
  local.pushIntents = [
    {
      id: 'install-atomic-dependency-fixture',
      kind: 'plugin-install',
      requireAtomic: true,
      resources: [`plugin:${atomicDependencyPlugin}`],
    },
    {
      id: 'install-atomic-dependent-fixture',
      kind: 'plugin-install',
      requireAtomic: true,
      resources: [`plugin:${atomicDependentPlugin}`],
      dependencies: { plugins: [atomicDependencyPlugin] },
    },
  ];

  const plan = planFor(base, local, baseSite());
  const dependentGroup = plan.atomicGroups.find((group) => group.id === 'install-atomic-dependent-fixture');

  assert.equal(plan.status, 'blocked');
  assert.equal(dependentGroup.status, 'blocked');
  assert.equal(dependentGroup.blockers[0].class, 'plugin-dependency-outside-atomic-group');
  assert.equal(dependentGroup.blockers[0].plugin, atomicDependencyPlugin);
  assert.throws(() => applyPlan(baseSite(), plan), /Refusing to apply/);
});

test('blocks a dependent atomic bundle when a remote dependency changed since base', () => {
  const base = baseSite();
  base.plugins[atomicDependencyPlugin] = { version: '2.1.0', active: true };
  const local = baseSite();
  local.plugins[atomicDependencyPlugin] = { version: '2.1.0', active: true };
  local.db.wp_options['option_name:reprint_push_atomic_fixture_data'] = {
    option_name: 'reprint_push_atomic_fixture_data',
    option_value: { mode: 'local' },
    __pluginOwner: atomicDependentPlugin,
  };
  local.pushIntents = [
    {
      id: 'update-atomic-dependent-fixture',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: ['row:["wp_options","option_name:reprint_push_atomic_fixture_data"]'],
      dependencies: {
        plugins: [
          {
            name: atomicDependencyPlugin,
            version: '2.1.0',
            hash: resourceHash(base, pluginResource(atomicDependencyPlugin)),
          },
        ],
      },
      resourcePolicy: pluginOwnedResourcePolicy(
        allowedPluginOwnedResource(
          'row:["wp_options","option_name:reprint_push_atomic_fixture_data"]',
          atomicDependentPlugin,
        ),
      ),
    },
  ];
  const remote = baseSite();
  remote.plugins[atomicDependencyPlugin] = { version: '2.2.0', active: true };

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];

  assert.equal(plan.status, 'blocked');
  assert.equal(blocker.class, 'remote-plugin-dependency-drift');
  assert.equal(blocker.plugin, atomicDependencyPlugin);
  assert.equal(decisionFor(plan, `plugin:${atomicDependencyPlugin}`).decision, 'keep-remote');
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
});

test('blocks an atomic bundle with an incompatible plugin dependency version range', () => {
  const base = baseSite();
  base.plugins[atomicDependencyPlugin] = { version: '2.1.0', active: true };
  const local = baseSite();
  local.plugins[atomicDependencyPlugin] = { version: '2.1.0', active: true };
  local.db.wp_options['option_name:reprint_push_atomic_fixture_data'] = {
    option_name: 'reprint_push_atomic_fixture_data',
    option_value: { mode: 'local' },
    __pluginOwner: atomicDependentPlugin,
  };
  local.pushIntents = [
    {
      id: 'update-atomic-dependent-fixture',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: ['row:["wp_options","option_name:reprint_push_atomic_fixture_data"]'],
      dependencies: {
        plugins: [{ name: atomicDependencyPlugin, versionRange: '>=3.0.0 <4.0.0' }],
      },
      resourcePolicy: pluginOwnedResourcePolicy(
        allowedPluginOwnedResource(
          'row:["wp_options","option_name:reprint_push_atomic_fixture_data"]',
          atomicDependentPlugin,
        ),
      ),
    },
  ];
  const remote = baseSite();
  remote.plugins[atomicDependencyPlugin] = { version: '2.1.0', active: true };

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];

  assert.equal(plan.status, 'blocked');
  assert.equal(blocker.class, 'incompatible-plugin-dependency-version-range');
  assert.equal(blocker.plugin, atomicDependencyPlugin);
  assert.match(blocker.reason, />=3\.0\.0 <4\.0\.0/);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
});

test('blocks an atomic bundle when dependency hash metadata does not match remote', () => {
  const base = baseSite();
  base.plugins[atomicDependencyPlugin] = { version: '2.1.0', active: true };
  const local = baseSite();
  local.plugins[atomicDependencyPlugin] = { version: '2.1.0', active: true };
  local.db.wp_options['option_name:reprint_push_atomic_fixture_data'] = {
    option_name: 'reprint_push_atomic_fixture_data',
    option_value: { mode: 'local' },
    __pluginOwner: atomicDependentPlugin,
  };
  local.pushIntents = [
    {
      id: 'update-atomic-dependent-fixture',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: ['row:["wp_options","option_name:reprint_push_atomic_fixture_data"]'],
      dependencies: {
        plugins: [{ name: atomicDependencyPlugin, hash: 'sha256:not-the-remote-plugin-hash' }],
      },
      resourcePolicy: pluginOwnedResourcePolicy(
        allowedPluginOwnedResource(
          'row:["wp_options","option_name:reprint_push_atomic_fixture_data"]',
          atomicDependentPlugin,
        ),
      ),
    },
  ];
  const remote = baseSite();
  remote.plugins[atomicDependencyPlugin] = { version: '2.1.0', active: true };

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];

  assert.equal(plan.status, 'blocked');
  assert.equal(blocker.class, 'plugin-dependency-hash-mismatch');
  assert.equal(blocker.plugin, atomicDependencyPlugin);
  assert.equal(blocker.expectedHash, 'sha256:not-the-remote-plugin-hash');
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
});

test('blocks an atomic bundle when dependency activation does not match requirement', () => {
  const resourceKey = 'row:["wp_options","option_name:reprint_push_atomic_fixture_data"]';
  const base = baseSite();
  base.plugins[atomicDependencyPlugin] = { version: '1.0.0', active: false };
  const local = baseSite();
  local.plugins[atomicDependencyPlugin] = { version: '1.0.0', active: false };
  local.db.wp_options['option_name:reprint_push_atomic_fixture_data'] = {
    option_name: 'reprint_push_atomic_fixture_data',
    option_value: { mode: 'local' },
    __pluginOwner: atomicDependentPlugin,
  };
  local.pushIntents = [
    {
      id: 'update-atomic-dependent-fixture',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: [resourceKey],
      dependencies: {
        plugins: [{ name: atomicDependencyPlugin, active: true }],
      },
      resourcePolicy: pluginOwnedResourcePolicy(
        allowedPluginOwnedResource(resourceKey, atomicDependentPlugin),
      ),
    },
  ];
  const remote = baseSite();
  remote.plugins[atomicDependencyPlugin] = { version: '1.0.0', active: false };

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];

  assert.equal(plan.status, 'blocked');
  assert.equal(blocker.class, 'incompatible-plugin-dependency-activation');
  assert.equal(blocker.plugin, atomicDependencyPlugin);
  assert.equal(blocker.expectedActive, true);
  assert.equal(blocker.actualActive, false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
});

test('rejects apply when the remote changed after dry-run planning', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  const plan = planFor(base, local, baseSite());
  const driftedRemote = baseSite();
  driftedRemote.files['index.php'] = '<?php echo "surprise remote edit";';

  assert.throws(
    () => applyPlan(driftedRemote, plan),
    (error) => error instanceof PushPlanError && error.code === 'PRECONDITION_FAILED',
  );
  assert.equal(driftedRemote.files['index.php'], '<?php echo "surprise remote edit";');
});

test('injected failure before commit returns no partially mutated remote state', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:1'].post_title = 'Local title';
  const remote = baseSite();
  const before = JSON.stringify(remote);
  const plan = planFor(base, local, remote);

  assert.throws(
    () => applyPlan(remote, plan, { failBeforeCommitAtMutation: 1 }),
    (error) => error instanceof PushPlanError && error.code === 'INJECTED_FAILURE_BEFORE_COMMIT',
  );
  assert.equal(JSON.stringify(remote), before);
});

test('injected failure before mutation leaves the old remote with a journal artifact', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:1'].post_title = 'Local title';
  const remote = baseSite();
  const before = JSON.stringify(remote);
  const plan = planFor(base, local, remote);

  const error = captureError(() => applyPlan(remote, plan, { failBeforeMutation: true }));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'INJECTED_FAILURE_BEFORE_MUTATION');
  assert.equal(JSON.stringify(remote), before);
  assert.equal(error.details.recovery.status, 'old-remote');
  assert.equal(error.details.recovery.artifacts.journal.status, 'opened');
  assert.equal(error.details.recovery.artifacts.journal.entries.length, 2);
});

test('injected failure after staging leaves the old remote with staged rollback artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:1'].post_title = 'Local title';
  const remote = baseSite();
  const before = JSON.stringify(remote);
  const plan = planFor(base, local, remote);

  const error = captureError(() => applyPlan(remote, plan, { failAfterStaging: true }));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'INJECTED_FAILURE_AFTER_STAGING');
  const journal = error.details.recovery.artifacts.journal;
  assert.equal(JSON.stringify(remote), before);
  assert.equal(error.details.recovery.status, 'old-remote');
  assert.equal(journal.status, 'staged');
  assert.deepEqual(journal.entries.map((entry) => entry.status), ['staged', 'staged']);
  assert.ok(journal.entries.every((entry) => entry.beforeValue && entry.afterValue));
});

test('injected failure after dependency validation leaves the old remote with validated artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files[pluginMainFile(atomicDependencyPlugin)] = '<?php /* dependency */';
  local.files[pluginMainFile(atomicDependentPlugin)] = '<?php /* dependent */';
  local.plugins[atomicDependencyPlugin] = { version: '2.1.0', active: true };
  local.plugins[atomicDependentPlugin] = { version: '1.0.0', active: true, requires: [atomicDependencyPlugin] };
  local.pushIntents = [
    {
      id: 'install-atomic-fixture-stack',
      kind: 'plugin-install',
      requireAtomic: true,
      resources: [
        `file:${pluginMainFile(atomicDependencyPlugin)}`,
        `file:${pluginMainFile(atomicDependentPlugin)}`,
        `plugin:${atomicDependencyPlugin}`,
        `plugin:${atomicDependentPlugin}`,
      ],
      dependencies: { plugins: [atomicDependencyPlugin] },
    },
  ];
  const remote = baseSite();
  const before = JSON.stringify(remote);
  const plan = planFor(base, local, remote);

  const error = captureError(() => applyPlan(remote, plan, { failAfterDependencyValidation: true }));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'INJECTED_FAILURE_AFTER_DEPENDENCY_VALIDATION');
  assert.equal(JSON.stringify(remote), before);
  assert.equal(error.details.recovery.status, 'old-remote');
  assert.equal(error.details.recovery.artifacts.journal.status, 'dependencies-validated');
});

test('durable apply journal classifies pre-commit failures as old remote', () => {
  const scenarios = [
    {
      code: 'INJECTED_FAILURE_BEFORE_MUTATION',
      options: { failBeforeMutation: true },
      expectedEvents: ['journal-opened', 'target-planned', 'target-planned', 'recovery-state'],
    },
    {
      code: 'INJECTED_FAILURE_AFTER_STAGING',
      options: { failAfterStaging: true },
      expectedEvents: [
        'journal-opened',
        'target-planned',
        'target-planned',
        'apply-staged',
        'recovery-state',
      ],
    },
    {
      code: 'INJECTED_FAILURE_AFTER_DEPENDENCY_VALIDATION',
      options: { failAfterDependencyValidation: true },
      expectedEvents: [
        'journal-opened',
        'target-planned',
        'target-planned',
        'apply-staged',
        'dependencies-validated',
        'recovery-state',
      ],
    },
  ];

  for (const scenario of scenarios) {
    const base = baseSite();
    const local = baseSite();
    local.files['index.php'] = '<?php echo "local";';
    local.db.wp_posts['ID:1'].post_title = 'Local title';
    const remote = baseSite();
    const before = JSON.stringify(remote);
    const plan = planFor(base, local, remote);
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });

    const error = captureError(() =>
      applyPlan(remote, plan, { ...scenario.options, durableJournal }));
    durableJournal.close();

    const persisted = readRecoveryJournal(journalPath);
    const inspection = inspectRecoveryJournal({ journal: persisted, plan, current: remote });

    assert.ok(error instanceof PushPlanError);
    assert.equal(error.code, scenario.code);
    assert.equal(JSON.stringify(remote), before);
    assert.equal(persisted.integrity.status, 'ok');
    assert.deepEqual(persisted.records.map((record) => record.type), scenario.expectedEvents);
    assert.equal(inspection.status, 'old-remote');
    assert.deepEqual(inspection.counts, { old: 2, new: 0, blockedUnknown: 0 });
    for (const record of persisted.records) {
      assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(record));
    }
  }
});

test('durable journal write failures before commit include old-remote recovery artifacts', () => {
  const scenarios = [
    { failType: 'journal-opened', expectedJournalStatus: 'opened' },
    { failType: 'apply-staged', expectedJournalStatus: 'staged' },
    { failType: 'dependencies-validated', expectedJournalStatus: 'dependencies-validated' },
    { failType: 'apply-committing', expectedJournalStatus: 'committing' },
  ];

  for (const scenario of scenarios) {
    const base = baseSite();
    const local = baseSite();
    local.files['index.php'] = '<?php echo "local";';
    local.db.wp_posts['ID:1'].post_title = 'Local title';
    const remote = baseSite();
    const before = JSON.stringify(remote);
    const plan = planFor(base, local, remote);
    const durableJournal = failingDurableJournal(scenario.failType);

    const error = captureError(() => applyPlan(remote, plan, { durableJournal }));

    assert.ok(error instanceof PushPlanError, scenario.failType);
    assert.equal(error.code, 'JOURNAL_WRITE_FAILED', scenario.failType);
    assert.equal(error.details.boundary, scenario.failType, scenario.failType);
    assert.equal(error.details.eventType, scenario.failType, scenario.failType);
    assert.equal(JSON.stringify(remote), before, scenario.failType);
    assert.equal(error.details.recovery.status, 'old-remote', scenario.failType);
    assert.equal(
      error.details.recovery.artifacts.journal.status,
      scenario.expectedJournalStatus,
      scenario.failType,
    );
  }
});

test('old-remote injected failures keep recovery artifacts if terminal recovery-state append fails', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:1'].post_title = 'Local title';
  const remote = baseSite();
  const before = JSON.stringify(remote);
  const plan = planFor(base, local, remote);
  const durableJournal = failingDurableJournal('recovery-state');

  const error = captureError(() =>
    applyPlan(remote, plan, { failAfterDependencyValidation: true, durableJournal }));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'INJECTED_FAILURE_AFTER_DEPENDENCY_VALIDATION');
  assert.equal(JSON.stringify(remote), before);
  assert.equal(error.details.recovery.status, 'old-remote');
  assert.equal(error.details.recovery.artifacts.journal.status, 'dependencies-validated');
  assert.equal(error.details.durableRecoveryStateWriteFailed, true);
  assert.equal(error.details.durableJournalError.eventType, 'recovery-state');
});

test('retrying an old-remote journal appends durable retry state without duplicating targets', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const journalPath = tempRecoveryJournalPath();

  const firstWriter = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const firstError = captureError(() =>
    applyPlan(remote, plan, { failBeforeMutation: true, durableJournal: firstWriter }));
  firstWriter.close();

  assert.ok(firstError instanceof PushPlanError);
  assert.equal(firstError.details.recovery.status, 'old-remote');

  const retryWriter = openRecoveryJournal(journalPath, { now: fixedNow });
  const retry = applyPlan(remote, plan, {
    journal: firstError.details.recovery.artifacts.journal,
    durableJournal: retryWriter,
    mutateRemote: true,
  });
  retryWriter.close();

  const persisted = readRecoveryJournal(journalPath);
  const inspection = inspectRecoveryJournal({ journal: persisted, plan, current: remote });
  const targetRecords = persisted.records.filter((record) => record.type === 'target-planned');

  assert.equal(retry.appliedMutations, 2);
  assert.equal(retry.recoveryState.status, 'fully-updated-remote');
  assert.equal(remote.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(remote.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
  assert.equal(persisted.integrity.status, 'ok');
  assert.equal(targetRecords.length, plan.mutations.length);
  assert.ok(persisted.records.some((record) => record.type === 'journal-retry-opened'));
  assert.equal(inspection.status, 'fully-updated-remote');
  assert.deepEqual(inspection.counts, { old: 0, new: 2, blockedUnknown: 0 });
});

test('stale recovery claim fences an old worker before target mutation', () => {
  const base = baseSite();
  const staleLocal = baseSite();
  staleLocal.files['index.php'] = '<?php echo "STALE_LOCAL";';
  staleLocal.db.wp_posts['ID:1'].post_title = 'STALE_LOCAL_TITLE';
  const remote = baseSite();
  const plan = planFor(base, staleLocal, remote);
  const journalPath = tempRecoveryJournalPath();
  const staleThresholdMs = 1000;
  const previousClaimAgeMs = 5000;
  const workerAClaim = 'worker-a-stale-claim-proof';
  const workerBClaim = 'worker-b-stale-claim-proof';
  const workerA = openRecoveryJournal(journalPath, {
    truncate: true,
    now: fixedNow,
    claimId: workerAClaim,
  });
  appendRecoveryClaimOpened(workerA, {
    plan,
    current: remote,
    claimId: workerAClaim,
    staleThresholdMs,
  });

  let workerBAdvanced = false;
  const error = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal: workerA,
      mutateRemote: true,
      beforeMutation({ mutationIndex }) {
        assert.equal(mutationIndex, 1);
        const workerB = openRecoveryJournal(journalPath, {
          now: new Date(fixedNow.getTime() + previousClaimAgeMs),
          claimId: workerBClaim,
        });
        appendStaleClaimAdvanced(workerB, {
          plan,
          current: remote,
          previousClaimId: workerAClaim,
          claimId: workerBClaim,
          staleThresholdMs,
          previousClaimAgeMs,
        });
        workerB.close();
        remote.files['index.php'] = '<?php echo "FRESH_RETRY";';
        workerBAdvanced = true;
      },
    }));
  workerA.close();

  const persisted = readRecoveryJournal(journalPath);
  const inspection = inspectRecoveryJournal({ journal: persisted, plan, current: remote });
  const journalText = fs.readFileSync(journalPath, 'utf8');

  assert.ok(workerBAdvanced);
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'RECOVERY_CLAIM_STALE');
  assert.equal(error.details.recovery.status, 'blocked-recovery');
  assert.equal(remote.files['index.php'], '<?php echo "FRESH_RETRY";');
  assert.equal(remote.db.wp_posts['ID:1'].post_title, 'Base post');
  assert.equal(journalText.includes('STALE_LOCAL'), false);
  assert.equal(journalText.includes('FRESH_RETRY'), false);
  assert.equal(persisted.integrity.status, 'ok');
  assert.deepEqual(
    persisted.records.map((record) => record.type),
    [
      'recovery-claim-opened',
      'journal-opened',
      'target-planned',
      'target-planned',
      'apply-staged',
      'dependencies-validated',
      'apply-committing',
      'stale-claim-advanced',
    ],
  );
  assert.equal(persisted.records.some((record) => record.type === 'mutation-observed'), false);
  assert.equal(inspection.status, 'blocked-recovery');
  assert.deepEqual(inspection.counts, { old: 1, new: 0, blockedUnknown: 1 });
  assert.equal(inspection.claim.status, 'advanced');
  assert.equal(inspection.claim.staleThresholdMs, staleThresholdMs);
  assert.equal(inspection.claim.previousClaimAgeMs, previousClaimAgeMs);
  for (const record of persisted.records) {
    assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(record));
  }
});

test('replaying a completed plan does not duplicate inserts or reapply stale local data', () => {
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);

  const replay = applyPlan(result.site, plan, { journal: result.journal });

  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.deepEqual(Object.keys(replay.site.db.wp_posts).sort(), ['ID:1', 'ID:2']);
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');

  const changedAfterCompletion = JSON.parse(JSON.stringify(result.site));
  changedAfterCompletion.db.wp_posts['ID:2'].post_title = 'Remote edited after push';
  const error = captureError(() => applyPlan(changedAfterCompletion, plan, { journal: result.journal }));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'RECOVERY_BLOCKED');
  assert.equal(changedAfterCompletion.db.wp_posts['ID:2'].post_title, 'Remote edited after push');
  assert.equal(error.details.recovery.status, 'blocked-recovery');
});

test('completed replay on a fresh durable journal persists a restart-inspectable envelope', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });

  const replay = applyPlan(result.site, plan, {
    journal: result.journal,
    durableJournal,
  });
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);
  const targetRecords = persisted.records.filter((record) => record.type === 'target-planned');
  const inspection = inspectRecoveryJournal({ journal: persisted, plan, current: result.site });

  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(persisted.integrity.status, 'ok');
  assert.deepEqual(
    persisted.records.map((record) => record.type),
    [
      'journal-opened',
      ...plan.mutations.map(() => 'target-planned'),
      'journal-replayed',
    ],
  );
  assert.equal(persisted.records[0].state, 'replay-observed');
  assert.equal(targetRecords.length, plan.mutations.length);
  assert.equal(inspection.status, 'fully-updated-remote');
  assert.deepEqual(inspection.counts, { old: 0, new: 2, blockedUnknown: 0 });
  for (const record of persisted.records) {
    assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(record));
  }
});

test('replaying a completed plan requires a complete matching journal envelope', () => {
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  local.files['index.php'] = '<?php echo "local";';
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);
  const after = JSON.stringify(result.site);

  const missingTargetJournal = JSON.parse(JSON.stringify(result.journal));
  missingTargetJournal.entries = missingTargetJournal.entries.slice(0, 1);
  const missingTargetError = captureError(() =>
    applyPlan(result.site, plan, { journal: missingTargetJournal }));

  assert.ok(missingTargetError instanceof PushPlanError);
  assert.equal(missingTargetError.code, 'JOURNAL_TARGET_MISMATCH');
  assert.equal(JSON.stringify(result.site), after);

  const staleTargetJournal = JSON.parse(JSON.stringify(result.journal));
  staleTargetJournal.entries[0].afterHash = '0'.repeat(64);
  const staleTargetError = captureError(() =>
    applyPlan(result.site, plan, { journal: staleTargetJournal }));

  assert.ok(staleTargetError instanceof PushPlanError);
  assert.equal(staleTargetError.code, 'JOURNAL_TARGET_MISMATCH');
  assert.equal(JSON.stringify(result.site), after);
});

test('partial remote mutation is a blocked recovery state with artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:1'].post_title = 'Local title';
  const remote = baseSite();
  const plan = planFor(base, local, remote);

  const error = captureError(() =>
    applyPlan(remote, plan, { mutateRemote: true, failDuringCommitAtMutation: 1 }));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'INJECTED_FAILURE_DURING_COMMIT');
  assert.equal(remote.files['index.php'], '<?php echo "local";');
  assert.equal(remote.db.wp_posts['ID:1'].post_title, 'Base post');
  assert.equal(error.details.recovery.status, 'blocked-recovery');
  assert.equal(error.details.recovery.artifacts.journal.status, 'blocked');
  assert.equal(error.details.recovery.artifacts.journal.entries[0].status, 'applied');
  assert.equal(error.details.recovery.artifacts.remote.files['index.php'], '<?php echo "local";');

  const retryError = captureError(() =>
    applyPlan(remote, plan, { journal: error.details.recovery.artifacts.journal }));

  assert.equal(retryError.code, 'RECOVERY_BLOCKED');
  assert.equal(retryError.details.recovery.status, 'blocked-recovery');
});

test('durable apply journal classifies partial remote mutation as blocked recovery', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:1'].post_title = 'Local title';
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });

  const error = captureError(() =>
    applyPlan(remote, plan, {
      mutateRemote: true,
      failDuringCommitAtMutation: 1,
      durableJournal,
    }));
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);
  const inspection = inspectRecoveryJournal({ journal: persisted, plan, current: remote });

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'INJECTED_FAILURE_DURING_COMMIT');
  assert.equal(error.details.recovery.status, 'blocked-recovery');
  assert.equal(persisted.integrity.status, 'ok');
  assert.deepEqual(
    persisted.records.map((record) => record.type),
    [
      'journal-opened',
      'target-planned',
      'target-planned',
      'apply-staged',
      'dependencies-validated',
      'apply-committing',
      'mutation-observed',
      'recovery-state',
    ],
  );
  assert.equal(inspection.status, 'blocked-recovery');
  assert.deepEqual(inspection.counts, { old: 1, new: 1, blockedUnknown: 0 });
  for (const record of persisted.records) {
    assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(record));
  }
});
