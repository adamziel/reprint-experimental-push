import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ACCEPTABLE_RECOVERY_STATES,
  applyPlan,
  isAcceptableRecoveryState,
  PushPlanError,
  validateRecoveryArtifacts,
} from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import {
  appendRecoveryClaimOpened,
  appendStaleClaimAdvanced,
  assertJournalRecordHasNoRawValues,
  RECOVERY_JOURNAL_SCHEMA_VERSION,
  createUnsupportedProductionRecoveryJournal,
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

function assertAcceptableRecoveryState(recoveryState) {
  assert.ok(recoveryState, 'missing recovery state');
  assert.ok(
    ACCEPTABLE_RECOVERY_STATES.includes(recoveryState.status),
    `unexpected recovery state ${recoveryState.status}`,
  );
  if (recoveryState.status === 'blocked-recovery') {
    assert.ok(recoveryState.artifacts?.journal, 'blocked recovery must carry journal artifacts');
    assert.ok(recoveryState.artifacts?.remote, 'blocked recovery must carry remote artifacts');
    return;
  }

  assert.ok(recoveryState.artifacts?.journal, `${recoveryState.status} recovery must carry journal artifacts`);
  assert.equal(
    recoveryState.artifacts?.remote,
    undefined,
    `${recoveryState.status} recovery must not expose remote artifacts`,
  );
}

function assertFailureRecoveryState(recoveryState, expectedStatus) {
  assertAcceptableRecoveryState(recoveryState);
  assert.equal(recoveryState.status, expectedStatus);
  assert.ok(recoveryState.artifacts?.journal, `${expectedStatus} recovery must carry journal artifacts`);
  if (expectedStatus === 'blocked-recovery') {
    assert.ok(recoveryState.artifacts?.remote, 'blocked recovery must carry remote artifacts');
  } else {
    assert.equal(recoveryState.artifacts.remote, undefined);
  }
}

function assertRecoveryStateArtifacts(recoveryState, expectedStatus) {
  assertFailureRecoveryState(recoveryState, expectedStatus);
}

function assertJournalTailTypes(records, expectedTypes, label) {
  assert.ok(records.length >= expectedTypes.length, label);
  const tail = records.slice(-expectedTypes.length).map((record) => record.type);
  assert.deepEqual(tail, expectedTypes, label);
}

function assertRemoteUnchanged(remote, snapshot) {
  assert.equal(JSON.stringify(remote), snapshot);
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

test('keeps the old remote state when failure happens before any mutation', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const before = JSON.stringify(remote);

  const error = captureError(() => applyPlan(remote, plan, { failBeforeMutation: true }));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'INJECTED_FAILURE_BEFORE_MUTATION');
  assertRemoteUnchanged(remote, before);
  assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
});

test('keeps the old remote state when failure happens after staging', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:1'].post_title = 'Local title';
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const before = JSON.stringify(remote);

  const error = captureError(() => applyPlan(remote, plan, { failAfterStaging: true }));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'INJECTED_FAILURE_AFTER_STAGING');
  assertRemoteUnchanged(remote, before);
  assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
});

test('keeps the old remote state when failure happens after dependency validation', () => {
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
        plugins: [
          {
            name: atomicDependencyPlugin,
            version: '2.1.0',
            hash: resourceHash(local, pluginResource(atomicDependencyPlugin)),
          },
        ],
      },
    },
  ];

  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const before = JSON.stringify(remote);

  const error = captureError(() => applyPlan(remote, plan, { failAfterDependencyValidation: true }));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'INJECTED_FAILURE_AFTER_DEPENDENCY_VALIDATION');
  assertRemoteUnchanged(remote, before);
  assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
});

test('keeps the durable replay contract intact when failure happens after dependency validation', () => {
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
        plugins: [
          {
            name: atomicDependencyPlugin,
            version: '2.1.0',
            hash: resourceHash(local, pluginResource(atomicDependencyPlugin)),
          },
        ],
      },
    },
  ];

  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const before = JSON.stringify(remote);

  const error = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal,
      failAfterDependencyValidation: true,
    }),
  );
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'INJECTED_FAILURE_AFTER_DEPENDENCY_VALIDATION');
  assertRemoteUnchanged(remote, before);
  assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
  assert.equal(error.details.recovery.artifacts.journal.status, 'dependencies-validated');
  assert.equal(error.details.recovery.artifacts.remote, undefined);
  assert.equal(error.details.recovery.artifacts.journal.entries[0].status, 'staged');
  assert.equal(persisted.records[0].type, 'journal-opened');
  assert.equal(persisted.records[persisted.records.length - 1].type, 'recovery-state');
  assert.equal(persisted.records[persisted.records.length - 1].state, 'old-remote');
});

test('atomic recovery contract keeps pre-mutation, post-staging, post-validation, and completed replay inside the approved states', () => {
  const scenarios = [
    ['before mutation', { failBeforeMutation: true }],
    ['after staging', { failAfterStaging: true }],
    ['after dependency validation', { failAfterDependencyValidation: true }],
  ];

  for (const [label, options] of scenarios) {
    const base = baseSite();
    const local = baseSite();
    local.files['index.php'] = '<?php echo "local";';
    local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
    const plan = planFor(base, local, baseSite());
    const remote = baseSite();
    const before = JSON.stringify(remote);

    const error = captureError(() => applyPlan(remote, plan, options));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(error.details.recovery.status, 'old-remote', label);
    assertRemoteUnchanged(remote, before);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
  }

  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());
  const completed = applyPlan(baseSite(), plan);

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
});

test('durable pre-commit failures stay old-remote and a completed replay stays fully-updated', () => {
  const scenarios = [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ];

  for (const [label, options, expectedStatus] of scenarios) {
    const base = baseSite();
    const local = baseSite();
    local.files['index.php'] = '<?php echo "local";';
    local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
    const plan = planFor(base, local, baseSite());

    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const before = JSON.stringify(remote);

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    durableJournal.close();

    assert.ok(failure instanceof PushPlanError, label);
    assertRemoteUnchanged(remote, before);
    assert.equal(
      failure.code,
      options.failBeforeMutation
        ? 'INJECTED_FAILURE_BEFORE_MUTATION'
        : options.failAfterStaging
          ? 'INJECTED_FAILURE_AFTER_STAGING'
          : 'INJECTED_FAILURE_AFTER_DEPENDENCY_VALIDATION',
      label,
    );
    assertAcceptableRecoveryState(failure.details.recovery);
    assertRecoveryStateArtifacts(failure.details.recovery, 'old-remote');
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedStatus, label);
    assert.equal(failure.details.recovery.artifacts.remote, undefined);

    const persisted = readRecoveryJournal(journalPath);
    assert.equal(persisted.records[0].type, 'journal-opened');
    assert.equal(
      persisted.records.some((record) => record.type === 'apply-staged'),
      options.failBeforeMutation ? false : true,
      label,
    );
    assert.equal(
      persisted.records.some((record) => record.type === 'dependencies-validated'),
      options.failAfterDependencyValidation ? true : false,
      label,
    );
    assert.equal(
      persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'old-remote'),
      true,
      label,
    );

    const retryRemote = baseSite();
    const retryJournal = openRecoveryJournal(journalPath, { now: fixedNow });
    const retry = applyPlan(retryRemote, plan, {
      durableJournal: retryJournal,
      journal: failure.details.recovery.artifacts.journal,
    });
    retryJournal.close();

    assert.equal(retry.appliedMutations, plan.mutations.length, label);
    assert.equal(retry.site.files['index.php'], '<?php echo "local";', label);
    assert.equal(retry.site.db.wp_posts['ID:2'].post_title, 'Inserted locally', label);
    assert.equal(Object.keys(retry.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1, label);
    assertAcceptableRecoveryState(retry.recoveryState);
    assertRecoveryStateArtifacts(retry.recoveryState, 'fully-updated-remote');
    assert.equal(retry.recoveryState.artifacts.remote, undefined);
    assert.equal(retry.recoveryState.artifacts.journal.status, 'completed');
  }
});

test('completed plan replay remains inert, keeps inserts stable, and does not resurrect stale local data', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  delete local.db.wp_posts['ID:1'];
  const plan = planFor(base, local, baseSite());
  const completed = applyPlan(baseSite(), plan);

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(tempRecoveryJournalPath(), { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
  assert.equal(Object.hasOwn(replay.site.db.wp_posts, 'ID:1'), false);
});

test('durable completed replay stays fully-updated and remains inspectable from the persisted journal', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  durableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  const inspection = inspectRecoveryJournal({
    journal: readRecoveryJournal(journalPath),
    plan,
    current: replayRemote,
  });

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(inspection.status, 'fully-updated-remote');
  assert.equal(inspection.claim.status, 'none');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
});

test('durable recovery keeps interruption cuts old-remote and completed replay fully-updated with ordered recovery artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const before = JSON.stringify(remote);

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    durableJournal.close();

    const persisted = readRecoveryJournal(journalPath);

    assert.ok(failure instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), before, label);
    assertAcceptableRecoveryState(failure.details.recovery);
    assert.equal(failure.details.recovery.status, 'old-remote', label);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(
      persisted.records[persisted.records.length - 1].type,
      'recovery-state',
      label,
    );
    assert.equal(persisted.records[persisted.records.length - 1].state, 'old-remote', label);
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  const persistedReplay = readRecoveryJournal(completedJournalPath);

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(persistedReplay.records[persistedReplay.records.length - 2].type, 'recovery-state');
  assert.equal(persistedReplay.records[persistedReplay.records.length - 2].state, 'fully-updated-remote');
  assert.equal(persistedReplay.records[persistedReplay.records.length - 1].type, 'journal-replayed');
});

test('durable atomic apply preserves old-remote failures and completed replay through recovery inspection', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());
  const journalPath = tempRecoveryJournalPath();

  for (const [label, options, expectedJournalStatus, expectedCode] of [
    ['before mutation', { failBeforeMutation: true }, 'opened', 'INJECTED_FAILURE_BEFORE_MUTATION'],
    ['after staging', { failAfterStaging: true }, 'staged', 'INJECTED_FAILURE_AFTER_STAGING'],
    [
      'after dependency validation',
      { failAfterDependencyValidation: true },
      'dependencies-validated',
      'INJECTED_FAILURE_AFTER_DEPENDENCY_VALIDATION',
    ],
  ]) {
    const writer = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const before = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, { durableJournal: writer, ...options }));
    writer.close();

    const persisted = readRecoveryJournal(journalPath);
    const inspection = inspectRecoveryJournal({ journal: persisted, plan, current: remote });

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(error.code, expectedCode, label);
    assert.equal(JSON.stringify(remote), before, label);
    assert.equal(error.details.recovery.status, 'old-remote', label);
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(inspection.status, 'old-remote', label);
    assert.equal(persisted.integrity.status, 'ok', label);
  }

  const completedWriter = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedWriter });
  completedWriter.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayWriter = openRecoveryJournal(journalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal: replayWriter,
  });
  replayWriter.close();

  const persisted = readRecoveryJournal(journalPath);
  const inspection = inspectRecoveryJournal({ journal: persisted, plan, current: replayRemote });

  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(inspection.status, 'fully-updated-remote');
  assert.equal(inspection.claim.status, 'none');
  assert.ok(persisted.records.some((record) => record.type === 'recovery-state'));
  assert.ok(persisted.records.some((record) => record.type === 'journal-replayed'));
  assert.equal(JSON.stringify(replayRemote), JSON.stringify(completed.site));
});

test('durable completed replay stays inert across repeated retries and does not duplicate recovery evidence', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  durableJournal.close();

  const firstReplayRemote = JSON.parse(JSON.stringify(completed.site));
  const firstReplaySnapshot = JSON.stringify(firstReplayRemote);
  const firstReplayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const firstReplay = applyPlan(firstReplayRemote, plan, {
    durableJournal: firstReplayJournal,
    journal: completed.journal,
  });
  firstReplayJournal.close();

  const secondReplayRemote = JSON.parse(JSON.stringify(firstReplay.site));
  const secondReplaySnapshot = JSON.stringify(secondReplayRemote);
  const secondReplayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const secondReplay = applyPlan(secondReplayRemote, plan, {
    durableJournal: secondReplayJournal,
    journal: completed.journal,
  });
  secondReplayJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(firstReplayRemote), firstReplaySnapshot);
  assert.equal(JSON.stringify(secondReplayRemote), secondReplaySnapshot);
  assert.equal(firstReplay.appliedMutations, 0);
  assert.equal(secondReplay.appliedMutations, 0);
  assertAcceptableRecoveryState(firstReplay.recoveryState);
  assertAcceptableRecoveryState(secondReplay.recoveryState);
  assert.equal(firstReplay.recoveryState.status, 'fully-updated-remote');
  assert.equal(secondReplay.recoveryState.status, 'fully-updated-remote');
  assert.equal(firstReplay.recoveryState.artifacts.remote, undefined);
  assert.equal(secondReplay.recoveryState.artifacts.remote, undefined);
  assert.equal(firstReplay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(secondReplay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(firstReplay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(secondReplay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(secondReplay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
  assert.equal(
    persisted.records.filter((record) => record.type === 'journal-replayed').length,
    2,
  );
  assert.equal(
    persisted.records.filter((record) => record.type === 'recovery-state' && record.state === 'fully-updated-remote').length,
    3,
  );
  assert.equal(persisted.integrity.status, 'ok');
});

test('supported recovery boundaries only resolve to old-remote, fully-updated-remote, or blocked-recovery', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const boundaryScenarios = [
    ['before mutation', { failBeforeMutation: true }, 'old-remote'],
    ['after staging', { failAfterStaging: true }, 'old-remote'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'old-remote'],
    ['completed replay', {}, 'fully-updated-remote'],
  ];

  for (const [label, options, expectedStatus] of boundaryScenarios) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();

    let result;
    if (label === 'completed replay') {
      result = applyPlan(remote, plan, { durableJournal });
      durableJournal.close();
      assertAcceptableRecoveryState(result.recoveryState);
      assertRecoveryStateArtifacts(result.recoveryState, expectedStatus);
      assert.equal(result.recoveryState.artifacts.remote, undefined);
      assert.equal(result.recoveryState.artifacts.journal.status, 'completed');
      assert.equal(result.appliedMutations, plan.mutations.length);
      assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
      assert.equal(Object.keys(result.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
      continue;
    }

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );
    durableJournal.close();

    assert.ok(failure instanceof PushPlanError, label);
    assertAcceptableRecoveryState(failure.details.recovery);
    assertRecoveryStateArtifacts(failure.details.recovery, expectedStatus);
    assert.equal(failure.details.recovery.artifacts.remote, undefined);
    assert.equal(
      readRecoveryJournal(journalPath).records.some(
        (record) => record.type === 'recovery-state' && record.state === expectedStatus,
      ),
      true,
      label,
    );
  }
});

test('keeps the durable old-remote contract intact when failure happens before mutation', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const before = JSON.stringify(remote);

  const error = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal,
      failBeforeMutation: true,
    }),
  );
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'INJECTED_FAILURE_BEFORE_MUTATION');
  assertRemoteUnchanged(remote, before);
  assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
  assert.equal(error.details.recovery.artifacts.journal.status, 'opened');
  assert.equal(error.details.recovery.artifacts.remote, undefined);
  assert.equal(persisted.records[0].type, 'journal-opened');
  assert.equal(persisted.records[persisted.records.length - 1].type, 'recovery-state');
  assert.equal(persisted.records[persisted.records.length - 1].state, 'old-remote');
});

test('durable recovery journals keep the old remote contract across the interruption boundaries', () => {
  const scenarios = [
    {
      name: 'before mutation',
      options: { failBeforeMutation: true },
      expectedRecoveryStatus: 'old-remote',
      expectedLastState: 'old-remote',
    },
    {
      name: 'after staging',
      options: { failAfterStaging: true },
      expectedRecoveryStatus: 'old-remote',
      expectedLastState: 'old-remote',
    },
    {
      name: 'after dependency validation',
      options: { failAfterDependencyValidation: true },
      expectedRecoveryStatus: 'old-remote',
      expectedLastState: 'old-remote',
    },
  ];

  for (const scenario of scenarios) {
    const base = baseSite();
    const local = baseSite();
    local.files['index.php'] = '<?php echo "local";';
    local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
    const remote = baseSite();
    const plan = planFor(base, local, remote);
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const before = JSON.stringify(remote);

    const error = captureError(() => applyPlan(remote, plan, {
      ...scenario.options,
      durableJournal,
    }));
    durableJournal.close();

    const persisted = readRecoveryJournal(journalPath);

    assert.ok(error instanceof PushPlanError, scenario.name);
    assert.equal(JSON.stringify(remote), before, scenario.name);
    assert.equal(error.details.recovery.status, scenario.expectedRecoveryStatus, scenario.name);
    assert.equal(error.details.recovery.artifacts.remote, undefined, scenario.name);
    assert.equal(error.details.recovery.artifacts.journal.planId, plan.id, scenario.name);
    assert.equal(persisted.records[0].type, 'journal-opened', scenario.name);
    assert.equal(persisted.records[persisted.records.length - 1].type, 'recovery-state', scenario.name);
    assert.equal(persisted.records[persisted.records.length - 1].state, scenario.expectedLastState, scenario.name);
  }
});

test('atomic apply keeps the documented recovery states across failure boundaries and completed replay', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);

  const failureScenarios = [
    ['before mutation', { failBeforeMutation: true }, 'old-remote', 'opened'],
    ['after staging', { failAfterStaging: true }, 'old-remote', 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'old-remote', 'dependencies-validated'],
  ];

  for (const [label, options, expectedStatus, expectedJournalStatus] of failureScenarios) {
    const before = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, options));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), before, label);
    assertAcceptableRecoveryState(error.details.recovery, label);
    assertRecoveryStateArtifacts(error.details.recovery, expectedStatus);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(error.details.recovery.artifacts.journal.planId, plan.id, label);
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
  }

  const completed = applyPlan(remote, plan);
  assertAcceptableRecoveryState(completed.recoveryState);
  assertRecoveryStateArtifacts(completed.recoveryState, 'fully-updated-remote');
  assert.equal(completed.recoveryState.artifacts.remote, undefined);
  assert.equal(completed.recoveryState.artifacts.journal.status, 'completed');

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(
    replay.recoveryState.artifacts.journal.entries.every((entry) => entry.status === 'applied'),
    true,
  );
});

test('no-data-loss recovery keeps the four named boundaries inside the durable contract', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const scenarios = [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ];

  for (const [label, options, expectedJournalStatus] of scenarios) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const snapshot = JSON.stringify(remote);

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    durableJournal.close();

    assert.ok(failure instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), snapshot, label);
    assertAcceptableRecoveryState(failure.details.recovery);
    assert.equal(failure.details.recovery.status, 'old-remote', label);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(
      readRecoveryJournal(journalPath).records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
      false,
      label,
    );

    assert.equal(readRecoveryJournal(journalPath).records.some((record) => record.type === 'recovery-state' && record.state === 'fully-updated-remote'), false, label);
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
});

test('atomic apply preserves the approved recovery envelope for pre-mutation, post-staging, post-validation, and completed replay states', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const failureCases = [
    ['before mutation', { failBeforeMutation: true }, 'old-remote', 'opened'],
    ['after staging', { failAfterStaging: true }, 'old-remote', 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'old-remote', 'dependencies-validated'],
  ];

  for (const [label, options, expectedStatus, expectedJournalStatus] of failureCases) {
    const before = JSON.stringify(remote);
    const durableJournal = openRecoveryJournal(tempRecoveryJournalPath(), { truncate: true, now: fixedNow });
    const error = captureError(() => applyPlan(remote, plan, { durableJournal, ...options }));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), before, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, expectedStatus);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(error.details.recovery.artifacts.journal.planId, plan.id, label);
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    durableJournal.close();
  }

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(remote, plan, { durableJournal });
  assertAcceptableRecoveryState(completed.recoveryState);
  assertRecoveryStateArtifacts(completed.recoveryState, 'fully-updated-remote');
  assert.equal(completed.recoveryState.artifacts.remote, undefined);
  assert.equal(completed.recoveryState.artifacts.journal.status, 'completed');

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal, durableJournal: replayJournal });

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');

  durableJournal.close();
  replayJournal.close();
});

test('atomic apply keeps only the documented recovery states across the durable failure boundaries and completed replay', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);

  for (const options of [
    { failBeforeMutation: true },
    { failAfterStaging: true },
    { failAfterDependencyValidation: true },
  ]) {
    const snapshot = JSON.stringify(remote);
    const durableJournal = openRecoveryJournal(tempRecoveryJournalPath(), { truncate: true, now: fixedNow });
    const error = captureError(() => applyPlan(remote, plan, { durableJournal, ...options }));

    assert.ok(error instanceof PushPlanError);
    assert.equal(JSON.stringify(remote), snapshot);
    assert.equal(isAcceptableRecoveryState(error.details.recovery), true);
    assert.equal(
      ['old-remote', 'blocked-recovery'].includes(error.details.recovery.status),
      true,
    );
    assert.equal(error.details.recovery.artifacts.journal.planId, plan.id);
    durableJournal.close();
  }

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(remote, plan, { durableJournal });
  assert.equal(isAcceptableRecoveryState(completed.recoveryState), true);
  assert.equal(completed.recoveryState.status, 'fully-updated-remote');

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal, durableJournal: replayJournal });

  assert.equal(isAcceptableRecoveryState(replay.recoveryState), true);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');

  durableJournal.close();
  replayJournal.close();
});

test('replaying a completed plan stays inert and does not duplicate inserted resources', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);

  const completed = applyPlan(remote, plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
});

test('replaying a completed plan blocks stale remote drift and preserves recovery artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const completed = applyPlan(remote, plan);

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  replayRemote.db.wp_posts['ID:2'].post_title = 'Remote drift after completion';
  const replayBefore = JSON.stringify(replayRemote);
  const error = captureError(() =>
    applyPlan(replayRemote, plan, { journal: completed.journal }),
  );

  assert.ok(error instanceof PushPlanError);
  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(error.details.recovery.status, 'blocked-recovery');
  assert.ok(error.details.recovery.artifacts?.journal);
  assert.ok(error.details.recovery.artifacts?.remote);
  assert.equal(error.details.recovery.artifacts.journal.status, 'completed');
  assert.equal(error.details.recovery.artifacts.remote.db.wp_posts['ID:2'].post_title, 'Remote drift after completion');
});

test('atomic recovery boundaries keep the old remote contract before mutation, after staging, after validation, and on completed replay', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const snapshot = JSON.stringify(remote);
    const durableJournal = openRecoveryJournal(tempRecoveryJournalPath(), { truncate: true, now: fixedNow });
    const error = captureError(() => applyPlan(remote, plan, { durableJournal, ...options }));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), snapshot, label);
    assert.equal(error.code.startsWith('INJECTED_FAILURE_'), true, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(error.details.recovery.artifacts.journal.planId, plan.id, label);
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    durableJournal.close();
  }

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(remote, plan, { durableJournal });
  assertAcceptableRecoveryState(completed.recoveryState);
  assertRecoveryStateArtifacts(completed.recoveryState, 'fully-updated-remote');
  assert.equal(completed.recoveryState.artifacts.remote, undefined);
  assert.equal(completed.recoveryState.artifacts.journal.status, 'completed');

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');

  durableJournal.close();
  replayJournal.close();
});

test('durable atomic apply only lands in old remote, fully updated remote, or blocked recovery with artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const failureCases = [
    ['before mutation', { failBeforeMutation: true }, 'old-remote', 'opened'],
    ['after staging', { failAfterStaging: true }, 'old-remote', 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'old-remote', 'dependencies-validated'],
  ];

  for (const [label, options, expectedStatus, expectedJournalStatus] of failureCases) {
    const snapshot = JSON.stringify(remote);
    const durableJournal = openRecoveryJournal(tempRecoveryJournalPath(), { truncate: true, now: fixedNow });
    const error = captureError(() => applyPlan(remote, plan, { durableJournal, ...options }));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(error.code.startsWith('INJECTED_FAILURE_'), true, label);
    assert.equal(JSON.stringify(remote), snapshot, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, expectedStatus);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(error.details.recovery.artifacts.journal.planId, plan.id, label);
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    durableJournal.close();
  }

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(remote, plan, { durableJournal });
  assertAcceptableRecoveryState(completed.recoveryState);
  assertRecoveryStateArtifacts(completed.recoveryState, 'fully-updated-remote');
  assert.equal(completed.recoveryState.artifacts.remote, undefined);
  assert.equal(completed.recoveryState.artifacts.journal.status, 'completed');

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.journal.entries.length, plan.mutations.length);

  durableJournal.close();
  replayJournal.close();
});

test('durable recovery contract keeps failure-before-mutation, failure-after-staging, failure-after-validation, and completed replay inside the approved states', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const snapshot = JSON.stringify(remote);
    const durableJournal = openRecoveryJournal(tempRecoveryJournalPath(), { truncate: true, now: fixedNow });
    const error = captureError(() => applyPlan(remote, plan, { durableJournal, ...options }));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), snapshot, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(error.details.recovery.artifacts.journal.planId, plan.id, label);
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    durableJournal.close();
  }

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(remote, plan, { durableJournal });
  assertAcceptableRecoveryState(completed.recoveryState);
  assertRecoveryStateArtifacts(completed.recoveryState, 'fully-updated-remote');
  assert.equal(completed.recoveryState.artifacts.remote, undefined);
  assert.equal(completed.recoveryState.artifacts.journal.status, 'completed');

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');

  durableJournal.close();
  replayJournal.close();
});

test('completed replay remains inert for a matching remote and blocks drift with inspectable artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const plan = planFor(base, local, baseSite());
  const completedJournalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  durableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);

  const driftedRemote = JSON.parse(JSON.stringify(completed.site));
  driftedRemote.files['index.php'] = '<?php echo "drifted";';
  const replayJournalPath = tempRecoveryJournalPath();
  const replayJournal = openRecoveryJournal(replayJournalPath, { truncate: true, now: fixedNow });
  const driftError = captureError(() =>
    applyPlan(driftedRemote, plan, {
      durableJournal: replayJournal,
      journal: completed.journal,
    }),
  );
  replayJournal.close();

  assert.ok(driftError instanceof PushPlanError);
  assert.equal(driftError.code, 'RECOVERY_BLOCKED');
  assertRecoveryStateArtifacts(driftError.details.recovery, 'blocked-recovery');
  assert.ok(driftError.details.recovery.artifacts.journal, 'stale replay must keep journal artifacts');
  assert.ok(driftError.details.recovery.artifacts.remote, 'stale replay must keep remote artifacts');
  const persistedBlockedRecovery = readRecoveryJournal(replayJournalPath).records.find(
    (record) => record.type === 'recovery-state' && record.state === 'blocked-recovery',
  );
  assert.match(persistedBlockedRecovery.artifactRefs.remote, /^[a-f0-9]{64}$/);
});

test('durable recovery matrix keeps the three failure boundaries old-remote and a completed replay fully-updated', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);

  const failureCases = [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ];

  for (const [label, options, expectedJournalStatus] of failureCases) {
    const snapshot = JSON.stringify(remote);
    const durableJournal = openRecoveryJournal(tempRecoveryJournalPath(), { truncate: true, now: fixedNow });
    const error = captureError(() => applyPlan(remote, plan, { durableJournal, ...options }));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), snapshot, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(error.details.recovery.artifacts.journal.planId, plan.id, label);
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    durableJournal.close();
  }

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(remote, plan, { durableJournal });
  assertAcceptableRecoveryState(completed.recoveryState);
  assertRecoveryStateArtifacts(completed.recoveryState, 'fully-updated-remote');
  assert.equal(completed.recoveryState.artifacts.remote, undefined);
  assert.equal(completed.recoveryState.artifacts.journal.status, 'completed');

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');

  durableJournal.close();
  replayJournal.close();
});

test('atomic apply only allows old remote, fully updated remote, or blocked recovery with artifacts across failure boundaries', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);

  const failureCases = [
    ['before mutation', { failBeforeMutation: true }, 'old-remote'],
    ['after staging', { failAfterStaging: true }, 'old-remote'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'old-remote'],
  ];

  for (const [label, options, expectedStatus] of failureCases) {
    const before = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, options));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), before, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, expectedStatus);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(error.details.recovery.artifacts.journal.planId, plan.id, label);
  }

  const completed = applyPlan(remote, plan);
  assertAcceptableRecoveryState(completed.recoveryState);
  assertRecoveryStateArtifacts(completed.recoveryState, 'fully-updated-remote');
  assert.equal(completed.recoveryState.artifacts.remote, undefined);
  assert.equal(completed.recoveryState.artifacts.journal.status, 'completed');

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
});

test('mid-apply partial recovery stays blocked with artifacts and replaying the completed journal remains inert', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });

  const before = JSON.stringify(remote);
  const error = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal,
      failDuringCommitAtMutation: 1,
    }),
  );
  durableJournal.close();

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'INJECTED_FAILURE_DURING_COMMIT');
  assert.equal(JSON.stringify(remote), before);
  assertAcceptableRecoveryState(error.details.recovery);
  assertRecoveryStateArtifacts(error.details.recovery, 'blocked-recovery');
  assert.ok(error.details.recovery.artifacts.remote, 'mid-apply failure must keep remote artifacts');
  assert.ok(error.details.recovery.artifacts.journal, 'mid-apply failure must keep journal artifacts');
  assert.equal(error.details.recovery.artifacts.journal.planId, plan.id);
});

test('durable completed replay blocks partial drift instead of treating it as a safe replay', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });

  const completed = applyPlan(remote, plan, { durableJournal });
  durableJournal.close();

  const driftedRemote = JSON.parse(JSON.stringify(completed.site));
  driftedRemote.files['index.php'] = '<?php echo "drifted";';
  const driftedSnapshot = JSON.stringify(driftedRemote);
  const retryJournal = openRecoveryJournal(tempRecoveryJournalPath(), { truncate: true, now: fixedNow });

  const error = captureError(() =>
    applyPlan(driftedRemote, plan, {
      durableJournal: retryJournal,
      journal: completed.journal,
    }),
  );
  retryJournal.close();

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'RECOVERY_BLOCKED');
  assert.equal(JSON.stringify(driftedRemote), driftedSnapshot);
  assertRecoveryStateArtifacts(error.details.recovery, 'blocked-recovery');
  assert.ok(error.details.recovery.artifacts.journal, 'stale replay must keep journal artifacts');
  assert.ok(error.details.recovery.artifacts.remote, 'stale replay must keep remote artifacts');
  assert.equal(error.details.recovery.artifacts.journal.status, 'completed');
  assert.equal(error.details.recovery.artifacts.remote.files['index.php'], '<?php echo "drifted";');
});

test('completed replay on a durable journal stays inert and does not resurrect stale local data', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const plan = planFor(base, local, baseSite());
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  durableJournal.close();

  local.files['index.php'] = '<?php echo "stale-local";';
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
});

test('durable completed replay keeps inserts stable and appends no new mutation evidence', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const plan = planFor(base, local, baseSite());
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  const persistedBeforeReplay = readRecoveryJournal(journalPath);

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal, durableJournal: replayJournal });
  const persistedAfterReplay = readRecoveryJournal(journalPath);

  durableJournal.close();
  replayJournal.close();

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(
    persistedAfterReplay.records.filter((record) => record.type === 'mutation-observed').length,
    persistedBeforeReplay.records.filter((record) => record.type === 'mutation-observed').length,
  );
  assert.equal(
    persistedAfterReplay.records.filter((record) => record.type === 'journal-replayed').length,
    persistedBeforeReplay.records.filter((record) => record.type === 'journal-replayed').length + 1,
  );
  assert.equal(
    persistedAfterReplay.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
    false,
  );
});

test('replaying a completed plan after a prior interruption keeps stale inserts inert and preserves the approved recovery state', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const plan = planFor(base, local, baseSite());
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  durableJournal.close();

  local.files['index.php'] = '<?php echo "stale-local";';
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);

  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
  });

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
});

test('accepts only old remote, fully updated remote, or blocked recovery across the atomic apply boundary', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);

  const failureScenarios = [
    ['before mutation', { failBeforeMutation: true }, 'old-remote'],
    ['after staging', { failAfterStaging: true }, 'old-remote'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'old-remote'],
  ];

  for (const [label, options, expectedStatus] of failureScenarios) {
    const snapshot = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, options));

    assert.equal(JSON.stringify(remote), snapshot, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, expectedStatus);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(error.details.recovery.artifacts.journal.planId, plan.id, label);
  }

  const completed = applyPlan(remote, plan);
  assertAcceptableRecoveryState(completed.recoveryState);
  assertRecoveryStateArtifacts(completed.recoveryState, 'fully-updated-remote');

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
});

test('completed replay stays inert and does not duplicate inserts or stale local data', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());
  const completed = applyPlan(baseSite(), plan);

  local.files['index.php'] = '<?php echo "stale-local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Stale local insert', post_status: 'draft' };

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
});

test('durable completed replay stays inert after stale local changes and keeps the insert set stable', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });

  local.files['index.php'] = '<?php echo "stale-local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Stale local insert', post_status: 'draft' };

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });
  durableJournal.close();

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
});

test('blocks a completed replay when the remote drifts and preserves recovery artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());
  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  replayRemote.files['index.php'] = '<?php echo "drifted";';
  const before = JSON.stringify(replayRemote);

  const error = captureError(() => applyPlan(replayRemote, plan, { journal: completed.journal }));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'RECOVERY_BLOCKED');
  assert.equal(JSON.stringify(replayRemote), before);
  assertRecoveryStateArtifacts(error.details.recovery, 'blocked-recovery');
  assert.ok(error.details.recovery.artifacts.remote, 'blocked recovery must keep remote artifacts');
  assert.equal(error.details.recovery.artifacts.journal.status, 'completed');
});

test('completed replay stays append-only under a durable journal and blocks stale drift', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });

  const driftedRemote = JSON.parse(JSON.stringify(completed.site));
  driftedRemote.files['index.php'] = '<?php echo "drifted";';
  const driftError = captureError(() =>
    applyPlan(driftedRemote, plan, {
      journal: completed.journal,
      durableJournal,
    }),
  );
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.ok(driftError instanceof PushPlanError);
  assert.equal(driftError.details.recovery.status, 'blocked-recovery');
  assert.ok(driftError.details.recovery.artifacts.journal);
  assert.ok(driftError.details.recovery.artifacts.remote);
  assert.equal(driftError.details.recovery.artifacts.remote.files['index.php'], '<?php echo "drifted";');
  assert.equal(
    persisted.records.filter((record) => record.type === 'journal-replayed').length,
    1,
  );
  assert.equal(
    persisted.records.filter((record) => record.type === 'journal-opened').length,
    1,
  );
});

test('replays a completed plan without reapplying mutations', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:1'].post_title = 'Local title';
  const remote = baseSite();
  const readyPlan = planFor(base, local, remote);
  const applied = applyPlan(remote, readyPlan);
  const completedJournal = applied.journal;
  const replayRemote = JSON.parse(JSON.stringify(applied.site));
  const before = JSON.stringify(replayRemote);

  const replay = applyPlan(replayRemote, readyPlan, { journal: completedJournal });

  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.journal.status, 'completed');
  assertRemoteUnchanged(replayRemote, before);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
});

test('replaying a completed plan ignores later stale local source changes', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const completed = applyPlan(remote, plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));

  local.files['index.php'] = '<?php echo "stale-local";';
  local.db.wp_posts['ID:2'].post_title = 'Stale local insert';

  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replayRemote.files['index.php'], '<?php echo "local";');
  assert.equal(replayRemote.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
});

test('durable completed replay stays inert after local divergence and preserves the completed recovery envelope', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });

  const completed = applyPlan(remote, plan, { durableJournal });
  durableJournal.close();

  local.files['index.php'] = '<?php echo "stale-local";';
  local.db.wp_posts['ID:2'].post_title = 'Stale local insert';

  const replayJournalPath = tempRecoveryJournalPath();
  const replayDurableJournal = openRecoveryJournal(replayJournalPath, { truncate: true, now: fixedNow });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const before = JSON.stringify(replayRemote);

  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal: replayDurableJournal,
  });
  replayDurableJournal.close();

  const persisted = readRecoveryJournal(replayJournalPath);

  assert.equal(JSON.stringify(replayRemote), before);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(persisted.records[persisted.records.length - 2].type, 'recovery-state');
  assert.equal(persisted.records[persisted.records.length - 1].type, 'journal-replayed');
  assert.equal(persisted.records[persisted.records.length - 1].state, 'fully-updated-remote');
  assert.equal(persisted.integrity.status, 'ok');
});

test('blocks a stale completed replay when the remote drifted after completion', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const completed = applyPlan(remote, plan);
  const staleReplayRemote = JSON.parse(JSON.stringify(completed.site));
  staleReplayRemote.files['index.php'] = '<?php echo "drifted";';
  const before = JSON.stringify(staleReplayRemote);

  const error = captureError(() => applyPlan(staleReplayRemote, plan, { journal: completed.journal }));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'RECOVERY_BLOCKED');
  assertRemoteUnchanged(staleReplayRemote, before);
  assertRecoveryStateArtifacts(error.details.recovery, 'blocked-recovery');
  assert.ok(error.details.recovery.artifacts.remote, 'blocked replay must carry remote artifacts');
});

test('completed replay stays inert on retry and blocks later drift with inspectable artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const completed = applyPlan(remote, plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);

  const firstReplay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(firstReplay.appliedMutations, 0);
  assert.equal(firstReplay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(firstReplay.site.files['index.php'], '<?php echo "local";');
  assertRecoveryStateArtifacts(firstReplay.recoveryState, 'fully-updated-remote');
  assert.equal(firstReplay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(firstReplay.recoveryState.artifacts.remote, undefined);

  replayRemote.files['index.php'] = '<?php echo "drifted";';
  const driftSnapshot = JSON.stringify(replayRemote);
  const blocked = captureError(() => applyPlan(replayRemote, plan, { journal: completed.journal }));

  assert.equal(JSON.stringify(replayRemote), driftSnapshot);
  assert.ok(blocked instanceof PushPlanError);
  assert.equal(blocked.code, 'RECOVERY_BLOCKED');
  assertRecoveryStateArtifacts(blocked.details.recovery, 'blocked-recovery');
  assert.ok(blocked.details.recovery.artifacts.remote, 'blocked replay must retain remote artifacts');
  assert.equal(blocked.details.recovery.artifacts.journal.status, 'completed');
  assert.equal(blocked.details.recovery.artifacts.remote.files['index.php'], '<?php echo "drifted";');
  assert.equal(blocked.details.recovery.artifacts.remote.db.wp_posts['ID:2'].post_title, 'Inserted locally');
});

test('documented post-failure states stay limited to old remote, fully updated remote, or blocked recovery', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const recoveryScenarios = [
    ['before mutation', { failBeforeMutation: true }, 'old-remote'],
    ['after staging', { failAfterStaging: true }, 'old-remote'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'old-remote'],
  ];

  for (const [label, options, expectedStatus] of recoveryScenarios) {
    const snapshot = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, options));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), snapshot, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, expectedStatus);
    assert.equal(error.details.recovery.artifacts.journal.planId, plan.id, label);
  }

  const completed = applyPlan(remote, plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');

  const blockedRemote = JSON.parse(JSON.stringify(completed.site));
  blockedRemote.files['index.php'] = '<?php echo "stale local";';
  const blocked = captureError(() => applyPlan(blockedRemote, plan, { journal: completed.journal }));

  assert.ok(blocked instanceof PushPlanError);
  assert.equal(blocked.code, 'RECOVERY_BLOCKED');
  assertAcceptableRecoveryState(blocked.details.recovery);
  assertRecoveryStateArtifacts(blocked.details.recovery, 'blocked-recovery');
  assert.ok(blocked.details.recovery.artifacts.remote, 'blocked recovery must carry remote artifacts');
});

test('accepts only the documented post-failure states for atomic apply recovery', () => {
  const scenarios = [
    {
      name: 'failure before mutation',
      options: { failBeforeMutation: true },
      expectedStatus: 'old-remote',
      expectedJournalStatus: 'opened',
    },
    {
      name: 'failure after staging',
      options: { failAfterStaging: true },
      expectedStatus: 'old-remote',
      expectedJournalStatus: 'staged',
    },
    {
      name: 'failure after dependency validation',
      options: { failAfterDependencyValidation: true },
      expectedStatus: 'old-remote',
      expectedJournalStatus: 'dependencies-validated',
    },
    {
      name: 'completed replay',
      expectedStatus: 'fully-updated-remote',
      expectedJournalStatus: 'completed',
      replay: true,
    },
  ];

  for (const scenario of scenarios) {
    const base = baseSite();
    const local = baseSite();
    local.files['index.php'] = '<?php echo "local";';
    local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
    const remote = baseSite();
    const plan = planFor(base, local, remote);

    if (scenario.replay) {
      const completed = applyPlan(remote, plan);
      const replayRemote = JSON.parse(JSON.stringify(completed.site));
      const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

      assert.equal(replay.appliedMutations, 0, scenario.name);
      assert.equal(replay.recoveryState.status, scenario.expectedStatus, scenario.name);
      assert.equal(replay.journal.status, scenario.expectedJournalStatus, scenario.name);
      assertRecoveryStateArtifacts(replay.recoveryState, scenario.expectedStatus);
      assert.equal(replayRemote.db.wp_posts['ID:2'].post_title, 'Inserted locally', scenario.name);
      continue;
    }

    const before = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, scenario.options));

    assert.ok(error instanceof PushPlanError, scenario.name);
    assert.equal(JSON.stringify(remote), before, scenario.name);
    assert.equal(error.details.recovery.status, scenario.expectedStatus, scenario.name);
    assert.equal(error.details.recovery.artifacts.journal.status, scenario.expectedJournalStatus, scenario.name);
    assertRecoveryStateArtifacts(error.details.recovery, scenario.expectedStatus);
  }
});

test('codifies the no-data-loss recovery matrix across failure boundaries and completed replay', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);

  const failureScenarios = [
    ['before mutation', { failBeforeMutation: true }, 'old-remote'],
    ['after staging', { failAfterStaging: true }, 'old-remote'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'old-remote'],
  ];

  for (const [label, options, expectedStatus] of failureScenarios) {
    const snapshot = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, options));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), snapshot, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, expectedStatus);
    assert.equal(error.details.recovery.artifacts.journal.planId, plan.id, label);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
  }

  const completed = applyPlan(remote, plan);
  assertAcceptableRecoveryState(completed.recoveryState);
  assertRecoveryStateArtifacts(completed.recoveryState, 'fully-updated-remote');
  assert.equal(completed.appliedMutations, 2);

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
});

test('keeps every interrupted apply in the old remote state and completed replay in the fully updated state', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);

  const failureScenarios = [
    ['before mutation', { failBeforeMutation: true }, 'old-remote'],
    ['after staging', { failAfterStaging: true }, 'old-remote'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'old-remote'],
  ];

  for (const [label, options, expectedStatus] of failureScenarios) {
    const snapshot = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, options));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), snapshot, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, expectedStatus);
    assert.equal(error.details.recovery.artifacts.journal.planId, plan.id, label);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
  }

  const completed = applyPlan(remote, plan);
  assertAcceptableRecoveryState(completed.recoveryState);
  assertRecoveryStateArtifacts(completed.recoveryState, 'fully-updated-remote');
  assert.equal(completed.recoveryState.artifacts.remote, undefined);
  assert.equal(completed.recoveryState.artifacts.journal.status, 'completed');

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
});

test('durable recovery keeps failure boundaries and completed replay recoverable', () => {
  const scenarios = [
    {
      name: 'failure before mutation',
      options: { failBeforeMutation: true },
      expectedStatus: 'old-remote',
      expectedJournalStatus: 'opened',
    },
    {
      name: 'failure after staging',
      options: { failAfterStaging: true },
      expectedStatus: 'old-remote',
      expectedJournalStatus: 'staged',
    },
    {
      name: 'failure after dependency validation',
      options: { failAfterDependencyValidation: true },
      expectedStatus: 'old-remote',
      expectedJournalStatus: 'dependencies-validated',
    },
    {
      name: 'completed replay',
      replay: true,
      expectedStatus: 'fully-updated-remote',
      expectedJournalStatus: 'completed',
    },
  ];

  for (const scenario of scenarios) {
    const base = baseSite();
    const local = baseSite();
    local.files['index.php'] = '<?php echo "local";';
    local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
    const plan = planFor(base, local, baseSite());
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });

    if (scenario.replay) {
      const completed = applyPlan(baseSite(), plan);
      const replayRemote = JSON.parse(JSON.stringify(completed.site));
      const replayBefore = JSON.stringify(replayRemote);

      const replay = applyPlan(replayRemote, plan, {
        journal: completed.journal,
        durableJournal,
      });
      durableJournal.close();

      const persisted = readRecoveryJournal(journalPath);

      assert.equal(JSON.stringify(replayRemote), replayBefore, scenario.name);
      assert.equal(replay.appliedMutations, 0, scenario.name);
      assert.equal(replay.recoveryState.status, scenario.expectedStatus, scenario.name);
      assert.equal(replay.recoveryState.artifacts.journal.status, scenario.expectedJournalStatus, scenario.name);
      assert.equal(replay.recoveryState.artifacts.remote, undefined, scenario.name);
      assert.equal(persisted.integrity.status, 'ok', scenario.name);
      assert.ok(persisted.records.some((record) => record.type === 'journal-replayed'), scenario.name);
      continue;
    }

    const remote = baseSite();
    const before = JSON.stringify(remote);
    const error = captureError(() =>
      applyPlan(remote, plan, {
        ...scenario.options,
        durableJournal,
      }));
    durableJournal.close();

    const persisted = readRecoveryJournal(journalPath);

    assert.ok(error instanceof PushPlanError, scenario.name);
    assert.equal(JSON.stringify(remote), before, scenario.name);
    assert.equal(error.details.recovery.status, scenario.expectedStatus, scenario.name);
    assert.equal(error.details.recovery.artifacts.journal.status, scenario.expectedJournalStatus, scenario.name);
    assert.equal(error.details.recovery.artifacts.remote, undefined, scenario.name);
    assert.equal(persisted.integrity.status, 'ok', scenario.name);
    assert.ok(persisted.records.some((record) => record.type === 'journal-opened'), scenario.name);
    assert.ok(
      persisted.records.some((record) => record.type === 'recovery-state'),
      scenario.name,
    );
  }
});

test('documented recovery states carry the expected artifact shapes', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);

  const failure = captureError(() => applyPlan(JSON.parse(JSON.stringify(remote)), plan, { failAfterStaging: true }));
  assertAcceptableRecoveryState(failure.details.recovery);
  assert.equal(failure.details.recovery.status, 'old-remote');
  assert.ok(failure.details.recovery.artifacts?.journal, 'old-remote must keep journal artifacts');
  assert.equal(failure.details.recovery.artifacts.remote, undefined);

  const applied = applyPlan(baseSite(), plan);
  assertAcceptableRecoveryState(applied.recoveryState);
  assert.equal(applied.recoveryState.status, 'fully-updated-remote');
  assert.ok(applied.recoveryState.artifacts?.journal, 'fully-updated-remote must keep journal artifacts');
  assert.equal(applied.recoveryState.artifacts.remote, undefined);

  const staleRemote = JSON.parse(JSON.stringify(applied.site));
  staleRemote.files['index.php'] = '<?php echo "drifted";';
  const blocked = captureError(() => applyPlan(staleRemote, plan, { journal: applied.journal }));
  assertAcceptableRecoveryState(blocked.details.recovery);
  assert.equal(blocked.details.recovery.status, 'blocked-recovery');
  assert.ok(blocked.details.recovery.artifacts?.journal, 'blocked-recovery must keep journal artifacts');
  assert.ok(blocked.details.recovery.artifacts?.remote, 'blocked-recovery must keep remote artifacts');
});

test('replaying a completed plan twice stays inert and keeps the fully updated remote', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const completed = applyPlan(remote, plan);
  const firstReplay = applyPlan(completed.site, plan, { journal: completed.journal });
  const beforeSecondReplay = JSON.stringify(firstReplay.site);

  const secondReplay = applyPlan(firstReplay.site, plan, { journal: firstReplay.journal });

  assert.equal(firstReplay.appliedMutations, 0);
  assert.equal(secondReplay.appliedMutations, 0);
  assert.equal(JSON.stringify(firstReplay.site), beforeSecondReplay);
  assert.equal(JSON.stringify(secondReplay.site), beforeSecondReplay);
  assertRecoveryStateArtifacts(secondReplay.recoveryState, 'fully-updated-remote');
  assert.equal(
    Object.keys(secondReplay.site.db.wp_posts).filter((key) => key === 'ID:2').length,
    1,
  );
  assert.equal(secondReplay.site.files['index.php'], '<?php echo "local";');
  assert.equal(secondReplay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
});

test('replaying a completed plan with drift blocks recovery and keeps artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  const remote = baseSite();
  const readyPlan = planFor(base, local, remote);
  const applied = applyPlan(remote, readyPlan);
  const driftedRemote = JSON.parse(JSON.stringify(applied.site));
  driftedRemote.files['index.php'] = '<?php echo "drifted";';
  const before = JSON.stringify(driftedRemote);

  const error = captureError(() => applyPlan(driftedRemote, readyPlan, { journal: applied.journal }));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'RECOVERY_BLOCKED');
  assertRemoteUnchanged(driftedRemote, before);
  assertAcceptableRecoveryState(error.details.recovery);
  assert.equal(error.details.recovery.status, 'blocked-recovery');
  assert.ok(error.details.recovery.artifacts.journal);
  assert.ok(error.details.recovery.artifacts.remote);
});

test('durable retry after a pre-commit failure does not duplicate inserts or revive stale local data', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const journalPath = tempRecoveryJournalPath();

  const firstWriter = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const firstError = captureError(() =>
    applyPlan(remote, plan, { failAfterStaging: true, durableJournal: firstWriter }));
  firstWriter.close();

  assert.ok(firstError instanceof PushPlanError);
  assert.equal(firstError.details.recovery.status, 'old-remote');
  assert.equal(firstError.details.recovery.artifacts.journal.status, 'staged');

  const staleLocal = JSON.parse(JSON.stringify(local));
  staleLocal.files['index.php'] = '<?php echo "stale-local";';
  staleLocal.db.wp_posts['ID:2'].post_title = 'Stale local insert';

  const retryWriter = openRecoveryJournal(journalPath, { now: fixedNow });
  const retry = applyPlan(remote, plan, {
    journal: firstError.details.recovery.artifacts.journal,
    durableJournal: retryWriter,
    mutateRemote: true,
  });
  retryWriter.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(retry.appliedMutations, 2);
  assert.equal(retry.recoveryState.status, 'fully-updated-remote');
  assert.equal(remote.files['index.php'], '<?php echo "local";');
  assert.equal(remote.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(remote.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
  assert.equal(persisted.integrity.status, 'ok');
  assert.ok(persisted.records.some((record) => record.type === 'journal-retry-opened'));
  assert.equal(staleLocal.files['index.php'], '<?php echo "stale-local";');
  assert.equal(staleLocal.db.wp_posts['ID:2'].post_title, 'Stale local insert');
});

test('durable retry after dependency validation preserves the recovery artifact and stays idempotent', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const journalPath = tempRecoveryJournalPath();

  const firstWriter = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const firstError = captureError(() =>
    applyPlan(remote, plan, { failAfterDependencyValidation: true, durableJournal: firstWriter }));
  firstWriter.close();

  assert.ok(firstError instanceof PushPlanError);
  assert.equal(firstError.details.recovery.status, 'old-remote');
  assert.equal(firstError.details.recovery.artifacts.journal.status, 'dependencies-validated');

  const retryWriter = openRecoveryJournal(journalPath, { now: fixedNow });
  const retry = applyPlan(remote, plan, {
    journal: firstError.details.recovery.artifacts.journal,
    durableJournal: retryWriter,
    mutateRemote: true,
  });
  retryWriter.close();

  const persisted = readRecoveryJournal(journalPath);
  const targetRecords = persisted.records.filter((record) => record.type === 'target-planned');

  assert.equal(retry.appliedMutations, 2);
  assert.equal(retry.recoveryState.status, 'fully-updated-remote');
  assert.equal(remote.files['index.php'], '<?php echo "local";');
  assert.equal(remote.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(remote.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
  assert.equal(targetRecords.length, plan.mutations.length);
  assert.equal(persisted.integrity.status, 'ok');
  assert.ok(persisted.records.some((record) => record.type === 'journal-retry-opened'));
  assert.ok(
    persisted.records.some((record) => record.type === 'dependencies-validated'),
    'durable retry must preserve the validation boundary',
  );
});

test('durable failure in the pre-write commit hook stays old-remote and does not observe a mutation', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const before = JSON.stringify(remote);

  const error = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal,
      beforeMutation({ mutationIndex }) {
        if (mutationIndex === 1) {
          throw new Error('hook failure before first remote write');
        }
      },
    }),
  );

  durableJournal.close();
  const persisted = readRecoveryJournal(journalPath);

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'JOURNAL_WRITE_FAILED');
  assert.equal(JSON.stringify(remote), before);
  assertAcceptableRecoveryState(error.details.recovery);
  assertRecoveryStateArtifacts(error.details.recovery, 'blocked-recovery');
  assert.ok(error.details.recovery.artifacts.journal, 'hook failure should keep journal artifacts');
  assert.ok(error.details.recovery.artifacts.remote, 'hook failure should keep remote artifacts');
  assert.equal(
    persisted.records.some((record) => record.type === 'mutation-observed'),
    false,
    'hook failure before first write must not observe a mutation',
  );
});

test('durable retry after an old-remote failure reopens append-only without duplicating targets', () => {
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
  assert.equal(firstError.details.recovery.artifacts.journal.status, 'opened');

  const retryWriter = openRecoveryJournal(journalPath, { now: fixedNow });
  const retry = applyPlan(remote, plan, {
    journal: firstError.details.recovery.artifacts.journal,
    durableJournal: retryWriter,
    mutateRemote: true,
  });
  retryWriter.close();

  const persisted = readRecoveryJournal(journalPath);
  const targetRecords = persisted.records.filter((record) => record.type === 'target-planned');

  assert.equal(retry.appliedMutations, 2);
  assert.equal(retry.recoveryState.status, 'fully-updated-remote');
  assert.equal(remote.files['index.php'], '<?php echo "local";');
  assert.equal(remote.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(targetRecords.length, plan.mutations.length);
  assert.ok(persisted.records.some((record) => record.type === 'journal-retry-opened'));
  assert.equal(persisted.integrity.status, 'ok');
});

test('durable stale completed replay blocks recovery and preserves inspectable artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const completed = applyPlan(remote, plan);
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const driftedRemote = JSON.parse(JSON.stringify(completed.site));
  driftedRemote.files['index.php'] = '<?php echo "drifted";';
  const before = JSON.stringify(driftedRemote);

  const error = captureError(() =>
    applyPlan(driftedRemote, plan, {
      journal: completed.journal,
      durableJournal,
    }),
  );
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'RECOVERY_BLOCKED');
  assert.equal(JSON.stringify(driftedRemote), before);
  assertAcceptableRecoveryState(error.details.recovery);
  assert.equal(error.details.recovery.status, 'blocked-recovery');
  assert.ok(error.details.recovery.artifacts.journal, 'blocked replay must keep journal artifacts');
  assert.ok(error.details.recovery.artifacts.remote, 'blocked replay must keep remote artifacts');
  assert.equal(error.details.recovery.artifacts.journal.status, 'completed');
  assert.equal(error.details.recovery.artifacts.remote.files['index.php'], '<?php echo "drifted";');
  assert.equal(error.details.recovery.artifacts.remote.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(persisted.integrity.status, 'ok');
  assert.ok(persisted.records.some((record) => record.type === 'recovery-state'));
});

test('durable mid-apply failure blocks recovery and keeps the partial remote inspectable', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const journalPath = tempRecoveryJournalPath();

  const writer = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const error = captureError(() =>
    applyPlan(remote, plan, {
      failDuringCommitAtMutation: 1,
      durableJournal: writer,
      mutateRemote: true,
    }));
  writer.close();

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'INJECTED_FAILURE_DURING_COMMIT');
  assertAcceptableRecoveryState(error.details.recovery);
  assert.equal(error.details.recovery.status, 'blocked-recovery');
  assert.ok(error.details.recovery.artifacts.journal, 'blocked recovery must keep journal artifacts');
  assert.ok(error.details.recovery.artifacts.remote, 'blocked recovery must keep remote artifacts');
  assert.equal(error.details.recovery.artifacts.journal.status, 'blocked');
  assert.equal(error.details.recovery.artifacts.remote.files['index.php'], '<?php echo "local";');
  assert.equal(error.details.recovery.artifacts.remote.db.wp_posts['ID:2'], undefined);
  assert.equal(remote.files['index.php'], '<?php echo "local";');
  assert.equal(remote.db.wp_posts['ID:2'], undefined);

  const retryBefore = JSON.stringify(remote);
  const retryError = captureError(() => applyPlan(remote, plan, {
    journal: error.details.recovery.artifacts.journal,
  }));

  assert.ok(retryError instanceof PushPlanError);
  assert.equal(retryError.code, 'RECOVERY_BLOCKED');
  assert.equal(JSON.stringify(remote), retryBefore);
  assert.equal(retryError.details.recovery.status, 'blocked-recovery');
  assert.ok(retryError.details.recovery.artifacts.journal);
  assert.ok(retryError.details.recovery.artifacts.remote);
  assert.equal(retryError.details.recovery.artifacts.remote.files['index.php'], '<?php echo "local";');

  const persisted = readRecoveryJournal(journalPath);
  assert.equal(persisted.integrity.status, 'ok');
  assert.ok(persisted.records.some((record) => record.type === 'journal-opened'));
  assert.ok(persisted.records.some((record) => record.type === 'apply-committing'));
  assert.ok(persisted.records.some((record) => record.type === 'mutation-observed'));
});

test('atomic apply recovery boundaries only land in old remote, fully updated remote, or blocked recovery with artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
    ['mid-apply', { failDuringCommitAtMutation: 1 }, 'blocked'],
  ]) {
    const remote = baseSite();
    const before = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, options));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), before, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assert.equal(
      error.details.recovery.status,
      label === 'mid-apply' ? 'blocked-recovery' : 'old-remote',
      label,
    );
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    if (label === 'mid-apply') {
      assert.ok(error.details.recovery.artifacts.remote, 'mid-apply recovery must carry remote artifacts');
      assert.equal(
        error.details.recovery.artifacts.remote.files['index.php'],
        '<?php echo "local";',
        label,
      );
      assert.equal(
        error.details.recovery.artifacts.remote.db.wp_posts['ID:2'],
        undefined,
        label,
      );
    } else {
      assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    }
  }

  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);

  const driftedRemote = JSON.parse(JSON.stringify(completed.site));
  driftedRemote.files['index.php'] = '<?php echo "drifted";';
  const blocked = captureError(() => applyPlan(driftedRemote, plan, { journal: completed.journal }));

  assert.ok(blocked instanceof PushPlanError);
  assert.equal(blocked.code, 'RECOVERY_BLOCKED');
  assertAcceptableRecoveryState(blocked.details.recovery);
  assert.equal(blocked.details.recovery.status, 'blocked-recovery');
  assert.ok(blocked.details.recovery.artifacts.journal);
  assert.ok(blocked.details.recovery.artifacts.remote);
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

test('recovery boundaries stay within the acceptable old, updated, or blocked states', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:1'].post_title = 'Local title';
  const remote = baseSite();
  const plan = planFor(base, local, remote);

  for (const [label, options] of [
    ['before mutation', { failBeforeMutation: true }],
    ['after staging', { failAfterStaging: true }],
    ['after dependency validation', { failAfterDependencyValidation: true }],
  ]) {
    const workingRemote = baseSite();
    const before = JSON.stringify(workingRemote);
    const error = captureError(() => applyPlan(workingRemote, plan, options));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(workingRemote), before, label);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
  }

  const completed = applyPlan(baseSite(), plan);
  const replay = applyPlan(completed.site, plan, { journal: completed.journal });

  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.deepEqual(replay.site, completed.site);
});

test('no-data-loss recovery keeps pre-commit failures old and completed replay inert', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const workingRemote = baseSite();
    const before = JSON.stringify(workingRemote);
    const error = captureError(() => applyPlan(workingRemote, plan, options));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(workingRemote), before, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
  }

  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
});

test('no-data-loss recovery boundaries stay limited to old remote, fully updated remote, or blocked recovery artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());
  const failureScenarios = [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ];

  for (const [label, options, expectedJournalStatus] of failureScenarios) {
    const remote = baseSite();
    const snapshot = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, options));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), snapshot, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
  }

  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
});

test('injected failure before commit returns no partially mutated remote state', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:1'].post_title = 'Local title';
  const remote = baseSite();
  const before = JSON.stringify(remote);
  const plan = planFor(base, local, remote);

  const error = captureError(() => applyPlan(remote, plan, { failBeforeCommitAtMutation: 1 }));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'INJECTED_FAILURE_BEFORE_COMMIT');
  assert.equal(JSON.stringify(remote), before);
  assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
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
  assertAcceptableRecoveryState(error.details.recovery);
  assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
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
  assertAcceptableRecoveryState(error.details.recovery);
  assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
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
  assertAcceptableRecoveryState(error.details.recovery);
  assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
  assert.equal(error.details.recovery.artifacts.journal.status, 'dependencies-validated');
});

test('no-data-loss recovery stays within old remote, fully updated remote, or blocked recovery artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const remote = baseSite();
    const remoteBefore = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, options));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), remoteBefore, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
  }

  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');

  const staleReplayRemote = JSON.parse(JSON.stringify(completed.site));
  staleReplayRemote.db.wp_posts['ID:2'].post_title = 'Externally edited after completion';
  const staleReplayError = captureError(() => applyPlan(staleReplayRemote, plan, { journal: completed.journal }));

  assert.ok(staleReplayError instanceof PushPlanError);
  assert.equal(staleReplayError.details.recovery.status, 'blocked-recovery');
  assert.ok(staleReplayError.details.recovery.artifacts.journal);
  assert.ok(staleReplayError.details.recovery.artifacts.remote);
  assert.equal(staleReplayError.details.recovery.artifacts.remote.db.wp_posts['ID:2'].post_title, 'Externally edited after completion');
});

test('atomic apply recovery contract only accepts old remote, fully updated remote, or blocked recovery with artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);

  for (const [label, options, expectedStatus] of [
    ['failure before mutation', { failBeforeMutation: true }, 'old-remote'],
    ['failure after staging', { failAfterStaging: true }, 'old-remote'],
    ['failure after dependency validation', { failAfterDependencyValidation: true }, 'old-remote'],
  ]) {
    const current = baseSite();
    const before = JSON.stringify(current);
    const error = captureError(() => applyPlan(current, plan, options));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(current), before, label);
    assertRecoveryStateArtifacts(error.details.recovery, expectedStatus);
  }

  const completed = applyPlan(baseSite(), plan);
  const replay = applyPlan(JSON.parse(JSON.stringify(completed.site)), plan, { journal: completed.journal });

  assert.equal(replay.appliedMutations, 0);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');

  const driftedRemote = JSON.parse(JSON.stringify(completed.site));
  driftedRemote.db.wp_posts['ID:2'].post_title = 'Externally edited after completion';
  const blocked = captureError(() => applyPlan(driftedRemote, plan, { journal: completed.journal }));

  assert.ok(blocked instanceof PushPlanError);
  assert.equal(blocked.details.recovery.status, 'blocked-recovery');
  assert.ok(blocked.details.recovery.artifacts.journal);
  assert.ok(blocked.details.recovery.artifacts.remote);
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

test('durable recovery boundaries stay within the acceptable recovery states', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const remote = baseSite();
    const remoteBefore = JSON.stringify(remote);
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const error = captureError(() => applyPlan(remote, plan, { ...options, durableJournal }));
    durableJournal.close();

    const persisted = readRecoveryJournal(journalPath);

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(error.code.startsWith('INJECTED_FAILURE_'), true, label);
    assert.equal(JSON.stringify(remote), remoteBefore, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(persisted.integrity.status, 'ok', label);
  }

  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(persisted.records[persisted.records.length - 2].type, 'recovery-state');
  assert.equal(persisted.records[persisted.records.length - 1].type, 'journal-replayed');
  assert.equal(persisted.records[persisted.records.length - 1].state, 'fully-updated-remote');
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

test('durable journal write failure after all mutations are committed blocks recovery with artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:1'].post_title = 'Local title';
  const remote = baseSite();
  const before = JSON.stringify(remote);
  const plan = planFor(base, local, remote);
  const durableJournal = failingDurableJournal('journal-completed');

  const error = captureError(() => applyPlan(remote, plan, { durableJournal }));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'JOURNAL_WRITE_FAILED');
  assert.equal(JSON.stringify(remote), before);
  assert.equal(error.details.recovery.status, 'blocked-recovery');
  assert.ok(error.details.recovery.artifacts.journal, 'blocked recovery must include journal artifacts');
  assert.ok(error.details.recovery.artifacts.remote, 'blocked recovery must include remote artifacts');
  assert.equal(error.details.recovery.artifacts.journal.status, 'completed');
  assert.equal(error.details.recovery.artifacts.remote.files['index.php'], '<?php echo "local";');
  assert.equal(error.details.recovery.artifacts.remote.db.wp_posts['ID:1'].post_title, 'Local title');
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

test('retrying a dependency-validation failure appends durable retry state without duplicating targets', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const journalPath = tempRecoveryJournalPath();

  const firstWriter = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const firstError = captureError(() =>
    applyPlan(remote, plan, { failAfterDependencyValidation: true, durableJournal: firstWriter }));
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

test('stale recovery claim fences the durable journal before opening the plan', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "STALE_LOCAL";';
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const journal = {
    kind: 'production-recovery-journal',
    productionAdapter: true,
    nextSequence: 1,
    events: [],
    appendEvent(type, payload) {
      this.events.push({ type, payload });
      return { sequence: this.nextSequence++, type, payload };
    },
    close() {},
    assertCurrentClaim(type) {
      throw new PushPlanError('RECOVERY_CLAIM_STALE', 'Injected stale claim before durable append.', {
        staleClaimHash: 'stale-claim',
        activeClaimHash: 'active-claim',
        activeClaimSequence: 2,
        activeClaimType: type,
      });
    },
  };

  const error = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal: journal,
      mutateRemote: true,
    }),
  );

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'RECOVERY_CLAIM_STALE');
  assert.equal(error.details.recovery.status, 'blocked-recovery');
  assert.equal(error.details.recovery.artifacts.remote.files['index.php'], '<?php echo "base";');
  assert.equal(remote.files['index.php'], '<?php echo "base";');
  assert.deepEqual(journal.events, []);
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
  assert.ok(error.details.recovery.artifacts.journal);
  assert.ok(error.details.recovery.artifacts.remote);
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
    ['journal-opened', ...plan.mutations.map(() => 'target-planned'), 'recovery-state', 'journal-replayed'],
  );
  assert.equal(persisted.records[0].state, 'replay-observed');
  assert.equal(targetRecords.length, plan.mutations.length);
  assert.equal(inspection.status, 'fully-updated-remote');
  assert.deepEqual(inspection.counts, { old: 0, new: 2, blockedUnknown: 0 });
  for (const record of persisted.records) {
    assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(record));
  }
});

test('completed replay on an existing durable journal keeps replay evidence append-only', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const completed = applyPlan(remote, plan);
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });

  durableJournal.appendEvent('journal-opened', {
    planId: plan.id,
    state: 'seeded',
    observedHash: 'seed',
    artifactRefs: {},
  });

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.deepEqual(
    persisted.records.map((record) => record.type),
    ['journal-opened', 'recovery-state', 'journal-replayed'],
  );
  assert.equal(persisted.records[1].state, 'fully-updated-remote');
  assert.equal(persisted.records.some((record) => record.type === 'target-planned'), false);
});

test('completed replay on a durable journal stays inert after local drift and keeps inserts stable', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const completed = applyPlan(remote, plan);

  local.files['index.php'] = '<?php echo "diverged local";';
  local.db.wp_posts['ID:2'].post_title = 'Inserted locally again';

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);

  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(
    persisted.records[persisted.records.length - 1].type,
    'journal-replayed',
  );
  assert.equal(
    persisted.records[persisted.records.length - 1].state,
    'fully-updated-remote',
  );
});

test('completed replay on a durable journal stays inert after stale local drift and preserves the completed envelope', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const completed = applyPlan(remote, plan);

  local.files['index.php'] = '<?php echo "stale local";';
  local.db.wp_posts['ID:2'].post_title = 'Inserted locally again';

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);

  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(persisted.integrity.status, 'ok');
  assert.equal(persisted.records[persisted.records.length - 2].type, 'recovery-state');
  assert.equal(persisted.records[persisted.records.length - 1].type, 'journal-replayed');
  assert.equal(persisted.records[persisted.records.length - 1].state, 'fully-updated-remote');
});

test('completed replay stays inert when local source data diverges after completion', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const completed = applyPlan(remote, plan);

  local.files['index.php'] = '<?php echo "diverged local";';
  local.db.wp_posts['ID:2'].post_title = 'Inserted locally again';

  const before = JSON.stringify(completed.site);
  const replay = applyPlan(completed.site, plan, { journal: completed.journal });

  assert.equal(replay.appliedMutations, 0);
  assert.equal(JSON.stringify(completed.site), before);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
});

test('completed replay durable write failure still classifies as fully updated remote', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const completed = applyPlan(remote, plan);
  const before = JSON.stringify(completed.site);
  const durableJournal = failingDurableJournal('journal-replayed');
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);

  const error = captureError(() =>
    applyPlan(replayRemote, plan, {
      journal: completed.journal,
      durableJournal,
    }));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'JOURNAL_WRITE_FAILED');
  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(JSON.stringify(completed.site), before);
  assertAcceptableRecoveryState(error.details.recovery);
  assert.equal(error.details.recovery.status, 'fully-updated-remote');
  assert.equal(error.details.recovery.artifacts.journal.status, 'completed');
  assert.equal(error.details.recovery.artifacts.remote, undefined);
  assert.equal(error.details.boundary, 'journal-replayed');
  assert.equal(
    Object.values(replayRemote.db.wp_posts).filter((row) => row.post_title === 'Inserted locally').length,
    1,
  );
  assert.equal(replayRemote.db.wp_posts['ID:2'].post_title, 'Inserted locally');
});

test('completed replay journaling failure stays inert and retries without duplicating inserts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const completed = applyPlan(remote, plan);
  const failingReplayJournal = failingDurableJournal('journal-replayed');
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);

  const error = captureError(() =>
    applyPlan(replayRemote, plan, {
      journal: completed.journal,
      durableJournal: failingReplayJournal,
    }),
  );

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'JOURNAL_WRITE_FAILED');
  assert.equal(error.details.boundary, 'journal-replayed');
  assertAcceptableRecoveryState(error.details.recovery);
  assertRecoveryStateArtifacts(error.details.recovery, 'fully-updated-remote');
  assert.equal(error.details.recovery.artifacts.remote, undefined);
  assert.equal(JSON.stringify(replayRemote), replaySnapshot);

  const retryJournal = openRecoveryJournal(tempRecoveryJournalPath(), { now: fixedNow });
  const retry = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal: retryJournal,
  });
  retryJournal.close();

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(retry.appliedMutations, 0);
  assert.equal(
    Object.values(retry.site.db.wp_posts).filter((row) => row.post_title === 'Inserted locally').length,
    1,
  );
  assert.equal(retry.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assertRecoveryStateArtifacts(retry.recoveryState, 'fully-updated-remote');
  assert.equal(retry.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(retry.recoveryState.artifacts.remote, undefined);
});

test('stale completed replay on durable journal blocks with journal and remote artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const completed = applyPlan(remote, plan);
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const driftedRemote = JSON.parse(JSON.stringify(completed.site));
  driftedRemote.db.wp_posts['ID:2'].post_title = 'Drifted after completion';

  const error = captureError(() =>
    applyPlan(driftedRemote, plan, {
      journal: completed.journal,
      durableJournal,
    }));
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'RECOVERY_BLOCKED');
  assert.equal(driftedRemote.db.wp_posts['ID:2'].post_title, 'Drifted after completion');
  assert.equal(error.details.recovery.status, 'blocked-recovery');
  assert.equal(error.details.recovery.artifacts.journal.status, 'completed');
  assert.equal(error.details.recovery.artifacts.remote.db.wp_posts['ID:2'].post_title, 'Drifted after completion');
  assert.equal(persisted.integrity.status, 'ok');
  assert.equal(persisted.records.length, 1);
  assert.equal(persisted.records[0].type, 'recovery-state');
  assert.equal(persisted.records[0].state, 'blocked-recovery');
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

test('stale completed replay blocks with journal and remote artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const completed = applyPlan(remote, plan);
  const driftedRemote = JSON.parse(JSON.stringify(completed.site));
  driftedRemote.db.wp_posts['ID:2'].post_title = 'Drifted after completion';

  const error = captureError(() => applyPlan(driftedRemote, plan, { journal: completed.journal }));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'RECOVERY_BLOCKED');
  assert.equal(error.details.recovery.status, 'blocked-recovery');
  assert.equal(error.details.recovery.artifacts.journal.status, 'completed');
  assert.equal(error.details.recovery.artifacts.remote.db.wp_posts['ID:2'].post_title, 'Drifted after completion');
});

test('atomic apply recovery contract keeps the documented states and artifact shapes', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedStatus, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'old-remote', 'opened'],
    ['mid-apply', { failBeforeCommitAtMutation: 1 }, 'old-remote', 'staging'],
    ['after staging', { failAfterStaging: true }, 'old-remote', 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'old-remote', 'dependencies-validated'],
  ]) {
    const remote = baseSite();
    const snapshot = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, options));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), snapshot, label);
    assert.equal(error.details.recovery.status, expectedStatus, label);
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
  }

  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);

  const staleRemote = JSON.parse(JSON.stringify(completed.site));
  staleRemote.files['index.php'] = '<?php echo "drifted";';
  const blocked = captureError(() => applyPlan(staleRemote, plan, { journal: completed.journal }));

  assert.ok(blocked instanceof PushPlanError);
  assert.equal(blocked.code, 'RECOVERY_BLOCKED');
  assert.equal(blocked.details.recovery.status, 'blocked-recovery');
  assert.equal(blocked.details.recovery.artifacts.journal.status, 'completed');
  assert.ok(blocked.details.recovery.artifacts.remote);
});

test('atomic apply recovery boundaries accept only old remote, fully updated remote, or blocked recovery artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:1'].post_title = 'Local title';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const boundaries = [
    ['before mutation', { failBeforeMutation: true }, 'old-remote', 'opened'],
    ['after staging', { failAfterStaging: true }, 'old-remote', 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'old-remote', 'dependencies-validated'],
  ];

  for (const [label, options, expectedStatus, expectedJournalStatus] of boundaries) {
    const remote = baseSite();
    const snapshot = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, options));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), snapshot, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assert.equal(error.details.recovery.status, expectedStatus, label);
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
  }

  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');

  const staleRemote = JSON.parse(JSON.stringify(completed.site));
  staleRemote.files['index.php'] = '<?php echo "drifted";';
  const blocked = captureError(() => applyPlan(staleRemote, plan, { journal: completed.journal }));

  assert.ok(blocked instanceof PushPlanError);
  assertAcceptableRecoveryState(blocked.details.recovery);
  assert.equal(blocked.details.recovery.status, 'blocked-recovery');
  assert.equal(blocked.details.recovery.artifacts.journal.status, 'completed');
  assert.equal(blocked.details.recovery.artifacts.remote.files['index.php'], '<?php echo "drifted";');
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

test('retrying a blocked partial recovery does not duplicate inserts or revive stale local data', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
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

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.details.recovery.status, 'blocked-recovery');
  assert.equal(remote.files['index.php'], '<?php echo "local";');
  assert.equal(remote.db.wp_posts['ID:2'], undefined);

  const retryWriter = openRecoveryJournal(journalPath, { now: fixedNow });
  const retryError = captureError(() =>
    applyPlan(remote, plan, {
      journal: error.details.recovery.artifacts.journal,
      durableJournal: retryWriter,
    }));
  retryWriter.close();

  const persisted = readRecoveryJournal(journalPath);
  const inspection = inspectRecoveryJournal({ journal: persisted, plan, current: remote });

  assert.ok(retryError instanceof PushPlanError);
  assert.equal(retryError.code, 'RECOVERY_BLOCKED');
  assert.equal(retryError.details.recovery.status, 'blocked-recovery');
  assert.equal(remote.files['index.php'], '<?php echo "local";');
  assert.equal(remote.db.wp_posts['ID:2'], undefined);
  assert.equal(persisted.integrity.status, 'ok');
  assert.equal(inspection.status, 'blocked-recovery');
  assert.deepEqual(inspection.counts, { old: 1, new: 1, blockedUnknown: 0 });
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
    assertAcceptableRecoveryState(error.details.recovery);
    assert.equal(error.details.recovery.status, scenario.expectedRecoveryStatus, scenario.label);
    assert.ok(error.details.recovery.artifacts.journal, scenario.label);
  }

  const completed = applyPlan(baseSite(), plan);
  const replay = applyPlan(completed.site, plan, { journal: completed.journal });

  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assertAcceptableRecoveryState(replay.recoveryState);

  const blockedRemote = JSON.parse(JSON.stringify(completed.site));
  blockedRemote.db.wp_posts['ID:1'].post_title = 'Drifted after completion';
  const blocked = captureError(() => applyPlan(blockedRemote, plan, { journal: completed.journal }));

  assert.ok(blocked instanceof PushPlanError);
  assertAcceptableRecoveryState(blocked.details.recovery);
  assert.equal(blocked.details.recovery.status, 'blocked-recovery');
  assert.equal(blocked.details.recovery.artifacts.journal.status, 'completed');
  assert.equal(blocked.details.recovery.artifacts.remote.db.wp_posts['ID:1'].post_title, 'Drifted after completion');
});

test('atomic apply recovery remains inside the documented post-failure states', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:1'].post_title = 'Local title';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options] of [
    ['before mutation', { failBeforeMutation: true, expectedStatus: 'old-remote' }],
    ['after staging', { failAfterStaging: true, expectedStatus: 'old-remote' }],
    ['after dependency validation', { failAfterDependencyValidation: true, expectedStatus: 'old-remote' }],
  ]) {
    const remote = baseSite();
    const before = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, options));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), before, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assert.equal(error.details.recovery.status, options.expectedStatus, label);
    assert.ok(error.details.recovery.artifacts.journal, label);
  }

  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
});

test('durable pre-commit failures persist old-remote recovery evidence', () => {
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
      expectedJournalStatus: 'opened',
    },
    {
      label: 'after staging',
      options: { failAfterStaging: true },
      expectedJournalStatus: 'staged',
    },
    {
      label: 'after dependency validation',
      options: { failAfterDependencyValidation: true },
      expectedJournalStatus: 'dependencies-validated',
    },
  ];

  for (const scenario of failureScenarios) {
    const remote = baseSite();
    const before = JSON.stringify(remote);
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });

    const error = captureError(() =>
      applyPlan(remote, plan, {
        ...scenario.options,
        durableJournal,
      }));
    durableJournal.close();

    const persisted = readRecoveryJournal(journalPath);

    assert.ok(error instanceof PushPlanError, scenario.label);
    assert.equal(JSON.stringify(remote), before, scenario.label);
    assert.equal(error.details.recovery.status, 'old-remote', scenario.label);
    assert.equal(
      error.details.recovery.artifacts.journal.status,
      scenario.expectedJournalStatus,
      scenario.label,
    );
    assert.equal(
      persisted.records[persisted.records.length - 1].type,
      'recovery-state',
      scenario.label,
    );
    assert.equal(
      persisted.records[persisted.records.length - 1].state,
      'old-remote',
      scenario.label,
    );
    assert.equal(persisted.integrity.status, 'ok', scenario.label);
  }
});

test('durable dependency-validation failure remains inspectable as old-remote', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:1'].post_title = 'Local title';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());
  const remote = baseSite();
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });

  const error = captureError(() =>
    applyPlan(remote, plan, {
      failAfterDependencyValidation: true,
      durableJournal,
    }));
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);
  const inspection = inspectRecoveryJournal({ journal: persisted, plan, current: remote });

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'INJECTED_FAILURE_AFTER_DEPENDENCY_VALIDATION');
  assert.equal(error.details.recovery.status, 'old-remote');
  assert.equal(error.details.recovery.artifacts.journal.status, 'dependencies-validated');
  assert.equal(JSON.stringify(remote), JSON.stringify(baseSite()));
  assert.equal(persisted.integrity.status, 'ok');
  assert.equal(inspection.status, 'old-remote');
  assert.deepEqual(inspection.counts, { old: plan.mutations.length, new: 0, blockedUnknown: 0 });
});

test('mid-apply failure after staging one mutation leaves the remote old and the journal inspectable', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:1'].post_title = 'Local title';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());
  const remote = baseSite();
  const before = JSON.stringify(remote);
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });

  const error = captureError(() =>
    applyPlan(remote, plan, {
      failBeforeCommitAtMutation: 1,
      durableJournal,
    }));
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);
  const inspection = inspectRecoveryJournal({ journal: persisted, plan, current: remote });

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'INJECTED_FAILURE_BEFORE_COMMIT');
  assert.equal(JSON.stringify(remote), before);
  assert.equal(error.details.recovery.status, 'old-remote');
  assert.equal(error.details.recovery.artifacts.journal.status, 'staging');
  assert.equal(persisted.integrity.status, 'ok');
  assert.equal(inspection.status, 'old-remote');
  assert.deepEqual(inspection.counts, { old: plan.mutations.length, new: 0, blockedUnknown: 0 });
});

test('partial mid-apply recovery blocks retries and keeps recovery artifacts attached', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());
  const remote = baseSite();

  const error = captureError(() =>
    applyPlan(remote, plan, {
      mutateRemote: true,
      failDuringCommitAtMutation: 1,
    }));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'INJECTED_FAILURE_DURING_COMMIT');
  assert.equal(error.details.recovery.status, 'blocked-recovery');
  assert.ok(error.details.recovery.artifacts.journal, 'blocked recovery must include journal artifacts');
  assert.ok(error.details.recovery.artifacts.remote, 'blocked recovery must include remote artifacts');
  assert.equal(error.details.recovery.artifacts.journal.status, 'blocked');
  assert.equal(error.details.recovery.artifacts.journal.entries[0].status, 'applied');
  assert.equal(error.details.recovery.artifacts.remote.files['index.php'], '<?php echo "local";');
  assert.equal(error.details.recovery.artifacts.remote.db.wp_posts['ID:2'], undefined);

  const retryError = captureError(() =>
    applyPlan(remote, plan, { journal: error.details.recovery.artifacts.journal }));

  assert.ok(retryError instanceof PushPlanError);
  assert.equal(retryError.code, 'RECOVERY_BLOCKED');
  assert.equal(retryError.details.recovery.status, 'blocked-recovery');
  assert.ok(retryError.details.recovery.artifacts.journal);
  assert.ok(retryError.details.recovery.artifacts.remote);
  assert.equal(remote.files['index.php'], '<?php echo "local";');
  assert.equal(remote.db.wp_posts['ID:2'], undefined);
});

test('atomic apply only accepts the documented recovery states', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:1'].post_title = 'Local title';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const options of [
    { failBeforeMutation: true },
    { failAfterStaging: true },
    { failAfterDependencyValidation: true },
  ]) {
    const remote = baseSite();
    const before = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, options));

    assert.ok(error instanceof PushPlanError);
    assertAcceptableRecoveryState(error.details.recovery);
    assert.equal(JSON.stringify(remote), before);
  }

  const completed = applyPlan(baseSite(), plan);
  const replay = applyPlan(completed.site, plan, { journal: completed.journal });
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
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
  assertAcceptableRecoveryState(error.details.recovery);
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
  assertAcceptableRecoveryState(error.details.recovery);
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
  assertAcceptableRecoveryState(error.details.recovery);
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
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
});

test('completed replay remains fully updated and does not duplicate inserts when retried through the durable journal', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  const retryRemote = JSON.parse(JSON.stringify(completed.site));
  const retry = applyPlan(retryRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(retry.appliedMutations, 0);
  assert.equal(retry.recoveryState.status, 'fully-updated-remote');
  assert.equal(retry.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(retry.recoveryState.artifacts.remote, undefined);
  assert.equal(retry.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(retry.site.files['index.php'], '<?php echo "local";');
  assert.equal(
    persisted.records.filter((record) => record.type === 'journal-replayed').length,
    1,
  );
  assert.equal(
    persisted.records.filter((record) => record.type === 'target-planned').length,
    plan.mutations.length,
  );
});

test('recovery boundaries only allow old remote, fully updated remote, or blocked recovery with artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);

  for (const [label, options] of [
    ['before mutation', { failBeforeMutation: true }],
    ['after staging', { failAfterStaging: true }],
    ['after dependency validation', { failAfterDependencyValidation: true }],
  ]) {
    const before = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, options));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), before, label);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
  }

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const partialError = captureError(() =>
    applyPlan(baseSite(), plan, {
      failBeforeCommitAtMutation: 1,
      durableJournal,
    }));
  durableJournal.close();

  assert.ok(partialError instanceof PushPlanError);
  assert.equal(partialError.code, 'INJECTED_FAILURE_BEFORE_COMMIT');
  assertAcceptableRecoveryState(partialError.details.recovery);
  assert.equal(partialError.details.recovery.status, 'old-remote');
  assert.ok(partialError.details.recovery.artifacts.journal);
  assert.equal(partialError.details.recovery.artifacts.remote, undefined);

  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(replay.appliedMutations, 0);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(JSON.stringify(replayRemote), JSON.stringify(completed.site));
});

test('durable completed replay stays fully updated and leaves inspectable replay evidence', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());
  const completed = applyPlan(baseSite(), plan);

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const replay = applyPlan(JSON.parse(JSON.stringify(completed.site)), plan, {
    journal: completed.journal,
    durableJournal,
  });
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(persisted.integrity.status, 'ok');
  assert.equal(
    persisted.records[persisted.records.length - 1].type,
    'journal-replayed',
  );
  assert.equal(persisted.records[persisted.records.length - 1].state, 'fully-updated-remote');
});

test('durable completed replay ignores later local divergence and remains fully updated', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());
  const completed = applyPlan(baseSite(), plan);

  const staleLocal = JSON.parse(JSON.stringify(local));
  staleLocal.files['index.php'] = '<?php echo "stale-local";';
  staleLocal.db.wp_posts['ID:2'].post_title = 'Stale local insert';
  staleLocal.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Late local insert', post_status: 'draft' };

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const replay = applyPlan(JSON.parse(JSON.stringify(completed.site)), plan, {
    journal: completed.journal,
    durableJournal,
  });
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(persisted.records[persisted.records.length - 2].type, 'recovery-state');
  assert.equal(persisted.records[persisted.records.length - 1].type, 'journal-replayed');
  assert.equal(persisted.records[persisted.records.length - 1].state, 'fully-updated-remote');
  assert.equal(staleLocal.files['index.php'], '<?php echo "stale-local";');
  assert.equal(staleLocal.db.wp_posts['ID:2'].post_title, 'Stale local insert');
  assert.equal(staleLocal.db.wp_posts['ID:3'].post_title, 'Late local insert');
});

test('acceptable post-failure states carry the required recovery artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const preCommitFailure = captureError(() => applyPlan(baseSite(), plan, { failBeforeMutation: true }));
  assertRecoveryStateArtifacts(preCommitFailure.details.recovery, 'old-remote');
  assert.equal(preCommitFailure.details.recovery.artifacts.remote, undefined);

  const completed = applyPlan(baseSite(), plan);
  const replay = applyPlan(completed.site, plan, { journal: completed.journal });
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);

  const driftedRemote = JSON.parse(JSON.stringify(completed.site));
  driftedRemote.files['index.php'] = '<?php echo "drifted";';
  const blocked = captureError(() => applyPlan(driftedRemote, plan, { journal: completed.journal }));
  assertRecoveryStateArtifacts(blocked.details.recovery, 'blocked-recovery');
  assert.ok(blocked.details.recovery.artifacts.remote, 'blocked recovery must include remote artifacts');
  assert.equal(blocked.details.recovery.artifacts.journal.status, 'completed');
});

test('completed replay stays inert and stale replay blocks with artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);

  const staleRemote = JSON.parse(JSON.stringify(completed.site));
  staleRemote.db.wp_posts['ID:2'].post_title = 'Stale local insert';
  const blocked = captureError(() => applyPlan(staleRemote, plan, { journal: completed.journal }));

  assertRecoveryStateArtifacts(blocked.details.recovery, 'blocked-recovery');
  assert.ok(blocked.details.recovery.artifacts.remote, 'stale replay must include remote artifacts');
  assert.equal(blocked.details.recovery.artifacts.journal.status, 'completed');
  assert.equal(staleRemote.db.wp_posts['ID:2'].post_title, 'Stale local insert');
});

test('durable recovery stays within old remote, fully updated remote, or blocked recovery across key boundaries', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());
  const journalPath = tempRecoveryJournalPath();

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const before = JSON.stringify(remote);

    const error = captureError(() =>
      applyPlan(remote, plan, {
        ...options,
        durableJournal,
      }));
    durableJournal.close();

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), before, label);
    assert.equal(error.details.recovery.status, 'old-remote', label);
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(readRecoveryJournal(journalPath).integrity.status, 'ok', label);
  }

  const completed = applyPlan(baseSite(), plan);
  const replayWriter = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal: replayWriter,
  });
  replayWriter.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(persisted.integrity.status, 'ok');
  assert.equal(persisted.records[persisted.records.length - 2].type, 'recovery-state');
  assert.equal(persisted.records[persisted.records.length - 1].type, 'journal-replayed');
  assert.equal(persisted.records[persisted.records.length - 1].state, 'fully-updated-remote');
});

test('durable replay of a completed plan remains inert and keeps the recovery matrix closed', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());
  const completed = applyPlan(baseSite(), plan);
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(persisted.integrity.status, 'ok');
  assert.equal(persisted.records[persisted.records.length - 2].type, 'recovery-state');
  assert.equal(persisted.records[persisted.records.length - 1].type, 'journal-replayed');
  assert.equal(persisted.records[persisted.records.length - 1].state, 'fully-updated-remote');
  assert.equal(
    persisted.records.filter((record) => record.type === 'target-planned').length,
    plan.mutations.length,
  );
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
});

test('documented recovery contract stays within old remote, fully updated remote, or blocked recovery', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);

  for (const options of [
    { failBeforeMutation: true },
    { failAfterStaging: true },
    { failAfterDependencyValidation: true },
  ]) {
    const before = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, options));

    assert.ok(error instanceof PushPlanError);
    assert.equal(JSON.stringify(remote), before);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
  }

  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(replay.appliedMutations, 0);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');

  const driftedRemote = JSON.parse(JSON.stringify(completed.site));
  driftedRemote.files['index.php'] = '<?php echo "drifted";';
  const blocked = captureError(() => applyPlan(driftedRemote, plan, { journal: completed.journal }));

  assert.ok(blocked instanceof PushPlanError);
  assertRecoveryStateArtifacts(blocked.details.recovery, 'blocked-recovery');
  assert.ok(blocked.details.recovery.artifacts.remote);
  assert.equal(blocked.details.recovery.artifacts.journal.status, 'completed');
});

test('pre-commit failures and completed replay only produce the documented recovery states', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:1'].post_title = 'Local title';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const remote = baseSite();
    const before = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, options));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), before, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assert.equal(error.details.recovery.status, 'old-remote', label);
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
  }

  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
});

test('failure boundaries and replay land only in acceptable recovery states', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options] of [
    ['before mutation', { failBeforeMutation: true }],
    ['after staging', { failAfterStaging: true }],
    ['after dependency validation', { failAfterDependencyValidation: true }],
  ]) {
    const remote = baseSite();
    const before = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, options));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), before, label);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
  }

  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
});

test('documented recovery boundaries keep the remote old, updated, or blocked with artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const remote = baseSite();
    const remoteBefore = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, options));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), remoteBefore, label);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
  }

  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);

  const staleReplayRemote = JSON.parse(JSON.stringify(completed.site));
  staleReplayRemote.files['index.php'] = '<?php echo "drifted";';
  const staleReplayBefore = JSON.stringify(staleReplayRemote);
  const staleReplayError = captureError(() =>
    applyPlan(staleReplayRemote, plan, { journal: completed.journal }));

  assert.ok(staleReplayError instanceof PushPlanError);
  assert.equal(JSON.stringify(staleReplayRemote), staleReplayBefore);
  assertAcceptableRecoveryState(staleReplayError.details.recovery);
  assertRecoveryStateArtifacts(staleReplayError.details.recovery, 'blocked-recovery');
  assert.ok(staleReplayError.details.recovery.artifacts.journal);
  assert.ok(staleReplayError.details.recovery.artifacts.remote);
});

test('stale completed replay blocks instead of duplicating inserts or reviving stale local data', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const completed = applyPlan(remote, plan);

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  replayRemote.files['index.php'] = '<?php echo "drifted";';
  const before = JSON.stringify(replayRemote);
  const replayError = captureError(() => applyPlan(replayRemote, plan, { journal: completed.journal }));

  assert.ok(replayError instanceof PushPlanError);
  assert.equal(replayError.details.recovery.status, 'blocked-recovery');
  assert.equal(JSON.stringify(replayRemote), before);
  assert.equal(replayError.details.recovery.artifacts.journal.status, 'completed');
  assert.equal(replayError.details.recovery.artifacts.remote.files['index.php'], '<?php echo "drifted";');
  assert.equal(replayError.details.recovery.artifacts.remote.db.wp_posts['ID:2'].post_title, 'Inserted locally');
});

test('durable stale completed replay blocks without duplicating inserts or rewriting drifted remote data', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());
  const completed = applyPlan(baseSite(), plan);
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  replayRemote.db.wp_posts['ID:2'].post_title = 'Externally edited after completion';
  const replayBefore = JSON.stringify(replayRemote);

  const replayError = captureError(() =>
    applyPlan(replayRemote, plan, {
      journal: completed.journal,
      durableJournal,
    }));
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.ok(replayError instanceof PushPlanError);
  assert.equal(replayError.code, 'RECOVERY_BLOCKED');
  assert.equal(replayError.details.recovery.status, 'blocked-recovery');
  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replayError.details.recovery.artifacts.journal.status, 'completed');
  assert.equal(replayError.details.recovery.artifacts.remote.db.wp_posts['ID:2'].post_title, 'Externally edited after completion');
  assert.equal(persisted.integrity.status, 'ok');
  assert.equal(persisted.records.length, 1);
  assert.equal(persisted.records[0].type, 'recovery-state');
  assert.equal(persisted.records[0].state, 'blocked-recovery');
});

test('completed replay stays inert even if the local source diverges after completion', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const completed = applyPlan(remote, plan);

  const staleLocal = JSON.parse(JSON.stringify(local));
  staleLocal.files['index.php'] = '<?php echo "stale-local";';
  staleLocal.db.wp_posts['ID:2'].post_title = 'Stale local insert';
  staleLocal.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Late local insert', post_status: 'draft' };
  const before = JSON.stringify(completed.site);

  const replay = applyPlan(completed.site, plan, { journal: completed.journal });

  assert.equal(replay.appliedMutations, 0);
  assert.equal(JSON.stringify(completed.site), before);
  assert.equal(completed.site.files['index.php'], '<?php echo "local";');
  assert.equal(completed.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(staleLocal.files['index.php'], '<?php echo "stale-local";');
  assert.equal(staleLocal.db.wp_posts['ID:2'].post_title, 'Stale local insert');
  assert.equal(staleLocal.db.wp_posts['ID:3'].post_title, 'Late local insert');
});

test('lane recovery boundaries stay within old remote, fully updated remote, or blocked recovery', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const remote = baseSite();
    const before = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, options));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), before, label);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
  }

  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
});

test('no-data-loss recovery contract keeps failure states old remote and replay fully updated', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options] of [
    ['before mutation', { failBeforeMutation: true }],
    ['after staging', { failAfterStaging: true }],
    ['after dependency validation', { failAfterDependencyValidation: true }],
  ]) {
    const remote = baseSite();
    const before = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, options));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), before, label);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
  }

  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
});

test('durable completed replay stays inert and records the replay boundary without fresh mutations', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());
  const completed = applyPlan(baseSite(), plan);
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);

  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(persisted.integrity.status, 'ok');
  assert.equal(persisted.records[persisted.records.length - 2].type, 'recovery-state');
  assert.equal(persisted.records[persisted.records.length - 1].type, 'journal-replayed');
  assert.equal(persisted.records[persisted.records.length - 1].state, 'fully-updated-remote');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
});

test('durable partial recovery stays blocked on retry and keeps inspectable artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
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

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.details.recovery.status, 'blocked-recovery');
  assert.equal(error.details.recovery.artifacts.remote.files['index.php'], '<?php echo "local";');
  assert.equal(error.details.recovery.artifacts.journal.status, 'blocked');

  const retryWriter = openRecoveryJournal(journalPath, { now: fixedNow });
  const retryError = captureError(() =>
    applyPlan(remote, plan, {
      journal: error.details.recovery.artifacts.journal,
      durableJournal: retryWriter,
    }));
  retryWriter.close();

  const persisted = readRecoveryJournal(journalPath);
  const inspection = inspectRecoveryJournal({ journal: persisted, plan, current: remote });

  assert.ok(retryError instanceof PushPlanError);
  assert.equal(retryError.code, 'RECOVERY_BLOCKED');
  assert.equal(retryError.details.recovery.status, 'blocked-recovery');
  assert.equal(remote.files['index.php'], '<?php echo "local";');
  assert.equal(remote.db.wp_posts['ID:2'], undefined);
  assert.equal(persisted.integrity.status, 'ok');
  assert.equal(inspection.status, 'blocked-recovery');
  assert.deepEqual(inspection.counts, { old: 1, new: 1, blockedUnknown: 0 });
});

test('durable mid-apply recovery stays blocked and does not duplicate inserts on retry', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
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

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'INJECTED_FAILURE_DURING_COMMIT');
  assert.equal(error.details.recovery.status, 'blocked-recovery');
  assert.equal(error.details.recovery.artifacts.journal.status, 'blocked');
  assert.equal(error.details.recovery.artifacts.remote.files['index.php'], '<?php echo "local";');
  assert.equal(error.details.recovery.artifacts.remote.db.wp_posts['ID:2'], undefined);

  const retryWriter = openRecoveryJournal(journalPath, { now: fixedNow });
  const retryError = captureError(() =>
    applyPlan(remote, plan, {
      journal: error.details.recovery.artifacts.journal,
      durableJournal: retryWriter,
    }));
  retryWriter.close();

  const persisted = readRecoveryJournal(journalPath);
  const inspection = inspectRecoveryJournal({ journal: persisted, plan, current: remote });

  assert.ok(retryError instanceof PushPlanError);
  assert.equal(retryError.code, 'RECOVERY_BLOCKED');
  assert.equal(retryError.details.recovery.status, 'blocked-recovery');
  assert.equal(remote.files['index.php'], '<?php echo "local";');
  assert.equal(remote.db.wp_posts['ID:2'], undefined);
  assert.equal(persisted.integrity.status, 'ok');
  assert.equal(inspection.status, 'blocked-recovery');
  assert.deepEqual(inspection.counts, { old: 1, new: 1, blockedUnknown: 0 });
});

test('durable mid-apply recovery after a later mutation remains blocked and replays without duplication', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });

  const error = captureError(() =>
    applyPlan(remote, plan, {
      mutateRemote: true,
      failDuringCommitAtMutation: 2,
      durableJournal,
    }),
  );

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'INJECTED_FAILURE_DURING_COMMIT');
  assertAcceptableRecoveryState(error.details.recovery);
  assertRecoveryStateArtifacts(error.details.recovery, 'blocked-recovery');
  assert.ok(error.details.recovery.artifacts.journal, 'blocked recovery must keep journal artifacts');
  assert.ok(error.details.recovery.artifacts.remote, 'blocked recovery must keep remote artifacts');
  assert.equal(error.details.recovery.artifacts.journal.status, 'blocked');
  assert.equal(error.details.recovery.artifacts.remote.files['index.php'], '<?php echo "local";');
  assert.equal(
    error.details.recovery.artifacts.remote.db.wp_posts['ID:2'].post_title,
    'Inserted locally',
  );
  assert.equal(remote.files['index.php'], '<?php echo "local";');
  assert.equal(remote.db.wp_posts['ID:2'].post_title, 'Inserted locally');

  const retryRemote = JSON.parse(JSON.stringify(error.details.recovery.artifacts.remote));
  const retrySnapshot = JSON.stringify(retryRemote);
  const retry = applyPlan(retryRemote, plan, {
    journal: error.details.recovery.artifacts.journal,
    durableJournal,
  });
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(retryRemote), retrySnapshot);
  assert.equal(retry.appliedMutations, 0);
  assertAcceptableRecoveryState(retry.recoveryState);
  assertRecoveryStateArtifacts(retry.recoveryState, 'fully-updated-remote');
  assert.equal(retry.recoveryState.artifacts.remote, undefined);
  assert.equal(retry.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(retry.site.files['index.php'], '<?php echo "local";');
  assert.equal(retry.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(
    persisted.records.filter((record) => record.type === 'journal-replayed').length,
    1,
  );
  assert.equal(
    persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
    true,
  );
});

test('recovery boundaries only land in the documented old remote, fully updated remote, or blocked recovery states', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const remote = baseSite();
    const snapshot = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, options));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), snapshot, label);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
  }

  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
});

test('replay classification stays bounded by old remote, fully updated remote, and blocked recovery artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const failureScenarios = [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ];

  for (const [label, options, expectedJournalStatus] of failureScenarios) {
    const remote = baseSite();
    const error = captureError(() => applyPlan(remote, plan, options));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(error.details.recovery.status, 'old-remote', label);
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(remote.files['index.php'], '<?php echo "base";', label);
    assert.equal(remote.db.wp_posts['ID:2'], undefined, label);
  }

  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');

  replayRemote.files['index.php'] = '<?php echo "drifted";';
  const blocked = captureError(() => applyPlan(replayRemote, plan, { journal: completed.journal }));

  assert.equal(blocked.details.recovery.status, 'blocked-recovery');
  assert.ok(blocked.details.recovery.artifacts.journal);
  assert.ok(blocked.details.recovery.artifacts.remote);
});

test('no-data-loss recovery keeps pre-commit failures old and completed replay inert', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const remote = baseSite();
    const before = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, options));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), before, label);
    assert.equal(error.details.recovery.status, 'old-remote', label);
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
  }

  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
});

test('durable recovery boundaries preserve the same three acceptable post-failure states', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());
  const journalPath = tempRecoveryJournalPath();

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const snapshot = JSON.stringify(remote);
    const error = captureError(() =>
      applyPlan(remote, plan, {
        ...options,
        durableJournal,
      }));
    durableJournal.close();

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), snapshot, label);
    assert.equal(error.details.recovery.status, 'old-remote', label);
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(readRecoveryJournal(journalPath).integrity.status, 'ok', label);
  }

  const completed = applyPlan(baseSite(), plan);
  const replayWriter = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal: replayWriter,
  });
  replayWriter.close();

  const persisted = readRecoveryJournal(journalPath);
  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(persisted.records[persisted.records.length - 2].type, 'recovery-state');
  assert.equal(persisted.records[persisted.records.length - 1].type, 'journal-replayed');
  assert.equal(persisted.records[persisted.records.length - 1].state, 'fully-updated-remote');
});

test('durable completed replay stays inert after local source divergence and does not duplicate inserts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());
  const completed = applyPlan(baseSite(), plan);
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const before = JSON.stringify(replayRemote);

  local.files['index.php'] = '<?php echo "stale-local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(replayRemote), before);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(persisted.records[persisted.records.length - 2].type, 'recovery-state');
  assert.equal(persisted.records[persisted.records.length - 1].type, 'journal-replayed');
  assert.equal(persisted.records[persisted.records.length - 1].state, 'fully-updated-remote');
});

test('stale completed replay blocks instead of treating a drifted remote as safe', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());
  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  replayRemote.files['index.php'] = '<?php echo "drifted";';
  const snapshot = JSON.stringify(replayRemote);

  const error = captureError(() => applyPlan(replayRemote, plan, { journal: completed.journal }));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'RECOVERY_BLOCKED');
  assert.equal(JSON.stringify(replayRemote), snapshot);
  assert.equal(error.details.recovery.status, 'blocked-recovery');
  assert.equal(error.details.recovery.artifacts.journal.status, 'completed');
  assert.ok(error.details.recovery.artifacts.remote);
  assert.equal(error.details.recovery.artifacts.remote.files['index.php'], '<?php echo "drifted";');
  assert.equal(error.details.recovery.artifacts.remote.db.wp_posts['ID:2'].post_title, 'Inserted locally');
});

test('blocked partial recovery keeps inspectable artifacts instead of pretending the remote is safe', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
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

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.details.recovery.status, 'blocked-recovery');
  assert.equal(error.details.recovery.artifacts.journal.status, 'blocked');
  assert.ok(error.details.recovery.artifacts.remote, 'blocked recovery must carry remote artifacts');
  assert.equal(error.details.recovery.artifacts.remote.files['index.php'], '<?php echo "local";');
  assert.equal(error.details.recovery.artifacts.remote.db.wp_posts['ID:2'], undefined);
  assert.equal(persisted.integrity.status, 'ok');
  assert.equal(persisted.records[persisted.records.length - 1].type, 'recovery-state');
});

test('failure before mutation stays on the old remote with an opened journal', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());
  const journalPath = tempRecoveryJournalPath();
  const remote = baseSite();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const before = JSON.stringify(remote);
  const error = captureError(() =>
    applyPlan(remote, plan, {
      failBeforeMutation: true,
      durableJournal,
    }));
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.ok(error instanceof PushPlanError);
  assert.equal(JSON.stringify(remote), before);
  assert.equal(error.details.recovery.status, 'old-remote');
  assert.equal(error.details.recovery.artifacts.journal.status, 'opened');
  assert.equal(error.details.recovery.artifacts.remote, undefined);
  assert.equal(persisted.integrity.status, 'ok');
});

test('durable failure before mutation keeps the old remote and only records the opened journal boundary', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());
  const journalPath = tempRecoveryJournalPath();
  const remote = baseSite();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const before = JSON.stringify(remote);

  const error = captureError(() =>
    applyPlan(remote, plan, {
      failBeforeMutation: true,
      durableJournal,
    }),
  );
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'INJECTED_FAILURE_BEFORE_MUTATION');
  assert.equal(JSON.stringify(remote), before);
  assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
  assert.equal(error.details.recovery.artifacts.journal.status, 'opened');
  assert.equal(error.details.recovery.artifacts.remote, undefined);
  assert.equal(persisted.integrity.status, 'ok');
  assert.deepEqual(
    persisted.records.map((record) => record.type),
    ['journal-opened', 'target-planned', 'target-planned', 'recovery-state'],
  );
  assert.equal(persisted.records[persisted.records.length - 1].state, 'old-remote');
});

test('failure after staging stays on the old remote with a staged journal', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());
  const journalPath = tempRecoveryJournalPath();
  const remote = baseSite();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const before = JSON.stringify(remote);
  const error = captureError(() =>
    applyPlan(remote, plan, {
      failAfterStaging: true,
      durableJournal,
    }));
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.ok(error instanceof PushPlanError);
  assert.equal(JSON.stringify(remote), before);
  assert.equal(error.details.recovery.status, 'old-remote');
  assert.equal(error.details.recovery.artifacts.journal.status, 'staged');
  assert.equal(error.details.recovery.artifacts.remote, undefined);
  assert.equal(persisted.integrity.status, 'ok');
});

test('failure after dependency validation stays on the old remote with a validated journal', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());
  const journalPath = tempRecoveryJournalPath();
  const remote = baseSite();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const before = JSON.stringify(remote);
  const error = captureError(() =>
    applyPlan(remote, plan, {
      failAfterDependencyValidation: true,
      durableJournal,
    }));
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.ok(error instanceof PushPlanError);
  assert.equal(JSON.stringify(remote), before);
  assert.equal(error.details.recovery.status, 'old-remote');
  assert.equal(error.details.recovery.artifacts.journal.status, 'dependencies-validated');
  assert.equal(error.details.recovery.artifacts.remote, undefined);
  assert.equal(persisted.integrity.status, 'ok');
});

test('failure during the first commit step blocks recovery and preserves inspectable partial remote artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
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

  assert.ok(error instanceof PushPlanError);
  assert.equal(remote.files['index.php'], '<?php echo "local";');
  assert.equal(remote.db.wp_posts['ID:2'], undefined);
  assert.equal(error.details.recovery.status, 'blocked-recovery');
  assert.equal(error.details.recovery.artifacts.journal.status, 'blocked');
  assert.ok(error.details.recovery.artifacts.remote, 'mid-apply recovery must carry remote artifacts');
  assert.equal(error.details.recovery.artifacts.remote.files['index.php'], '<?php echo "local";');
  assert.equal(error.details.recovery.artifacts.remote.db.wp_posts['ID:2'], undefined);
  assert.equal(persisted.integrity.status, 'ok');
  assert.ok(persisted.records.some((record) => record.type === 'apply-committing'));
  assert.ok(persisted.records.some((record) => record.type === 'mutation-observed'));
  assert.equal(persisted.records[persisted.records.length - 1].type, 'recovery-state');
});

test('replaying a completed plan stays inert and reports fully updated recovery', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());
  const completed = applyPlan(baseSite(), plan);
  const journalPath = tempRecoveryJournalPath();
  const replayWriter = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal: replayWriter,
  });
  replayWriter.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(persisted.integrity.status, 'ok');
  assert.equal(persisted.records[persisted.records.length - 2].type, 'recovery-state');
  assert.equal(persisted.records[persisted.records.length - 1].type, 'journal-replayed');
  assert.equal(persisted.records[persisted.records.length - 1].state, 'fully-updated-remote');
});

test('replaying a completed plan twice remains inert and does not duplicate inserts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());
  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const firstReplay = applyPlan(replayRemote, plan, { journal: completed.journal });
  const secondReplay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(firstReplay.appliedMutations, 0);
  assert.equal(secondReplay.appliedMutations, 0);
  assert.equal(firstReplay.recoveryState.status, 'fully-updated-remote');
  assert.equal(secondReplay.recoveryState.status, 'fully-updated-remote');
  assert.equal(firstReplay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(secondReplay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replayRemote.files['index.php'], '<?php echo "local";');
  assert.equal(replayRemote.db.wp_posts['ID:2'].post_title, 'Inserted locally');
});

test('durable no-data-loss recovery keeps completed replay inert and stale completed replay blocked', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());
  const completed = applyPlan(baseSite(), plan);
  const journalPath = tempRecoveryJournalPath();
  const replayWriter = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal: replayWriter,
  });
  replayWriter.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(persisted.integrity.status, 'ok');
  assert.equal(persisted.records[persisted.records.length - 2].type, 'recovery-state');
  assert.equal(persisted.records[persisted.records.length - 1].type, 'journal-replayed');
  assert.equal(persisted.records[persisted.records.length - 1].state, 'fully-updated-remote');
});

test('durable completed replay stays idempotent after the local source diverges', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());
  const completed = applyPlan(baseSite(), plan);
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const before = JSON.stringify(replayRemote);

  local.files['index.php'] = '<?php echo "stale-local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(replayRemote), before);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(persisted.integrity.status, 'ok');
  assert.equal(persisted.records[persisted.records.length - 2].type, 'recovery-state');
  assert.equal(persisted.records[persisted.records.length - 1].type, 'journal-replayed');
  assert.equal(persisted.records[persisted.records.length - 1].state, 'fully-updated-remote');
});

test('durable recovery boundaries stay in old remote or fully updated remote with inspectable artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);

  for (const [label, options, expectedStatus, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'old-remote', 'opened'],
    ['after staging', { failAfterStaging: true }, 'old-remote', 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'old-remote', 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remoteSnapshot = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, { ...options, durableJournal }));
    durableJournal.close();

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), JSON.stringify(baseSite()), label);
    assertAcceptableRecoveryState(error.details.recovery);
    assert.equal(error.details.recovery.status, expectedStatus, label);
    assert.ok(error.details.recovery.artifacts.journal, label);
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
  }

  const completed = applyPlan(baseSite(), plan);
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.deepEqual(
    persisted.records.map((record) => record.type),
    ['journal-opened', ...plan.mutations.map(() => 'target-planned'), 'recovery-state', 'journal-replayed'],
  );
  assert.equal(persisted.records[persisted.records.length - 1].state, 'fully-updated-remote');
});

test('durable failure before mutation keeps the old remote and records only the opening boundary', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const remoteSnapshot = JSON.stringify(remote);

  const error = captureError(() => applyPlan(remote, plan, { failBeforeMutation: true, durableJournal }));
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.ok(error instanceof PushPlanError);
  assert.equal(JSON.stringify(remote), remoteSnapshot);
  assert.equal(error.details.recovery.status, 'old-remote');
  assert.equal(error.details.recovery.artifacts.journal.status, 'opened');
  assert.equal(error.details.recovery.artifacts.remote, undefined);
  assert.deepEqual(
    persisted.records.map((record) => record.type),
    ['journal-opened', ...plan.mutations.map(() => 'target-planned'), 'recovery-state'],
  );
  assert.equal(persisted.integrity.status, 'ok');
});

test('durable failure after staging keeps the old remote and preserves staged recovery evidence', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const remoteSnapshot = JSON.stringify(remote);

  const error = captureError(() => applyPlan(remote, plan, { failAfterStaging: true, durableJournal }));
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.ok(error instanceof PushPlanError);
  assert.equal(JSON.stringify(remote), remoteSnapshot);
  assert.equal(error.details.recovery.status, 'old-remote');
  assert.equal(error.details.recovery.artifacts.journal.status, 'staged');
  assert.equal(error.details.recovery.artifacts.remote, undefined);
  assert.deepEqual(
    persisted.records.map((record) => record.type),
    ['journal-opened', ...plan.mutations.map(() => 'target-planned'), 'apply-staged', 'recovery-state'],
  );
  assert.equal(persisted.integrity.status, 'ok');
});

test('durable failure after dependency validation keeps the old remote and preserves validation evidence', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const remoteSnapshot = JSON.stringify(remote);

  const error = captureError(() =>
    applyPlan(remote, plan, { failAfterDependencyValidation: true, durableJournal }),
  );
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.ok(error instanceof PushPlanError);
  assert.equal(JSON.stringify(remote), remoteSnapshot);
  assert.equal(error.details.recovery.status, 'old-remote');
  assert.equal(error.details.recovery.artifacts.journal.status, 'dependencies-validated');
  assert.equal(error.details.recovery.artifacts.remote, undefined);
  assert.deepEqual(
    persisted.records.map((record) => record.type),
    [
      'journal-opened',
      ...plan.mutations.map(() => 'target-planned'),
      'apply-staged',
      'dependencies-validated',
      'recovery-state',
    ],
  );
  assert.equal(persisted.integrity.status, 'ok');
});

test('durable dependency-validation recovery retries to completion and completed replay stays inert', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const firstWriter = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const remote = baseSite();

  const failure = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal: firstWriter,
      failAfterDependencyValidation: true,
    }),
  );
  firstWriter.close();

  assert.ok(failure instanceof PushPlanError);
  assert.equal(failure.details.recovery.status, 'old-remote');
  assert.equal(failure.details.recovery.artifacts.journal.status, 'dependencies-validated');
  assert.equal(failure.details.recovery.artifacts.remote, undefined);

  const retryWriter = openRecoveryJournal(journalPath, { now: fixedNow });
  const retry = applyPlan(remote, plan, {
    durableJournal: retryWriter,
    journal: failure.details.recovery.artifacts.journal,
  });
  retryWriter.close();

  assert.equal(retry.appliedMutations, plan.mutations.length);
  assert.equal(retry.recoveryState.status, 'fully-updated-remote');
  assert.equal(retry.site.files['index.php'], '<?php echo "local";');
  assert.equal(retry.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');

  const replayWriter = openRecoveryJournal(journalPath, { now: fixedNow });
  const replayRemote = JSON.parse(JSON.stringify(retry.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayWriter,
    journal: retry.journal,
  });
  replayWriter.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(
    persisted.records.filter((record) => record.type === 'journal-replayed').length >= 1,
    true,
  );
  assert.equal(
    persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
    false,
  );
});

test('completed plan replay keeps insert cardinality stable and ignores stale local source data', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  durableJournal.close();

  const staleLocal = JSON.parse(JSON.stringify(local));
  staleLocal.files['index.php'] = '<?php echo "stale local";';
  staleLocal.db.wp_posts['ID:2'].post_title = 'Inserted stale locally';

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(staleLocal.files['index.php'], '<?php echo "stale local";');
  assert.equal(staleLocal.db.wp_posts['ID:2'].post_title, 'Inserted stale locally');
  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
  assert.equal(
    persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
    false,
  );
});

test('durable stale completed replay blocks with inspectable artifacts instead of duplicating inserts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());
  const completed = applyPlan(baseSite(), plan);
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  replayRemote.files['index.php'] = '<?php echo "drifted";';
  const replayBefore = JSON.stringify(replayRemote);

  const error = captureError(() =>
    applyPlan(replayRemote, plan, {
      journal: completed.journal,
      durableJournal,
    }));
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.ok(error instanceof PushPlanError);
  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(error.details.recovery.status, 'blocked-recovery');
  assert.equal(error.details.recovery.artifacts.journal.status, 'completed');
  assert.ok(error.details.recovery.artifacts.remote);
  assert.equal(error.details.recovery.artifacts.remote.files['index.php'], '<?php echo "drifted";');
  assert.equal(error.details.recovery.artifacts.remote.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(persisted.integrity.status, 'ok');
  assert.equal(persisted.records.length, 1);
  assert.equal(persisted.records[0].type, 'recovery-state');
  assert.equal(persisted.records[0].state, 'blocked-recovery');
});

test('blocked stale completed replay stays blocked on retry and does not mutate the remote', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  replayRemote.files['index.php'] = '<?php echo "drifted";';
  const replayBefore = JSON.stringify(replayRemote);

  const firstError = captureError(() => applyPlan(replayRemote, plan, { journal: completed.journal }));
  const secondError = captureError(() => applyPlan(replayRemote, plan, { journal: completed.journal }));

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(firstError.details.recovery.status, 'blocked-recovery');
  assert.equal(secondError.details.recovery.status, 'blocked-recovery');
  assert.ok(firstError.details.recovery.artifacts?.journal, 'blocked replay must keep journal artifacts');
  assert.ok(firstError.details.recovery.artifacts?.remote, 'blocked replay must keep remote artifacts');
  assert.ok(secondError.details.recovery.artifacts?.journal, 'blocked replay retry must keep journal artifacts');
  assert.ok(secondError.details.recovery.artifacts?.remote, 'blocked replay retry must keep remote artifacts');
  assert.equal(firstError.details.recovery.artifacts.remote.files['index.php'], '<?php echo "drifted";');
  assert.equal(secondError.details.recovery.artifacts.remote.files['index.php'], '<?php echo "drifted";');
  assert.equal(secondError.details.recovery.artifacts.journal.status, 'completed');
});

test('durable completed replay stays inert when local source has stale inserts and edits', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());
  const completed = applyPlan(baseSite(), plan);
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);

  local.files['index.php'] = '<?php echo "stale-local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Stale local insert', post_status: 'draft' };

  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(persisted.records[persisted.records.length - 2].type, 'recovery-state');
  assert.equal(persisted.records[persisted.records.length - 1].type, 'journal-replayed');
  assert.equal(persisted.records[persisted.records.length - 1].state, 'fully-updated-remote');
});

test('atomic apply recovery boundaries stay within the acceptable contract across failures and completed replay', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'old-remote'],
    ['after staging', { failAfterStaging: true }, 'old-remote'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'old-remote'],
  ]) {
    const remote = baseSite();
    const snapshot = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, options));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), snapshot, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, expectedStatus);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
  }

  const completed = applyPlan(baseSite(), plan);
  assertAcceptableRecoveryState(completed.recoveryState);
  assertRecoveryStateArtifacts(completed.recoveryState, 'fully-updated-remote');
  assert.equal(completed.recoveryState.artifacts.remote, undefined);

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
});

test('durable completed replay stays inert across repeated replays and never resurrects stale local data', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());
  const completed = applyPlan(baseSite(), plan);

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);

  local.files['index.php'] = '<?php echo "stale-local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Stale local insert', post_status: 'draft' };

  const firstReplay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });
  const secondReplay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(firstReplay.appliedMutations, 0);
  assert.equal(secondReplay.appliedMutations, 0);
  assert.equal(firstReplay.site.files['index.php'], '<?php echo "local";');
  assert.equal(secondReplay.site.files['index.php'], '<?php echo "local";');
  assert.equal(firstReplay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(secondReplay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(firstReplay.recoveryState.status, 'fully-updated-remote');
  assert.equal(secondReplay.recoveryState.status, 'fully-updated-remote');
  assert.equal(persisted.records.filter((record) => record.type === 'journal-replayed').length, 2);
  assert.equal(persisted.records[persisted.records.length - 1].state, 'fully-updated-remote');
});

test('durable recovery contract keeps pre-commit failures old and completed replay inert on the persisted journal', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalState] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const snapshot = JSON.stringify(remote);

    const error = captureError(() => applyPlan(remote, plan, { ...options, durableJournal }));
    durableJournal.close();

    const persisted = readRecoveryJournal(journalPath);

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), snapshot, label);
    assert.equal(error.details.recovery.status, 'old-remote', label);
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalState, label);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(persisted.records[persisted.records.length - 1].type, 'recovery-state', label);
    assert.equal(persisted.records[persisted.records.length - 1].state, 'old-remote', label);
  }

  const completed = applyPlan(baseSite(), plan);
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);

  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(persisted.records[persisted.records.length - 2].type, 'recovery-state');
  assert.equal(persisted.records[persisted.records.length - 1].type, 'journal-replayed');
  assert.equal(persisted.records[persisted.records.length - 1].state, 'fully-updated-remote');
});

test('acceptable recovery outcomes are old remote, fully updated remote, or blocked with artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const oldRemoteError = captureError(() =>
    applyPlan(baseSite(), plan, { failAfterStaging: true }),
  );
  assertAcceptableRecoveryState(oldRemoteError.details.recovery);
  assertRecoveryStateArtifacts(oldRemoteError.details.recovery, 'old-remote');

  const completed = applyPlan(baseSite(), plan);
  assertAcceptableRecoveryState(completed.recoveryState);
  assertRecoveryStateArtifacts(completed.recoveryState, 'fully-updated-remote');

  const driftedRemote = JSON.parse(JSON.stringify(completed.site));
  driftedRemote.files['index.php'] = '<?php echo "drifted";';
  const blockedError = captureError(() => applyPlan(driftedRemote, plan, { journal: completed.journal }));
  assertAcceptableRecoveryState(blockedError.details.recovery);
  assert.equal(blockedError.details.recovery.status, 'blocked-recovery');
  assert.ok(blockedError.details.recovery.artifacts.journal);
  assert.ok(blockedError.details.recovery.artifacts.remote);
  assert.equal(blockedError.details.recovery.artifacts.remote.files['index.php'], '<?php echo "drifted";');
  assert.equal(
    blockedError.details.recovery.artifacts.remote.db.wp_posts['ID:2'].post_title,
    'Inserted locally',
  );
  assert.equal(blockedError.details.recovery.artifacts.journal.status, 'completed');
});

test('atomic apply recovery contract keeps the post-failure states distinct', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const beforeMutationError = captureError(() =>
    applyPlan(baseSite(), plan, { failBeforeMutation: true }),
  );
  assert.equal(beforeMutationError.details.recovery.status, 'old-remote');
  assert.ok(beforeMutationError.details.recovery.artifacts.journal);
  assert.equal(beforeMutationError.details.recovery.artifacts.remote, undefined);

  const afterStagingError = captureError(() =>
    applyPlan(baseSite(), plan, { failAfterStaging: true }),
  );
  assert.equal(afterStagingError.details.recovery.status, 'old-remote');
  assert.ok(afterStagingError.details.recovery.artifacts.journal);
  assert.equal(afterStagingError.details.recovery.artifacts.remote, undefined);

  const afterDependencyValidationError = captureError(() =>
    applyPlan(baseSite(), plan, { failAfterDependencyValidation: true }),
  );
  assert.equal(afterDependencyValidationError.details.recovery.status, 'old-remote');
  assert.ok(afterDependencyValidationError.details.recovery.artifacts.journal);
  assert.equal(afterDependencyValidationError.details.recovery.artifacts.remote, undefined);

  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.ok(replay.recoveryState.artifacts.journal);
  assert.equal(replay.recoveryState.artifacts.remote, undefined);

  const blockedRemote = JSON.parse(JSON.stringify(completed.site));
  blockedRemote.files['index.php'] = '<?php echo "drifted";';
  const blockedError = captureError(() => applyPlan(blockedRemote, plan, { journal: completed.journal }));
  assert.equal(blockedError.details.recovery.status, 'blocked-recovery');
  assert.ok(blockedError.details.recovery.artifacts.journal);
  assert.ok(blockedError.details.recovery.artifacts.remote);
});

test('durable recovery outcomes stay within the contract across failure boundaries and completed replay', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const error = captureError(() => applyPlan(remote, plan, { ...options, durableJournal }));
    durableJournal.close();

    assert.ok(error instanceof PushPlanError, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
  }

  const completed = applyPlan(baseSite(), plan);
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.deepEqual(
    persisted.records.map((record) => record.type),
    ['journal-opened', ...plan.mutations.map(() => 'target-planned'), 'recovery-state', 'journal-replayed'],
  );
  assert.equal(persisted.records[persisted.records.length - 1].state, 'fully-updated-remote');
});

test('completed replay stays inert and does not duplicate inserts or stale local data', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const completed = applyPlan(baseSite(), plan);
  assert.equal(completed.appliedMutations, 2);
  assert.equal(completed.recoveryState.status, 'fully-updated-remote');

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
});

test('no-data-loss recovery boundaries stay in the accepted post-failure states', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const remote = baseSite();
    const before = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, options));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), before, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assert.equal(error.details.recovery.status, 'old-remote', label);
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
  }

  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
});

test('completed replay stays inert even if the local source diverges after completion', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);

  local.files['index.php'] = '<?php echo "stale local divergence";';
  local.db.wp_posts['ID:2'].post_title = 'Stale inserted title';

  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
});

test('accepted recovery states cover pre-mutation failure, post-staging failure, post-validation failure, and completed replay', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const options of [
    { failBeforeMutation: true },
    { failAfterStaging: true },
    { failAfterDependencyValidation: true },
  ]) {
    const remote = baseSite();
    const before = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, options));

    assert.ok(error instanceof PushPlanError);
    assert.equal(JSON.stringify(remote), before);
    assertAcceptableRecoveryState(error.details.recovery);
    assert.equal(error.details.recovery.status, 'old-remote');
    assert.ok(error.details.recovery.artifacts.journal);
    assert.equal(error.details.recovery.artifacts.remote, undefined);
  }

  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.ok(replay.recoveryState.artifacts.journal);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
});

test('durable recovery contract keeps the only acceptable post-failure states across failure boundaries and completed replay', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const snapshot = JSON.stringify(remote);

    const error = captureError(() => applyPlan(remote, plan, { ...options, durableJournal }));
    durableJournal.close();

    const persisted = readRecoveryJournal(journalPath);

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), snapshot, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assert.equal(error.details.recovery.status, 'old-remote', label);
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(persisted.records[persisted.records.length - 1].type, 'recovery-state', label);
    assert.equal(persisted.records[persisted.records.length - 1].state, 'old-remote', label);
    assert.equal(persisted.integrity.status, 'ok', label);
  }

  const completed = applyPlan(baseSite(), plan);
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);

  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(persisted.records[persisted.records.length - 2].type, 'recovery-state');
  assert.equal(persisted.records[persisted.records.length - 1].type, 'journal-replayed');
  assert.equal(persisted.records[persisted.records.length - 1].state, 'fully-updated-remote');
});

test('durable completed replay stays inert after local divergence and does not duplicate stale inserts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const completed = applyPlan(baseSite(), plan);
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);

  local.files['index.php'] = '<?php echo "stale local divergence";';
  local.db.wp_posts['ID:2'].post_title = 'Stale inserted title';

  const firstReplay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });
  const firstReplaySnapshot = JSON.stringify(replayRemote);
  const secondReplay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(JSON.stringify(replayRemote), firstReplaySnapshot);
  assert.equal(firstReplay.appliedMutations, 0);
  assert.equal(secondReplay.appliedMutations, 0);
  assert.equal(firstReplay.site.files['index.php'], '<?php echo "local";');
  assert.equal(firstReplay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(secondReplay.site.files['index.php'], '<?php echo "local";');
  assert.equal(secondReplay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assertAcceptableRecoveryState(firstReplay.recoveryState);
  assertRecoveryStateArtifacts(firstReplay.recoveryState, 'fully-updated-remote');
  assert.equal(firstReplay.recoveryState.artifacts.remote, undefined);
  assertAcceptableRecoveryState(secondReplay.recoveryState);
  assertRecoveryStateArtifacts(secondReplay.recoveryState, 'fully-updated-remote');
  assert.equal(secondReplay.recoveryState.artifacts.remote, undefined);
  assert.equal(persisted.records.filter((record) => record.type === 'journal-replayed').length, 2);
  assert.equal(persisted.records.every((record) => record.state !== 'blocked-recovery'), true);
});

test('no-data-loss recovery only accepts old remote, fully updated remote, or blocked recovery states', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const remote = baseSite();
    const before = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, options));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), before, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assert.equal(error.details.recovery.status, 'old-remote', label);
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
  }

  const completed = applyPlan(baseSite(), plan);
  assertAcceptableRecoveryState(completed.recoveryState);
  assert.equal(completed.recoveryState.status, 'fully-updated-remote');
  assert.ok(completed.recoveryState.artifacts.journal);
  assert.equal(completed.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(completed.recoveryState.artifacts.remote, undefined);

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
});

test('durable no-data-loss recovery boundaries stay in the accepted post-failure states', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const remote = baseSite();
    const before = JSON.stringify(remote);
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const error = captureError(() => applyPlan(remote, plan, { ...options, durableJournal }));
    durableJournal.close();

    const persisted = readRecoveryJournal(journalPath);

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), before, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assert.equal(error.details.recovery.status, 'old-remote', label);
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.ok(persisted.records.length >= 2, label);
    assert.equal(persisted.records[0].type, 'journal-opened', label);
    assert.equal(persisted.records[persisted.records.length - 1].type, 'recovery-state', label);
  }

  const completed = applyPlan(baseSite(), plan);
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal, durableJournal });
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(persisted.records[0].type, 'journal-opened');
  assert.equal(persisted.records[persisted.records.length - 2].type, 'recovery-state');
  assert.equal(persisted.records[persisted.records.length - 1].type, 'journal-replayed');
});

test('durable stale completed replay blocks with inspectable artifacts instead of reapplying', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const completed = applyPlan(baseSite(), plan);
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const staleRemote = JSON.parse(JSON.stringify(completed.site));
  staleRemote.db.wp_posts['ID:2'].post_title = 'Drifted after completion';
  const staleBefore = JSON.stringify(staleRemote);

  const error = captureError(() =>
    applyPlan(staleRemote, plan, {
      journal: completed.journal,
      durableJournal,
    }));
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.ok(error instanceof PushPlanError);
  assert.equal(JSON.stringify(staleRemote), staleBefore);
  assertAcceptableRecoveryState(error.details.recovery);
  assert.equal(error.details.recovery.status, 'blocked-recovery');
  assert.ok(error.details.recovery.artifacts.journal, 'blocked replay must retain journal artifacts');
  assert.ok(error.details.recovery.artifacts.remote, 'blocked replay must retain remote artifacts');
  assert.equal(error.details.recovery.artifacts.journal.status, 'completed');
  assert.equal(error.details.recovery.artifacts.remote.db.wp_posts['ID:2'].post_title, 'Drifted after completion');
  assert.equal(persisted.records[persisted.records.length - 1].type, 'recovery-state');
  assert.equal(persisted.records[persisted.records.length - 1].state, 'blocked-recovery');
  assert.equal(persisted.records[persisted.records.length - 1].reason, error.details.recovery.reason);
  assert.equal(persisted.integrity.status, 'ok');
});

test('durable replay of a completed plan stays inert after an interrupted attempt', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const interrupted = captureError(() =>
    applyPlan(baseSite(), plan, {
      failAfterStaging: true,
      durableJournal,
    }));
  assert.ok(interrupted instanceof PushPlanError);

  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);

  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(
    persisted.records.filter((record) => record.type === 'target-planned').length,
    plan.mutations.length,
  );
  assert.equal(
    persisted.records.filter((record) => record.type === 'journal-replayed').length,
    1,
  );
});

test('durable completed replay ignores stale local source changes and stays read-only', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());
  const completed = applyPlan(baseSite(), plan);

  const staleLocal = JSON.parse(JSON.stringify(local));
  staleLocal.files['index.php'] = '<?php echo "stale-local";';
  staleLocal.db.wp_posts['ID:2'].post_title = 'Stale local insert';

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(staleLocal.files['index.php'], '<?php echo "stale-local";');
  assert.equal(staleLocal.db.wp_posts['ID:2'].post_title, 'Stale local insert');
  assert.equal(persisted.integrity.status, 'ok');
  assert.ok(persisted.records.some((record) => record.type === 'journal-replayed'));
});

test('durable completed replay stays append-only across repeated retries and never reopens targets', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const completed = applyPlan(baseSite(), plan);
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);

  const firstReplay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });
  const secondReplay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);
  const recordTypes = persisted.records.map((record) => record.type);

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(firstReplay.appliedMutations, 0);
  assert.equal(secondReplay.appliedMutations, 0);
  assert.equal(firstReplay.recoveryState.status, 'fully-updated-remote');
  assert.equal(secondReplay.recoveryState.status, 'fully-updated-remote');
  assert.deepEqual(recordTypes, [
    'journal-opened',
    ...plan.mutations.map(() => 'target-planned'),
    'recovery-state',
    'journal-replayed',
    'recovery-state',
    'journal-replayed',
  ]);
  assert.equal(
    persisted.records.filter((record) => record.type === 'journal-opened').length,
    1,
  );
  assert.equal(
    persisted.records.filter((record) => record.type === 'target-planned').length,
    plan.mutations.length,
  );
  assert.equal(
    persisted.records.filter((record) => record.type === 'journal-replayed').length,
    2,
  );
});

test('durable no-data-loss recovery keeps every failure boundary in an acceptable post-state', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);

  const failureScenarios = [
    ['before mutation', { failBeforeMutation: true }, 'old-remote', 'opened'],
    ['after staging', { failAfterStaging: true }, 'old-remote', 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'old-remote', 'dependencies-validated'],
  ];

  for (const [label, options, expectedRecoveryState, expectedJournalState] of failureScenarios) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const before = JSON.stringify(remote);

    const error = captureError(() =>
      applyPlan(remote, plan, {
        ...options,
        durableJournal,
      }),
    );
    durableJournal.close();

    const persisted = readRecoveryJournal(journalPath);

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), before, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, expectedRecoveryState);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(error.details.recovery.artifacts.journal.planId, plan.id, label);
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalState, label);
    assert.equal(persisted.records[0].type, 'journal-opened', label);
    assert.equal(persisted.records[persisted.records.length - 1].type, 'recovery-state', label);
    assert.equal(persisted.records[persisted.records.length - 1].state, expectedRecoveryState, label);
  }

  const replayJournalPath = tempRecoveryJournalPath();
  const replayDurableJournal = openRecoveryJournal(replayJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan);
  assertAcceptableRecoveryState(completed.recoveryState);
  assertRecoveryStateArtifacts(completed.recoveryState, 'fully-updated-remote');
  assert.equal(completed.recoveryState.artifacts.remote, undefined);
  assert.equal(completed.recoveryState.artifacts.journal.status, 'completed');

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal: replayDurableJournal,
  });
  replayDurableJournal.close();

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');

  const replayPersisted = readRecoveryJournal(replayJournalPath);
  assert.equal(
    replayPersisted.records.filter((record) => record.type === 'journal-replayed').length,
    1,
  );
  assert.equal(
    replayPersisted.records.filter((record) => record.type === 'target-planned').length,
    plan.mutations.length,
  );
});

test('recovery boundaries stay within the accepted no-data-loss states', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedStatus] of [
    ['failure before mutation', { failBeforeMutation: true }, 'old-remote'],
    ['failure after staging', { failAfterStaging: true }, 'old-remote'],
    ['failure after dependency validation', { failAfterDependencyValidation: true }, 'old-remote'],
  ]) {
    const remote = baseSite();
    const before = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, options));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), before, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assert.equal(error.details.recovery.status, expectedStatus, label);
    assert.ok(error.details.recovery.artifacts.journal, label);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
  }

  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.ok(replay.recoveryState.artifacts.journal);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
});

test('the no-data-loss contract keeps every failure boundary either old remote, fully updated, or blocked with artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'old-remote'],
    ['after staging', { failAfterStaging: true }, 'old-remote'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'old-remote'],
  ]) {
    const error = captureError(() => applyPlan(baseSite(), plan, options));
    assert.ok(error instanceof PushPlanError, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assert.equal(error.details.recovery.status, expectedStatus, label);
    assert.ok(error.details.recovery.artifacts.journal, label);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
  }

  const completed = applyPlan(baseSite(), plan);
  assertAcceptableRecoveryState(completed.recoveryState);
  assert.equal(completed.recoveryState.status, 'fully-updated-remote');
  assert.ok(completed.recoveryState.artifacts.journal);
  assert.equal(completed.recoveryState.artifacts.remote, undefined);

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });
  assert.equal(JSON.stringify(replayRemote), JSON.stringify(completed.site));
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.ok(replay.recoveryState.artifacts.journal);
  assert.equal(replay.recoveryState.artifacts.remote, undefined);

  const staleReplayRemote = JSON.parse(JSON.stringify(completed.site));
  staleReplayRemote.files['index.php'] = '<?php echo "stale local";';
  staleReplayRemote.db.wp_posts['ID:2'].post_title = 'Stale inserted local';
  const staleReplayError = captureError(() =>
    applyPlan(staleReplayRemote, plan, { journal: completed.journal }));
  assert.equal(staleReplayError.details.recovery.status, 'blocked-recovery');
  assert.ok(staleReplayError.details.recovery.artifacts.journal);
  assert.ok(staleReplayError.details.recovery.artifacts.remote);
});

test('the no-data-loss recovery matrix keeps pre-commit failures old and completed replay inert', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options] of [
    ['before mutation', { failBeforeMutation: true }],
    ['after staging', { failAfterStaging: true }],
    ['after dependency validation', { failAfterDependencyValidation: true }],
  ]) {
    const remote = baseSite();
    const before = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, options));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), before, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assert.equal(error.details.recovery.status, 'old-remote', label);
    assert.ok(error.details.recovery.artifacts.journal, label);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
  }

  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), JSON.stringify(completed.site));
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.ok(replay.recoveryState.artifacts.journal);
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
});

test('accepts only the documented recovery states across failure boundaries and replay', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options] of [
    ['before mutation', { failBeforeMutation: true }],
    ['after staging', { failAfterStaging: true }],
    ['after dependency validation', { failAfterDependencyValidation: true }],
  ]) {
    const remote = baseSite();
    const before = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, options));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), before, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
  }

  const completed = applyPlan(baseSite(), plan);
  assertAcceptableRecoveryState(completed.recoveryState);
  assertRecoveryStateArtifacts(completed.recoveryState, 'fully-updated-remote');
  assert.equal(completed.recoveryState.artifacts.remote, undefined);
  assert.equal(completed.recoveryState.artifacts.journal.status, 'completed');

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');

  const driftedReplayRemote = JSON.parse(JSON.stringify(completed.site));
  driftedReplayRemote.files['index.php'] = '<?php echo "stale local";';
  driftedReplayRemote.db.wp_posts['ID:2'].post_title = 'Stale inserted local';
  const driftedReplayError = captureError(() =>
    applyPlan(driftedReplayRemote, plan, { journal: completed.journal }),
  );

  assertAcceptableRecoveryState(driftedReplayError.details.recovery);
  assert.equal(driftedReplayError.details.recovery.status, 'blocked-recovery');
  assert.ok(driftedReplayError.details.recovery.artifacts.journal);
  assert.ok(driftedReplayError.details.recovery.artifacts.remote);
});

test('pre-mutation failures keep the remote old even when durable recovery-state writes fail', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());
  const remote = baseSite();
  const before = JSON.stringify(remote);
  const durableJournal = failingDurableJournal('recovery-state');

  const error = captureError(() =>
    applyPlan(remote, plan, {
      failBeforeMutation: true,
      durableJournal,
    }),
  );

  assert.ok(error instanceof PushPlanError);
  assert.equal(JSON.stringify(remote), before);
  assert.equal(error.details.recovery.status, 'old-remote');
  assert.ok(error.details.recovery.artifacts.journal);
  assert.equal(error.details.recovery.artifacts.remote, undefined);
  assert.equal(error.details.durableRecoveryStateWriteFailed, true);
  assert.equal(error.details.durableJournalError.eventType, 'recovery-state');
});

test('replaying a completed plan stays inert, does not duplicate inserts, and blocks stale drift with artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });

  const cleanReplayRemote = JSON.parse(JSON.stringify(completed.site));
  const cleanReplay = applyPlan(cleanReplayRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });

  const driftedReplayRemote = JSON.parse(JSON.stringify(completed.site));
  driftedReplayRemote.files['index.php'] = '<?php echo "stale local";';
  driftedReplayRemote.db.wp_posts['ID:2'].post_title = 'Stale inserted local';
  const driftedReplayError = captureError(() =>
    applyPlan(driftedReplayRemote, plan, {
      journal: completed.journal,
      durableJournal,
    }),
  );
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(cleanReplay.appliedMutations, 0);
  assert.equal(cleanReplay.recoveryState.status, 'fully-updated-remote');
  assert.ok(cleanReplay.recoveryState.artifacts.journal);
  assert.equal(cleanReplay.recoveryState.artifacts.remote, undefined);
  assert.equal(cleanReplayRemote.files['index.php'], '<?php echo "local";');
  assert.equal(cleanReplayRemote.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.ok(driftedReplayError instanceof PushPlanError);
  assert.equal(driftedReplayError.details.recovery.status, 'blocked-recovery');
  assert.ok(driftedReplayError.details.recovery.artifacts.journal);
  assert.ok(driftedReplayError.details.recovery.artifacts.remote);
  assert.equal(driftedReplayError.details.recovery.artifacts.remote.files['index.php'], '<?php echo "stale local";');
  assert.equal(
    driftedReplayError.details.recovery.artifacts.remote.db.wp_posts['ID:2'].post_title,
    'Stale inserted local',
  );
  assert.equal(JSON.stringify(driftedReplayRemote.files['index.php']), JSON.stringify('<?php echo "stale local";'));
  assert.equal(
    persisted.records.filter((record) => record.type === 'journal-replayed').length,
    1,
  );
});

test('durable recovery boundaries keep the remote safe and make completed replay inert', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });

  for (const [label, options] of [
    ['before mutation', { failBeforeMutation: true }],
    ['after staging', { failAfterStaging: true }],
    ['after dependency validation', { failAfterDependencyValidation: true }],
  ]) {
    const remote = baseSite();
    const before = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, { ...options, durableJournal }));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), before, label);
    assert.equal(error.details.recovery.status, 'old-remote', label);
    assert.ok(error.details.recovery.artifacts.journal, label);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
  }

  const completed = applyPlan(baseSite(), plan, { durableJournal });
  assert.equal(completed.recoveryState.status, 'fully-updated-remote');
  assert.ok(completed.recoveryState.artifacts.journal);
  assert.equal(completed.recoveryState.artifacts.remote, undefined);

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.ok(replay.recoveryState.artifacts.journal);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(
    persisted.records.filter((record) => record.type === 'journal-replayed').length,
    1,
  );
});

test('durable no-data-loss recovery keeps the accepted failure states and completed replay inert', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const failureScenarios = [
    ['before mutation', { failBeforeMutation: true }, 'old-remote'],
    ['after staging', { failAfterStaging: true }, 'old-remote'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'old-remote'],
  ];

  for (const [label, options, expectedStatus] of failureScenarios) {
    const remote = baseSite();
    const before = JSON.stringify(remote);
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const error = captureError(() =>
      applyPlan(remote, plan, {
        ...options,
        durableJournal,
      }),
    );
    durableJournal.close();

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), before, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assert.equal(error.details.recovery.status, expectedStatus, label);
    assert.ok(error.details.recovery.artifacts.journal, label);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
  }

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.ok(replay.recoveryState.artifacts.journal);
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(replay.site.files['index.php'], completed.site.files['index.php']);
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, completed.site.db.wp_posts['ID:2'].post_title);
  assert.equal(
    persisted.records.filter((record) => record.type === 'journal-replayed').length,
    1,
  );
  assert.equal(
    persisted.records.filter((record) => record.type === 'target-planned').length,
    plan.mutations.length,
  );
});

test('durable recovery boundaries persist the right journal artifacts and keep completed replay inert', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const plan = planFor(base, local, baseSite());

  const scenarios = [
    {
      label: 'before mutation',
      options: { failBeforeMutation: true },
      expectedBoundaries: [],
      expectedRecoveryState: 'old-remote',
      expectMutationObserved: false,
      expectJournalCompleted: false,
    },
    {
      label: 'after staging',
      options: { failAfterStaging: true },
      expectedBoundaries: ['apply-staged'],
      expectedRecoveryState: 'old-remote',
      expectMutationObserved: false,
      expectJournalCompleted: false,
    },
    {
      label: 'after dependency validation',
      options: { failAfterDependencyValidation: true },
      expectedBoundaries: ['apply-staged', 'dependencies-validated'],
      expectedRecoveryState: 'old-remote',
      expectMutationObserved: false,
      expectJournalCompleted: false,
    },
  ];

  for (const scenario of scenarios) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const snapshot = JSON.stringify(remote);

    const error = captureError(() =>
      applyPlan(remote, plan, {
        ...scenario.options,
        durableJournal,
      }),
    );
    durableJournal.close();

    const persisted = readRecoveryJournal(journalPath);

    assert.ok(error instanceof PushPlanError, scenario.label);
    assert.equal(JSON.stringify(remote), snapshot, scenario.label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, scenario.expectedRecoveryState);
    assert.equal(error.details.recovery.artifacts.remote, undefined, scenario.label);

    const recordTypes = persisted.records.map((record) => record.type);
    assert.equal(recordTypes[0], 'journal-opened', scenario.label);
    assert.equal(
      recordTypes.filter((type) => type === 'target-planned').length,
      plan.mutations.length,
      scenario.label,
    );
    for (const boundary of scenario.expectedBoundaries) {
      assert.equal(
        recordTypes.includes(boundary),
        true,
        `${scenario.label}: missing ${boundary}`,
      );
    }
    assert.equal(
      recordTypes.includes('mutation-observed'),
      scenario.expectMutationObserved,
      scenario.label,
    );
    assert.equal(
      recordTypes.includes('journal-completed'),
      scenario.expectJournalCompleted,
      scenario.label,
    );
    assert.equal(
      persisted.records[persisted.records.length - 1].type,
      'recovery-state',
      scenario.label,
    );
    assert.equal(
      persisted.records[persisted.records.length - 1].state,
      'old-remote',
      scenario.label,
    );
  }

  const replayJournalPath = tempRecoveryJournalPath();
  const replayDurableJournal = openRecoveryJournal(replayJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: replayDurableJournal });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const recordsBeforeReplay = completed.journal.entries.length;
  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal: replayDurableJournal,
  });
  replayDurableJournal.close();

  const persisted = readRecoveryJournal(replayJournalPath);

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(
    persisted.records.filter((record) => record.type === 'journal-replayed').length,
    1,
  );
  assert.equal(
    persisted.records.filter((record) => record.type === 'mutation-observed').length,
    recordsBeforeReplay,
    'completed replay must not add new mutation-observed records',
  );
});

test('durable apply recovery only allows old remote, fully updated remote, or blocked recovery with artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const failureScenarios = [
    ['before mutation', { failBeforeMutation: true }],
    ['after staging', { failAfterStaging: true }],
    ['after dependency validation', { failAfterDependencyValidation: true }],
  ];

  for (const [label, options] of failureScenarios) {
    const remote = baseSite();
    const before = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, options));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), before, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assert.equal(error.details.recovery.status, 'old-remote', label);
    assert.ok(error.details.recovery.artifacts.journal, label);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
  }

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.ok(replay.recoveryState.artifacts.journal);
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(
    persisted.records.filter((record) => record.type === 'journal-replayed').length,
    1,
  );
  assert.equal(
    persisted.records.filter((record) => record.type === 'target-planned').length,
    plan.mutations.length,
  );
});

test('the durable recovery boundary matrix keeps failure states old and completed replay inert', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const remote = baseSite();
    const before = JSON.stringify(remote);
    const error = captureError(() =>
      applyPlan(remote, plan, {
        ...options,
        durableJournal,
      }),
    );

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), before, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
  }

  const completed = applyPlan(baseSite(), plan, { durableJournal });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(
    persisted.records.filter((record) => record.type === 'journal-replayed').length,
    1,
  );
  assert.equal(
    persisted.records.filter((record) => record.type === 'target-planned').length,
    plan.mutations.length * 4,
  );
});

test('completed-plan replay reuses the durable journal without duplicating target records', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);
  const targetPlannedRecords = persisted.records.filter((record) => record.type === 'target-planned');

  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(targetPlannedRecords.length, plan.mutations.length);
  assert.equal(
    persisted.records.filter((record) => record.type === 'journal-replayed').length,
    1,
  );
  assert.equal(
    persisted.records.filter((record) => record.type === 'journal-opened').length,
    1,
  );
});

test('replaying a completed plan keeps stale drift blocked and preserves the durable replay journal', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });

  const staleReplayRemote = JSON.parse(JSON.stringify(completed.site));
  staleReplayRemote.files['index.php'] = '<?php echo "stale drift";';
  staleReplayRemote.db.wp_posts['ID:2'].post_title = 'Stale inserted local';
  const staleReplaySnapshot = JSON.stringify(staleReplayRemote);

  const staleReplayError = captureError(() =>
    applyPlan(staleReplayRemote, plan, {
      journal: completed.journal,
      durableJournal,
    }),
  );
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(staleReplayRemote), staleReplaySnapshot);
  assert.ok(staleReplayError instanceof PushPlanError);
  assert.equal(staleReplayError.details.recovery.status, 'blocked-recovery');
  assert.ok(staleReplayError.details.recovery.artifacts.journal);
  assert.ok(staleReplayError.details.recovery.artifacts.remote);
  assert.equal(staleReplayError.details.recovery.artifacts.journal.status, 'completed');
  assert.equal(staleReplayError.details.recovery.artifacts.remote.files['index.php'], '<?php echo "stale drift";');
  assert.equal(
    staleReplayError.details.recovery.artifacts.remote.db.wp_posts['ID:2'].post_title,
    'Stale inserted local',
  );
  assert.equal(
    persisted.records.filter((record) => record.type === 'journal-replayed').length,
    0,
  );
  assert.equal(
    persisted.records.filter((record) => record.type === 'journal-opened').length,
    1,
  );
});

test('completed-plan replay blocks stale drift and keeps the remote inspectable', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  replayRemote.files['index.php'] = '<?php echo "local drift";';
  const replaySnapshot = JSON.stringify(replayRemote);

  const replayError = captureError(() =>
    applyPlan(replayRemote, plan, {
      journal: completed.journal,
      durableJournal,
    }));

  const staleReplayRemote = JSON.parse(JSON.stringify(completed.site));
  staleReplayRemote.files['index.php'] = '<?php echo "stale drift";';
  const staleReplayError = captureError(() =>
    applyPlan(staleReplayRemote, plan, {
      journal: completed.journal,
      durableJournal,
    }));
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.ok(replayError instanceof PushPlanError);
  assertAcceptableRecoveryState(replayError.details.recovery);
  assert.equal(replayError.details.recovery.status, 'blocked-recovery');
  assert.ok(replayError.details.recovery.artifacts.journal);
  assert.ok(replayError.details.recovery.artifacts.remote);
  assert.equal(replayError.details.recovery.artifacts.remote.files['index.php'], '<?php echo "local drift";');
  assert.equal(replayError.details.recovery.artifacts.remote.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(staleReplayError.details.recovery.status, 'blocked-recovery');
  assert.ok(staleReplayError.details.recovery.artifacts.journal);
  assert.ok(staleReplayError.details.recovery.artifacts.remote);
  assert.equal(staleReplayError.details.recovery.artifacts.remote.files['index.php'], '<?php echo "stale drift";');
  assert.equal(
    persisted.records.filter((record) => record.type === 'journal-replayed').length,
    0,
  );
});

test('completed-plan replay keeps stale remote data blocked and safe retries remain replay-only', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });

  const staleReplayRemote = JSON.parse(JSON.stringify(completed.site));
  staleReplayRemote.files['index.php'] = '<?php echo "stale local";';
  staleReplayRemote.db.wp_posts['ID:2'].post_title = 'Stale inserted local';

  const staleReplayError = captureError(() =>
    applyPlan(staleReplayRemote, plan, {
      journal: completed.journal,
      durableJournal,
    }),
  );

  const cleanReplayRemote = JSON.parse(JSON.stringify(completed.site));
  const cleanReplay = applyPlan(cleanReplayRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(staleReplayError.details.recovery.status, 'blocked-recovery');
  assert.ok(staleReplayError.details.recovery.artifacts.journal);
  assert.ok(staleReplayError.details.recovery.artifacts.remote);
  assert.equal(
    staleReplayError.details.recovery.artifacts.remote.files['index.php'],
    '<?php echo "stale local";',
  );
  assert.equal(
    staleReplayError.details.recovery.artifacts.remote.db.wp_posts['ID:2'].post_title,
    'Stale inserted local',
  );
  assert.equal(cleanReplay.recoveryState.status, 'fully-updated-remote');
  assert.equal(cleanReplay.appliedMutations, 0);
  assert.equal(cleanReplay.recoveryState.artifacts.remote, undefined);
  assert.equal(
    persisted.records.filter((record) => record.type === 'journal-replayed').length,
    1,
  );
  assert.equal(
    persisted.records.filter((record) => record.type === 'journal-opened').length,
    1,
  );
});

test('completed-plan replay stays read-only and blocks when stale local data is reintroduced', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  replayRemote.files['index.php'] = '<?php echo "stale local";';
  replayRemote.db.wp_posts['ID:2'].post_title = 'Stale inserted local';
  const replaySnapshot = JSON.stringify(replayRemote);

  const replayError = captureError(() =>
    applyPlan(replayRemote, plan, {
      journal: completed.journal,
      durableJournal,
    }),
  );
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.ok(replayError instanceof PushPlanError);
  assert.equal(replayError.details.recovery.status, 'blocked-recovery');
  assert.ok(replayError.details.recovery.artifacts.journal);
  assert.ok(replayError.details.recovery.artifacts.remote);
  assert.equal(replayError.details.recovery.artifacts.remote.files['index.php'], '<?php echo "stale local";');
  assert.equal(
    replayError.details.recovery.artifacts.remote.db.wp_posts['ID:2'].post_title,
    'Stale inserted local',
  );
  assert.equal(
    persisted.records.filter((record) => record.type === 'journal-replayed').length,
    0,
  );
});

test('completed-plan replay stays blocked across repeated drifted retries and preserves the same recovery artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });

  const driftedRemote = JSON.parse(JSON.stringify(completed.site));
  driftedRemote.files['index.php'] = '<?php echo "drifted local";';
  driftedRemote.db.wp_posts['ID:2'].post_title = 'Drifted inserted local';
  const driftedSnapshot = JSON.stringify(driftedRemote);

  const firstRetryError = captureError(() =>
    applyPlan(driftedRemote, plan, {
      journal: completed.journal,
      durableJournal,
    }),
  );
  const secondRetryError = captureError(() =>
    applyPlan(driftedRemote, plan, {
      journal: completed.journal,
      durableJournal,
    }),
  );
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(driftedRemote), driftedSnapshot);
  assert.ok(firstRetryError instanceof PushPlanError);
  assert.ok(secondRetryError instanceof PushPlanError);
  assert.equal(firstRetryError.details.recovery.status, 'blocked-recovery');
  assert.equal(secondRetryError.details.recovery.status, 'blocked-recovery');
  assert.ok(firstRetryError.details.recovery.artifacts.journal);
  assert.ok(secondRetryError.details.recovery.artifacts.journal);
  assert.ok(firstRetryError.details.recovery.artifacts.remote);
  assert.ok(secondRetryError.details.recovery.artifacts.remote);
  assert.equal(
    firstRetryError.details.recovery.artifacts.remote.files['index.php'],
    '<?php echo "drifted local";',
  );
  assert.equal(
    secondRetryError.details.recovery.artifacts.remote.db.wp_posts['ID:2'].post_title,
    'Drifted inserted local',
  );
  assert.equal(
    persisted.records.filter((record) => record.type === 'journal-replayed').length,
    0,
  );
});

test('stale recovery claims stay blocked with artifacts and do not become a safe retry', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const workerAClaim = 'worker-a-stale-claim-proof';
  const workerBClaim = 'worker-b-stale-claim-proof';
  const durableJournal = openRecoveryJournal(journalPath, {
    truncate: true,
    now: fixedNow,
    claimId: workerAClaim,
  });
  const remote = baseSite();
  const remoteBefore = JSON.stringify(remote);
  appendRecoveryClaimOpened(durableJournal, {
    plan,
    current: remote,
    claimId: workerAClaim,
    staleThresholdMs: 1000,
  });

  const firstError = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal,
      mutateRemote: true,
      beforeMutation({ mutationIndex }) {
        assert.equal(mutationIndex, 1);
        const competingWriter = openRecoveryJournal(journalPath, {
          now: new Date(fixedNow.getTime() + 5000),
          claimId: workerBClaim,
        });
        appendStaleClaimAdvanced(competingWriter, {
          plan,
          current: remote,
          previousClaimId: workerAClaim,
          claimId: workerBClaim,
          staleThresholdMs: 1000,
          previousClaimAgeMs: 5000,
        });
        competingWriter.close();
      },
    }),
  );

  assert.ok(firstError instanceof PushPlanError);
  assert.equal(firstError.code, 'RECOVERY_CLAIM_STALE');
  assert.equal(firstError.details.recovery.status, 'blocked-recovery');
  assert.ok(firstError.details.recovery.artifacts.journal);
  assert.ok(firstError.details.recovery.artifacts.remote);
  assert.equal(firstError.details.recovery.artifacts.remote.files['index.php'], '<?php echo "base";');
  assert.equal(firstError.details.recovery.artifacts.remote.db.wp_posts['ID:2'], undefined);
  assert.equal(JSON.stringify(remote), remoteBefore);
  assert.equal(remote.files['index.php'], '<?php echo "base";');
  assert.equal(remote.db.wp_posts['ID:2'], undefined);

  const blockedJournal = firstError.details.recovery.artifacts.journal;
  const retrySnapshot = JSON.stringify(remote);
  const retryError = captureError(() =>
    applyPlan(JSON.parse(JSON.stringify(remote)), plan, {
      journal: blockedJournal,
      durableJournal,
    }),
  );
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.ok(retryError instanceof PushPlanError);
  assert.equal(retryError.code, 'RECOVERY_CLAIM_STALE');
  assert.equal(JSON.stringify(remote), retrySnapshot);
  assert.equal(retryError.details.recovery.status, 'blocked-recovery');
  assert.ok(retryError.details.recovery.artifacts.journal);
  assert.ok(retryError.details.recovery.artifacts.remote);
  assert.equal(retryError.details.recovery.artifacts.remote.files['index.php'], '<?php echo "base";');
  assert.equal(retryError.details.recovery.artifacts.remote.db.wp_posts['ID:2'], undefined);
  assert.equal(
    persisted.records.filter((record) => record.type === 'mutation-observed').length,
    0,
  );
});

test('mid-apply failure only leaves blocked recovery with artifacts, never a silent partial remote', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());
  const remote = baseSite();
  const remoteBefore = JSON.stringify(remote);

  const error = captureError(() =>
    applyPlan(remote, plan, {
      mutateRemote: true,
      failDuringCommitAtMutation: 1,
    }),
  );

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'INJECTED_FAILURE_DURING_COMMIT');
  assertAcceptableRecoveryState(error.details.recovery);
  assert.equal(error.details.recovery.status, 'blocked-recovery');
  assert.ok(error.details.recovery.artifacts?.journal, 'blocked recovery must keep journal artifacts');
  assert.ok(error.details.recovery.artifacts?.remote, 'blocked recovery must keep remote artifacts');
  assert.equal(error.details.recovery.artifacts.remote.files['index.php'], '<?php echo "local";');
  assert.equal(
    error.details.recovery.artifacts.remote.db.wp_posts['ID:2'],
    undefined,
    'the partial remote should only expose the mutation that actually committed',
  );
  assert.notEqual(JSON.stringify(remote), remoteBefore);
  assert.equal(remote.files['index.php'], '<?php echo "local";');
  assert.equal(remote.db.wp_posts['ID:2'], undefined);
});

test('mid-apply failure on a later mutation keeps the earlier commit visible and still blocks recovery', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());
  const remote = baseSite();
  const remoteBefore = JSON.stringify(remote);

  const error = captureError(() =>
    applyPlan(remote, plan, {
      mutateRemote: true,
      failDuringCommitAtMutation: 2,
    }),
  );

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'INJECTED_FAILURE_DURING_COMMIT');
  assertAcceptableRecoveryState(error.details.recovery);
  assert.equal(error.details.recovery.status, 'blocked-recovery');
  assert.ok(error.details.recovery.artifacts?.journal, 'blocked recovery must keep journal artifacts');
  assert.ok(error.details.recovery.artifacts?.remote, 'blocked recovery must keep remote artifacts');
  assert.equal(error.details.recovery.artifacts.remote.files['index.php'], '<?php echo "local";');
  assert.equal(
    error.details.recovery.artifacts.remote.db.wp_posts['ID:2'].post_title,
    'Inserted locally',
  );
  assert.notEqual(JSON.stringify(remote), remoteBefore);
  assert.equal(remote.files['index.php'], '<?php echo "local";');
  assert.equal(remote.db.wp_posts['ID:2'].post_title, 'Inserted locally');
});

test('durable mid-apply failure remains blocked on retry and preserves the partial-commit artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const remote = baseSite();

  const firstError = captureError(() =>
    applyPlan(remote, plan, {
      mutateRemote: true,
      failDuringCommitAtMutation: 1,
      durableJournal,
    }));

  assert.ok(firstError instanceof PushPlanError);
  assert.equal(firstError.details.recovery.status, 'blocked-recovery');
  assert.ok(firstError.details.recovery.artifacts.journal, 'blocked recovery must keep journal artifacts');
  assert.ok(firstError.details.recovery.artifacts.remote, 'blocked recovery must keep remote artifacts');
  assert.equal(firstError.details.recovery.artifacts.remote.files['index.php'], '<?php echo "local";');
  assert.equal(firstError.details.recovery.artifacts.remote.db.wp_posts['ID:2'], undefined);

  const partialRemote = JSON.parse(JSON.stringify(remote));
  const retryError = captureError(() =>
    applyPlan(partialRemote, plan, {
      journal: firstError.details.recovery.artifacts.journal,
      durableJournal,
    }));
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.ok(retryError instanceof PushPlanError);
  assert.equal(retryError.details.recovery.status, 'blocked-recovery');
  assert.ok(retryError.details.recovery.artifacts.journal, 'retry must keep journal artifacts');
  assert.ok(retryError.details.recovery.artifacts.remote, 'retry must keep remote artifacts');
  assert.equal(retryError.details.recovery.artifacts.remote.files['index.php'], '<?php echo "local";');
  assert.equal(retryError.details.recovery.artifacts.remote.db.wp_posts['ID:2'], undefined);
  assert.equal(remote.files['index.php'], '<?php echo "local";');
  assert.equal(remote.db.wp_posts['ID:2'], undefined);
  assert.equal(persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'), true);
});

test('durable pre-commit failures keep boundary-specific journal evidence and completed replay stays inert', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const before = JSON.stringify(remote);

    const error = captureError(() =>
      applyPlan(remote, plan, {
        ...options,
        durableJournal,
      }),
    );
    durableJournal.close();

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), before, label);
    assert.equal(error.details.recovery.status, 'old-remote', label);
    assert.ok(error.details.recovery.artifacts.journal, label);
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
  }

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });
  durableJournal.close();

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.ok(replay.recoveryState.artifacts.journal);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(Object.values(replay.site.db.wp_posts).filter((row) => row.post_title === 'Inserted locally').length, 1);
});

test('durable recovery accepts only old remote, fully updated remote, or blocked recovery with artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const failureScenarios = [
    ['before mutation', { failBeforeMutation: true }, 'old-remote'],
    ['after staging', { failAfterStaging: true }, 'old-remote'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'old-remote'],
  ];

  for (const [label, options, expectedStatus] of failureScenarios) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();

    const error = captureError(() =>
      applyPlan(remote, plan, {
        ...options,
        durableJournal,
      }),
    );
    durableJournal.close();

    assert.ok(error instanceof PushPlanError, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, expectedStatus);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(remote.files['index.php'], base.files['index.php'], label);
    assert.equal(remote.db.wp_posts['ID:2'], undefined, label);
  }

  const blockedJournalPath = tempRecoveryJournalPath();
  const blockedDurableJournal = openRecoveryJournal(blockedJournalPath, { truncate: true, now: fixedNow });
  const blockedRemote = baseSite();
  const blockedRemoteBefore = JSON.stringify(blockedRemote);
  const blockedError = captureError(() =>
    applyPlan(blockedRemote, plan, {
      mutateRemote: true,
      failDuringCommitAtMutation: 1,
      durableJournal: blockedDurableJournal,
    }),
  );
  blockedDurableJournal.close();

  assert.ok(blockedError instanceof PushPlanError);
  assertAcceptableRecoveryState(blockedError.details.recovery);
  assertRecoveryStateArtifacts(blockedError.details.recovery, 'blocked-recovery');
  assert.ok(blockedError.details.recovery.artifacts.remote);
  assert.notEqual(JSON.stringify(blockedRemote), blockedRemoteBefore);
  assert.equal(blockedError.details.recovery.artifacts.remote.files['index.php'], '<?php echo "local";');
  assert.equal(blockedError.details.recovery.artifacts.remote.db.wp_posts['ID:2'], undefined);
  assert.equal(blockedRemote.files['index.php'], '<?php echo "local";');
  assert.equal(blockedRemote.db.wp_posts['ID:2'], undefined);

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal: completedDurableJournal,
  });
  completedDurableJournal.close();

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(
    replay.site.db.wp_posts['ID:2'].post_title,
    'Inserted locally',
    'completed replay must preserve the inserted row',
  );
  assert.equal(
    Object.values(replay.site.db.wp_posts).filter((row) => row.post_title === 'Inserted locally').length,
    1,
    'completed replay must not duplicate inserted rows',
  );
});

test('durable recovery boundaries preserve old-remote failures and completed replay artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const failureScenarios = [
    ['before mutation', { failBeforeMutation: true }, 'journal-opened'],
    ['after staging', { failAfterStaging: true }, 'apply-staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ];

  for (const [label, options, expectedBoundary] of failureScenarios) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const remoteSnapshot = JSON.stringify(remote);

    const error = captureError(() =>
      applyPlan(remote, plan, {
        ...options,
        durableJournal,
      }),
    );
    durableJournal.close();

    const persisted = readRecoveryJournal(journalPath);

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), remoteSnapshot, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(error.details.recovery.artifacts.journal.planId, plan.id, label);
    assert.equal(
      persisted.records.some((record) => record.type === expectedBoundary),
      true,
      label,
    );
    assert.equal(
      persisted.records.some(
        (record) => record.type === 'recovery-state' && record.state === 'old-remote',
      ),
      true,
      label,
    );
    assert.equal(
      persisted.records.some((record) => record.type === 'mutation-observed'),
      false,
      label,
    );
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  const persistedBeforeReplay = readRecoveryJournal(completedJournalPath);
  const mutationObservedCountBeforeReplay = persistedBeforeReplay.records.filter(
    (record) => record.type === 'mutation-observed',
  ).length;
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal: completedDurableJournal,
  });
  completedDurableJournal.close();

  const persisted = readRecoveryJournal(completedJournalPath);

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(
    persisted.records.some((record) => record.type === 'journal-replayed'),
    true,
  );
  assert.equal(
    persisted.records.filter((record) => record.type === 'mutation-observed').length,
    mutationObservedCountBeforeReplay,
  );
});

test('durable replay after an old-remote failure stays append-only and does not duplicate inserts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const remote = baseSite();

  const failure = captureError(() =>
    applyPlan(remote, plan, {
      failAfterDependencyValidation: true,
      durableJournal,
    }),
  );

  assert.ok(failure instanceof PushPlanError);
  assert.equal(failure.details.recovery.status, 'old-remote');
  assert.ok(failure.details.recovery.artifacts.journal, 'old-remote failure must keep journal artifacts');
  assert.equal(failure.details.recovery.artifacts.remote, undefined);

  const completed = applyPlan(baseSite(), plan, { durableJournal });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(
    Object.values(replay.site.db.wp_posts).filter((row) => row.post_title === 'Inserted locally').length,
    1,
    'completed replay must not duplicate inserted rows after an earlier failure',
  );
  assert.equal(
    persisted.records.some((record) => record.type === 'journal-replayed' && record.state === 'fully-updated-remote'),
    true,
  );
});

test('stale completed replay blocks when the remote drifts outside the completed journal envelope', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  const staleReplayRemote = JSON.parse(JSON.stringify(completed.site));
  staleReplayRemote.files['index.php'] = '<?php echo "stale local";';
  delete staleReplayRemote.db.wp_posts['ID:2'];

  const replayError = captureError(() =>
    applyPlan(staleReplayRemote, plan, {
      journal: completed.journal,
      durableJournal,
    }),
  );
  durableJournal.close();

  assert.ok(replayError instanceof PushPlanError);
  assert.equal(replayError.details.recovery.status, 'blocked-recovery');
  assert.ok(replayError.details.recovery.artifacts.journal, 'stale replay must keep journal artifacts');
  assert.ok(replayError.details.recovery.artifacts.remote, 'stale replay must keep remote artifacts');
  assert.equal(replayError.details.recovery.artifacts.remote.files['index.php'], '<?php echo "stale local";');
  assert.equal(replayError.details.recovery.artifacts.remote.db.wp_posts['ID:2'], undefined);
  assert.equal(
    Object.values(replayError.details.recovery.artifacts.remote.db.wp_posts).filter((row) => row.post_title === 'Inserted locally').length,
    0,
    'blocked stale replay must not resurrect the inserted row',
  );
});

test('durable stale completed replay stays blocked and preserves the drifted remote artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  const staleReplayRemote = JSON.parse(JSON.stringify(completed.site));
  staleReplayRemote.files['index.php'] = '<?php echo "stale local";';
  delete staleReplayRemote.db.wp_posts['ID:2'];

  const replayError = captureError(() =>
    applyPlan(staleReplayRemote, plan, {
      journal: completed.journal,
      durableJournal,
    }),
  );
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.ok(replayError instanceof PushPlanError);
  assert.equal(replayError.details.recovery.status, 'blocked-recovery');
  assert.ok(replayError.details.recovery.artifacts.journal, 'durable stale replay must keep journal artifacts');
  assert.ok(replayError.details.recovery.artifacts.remote, 'durable stale replay must keep remote artifacts');
  assert.equal(replayError.details.recovery.artifacts.remote.files['index.php'], '<?php echo "stale local";');
  assert.equal(replayError.details.recovery.artifacts.remote.db.wp_posts['ID:2'], undefined);
  assert.equal(
    persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
    true,
  );
});

test('retrying a blocked completed replay stays blocked and leaves the drifted remote unchanged', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  const driftedRemote = JSON.parse(JSON.stringify(completed.site));
  driftedRemote.files['index.php'] = '<?php echo "stale local";';
  delete driftedRemote.db.wp_posts['ID:2'];

  const firstRetryError = captureError(() =>
    applyPlan(driftedRemote, plan, {
      journal: completed.journal,
      durableJournal,
    }),
  );
  const retrySnapshot = JSON.stringify(driftedRemote);
  const secondRetryError = captureError(() =>
    applyPlan(driftedRemote, plan, {
      journal: completed.journal,
      durableJournal,
    }),
  );
  durableJournal.close();

  assert.ok(firstRetryError instanceof PushPlanError);
  assert.ok(secondRetryError instanceof PushPlanError);
  assert.equal(firstRetryError.code, 'RECOVERY_BLOCKED');
  assert.equal(secondRetryError.code, 'RECOVERY_BLOCKED');
  assert.equal(JSON.stringify(driftedRemote), retrySnapshot);
  assert.equal(driftedRemote.files['index.php'], '<?php echo "stale local";');
  assert.equal(driftedRemote.db.wp_posts['ID:2'], undefined);
  assert.equal(firstRetryError.details.recovery.status, 'blocked-recovery');
  assert.equal(secondRetryError.details.recovery.status, 'blocked-recovery');
  assert.ok(firstRetryError.details.recovery.artifacts.remote, 'first blocked retry must keep remote artifacts');
  assert.ok(secondRetryError.details.recovery.artifacts.remote, 'second blocked retry must keep remote artifacts');
  assert.equal(
    Object.values(secondRetryError.details.recovery.artifacts.remote.db.wp_posts).filter(
      (row) => row.post_title === 'Inserted locally',
    ).length,
    0,
    'blocked retry must not resurrect inserted rows',
  );
});

test('partial commit and completed replay both keep recovery artifacts instead of pretending to be safe', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const partialRemote = baseSite();
  const partialError = captureError(() =>
    applyPlan(partialRemote, plan, {
      mutateRemote: true,
      failDuringCommitAtMutation: 2,
    }),
  );

  assert.ok(partialError instanceof PushPlanError);
  assert.equal(partialError.code, 'INJECTED_FAILURE_DURING_COMMIT');
  assert.equal(partialError.details.recovery.status, 'blocked-recovery');
  assert.ok(partialError.details.recovery.artifacts.journal, 'partial commit must keep journal artifacts');
  assert.ok(partialError.details.recovery.artifacts.remote, 'partial commit must keep remote artifacts');
  assert.equal(partialError.details.recovery.artifacts.remote.files['index.php'], '<?php echo "local";');
  assert.equal(
    partialError.details.recovery.artifacts.remote.db.wp_posts['ID:2'].post_title,
    'Inserted locally',
  );

  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  replayRemote.files['index.php'] = '<?php echo "stale local";';
  delete replayRemote.db.wp_posts['ID:2'];

  const replayError = captureError(() =>
    applyPlan(replayRemote, plan, { journal: completed.journal }),
  );

  assert.ok(replayError instanceof PushPlanError);
  assert.equal(replayError.code, 'RECOVERY_BLOCKED');
  assert.equal(replayError.details.recovery.status, 'blocked-recovery');
  assert.ok(replayError.details.recovery.artifacts.journal, 'stale replay must keep journal artifacts');
  assert.ok(replayError.details.recovery.artifacts.remote, 'stale replay must keep remote artifacts');
  assert.equal(replayError.details.recovery.artifacts.remote.files['index.php'], '<?php echo "stale local";');
  assert.equal(replayError.details.recovery.artifacts.remote.db.wp_posts['ID:2'], undefined);
});

test('apply boundary failures stay in old-remote and completed replay stays fully updated', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, optionKey] of [
    ['before mutation', 'failBeforeMutation'],
    ['after staging', 'failAfterStaging'],
    ['after dependency validation', 'failAfterDependencyValidation'],
  ]) {
    const remote = baseSite();
    const snapshot = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, { [optionKey]: true }));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), snapshot, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(error.details.recovery.artifacts.journal.planId, plan.id, label);
  }

  const partialRemote = baseSite();
  const partialError = captureError(() =>
    applyPlan(partialRemote, plan, {
      mutateRemote: true,
      failDuringCommitAtMutation: 1,
    }),
  );

  assert.ok(partialError instanceof PushPlanError, 'mid-apply failure');
  assert.equal(partialError.code, 'INJECTED_FAILURE_DURING_COMMIT');
  assert.equal(partialError.details.recovery.status, 'blocked-recovery');
  assert.ok(partialError.details.recovery.artifacts.journal, 'mid-apply failure must keep journal artifacts');
  assert.ok(partialError.details.recovery.artifacts.remote, 'mid-apply failure must keep remote artifacts');

  const completed = applyPlan(baseSite(), plan);
  assertAcceptableRecoveryState(completed.recoveryState);
  assertRecoveryStateArtifacts(completed.recoveryState, 'fully-updated-remote');

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
});

test('apply recovery contract keeps failure boundaries old-remote and completed replays inert', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options] of [
    ['before mutation', { failBeforeMutation: true }],
    ['after staging', { failAfterStaging: true }],
    ['after dependency validation', { failAfterDependencyValidation: true }],
  ]) {
    const remote = baseSite();
    const snapshot = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, options));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), snapshot, label);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(error.details.recovery.artifacts.journal.planId, plan.id, label);
  }

  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(
    replay.site.db.wp_posts['ID:2'].post_title,
    'Inserted locally',
    'completed replay must preserve inserted rows',
  );
  assert.equal(
    Object.values(replay.site.db.wp_posts).filter((row) => row.post_title === 'Inserted locally').length,
    1,
    'completed replay must not duplicate inserts',
  );
});

test('completed plan replay records a durable replay boundary without mutating the remote', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const plan = planFor(base, local, baseSite());
  const completedJournalPath = tempRecoveryJournalPath();
  const completedWriter = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedWriter });
  const completedSnapshot = JSON.stringify(completed.site);

  const replayJournalPath = tempRecoveryJournalPath();
  const replayWriter = openRecoveryJournal(replayJournalPath, { truncate: true, now: fixedNow });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal: replayWriter,
  });

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(JSON.stringify(completed.site), completedSnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');

  const persisted = readRecoveryJournal(replayJournalPath);
  assert.equal(
    persisted.records.some((record) => record.type === 'journal-replayed' && record.state === 'fully-updated-remote'),
    true,
  );
  assert.equal(
    persisted.records.some((record) => record.type === 'mutation-observed'),
    false,
  );
});

test('replaying a completed plan stays inert and never revives stale local inserts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const plan = planFor(base, local, baseSite());
  const completed = applyPlan(baseSite(), plan);

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  replayRemote.files['index.php'] = '<?php echo "stale local";';
  replayRemote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Stale insert', post_status: 'draft' };
  const replaySnapshot = JSON.stringify(replayRemote);

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  const replayError = captureError(() => applyPlan(replayRemote, plan, { journal: completed.journal }));

  assert.ok(replayError instanceof PushPlanError);
  assert.equal(replayError.code, 'RECOVERY_BLOCKED');
  assertAcceptableRecoveryState(replayError.details.recovery);
  assertRecoveryStateArtifacts(replayError.details.recovery, 'blocked-recovery');
  assert.ok(replayError.details.recovery.artifacts.remote, 'blocked replay must carry remote artifacts');
  assert.ok(replayError.details.recovery.artifacts.journal, 'blocked replay must carry journal artifacts');
  assert.equal(replayRemote.db.wp_posts['ID:2'].post_title, 'Stale insert');
  assert.equal(replayRemote.files['index.php'], '<?php echo "stale local";');
});

test('completed replay remains inert even when the remote already matches the completed journal', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const plan = planFor(base, local, baseSite());
  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);

  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
});

test('no-data-loss recovery matrix keeps failure-before-mutation, post-staging, post-validation, and completed replay within the safe envelope', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const plan = planFor(base, local, baseSite());

  for (const [label, options] of [
    ['before mutation', { failBeforeMutation: true }],
    ['after staging', { failAfterStaging: true }],
    ['after dependency validation', { failAfterDependencyValidation: true }],
  ]) {
    const remote = baseSite();
    const snapshot = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, options));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), snapshot, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(error.details.recovery.artifacts.journal.planId, plan.id, label);
  }

  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(
    Object.values(replay.site.db.wp_posts).filter((row) => row.post_title === 'Inserted locally').length,
    1,
    'completed replay must not duplicate inserts',
  );
  assert.equal(
    replay.site.db.wp_posts['ID:2'].post_title,
    'Inserted locally',
    'completed replay must not resurrect stale local data',
  );
});

test('atomic apply failure boundaries and completed replay stay within the accepted recovery states', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const plan = planFor(base, local, baseSite());

  for (const [label, options] of [
    ['before mutation', { failBeforeMutation: true }],
    ['after staging', { failAfterStaging: true }],
    ['after dependency validation', { failAfterDependencyValidation: true }],
  ]) {
    const remote = baseSite();
    const snapshot = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, options));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), snapshot, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
  }

  const completed = applyPlan(baseSite(), plan);
  assertAcceptableRecoveryState(completed.recoveryState);
  assertRecoveryStateArtifacts(completed.recoveryState, 'fully-updated-remote');
  assert.equal(completed.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
});

test('durable no-data-loss recovery keeps the only acceptable post-failure states and preserves the insert set', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const plan = planFor(base, local, baseSite());

  for (const [label, options] of [
    ['before mutation', { failBeforeMutation: true }],
    ['after staging', { failAfterStaging: true }],
    ['after dependency validation', { failAfterDependencyValidation: true }],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const snapshot = JSON.stringify(remote);

    const error = captureError(() =>
      applyPlan(remote, plan, {
        ...options,
        durableJournal,
      }),
    );
    durableJournal.close();

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), snapshot, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(error.details.recovery.artifacts.journal.planId, plan.id, label);
  }

  const beforeMutationJournalPath = tempRecoveryJournalPath();
  const beforeMutationDurableJournal = openRecoveryJournal(beforeMutationJournalPath, {
    truncate: true,
    now: fixedNow,
  });
  const beforeMutationRemote = baseSite();
  const beforeMutationSnapshot = JSON.stringify(beforeMutationRemote);
  const beforeMutationError = captureError(() =>
    applyPlan(beforeMutationRemote, plan, {
      failBeforeMutation: true,
      durableJournal: beforeMutationDurableJournal,
    }),
  );
  beforeMutationDurableJournal.close();
  const beforeMutationPersisted = readRecoveryJournal(beforeMutationJournalPath);

  assert.ok(beforeMutationError instanceof PushPlanError, 'before mutation durable failure');
  assert.equal(beforeMutationError.code, 'INJECTED_FAILURE_BEFORE_MUTATION');
  assert.equal(JSON.stringify(beforeMutationRemote), beforeMutationSnapshot, 'before mutation durable failure');
  assertAcceptableRecoveryState(beforeMutationError.details.recovery);
  assertRecoveryStateArtifacts(beforeMutationError.details.recovery, 'old-remote');
  assert.equal(beforeMutationError.details.recovery.artifacts.remote, undefined, 'before mutation durable failure');
  assert.equal(beforeMutationError.details.recovery.artifacts.journal.planId, plan.id, 'before mutation durable failure');
  assert.equal(beforeMutationError.details.recovery.artifacts.journal.status, 'opened', 'before mutation durable failure');
  assert.equal(beforeMutationPersisted.records[0].type, 'journal-opened');
  assert.equal(beforeMutationPersisted.records[beforeMutationPersisted.records.length - 1].type, 'recovery-state');
  assert.equal(beforeMutationPersisted.records[beforeMutationPersisted.records.length - 1].state, 'old-remote');
  assert.equal(
    beforeMutationPersisted.records.some((record) => record.type === 'mutation-observed'),
    false,
    'before mutation durable failure',
  );

  const replayJournalPath = tempRecoveryJournalPath();
  const replayDurableJournal = openRecoveryJournal(replayJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal: replayDurableJournal,
  });
  replayDurableJournal.close();
  const persisted = readRecoveryJournal(replayJournalPath);

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(
    Object.values(replay.site.db.wp_posts).filter((row) => row.post_title === 'Inserted locally').length,
    1,
  );
  assert.equal(
    persisted.records.some((record) => record.type === 'journal-replayed' && record.state === 'fully-updated-remote'),
    true,
  );
  assert.equal(
    persisted.records.some((record) => record.type === 'mutation-observed'),
    false,
  );
});

test('durable recovery boundaries persist the expected journal evidence and completed replay stays inert', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedBoundary, expectedStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'journal-opened', undefined],
    ['after staging', { failAfterStaging: true }, 'apply-staged', 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated', 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const snapshot = JSON.stringify(remote);

    const error = captureError(() =>
      applyPlan(remote, plan, {
        ...options,
        durableJournal,
      }),
    );
    durableJournal.close();

    const persisted = readRecoveryJournal(journalPath);
    const boundaryRecord = persisted.records.find((record) => record.type === expectedBoundary);

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), snapshot, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(error.details.recovery.artifacts.journal.planId, plan.id, label);
    if (expectedStatus !== undefined) {
      assert.equal(error.details.recovery.artifacts.journal.status, expectedStatus, label);
    }
    assert.equal(persisted.records[0].type, 'journal-opened', label);
    assert.ok(boundaryRecord, label);
    if (expectedStatus !== undefined) {
      assert.equal(boundaryRecord.state, expectedStatus, label);
    }
    assert.equal(
      persisted.records.some((record) => record.type === 'mutation-observed'),
      false,
      label,
    );
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedWriter = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedWriter });
  completedWriter.close();

  const replayJournalPath = tempRecoveryJournalPath();
  const replayWriter = openRecoveryJournal(replayJournalPath, { truncate: true, now: fixedNow });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal: replayWriter,
  });
  replayWriter.close();

  const persistedReplay = readRecoveryJournal(replayJournalPath);

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(
    persistedReplay.records.some((record) => record.type === 'journal-replayed' && record.state === 'fully-updated-remote'),
    true,
  );
  assert.equal(
    persistedReplay.records.some((record) => record.type === 'mutation-observed'),
    false,
  );
});

test('durable no-data-loss recovery keeps the allowed failure states and completed replay replay-only', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedBoundary, expectedState] of [
    ['before mutation', { failBeforeMutation: true }, 'journal-opened', 'opened'],
    ['after staging', { failAfterStaging: true }, 'apply-staged', 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated', 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const snapshot = JSON.stringify(remote);

    const error = captureError(() =>
      applyPlan(remote, plan, {
        ...options,
        durableJournal,
      }),
    );
    durableJournal.close();

    const persisted = readRecoveryJournal(journalPath);

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), snapshot, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(error.details.recovery.artifacts.journal.planId, plan.id, label);
    assert.equal(error.details.recovery.artifacts.journal.status, expectedState, label);
    assert.equal(persisted.records.some((record) => record.type === expectedBoundary), true, label);
    assert.equal(
      persisted.records.some((record) => record.type === 'mutation-observed'),
      false,
      label,
    );
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedWriter = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedWriter });
  completedWriter.close();

  const replayJournalPath = tempRecoveryJournalPath();
  const replayWriter = openRecoveryJournal(replayJournalPath, { truncate: true, now: fixedNow });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal: replayWriter,
  });
  replayWriter.close();

  const persistedReplay = readRecoveryJournal(replayJournalPath);

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(
    persistedReplay.records.some((record) => record.type === 'journal-replayed' && record.state === 'fully-updated-remote'),
    true,
  );
  assert.equal(
    persistedReplay.records.some((record) => record.type === 'mutation-observed'),
    false,
  );
});

test('durable completed replay stays append-only when the journal already has prior records', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  const plan = planFor(base, local, baseSite());

  const completedJournalPath = tempRecoveryJournalPath();
  const completedWriter = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedWriter });
  completedWriter.close();

  const replayJournalPath = tempRecoveryJournalPath();
  const replayWriter = openRecoveryJournal(replayJournalPath, { truncate: true, now: fixedNow });
  replayWriter.appendEvent('seed-record', {
    planId: plan.id,
    state: 'seeded-prior-record',
    observedHash: 'seeded-prior-record',
    artifactRefs: {},
  });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);

  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal: replayWriter,
  });
  replayWriter.close();

  const persistedReplay = readRecoveryJournal(replayJournalPath);

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(
    persistedReplay.records.some((record) => record.type === 'journal-opened'),
    false,
  );
  assert.equal(
    persistedReplay.records.some((record) => record.type === 'target-planned'),
    false,
  );
  assert.equal(
    persistedReplay.records.some((record) => record.type === 'journal-replayed' && record.state === 'fully-updated-remote'),
    true,
  );
});

test('durable mid-apply failures remain blocked with artifacts and replaying the completed journal stays inert', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const plan = planFor(base, local, baseSite());
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const remote = baseSite();
  const snapshot = JSON.stringify(remote);

  const error = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal,
      failDuringCommitAtMutation: 1,
    }),
  );
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'INJECTED_FAILURE_DURING_COMMIT');
  assert.equal(JSON.stringify(remote), snapshot);
  assertAcceptableRecoveryState(error.details.recovery);
  assertRecoveryStateArtifacts(error.details.recovery, 'blocked-recovery');
  assert.ok(error.details.recovery.artifacts.remote, 'partial commit must preserve remote artifacts');
  assert.equal(error.details.recovery.artifacts.journal.planId, plan.id);
  assert.equal(error.details.recovery.artifacts.journal.status, 'blocked');
  assert.equal(error.details.recovery.artifacts.remote.files['index.php'], '<?php echo "local";');
  assert.equal(error.details.recovery.artifacts.remote.db.wp_posts['ID:2'], undefined);
  assert.equal(
    persisted.records.some((record) => record.type === 'mutation-observed'),
    true,
    'partial commit must record the observed mutation before blocking',
  );
  assert.equal(
    persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
    true,
    'partial commit must persist a blocked recovery state',
  );

  const retryRemote = JSON.parse(JSON.stringify(error.details.recovery.artifacts.remote));
  const retrySnapshot = JSON.stringify(retryRemote);
  const retry = captureError(() =>
    applyPlan(retryRemote, plan, {
      journal: error.details.recovery.artifacts.journal,
    }),
  );

  assert.equal(JSON.stringify(retryRemote), retrySnapshot);
  assert.ok(retry instanceof PushPlanError);
  assert.equal(retry.code, 'RECOVERY_BLOCKED');
  assertAcceptableRecoveryState(retry.details.recovery);
  assertRecoveryStateArtifacts(retry.details.recovery, 'blocked-recovery');
  assert.equal(retry.details.recovery.artifacts.remote.files['index.php'], '<?php echo "local";');
  assert.equal(retry.details.recovery.artifacts.remote.db.wp_posts['ID:2'], undefined);
});

test('durable blocked partial commit retries stay blocked and do not turn into a safe replay', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const plan = planFor(base, local, baseSite());
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const remote = baseSite();

  const error = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal,
      failDuringCommitAtMutation: 1,
    }),
  );
  durableJournal.close();

  const retryRemote = JSON.parse(JSON.stringify(error.details.recovery.artifacts.remote));
  const retrySnapshot = JSON.stringify(retryRemote);
  const retryJournal = openRecoveryJournal(tempRecoveryJournalPath(), { truncate: true, now: fixedNow });

  const retry = captureError(() =>
    applyPlan(retryRemote, plan, {
      durableJournal: retryJournal,
      journal: error.details.recovery.artifacts.journal,
    }),
  );
  retryJournal.close();

  assert.equal(JSON.stringify(retryRemote), retrySnapshot);
  assert.ok(retry instanceof PushPlanError);
  assert.equal(retry.code, 'RECOVERY_BLOCKED');
  assertRecoveryStateArtifacts(retry.details.recovery, 'blocked-recovery');
  assert.ok(retry.details.recovery.artifacts.journal, 'retry must preserve journal artifacts');
  assert.ok(retry.details.recovery.artifacts.remote, 'retry must preserve remote artifacts');
  assert.equal(retry.details.recovery.artifacts.remote.files['index.php'], '<?php echo "local";');
  assert.equal(retry.details.recovery.artifacts.remote.db.wp_posts['ID:2'], undefined);
});

test('durable completed replay against a stale remote stays blocked with inspectable artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const plan = planFor(base, local, baseSite());
  const journalPath = tempRecoveryJournalPath();
  const completedWriter = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedWriter });
  completedWriter.close();
  const beforeReplayPersisted = readRecoveryJournal(journalPath);

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  replayRemote.files['index.php'] = '<?php echo "drifted";';
  const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const replayError = captureError(() =>
    applyPlan(replayRemote, plan, {
      durableJournal: replayJournal,
      journal: completed.journal,
    }),
  );
  replayJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.ok(replayError instanceof PushPlanError);
  assert.equal(replayError.details.recovery.status, 'blocked-recovery');
  assert.ok(replayError.details.recovery.artifacts.journal);
  assert.ok(replayError.details.recovery.artifacts.remote);
  assert.equal(replayError.details.recovery.artifacts.remote.files['index.php'], '<?php echo "drifted";');
  assert.equal(replayError.details.recovery.artifacts.remote.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(
    persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
    true,
  );
  assert.equal(
    persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'fully-updated-remote'),
    true,
  );
  assert.equal(
    persisted.records.filter((record) => record.type === 'mutation-observed').length,
    beforeReplayPersisted.records.filter((record) => record.type === 'mutation-observed').length,
  );
});

test('durable pre-commit fence failures stay blocked and do not expose a partial remote', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const plan = planFor(base, local, baseSite());
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const remote = baseSite();
  const remoteSnapshot = JSON.stringify(remote);

  const error = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal,
      failBeforeCommitAtMutation: 1,
    }),
  );
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'INJECTED_FAILURE_BEFORE_COMMIT');
  assert.equal(JSON.stringify(remote), remoteSnapshot);
  assertAcceptableRecoveryState(error.details.recovery);
  assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
  assert.ok(error.details.recovery.artifacts.journal, 'pre-commit fence failure must preserve journal artifacts');
  assert.equal(error.details.recovery.artifacts.remote, undefined);
  assert.equal(
    persisted.records.some((record) => record.type === 'mutation-observed'),
    false,
    'pre-commit fence failure must not record a committed mutation',
  );
  assert.equal(persisted.records[persisted.records.length - 1].type, 'target-planned');
  assert.equal(
    persisted.records.some((record) => record.type === 'recovery-state'),
    false,
    'pre-commit fence failure must not emit a recovery-state record',
  );
});

test('the only acceptable recovery outcomes are old remote, blocked recovery, and fully updated replay', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const plan = planFor(base, local, baseSite());

  const beforeMutationError = captureError(() =>
    applyPlan(baseSite(), plan, { failBeforeMutation: true }),
  );
  assert.ok(beforeMutationError instanceof PushPlanError);
  assertAcceptableRecoveryState(beforeMutationError.details.recovery);
  assertRecoveryStateArtifacts(beforeMutationError.details.recovery, 'old-remote');
  assert.equal(beforeMutationError.details.recovery.artifacts.remote, undefined);

  const partialError = captureError(() =>
    applyPlan(baseSite(), plan, {
      mutateRemote: true,
      failDuringCommitAtMutation: 1,
    }),
  );
  assert.ok(partialError instanceof PushPlanError);
  assertAcceptableRecoveryState(partialError.details.recovery);
  assertRecoveryStateArtifacts(partialError.details.recovery, 'blocked-recovery');
  assert.ok(partialError.details.recovery.artifacts.remote);
  assert.ok(partialError.details.recovery.artifacts.journal);

  const completed = applyPlan(baseSite(), plan);
  assertAcceptableRecoveryState(completed.recoveryState);
  assertRecoveryStateArtifacts(completed.recoveryState, 'fully-updated-remote');
  assert.equal(completed.recoveryState.artifacts.remote, undefined);
  assert.equal(completed.recoveryState.artifacts.journal.status, 'completed');

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
});

test('durable recovery keeps failure boundaries on old remote and completed replay on fully updated remote', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedBoundary, expectedStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'journal-opened', 'opened'],
    ['after staging', { failAfterStaging: true }, 'apply-staged', 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated', 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const before = JSON.stringify(remote);

    const error = captureError(() =>
      applyPlan(remote, plan, {
        ...options,
        durableJournal,
      }),
    );
    durableJournal.close();

    const persisted = readRecoveryJournal(journalPath);

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), before, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(error.details.recovery.artifacts.journal.planId, plan.id, label);
    assert.equal(error.details.recovery.artifacts.journal.status, expectedStatus, label);
    assert.equal(persisted.records.some((record) => record.type === expectedBoundary), true, label);
    assert.equal(
      persisted.records.some((record) => record.type === 'mutation-observed'),
      false,
      label,
    );
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedWriter = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedWriter });
  completedWriter.close();

  const replayJournalPath = tempRecoveryJournalPath();
  const replayWriter = openRecoveryJournal(replayJournalPath, { truncate: true, now: fixedNow });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal: replayWriter,
  });
  replayWriter.close();

  const persistedReplay = readRecoveryJournal(replayJournalPath);

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(
    persistedReplay.records.some((record) => record.type === 'journal-replayed' && record.state === 'fully-updated-remote'),
    true,
  );
  assert.equal(
    persistedReplay.records.some((record) => record.type === 'mutation-observed'),
    false,
  );
});

test('no-data-loss recovery boundaries remain old remote, fully updated remote, or blocked recovery with artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options] of [
    ['before mutation', { failBeforeMutation: true }],
    ['after staging', { failAfterStaging: true }],
    ['after dependency validation', { failAfterDependencyValidation: true }],
  ]) {
    const remote = baseSite();
    const error = captureError(() => applyPlan(remote, plan, options));

    assert.ok(error instanceof PushPlanError, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(error.details.recovery.artifacts.journal.planId, plan.id, label);
    assert.equal(
      error.details.recovery.artifacts.journal.status,
      options.failBeforeMutation ? 'opened' : options.failAfterStaging ? 'staged' : 'dependencies-validated',
      label,
    );
    assert.equal(
      error.details.recovery.artifacts.journal.status === 'blocked',
      false,
      `pre-commit failure should not record a blocked recovery journal for ${label}`,
    );
    assert.equal(remote.db.wp_posts['ID:1'].post_title, 'Base post', label);
    assert.equal(remote.db.wp_posts['ID:2'], undefined, label);
  }

  const completed = applyPlan(baseSite(), plan);
  assertAcceptableRecoveryState(completed.recoveryState);
  assertRecoveryStateArtifacts(completed.recoveryState, 'fully-updated-remote');
  assert.equal(completed.recoveryState.artifacts.remote, undefined);
  assert.equal(completed.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(completed.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');

  const staleReplayRemote = JSON.parse(JSON.stringify(completed.site));
  staleReplayRemote.files['index.php'] = '<?php echo "stale local";';
  const staleReplay = captureError(() => applyPlan(staleReplayRemote, plan, { journal: completed.journal }));

  assert.ok(staleReplay instanceof PushPlanError);
  assert.equal(staleReplay.code, 'RECOVERY_BLOCKED');
  assertAcceptableRecoveryState(staleReplay.details.recovery);
  assertRecoveryStateArtifacts(staleReplay.details.recovery, 'blocked-recovery');
  assert.ok(staleReplay.details.recovery.artifacts.remote, 'stale completed replay must keep remote artifacts');
  assert.ok(staleReplay.details.recovery.artifacts.journal, 'stale completed replay must keep journal artifacts');
  assert.equal(staleReplay.details.recovery.artifacts.remote.files['index.php'], '<?php echo "stale local";');
  assert.equal(staleReplayRemote.files['index.php'], '<?php echo "stale local";');
  assert.equal(
    Object.values(staleReplay.details.recovery.artifacts.remote.db.wp_posts).filter(
      (row) => row.post_title === 'Inserted locally',
    ).length,
    1,
    'stale completed replay must not duplicate inserts in recovery artifacts',
  );
  assert.equal(
    staleReplay.details.recovery.artifacts.remote.db.wp_posts['ID:2'].post_title,
    'Inserted locally',
    'stale completed replay must not resurrect stale local rows',
  );
});

test('durable stale completed replay is blocked with artifacts and does not duplicate inserts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const plan = planFor(base, local, baseSite());
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });

  const completed = applyPlan(baseSite(), plan, { durableJournal });
  const persistedAfterApply = readRecoveryJournal(journalPath);

  const staleReplayRemote = JSON.parse(JSON.stringify(completed.site));
  staleReplayRemote.files['index.php'] = '<?php echo "stale local";';

  const staleReplayError = captureError(() =>
    applyPlan(staleReplayRemote, plan, {
      journal: completed.journal,
      durableJournal,
    }),
  );
  const persistedAfterReplay = readRecoveryJournal(journalPath);

  assert.ok(staleReplayError instanceof PushPlanError);
  assert.equal(staleReplayError.code, 'RECOVERY_BLOCKED');
  assertAcceptableRecoveryState(staleReplayError.details.recovery);
  assertRecoveryStateArtifacts(staleReplayError.details.recovery, 'blocked-recovery');
  assert.ok(staleReplayError.details.recovery.artifacts.remote, 'blocked replay must keep remote artifacts');
  assert.ok(staleReplayError.details.recovery.artifacts.journal, 'blocked replay must keep journal artifacts');
  assert.equal(staleReplayError.details.recovery.artifacts.remote.files['index.php'], '<?php echo "stale local";');
  assert.equal(
    staleReplayError.details.recovery.artifacts.remote.db.wp_posts['ID:2'].post_title,
    'Inserted locally',
    'blocked replay must not duplicate inserts',
  );
  assert.equal(
    persistedAfterReplay.records.filter((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery').length,
    persistedAfterApply.records.filter((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery').length + 1,
    'durable blocked replay should append a recovery-state record',
  );
});

test('recovery failure boundaries stay on old remote and completed replay stays inert', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const plan = planFor(base, local, baseSite());

  for (const [label, options] of [
    ['before mutation', { failBeforeMutation: true }],
    ['after staging', { failAfterStaging: true }],
    ['after dependency validation', { failAfterDependencyValidation: true }],
  ]) {
    const remote = baseSite();
    const remoteSnapshot = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, options));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), remoteSnapshot, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(error.details.recovery.artifacts.journal.planId, plan.id, label);
  }

  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
});

test('durable recovery after dependency validation keeps the old remote state and a later replay stays inert', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const plan = planFor(base, local, baseSite());
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const remote = baseSite();
  const before = JSON.stringify(remote);

  const error = captureError(() => applyPlan(remote, plan, {
    durableJournal,
    failAfterDependencyValidation: true,
  }));
  const persistedAfterFailure = readRecoveryJournal(journalPath);
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });
  durableJournal.close();
  const persistedAfterReplay = readRecoveryJournal(journalPath);

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'INJECTED_FAILURE_AFTER_DEPENDENCY_VALIDATION');
  assert.equal(JSON.stringify(remote), before);
  assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
  assert.equal(error.details.recovery.artifacts.remote, undefined);
  assert.equal(error.details.recovery.artifacts.journal.status, 'dependencies-validated');
  assert.equal(persistedAfterFailure.records[persistedAfterFailure.records.length - 1].state, 'old-remote');
  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(
    persistedAfterReplay.records.filter((record) => record.type === 'journal-replayed').length,
    persistedAfterFailure.records.filter((record) => record.type === 'journal-replayed').length + 1,
  );
});

test('mid-apply partial writes stay blocked with artifacts and completed replay stays idempotent', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const plan = planFor(base, local, baseSite());

  const partialRemote = baseSite();
  const partialError = captureError(() =>
    applyPlan(partialRemote, plan, {
      mutateRemote: true,
      failDuringCommitAtMutation: 1,
    }),
  );

  assert.ok(partialError instanceof PushPlanError);
  assert.equal(partialError.code, 'INJECTED_FAILURE_DURING_COMMIT');
  assertAcceptableRecoveryState(partialError.details.recovery);
  assertRecoveryStateArtifacts(partialError.details.recovery, 'blocked-recovery');
  assert.ok(partialError.details.recovery.artifacts.remote, 'mid-apply failure must keep remote artifacts');
  assert.ok(partialError.details.recovery.artifacts.journal, 'mid-apply failure must keep journal artifacts');

  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
});

test('replaying a completed durable plan stays inert and records only the completed replay boundary', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const plan = planFor(base, local, baseSite());
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });

  const completed = applyPlan(baseSite(), plan, { durableJournal });
  const persistedAfterApply = readRecoveryJournal(journalPath);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal, durableJournal });
  const persistedAfterReplay = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(
    persistedAfterReplay.records.filter((record) => record.type === 'journal-replayed').length,
    persistedAfterApply.records.filter((record) => record.type === 'journal-replayed').length + 1,
  );
  assert.equal(
    persistedAfterReplay.records.some((record) => record.type === 'apply-committing'),
    true,
    'durable replay should preserve the original apply trail',
  );
  assert.equal(
    persistedAfterReplay.records.filter((record) => record.type === 'apply-committing').length,
    persistedAfterApply.records.filter((record) => record.type === 'apply-committing').length,
    'replaying a completed plan must not append a new commit trail',
  );
});

test('durable completed replay stays inert after stale local edits and preserves the completed recovery envelope', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const plan = planFor(base, local, baseSite());
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });

  const completed = applyPlan(baseSite(), plan, { durableJournal });
  local.files['index.php'] = '<?php echo "stale-local";';
  local.db.wp_posts['ID:2'].post_title = 'Stale local insert';

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(
    persisted.records.filter((record) => record.type === 'journal-replayed').length,
    1,
  );
});

test('completed replay keeps stale local drift blocked when the recovery journal is replayed again', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const plan = planFor(base, local, baseSite());
  const completed = applyPlan(baseSite(), plan);

  const driftedRemote = JSON.parse(JSON.stringify(completed.site));
  driftedRemote.files['index.php'] = '<?php echo "stale local";';
  driftedRemote.db.wp_posts['ID:2'].post_title = 'Stale local insert';

  const error = captureError(() =>
    applyPlan(driftedRemote, plan, {
      journal: completed.journal,
    }),
  );

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'RECOVERY_BLOCKED');
  assertAcceptableRecoveryState(error.details.recovery);
  assertRecoveryStateArtifacts(error.details.recovery, 'blocked-recovery');
  assert.ok(error.details.recovery.artifacts.remote, 'blocked replay must preserve remote artifacts');
  assert.ok(error.details.recovery.artifacts.journal, 'blocked replay must preserve journal artifacts');
  assert.equal(
    error.details.recovery.artifacts.remote.db.wp_posts['ID:2'].post_title,
    'Stale local insert',
    'blocked replay must preserve the drifted remote state instead of replaying the completed insert set',
  );
  assert.equal(
    Object.values(error.details.recovery.artifacts.remote.db.wp_posts).filter(
      (row) => row.post_title === 'Stale local insert',
    ).length,
    1,
    'blocked replay must preserve the single drifted insert record',
  );
});

test('durable recovery only accepts old-remote, fully-updated-remote, or blocked-recovery with artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const failureScenarios = [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ];

  for (const [label, options, expectedJournalStatus] of failureScenarios) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const snapshot = JSON.stringify(remote);

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );
    durableJournal.close();

    assert.ok(failure instanceof PushPlanError, label);
    assertFailureRecoveryState(failure.details.recovery, 'old-remote');
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(JSON.stringify(remote), snapshot, label);
    assert.equal(readRecoveryJournal(journalPath).integrity.status, 'ok', label);
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  assertAcceptableRecoveryState(completed.recoveryState);
  assert.equal(completed.recoveryState.status, 'fully-updated-remote');
  assert.equal(completed.recoveryState.artifacts.remote, undefined);
  assert.equal(completed.recoveryState.artifacts.journal.status, 'completed');

  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(completed.site, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(
    readRecoveryJournal(completedJournalPath).records.filter((record) => record.type === 'journal-replayed').length,
    1,
  );
});

test('durable recovery stays within the accepted post-failure states and completed replay remains inert', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const plan = planFor(base, local, baseSite());

  for (const [label, options] of [
    ['before mutation', { failBeforeMutation: true, expectedJournalStatus: 'opened' }],
    ['after staging', { failAfterStaging: true, expectedJournalStatus: 'staged' }],
    ['after dependency validation', { failAfterDependencyValidation: true, expectedJournalStatus: 'dependencies-validated' }],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const remoteSnapshot = JSON.stringify(remote);

    const error = captureError(() =>
      applyPlan(remote, plan, {
        ...options,
        durableJournal,
      }),
    );
    durableJournal.close();

    const persisted = readRecoveryJournal(journalPath);

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), remoteSnapshot, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(error.details.recovery.artifacts.journal.planId, plan.id, label);
    assert.equal(error.details.recovery.artifacts.journal.status, options.expectedJournalStatus, label);
    assert.equal(
      persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'old-remote'),
      true,
      label,
    );
  }

  const applyJournalPath = tempRecoveryJournalPath();
  const applyDurableJournal = openRecoveryJournal(applyJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: applyDurableJournal });
  const completedPersisted = readRecoveryJournal(applyJournalPath);

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal: applyDurableJournal,
  });
  applyDurableJournal.close();

  const replayPersisted = readRecoveryJournal(applyJournalPath);

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(
    replayPersisted.records.filter((record) => record.type === 'journal-replayed').length,
    completedPersisted.records.filter((record) => record.type === 'journal-replayed').length + 1,
  );
});

test('durable recovery contract keeps every boundary in the accepted states and replay stays journal-only', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const plan = planFor(base, local, baseSite());

  const scenarios = [
    ['before mutation', { failBeforeMutation: true, expectedJournalStatus: 'opened' }],
    ['after staging', { failAfterStaging: true, expectedJournalStatus: 'staged' }],
    ['after dependency validation', { failAfterDependencyValidation: true, expectedJournalStatus: 'dependencies-validated' }],
  ];

  for (const [label, options] of scenarios) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const error = captureError(() =>
      applyPlan(remote, plan, {
        ...options,
        durableJournal,
      }),
    );
    durableJournal.close();

    const persisted = readRecoveryJournal(journalPath);

    assert.ok(error instanceof PushPlanError, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(error.details.recovery.artifacts.journal.planId, plan.id, label);
    assert.equal(error.details.recovery.artifacts.journal.status, options.expectedJournalStatus, label);
    assert.equal(
      persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'old-remote'),
      true,
      label,
    );
  }

  const applyJournalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(applyJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  const completedPersisted = readRecoveryJournal(applyJournalPath);

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });
  durableJournal.close();

  const replayPersisted = readRecoveryJournal(applyJournalPath);

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(
    replayPersisted.records.filter((record) => record.type === 'journal-replayed').length,
    completedPersisted.records.filter((record) => record.type === 'journal-replayed').length + 1,
  );
  assert.equal(
    replayPersisted.records.filter((record) => record.type === 'recovery-state').length,
    completedPersisted.records.filter((record) => record.type === 'recovery-state').length + 1,
  );
  assert.equal(
    replayPersisted.records.filter((record) => record.type === 'apply-staged').length,
    completedPersisted.records.filter((record) => record.type === 'apply-staged').length,
  );
  assert.equal(
    replayPersisted.records.filter((record) => record.type === 'dependencies-validated').length,
    completedPersisted.records.filter((record) => record.type === 'dependencies-validated').length,
  );
});

test('durable blocked partial recovery stays blocked on retry and preserves inspectable artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const plan = planFor(base, local, baseSite());
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });

  const partialRemote = baseSite();
  const partialError = captureError(() =>
    applyPlan(partialRemote, plan, {
      mutateRemote: true,
      failDuringCommitAtMutation: 2,
      durableJournal,
    }),
  );
  const persistedAfterPartial = readRecoveryJournal(journalPath);

  assert.ok(partialError instanceof PushPlanError);
  assert.equal(partialError.code, 'INJECTED_FAILURE_DURING_COMMIT');
  assertAcceptableRecoveryState(partialError.details.recovery);
  assertRecoveryStateArtifacts(partialError.details.recovery, 'blocked-recovery');
  assert.ok(partialError.details.recovery.artifacts.remote, 'partial recovery must keep remote artifacts');
  assert.ok(partialError.details.recovery.artifacts.journal, 'partial recovery must keep journal artifacts');
  assert.equal(partialRemote.db.wp_posts['ID:2'].post_title, 'Inserted locally');

  const retryRemote = JSON.parse(JSON.stringify(partialError.details.recovery.artifacts.remote));
  const retrySnapshot = JSON.stringify(retryRemote);
  const retry = applyPlan(retryRemote, plan, {
    journal: partialError.details.recovery.artifacts.journal,
    durableJournal,
  });
  const persistedAfterRetry = readRecoveryJournal(journalPath);

  assertAcceptableRecoveryState(retry.recoveryState);
  assertRecoveryStateArtifacts(retry.recoveryState, 'fully-updated-remote');
  assert.equal(JSON.stringify(retryRemote), retrySnapshot);
  assert.equal(
    retry.site.db.wp_posts['ID:2'].post_title,
    'Inserted locally',
    'retry must not duplicate inserts or revive stale local data',
  );
  assert.equal(
    persistedAfterRetry.records.filter((record) => record.type === 'journal-replayed').length,
    persistedAfterPartial.records.filter((record) => record.type === 'journal-replayed').length + 1,
  );
});

test('durable recovery boundaries keep old remote unchanged and completed replays stay inert after local drift', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const plan = planFor(base, local, baseSite());

  for (const [label, options] of [
    ['before mutation', { failBeforeMutation: true }],
    ['after staging', { failAfterStaging: true }],
    ['after dependency validation', { failAfterDependencyValidation: true }],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const remoteSnapshot = JSON.stringify(remote);

    const error = captureError(() =>
      applyPlan(remote, plan, {
        ...options,
        durableJournal,
      }),
    );
    durableJournal.close();

    const persisted = readRecoveryJournal(journalPath);

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), remoteSnapshot, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(error.details.recovery.artifacts.journal.planId, plan.id, label);
    assert.equal(
      persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'old-remote'),
      true,
      label,
    );
    assert.equal(
      persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
      false,
      label,
    );
  }

  const applyJournalPath = tempRecoveryJournalPath();
  const applyDurableJournal = openRecoveryJournal(applyJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: applyDurableJournal });
  const completedPersisted = readRecoveryJournal(applyJournalPath);

  local.files['index.php'] = '<?php echo "stale-local";';
  local.db.wp_posts['ID:2'].post_title = 'Stale local insert';

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal: applyDurableJournal,
  });
  applyDurableJournal.close();

  const replayPersisted = readRecoveryJournal(applyJournalPath);

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(
    replayPersisted.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
    false,
  );
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(
    replayPersisted.records.filter((record) => record.type === 'journal-replayed').length,
    completedPersisted.records.filter((record) => record.type === 'journal-replayed').length + 1,
  );
});

test('explicit recovery matrix stays limited to old remote, fully updated remote, or blocked recovery with artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const remote = baseSite();
  const plan = planFor(base, local, remote);

  const failureCases = [
    ['before mutation', { failBeforeMutation: true }, 'old-remote'],
    ['after staging', { failAfterStaging: true }, 'old-remote'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'old-remote'],
  ];

  for (const [label, options, expectedStatus] of failureCases) {
    const before = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, options));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), before, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, expectedStatus);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(error.details.recovery.artifacts.journal.planId, plan.id, label);
  }

  const completed = applyPlan(remote, plan);
  assertAcceptableRecoveryState(completed.recoveryState);
  assertRecoveryStateArtifacts(completed.recoveryState, 'fully-updated-remote');
  assert.equal(completed.recoveryState.artifacts.remote, undefined);
  assert.equal(completed.recoveryState.artifacts.journal.status, 'completed');

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');

  const secondReplayRemote = JSON.parse(JSON.stringify(replay.site));
  const secondReplaySnapshot = JSON.stringify(secondReplayRemote);
  const secondReplay = applyPlan(secondReplayRemote, plan, { journal: replay.journal });

  assert.equal(JSON.stringify(secondReplayRemote), secondReplaySnapshot);
  assert.equal(secondReplay.appliedMutations, 0);
  assertAcceptableRecoveryState(secondReplay.recoveryState);
  assertRecoveryStateArtifacts(secondReplay.recoveryState, 'fully-updated-remote');
  assert.equal(secondReplay.recoveryState.artifacts.remote, undefined);
  assert.equal(secondReplay.recoveryState.artifacts.journal.status, 'completed');
});

test('completed replay remains idempotent across repeated recovery journal replays', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const plan = planFor(base, local, baseSite());
  const completed = applyPlan(baseSite(), plan);

  const firstReplayRemote = JSON.parse(JSON.stringify(completed.site));
  const firstReplaySnapshot = JSON.stringify(firstReplayRemote);
  const firstReplay = applyPlan(firstReplayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(firstReplayRemote), firstReplaySnapshot);
  assert.equal(firstReplay.appliedMutations, 0);
  assertAcceptableRecoveryState(firstReplay.recoveryState);
  assertRecoveryStateArtifacts(firstReplay.recoveryState, 'fully-updated-remote');
  assert.equal(firstReplay.recoveryState.artifacts.remote, undefined);
  assert.equal(firstReplay.recoveryState.artifacts.journal.status, 'completed');

  const secondReplayRemote = JSON.parse(JSON.stringify(firstReplay.site));
  const secondReplaySnapshot = JSON.stringify(secondReplayRemote);
  const secondReplay = applyPlan(secondReplayRemote, plan, { journal: firstReplay.journal });

  assert.equal(JSON.stringify(secondReplayRemote), secondReplaySnapshot);
  assert.equal(secondReplay.appliedMutations, 0);
  assertAcceptableRecoveryState(secondReplay.recoveryState);
  assertRecoveryStateArtifacts(secondReplay.recoveryState, 'fully-updated-remote');
  assert.equal(secondReplay.recoveryState.artifacts.remote, undefined);
  assert.equal(secondReplay.recoveryState.artifacts.journal.status, 'completed');
});

test('completed replay with remote drift blocks recovery instead of duplicating the completed plan', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const plan = planFor(base, local, baseSite());
  const completed = applyPlan(baseSite(), plan);

  const driftedRemote = JSON.parse(JSON.stringify(completed.site));
  driftedRemote.files['index.php'] = '<?php echo "stale-local";';
  const driftedSnapshot = JSON.stringify(driftedRemote);

  const error = captureError(() => applyPlan(driftedRemote, plan, { journal: completed.journal }));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'RECOVERY_BLOCKED');
  assert.equal(JSON.stringify(driftedRemote), driftedSnapshot);
  assertAcceptableRecoveryState(error.details.recovery);
  assertRecoveryStateArtifacts(error.details.recovery, 'blocked-recovery');
  assert.ok(error.details.recovery.artifacts.remote, 'blocked recovery must keep remote artifacts');
  assert.ok(error.details.recovery.artifacts.journal, 'blocked recovery must keep journal artifacts');
  assert.equal(error.details.recovery.artifacts.journal.status, 'completed');
  assert.equal(error.details.recovery.artifacts.remote.files['index.php'], '<?php echo "stale-local";');
});

test('durable pre-mutation journal failure keeps the remote old and preserves inspectable artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const plan = planFor(base, local, baseSite());
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const remote = baseSite();
  const before = JSON.stringify(remote);

  const error = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal,
      failBeforeMutation: true,
    }),
  );
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'INJECTED_FAILURE_BEFORE_MUTATION');
  assert.equal(JSON.stringify(remote), before);
  assertAcceptableRecoveryState(error.details.recovery);
  assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
  assert.equal(error.details.recovery.artifacts.remote, undefined);
  assert.equal(error.details.recovery.artifacts.journal.planId, plan.id);
  assert.equal(error.details.recovery.artifacts.journal.status, 'opened');
  assert.equal(
    persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'old-remote'),
    true,
  );
});

test('a durable pre-mutation failure can be retried into a completed replay without duplicating inserts or stale data', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const plan = planFor(base, local, baseSite());
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });

  const remote = baseSite();
  const remoteSnapshot = JSON.stringify(remote);
  const failure = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal,
      failBeforeMutation: true,
    }),
  );
  const persistedAfterFailure = readRecoveryJournal(journalPath);

  assert.ok(failure instanceof PushPlanError);
  assert.equal(failure.code, 'INJECTED_FAILURE_BEFORE_MUTATION');
  assert.equal(JSON.stringify(remote), remoteSnapshot);
  assertAcceptableRecoveryState(failure.details.recovery);
  assertRecoveryStateArtifacts(failure.details.recovery, 'old-remote');
  assert.equal(failure.details.recovery.artifacts.remote, undefined);
  assert.equal(failure.details.recovery.artifacts.journal.status, 'opened');

  const completed = applyPlan(remote, plan, { durableJournal });
  const completedPersisted = readRecoveryJournal(journalPath);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, {
    durableJournal,
    journal: completed.journal,
  });
  durableJournal.close();
  const replayPersisted = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(
    completedPersisted.records.filter((record) => record.type === 'journal-replayed').length,
    persistedAfterFailure.records.filter((record) => record.type === 'journal-replayed').length,
  );
  assert.equal(
    replayPersisted.records.filter((record) => record.type === 'journal-replayed').length,
    completedPersisted.records.filter((record) => record.type === 'journal-replayed').length + 1,
  );
  assert.equal(
    replayPersisted.records.some((record) => record.type === 'recovery-state' && record.state === 'fully-updated-remote'),
    true,
  );
  assert.equal(
    replayPersisted.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
    false,
  );
});

test('the recovery boundary matrix stays limited to old remote, fully updated remote, or blocked recovery with artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const remote = baseSite();
    const remoteSnapshot = JSON.stringify(remote);

    const error = captureError(() => applyPlan(remote, plan, options));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), remoteSnapshot, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(error.details.recovery.artifacts.journal.planId, plan.id, label);
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
  }

  const completed = applyPlan(baseSite(), plan);
  assertAcceptableRecoveryState(completed.recoveryState);
  assertRecoveryStateArtifacts(completed.recoveryState, 'fully-updated-remote');
  assert.equal(completed.recoveryState.artifacts.remote, undefined);
  assert.equal(completed.recoveryState.artifacts.journal.status, 'completed');

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
});

test('blocked partial recovery and completed replay stay within the no-data-loss envelope', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const partialRemote = baseSite();
  const partialError = captureError(() =>
    applyPlan(partialRemote, plan, {
      mutateRemote: true,
      failDuringCommitAtMutation: 2,
    }),
  );

  assert.ok(partialError instanceof PushPlanError);
  assert.equal(partialError.code, 'INJECTED_FAILURE_DURING_COMMIT');
  assertAcceptableRecoveryState(partialError.details.recovery);
  assertRecoveryStateArtifacts(partialError.details.recovery, 'blocked-recovery');
  assert.ok(partialError.details.recovery.artifacts.journal, 'blocked recovery must keep journal artifacts');
  assert.ok(partialError.details.recovery.artifacts.remote, 'blocked recovery must keep remote artifacts');
  assert.equal(partialRemote.db.wp_posts['ID:2'].post_title, 'Inserted locally');

  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
});

test('pins the accepted post-failure states for no-data-loss recovery', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const remote = baseSite();
  const plan = planFor(base, local, remote);
  const cases = [
    ['before mutation', { failBeforeMutation: true }, 'old-remote'],
    ['after staging', { failAfterStaging: true }, 'old-remote'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'old-remote'],
  ];

  for (const [label, options, expectedStatus] of cases) {
    const before = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, options));

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), before, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, expectedStatus);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(error.details.recovery.artifacts.journal.planId, plan.id, label);
  }

  const completed = applyPlan(remote, plan);
  assertAcceptableRecoveryState(completed.recoveryState);
  assertRecoveryStateArtifacts(completed.recoveryState, 'fully-updated-remote');
  assert.equal(completed.recoveryState.artifacts.remote, undefined);
  assert.equal(completed.recoveryState.artifacts.journal.status, 'completed');

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
});

test('durable completed replay stays inert and preserves the completed recovery journal contract', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const plan = planFor(base, local, baseSite());
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const persistedBeforeReplay = readRecoveryJournal(journalPath);

  const replay = applyPlan(replayRemote, plan, {
    durableJournal,
    journal: completed.journal,
  });

  durableJournal.close();
  const persistedAfterReplay = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(
    persistedAfterReplay.records.filter((record) => record.type === 'journal-replayed').length,
    persistedBeforeReplay.records.filter((record) => record.type === 'journal-replayed').length + 1,
  );
  assert.equal(
    persistedAfterReplay.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
    false,
  );
});

test('durable completed replay stays read-only and does not append fresh mutation evidence', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const plan = planFor(base, local, baseSite());
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const persistedBeforeReplay = readRecoveryJournal(journalPath);

  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });

  durableJournal.close();
  const persistedAfterReplay = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
  assert.equal(
    persistedAfterReplay.records.filter((record) => record.type === 'target-planned').length,
    persistedBeforeReplay.records.filter((record) => record.type === 'target-planned').length,
  );
  assert.equal(
    persistedAfterReplay.records.filter((record) => record.type === 'mutation-observed').length,
    persistedBeforeReplay.records.filter((record) => record.type === 'mutation-observed').length,
  );
  assert.equal(
    persistedAfterReplay.records.filter((record) => record.type === 'recovery-state' && record.state === 'fully-updated-remote').length,
    persistedBeforeReplay.records.filter((record) => record.type === 'recovery-state' && record.state === 'fully-updated-remote').length + 1,
  );
});

test('durable recovery boundary states stay limited to old remote, fully updated remote, or blocked recovery with artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const failureCases = [
    ['before mutation', { failBeforeMutation: true }, 'opened', 'old-remote'],
    ['after staging', { failAfterStaging: true }, 'staged', 'old-remote'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated', 'old-remote'],
  ];

  for (const [label, options, expectedJournalStatus, expectedRecoveryStatus] of failureCases) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const before = JSON.stringify(remote);

    const error = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );
    durableJournal.close();

    const persisted = readRecoveryJournal(journalPath);

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(error.code, options.failBeforeMutation ? 'INJECTED_FAILURE_BEFORE_MUTATION' : options.failAfterStaging ? 'INJECTED_FAILURE_AFTER_STAGING' : 'INJECTED_FAILURE_AFTER_DEPENDENCY_VALIDATION', label);
    assert.equal(JSON.stringify(remote), before, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, expectedRecoveryStatus);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(error.details.recovery.artifacts.journal.planId, plan.id, label);
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(
      persisted.records.some((record) => record.type === 'mutation-observed'),
      false,
      label,
    );
    assert.equal(
      persisted.records.some((record) => record.type === 'recovery-state' && record.state === expectedRecoveryStatus),
      true,
      label,
    );
  }

  const applyJournalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(applyJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  const completedPersisted = readRecoveryJournal(applyJournalPath);

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });
  durableJournal.close();

  const replayPersisted = readRecoveryJournal(applyJournalPath);

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(
    replayPersisted.records.filter((record) => record.type === 'target-planned').length,
    completedPersisted.records.filter((record) => record.type === 'target-planned').length,
  );
  assert.equal(
    replayPersisted.records.filter((record) => record.type === 'mutation-observed').length,
    completedPersisted.records.filter((record) => record.type === 'mutation-observed').length,
  );
  assert.equal(
    replayPersisted.records.filter((record) => record.type === 'journal-replayed').length,
    completedPersisted.records.filter((record) => record.type === 'journal-replayed').length + 1,
  );
  assert.equal(
    replayPersisted.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
    false,
  );
  assert.equal(
    replayPersisted.records.some((record) => record.type === 'recovery-state' && record.state === 'fully-updated-remote'),
    true,
  );
});

test('no-data-loss recovery contract stays pinned across pre-mutation, post-staging, post-validation, and completed replay boundaries', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options] of [
    ['before mutation', { failBeforeMutation: true }],
    ['after staging', { failAfterStaging: true }],
    ['after dependency validation', { failAfterDependencyValidation: true }],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const snapshot = JSON.stringify(remote);

    const error = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    durableJournal.close();

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), snapshot, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(error.details.recovery.artifacts.journal.planId, plan.id, label);
  }

  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
});

test('recovery state contract stays limited to old remote, fully updated remote, or blocked recovery artifacts', () => {
  assert.deepEqual(ACCEPTABLE_RECOVERY_STATES, [
    'old-remote',
    'fully-updated-remote',
    'blocked-recovery',
  ]);

  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  const plan = planFor(base, local, baseSite());

  const failureCases = [
    ['before mutation', { failBeforeMutation: true }, 'old-remote'],
    ['after staging', { failAfterStaging: true }, 'old-remote'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'old-remote'],
  ];

  for (const [label, options, expectedStatus] of failureCases) {
    const remote = baseSite();
    const error = captureError(() => applyPlan(remote, plan, options));

    assert.equal(error.details.recovery.status, expectedStatus, label);
    assertRecoveryStateArtifacts(error.details.recovery, expectedStatus);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
  }

  const completed = applyPlan(baseSite(), plan);
  const replay = applyPlan(JSON.parse(JSON.stringify(completed.site)), plan, { journal: completed.journal });

  assertRecoveryStateArtifacts(completed.recoveryState, 'fully-updated-remote');
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
});

test('durable no-data-loss recovery keeps each failure boundary explainable and replay inert', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const plan = planFor(base, local, baseSite());
  const failureCases = [
    ['before mutation', { failBeforeMutation: true }, 'opened', 'old-remote'],
    ['after staging', { failAfterStaging: true }, 'staged', 'old-remote'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated', 'old-remote'],
  ];

  for (const [label, options, expectedJournalStatus, expectedRecoveryStatus] of failureCases) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const before = JSON.stringify(remote);

    const error = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    durableJournal.close();
    const persisted = readRecoveryJournal(journalPath);
    const inspection = inspectRecoveryJournal({ journal: persisted, plan, current: remote });

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), before, label);
    assert.equal(error.code.startsWith('INJECTED_FAILURE_'), true, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, expectedRecoveryStatus);
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(inspection.status, expectedRecoveryStatus, label);
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });

  durableJournal.close();
  const persisted = readRecoveryJournal(completedJournalPath);
  const inspection = inspectRecoveryJournal({
    journal: persisted,
    plan,
    current: replayRemote,
  });

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(inspection.status, 'fully-updated-remote');
});

test('stale completed replay on a durable journal blocks recovery instead of duplicating inserts or reviving stale local data', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const plan = planFor(base, local, baseSite());
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });

  const completed = applyPlan(baseSite(), plan, { durableJournal });
  const driftedRemote = JSON.parse(JSON.stringify(completed.site));
  driftedRemote.db.wp_posts['ID:2'].post_title = 'Drifted after completion';
  const driftSnapshot = JSON.stringify(driftedRemote);
  const persistedBeforeReplay = readRecoveryJournal(journalPath);

  const replayError = captureError(() =>
    applyPlan(driftedRemote, plan, {
      durableJournal,
      journal: completed.journal,
    }),
  );

  durableJournal.close();
  const persistedAfterReplay = readRecoveryJournal(journalPath);

  assert.ok(replayError instanceof PushPlanError);
  assert.equal(replayError.code, 'RECOVERY_BLOCKED');
  assert.equal(JSON.stringify(driftedRemote), driftSnapshot);
  assert.equal(replayError.details.recovery.status, 'blocked-recovery');
  assertAcceptableRecoveryState(replayError.details.recovery);
  assertRecoveryStateArtifacts(replayError.details.recovery, 'blocked-recovery');
  assert.ok(replayError.details.recovery.artifacts.journal, 'blocked replay must keep journal artifacts');
  assert.ok(replayError.details.recovery.artifacts.remote, 'blocked replay must keep remote artifacts');
  assert.equal(replayError.details.recovery.artifacts.journal.status, 'completed');
  assert.equal(
    replayError.details.recovery.artifacts.remote.db.wp_posts['ID:2'].post_title,
    'Drifted after completion',
  );
  assert.equal(
    Object.keys(replayError.details.recovery.artifacts.remote.db.wp_posts).filter((key) => key === 'ID:2').length,
    1,
  );
  assert.equal(
    persistedAfterReplay.records.filter((record) => record.type === 'journal-replayed').length,
    persistedBeforeReplay.records.filter((record) => record.type === 'journal-replayed').length,
  );
  assert.equal(
    persistedAfterReplay.records.filter((record) => record.type === 'target-planned').length,
    persistedBeforeReplay.records.filter((record) => record.type === 'target-planned').length,
  );
  assert.equal(
    persistedAfterReplay.records.filter((record) => record.type === 'mutation-observed').length,
    persistedBeforeReplay.records.filter((record) => record.type === 'mutation-observed').length,
  );
  assert.equal(
    persistedAfterReplay.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
    true,
  );
});

test('completed replay remains inert after the injected failure boundaries and preserves the approved recovery envelope', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const snapshot = JSON.stringify(remote);

    const error = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    durableJournal.close();

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), snapshot, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
  }

  const completed = applyPlan(baseSite(), plan);
  const staleLocal = JSON.parse(JSON.stringify(local));
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(staleLocal), JSON.stringify(local));
  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
});

test('durable recovery boundaries stay limited to old remote or fully updated replay across the apply journal', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const failureCases = [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ];

  for (const [label, options, expectedJournalStatus] of failureCases) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const before = JSON.stringify(remote);

    const error = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    durableJournal.close();
    const persisted = readRecoveryJournal(journalPath);
    const inspection = inspectRecoveryJournal({ journal: persisted, plan, current: remote });

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), before, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(inspection.status, 'old-remote', label);
  }

  const applyJournalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(applyJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const persistedBeforeReplay = readRecoveryJournal(applyJournalPath);
  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });

  durableJournal.close();
  const replayPersisted = readRecoveryJournal(applyJournalPath);
  const replayInspection = inspectRecoveryJournal({
    journal: replayPersisted,
    plan,
    current: replayRemote,
  });

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replayInspection.status, 'fully-updated-remote');
  assert.equal(
    replayPersisted.records.filter((record) => record.type === 'target-planned').length,
    persistedBeforeReplay.records.filter((record) => record.type === 'target-planned').length,
  );
  assert.equal(
    replayPersisted.records.filter((record) => record.type === 'mutation-observed').length,
    persistedBeforeReplay.records.filter((record) => record.type === 'mutation-observed').length,
  );
  assert.equal(
    replayPersisted.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
    false,
  );
});

test('a partial durable commit stays blocked on retry and does not duplicate staged inserts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };

  const plan = planFor(base, local, baseSite());
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const partialRemote = baseSite();
  const before = JSON.stringify(partialRemote);

  const partialError = captureError(() =>
    applyPlan(partialRemote, plan, {
      durableJournal,
      failDuringCommitAtMutation: 1,
    }),
  );

  durableJournal.close();
  const persistedAfterFailure = readRecoveryJournal(journalPath);
  const partialSnapshot = JSON.stringify(partialRemote);

  assert.ok(partialError instanceof PushPlanError);
  assert.equal(partialError.code, 'INJECTED_FAILURE_DURING_COMMIT');
  assert.equal(JSON.stringify(partialRemote), before);
  assertAcceptableRecoveryState(partialError.details.recovery);
  assertRecoveryStateArtifacts(partialError.details.recovery, 'blocked-recovery');
  assert.ok(partialError.details.recovery.artifacts.journal, 'blocked partial recovery must keep journal artifacts');
  assert.ok(partialError.details.recovery.artifacts.remote, 'blocked partial recovery must keep remote artifacts');
  assert.equal(partialError.details.recovery.artifacts.journal.planId, plan.id);
  const blockedRemote = partialError.details.recovery.artifacts.remote;
  assert.ok(
    blockedRemote.files['index.php'] === '<?php echo "local";'
      || blockedRemote.db.wp_posts['ID:2']?.post_title === 'Inserted locally',
    'blocked recovery remote should include at least one committed mutation',
  );
  assert.equal(
    persistedAfterFailure.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
    true,
  );

  const retryRemote = JSON.parse(JSON.stringify(partialError.details.recovery.artifacts.remote));
  const retrySnapshot = JSON.stringify(retryRemote);
  const retryError = captureError(() =>
    applyPlan(retryRemote, plan, {
      durableJournal,
      journal: partialError.details.recovery.artifacts.journal,
    }),
  );
  durableJournal.close();
  const persistedAfterRetry = readRecoveryJournal(journalPath);
  const retryInspection = inspectRecoveryJournal({
    journal: persistedAfterRetry,
    plan,
    current: retryRemote,
  });

  assert.equal(JSON.stringify(retryRemote), retrySnapshot);
  assert.ok(retryError instanceof PushPlanError);
  assert.equal(retryError.code, 'RECOVERY_BLOCKED');
  assertAcceptableRecoveryState(retryError.details.recovery);
  assertRecoveryStateArtifacts(retryError.details.recovery, 'blocked-recovery');
  assert.ok(retryError.details.recovery.artifacts.remote, 'retry must keep the partial remote artifacts');
  assert.ok(retryError.details.recovery.artifacts.journal, 'retry must keep the journal artifacts');
  assert.equal(
    retryError.details.recovery.artifacts.remote.files['index.php'] === '<?php echo "local";'
      || retryError.details.recovery.artifacts.remote.db.wp_posts['ID:2']?.post_title === 'Inserted locally',
    true,
    'retry must keep the partial committed mutation set stable',
  );
  assert.equal(
    persistedAfterRetry.records.filter((record) => record.type === 'journal-replayed').length,
    persistedAfterFailure.records.filter((record) => record.type === 'journal-replayed').length,
  );
  assert.equal(
    persistedAfterRetry.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
    true,
  );
  assert.equal(retryInspection.status, 'blocked-recovery');
});

test('durable no-data-loss recovery boundaries stay limited to old remote, fully updated remote, or blocked recovery with artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const before = JSON.stringify(remote);

    const error = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    durableJournal.close();

    const persisted = readRecoveryJournal(journalPath);

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), before, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(error.details.recovery.artifacts.journal.planId, plan.id, label);
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(
      persisted.records.some((record) => record.type === 'mutation-observed'),
      false,
      label,
    );
    assert.equal(
      persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'old-remote'),
      true,
      label,
    );
  }

  const applyJournalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(applyJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  const completedPersisted = readRecoveryJournal(applyJournalPath);

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, {
    journal: completed.journal,
    durableJournal,
  });
  durableJournal.close();

  const replayPersisted = readRecoveryJournal(applyJournalPath);

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(
    replayPersisted.records.filter((record) => record.type === 'target-planned').length,
    completedPersisted.records.filter((record) => record.type === 'target-planned').length,
  );
  assert.equal(
    replayPersisted.records.filter((record) => record.type === 'mutation-observed').length,
    completedPersisted.records.filter((record) => record.type === 'mutation-observed').length,
  );
  assert.equal(
    replayPersisted.records.filter((record) => record.type === 'journal-replayed').length,
    completedPersisted.records.filter((record) => record.type === 'journal-replayed').length + 1,
  );
  assert.equal(
    replayPersisted.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
    false,
  );
});

test('failure after staging a single mutation but before commit keeps the remote old and records a staging journal', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const remote = baseSite();
  const before = JSON.stringify(remote);

  const error = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal,
      failBeforeCommitAtMutation: 1,
    }),
  );

  durableJournal.close();
  const persisted = readRecoveryJournal(journalPath);
  const inspection = inspectRecoveryJournal({ journal: persisted, plan, current: remote });

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'INJECTED_FAILURE_BEFORE_COMMIT');
  assert.equal(JSON.stringify(remote), before);
  assertAcceptableRecoveryState(error.details.recovery);
  assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
  assert.equal(error.details.recovery.artifacts.remote, undefined);
  assert.equal(error.details.recovery.artifacts.journal.status, 'staging');
  assert.equal(
    persisted.records.some((record) => record.type === 'mutation-observed'),
    false,
  );
  assert.equal(
    persisted.records.some((record) => record.type === 'recovery-state'),
    false,
  );
  assert.equal(inspection.status, 'old-remote');
});

test('durable journal replay stays inert after old-remote failures and a completed plan still classifies as fully updated remote', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const remote = baseSite();
  const remoteSnapshot = JSON.stringify(remote);

  for (const [label, options] of [
    ['before mutation', { failBeforeMutation: true }],
    ['after staging', { failAfterStaging: true }],
    ['after dependency validation', { failAfterDependencyValidation: true }],
  ]) {
    const error = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), remoteSnapshot, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
  }

  const completed = applyPlan(remote, plan, { durableJournal });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, {
    durableJournal,
    journal: completed.journal,
  });
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(
    persisted.records.filter((record) => record.type === 'journal-replayed').length >= 1,
    true,
  );
  assert.equal(
    persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
    false,
  );
});

test('durable recovery contract keeps pre-commit failures old-remote, completed replays inert, and drifted replays blocked', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const remote = baseSite();
  const remoteSnapshot = JSON.stringify(remote);

  for (const [label, options] of [
    ['before mutation', { failBeforeMutation: true }],
    ['after staging', { failAfterStaging: true }],
    ['after dependency validation', { failAfterDependencyValidation: true }],
  ]) {
    const error = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), remoteSnapshot, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(error.details.recovery.artifacts.journal.planId, plan.id, label);
  }

  const completed = applyPlan(remote, plan, { durableJournal });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, {
    durableJournal,
    journal: completed.journal,
  });

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');

  const driftedReplay = JSON.parse(JSON.stringify(completed.site));
  driftedReplay.db.wp_posts['ID:2'].post_title = 'Drifted after completion';
  const blockedError = captureError(() =>
    applyPlan(driftedReplay, plan, {
      durableJournal,
      journal: completed.journal,
    }),
  );

  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.ok(blockedError instanceof PushPlanError);
  assert.equal(blockedError.code, 'RECOVERY_BLOCKED');
  assertAcceptableRecoveryState(blockedError.details.recovery);
  assertRecoveryStateArtifacts(blockedError.details.recovery, 'blocked-recovery');
  assert.ok(blockedError.details.recovery.artifacts.remote);
  assert.ok(blockedError.details.recovery.artifacts.journal);
  assert.equal(
    persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
    true,
  );
  assert.equal(
    persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'old-remote'),
    true,
  );
});

test('durable recovery artifacts only surface remote state when recovery is actually blocked', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });

  const oldRemote = baseSite();
  const oldFailure = captureError(() =>
    applyPlan(oldRemote, plan, {
      durableJournal,
      failAfterDependencyValidation: true,
    }),
  );

  assert.ok(oldFailure instanceof PushPlanError);
  assert.equal(oldFailure.code, 'INJECTED_FAILURE_AFTER_DEPENDENCY_VALIDATION');
  assert.equal(oldFailure.details.recovery.status, 'old-remote');
  assert.equal(oldFailure.details.recovery.artifacts.remote, undefined);
  assert.equal(oldFailure.details.recovery.artifacts.journal.status, 'dependencies-validated');

  const completed = applyPlan(baseSite(), plan, { durableJournal });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replay = applyPlan(replayRemote, plan, {
    durableJournal,
    journal: completed.journal,
  });

  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');

  const blockedRemote = JSON.parse(JSON.stringify(completed.site));
  blockedRemote.db.wp_posts['ID:2'].post_title = 'Drifted after completion';
  const blockedError = captureError(() =>
    applyPlan(blockedRemote, plan, {
      durableJournal,
      journal: completed.journal,
    }),
  );

  durableJournal.close();

  assert.ok(blockedError instanceof PushPlanError);
  assert.equal(blockedError.code, 'RECOVERY_BLOCKED');
  assert.equal(blockedError.details.recovery.status, 'blocked-recovery');
  assert.ok(blockedError.details.recovery.artifacts.remote);
  assert.ok(blockedError.details.recovery.artifacts.journal);
});

test('durable recovery boundaries classify failures as old remote and completed replays as fully updated remote', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const snapshot = JSON.stringify(remote);

    const error = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    durableJournal.close();
    const persisted = readRecoveryJournal(journalPath);

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), snapshot, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(error.details.recovery.artifacts.journal.planId, plan.id, label);
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(
      persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'old-remote'),
      true,
      label,
    );
    assert.equal(
      persisted.records.some((record) => record.type === 'mutation-observed'),
      false,
      label,
    );
    assert.equal(
      persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
      false,
      label,
    );
  }

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, {
    durableJournal,
    journal: completed.journal,
  });
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(
    persisted.records.filter((record) => record.type === 'journal-replayed').length >= 1,
    true,
  );
  assert.equal(
    persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
    false,
  );
});

test('durable recovery stays within the approved state envelope across failure boundaries and completed replay', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const remote = baseSite();

  for (const options of [
    { failBeforeMutation: true },
    { failAfterStaging: true },
    { failAfterDependencyValidation: true },
  ]) {
    const error = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    assert.ok(error instanceof PushPlanError);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.remote, undefined);
    assert.equal(error.details.recovery.artifacts.journal.planId, plan.id);
  }

  const completed = applyPlan(remote, plan, { durableJournal });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, {
    durableJournal,
    journal: completed.journal,
  });
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(
    persisted.records.filter((record) => record.type === 'mutation-observed').length,
    plan.mutations.length,
  );
  assert.equal(
    persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
    false,
  );
});

test('no-data-loss recovery accepts only old remote, fully updated remote, or blocked recovery with artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const remote = baseSite();
  const remoteSnapshot = JSON.stringify(remote);

  for (const [label, options] of [
    ['before mutation', { failBeforeMutation: true }],
    ['after staging', { failAfterStaging: true }],
    ['after dependency validation', { failAfterDependencyValidation: true }],
  ]) {
    const error = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), remoteSnapshot, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assert.equal(error.details.recovery.status, 'old-remote', label);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.ok(error.details.recovery.artifacts.journal, label);
  }

  const completed = applyPlan(remote, plan, { durableJournal });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replay = applyPlan(replayRemote, plan, {
    durableJournal,
    journal: completed.journal,
  });

  const blockedRemote = JSON.parse(JSON.stringify(completed.site));
  blockedRemote.db.wp_posts['ID:2'].post_title = 'Drifted after completion';
  const blockedError = captureError(() =>
    applyPlan(blockedRemote, plan, {
      durableJournal,
      journal: completed.journal,
    }),
  );

  durableJournal.close();

  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.ok(replay.recoveryState.artifacts.journal);

  assert.ok(blockedError instanceof PushPlanError);
  assert.equal(blockedError.details.recovery.status, 'blocked-recovery');
  assertAcceptableRecoveryState(blockedError.details.recovery);
  assert.ok(blockedError.details.recovery.artifacts.remote);
  assert.ok(blockedError.details.recovery.artifacts.journal);
  assert.equal(blockedError.details.recovery.artifacts.journal.status, 'completed');
  assert.equal(
    blockedError.details.recovery.artifacts.journal.entries.every((entry) => entry.status === 'applied'),
    true,
  );
});

test('reopened durable journals keep the replay boundary inert after a dependency-validation failure boundary', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const firstWriter = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const remote = baseSite();
  const before = JSON.stringify(remote);

  const failure = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal: firstWriter,
      failAfterDependencyValidation: true,
    }),
  );

  firstWriter.close();

  assert.ok(failure instanceof PushPlanError);
  assert.equal(JSON.stringify(remote), before);
  assert.equal(failure.details.recovery.status, 'old-remote');
  assert.ok(failure.details.recovery.artifacts.journal, 'dependency validation failure must retain journal artifacts');
  assert.equal(failure.details.recovery.artifacts.remote, undefined);

  const completedJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedJournal });
  completedJournal.close();
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
});

test('reopened durable journals keep completed replays inert and do not resurrect stale local data', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  durableJournal.close();

  const persistedCompleted = readRecoveryJournal(journalPath);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const reopenedJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: reopenedJournal,
    journal: completed.journal,
  });
  reopenedJournal.close();

  const persistedReplay = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(
    persistedReplay.records.filter((record) => record.type === 'journal-replayed').length,
    persistedCompleted.records.filter((record) => record.type === 'journal-replayed').length + 1,
  );
  assert.equal(
    persistedReplay.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
    false,
  );
});

test('reopened durable journals keep a second completed replay inert and preserve the completed envelope', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  durableJournal.close();

  const firstReplayRemote = JSON.parse(JSON.stringify(completed.site));
  const firstReplayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const firstReplay = applyPlan(firstReplayRemote, plan, {
    durableJournal: firstReplayJournal,
    journal: completed.journal,
  });
  firstReplayJournal.close();
  assertAcceptableRecoveryState(firstReplay.recoveryState);
  assertRecoveryStateArtifacts(firstReplay.recoveryState, 'fully-updated-remote');
  assert.equal(firstReplay.appliedMutations, 0);

  const secondReplayRemote = JSON.parse(JSON.stringify(firstReplayRemote));
  const secondReplayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const secondReplay = applyPlan(secondReplayRemote, plan, {
    durableJournal: secondReplayJournal,
    journal: completed.journal,
  });
  secondReplayJournal.close();

  const persisted = readRecoveryJournal(journalPath);
  assert.equal(secondReplay.appliedMutations, 0);
  assertAcceptableRecoveryState(secondReplay.recoveryState);
  assertRecoveryStateArtifacts(secondReplay.recoveryState, 'fully-updated-remote');
  assert.equal(secondReplay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(JSON.stringify(secondReplayRemote), JSON.stringify(firstReplayRemote));
  assert.equal(
    persisted.records.filter((record) => record.type === 'journal-replayed').length >= 2,
    true,
  );
  assert.equal(
    persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
    false,
  );
});

test('durable completed replay with stale local data stays inert and keeps the completed recovery envelope', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  durableJournal.close();

  const staleLocalSource = JSON.parse(JSON.stringify(local));
  staleLocalSource.files['index.php'] = '<?php echo "stale local";';
  staleLocalSource.db.wp_posts['ID:2'].post_title = 'Inserted stale locally';

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);

  const reopenedJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: reopenedJournal,
    journal: completed.journal,
  });
  reopenedJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(staleLocalSource.files['index.php'], '<?php echo "stale local";');
  assert.equal(staleLocalSource.db.wp_posts['ID:2'].post_title, 'Inserted stale locally');
  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(
    persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
    false,
  );
});

test('completed plan replay ignores stale local inserts and keeps the completed recovery envelope', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  durableJournal.close();

  const staleLocal = JSON.parse(JSON.stringify(local));
  staleLocal.files['index.php'] = '<?php echo "stale local";';
  staleLocal.db.wp_posts['ID:2'].post_title = 'Inserted stale locally';

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const reopenedJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: reopenedJournal,
    journal: completed.journal,
  });
  reopenedJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(staleLocal.files['index.php'], '<?php echo "stale local";');
  assert.equal(staleLocal.db.wp_posts['ID:2'].post_title, 'Inserted stale locally');
  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(
    persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
    false,
  );
  assert.equal(
    persisted.records.filter((record) => record.type === 'journal-replayed').length >= 1,
    true,
  );
});

test('stale completed replay is blocked with journal and remote artifacts instead of being treated as safe', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  durableJournal.close();

  const driftedRemote = JSON.parse(JSON.stringify(completed.site));
  driftedRemote.files['index.php'] = '<?php echo "drifted remote";';
  const driftedSnapshot = JSON.stringify(driftedRemote);

  const reopenedJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const blocked = captureError(() =>
    applyPlan(driftedRemote, plan, {
      durableJournal: reopenedJournal,
      journal: completed.journal,
    }),
  );
  reopenedJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.ok(blocked instanceof PushPlanError);
  assert.equal(blocked.details.recovery.status, 'blocked-recovery');
  assert.ok(blocked.details.recovery.artifacts.journal, 'blocked replay must retain journal artifacts');
  assert.ok(blocked.details.recovery.artifacts.remote, 'blocked replay must retain remote artifacts');
  assert.equal(blocked.details.recovery.artifacts.remote.files['index.php'], '<?php echo "drifted remote";');
  assert.equal(JSON.stringify(driftedRemote), driftedSnapshot);
  assert.equal(
    persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
    true,
  );
});

test('durable recovery keeps append-only retries and completed replays idempotent across the full cycle', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const firstWriter = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const remote = baseSite();
  const before = JSON.stringify(remote);

  const failure = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal: firstWriter,
      failBeforeMutation: true,
    }),
  );

  firstWriter.close();
  assert.ok(failure instanceof PushPlanError);
  assert.equal(failure.details.recovery.status, 'old-remote');
  assert.equal(failure.details.recovery.artifacts.journal.status, 'opened');
  assert.equal(JSON.stringify(remote), before);

  const retryWriter = openRecoveryJournal(journalPath, { now: fixedNow });
  const retry = applyPlan(remote, plan, {
    durableJournal: retryWriter,
    journal: failure.details.recovery.artifacts.journal,
  });
  retryWriter.close();

  assert.equal(retry.appliedMutations, plan.mutations.length);
  assert.equal(retry.recoveryState.status, 'fully-updated-remote');
  assert.equal(retry.site.files['index.php'], '<?php echo "local";');
  assert.equal(retry.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');

  const completedRemote = JSON.parse(JSON.stringify(retry.site));
  const completedSnapshot = JSON.stringify(completedRemote);
  const replayWriter = openRecoveryJournal(journalPath, { now: fixedNow });
  const replay = applyPlan(completedRemote, plan, {
    durableJournal: replayWriter,
    journal: retry.journal,
  });
  replayWriter.close();

  const persisted = readRecoveryJournal(journalPath);
  const targetRecords = persisted.records.filter((record) => record.type === 'target-planned');

  assert.equal(JSON.stringify(completedRemote), completedSnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(targetRecords.length, plan.mutations.length);
  assert.equal(
    persisted.records.filter((record) => record.type === 'journal-retry-opened').length >= 1,
    true,
  );
  assert.equal(
    persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
    false,
  );
});

test('durable recovery keeps pre-commit failures in old-remote with journal artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());
  const beforeSnapshot = JSON.stringify(base);

  for (const [label, options, expectedJournalStatus] of [
    ['failure before mutation', { failBeforeMutation: true }, 'opened'],
    ['failure after staging', { failAfterStaging: true }, 'staged'],
    ['failure after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const remoteSnapshot = JSON.stringify(remote);

    const error = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    durableJournal.close();

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), beforeSnapshot, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assert.equal(error.details.recovery.status, 'old-remote', label);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.ok(error.details.recovery.artifacts.journal, label);
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(
      error.details.recovery.artifacts.journal.entries.every((entry) => entry.status === 'pending' || entry.status === 'staged'),
      true,
      label,
    );

    const persisted = readRecoveryJournal(journalPath);
    assert.equal(persisted.records.some((record) => record.type === 'journal-opened'), true, label);
    assert.equal(
      persisted.records.some((record) => record.type === 'apply-staged'),
      expectedJournalStatus !== 'opened',
      label,
    );
    assert.equal(
      persisted.records.some((record) => record.type === 'dependencies-validated'),
      expectedJournalStatus === 'dependencies-validated',
      label,
    );
    assert.equal(
      persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
      false,
      label,
    );
  }
});

test('durable recovery replays a completed plan as fully-updated-remote without reapplying mutations', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  durableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(Object.keys(replay.site.db.wp_posts).length, 2);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(
    replay.recoveryState.artifacts.journal.entries.every((entry) => entry.status === 'applied'),
    true,
  );
  const persisted = readRecoveryJournal(journalPath);
  assert.equal(
    persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
    false,
  );

  const secondReplayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const secondReplayRemoteSnapshot = JSON.stringify(replayRemote);
  const secondReplay = applyPlan(replayRemote, plan, {
    durableJournal: secondReplayJournal,
    journal: replay.journal,
  });
  secondReplayJournal.close();

  assert.equal(JSON.stringify(replayRemote), secondReplayRemoteSnapshot);
  assert.equal(secondReplay.appliedMutations, 0);
  assert.equal(secondReplay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(secondReplay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
  assert.equal(secondReplay.site.files['index.php'], '<?php echo "local";');
  assertAcceptableRecoveryState(secondReplay.recoveryState);
  assertRecoveryStateArtifacts(secondReplay.recoveryState, 'fully-updated-remote');
  assert.equal(secondReplay.recoveryState.artifacts.remote, undefined);
  assert.equal(secondReplay.recoveryState.artifacts.journal.status, 'completed');
});

test('durable completed replay stays append-only and does not duplicate targets', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  durableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(replayRemote), JSON.stringify(completed.site));
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
  assert.equal(
    persisted.records.filter((record) => record.type === 'target-planned').length,
    plan.mutations.length,
  );
  assert.equal(
    persisted.records.filter((record) => record.type === 'journal-completed').length,
    1,
  );
  assert.equal(
    persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
    false,
  );
  assert.equal(
    persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'fully-updated-remote'),
    true,
  );
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
});

test('durable replay blocks drifted completed state instead of collapsing into old-remote', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  durableJournal.close();

  const driftedRemote = JSON.parse(JSON.stringify(completed.site));
  driftedRemote.files['index.php'] = '<?php echo "stale local";';
  const driftSnapshot = JSON.stringify(driftedRemote);

  const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const error = captureError(() =>
    applyPlan(driftedRemote, plan, {
      durableJournal: replayJournal,
      journal: completed.journal,
    }),
  );
  replayJournal.close();

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'RECOVERY_BLOCKED');
  assert.equal(JSON.stringify(driftedRemote), driftSnapshot);
  assertAcceptableRecoveryState(error.details.recovery);
  assertRecoveryStateArtifacts(error.details.recovery, 'blocked-recovery');
  assert.ok(error.details.recovery.artifacts.remote, 'drifted replay must preserve remote artifacts');
  assert.equal(error.details.recovery.artifacts.remote.files['index.php'], '<?php echo "stale local";');
  assert.equal(error.details.recovery.artifacts.journal.status, 'completed');
  assert.equal(error.details.recovery.artifacts.journal.entries.length, plan.mutations.length);
});

test('durable recovery keeps the documented failure states and completed replay inert', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());
  const failureScenarios = [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ];

  for (const [label, options, expectedJournalStatus] of failureScenarios) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    durableJournal.close();

    assert.ok(failure instanceof PushPlanError, label);
    assertRecoveryStateArtifacts(failure.details.recovery, 'old-remote');
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(JSON.stringify(remote), JSON.stringify(baseSite()), label);

    const persisted = readRecoveryJournal(journalPath);
    assert.equal(
      persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'old-remote'),
      true,
      label,
    );
    assert.equal(
      persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
      false,
      label,
    );
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.journal.entries.length, plan.mutations.length);
  assert.equal(
    readRecoveryJournal(completedJournalPath).records.some(
      (record) => record.type === 'recovery-state' && record.state === 'fully-updated-remote',
    ),
    true,
  );
  assert.equal(
    readRecoveryJournal(completedJournalPath).records.some(
      (record) => record.type === 'recovery-state' && record.state === 'blocked-recovery',
    ),
    false,
  );
});

test('completed replay stays fully-updated even when replay journaling fails', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  durableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = failingDurableJournal('journal-replayed');
  const replayError = captureError(() =>
    applyPlan(replayRemote, plan, {
      durableJournal: replayJournal,
      journal: completed.journal,
    }),
  );

  assert.ok(replayError instanceof PushPlanError);
  assert.equal(replayError.code, 'JOURNAL_WRITE_FAILED');
  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assertAcceptableRecoveryState(replayError.details.recovery);
  assertRecoveryStateArtifacts(replayError.details.recovery, 'fully-updated-remote');
  assert.equal(replayError.details.recovery.artifacts.remote, undefined);
  assert.equal(replayError.details.recovery.artifacts.journal.status, 'completed');
  assert.equal(replayError.details.recovery.artifacts.journal.entries.length, plan.mutations.length);
});

test('replaying a completed plan stays inert across repeated retries and does not duplicate inserted rows', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  durableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const firstReplayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const firstReplay = applyPlan(replayRemote, plan, {
    durableJournal: firstReplayJournal,
    journal: completed.journal,
  });
  firstReplayJournal.close();

  const secondReplayRemote = JSON.parse(JSON.stringify(firstReplay.site));
  const secondReplayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const secondReplay = applyPlan(secondReplayRemote, plan, {
    durableJournal: secondReplayJournal,
    journal: firstReplay.journal,
  });
  secondReplayJournal.close();

  assert.equal(firstReplay.appliedMutations, 0);
  assert.equal(secondReplay.appliedMutations, 0);
  assert.equal(JSON.stringify(secondReplay.site), JSON.stringify(firstReplay.site));
  assert.equal(secondReplay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(secondReplay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
  assertAcceptableRecoveryState(secondReplay.recoveryState);
  assertRecoveryStateArtifacts(secondReplay.recoveryState, 'fully-updated-remote');
  assert.equal(secondReplay.recoveryState.artifacts.remote, undefined);
  assert.equal(secondReplay.recoveryState.artifacts.journal.status, 'completed');
});

test('durable recovery boundary matrix keeps pre-commit failures old-remote and completed replay inert', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['failure before mutation', { failBeforeMutation: true }, 'opened'],
    ['failure after staging', { failAfterStaging: true }, 'staged'],
    ['failure after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const remoteSnapshot = JSON.stringify(remote);

    const error = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    durableJournal.close();

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), remoteSnapshot, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);

    const retryJournal = openRecoveryJournal(journalPath, { now: fixedNow });
    const retrySnapshot = JSON.stringify(remote);
    const retry = applyPlan(remote, plan, {
      durableJournal: retryJournal,
      journal: error.details.recovery.artifacts.journal,
    });
    retryJournal.close();

    assert.equal(JSON.stringify(remote), retrySnapshot, label);
    assert.equal(retry.appliedMutations, plan.mutations.length, label);
    assert.equal(retry.site.db.wp_posts['ID:2'].post_title, 'Inserted locally', label);
    assert.equal(Object.keys(retry.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1, label);
    assert.equal(retry.site.files['index.php'], '<?php echo "local";', label);
    assertAcceptableRecoveryState(retry.recoveryState);
    assertRecoveryStateArtifacts(retry.recoveryState, 'fully-updated-remote');
    assert.equal(retry.recoveryState.artifacts.remote, undefined, label);
    assert.equal(retry.recoveryState.artifacts.journal.status, 'completed', label);
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
});

test('atomic apply only admits the expected recovery states across pre-commit failure boundaries and completed replay', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedRecoveryStatus, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'old-remote', 'opened'],
    ['after staging', { failAfterStaging: true }, 'old-remote', 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'old-remote', 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();

    const error = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    durableJournal.close();

    assert.ok(error instanceof PushPlanError, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assert.equal(error.details.recovery.status, expectedRecoveryStatus, label);
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
});

test('durable recovery contract keeps pre-mutation, post-staging, post-validation, and completed replay within the accepted states', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const cases = [
    {
      label: 'failure before mutation',
      options: { failBeforeMutation: true },
      expectedJournalStatus: 'opened',
      expectedRecoveryStatus: 'old-remote',
    },
    {
      label: 'failure after staging',
      options: { failAfterStaging: true },
      expectedJournalStatus: 'staged',
      expectedRecoveryStatus: 'old-remote',
    },
    {
      label: 'failure after dependency validation',
      options: { failAfterDependencyValidation: true },
      expectedJournalStatus: 'dependencies-validated',
      expectedRecoveryStatus: 'old-remote',
    },
  ];

  for (const testCase of cases) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const remoteSnapshot = JSON.stringify(remote);

    const error = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...testCase.options,
      }),
    );

    durableJournal.close();

    assert.ok(error instanceof PushPlanError, testCase.label);
    assert.equal(JSON.stringify(remote), remoteSnapshot, testCase.label);
    assertAcceptableRecoveryState(error.details.recovery);
    assert.equal(error.details.recovery.status, testCase.expectedRecoveryStatus, testCase.label);
    assertRecoveryStateArtifacts(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.journal.status, testCase.expectedJournalStatus, testCase.label);
    assert.equal(error.details.recovery.artifacts.remote, undefined, testCase.label);

    const retryJournal = openRecoveryJournal(journalPath, { now: fixedNow });
    const retry = applyPlan(remote, plan, {
      durableJournal: retryJournal,
      journal: error.details.recovery.artifacts.journal,
    });
    retryJournal.close();

    assert.equal(retry.appliedMutations, plan.mutations.length, testCase.label);
    assertAcceptableRecoveryState(retry.recoveryState);
    assertRecoveryStateArtifacts(retry.recoveryState, 'fully-updated-remote');
    assert.equal(retry.recoveryState.artifacts.remote, undefined, testCase.label);
    assert.equal(retry.recoveryState.artifacts.journal.status, 'completed', testCase.label);
    assert.equal(retry.site.files['index.php'], '<?php echo "local";', testCase.label);
    assert.equal(retry.site.db.wp_posts['ID:2'].post_title, 'Inserted locally', testCase.label);
  }

  const failingOpenJournal = failingDurableJournal('journal-opened');
  const openFailureRemote = baseSite();
  const openFailureSnapshot = JSON.stringify(openFailureRemote);
  const openFailure = captureError(() =>
    applyPlan(openFailureRemote, plan, {
      durableJournal: failingOpenJournal,
    }),
  );

  assert.ok(openFailure instanceof PushPlanError, 'journal-opened failure');
  assert.equal(openFailure.code, 'JOURNAL_WRITE_FAILED', 'journal-opened failure');
  assert.equal(JSON.stringify(openFailureRemote), openFailureSnapshot, 'journal-opened failure');
  assertAcceptableRecoveryState(openFailure.details.recovery);
  assertRecoveryStateArtifacts(openFailure.details.recovery, 'old-remote');
  assert.equal(openFailure.details.recovery.artifacts.journal.status, 'opened', 'journal-opened failure');
  assert.equal(openFailure.details.recovery.artifacts.remote, undefined, 'journal-opened failure');
  assert.equal(failingOpenJournal.events.length, 0, 'journal-opened failure');

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
});

test('recovery boundaries only produce accepted states and completed replay stays inert', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const boundaryCases = [
    ['failure before mutation', { failBeforeMutation: true }, 'opened'],
    ['failure after staging', { failAfterStaging: true }, 'staged'],
    ['failure after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ];

  for (const [label, options, expectedJournalStatus] of boundaryCases) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const remoteSnapshot = JSON.stringify(remote);

    const error = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    durableJournal.close();

    assert.ok(error instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), remoteSnapshot, label);
    assertAcceptableRecoveryState(error.details.recovery);
    assert.equal(error.details.recovery.status, 'old-remote', label);
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(
      readRecoveryJournal(journalPath).records.some((record) => record.type === 'recovery-state' && record.state === 'old-remote'),
      true,
      label,
    );
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
});

test('replaying a completed plan keeps the remote unchanged and preserves the completed recovery state', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();
  const persistedBeforeReplay = readRecoveryJournal(journalPath);

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  const persistedAfterReplay = readRecoveryJournal(journalPath);
  assert.equal(
    persistedAfterReplay.records.filter((record) => record.type === 'apply-committed').length,
    persistedBeforeReplay.records.filter((record) => record.type === 'apply-committed').length,
    'completed replay should not append mutation commit records',
  );
  assert.equal(
    persistedAfterReplay.records.filter((record) => record.type === 'mutation-observed').length,
    persistedBeforeReplay.records.filter((record) => record.type === 'mutation-observed').length,
    'completed replay should not append fresh mutation observations',
  );
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
});

test('durable recovery boundary matrix keeps old-remote failures safe and completed replay inert', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const remoteSnapshot = JSON.stringify(remote);

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    durableJournal.close();

    assert.ok(failure instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), remoteSnapshot, label);
    assertAcceptableRecoveryState(failure.details.recovery);
    assertRecoveryStateArtifacts(failure.details.recovery, 'old-remote');
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);

    const persisted = readRecoveryJournal(journalPath);
    assert.equal(
      persisted.records.some((record) => record.type === 'journal-opened'),
      true,
      label,
    );
    assert.equal(
      persisted.records.some((record) => record.type === 'apply-staged'),
      expectedJournalStatus !== 'opened',
      label,
    );
    assert.equal(
      persisted.records.some((record) => record.type === 'dependencies-validated'),
      expectedJournalStatus === 'dependencies-validated',
      label,
    );
    assert.equal(
      persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'old-remote'),
      true,
      label,
    );
    assert.equal(
      persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
      false,
      label,
    );

    const replayRemote = baseSite();
    const replaySnapshot = JSON.stringify(replayRemote);
    const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
    const replay = applyPlan(replayRemote, plan, {
      durableJournal: replayJournal,
      journal: failure.details.recovery.artifacts.journal,
    });
    replayJournal.close();

    assert.equal(JSON.stringify(replayRemote), replaySnapshot, label);
    assert.equal(replay.appliedMutations, plan.mutations.length, label);
    assertAcceptableRecoveryState(replay.recoveryState);
    assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
    assert.equal(replay.recoveryState.artifacts.remote, undefined, label);
    assert.equal(replay.recoveryState.artifacts.journal.status, 'completed', label);
    assert.equal(replay.site.files['index.php'], '<?php echo "local";', label);
    assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally', label);
    assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1, label);
  }
});

test('atomic recovery boundaries only land in approved states and completed replay stays inert', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const remoteSnapshot = JSON.stringify(remote);

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    durableJournal.close();

    assert.ok(failure instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), remoteSnapshot, label);
    assertAcceptableRecoveryState(failure.details.recovery);
    assertRecoveryStateArtifacts(failure.details.recovery, 'old-remote');
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);

    const replayRemote = baseSite();
    const replaySnapshot = JSON.stringify(replayRemote);
    const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
    const replay = applyPlan(replayRemote, plan, {
      durableJournal: replayJournal,
      journal: failure.details.recovery.artifacts.journal,
    });
    replayJournal.close();

    assert.equal(JSON.stringify(replayRemote), replaySnapshot, label);
    assert.equal(replay.appliedMutations, plan.mutations.length, label);
    assertAcceptableRecoveryState(replay.recoveryState);
    assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
    assert.equal(replay.recoveryState.artifacts.remote, undefined, label);
    assert.equal(replay.recoveryState.artifacts.journal.status, 'completed', label);
    assert.equal(replay.site.files['index.php'], '<?php echo "local";', label);
    assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally', label);
    assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1, label);
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  const replayInspection = inspectRecoveryJournal({
    journal: readRecoveryJournal(completedJournalPath),
    plan,
    current: replayRemote,
  });
  assert.equal(replayInspection.status, 'fully-updated-remote');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
});

test('durable recovery contract stays limited to the accepted boundary states and replay stays inert', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const remote = baseSite();
  const remoteSnapshot = JSON.stringify(remote);

  const failure = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal,
      failAfterDependencyValidation: true,
    }),
  );
  durableJournal.close();

  assert.ok(failure instanceof PushPlanError);
  assertAcceptableRecoveryState(failure.details.recovery);
  assertRecoveryStateArtifacts(failure.details.recovery, 'old-remote');
  assert.equal(failure.details.recovery.artifacts.journal.status, 'dependencies-validated');
  assert.equal(failure.details.recovery.artifacts.remote, undefined);
  assert.equal(JSON.stringify(remote), remoteSnapshot);

  const replayRemote = baseSite();
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: failure.details.recovery.artifacts.journal,
  });
  replayJournal.close();

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, plan.mutations.length);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
});

test('pre-mutation durable recovery stays old-remote and completed replay remains inert', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const remote = baseSite();
  const remoteSnapshot = JSON.stringify(remote);

  const failure = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal,
      failBeforeMutation: true,
    }),
  );

  durableJournal.close();

  assert.ok(failure instanceof PushPlanError);
  assert.equal(failure.code, 'INJECTED_FAILURE_BEFORE_MUTATION');
  assert.equal(JSON.stringify(remote), remoteSnapshot);
  assertAcceptableRecoveryState(failure.details.recovery);
  assertRecoveryStateArtifacts(failure.details.recovery, 'old-remote');
  assert.equal(failure.details.recovery.artifacts.journal.status, 'opened');
  assert.equal(failure.details.recovery.artifacts.remote, undefined);

  const persistedAfterFailure = readRecoveryJournal(journalPath);
  assert.equal(
    persistedAfterFailure.records.some((record) => record.type === 'journal-opened'),
    true,
  );
  assert.equal(
    persistedAfterFailure.records.some((record) => record.type === 'apply-staged'),
    false,
  );
  assert.equal(
    persistedAfterFailure.records.some((record) => record.type === 'dependencies-validated'),
    false,
  );
  assert.equal(
    persistedAfterFailure.records.some((record) => record.type === 'recovery-state'),
    true,
  );
  assert.equal(
    persistedAfterFailure.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
    false,
  );
  assert.equal(
    persistedAfterFailure.records.some((record) => record.type === 'recovery-state' && record.state === 'old-remote'),
    true,
  );

  const replayRemote = baseSite();
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: failure.details.recovery.artifacts.journal,
  });
  replayJournal.close();

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, plan.mutations.length);
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
});

test('durable recovery after staging the first mutation but before commit stays old-remote and replays once', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const remote = baseSite();
  const remoteSnapshot = JSON.stringify(remote);

  const failure = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal,
      failBeforeCommitAtMutation: 1,
    }),
  );

  durableJournal.close();

  assert.ok(failure instanceof PushPlanError);
  assert.equal(failure.code, 'INJECTED_FAILURE_BEFORE_COMMIT');
  assert.equal(JSON.stringify(remote), remoteSnapshot);
  assertAcceptableRecoveryState(failure.details.recovery);
  assertRecoveryStateArtifacts(failure.details.recovery, 'old-remote');
  assert.equal(failure.details.recovery.artifacts.journal.status, 'staging');
  assert.equal(failure.details.recovery.artifacts.remote, undefined);

  const persistedAfterFailure = readRecoveryJournal(journalPath);
  assert.equal(
    persistedAfterFailure.records.some((record) => record.type === 'journal-opened'),
    true,
  );
  assert.equal(
    persistedAfterFailure.records.some((record) => record.type === 'apply-staged'),
    false,
  );
  assert.equal(
    persistedAfterFailure.records.some((record) => record.type === 'dependencies-validated'),
    false,
  );
  const replayRemote = baseSite();
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: failure.details.recovery.artifacts.journal,
  });
  replayJournal.close();

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, plan.mutations.length);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
});

test('durable replay after an old-remote recovery stays inert and does not resurrect stale inserts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const failure = captureError(() =>
    applyPlan(baseSite(), plan, {
      durableJournal,
      failAfterDependencyValidation: true,
    }),
  );
  durableJournal.close();

  assert.ok(failure instanceof PushPlanError);
  assertAcceptableRecoveryState(failure.details.recovery);
  assertRecoveryStateArtifacts(failure.details.recovery, 'old-remote');
  assert.equal(failure.details.recovery.artifacts.journal.status, 'dependencies-validated');
  assert.equal(failure.details.recovery.artifacts.remote, undefined);

  const retryRemote = baseSite();
  const retryRemoteSnapshot = JSON.stringify(retryRemote);
  const retryJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const retry = applyPlan(retryRemote, plan, {
    durableJournal: retryJournal,
    journal: failure.details.recovery.artifacts.journal,
  });
  retryJournal.close();

  assert.equal(JSON.stringify(retryRemote), retryRemoteSnapshot);
  assert.equal(retry.appliedMutations, plan.mutations.length);
  assert.equal(retry.site.files['index.php'], '<?php echo "local";');
  assert.equal(retry.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(retry.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
  assertAcceptableRecoveryState(retry.recoveryState);
  assertRecoveryStateArtifacts(retry.recoveryState, 'fully-updated-remote');
  assert.equal(retry.recoveryState.artifacts.remote, undefined);
  assert.equal(retry.recoveryState.artifacts.journal.status, 'completed');
});

test('completed replay stays inert on repeated retries and does not duplicate inserts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const firstReplayRemote = JSON.parse(JSON.stringify(completed.site));
  const firstReplayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const firstReplay = applyPlan(firstReplayRemote, plan, {
    durableJournal: firstReplayJournal,
    journal: completed.journal,
  });
  firstReplayJournal.close();

  const secondReplayRemote = JSON.parse(JSON.stringify(firstReplay.site));
  const secondReplayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const secondReplay = applyPlan(secondReplayRemote, plan, {
    durableJournal: secondReplayJournal,
    journal: completed.journal,
  });
  secondReplayJournal.close();

  assert.equal(firstReplay.appliedMutations, 0);
  assert.equal(secondReplay.appliedMutations, 0);
  assert.equal(firstReplay.site.files['index.php'], '<?php echo "local";');
  assert.equal(secondReplay.site.files['index.php'], '<?php echo "local";');
  assert.equal(firstReplay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(secondReplay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(secondReplay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
  assertAcceptableRecoveryState(firstReplay.recoveryState);
  assertAcceptableRecoveryState(secondReplay.recoveryState);
  assertRecoveryStateArtifacts(firstReplay.recoveryState, 'fully-updated-remote');
  assertRecoveryStateArtifacts(secondReplay.recoveryState, 'fully-updated-remote');
  assert.equal(firstReplay.recoveryState.artifacts.remote, undefined);
  assert.equal(secondReplay.recoveryState.artifacts.remote, undefined);
  assert.equal(firstReplay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(secondReplay.recoveryState.artifacts.journal.status, 'completed');
});

test('durable completed replay stays fully-updated when replay journaling fails', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const failingReplayJournal = failingDurableJournal('journal-replayed');
  const replayError = captureError(() =>
    applyPlan(replayRemote, plan, {
      durableJournal: failingReplayJournal,
      journal: completed.journal,
    }),
  );

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.ok(replayError instanceof PushPlanError);
  assert.equal(replayError.code, 'JOURNAL_WRITE_FAILED');
  assertAcceptableRecoveryState(replayError.details.recovery);
  assertRecoveryStateArtifacts(replayError.details.recovery, 'fully-updated-remote');
  assert.equal(replayError.details.durableRecoveryStateWriteFailed, true);
  assert.ok(replayError.details.durableJournalError);
  assert.equal(replayError.details.durableJournalError.eventType, 'journal-replayed');
  assert.equal(replayError.details.recovery.artifacts.remote, undefined);
  assert.equal(replayError.details.recovery.artifacts.journal.status, 'completed');
});

test('stale completed replay stays blocked with inspectable artifacts instead of collapsing to old-remote', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const driftedRemote = JSON.parse(JSON.stringify(completed.site));
  driftedRemote.files['index.php'] = '<?php echo "drifted";';
  const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const replayError = captureError(() =>
    applyPlan(driftedRemote, plan, {
      durableJournal: replayJournal,
      journal: completed.journal,
    }),
  );
  replayJournal.close();

  assert.ok(replayError instanceof PushPlanError);
  assert.equal(replayError.details.recovery.status, 'blocked-recovery');
  assert.ok(replayError.details.recovery.artifacts.journal, 'stale replay must preserve journal artifacts');
  assert.ok(replayError.details.recovery.artifacts.remote, 'stale replay must preserve remote artifacts');
  assert.equal(replayError.details.recovery.artifacts.remote.files['index.php'], '<?php echo "drifted";');
  assert.equal(replayError.details.recovery.artifacts.remote.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(
    readRecoveryJournal(journalPath).records.some(
      (record) => record.type === 'recovery-state' && record.state === 'blocked-recovery',
    ),
    true,
  );
  assert.equal(
    readRecoveryJournal(journalPath).records.some(
      (record) => record.type === 'recovery-state' && record.state === 'fully-updated-remote',
    ),
    true,
  );
});

test('durable mid-apply failures stay blocked with recovery artifacts and never become a safe replay', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const remote = baseSite();

  const partialError = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal,
      mutateRemote: true,
      failDuringCommitAtMutation: 1,
    }),
  );

  assert.ok(partialError instanceof PushPlanError);
  assert.equal(partialError.code, 'INJECTED_FAILURE_DURING_COMMIT');
  assert.equal(partialError.details.recovery.status, 'blocked-recovery');
  assert.ok(partialError.details.recovery.artifacts.journal, 'partial commit must keep journal artifacts');
  assert.ok(partialError.details.recovery.artifacts.remote, 'partial commit must keep remote artifacts');
  assert.equal(partialError.details.recovery.artifacts.journal.status, 'blocked');
  assert.equal(partialError.details.recovery.artifacts.remote.files['index.php'], '<?php echo "local";');
  assert.equal(partialError.details.recovery.artifacts.remote.db.wp_posts['ID:1'].post_title, 'Base post');
  assert.equal(partialError.details.recovery.artifacts.remote.db.wp_posts['ID:2'], undefined);

  const retryError = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal,
      mutateRemote: true,
      journal: partialError.details.recovery.artifacts.journal,
    }),
  );

  durableJournal.close();
  const persisted = readRecoveryJournal(journalPath);
  const inspection = inspectRecoveryJournal({
    journal: persisted,
    plan,
    current: partialError.details.recovery.artifacts.remote,
  });

  assert.ok(retryError instanceof PushPlanError);
  assert.equal(retryError.details.recovery.status, 'blocked-recovery');
  assert.equal(retryError.details.recovery.artifacts.journal.status, 'blocked');
  assert.ok(retryError.details.recovery.artifacts.remote, 'retry must remain blocked with remote artifacts');
  assert.equal(retryError.details.recovery.artifacts.remote.db.wp_posts['ID:2'], undefined);
  assert.equal(inspection.status, 'blocked-recovery');
  assert.ok(inspection.journal, 'inspection must preserve journal artifacts');
  assert.equal(
    persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
    true,
  );
  assert.equal(
    persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'fully-updated-remote'),
    false,
  );
});

test('durable recovery boundaries stay limited to old-remote, fully-updated-remote, or blocked-recovery with artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const boundaries = [
    ['before mutation', { failBeforeMutation: true }, 'opened', 'old-remote'],
    ['after staging', { failAfterStaging: true }, 'staged', 'old-remote'],
    [
      'after dependency validation',
      { failAfterDependencyValidation: true },
      'dependencies-validated',
      'old-remote',
    ],
  ];

  for (const [label, options, journalState, expectedRecoveryState] of boundaries) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const failure = captureError(() =>
      applyPlan(baseSite(), plan, {
        durableJournal,
        ...options,
      }),
    );
    durableJournal.close();

    assert.ok(failure instanceof PushPlanError, label);
    assertAcceptableRecoveryState(failure.details.recovery);
    assertFailureRecoveryState(failure.details.recovery, expectedRecoveryState);
    assert.equal(failure.details.recovery.artifacts.journal.status, journalState, label);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);

    const persisted = readRecoveryJournal(journalPath);
    assert.equal(
      persisted.records.some(
        (record) => record.type === 'recovery-state' && record.state === expectedRecoveryState,
      ),
      true,
      label,
    );
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
});

test('persisted partial-commit recovery remains blocked on inspection and does not collapse into old-remote', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const remote = baseSite();

  const failure = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal,
      mutateRemote: true,
      failDuringCommitAtMutation: 1,
    }),
  );

  durableJournal.close();

  assert.ok(failure instanceof PushPlanError);
  assert.equal(failure.details.recovery.status, 'blocked-recovery');

  const persisted = readRecoveryJournal(journalPath);
  const inspection = inspectRecoveryJournal({
    journal: persisted,
    plan,
    current: remote,
  });

  assert.equal(inspection.status, 'blocked-recovery');
  assert.ok(inspection.journal);
  assert.ok(inspection.claim);
  assert.equal(
    inspection.targets.some((target) => target.state === 'old'),
    true,
  );
  assert.equal(
    inspection.targets.some((target) => target.state === 'new'),
    true,
  );
  assert.equal(
    persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
    true,
  );
});

test('durable claim loss before the first remote mutation stays blocked with artifacts and does not expose a partial remote', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, {
    truncate: true,
    now: fixedNow,
    claimId: 'worker-a',
  });
  appendRecoveryClaimOpened(durableJournal, {
    plan,
    current: baseSite(),
    claimId: 'worker-a',
    staleThresholdMs: 1000,
  });

  const remote = baseSite();
  const remoteSnapshot = JSON.stringify(remote);
  const error = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal,
      mutateRemote: true,
      beforeMutation({ mutationIndex }) {
        assert.equal(mutationIndex, 1);
        const competingWriter = openRecoveryJournal(journalPath, {
          now: new Date(fixedNow.getTime() + 5000),
          claimId: 'worker-b',
        });
        appendStaleClaimAdvanced(competingWriter, {
          plan,
          current: remote,
          previousClaimId: 'worker-a',
          claimId: 'worker-b',
          staleThresholdMs: 1000,
          previousClaimAgeMs: 5000,
        });
        competingWriter.close();
      },
    }),
  );

  durableJournal.close();

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'RECOVERY_CLAIM_STALE');
  assert.equal(error.details.recovery.status, 'blocked-recovery');
  assert.equal(JSON.stringify(remote), remoteSnapshot);
  assert.equal(remote.files['index.php'], '<?php echo "base";');
  assert.equal(remote.db.wp_posts['ID:2'], undefined);
  assert.ok(error.details.recovery.artifacts.journal);
  assert.ok(error.details.recovery.artifacts.remote);
  assert.equal(error.details.recovery.artifacts.remote.files['index.php'], '<?php echo "base";');
  assert.equal(error.details.recovery.artifacts.remote.db.wp_posts['ID:2'], undefined);

  const persisted = readRecoveryJournal(journalPath);
  assert.equal(
    persisted.records.some((record) => record.type === 'stale-claim-advanced'),
    true,
  );
  assert.equal(
    persisted.records.some((record) => record.type === 'mutation-observed'),
    false,
  );
});

test('no-data-loss recovery contract keeps pre-mutation failures old-remote, completed replay fully-updated, and only partial writes blocked', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    durableJournal.close();

    assert.ok(failure instanceof PushPlanError, label);
    assert.equal(failure.details.recovery.status, 'old-remote', label);
    assertRecoveryStateArtifacts(failure.details.recovery, 'old-remote');
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);

    const replayRemote = baseSite();
    const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
    const replay = applyPlan(replayRemote, plan, {
      durableJournal: replayJournal,
      journal: failure.details.recovery.artifacts.journal,
    });
    replayJournal.close();

    assert.equal(replay.appliedMutations, plan.mutations.length, label);
    assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
    assert.equal(replay.recoveryState.artifacts.remote, undefined, label);
    assert.equal(replay.recoveryState.artifacts.journal.status, 'completed', label);
    assert.equal(replay.site.files['index.php'], '<?php echo "local";', label);
    assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally', label);
  }

  const partialJournalPath = tempRecoveryJournalPath();
  const partialDurableJournal = openRecoveryJournal(partialJournalPath, { truncate: true, now: fixedNow });
  const partialRemote = baseSite();
  const partialFailure = captureError(() =>
    applyPlan(partialRemote, plan, {
      durableJournal: partialDurableJournal,
      mutateRemote: true,
      failDuringCommitAtMutation: 1,
    }),
  );
  partialDurableJournal.close();

  assert.ok(partialFailure instanceof PushPlanError);
  assert.equal(partialFailure.details.recovery.status, 'blocked-recovery');
  assert.ok(partialFailure.details.recovery.artifacts.journal);
  assert.ok(partialFailure.details.recovery.artifacts.remote);
  assert.equal(partialFailure.details.recovery.artifacts.remote.db.wp_posts['ID:2'], undefined);
});

test('durable recovery keeps the three failure boundaries old-remote and completed replay fully-updated', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const remote = baseSite();
    const before = JSON.stringify(remote);
    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    assert.ok(failure instanceof PushPlanError, label);
    assert.equal(JSON.stringify(remote), before, label);
    assertAcceptableRecoveryState(failure.details.recovery);
    assertRecoveryStateArtifacts(failure.details.recovery, 'old-remote');
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
  }

  const completed = applyPlan(baseSite(), plan, { durableJournal });
  assertAcceptableRecoveryState(completed.recoveryState);
  assertRecoveryStateArtifacts(completed.recoveryState, 'fully-updated-remote');
  assert.equal(completed.recoveryState.artifacts.remote, undefined);
  assert.equal(completed.recoveryState.artifacts.journal.status, 'completed');

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, {
    durableJournal,
    journal: completed.journal,
  });

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');

  durableJournal.close();
});

test('no-data-loss recovery boundary matrix only allows old-remote before commit and fully-updated-remote after completed replay', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const snapshot = JSON.stringify(remote);

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    durableJournal.close();

    assert.ok(failure instanceof PushPlanError, label);
    assertFailureRecoveryState(failure.details.recovery, 'old-remote');
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(JSON.stringify(remote), snapshot, label);

    const inspection = inspectRecoveryJournal({
      journal: readRecoveryJournal(journalPath),
      plan,
      current: remote,
    });
    assert.equal(inspection.status, 'old-remote', label);
  }

  const midApplyJournalPath = tempRecoveryJournalPath();
  const midApplyDurableJournal = openRecoveryJournal(midApplyJournalPath, { truncate: true, now: fixedNow });
  const midApplyRemote = baseSite();
  const midApplySnapshot = JSON.stringify(midApplyRemote);
  const midApplyFailure = captureError(() =>
    applyPlan(midApplyRemote, plan, {
      durableJournal: midApplyDurableJournal,
      mutateRemote: true,
      failDuringCommitAtMutation: 1,
    }),
  );
  midApplyDurableJournal.close();

  assert.ok(midApplyFailure instanceof PushPlanError, 'mid-apply partial commit should fail');
  assertFailureRecoveryState(midApplyFailure.details.recovery, 'blocked-recovery');
  assert.ok(midApplyFailure.details.recovery.artifacts.remote, 'mid-apply partial commit must retain remote artifacts');
  assert.equal(midApplyFailure.details.recovery.artifacts.journal.status, 'blocked');
  assert.notEqual(JSON.stringify(midApplyRemote), midApplySnapshot, 'mid-apply failure mutates the live remote');

  const midApplyInspection = inspectRecoveryJournal({
    journal: readRecoveryJournal(midApplyJournalPath),
    plan,
    current: midApplyRemote,
  });
  assert.equal(midApplyInspection.status, 'blocked-recovery', 'mid-apply partial commit must remain blocked');

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
});

test('no-data-loss recovery replays completed plans without duplicating inserts or reviving stale local data', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
});

test('completed replay stays inert across repeated retries and does not resurrect stale local deletes', () => {
  const base = baseSite();
  const local = baseSite();
  delete local.files['index.php'];
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });

  const firstReplay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  const secondReplay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: firstReplay.journal,
  });

  replayJournal.close();

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(firstReplay.appliedMutations, 0);
  assert.equal(secondReplay.appliedMutations, 0);
  assertAcceptableRecoveryState(firstReplay.recoveryState);
  assertAcceptableRecoveryState(secondReplay.recoveryState);
  assertRecoveryStateArtifacts(firstReplay.recoveryState, 'fully-updated-remote');
  assertRecoveryStateArtifacts(secondReplay.recoveryState, 'fully-updated-remote');
  assert.equal(firstReplay.recoveryState.artifacts.remote, undefined);
  assert.equal(secondReplay.recoveryState.artifacts.remote, undefined);
  assert.equal(firstReplay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(secondReplay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(firstReplay.site.files['index.php'], undefined);
  assert.equal(secondReplay.site.files['index.php'], undefined);
  assert.equal(firstReplay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(secondReplay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(secondReplay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
});

test('completed replay keeps the durable journal replay-only and does not emit mutation observations on retry', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const beforeReplay = readRecoveryJournal(completedJournalPath);
  const beforeReplayMutationObservations = beforeReplay.records.filter(
    (record) => record.type === 'mutation-observed',
  ).length;

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  const persisted = readRecoveryJournal(completedJournalPath);
  const eventTypes = persisted.records.map((record) => record.type);
  const afterReplayMutationObservations = persisted.records.filter(
    (record) => record.type === 'mutation-observed',
  ).length;
  const replayStates = persisted.records.filter((record) => record.type === 'recovery-state');

  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.ok(eventTypes.includes('journal-completed'));
  assert.ok(eventTypes.includes('journal-replayed'));
  assert.equal(eventTypes.filter((type) => type === 'journal-replayed').length, 1);
  assert.equal(replayStates.filter((record) => record.state === 'fully-updated-remote').length, 2);
  assert.equal(replayStates.some((record) => record.state === 'blocked-recovery'), false);
  assert.equal(afterReplayMutationObservations, beforeReplayMutationObservations);
  assert.equal(persisted.records[persisted.records.length - 2].type, 'recovery-state');
});

test('completed replay stays idempotent when re-applied from the persisted completed journal', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);
  assert.equal(persisted.integrity.status, 'ok');
  assert.equal(persisted.records.filter((record) => record.type === 'journal-completed').length, 1);

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
});

test('persisted completed journal replays without duplicating completion records or reviving stale local state', () => {
  const base = baseSite();
  const local = baseSite();
  delete local.files['index.php'];
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  durableJournal.close();

  const persistedBefore = readRecoveryJournal(journalPath);
  assert.equal(
    persistedBefore.records.filter((record) => record.type === 'journal-completed').length,
    1,
  );

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  const persistedAfter = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.files['index.php'], undefined);
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
  assert.equal(
    persistedAfter.records.filter((record) => record.type === 'journal-completed').length,
    1,
  );
  assert.equal(
    persistedAfter.records.filter((record) => record.type === 'journal-replayed').length,
    1,
  );
});

test('no-data-loss blocked partial recovery keeps inspectable artifacts and stays blocked on retry', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const remote = baseSite();
  const failure = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal,
      mutateRemote: true,
      failDuringCommitAtMutation: 1,
    }),
  );
  durableJournal.close();

  assert.ok(failure instanceof PushPlanError);
  assertFailureRecoveryState(failure.details.recovery, 'blocked-recovery');

  const inspection = inspectRecoveryJournal({
    journal: readRecoveryJournal(journalPath),
    plan,
    current: remote,
  });
  assert.equal(inspection.status, 'blocked-recovery');

  const retryJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const retryError = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal: retryJournal,
      journal: failure.details.recovery.artifacts.journal,
    }),
  );
  retryJournal.close();

  assert.ok(retryError instanceof PushPlanError);
  assertFailureRecoveryState(retryError.details.recovery, 'blocked-recovery');
  assert.equal(retryError.details.recovery.artifacts.remote.db.wp_posts['ID:2'], undefined);
  assert.equal(remote.db.wp_posts['ID:2'], undefined);

  const insertedJournalPath = tempRecoveryJournalPath();
  const insertedJournal = openRecoveryJournal(insertedJournalPath, { truncate: true, now: fixedNow });
  const insertedRemote = baseSite();
  const insertedFailure = captureError(() =>
    applyPlan(insertedRemote, plan, {
      durableJournal: insertedJournal,
      mutateRemote: true,
      failDuringCommitAtMutation: 2,
    }),
  );
  insertedJournal.close();

  assert.ok(insertedFailure instanceof PushPlanError);
  assertFailureRecoveryState(insertedFailure.details.recovery, 'blocked-recovery');
  assert.equal(
    Object.keys(insertedFailure.details.recovery.artifacts.remote.db.wp_posts).filter((key) => key === 'ID:2').length,
    1,
  );

  const insertedRetryJournal = openRecoveryJournal(insertedJournalPath, { now: fixedNow });
  const insertedRetry = applyPlan(insertedRemote, plan, {
    durableJournal: insertedRetryJournal,
    journal: insertedFailure.details.recovery.artifacts.journal,
  });
  insertedRetryJournal.close();

  assert.equal(insertedRetry.recoveryState.status, 'fully-updated-remote');
  assert.equal(insertedRetry.recoveryState.artifacts.remote, undefined);
  assert.equal(insertedRetry.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(
    Object.keys(insertedRetry.site.db.wp_posts).filter((key) => key === 'ID:2').length,
    1,
  );
  assert.equal(insertedRemote.db.wp_posts['ID:2'].post_title, 'Inserted locally');
});

test('no-data-loss recovery contract only accepts old-remote, fully-updated-remote, or blocked-recovery with artifacts', () => {
  assert.deepEqual([...ACCEPTABLE_RECOVERY_STATES].sort(), [
    'blocked-recovery',
    'fully-updated-remote',
    'old-remote',
  ]);

  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const failureJournalPath = tempRecoveryJournalPath();
  const failureJournal = openRecoveryJournal(failureJournalPath, { truncate: true, now: fixedNow });
  const preMutationRemote = baseSite();
  const preMutationFailure = captureError(() =>
    applyPlan(preMutationRemote, plan, {
      durableJournal: failureJournal,
      failBeforeMutation: true,
    }),
  );
  failureJournal.close();

  assertFailureRecoveryState(preMutationFailure.details.recovery, 'old-remote');
  assert.equal(preMutationFailure.details.recovery.artifacts.remote, undefined);

  const completedJournalPath = tempRecoveryJournalPath();
  const completedJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedJournal });
  completedJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');

  const partialJournalPath = tempRecoveryJournalPath();
  const partialJournal = openRecoveryJournal(partialJournalPath, { truncate: true, now: fixedNow });
  const partialRemote = baseSite();
  const partialFailure = captureError(() =>
    applyPlan(partialRemote, plan, {
      durableJournal: partialJournal,
      mutateRemote: true,
      failDuringCommitAtMutation: 1,
    }),
  );
  partialJournal.close();

  assertFailureRecoveryState(partialFailure.details.recovery, 'blocked-recovery');
  assert.ok(partialFailure.details.recovery.artifacts.remote);
  assert.ok(partialFailure.details.recovery.artifacts.journal);
});

test('no-data-loss recovery matrix keeps pre-mutation failures old-remote, replayed journals fully-updated, and retries idempotent', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const failureJournalPath = tempRecoveryJournalPath();
  const failureJournal = openRecoveryJournal(failureJournalPath, { truncate: true, now: fixedNow });
  const remote = baseSite();
  const failure = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal: failureJournal,
      failAfterStaging: true,
    }),
  );
  failureJournal.close();

  assert.ok(failure instanceof PushPlanError);
  assertFailureRecoveryState(failure.details.recovery, 'old-remote');
  assert.equal(failure.details.recovery.artifacts.remote, undefined);
  assert.equal(failure.details.recovery.artifacts.journal.status, 'staged');

  const replayJournal = openRecoveryJournal(failureJournalPath, { now: fixedNow });
  const replay = applyPlan(baseSite(), plan, {
    durableJournal: replayJournal,
    journal: failure.details.recovery.artifacts.journal,
  });
  replayJournal.close();

  assert.equal(replay.appliedMutations, plan.mutations.length);
  assertFailureRecoveryState(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
});

test('no-data-loss recovery contract keeps pre-mutation boundaries old-remote and completed replay inert', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const snapshot = JSON.stringify(remote);

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    durableJournal.close();

    assert.ok(failure instanceof PushPlanError, label);
    assertFailureRecoveryState(failure.details.recovery, 'old-remote');
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assertRemoteUnchanged(remote, snapshot);

    const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
    const replay = applyPlan(baseSite(), plan, {
      durableJournal: replayJournal,
      journal: failure.details.recovery.artifacts.journal,
    });
    replayJournal.close();

    assert.equal(replay.appliedMutations, plan.mutations.length, label);
    assertAcceptableRecoveryState(replay.recoveryState);
    assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
    assert.equal(replay.recoveryState.artifacts.remote, undefined, label);
    assert.equal(replay.recoveryState.artifacts.journal.status, 'completed', label);
    assert.equal(replay.site.files['index.php'], '<?php echo "local";', label);
    assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally', label);
    assert.equal(
      Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length,
      1,
      label,
    );
  }
});

test('no-data-loss recovery contract stays durable across pre-commit failures, completed replay, and stale completed replay', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const snapshot = JSON.stringify(remote);

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );
    durableJournal.close();

    assert.ok(failure instanceof PushPlanError, label);
    assertFailureRecoveryState(failure.details.recovery, 'old-remote');
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(JSON.stringify(remote), snapshot, label);

    const replay = applyPlan(baseSite(), plan, {
      durableJournal: openRecoveryJournal(journalPath, { now: fixedNow }),
      journal: failure.details.recovery.artifacts.journal,
    });

    assert.equal(replay.recoveryState.status, 'fully-updated-remote', label);
    assert.equal(replay.recoveryState.artifacts.remote, undefined, label);
    assert.equal(replay.recoveryState.artifacts.journal.status, 'completed', label);
    assert.equal(replay.site.files['index.php'], '<?php echo "local";', label);
    assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally', label);
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const staleRemote = JSON.parse(JSON.stringify(completed.site));
  staleRemote.files['index.php'] = '<?php echo "drifted";';
  const staleReplay = captureError(() =>
    applyPlan(staleRemote, plan, {
      durableJournal: openRecoveryJournal(completedJournalPath, { now: fixedNow }),
      journal: completed.journal,
    }),
  );

  assert.ok(staleReplay instanceof PushPlanError);
  assertFailureRecoveryState(staleReplay.details.recovery, 'blocked-recovery');
  assert.ok(staleReplay.details.recovery.artifacts.remote, 'stale completed replay must preserve remote artifacts');
  assert.ok(staleReplay.details.recovery.artifacts.journal, 'stale completed replay must preserve journal artifacts');
  assert.equal(staleReplay.details.recovery.artifacts.remote.files['index.php'], '<?php echo "drifted";');
});

test('no-data-loss durable journal boundaries keep pre-mutation failures old-remote and replay completed plans inert', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const snapshot = JSON.stringify(remote);

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    durableJournal.close();

    assert.ok(failure instanceof PushPlanError, label);
    assertFailureRecoveryState(failure.details.recovery, 'old-remote');
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(JSON.stringify(remote), snapshot, label);

    const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
    const replay = applyPlan(baseSite(), plan, {
      durableJournal: replayJournal,
      journal: failure.details.recovery.artifacts.journal,
    });
    replayJournal.close();

    assert.equal(replay.appliedMutations, plan.mutations.length, label);
    assertAcceptableRecoveryState(replay.recoveryState);
    assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
    assert.equal(replay.recoveryState.artifacts.remote, undefined, label);
    assert.equal(replay.recoveryState.artifacts.journal.status, 'completed', label);
    assert.equal(replay.site.files['index.php'], '<?php echo "local";', label);
    assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally', label);
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
});

test('durable journal write failure before mutation stays old-remote and preserves the journal artifact', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const remote = baseSite();
  const snapshot = JSON.stringify(remote);
  const failure = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal: failingDurableJournal('journal-opened'),
    }),
  );

  assert.ok(failure instanceof PushPlanError);
  assertFailureRecoveryState(failure.details.recovery, 'old-remote');
  assert.equal(failure.details.recovery.artifacts.remote, undefined);
  assert.equal(failure.details.recovery.artifacts.journal.status, 'opened');
  assert.equal(JSON.stringify(remote), snapshot);
});

test('durable journal write failures at staging and dependency validation stay old-remote and replay safely', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, failType, expectedJournalStatus] of [
    ['apply-staged', 'apply-staged', 'staged'],
    ['dependencies-validated', 'dependencies-validated', 'dependencies-validated'],
  ]) {
    const remote = baseSite();
    const snapshot = JSON.stringify(remote);
    const durableJournal = failingDurableJournal(failType);

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
      }),
    );

    assert.ok(failure instanceof PushPlanError, label);
    assertFailureRecoveryState(failure.details.recovery, 'old-remote');
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(JSON.stringify(remote), snapshot, label);

    const retryJournal = failingDurableJournal('journal-replayed');
    const replay = applyPlan(baseSite(), plan, {
      durableJournal: retryJournal,
      journal: failure.details.recovery.artifacts.journal,
    });

    assert.equal(replay.appliedMutations, plan.mutations.length, label);
    assertAcceptableRecoveryState(replay.recoveryState);
    assert.equal(replay.recoveryState.status, 'fully-updated-remote', label);
    assert.equal(replay.recoveryState.artifacts.remote, undefined, label);
    assert.equal(replay.recoveryState.artifacts.journal.status, 'completed', label);
    assert.equal(replay.site.files['index.php'], '<?php echo "local";', label);
    assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally', label);
  }
});

test('no-data-loss recovery boundaries allow only old-remote, fully-updated-remote, or blocked-recovery with artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedStatus, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'old-remote', 'opened'],
    ['after staging', { failAfterStaging: true }, 'old-remote', 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'old-remote', 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const snapshot = JSON.stringify(remote);

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    durableJournal.close();

    assert.ok(failure instanceof PushPlanError, label);
    assertFailureRecoveryState(failure.details.recovery, expectedStatus);
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(JSON.stringify(remote), snapshot, label);
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
});

test('durable journal replay keeps pre-commit failures old-remote and completed replay inert', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const failureCases = [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ];

  for (const [label, options, expectedJournalStatus] of failureCases) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const snapshot = JSON.stringify(remote);

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    durableJournal.close();

    assert.ok(failure instanceof PushPlanError, label);
    assertFailureRecoveryState(failure.details.recovery, 'old-remote');
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(JSON.stringify(remote), snapshot, label);

    const inspection = inspectRecoveryJournal({
      journal: readRecoveryJournal(journalPath),
      plan,
      current: remote,
    });
    assert.equal(inspection.status, 'old-remote', label);
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
});

test('durable completed replay stays inert after dependency validation and preserves the persisted journal contract', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  durableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
  assert.equal(
    persisted.records.filter((record) => record.type === 'journal-completed').length,
    1,
  );
  assert.equal(
    persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
    false,
  );
});

test('durable journal replay blocks stale completed state and preserves inspectable artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  replayRemote.files['index.php'] = '<?php echo "drifted";';
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });

  const replayError = captureError(() =>
    applyPlan(replayRemote, plan, {
      durableJournal: replayJournal,
      journal: completed.journal,
    }),
  );

  replayJournal.close();

  assert.ok(replayError instanceof PushPlanError);
  assertRecoveryStateArtifacts(replayError.details.recovery, 'blocked-recovery');
  assert.equal(replayError.details.recovery.artifacts.journal.status, 'completed');
  assert.equal(replayError.details.recovery.artifacts.remote.files['index.php'], '<?php echo "drifted";');
  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
});

test('no-data-loss recovery states stay bounded across failure boundaries and completed replay', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const snapshot = JSON.stringify(remote);

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    durableJournal.close();

    assert.ok(failure instanceof PushPlanError, label);
    assertFailureRecoveryState(failure.details.recovery, 'old-remote');
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(JSON.stringify(remote), snapshot, label);

    const persisted = readRecoveryJournal(journalPath);
    const inspection = inspectRecoveryJournal({
      journal: persisted,
      plan,
      current: remote,
    });
    assert.equal(inspection.status, 'old-remote', label);
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
});

test('durable recovery matrix keeps pre-commit failures old-remote, partial commits blocked, and completed replay inert', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const failureCases = [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ];

  for (const [label, options, expectedJournalStatus] of failureCases) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const snapshot = JSON.stringify(remote);

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    durableJournal.close();

    assert.ok(failure instanceof PushPlanError, label);
    assertFailureRecoveryState(failure.details.recovery, 'old-remote');
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(JSON.stringify(remote), snapshot, label);
  }

  const partialJournalPath = tempRecoveryJournalPath();
  const partialJournal = openRecoveryJournal(partialJournalPath, { truncate: true, now: fixedNow });
  const partialRemote = baseSite();
  const partialFailure = captureError(() =>
    applyPlan(partialRemote, plan, {
      durableJournal: partialJournal,
      mutateRemote: true,
      failDuringCommitAtMutation: 1,
    }),
  );

  partialJournal.close();

  assertFailureRecoveryState(partialFailure.details.recovery, 'blocked-recovery');
  assert.ok(partialFailure.details.recovery.artifacts.remote, 'blocked recovery must preserve remote artifacts');
  assert.ok(partialFailure.details.recovery.artifacts.journal, 'blocked recovery must preserve journal artifacts');
  assert.equal(partialFailure.details.recovery.artifacts.remote.files['index.php'], '<?php echo "local";');

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
});

test('durable no-data-loss recovery keeps failure-before-mutation, failure-after-staging, failure-after-validation, and completed replay inside the approved envelope', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const failureCases = [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ];

  for (const [label, options, expectedJournalStatus] of failureCases) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const snapshot = JSON.stringify(remote);

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    durableJournal.close();

    assert.ok(failure instanceof PushPlanError, label);
    assertFailureRecoveryState(failure.details.recovery, 'old-remote');
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(JSON.stringify(remote), snapshot, label);

    const inspection = inspectRecoveryJournal({
      journal: readRecoveryJournal(journalPath),
      plan,
      current: remote,
    });
    assert.equal(inspection.status, 'old-remote', label);
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
});

test('durable no-data-loss recovery rejects mid-apply partial commits and keeps completed replay inert', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const partialJournalPath = tempRecoveryJournalPath();
  const partialDurableJournal = openRecoveryJournal(partialJournalPath, { truncate: true, now: fixedNow });
  const partialRemote = baseSite();
  const partialSnapshot = JSON.stringify(partialRemote);

  const partialFailure = captureError(() =>
    applyPlan(partialRemote, plan, {
      durableJournal: partialDurableJournal,
      mutateRemote: true,
      failDuringCommitAtMutation: 1,
    }),
  );

  partialDurableJournal.close();

  assert.ok(partialFailure instanceof PushPlanError);
  assertFailureRecoveryState(partialFailure.details.recovery, 'blocked-recovery');
  assert.ok(partialFailure.details.recovery.artifacts.remote, 'partial commit must keep remote artifacts');
  assert.ok(partialFailure.details.recovery.artifacts.journal, 'partial commit must keep journal artifacts');
  assert.equal(partialFailure.details.recovery.artifacts.remote.files['index.php'], '<?php echo "local";');
  assert.equal(JSON.stringify(partialRemote), JSON.stringify(partialFailure.details.recovery.artifacts.remote));
  assert.notEqual(JSON.stringify(partialRemote), partialSnapshot);

  const partialInspection = inspectRecoveryJournal({
    journal: readRecoveryJournal(partialJournalPath),
    plan,
    current: partialRemote,
  });
  assert.equal(partialInspection.status, 'blocked-recovery');
  assert.match(partialInspection.reason, /partial|partially updated/i, 'blocked inspect reason should describe the partial commit');
  assert.equal(partialInspection.claim.status, 'none', 'blocked partial recovery should not fabricate claim state');
  assert.equal(partialInspection.journal.integrity.status, 'ok', 'blocked partial recovery should keep journal integrity inspectable');
  assert.equal(partialInspection.counts.old, 1);
  assert.equal(partialInspection.counts.new, 1);
  assert.equal(partialInspection.counts.blockedUnknown, 0);

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
});

test('replaying a completed plan blocks drifted remote state and keeps recovery artifacts inspectable', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  durableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  replayRemote.files['index.php'] = '<?php echo "drifted";';
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });

  const replayError = captureError(() =>
    applyPlan(replayRemote, plan, {
      durableJournal: replayJournal,
      journal: completed.journal,
    }),
  );

  replayJournal.close();

  assert.ok(replayError instanceof PushPlanError);
  assertFailureRecoveryState(replayError.details.recovery, 'blocked-recovery');
  assert.ok(replayError.details.recovery.artifacts.remote, 'blocked replay must retain remote artifacts');
  assert.ok(replayError.details.recovery.artifacts.journal, 'blocked replay must retain journal artifacts');
  assert.equal(replayError.details.recovery.artifacts.journal.status, 'completed');
  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replayRemote.files['index.php'], '<?php echo "drifted";');
  assert.equal(Object.keys(replayRemote.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
});

test('durable no-data-loss recovery keeps the persisted completed journal replay inert and the failure boundaries recoverable', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const snapshot = JSON.stringify(remote);

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    durableJournal.close();

    assert.ok(failure instanceof PushPlanError, label);
    assertFailureRecoveryState(failure.details.recovery, 'old-remote');
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(JSON.stringify(remote), snapshot, label);

    const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
    const replay = applyPlan(baseSite(), plan, {
      durableJournal: replayJournal,
      journal: failure.details.recovery.artifacts.journal,
    });
    replayJournal.close();

    assert.equal(replay.appliedMutations, 2, label);
    assert.equal(replay.recoveryState.status, 'fully-updated-remote', label);
    assert.equal(replay.recoveryState.artifacts.remote, undefined, label);
    assert.equal(replay.recoveryState.artifacts.journal.status, 'completed', label);
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
});

test('replaying a completed plan stays inert and does not duplicate inserts or revive stale local data', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  durableJournal.close();
  const persistedBeforeReplay = readRecoveryJournal(journalPath);
  const targetPlannedCountBeforeReplay = persistedBeforeReplay.records.filter((record) => record.type === 'target-planned').length;
  const completedCountBeforeReplay = persistedBeforeReplay.records.filter((record) => record.type === 'journal-completed').length;
  const replayedCountBeforeReplay = persistedBeforeReplay.records.filter((record) => record.type === 'journal-replayed').length;
  const recoveryStateCountBeforeReplay = persistedBeforeReplay.records.filter((record) => record.type === 'recovery-state').length;

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);

  const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();
  const persistedAfterReplay = readRecoveryJournal(journalPath);
  const targetPlannedCountAfterReplay = persistedAfterReplay.records.filter((record) => record.type === 'target-planned').length;
  const completedCountAfterReplay = persistedAfterReplay.records.filter((record) => record.type === 'journal-completed').length;
  const replayedCountAfterReplay = persistedAfterReplay.records.filter((record) => record.type === 'journal-replayed').length;
  const recoveryStateCountAfterReplay = persistedAfterReplay.records.filter((record) => record.type === 'recovery-state').length;

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(targetPlannedCountAfterReplay, targetPlannedCountBeforeReplay);
  assert.equal(completedCountAfterReplay, completedCountBeforeReplay);
  assert.equal(replayedCountAfterReplay, replayedCountBeforeReplay + 1);
  assert.equal(recoveryStateCountAfterReplay, recoveryStateCountBeforeReplay + 1);
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
});

test('durable replay boundary keeps interrupted states old-remote and completed states replayable from disk', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const snapshot = JSON.stringify(remote);

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    durableJournal.close();

    assert.ok(failure instanceof PushPlanError, label);
    assert.equal(failure.details.recovery.status, 'old-remote', label);
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(JSON.stringify(remote), snapshot, label);
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
});

test('durable stale completed replay blocks with artifacts instead of duplicating inserts or reviving stale local data', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const staleRemote = JSON.parse(JSON.stringify(completed.site));
  staleRemote.files['index.php'] = '<?php echo "stale drift";';
  const staleSnapshot = JSON.stringify(staleRemote);

  const staleJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const staleError = captureError(() =>
    applyPlan(staleRemote, plan, {
      durableJournal: staleJournal,
      journal: completed.journal,
    }),
  );
  staleJournal.close();

  assert.ok(staleError instanceof PushPlanError);
  assertFailureRecoveryState(staleError.details.recovery, 'blocked-recovery');
  assert.ok(staleError.details.recovery.artifacts.remote, 'stale replay must keep remote artifacts');
  assert.ok(staleError.details.recovery.artifacts.journal, 'stale replay must keep journal artifacts');
  assert.equal(staleError.details.recovery.artifacts.remote.files['index.php'], '<?php echo "stale drift";');
  assert.equal(staleError.details.recovery.artifacts.remote.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(JSON.stringify(staleRemote), staleSnapshot);
});

test('durable apply recovery states stay inside the accepted envelope across failure and replay boundaries', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedStatus, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'old-remote', 'opened'],
    ['after staging', { failAfterStaging: true }, 'old-remote', 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'old-remote', 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const before = JSON.stringify(remote);

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    durableJournal.close();

    assert.ok(failure instanceof PushPlanError, label);
    assertFailureRecoveryState(failure.details.recovery, expectedStatus);
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(JSON.stringify(remote), before, label);
    assert.equal(inspectRecoveryJournal({
      journal: readRecoveryJournal(journalPath),
      plan,
      current: remote,
    }).status, 'old-remote', label);
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
});

test('durable recovery accepts only old-remote, fully-updated-remote, or blocked-recovery outcomes across the apply boundary', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const boundaryFailures = [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ];

  for (const [label, options, expectedJournalStatus] of boundaryFailures) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const snapshot = JSON.stringify(remote);

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    durableJournal.close();

    assert.ok(failure instanceof PushPlanError, label);
    assertAcceptableRecoveryState(failure.details.recovery);
    assert.equal(failure.details.recovery.status, 'old-remote', label);
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(JSON.stringify(remote), snapshot, label);
  }

  const partialJournalPath = tempRecoveryJournalPath();
  const partialDurableJournal = openRecoveryJournal(partialJournalPath, { truncate: true, now: fixedNow });
  const partialRemote = baseSite();
  const partialFailure = captureError(() =>
    applyPlan(partialRemote, plan, {
      durableJournal: partialDurableJournal,
      mutateRemote: true,
      failDuringCommitAtMutation: 1,
    }),
  );

  partialDurableJournal.close();

  assert.ok(partialFailure instanceof PushPlanError);
  assertAcceptableRecoveryState(partialFailure.details.recovery);
  assert.equal(partialFailure.details.recovery.status, 'blocked-recovery');
  assert.ok(partialFailure.details.recovery.artifacts.remote, 'partial commit must keep remote artifacts');
  assert.ok(partialFailure.details.recovery.artifacts.journal, 'partial commit must keep journal artifacts');
  assert.equal(partialFailure.details.recovery.artifacts.remote.files['index.php'], '<?php echo "local";');
  assert.equal(
    Object.keys(partialFailure.details.recovery.artifacts.remote.db.wp_posts).filter((key) => key === 'ID:2').length <= 1,
    true,
  );

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
});

test('durable no-data-loss recovery keeps failures old-remote and completed replay fully-updated with no duplicate work', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const snapshot = JSON.stringify(remote);

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    durableJournal.close();

    assert.ok(failure instanceof PushPlanError, label);
    assertFailureRecoveryState(failure.details.recovery, 'old-remote');
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(JSON.stringify(remote), snapshot, label);

    const inspection = inspectRecoveryJournal({
      journal: readRecoveryJournal(journalPath),
      plan,
      current: remote,
    });
    assert.equal(inspection.status, 'old-remote', label);
  }

  const partialJournalPath = tempRecoveryJournalPath();
  const partialDurableJournal = openRecoveryJournal(partialJournalPath, { truncate: true, now: fixedNow });
  const partialRemote = baseSite();
  const partialFailure = captureError(() =>
    applyPlan(partialRemote, plan, {
      durableJournal: partialDurableJournal,
      mutateRemote: true,
      failDuringCommitAtMutation: 1,
    }),
  );

  partialDurableJournal.close();

  assert.ok(partialFailure instanceof PushPlanError);
  assertFailureRecoveryState(partialFailure.details.recovery, 'blocked-recovery');
  assert.ok(partialFailure.details.recovery.artifacts.remote, 'partial commit must keep remote artifacts');
  assert.ok(partialFailure.details.recovery.artifacts.journal, 'partial commit must keep journal artifacts');
  assert.equal(partialFailure.details.recovery.artifacts.remote.files['index.php'], '<?php echo "local";');
  assert.equal(
    Object.keys(partialFailure.details.recovery.artifacts.remote.db.wp_posts).filter((key) => key === 'ID:2').length <= 1,
    true,
  );

  const partialInspection = inspectRecoveryJournal({
    journal: readRecoveryJournal(partialJournalPath),
    plan,
    current: partialFailure.details.recovery.artifacts.remote,
  });
  assert.equal(partialInspection.status, 'blocked-recovery');

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
});

test('durable apply recovery stays within old-remote, fully-updated-remote, or blocked-recovery across failure and replay boundaries', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const snapshot = JSON.stringify(remote);

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    durableJournal.close();

    assert.ok(failure instanceof PushPlanError, label);
    assertFailureRecoveryState(failure.details.recovery, 'old-remote');
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(JSON.stringify(remote), snapshot, label);

    const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
    const replay = applyPlan(baseSite(), plan, {
      durableJournal: replayJournal,
      journal: failure.details.recovery.artifacts.journal,
    });
    replayJournal.close();

    assert.equal(replay.appliedMutations, plan.mutations.length, label);
    assertAcceptableRecoveryState(replay.recoveryState);
    assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
    assert.equal(replay.recoveryState.artifacts.remote, undefined, label);
    assert.equal(replay.recoveryState.artifacts.journal.status, 'completed', label);
    assert.equal(replay.site.files['index.php'], '<?php echo "local";', label);
    assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally', label);
    assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1, label);
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
});

test('recovery inspect classifies durable replay as fully updated and drift as blocked with artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  durableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayInspection = inspectRecoveryJournal({
    journal: readRecoveryJournal(journalPath),
    plan,
    current: replayRemote,
  });
  assert.equal(replayInspection.status, 'fully-updated-remote');
  assert.equal(replayInspection.reason, 'Every planned target currently matches its journaled after hash.');
  assert.equal(replayInspection.claim.status, 'none');

  const driftedRemote = JSON.parse(JSON.stringify(completed.site));
  driftedRemote.files['index.php'] = '<?php echo "stale drift";';
  const blockedInspection = inspectRecoveryJournal({
    journal: readRecoveryJournal(journalPath),
    plan,
    current: driftedRemote,
  });
  assert.equal(blockedInspection.status, 'blocked-recovery');
  assert.equal(blockedInspection.claim.status, 'none');
  assert.ok(blockedInspection.targets.some((target) => target.state === 'blocked-unknown'));
  assert.ok(blockedInspection.targets.some((target) => target.reason.includes('outside the before/after recovery envelope')));
});

test('durable journal replay keeps pre-mutation failures old-remote and completed plans inert on retry', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const snapshot = JSON.stringify(remote);

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    durableJournal.close();

    assert.ok(failure instanceof PushPlanError, label);
    assertAcceptableRecoveryState(failure.details.recovery);
    assert.equal(failure.details.recovery.status, 'old-remote', label);
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(JSON.stringify(remote), snapshot, label);

    const retryJournal = openRecoveryJournal(journalPath, { now: fixedNow });
    const retry = applyPlan(baseSite(), plan, {
      durableJournal: retryJournal,
      journal: failure.details.recovery.artifacts.journal,
    });
    retryJournal.close();

    assertAcceptableRecoveryState(retry.recoveryState);
    assert.equal(retry.recoveryState.status, 'fully-updated-remote', label);
    assert.equal(retry.recoveryState.artifacts.remote, undefined, label);
    assert.equal(retry.recoveryState.artifacts.journal.status, 'completed', label);
    assert.equal(retry.appliedMutations, plan.mutations.length, label);
    assert.equal(retry.site.files['index.php'], '<?php echo "local";', label);
    assert.equal(retry.site.db.wp_posts['ID:2'].post_title, 'Inserted locally', label);
    assert.equal(Object.keys(retry.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1, label);
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
});

test('no-data-loss recovery boundary contract keeps interrupted applies old-remote, completed replay fully-updated, and partial writes blocked with artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const before = JSON.stringify(remote);

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    durableJournal.close();

    assert.ok(failure instanceof PushPlanError, label);
    assertFailureRecoveryState(failure.details.recovery, 'old-remote');
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(JSON.stringify(remote), before, label);
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
});

test('durable recovery accepts only the approved failure and replay states across the apply boundary', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const snapshot = JSON.stringify(remote);

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    durableJournal.close();

    assert.ok(failure instanceof PushPlanError, label);
    assertFailureRecoveryState(failure.details.recovery, 'old-remote');
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(JSON.stringify(remote), snapshot, label);
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
});

test('no-data-loss recovery keeps pre-mutation, post-staging, post-validation, and completed replay inside the accepted states', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const remote = baseSite();
    const remoteSnapshot = JSON.stringify(remote);
    const error = captureError(() => applyPlan(remote, plan, options));

    assert.ok(error instanceof PushPlanError, label);
    assertFailureRecoveryState(error.details.recovery, 'old-remote');
    assert.equal(error.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(error.details.recovery.artifacts.remote, undefined, label);
    assert.equal(JSON.stringify(remote), remoteSnapshot, label);
  }

  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
});

test('no-data-loss recovery journal states stay pinned to the failure boundary and completed replay stays inert', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const before = JSON.stringify(remote);

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    durableJournal.close();

    assert.ok(failure instanceof PushPlanError, label);
    assertFailureRecoveryState(failure.details.recovery, 'old-remote');
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(failure.details.recovery.artifacts.journal.entries.every((entry) => entry.status === 'pending' || entry.status === 'staged'), true, label);
    assert.equal(JSON.stringify(remote), before, label);
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.journal.entries.every((entry) => entry.status === 'applied'), true);
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
});

test('no-data-loss durable journal boundaries stay within the approved recovery envelope', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const before = JSON.stringify(remote);

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );

    durableJournal.close();

    assert.ok(failure instanceof PushPlanError, label);
    assertFailureRecoveryState(failure.details.recovery, 'old-remote');
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(
      failure.details.recovery.artifacts.journal.entries.every((entry) => entry.status === 'pending' || entry.status === 'staged'),
      true,
      label,
    );
    assert.equal(JSON.stringify(remote), before, label);
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayBefore = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assert.equal(JSON.stringify(replayRemote), replayBefore);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
});

test('mid-apply durable failures stay blocked with artifacts and do not duplicate inserts on retry', () => {
  const base = baseSite();
  const local = baseSite();
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const partialRemote = baseSite();
  const partialFailure = captureError(() =>
    applyPlan(partialRemote, plan, {
      durableJournal,
      mutateRemote: true,
      failDuringCommitAtMutation: 1,
    }),
  );
  durableJournal.close();

  assert.ok(partialFailure instanceof PushPlanError);
  assertFailureRecoveryState(partialFailure.details.recovery, 'blocked-recovery');
  assert.equal(partialFailure.details.recovery.artifacts.remote.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(
    Object.keys(partialFailure.details.recovery.artifacts.remote.db.wp_posts).filter((key) => key === 'ID:2').length,
    1,
  );

  const retryJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const retry = applyPlan(partialRemote, plan, {
    durableJournal: retryJournal,
    journal: partialFailure.details.recovery.artifacts.journal,
    mutateRemote: true,
  });
  retryJournal.close();

  assertAcceptableRecoveryState(retry.recoveryState);
  assert.equal(retry.recoveryState.status, 'fully-updated-remote');
  assert.equal(retry.recoveryState.artifacts.remote, undefined);
  assert.equal(retry.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(retry.appliedMutations, 0);
  assert.equal(
    Object.keys(retry.site.db.wp_posts).filter((key) => key === 'ID:2').length,
    1,
  );
  assert.equal(partialRemote.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(partialRemote.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
});

test('durable journal write failure after the first mutation blocks recovery and preserves inspectable artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const remote = baseSite();
  const remoteBefore = JSON.stringify(remote);
  const failure = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal: failingDurableJournal('mutation-observed'),
      mutateRemote: true,
    }),
  );

  assert.ok(failure instanceof PushPlanError);
  assert.equal(failure.code, 'JOURNAL_WRITE_FAILED');
  assertFailureRecoveryState(failure.details.recovery, 'blocked-recovery');
  assert.ok(failure.details.recovery.artifacts.remote);
  assert.ok(failure.details.recovery.artifacts.journal);
  assert.notEqual(JSON.stringify(remote), remoteBefore, 'failure should leave behind the partial live mutation');

  const firstMutation = plan.mutations[0];
  if (firstMutation.resource.type === 'file') {
    assert.equal(failure.details.recovery.artifacts.remote.files[firstMutation.resource.path], '<?php echo "local";');
    assert.equal(remote.files[firstMutation.resource.path], '<?php echo "local";');
    assert.equal(
      Object.keys(failure.details.recovery.artifacts.remote.db.wp_posts).filter((key) => key === 'ID:2').length,
      0,
    );
  } else if (firstMutation.resource.type === 'row' && firstMutation.resource.table === 'wp_posts') {
    assert.equal(
      failure.details.recovery.artifacts.remote.db.wp_posts[firstMutation.resource.id].post_title,
      'Inserted locally',
    );
    assert.equal(remote.db.wp_posts[firstMutation.resource.id].post_title, 'Inserted locally');
    assert.equal(
      Object.keys(failure.details.recovery.artifacts.remote.db.wp_posts).filter((key) => key === 'ID:2').length,
      1,
    );
  }
  assert.equal(failure.details.recovery.artifacts.journal.status, 'blocked');
});

test('completed recovery replay stays inert on repeated retries and preserves the fully updated remote', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: durableJournal });
  durableJournal.close();

  const retryRemote = JSON.parse(JSON.stringify(completed.site));
  const retrySnapshot = JSON.stringify(retryRemote);
  const retryJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const firstRetry = applyPlan(retryRemote, plan, {
    durableJournal: retryJournal,
    journal: completed.journal,
  });
  const firstRetrySnapshot = JSON.stringify(retryRemote);
  const secondRetry = applyPlan(retryRemote, plan, {
    durableJournal: retryJournal,
    journal: firstRetry.journal,
  });
  retryJournal.close();

  assert.equal(JSON.stringify(retryRemote), retrySnapshot);
  assert.equal(JSON.stringify(retryRemote), firstRetrySnapshot);
  assert.equal(firstRetry.appliedMutations, 0);
  assert.equal(secondRetry.appliedMutations, 0);
  assertAcceptableRecoveryState(firstRetry.recoveryState);
  assertAcceptableRecoveryState(secondRetry.recoveryState);
  assert.equal(firstRetry.recoveryState.status, 'fully-updated-remote');
  assert.equal(secondRetry.recoveryState.status, 'fully-updated-remote');
  assert.equal(firstRetry.recoveryState.artifacts.remote, undefined);
  assert.equal(secondRetry.recoveryState.artifacts.remote, undefined);
  assert.equal(firstRetry.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(secondRetry.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(retryRemote.files['index.php'], '<?php echo "local";');
  assert.equal(retryRemote.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(retryRemote.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
});

test('staging the first mutation before commit keeps the remote old and replays from the staged journal without duplication', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const remote = baseSite();
  const before = JSON.stringify(remote);
  const failure = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal,
      failBeforeCommitAtMutation: 1,
    }),
  );
  durableJournal.close();

  assert.ok(failure instanceof PushPlanError);
  assertFailureRecoveryState(failure.details.recovery, 'old-remote');
  assert.equal(failure.details.recovery.artifacts.remote, undefined);
  assert.equal(failure.details.recovery.artifacts.journal.status, 'staging');
  assert.equal(failure.details.recovery.artifacts.journal.entries[0].status, 'staged');
  assert.equal(failure.details.recovery.artifacts.journal.entries[1].status, 'pending');
  assert.equal(JSON.stringify(remote), before);

  const retryJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const retry = applyPlan(baseSite(), plan, {
    durableJournal: retryJournal,
    journal: failure.details.recovery.artifacts.journal,
  });
  retryJournal.close();

  assertAcceptableRecoveryState(retry.recoveryState);
  assert.equal(retry.recoveryState.status, 'fully-updated-remote');
  assert.equal(retry.recoveryState.artifacts.remote, undefined);
  assert.equal(retry.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(retry.site.files['index.php'], '<?php echo "local";');
  assert.equal(retry.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(retry.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
});

test('completed replay blocks drifted remotes and keeps the durable recovery artifacts inspectable', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  durableJournal.close();

  const driftedRemote = JSON.parse(JSON.stringify(completed.site));
  driftedRemote.files['index.php'] = '<?php echo "drifted";';
  const before = JSON.stringify(driftedRemote);
  const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const blocked = captureError(() =>
    applyPlan(driftedRemote, plan, {
      durableJournal: replayJournal,
      journal: completed.journal,
    }),
  );
  replayJournal.close();

  assert.ok(blocked instanceof PushPlanError);
  assert.equal(blocked.code, 'RECOVERY_BLOCKED');
  assert.equal(JSON.stringify(driftedRemote), before);
  assertFailureRecoveryState(blocked.details.recovery, 'blocked-recovery');
  assert.equal(blocked.details.recovery.artifacts.remote.files['index.php'], '<?php echo "drifted";');
  assert.equal(blocked.details.recovery.artifacts.journal.status, 'completed');
  assert.equal(
    Object.keys(blocked.details.recovery.artifacts.remote.db.wp_posts).filter((key) => key === 'ID:2').length,
    1,
  );
});

test('replaying a completed plan through the durable journal stays inert and leaves no duplicate insert evidence', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  durableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(
    Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length,
    1,
  );
  assert.equal(persisted.integrity.status, 'ok');
  assert.equal(
    persisted.records.filter((record) => record.type === 'journal-replayed').length,
    1,
  );
  assert.equal(
    persisted.records.filter((record) => record.type === 'target-planned').length,
    plan.mutations.length,
  );
  assert.equal(
    persisted.records.some((record) => record.type === 'journal-completed'),
    true,
  );
});

test('durable recovery boundaries stay within the approved envelope across failure cuts and completed replay', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const remoteSnapshot = JSON.stringify(remote);

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );
    durableJournal.close();

    const persisted = readRecoveryJournal(journalPath);

    assert.ok(failure instanceof PushPlanError, label);
    assertFailureRecoveryState(failure.details.recovery, 'old-remote');
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(JSON.stringify(remote), remoteSnapshot, label);
    assert.equal(persisted.integrity.status, 'ok', label);
    assertAcceptableRecoveryState(failure.details.recovery);
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  const replayPersisted = readRecoveryJournal(completedJournalPath);

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(
    replayPersisted.records.filter((record) => record.type === 'journal-replayed').length,
    1,
  );
  assert.equal(
    replayPersisted.records.some((record) => record.type === 'recovery-state' && record.state === 'fully-updated-remote'),
    true,
  );
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
});

test('failure before mutation keeps the remote old, leaves an opened journal, and replays cleanly after recovery', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const remote = baseSite();
  const remoteBefore = JSON.stringify(remote);

  const failure = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal,
      failBeforeMutation: true,
    }),
  );
  durableJournal.close();

  assert.ok(failure instanceof PushPlanError);
  assert.equal(failure.code, 'INJECTED_FAILURE_BEFORE_MUTATION');
  assertFailureRecoveryState(failure.details.recovery, 'old-remote');
  assert.equal(failure.details.recovery.artifacts.remote, undefined);
  assert.equal(failure.details.recovery.artifacts.journal.status, 'opened');
  assert.equal(JSON.stringify(remote), remoteBefore);

  const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const replay = applyPlan(remote, plan, {
    durableJournal: replayJournal,
    journal: failure.details.recovery.artifacts.journal,
  });
  replayJournal.close();

  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.appliedMutations, plan.mutations.length);
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
  assert.equal(remote.files['index.php'], '<?php echo "base";');
  assert.equal(remote.db.wp_posts['ID:2'], undefined);
});

test('failure after dependency validation keeps the remote old and replays without duplicating inserts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const remote = baseSite();
  const remoteBefore = JSON.stringify(remote);

  const failure = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal,
      failAfterDependencyValidation: true,
    }),
  );
  durableJournal.close();

  assert.ok(failure instanceof PushPlanError);
  assert.equal(failure.code, 'INJECTED_FAILURE_AFTER_DEPENDENCY_VALIDATION');
  assertFailureRecoveryState(failure.details.recovery, 'old-remote');
  assert.equal(failure.details.recovery.artifacts.remote, undefined);
  assert.equal(failure.details.recovery.artifacts.journal.status, 'dependencies-validated');
  assert.equal(JSON.stringify(remote), remoteBefore);

  const retryJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const retry = applyPlan(baseSite(), plan, {
    durableJournal: retryJournal,
    journal: failure.details.recovery.artifacts.journal,
  });
  retryJournal.close();

  assertAcceptableRecoveryState(retry.recoveryState);
  assert.equal(retry.recoveryState.status, 'fully-updated-remote');
  assert.equal(retry.recoveryState.artifacts.remote, undefined);
  assert.equal(retry.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(retry.appliedMutations, plan.mutations.length);
  assert.equal(retry.site.files['index.php'], '<?php echo "local";');
  assert.equal(retry.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(retry.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
});

test('durable recovery blocks stale claims before mutation and preserves inspectable artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, {
    truncate: true,
    now: fixedNow,
    claimId: 'worker-a',
  });
  const remote = baseSite();
  const remoteSnapshot = JSON.stringify(remote);

  const failure = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal,
      mutateRemote: true,
      beforeMutation({ mutationIndex }) {
        assert.equal(mutationIndex, 1);
        const competingWriter = openRecoveryJournal(journalPath, {
          now: new Date(fixedNow.getTime() + 5000),
          claimId: 'worker-b',
        });
        appendStaleClaimAdvanced(competingWriter, {
          plan,
          current: remote,
          previousClaimId: 'worker-a',
          claimId: 'worker-b',
          staleThresholdMs: 1000,
          previousClaimAgeMs: 5000,
        });
        competingWriter.close();
      },
    }),
  );

  durableJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.ok(failure instanceof PushPlanError);
  assert.equal(failure.code, 'RECOVERY_CLAIM_STALE');
  assert.equal(failure.details.recovery.status, 'blocked-recovery');
  assert.equal(JSON.stringify(remote), remoteSnapshot);
  assert.equal(failure.details.recovery.artifacts.remote.files['index.php'], '<?php echo "base";');
  assert.equal(failure.details.recovery.artifacts.remote.db.wp_posts['ID:2'], undefined);
  assert.ok(failure.details.recovery.artifacts.journal);
  assert.equal(failure.details.recovery.artifacts.journal.status, 'blocked');
  assert.equal(
    persisted.records.some((record) => record.type === 'mutation-observed'),
    false,
  );
});

test('durable recovery artifacts keep the approved envelope inspectable across failure and replay boundaries', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const before = JSON.stringify(remote);

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );
    durableJournal.close();

    const persisted = readRecoveryJournal(journalPath);

    assert.ok(failure instanceof PushPlanError, label);
    assertFailureRecoveryState(failure.details.recovery, 'old-remote');
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(JSON.stringify(remote), before, label);
    assert.equal(persisted.integrity.status, 'ok', label);
    assert.equal(
      persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'old-remote'),
      true,
      label,
    );
    assert.equal(
      persisted.records.some((record) => record.type === 'journal-opened'),
      true,
      label,
    );
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  const replayPersisted = readRecoveryJournal(completedJournalPath);

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(
    replayPersisted.records.filter((record) => record.type === 'journal-replayed').length,
    1,
  );
  assert.equal(
    replayPersisted.records.some((record) => record.type === 'recovery-state' && record.state === 'fully-updated-remote'),
    true,
  );
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
});

test('durable recovery never escapes the approved post-failure states and blocked recovery always carries artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const remote = baseSite();
  const before = JSON.stringify(remote);

  const failure = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal,
      failAfterDependencyValidation: true,
    }),
  );
  durableJournal.close();

  assert.ok(failure instanceof PushPlanError);
  assertFailureRecoveryState(failure.details.recovery, 'old-remote');
  assert.equal(failure.details.recovery.artifacts.remote, undefined);
  assert.equal(failure.details.recovery.artifacts.journal.status, 'dependencies-validated');
  assert.equal(JSON.stringify(remote), before);

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');

  const driftedRemote = JSON.parse(JSON.stringify(completed.site));
  driftedRemote.files['index.php'] = '<?php echo "drifted";';
  const blockedJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const blocked = captureError(() =>
    applyPlan(driftedRemote, plan, {
      durableJournal: blockedJournal,
      journal: completed.journal,
    }),
  );
  blockedJournal.close();

  assert.ok(blocked instanceof PushPlanError);
  assert.equal(blocked.code, 'RECOVERY_BLOCKED');
  assertFailureRecoveryState(blocked.details.recovery, 'blocked-recovery');
  assert.ok(blocked.details.recovery.artifacts.remote);
  assert.ok(blocked.details.recovery.artifacts.journal);
  assert.equal(blocked.details.recovery.artifacts.journal.status, 'completed');
  assert.equal(blocked.details.recovery.artifacts.remote.files['index.php'], '<?php echo "drifted";');
});

test('durable recovery boundaries preserve the old remote until commit and replaying a completed plan stays inert', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const remoteBefore = JSON.stringify(remote);

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );
    durableJournal.close();

    const persisted = readRecoveryJournal(journalPath);

    assert.ok(failure instanceof PushPlanError, label);
    assertFailureRecoveryState(failure.details.recovery, 'old-remote');
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(JSON.stringify(remote), remoteBefore, label);
    assert.equal(persisted.integrity.status, 'ok', label);
    assert.equal(
      persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'old-remote'),
      true,
      label,
    );
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  const replayPersisted = readRecoveryJournal(completedJournalPath);

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
  assert.equal(
    replayPersisted.records.filter((record) => record.type === 'journal-replayed').length,
    1,
  );
  assert.equal(
    replayPersisted.records.filter((record) => record.type === 'journal-opened').length,
    1,
  );
  assert.equal(
    replayPersisted.records.filter((record) => record.type === 'target-planned').length,
    plan.mutations.length,
  );
  assert.equal(
    replayPersisted.records.some((record) => record.type === 'recovery-state' && record.state === 'fully-updated-remote'),
    true,
  );
});

test('durable recovery boundaries classify every failure cut point and completed replay without data loss', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const remoteSnapshot = JSON.stringify(remote);

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );
    durableJournal.close();

    const persisted = readRecoveryJournal(journalPath);

    assert.ok(failure instanceof PushPlanError, label);
    assertFailureRecoveryState(failure.details.recovery, 'old-remote');
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(JSON.stringify(remote), remoteSnapshot, label);
    assert.equal(persisted.integrity.status, 'ok', label);
    assert.equal(
      persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'old-remote'),
      true,
      label,
    );
    assertAcceptableRecoveryState(failure.details.recovery);
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  const replayPersisted = readRecoveryJournal(completedJournalPath);

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.appliedMutations, 0);
  assert.equal(
    Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length,
    1,
  );
  assert.equal(
    replayPersisted.records.filter((record) => record.type === 'journal-replayed').length,
    1,
  );
  assert.equal(
    replayPersisted.records.some((record) => record.type === 'recovery-state' && record.state === 'fully-updated-remote'),
    true,
  );
});

test('durable recovery accepts only old remote, fully updated remote, or blocked recovery states with artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const beforeMutationJournalPath = tempRecoveryJournalPath();
  const beforeMutationJournal = openRecoveryJournal(beforeMutationJournalPath, { truncate: true, now: fixedNow });
  const oldRemote = baseSite();
  const oldRemoteFailure = captureError(() =>
    applyPlan(oldRemote, plan, {
      durableJournal: beforeMutationJournal,
      failBeforeMutation: true,
    }),
  );
  beforeMutationJournal.close();

  assertFailureRecoveryState(oldRemoteFailure.details.recovery, 'old-remote');
  assert.equal(oldRemoteFailure.details.recovery.artifacts.remote, undefined);
  assert.equal(oldRemoteFailure.details.recovery.artifacts.journal.status, 'opened');
  assertAcceptableRecoveryState(oldRemoteFailure.details.recovery);

  const completedJournalPath = tempRecoveryJournalPath();
  const completedJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedJournal });
  completedJournal.close();

  assertAcceptableRecoveryState(completed.recoveryState);
  assert.equal(completed.recoveryState.status, 'fully-updated-remote');
  assert.equal(completed.recoveryState.artifacts.remote, undefined);
  assert.equal(completed.recoveryState.artifacts.journal.status, 'completed');

  const blockedJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const blockedRemote = JSON.parse(JSON.stringify(completed.site));
  blockedRemote.files['index.php'] = '<?php echo "drifted";';
  const blocked = captureError(() =>
    applyPlan(blockedRemote, plan, {
      durableJournal: blockedJournal,
      journal: completed.journal,
    }),
  );
  blockedJournal.close();

  assertFailureRecoveryState(blocked.details.recovery, 'blocked-recovery');
  assert.ok(blocked.details.recovery.artifacts.remote);
  assert.ok(blocked.details.recovery.artifacts.journal);
  assert.equal(blocked.details.recovery.artifacts.journal.status, 'completed');
  assert.equal(blocked.details.recovery.artifacts.remote.files['index.php'], '<?php echo "drifted";');
  assertAcceptableRecoveryState(blocked.details.recovery);
});

test('replaying a completed plan through the durable journal stays fully updated and records a single replay boundary', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  durableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(JSON.stringify(replayRemote), JSON.stringify(completed.site));
  assert.equal(
    persisted.records.filter((record) => record.type === 'journal-replayed').length,
    1,
  );
  assert.equal(
    persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'fully-updated-remote'),
    true,
  );
});

test('approved recovery states are limited to the durable old, updated, and blocked envelopes', () => {
  assert.equal(isAcceptableRecoveryState({
    status: 'old-remote',
    artifacts: { journal: { status: 'opened' } },
  }), true);
  assert.equal(isAcceptableRecoveryState({
    status: 'old-remote',
    artifacts: { journal: { status: 'opened' }, remote: { files: {} } },
  }), false);
  assert.equal(isAcceptableRecoveryState({
    status: 'fully-updated-remote',
    artifacts: { journal: { status: 'completed' } },
  }), true);
  assert.equal(isAcceptableRecoveryState({
    status: 'fully-updated-remote',
    artifacts: { journal: { status: 'completed' }, remote: { files: {} } },
  }), false);
  assert.equal(isAcceptableRecoveryState({
    status: 'blocked-recovery',
    artifacts: { journal: { status: 'blocked' }, remote: { files: {} } },
  }), true);
  assert.equal(isAcceptableRecoveryState({ status: 'unexpected' }), false);
  assert.equal(isAcceptableRecoveryState(null), false);
  assert.equal(isAcceptableRecoveryState({
    status: 'blocked-recovery',
    artifacts: { journal: { status: 'blocked' } },
  }), false);
});

test('non-blocked recovery artifacts fail closed when a remote artifact leaks into the envelope', () => {
  assert.throws(
    () => validateRecoveryArtifacts({
      status: 'old-remote',
      planId: 'plan-1',
      artifacts: {
        journal: { status: 'opened' },
        remote: { files: {} },
      },
    }),
    /must not expose remote artifacts/,
  );
});

test('durable recovery stays within the approved old-remote, fully-updated-remote, or blocked-recovery envelopes', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['failure before mutation', { failBeforeMutation: true }, 'opened'],
    ['failure after staging', { failAfterStaging: true }, 'staged'],
    ['failure after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const remoteSnapshot = JSON.stringify(remote);

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );
    durableJournal.close();

    assert.ok(failure instanceof PushPlanError, label);
    assertFailureRecoveryState(failure.details.recovery, 'old-remote', label);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(JSON.stringify(remote), remoteSnapshot, label);
    assert.equal(readRecoveryJournal(journalPath).integrity.status, 'ok', label);
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedJournal });
  completedJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  const persisted = readRecoveryJournal(completedJournalPath);

  assertAcceptableRecoveryState(completed.recoveryState);
  assert.equal(completed.recoveryState.status, 'fully-updated-remote');
  assert.equal(completed.recoveryState.artifacts.remote, undefined);
  assert.equal(completed.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(completed.appliedMutations, plan.mutations.length);
  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.appliedMutations, 0);
  assert.equal(JSON.stringify(replay.site), JSON.stringify(completed.site));
  assert.equal(
    persisted.records.filter((record) => record.type === 'journal-replayed').length,
    1,
  );
  assert.equal(
    persisted.records.filter((record) => record.type === 'recovery-state' && record.state === 'fully-updated-remote').length,
    2,
  );
  assert.equal(persisted.integrity.status, 'ok');
});

test('durable recovery keeps the approved failure envelope and retries do not duplicate inserts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const remoteSnapshot = JSON.stringify(remote);

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );
    durableJournal.close();

    assert.ok(failure instanceof PushPlanError, label);
    assertFailureRecoveryState(failure.details.recovery, 'old-remote');
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(JSON.stringify(remote), remoteSnapshot, label);
    assertAcceptableRecoveryState(failure.details.recovery);

    const retryJournal = openRecoveryJournal(journalPath, { now: fixedNow });
    const retry = applyPlan(baseSite(), plan, {
      durableJournal: retryJournal,
      journal: failure.details.recovery.artifacts.journal,
    });
    retryJournal.close();

    assertAcceptableRecoveryState(retry.recoveryState);
    assert.equal(retry.recoveryState.status, 'fully-updated-remote');
    assert.equal(retry.recoveryState.artifacts.remote, undefined);
    assert.equal(retry.recoveryState.artifacts.journal.status, 'completed');
    assert.equal(retry.appliedMutations, plan.mutations.length);
    assert.equal(retry.site.files['index.php'], '<?php echo "local";');
    assert.equal(retry.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
    assert.equal(Object.keys(retry.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
  }
});

test('durable recovery inspect blocks live drift after a completed replay and keeps the persisted journal readable', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  durableJournal.close();

  const drifted = JSON.parse(JSON.stringify(completed.site));
  drifted.files['index.php'] = '<?php echo "drifted";';
  const inspection = inspectRecoveryJournal({
    journalPath,
    plan,
    current: drifted,
  });

  const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const blocked = captureError(() =>
    applyPlan(drifted, plan, {
      durableJournal: replayJournal,
      journal: completed.journal,
    }),
  );
  replayJournal.close();

  assert.equal(inspection.status, 'blocked-recovery');
  assert.ok(inspection.reason.includes('partially updated') || inspection.reason.includes('cannot be classified'));
  assert.equal(inspection.journal.integrity.status, 'ok');
  assert.equal(inspection.claim.status, 'none');
  assert.equal(inspection.targets.some((target) => target.state === 'new'), true);
  assert.equal(inspection.targets.some((target) => target.state === 'blocked-unknown'), true);

  assertFailureRecoveryState(blocked.details.recovery, 'blocked-recovery');
  assert.ok(blocked.details.recovery.artifacts.remote);
  assert.ok(blocked.details.recovery.artifacts.journal);
  assert.equal(blocked.details.recovery.artifacts.remote.files['index.php'], '<?php echo "drifted";');
  assert.equal(blocked.details.recovery.artifacts.journal.status, 'completed');
  assert.equal(
    readRecoveryJournal(journalPath).integrity.status,
    'ok',
  );
});

test('the durable recovery boundary remains fail-closed until the release gate wires durable journal storage, replay, and recovery inspect into the release path', () => {
  const packageJson = JSON.parse(
    execFileSync('git', ['show', 'origin/lane/reliable-executor:package.json'], { encoding: 'utf8' }),
  );
  assert.equal(Object.hasOwn(packageJson.scripts, 'verify:release'), true);
  assert.equal(
    packageJson.scripts['verify:release'],
    'npm run test:playground:production-shaped-topology-proof && npm run test:playground:production-shaped-release-verify && npm run test:recovery:file-journal',
    'release verification exists upstream, but it still does not prove durable journal storage, recovery inspection, or release-path replay wiring',
  );
  assert.equal(
    packageJson.scripts['test:recovery:file-journal'],
    'node ./scripts/recovery/file-journal-restart-smoke.mjs',
    'file-backed recovery journal restart smoke remains the executable durability proof currently available in this repo',
  );
  assert.equal(
    packageJson.scripts['verify:release'].includes('production-shaped-live-protocol-proof'),
    false,
    'the release gate still does not prove the live protocol path that carries durable journal storage, replay, and recovery-inspect semantics',
  );
  assert.equal(
    packageJson.scripts['verify:release'].includes('production-shaped-live-preflight'),
    false,
    'the release gate still does not wire the durable recovery inspect proof into the release preflight path',
  );
  assert.equal(
    packageJson.scripts['verify:release'].includes('db-journal-process-kill'),
    false,
    'the release gate still does not prove crash durability at the DB journal boundary',
  );
  assert.equal(
    packageJson.scripts['verify:release'].includes('db-journal-stale-claim-all-old'),
    false,
    'the release gate still does not prove lease ownership or fencing against stale recovery claims',
  );
  assert.equal(
    packageJson.scripts['verify:release'].includes('recovery:file-journal'),
    true,
    'the release gate still only proves restart smoke, not durable recovery inspect, durable storage, or replay classification',
  );
  assert.equal(
    packageJson.scripts['verify:release'].includes('recovery-inspect'),
    false,
    'the release gate still does not execute an inspect-first recovery proof at the release command boundary',
  );

  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  durableJournal.close();

  const drifted = JSON.parse(JSON.stringify(completed.site));
  drifted.files['index.php'] = '<?php echo "drifted";';

  const inspection = inspectRecoveryJournal({
    journalPath,
    plan,
    current: drifted,
  });

  const blockedJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const blocked = captureError(() =>
    applyPlan(drifted, plan, {
      durableJournal: blockedJournal,
      journal: completed.journal,
    }),
  );
  blockedJournal.close();
  const blockedPersisted = readRecoveryJournal(journalPath);

  assert.equal(inspection.status, 'blocked-recovery');
  assert.equal(inspection.journal.integrity.status, 'ok');
  assert.equal(inspection.claim.status, 'none');
  assert.ok(inspection.reason.includes('partially updated') || inspection.reason.includes('cannot be classified'));
  assert.ok(blocked instanceof PushPlanError);
  assert.equal(blocked.details.recovery.status, 'blocked-recovery');
  assert.ok(blocked.details.recovery.artifacts.journal);
  assert.ok(blocked.details.recovery.artifacts.remote);
  assert.equal(blocked.details.recovery.artifacts.remote.files['index.php'], '<?php echo "drifted";');
  assert.equal(
    blockedPersisted.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
    true,
  );
  assert.equal(
    blockedPersisted.records.some((record) => record.type === 'journal-replayed'),
    false,
  );
});

test('durable recovery only allows old remote, fully updated remote, or blocked recovery with artifacts across the failure and replay boundary', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedStatus, expectedJournalStatus] of [
    ['failure before mutation', { failBeforeMutation: true }, 'old-remote', 'opened'],
    ['failure after staging', { failAfterStaging: true }, 'old-remote', 'staged'],
    ['failure after dependency validation', { failAfterDependencyValidation: true }, 'old-remote', 'dependencies-validated'],
  ]) {
    const remote = baseSite();
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );
    durableJournal.close();

    assert.ok(failure instanceof PushPlanError, label);
    assertFailureRecoveryState(failure.details.recovery, expectedStatus, label);
    assertAcceptableRecoveryState(failure.details.recovery);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(JSON.stringify(remote), JSON.stringify(baseSite()), label);
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedJournal });
  completedJournal.close();

  assertAcceptableRecoveryState(completed.recoveryState);
  assert.equal(completed.recoveryState.status, 'fully-updated-remote');
  assert.equal(completed.recoveryState.artifacts.remote, undefined);
  assert.equal(completed.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(completed.appliedMutations, plan.mutations.length);
  assert.equal(completed.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');

  const drifted = JSON.parse(JSON.stringify(completed.site));
  drifted.files['index.php'] = '<?php echo "drifted";';

  const inspection = inspectRecoveryJournal({
    journal: readRecoveryJournal(completedJournalPath),
    plan,
    current: drifted,
  });
  const blockedJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const blocked = captureError(() =>
    applyPlan(drifted, plan, {
      durableJournal: blockedJournal,
      journal: completed.journal,
    }),
  );
  blockedJournal.close();

  assert.equal(inspection.status, 'blocked-recovery');
  assert.ok(inspection.reason.includes('partially updated') || inspection.reason.includes('cannot be classified'));
  assert.ok(blocked instanceof PushPlanError);
  assertFailureRecoveryState(blocked.details.recovery, 'blocked-recovery');
  assertAcceptableRecoveryState(blocked.details.recovery);
  assert.ok(blocked.details.recovery.artifacts.remote);
  assert.ok(blocked.details.recovery.artifacts.journal);
});

test('durable recovery keeps the approved states across pre-mutation failure, staged failure, validation failure, and completed replay retry', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options] of [
    ['failure before mutation', { failBeforeMutation: true }],
    ['failure after staging', { failAfterStaging: true }],
    ['failure after dependency validation', { failAfterDependencyValidation: true }],
  ]) {
    const remote = baseSite();
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );
    durableJournal.close();

    assert.ok(failure instanceof PushPlanError, label);
    assertAcceptableRecoveryState(failure.details.recovery);
    assert.equal(failure.details.recovery.status, 'old-remote', label);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(JSON.stringify(remote), JSON.stringify(baseSite()), label);
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedJournal });
  completedJournal.close();

  assertAcceptableRecoveryState(completed.recoveryState);
  assert.equal(completed.recoveryState.status, 'fully-updated-remote');
  assert.equal(completed.recoveryState.artifacts.remote, undefined);
  assert.equal(completed.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(completed.appliedMutations, plan.mutations.length);

  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(completed.site, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(JSON.stringify(replay.site), JSON.stringify(completed.site));
});

test('durable recovery keeps failure-before-mutation, failure-after-staging, failure-after-validation, and completed replay inside the approved envelope', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const scenarios = [
    ['before mutation', { failBeforeMutation: true }, 'old-remote', 'opened'],
    ['after staging', { failAfterStaging: true }, 'old-remote', 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'old-remote', 'dependencies-validated'],
  ];

  for (const [label, options, expectedState, expectedJournalStatus] of scenarios) {
    const remote = JSON.parse(JSON.stringify(base));
    const result = captureError(() => applyPlan(remote, plan, options));

    assert.ok(result instanceof PushPlanError, label);
    assert.equal(result.details.recovery.status, expectedState, label);
    assertAcceptableRecoveryState(result.details.recovery);
    assert.equal(result.details.recovery.artifacts.remote, undefined, label);
    assert.ok(result.details.recovery.artifacts.journal, label);
    assert.equal(result.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
  }

  const completed = applyPlan(JSON.parse(JSON.stringify(base)), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.keys(replay.site.db.wp_posts).filter((key) => key === 'ID:2').length, 1);
});

test('durable recovery keeps the accepted post-failure states and replaying a completed plan inert with durable journal artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options] of [
    ['failure before mutation', { failBeforeMutation: true }],
    ['failure after staging', { failAfterStaging: true }],
    ['failure after dependency validation', { failAfterDependencyValidation: true }],
  ]) {
    const remote = baseSite();
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );
    durableJournal.close();

    assert.ok(failure instanceof PushPlanError, label);
    assertFailureRecoveryState(failure.details.recovery, 'old-remote', label);
    assertAcceptableRecoveryState(failure.details.recovery);
    assert.equal(JSON.stringify(remote), JSON.stringify(baseSite()), label);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(readRecoveryJournal(journalPath).integrity.status, 'ok', label);
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedJournal });
  completedJournal.close();

  assertAcceptableRecoveryState(completed.recoveryState);
  assert.equal(completed.recoveryState.status, 'fully-updated-remote');
  assert.equal(completed.recoveryState.artifacts.remote, undefined);
  assert.equal(completed.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(completed.appliedMutations, plan.mutations.length);
  assert.equal(completed.site.files['index.php'], '<?php echo "local";');
  assert.equal(completed.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');

  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(completed.site, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.appliedMutations, 0);
  assert.equal(JSON.stringify(replay.site), JSON.stringify(completed.site));
  assert.equal(
    readRecoveryJournal(completedJournalPath).records.filter((record) => record.type === 'journal-replayed').length,
    1,
  );
});

test('accepted recovery-state shapes stay limited to old remote, fully updated remote, and blocked recovery with artifacts', () => {
  assert.equal(
    isAcceptableRecoveryState({
      status: 'old-remote',
      artifacts: {
        journal: { status: 'opened' },
      },
    }),
    true,
  );
  assert.equal(
    isAcceptableRecoveryState({
      status: 'fully-updated-remote',
      artifacts: {
        journal: { status: 'completed' },
      },
    }),
    true,
  );
  assert.equal(
    isAcceptableRecoveryState({
      status: 'blocked-recovery',
      artifacts: {
        journal: { status: 'blocked' },
        remote: { files: {} },
      },
    }),
    true,
  );
  assert.equal(
    isAcceptableRecoveryState({
      status: 'blocked-recovery',
      artifacts: {
        journal: { status: 'blocked' },
      },
    }),
    false,
  );
  assert.equal(
    isAcceptableRecoveryState({
      status: 'old-remote',
      artifacts: {
        journal: { status: 'opened' },
        remote: { files: {} },
      },
    }),
    false,
  );

  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  durableJournal.close();

  const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(JSON.stringify(replay.site), JSON.stringify(completed.site));
});

test('durable recovery writes the recovery-state boundary before journal-replayed for a completed plan and keeps pre-mutation failures old-remote', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['failure before mutation', { failBeforeMutation: true }, 'opened'],
    ['failure after staging', { failAfterStaging: true }, 'staged'],
    ['failure after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );
    durableJournal.close();

    const persisted = readRecoveryJournal(journalPath);

    assert.ok(failure instanceof PushPlanError, label);
    assertFailureRecoveryState(failure.details.recovery, 'old-remote', label);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(persisted.records[0].type, 'journal-opened', label);
    assert.equal(persisted.records[persisted.records.length - 1].type, 'recovery-state', label);
    assert.equal(persisted.records[persisted.records.length - 1].state, 'old-remote', label);
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedJournal });
  completedJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  const replayPersisted = readRecoveryJournal(completedJournalPath);
  const replayTypes = replayPersisted.records.map((record) => record.type);

  assert.equal(replay.appliedMutations, 0);
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replayTypes.includes('journal-opened'), true);
  assert.equal(replayTypes.includes('recovery-state'), true);
  assert.equal(replayTypes.includes('journal-replayed'), true);
  assert.ok(
    replayTypes.indexOf('recovery-state') < replayTypes.indexOf('journal-replayed'),
    'completed replay must record recovery-state before journal-replayed',
  );
  assert.equal(JSON.stringify(replayRemote), JSON.stringify(completed.site));
});

test('atomic apply recovery keeps failure envelopes old-remote and a completed replay fully-updated', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const failureScenarios = [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ];

  for (const [label, options, expectedJournalStatus] of failureScenarios) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );
    durableJournal.close();

    assert.ok(failure instanceof PushPlanError, label);
    assertFailureRecoveryState(failure.details.recovery, 'old-remote', label);
    assertAcceptableRecoveryState(failure.details.recovery);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(JSON.stringify(remote), JSON.stringify(baseSite()), label);
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedJournal });
  completedJournal.close();

  assertAcceptableRecoveryState(completed.recoveryState);
  assert.equal(completed.recoveryState.status, 'fully-updated-remote');
  assert.equal(completed.recoveryState.artifacts.remote, undefined);
  assert.equal(completed.recoveryState.artifacts.journal.status, 'completed');

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.appliedMutations, 0);
  assert.equal(JSON.stringify(replay.site), JSON.stringify(completed.site));
});

test('replaying a completed plan stays fully updated and does not duplicate durable replay records', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  durableJournal.close();

  const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const firstReplay = applyPlan(completed.site, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  const secondReplay = applyPlan(firstReplay.site, plan, {
    durableJournal: replayJournal,
    journal: firstReplay.journal,
  });
  replayJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assertAcceptableRecoveryState(firstReplay.recoveryState);
  assert.equal(firstReplay.recoveryState.status, 'fully-updated-remote');
  assert.equal(firstReplay.appliedMutations, 0);
  assert.equal(JSON.stringify(firstReplay.site), JSON.stringify(completed.site));
  assertAcceptableRecoveryState(secondReplay.recoveryState);
  assert.equal(secondReplay.recoveryState.status, 'fully-updated-remote');
  assert.equal(secondReplay.appliedMutations, 0);
  assert.equal(JSON.stringify(secondReplay.site), JSON.stringify(completed.site));
  assert.equal(
    persisted.records.filter((record) => record.type === 'journal-replayed').length,
    2,
    'each completed replay should record one durable replay boundary',
  );
  assert.equal(
    persisted.records.filter((record) => record.type === 'recovery-state' && record.state === 'fully-updated-remote').length,
    3,
    'the initial completion plus each completed replay should record a durable recovery-state boundary',
  );
});

test('inspect-first replay on a drifted completed plan stays blocked with durable artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  durableJournal.close();

  const drifted = JSON.parse(JSON.stringify(completed.site));
  drifted.files['index.php'] = '<?php echo "stale drift";';

  const inspection = inspectRecoveryJournal({
    journal: readRecoveryJournal(journalPath),
    plan,
    current: drifted,
  });
  const blockedJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const blocked = captureError(() =>
    applyPlan(drifted, plan, {
      durableJournal: blockedJournal,
      journal: completed.journal,
    }),
  );
  blockedJournal.close();

  assert.equal(inspection.status, 'blocked-recovery');
  assert.equal(inspection.claim.status, 'none');
  assert.ok(inspection.reason.includes('partially updated') || inspection.reason.includes('cannot be classified'));
  assert.ok(blocked instanceof PushPlanError);
  assert.equal(blocked.details.recovery.status, 'blocked-recovery');
  assert.ok(blocked.details.recovery.artifacts.remote);
  assert.ok(blocked.details.recovery.artifacts.journal);
  assert.equal(blocked.details.recovery.artifacts.remote.files['index.php'], '<?php echo "stale drift";');
  assert.equal(blocked.details.recovery.artifacts.journal.status, 'completed');
  assert.equal(readRecoveryJournal(journalPath).integrity.status, 'ok');
});

test('durable recovery accepts only old remote, fully updated remote, or blocked recovery with artifacts across the apply and replay boundary', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const failureScenarios = [
    ['failure before mutation', { failBeforeMutation: true }],
    ['failure after staging', { failAfterStaging: true }],
    ['failure after dependency validation', { failAfterDependencyValidation: true }],
  ];

  for (const [name, options] of failureScenarios) {
    const remote = baseSite();
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );
    durableJournal.close();

    assert.ok(failure instanceof PushPlanError, name);
    assertFailureRecoveryState(failure.details.recovery, 'old-remote', name);
    assertAcceptableRecoveryState(failure.details.recovery);
    assert.equal(JSON.stringify(remote), JSON.stringify(baseSite()), name);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, name);
    assert.ok(failure.details.recovery.artifacts.journal, name);
    assert.equal(
      readRecoveryJournal(journalPath).integrity.status,
      'ok',
      `${name} should leave a readable durable journal`,
    );
  }

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  durableJournal.close();

  assertAcceptableRecoveryState(completed.recoveryState);
  assert.equal(completed.recoveryState.status, 'fully-updated-remote');
  assert.equal(completed.recoveryState.artifacts.remote, undefined);
  assert.equal(completed.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(completed.appliedMutations, plan.mutations.length);
  assert.equal(completed.site.files['index.php'], '<?php echo "local";');
  assert.equal(completed.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');

  const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const replay = applyPlan(completed.site, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(Object.hasOwn(replay.site.db.wp_posts, 'ID:2'), true);
  assert.equal(
    readRecoveryJournal(journalPath).records.filter((record) => record.type === 'journal-replayed').length,
    1,
  );
});

test('completed replay remains fully updated and refuses to resurrect stale local data', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  durableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(readRecoveryJournal(journalPath).integrity.status, 'ok');
});

test('acceptable recovery states keep remote artifacts confined to blocked recovery', () => {
  assert.equal(
    isAcceptableRecoveryState({
      status: 'old-remote',
      artifacts: {
        journal: { status: 'opened' },
      },
    }),
    true,
  );
  assert.equal(
    isAcceptableRecoveryState({
      status: 'fully-updated-remote',
      artifacts: {
        journal: { status: 'completed' },
      },
    }),
    true,
  );
  assert.equal(
    isAcceptableRecoveryState({
      status: 'old-remote',
      artifacts: {
        journal: { status: 'opened' },
        remote: { files: {} },
      },
    }),
    false,
  );
  assert.equal(
    isAcceptableRecoveryState({
      status: 'blocked-recovery',
      artifacts: {
        journal: { status: 'blocked' },
        remote: { files: {} },
      },
    }),
    true,
  );
});

test('acceptable recovery states are limited to old remote, fully updated remote, or blocked recovery with artifacts', () => {
  assert.equal(
    isAcceptableRecoveryState({
      status: 'old-remote',
      artifacts: {
        journal: { status: 'opened' },
      },
    }),
    true,
  );
  assert.equal(
    isAcceptableRecoveryState({
      status: 'fully-updated-remote',
      artifacts: {
        journal: { status: 'completed' },
      },
    }),
    true,
  );
  assert.equal(
    isAcceptableRecoveryState({
      status: 'blocked-recovery',
      artifacts: {
        journal: { status: 'completed' },
        remote: baseSite(),
      },
    }),
    true,
  );
  assert.equal(
    isAcceptableRecoveryState({
      status: 'blocked-recovery',
      artifacts: {
        journal: { status: 'completed' },
      },
    }),
    false,
  );
  assert.equal(
    isAcceptableRecoveryState({
      status: 'unexpected',
      artifacts: {
        journal: { status: 'completed' },
      },
    }),
    false,
  );
});

test('blocked recovery must keep both journal and remote artifacts while non-blocked states stay artifact-bounded', () => {
  assert.equal(
    isAcceptableRecoveryState({
      status: 'blocked-recovery',
      artifacts: {
        journal: { status: 'completed' },
      },
    }),
    false,
  );
  assert.equal(
    isAcceptableRecoveryState({
      status: 'blocked-recovery',
      artifacts: {
        remote: baseSite(),
      },
    }),
    false,
  );
  assert.equal(
    isAcceptableRecoveryState({
      status: 'blocked-recovery',
      artifacts: {
        journal: { status: 'completed' },
        remote: baseSite(),
      },
    }),
    true,
  );
  assert.equal(
    isAcceptableRecoveryState({
      status: 'fully-updated-remote',
      artifacts: {
        journal: { status: 'completed' },
        remote: baseSite(),
      },
    }),
    false,
  );
});

test('failure before mutation keeps the old remote and leaves inspectable journal artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  const plan = planFor(base, local, baseSite());
  const remote = baseSite();
  const snapshot = JSON.stringify(remote);

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const failure = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal,
      failBeforeMutation: true,
    }),
  );
  durableJournal.close();

  assert.ok(failure instanceof PushPlanError);
  assert.equal(failure.details.recovery.status, 'old-remote');
  assert.equal(failure.details.recovery.artifacts.remote, undefined);
  assert.equal(failure.details.recovery.artifacts.journal.status, 'opened');
  assert.equal(JSON.stringify(remote), snapshot);
});

test('failure after staging keeps the old remote and preserves staged journal evidence', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const remote = baseSite();
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const failure = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal,
      failAfterStaging: true,
    }),
  );
  durableJournal.close();

  assert.ok(failure instanceof PushPlanError);
  assert.equal(failure.details.recovery.status, 'old-remote');
  assert.equal(failure.details.recovery.artifacts.remote, undefined);
  assert.equal(failure.details.recovery.artifacts.journal.status, 'staged');
  assert.equal(remote.files['index.php'], base.files['index.php']);
  assert.equal(remote.db.wp_posts['ID:2'], undefined);
});

test('failure after dependency validation keeps the old remote and retains validation-state journal artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const remote = baseSite();
  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const failure = captureError(() =>
    applyPlan(remote, plan, {
      durableJournal,
      failAfterDependencyValidation: true,
    }),
  );
  durableJournal.close();

  assert.ok(failure instanceof PushPlanError);
  assert.equal(failure.details.recovery.status, 'old-remote');
  assert.equal(failure.details.recovery.artifacts.remote, undefined);
  assert.equal(failure.details.recovery.artifacts.journal.status, 'dependencies-validated');
  assert.equal(remote.files['index.php'], base.files['index.php']);
  assert.equal(remote.db.wp_posts['ID:2'], undefined);
});

test('atomic apply keeps the approved old-remote failure cuts and completed replay envelope inspectable', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const remoteSnapshot = JSON.stringify(remote);

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );
    durableJournal.close();

    const persisted = readRecoveryJournal(journalPath);

    assert.ok(failure instanceof PushPlanError, label);
    assertAcceptableRecoveryState(failure.details.recovery);
    assert.equal(failure.details.recovery.status, 'old-remote', label);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(JSON.stringify(remote), remoteSnapshot, label);
    assert.equal(
      persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
      false,
      label,
    );
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedWriter = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedWriter });
  completedWriter.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayWriter = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayWriter,
    journal: completed.journal,
  });
  replayWriter.close();

  const persistedReplay = readRecoveryJournal(completedJournalPath);

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.appliedMutations, 0);
  assert.equal(
    persistedReplay.records.filter((record) => record.type === 'journal-replayed').length,
    1,
  );
  assert.equal(
    persistedReplay.records.some((record) => record.type === 'recovery-state' && record.state === 'fully-updated-remote'),
    true,
  );
});

test('replaying a completed plan stays fully updated and does not resurrect stale local data', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  durableJournal.close();

  const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const replay = applyPlan(completed.site, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  const persisted = readRecoveryJournal(journalPath);
  const inspection = inspectRecoveryJournal({ journal: persisted, plan, current: completed.site });
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.appliedMutations, 0);
  assert.equal(replay.site.files['index.php'], '<?php echo "local";');
  assert.equal(replay.site.db.wp_posts['ID:2'].post_title, 'Inserted locally');
  assert.equal(inspection.status, 'fully-updated-remote');
  assert.deepEqual(inspection.counts, { old: 0, new: 2, blockedUnknown: 0 });
  assert.equal(inspection.journal.records.some((record) => record.type === 'journal-replayed'), true);
  assert.equal(persisted.records.filter((record) => record.type === 'journal-replayed').length, 1);
  assert.equal(
    persisted.records.filter((record) => record.type === 'recovery-state' && record.state === 'fully-updated-remote').length,
    2,
  );
  assert.equal(persisted.records.filter((record) => record.type === 'journal-completed').length, 1);
});

test('completed replay fails closed when the durable journal cannot append replay recovery state', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const completed = applyPlan(baseSite(), plan);
  const replayJournal = failingDurableJournal('journal-replayed');
  const replayError = captureError(() =>
    applyPlan(JSON.parse(JSON.stringify(completed.site)), plan, {
      durableJournal: replayJournal,
      journal: completed.journal,
    }),
  );

  assert.ok(replayError instanceof PushPlanError);
  assert.equal(replayError.code, 'JOURNAL_WRITE_FAILED');
  assert.equal(replayError.details.boundary, 'journal-replayed');
  assert.equal(replayError.details.recovery.status, 'fully-updated-remote');
  assert.equal(replayError.details.recovery.artifacts.remote, undefined);
  assert.equal(replayError.details.recovery.artifacts.journal.status, 'completed');
  assert.equal(replayJournal.events.filter((event) => event.type === 'recovery-state').length, 1);
  assert.equal(replayJournal.events.some((event) => event.type === 'journal-replayed'), false);
});

test('durable recovery replay stays inert while preserving the approved post-failure envelope', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const remote = baseSite();
    const failure = captureError(() => applyPlan(remote, plan, options));

    assert.ok(failure instanceof PushPlanError, label);
    assertFailureRecoveryState(failure.details.recovery, 'old-remote');
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(failure.details.recovery.artifacts.journal.planId, plan.id, label);
  }

  const completed = applyPlan(baseSite(), plan);
  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replay = applyPlan(replayRemote, plan, { journal: completed.journal });

  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.appliedMutations, 0);
  assert.equal(JSON.stringify(replayRemote), JSON.stringify(completed.site));
});

test('durable recovery only allows old remote, fully updated remote, or blocked recovery with artifacts across failure cuts and completed replay', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedState, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'old-remote', 'opened'],
    ['after staging', { failAfterStaging: true }, 'old-remote', 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'old-remote', 'dependencies-validated'],
  ]) {
    const remote = baseSite();
    const remoteSnapshot = JSON.stringify(remote);
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );
    durableJournal.close();

    assert.ok(failure instanceof PushPlanError, label);
    assertFailureRecoveryState(failure.details.recovery, expectedState, label);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(JSON.stringify(remote), remoteSnapshot, label);
    assert.equal(readRecoveryJournal(journalPath).integrity.status, 'ok', label);
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  assertAcceptableRecoveryState(completed.recoveryState);
  assert.equal(completed.recoveryState.status, 'fully-updated-remote');
  assert.equal(completed.recoveryState.artifacts.remote, undefined);
  assert.equal(completed.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(completed.appliedMutations, plan.mutations.length);

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  const persisted = readRecoveryJournal(completedJournalPath);

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.appliedMutations, 0);
  assert.equal(
    persisted.records.filter((record) => record.type === 'journal-replayed').length,
    1,
  );
  assert.equal(
    persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'fully-updated-remote'),
    true,
  );
  assert.equal(
    persisted.records[persisted.records.length - 2].type,
    'recovery-state',
  );
  assert.equal(
    persisted.records[persisted.records.length - 1].type,
    'journal-replayed',
  );
  assert.equal(persisted.integrity.status, 'ok');
});

test('durable recovery keeps the failure-before-mutation, failure-after-staging, failure-after-validation, and completed replay envelope inspectable', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedStatus, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'old-remote', 'opened'],
    ['after staging', { failAfterStaging: true }, 'old-remote', 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'old-remote', 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const remoteSnapshot = JSON.stringify(remote);
    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );
    durableJournal.close();

    assert.ok(failure instanceof PushPlanError, label);
    assertFailureRecoveryState(failure.details.recovery, expectedStatus, label);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(JSON.stringify(remote), remoteSnapshot, label);
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  const persisted = readRecoveryJournal(completedJournalPath);

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.appliedMutations, 0);
  assert.equal(persisted.records[persisted.records.length - 2].type, 'recovery-state');
  assert.equal(persisted.records[persisted.records.length - 1].type, 'journal-replayed');
  assert.equal(persisted.integrity.status, 'ok');
});

test('durable recovery replay writes the recovery-state boundary before journal-replayed and leaves interruption cuts old-remote', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );
    durableJournal.close();

    assert.ok(failure instanceof PushPlanError, label);
    assert.equal(failure.details.recovery.status, 'old-remote', label);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(readRecoveryJournal(journalPath).integrity.status, 'ok', label);
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  const persisted = readRecoveryJournal(completedJournalPath);

  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.appliedMutations, 0);
  assert.equal(JSON.stringify(replayRemote), JSON.stringify(completed.site));
  assert.equal(persisted.records[persisted.records.length - 2].type, 'recovery-state');
  assert.equal(persisted.records[persisted.records.length - 2].state, 'fully-updated-remote');
  assert.equal(persisted.records[persisted.records.length - 1].type, 'journal-replayed');
  assert.equal(persisted.records[persisted.records.length - 1].state, 'fully-updated-remote');
});

test('durable replay drift closes into blocked recovery with inspectable artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  const journalPath = tempRecoveryJournalPath();
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal });
  durableJournal.close();

  const driftedRemote = JSON.parse(JSON.stringify(completed.site));
  driftedRemote.files['index.php'] = '<?php echo "drifted";';

  const replayJournal = openRecoveryJournal(journalPath, { now: fixedNow });
  const replayError = captureError(() =>
    applyPlan(driftedRemote, plan, {
      durableJournal: replayJournal,
      journal: completed.journal,
    }),
  );
  replayJournal.close();

  const persisted = readRecoveryJournal(journalPath);

  assert.ok(replayError instanceof PushPlanError);
  assert.equal(replayError.details.recovery.status, 'blocked-recovery');
  assert.ok(replayError.details.recovery.artifacts.journal);
  assert.ok(replayError.details.recovery.artifacts.remote);
  assert.equal(replayError.details.recovery.artifacts.journal.status, 'completed');
  assert.equal(persisted.records[persisted.records.length - 1].state, 'blocked-recovery');
  assert.equal(persisted.records[persisted.records.length - 1].type, 'recovery-state');
  assert.equal(persisted.integrity.status, 'ok');
});

test('atomic apply keeps only the approved recovery states across the failure cuts and completed replay boundary', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const remoteSnapshot = JSON.stringify(remote);

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );
    durableJournal.close();

    const persisted = readRecoveryJournal(journalPath);

    assert.ok(failure instanceof PushPlanError, label);
    assertFailureRecoveryState(failure.details.recovery, 'old-remote', label);
    assertAcceptableRecoveryState(failure.details.recovery);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(JSON.stringify(remote), remoteSnapshot, label);
    assert.equal(persisted.records[persisted.records.length - 1].type, 'recovery-state', label);
    assert.equal(persisted.records[persisted.records.length - 1].state, 'old-remote', label);
    if (label === 'before mutation') {
      assertJournalTailTypes(persisted.records, ['target-planned', 'recovery-state'], label);
    } else if (label === 'after staging') {
      assertJournalTailTypes(persisted.records, ['apply-staged', 'recovery-state'], label);
    } else {
      assertJournalTailTypes(persisted.records, ['dependencies-validated', 'recovery-state'], label);
    }
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  assertAcceptableRecoveryState(completed.recoveryState);
  assert.equal(completed.recoveryState.status, 'fully-updated-remote');
  assert.equal(completed.recoveryState.artifacts.remote, undefined);
  assert.equal(completed.recoveryState.artifacts.journal.status, 'completed');

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  const persistedReplay = readRecoveryJournal(completedJournalPath);

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.appliedMutations, 0);
  assert.equal(
    persistedReplay.records.filter((record) => record.type === 'journal-replayed').length,
    1,
  );
  assertJournalTailTypes(persistedReplay.records, ['recovery-state', 'journal-replayed']);
  assert.equal(
    persistedReplay.records.filter((record) => record.type === 'recovery-state' && record.state === 'fully-updated-remote').length,
    2,
  );
  assert.equal(
    persistedReplay.records[persistedReplay.records.length - 2].type,
    'recovery-state',
  );
  assert.equal(
    persistedReplay.records[persistedReplay.records.length - 1].type,
    'journal-replayed',
  );
  assert.equal(persistedReplay.integrity.status, 'ok');

  const secondReplayRemote = JSON.parse(JSON.stringify(completed.site));
  const secondReplayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const secondReplay = applyPlan(secondReplayRemote, plan, {
    durableJournal: secondReplayJournal,
    journal: completed.journal,
  });
  secondReplayJournal.close();

  const persistedSecondReplay = readRecoveryJournal(completedJournalPath);

  assert.equal(JSON.stringify(secondReplayRemote), JSON.stringify(completed.site));
  assertAcceptableRecoveryState(secondReplay.recoveryState);
  assert.equal(secondReplay.recoveryState.status, 'fully-updated-remote');
  assert.equal(secondReplay.recoveryState.artifacts.remote, undefined);
  assert.equal(secondReplay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(secondReplay.appliedMutations, 0);
  assert.equal(
    persistedSecondReplay.records.filter((record) => record.type === 'journal-replayed').length,
    2,
  );
  assert.equal(
    persistedSecondReplay.records.filter((record) => record.type === 'recovery-state' && record.state === 'fully-updated-remote').length,
    3,
  );
  assert.equal(
    persistedSecondReplay.records[persistedSecondReplay.records.length - 2].type,
    'recovery-state',
  );
  assert.equal(
    persistedSecondReplay.records[persistedSecondReplay.records.length - 1].type,
    'journal-replayed',
  );
  assert.equal(persistedSecondReplay.integrity.status, 'ok');
});

test('atomic apply recovery only accepts old remote, fully updated remote, or blocked recovery with artifacts across interrupted apply and completed replay', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const snapshot = JSON.stringify(remote);
    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );
    durableJournal.close();

    assert.ok(failure instanceof PushPlanError, label);
    assertFailureRecoveryState(failure.details.recovery, 'old-remote', label);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(JSON.stringify(remote), snapshot, label);
    assert.equal(readRecoveryJournal(journalPath).integrity.status, 'ok', label);
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  assertAcceptableRecoveryState(completed.recoveryState);
  assert.equal(completed.recoveryState.status, 'fully-updated-remote');
  assert.equal(completed.recoveryState.artifacts.remote, undefined);
  assert.equal(completed.recoveryState.artifacts.journal.status, 'completed');

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  const persisted = readRecoveryJournal(completedJournalPath);

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.appliedMutations, 0);
  assert.equal(
    persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
    false,
  );
  assert.equal(
    persisted.records.filter((record) => record.type === 'journal-replayed').length,
    1,
  );
  assert.equal(
    persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'fully-updated-remote'),
    true,
  );
  assert.equal(
    persisted.records[persisted.records.length - 2].type,
    'recovery-state',
  );
  assert.equal(
    persisted.records[persisted.records.length - 1].type,
    'journal-replayed',
  );
});

test('durable recovery keeps the failure cuts old-remote and replayed plans fully-updated with inspectable artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const snapshot = JSON.stringify(remote);
    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );
    durableJournal.close();

    const persisted = readRecoveryJournal(journalPath);

    assert.ok(failure instanceof PushPlanError, label);
    assertFailureRecoveryState(failure.details.recovery, 'old-remote', label);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(JSON.stringify(remote), snapshot, label);
    assert.equal(persisted.integrity.status, 'ok', label);
    assert.equal(
      persisted.records[persisted.records.length - 1].type,
      'recovery-state',
      label,
    );
    assert.equal(
      persisted.records[persisted.records.length - 1].state,
      'old-remote',
      label,
    );
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  assertAcceptableRecoveryState(completed.recoveryState);
  assert.equal(completed.recoveryState.status, 'fully-updated-remote');
  assert.equal(completed.recoveryState.artifacts.remote, undefined);
  assert.equal(completed.recoveryState.artifacts.journal.status, 'completed');

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  const persistedReplay = readRecoveryJournal(completedJournalPath);

  assert.equal(JSON.stringify(replayRemote), JSON.stringify(completed.site));
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.appliedMutations, 0);
  assert.equal(
    persistedReplay.records.filter((record) => record.type === 'journal-replayed').length,
    1,
  );
  assert.equal(
    persistedReplay.records.filter((record) => record.type === 'recovery-state' && record.state === 'fully-updated-remote').length,
    2,
  );
  assert.equal(
    persistedReplay.records[persistedReplay.records.length - 2].type,
    'recovery-state',
  );
  assert.equal(
    persistedReplay.records[persistedReplay.records.length - 1].type,
    'journal-replayed',
  );
  assert.equal(persistedReplay.integrity.status, 'ok');
});

test('durable recovery inspect sees the interruption cuts as old-remote and completed replay as fully-updated-remote', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );
    durableJournal.close();

    const inspection = inspectRecoveryJournal({
      journal: readRecoveryJournal(journalPath),
      plan,
      current: remote,
    });

    assert.ok(failure instanceof PushPlanError, label);
    assertFailureRecoveryState(failure.details.recovery, 'old-remote', label);
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(inspection.status, 'old-remote', label);
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  const replayInspection = inspectRecoveryJournal({
    journal: readRecoveryJournal(completedJournalPath),
    plan,
    current: replayRemote,
  });

  assertAcceptableRecoveryState(replay.recoveryState);
  assertRecoveryStateArtifacts(replay.recoveryState, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.appliedMutations, 0);
  assert.equal(JSON.stringify(replayRemote), JSON.stringify(completed.site));
  assert.equal(replayInspection.status, 'fully-updated-remote');
});

test('durable recovery keeps the failure-before-mutation, failure-after-staging, failure-after-validation, and completed replay envelope inspectable', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['failure-before-mutation', { failBeforeMutation: true }, 'opened'],
    ['failure-after-staging', { failAfterStaging: true }, 'staged'],
    ['failure-after-validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const snapshot = JSON.stringify(remote);

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );
    durableJournal.close();

    const persisted = readRecoveryJournal(journalPath);

    assert.ok(failure instanceof PushPlanError, label);
    assertFailureRecoveryState(failure.details.recovery, 'old-remote', label);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(JSON.stringify(remote), snapshot, label);
    assert.equal(persisted.records[persisted.records.length - 1].type, 'recovery-state', label);
    assert.equal(persisted.records[persisted.records.length - 1].state, 'old-remote', label);
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replaySnapshot = JSON.stringify(replayRemote);
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  const persistedReplay = readRecoveryJournal(completedJournalPath);

  assert.equal(JSON.stringify(replayRemote), replaySnapshot);
  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.appliedMutations, 0);
  assert.equal(
    persistedReplay.records.filter((record) => record.type === 'journal-replayed').length,
    1,
  );
  assert.equal(
    persistedReplay.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
    false,
  );
  assert.equal(
    persistedReplay.records[persistedReplay.records.length - 2].type,
    'recovery-state',
  );
  assert.equal(
    persistedReplay.records[persistedReplay.records.length - 1].type,
    'journal-replayed',
  );
  assert.equal(persistedReplay.integrity.status, 'ok');
});

test('durable recovery preserves plan identity across interruption cuts and completed replay', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [options, expectedJournalStatus] of [
    [{ failBeforeMutation: true }, 'opened'],
    [{ failAfterStaging: true }, 'staged'],
    [{ failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );
    durableJournal.close();

    assert.equal(failure.details.recovery.planId, plan.id);
    assert.equal(failure.details.recovery.status, 'old-remote');
    assert.equal(failure.details.recovery.artifacts.journal.planId, plan.id);
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus);
    assert.equal(failure.details.recovery.artifacts.remote, undefined);
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  assert.equal(replay.recoveryState.planId, plan.id);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.journal.planId, plan.id);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.appliedMutations, 0);
});

test('atomic apply recovery only permits old remote, fully updated remote, or blocked recovery with artifacts', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Inserted locally', post_status: 'draft' };
  const plan = planFor(base, local, baseSite());

  for (const [label, options, expectedJournalStatus] of [
    ['before mutation', { failBeforeMutation: true }, 'opened'],
    ['after staging', { failAfterStaging: true }, 'staged'],
    ['after dependency validation', { failAfterDependencyValidation: true }, 'dependencies-validated'],
  ]) {
    const journalPath = tempRecoveryJournalPath();
    const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now: fixedNow });
    const remote = baseSite();
    const remoteSnapshot = JSON.stringify(remote);

    const failure = captureError(() =>
      applyPlan(remote, plan, {
        durableJournal,
        ...options,
      }),
    );
    durableJournal.close();

    const inspection = inspectRecoveryJournal({
      journal: readRecoveryJournal(journalPath),
      plan,
      current: remote,
    });

    assert.ok(failure instanceof PushPlanError, label);
    assertFailureRecoveryState(failure.details.recovery, 'old-remote', label);
    assert.equal(failure.details.recovery.artifacts.remote, undefined, label);
    assert.equal(failure.details.recovery.artifacts.journal.status, expectedJournalStatus, label);
    assert.equal(JSON.stringify(remote), remoteSnapshot, label);
    assert.equal(inspection.status, 'old-remote', label);
  }

  const completedJournalPath = tempRecoveryJournalPath();
  const completedDurableJournal = openRecoveryJournal(completedJournalPath, { truncate: true, now: fixedNow });
  const completed = applyPlan(baseSite(), plan, { durableJournal: completedDurableJournal });
  completedDurableJournal.close();

  assertAcceptableRecoveryState(completed.recoveryState);
  assert.equal(completed.recoveryState.status, 'fully-updated-remote');
  assert.equal(completed.recoveryState.artifacts.remote, undefined);
  assert.equal(completed.recoveryState.artifacts.journal.status, 'completed');

  const replayRemote = JSON.parse(JSON.stringify(completed.site));
  const replayJournal = openRecoveryJournal(completedJournalPath, { now: fixedNow });
  const replay = applyPlan(replayRemote, plan, {
    durableJournal: replayJournal,
    journal: completed.journal,
  });
  replayJournal.close();

  const persisted = readRecoveryJournal(completedJournalPath);

  assertAcceptableRecoveryState(replay.recoveryState);
  assert.equal(replay.recoveryState.status, 'fully-updated-remote');
  assert.equal(replay.recoveryState.artifacts.remote, undefined);
  assert.equal(replay.recoveryState.artifacts.journal.status, 'completed');
  assert.equal(replay.appliedMutations, 0);
  assert.equal(JSON.stringify(replayRemote), JSON.stringify(completed.site));
  assert.equal(
    persisted.records.some((record) => record.type === 'recovery-state' && record.state === 'blocked-recovery'),
    false,
  );
  assert.equal(persisted.records[persisted.records.length - 2].type, 'recovery-state');
  assert.equal(persisted.records[persisted.records.length - 1].type, 'journal-replayed');
});

test('accepted post-failure recovery states are old remote, fully updated remote, or blocked recovery with artifacts', () => {
  assert.equal(
    isAcceptableRecoveryState({
      status: 'old-remote',
      artifacts: { journal: { status: 'opened' } },
    }),
    true,
  );
  assert.equal(
    isAcceptableRecoveryState({
      status: 'fully-updated-remote',
      artifacts: { journal: { status: 'completed' } },
    }),
    true,
  );
  assert.equal(
    isAcceptableRecoveryState({
      status: 'blocked-recovery',
      artifacts: {
        journal: { status: 'completed' },
        remote: { files: {} },
      },
    }),
    true,
  );
  assert.equal(
    isAcceptableRecoveryState({
      status: 'blocked-recovery',
      artifacts: { journal: { status: 'completed' } },
    }),
    false,
  );
  assert.equal(
    isAcceptableRecoveryState({
      status: 'partially-applied',
      artifacts: { journal: { status: 'staged' } },
    }),
    false,
  );
});

test('production durable journal claims fail closed without a restart-readable writer', () => {
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const error = captureError(() => applyPlan(baseSite(), plan, { requireProductionDurableJournal: true }));
  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.deepEqual(error.details.missingDependency, [
    'production recovery journal adapter marker',
    'explicit production recovery adapter marker',
    'explicit journal ownership fencing',
    'stable-storage flush or fsync semantics',
    'durable writer cleanup',
    'restart-readable recovery inspection',
    'restart-readable recovery artifact references',
    'owned restart-readable recovery journal path',
    'restart-readable recovery journal schema',
    'fencing or lease ownership for the journal writer',
  ]);
});

test('unsupported production recovery journal adapters stay fail closed by default', () => {
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const journal = createUnsupportedProductionRecoveryJournal();

  assert.equal(plan.status, 'ready');
  assert.throws(
    () => journal.appendEvent('journal-opened', {}),
    /Production recovery journal support is not available/,
  );

  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: journal,
  }));

  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.ok(error.details.missingDependency.includes('restart-readable recovery inspection'));
  assert.ok(error.details.missingDependency.includes('owned restart-readable recovery journal path'));
});

test('unsupported production recovery journal adapters remain fenced and restart-opaque by default', () => {
  const journal = createUnsupportedProductionRecoveryJournal();

  assert.equal(journal.kind, 'production-recovery-journal');
  assert.equal(journal.productionAdapter, true);
  assert.equal(journal.supportedSurface, 'production-recovery-journal-adapter');
  assert.equal(journal.ownsJournal, false);
  assert.equal(journal.restartReadable, false);
  assert.equal(journal.journalPath, null);
  assert.deepEqual(journal.artifactRefs, { journal: null, remote: null });
  assert.deepEqual(journal.missingDependency, [
    'production recovery journal adapter marker',
    'explicit production recovery adapter marker',
    'restart-readable recovery journal adapter',
    'explicit journal ownership fencing',
    'stable-storage flush or fsync semantics',
    'durable writer cleanup',
    'restart-readable recovery inspection',
    'restart-readable recovery artifact references',
    'restart-readable remote recovery artifact ownership',
    'owned restart-readable recovery journal path',
    'restart-readable recovery journal schema',
    'fencing or lease ownership for the journal writer',
    'journal-readable inspection records with sequence and type',
  ]);
  assert.equal(typeof journal.inspect, 'function');
  assert.throws(() => journal.inspect(), /Production recovery journal support is not available/);
});

test('production durable journal claims fail closed when the writer advertises the production surface but stays restart-opaque', () => {
  const writer = {
    kind: 'production-recovery-journal',
    productionAdapter: true,
    supportedSurface: 'production-recovery-journal-adapter',
    ownsJournal: true,
    ownsRemoteArtifact: false,
    restartReadable: false,
    journalPath: '/var/lib/reprint/recovery.jsonl',
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    artifactRefs: {
      journal: '/var/lib/reprint/recovery.jsonl',
    },
    nextSequence: 1,
    appendEvent(type, payload) {
      this.nextSequence += 1;
      return { sequence: this.nextSequence - 1, type, payload };
    },
    flush() {},
    close() {},
    inspect() {
      return {
        filePath: '/var/lib/reprint/recovery.jsonl',
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
        artifactRefs: {
          journal: '/var/lib/reprint/recovery.jsonl',
        },
        records: [{ sequence: 1, type: 'journal-opened' }],
      };
    },
    assertCurrentClaim() {},
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  }));

  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.ok(error.details.missingDependency.includes('restart-readable recovery journal adapter'));
});

test('production durable journal claims report the exact missing durability pieces for a partial writer', () => {
  const writer = {
    kind: 'production-recovery-journal',
    productionAdapter: true,
    ownsJournal: true,
    journalPath: '/var/lib/reprint/recovery.jsonl',
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    nextSequence: 1,
    appendEvent(type, payload) {
      this.nextSequence += 1;
      return { sequence: this.nextSequence - 1, type, payload };
    },
    flush() {},
    close() {},
    inspect() {
      return {
        filePath: '/var/lib/reprint/recovery.jsonl',
        artifactRefs: {
          journal: '/var/lib/reprint/recovery.jsonl',
        },
        records: [{ sequence: 1, type: 'journal-opened' }],
      };
    },
    assertCurrentClaim() {},
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  }));

  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.deepEqual(error.details.missingDependency, [
    'restart-readable recovery journal schema',
    'restart-readable recovery artifact location',
    'restart-readable recovery artifact references',
    'journal-readable inspection records with sequence and type',
  ]);
});

test('production durable journal claims fail closed when restart inspection omits artifact references', () => {
  const writer = {
    kind: 'production-recovery-journal',
    productionAdapter: true,
    ownsJournal: true,
    journalPath: '/var/lib/reprint/recovery.jsonl',
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    nextSequence: 1,
    artifactRefs: {
      journal: '/var/lib/reprint/recovery.jsonl',
    },
    appendEvent(type, payload) {
      this.nextSequence += 1;
      return { sequence: this.nextSequence - 1, type, payload };
    },
    flush() {},
    close() {},
    inspect() {
      return {
        filePath: '/var/lib/reprint/recovery.jsonl',
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
        records: [{ sequence: 1, type: 'journal-opened' }],
      };
    },
    assertCurrentClaim() {},
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  }));

  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.deepEqual(error.details.missingDependency, [
    'restart-readable recovery artifact references',
  ]);
});

test('production durable journal claims fail closed when an advertised artifact reference is missing', () => {
  const writer = {
    kind: 'production-recovery-journal',
    productionAdapter: true,
    ownsJournal: true,
    journalPath: '/var/lib/reprint/recovery.jsonl',
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    nextSequence: 1,
    artifactRefs: {},
    appendEvent(type, payload) {
      this.nextSequence += 1;
      return { sequence: this.nextSequence - 1, type, payload };
    },
    flush() {},
    close() {},
    inspect() {
      return {
        filePath: '/var/lib/reprint/recovery.jsonl',
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
        artifactRefs: {
          journal: '/var/lib/reprint/recovery.jsonl',
        },
        records: [{ sequence: 1, type: 'journal-opened' }],
      };
    },
    assertCurrentClaim() {},
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  }));

  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.deepEqual(error.details.missingDependency, [
    'restart-readable recovery artifact references',
  ]);
});

test('production durable journal claims fail closed when advertised artifact references point at a different journal path', () => {
  const writer = {
    kind: 'production-recovery-journal',
    productionAdapter: true,
    ownsJournal: true,
    journalPath: '/var/lib/reprint/recovery.jsonl',
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    nextSequence: 1,
    artifactRefs: {
      journal: '/var/lib/reprint/other-recovery.jsonl',
    },
    appendEvent(type, payload) {
      this.nextSequence += 1;
      return { sequence: this.nextSequence - 1, type, payload };
    },
    flush() {},
    close() {},
    inspect() {
      return {
        filePath: '/var/lib/reprint/recovery.jsonl',
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
        records: [{ sequence: 1, type: 'journal-opened' }],
      };
    },
    assertCurrentClaim() {},
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  }));

  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.deepEqual(error.details.missingDependency, [
    'restart-readable recovery artifact references',
  ]);
});

test('production durable journal claims fail closed when advertised artifact references are not absolute', () => {
  const writer = {
    kind: 'production-recovery-journal',
    productionAdapter: true,
    ownsJournal: true,
    journalPath: '/var/lib/reprint/recovery.jsonl',
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    nextSequence: 1,
    artifactRefs: {
      journal: 'var/lib/reprint/recovery.jsonl',
    },
    appendEvent(type, payload) {
      this.nextSequence += 1;
      return { sequence: this.nextSequence - 1, type, payload };
    },
    flush() {},
    close() {},
    inspect() {
      return {
        filePath: '/var/lib/reprint/recovery.jsonl',
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
        artifactRefs: {
          journal: '/var/lib/reprint/recovery.jsonl',
        },
        records: [{ sequence: 1, type: 'journal-opened' }],
      };
    },
    assertCurrentClaim() {},
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  }));

  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.deepEqual(error.details.missingDependency, [
    'restart-readable recovery artifact references',
  ]);
});

test('production durable journal claims fail closed when inspection advertises a different artifact reference than the writer', () => {
  const writer = {
    kind: 'production-recovery-journal',
    productionAdapter: true,
    ownsJournal: true,
    journalPath: '/var/lib/reprint/recovery.jsonl',
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    nextSequence: 1,
    artifactRefs: {
      journal: '/var/lib/reprint/recovery.jsonl',
    },
    appendEvent(type, payload) {
      this.nextSequence += 1;
      return { sequence: this.nextSequence - 1, type, payload };
    },
    flush() {},
    close() {},
    inspect() {
      return {
        filePath: '/var/lib/reprint/recovery.jsonl',
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
        artifactRefs: {
          journal: '/var/lib/reprint/other-recovery.jsonl',
        },
        records: [{ sequence: 1, type: 'journal-opened' }],
      };
    },
    assertCurrentClaim() {},
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  }));

  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.deepEqual(error.details.missingDependency, [
    'restart-readable recovery artifact references',
  ]);
});

test('production durable journal claims fail closed when inspection artifact references do not match the inspected journal path', () => {
  const writer = {
    kind: 'production-recovery-journal',
    productionAdapter: true,
    ownsJournal: true,
    journalPath: '/var/lib/reprint/recovery.jsonl',
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    nextSequence: 1,
    artifactRefs: {
      journal: '/var/lib/reprint/recovery.jsonl',
    },
    appendEvent(type, payload) {
      this.nextSequence += 1;
      return { sequence: this.nextSequence - 1, type, payload };
    },
    flush() {},
    close() {},
    inspect() {
      return {
        filePath: '/var/lib/reprint/recovery.jsonl',
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
        artifactRefs: {
          journal: '/var/lib/reprint/other-recovery.jsonl',
        },
        records: [{ sequence: 1, type: 'journal-opened' }],
      };
    },
    assertCurrentClaim() {},
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  }));

  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.deepEqual(error.details.missingDependency, [
    'restart-readable recovery artifact references',
  ]);
});

test('production durable journal claims fail closed when the writer artifact path diverges from the inspected journal path', () => {
  const writer = {
    kind: 'production-recovery-journal',
    productionAdapter: true,
    ownsJournal: true,
    journalPath: '/var/lib/reprint/recovery.jsonl',
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    nextSequence: 1,
    artifactRefs: {
      journal: '/var/lib/reprint/alternate-recovery.jsonl',
    },
    appendEvent(type, payload) {
      this.nextSequence += 1;
      return { sequence: this.nextSequence - 1, type, payload };
    },
    flush() {},
    close() {},
    inspect() {
      return {
        filePath: '/var/lib/reprint/recovery.jsonl',
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
        artifactRefs: {
          journal: '/var/lib/reprint/recovery.jsonl',
        },
        records: [{ sequence: 1, type: 'journal-opened' }],
      };
    },
    assertCurrentClaim() {},
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  }));

  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.deepEqual(error.details.missingDependency, [
    'restart-readable recovery artifact references',
  ]);
});

test('production durable journal claims fail closed when restart inspection lacks a journal location', () => {
  const writer = {
    kind: 'production-recovery-journal',
    productionAdapter: true,
    ownsJournal: true,
    journalPath: '/var/lib/reprint/recovery.jsonl',
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    nextSequence: 1,
    appendEvent(type, payload) {
      this.nextSequence += 1;
      return { sequence: this.nextSequence - 1, type, payload };
    },
    flush() {},
    close() {},
    inspect() {
      return {
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
        records: [{ sequence: 1, type: 'journal-opened' }],
      };
    },
    assertCurrentClaim() {},
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  }));

  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.deepEqual(error.details.missingDependency, [
    'restart-readable recovery artifact location',
    'restart-readable recovery artifact references',
  ]);
});

test('production durable journal claims fail closed when restart inspection points at a different journal path', () => {
  const writer = {
    kind: 'production-recovery-journal',
    productionAdapter: true,
    ownsJournal: true,
    journalPath: '/var/lib/reprint/recovery.jsonl',
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    nextSequence: 1,
    appendEvent(type, payload) {
      this.nextSequence += 1;
      return { sequence: this.nextSequence - 1, type, payload };
    },
    flush() {},
    close() {},
    inspect() {
      return {
        filePath: '/var/lib/reprint/other-recovery.jsonl',
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
        records: [{ sequence: 1, type: 'journal-opened' }],
      };
    },
    assertCurrentClaim() {},
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  }));

  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.deepEqual(error.details.missingDependency, [
    'restart-readable recovery artifact location',
    'restart-readable recovery artifact references',
  ]);
  assert.equal(error.details.inspectedJournalPath, '/var/lib/reprint/other-recovery.jsonl');
  assert.equal(error.details.writerJournalPath, '/var/lib/reprint/recovery.jsonl');
});

test('production durable journal claims fail closed when restart inspection reports a non-absolute file path', () => {
  const writer = {
    kind: 'production-recovery-journal',
    ownsJournal: true,
    journalPath: '/var/lib/reprint/recovery.jsonl',
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    nextSequence: 1,
    appendEvent(type, payload) {
      this.nextSequence += 1;
      return { sequence: this.nextSequence - 1, type, payload };
    },
    flush() {},
    close() {},
    inspect() {
      return {
        filePath: 'var/lib/reprint/recovery.jsonl',
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
        records: [{ sequence: 1, type: 'journal-opened' }],
      };
    },
    assertCurrentClaim() {},
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  }));

  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.deepEqual(error.details.missingDependency, [
    'explicit production recovery adapter marker',
    'restart-readable recovery artifact location',
    'restart-readable recovery artifact references',
  ]);
});

test('production durable journal support checks close an invalid writer before failing closed', () => {
  let closed = 0;
  const writer = {
    close() {
      closed += 1;
    },
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  }));

  assert.equal(error.code, 'JOURNAL_WRITER_INVALID');
  assert.equal(closed, 0);
});

test('production durable journal support checks close a writer when restart inspection throws', () => {
  let closed = 0;
  const writer = {
    kind: 'production-recovery-journal',
    ownsJournal: true,
    journalPath: '/var/lib/reprint/recovery.jsonl',
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    appendEvent() {},
    flush() {},
    close() {
      closed += 1;
    },
    inspect() {
      throw new Error('injected inspect failure');
    },
    assertCurrentClaim() {},
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  }));

  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.equal(closed, 1);
  assert.deepEqual(error.details.missingDependency, [
    'explicit production recovery adapter marker',
    'restart-readable recovery inspection',
    'restart-readable recovery artifact references',
  ]);
  assert.equal(error.details.inspectionErrorMessage, 'injected inspect failure');
});

test('production durable journal support checks close a writer when the support probe rejects it', () => {
  let closed = 0;
  const writer = {
    kind: 'production-recovery-journal',
    ownsJournal: true,
    journalPath: '/var/lib/reprint/recovery.jsonl',
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    appendEvent() {},
    flush() {},
    close() {
      closed += 1;
    },
    inspect() {
      return {
        filePath: '/var/lib/reprint/recovery.jsonl',
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
        artifactRefs: {
          journal: '/var/lib/reprint/recovery.jsonl',
        },
        records: [{ sequence: 1, type: 'journal-opened' }],
      };
    },
    assertCurrentClaim() {
      throw new Error('lease missing');
    },
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  }));

  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.equal(closed, 1);
  assert.deepEqual(error.details.missingDependency, [
    'explicit production recovery adapter marker',
    'restart-readable recovery artifact references',
    'fencing or lease ownership for the journal writer',
  ]);
});

test('production durable journal claims fail closed when the writer cannot inspect restart state', () => {
  const writer = {
    nextSequence: 1,
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    appendEvent() {
      this.nextSequence += 1;
    },
    flush() {},
    close() {},
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  }));

  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.equal(error.details.requiresDurableJournal, true);
});

test('production durable journal claims fail closed when restart inspection is not journal-readable', () => {
  const writer = {
    nextSequence: 1,
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    appendEvent() {
      this.nextSequence += 1;
    },
    flush() {},
    close() {},
    inspect() {
      return { status: 'ok' };
    },
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  }));

  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.equal(error.details.requiresDurableJournal, true);
});

test('production durable journal claims fail closed when inspection records are structurally incomplete', () => {
  const writer = {
    nextSequence: 1,
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    appendEvent() {
      this.nextSequence += 1;
    },
    flush() {},
    close() {},
    inspect() {
      return { records: [{ status: 'ok' }] };
    },
    assertCurrentClaim() {},
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  }));

  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.equal(error.details.requiresDurableJournal, true);
});

test('production durable journal claims fail closed when inspection records skip a sequence', () => {
  const writer = {
    kind: 'production-recovery-journal',
    productionAdapter: true,
    ownsJournal: true,
    journalPath: '/var/lib/reprint/recovery.jsonl',
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    nextSequence: 1,
    appendEvent() {
      this.nextSequence += 1;
    },
    flush() {},
    close() {},
    inspect() {
      return {
        filePath: '/var/lib/reprint/recovery.jsonl',
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
        artifactRefs: {
          journal: '/var/lib/reprint/recovery.jsonl',
        },
        records: [
          { sequence: 1, type: 'journal-opened' },
          { sequence: 3, type: 'journal-completed' },
        ],
      };
    },
    assertCurrentClaim() {},
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  }));

  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.deepEqual(error.details.missingDependency, [
    'restart-readable recovery artifact references',
    'journal-readable inspection records with sequence and type',
  ]);
});

test('production durable journal claims fail closed when inspection records are empty', () => {
  const writer = {
    kind: 'production-recovery-journal',
    productionAdapter: true,
    ownsJournal: true,
    journalPath: '/var/lib/reprint/recovery.jsonl',
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    nextSequence: 1,
    appendEvent() {
      this.nextSequence += 1;
    },
    flush() {},
    close() {},
    inspect() {
      return {
        filePath: '/var/lib/reprint/recovery.jsonl',
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
        artifactRefs: {
          journal: '/var/lib/reprint/recovery.jsonl',
        },
        records: [],
      };
    },
    assertCurrentClaim() {},
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  }));

  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.deepEqual(error.details.missingDependency, [
    'restart-readable recovery artifact references',
    'journal-readable inspection records with sequence and type',
  ]);
});

test('production durable journal claims fail closed when restart inspection advertises artifact references without writer ownership', () => {
  const writer = {
    kind: 'production-recovery-journal',
    ownsJournal: true,
    journalPath: '/var/lib/reprint/recovery.jsonl',
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    nextSequence: 1,
    appendEvent() {
      this.nextSequence += 1;
    },
    flush() {},
    close() {},
    inspect() {
      return {
        filePath: '/var/lib/reprint/recovery.jsonl',
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
        artifactRefs: {
          journal: '/var/lib/reprint/recovery.jsonl',
        },
        records: [{ sequence: 1, type: 'journal-opened' }],
      };
    },
    assertCurrentClaim() {},
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  }));

  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.deepEqual(error.details.missingDependency, [
    'explicit production recovery adapter marker',
    'restart-readable recovery artifact references',
  ]);
});

test('production durable journal claims fail closed when restart inspection reports a different schema version', () => {
  const writer = {
    kind: 'production-recovery-journal',
    ownsJournal: true,
    journalPath: '/var/lib/reprint/recovery.jsonl',
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    nextSequence: 1,
    appendEvent() {
      this.nextSequence += 1;
    },
    flush() {},
    close() {},
    inspect() {
      return {
        filePath: '/var/lib/reprint/recovery.jsonl',
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION + 1,
        records: [{ sequence: 1, type: 'journal-opened' }],
      };
    },
    assertCurrentClaim() {},
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  }));

  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.deepEqual(error.details.missingDependency, [
    'explicit production recovery adapter marker',
    'restart-readable recovery journal schema',
    'restart-readable recovery artifact references',
  ]);
});

test('production durable journal claims fail closed when inspection records are not sequential', () => {
  const writer = {
    kind: 'production-recovery-journal',
    ownsJournal: true,
    journalPath: '/var/lib/reprint/recovery.jsonl',
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    nextSequence: 1,
    appendEvent() {
      this.nextSequence += 1;
    },
    flush() {},
    close() {},
    inspect() {
      return {
        filePath: '/var/lib/reprint/recovery.jsonl',
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
        records: [
          { sequence: 2, type: 'journal-opened' },
          { sequence: 1, type: 'journal-completed' },
        ],
      };
    },
    assertCurrentClaim() {},
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  }));

  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.deepEqual(error.details.missingDependency, [
    'explicit production recovery adapter marker',
    'restart-readable recovery artifact references',
    'journal-readable inspection records with sequence and type',
  ]);
});

test('production durable journal claims fail closed when the first inspection record is not journal-opened', () => {
  const writer = {
    kind: 'production-recovery-journal',
    ownsJournal: true,
    journalPath: '/var/lib/reprint/recovery.jsonl',
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    nextSequence: 1,
    appendEvent() {
      this.nextSequence += 1;
    },
    flush() {},
    close() {},
    inspect() {
      return {
        filePath: '/var/lib/reprint/recovery.jsonl',
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
        artifactRefs: {
          journal: '/var/lib/reprint/recovery.jsonl',
        },
        records: [
          { sequence: 1, type: 'mutation-observed' },
          { sequence: 2, type: 'journal-opened' },
        ],
      };
    },
    assertCurrentClaim() {},
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  }));

  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.deepEqual(error.details.missingDependency, [
    'explicit production recovery adapter marker',
    'restart-readable recovery artifact references',
    'journal-readable inspection records with sequence and type',
  ]);
});

test('production durable journal claims fail closed when the writer cannot fence claims', () => {
  const writer = {
    nextSequence: 1,
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    appendEvent() {
      this.nextSequence += 1;
    },
    flush() {},
    close() {},
    inspect() {
      return { records: [] };
    },
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  }));

  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.equal(error.details.requiresDurableJournal, true);
});

test('production durable journal claims fail closed when claim fencing rejects the writer', () => {
  const writer = {
    kind: 'production-recovery-journal',
    ownsJournal: true,
    journalPath: '/var/lib/reprint/recovery.jsonl',
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    nextSequence: 1,
    appendEvent(type, payload) {
      this.nextSequence += 1;
      return { sequence: this.nextSequence - 1, type, payload };
    },
    flush() {},
    close() {},
    inspect() {
      return {
        filePath: '/var/lib/reprint/recovery.jsonl',
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
        records: [{ sequence: 1, type: 'journal-opened' }],
      };
    },
    assertCurrentClaim() {
      throw new Error('claim lost');
    },
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  }));

  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.deepEqual(error.details.missingDependency, [
    'explicit production recovery adapter marker',
    'restart-readable recovery artifact references',
    'fencing or lease ownership for the journal writer',
  ]);
});

test('production durable journal claims fail closed without an explicit production adapter marker', () => {
  const writer = {
    nextSequence: 1,
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    appendEvent(type, payload) {
      this.nextSequence += 1;
      return { sequence: this.nextSequence - 1, type, payload };
    },
    flush() {},
    close() {},
    inspect() {
      return {
        filePath: '/var/lib/reprint/recovery.jsonl',
        records: [{ sequence: 1, type: 'journal-opened' }],
      };
    },
    assertCurrentClaim() {},
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  }));

  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.equal(error.details.supportedSurface, 'production-recovery-journal-adapter');
});

test('production durable journal claims fail closed when the writer does not own the restart journal path', () => {
  const writer = {
    kind: 'production-recovery-journal',
    ownsJournal: true,
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    nextSequence: 1,
    appendEvent(type, payload) {
      this.nextSequence += 1;
      return { sequence: this.nextSequence - 1, type, payload };
    },
    flush() {},
    close() {},
    inspect() {
      return {
        filePath: '/var/lib/reprint/recovery.jsonl',
        records: [{ sequence: 1, type: 'journal-opened' }],
      };
    },
    assertCurrentClaim() {},
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  }));

  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.deepEqual(error.details.missingDependency, [
    'explicit production recovery adapter marker',
    'restart-readable recovery journal schema',
    'restart-readable recovery artifact location',
    'restart-readable recovery artifact references',
    'owned restart-readable recovery journal path',
    'journal-readable inspection records with sequence and type',
  ]);
});

test('production durable journal claims fail closed when restart inspection is otherwise readable but journal ownership is not fenced', () => {
  const writer = {
    kind: 'production-recovery-journal',
    productionAdapter: true,
    ownsJournal: false,
    journalPath: '/var/lib/reprint/recovery.jsonl',
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    nextSequence: 1,
    appendEvent(type, payload) {
      this.nextSequence += 1;
      return { sequence: this.nextSequence - 1, type, payload };
    },
    flush() {},
    close() {},
    inspect() {
      return {
        filePath: '/var/lib/reprint/recovery.jsonl',
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
        artifactRefs: {
          journal: '/var/lib/reprint/recovery.jsonl',
        },
        records: [{ sequence: 1, type: 'journal-opened' }],
      };
    },
    assertCurrentClaim() {},
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  }));

  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.deepEqual(error.details.missingDependency, [
    'explicit journal ownership fencing',
    'restart-readable recovery artifact references',
  ]);
});

test('production durable journal claims fail closed when the writer journal path is not absolute', () => {
  const writer = {
    kind: 'production-recovery-journal',
    ownsJournal: true,
    journalPath: 'var/lib/reprint/recovery.jsonl',
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    nextSequence: 1,
    appendEvent(type, payload) {
      this.nextSequence += 1;
      return { sequence: this.nextSequence - 1, type, payload };
    },
    flush() {},
    close() {},
    inspect() {
      return {
        filePath: 'var/lib/reprint/recovery.jsonl',
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
        records: [{ sequence: 1, type: 'journal-opened' }],
      };
    },
    assertCurrentClaim() {},
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  }));

  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.deepEqual(error.details.missingDependency, [
    'explicit production recovery adapter marker',
    'restart-readable recovery artifact location',
    'restart-readable recovery artifact references',
    'absolute restart-readable recovery journal path',
  ]);
  assert.equal(error.details.inspectedJournalPath, 'var/lib/reprint/recovery.jsonl');
  assert.equal(error.details.writerJournalPath, 'var/lib/reprint/recovery.jsonl');
});

test('production durable journal claims fail closed when restart inspection omits artifact references', () => {
  let inspectCalls = 0;
  const writer = {
    kind: 'production-recovery-journal',
    productionAdapter: true,
    ownsJournal: true,
    journalPath: '/var/lib/reprint/recovery.jsonl',
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    nextSequence: 1,
    appendEvent(type, payload) {
      this.nextSequence += 1;
      return { sequence: this.nextSequence - 1, type, payload };
    },
    flush() {},
    close() {},
    inspect() {
      inspectCalls += 1;
      return {
        filePath: '/var/lib/reprint/recovery.jsonl',
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
        artifactRefs: {
          journal: '/var/lib/reprint/recovery.jsonl',
        },
        records: [{ sequence: 1, type: 'journal-opened' }],
      };
    },
    assertCurrentClaim() {},
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });

  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  }));

  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.deepEqual(error.details.missingDependency, [
    'restart-readable recovery artifact references',
  ]);
  assert.equal(inspectCalls, 1);
});

test('production durable journal claims fail closed when the writer artifact reference diverges from restart inspection', () => {
  const writer = {
    kind: 'production-recovery-journal',
    productionAdapter: true,
    ownsJournal: true,
    journalPath: '/var/lib/reprint/recovery.jsonl',
    artifactRefs: {
      journal: '/var/lib/reprint/recovery-writer.jsonl',
    },
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    nextSequence: 1,
    appendEvent(type, payload) {
      this.nextSequence += 1;
      return { sequence: this.nextSequence - 1, type, payload };
    },
    flush() {},
    close() {},
    inspect() {
      return {
        filePath: '/var/lib/reprint/recovery.jsonl',
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
        artifactRefs: {
          journal: '/var/lib/reprint/recovery.jsonl',
        },
        records: [{ sequence: 1, type: 'journal-opened' }],
      };
    },
    assertCurrentClaim() {},
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  }));

  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.deepEqual(error.details.missingDependency, [
    'restart-readable recovery artifact references',
  ]);
  assert.equal(error.details.inspectedJournalPath, '/var/lib/reprint/recovery.jsonl');
  assert.equal(error.details.writerJournalPath, '/var/lib/reprint/recovery.jsonl');
});

test('production durable journal claims fail closed when the writer advertises a remote artifact reference', () => {
  const writer = {
    kind: 'production-recovery-journal',
    productionAdapter: true,
    ownsJournal: true,
    journalPath: '/var/lib/reprint/recovery.jsonl',
    artifactRefs: {
      journal: '/var/lib/reprint/recovery.jsonl',
      remote: '/var/lib/reprint/remote.jsonl',
    },
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    nextSequence: 1,
    appendEvent(type, payload) {
      this.nextSequence += 1;
      return { sequence: this.nextSequence - 1, type, payload };
    },
    flush() {},
    close() {},
    inspect() {
      return {
        filePath: '/var/lib/reprint/recovery.jsonl',
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
        artifactRefs: {
          journal: '/var/lib/reprint/recovery.jsonl',
        },
        records: [{ sequence: 1, type: 'journal-opened' }],
      };
    },
    assertCurrentClaim() {},
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  }));

  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.deepEqual(error.details.missingDependency, [
    'restart-readable remote recovery artifact ownership',
    'restart-readable recovery remote artifact references',
  ]);
});

test('production durable journal claims fail closed when restart inspection advertises a remote artifact reference', () => {
  const writer = {
    kind: 'production-recovery-journal',
    productionAdapter: true,
    ownsJournal: true,
    journalPath: '/var/lib/reprint/recovery.jsonl',
    artifactRefs: {
      journal: '/var/lib/reprint/recovery.jsonl',
    },
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    nextSequence: 1,
    appendEvent(type, payload) {
      this.nextSequence += 1;
      return { sequence: this.nextSequence - 1, type, payload };
    },
    flush() {},
    close() {},
    inspect() {
      return {
        filePath: '/var/lib/reprint/recovery.jsonl',
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
        artifactRefs: {
          journal: '/var/lib/reprint/recovery.jsonl',
          remote: '/var/lib/reprint/remote.jsonl',
        },
        records: [{ sequence: 1, type: 'journal-opened' }],
      };
    },
    assertCurrentClaim() {},
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  }));

  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.deepEqual(error.details.missingDependency, [
    'restart-readable recovery remote artifact references',
    'restart-readable remote recovery artifact ownership',
  ]);
});

test('production durable journal claims fail closed when restart inspection advertises a non-absolute remote artifact reference', () => {
  const writer = {
    kind: 'production-recovery-journal',
    productionAdapter: true,
    ownsJournal: true,
    ownsRemoteArtifact: true,
    journalPath: '/var/lib/reprint/recovery.jsonl',
    artifactRefs: {
      journal: '/var/lib/reprint/recovery.jsonl',
    },
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    nextSequence: 1,
    appendEvent(type, payload) {
      this.nextSequence += 1;
      return { sequence: this.nextSequence - 1, type, payload };
    },
    flush() {},
    close() {},
    inspect() {
      return {
        filePath: '/var/lib/reprint/recovery.jsonl',
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
        artifactRefs: {
          journal: '/var/lib/reprint/recovery.jsonl',
          remote: 'var/lib/reprint/remote.jsonl',
        },
        records: [{ sequence: 1, type: 'journal-opened' }],
      };
    },
    assertCurrentClaim() {},
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  }));

  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.deepEqual(error.details.missingDependency, [
    'restart-readable recovery remote artifact references',
  ]);
});

test('production durable journal claims fail closed when a remote artifact reference is not absolute', () => {
  const writer = {
    kind: 'production-recovery-journal',
    productionAdapter: true,
    ownsJournal: true,
    ownsRemoteArtifact: true,
    journalPath: '/var/lib/reprint/recovery.jsonl',
    artifactRefs: {
      journal: '/var/lib/reprint/recovery.jsonl',
      remote: 'var/lib/reprint/remote.jsonl',
    },
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    nextSequence: 1,
    appendEvent(type, payload) {
      this.nextSequence += 1;
      return { sequence: this.nextSequence - 1, type, payload };
    },
    flush() {},
    close() {},
    inspect() {
      return {
        filePath: '/var/lib/reprint/recovery.jsonl',
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
        artifactRefs: {
          journal: '/var/lib/reprint/recovery.jsonl',
          remote: '/var/lib/reprint/remote.jsonl',
        },
        records: [{ sequence: 1, type: 'journal-opened' }],
      };
    },
    assertCurrentClaim() {},
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  }));

  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.deepEqual(error.details.missingDependency, [
    'restart-readable recovery remote artifact references',
  ]);
});

test('production durable journal claims fail closed when the writer advertises a remote artifact reference but restart inspection omits it', () => {
  const writer = {
    kind: 'production-recovery-journal',
    productionAdapter: true,
    ownsJournal: true,
    ownsRemoteArtifact: true,
    journalPath: '/var/lib/reprint/recovery.jsonl',
    artifactRefs: {
      journal: '/var/lib/reprint/recovery.jsonl',
      remote: '/var/lib/reprint/remote.jsonl',
    },
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    nextSequence: 1,
    appendEvent(type, payload) {
      this.nextSequence += 1;
      return { sequence: this.nextSequence - 1, type, payload };
    },
    flush() {},
    close() {},
    inspect() {
      return {
        filePath: '/var/lib/reprint/recovery.jsonl',
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
        artifactRefs: {
          journal: '/var/lib/reprint/recovery.jsonl',
        },
        records: [{ sequence: 1, type: 'journal-opened' }],
      };
    },
    assertCurrentClaim() {},
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  }));

  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.deepEqual(error.details.missingDependency, [
    'restart-readable recovery remote artifact references',
  ]);
});

test('production durable journal claims fail closed when restart inspection advertises a different remote artifact reference than the writer', () => {
  const writer = {
    kind: 'production-recovery-journal',
    productionAdapter: true,
    ownsJournal: true,
    ownsRemoteArtifact: true,
    journalPath: '/var/lib/reprint/recovery.jsonl',
    artifactRefs: {
      journal: '/var/lib/reprint/recovery.jsonl',
      remote: '/var/lib/reprint/remote-a.jsonl',
    },
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    nextSequence: 1,
    appendEvent(type, payload) {
      this.nextSequence += 1;
      return { sequence: this.nextSequence - 1, type, payload };
    },
    flush() {},
    close() {},
    inspect() {
      return {
        filePath: '/var/lib/reprint/recovery.jsonl',
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
        artifactRefs: {
          journal: '/var/lib/reprint/recovery.jsonl',
          remote: '/var/lib/reprint/remote-b.jsonl',
        },
        records: [{ sequence: 1, type: 'journal-opened' }],
      };
    },
    assertCurrentClaim() {},
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  }));

  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.deepEqual(error.details.missingDependency, [
    'restart-readable recovery remote artifact references',
  ]);
});

test('production durable journal claims fail closed when remote artifact references are malformed', () => {
  const writer = {
    kind: 'production-recovery-journal',
    productionAdapter: true,
    ownsJournal: true,
    ownsRemoteArtifact: true,
    journalPath: '/var/lib/reprint/recovery.jsonl',
    artifactRefs: {
      journal: '/var/lib/reprint/recovery.jsonl',
      remote: { path: '/var/lib/reprint/remote-a.jsonl' },
    },
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    nextSequence: 1,
    appendEvent(type, payload) {
      this.nextSequence += 1;
      return { sequence: this.nextSequence - 1, type, payload };
    },
    flush() {},
    close() {},
    inspect() {
      return {
        filePath: '/var/lib/reprint/recovery.jsonl',
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
        artifactRefs: {
          journal: '/var/lib/reprint/recovery.jsonl',
          remote: { path: '/var/lib/reprint/remote-b.jsonl' },
        },
        records: [{ sequence: 1, type: 'journal-opened' }],
      };
    },
    assertCurrentClaim() {},
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  }));

  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.deepEqual(error.details.missingDependency, [
    'restart-readable recovery remote artifact references',
  ]);
});

test('production durable journal claims fail closed when artifact paths include traversal segments', () => {
  const writer = {
    kind: 'production-recovery-journal',
    productionAdapter: true,
    ownsJournal: true,
    journalPath: '/var/lib/reprint/../reprint/recovery.jsonl',
    artifactRefs: {
      journal: '/var/lib/reprint/../reprint/recovery.jsonl',
    },
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    nextSequence: 1,
    appendEvent(type, payload) {
      this.nextSequence += 1;
      return { sequence: this.nextSequence - 1, type, payload };
    },
    flush() {},
    close() {},
    inspect() {
      return {
        filePath: '/var/lib/reprint/../reprint/recovery.jsonl',
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
        artifactRefs: {
          journal: '/var/lib/reprint/../reprint/recovery.jsonl',
        },
        records: [{ sequence: 1, type: 'journal-opened' }],
      };
    },
    assertCurrentClaim() {},
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });
  const error = captureError(() => applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  }));

  assert.equal(error.code, 'PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED');
  assert.deepEqual(error.details.missingDependency, [
    'restart-readable recovery artifact location',
    'restart-readable recovery artifact references',
    'absolute restart-readable recovery journal path',
  ]);
});

test('production durable journal support probes restart inspection only once', () => {
  let inspectCalls = 0;
  const writer = {
    kind: 'production-recovery-journal',
    productionAdapter: true,
    ownsJournal: true,
    journalPath: '/var/lib/reprint/recovery.jsonl',
    artifactRefs: {
      journal: '/var/lib/reprint/recovery.jsonl',
    },
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    appendEvent() {
      return { sequence: 1, type: 'journal-opened' };
    },
    flush() {},
    close() {},
    inspect() {
      inspectCalls += 1;
      return {
        filePath: '/var/lib/reprint/recovery.jsonl',
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
        artifactRefs: {
          journal: '/var/lib/reprint/recovery.jsonl',
        },
        records: [{ sequence: 1, type: 'journal-opened' }],
      };
    },
    assertCurrentClaim() {},
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });

  const result = applyPlan(baseSite(), plan, {
    requireProductionDurableJournal: true,
    durableJournal: writer,
  });

  assert.equal(result.recoveryState.status, 'fully-updated-remote');
  assert.equal(inspectCalls, 1);
});

test('closes a durable journal writer when apply fails before commit', () => {
  const events = [];
  let closed = 0;
  const writer = {
    nextSequence: 1,
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    appendEvent(type, payload) {
      events.push({ type, payload });
      this.nextSequence += 1;
      if (type === 'apply-staged') {
        throw new Error('injected durable journal failure');
      }
      return { sequence: this.nextSequence - 1, type, payload };
    },
    flush() {},
    close() {
      closed += 1;
    },
    inspect() {
      return {
        filePath: '/var/lib/reprint/recovery.jsonl',
        records: events.slice(),
      };
    },
    assertCurrentClaim() {},
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });

  assert.throws(() => applyPlan(baseSite(), plan, {
    durableJournal: writer,
  }), /before committing remote mutations at apply-staged\./);
  assert.equal(closed, 0);
});

test('closes a durable journal writer after a successful apply', () => {
  const events = [];
  let closed = 0;
  const writer = {
    nextSequence: 1,
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    appendEvent(type, payload) {
      events.push({ type, payload });
      this.nextSequence += 1;
      return { sequence: this.nextSequence - 1, type, payload };
    },
    flush() {},
    close() {
      closed += 1;
    },
    inspect() {
      return {
        filePath: '/var/lib/reprint/recovery.jsonl',
        records: events.slice(),
      };
    },
    assertCurrentClaim() {},
  };
  const plan = planFor(baseSite(), baseSite(), {
    ...baseSite(),
    db: {
      ...baseSite().db,
      wp_options: {
        ...baseSite().db.wp_options,
        'option_name:blogname': { option_name: 'blogname', option_value: 'New Site' },
      },
    },
  });

  const result = applyPlan(baseSite(), plan, {
    durableJournal: writer,
  });

  assert.equal(result.recoveryState.status, 'fully-updated-remote');
  assert.equal(closed, 0);
  assert.ok(events.some((event) => event.type === 'journal-completed'));
});
