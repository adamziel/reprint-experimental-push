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
  recoveryClaimHash,
  readRecoveryJournal,
} from '../src/recovery-journal.js';
import { inspectRecoveryJournal } from '../src/recovery-inspect.js';
import { deserializeResourceValue, resourceHash } from '../src/resources.js';

const fixedNow = new Date('2026-05-24T00:00:00.000Z');

function tempRecoveryJournalPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-push-apply-journal-'));
  return path.join(dir, 'recovery.jsonl');
}

function failingDurableJournal(failType) {
  return {
    claimFenced: true,
    claimHash: 'a'.repeat(64),
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

function unfencedDurableJournal() {
  return {
    events: [],
    nextSequence: 1,
    appendEvent(type, payload) {
      const record = { sequence: this.nextSequence, type, ...payload };
      this.events.push(record);
      this.nextSequence++;
      return record;
    },
  };
}

function halfInitializedDurableJournal() {
  return {
    claimFenced: true,
    claimHash: 'not-a-valid-claim-hash',
    events: [],
    nextSequence: 1,
    appendEvent(type, payload) {
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

function loadJsonFixture(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8'));
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function playgroundLocalEditedSnapshot() {
  return withStablePlaygroundAuthorIdentities(
    loadJsonFixture('fixtures/playground/local-edited.snapshot.json'),
  );
}

function playgroundBaseWithoutLocalOnlyGraphRows(snapshot) {
  const base = cloneJson(snapshot);
  delete base.db.wp_posts['ID:2001'];
  delete base.db.wp_postmeta['post_id:2001:meta_key:_reprint_push_forms_schema'];
  return base;
}

function withStablePlaygroundAuthorIdentities(snapshot) {
  const next = cloneJson(snapshot);
  next.db.wp_users = next.db.wp_users || {};
  for (const post of Object.values(next.db.wp_posts || {})) {
    const userId = Number.parseInt(String(post.post_author), 10);
    if (!Number.isInteger(userId) || userId <= 0) {
      continue;
    }
    const rowId = `ID:${userId}`;
    next.db.wp_users[rowId] = next.db.wp_users[rowId] || {
      ID: userId,
    };
  }
  return next;
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

function deserializeMutationValue(mutation) {
  return deserializeResourceValue(mutation.value);
}

function decisionFor(plan, resourceKey) {
  return plan.decisions.find((decision) => decision.resourceKey === resourceKey);
}

function pluginResource(name) {
  return { type: 'plugin', name, key: `plugin:${name}` };
}

function allowedPluginOwnedResource(resourceKey, pluginOwner, driver = 'wp-option', extra = {}) {
  return { pluginOwner, resourceKey, driver, ...extra };
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
  assert.equal(plan.summary.mutations, 2);
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

test('stops a local directory deletion that would remove a remote-only descendant without leaking file bytes', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = JSON.parse(JSON.stringify(base));
  delete local.files['wp-content/uploads/gallery'];
  const remote = JSON.parse(JSON.stringify(base));
  remote.files['wp-content/uploads/gallery/remote-only.jpg'] = 'remote private image bytes';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];
  const serializedPlan = JSON.stringify(plan);
  const before = JSON.stringify(remote);
  const error = captureError(() => applyPlan(remote, plan));

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery'), undefined);
  assert.equal(
    plan.preconditions.some((precondition) => precondition.resourceKey === 'file:wp-content/uploads/gallery'),
    false,
  );
  assert.equal(conflict.class, 'file-topology-conflict');
  assert.equal(conflict.reason, 'Local file deletion or type change would hide or remove a live remote descendant.');
  assert.equal(conflict.resolutionPolicy, 'preserve-remote-file-topology-and-stop');
  assert.equal(conflict.resourceKey, 'file:wp-content/uploads/gallery');
  assert.equal(conflict.relatedResourceKey, 'file:wp-content/uploads/gallery/remote-only.jpg');
  assert.equal(conflict.change.localChange, 'delete');
  assert.equal(conflict.relatedChange.remoteChange, 'create');
  assert.match(conflict.remoteHash, /^[a-f0-9]{64}$/);
  assert.match(conflict.relatedChange.remote.hash, /^[a-f0-9]{64}$/);
  assert.equal(serializedPlan.includes('remote private image bytes'), false);
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(JSON.stringify(remote), before);
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

test('recognizes matching independent deletions as already in sync', () => {
  const base = baseSite();
  const local = baseSite();
  const remote = baseSite();
  delete local.files['index.php'];
  delete remote.files['index.php'];

  const plan = planFor(base, local, remote);
  const decision = decisionFor(plan, 'file:index.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(decision.decision, 'already-in-sync');
  assert.equal(decision.change.localChange, 'delete');
  assert.equal(decision.change.remoteChange, 'delete');
});

test('recognizes matching independent file edits as already in sync', () => {
  const base = baseSite();
  base.files['wp-content/themes/theme/style.css'] = 'body { color: red; }';
  const local = baseSite();
  local.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  const remote = baseSite();
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';

  const plan = planFor(base, local, remote);
  const decision = decisionFor(plan, 'file:wp-content/themes/theme/style.css');

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

test('blocks plugin-owned data when the owning plugin is missing or inactive on remote', () => {
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
  remote.plugins.forms = { version: '1.0.0', active: false };

  const plan = planFor(base, local, remote);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.blockers[0].class, 'stale-plugin-owner-context');
  assert.equal(plan.blockers[0].pluginOwner, 'forms');
  assert.equal(plan.blockers[0].ownerContext[0].resourceKey, 'plugin:forms');
  assert.equal(plan.blockers[0].ownerContext[0].change.remoteChange, 'update');
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply a blocked plan/);
});

test('still blocks plugin-owned data when a same-plan plugin mutation leaves the owner inactive', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-advanced';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'forms', 'wp-option'),
    ),
  };
  local.pushIntents = [
    {
      id: 'update-forms-plugin',
      kind: 'plugin-update',
      requireAtomic: true,
      resources: ['plugin:forms'],
    },
  ];
  const remote = baseSite();
  remote.plugins.forms = { version: '1.1.0', active: false };

  const plan = planFor(base, local, remote);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.blockers[0].class, 'stale-plugin-owner-context');
  assert.equal(plan.blockers[0].pluginOwner, 'forms');
  assert.equal(plan.blockers[0].ownerContext[0].resourceKey, 'plugin:forms');
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
  assert.equal(blocker.class, 'unsupported-plugin-owned-resource');
  assert.equal(blocker.pluginOwner, 'forms');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.equal(blockerJson.includes('base-private-entry'), false);
  assert.equal(blockerJson.includes('local-private-entry'), false);
});

test('allows plugin-owned custom table rows with explicit driver table policy', () => {
  const resourceKey = 'row:["wp_reprint_push_driver_fixture","entry_id:1"]';
  const base = baseSite();
  base.db.wp_reprint_push_driver_fixture = {
    'entry_id:1': {
      entry_id: 1,
      payload: { owner: 'driver-fixture', mode: 'base', version: 1 },
      updated_marker: 'base',
      __pluginOwner: 'driver-fixture',
    },
  };
  const local = JSON.parse(JSON.stringify(base));
  local.db.wp_reprint_push_driver_fixture['entry_id:1'].payload.mode = 'local-update';
  local.db.wp_reprint_push_driver_fixture['entry_id:1'].payload.version = 2;
  local.db.wp_reprint_push_driver_fixture['entry_id:1'].updated_marker = 'local-update';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'driver-fixture', 'fixture-arbitrary-plugin-table', {
        table: 'wp_reprint_push_driver_fixture',
        supportsDelete: false,
      }),
    ),
  };
  const remote = JSON.parse(JSON.stringify(base));

  const plan = planFor(base, local, remote);

  assert.equal(plan.status, 'ready');
  const mutation = mutationFor(plan, resourceKey);
  assert.equal(mutation.pluginOwnedResource.driver, 'fixture-arbitrary-plugin-table');
  assert.equal(mutation.pluginOwnedResource.supportsDelete, false);
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

test('allows same-plan post and attachment graph closure when remote still matches base', () => {
  const base = baseSite();
  const local = baseSite();
  const remote = baseSite();
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local parent post',
    post_status: 'draft',
  };
  local.db.wp_posts['ID:3'] = {
    ID: 3,
    post_title: 'Local attachment asset',
    post_status: 'inherit',
    post_type: 'attachment',
    post_parent: 2,
  };
  local.db.wp_postmeta = {
    'meta_id:45': {
      meta_id: 45,
      post_id: 2,
      meta_key: '_thumbnail_id',
      meta_value: '3',
    },
  };

  const plan = planFor(base, local, remote);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 3);
  assert.equal(mutationFor(plan, 'row:["wp_posts","ID:2"]').action, 'put');
  assert.equal(mutationFor(plan, 'row:["wp_posts","ID:3"]').action, 'put');
  assert.equal(mutationFor(plan, 'row:["wp_postmeta","meta_id:45"]').action, 'put');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Local parent post');
  assert.equal(result.site.db.wp_posts['ID:3'].post_parent, 2);
  assert.equal(result.site.db.wp_postmeta['meta_id:45'].post_id, 2);
  assert.equal(result.site.db.wp_postmeta['meta_id:45'].meta_value, '3');
});

test('maps real Playground postmeta when its WordPress post identity is created in the same plan', () => {
  const local = playgroundLocalEditedSnapshot();
  const base = playgroundBaseWithoutLocalOnlyGraphRows(local);
  const remote = cloneJson(base);
  const postResourceKey = 'row:["wp_posts","ID:2001"]';
  const postmetaResourceKey = 'row:["wp_postmeta","post_id:2001:meta_key:_reprint_push_forms_schema"]';

  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(plan.summary.mutations, 2);
  assert.equal(mutationFor(plan, postResourceKey).changeKind, 'create');
  assert.equal(mutationFor(plan, postmetaResourceKey).changeKind, 'create');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.deepEqual(result.site.db.wp_posts['ID:2001'], local.db.wp_posts['ID:2001']);
  assert.deepEqual(
    result.site.db.wp_postmeta['post_id:2001:meta_key:_reprint_push_forms_schema'],
    local.db.wp_postmeta['post_id:2001:meta_key:_reprint_push_forms_schema'],
  );
});

test('rewrites explicit WordPress graph identity map references to proven remote rows', () => {
  const sourcePostResourceKey = 'row:["wp_posts","ID:2001"]';
  const targetPostResourceKey = 'row:["wp_posts","ID:3001"]';
  const childPostResourceKey = 'row:["wp_posts","ID:2002"]';
  const rewrittenPostmetaResourceKey = 'row:["wp_postmeta","post_id:3001:meta_key:_reprint_push_forms_schema"]';
  const commentResourceKey = 'row:["wp_comments","comment_ID:51"]';
  const sourceTermResourceKey = 'row:["wp_terms","term_id:2101"]';
  const sourceTaxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:2201"]';
  const rewrittenRelationshipResourceKey = 'row:["wp_term_relationships","object_id:3001|term_taxonomy_id:3201"]';
  const termmetaResourceKey = 'row:["wp_termmeta","meta_id:4101"]';
  const base = baseSite();
  base.db.wp_postmeta = {};
  base.db.wp_comments = {};
  base.db.wp_terms = {};
  base.db.wp_term_taxonomy = {};
  base.db.wp_term_relationships = {};
  base.db.wp_termmeta = {};
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.meta = {
    wordpressGraphIdentityMap: {
      rows: [
        { table: 'wp_posts', localId: 'ID:2001', remoteId: 'ID:3001' },
        { table: 'wp_terms', localId: 'term_id:2101', remoteId: 'term_id:3101' },
        { table: 'wp_term_taxonomy', localId: 'term_taxonomy_id:2201', remoteId: 'term_taxonomy_id:3201' },
      ],
    },
  };
  local.db.wp_posts['ID:2001'] = {
    ID: 2001,
    post_title: 'Mapped graph parent',
    post_name: 'mapped-graph-parent',
    post_status: 'publish',
    post_type: 'page',
    post_parent: 0,
    post_author: 0,
  };
  remote.db.wp_posts['ID:3001'] = {
    ID: 3001,
    post_title: 'Mapped graph parent',
    post_name: 'mapped-graph-parent',
    post_status: 'publish',
    post_type: 'page',
    post_parent: 0,
    post_author: 0,
  };
  local.db.wp_posts['ID:2002'] = {
    ID: 2002,
    post_title: 'Mapped graph child',
    post_name: 'mapped-graph-child',
    post_status: 'publish',
    post_type: 'page',
    post_parent: 2001,
    post_author: 0,
  };
  local.db.wp_postmeta['post_id:2001:meta_key:_reprint_push_forms_schema'] = {
    post_id: 2001,
    meta_key: '_reprint_push_forms_schema',
    meta_value: { source: 'local-mapped-postmeta' },
  };
  local.db.wp_comments['comment_ID:51'] = {
    comment_ID: 51,
    comment_post_ID: 2001,
    comment_parent: 0,
    comment_content: 'Mapped graph comment',
  };
  local.db.wp_terms['term_id:2101'] = {
    term_id: 2101,
    name: 'Mapped graph category',
    slug: 'mapped-graph-category',
  };
  remote.db.wp_terms['term_id:3101'] = {
    term_id: 3101,
    name: 'Mapped graph category',
    slug: 'mapped-graph-category',
  };
  local.db.wp_term_taxonomy['term_taxonomy_id:2201'] = {
    term_taxonomy_id: 2201,
    term_id: 2101,
    taxonomy: 'category',
    parent: 0,
    count: 1,
  };
  remote.db.wp_term_taxonomy['term_taxonomy_id:3201'] = {
    term_taxonomy_id: 3201,
    term_id: 3101,
    taxonomy: 'category',
    parent: 0,
    count: 1,
  };
  local.db.wp_term_relationships['object_id:2001|term_taxonomy_id:2201'] = {
    object_id: 2001,
    term_taxonomy_id: 2201,
    term_order: 0,
  };
  local.db.wp_termmeta['meta_id:4101'] = {
    meta_id: 4101,
    term_id: 2101,
    meta_key: '_mapped_term_flag',
    meta_value: 'mapped-termmeta',
  };

  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);
  const postmetaMutation = mutationFor(plan, rewrittenPostmetaResourceKey);
  const relationshipMutation = mutationFor(plan, rewrittenRelationshipResourceKey);

  assert.equal(plan.status, 'ready');
  assert.equal(mutationFor(plan, sourcePostResourceKey), undefined);
  assert.equal(mutationFor(plan, sourceTermResourceKey), undefined);
  assert.equal(mutationFor(plan, sourceTaxonomyResourceKey), undefined);
  assert.equal(decisionFor(plan, sourcePostResourceKey).decision, 'map-local-identity-to-remote');
  assert.equal(decisionFor(plan, targetPostResourceKey).decision, 'keep-remote');
  assert.equal(mutationFor(plan, childPostResourceKey).changeKind, 'create');
  assert.equal(postmetaMutation.changeKind, 'create');
  assert.equal(relationshipMutation.changeKind, 'create');
  assert.equal(deserializeMutationValue(mutationFor(plan, childPostResourceKey)).post_parent, 3001);
  assert.equal(deserializeMutationValue(postmetaMutation).post_id, 3001);
  assert.equal(deserializeMutationValue(mutationFor(plan, commentResourceKey)).comment_post_ID, 3001);
  assert.equal(deserializeMutationValue(relationshipMutation).object_id, 3001);
  assert.equal(deserializeMutationValue(relationshipMutation).term_taxonomy_id, 3201);
  assert.equal(deserializeMutationValue(mutationFor(plan, termmetaResourceKey)).term_id, 3101);
  assert.equal(postmetaMutation.wordpressGraphIdentity.rewrites[0].sourceTargetResourceKey, sourcePostResourceKey);
  assert.equal(postmetaMutation.wordpressGraphIdentity.rewrites[0].targetResourceKey, targetPostResourceKey);
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(result.site.db.wp_posts['ID:2001'], undefined);
  assert.equal(result.site.db.wp_posts['ID:3001'].post_title, 'Mapped graph parent');
  assert.equal(result.site.db.wp_posts['ID:2002'].post_parent, 3001);
  assert.equal(result.site.db.wp_postmeta['post_id:3001:meta_key:_reprint_push_forms_schema'].post_id, 3001);
  assert.equal(result.site.db.wp_comments['comment_ID:51'].comment_post_ID, 3001);
  assert.equal(result.site.db.wp_term_relationships['object_id:3001|term_taxonomy_id:3201'].term_taxonomy_id, 3201);
  assert.equal(result.site.db.wp_termmeta['meta_id:4101'].term_id, 3101);
});

test('blocks explicit WordPress graph identity maps when the remote target is not equivalent', () => {
  const sourcePostResourceKey = 'row:["wp_posts","ID:2001"]';
  const targetPostResourceKey = 'row:["wp_posts","ID:3001"]';
  const postmetaResourceKey = 'row:["wp_postmeta","post_id:2001:meta_key:_reprint_push_forms_schema"]';
  const base = baseSite();
  base.db.wp_postmeta = {};
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.meta = {
    wordpressGraphIdentityMap: {
      rows: [{ table: 'wp_posts', localId: 'ID:2001', remoteId: 'ID:3001' }],
    },
  };
  local.db.wp_posts['ID:2001'] = {
    ID: 2001,
    post_title: 'local-private-mapped-title',
    post_name: 'mapped-post',
    post_status: 'publish',
    post_type: 'page',
    post_parent: 0,
    post_author: 0,
  };
  remote.db.wp_posts['ID:3001'] = {
    ID: 3001,
    post_title: 'remote-private-mapped-title',
    post_name: 'mapped-post',
    post_status: 'publish',
    post_type: 'page',
    post_parent: 0,
    post_author: 0,
  };
  local.db.wp_postmeta['post_id:2001:meta_key:_reprint_push_forms_schema'] = {
    post_id: 2001,
    meta_key: '_reprint_push_forms_schema',
    meta_value: 'local-private-mapped-postmeta',
  };

  const plan = planFor(base, local, remote);
  const sourceBlocker = plan.blockers.find((blocker) => blocker.resourceKey === sourcePostResourceKey);
  const postmetaBlocker = plan.blockers.find((blocker) => blocker.resourceKey === postmetaResourceKey);
  const planJson = JSON.stringify(plan);

  assert.equal(plan.status, 'blocked');
  assert.equal(mutationFor(plan, sourcePostResourceKey), undefined);
  assert.equal(mutationFor(plan, postmetaResourceKey), undefined);
  assert.equal(decisionFor(plan, targetPostResourceKey).decision, 'keep-remote');
  assert.equal(sourceBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(sourceBlocker.reason, /not equivalent/);
  assert.equal(postmetaBlocker.references[0].targetSupport.supported, false);
  assert.equal(planJson.includes('local-private-mapped-title'), false);
  assert.equal(planJson.includes('remote-private-mapped-title'), false);
  assert.equal(planJson.includes('local-private-mapped-postmeta'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
});

test('blocks post GUID and slug collisions without an explicit graph identity map', () => {
  const sourcePostResourceKey = 'row:["wp_posts","ID:2001"]';
  const targetPostResourceKey = 'row:["wp_posts","ID:3001"]';
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.db.wp_posts['ID:2001'] = {
    ID: 2001,
    post_title: 'local-private-colliding-title',
    post_name: 'shared-collision-slug',
    post_status: 'publish',
    post_type: 'page',
    post_parent: 0,
    post_author: 0,
    guid: 'https://example.test/shared-collision',
  };
  remote.db.wp_posts['ID:3001'] = {
    ID: 3001,
    post_title: 'remote-private-colliding-title',
    post_name: 'shared-collision-slug',
    post_status: 'publish',
    post_type: 'page',
    post_parent: 0,
    post_author: 0,
    guid: 'https://example.test/shared-collision',
  };

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === sourcePostResourceKey);
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(mutationFor(plan, sourcePostResourceKey), undefined);
  assert.equal(decisionFor(plan, targetPostResourceKey).decision, 'keep-remote');
  assert.equal(blocker.class, 'stale-wordpress-graph-identity');
  assert.match(blocker.reason, /collides with existing remote post identity/);
  assert.deepEqual(blocker.references[0].identityKinds, ['guid', 'post_type+post_name']);
  assert.equal(blockerJson.includes('local-private-colliding-title'), false);
  assert.equal(blockerJson.includes('remote-private-colliding-title'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
});

test('blocks featured image references when the attachment target diverged on remote', () => {
  const resourceKey = 'row:["wp_postmeta","meta_id:45"]';
  const targetResourceKey = 'row:["wp_posts","ID:2"]';
  const base = baseSite();
  base.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'base-private-attachment-title',
    post_status: 'inherit',
    post_type: 'attachment',
  };
  const local = JSON.parse(JSON.stringify(base));
  local.db.wp_postmeta = {
    'meta_id:45': {
      meta_id: 45,
      post_id: 1,
      meta_key: '_thumbnail_id',
      meta_value: '2',
    },
  };
  const remote = JSON.parse(JSON.stringify(base));
  remote.db.wp_posts['ID:2'].post_title = 'remote-private-attachment-title';
  remote.db.wp_posts['ID:2'].post_content = 'remote-private-attachment-body';

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
  assert.equal(reference.relationshipKey, 'wp_postmeta.meta_value');
  assert.equal(reference.relationshipType, 'featured-image-attachment');
  assert.equal(reference.targetResourceKey, targetResourceKey);
  assert.equal(reference.targetChange.localChange, 'unchanged');
  assert.equal(reference.targetChange.remoteChange, 'update');
  assert.equal(planJson.includes('remote-private-attachment-title'), false);
  assert.equal(planJson.includes('remote-private-attachment-body'), false);
});

test('keeps WordPress menu item graph surfaces fail-closed', () => {
  const menuItemResourceKey = 'row:["wp_posts","ID:44"]';
  const menuMetaResourceKey = 'row:["wp_postmeta","meta_id:90"]';
  const base = baseSite();
  base.db.wp_postmeta = {};
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.db.wp_posts['ID:44'] = {
    ID: 44,
    post_title: 'Local private menu item',
    post_content: 'local-private-menu-item-body',
    post_status: 'publish',
    post_type: 'nav_menu_item',
    post_parent: 0,
  };
  local.db.wp_postmeta['meta_id:90'] = {
    meta_id: 90,
    post_id: 44,
    meta_key: '_menu_item_object_id',
    meta_value: 1,
  };

  const plan = planFor(base, local, remote);
  const menuItemBlocker = plan.blockers.find((blocker) => blocker.resourceKey === menuItemResourceKey);
  const menuMetaBlocker = plan.blockers.find((blocker) => blocker.resourceKey === menuMetaResourceKey);
  const planJson = JSON.stringify(plan);

  assert.equal(plan.status, 'blocked');
  assert.equal(mutationFor(plan, menuItemResourceKey), undefined);
  assert.equal(mutationFor(plan, menuMetaResourceKey), undefined);
  assert.equal(menuItemBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(menuItemBlocker.reason, /nav_menu_item/);
  assert.equal(menuMetaBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(menuMetaBlocker.reason, /_menu_item_object_id/);
  assert.equal(planJson.includes('local-private-menu-item-body'), false);
  assert.equal(planJson.includes('Local private menu item'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
});

test('allows same-plan comment and user graph closure when author and comment targets are created locally', () => {
  const postResourceKey = 'row:["wp_posts","ID:2"]';
  const userResourceKey = 'row:["wp_users","ID:7"]';
  const usermetaResourceKey = 'row:["wp_usermeta","meta_id:61"]';
  const parentCommentResourceKey = 'row:["wp_comments","comment_ID:11"]';
  const childCommentResourceKey = 'row:["wp_comments","comment_ID:12"]';
  const commentmetaResourceKey = 'row:["wp_commentmeta","meta_id:51"]';
  const base = baseSite();
  base.db.wp_users = {};
  base.db.wp_usermeta = {};
  base.db.wp_comments = {};
  base.db.wp_commentmeta = {};
  const local = JSON.parse(JSON.stringify(base));
  const remote = JSON.parse(JSON.stringify(base));

  local.db.wp_users['ID:7'] = {
    ID: 7,
    user_login: 'local-author',
    user_email: 'author@example.test',
    display_name: 'Local Author',
  };
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local authored post',
    post_status: 'draft',
    post_author: 7,
  };
  local.db.wp_usermeta['meta_id:61'] = {
    meta_id: 61,
    user_id: 7,
    meta_key: 'nickname',
    meta_value: 'local-author-nickname',
  };
  local.db.wp_comments['comment_ID:11'] = {
    comment_ID: 11,
    comment_post_ID: 2,
    comment_parent: 0,
    comment_content: 'Local parent comment',
  };
  local.db.wp_comments['comment_ID:12'] = {
    comment_ID: 12,
    comment_post_ID: 2,
    comment_parent: 11,
    comment_content: 'Local child comment',
  };
  local.db.wp_commentmeta['meta_id:51'] = {
    meta_id: 51,
    comment_id: 12,
    meta_key: '_local_comment_flag',
    meta_value: 'comment-private-meta',
  };

  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(mutationFor(plan, userResourceKey).changeKind, 'create');
  assert.equal(mutationFor(plan, postResourceKey).changeKind, 'create');
  assert.equal(mutationFor(plan, usermetaResourceKey).changeKind, 'create');
  assert.equal(mutationFor(plan, parentCommentResourceKey).changeKind, 'create');
  assert.equal(mutationFor(plan, childCommentResourceKey).changeKind, 'create');
  assert.equal(mutationFor(plan, commentmetaResourceKey).changeKind, 'create');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(result.site.db.wp_posts['ID:2'].post_author, 7);
  assert.equal(result.site.db.wp_usermeta['meta_id:61'].user_id, 7);
  assert.equal(result.site.db.wp_comments['comment_ID:11'].comment_post_ID, 2);
  assert.equal(result.site.db.wp_comments['comment_ID:12'].comment_parent, 11);
  assert.equal(result.site.db.wp_commentmeta['meta_id:51'].comment_id, 12);
});

test('blocks post author and usermeta references when the remote user target diverged', () => {
  const postResourceKey = 'row:["wp_posts","ID:2"]';
  const usermetaResourceKey = 'row:["wp_usermeta","meta_id:61"]';
  const targetUserResourceKey = 'row:["wp_users","ID:7"]';
  const base = baseSite();
  base.db.wp_users = {
    'ID:7': {
      ID: 7,
      user_login: 'base-private-user-login',
      user_email: 'base-private-user@example.test',
      display_name: 'Base Private User',
    },
  };
  base.db.wp_usermeta = {};
  const local = JSON.parse(JSON.stringify(base));
  const remote = JSON.parse(JSON.stringify(base));

  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local user-authored post',
    post_status: 'draft',
    post_author: 7,
  };
  local.db.wp_usermeta['meta_id:61'] = {
    meta_id: 61,
    user_id: 7,
    meta_key: 'nickname',
    meta_value: 'local-private-usermeta',
  };
  remote.db.wp_users['ID:7'] = {
    ...remote.db.wp_users['ID:7'],
    user_email: 'remote-private-user@example.test',
    display_name: 'Remote Private User',
  };

  const plan = planFor(base, local, remote);
  const postBlocker = plan.blockers.find((blocker) => blocker.resourceKey === postResourceKey);
  const usermetaBlocker = plan.blockers.find((blocker) => blocker.resourceKey === usermetaResourceKey);
  const planJson = JSON.stringify(plan);

  assert.equal(plan.status, 'blocked');
  assert.equal(mutationFor(plan, postResourceKey), undefined);
  assert.equal(mutationFor(plan, usermetaResourceKey), undefined);
  assert.equal(decisionFor(plan, targetUserResourceKey).decision, 'keep-remote');
  assert.equal(postBlocker.references[0].relationshipType, 'post-author');
  assert.equal(postBlocker.references[0].targetResourceKey, targetUserResourceKey);
  assert.equal(postBlocker.references[0].targetChange.remoteChange, 'update');
  assert.equal(usermetaBlocker.references[0].relationshipType, 'usermeta-user');
  assert.equal(usermetaBlocker.references[0].targetResourceKey, targetUserResourceKey);
  assert.equal(planJson.includes('local-private-usermeta'), false);
  assert.equal(planJson.includes('remote-private-user@example.test'), false);
  assert.equal(planJson.includes('Remote Private User'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
});

test('blocks comment graph references when the remote post target is missing', () => {
  const commentResourceKey = 'row:["wp_comments","comment_ID:11"]';
  const targetPostResourceKey = 'row:["wp_posts","ID:2"]';
  const base = baseSite();
  base.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'base-private-comment-post',
    post_status: 'publish',
  };
  base.db.wp_comments = {};
  const local = JSON.parse(JSON.stringify(base));
  const remote = JSON.parse(JSON.stringify(base));

  local.db.wp_comments['comment_ID:11'] = {
    comment_ID: 11,
    comment_post_ID: 2,
    comment_parent: 0,
    comment_content: 'local-private-comment-body',
  };
  delete remote.db.wp_posts['ID:2'];

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === commentResourceKey);
  const planJson = JSON.stringify(plan);

  assert.equal(plan.status, 'blocked');
  assert.equal(mutationFor(plan, commentResourceKey), undefined);
  assert.equal(decisionFor(plan, targetPostResourceKey).decision, 'keep-remote');
  assert.equal(blocker.references[0].relationshipKey, 'wp_comments.comment_post_ID');
  assert.equal(blocker.references[0].relationshipType, 'comment-post');
  assert.equal(blocker.references[0].targetResourceKey, targetPostResourceKey);
  assert.equal(blocker.references[0].targetChange.remoteChange, 'delete');
  assert.equal(planJson.includes('local-private-comment-body'), false);
  assert.equal(planJson.includes('base-private-comment-post'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
});

test('blocks core user, link, and multisite graph references when targets diverged remotely', () => {
  const sourceResourceKeys = [
    'row:["wp_comments","comment_ID:20"]',
    'row:["wp_links","link_id:8"]',
    'row:["wp_blogs","blog_id:9"]',
    'row:["wp_sitemeta","meta_id:91"]',
    'row:["wp_blogmeta","meta_id:92"]',
    'row:["wp_blog_versions","blog_id:10"]',
    'row:["wp_registration_log","ID:93"]',
  ];
  const base = baseSite();
  base.db.wp_users = {
    'ID:7': {
      ID: 7,
      user_login: 'base-private-user',
      user_email: 'base-private-user@example.test',
      display_name: 'Base Private User',
    },
  };
  base.db.wp_comments = {};
  base.db.wp_links = {};
  base.db.wp_site = {
    'id:1': {
      id: 1,
      domain: 'base-private-network.test',
      path: '/',
    },
  };
  base.db.wp_blogs = {
    'blog_id:9': {
      blog_id: 9,
      site_id: 1,
      domain: 'source-blog.example.test',
      path: '/',
    },
    'blog_id:10': {
      blog_id: 10,
      site_id: 1,
      domain: 'base-private-target-blog.test',
      path: '/',
    },
  };
  base.db.wp_sitemeta = {};
  base.db.wp_blogmeta = {};
  base.db.wp_blog_versions = {};
  base.db.wp_registration_log = {};
  const local = JSON.parse(JSON.stringify(base));
  const remote = JSON.parse(JSON.stringify(base));

  local.db.wp_comments['comment_ID:20'] = {
    comment_ID: 20,
    comment_post_ID: 1,
    user_id: 7,
    comment_content: 'local-private-comment-body',
  };
  local.db.wp_links['link_id:8'] = {
    link_id: 8,
    link_url: 'https://example.test/local-private-link',
    link_name: 'Local private link',
    link_owner: 7,
  };
  local.db.wp_blogs['blog_id:9'].path = '/local-private-source-blog/';
  local.db.wp_sitemeta['meta_id:91'] = {
    meta_id: 91,
    site_id: 1,
    meta_key: 'local_private_site_flag',
    meta_value: 'local-private-sitemeta',
  };
  local.db.wp_blogmeta['meta_id:92'] = {
    meta_id: 92,
    blog_id: 10,
    meta_key: 'local_private_blog_flag',
    meta_value: 'local-private-blogmeta',
  };
  local.db.wp_blog_versions['blog_id:10'] = {
    blog_id: 10,
    db_version: 60000,
    last_updated: '2026-05-24 00:00:00',
  };
  local.db.wp_registration_log['ID:93'] = {
    ID: 93,
    email: 'local-private-registration@example.test',
    IP: '127.0.0.1',
    blog_id: 10,
    date_registered: '2026-05-24 00:00:00',
  };
  remote.db.wp_users['ID:7'].display_name = 'Remote Private User';
  remote.db.wp_site['id:1'].domain = 'remote-private-network.test';
  remote.db.wp_blogs['blog_id:10'].domain = 'remote-private-target-blog.test';

  const plan = planFor(base, local, remote);
  const relationshipTypes = plan.blockers
    .flatMap((blocker) => blocker.references.map((reference) => reference.relationshipType))
    .sort();
  const planJson = JSON.stringify(plan);

  assert.equal(plan.status, 'blocked');
  assert.deepEqual(relationshipTypes, [
    'blog-site',
    'blog-version-blog',
    'blogmeta-blog',
    'comment-user',
    'link-owner',
    'registration-log-blog',
    'sitemeta-site',
  ]);
  for (const resourceKey of sourceResourceKeys) {
    assert.equal(mutationFor(plan, resourceKey), undefined);
  }
  assert.equal(decisionFor(plan, 'row:["wp_users","ID:7"]').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'row:["wp_site","id:1"]').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'row:["wp_blogs","blog_id:10"]').decision, 'keep-remote');
  assert.equal(planJson.includes('local-private-comment-body'), false);
  assert.equal(planJson.includes('local-private-registration@example.test'), false);
  assert.equal(planJson.includes('remote-private-network.test'), false);
  assert.equal(planJson.includes('Remote Private User'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
});

test('allows same-plan core user, link, and multisite graph closure when remote still matches base', () => {
  const base = baseSite();
  base.db.wp_users = {};
  base.db.wp_comments = {};
  base.db.wp_links = {};
  base.db.wp_site = {};
  base.db.wp_blogs = {};
  base.db.wp_sitemeta = {};
  base.db.wp_blogmeta = {};
  base.db.wp_blog_versions = {};
  base.db.wp_registration_log = {};
  const local = JSON.parse(JSON.stringify(base));
  const remote = JSON.parse(JSON.stringify(base));

  local.db.wp_users['ID:7'] = {
    ID: 7,
    user_login: 'local-network-owner',
    user_email: 'network-owner@example.test',
    display_name: 'Local Network Owner',
  };
  local.db.wp_comments['comment_ID:20'] = {
    comment_ID: 20,
    comment_post_ID: 1,
    user_id: 7,
    comment_content: 'Local user-owned comment',
  };
  local.db.wp_links['link_id:8'] = {
    link_id: 8,
    link_url: 'https://example.test/local-link',
    link_name: 'Local link',
    link_owner: 7,
  };
  local.db.wp_site['id:1'] = {
    id: 1,
    domain: 'network.example.test',
    path: '/',
  };
  local.db.wp_blogs['blog_id:9'] = {
    blog_id: 9,
    site_id: 1,
    domain: 'site.example.test',
    path: '/',
  };
  local.db.wp_sitemeta['meta_id:91'] = {
    meta_id: 91,
    site_id: 1,
    meta_key: 'site_flag',
    meta_value: 'local-site-flag',
  };
  local.db.wp_blogmeta['meta_id:92'] = {
    meta_id: 92,
    blog_id: 9,
    meta_key: 'blog_flag',
    meta_value: 'local-blog-flag',
  };
  local.db.wp_blog_versions['blog_id:9'] = {
    blog_id: 9,
    db_version: 60000,
    last_updated: '2026-05-24 00:00:00',
  };
  local.db.wp_registration_log['ID:93'] = {
    ID: 93,
    email: 'site-owner@example.test',
    IP: '127.0.0.1',
    blog_id: 9,
    date_registered: '2026-05-24 00:00:00',
  };

  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 9);
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(result.site.db.wp_comments['comment_ID:20'].user_id, 7);
  assert.equal(result.site.db.wp_links['link_id:8'].link_owner, 7);
  assert.equal(result.site.db.wp_blogs['blog_id:9'].site_id, 1);
  assert.equal(result.site.db.wp_sitemeta['meta_id:91'].site_id, 1);
  assert.equal(result.site.db.wp_blogmeta['meta_id:92'].blog_id, 9);
  assert.equal(result.site.db.wp_blog_versions['blog_id:9'].blog_id, 9);
  assert.equal(result.site.db.wp_registration_log['ID:93'].blog_id, 9);
});

test('blocks a graph row that still references a target deleted in the same local plan', () => {
  const commentResourceKey = 'row:["wp_comments","comment_ID:20"]';
  const userResourceKey = 'row:["wp_users","ID:7"]';
  const base = baseSite();
  base.db.wp_users = {
    'ID:7': {
      ID: 7,
      user_login: 'base-private-user',
      user_email: 'base-private-user@example.test',
      display_name: 'Base Private User',
    },
  };
  base.db.wp_comments = {};
  const local = JSON.parse(JSON.stringify(base));
  const remote = JSON.parse(JSON.stringify(base));

  delete local.db.wp_users['ID:7'];
  local.db.wp_comments['comment_ID:20'] = {
    comment_ID: 20,
    comment_post_ID: 1,
    user_id: 7,
    comment_content: 'local-private-comment-body',
  };

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === commentResourceKey);
  const planJson = JSON.stringify(plan);

  assert.equal(plan.status, 'blocked');
  assert.equal(mutationFor(plan, userResourceKey).action, 'delete');
  assert.equal(mutationFor(plan, commentResourceKey), undefined);
  assert.equal(blocker.references[0].relationshipType, 'comment-user');
  assert.equal(blocker.references[0].targetResourceKey, userResourceKey);
  assert.equal(blocker.references[0].targetChange.localChange, 'delete');
  assert.equal(planJson.includes('local-private-comment-body'), false);
  assert.equal(planJson.includes('base-private-user@example.test'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
});

test('plans a safe same-plan taxonomy closure for a category term, relationship, and termmeta', () => {
  const termResourceKey = 'row:["wp_terms","term_id:21"]';
  const taxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:31"]';
  const relationshipResourceKey = 'row:["wp_term_relationships","object_id:1|term_taxonomy_id:31"]';
  const termmetaResourceKey = 'row:["wp_termmeta","meta_id:41"]';
  const base = baseSite();
  base.db.wp_terms = {};
  base.db.wp_term_taxonomy = {};
  base.db.wp_term_relationships = {};
  base.db.wp_termmeta = {};
  const local = JSON.parse(JSON.stringify(base));
  const remote = JSON.parse(JSON.stringify(base));

  local.db.wp_terms['term_id:21'] = {
    term_id: 21,
    name: 'local-private-category-name',
    slug: 'local-private-category',
  };
  local.db.wp_term_taxonomy['term_taxonomy_id:31'] = {
    term_taxonomy_id: 31,
    term_id: 21,
    taxonomy: 'category',
    parent: 0,
    count: 1,
  };
  local.db.wp_term_relationships['object_id:1|term_taxonomy_id:31'] = {
    object_id: 1,
    term_taxonomy_id: 31,
    term_order: 0,
  };
  local.db.wp_termmeta['meta_id:41'] = {
    meta_id: 41,
    term_id: 21,
    meta_key: '_local_term_private_flag',
    meta_value: 'local-private-termmeta-payload',
  };

  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(mutationFor(plan, termResourceKey).action, 'put');
  assert.equal(mutationFor(plan, termResourceKey).changeKind, 'create');
  assert.equal(mutationFor(plan, taxonomyResourceKey).action, 'put');
  assert.equal(mutationFor(plan, taxonomyResourceKey).changeKind, 'create');
  assert.equal(mutationFor(plan, relationshipResourceKey).action, 'put');
  assert.equal(mutationFor(plan, relationshipResourceKey).changeKind, 'create');
  assert.equal(mutationFor(plan, termmetaResourceKey).action, 'put');
  assert.equal(mutationFor(plan, termmetaResourceKey).changeKind, 'create');
  assert.equal(result.site.db.wp_term_relationships['object_id:1|term_taxonomy_id:31'].term_taxonomy_id, 31);
  assert.equal(result.site.db.wp_termmeta['meta_id:41'].term_id, 21);
});

test('blocks a taxonomy relationship when its same-plan term_taxonomy target is itself blocked', () => {
  const relationshipResourceKey = 'row:["wp_term_relationships","object_id:1|term_taxonomy_id:31"]';
  const taxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:31"]';
  const base = baseSite();
  base.db.wp_terms = {
    'term_id:22': {
      term_id: 22,
      name: 'base-private-parent-term',
      slug: 'base-private-parent',
    },
  };
  base.db.wp_term_taxonomy = {};
  base.db.wp_term_relationships = {};
  const local = JSON.parse(JSON.stringify(base));
  const remote = JSON.parse(JSON.stringify(base));

  local.db.wp_terms['term_id:21'] = {
    term_id: 21,
    name: 'local-private-child-term',
    slug: 'local-private-child',
  };
  local.db.wp_term_taxonomy['term_taxonomy_id:31'] = {
    term_taxonomy_id: 31,
    term_id: 21,
    taxonomy: 'category',
    parent: 22,
    count: 1,
  };
  local.db.wp_term_relationships['object_id:1|term_taxonomy_id:31'] = {
    object_id: 1,
    term_taxonomy_id: 31,
    term_order: 0,
  };
  remote.db.wp_terms['term_id:22'] = {
    term_id: 22,
    name: 'remote-private-parent-term',
    slug: 'remote-private-parent',
  };

  const plan = planFor(base, local, remote);
  const taxonomyBlocker = plan.blockers.find((blocker) => blocker.resourceKey === taxonomyResourceKey);
  const relationshipBlocker = plan.blockers.find((blocker) => blocker.resourceKey === relationshipResourceKey);
  const relationshipJson = JSON.stringify(relationshipBlocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(mutationFor(plan, relationshipResourceKey), undefined);
  assert.equal(taxonomyBlocker.class, 'stale-wordpress-graph-identity');
  assert.equal(relationshipBlocker.class, 'stale-wordpress-graph-identity');
  assert.equal(relationshipBlocker.references[0].relationshipKey, 'wp_term_relationships.term_taxonomy_id');
  assert.equal(relationshipBlocker.references[0].targetResourceKey, taxonomyResourceKey);
  assert.equal(relationshipBlocker.references[0].targetSupport.supported, false);
  assert.equal(relationshipJson.includes('remote-private-parent-term'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
});

test('keeps nav_menu taxonomy graph surfaces blocked', () => {
  const taxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:33"]';
  const relationshipResourceKey = 'row:["wp_term_relationships","object_id:1|term_taxonomy_id:33"]';
  const base = baseSite();
  base.db.wp_terms = {};
  base.db.wp_term_taxonomy = {};
  base.db.wp_term_relationships = {};
  const local = JSON.parse(JSON.stringify(base));
  const remote = JSON.parse(JSON.stringify(base));

  local.db.wp_terms['term_id:23'] = {
    term_id: 23,
    name: 'local-private-menu-term',
    slug: 'local-private-menu',
  };
  local.db.wp_term_taxonomy['term_taxonomy_id:33'] = {
    term_taxonomy_id: 33,
    term_id: 23,
    taxonomy: 'nav_menu',
    parent: 0,
    count: 1,
  };
  local.db.wp_term_relationships['object_id:1|term_taxonomy_id:33'] = {
    object_id: 1,
    term_taxonomy_id: 33,
    term_order: 0,
  };

  const plan = planFor(base, local, remote);
  const taxonomyBlocker = plan.blockers.find((blocker) => blocker.resourceKey === taxonomyResourceKey);
  const relationshipBlocker = plan.blockers.find((blocker) => blocker.resourceKey === relationshipResourceKey);
  const blockerJson = JSON.stringify({ taxonomyBlocker, relationshipBlocker });

  assert.equal(plan.status, 'blocked');
  assert.equal(taxonomyBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(taxonomyBlocker.reason, /unsupported taxonomy graph surface nav_menu/);
  assert.equal(relationshipBlocker.references[0].targetSupport.supported, false);
  assert.equal(blockerJson.includes('local-private-menu-term'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
});

test('keeps custom taxonomy graph surfaces blocked as plugin-owned or ambiguous', () => {
  const taxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:34"]';
  const relationshipResourceKey = 'row:["wp_term_relationships","object_id:1|term_taxonomy_id:34"]';
  const base = baseSite();
  base.db.wp_terms = {};
  base.db.wp_term_taxonomy = {};
  base.db.wp_term_relationships = {};
  const local = JSON.parse(JSON.stringify(base));
  const remote = JSON.parse(JSON.stringify(base));

  local.db.wp_terms['term_id:24'] = {
    term_id: 24,
    name: 'local-private-product-term',
    slug: 'local-private-product',
  };
  local.db.wp_term_taxonomy['term_taxonomy_id:34'] = {
    term_taxonomy_id: 34,
    term_id: 24,
    taxonomy: 'product_cat',
    parent: 0,
    count: 1,
  };
  local.db.wp_term_relationships['object_id:1|term_taxonomy_id:34'] = {
    object_id: 1,
    term_taxonomy_id: 34,
    term_order: 0,
  };

  const plan = planFor(base, local, remote);
  const taxonomyBlocker = plan.blockers.find((blocker) => blocker.resourceKey === taxonomyResourceKey);
  const relationshipBlocker = plan.blockers.find((blocker) => blocker.resourceKey === relationshipResourceKey);
  const blockerJson = JSON.stringify({ taxonomyBlocker, relationshipBlocker });

  assert.equal(plan.status, 'blocked');
  assert.equal(taxonomyBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(taxonomyBlocker.reason, /unsupported taxonomy graph surface product_cat/);
  assert.equal(relationshipBlocker.references[0].targetSupport.supported, false);
  assert.equal(blockerJson.includes('local-private-product-term'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
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
      expectedEvents: ['recovery-claim-opened', 'journal-opened', 'target-planned', 'target-planned', 'recovery-state'],
    },
    {
      code: 'INJECTED_FAILURE_AFTER_STAGING',
      options: { failAfterStaging: true },
      expectedEvents: [
        'recovery-claim-opened',
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
        'recovery-claim-opened',
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
    const durableJournal = openRecoveryJournal(journalPath, {
      truncate: true,
      now: fixedNow,
      claimId: `apply-plan-scenario-${scenario.code}`,
    });

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

  const firstWriter = openRecoveryJournal(journalPath, {
    truncate: true,
    now: fixedNow,
    claimId: 'retrying-old-remote-first-writer',
  });
  const firstError = captureError(() =>
    applyPlan(remote, plan, { failBeforeMutation: true, durableJournal: firstWriter }));
  firstWriter.close();

  assert.ok(firstError instanceof PushPlanError);
  assert.equal(firstError.details.recovery.status, 'old-remote');

  const retryWriter = openRecoveryJournal(journalPath, {
    now: fixedNow,
    claimId: 'retrying-old-remote-retry-writer',
  });
  appendStaleClaimAdvanced(retryWriter, {
    plan,
    current: remote,
    previousClaimId: 'retrying-old-remote-first-writer',
    claimId: 'retrying-old-remote-retry-writer',
    previousClaimAgeMs: 1,
  });
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
  const durableJournal = openRecoveryJournal(journalPath, {
    truncate: true,
    now: fixedNow,
    claimId: 'completed-replay-fresh-durable-journal',
  });

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
      'recovery-claim-opened',
      'journal-opened',
      ...plan.mutations.map(() => 'target-planned'),
      'journal-replayed',
    ],
  );
  assert.equal(persisted.records[0].state, 'active');
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
  const durableJournal = openRecoveryJournal(journalPath, {
    truncate: true,
    now: fixedNow,
    claimId: 'durable-apply-journal-partial-commit',
  });

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
      'recovery-claim-opened',
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

test('durable apply refuses an unfenced journal writer', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:1'].post_title = 'Local title';
  const remote = baseSite();
  const plan = planFor(base, local, remote);

  const error = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal: unfencedDurableJournal(),
    }));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'JOURNAL_OWNERSHIP_REQUIRED');
  assert.equal(error.details.recovery, undefined);
});

test('durable apply refuses a claim-fenced journal writer without a valid claim hash', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:1'].post_title = 'Local title';
  const remote = baseSite();
  const plan = planFor(base, local, remote);

  const error = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal: halfInitializedDurableJournal(),
    }));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'JOURNAL_OWNERSHIP_REQUIRED');
  assert.equal(
    error.message,
    'Durable recovery journal writer must carry a valid claim hash before applyPlan can write to it.',
  );
});

test('durable apply refuses a claim-fenced journal writer when persisted claim ownership is stale', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:1'].post_title = 'Local title';
  const remote = baseSite();
  const plan = planFor(base, local, remote);

  const filePath = tempRecoveryJournalPath();
  const currentClaimJournal = openRecoveryJournal(filePath, {
    truncate: true,
    now: fixedNow,
    claimId: 'psh_01j00000000000000000000000',
  });
  appendRecoveryClaimOpened(currentClaimJournal, {
    plan,
    current: remote,
    claimId: 'psh_01j00000000000000000000000',
  });
  currentClaimJournal.close();

  const staleWriter = openRecoveryJournal(filePath, {
    truncate: false,
    now: fixedNow,
    claimId: 'psh_01j00000000000000000000001',
  });

  const error = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal: staleWriter,
    }));

  staleWriter.close();

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'RECOVERY_CLAIM_STALE');
  assert.match(
    error.message,
    /Durable recovery journal claim was superseded before journal-opened\./,
  );
  assert.equal(error.details.activeClaimHash, recoveryClaimHash('psh_01j00000000000000000000000'));
  assert.equal(error.details.staleClaimHash, recoveryClaimHash('psh_01j00000000000000000000001'));
});

test('durable recovery stays within old remote, fully updated remote, or blocked recovery', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:1'].post_title = 'Local title';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const failureScenarios = [
    {
      label: 'before mutation',
      options: { failBeforeMutation: true },
      expectedRecoveryStatus: 'old-remote',
    },
    {
      label: 'after staging',
      options: { failAfterStaging: true },
      expectedRecoveryStatus: 'old-remote',
    },
    {
      label: 'after dependency validation',
      options: { failAfterDependencyValidation: true },
      expectedRecoveryStatus: 'old-remote',
    },
  ];

  for (const scenario of failureScenarios) {
    const remote = baseSite();
    const before = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, scenario.options));

    assert.ok(error instanceof PushPlanError, scenario.label);
    assert.equal(JSON.stringify(remote), before, scenario.label);
    assert.equal(error.details.recovery.status, scenario.expectedRecoveryStatus, scenario.label);
    assert.ok(error.details.recovery.artifacts.journal, scenario.label);
  }

  const completed = applyPlan(baseSite(), plan);
  const replay = applyPlan(completed.site, plan, { journal: completed.journal });

  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');

  const blockedRemote = JSON.parse(JSON.stringify(completed.site));
  blockedRemote.db.wp_posts['ID:1'].post_title = 'Drifted after completion';
  const blocked = captureError(() => applyPlan(blockedRemote, plan, { journal: completed.journal }));

  assert.ok(blocked instanceof PushPlanError);
  assert.equal(blocked.details.recovery.status, 'blocked-recovery');
  assert.equal(blocked.details.recovery.artifacts.journal.status, 'completed');
  assert.equal(blocked.details.recovery.artifacts.remote.db.wp_posts['ID:1'].post_title, 'Drifted after completion');
});

test('failure before mutation leaves old remote and a recovery artifact', () => {
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
});

test('failure after staging leaves old remote and a recovery artifact', () => {
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
  assert.equal(JSON.stringify(remote), before);
  assert.equal(error.details.recovery.status, 'old-remote');
  assert.equal(error.details.recovery.artifacts.journal.status, 'staged');
});

test('failure after dependency validation leaves old remote and a recovery artifact', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:1'].post_title = 'Local title';
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

test('replaying a completed plan returns the fully updated remote without reapplying mutations', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const completed = applyPlan(remote, plan);
  const completedSnapshot = JSON.stringify(completed.site);

  const replay = applyPlan(completed.site, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(completed.site), completedSnapshot);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
});
